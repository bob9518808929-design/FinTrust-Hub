"""文件名：refinance.py 职责：再融资 Pydantic 模型,定义缺口标签、提交状态、现金流预测与 AI 推荐 schema."""
from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.schemas.common import AmountInCents, Id, IsoTimestamp, Ratio


class GapSizeLabel(str, Enum):
    SMALL = "small"
    MEDIUM = "medium"
    LARGE = "large"


class SubmissionStatus(str, Enum):
    DRAFT = "draft"
    SUBMITTED = "submitted"
    PENDING_APPROVAL = "pending_approval"
    APPROVED = "approved"
    REJECTED = "rejected"


class _RefiBase(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        alias_generator=to_camel,
        use_enum_values=True,
    )


class CashflowForecast(_RefiBase):
    enterprise_id: Id
    month_iso: str
    projected_inflow_cents: AmountInCents
    projected_outflow_cents: AmountInCents
    gap_cents: int
    cumulative_gap_cents: int


class RefinanceEntrance(_RefiBase):
    enterprise_id: Id
    eligible: bool
    gap_size_label: GapSizeLabel
    suggested_schemes: list[str] = Field(default_factory=list)


class AIRecommendation(_RefiBase):
    rec_id: Id
    product_name: str
    lender: str
    amount_cents: AmountInCents
    annual_rate_pct: float = Field(ge=0.0)
    term_months: int = Field(ge=1)
    expected_approval_prob: float = Field(ge=0.0, le=1.0)
    total_cost_cents: AmountInCents
    reasons: list[str] = Field(default_factory=list)


class RefinanceSubmission(_RefiBase):
    enterprise_id: Id
    rec_id: Id
    status: SubmissionStatus
    created_at: IsoTimestamp
