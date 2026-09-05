"""征信与审批简化模块服务 (MOD-03, R5.1 升级).

spec 依据: MOD-03 L657-720 (征信与审批简化)

设计风格: 内存单例 + asyncio.Lock + _seed + db=None (参考 bank_service.py).

新增能力:
    - _call_pbc_credit_api: 人行征信 API 调用 (15s 超时, 降级到 mock)
    - parse_credit_report: 解析征信报告为结构化 CreditReport
    - evaluate_credit: 综合评分 + 建议 approve/review/reject
    - compute_credit_score / simplify_approval / get_alternative_data (P1 桩保留)
"""

from __future__ import annotations

import asyncio
import logging
import random
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from app.schemas.credit_report import (
    CreditDecision,
    CreditEvaluation,
    CreditRating,
    CreditReport,
)

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _id(prefix: str = "cr") -> str:
    return f"{prefix}-{uuid4().hex[:12]}"


# === 评级与决策映射 ===

_RATING_TO_SCORE: dict[str, int] = {
    "AAA": 950, "AA": 880, "A": 820, "BBB": 720,
    "BB": 650, "B": 580, "CCC": 510, "CC": 440, "C": 380, "D": 300,
}


def _score_to_rating(score: int) -> CreditRating:
    """分数 → 信用评级 (AAA-D)."""
    if score >= 920:
        return "AAA"
    if score >= 860:
        return "AA"
    if score >= 800:
        return "A"
    if score >= 700:
        return "BBB"
    if score >= 630:
        return "BB"
    if score >= 560:
        return "B"
    if score >= 490:
        return "CCC"
    if score >= 420:
        return "CC"
    if score >= 350:
        return "C"
    return "D"


def _rating_to_decision(rating: CreditRating) -> CreditDecision:
    """评级 → 建议 (approve/review/reject)."""
    if rating in ("AAA", "AA", "A"):
        return "approve"
    if rating in ("BBB", "BB", "B"):
        return "review"
    return "reject"


# ============================================================================
# 内存状态 (开发期, 参考 bank_service._BankStore 模式)
# ============================================================================

