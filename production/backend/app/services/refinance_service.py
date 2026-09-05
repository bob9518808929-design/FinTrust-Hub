from __future__ import annotations

import asyncio
import random
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from app.schemas.refinance import (
    AIRecommendation,
    CashflowForecast,
    GapSizeLabel,
    RefinanceEntrance,
    RefinanceSubmission,
    SubmissionStatus,
)


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _id(prefix: str) -> str:
    return f"{prefix}-{uuid4().hex[:12]}"


def _month_iso(year: int, month: int) -> str:
    return f"{year:04d}-{month:02d}"


class _RefiStore:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._forecasts: dict[str, list[dict]] = {}
        self._submissions: list[dict] = []
        self._seed()

    def _seed(self) -> None:
        now = datetime.now(UTC)
        base_inflow = {
            "E001": 5_000_000_00,  # 500 万/月 (分)
            "E002": 8_000_000_00,  # 800 万
            "E003": 3_000_000_00,  # 300 万
            "E004": 6_000_000_00,  # 600 万
        }
        base_outflow = {
            "E001": 3_200_000_00,
            "E002": 5_000_000_00,
            "E003": 2_800_000_00,
            "E004": 5_800_000_00,
        }
        for eid in ["E001", "E002", "E003", "E004"]:
            forecast: list[dict] = []
            cumulative = 0
            for m in range(6):
                year = now.year
                month = now.month + m
                if month > 12:
                    year += 1
                    month -= 12
                drift = (m + 1) * 0.05
                inflow = int(base_inflow[eid] * (1 + drift * random.choice([-1, 0, 1])))
                outflow = int(base_outflow[eid] * (1 + drift * 0.8))
                if eid == "E004" and m >= 3:
                    outflow = int(base_outflow[eid] * 1.8)
                gap = inflow - outflow
                cumulative += gap
                forecast.append({
                    "enterpriseId": eid,
                    "monthIso": _month_iso(year, month),
                    "projectedInflowCents": inflow,
                    "projectedOutflowCents": outflow,
                    "gapCents": gap,
                    "cumulativeGapCents": cumulative,
                })
            self._forecasts[eid] = forecast

    async def get_forecast(self, eid: str, months: int = 6) -> list[dict]:
        async with self._lock:
            f = self._forecasts.get(eid, [])
            return [dict(x) for x in f[:months]]

    async def add_submission(self, sub: dict) -> dict:
        async with self._lock:
            self._submissions.append(dict(sub))
            return dict(sub)


_refi_store = _RefiStore()


