from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any

from app.schemas.policy_factor import (
    EnterprisePolicyAnalysis,
    FactorType,
    MatchedFactor,
    PolicyFactor,
)


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


class _PolicyStore:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._factors: list[dict] = []
        self._seed()

    def _seed(self) -> None:
        now = datetime.now(UTC)
        from_iso = (now.replace(year=now.year - 1)).isoformat()
        to_iso = (now.replace(year=now.year + 2)).isoformat()
        factors = [
            {
                "id": "F001", "name": "房地产行业限制授信",
                "factorType": FactorType.RESTRICTION.value,
                "appliesToUsccPrefixes": ["9111000070", "9131000059"],
                "pctImpactOdds": -0.35,
                "effectiveFromIso": from_iso, "effectiveToIso": to_iso,
                "notes": "三道红线房企授信集中度限制, PD +35%",
            },
            {
                "id": "F002", "name": "高新技术企业鼓励政策",
                "factorType": FactorType.POLICY.value,
                "appliesToUsccPrefixes": ["91110000MA0", "9133000056"],
                "pctImpactOdds": 0.25,
                "effectiveFromIso": from_iso, "effectiveToIso": to_iso,
                "notes": "专精特新高企可享受利率优惠与额度加成",
            },
            {
                "id": "F003", "name": "新能源产业链补贴",
                "factorType": FactorType.INDUSTRY.value,
                "appliesToUsccPrefixes": ["9144000045", "9132000082"],
                "pctImpactOdds": 0.30,
                "effectiveFromIso": from_iso, "effectiveToIso": to_iso,
                "notes": "新能源车/光伏产业链企业享受补贴贴息",
            },
            {
                "id": "F004", "name": "小微企业扶持政策",
                "factorType": FactorType.POLICY.value,
                "appliesToUsccPrefixes": ["91"],
                "pctImpactOdds": 0.15,
                "effectiveFromIso": from_iso, "effectiveToIso": to_iso,
                "notes": "普惠小微首贷户贴息与风险补偿",
            },
            {
                "id": "F005", "name": "银行 Q1 冲量投放",
                "factorType": FactorType.SEASONAL.value,
                "appliesToUsccPrefixes": [],
                "pctImpactOdds": 0.10,
                "effectiveFromIso": from_iso, "effectiveToIso": to_iso,
                "notes": "1-3月银行开门红, 额度宽松审批加速",
            },
            {
                "id": "F006", "name": "Q4 回款旺季压降",
                "factorType": FactorType.SEASONAL.value,
                "appliesToUsccPrefixes": [],
                "pctImpactOdds": -0.10,
                "effectiveFromIso": from_iso, "effectiveToIso": to_iso,
                "notes": "10-12月银行年底回款考核, 新增授信偏谨慎",
            },
            {
                "id": "F007", "name": "环保双碳限制行业",
                "factorType": FactorType.RESTRICTION.value,
                "appliesToUsccPrefixes": ["9114000011", "9137000033"],
                "pctImpactOdds": -0.25,
                "effectiveFromIso": from_iso, "effectiveToIso": to_iso,
                "notes": "高耗能高排放行业新增授信需 ESG 评估",
            },
            {
                "id": "F008", "name": "半导体国产替代鼓励",
                "factorType": FactorType.INDUSTRY.value,
                "appliesToUsccPrefixes": ["9131000061", "9132000055"],
                "pctImpactOdds": 0.35,
                "effectiveFromIso": from_iso, "effectiveToIso": to_iso,
                "notes": "芯片设计/制造/封测产业链专项再贷款支持",
            },
        ]
        self._factors = factors

    async def list_factors(self) -> list[dict]:
        async with self._lock:
            return [dict(f) for f in self._factors]


_policy_store = _PolicyStore()

