"""评分卡 + 改造状态 schemas (镜像 contracts/scorecard.ts)."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import AmountInCents, Id, IsoTimestamp, Ratio, Score
from app.schemas.enterprise import AutonomyLevel, ReformLevel

ScorecardDimension = Literal[
    "subject", "finance", "tax", "business", "assets", "credit", "policy", "capital",
]


class Scorecard8D(BaseModel):
    """8 维评分卡."""

    model_config = ConfigDict(populate_by_name=True)

    subject: Score
    finance: Score
    tax: Score
    business: Score
    assets: Score
    credit: Score
    policy: Score
    capital: Score


class GapItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    dimension: ScorecardDimension
    current: Score
    target: Score
    delta: int
    severity: Literal["low", "medium", "high", "critical"]
    suggested_actions: list[str] = Field(alias="suggestedActions", default_factory=list)
    estimated_days: int = Field(alias="estimatedDays")
    estimated_cost: AmountInCents = Field(alias="estimatedCost")


ReformActionStatus = Literal["pending", "executing", "completed", "blocked", "failed"]
ComplianceLevel = Literal["green", "yellow", "red", "pending"]


class ReformActionRef(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    action_id: Id = Field(alias="actionId")
    name: str
    completed_at: IsoTimestamp = Field(alias="completedAt")


class ReformAction(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    id: Id
    phase_id: Id = Field(alias="phaseId")
    name: str
    description: str = ""
    dimension: ScorecardDimension
    engine: str
    status: ReformActionStatus = "pending"
    started_at: IsoTimestamp | None = Field(alias="startedAt", default=None)
    completed_at: IsoTimestamp | None = Field(alias="completedAt", default=None)
    result: str | None = None
    cost: AmountInCents | None = None
    evidence: list[str] = Field(default_factory=list, description="子引擎执行产物证据 (账户/交易哈希/报告编号)")
    autonomy_level: AutonomyLevel = Field(alias="autonomyLevel")
    compliance_check: ComplianceLevel = Field(alias="complianceCheck", default="pending")


ReformPhaseStatus = Literal["pending", "executing", "completed", "blocked", "failed"]


class ReformPhase(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    id: Id
    name: str
    description: str = ""
    weight: Ratio
    progress: Ratio = 0.0
    dimension: ScorecardDimension
    status: ReformPhaseStatus = "pending"
    estimated_days: int = Field(alias="estimatedDays")
    actual_days: int | None = Field(alias="actualDays", default=None)
    cost: AmountInCents | None = None
    engine: str
    autonomy_level: AutonomyLevel = Field(alias="autonomyLevel")
    actions: list[ReformAction] | None = None


ReformStatus = Literal["idle", "in_progress", "paused", "abandoned", "completed"]
AggressionLevel = Literal["conservative", "balanced", "innovative"]


class ReformState(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    enterprise_id: Id = Field(alias="enterpriseId")
    status: ReformStatus = "idle"
    progress: Ratio = 0.0
    current_level: ReformLevel = Field(alias="currentLevel")
    target_level: ReformLevel = Field(alias="targetLevel")
    aggression_level: AggressionLevel = Field(alias="aggressionLevel")
    started_at: IsoTimestamp | None = Field(alias="startedAt", default=None)
    completed_at: IsoTimestamp | None = Field(alias="completedAt", default=None)
    plan_id: Id | None = Field(alias="planId", default=None)
    scorecard: dict  # { current: Scorecard8D, target?: Scorecard8D }
    phases: list[ReformPhase] | None = None
    completed_actions: list[ReformAction] | None = Field(alias="completedActions", default=None)


class ReformTrigger(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    kind: Literal[
        "action_failed", "action_blocked", "monthly_data_update",
        "policy_change", "enterprise_request", "external_event",
    ]
    source: str
    message: str
    occurred_at: IsoTimestamp = Field(alias="occurredAt")
    affected_dimension: ScorecardDimension | None = Field(alias="affectedDimension", default=None)
    evidence: list[str] | None = None


class ReformContext(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    state: ReformState
    enterprise_id: Id = Field(alias="enterpriseId")
    budget_limit: AmountInCents = Field(alias="budgetLimit")
    tier: Literal["tier1", "tier2"]
    audit_user: Id | None = Field(alias="auditUser", default=None)


class ReformActionResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    action_id: Id = Field(alias="actionId")
    success: bool
    status: ReformActionStatus
    result: str | None = None
    cost: AmountInCents | None = None
    duration_ms: int = Field(alias="durationMs")
    evidence: list[str] = Field(default_factory=list)
    next_action_id: Id | None = Field(alias="nextActionId", default=None)


class ReformImpact(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    delta_progress: Ratio = Field(alias="deltaProgress")
    delta_cost: AmountInCents = Field(alias="deltaCost")
    delta_days: int = Field(alias="deltaDays")
    affected_phases: list[Id] = Field(alias="affectedPhases", default_factory=list)
    risk_level: Literal["low", "medium", "high", "critical"] = Field(alias="riskLevel")


class ReformReplanResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    new_phases: list[ReformPhase] = Field(alias="newPhases")
    impact: ReformImpact
    replan_reason: str = Field(alias="replanReason")


class ComplianceCheckResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    level: ComplianceLevel
    rule_id: Id = Field(alias="ruleId")
    rule_text: str = Field(alias="ruleText")
    evidence: list[str] = Field(default_factory=list)
    suggested_action: str | None = Field(alias="suggestedAction", default=None)
    legal_basis: str | None = Field(alias="legalBasis", default=None)
    checked_at: IsoTimestamp = Field(alias="checkedAt")


class Milestone(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    id: Id
    name: str
    planned_date: IsoTimestamp = Field(alias="plannedDate")
    actual_date: IsoTimestamp | None = Field(alias="actualDate", default=None)
    status: Literal["pending", "achieved", "missed", "at_risk"]
    phase_id: Id | None = Field(alias="phaseId", default=None)


class Alert(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    id: Id
    severity: Literal["info", "warning", "error", "critical"]
    kind: str
    message: str
    phase_id: Id | None = Field(alias="phaseId", default=None)
    action_id: Id | None = Field(alias="actionId", default=None)
    raised_at: IsoTimestamp = Field(alias="raisedAt")
    acknowledged_at: IsoTimestamp | None = Field(alias="acknowledgedAt", default=None)


class ReformMonitorResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    milestones: list[Milestone]
    alerts: list[Alert]
    overall_progress: Ratio = Field(alias="overallProgress")
    estimated_completion_at: IsoTimestamp | None = Field(alias="estimatedCompletionAt", default=None)


class BankProductMatch(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    bank_id: Id = Field(alias="bankId")
    bank_name: str = Field(alias="bankName")
    product_code: str = Field(alias="productCode")
    product_name: str = Field(alias="productName")
    matched_amount: AmountInCents = Field(alias="matchedAmount")
    offered_rate: float = Field(alias="offeredRate")
    requires_guarantee: bool = Field(alias="requiresGuarantee")
    match_score: Ratio = Field(alias="matchScore")
    match_reasons: list[str] = Field(alias="matchReasons", default_factory=list)
    estimated_approval_days: int = Field(alias="estimatedApprovalDays")


ReformOutcome = Literal["success", "abandoned", "failed"]


class ReformCase(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    case_id: Id = Field(alias="caseId")
    enterprise_id: Id = Field(alias="enterpriseId")
    industry: str
    outcome: ReformOutcome
    before_scorecard: Scorecard8D = Field(alias="beforeScorecard")
    after_scorecard: Scorecard8D | None = Field(alias="afterScorecard", default=None)
    total_days: int = Field(alias="totalDays")
    total_cost: AmountInCents = Field(alias="totalCost")
    total_actions: int = Field(alias="totalActions")
    top_level_reached: ReformLevel | None = Field(alias="topLevelReached", default=None)
    stored_at: IsoTimestamp = Field(alias="storedAt")
    signature: str
