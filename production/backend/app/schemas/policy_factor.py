"""文件名：policy_factor.py 职责：政策与行业因素 Pydantic 模型,定义因素类型枚举与企业政策分析 schema."""
from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.schemas.common import Id, IsoTimestamp, Ratio


class FactorType(str, Enum):
    INDUSTRY = "industry"
    POLICY = "policy"
    SEASONAL = "seasonal"
    RESTRICTION = "restriction"


class _PolicyBase(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        alias_generator=to_camel,
        use_enum_values=True,
    )


class PolicyFactor(_PolicyBase):
    id: Id
    name: str
    factor_type: FactorType
    applies_to_uscc_prefixes: list[str] = Field(default_factory=list)
    pct_impact_odds: float = Field(ge=-1.0, le=1.0)
    effective_from_iso: IsoTimestamp
    effective_to_iso: IsoTimestamp
    notes: str = ""


class MatchedFactor(_PolicyBase):
    enterprise_id: Id
    factor_id: Id
    factor: PolicyFactor
    hit_reason: str
    matched_weight: float = Field(ge=0.0, le=1.0)


class EnterprisePolicyAnalysis(_PolicyBase):
    enterprise_id: Id
    matched: list[MatchedFactor] = Field(default_factory=list)
    overall_adjustment: float = Field(ge=-1.0, le=1.0)
    bank_seasonal_reminders: list[str] = Field(default_factory=list)
