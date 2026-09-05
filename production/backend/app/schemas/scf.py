"""供应链金融 (SCF) schemas — SC6/SC7/SC8/SC9/SC10 + 场景预设.

字段命名: snake_case (PEP 8), 通过 alias 对齐前端 camelCase.
设计依据: spec.md SCF-05/06/08/09, simulation/js/view-scf.js.

SC6  定价引擎          综合利率 = LPR + 风险溢价 - 担保抵扣
SC7  风险扩散引擎      核心企业违约 → 上下游 N 跳传播
SC8  撮合引擎          企业融资需求 ↔ 银行资金供给 (top-3)
SC9  履约监控引擎      还款/发货/收货 + 红黄绿灯
SC10 案例学习引擎      行业/产品/规模/结果 四维分类 + 相似度匹配
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import AmountInCents, Id, IsoTimestamp, Percentage, Ratio, Score


# ============================================================================
# 枚举
# ============================================================================

ScfIndustry = Literal[
    "manufacturing", "high_tech", "trade", "service", "agriculture",
    "energy", "logistics", "real_estate_related",
]

GuaranteeMethod = Literal[
    "credit",            # 信用
    "accounts_receivable",  # 应收账款
    "inventory",          # 存货质押
    "guarantee",          # 第三方担保
    "pledge",             # 抵押
    "endorsement",        # 票据背书
]

ScfProduct = Literal[
    "accounts_receivable_financing",  # 应收账款融资
    "prepayment_financing",            # 预付款融资
    "inventory_financing",             # 存货融资
    "bill_discount",                    # 票据贴现
    "reverse_factoring",               # 反向保理
]

ScenarioId = Literal[
    "reverse_factoring_core",   # 核心企业反向保理
    "inventory_pledge",          # 存货质押融资
    "ar_transfer",               # 应收账款转让
    "bill_discount",             # 票据贴现
]

AlertLevel = Literal["green", "yellow", "red"]  # 绿灯/黄灯/红灯
MonitorStatus = Literal["normal", "warning", "overdue", "defaulted", "completed"]
CaseOutcome = Literal["success", "failed", "partial"]
Direction = Literal["upstream", "downstream"]   # 上下游方向


class SCFScenario(BaseModel):
    """SCF 场景预设 (4 个内置)."""

    model_config = ConfigDict(populate_by_name=True)

    scenario_id: ScenarioId = Field(alias="scenarioId")
    name: str
    description: str
    product: ScfProduct
    default_enterprise: str = Field(alias="defaultEnterprise")
    default_amount: AmountInCents = Field(alias="defaultAmount")
    default_term_months: int = Field(alias="defaultTermMonths")
    default_guarantee: GuaranteeMethod = Field(alias="defaultGuarantee")
    prefill: dict = Field(default_factory=dict, description="自动填表字段")


# ============================================================================
# SC6 定价引擎
# ============================================================================

class PricingInput(BaseModel):
    """SC6 定价输入."""

    model_config = ConfigDict(populate_by_name=True)

    enterprise_id: Id = Field(alias="enterpriseId")
    credit_score: Score = Field(alias="creditScore", description="企业信用评分 0-100")
    industry: ScfIndustry
    guarantee_method: GuaranteeMethod = Field(alias="guaranteeMethod")
    term_months: int = Field(alias="termMonths", ge=1, le=120, description="融资期限(月)")
    loan_amount: AmountInCents = Field(alias="loanAmount", description="融资金额(分)")
    base_lpr: Percentage = Field(alias="baseLpr", default=3.45, description="基础 LPR %")


class PricingOutput(BaseModel):
    """SC6 定价输出 (综合利率明细)."""

    model_config = ConfigDict(populate_by_name=True)

    enterprise_id: Id = Field(alias="enterpriseId")
    base_rate: Percentage = Field(alias="baseRate", description="基础利率 LPR")
    risk_premium: Percentage = Field(alias="riskPremium", description="风险溢价")
    collateral_discount: Percentage = Field(alias="collateralDiscount", description="担保抵扣")
    final_rate: Percentage = Field(alias="finalRate", description="最终综合利率")
    annual_interest: AmountInCents = Field(alias="annualInterest", description="年利息(分)")
    breakdown: dict = Field(default_factory=dict, description="明细说明")
    computed_at: IsoTimestamp = Field(alias="computedAt")


# ============================================================================
# SC7 风险扩散引擎
# ============================================================================

class RiskPropagationInput(BaseModel):
    """SC7 风险扩散输入."""

    model_config = ConfigDict(populate_by_name=True)

    root_enterprise_id: Id = Field(alias="rootEnterpriseId", description="触发违约的核心企业 ID")
    hops: int = Field(ge=1, le=5, default=2, description="传播跳数 N")
    shock_amount: AmountInCents = Field(alias="shockAmount", description="初始违约金额(分)")


class PropagationNode(BaseModel):
    """风险传播树节点."""

    model_config = ConfigDict(populate_by_name=True)

    enterprise_id: Id = Field(alias="enterpriseId")
    enterprise_name: str = Field(alias="enterpriseName")
    direction: Direction
    hop: int = Field(description="距根节点跳数, 0=根节点本身")
    exposure_amount: AmountInCents = Field(alias="exposureAmount", description="影响金额(分)")
    loss_given_default: AmountInCents = Field(alias="lossGivenDefault", description="预计损失(分)")
    propagation_ratio: Ratio = Field(alias="propagationRatio", description="传播比例 0-1")
    relation_type: str = Field(alias="relationType", description="关联类型: 应收/预付/存货等")
    severity: Literal["low", "medium", "high", "critical"]


class RiskPropagationOutput(BaseModel):
    """SC7 风险扩散输出."""

    model_config = ConfigDict(populate_by_name=True)

    root_enterprise_id: Id = Field(alias="rootEnterpriseId")
    root_enterprise_name: str = Field(alias="rootEnterpriseName")
    hops: int
    total_exposure: AmountInCents = Field(alias="totalExposure", description="总影响金额(分)")
    total_loss: AmountInCents = Field(alias="totalLoss", description="总预计损失(分)")
    affected_count: int = Field(alias="affectedCount", description="受影响企业数")
    propagation_tree: list[PropagationNode] = Field(alias="propagationTree", description="传播树扁平列表")
    computed_at: IsoTimestamp = Field(alias="computedAt")


# ============================================================================
# SC8 撮合引擎
# ============================================================================

class MatchInput(BaseModel):
    """SC8 撮合输入."""

    model_config = ConfigDict(populate_by_name=True)

    enterprise_id: Id = Field(alias="enterpriseId")
    credit_score: Score = Field(alias="creditScore")
    loan_amount: AmountInCents = Field(alias="loanAmount")
    term_months: int = Field(alias="termMonths")
    guarantee_preference: GuaranteeMethod = Field(alias="guaranteePreference")
    industry: ScfIndustry
    top_k: int = Field(alias="topK", default=3, ge=1, le=10)


class MatchCandidate(BaseModel):
    """撮合候选 (企业-银行-额度-利率-置信度)."""

    model_config = ConfigDict(populate_by_name=True)

    enterprise_id: Id = Field(alias="enterpriseId")
    enterprise_name: str = Field(alias="enterpriseName")
    bank_id: Id = Field(alias="bankId")
    bank_name: str = Field(alias="bankName")
    bank_product: str = Field(alias="bankProduct", description="银行产品名")
    approved_amount: AmountInCents = Field(alias="approvedAmount", description="核准额度(分)")
    approved_rate: Percentage = Field(alias="approvedRate", description="核准利率 %")
    term_months: int = Field(alias="termMonths")
    confidence: Ratio = Field(description="匹配置信度 0-1")
    match_reasons: list[str] = Field(alias="matchReasons", default_factory=list)
    mismatches: list[str] = Field(default_factory=list)


class MatchOutput(BaseModel):
    """SC8 撮合输出 (top-K 候选)."""

    model_config = ConfigDict(populate_by_name=True)

    enterprise_id: Id = Field(alias="enterpriseId")
    candidates: list[MatchCandidate]
    computed_at: IsoTimestamp = Field(alias="computedAt")


# ============================================================================
# SC9 履约监控引擎
# ============================================================================

class MonitorAlert(BaseModel):
    """履约告警."""

    model_config = ConfigDict(populate_by_name=True)

    alert_id: Id = Field(alias="alertId")
    enterprise_id: Id = Field(alias="enterpriseId")
    enterprise_name: str = Field(alias="enterpriseName")
    contract_id: Id = Field(alias="contractId")
    monitor_kind: Literal["repayment", "shipment", "receipt", "delivery"] = Field(alias="monitorKind")
    level: AlertLevel
    status: MonitorStatus
    due_date: IsoTimestamp = Field(alias="dueDate")
    amount: AmountInCents = Field(description="履约金额(分)")
    overdue_days: int = Field(alias="overdueDays", default=0)
    message: str
    raised_at: IsoTimestamp = Field(alias="raisedAt")


class MonitorStatusSummary(BaseModel):
    """履约监控汇总."""

    model_config = ConfigDict(populate_by_name=True)

    total: int
    green_count: int = Field(alias="greenCount")
    yellow_count: int = Field(alias="yellowCount")
    red_count: int = Field(alias="redCount")
    total_at_risk_amount: AmountInCents = Field(alias="totalAtRiskAmount", description="风险敞口(分)")


# ============================================================================
# SC10 案例学习引擎
# ============================================================================

class CaseRecord(BaseModel):
    """案例库记录."""

    model_config = ConfigDict(populate_by_name=True)

    case_id: Id = Field(alias="caseId")
    enterprise_name: str = Field(alias="enterpriseName")
    industry: ScfIndustry
    product: ScfProduct
    scale: Literal["micro", "small", "medium", "large"] = Field(description="企业规模")
    outcome: CaseOutcome
    loan_amount: AmountInCents = Field(alias="loanAmount")
    final_rate: Percentage = Field(alias="finalRate")
    duration_days: int = Field(alias="durationDays")
    summary: str
    key_learnings: list[str] = Field(alias="keyLearnings", default_factory=list)
    similarity_tags: list[str] = Field(alias="similarityTags", default_factory=list, description="相似度匹配标签")
    stored_at: IsoTimestamp = Field(alias="storedAt")


class CaseQuery(BaseModel):
    """案例检索条件."""

    model_config = ConfigDict(populate_by_name=True)

    industry: ScfIndustry | None = None
    product: ScfProduct | None = None
    scale: Literal["micro", "small", "medium", "large"] | None = None
    outcome: CaseOutcome | None = None
    keyword: str | None = Field(default=None, description="关键词模糊匹配 summary")


# ============================================================================
# SCF ↔ Reform 联动事件 (SCF-09)
# ============================================================================

class ReformSyncEvent(BaseModel):
    """reform 完成事件, 触发 SC1 画像刷新 + SC8 撮合重算."""

    model_config = ConfigDict(populate_by_name=True)

    enterprise_id: Id = Field(alias="enterpriseId")
    reform_case_id: Id = Field(alias="reformCaseId")
    reform_outcome: Literal["success", "failed", "abandoned"] = Field(alias="reformOutcome")
    after_level: Literal["D", "C", "B", "A"] = Field(alias="afterLevel")
    after_credit_score: Score = Field(alias="afterCreditScore")
    completed_at: IsoTimestamp = Field(alias="completedAt")


class ReformSyncResult(BaseModel):
    """联动结果."""

    model_config = ConfigDict(populate_by_name=True)

    enterprise_id: Id = Field(alias="enterpriseId")
    portrait_refreshed: bool = Field(alias="portraitRefreshed")
    new_credit_score: Score = Field(alias="newCreditScore")
    rematch_triggered: bool = Field(alias="rematchTriggered")
    new_candidates_count: int = Field(alias="newCandidatesCount")
    message: str
