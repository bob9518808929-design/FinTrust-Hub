"""文件名：cooperation.py 职责：合作模式 Pydantic 模型,定义 4 种合作模式枚举、模式配置与切换结果 schema."""
from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.schemas.common import Id, Ratio


class CooperationMode(str, Enum):
    FULL_TRUST = "FULL_TRUST"
    CO_LENDING = "CO_LENDING"
    GUARANTEED = "GUARANTEED"
    INSURED = "INSURED"


class _CoopBase(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        alias_generator=to_camel,
        use_enum_values=True,
    )


class ModeConfig(_CoopBase):
    mode: CooperationMode
    interest_split_pct_bank: float = Field(ge=0.0, le=100.0, description="银行利息分成%")
    risk_share_pct_bank: float = Field(ge=0.0, le=100.0, description="银行风险分担%")
    required_modules: list[str] = Field(default_factory=list)
    permission_matrix: dict[str, list[str]] = Field(default_factory=dict)
    description: str = ""


class SwitchResult(_CoopBase):
    previous_mode: CooperationMode
    current_mode: CooperationMode
    changed_permissions: list[str] = Field(default_factory=list)
    affected_partners: list[str] = Field(default_factory=list)
