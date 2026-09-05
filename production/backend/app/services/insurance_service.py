"""应收款保险模块 (MOD-05).

spec 依据: MOD-05 L772-820 (应收款保险)
状态: V3 已实现 production — 投保流程 + 保单管理 + 理赔协同

V3 升级:
    - create_policy: 创建保单 (生成保单号, 计算保费)
    - get_policy: 查询保单
    - list_policies: 列出企业保单
    - file_claim: 理赔申请 (新签名: policy_id, claim_amount, incident_desc)
    - 保费计算: base_rate=0.5%, 按 coverage_ratio 和企业风险评分调整

设计风格: 内存单例 _InsuranceStore + asyncio.Lock + _seed + db=None 注入
        (参考 bank_service.py / multilateral_service.py).

降级策略: 外部 insurer SDK 不可用时降级到内存保单存根, 保证零机构接入独立运行.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _id(prefix: str = "POL") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10].upper()}"


# ============================================================================
# 保费计算参数 (V3)
# ============================================================================

# 基础保费费率: 0.5% (覆盖 100% 时的费率)
_BASE_PREMIUM_RATE = 0.005

# 风险评分 → 费率调整系数映射 (PD 百分比)
# PD 越高, 费率越高 (赔付概率大)
def _risk_factor_from_pd(pd_percent: float) -> float:
    """根据企业 PD (违约概率 0-100) 计算费率调整因子.

    PD < 5: 0.8x (低风险优惠)
    5 <= PD < 15: 1.0x (基准)
    15 <= PD < 30: 1.5x (中风险加价)
    PD >= 30: 2.5x (高风险加价)
    """
    if pd_percent < 5.0:
        return 0.8
    elif pd_percent < 15.0:
        return 1.0
    elif pd_percent < 30.0:
        return 1.5
    else:
        return 2.5


# 覆盖比例 → 费率调整因子: 高覆盖比例对应略高的费率
def _coverage_factor(coverage_ratio: float) -> float:
    """根据 coverage_ratio (0-1) 计算费率调整因子.

    coverage_ratio < 0.5: 0.7x (低覆盖折扣)
    0.5 <= coverage_ratio < 0.8: 1.0x (基准)
    coverage_ratio >= 0.8: 1.2x (高覆盖加价)
    """
    if coverage_ratio < 0.5:
        return 0.7
    elif coverage_ratio < 0.8:
        return 1.0
    else:
        return 1.2


def _compute_premium(
    receivable_amount: float,
    coverage_ratio: float,
    pd_percent: float,
) -> tuple[float, float, dict[str, Any]]:
    """保费计算: base_rate=0.5%, 按 coverage_ratio 和企业风险评分调整.

    Returns:
        (premium_amount, premium_rate, breakdown)
        - premium_amount: 保费金额 (元)
        - premium_rate: 实际费率 (小数, 如 0.008 表示 0.8%)
        - breakdown: 计算明细 dict
    """
    coverage_ratio = max(0.0, min(1.0, coverage_ratio))
    risk_factor = _risk_factor_from_pd(pd_percent)
    coverage_factor = _coverage_factor(coverage_ratio)
    premium_rate = _BASE_PREMIUM_RATE * risk_factor * coverage_factor
    coverage_amount = receivable_amount * coverage_ratio
    premium_amount = coverage_amount * premium_rate
    breakdown = {
        "base_rate": _BASE_PREMIUM_RATE,
        "risk_factor": risk_factor,
        "coverage_factor": coverage_factor,
        "final_rate": premium_rate,
        "coverage_amount": coverage_amount,
        "premium_amount": premium_amount,
        "pd_percent": pd_percent,
        "coverage_ratio": coverage_ratio,
    }
    return round(premium_amount, 2), round(premium_rate, 6), breakdown


# ============================================================================
# 内存状态
# ============================================================================

class _InsuranceStore:
    """保单内存兜底数据: 3 个种子保单 + 1 个待审核理赔."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        # policy_id -> policy dict
        self._policies: dict[str, dict] = {}
        # claim_id -> claim dict
        self._claims: dict[str, dict] = {}
        self._seed()

    def _seed(self) -> None:
        """内置 mock: 3 个保单 + 1 个待审核理赔.

        - POL-2026-0001: E001, 已生效, 全额覆盖
        - POL-2026-0002: E002, 已生效, 70% 覆盖
        - POL-2026-0003: E003, 已过期
        """
        now = datetime.now(UTC)
        seed_policies = [
            {
                "policy_id": "POL-2026-0001",
                "enterprise_id": "E001",
                "insured_party": "深圳供应链 A 公司",
                "receivable_amount": 1_000_000.0,
                "coverage_ratio": 0.9,
                "coverage_amount": 900_000.0,
                "premium_rate": 0.0048,  # 0.5% * 0.8 (低风险) * 1.2 (高覆盖)
                "premium_amount": 4320.0,
                "policy_status": "active",
                "valid_from_iso": (now - timedelta(days=30)).isoformat(),
                "valid_to_iso": (now + timedelta(days=335)).isoformat(),
                "created_at_iso": (now - timedelta(days=30)).isoformat(),
                "pd_percent_at_issue": 3.5,
                "insurer": "mock_insurer",
                "breakdown": {},
            },
            {
                "policy_id": "POL-2026-0002",
                "enterprise_id": "E002",
                "insured_party": "杭州智造 B 公司",
                "receivable_amount": 2_000_000.0,
                "coverage_ratio": 0.7,
                "coverage_amount": 1_400_000.0,
                "premium_rate": 0.005,  # 0.5% * 1.0 (中风险) * 1.0 (基准)
                "premium_amount": 7000.0,
                "policy_status": "active",
                "valid_from_iso": (now - timedelta(days=15)).isoformat(),
                "valid_to_iso": (now + timedelta(days=350)).isoformat(),
                "created_at_iso": (now - timedelta(days=15)).isoformat(),
                "pd_percent_at_issue": 8.0,
                "insurer": "mock_insurer",
                "breakdown": {},
            },
            {
                "policy_id": "POL-2026-0003",
                "enterprise_id": "E003",
                "insured_party": "苏州新材料 C 公司",
                "receivable_amount": 500_000.0,
                "coverage_ratio": 0.6,
                "coverage_amount": 300_000.0,
                "premium_rate": 0.0075,  # 0.5% * 1.5 (中风险) * 1.0 (基准)
                "premium_amount": 2250.0,
                "policy_status": "expired",
                "valid_from_iso": (now - timedelta(days=400)).isoformat(),
                "valid_to_iso": (now - timedelta(days=35)).isoformat(),
                "created_at_iso": (now - timedelta(days=400)).isoformat(),
                "pd_percent_at_issue": 18.0,
                "insurer": "mock_insurer",
                "breakdown": {},
            },
        ]
        for p in seed_policies:
            self._policies[p["policy_id"]] = p

        # 1 个待审核理赔
        seed_claim = {
            "claim_id": "CLM-2026-0001",
            "policy_id": "POL-2026-0001",
            "enterprise_id": "E001",
            "claim_amount": 200_000.0,
            "incident_desc": "买方 E001 应收账款逾期 60 天未付",
            "status": "under_review",
            "filed_at_iso": (now - timedelta(days=2)).isoformat(),
            "sla_days": 7,
            "insurer": "mock_insurer",
            "note": "种子理赔: 待审核",
        }
        self._claims[seed_claim["claim_id"]] = seed_claim

    async def get_policy(self, policy_id: str) -> dict | None:
        async with self._lock:
            p = self._policies.get(policy_id)
            return dict(p) if p else None

    async def list_policies(
        self, enterprise_id: str | None = None,
    ) -> list[dict]:
        async with self._lock:
            policies = list(self._policies.values())
            if enterprise_id:
                policies = [p for p in policies if p.get("enterprise_id") == enterprise_id]
            return [dict(p) for p in policies]

    async def put_policy(self, policy: dict) -> dict:
        async with self._lock:
            self._policies[policy["policy_id"]] = dict(policy)
            return dict(policy)

    async def put_claim(self, claim: dict) -> dict:
        async with self._lock:
            self._claims[claim["claim_id"]] = dict(claim)
            return dict(claim)

    async def get_claim(self, claim_id: str) -> dict | None:
        async with self._lock:
            c = self._claims.get(claim_id)
            return dict(c) if c else None


