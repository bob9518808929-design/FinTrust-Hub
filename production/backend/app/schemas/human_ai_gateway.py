"""人机协同网关 schemas (CORE-02 R1.5).

审批工作流: 串行 SERIAL / 并行 PARALLEL / AnyOne 短路.
状态: PENDING / APPROVED / REJECTED / ESCALATED / TIMEOUT_OVERRIDE / DELEGATED.

字段命名: snake_case (PEP 8), alias_generator=to_camel 自动转 camelCase.
"""

from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.schemas.common import AmountInCents, ApiResult, Id, IsoTimestamp


ApproverRole = Literal[
    "loan_officer", "risk_manager", "branch_manager", "cfo", "auditor"
]


class ApprovalStatus(str, Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    ESCALATED = "ESCALATED"
    TIMEOUT_OVERRIDE = "TIMEOUT_OVERRIDE"
    DELEGATED = "DELEGATED"


class ApprovalPriority(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    URGENT = "URGENT"


class WorkflowType(str, Enum):
    SERIAL = "SERIAL"
    PARALLEL = "PARALLEL"
    ANY_ONE = "ANY_ONE"


class _HumanAIBase(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        alias_generator=to_camel,
        use_enum_values=True,
    )


class ApproverSlot(_HumanAIBase):
    role: ApproverRole
    min_level: int = Field(default=1, ge=1)
    required: bool = Field(default=True)


class WorkflowRule(_HumanAIBase):
    id: Id
    name: str = Field(default="")
    type: WorkflowType
    approvers: list[ApproverSlot]
    timeout_hours: int = Field(default=24, ge=1)
    escalation_role: ApproverRole


class ApprovalRecord(_HumanAIBase):
    task_id: Id
    step: int = Field(ge=0)
    approver_id: Id
    approver_role: ApproverRole
    decision: Literal["approve", "reject"]
    comment: str = Field(default="")
    decided_at: IsoTimestamp
    delegated_from_role: ApproverRole | None = Field(default=None)
    proxy_used: bool = Field(default=False)


class ApprovalTask(_HumanAIBase):
    task_id: Id
    workflow_id: Id
    execution_ref_id: Id = Field(default="")
    enterprise_id: Id
    title: str
    summary: str = Field(default="")
    amount_cents: AmountInCents
    priority: ApprovalPriority
    deadline_iso: IsoTimestamp
    current_step: int = Field(default=0, ge=0)
    status: ApprovalStatus
    approvals: list[ApprovalRecord] = Field(default_factory=list)
    required_approvals: list[ApproverSlot] = Field(default_factory=list)
    escalation_role: ApproverRole
    escalation_triggered: bool = Field(default=False)
    created_at: IsoTimestamp = Field(
        default_factory=lambda: __import__("datetime").datetime.now(
            __import__("datetime").timezone.utc
        ).isoformat()
    )


class CreateApprovalRequest(_HumanAIBase):
    title: str
    summary: str = Field(default="")
    amount_cents: AmountInCents
    priority: ApprovalPriority = ApprovalPriority.MEDIUM
    enterprise_id: Id
    execution_ref_id: Id = Field(default="")
    workflow_rule_id: Id
    deadline_hours: int = Field(default=24, ge=1)


class ApproveRequest(_HumanAIBase):
    task_id: Id
    approver_id: Id
    approver_role: ApproverRole
    decision: Literal["approve", "reject"]
    comment: str = Field(default="")
    delegated_from_role: ApproverRole | None = Field(default=None)
    proxy: bool = Field(default=False)


class HumanRoutingDecision(_HumanAIBase):
    task_id: Id | None = Field(default=None)
    routed_to: str
    reason: str
    autonomy_level: Literal["L1", "L2", "L3", "L4"]
    pending_steps: int = Field(default=0, ge=0)
    escalated: bool = Field(default=False)


class RouteFromAIRequest(_HumanAIBase):
    autonomy_level: Literal["L1", "L2", "L3", "L4"]
    execution_ref_id: Id = Field(default="")
    amount_cents: AmountInCents
    title: str
    summary: str = Field(default="")
    enterprise_id: Id


class DelegateRequest(_HumanAIBase):
    from_role: ApproverRole
    to_role: ApproverRole
    approver_id: Id


class EscalateRequest(_HumanAIBase):
    reason: str = Field(default="")


__all__ = [
    "ApprovalStatus",
    "ApprovalPriority",
    "WorkflowType",
    "ApproverRole",
    "ApproverSlot",
    "WorkflowRule",
    "ApprovalRecord",
    "ApprovalTask",
    "CreateApprovalRequest",
    "ApproveRequest",
    "HumanRoutingDecision",
    "RouteFromAIRequest",
    "DelegateRequest",
    "EscalateRequest",
    "ApiResult",
    "Id",
    "IsoTimestamp",
    "AmountInCents",
]
