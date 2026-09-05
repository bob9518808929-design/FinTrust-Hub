"""企业 schemas (镜像 contracts/common.ts Enterprise 部分)."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import (
    AmountInCents,
    ApiResult,
    Id,
    IsoTimestamp,
    Ratio,
    Score,
    TimestampMixin,
)

# === 枚举 ===

Industry = Literal[
    "manufacturing", "high_tech", "real_estate_related",
    "trade", "service", "agriculture", "energy", "logistics",
]
IndustryPolicy = Literal["encourage", "neutral", "restrict"]
RiskProfile = Literal["premium", "normal", "high_risk", "distress"]
DataFlowKey = Literal["fund", "contract", "invoice", "logistics", "iot", "personnel"]
CreditGrade = Literal["A", "B", "C"]
ReformLevel = Literal["D", "C", "B", "A"]
AutonomyLevel = Literal["L1", "L2", "L3", "L4"]

EnterpriseMode = Literal[
    "custody", "planning", "financing_advisory", "advisory", "self_operated",
]
BankMode = Literal["pre_loan", "post_loan", "consulting", "delegation", "discovery"]
GuarantorMode = Literal["collaborate", "compensation", "counter_guarantee"]
InsuranceMode = Literal["joint_underwriting", "claim_collab"]

ExternalApiStatus = Literal["connected", "disconnected", "degraded", "circuit_open"]
CircuitState = Literal["closed", "open", "half_open"]
ApiCategory = Literal[
    "bank", "invoice", "business", "judicial", "bill", "logistics",
    "utility", "contract", "blockchain", "guarantee", "insurance",
    "legal", "audit", "credit",
]
FallbackModuleId = Literal["C1", "C2", "C3", "C4", "C5", "C6", "C7", "MOD15"]

PrecheckVerdict = Literal["eligible", "reluctant", "needs_data", "ineligible", "fallback_only"]


# === 子对象 ===

class DataFlowFlags(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    fund: bool = False
    contract: bool = False
    invoice: bool = False
    logistics: bool = False
    iot: bool = False
    personnel: bool = False


class CooperationModes(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    enterprise_mode: list[EnterpriseMode] = Field(alias="enterpriseMode", default_factory=list)
    bank_mode: list[BankMode] = Field(alias="bankMode", default_factory=list)
    guarantor_mode: list[GuarantorMode] = Field(alias="guarantorMode", default_factory=list)
    insurance_mode: list[InsuranceMode] = Field(alias="insuranceMode", default_factory=list)


class DataVisibility(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    bank: list[str] = Field(default_factory=list)
    guarantor: list[str] = Field(default_factory=list)
    insurance: list[str] = Field(default_factory=list)


class EnterpriseModules(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    fund_monitor: Literal["strong", "weak", "none"] = Field(alias="fundMonitor", default="none")
    bill_service: bool = Field(alias="billService", default=False)
    ar_insurance: bool = Field(alias="arInsurance", default=False)
    iot_perception: bool = Field(alias="iotPerception", default=False)
    blockchain_anchor: bool = Field(alias="blockchainAnchor", default=False)
    ai_autonomy_max: AutonomyLevel = Field(alias="aiAutonomyMax", default="L4")


class Bill(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    bill_id: Id = Field(alias="billId")
    amount: AmountInCents
    due_date: IsoTimestamp = Field(alias="dueDate")
    type: Literal["bank_acceptance", "commercial_acceptance", "electronic"]
    insured: bool = False


class EnterpriseFinancials(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    monthly_revenue: AmountInCents = Field(alias="monthlyRevenue")
    monthly_expense: AmountInCents = Field(alias="monthlyExpense")
    account_balance: AmountInCents = Field(alias="accountBalance")
    pending_ar: AmountInCents = Field(alias="pendingAR")
    bills_held: list[Bill] = Field(alias="billsHeld", default_factory=list)


class FiveStreamsState(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    fund: bool = False
    contract: bool = False
    invoice: bool = False
    logistics: bool = False
    iot: bool = False
    personnel: bool = False


class ResponsibilityNode(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    node_id: Id = Field(alias="nodeId")
    name: str
    role: str
    operator: str
    approver: str | None = None
    method: str
    credit_weight: int = Field(alias="creditWeight", ge=0)
    stage: str


class ResponsibilityChain(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    nodes: list[ResponsibilityNode] = Field(default_factory=list)
    completeness: Ratio = 0.0
    total_score: int = Field(alias="totalScore", default=0)
    compliance_report: dict | None = Field(alias="complianceReport", default=None)


class EnterpriseRuntime(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    credit_completeness: Ratio = Field(alias="creditCompleteness", default=0.0)
    credit_score: int = Field(alias="creditScore", default=600, ge=0, le=850)
    max_amount_multiplier: float = Field(alias="maxAmountMultiplier", default=1.0)
    rate_discount: float = Field(alias="rateDiscount", default=0.0)
    credit_grade_cap: CreditGrade = Field(alias="creditGradeCap", default="C")
    approval_speed: Literal["fast", "normal", "slow"] = Field(alias="approvalSpeed", default="normal")
    water_level: Ratio = Field(alias="waterLevel", default=0.5)
    five_streams: FiveStreamsState = Field(alias="fiveStreams", default_factory=FiveStreamsState)
    guarantee_status: Literal["none", "pending", "active", "rejected"] = Field(alias="guaranteeStatus", default="none")
    insurance_status: Literal["none", "pending", "active", "rejected"] = Field(alias="insuranceStatus", default="none")
    financing_unlocked: bool = Field(alias="financingUnlocked", default=False)
    responsibility_chain: ResponsibilityChain = Field(alias="responsibilityChain", default_factory=ResponsibilityChain)


# === 企业主模型 ===

class EnterpriseBase(BaseModel):
    """企业基础信息."""

    model_config = ConfigDict(populate_by_name=True, from_attributes=True)

    name: str
    industry: Industry
    industry_label: str = Field(alias="industryLabel")
    industry_policy: IndustryPolicy = Field(alias="industryPolicy")
    risk_profile: RiskProfile = Field(alias="riskProfile")
    risk_label: str = Field(alias="riskLabel")
    data_flows: DataFlowFlags = Field(alias="dataFlows", default_factory=DataFlowFlags)
    modules: EnterpriseModules = Field(default_factory=EnterpriseModules)
    cooperation: CooperationModes = Field(default_factory=CooperationModes)
    data_visibility: DataVisibility = Field(alias="dataVisibility", default_factory=DataVisibility)
    financials: EnterpriseFinancials


class Enterprise(EnterpriseBase, TimestampMixin):
    """企业完整 (含 ID + runtime + reform)."""

    id: Id
    runtime: EnterpriseRuntime = Field(default_factory=EnterpriseRuntime)
    reform: dict = Field(default_factory=dict)


class EnterpriseCreate(EnterpriseBase):
    """创建企业入参."""


class EnterpriseUpdate(BaseModel):
    """更新企业 (部分字段, 全部可选)."""

    model_config = ConfigDict(populate_by_name=True)

    name: str | None = None
    industry: Industry | None = None
    industry_label: str | None = Field(alias="industryLabel", default=None)
    industry_policy: IndustryPolicy | None = Field(alias="industryPolicy", default=None)
    risk_profile: RiskProfile | None = Field(alias="riskProfile", default=None)
    risk_label: str | None = Field(alias="riskLabel", default=None)
    data_flows: DataFlowFlags | None = Field(alias="dataFlows", default=None)
    modules: EnterpriseModules | None = None
    cooperation: CooperationModes | None = None
    data_visibility: DataVisibility | None = Field(alias="dataVisibility", default=None)


class ApplyReformResultInput(BaseModel):
    """应用改造结果回写 (project_memory 硬约束)."""

    model_config = ConfigDict(populate_by_name=True)

    has_reformed: bool = Field(alias="hasReformed")
    reformed_at: IsoTimestamp = Field(alias="reformedAt")
    after_level: ReformLevel | None = Field(alias="afterLevel")
    after_scorecard: dict | None = Field(alias="afterScorecard")
    financing_unlocked: bool = Field(alias="financingUnlocked")


# === 银行/担保/保险 ===

class Bank(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    id: Id
    name: str
    base_rate: str = Field(alias="baseRate")
    base_rate_value: float = Field(alias="baseRateValue")
    max_amount: AmountInCents = Field(alias="maxAmount")
    requires_guarantee: bool = Field(alias="requiresGuarantee")
    label: str = ""
    bank_group: str | None = Field(alias="bankGroup", default=None)


class Guarantor(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    id: Id
    name: str
    mode: GuarantorMode
    active_guarantees: int = Field(alias="activeGuarantees", default=0)
    guarantee_rate: str = Field(alias="guaranteeRate")


class Insurer(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    id: Id
    name: str
    mode: InsuranceMode
    active_policies: int = Field(alias="activePolicies", default=0)
    premium_rate: str = Field(alias="premiumRate")


# === 政策/季节性 ===

class PolicyVersion(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    version: str
    label: str
    manufacturing: IndustryPolicy
    high_tech: IndustryPolicy = Field(alias="high_tech")
    real_estate_related: IndustryPolicy = Field(alias="real_estate_related")


class SeasonalWindow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    key: str
    label: str
    rate_adjust: float = Field(alias="rateAdjust")
    desc: str = ""


# === ECO 事件 ===

class EcoEvent(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    kind: str
    enterprise_id: Id = Field(alias="enterpriseId")
    payload: dict = Field(default_factory=dict)
    occurred_at: IsoTimestamp = Field(alias="occurredAt")
    trace_id: Id = Field(alias="traceId")


# === R0 预检 ===

class ReformPrecheck(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    enterprise_id: Id = Field(alias="enterpriseId")
    verdict: PrecheckVerdict
    willingness_score: Score = Field(alias="willingnessScore")
    data_completeness: Ratio = Field(alias="dataCompleteness")
    top_gaps: list[str] = Field(alias="topGaps", default_factory=list)
    recommended_tier: Literal["tier1", "tier2", "fallback"] = Field(alias="recommendedTier")
    checked_at: IsoTimestamp = Field(alias="checkedAt")


# === 响应包装快捷别名 ===

EnterpriseResult = ApiResult[Enterprise]
EnterpriseListResult = ApiResult[list[Enterprise]]
PrecheckResult = ApiResult[ReformPrecheck]
