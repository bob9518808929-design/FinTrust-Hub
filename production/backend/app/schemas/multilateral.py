"""MOD-13 多方协作 schemas (R5.8).

电子签章 + 协作任务 + SLA 指标.

字段命名: snake_case (PEP 8), 通过 alias_generator 自动转 camelCase.
"""

from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.schemas.common import Id, IsoTimestamp


# === 枚举 ===

SealType = Literal["enterprise", "legal_representative", "finance", "contract"]
SealStatus = Literal["active", "revoked", "expired"]
TaskStatus = Literal["pending", "in_progress", "completed", "breached", "cancelled"]


class _MultiBase(BaseModel):
    """多方协作 schema 公共配置."""
    model_config = ConfigDict(
        populate_by_name=True,
        alias_generator=to_camel,
        use_enum_values=True,
    )


# === 电子签章 ===

class ElectronicSeal(_MultiBase):
    """电子签章 (对接 e签宝 / 法大大 SDK)."""
    seal_id: Id = Field(description="签章 ID")
    enterprise_id: Id = Field(description="所属企业 ID")
    seal_type: SealType = Field(description="签章类型")
    signatory_name: str = Field(description="签名人姓名")
    certificate_no: str = Field(description="证书编号")
    valid_from_iso: IsoTimestamp = Field(description="生效时间")
    valid_to_iso: IsoTimestamp = Field(description="失效时间")
    status: SealStatus = Field(default="active", description="状态")
    created_at_iso: IsoTimestamp = Field(description="创建时间")


# === 协作任务 ===

class CollaborationTask(_MultiBase):
    """协作任务 (含 SLA 截止时间)."""
    task_id: Id = Field(description="任务 ID")
    enterprise_id: Id = Field(description="企业 ID")
    title: str = Field(description="任务标题")
    assignee_roles: list[str] = Field(
        default_factory=list, description="负责人角色列表"
    )
    sla_deadline_iso: IsoTimestamp = Field(description="SLA 截止时间")
    status: TaskStatus = Field(default="pending", description="任务状态")
    sign_progress: list[dict] = Field(
        default_factory=list,
        description="签章进度 [{seal_id, document_hash, signed_at_iso}]",
    )
    created_at_iso: IsoTimestamp = Field(description="创建时间")
    completed_at_iso: IsoTimestamp | None = Field(
        default=None, description="完成时间"
    )


# === SLA 指标 ===

class SLAMetric(_MultiBase):
    """SLA 指标 (单任务是否超期 + 超期时长)."""
    task_id: Id = Field(description="任务 ID")
    sla_deadline_iso: IsoTimestamp = Field(description="SLA 截止时间")
    actual_completion_iso: IsoTimestamp | None = Field(
        default=None, description="实际完成时间 (未完成为 None)"
    )
    is_breached: bool = Field(description="是否超期")
    breach_duration_hours: float = Field(
        default=0.0, ge=0.0, description="超期时长 (小时)"
    )


__all__ = [
    "SealType",
    "SealStatus",
    "TaskStatus",
    "ElectronicSeal",
    "CollaborationTask",
    "SLAMetric",
]