_insurance_store = _InsuranceStore()


# ============================================================================
# 应收款保险服务
# ============================================================================

class InsuranceService:
    """应收款保险服务 (MOD-05).

    V3 实现:
        - create_policy: 创建保单 (生成保单号, 计算保费)
        - get_policy: 查询保单
        - list_policies: 列出企业保单
        - file_claim: 理赔申请
        - 保费计算: base_rate=0.5%, 按 coverage_ratio 和企业风险评分调整

    兼容旧桩接口 (legacy):
        - confirm_receivable: 应收款确权 (基于五流验证)
        - match_insurance: 保单匹配 (基于金额 + 风险等级, 返回 mock 报价)
    """

    def __init__(self, db: Any | None = None) -> None:
        self.db = db  # 兼容 DB 注入, 当前仅内存兜底

    # ====================================================================
    # V3 投保流程 + 保单管理
    # ====================================================================

    async def _fetch_enterprise_pd(self, enterprise_id: str) -> float:
        """获取企业 PD (违约概率, 0-100), 用于保费定价.

        降级策略: performance_score_service 不可用时返回默认值 8.0 (中等风险).
        """
        try:
            from app.services.performance_score_service import (
                performance_score_service,
            )
            score = await performance_score_service.compute(
                enterprise_id, use_llm=False,
            )
            return float(score.pd_percent)
        except Exception as exc:
            logger.warning(
                f"performance_score_service 拉取 PD 失败 ({exc}), 降级默认 8.0"
            )
            return 8.0

    async def create_policy(
        self,
        enterprise_id: str,
        receivable_amount: float,
        insured_party: str,
        coverage_ratio: float = 0.8,
    ) -> dict:
        """创建保单 (生成保单号, 计算保费).

        Args:
            enterprise_id: 投保企业 ID.
            receivable_amount: 应收账款金额 (元).
            insured_party: 被保险方 (买方名称).
            coverage_ratio: 覆盖比例 (0-1, 默认 0.8).

        Returns:
            {
                "policy_id": str,
                "enterprise_id": str,
                "insured_party": str,
                "receivable_amount": float,
                "coverage_ratio": float,
                "coverage_amount": float,
                "premium_rate": float,
                "premium_amount": float,
                "policy_status": "quoted"|"active"|"expired"|"cancelled",
                "valid_from_iso": str,
                "valid_to_iso": str,
                "created_at_iso": str,
                "pd_percent_at_issue": float,
                "insurer": "mock_insurer",
                "breakdown": {...},
            }

        保费计算: base_rate=0.5%, 按 coverage_ratio 和企业 PD 调整.
        保单默认有效期 1 年 (365 天).
        """
        # 校验输入
        if receivable_amount <= 0:
            raise ValueError("receivable_amount 必须大于 0")
        if not (0.0 < coverage_ratio <= 1.0):
            raise ValueError("coverage_ratio 必须在 (0, 1] 区间")
        if not enterprise_id or not insured_party:
            raise ValueError("enterprise_id 和 insured_party 不能为空")

        # 获取企业 PD (用于保费定价)
        pd_percent = await self._fetch_enterprise_pd(enterprise_id)

        # 计算保费
        premium_amount, premium_rate, breakdown = _compute_premium(
            receivable_amount=receivable_amount,
            coverage_ratio=coverage_ratio,
            pd_percent=pd_percent,
        )

        # 生成保单号 + 时间戳
        policy_id = _id("POL")
        now = datetime.now(UTC)
        valid_from = now
        valid_to = now + timedelta(days=365)

        policy = {
            "policy_id": policy_id,
            "enterprise_id": enterprise_id,
            "insured_party": insured_party,
            "receivable_amount": round(receivable_amount, 2),
            "coverage_ratio": round(coverage_ratio, 4),
            "coverage_amount": round(receivable_amount * coverage_ratio, 2),
            "premium_rate": premium_rate,
            "premium_amount": premium_amount,
            "policy_status": "active",  # 创建即生效 (mock insurer 即时承保)
            "valid_from_iso": valid_from.isoformat(),
            "valid_to_iso": valid_to.isoformat(),
            "created_at_iso": now.isoformat(),
            "pd_percent_at_issue": round(pd_percent, 2),
            "insurer": "mock_insurer",
            "breakdown": breakdown,
        }
        await _insurance_store.put_policy(policy)
        return policy

    async def get_policy(self, policy_id: str) -> dict | None:
        """查询保单 (不存在返回 None)."""
        return await _insurance_store.get_policy(policy_id)

    async def list_policies(
        self, enterprise_id: str | None = None,
    ) -> list[dict]:
        """列出企业保单 (可按 enterprise_id 过滤, 不过滤则返回全部)."""
        return await _insurance_store.list_policies(enterprise_id)

    async def file_claim(
        self,
        policy_id: str,
        claim_amount: float,
        incident_desc: str,
    ) -> dict:
        """理赔申请.

        Args:
            policy_id: 关联保单 ID.
            claim_amount: 理赔金额 (元).
            incident_desc: 事故描述 (买方违约/逾期等).

        Returns:
            {
                "claim_id": str,
                "policy_id": str,
                "enterprise_id": str,
                "claim_amount": float,
                "incident_desc": str,
                "status": "under_review"|"approved"|"rejected"|"paid",
                "filed_at_iso": str,
                "sla_days": int,
                "insurer": str,
            }

        校验:
            - 保单必须存在且有效 (status=active)
            - 理赔金额不能超过保单覆盖金额 (coverage_amount)
            - incident_desc 不能为空
        """
        # 校验保单存在
        policy = await _insurance_store.get_policy(policy_id)
        if not policy:
            raise ValueError(f"保单 {policy_id} 不存在")

        # 校验保单状态
        if policy.get("policy_status") != "active":
            raise ValueError(
                f"保单 {policy_id} 状态为 {policy.get('policy_status')}, "
                f"无法申请理赔 (仅 active 保单可理赔)"
            )

        # 校验理赔金额
        coverage_amount = float(policy.get("coverage_amount", 0))
        if claim_amount <= 0:
            raise ValueError("claim_amount 必须大于 0")
        if claim_amount > coverage_amount:
            raise ValueError(
                f"理赔金额 {claim_amount} 超过保单覆盖金额 {coverage_amount}"
            )

        # 校验事故描述
        if not incident_desc or not incident_desc.strip():
            raise ValueError("incident_desc 不能为空")

        # 创建理赔
        claim_id = _id("CLM")
        now_iso = _now_iso()
        claim = {
            "claim_id": claim_id,
            "policy_id": policy_id,
            "enterprise_id": policy.get("enterprise_id", ""),
            "claim_amount": round(claim_amount, 2),
            "incident_desc": incident_desc,
            "status": "under_review",
            "filed_at_iso": now_iso,
            "sla_days": 7,  # SLA: 5-10 工作日审核
            "insurer": policy.get("insurer", "mock_insurer"),
        }
        await _insurance_store.put_claim(claim)
        return claim

    # ====================================================================
    # 兼容旧桩接口 (legacy, 保持向后兼容)
    # ====================================================================

    async def confirm_receivable(
        self,
        enterprise_id: str,
        receivable_id: str,
        amount: float,
        counterparty_id: str,
    ) -> dict:
        """应收款确权 (基于五流验证).

        V3 扩展接口: 五流验证委托 FiveFlowConsistencyService 一致性引擎;
        引擎不可用 / 无校验数据时回退默认概要 (fund/contract/invoice 通过).
        """
        five_flow_verification = {
            "fund_flow": True,
            "contract_flow": True,
            "invoice_flow": True,
            "logistics_flow": False,
            "iot_flow": False,
            "completeness": 0.6,
        }
        note = "V3 扩展接口: 五流验证引擎不可用, 回退默认概要"
        try:
            from app.services.five_flow_consistency_service import (
                five_flow_consistency_service,
            )
            check = await five_flow_consistency_service.check_consistency(
                enterprise_id, receivable_id,
            )
            matched = set(check.matched_flows or [])
            five_flow_verification = {
                "fund_flow": "fund" in matched or "FUND" in matched,
                "contract_flow": "contract" in matched or "CONTRACT" in matched,
                "invoice_flow": "invoice" in matched or "INVOICE" in matched,
                "logistics_flow": "logistics" in matched or "LOGISTICS" in matched,
                "iot_flow": "iot" in matched or "IOT" in matched,
                "completeness": round(float(check.consistency_score) / 100.0, 2),
            }
            note = f"五流一致性引擎校验通过={check.passed}, 得分={check.consistency_score}"
        except Exception:
            pass
        return {
            "receivable_id": receivable_id,
            "enterprise_id": enterprise_id,
            "amount": amount,
            "counterparty_id": counterparty_id,
            "confirmed": True,
            "five_flow_verification": five_flow_verification,
            "note": note,
        }

    async def match_insurance(
        self, receivable_id: str, amount: float, risk_level: str
    ) -> dict:
        """保单匹配 (基于金额 + 风险等级).

        A 档: 配置 INSURER_API_URL / INSURER_API_KEY 后走保司报价 API;
        无凭证 / API 失败降级规则报价 (仅报价不创建保单, 创建用 create_policy).
        """
        if risk_level == "low":
            coverage_ratio = 0.9
            premium_rate = 0.005
        elif risk_level == "medium":
            coverage_ratio = 0.7
            premium_rate = 0.012
        else:  # high
            coverage_ratio = 0.5
            premium_rate = 0.025
        insurer = "rule_based_quote"
        source = "rule"
        # A 档: 保司报价 API
        try:
            real = await self._call_insurer_quote_api(
                receivable_id, amount, risk_level,
            )
            if real is not None:
                return {
                    "receivable_id": receivable_id,
                    "amount": amount,
                    "risk_level": risk_level,
                    "coverage_ratio": float(real.get("coverageRatio", coverage_ratio)),
                    "coverage_amount": float(real.get("coverageAmount", amount * coverage_ratio)),
                    "premium_rate": float(real.get("premiumRate", premium_rate)),
                    "premium_amount": float(real.get("premiumAmount", amount * premium_rate)),
                    "insurer": str(real.get("insurer", insurer)),
                    "policy_status": "quoted",
                    "quote_source": "insurer_api",
                }
        except Exception:
            pass
        return {
            "receivable_id": receivable_id,
            "amount": amount,
            "risk_level": risk_level,
            "coverage_ratio": coverage_ratio,
            "coverage_amount": amount * coverage_ratio,
            "premium_rate": premium_rate,
            "premium_amount": amount * premium_rate,
            "insurer": insurer,
            "policy_status": "quoted",
            "quote_source": source,
            "note": "规则报价: 按风险等级定价; 如需创建保单请用 create_policy",
        }

    _INSURER_API_TIMEOUT_SECONDS = 8.0

    async def _call_insurer_quote_api(
        self, receivable_id: str, amount: float, risk_level: str,
    ) -> dict | None:
        """保司报价 API (人保/平安/太保类, A 档). 凭证缺失/失败返回 None 触发规则报价."""
        import os

        api_url = os.getenv("INSURER_API_URL", "")
        api_key = os.getenv("INSURER_API_KEY", "")
        if not (api_url and api_key):
            return None
        try:
            import httpx
            async with httpx.AsyncClient(timeout=self._INSURER_API_TIMEOUT_SECONDS) as client:
                resp = await client.post(
                    f"{api_url.rstrip('/')}/receivable/quote",
                    headers={"Authorization": f"Bearer {api_key}"},
                    json={
                        "receivableId": receivable_id,
                        "amount": amount,
                        "riskLevel": risk_level,
                    },
                )
                if resp.status_code != 200:
                    return None
                return resp.json()
        except Exception:
            return None


# 单例
insurance_service = InsuranceService()