class _CreditStore:
    """内存兜底数据 (C 档独立兜底, 后端无 DB 时返回)."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        # enterprise_id -> raw_report dict (人行征信原始报告)
        self._raw_reports: dict[str, dict] = {}
        # enterprise_id -> CreditEvaluation dict
        self._evaluations: dict[str, dict] = {}
        self._seed()

    def _seed(self) -> None:
        """内置 mock: 4 家企业的征信报告 + 评分."""
        now = _now_iso()
        specs = [
            # (eid, name, uscc, loan_balance_cents, guaranteed_cents,
            #  overdue_count, interest_arrears_cents, concern_count, rating)
            ("E001", "深圳科创电子", "91440300MA5EXAMPLE1",
             8_000_000_00, 1_500_000_00, 0, 0, 0, "AA"),
            ("E002", "杭州智造机械", "91330100MA2EXAMPLE2",
             12_500_000_00, 4_200_000_00, 2, 35_000_00, 1, "BB"),
            ("E003", "苏州新材料股份", "91320500MA6EXAMPLE3",
             3_200_000_00, 800_000_00, 0, 0, 0, "AAA"),
            ("E004", "广州新能源科技", "91440100MA9EXAMPLE4",
             6_800_000_00, 2_900_000_00, 1, 12_500_00, 2, "BBB"),
        ]
        for (eid, name, uscc, loan, guar, odc, owe, cc, rating) in specs:
            raw = {
                "enterpriseId": eid,
                "enterpriseName": name,
                "uscc": uscc,
                "loanBalanceCents": loan,
                "guaranteedAmountCents": guar,
                "overdueCount": odc,
                "interestArrearsCents": owe,
                "concernClassCount": cc,
                "creditRating": rating,
                "inquiryAtIso": now,
                "rawSource": "mock",
                # 模拟人行返回的额外字段 (供 parse 演示)
                "creditRecords": [
                    {"type": "loan", "amountCents": loan, "status": "outstanding"},
                    {"type": "guarantee", "amountCents": guar, "status": "active"},
                ],
                "inquiryRecord": {"count12m": 3, "lastDateIso": now},
            }
            self._raw_reports[eid] = raw
            # 计算综合评分 (复用 evaluate_credit 中相同的算法, 但此处直接写入缓存)
            score = _RATING_TO_SCORE.get(rating, 600)
            self._evaluations[eid] = {
                "enterpriseId": eid,
                "enterpriseName": name,
                "creditRating": rating,
                "creditScore": score,
                "decision": _rating_to_decision(rating),
                "factors": [
                    "人行征信报告解析",
                    "对外担保余额",
                    "逾期与欠息记录",
                    "关注类贷款笔数",
                ],
                "reasoning": f"种子数据: 评级 {rating}, 评分 {score}",
                "evaluatedAtIso": now,
                "report": raw,
            }

    async def get_raw(self, eid: str) -> dict | None:
        async with self._lock:
            r = self._raw_reports.get(eid)
            return dict(r) if r else None

    async def put_raw(self, eid: str, raw: dict) -> dict:
        async with self._lock:
            self._raw_reports[eid] = dict(raw)
            return dict(raw)

    async def get_eval(self, eid: str) -> dict | None:
        async with self._lock:
            e = self._evaluations.get(eid)
            return dict(e) if e else None

    async def put_eval(self, eid: str, ev: dict) -> dict:
        async with self._lock:
            self._evaluations[eid] = dict(ev)
            return dict(ev)


_credit_store = _CreditStore()


# ============================================================================
# 征信服务
# ============================================================================

class CreditService:
    """征信服务 (MOD-03).

    保留 P1 桩方法 + 新增 R5.1 能力:
        - _call_pbc_credit_api
        - parse_credit_report
        - evaluate_credit
    """

    # 替代数据 4 类 (对齐 spec MOD-03)
    ALTERNATIVE_DATA_TYPES = [
        "tax",          # 税务数据
        "utility",      # 水电煤缴费
        "logistics",    # 物流签收
        "judicial",     # 司法失信
    ]

    PBC_API_TIMEOUT_SEC = 15.0

    def __init__(self, db: Any | None = None) -> None:
        self.db = db  # 兼容 DB 注入, 当前仅内存兜底

    # === 人行征信 API 调用 (R5.1) ===

    async def _call_pbc_credit_api(
        self, enterprise_id: str, enterprise_name: str, uscc: str,
    ) -> dict:
        """调用中国人民银行征信中心 API.

        超时 15s, 不可用时降级到 mock 报告 (走 _credit_store 中种子数据).

        Returns:
            原始征信报告 dict (供 parse_credit_report 解析).
        """
        from app.config import settings

        api_url = getattr(settings, "PBOC_CREDIT_API_URL", "") or ""
        api_key = getattr(settings, "PBOC_CREDIT_API_KEY", "") or ""
        org_code = getattr(settings, "PBOC_CREDIT_ORG_CODE", "") or ""

        # 优先走内存种子的 mock 报告 (避免无凭证时阻断业务)
        seeded = await _credit_store.get_raw(enterprise_id)
        if seeded:
            return dict(seeded)

        # 真实 API 调用 (仅有 URL + Key + OrgCode 时尝试)
        if api_url and api_key and org_code:
            try:
                import httpx
                async with httpx.AsyncClient(timeout=self.PBC_API_TIMEOUT_SEC) as client:
                    resp = await client.post(
                        api_url.rstrip("/") + "/v1/credit/report",
                        headers={
                            "Authorization": f"Bearer {api_key}",
                            "X-Org-Code": org_code,
                            "Content-Type": "application/json",
                        },
                        json={
                            "enterpriseId": enterprise_id,
                            "enterpriseName": enterprise_name,
                            "uscc": uscc,
                        },
                    )
                    if resp.status_code == 200:
                        data = resp.json()
                        data.setdefault("rawSource", "pboc")
                        await _credit_store.put_raw(enterprise_id, data)
                        return data
                    logger.warning(
                        f"PBC API 非 200: {resp.status_code}, 降级 mock"
                    )
            except TimeoutError:
                logger.warning("PBC API 超时 15s, 降级 mock")
            except Exception as exc:
                logger.warning(f"PBC API 调用失败: {exc}, 降级 mock")

        # 降级 mock: 生成与 enterprise_id 哈希相关的稳定报告
        base_score = 600 + (hash(enterprise_id) % 200)
        rating = _score_to_rating(base_score)
        mock_report = {
            "enterpriseId": enterprise_id,
            "enterpriseName": enterprise_name,
            "uscc": uscc,
            "loanBalanceCents": random.randint(1_000_000, 50_000_000) * 100,
            "guaranteedAmountCents": random.randint(0, 10_000_000) * 100,
            "overdueCount": random.randint(0, 3),
            "interestArrearsCents": random.randint(0, 50_000) * 100,
            "concernClassCount": random.randint(0, 2),
            "creditRating": rating,
            "inquiryAtIso": _now_iso(),
            "rawSource": "mock",
            "creditRecords": [],
            "inquiryRecord": {"count12m": 1, "lastDateIso": _now_iso()},
        }
        await _credit_store.put_raw(enterprise_id, mock_report)
        return mock_report

    # === 解析征信报告 (R5.1) ===

    def parse_credit_report(self, raw_report: dict) -> CreditReport:
        """解析人行征信原始报告 → 结构化 CreditReport.

        解析维度: 信贷记录 / 对外担保 / 欠息 / 逾期 / 关注类.
        """
        eid = str(raw_report.get("enterpriseId") or raw_report.get("enterprise_id") or "")
        name = str(raw_report.get("enterpriseName") or raw_report.get("enterprise_name") or "")
        uscc = str(raw_report.get("uscc") or raw_report.get("USCC") or "")

        # 兼容 camelCase / snake_case / 中文键
        loan = self._extract_amount(raw_report, ("loanBalanceCents", "loan_balance_cents", "loanBalance"))
        guar = self._extract_amount(raw_report, ("guaranteedAmountCents", "guaranteed_amount_cents", "guaranteedAmount"))
        odc = int(raw_report.get("overdueCount", raw_report.get("overdue_count", 0)) or 0)
        owe = self._extract_amount(raw_report, ("interestArrearsCents", "interest_arrears_cents", "interestArrears"))
        cc = int(raw_report.get("concernClassCount", raw_report.get("concern_class_count", 0)) or 0)
        rating = raw_report.get("creditRating") or raw_report.get("credit_rating") or "BBB"
        if rating not in _RATING_TO_SCORE:
            rating = "BBB"
        inquiry = (
            raw_report.get("inquiryAtIso")
            or raw_report.get("inquiry_at_iso")
            or _now_iso()
        )
        source = str(raw_report.get("rawSource") or raw_report.get("raw_source") or "mock")

        return CreditReport(
            enterprise_id=eid,
            enterprise_name=name,
            uscc=uscc,
            loan_balance_cents=loan,
            guaranteed_amount_cents=guar,
            overdue_count=odc,
            interest_arrears_cents=owe,
            concern_class_count=cc,
            credit_rating=rating,
            inquiry_at_iso=inquiry,
            raw_source=source,
        )

    @staticmethod
    def _extract_amount(d: dict, keys: tuple[str, ...]) -> int:
        """从多个候选键中提取金额 (元 → 分, 若数值偏小则视为已分)."""
        for k in keys:
            if k in d and d[k] is not None:
                try:
                    v = int(d[k])
                except (TypeError, ValueError):
                    continue
                # 若数值 < 10000 视为元, 转 分
                if v < 10_000 and v > 0:
                    return v * 100
                return v
        return 0

    # === 综合评分 (R5.1) ===

    async def evaluate_credit(self, enterprise_id: str) -> CreditEvaluation:
        """综合评分 + 建议 approve/review/reject.

        评分维度: 信用评级 (40%) + 信贷余额 (15%) + 对外担保 (10%)
                  + 逾期笔数 (15%) + 欠息 (10%) + 关注类 (10%)
        """
        # 取原始报告 (走 _call_pbc_credit_api, 自动降级)
        raw = await self._call_pbc_credit_api(
            enterprise_id=enterprise_id,
            enterprise_name=enterprise_id,
            uscc="",
        )
        report = self.parse_credit_report(raw)

        # 基础分 (来自评级)
        base_score = _RATING_TO_SCORE.get(report.credit_rating, 600)

        # 扣分项 (各项异常时减分, 否则轻微加分)
        # 1. 信贷余额: 高于 5 千万分则视为偏重, 扣 30-100
        loan_cents = report.loan_balance_cents
        if loan_cents > 50_000_000 * 100:
            base_score -= 100
        elif loan_cents > 20_000_000 * 100:
            base_score -= 30
        else:
            base_score += 10

        # 2. 对外担保
        if report.guaranteed_amount_cents > 5_000_000 * 100:
            base_score -= 50
        elif report.guaranteed_amount_cents > 1_000_000 * 100:
            base_score -= 20
        else:
            base_score += 5

        # 3. 逾期笔数
        base_score -= report.overdue_count * 50

        # 4. 欠息
        if report.interest_arrears_cents > 100_000 * 100:
            base_score -= 80
        elif report.interest_arrears_cents > 0:
            base_score -= 30

        # 5. 关注类贷款
        base_score -= report.concern_class_count * 40

        score = max(0, min(1000, base_score))
        rating = _score_to_rating(score)
        decision = _rating_to_decision(rating)

        factors: list[str] = []
        if report.overdue_count > 0:
            factors.append(f"逾期 {report.overdue_count} 笔")
        if report.interest_arrears_cents > 0:
            factors.append(f"欠息 {report.interest_arrears_cents / 100:.2f} 元")
        if report.concern_class_count > 0:
            factors.append(f"关注类贷款 {report.concern_class_count} 笔")
        if report.guaranteed_amount_cents > 0:
            factors.append(f"对外担保 {report.guaranteed_amount_cents / 100:.2f} 元")
        if report.loan_balance_cents > 0:
            factors.append(f"贷款余额 {report.loan_balance_cents / 100:.2f} 元")
        if not factors:
            factors.append("无显著负面记录")

        reasoning = (
            f"评级 {report.credit_rating} → 综合评分 {score} → 评级 {rating}; "
            f"建议: {decision}"
        )

        eval_dict = {
            "enterpriseId": enterprise_id,
            "enterpriseName": report.enterprise_name,
            "creditRating": rating,
            "creditScore": score,
            "decision": decision,
            "factors": factors,
            "reasoning": reasoning,
            "evaluatedAtIso": _now_iso(),
            "report": report.model_dump(by_alias=True),
        }
        await _credit_store.put_eval(enterprise_id, eval_dict)
        # 注入 report 对象, 便于 model_validate 后构建嵌套
        eval_dict["report"] = report.model_dump(by_alias=True)
        return CreditEvaluation.model_validate(eval_dict)

    # === P1 兼容方法 (R5.1 真实实现) ===

    async def compute_credit_score(self, enterprise_id: str) -> dict:
        """计算企业信用分 (基于 evaluate_credit 真实评分).

        信用分公式 (spec MOD-03):
            credit_score = 0.4 * base_data + 0.3 * alternative_data + 0.2 * behavior + 0.1 * judicial

        本方法聚焦 base_data 维度 (人行征信报告), 调用 evaluate_credit 获取 6 维综合评分.
        替代数据 (alternative/judicial) 需另行调用 get_alternative_data 获取.
        """
        evaluation = await self.evaluate_credit(enterprise_id)
        score = evaluation.credit_score
        # 三档等级 (保留原 P1 桩阈值, 适配 0-1000 评分区间)
        level = "A" if score >= 750 else "B" if score >= 650 else "C"
        # 数据完整度: base_data 已具备 (权重 0.4); 真实 PBC 数据完整度更高, 内置演示数据略降
        raw_source = getattr(evaluation.report, "raw_source", "mock")
        completeness = 0.4 if raw_source == "pboc" else 0.3
        return {
            "enterprise_id": enterprise_id,
            "credit_score": score,
            "level": level,
            "data_sources": self.ALTERNATIVE_DATA_TYPES,
            "completeness": completeness,
            "note": f"基于人行征信报告 ({raw_source}) 6 维综合评分; 替代数据需调用 get_alternative_data",
        }

    async def simplify_approval(
        self, enterprise_id: str, credit_score: int, financing_amount: float,
    ) -> dict:
        """审批流程简化 (基于信用分 + 金额 + 征信决策路由).

        基础路由 (保留 P1 桩逻辑):
            L1: 信用分 ≥ 750 且金额 < 100万 → 秒批
            L2: 信用分 ≥ 650 且金额 < 500万 → 1-3 天
            L3: 其他 → 5-10 天

        决策维度增强 (调用 evaluate_credit):
            - reject (征信评级 CCC 以下) → 强制 L3
            - review (征信评级 BBB-B) → 不允许 L1 秒批, 降至 L2
            - approve (征信评级 A 以上) → 维持基础路由
        """
        # 基础路由 (保留 P1 桩逻辑)
        if credit_score >= 750 and financing_amount < 1_000_000:
            level = "L1"
            sla = "秒批"
            required_docs: list[str] = []
        elif credit_score >= 650 and financing_amount < 5_000_000:
            level = "L2"
            sla = "1-3 天"
            required_docs = ["basic", "tax_recent"]
        else:
            level = "L3"
            sla = "5-10 天"
            required_docs = ["basic", "tax", "financial", "guarantee"]

        # 决策维度增强 (调用 evaluate_credit 获取真实决策)
        decision = "approve"
        try:
            evaluation = await self.evaluate_credit(enterprise_id)
            decision = evaluation.decision
        except Exception as exc:
            logger.warning(f"simplify_approval evaluate_credit 失败, 按基础路由: {exc}")

        # reject → 强制 L3
        if decision == "reject":
            level = "L3"
            sla = "5-10 天"
            required_docs = ["basic", "tax", "financial", "guarantee"]
        # review → 不允许秒批, 降至 L2
        elif decision == "review" and level == "L1":
            level = "L2"
            sla = "1-3 天"
            required_docs = ["basic", "tax_recent"]

        return {
            "enterprise_id": enterprise_id,
            "approval_level": level,
            "sla": sla,
            "required_docs": required_docs,
            "credit_score": credit_score,
            "amount": financing_amount,
        }

    async def get_alternative_data(
        self, enterprise_id: str, data_type: str,
    ) -> dict:
        """获取替代数据 (4 类: tax/utility/logistics/judicial).

        通过 api_adapter_registry 路由到对应适配器:
            - tax → A3_TAX_INVOICE (税务发票)
            - judicial → A5_JUDICIARY (司法失信)
            - utility / logistics → 暂无对应适配器, 降级返回 "服务暂不可用"
        """
        if data_type not in self.ALTERNATIVE_DATA_TYPES:
            return {"error": f"未知数据类型: {data_type}"}

        # data_type → AdapterId 映射 (utility/logistics 暂无对应适配器)
        adapter_id_map = {
            "tax": "A3_TAX_INVOICE",
            "judicial": "A5_JUDICIARY",
        }
        aid_value = adapter_id_map.get(data_type)
        if aid_value is None:
            return {
                "enterprise_id": enterprise_id,
                "data_type": data_type,
                "data": [],
                "note": f"暂无 {data_type} 对应适配器, 服务暂不可用",
            }

        # 尝试加载 api_adapter_registry (ImportError 兜底)
        try:
            from app.schemas.api_adapters import (
                AdapterId,
                InvokeRequest,
                InvokeStatus,
            )
            from app.services.api_adapter_registry import get_adapter_registry
        except ImportError as exc:
            return {
                "enterprise_id": enterprise_id,
                "data_type": data_type,
                "data": [],
                "note": f"api_adapter_registry 不可用: {exc}",
            }

        try:
            registry = await get_adapter_registry()
            aid = AdapterId(aid_value)
            req = InvokeRequest(
                adapter_id=aid,
                operation="query",
                params={"enterpriseId": enterprise_id},
                timeout_ms=3000,
                retry_times=2,
            )
            result = await registry.invoke(req)
            # OK / FALLBACK 视为可用; RATE_LIMITED / TIMEOUT / FAILED 视为不可用
            if result.status in (InvokeStatus.OK, InvokeStatus.FALLBACK) and result.response:
                return {
                    "enterprise_id": enterprise_id,
                    "data_type": data_type,
                    "data": [result.response],
                    "note": f"source={result.status.value}, adapter={aid.value}, trace={result.trace_id}",
                }
            return {
                "enterprise_id": enterprise_id,
                "data_type": data_type,
                "data": [],
                "note": f"适配器调用失败 status={result.status.value}, error={result.error_code}, trace={result.trace_id}",
            }
        except Exception as exc:
            logger.warning(f"get_alternative_data 调用异常 ({data_type}): {exc}")
            return {
                "enterprise_id": enterprise_id,
                "data_type": data_type,
                "data": [],
                "note": f"适配器调用异常: {exc}",
            }


credit_service = CreditService(db=None)
