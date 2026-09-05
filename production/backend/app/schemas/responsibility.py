"""文件名：responsibility.py 职责：人流责任链 Pydantic 模型,定义 R0-R4 阶段枚举、责任链与行为挖掘记录 schema."""
from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.schemas.common import Id, IsoTimestamp, Ratio


class ChainStage(str, Enum):
    R0_NONE = "R0_NONE"
    R1_INFO = "R1_INFO"
    R2_VERIFIED = "R2_VERIFIED"
    R3_INCENTIVIZED = "R3_INCENTIVIZED"
    R4_OPTIMIZED = "R4_OPTIMIZED"


class _RespBase(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        alias_generator=to_camel,
        use_enum_values=True,
    )


class PersonFlowRole(_RespBase):
    role_id: Id
    role_name: str
    enterprise_id: Id
    person_id: Id
    person_name: str
    department: str = ""
    authorized_actions: list[str] = Field(default_factory=list)


class ResponsibilityChain(_RespBase):
    chain_id: Id
    enterprise_id: Id
    stage: ChainStage
    roles: list[PersonFlowRole] = Field(default_factory=list)
    completeness_pct: float = Field(ge=0.0, le=100.0)
    missing_roles: list[str] = Field(default_factory=list)
    integrity_score: float = Field(ge=0.0, le=100.0)


class BehaviorMiningRecord(_RespBase):
    record_id: Id
    enterprise_id: Id
    person_id: Id
    action: str
    weight: float = Field(ge=0.0, le=1.0)
    points_awarded: int = Field(ge=0)
    action_time_iso: IsoTimestamp
    linked_tx_id: Optional[Id] = None


class ResponsibilityResult(_RespBase):
    chain_id: Id
    enterprise_id: Id
    integrity_delta: float
    mining_summary: str