_ENTERPRISE_META: dict[str, dict] = {
    "E001": {"name": "宏达精密制造", "usccPrefix": "9133000056", "industry": "manufacturing"},
    "E002": {"name": "智芯科技", "usccPrefix": "9131000061", "industry": "high_tech"},
    "E003": {"name": "鑫达贸易", "usccPrefix": "9111000070", "industry": "trade"},
    "E004": {"name": "绿能新材", "usccPrefix": "9132000082", "industry": "new_energy"},
}


class PolicyFactorService:
    def __init__(self, db: Any | None = None) -> None:
        self.db = db

    async def list_factors(self) -> list[PolicyFactor]:
        items = await _policy_store.list_factors()
        return [PolicyFactor.model_validate(f) for f in items]

    async def analyze_enterprise(
        self,
        enterprise_id: str,
        enterprise_info: dict | None = None,
    ) -> EnterprisePolicyAnalysis:
        meta = enterprise_info or _ENTERPRISE_META.get(enterprise_id, {
            "name": f"企业{enterprise_id}",
            "usccPrefix": "91",
            "industry": "general",
        })
        uscc_prefix = meta.get("usccPrefix", "91")
        industry = meta.get("industry", "general")
        now = datetime.now(UTC)
        month = now.month

        all_factors = await self.list_factors()
        matched: list[MatchedFactor] = []
        total_weight = 0.0
        weighted_impact = 0.0

        for f in all_factors:
            hit = False
            reason = ""
            weight = 0.5
            applies = f.applies_to_uscc_prefixes
            if f.factor_type == FactorType.SEASONAL:
                if f.id == "F005" and month in (1, 2, 3):
                    hit = True
                    reason = f"当前月份 {month} 月属于银行 Q1 冲量期"
                    weight = 1.0
                elif f.id == "F006" and month in (10, 11, 12):
                    hit = True
                    reason = f"当前月份 {month} 月属于 Q4 回款旺季"
                    weight = 1.0
                else:
                    continue
            else:
                if not applies:
                    hit = True
                    reason = "普惠性政策, 全量覆盖"
                    weight = 0.6
                else:
                    for p in applies:
                        if uscc_prefix.startswith(p) or p.startswith(uscc_prefix[:len(p)]):
                            hit = True
                            reason = f"企业 USCC 前缀 {uscc_prefix} 匹配 {p}"
                            weight = 0.9
                            break
                    if not hit:
                        if (f.id == "F002" and industry == "high_tech") or \
                           (f.id == "F003" and industry == "new_energy") or \
                           (f.id == "F008" and industry in ("high_tech", "semiconductor")):
                            hit = True
                            reason = f"企业行业 {industry} 匹配 {f.name}"
                            weight = 0.85
                        elif f.id == "F004" and industry in ("trade", "manufacturing"):
                            hit = True
                            reason = "小微企业扶持政策, 符合行业判定"
                            weight = 0.7

            if hit:
                matched.append(MatchedFactor(
                    enterprise_id=enterprise_id,
                    factor_id=f.id,
                    factor=f,
                    hit_reason=reason,
                    matched_weight=weight,
                ))
                weighted_impact += f.pct_impact_odds * weight
                total_weight += weight

        overall = round(weighted_impact / max(0.01, total_weight), 3) if total_weight > 0 else 0.0
        overall = max(-1.0, min(1.0, overall))

        reminders: list[str] = []
        if month in (1, 2, 3):
            reminders.append("当前为银行 Q1 开门红冲量期, 额度充足审批快, 建议抓紧提款")
        if month in (10, 11, 12):
            reminders.append("Q4 银行集中回款, 新增授信审批趋严, 建议提前备料")
        if overall < -0.1:
            reminders.append("命中限制性政策, 建议补充增信措施或调整授信方案")
        if overall > 0.1:
            reminders.append("命中鼓励类政策, 可申请利率优惠与专项额度加成")

        return EnterprisePolicyAnalysis(
            enterprise_id=enterprise_id,
            matched=matched,
            overall_adjustment=overall,
            bank_seasonal_reminders=reminders,
        )


policy_factor_service = PolicyFactorService(db=None)