class RefinanceService:
    def __init__(self, db: Any | None = None) -> None:
        self.db = db

    async def forecast_cashflow(
        self, enterprise_id: str, months: int = 6,
    ) -> list[CashflowForecast]:
        items = await _refi_store.get_forecast(enterprise_id, months)
        if not items:
            now = datetime.now(UTC)
            items = []
            cumulative = 0
            for m in range(months):
                year = now.year
                month = now.month + m
                if month > 12:
                    year += 1
                    month -= 12
                inflow = random.randint(2_000_000_00, 10_000_000_00)
                outflow = random.randint(1_800_000_00, 9_500_000_00)
                gap = inflow - outflow
                cumulative += gap
                items.append({
                    "enterpriseId": enterprise_id,
                    "monthIso": _month_iso(year, month),
                    "projectedInflowCents": inflow,
                    "projectedOutflowCents": outflow,
                    "gapCents": gap,
                    "cumulativeGapCents": cumulative,
                })
        return [CashflowForecast.model_validate(x) for x in items]

    async def compute_entrance(self, enterprise_id: str) -> RefinanceEntrance:
        forecast = await self.forecast_cashflow(enterprise_id, months=6)
        total_inflow = sum(f.projected_inflow_cents for f in forecast)
        min_cum_gap = min(f.cumulative_gap_cents for f in forecast)
        if total_inflow <= 0:
            gap_ratio = 0.0
        else:
            gap_ratio = abs(min_cum_gap) / total_inflow if min_cum_gap < 0 else 0.0

        if gap_ratio > 0.30:
            label = GapSizeLabel.LARGE
        elif gap_ratio > 0.10:
            label = GapSizeLabel.MEDIUM
        else:
            label = GapSizeLabel.SMALL

        eligible = min_cum_gap < 0 or gap_ratio > 0.05
        schemes: list[str] = []
        if label == GapSizeLabel.LARGE:
            schemes = ["再贴现+保理ABS组合", "税务贷+同业存单", "引入担保公司增信"]
        elif label == GapSizeLabel.MEDIUM:
            schemes = ["再贴现产品", "税务贷线上秒批", "保理融资"]
        else:
            schemes = ["循环额度备用", "理财优化闲置资金"]

        return RefinanceEntrance(
            enterprise_id=enterprise_id,
            eligible=eligible,
            gap_size_label=label,
            suggested_schemes=schemes,
        )

    async def ai_recommend(
        self, enterprise_id: str, use_llm: bool = True,
    ) -> list[AIRecommendation]:
        entrance = await self.compute_entrance(enterprise_id)
        recs: list[AIRecommendation] = []

        base = {
            GapSizeLabel.LARGE: (5_000_000_00, 4.8, 12),
            GapSizeLabel.MEDIUM: (3_000_000_00, 4.2, 6),
            GapSizeLabel.SMALL: (1_000_000_00, 3.8, 3),
        }
        amount, rate, term = base[entrance.gap_size_label]

        recs.append(AIRecommendation(
            rec_id=_id("REC"),
            product_name="央行再贴现专项",
            lender="中国人民银行再贷款",
            amount_cents=amount,
            annual_rate_pct=max(2.0, rate - 1.8),
            term_months=term,
            expected_approval_prob=0.85,
            total_cost_cents=int(amount * (rate - 1.8) / 100 * term / 12),
            reasons=["银行承兑汇票持有量达标", "属于普惠小微口径", "再贴现额度充裕"],
        ))
        recs.append(AIRecommendation(
            rec_id=_id("REC"),
            product_name="同业存单质押",
            lender="同业资金市场",
            amount_cents=int(amount * 0.8),
            annual_rate_pct=rate - 0.3,
            term_months=max(1, term - 3),
            expected_approval_prob=0.92,
            total_cost_cents=int(amount * 0.8 * (rate - 0.3) / 100 * max(1, term - 3) / 12),
            reasons=["持有同业资产可质押", "T+0 快速放款", "利率随行就市较低"],
        ))
        recs.append(AIRecommendation(
            rec_id=_id("REC"),
            product_name="应收账款保理 ABS",
            lender="保理公司+资产支持专项计划",
            amount_cents=int(amount * 1.2),
            annual_rate_pct=rate + 1.2,
            term_months=term + 6,
            expected_approval_prob=0.65,
            total_cost_cents=int(amount * 1.2 * (rate + 1.2) / 100 * (term + 6) / 12),
            reasons=["应收账款池规模达标", "债务人信用等级 A 以上", "ABS 发行窗口近期开启"],
        ))
        recs.append(AIRecommendation(
            rec_id=_id("REC"),
            product_name="银税互动税务贷",
            lender="杭州银行/招商银行",
            amount_cents=amount,
            annual_rate_pct=rate + 0.5,
            term_months=term,
            expected_approval_prob=0.88,
            total_cost_cents=int(amount * (rate + 0.5) / 100 * term / 12),
            reasons=["近 2 年纳税信用等级 B 以上", "年纳税额 >50 万", "纯信用线上秒批"],
        ))
        return recs

    async def submit(
        self, enterprise_id: str, rec_id: str,
    ) -> RefinanceSubmission:
        sub = {
            "enterpriseId": enterprise_id,
            "recId": rec_id,
            "status": SubmissionStatus.SUBMITTED.value,
            "createdAt": _now_iso(),
        }
        await _refi_store.add_submission(sub)
        return RefinanceSubmission.model_validate(sub)


refinance_service = RefinanceService(db=None)
