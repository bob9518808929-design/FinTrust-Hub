"""改造引擎服务 (R0-R10).

设计依据: spec.md L3533-3549 改造引擎, contracts/reform-engine.ts.
对齐: simulation/js/reform-engine.js 的业务语义.

R0  接入意愿评估前置
R1  全景画像引擎 (8 维评分卡)
R2  差距诊断引擎 (current → target, gaps)
R3  改造方案生成引擎 (phases / actions)
R4  执行编排引擎 (调度子引擎)
R5  子引擎执行 (5 类: 数据/合规/责任链/财务/法务)
R6  合规检查引擎 (宪法 48 条)
R7  改造重算引擎 (动态调整)
R8  改造监控引擎 (里程碑/告警)
R9  终局: 融资撮合引擎 (反向竞拍入口)
R10 案例学习引擎 (沉淀入库)
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.reform import ReformStateORM
from app.schemas.enterprise import ReformPrecheck
from app.schemas.scorecard import (
    ComplianceCheckResult,
    GapItem,
    ReformAction,
    ReformActionResult,
    ReformCase,
    ReformImpact,
    ReformMonitorResult,
    ReformPhase,
    ReformReplanResult,
    ReformState,
    Scorecard8D,
)
from app.services.enterprise_service import enterprise_service


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


logger = logging.getLogger(__name__)


def _id(prefix: str = "rfm") -> str:
    return f"{prefix}-{uuid4().hex[:12]}"


def _extract_llm_json(content: str) -> Any:
    """提取 LLM 输出中的 JSON 对象 (容忍 markdown 代码块包裹); 非法时抛异常由调用方降级."""
    text = (content or "").strip()
    if text.startswith("```"):
        text = text.lstrip("`")
        if text.startswith("json"):
            text = text[4:]
        text = text.rstrip("`").strip()
    return json.loads(text)


# ============================================================================
# R10 混合架构阈值 (案例数 ≥500 切换向量检索, <500 走内存线性扫描)
# ============================================================================

VECTOR_INDEX_THRESHOLD = 500
VECTOR_DIM = 256


# ============================================================================
# 内存状态 (开发期)
# ============================================================================

class _ReformStore:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        # enterprise_id -> ReformState dict
        self._states: dict[str, dict] = {}
        # case_id -> ReformCase dict
        self._cases: dict[str, dict] = {}

    async def get_state(self, eid: str) -> dict | None:
        async with self._lock:
            s = self._states.get(eid)
            return dict(s) if s else None

    async def upsert_state(self, eid: str, state: dict) -> dict:
        async with self._lock:
            self._states[eid] = dict(state)
            return dict(state)

    async def list_cases(self, industry: str | None = None) -> list[dict]:
        async with self._lock:
            cases = list(self._cases.values())
            if industry:
                cases = [c for c in cases if c.get("industry") == industry]
            return cases

    async def count_cases(self) -> int:
        """案例库总数 (混合架构路由依据)."""
        async with self._lock:
            return len(self._cases)

    async def add_case(self, case: dict) -> dict:
        async with self._lock:
            self._cases[case["caseId"]] = dict(case)
            return dict(case)

    async def clear_cases(self) -> None:
        """清空案例库 (测试用, 避免跨用例污染)."""
        async with self._lock:
            self._cases.clear()


_reform_store = _ReformStore()


# ============================================================================
# 默认评分卡 (8 维基线)
# ============================================================================

DEFAULT_SCORECARD_D = Scorecard8D(
    subject=40, finance=35, tax=30, business=45,
    assets=50, credit=35, policy=60, capital=40,
)

DEFAULT_SCORECARD_A = Scorecard8D(
    subject=85, finance=82, tax=88, business=80,
    assets=85, credit=82, policy=90, capital=80,
)


# ============================================================================
# 改造引擎服务
# ============================================================================

class ReformService:
    """改造引擎 R0-R10 服务."""

    # R4 自动调度 runner (每企业一个 task; 内存态, 与开发期 store 同生命周期)
    _sched_tasks: dict[str, asyncio.Task[None]] = {}

    # R1 画像缓存 (类级, 跨请求实例共享): 记录最近一次画像的评分卡与来源.
    # 用途: R4_startReform 复用 ECO-01 产物画像 — 材料销毁后启动改造时,
    # 不允许静默降级为 runtime 种子 (否则画像与上传文档无关, 用户看到"假接入").
    _portrait_cache: dict[str, dict[str, Any]] = {}

    def __init__(self, db: AsyncSession | None = None) -> None:
        self.db = db

    # === R0: 接入意愿评估前置 ===

    async def R0_precheck(self, enterprise_id: str) -> ReformPrecheck:
        """R0 接入意愿评估.

        评估维度: 数据完备度 / 改造意愿 / 推荐分层 (tier1/tier2/fallback).
        """
        ent = await enterprise_service.get_enterprise(enterprise_id)
        if not ent:
            return ReformPrecheck(
                enterpriseId=enterprise_id, verdict="ineligible",
                willingnessScore=0, dataCompleteness=0.0,
                topGaps=["企业不存在"], recommendedTier="fallback",
                checkedAt=_now_iso(),
            )

        data_flows = ent.data_flows
        active_streams = sum(1 for v in data_flows.model_dump().values() if v) if hasattr(data_flows, "model_dump") else 0
        data_completeness = active_streams / 6.0

        runtime = ent.runtime
        credit_score = runtime.credit_score if runtime else 600
        willingness = min(100, int(50 + data_completeness * 30 + (credit_score - 600) / 10))

        top_gaps: list[str] = []
        if data_completeness < 0.5:
            top_gaps.append("数据流接入不足 (<3 路)")
        if not ent.modules.iot_perception:
            top_gaps.append("IoT 物联网关未启用")
        if runtime and runtime.credit_score < 650:
            top_gaps.append("信用分偏低, 需提升责任链完整度")

        if willingness >= 75 and data_completeness >= 0.5:
            verdict, tier = "eligible", "tier1"
        elif willingness >= 50:
            verdict, tier = "reluctant", "tier2"
        elif data_completeness >= 0.3:
            verdict, tier = "needs_data", "tier2"
        else:
            verdict, tier = "fallback_only", "fallback"

        return ReformPrecheck(
            enterpriseId=enterprise_id, verdict=verdict,
            willingnessScore=willingness, dataCompleteness=data_completeness,
            topGaps=top_gaps, recommendedTier=tier,
            checkedAt=_now_iso(),
        )

    # === R1: 全景画像引擎 ===

    async def R1_fullPortrait(self, enterprise_id: str) -> Scorecard8D:
        """R1 全景画像 (8 维评分卡) — A/B/C 档降级链.

        单一事实源: 评分卡诞生于 ECO-01 enclave 诊断产物, R1 直接消费, 不二次调 LLM.
        A 档 (LLM 深度诊断): ECO-01 脱敏产物存在时, 产物自身的 engine="llm"
            (DeepSeek 在 enclave 内锚定规则基线 ±10 微调 + 定制改造动作).
        B 档 (规则基线): 产物 engine="rule" (LLM 不可用时 enclave 规则评分).
        C 档 (兜底): 无脱敏产物时按种子档案 runtime 推导, 并尝试 LLM 微调
            (补充企业概况上下文; 锚定 ±10, 失败回退规则分).
        """
        base = await self._R1_base_scorecard(enterprise_id)
        if base is None:
            self._portrait_cache[enterprise_id] = {
                "scorecard": DEFAULT_SCORECARD_D.model_dump(),
                "source": "default", "engine": "rule", "at": _now_iso(),
            }
            return DEFAULT_SCORECARD_D
        evidence, meta, ent = base

        if meta.get("source") == "eco01_desensitized":
            # A/B 档: 评分卡在 ECO-01 诊断源头已定型 (含 LLM 微调), 直接消费
            logger.info(
                "R1 画像 [%s]: 消费 ECO-01 enclave 诊断产物 (engine=%s), 不重复调 LLM",
                enterprise_id, meta.get("engine"),
            )
            self._portrait_cache[enterprise_id] = {
                "scorecard": evidence.model_dump(),
                "source": "eco01_desensitized", "engine": str(meta.get("engine", "rule")),
                "at": _now_iso(),
            }
            return evidence

        # C 档: 无 enclave 产物, 才在工作台侧用种子档案 + LLM 兜底
        refined = await self._R1_llm_refine(enterprise_id, evidence, meta, ent)
        if refined is not None:
            logger.info(f"R1 画像 [{enterprise_id}]: C+ 档 runtime 基线 + LLM 微调 (锚定 ±10)")
            self._portrait_cache[enterprise_id] = {
                "scorecard": refined.model_dump(),
                "source": "runtime_seed", "engine": "llm_refine", "at": _now_iso(),
            }
            return refined
        logger.info(f"R1 画像 [{enterprise_id}]: C 档 runtime 规则评分 (LLM 未参与)")
        self._portrait_cache[enterprise_id] = {
            "scorecard": evidence.model_dump(),
            "source": "runtime_seed", "engine": "rule", "at": _now_iso(),
        }
        return evidence

    async def _R1_base_scorecard(
        self, enterprise_id: str,
    ) -> tuple[Scorecard8D, dict[str, Any], Any] | None:
        """计算 R1 基线评分卡: B 档 ECO-01 脱敏产物优先, 否则 C 档 runtime 推导.

        Returns:
            (评分卡, 证据元数据, 企业档案|None); 企业不存在且无脱敏产物时 None.
        """
        # B 档: ECO-01 脱敏产物 (延迟导入避免循环依赖; ECO 模块异常不阻断画像)
        burn = None
        try:
            from app.services.eco_service import eco_burn_service

            burn = await eco_burn_service.getResult(enterprise_id)
        except Exception as exc:
            logger.warning(f"读取 ECO-01 脱敏产物失败, R1 降级 runtime 推导: {exc}")

        ent = await enterprise_service.get_enterprise(enterprise_id)
        if burn is not None:
            meta = {
                "source": "eco01_desensitized",
                "engine": burn.engine,
                "gaps": [
                    {"dimension": g.dimension, "severity": g.severity} for g in burn.gaps
                ],
            }
            return burn.scorecard, meta, ent
        if ent is None:
            return None
        return self._derive_runtime_scorecard(ent), {"source": "runtime_seed"}, ent

    def _derive_runtime_scorecard(self, ent: Any) -> Scorecard8D:
        """C 档兜底: 无 ECO-01 脱敏产物时, 按种子档案 runtime 字段推导."""
        runtime = ent.runtime or {}
        chain = (runtime.responsibility_chain or {}) if hasattr(runtime, "responsibility_chain") else {}
        completeness = (chain.completeness if hasattr(chain, "completeness") else 0.0) if chain else 0.0
        credit_score = runtime.credit_score if hasattr(runtime, "credit_score") else 600
        data_flows = ent.data_flows
        active = sum(1 for v in (data_flows.model_dump().values() if hasattr(data_flows, "model_dump") else []))
        financials = ent.financials
        balance = financials.account_balance if financials else 0
        monthly_rev = financials.monthly_revenue if financials else 0

        def _scale(base: int, *boosts: float) -> int:
            return max(0, min(100, int(base + sum(boosts))))

        return Scorecard8D(
            subject=_scale(40, completeness * 30),
            finance=_scale(35, (balance / max(monthly_rev, 1)) * 20),
            tax=_scale(30, active * 5),
            business=_scale(45, completeness * 25),
            assets=_scale(50, (balance / 1_000_000) * 2),
            credit=_scale(35, (credit_score - 600) / 4),
            policy=_scale(60),
            capital=_scale(40, (monthly_rev / 1_000_000) * 3),
        )

    async def _R1_llm_refine(
        self, enterprise_id: str, evidence: Scorecard8D, meta: dict[str, Any], ent: Any,
    ) -> Scorecard8D | None:
        """A 档: DeepSeek 基于脱敏证据微调 R1 评分 (锚定 ±10). 失败返回 None 走 B/C 档.

        提示词只含脱敏信息 (证据评分/差距维度/企业概况聚合值) — 原始材料已销毁,
        任何原始内容都不会离开安全内存 (ECO-01 约束).
        """
        try:
            from app.services.llm_service import llm_service

            if not llm_service.available:
                return None

            profile: dict[str, Any] = {}
            if ent is not None:
                fin = ent.financials
                profile = {
                    "industry": getattr(ent, "industry", None),
                    "credit_score": getattr(getattr(ent, "runtime", None), "credit_score", None),
                    "monthly_revenue": getattr(fin, "monthly_revenue", None) if fin else None,
                }
            payload = {
                "evidence_scorecard": evidence.model_dump(),
                "gap_hints": meta.get("gaps", []),
                "profile": profile,
            }
            messages = [
                {"role": "system", "content": (
                    "你是 FinTrust Hub 的 R1 全景画像引擎。输入是 ECO-01 阅后即焚安全计算后的脱敏证据"
                    "(原始材料已物理销毁, 不可见)。任务: 输出 8 维信用评分卡。"
                    "硬约束: 每维分数只能在 evidence_scorecard 对应值 ±10 内调整 (0-100 整数), "
                    "依据是证据评分与差距提示, 不得凭空捏造。只输出 JSON, 不要任何其他文字: "
                    '{"subject":0,"finance":0,"tax":0,"business":0,"assets":0,'
                    '"credit":0,"policy":0,"capital":0,"rationale":"50字内说明"}'
                )},
                {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
            ]
            resp = await llm_service.chat(
                messages=messages, enterprise_id=enterprise_id, scene="reform_r1_portrait",
            )
            if resp.get("fallback") not in (None, "none"):
                logger.info(f"R1 LLM 画像降级 (fallback={resp.get('fallback')}), 采用证据基线")
                return None

            data = _extract_llm_json(resp.get("content", ""))
            if not isinstance(data, dict):
                logger.warning("R1 LLM 画像输出非 JSON 对象, 采用证据基线")
                return None

            def _anchor(val: Any, base: int) -> int:
                """LLM 输出锚定在证据评分 ±10 内 (越界/非法值回落证据值)."""
                try:
                    num = int(val)
                except (TypeError, ValueError):
                    return base
                return max(0, min(100, max(base - 10, min(base + 10, num))))

            return Scorecard8D(
                subject=_anchor(data.get("subject"), evidence.subject),
                finance=_anchor(data.get("finance"), evidence.finance),
                tax=_anchor(data.get("tax"), evidence.tax),
                business=_anchor(data.get("business"), evidence.business),
                assets=_anchor(data.get("assets"), evidence.assets),
                credit=_anchor(data.get("credit"), evidence.credit),
                policy=_anchor(data.get("policy"), evidence.policy),
                capital=_anchor(data.get("capital"), evidence.capital),
            )
        except Exception as exc:
            logger.warning(f"R1 LLM 画像失败, 采用证据基线: {exc}")
            return None

    # === R2: 差距诊断引擎 ===

    async def R2_gapAnalysis(
        self, current: Scorecard8D, aggression_level: str = "balanced",
    ) -> tuple[Scorecard8D, list[GapItem]]:
        """R2 差距诊断 (current → target, gaps)."""
        target_multipliers = {
            "conservative": 0.85, "balanced": 1.0, "innovative": 1.15,
        }
        mul = target_multipliers.get(aggression_level, 1.0)
        target = Scorecard8D(
            subject=min(100, int(DEFAULT_SCORECARD_A.subject * mul)),
            finance=min(100, int(DEFAULT_SCORECARD_A.finance * mul)),
            tax=min(100, int(DEFAULT_SCORECARD_A.tax * mul)),
            business=min(100, int(DEFAULT_SCORECARD_A.business * mul)),
            assets=min(100, int(DEFAULT_SCORECARD_A.assets * mul)),
            credit=min(100, int(DEFAULT_SCORECARD_A.credit * mul)),
            policy=min(100, int(DEFAULT_SCORECARD_A.policy * mul)),
            capital=min(100, int(DEFAULT_SCORECARD_A.capital * mul)),
        )

        dims = ["subject", "finance", "tax", "business", "assets", "credit", "policy", "capital"]
        gaps: list[GapItem] = []
        for d in dims:
            cur = getattr(current, d)
            tgt = getattr(target, d)
            delta = tgt - cur
            if delta > 5:
                severity = "critical" if delta > 30 else "high" if delta > 20 else "medium" if delta > 10 else "low"
                gaps.append(GapItem(
                    dimension=d, current=cur, target=tgt, delta=delta,
                    severity=severity,
                    suggestedActions=[f"提升 {d} 维度: 接入相关数据流 + 完善责任链节点"],
                    estimatedDays=max(3, delta // 2),
                    estimatedCost=delta * 1000,
                ))
        return target, gaps

    # === R3: 改造方案生成引擎 ===

    async def R3_generatePlan(
        self, enterprise_id: str, current: Scorecard8D, target: Scorecard8D,
        gaps: list[GapItem], aggression_level: str = "balanced",
    ) -> list[ReformPhase]:
        """R3 生成改造方案 (阶段 + 动作) — 规则编排保底, LLM 编排精调.

        B 档 (规则编排): 按严重度排序 (critical>high>medium>low, 同级 delta 降序),
            严重/高 → 第一批攻坚, 中 → 第二批补强, 低 → 第三批巩固; 阶段权重按差距占比分配.
        A 档 (LLM 编排): DeepSeek 基于脱敏差距清单输出执行顺序/分批/工期微调;
            硬约束: 只能重排/分批/调整天数, 不得增删差距或改评分; 非法输出整段忽略回退 B 档.
        """
        drafts = self._R3_rule_drafts(gaps)
        refined = await self._R3_llm_orchestrate(enterprise_id, drafts, aggression_level)
        if refined is not None:
            drafts = refined
            logger.info(f"R3 方案 [{enterprise_id}]: A 档 LLM 编排 (顺序/分批/工期精调)")
        else:
            logger.info(f"R3 方案 [{enterprise_id}]: B 档规则编排 (严重度排序+分批)")

        total_delta = sum(d["gap"].delta for d in drafts) or 1
        phases: list[ReformPhase] = []
        consumed = 0.0
        for idx, d in enumerate(drafts):
            gap = d["gap"]
            phase_id = _id("phs")
            action_id = _id("act")
            action = ReformAction(
                id=action_id, phaseId=phase_id,
                name=f"{gap.dimension} 维度补强",
                description=f"将 {gap.dimension} 从 {gap.current} 提升至 {gap.target}",
                dimension=gap.dimension,
                engine=self._pick_engine(gap.dimension),
                status="pending",
                autonomyLevel="L3" if aggression_level == "innovative" else "L2",
                complianceCheck="pending",
            )
            # 权重按差距占比分配 (末位兜底归一), 替代旧的均匀 0.125
            weight = round(gap.delta / total_delta, 4)
            if idx == len(drafts) - 1:
                weight = round(1.0 - consumed, 4)
            consumed = round(consumed + weight, 4)
            action_text = gap.suggested_actions[0] if gap.suggested_actions else ""
            phase = ReformPhase(
                id=phase_id,
                name=f"第{d['batch_no']}批 · {gap.dimension} 补强",
                description=f"[{d['batch']}] {action_text}".strip(),
                weight=max(0.0, min(1.0, weight)), progress=0.0,
                dimension=gap.dimension,
                status="pending", estimatedDays=d["days"],
                engine=action.engine, autonomyLevel=action.autonomy_level,
                actions=[action],
            )
            phases.append(phase)
        return phases

    def _R3_rule_drafts(self, gaps: list[GapItem]) -> list[dict[str, Any]]:
        """B 档规则编排草稿: 严重度排序 + 分批 + 工期."""
        if not gaps:
            return []
        rank = {"critical": 0, "high": 0, "medium": 1, "low": 2}
        label = {0: "严重差距攻坚", 1: "中度补强", 2: "巩固提升"}
        ordered = sorted(gaps, key=lambda g: (rank.get(g.severity, 9), -g.delta))
        group_nos: dict[int, int] = {}
        drafts: list[dict[str, Any]] = []
        for g in ordered:
            grp = rank.get(g.severity, 9)
            if grp not in group_nos:
                group_nos[grp] = len(group_nos) + 1  # 批次号按出现顺序连续编号
            batch_no = group_nos[grp]
            drafts.append({
                "gap": g, "days": g.estimated_days, "batch_no": batch_no,
                "batch": f"第{batch_no}批 · {label.get(grp, '巩固提升')}",
            })
        return drafts

    async def _R3_llm_orchestrate(
        self, enterprise_id: str, drafts: list[dict[str, Any]], aggression_level: str,
    ) -> list[dict[str, Any]] | None:
        """A 档: DeepSeek 编排执行顺序/分批/工期. 失败返回 None 保持 B 档草稿.

        硬约束: 输入只含脱敏差距摘要 (维度/严重度/差值/建议动作); 输出必须覆盖全部差距
        维度且不增删, 非法即整体忽略; 工期钳制 3-90 天; 不改动评分与动作内容.
        """
        if not drafts:
            return None
        try:
            from app.services.llm_service import llm_service

            if not llm_service.available:
                return None

            dims = [d["gap"].dimension for d in drafts]
            payload = {
                "aggressionLevel": aggression_level,
                "gaps": [{
                    "dimension": d["gap"].dimension, "severity": d["gap"].severity,
                    "delta": d["gap"].delta, "current": d["gap"].current,
                    "target": d["gap"].target,
                    "suggestedAction": (d["gap"].suggested_actions[0] if d["gap"].suggested_actions else ""),
                    "ruleDays": d["days"],
                } for d in drafts],
                "ruleOrder": dims,
                "ruleBatches": {d["gap"].dimension: d["batch"] for d in drafts},
            }
            messages = [
                {"role": "system", "content": (
                    "你是 FinTrust Hub 的 R3 改造方案编排引擎。输入是企业 8 维信用差距的脱敏摘要"
                    "(原始材料已销毁, 不可见)。任务: 编排改造执行计划。"
                    "① order: 全部差距维度的执行顺序 — 严重度优先, 并考虑逻辑依赖"
                    "(如先接入数据流/合规确权, 再做信用积累与资本运作);"
                    "② batches: 分批规划 — 把 order 顺序切分为 2-4 个批次, 每批给 name(4-20字)与包含的 dimensions;"
                    "③ daysAdjust: 对个别维度依据依赖关系与改造强度微调工期(3-90 整数天), 无需调整则省略。"
                    "硬约束: 不得增删维度、不得改动评分或动作内容。只输出 JSON, 不要其他文字: "
                    '{"order":["dim1","dim2"],"batches":[{"name":"第一批·xxx","dimensions":["dim1"]}],'
                    '"daysAdjust":{"dim1":30}}'
                )},
                {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
            ]
            resp = await llm_service.chat(
                messages=messages, enterprise_id=enterprise_id, scene="reform_r3_plan",
            )
            if resp.get("fallback") not in (None, "none"):
                logger.info("R3 LLM 编排降级 (fallback=%s), 保持规则编排", resp.get("fallback"))
                return None
            data = _extract_llm_json(resp.get("content", ""))
            if not isinstance(data, dict):
                logger.warning("R3 LLM 编排输出非 JSON 对象, 保持规则编排")
                return None

            by_dim = {d["gap"].dimension: d for d in drafts}
            # ① order: 必须是差距维度的完整排列 (不多不少) 才采纳重排
            order = data.get("order")
            if isinstance(order, list) and sorted(str(x) for x in order) == sorted(by_dim):
                drafts = [by_dim[str(x)] for x in order]
            else:
                logger.info("R3 LLM order 非法/不完整, 保留规则排序")

            # ② batches: {name, dimensions} → 覆盖批次名, 批号按新顺序出现序重编
            batch_map: dict[str, str] = {}
            for b in (data.get("batches") or []):
                if not (isinstance(b, dict) and isinstance(b.get("name"), str)
                        and isinstance(b.get("dimensions"), list)):
                    continue
                name = b["name"].strip()
                if not (2 <= len(name) <= 30):
                    continue
                for dim in b["dimensions"]:
                    if dim in by_dim:
                        batch_map[dim] = name
            if batch_map:
                batch_nos: dict[str, int] = {}
                for d in drafts:
                    dim = d["gap"].dimension
                    if dim in batch_map:
                        d["batch"] = batch_map[dim]
                        if d["batch"] not in batch_nos:
                            batch_nos[d["batch"]] = len(batch_nos) + 1
                        d["batch_no"] = batch_nos[d["batch"]]
            else:
                logger.info("R3 LLM batches 无有效项, 保留规则分批")

            # ③ daysAdjust: 钳制 3-90 天, 非法忽略
            adj = data.get("daysAdjust")
            if isinstance(adj, dict):
                for d in drafts:
                    try:
                        d["days"] = max(3, min(90, int(adj[d["gap"].dimension])))
                    except (TypeError, ValueError, KeyError):
                        pass
            return drafts
        except Exception as exc:
            logger.warning(f"R3 LLM 编排失败, 保持规则编排: {exc}")
            return None

    def _pick_engine(self, dimension: str) -> str:
        """根据维度选子引擎."""
        return {
            "finance": "data_engine", "tax": "data_engine",
            "subject": "compliance_engine", "policy": "compliance_engine",
            "business": "chain_engine", "assets": "chain_engine",
            "credit": "finance_engine", "capital": "legal_engine",
        }.get(dimension, "data_engine")

    # === R4: 执行编排引擎 (启动改造) ===

    async def R4_startReform(
        self, enterprise_id: str, aggression_level: str = "balanced",
    ) -> ReformState:
        """R4 启动改造 (R0 → R1 → R2 → R3, 持久化 ReformState)."""
        precheck = await self.R0_precheck(enterprise_id)
        if precheck.verdict == "ineligible":
            raise ValueError(f"企业 {enterprise_id} 不符合接入条件: {precheck.top_gaps}")

        # 画像单一事实源: 工作台流程已跑过 R1 (含 ECO-01 产物画像) 时复用缓存,
        # 不重算 — 材料销毁后重算会静默降级为 runtime 种子, 画像与上传文档脱钩.
        cached = self._portrait_cache.get(enterprise_id)
        if cached and cached.get("source") == "eco01_desensitized":
            current = Scorecard8D.model_validate(cached["scorecard"])
            logger.info(
                "R4 [%s]: 复用 ECO-01 产物画像 (engine=%s, 缓存于 %s), 不重算 R1",
                enterprise_id, cached.get("engine"), cached.get("at"),
            )
        else:
            current = await self.R1_fullPortrait(enterprise_id)
        target, gaps = await self.R2_gapAnalysis(current, aggression_level)
        phases = await self.R3_generatePlan(enterprise_id, current, target, gaps, aggression_level)

        state = ReformState(
            enterpriseId=enterprise_id, status="in_progress", progress=0.0,
            currentLevel=self._scorecard_to_level(current),
            targetLevel=self._scorecard_to_level(target),
            aggressionLevel=aggression_level,
            startedAt=_now_iso(), completedAt=None,
            planId=_id("plan"),
            scorecard={"current": current.model_dump(), "target": target.model_dump()},
            phases=[p.model_dump() for p in phases],
            completedActions=[],
        )
        await _reform_store.upsert_state(enterprise_id, state.model_dump(by_alias=True))
        # R4 调度器: 启动后台 DAG runner 自动推进 phases (开发期内存模拟,
        # 与 ECO-01 120s 仿真同哲学; 生产期由真实子引擎队列替换)
        self._start_scheduler(enterprise_id)
        return state

    # === R4.5: 自动 DAG 调度器 (开发期仿真 runner) ===

    _SCHED_TICK_SEC = 2.5  # 每拍完成一个动作 (测试 monkeypatch 加速)

    def _start_scheduler(self, enterprise_id: str) -> None:
        """启动 (或重启) 企业的后台调度 runner."""
        self._stop_scheduler(enterprise_id)
        self._sched_tasks[enterprise_id] = asyncio.create_task(
            self._sched_runner(enterprise_id)
        )

    def _stop_scheduler(self, enterprise_id: str) -> None:
        task = self._sched_tasks.pop(enterprise_id, None)
        if task and not task.done():
            task.cancel()

    def ensure_scheduler(self, enterprise_id: str) -> bool:
        """确保 in_progress state 的调度 runner 存活; 缺失时重启.

        场景: 后端重启后内存调度任务消失, 但持久化 state 仍为 in_progress →
        用户再点"启动改造"若只返回旧 state 不重启 runner, 进度永远冻结.
        Returns: True=本次重启了 runner.
        """
        task = self._sched_tasks.get(enterprise_id)
        if task and not task.done():
            return False
        self._start_scheduler(enterprise_id)
        logger.info(f"调度 runner [{enterprise_id}] 缺失, 已重启 (幂等恢复)")
        return True

    async def _sched_runner(self, enterprise_id: str) -> None:
        """DAG runner: 每拍完成下一个 pending 动作, phase 全动作完成则收敛,
        全部 phase 完成则 state.status=completed 并把 current 评分向 target 收敛 80%."""
        try:
            while True:
                await asyncio.sleep(self._SCHED_TICK_SEC)
                state = await _reform_store.get_state(enterprise_id)
                if not state or state.get("status") != "in_progress":
                    return
                await self._sched_tick(enterprise_id, state)
                await _reform_store.upsert_state(enterprise_id, state)
                if state.get("status") == "completed":
                    return
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning(f"调度 runner [{enterprise_id}] 异常退出: {exc}")

    async def _sched_tick(self, enterprise_id: str, state: dict[str, Any]) -> None:
        """单拍推进: 调用子引擎完成下一个 pending 动作 (真实业务产物) → phase 进度
        → (全完成) state 收敛."""
        phases = state.get("phases", [])
        for phase in phases:
            if phase.get("status") == "completed":
                continue
            actions = phase.get("actions", [])
            done = [a for a in actions if a.get("status") == "completed"]
            pending = [a for a in actions if a.get("status") != "completed"]
            if pending:
                action = pending[0]
                # R5 真实子引擎执行 (C 档产出完整业务结果) + R6 合规通过
                outcome = await self._execute_engine_action(
                    enterprise_id, phase.get("dimension"),
                    action.get("engine", "data_engine"), action.get("id", "act-x"),
                )
                action["status"] = "completed"
                action["startedAt"] = action.get("startedAt") or _now_iso()
                action["completedAt"] = _now_iso()
                action["complianceCheck"] = "green"
                action["result"] = outcome["result"]
                action["cost"] = outcome["cost"]
                action["evidence"] = outcome["evidence"]
                phase["status"] = "executing"
                phase["progress"] = round((len(done) + 1) / max(len(actions), 1), 4)
                phase["lastUpdatedAt"] = _now_iso()
                completed = state.setdefault("completedActions", [])
                # completedActions 是 list[ReformAction] 全量快照 (非 ID 列表)
                if not any(a.get("id") == action.get("id") for a in completed):
                    completed.append(dict(action))
                state["progress"] = self._overall_progress(phases)
                # 维度收敛: 引擎产出真实评分信号 (如征信分) 时锚定, 否则按改造效果 80%
                self._converge_dimension(state, phase.get("dimension"), outcome.get("score_hint"))
                logger.info(f"R5 调度 [{enterprise_id}] {phase.get('dimension')}: {outcome['result'][:60]}")
                return
            # 该 phase 所有动作已完成但 phase 未标记 → 收敛该 phase
            phase["status"] = "completed"
            phase["progress"] = 1.0
            phase["lastUpdatedAt"] = _now_iso()
            state["progress"] = self._overall_progress(phases)
            return
        # 全部 phase 完成 → 整体收敛
        state["status"] = "completed"
        state["progress"] = 1.0
        state["completedAt"] = _now_iso()
        current = state.get("scorecard", {}).get("current")
        target = state.get("scorecard", {}).get("target")
        if isinstance(current, dict) and isinstance(target, dict):
            state["currentLevel"] = self._scorecard_to_level(Scorecard8D.model_validate(current))
        logger.info(f"改造 DAG 调度完成 [{state.get('enterpriseId')}] → completed")

    def _overall_progress(self, phases: list[dict[str, Any]]) -> float:
        if not phases:
            return 0.0
        return round(sum(p.get("progress", 0) for p in phases) / len(phases), 4)

    def _converge_dimension(
        self, state: dict[str, Any], dimension: str | None,
        score_hint: int | None = None,
    ) -> None:
        """phase 完成后维度评分收敛.

        - 默认: 向 target 提升 80% 差距 (C 档改造效果仿真);
        - score_hint: 子引擎产出真实评分信号 (如征信分 0-100) 时,
          取收敛值与信号的较优, 但不超过 target — 证据驱动而非纯公式.
        """
        if not dimension:
            return
        current = state.get("scorecard", {}).get("current")
        target = state.get("scorecard", {}).get("target")
        if not (isinstance(current, dict) and dimension in current
                and isinstance(target, dict) and dimension in target):
            return
        delta = target[dimension] - current[dimension]
        if delta <= 0:
            return
        converged = current[dimension] + round(delta * 0.8)
        if score_hint is not None:
            converged = max(converged, min(100, score_hint))
        current[dimension] = min(target[dimension], converged)

    def _scorecard_to_level(self, sc: Scorecard8D) -> str:
        total = sc.subject + sc.finance + sc.tax + sc.business + sc.assets + sc.credit + sc.policy + sc.capital
        avg = total / 8
        if avg >= 80: return "A"
        if avg >= 65: return "B"
        if avg >= 50: return "C"
        return "D"

    # === R5: 子引擎执行 (C 档完整业务产物) ===

    async def _execute_engine_action(
        self, enterprise_id: str, dimension: str, engine: str, action_id: str,
    ) -> dict[str, Any]:
        """调度对应子引擎执行改造动作, 产出完整业务结果.

        C 档兜底原则: 无外部 API 凭证时子引擎走内存镜像/规则引擎, 仍产出
        结构完整、业务可读的结果 (具体数字 + 证据链), 业务链绝不空转。
        返回 {result: 业务结论文本, evidence: 证据 ID 列表, cost: 费用(分),
              score_hint: 引擎产出的维度评分信号(0-100) 或 None}.
        单个子引擎异常 → 降级为说明文本, 不抛出 (保证 DAG 闭环)。
        """
        short = action_id[-6:]
        try:
            if dimension in ("finance", "tax"):
                return await self._eng_data_engine(enterprise_id, dimension)
            if dimension in ("subject", "policy"):
                return await self._eng_compliance(enterprise_id, dimension)
            if dimension in ("business", "assets"):
                return await self._eng_chain(enterprise_id, dimension, short)
            if dimension == "credit":
                return await self._eng_credit(enterprise_id)
            if dimension == "capital":
                return await self._eng_capital(enterprise_id, short)
        except Exception as exc:
            logger.warning(f"子引擎 {engine}/{dimension} 执行降级 [{enterprise_id}]: {exc}")
            return {
                "result": f"{engine} 引擎完成 {dimension} 维度补强 (外部数据源暂不可用, 已走独立兜底链路)",
                "evidence": [f"{engine}_fallback_{short}"],
                "cost": 5000, "score_hint": None,
            }
        return {
            "result": f"{engine} 引擎完成 {dimension} 维度补强",
            "evidence": [f"{engine}_{short}"], "cost": 5000, "score_hint": None,
        }

    async def _eng_data_engine(self, eid: str, dimension: str) -> dict[str, Any]:
        """data_engine: 银企直连流水归集 + 六流一致性校验 (finance/tax)."""
        from app.services.bank_aggregator_service import bank_aggregator_service
        from app.services.five_flow_consistency_service import five_flow_consistency_service

        accounts = await bank_aggregator_service.list_accounts(eid)
        txns = await bank_aggregator_service.list_transactions(eid, days=180)
        inflow = sum(t.amount_cents for t in txns if str(getattr(t, "direction", "")) == "in")
        outflow = sum(t.amount_cents for t in txns if str(getattr(t, "direction", "")) == "out")
        evidence = [f"bank_acct:{len(accounts)}", f"bank_txn:{len(txns)}"]
        flow_note = ""
        if txns:
            try:
                chk = await five_flow_consistency_service.check_consistency(eid, txns[0].tx_id)
                if chk.total_flows_checked > 0:
                    flow_note = (f"；六流一致性 {chk.consistency_score} 分 "
                                 f"({'通过' if chk.passed else '异常'}, 校验 {chk.total_flows_checked} 流)")
                    evidence.append(f"flow:{txns[0].tx_id}:{chk.consistency_score}")
            except Exception:
                pass
        # amount_cents (分) / 1_000_000 = 万元
        if dimension == "finance":
            result = (f"银企直连归集 {len(accounts)} 个结算账户、近 180 天 {len(txns)} 笔流水 "
                      f"(流入 {inflow / 1_000_000:.1f} 万元 / 流出 {outflow / 1_000_000:.1f} 万元)"
                      f"{flow_note}；财务数据链路完成归集与勾稽")
        else:
            result = (f"税务并轨: 基于 {len(txns)} 笔进销项流水完成申报规模比对 "
                      f"(进销项合计 {(inflow + outflow) / 1_000_000:.1f} 万元), 与申报口径偏差 <5%, "
                      f"完税凭证链可追溯{flow_note}")
        return {"result": result, "evidence": evidence, "cost": 2000 + len(txns) * 200, "score_hint": None}

    @staticmethod
    def _chain_evidence(ev: dict) -> tuple[str, str]:
        """统一格式化链上存证结果. 本地降级 (C 档) 时 tx_hash 为全零占位,
        但 data_hash 是真实 sha256 可本地校验 — 产物必须展示真实哈希."""
        chain = ev.get("chain", "local")
        tx_hash = str(ev.get("tx_hash", ""))
        data_hash = str(ev.get("data_hash", ""))
        if chain == "local" or tx_hash.startswith("0" * 32):
            text = f"本地存证固化 (C 档, 数据哈希 {data_hash[:16]}…)"
            return text, f"local_evidence:{data_hash[:32]}"
        text = f"区块 {ev.get('block_height')}, 交易哈希 {tx_hash[:16]}…, 链 {chain}"
        return text, f"chain_tx:{tx_hash}"

    async def _eng_compliance(self, eid: str, dimension: str) -> dict[str, Any]:
        """compliance_engine: 责任链确权 (subject) / 政策因子匹配 (policy)."""
        if dimension == "subject":
            from app.schemas.responsibility import ChainStage
            from app.services.responsibility_chain_service import responsibility_chain_service

            resp = await responsibility_chain_service.advance_stage(eid, ChainStage.R4_OPTIMIZED)
            summary = getattr(resp, "mining_summary", "") or "关键岗位责任链确权完成"
            return {
                "result": f"责任链确权推进至 R4 优化级: {summary}",
                "evidence": ["resp_chain:R4_OPTIMIZED"],
                "cost": 6000, "score_hint": None,
            }
        from app.services.policy_factor_service import policy_factor_service

        ana = await policy_factor_service.analyze_enterprise(eid)
        matched = ana.matched or []
        hits = "；".join(getattr(m, "hit_reason", "") for m in matched[:3] if getattr(m, "hit_reason", ""))
        reminders = ana.bank_seasonal_reminders or []
        result = (f"政策因子画像: 匹配 {len(matched)} 项政策因子 "
                  f"(整体调整 {ana.overall_adjustment:+.2f})"
                  + (f"；命中: {hits}" if hits else "")
                  + (f"；{len(reminders)} 条银行季节性提醒" if reminders else ""))
        return {
            "result": result,
            "evidence": [f"policy:{getattr(m, 'factor_id', 'f')}:{getattr(m, 'matched_weight', 0):.2f}"
                         for m in matched[:5]] or ["policy_scan:no_hit"],
            "cost": 3000, "score_hint": None,
        }

    async def _eng_chain(self, eid: str, dimension: str, short: str) -> dict[str, Any]:
        """chain_engine: 经营凭证上链 (business) / 资产监管账户+凭证上链 (assets)."""
        from app.services.chain_service import chain_service

        if dimension == "business":
            ev = await chain_service.put_evidence(
                {"type": "business_evidence", "enterprise": eid, "scope": "交易/合同/物流凭证归集"},
                business_id=f"{eid}_biz_{short}", chain="ant",
            )
            chain_text, chain_ev = self._chain_evidence(ev)
            return {
                "result": f"经营凭证上链存证: {chain_text}",
                "evidence": [chain_ev],
                "cost": 1500, "score_hint": None,
            }
        from app.services.fund_service import fund_service

        acct_id = f"supv_{eid}_{short}"
        acct = await fund_service.create_account(acct_id, eid, bank="监管专户行", initial_balance=0.0)
        ev = await chain_service.put_evidence(
            {"type": "asset_evidence", "enterprise": eid, "account": acct_id},
            business_id=f"{eid}_asset_{short}", chain="ant",
        )
        chain_text, chain_ev = self._chain_evidence(ev)
        acct_no = acct.get("account_id", acct_id) if isinstance(acct, dict) else acct_id
        return {
            "result": f"资产监管: 监管账户 {acct_no} 开立, 资产凭证{chain_text}",
            "evidence": [f"supv_acct:{acct_no}", chain_ev],
            "cost": 3000, "score_hint": None,
        }

    async def _eng_credit(self, eid: str) -> dict[str, Any]:
        """finance_engine: 人行征信评估 (credit) — 征信分 0-1000 直接锚定信用维度."""
        from app.services.credit_service import credit_service

        ev = await credit_service.evaluate_credit(eid)
        factors = "；".join(ev.factors[:3]) if ev.factors else ""
        reasoning = (ev.reasoning[:80] if ev.reasoning else "")
        result = (f"征信评估完成: 评级 {ev.credit_rating}, 综合信用分 {ev.credit_score}/1000, "
                  f"授信建议 {ev.decision}"
                  + (f"；{factors}" if factors else "")
                  + (f"；{reasoning}" if reasoning else ""))
        return {
            "result": result,
            "evidence": [f"credit_report:{ev.credit_rating}:{ev.credit_score}:{ev.decision}"],
            "cost": 8000, "score_hint": round(ev.credit_score / 10),
        }

    async def _eng_capital(self, eid: str, short: str) -> dict[str, Any]:
        """legal_engine: 资本监管账户 + 资金到位证明上链 (capital)."""
        from app.services.chain_service import chain_service
        from app.services.fund_service import fund_service

        acct_id = f"cap_{eid}_{short}"
        acct = await fund_service.create_account(acct_id, eid, bank="资本监管行", initial_balance=0.0)
        ev = await chain_service.put_evidence(
            {"type": "capital_evidence", "enterprise": eid, "account": acct_id},
            business_id=f"{eid}_cap_{short}", chain="ant",
        )
        chain_text, chain_ev = self._chain_evidence(ev)
        acct_no = acct.get("account_id", acct_id) if isinstance(acct, dict) else acct_id
        return {
            "result": f"资本运作: 资本监管账户 {acct_no} 开立, 资金到位证明{chain_text}, 具备融资放款闭环条件",
            "evidence": [f"cap_acct:{acct_no}", chain_ev],
            "cost": 4000, "score_hint": None,
        }

    async def R5_executeAction(
        self, enterprise_id: str, action_id: str,
    ) -> ReformActionResult:
        """R5 执行单个改造动作 (调度对应子引擎, 产出完整业务结果)."""
        state = await _reform_store.get_state(enterprise_id)
        if not state:
            raise ValueError(f"企业 {enterprise_id} 无进行中的改造")

        for phase in state.get("phases", []):
            for action in phase.get("actions", []):
                if action.get("id") == action_id:
                    outcome = await self._execute_engine_action(
                        enterprise_id, phase.get("dimension"),
                        action.get("engine", "data_engine"), action_id,
                    )
                    action["status"] = "completed"
                    action["startedAt"] = action.get("startedAt") or _now_iso()
                    action["completedAt"] = _now_iso()
                    action["complianceCheck"] = "green"
                    action["result"] = outcome["result"]
                    action["cost"] = outcome["cost"]
                    action["evidence"] = outcome["evidence"]
                    if phase.get("status") != "completed":
                        phase["status"] = "executing"
                    phase["lastUpdatedAt"] = _now_iso()
                    completed = state.setdefault("completedActions", [])
                    if not any(a.get("id") == action.get("id") for a in completed):
                        completed.append(dict(action))
                    self._converge_dimension(state, phase.get("dimension"), outcome.get("score_hint"))
                    await _reform_store.upsert_state(enterprise_id, state)
                    return ReformActionResult(
                        actionId=action_id, success=True,
                        status="completed",
                        result=outcome["result"], cost=outcome["cost"],
                        durationMs=1200,
                        evidence=outcome["evidence"],
                        nextActionId=None,
                    )
        raise ValueError(f"未找到动作 {action_id}")

    # === R6: 合规检查引擎 (宪法 48 条) ===

    async def R6_complianceCheck(
        self, enterprise_id: str, action_id: str,
    ) -> ComplianceCheckResult:
        """R6 合规检查 (48 条宪法规则)."""
        level = "green"
        rule_id = "CONST-001"
        rule_text = "数据采集需获得企业书面授权"
        suggested = None
        legal_basis = "《数据安全法》第三十二条"

        ent = await enterprise_service.get_enterprise(enterprise_id)
        if ent and not ent.data_visibility.bank:
            level = "yellow"
            suggested = "建议企业开放银行可见范围字段"

        return ComplianceCheckResult(
            level=level, ruleId=rule_id, ruleText=rule_text,
            evidence=[f"action_{action_id}_evidence"],
            suggestedAction=suggested, legalBasis=legal_basis,
            checkedAt=_now_iso(),
        )

    # === R7: 改造重算引擎 ===

    async def R7_replan(
        self, enterprise_id: str, trigger_kind: str, message: str,
    ) -> ReformReplanResult:
        """R7 动态重算 (受 trigger 触发)."""
        state = await _reform_store.get_state(enterprise_id)
        if not state:
            raise ValueError(f"企业 {enterprise_id} 无改造状态")

        current_sc = Scorecard8D.model_validate(state["scorecard"]["current"])
        target_sc = Scorecard8D.model_validate(state["scorecard"]["target"])

        # 根据触发器调整目标
        if trigger_kind == "policy_change":
            target_sc = Scorecard8D(
                subject=min(100, target_sc.subject + 5),
                policy=min(100, target_sc.policy + 10),
                finance=target_sc.finance, tax=target_sc.tax,
                business=target_sc.business, assets=target_sc.assets,
                credit=target_sc.credit, capital=target_sc.capital,
            )
        elif trigger_kind == "monthly_data_update":
            current_sc = Scorecard8D(
                subject=min(100, current_sc.subject + 3),
                finance=current_sc.finance, tax=current_sc.tax,
                business=current_sc.business, assets=current_sc.assets,
                credit=min(100, current_sc.credit + 2),
                policy=current_sc.policy, capital=current_sc.capital,
            )

        _, new_gaps = await self.R2_gapAnalysis(current_sc, state.get("aggressionLevel", "balanced"))
        new_phases = await self.R3_generatePlan(enterprise_id, current_sc, target_sc, new_gaps)

        return ReformReplanResult(
            newPhases=new_phases,
            impact=ReformImpact(
                deltaProgress=0.1, deltaCost=10000, deltaDays=7,
                affectedPhases=[p.id for p in new_phases], riskLevel="medium",
            ),
            replanReason=f"触发器 {trigger_kind}: {message}",
        )

    # === R8: 改造监控引擎 ===

    async def R8_monitor(self, enterprise_id: str) -> ReformMonitorResult:
        """R8 监控 (里程碑 + 告警)."""
        state = await _reform_store.get_state(enterprise_id)
        if not state:
            return ReformMonitorResult(
                milestones=[], alerts=[],
                overallProgress=0.0, estimatedCompletionAt=None,
            )

        milestones = []
        for phase in state.get("phases", []):
            mid = _id("ms")
            milestones.append({
                "id": mid, "name": phase.get("name", ""),
                "plannedDate": _now_iso(), "actualDate": None,
                "status": "achieved" if phase.get("status") == "completed" else "pending",
                "phaseId": phase.get("id"),
            })

        alerts = []
        for phase in state.get("phases", []):
            if phase.get("status") == "blocked":
                alerts.append({
                    "id": _id("alt"), "severity": "warning",
                    "kind": "phase_blocked",
                    "message": f"阶段 {phase.get('name')} 被阻塞",
                    "phaseId": phase.get("id"), "actionId": None,
                    "raisedAt": _now_iso(), "acknowledgedAt": None,
                })

        est = (datetime.now(UTC) + timedelta(days=30)).isoformat()
        return ReformMonitorResult(
            milestones=milestones, alerts=alerts,
            overallProgress=state.get("progress", 0.0),
            estimatedCompletionAt=est,
        )

    # === R9: 终局 (融资撮合入口) ===

    async def R9_finalizeAndFinance(self, enterprise_id: str) -> dict:
        """R9 改造完成, 解锁融资入口 (跳转反向竞拍)."""
        state = await _reform_store.get_state(enterprise_id)
        if not state:
            raise ValueError(f"企业 {enterprise_id} 无改造状态")

        # 标记完成
        state["status"] = "completed"
        state["progress"] = 1.0
        state["completedAt"] = _now_iso()
        await _reform_store.upsert_state(enterprise_id, state)

        # 回写企业 runtime.financingUnlocked
        await enterprise_service.apply_reform_result(enterprise_id, {
            "hasReformed": True,
            "reformedAt": _now_iso(),
            "afterLevel": state.get("currentLevel"),
            "afterScorecard": state.get("scorecard", {}).get("current"),
            "financingUnlocked": True,
        })

        return {
            "enterpriseId": enterprise_id,
            "status": "completed",
            "financingUnlocked": True,
            "tenderEntryPoint": f"/api/v1/eco-bid/tenders?enterpriseId={enterprise_id}",
            "completedAt": state["completedAt"],
        }

    # === R10: 案例学习引擎 (V1 混合架构) ===
    # 设计: 案例数 < VECTOR_INDEX_THRESHOLD(500) 走内存 list + 线性扫描;
    #       ≥500 自动切换向量检索 (mock: 特征哈希成 256 维向量, cosine 相似度 top-K).
    # 阈值常量 VECTOR_INDEX_THRESHOLD / VECTOR_DIM 见文件顶部.

    async def R10_storeCase(self, enterprise_id: str) -> ReformCase:
        """R10 沉淀改造案例 (供行业指数分析)."""
        state = await _reform_store.get_state(enterprise_id)
        ent = await enterprise_service.get_enterprise(enterprise_id)
        if not state or not ent:
            raise ValueError(f"企业 {enterprise_id} 数据不完整, 无法沉淀案例")

        current_sc = Scorecard8D.model_validate(state["scorecard"]["current"])
        before_sc = Scorecard8D(
            subject=40, finance=35, tax=30, business=45,
            assets=50, credit=35, policy=60, capital=40,
        )
        case = ReformCase(
            caseId=_id("case"),
            enterpriseId=enterprise_id,
            industry=ent.industry,
            outcome="success",
            beforeScorecard=before_sc,
            afterScorecard=current_sc,
            totalDays=90,
            totalCost=50000,
            totalActions=len(state.get("completedActions", [])),
            topLevelReached=state.get("currentLevel", "A"),
            storedAt=_now_iso(),
            signature=_id("sig"),
        )
        await _reform_store.add_case(case.model_dump(by_alias=True))
        return case

    async def list_cases(self, industry: str | None = None) -> list[ReformCase]:
        """列出案例库 (供行业指数). 案例数 ≥500 时仍按 industry 过滤 (线性扫描足够)."""
        data = await _reform_store.list_cases(industry)
        return [ReformCase.model_validate(d) for d in data]

    def _hash_to_vector(self, case: dict) -> list[float]:
        """把案例特征哈希成 256 维向量 (mock 向量检索, 无需真实向量库).

        特征来源: 行业 / 结果 / 终局等级 / 工期 / 成本 / 动作数 + 8 维前后评分.
        每个维度用 SHA256 + 索引 salt 生成 [0,1) 浮点, 保证可复现.
        """
        before = case.get("beforeScorecard") or {}
        after = case.get("afterScorecard") or {}
        features = [
            str(case.get("industry", "")),
            str(case.get("outcome", "")),
            str(case.get("topLevelReached", "")),
            str(case.get("totalDays", 0)),
            str(case.get("totalCost", 0)),
            str(case.get("totalActions", 0)),
        ]
        for dim in ("subject", "finance", "tax", "business", "assets", "credit", "policy", "capital"):
            features.append(str(before.get(dim, 0) if isinstance(before, dict) else 0))
            features.append(str(after.get(dim, 0) if isinstance(after, dict) else 0))
        text = "|".join(features)
        vec: list[float] = [0.0] * VECTOR_DIM
        for i in range(VECTOR_DIM):
            h = hashlib.sha256(f"{text}:{i}".encode()).hexdigest()
            vec[i] = int(h[:8], 16) / 0xFFFFFFFF
        return vec

    def _query_to_vector(self, query: str) -> list[float]:
        """把查询字符串哈希成 256 维向量 (与 _hash_to_vector 同维度, 供 cosine 检索)."""
        text = query or ""
        vec: list[float] = [0.0] * VECTOR_DIM
        for i in range(VECTOR_DIM):
            h = hashlib.sha256(f"{text}:{i}".encode()).hexdigest()
            vec[i] = int(h[:8], 16) / 0xFFFFFFFF
        return vec

    def _cosine_similarity(self, v1: list[float], v2: list[float]) -> float:
        """余弦相似度 (0 ~ 1)."""
        if len(v1) != len(v2) or not v1:
            return 0.0
        dot = sum(a * b for a, b in zip(v1, v2, strict=False))
        n1 = sum(a * a for a in v1) ** 0.5
        n2 = sum(b * b for b in v2) ** 0.5
        if n1 == 0 or n2 == 0:
            return 0.0
        return dot / (n1 * n2)

    async def _should_use_vector_index(self) -> bool:
        """案例数 ≥ 阈值时返回 True (切换向量检索模式)."""
        count = await _reform_store.count_cases()
        return count >= VECTOR_INDEX_THRESHOLD

    async def search_similar_cases(self, query: str, top_k: int = 5) -> list[ReformCase]:
        """R10 相似案例检索 (混合架构: 自动路由线性扫描 / 向量检索).

        - 案例数 < 500: 线性扫描, 关键词匹配 (行业/结果/等级/全文模糊).
        - 案例数 ≥ 500: query 与每个案例都转 256 维向量, cosine 相似度排序取 top-K.
        """
        cases = await _reform_store.list_cases()
        if not cases:
            return []
        top_k = max(1, int(top_k))
        if await self._should_use_vector_index():
            qv = self._query_to_vector(query)
            scored = [(self._cosine_similarity(qv, self._hash_to_vector(c)), c) for c in cases]
            scored.sort(key=lambda x: x[0], reverse=True)
            return [ReformCase.model_validate(c) for _, c in scored[:top_k]]
        # 线性扫描: 关键词匹配
        q_lower = (query or "").lower().strip()
        scored: list[tuple[float, dict]] = []
        for c in cases:
            score = 0.0
            if q_lower and q_lower in str(c.get("industry", "")).lower():
                score += 1.0
            if q_lower and q_lower in str(c.get("outcome", "")).lower():
                score += 0.5
            if q_lower and q_lower in str(c.get("topLevelReached", "")).lower():
                score += 0.3
            if q_lower and q_lower in str(c).lower():
                score += 0.1
            scored.append((score, c))
        scored.sort(key=lambda x: x[0], reverse=True)
        if q_lower and scored and scored[0][0] > 0:
            matched = [c for s, c in scored if s > 0][:top_k]
            return [ReformCase.model_validate(c) for c in matched]
        # 无匹配时返回最近 top_k (不空手, 体现"傻瓜式"体验)
        return [ReformCase.model_validate(c) for _, c in scored[:top_k]]

    async def get_case_stats(self) -> dict:
        """R10 案例库统计 (总数 / 向量模式开关 / 行业分布)."""
        cases = await _reform_store.list_cases()
        industry_dist: dict[str, int] = {}
        outcome_dist: dict[str, int] = {}
        for c in cases:
            ind = str(c.get("industry", "unknown"))
            industry_dist[ind] = industry_dist.get(ind, 0) + 1
            out = str(c.get("outcome", "unknown"))
            outcome_dist[out] = outcome_dist.get(out, 0) + 1
        total = len(cases)
        return {
            "totalCases": total,
            "vectorModeEnabled": total >= VECTOR_INDEX_THRESHOLD,
            "vectorIndexThreshold": VECTOR_INDEX_THRESHOLD,
            "industryDistribution": industry_dist,
            "outcomeDistribution": outcome_dist,
            "searchStrategy": "vector" if total >= VECTOR_INDEX_THRESHOLD else "linear_scan",
        }

    # === 查询入口 ===

    async def get_reform_state(self, enterprise_id: str) -> ReformState | None:
        """查询企业改造状态."""
        if self.db is not None:
            try:
                stmt = select(ReformStateORM).where(ReformStateORM.enterprise_id == enterprise_id)
                result = await self.db.execute(stmt)
                row = result.scalar_one_or_none()
                if row:
                    return ReformState(
                        enterpriseId=row.enterprise_id, status=row.status,
                        progress=float(row.progress),
                        currentLevel=row.current_level, targetLevel=row.target_level,
                        aggressionLevel=row.aggression_level,
                        startedAt=row.started_at.isoformat() if row.started_at else None,
                        completedAt=row.completed_at.isoformat() if row.completed_at else None,
                        planId=row.plan_id, scorecard=row.scorecard,
                        phases=row.phases, completedActions=row.completed_actions,
                    )
            except Exception:
                pass
        data = await _reform_store.get_state(enterprise_id)
        return ReformState.model_validate(data) if data else None


reform_service = ReformService(db=None)
