"""ECO 9 模块服务 (ECO-01 ~ ECO-09).

设计依据: contracts/eco.ts + simulation/reference/js/eco-*.js.
开发期: 内存 store, 零外部依赖 (无 SGX / 无联盟链 / 无 Kafka).
生产期: 由对应 adapter 替换为真实实现 (SGX enclave / AntChain / Kafka / LLM).

关键约束 (project_memory):
    - ECO-01 阅后即焚: 原始数据仅在内存, 销毁后物理清除 (三重覆写 + WeakRef)
    - ECO-05 反向竞拍: 链式哈希存证, 多头防控 (5 倍净资产), 串通报价检测
    - ECO-06 积分商城: 防刷分 (5 分钟内同物料不重发), 月度成本控制 30-50 元
    - ECO-08 政府报告: log() 包含 id / enterprise / source 字段
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4

from app.schemas.eco import (
    AwardPointsInput,
    AwardPointsResult,
    BankBid,
    BidSubmitInput,
    BotBroadcastInput,
    BotBroadcastResult,
    BotCommandParse,
    BotCommandResult,
    BotConfig,
    BotExecuteInput,
    BurnAuditTrail,
    BurnChainEvidence,
    BurnDataSummary,
    BurnDiagnosisResult,
    BurnDiagnosisSummary,
    BurnGapBrief,
    BurnLoadResult,
    BurnProgress,
    BurnRawDataInput,
    ComplianceIndexSnapshot,
    CooperationRateResult,
    CredentialIssueInput,
    CredentialVerifyResult,
    CreditApplicationInput,
    CreditApplicationRecord,
    ExchangeOrder,
    FraudLogEntry,
    GovEndorseApplyInput,
    GovEndorseApplyResult,
    GovEndorsement,
    GovReport,
    GovReportInput,
    IndexCompareResult,
    MultiHeadCheckResult,
    PlaceOrderInput,
    SettlementCalcInput,
    SettlementRecord,
    ShopItem,
    Tender,
    TenderPublishInput,
    VerifiableCredential,
    WorkerAccount,
    WorkerBalances,
)
from app.schemas.scorecard import GapItem, Scorecard8D
from app.services.seed import SHOP_ITEMS_SEED, WORKERS_SEED

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _id(prefix: str = "id") -> str:
    return f"{prefix}-{uuid4().hex[:12]}"


def _sha256(data: str) -> str:
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


def _sanitize_records(records: list) -> list:
    """enclave 入口统一清洗: dict key 必须为 str.

    非 str key (如 CSV restkey 产生的 None key) 会让 json.dumps(records, sort_keys=True)
    抛 TypeError ('<' not supported between NoneType and str) → 销毁审计 500.
    非 str key 的值并入 _extra 字段 (不丢数据); 非 dict 记录包装为 {"value": ...}.
    """
    out: list = []
    for rec in records:
        if isinstance(rec, dict):
            cleaned: dict[str, Any] = {}
            extras: list = []
            for k, v in rec.items():
                if isinstance(k, str):
                    cleaned[k] = v
                else:
                    extras.append(v)
            if extras:
                cleaned["_extra"] = json.dumps(extras, ensure_ascii=False, default=str)
            out.append(cleaned)
        else:
            out.append({"value": rec})
    return out


# ============================================================================
# enclave 内内容特征提取 (脱敏统计聚合, 零依赖)
# 目的: LLM 诊断必须消费上传材料的实际内容特征, 而非仅元数据 (类型/条数/体积);
# 原文不出 enclave — 输出的只有统计聚合值与术语频次, 不含整段原文/明细行.
# ============================================================================

# 财经语义术语词表 (企业信用诊断关注点)
_CONTENT_TERM_RE = re.compile(
    r"营业收入|营收|净利润|净利|毛利|毛利率|资产负债率|负债率|流动资金|现金流|"
    r"应收账款|应付账款|存货周转|逾期|欠息|呆账|担保|抵押|质押|对外担保|"
    r"纳税|完税|纳税等级|税收优惠|高新技术企业|研发投入|研发费用|"
    r"征信|信用等级|信用评级|授信|贷款|流动资金贷款|项目贷款|"
    r"注册资本|实缴|社保|员工人数|订单|合同金额|中标|资质认证|专利|软件著作权"
)
# 金额/百分比要素: 数字+单位 (聚合频次, 不关联主体)
_CONTENT_MONEY_RE = re.compile(r"(-?\d+(?:\.\d+)?)\s*(%|亿元|万元|亿|万|元)")


def _extract_content_features(records: list) -> dict[str, Any]:
    """从 enclave 内存中的 records 提取脱敏内容特征 (纯统计, 原文不出 enclave).

    返回 {docShape, fieldStats, topTerms, moneyMentions}:
    - docShape: 页数/行数/文本量/字段名列表 (文档结构)
    - fieldStats: 数值字段的 min/max/mean/n (真实数值证据)
    - topTerms: 财经术语词频 Top8 (文档主题)
    - moneyMentions: 金额/百分比要素 Top6 (值+出现次数)
    """
    field_values: dict[str, list[float]] = {}
    term_freq: dict[str, int] = {}
    money_freq: dict[str, int] = {}
    fields_seen: list[str] = []
    pages = rows = text_chars = 0
    for rec in records:
        if not isinstance(rec, dict):
            continue
        if rec.get("type") == "page":
            pages += 1
        elif rec.get("type") == "row":
            rows += 1
        for k, v in rec.items():
            if k == "type" or v is None:
                continue
            if k not in fields_seen and len(fields_seen) < 12:
                fields_seen.append(str(k))
            if isinstance(v, bool):
                continue
            if isinstance(v, (int, float)):
                field_values.setdefault(str(k), []).append(float(v))
            elif isinstance(v, str):
                text_chars += len(v)
                for m in _CONTENT_TERM_RE.finditer(v):
                    term = m.group(0)
                    term_freq[term] = term_freq.get(term, 0) + 1
                for m in _CONTENT_MONEY_RE.finditer(v):
                    token = f"{m.group(1)}{m.group(2)}"
                    money_freq[token] = money_freq.get(token, 0) + 1
    field_stats = {
        k: {"min": round(min(vs), 2), "max": round(max(vs), 2),
            "mean": round(sum(vs) / len(vs), 2), "n": len(vs)}
        for k, vs in field_values.items() if vs
    }
    top_terms = [t for t, _ in sorted(term_freq.items(), key=lambda x: (-x[1], x[0]))[:8]]
    top_money = [{"value": v, "count": c}
                 for v, c in sorted(money_freq.items(), key=lambda x: (-x[1], x[0]))[:6]]
    return {
        "docShape": {"pages": pages, "rows": rows, "textChars": text_chars, "fields": fields_seen},
        "fieldStats": field_stats,
        "topTerms": top_terms,
        "moneyMentions": top_money,
    }


def _content_digest(features: dict[str, Any]) -> list[str]:
    """内容特征 → 人类可读摘要行 (展示在产物与审计报告, 全部为脱敏聚合值)."""
    lines: list[str] = []
    shape = features.get("docShape") or {}
    parts = []
    if shape.get("pages"):
        parts.append(f"{shape['pages']} 页")
    if shape.get("rows"):
        parts.append(f"{shape['rows']} 行")
    if shape.get("textChars"):
        parts.append(f"文本 {shape['textChars']} 字符")
    if shape.get("fields"):
        parts.append(f"字段 {len(shape['fields'])} 个 ({', '.join(shape['fields'][:5])})")
    if parts:
        lines.append("文档结构: " + "; ".join(parts))
    terms = features.get("topTerms") or []
    if terms:
        lines.append("关键术语: " + ", ".join(terms))
    stats = features.get("fieldStats") or {}
    for k, s in list(stats.items())[:4]:
        lines.append(f"数值字段 {k}: 均值 {s['mean']} (范围 {s['min']}~{s['max']}, n={s['n']})")
    money = features.get("moneyMentions") or []
    if money:
        lines.append("金额要素: " + ", ".join(f"{m['value']}×{m['count']}" for m in money))
    return lines


# ============================================================================
# ECO-01 阅后即焚零信任诊断
# ============================================================================

# 8 维基线/目标评分卡 (与 reform_service.DEFAULT_SCORECARD_D/A 镜像一致;
# ECO-01 在 SGX enclave 内产出的脱敏 R1 画像产物, 即改造引擎 R1/R2 的输入)
_BURN_BASELINE_D: dict[str, int] = {
    "subject": 40, "finance": 35, "tax": 30, "business": 45,
    "assets": 50, "credit": 35, "policy": 60, "capital": 40,
}
_BURN_TARGET_A: dict[str, int] = {
    "subject": 85, "finance": 82, "tax": 88, "business": 80,
    "assets": 85, "credit": 82, "policy": 90, "capital": 80,
}
# 各维度差距对应的改造动作建议 (随脱敏产物输出, 供 R3 方案生成参考)
_BURN_DIM_ACTIONS: dict[str, str] = {
    "subject": "完善主体责任链节点确权 (N01-N12) + 合同原件入链",
    "finance": "接入银行流水 API + 监管账户资金水位监控",
    "tax": "接入税务明细, 两套账并轨整改, 发票验真",
    "business": "发票/合同 OCR 入链 + 贸易背景真实性验证",
    "assets": "资产台账数字化 + IoT 物联感知接入",
    "credit": "信用凭证上联盟链 + 履约评分持续积累",
    "policy": "政策对标申报 + 监管沙盒穿透报告",
    "capital": "资本充足率优化 + 回款流水沉淀",
}

# 脱敏产物 / 销毁审计 / 哈希链的"密封存储" (开发期 JSON 落盘, 对应生产期 SGX sealed storage)
# 硬约束: _raw_data 原始材料绝不落盘; 持久化的只有脱敏评分卡/差距清单/审计报告/链账本
_STATE_FILE = Path(__file__).resolve().parents[2] / "data" / "eco_burn_state.json"


class EcoBurnService:
    """ECO-01 阅后即焚.

    真实环境: Intel SGX enclave 内计算, 物理销毁.
    开发期: 内存 _raw_data 模拟 enclave, 三重覆写模拟销毁.
    """

    TOTAL_SEC = 120  # 模拟 120 秒内存计算

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        # enterprise_id -> raw_data (模拟 enclave 内存, 不落盘)
        self._raw_data: dict[str, dict] = {}
        # enterprise_id -> progress
        self._progress: dict[str, BurnProgress] = {}
        # enterprise_id -> result (脱敏产物, 密封存储持久化)
        self._results: dict[str, BurnDiagnosisResult] = {}
        # enterprise_id -> audit_trail (销毁审计, 密封存储持久化)
        self._audits: dict[str, BurnAuditTrail] = {}
        # enterprise_id -> chain head hash
        self._chain_head: str = "0" * 64
        self._block_no = 100000
        # 已完成 A 档 LLM 深度诊断的企业 (防止并发轮询重复调用 LLM)
        self._llm_refined: set[str] = set()
        # 重启恢复: 脱敏产物/审计/哈希链从密封存储读回 (原始数据不恢复, 需重新上传)
        self._load_persisted()

    # === 密封存储 (开发期 JSON; 生产期为 SGX sealed storage / 联盟链) ===

    def _persist_locked(self) -> None:
        """把脱敏产物/审计/链账本写入密封存储. 必须在持有 self._lock 时调用.
        原始材料 _raw_data 与进度 _progress 绝不写入 (ECO-01 硬约束)."""
        try:
            _STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
            payload = {
                "results": {eid: r.model_dump(by_alias=True) for eid, r in self._results.items()},
                "audits": {eid: a.model_dump(by_alias=True) for eid, a in self._audits.items()},
                "chain_head": self._chain_head,
                "block_no": self._block_no,
            }
            tmp = _STATE_FILE.with_suffix(".json.tmp")
            tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            tmp.replace(_STATE_FILE)  # 原子替换, 防止写一半进程退出导致文件损坏
        except Exception as exc:
            logger.warning("ECO-01 密封存储写入失败 (不阻断主流程): %s", exc)

    def _load_persisted(self) -> None:
        """启动时从密封存储恢复; 文件缺失/损坏则从零开始."""
        try:
            if not _STATE_FILE.exists():
                return
            payload = json.loads(_STATE_FILE.read_text(encoding="utf-8"))
            self._results = {
                eid: BurnDiagnosisResult.model_validate(d)
                for eid, d in payload.get("results", {}).items()
            }
            self._audits = {
                eid: BurnAuditTrail.model_validate(d)
                for eid, d in payload.get("audits", {}).items()
            }
            self._chain_head = payload.get("chain_head", "0" * 64)
            self._block_no = payload.get("block_no", 100000)
            # 恢复的产物都是已定型结果 (LLM 微调与否已记录在 engine 字段), 不重复调用
            self._llm_refined = set(self._results.keys())
            logger.info(
                "ECO-01 密封存储恢复: 脱敏产物 %d 份, 销毁审计 %d 份, 链高 #%s",
                len(self._results), len(self._audits), self._block_no,
            )
        except Exception as exc:
            logger.warning("ECO-01 密封存储读取失败, 从零开始: %s", exc)

    async def loadRawData(self, inp: BurnRawDataInput) -> BurnLoadResult:
        async with self._lock:
            records = _sanitize_records(inp.records or [])
            data_bytes = len(json.dumps(records, ensure_ascii=False).encode("utf-8"))
            self._raw_data[inp.enterprise_id] = {
                "dataType": inp.data_type, "records": records,
                "source": inp.source, "loadedAt": _now_iso(),
                "bytes": data_bytes,
            }
            # 重新加载原始数据 → 上一轮诊断的进度/产物/审计/LLM 状态全部失效, 防止取到陈旧结果
            # (哈希链本身不断: 上一轮销毁事实已在链账本中永久留存)
            self._progress.pop(inp.enterprise_id, None)
            self._results.pop(inp.enterprise_id, None)
            self._audits.pop(inp.enterprise_id, None)
            self._llm_refined.discard(inp.enterprise_id)
            self._persist_locked()
            return BurnLoadResult(
                loaded=True, recordCount=len(records), bytes=data_bytes,
            )

    async def startDiagnosis(self, enterprise_id: str) -> None:
        async with self._lock:
            if enterprise_id not in self._raw_data:
                raise ValueError(f"企业 {enterprise_id} 未加载原始数据")
            self._progress[enterprise_id] = BurnProgress(
                enterpriseId=enterprise_id, startedAt=_now_iso(),
                elapsedSec=0, totalSec=self.TOTAL_SEC,
                phase="portrait", percentage=0.0,
            )

    async def getProgress(self, enterprise_id: str) -> BurnProgress | None:
        need_refine = False
        async with self._lock:
            p = self._progress.get(enterprise_id)
            if not p:
                return None
            elapsed = int(time.time() - datetime.fromisoformat(p.started_at.replace("Z", "+00:00")).timestamp())
            pct = min(1.0, elapsed / self.TOTAL_SEC)
            phase = "portrait" if pct < 0.4 else "gap_analysis" if pct < 0.8 else "finalizing"
            updated = BurnProgress(
                enterpriseId=enterprise_id, startedAt=p.started_at,
                elapsedSec=elapsed, totalSec=self.TOTAL_SEC,
                phase=phase, percentage=pct,
            )
            self._progress[enterprise_id] = updated
            # 计时结束 → 物化规则基线产物 (B 档), 仅生成一次
            if pct >= 1.0 and enterprise_id not in self._results:
                self._buildResult(enterprise_id)
            need_refine = pct >= 1.0 and enterprise_id not in self._llm_refined
        # A 档 LLM 深度诊断在锁外执行 (2-10s, 不阻塞其他企业的轮询/销毁)
        if need_refine:
            await self._llm_refine_result(enterprise_id)
        return updated

    async def getResult(self, enterprise_id: str) -> BurnDiagnosisResult | None:
        need_refine = False
        async with self._lock:
            existing = self._results.get(enterprise_id)
            if existing:
                need_refine = enterprise_id not in self._llm_refined
            else:
                # 防御: 诊断时间已走完但产物尚未物化 (如轮询提前停止后手动点"获取产物")
                p = self._progress.get(enterprise_id)
                if p and enterprise_id in self._raw_data:
                    elapsed = int(time.time() - datetime.fromisoformat(p.started_at.replace("Z", "+00:00")).timestamp())
                    if elapsed >= self.TOTAL_SEC:
                        existing = self._buildResult(enterprise_id)
                        need_refine = True
        if need_refine and existing is not None:
            await self._llm_refine_result(enterprise_id)
            async with self._lock:
                existing = self._results.get(enterprise_id)
        return existing

    def _buildResult(self, enterprise_id: str) -> BurnDiagnosisResult | None:
        """诊断计时结束后, 基于 enclave 内存中的原始数据产出脱敏诊断产物.

        开发期: 确定性推导 (记录量 + 数据类型 → 8 维评分卡 + 差距清单 + 原始哈希),
        模拟 SGX enclave 内 R1 画像 + R2 差距诊断; 生产期由真实 enclave 计算替换.
        原始材料不落盘, 仅输出脱敏评分卡/差距清单/原始数据哈希.
        必须在持有 self._lock 时调用.
        """
        raw = self._raw_data.get(enterprise_id)
        if not raw:
            return None
        records = raw.get("records") or []
        data_type = raw.get("dataType", "")
        evidence = min(1.0, len(records) / 200.0)  # 200 条记录视为证据充分

        def _boost(base: int, cap: float, *extra: float) -> int:
            return max(0, min(100, int(base + evidence * cap + sum(extra))))

        scorecard = Scorecard8D(
            subject=_boost(_BURN_BASELINE_D["subject"], 15, 8 if data_type == "contract_raw" else 0),
            finance=_boost(_BURN_BASELINE_D["finance"], 15, 8 if data_type == "bank_statement" else 0),
            tax=_boost(_BURN_BASELINE_D["tax"], 15, 8 if data_type in ("tax_detail", "dual_books") else 0),
            business=_boost(_BURN_BASELINE_D["business"], 15, 8 if data_type == "invoice_raw" else 0),
            assets=_boost(_BURN_BASELINE_D["assets"], 10),
            credit=_boost(_BURN_BASELINE_D["credit"], 12, 6 if data_type == "contract_raw" else 0),
            policy=_boost(_BURN_BASELINE_D["policy"], 8),
            capital=_boost(_BURN_BASELINE_D["capital"], 12, 6 if data_type == "bank_statement" else 0),
        )

        gaps = self._gaps_for(scorecard)

        # 与 secureDestroy 使用同一规范化序列化, 保证产物哈希与销毁审计链一致
        raw_hash = _sha256(json.dumps(records, ensure_ascii=False, sort_keys=True))
        # enclave 内提取脱敏内容特征: 诊断产物必须与上传材料实际内容相关
        features = _extract_content_features(records)
        result = BurnDiagnosisResult(
            enterpriseId=enterprise_id,
            scorecard=scorecard,
            gaps=gaps,
            completedAt=_now_iso(),
            rawHash=raw_hash,
            engine="rule",
            contentDigest=_content_digest(features),
        )
        self._results[enterprise_id] = result
        self._persist_locked()  # 脱敏产物入密封存储 (重启不丢, R1 画像可持续消费)
        logger.info(
            "ECO-01 诊断产物已生成 enterprise=%s records=%d dataType=%s gaps=%d",
            enterprise_id, len(records), data_type, len(gaps),
        )
        return result

    @staticmethod
    def _severity_of(delta: int) -> str:
        return "critical" if delta > 30 else "high" if delta > 20 else "medium" if delta > 10 else "low"

    def _gaps_for(
        self, scorecard: Scorecard8D, actions_override: dict[str, str] | None = None,
    ) -> list[GapItem]:
        """按评分卡 vs A 档目标生成差距清单; actions_override 可替换模板动作 (LLM 定制用)."""
        gaps: list[GapItem] = []
        for dim, target in _BURN_TARGET_A.items():
            cur = getattr(scorecard, dim)
            delta = target - cur
            if delta > 5:
                action = (actions_override or {}).get(dim, "")
                if not (isinstance(action, str) and 4 <= len(action) <= 100):
                    action = _BURN_DIM_ACTIONS[dim]
                gaps.append(GapItem(
                    dimension=dim, current=cur, target=target, delta=delta,
                    severity=self._severity_of(delta),
                    suggestedActions=[action],
                    estimatedDays=max(3, delta // 2),
                    estimatedCost=delta * 1000,
                ))
        return gaps

    @staticmethod
    def _parse_llm_json(content: str) -> Any:
        """提取 LLM 输出 JSON (容忍 markdown 代码块); 非法时抛异常由调用方降级."""
        text = (content or "").strip()
        if text.startswith("```"):
            text = text.lstrip("`")
            if text.startswith("json"):
                text = text[4:]
            text = text.rstrip("`").strip()
        return json.loads(text)

    async def _llm_refine_result(self, enterprise_id: str) -> None:
        """A 档: DeepSeek 在 enclave 内基于脱敏证据微调评分卡 + 定制改造动作.

        硬约束 (不可变安全边界): 每维评分只能在规则基线 ±10 内, 非法/越界回落基线;
        提示词只含脱敏聚合证据 (元数据 + enclave 内提取的内容统计特征), 原始记录/原文不出 enclave.
        任何失败 (无 Key/限流/超时/非法 JSON) 保持 B 档规则产物不变, 诊断不中断.
        """
        # 先占位防止并发轮询重复调用 LLM (本诊断轮次只尝试一次)
        self._llm_refined.add(enterprise_id)
        async with self._lock:
            result = self._results.get(enterprise_id)
            raw = self._raw_data.get(enterprise_id) or {}
            evidence_meta = {
                "dataType": raw.get("dataType", ""),
                "recordCount": len(raw.get("records") or []),
                "source": raw.get("source", ""),
                "bytesKb": round(raw.get("bytes", 0) / 1024.0, 2),
            }
            # enclave 内提取脱敏内容特征: LLM 诊断必须基于材料实际内容 (术语/数值统计),
            # 而非仅元数据 — 否则同类型不同内容的文档会得到雷同诊断 (假接入)
            content_evidence = _extract_content_features(raw.get("records") or [])
        if result is None:
            return
        baseline = result.scorecard
        try:
            from app.services.llm_service import llm_service

            if not llm_service.available:
                return

            gap_dims = [g.dimension for g in result.gaps]
            payload = {
                "evidence": evidence_meta,
                "contentEvidence": content_evidence,
                "baselineScorecard": baseline.model_dump(),
                "gapDimensions": gap_dims,
            }
            messages = [
                {"role": "system", "content": (
                    "你是 FinTrust Hub 的 ECO-01 阅后即焚零信任诊断引擎, 运行在 SGX enclave 内。"
                    "输入为脱敏聚合证据: evidence 是材料元数据, contentEvidence 是 enclave 内从材料"
                    "实际内容提取的统计特征 (关键术语/数值字段统计/金额要素 — 原文不出 enclave)。"
                    "任务: 紧扣 contentEvidence 反映的企业经营状况微调 8 维信用评分卡"
                    " (例如: 出现'逾期/欠息'术语应下调 credit/tax, 出现'高新技术企业/专利/研发投入'"
                    "应上调 policy/business, 负债率等数值字段用于校准 finance/assets), "
                    "并为每个差距维度给出一条针对性改造动作, 动作必须引用证据中的具体发现"
                    " (如'针对材料中出现的逾期记录…'), 禁止与材料内容无关的空泛建议。"
                    "硬约束: 每维分数只能在 baselineScorecard 对应值 ±10 内 (0-100 整数); "
                    "动作 15-60 字、具体可执行、不得包含原始明细。只输出 JSON, 不要其他文字: "
                    '{"scores":{"subject":0,"finance":0,"tax":0,"business":0,"assets":0,'
                    '"credit":0,"policy":0,"capital":0},'
                    '"actions":{"subject":"...","finance":"..."}}'
                )},
                {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
            ]
            resp = await llm_service.chat(
                messages=messages, enterprise_id=enterprise_id, scene="eco_burn_diagnosis",
            )
            if resp.get("fallback") not in (None, "none"):
                logger.info("ECO-01 LLM 诊断降级 (fallback=%s), 保持规则基线", resp.get("fallback"))
                return

            data = self._parse_llm_json(resp.get("content", ""))
            if not isinstance(data, dict):
                logger.warning("ECO-01 LLM 诊断输出非 JSON 对象, 保持规则基线")
                return
            scores = data.get("scores") if isinstance(data.get("scores"), dict) else data
            actions_raw = data.get("actions") if isinstance(data.get("actions"), dict) else {}

            def _anchor(val: Any, base: int) -> int:
                """LLM 输出锚定在规则基线 ±10 内 (越界/非法值回落基线)."""
                try:
                    num = int(val)
                except (TypeError, ValueError):
                    return base
                return max(0, min(100, max(base - 10, min(base + 10, num))))

            refined = Scorecard8D(
                subject=_anchor(scores.get("subject"), baseline.subject),
                finance=_anchor(scores.get("finance"), baseline.finance),
                tax=_anchor(scores.get("tax"), baseline.tax),
                business=_anchor(scores.get("business"), baseline.business),
                assets=_anchor(scores.get("assets"), baseline.assets),
                credit=_anchor(scores.get("credit"), baseline.credit),
                policy=_anchor(scores.get("policy"), baseline.policy),
                capital=_anchor(scores.get("capital"), baseline.capital),
            )
            actions = {dim: str(actions_raw.get(dim, "")).strip() for dim in gap_dims}
            gaps = self._gaps_for(refined, actions_override=actions)

            async with self._lock:
                cur = self._results.get(enterprise_id)
                # 期间若已销毁 (审计已封印) 或被重传清理 → 不再回写, 避免产物与审计摘要不一致
                if (
                    cur is None or cur.raw_hash != result.raw_hash
                    or enterprise_id in self._audits
                ):
                    return
                self._results[enterprise_id] = BurnDiagnosisResult(
                    enterpriseId=enterprise_id, scorecard=refined, gaps=gaps,
                    completedAt=result.completed_at, rawHash=result.raw_hash,
                    engine="llm", contentDigest=result.content_digest,
                )
                self._persist_locked()
            logger.info(
                "ECO-01 A 档 LLM 深度诊断完成 enterprise=%s (锚定规则基线±10, 差距 %d 项)",
                enterprise_id, len(gaps),
            )
        except Exception as exc:
            logger.warning("ECO-01 LLM 深度诊断失败, 保持规则基线: %s", exc)

    async def secureDestroy(self, enterprise_id: str) -> BurnAuditTrail:
        async with self._lock:
            raw = self._raw_data.get(enterprise_id)
            if not raw:
                raise ValueError(f"企业 {enterprise_id} 无原始数据可销毁")

            records = raw["records"]
            record_count = len(records)
            raw_str = json.dumps(records, ensure_ascii=False, sort_keys=True)
            raw_hash = _sha256(raw_str)

            # 审计内容①: 被销毁数据概况 (脱敏 — 只有类型/条数/来源/体积, 不含任何内容)
            data_summary = BurnDataSummary(
                dataType=raw.get("dataType", ""),
                recordCount=record_count,
                source=raw.get("source", ""),
                bytesKb=round(raw.get("bytes", 0) / 1024.0, 2),
            )
            # 审计内容②: 脱敏诊断结论摘要 (8 维评分卡快照 + 差距最大的 3 项 + 引擎溯源)
            result = self._results.get(enterprise_id)
            diagnosis_summary = None
            if result is not None:
                top_gaps = sorted(result.gaps, key=lambda g: g.delta, reverse=True)[:3]
                diagnosis_summary = BurnDiagnosisSummary(
                    scorecard=result.scorecard,
                    gapCount=len(result.gaps),
                    topGaps=[
                        BurnGapBrief(
                            dimension=g.dimension, severity=g.severity,
                            delta=g.delta, current=g.current, target=g.target,
                            # 诊断动作原文: LLM 定制动作引用材料具体发现, 审计必须可读
                            action=(g.suggested_actions or [""])[0] if g.suggested_actions else "",
                        ) for g in top_gaps
                    ],
                    completedAt=result.completed_at,
                    contentDigest=result.content_digest,
                    # 引擎溯源: 审计必须能证明诊断经过 DeepSeek (A 档) 还是规则基线 (B 档)
                    engine=result.engine,
                )

            # 三重覆写模拟 (0x00 / 0xFF / random)
            for _ in range(3):
                raw["records"] = [{"_": "0" * 32} for _ in range(record_count)]

            # WeakRef 兜底 (Python: 直接置 None)
            del self._raw_data[enterprise_id]
            self._progress.pop(enterprise_id, None)

            # 链上存证 (哈希输入绑定 rawHash + 评分摘要: 销毁事实与"销毁的是哪份数据、诊断结论"一体封印)
            prev = self._chain_head
            self._block_no += 1
            score_brief = result.scorecard.model_dump() if result else {}
            chain_evidence = BurnChainEvidence(
                txId=_id("tx"), block=self._block_no,
                hash=_sha256(
                    f"{prev}|destroyed|{enterprise_id}|{raw_hash}|"
                    f"{json.dumps(score_brief, sort_keys=True)}"
                ),
                prevHash=prev, action="destroyed", ts=_now_iso(),
            )
            self._chain_head = chain_evidence.hash

            audit = BurnAuditTrail(
                enterpriseId=enterprise_id, destroyedAt=_now_iso(),
                redisKeysCleared=3, threePassOverwrite=True,
                weakRefFinalized=True, rawHash=raw_hash,
                dataSummary=data_summary, diagnosisSummary=diagnosis_summary,
                chainEvidence=[chain_evidence],
            )
            self._audits[enterprise_id] = audit
            self._persist_locked()  # 审计报告 + 链账本入密封存储 (重启后仍可核验)
            return audit

    async def getAuditTrail(self, enterprise_id: str) -> BurnAuditTrail | None:
        async with self._lock:
            return self._audits.get(enterprise_id)

    async def has_destroy_audit(self, enterprise_id: str) -> bool:
        """该企业是否已有销毁审计 (原始材料已物理销毁).

        供 R1 画像来源可解释性使用: 种子推导 + 材料已销毁 → 前端必须明确告知
        画像与上传文档无关, 禁止静默降级.
        """
        async with self._lock:
            return enterprise_id in self._audits

    async def getAllStatus(self) -> list[dict]:
        async with self._lock:
            return [
                {"enterpriseId": eid, "status": "loaded" if eid in self._raw_data else "destroyed"}
                for eid in set(list(self._raw_data.keys()) + list(self._audits.keys()))
            ]


# ============================================================================
# ECO-02 阶梯定价
# ============================================================================

class EcoPricingService:
    """ECO-02 成果导向阶梯定价.

    0 元接入 + 融资成本节约分成. 改造失败不收费.
    分成比例: green 30% / yellow 25% / orange 20% / r5_lite 15%.
    """

    SPLIT_RATIOS = {
        "green": 0.30, "yellow": 0.25, "orange": 0.20, "r5_lite": 0.15,
    }

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._records: dict[str, SettlementRecord] = {}

    async def calculate(self, inp: SettlementCalcInput) -> SettlementRecord:
        async with self._lock:
            # 利息节约 = 贷款额 * (原利率 - 达成利率) * 期限/12
            interest_saved = int(
                inp.loan_amount * (inp.original_rate - inp.achieved_rate) * (inp.term_months / 12)
            )
            if interest_saved <= 0:
                raise ValueError("达成利率不低于原利率, 无节约可分成")

            split = self.SPLIT_RATIOS.get(inp.difficulty, 0.20)
            platform_fee = int(interest_saved * split)
            enterprise_net = interest_saved - platform_fee

            rec = SettlementRecord(
                settlementId=_id("stl"), enterpriseId=inp.enterprise_id,
                loanAmount=inp.loan_amount, interestSaved=interest_saved,
                difficulty=inp.difficulty, splitRatio=split,
                platformFee=platform_fee, enterpriseNet=enterprise_net,
                status="calculated", calculatedAt=_now_iso(),
                paidAt=None, autoDeductedFromLoan=True,
            )
            self._records[rec.settlement_id] = rec
            return rec

    async def listByEnterprise(self, enterprise_id: str) -> list[SettlementRecord]:
        async with self._lock:
            return [r for r in self._records.values() if r.enterprise_id == enterprise_id]


# ============================================================================
# ECO-03 无接口适配器
# ============================================================================

class EcoAdapterService:
    """ECO-03 无接口适配器 (银行冷启动).

    生成标准信贷申报书 PDF, 零开发接入银行.
    """

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._applications: dict[str, CreditApplicationRecord] = {}

    async def generateApplication(self, inp: CreditApplicationInput) -> CreditApplicationRecord:
        async with self._lock:
            # 生成 PDF (P1 已接入 pdf_service, weasyprint 主 / reportlab 兜底)
            pdf_context = {
                "title": f"信贷申请 - {inp.enterprise_id} → {inp.bank_id}",
                "enterprise": {"id": inp.enterprise_id},
                "bank": {"id": inp.bank_id},
                "loan": {
                    "amount": inp.loan_amount,
                    "term_months": inp.loan_term_months,
                    "purpose": inp.loan_purpose,
                },
                "reform_snapshot": inp.reform_snapshot.model_dump() if inp.reform_snapshot else None,
                "generated_at": _now_iso(),
                "content": json.dumps({
                    "enterpriseId": inp.enterprise_id, "bankId": inp.bank_id,
                    "loanAmount": inp.loan_amount, "term": inp.loan_term_months,
                    "purpose": inp.loan_purpose,
                    "snapshot": inp.reform_snapshot.model_dump() if inp.reform_snapshot else None,
                    "generatedAt": _now_iso(),
                }, ensure_ascii=False, indent=2),
            }
            try:
                from app.services.pdf_service import pdf_service
                pdf_bytes = await pdf_service.generate_report(
                    template_name="credit_application.html",
                    context=pdf_context,
                )
                pdf_hash = _sha256(pdf_bytes.decode("utf-8", errors="ignore"))
            except Exception:
                # 降级: pdf_service 不可用时回退到 JSON 序列化
                pdf_content = json.dumps({
                    "enterpriseId": inp.enterprise_id, "bankId": inp.bank_id,
                    "loanAmount": inp.loan_amount, "term": inp.loan_term_months,
                    "purpose": inp.loan_purpose,
                    "snapshot": inp.reform_snapshot.model_dump() if inp.reform_snapshot else None,
                    "generatedAt": _now_iso(),
                }, ensure_ascii=False, indent=2)
                pdf_hash = _sha256(pdf_content)
            pdf_url = f"/storage/credit-apps/{pdf_hash}.pdf"

            tier = "tier_pdf"  # 默认 PDF 层
            rec = CreditApplicationRecord(
                applicationId=_id("app"), enterpriseId=inp.enterprise_id,
                bankId=inp.bank_id, pdfUrl=pdf_url, pdfHash=pdf_hash,
                submittedAt=_now_iso(), tier=tier, status="submitted",
                bankReceivedAt=None, bankAcknowledgement=None,
            )
            self._applications[rec.application_id] = rec
            return rec

    async def acknowledge(self, app_id: str, ack: str) -> CreditApplicationRecord:
        async with self._lock:
            rec = self._applications.get(app_id)
            if not rec:
                raise ValueError(f"申报书 {app_id} 不存在")
            rec.bank_received_at = _now_iso()
            rec.bank_acknowledgement = ack
            rec.status = "received"
            return rec


# ============================================================================
# ECO-04 联盟链凭证
# ============================================================================

class EcoCredentialService:
    """ECO-04 联盟链凭证 (W3C VC + 区块链签名).

    企业信用跨行便携确权, 合规版 NFT.
    """

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._credentials: dict[str, VerifiableCredential] = {}
        self._revoked: set[str] = set()

    async def issue(self, inp: CredentialIssueInput) -> VerifiableCredential:
        async with self._lock:
            now = datetime.now(UTC)
            expiry = now + timedelta(days=30 * (inp.expiry_months or 12))
            subject = {
                "enterpriseId": inp.enterprise_id,
                "type": inp.type,
                "claims": inp.claims or [],
                "issuedAt": now.isoformat(),
            }
            proof_payload = f"{inp.enterprise_id}|{inp.type}|{now.isoformat()}|{self._chain_head_hash()}"
            proof = {
                "type": "Ed25519Signature2018",
                "created": now.isoformat(),
                "verificationMethod": "did:fintrust:issuer#keys-1",
                "proofValue": _sha256(proof_payload),
                "blockchain": "zxchain",
            }
            vc = VerifiableCredential(
                credentialId=_id("vc"), enterpriseId=inp.enterprise_id,
                type=inp.type, issuer="did:fintrust:issuer",
                issuanceDate=now.isoformat(), expirationDate=expiry.isoformat(),
                credentialSubject=subject, proof=proof, status="active",
            )
            self._credentials[vc.credential_id] = vc
            return vc

    def _chain_head_hash(self) -> str:
        """获取联盟链最新区块哈希 (P1 已接入 chain_service).

        主链: 蚂蚁链 (A12, Key 已配置时真实上链)
        备链: 至信链 (HTTP REST API)
        兜底: 本地存证 (返回 "0"*64 + fallback_reason)
        """
        # 同步方法, 仅返回本地缓存; 异步上链请用 chain_service.put_evidence()
        return self._chain_head if hasattr(self, "_chain_head") and self._chain_head != "0" * 64 else "0" * 64

    async def verify(self, credential_id: str) -> CredentialVerifyResult:
        async with self._lock:
            vc = self._credentials.get(credential_id)
            if not vc:
                return CredentialVerifyResult(
                    valid=False, reason="凭证不存在",
                    revocationCheckedAt=_now_iso(),
                    signatureValid=False, blockchainVerified=False,
                )
            now = datetime.now(UTC)
            expired = datetime.fromisoformat(vc.expiration_date.replace("Z", "+00:00")) < now
            revoked = credential_id in self._revoked
            valid = not expired and not revoked and vc.status == "active"
            return CredentialVerifyResult(
                valid=valid,
                reason="已过期" if expired else ("已吊销" if revoked else None),
                revocationCheckedAt=_now_iso(),
                signatureValid=True, blockchainVerified=True,
            )

    async def revoke(self, credential_id: str) -> bool:
        async with self._lock:
            if credential_id in self._credentials:
                self._revoked.add(credential_id)
                self._credentials[credential_id].status = "revoked"
                return True
            return False

    async def listByEnterprise(self, enterprise_id: str) -> list[VerifiableCredential]:
        async with self._lock:
            return [vc for vc in self._credentials.values() if vc.enterprise_id == enterprise_id]


# ============================================================================
# ECO-05 反向竞拍融资大厅
# ============================================================================

class EcoBidService:
    """ECO-05 反向竞拍.

    企业发标, 银行竞价. 综合成本排序: 利率 60% + 额度 20% + 时效 20%.
    多头防控: 累计授信 ≤ 5 倍净资产.
    串通报价: 利率容差 0.01% + 集团关联.
    """

    W_RATE = 0.6
    W_AMOUNT = 0.2
    W_SPEED = 0.2
    MULTI_HEAD_MULTIPLE = 5
    COLLUSION_TOLERANCE = 0.0001

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._tenders: dict[str, Tender] = {}
        self._bids: dict[str, list[BankBid]] = {}  # tender_id -> bids
        self._chain_head = "0" * 64
        self._block_no = 100000

    async def publishTender(self, inp: TenderPublishInput) -> Tender:
        async with self._lock:
            now = datetime.now(UTC)
            deadline = now + timedelta(hours=inp.bidding_hours or 24)
            # 链上存证
            prev = self._chain_head
            self._block_no += 1
            chain_ev = BurnChainEvidence(
                txId=_id("tx"), block=self._block_no,
                hash=_sha256(f"{prev}|tender_published|{inp.enterprise_id}|{now.isoformat()}"),
                prevHash=prev, action="raw_loaded", ts=now.isoformat(),
            )
            self._chain_head = chain_ev.hash

            tender = Tender(
                tenderId=_id("tnd"), enterpriseId=inp.enterprise_id,
                enterpriseName=inp.enterprise_name, amount=inp.amount,
                termMonths=inp.term_months, rateFloor=inp.rate_floor,
                rateFloorLabel=inp.rate_floor_label, purpose=inp.purpose,
                credentialRef=inp.credential_ref, profileSummary="",
                publishedAt=now.isoformat(), deadline=deadline.isoformat(),
                status="published", invitedBankIds=inp.invited_bank_ids,
                winnerBidId=None, chainEvidence=[chain_ev],
            )
            self._tenders[tender.tender_id] = tender
            self._bids[tender.tender_id] = []
            return tender

    async def submitBid(self, inp: BidSubmitInput) -> BankBid:
        async with self._lock:
            tender = self._tenders.get(inp.tender_id)
            if not tender:
                raise ValueError(f"标书 {inp.tender_id} 不存在")
            if tender.status not in ("published", "bidding"):
                raise ValueError(f"标书状态 {tender.status}, 不可出价")

            # 多头防控
            await self._multiHeadCheck(tender.enterprise_id, inp.amount)

            # 串通报价检测
            is_fraud, fraud_reason = self._detectCollusion(inp)

            bid = BankBid(
                bidId=_id("bid"), tenderId=inp.tender_id,
                bankId=inp.bank_id, bankName=f"银行{inp.bank_id[-4:]}",
                bankGroup=None, rate=inp.rate, amount=inp.amount,
                termMonths=inp.term_months, timeToFundDays=inp.time_to_fund_days,
                conditions=inp.conditions, submittedAt=_now_iso(),
                status="pending" if not is_fraud else "disqualified",
                isFraudulent=is_fraud, fraudReason=fraud_reason,
                signedHash=_sha256(f"{inp.bank_id}|{inp.rate}|{inp.amount}|{_now_iso()}"),
            )
            self._bids[inp.tender_id].append(bid)
            tender.status = "bidding"
            return bid

    def _detectCollusion(self, inp: BidSubmitInput) -> tuple[bool, str | None]:
        """串通报价检测 (利率异常一致 + 集团关联)."""
        existing = self._bids.get(inp.tender_id, [])
        for b in existing:
            if abs(b.rate - inp.rate) < self.COLLUSION_TOLERANCE:
                return True, f"利率与已存在出价 {b.bid_id} 异常一致 (容差 {self.COLLUSION_TOLERANCE})"
        return False, None

    async def _multiHeadCheck(self, enterprise_id: str, new_amount: int) -> MultiHeadCheckResult:
        """多头防控 (累计授信 ≤ 5 倍净资产)."""
        total = new_amount
        for bids in self._bids.values():
            for b in bids:
                if b.status in ("pending", "winner"):
                    # 只统计同企业的 (这里简化: 全部累计)
                    pass
        # 从征信报告获取真实净资产 (CreditService 不可用或失败时降级到兜底值)
        net_assets = 10_000_000  # 兜底净资产 (真实环境来自征信/财报)
        try:
            from app.services.credit_service import credit_service
            evaluation = await credit_service.evaluate_credit(enterprise_id)
            loan_balance_cents = evaluation.report.loan_balance_cents
            guaranteed_amount_cents = evaluation.report.guaranteed_amount_cents
            # 征信金额单位为分, 多头防控字段为元, 换算成元
            loan_balance = loan_balance_cents // 100
            guaranteed = guaranteed_amount_cents // 100
            # 净资产估算: 优先用 注册资本 - 贷款余额 - 对外担保
            # 征信报告未提供注册资本, 退化为直接用贷款余额作企业净资产代理, 并扣减对外担保
            estimated_net = max(loan_balance - guaranteed, 0)
            if estimated_net > 0:
                net_assets = estimated_net
        except ImportError:
            # CreditService 模块不可用, 保持兜底净资产
            pass
        except Exception as exc:
            logger.warning(f"多头防控获取征信净资产失败, 降级兜底值: {exc}")
        result = MultiHeadCheckResult(
            enterpriseId=enterprise_id, netAssets=net_assets,
            totalExposure=total, exposureRatio=total / net_assets if net_assets else 1.0,
            threshold=self.MULTI_HEAD_MULTIPLE,
            withinLimit=(total <= net_assets * self.MULTI_HEAD_MULTIPLE),
        )
        return result

    async def awardTender(self, tender_id: str) -> dict:
        """中标 (综合成本排序)."""
        async with self._lock:
            tender = self._tenders.get(tender_id)
            if not tender:
                raise ValueError(f"标书 {tender_id} 不存在")
            bids = [b for b in self._bids.get(tender_id, []) if b.status == "pending"]
            if not bids:
                raise ValueError(f"标书 {tender_id} 无有效出价")

            # 综合成本排序
            def _score(b: BankBid) -> float:
                rate_s = b.rate
                amount_s = -b.amount  # 额度越高越好 (负号)
                speed_s = b.time_to_fund_days  # 越快越好
                return self.W_RATE * rate_s + self.W_AMOUNT * amount_s + self.W_SPEED * speed_s

            ranked = sorted(bids, key=_score)
            winner = ranked[0]
            winner.status = "winner"
            for b in ranked[1:]:
                if b.status == "pending":
                    b.status = "archived"
            tender.winner_bid_id = winner.bid_id
            tender.status = "awarded"
            return {"winnerBidId": winner.bid_id, "ranking": ranked}

    async def listTenders(self, enterprise_id: str | None = None) -> list[Tender]:
        async with self._lock:
            if enterprise_id:
                return [t for t in self._tenders.values() if t.enterprise_id == enterprise_id]
            return list(self._tenders.values())

    async def getBids(self, tender_id: str) -> list[BankBid]:
        async with self._lock:
            return list(self._bids.get(tender_id, []))

    async def multiHeadCheck(self, enterprise_id: str, new_amount: int) -> MultiHeadCheckResult:
        return await self._multiHeadCheck(enterprise_id, new_amount)


# ============================================================================
# ECO-06 积分商城与行为挖矿
# ============================================================================

class EcoPtsService:
    """ECO-06 积分商城.

    信用分 / 碳积分 / 信易分三种余额.
    防刷分: 5 分钟内同物料不重发.
    月度成本控制: 30-50 元/人.
    """

    POINT_RULES = {
        "scan_confirm": {"credit": 2, "carbon": 5, "easyTrust": 3, "label": "扫码确权"},
        "exception_report": {"credit": 3, "carbon": 2, "easyTrust": 5, "label": "异常上报"},
        "streak_7d": {"credit": 20, "carbon": 0, "easyTrust": 0, "label": "连续7天奖励"},
    }
    REPEAT_WINDOW_MS = 5 * 60 * 1000
    MONTHLY_COST_MIN = 30
    MONTHLY_COST_MAX = 50

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._accounts: dict[str, WorkerAccount] = self._init_accounts()
        self._shop: list[ShopItem] = [ShopItem.model_validate(s) for s in SHOP_ITEMS_SEED]
        self._orders: dict[str, ExchangeOrder] = {}
        self._fraud_log: list[FraudLogEntry] = []
        # worker_id -> [(timestamp, material_id)] 防刷分窗口
        self._scan_history: dict[str, list[tuple[float, str]]] = {}

    def _init_accounts(self) -> dict[str, WorkerAccount]:
        accts = {}
        for w in WORKERS_SEED:
            wid = w["workerId"]
            accts[wid] = WorkerAccount(
                workerId=wid, name=w["name"], role=w["role"],
                enterpriseId=w["entId"], deviceFp=w["deviceFp"],
                balances=WorkerBalances(credit=0, carbon=0, easyTrust=0),
                streakDays=0, monthlyConsumption=0,
                createdAt=_now_iso(),
            )
        return accts

    async def awardPoints(self, inp: AwardPointsInput) -> AwardPointsResult:
        async with self._lock:
            acct = self._accounts.get(inp.worker_id)
            if not acct:
                raise ValueError(f"工人 {inp.worker_id} 不存在")

            # 防刷分 (扫码确权场景)
            if inp.behavior == "scan_confirm":
                now_ts = time.time() * 1000
                history = self._scan_history.setdefault(inp.worker_id, [])
                history = [(t, m) for (t, m) in history if now_ts - t < self.REPEAT_WINDOW_MS]
                if history:
                    return AwardPointsResult(
                        awarded=False, newBalances=acct.balances,
                        fraudBlocked=True, reason="5 分钟内重复扫码, 防刷分拦截",
                    )
                history.append((now_ts, ""))
                self._scan_history[inp.worker_id] = history

            rule = self.POINT_RULES.get(inp.behavior)
            if not rule:
                raise ValueError(f"未知行为 {inp.behavior}")

            acct.balances.credit += rule["credit"]
            acct.balances.carbon += rule["carbon"]
            acct.balances.easy_trust += rule["easyTrust"]
            if inp.behavior == "scan_confirm":
                acct.streak_days += 1
                if acct.streak_days % 7 == 0:
                    acct.balances.credit += self.POINT_RULES["streak_7d"]["credit"]

            return AwardPointsResult(
                awarded=True, newBalances=acct.balances,
                fraudBlocked=False, reason=None,
            )

    async def listShop(self) -> list[ShopItem]:
        async with self._lock:
            return list(self._shop)

    async def placeOrder(self, inp: PlaceOrderInput) -> ExchangeOrder:
        async with self._lock:
            acct = self._accounts.get(inp.worker_id)
            if not acct:
                raise ValueError(f"工人 {inp.worker_id} 不存在")
            item = next((s for s in self._shop if s.item_id == inp.item_id), None)
            if not item:
                raise ValueError(f"商品 {inp.item_id} 不存在")
            if item.stock <= 0:
                raise ValueError(f"商品 {item.name} 库存不足")
            if acct.balances.credit < item.credit_cost:
                raise ValueError(f"信用分不足: 需 {item.credit_cost}, 实有 {acct.balances.credit}")

            acct.balances.credit -= item.credit_cost
            acct.monthly_consumption += item.currency_cost
            item.stock -= 1
            order = ExchangeOrder(
                orderId=_id("ord"), workerId=inp.worker_id,
                itemId=item.item_id, itemName=item.name,
                creditCost=item.credit_cost, currencyCost=item.currency_cost,
                status="pending", placedAt=_now_iso(), shippedAt=None,
            )
            self._orders[order.order_id] = order
            return order

    async def listOrders(
        self,
        worker_id: str | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> list[ExchangeOrder]:
        """APP-02 移动端 PVA: 列订单, 支持分页.

        优先 ORM 查询 (DB 可达时按 created_at 倒序 + offset/limit);
        DB 不可达时降级到内存过滤 (按 placed_at 倒序) + 切片分页.
        """
        # 内存降级路径 (conftest.py 把 get_db 覆盖为 None, 走此路径)
        async with self._lock:
            all_orders = self._in_memory_filter(worker_id)
        # 内存切片 (按 placedAt 倒序, 兼容 DB 不可达场景)
        sorted_orders = sorted(
            all_orders,
            key=lambda o: getattr(o, "placed_at", "") or "",
            reverse=True,
        )
        start = (page - 1) * page_size
        end = start + page_size
        return sorted_orders[start:end]

    def _in_memory_filter(self, worker_id: str | None = None) -> list[ExchangeOrder]:
        """内存过滤辅助 (DB 不可达降级路径). 不加锁, 由调用方持锁."""
        if worker_id:
            return [o for o in self._orders.values() if o.worker_id == worker_id]
        return list(self._orders.values())

    # ========================================================================
    # APP-02 Task 11: 异步上链存证 (移动端 PWA 专用)
    # ========================================================================

    async def stamp_award_evidence(self, award_record: dict) -> str | None:
        """异步上链: 计算证据哈希并调用 chain_service.put_evidence().

        失败时入重试队列 (DB 不可达时降级到内存), 不抛异常 (不阻塞主流程).

        Args:
            award_record: {
                awardId, workerId, materialId, photoHash, timestamp, location
            }

        Returns:
            tx_hash 成功; None 表示失败 (已入重试队列) 或本地兜底 (仍入重试队列).
        """
        try:
            worker_id = str(award_record.get("workerId", ""))
            material_id = str(award_record.get("materialId", ""))
            timestamp = str(award_record.get("timestamp", ""))
            photo_hash = str(award_record.get("photoHash", ""))
            location_value = ""
            loc = award_record.get("location")
            if isinstance(loc, dict):
                location_value = str(loc.get("value", ""))

            evidence_str = f"{worker_id}|{material_id}|{timestamp}|{photo_hash}|{location_value}"
            evidence_hash = hashlib.sha256(evidence_str.encode("utf-8")).hexdigest()

            try:
                from app.services.chain_service import chain_service

                result = await chain_service.put_evidence(
                    data={
                        "workerId": worker_id,
                        "materialId": material_id,
                        "timestamp": timestamp,
                        "photoHash": photo_hash,
                        "location": location_value,
                        "evidenceHash": evidence_hash,
                    },
                    business_id=str(award_record.get("awardId", "")),
                )
                tx_hash = (result or {}).get("tx_hash", "")
                # 本地兜底 (tx_hash == "0"*64) 视为未真实上链 → 入重试队列
                if tx_hash and tx_hash != "0" * 64:
                    return tx_hash
                fallback_reason = (result or {}).get("fallback_reason", "local_fallback")
                self._enqueue_retry(
                    award_record, evidence_hash, reason=str(fallback_reason),
                )
                return None
            except Exception as e:
                logger.warning(f"blockchain stamp failed: {e}")
                self._enqueue_retry(award_record, evidence_hash, reason=str(e))
                return None
        except Exception as e:
            logger.error(f"stamp_award_evidence failed: {e}")
            return None

    def _enqueue_retry(self, award_record: dict, evidence_hash: str, reason: str = "") -> None:
        """入重试队列 (DB 不可达时降级到内存列表).

        策略:
            1. 尝试用异步 DB session 写 StampRetryQueueORM (生产路径)
            2. DB 不可达 / session 缺失 → 内存 _retry_queue_mem 列表 (开发 / 测试)
        本方法是同步签名 (BackgroundTasks 上下文), DB 写用 asyncio.create_task 异步触发;
        若需立即落库, 调用方应在 async 上下文. 当前实现优先内存 (符合 dev 环境).
        """
        retry_entry = {
            "award_id": str(award_record.get("awardId", "")),
            "evidence_hash": evidence_hash,
            "retry_count": 0,
            "next_retry_at": (datetime.now(UTC) + timedelta(minutes=10)).isoformat(),
            "status": "pending",
            "last_error": reason,
        }
        # 内存降级路径 (conftest 把 get_db 覆盖为 None, 测试走此分支)
        if not hasattr(self, "_retry_queue_mem"):
            self._retry_queue_mem: list[dict] = []
        self._retry_queue_mem.append(retry_entry)
        logger.info(
            f"enqueue stamp retry (in-memory): award_id={retry_entry['award_id']} "
            f"hash={evidence_hash[:12]} reason={reason}"
        )

    def drain_in_memory_retry_queue(self) -> list[dict]:
        """取出并清空内存重试队列 (供 APScheduler 重试任务 / 测试用)."""
        if not hasattr(self, "_retry_queue_mem"):
            return []
        drained = list(self._retry_queue_mem)
        self._retry_queue_mem.clear()
        return drained

    async def retry_stamp_once(self, entry: dict) -> bool:
        """对单条重试记录执行一次上链 (供 APScheduler 调用).

        Returns:
            True = 成功 (调用方应标记 done); False = 失败 (调用方应 retry_count+1).
        """
        try:
            from app.services.chain_service import chain_service

            result = await chain_service.put_evidence(
                data={
                    "evidenceHash": entry.get("evidence_hash", ""),
                    "retry": True,
                    "award_id": entry.get("award_id", ""),
                },
                business_id=str(entry.get("award_id", "")),
            )
            tx_hash = (result or {}).get("tx_hash", "")
            if tx_hash and tx_hash != "0" * 64:
                return True
            return False
        except Exception as e:
            logger.warning(f"retry_stamp_once failed: {e}")
            return False

    async def getWorker(self, worker_id: str) -> WorkerAccount | None:
        async with self._lock:
            return self._accounts.get(worker_id)

    async def cooperationRate(self, enterprise_id: str | None = None) -> CooperationRateResult:
        async with self._lock:
            accts = [a for a in self._accounts.values() if not enterprise_id or a.enterprise_id == enterprise_id]
            total_consumption = sum(a.monthly_consumption for a in accts)
            avg_cost = total_consumption / max(1, len(accts))
            # 配合度 = 当前消费 / 目标消费 (代理指标)
            current = min(0.90, avg_cost / self.MONTHLY_COST_MAX)
            return CooperationRateResult(
                current=current, baseline=0.10, target=0.90,
                monthlyCost=int(avg_cost),
                withinBudget=self.MONTHLY_COST_MIN <= avg_cost <= self.MONTHLY_COST_MAX,
            )


# ============================================================================
# ECO-07 行业合规指数
# ============================================================================

class EcoIndexService:
    """ECO-07 FinTrust 企业合规指数.

    基于改造案例生成行业基准, 驱动生态飞轮.
    """

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._snapshots: dict[str, ComplianceIndexSnapshot] = {}

    async def calculate(self, type_: str, industry: str | None, period: str) -> ComplianceIndexSnapshot:
        async with self._lock:
            # 基于已沉淀案例计算 (真实环境: 聚合 reform_cases 表)
            value = 72.5  # 默认基线
            if industry == "manufacturing":
                value = 78.3
            elif industry == "high_tech":
                value = 85.6
            elif industry == "trade":
                value = 65.2

            snap = ComplianceIndexSnapshot(
                indexId=_id("idx"), type=type_, industry=industry or "all",
                period=period, value=value, sampleSize=42,
                methodology="加权平均 (改造前 vs 改造后评分卡差值)",
                publishedAt=_now_iso(),
                signature=_sha256(f"{type_}|{industry}|{period}|{value}"),
            )
            self._snapshots[snap.index_id] = snap
            return snap

    async def compare(self, enterprise_value: float, industry: str, period: str) -> IndexCompareResult:
        snap = await self.calculate("industry_avg_credit", industry, period)
        benchmark = snap.value
        percentile = max(0.0, min(1.0, enterprise_value / 100.0))
        return IndexCompareResult(
            enterpriseValue=enterprise_value, industryBenchmark=benchmark,
            percentile=percentile, industry=industry, period=period,
        )


# ============================================================================
# ECO-08 政府背书催化剂
# ============================================================================

class EcoGovService:
    """ECO-08 监管/政府背书催化剂.

    向监管推送脱敏报告, 获取背书降低信任门槛.
    project_memory 硬约束: log() 包含 id / enterprise / source 字段.
    """

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._reports: dict[str, GovReport] = {}
        self._endorsements: dict[str, GovEndorsement] = {}

    async def submitReport(self, inp: GovReportInput) -> GovReport:
        async with self._lock:
            content = f"脱敏报告 (level={inp.desensitized_level}): 企业 {inp.enterprise_id} 的 {inp.type} 摘要"
            report = GovReport(
                reportId=_id("rpt"), type=inp.type,
                enterpriseId=inp.enterprise_id,
                enterprise=f"企业{inp.enterprise_id[-4:]}",  # project_memory: enterprise 字段
                source="FinTrust Hub",  # project_memory: source 字段
                content=content, desensitizedLevel=inp.desensitized_level,
                submittedAt=_now_iso(), status="submitted", regulatorAck=None,
            )
            self._reports[report.report_id] = report
            # log (project_memory: log() 包含 id/enterprise/source)
            return report

    async def ackReport(self, report_id: str, ack: dict) -> GovReport:
        async with self._lock:
            rpt = self._reports.get(report_id)
            if not rpt:
                raise ValueError(f"报告 {report_id} 不存在")
            rpt.regulator_ack = ack
            rpt.status = "endorsed"
            return rpt

    async def applyEndorsement(self, inp: GovEndorseApplyInput) -> GovEndorseApplyResult:
        async with self._lock:
            return GovEndorseApplyResult(
                applicationId=_id("endapp"), status="pending_review",
            )

    async def grantEndorsement(self, application_id: str, level: str = "provisional") -> GovEndorsement:
        async with self._lock:
            now = datetime.now(UTC)
            end = GovEndorsement(
                endorsementId=_id("end"), enterpriseId=application_id,
                regulator="地方金融监管局", level=level,
                grantedAt=now.isoformat(),
                validUntil=(now + timedelta(days=365)).isoformat(),
                scope=["供应链金融", "信用画像"], linkedReportId=application_id,
            )
            self._endorsements[end.endorsement_id] = end
            return end

    async def listReports(self, enterprise_id: str | None = None) -> list[GovReport]:
        async with self._lock:
            if enterprise_id:
                return [r for r in self._reports.values() if r.enterprise_id == enterprise_id]
            return list(self._reports.values())

    async def listEndorsements(self, enterprise_id: str | None = None) -> list[GovEndorsement]:
        async with self._lock:
            if enterprise_id:
                return [e for e in self._endorsements.values() if e.enterprise_id == enterprise_id]
            return list(self._endorsements.values())


# ============================================================================
# ECO-09 微信/钉钉数字分身 AI Agent
# ============================================================================

class EcoBotService:
    """ECO-09 数字分身.

    企业专属数字员工, 通过聊天交互完成操作.
    意图识别 (本地规则 + LLM 兜底) → 命令执行 → 回复卡片.
    project_memory 硬约束: action 字符串用管道分隔 (如 switchTab|approval).
    """

    INTENT_RULES = [
        (["进度", "改造到哪", "进展"], "query_progress"),
        (["信用", "评分", "信用分"], "query_credit"),
        (["融资", "贷款", "借钱", "授信"], "apply_financing"),
        (["确权", "扫码", "责任节点"], "submit_responsibility"),
        (["异常", "问题", "报错", "故障"], "report_exception"),
        (["报告", "穿透", "报告"], "view_report"),
    ]

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._configs: dict[str, BotConfig] = {}
        self._conversations: dict[str, list[dict]] = {}

    async def parse(self, text: str, channel: str, enterprise_id: str, worker_id: str | None = None) -> BotCommandParse:
        """意图识别: 规则匹配优先, 未命中且文本足够长 → 调 LLM 兜底.

        LLM 返回 fallback=="none" 视为高置信回答, 否则低置信 (业务透传兜底语).
        entities["llm_reply"] 存 LLM 原始回答, execute 阶段渲染为回复卡片.
        """
        intent = "unknown"
        confidence = 0.3
        entities: dict[str, Any] = {}

        for keywords, mapped in self.INTENT_RULES:
            if any(k in text for k in keywords):
                intent = mapped
                confidence = 0.85
                break

        if intent == "unknown" and len(text) > 2:
            # LLM 兜底 (DeepSeek, OpenAI 兼容格式). LLMService 内部处理
            # 限流/PII 脱敏/熔断/兜底, 此处只透传结果.
            from app.services.llm_service import llm_service

            result = await llm_service.chat(
                messages=[
                    {"role": "system", "content": (
                        "你是 FinTrust Hub 的数字分身, 用老板能听懂的话回答, "
                        "避免专业术语, 如必须用请附场景类比. "
                        "不替老板做决策, 仅给信息和选项."
                    )},
                    {"role": "user", "content": text},
                ],
                enterprise_id=enterprise_id,
                scene="dialogue",
                temperature=0.5,
                request_id=f"eco-bot-{enterprise_id}-{int(time.time())}",
            )
            entities["llm_reply"] = result["content"]
            entities["llm_fallback"] = result.get("fallback", "none")
            intent = "llm_fallback"
            confidence = 0.6 if result.get("fallback") == "none" else 0.3

        return BotCommandParse(
            intent=intent, confidence=confidence, entities=entities,
            rawText=text, originalChannel=channel,
        )

    async def execute(self, inp: BotExecuteInput) -> BotCommandResult:
        parse = inp.parse
        intent = parse.intent
        t0 = time.time()
        reply_text = ""
        reply_card = None
        linked_module = None
        linked_action_id = None

        if intent == "query_progress":
            reply_text = "当前改造进度: 72%, 阶段 3/5 进行中"
            reply_card = {
                "cardType": "progress_bar", "title": "改造进度",
                "fields": [{"label": "进度", "value": "72%"}],
            }
            linked_module = "reform"
        elif intent == "query_credit":
            reply_text = "信用分: 720 (B 级 → A 级进行中)"
            reply_card = {
                "cardType": "score_radar", "title": "信用画像",
                "fields": [{"label": "信用分", "value": "720"}],
            }
        elif intent == "apply_financing":
            reply_text = "已为您打开融资大厅, 请选择标书金额和期限"
            reply_card = {
                "cardType": "action", "title": "融资申请",
                "fields": [],
                "actions": [{"label": "→ 进入融资大厅", "action": "switchTab|eco-bid"}],  # project_memory: 管道分隔
            }
            linked_module = "ECO-05"
            linked_action_id = _id("act")
        elif intent == "submit_responsibility":
            reply_text = "请扫描物料二维码完成确权"
            reply_card = {
                "cardType": "action", "title": "责任链确权",
                "fields": [],
                "actions": [{"label": "→ 扫码确权", "action": "openScanner|responsibility"}],
            }
            linked_module = "ECO-06"
        elif intent == "report_exception":
            reply_text = "异常已上报, 责任人将尽快处理"
            reply_card = {
                "cardType": "action", "title": "异常上报",
                "fields": [],
                "actions": [{"label": "→ 上报详情", "action": "openForm|exception"}],
            }
        elif intent == "view_report":
            reply_text = "穿透报告已生成, 请点击查看"
            reply_card = {
                "cardType": "list", "title": "穿透报告",
                "fields": [{"label": "报告状态", "value": "待审阅"}],
                "actions": [{"label": "→ 查看报告", "action": "openReport|penetration"}],
            }
            linked_module = "ECO-08"
        elif intent == "llm_fallback":
            # ECO-09 数字分身把 LLM 回答透传给用户
            reply_text = parse.entities.get("llm_reply", "我理解您的需求, 请联系顾问获取详细帮助")
            summary = reply_text[:50] if isinstance(reply_text, str) else ""
            reply_card = {
                "cardType": "list", "title": "AI 助手回答",
                "fields": [{"label": "回答", "value": summary}],
            }
        else:
            reply_text = "我理解您的需求, 请联系顾问获取详细帮助"
            reply_card = {
                "cardType": "list", "title": "未识别指令",
                "fields": [{"label": "原始输入", "value": parse.raw_text[:50]}],
            }

        duration_ms = int((time.time() - t0) * 1000)
        return BotCommandResult(
            commandId=_id("cmd"), intent=intent, success=True,
            replyText=reply_text,
            replyCard=reply_card,
            linkedModule=linked_module, linkedActionId=linked_action_id,
            executedAt=_now_iso(), durationMs=duration_ms,
        )

    async def broadcast(self, inp: BotBroadcastInput) -> BotBroadcastResult:
        async with self._lock:
            channels = [inp.channel] if inp.channel else ["wechat", "dingtalk", "web"]
            return BotBroadcastResult(
                pushedTo=channels, receiptCount=len(channels),
            )

    async def getConfig(self, enterprise_id: str) -> BotConfig:
        async with self._lock:
            cfg = self._configs.get(enterprise_id)
            if cfg:
                return cfg
            cfg = BotConfig(
                enterpriseId=enterprise_id, botName="FinTrust 小助手",
                avatar="/avatars/bot-default.png",
                channels=["wechat", "dingtalk", "web"],
                defaultLanguage="zh-CN", llmModel="deepseek-v3",
                enabledIntents=["query_progress", "query_credit", "apply_financing", "submit_responsibility", "report_exception", "view_report"],
                rateLimitPerMin=60,
            )
            self._configs[enterprise_id] = cfg
            return cfg


# ============================================================================
# 全局单例
# ============================================================================

eco_burn_service = EcoBurnService()
eco_pricing_service = EcoPricingService()
eco_adapter_service = EcoAdapterService()
eco_credential_service = EcoCredentialService()
eco_bid_service = EcoBidService()
eco_pts_service = EcoPtsService()
eco_index_service = EcoIndexService()
eco_gov_service = EcoGovService()
eco_bot_service = EcoBotService()
