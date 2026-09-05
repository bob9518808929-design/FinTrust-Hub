"""ECO 9 模块 schemas (镜像 contracts/eco.ts).

合并 9 个模块的 Pydantic schemas 在一处, 便于引用.
字段命名: snake_case, 通过 alias 对齐前端 camelCase.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import AmountInCents, Id, IsoTimestamp, Ratio, Percentage, Score
from app.schemas.enterprise import Industry
from app.schemas.scorecard import Scorecard8D, GapItem


# ============================================================================
# ECO-01 阅后即焚
# ============================================================================

BurnStatus = Literal["idle", "loaded", "diagnosing", "completed", "destroyed"]
BurnPhase = Literal["loading", "portrait", "gap_analysis", "finalizing", "destroying"]
BurnDataType = Literal["bank_statement", "tax_detail", "dual_books", "invoice_raw", "contract_raw"]


class BurnRawDataInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    enterprise_id: Id = Field(alias="enterpriseId")
    data_type: BurnDataType = Field(alias="dataType")
    records: list[dict]
    source: Literal["bank_api", "ocr", "enterprise_upload", "tax_api"]


class BurnLoadResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    loaded: bool
    record_count: int = Field(alias="recordCount")
    bytes: int


class BurnProgress(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    enterprise_id: Id = Field(alias="enterpriseId")
    started_at: IsoTimestamp = Field(alias="startedAt")
    elapsed_sec: int = Field(alias="elapsedSec")
    total_sec: int = Field(alias="totalSec")
    phase: BurnPhase
    percentage: Ratio


class BurnDiagnosisResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    enterprise_id: Id = Field(alias="enterpriseId")
    scorecard: Scorecard8D
    gaps: list[GapItem]
    completed_at: IsoTimestamp = Field(alias="completedAt")
    raw_hash: str = Field(alias="rawHash")
    # 诊断引擎: "llm"=DeepSeek 深度诊断 (A 档, 锚定规则基线±10), "rule"=规则基线 (B 档降级)
    engine: str = Field(default="rule")
    # enclave 内提取的脱敏内容特征摘要 (统计聚合值, 原文不出 enclave):
    # 如 "关键术语: 负债×12, 逾期×8" / "数值字段 负债率: 均值0.72 (n=5)" / "金额要素: 72%×3"
    content_digest: list[str] = Field(default_factory=list, alias="contentDigest")


class BurnChainEvidence(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    tx_id: Id = Field(alias="txId")
    block: int
    hash: str
    prev_hash: str = Field(alias="prevHash")
    action: Literal["raw_loaded", "diagnosed", "destroyed", "audit_logged"]
    ts: IsoTimestamp


class BurnDataSummary(BaseModel):
    """被销毁原始数据的概况 (脱敏: 只有类型/条数/来源/体积, 不含任何内容)."""
    model_config = ConfigDict(populate_by_name=True)
    data_type: str = Field(alias="dataType")
    record_count: int = Field(alias="recordCount")
    source: str = ""
    bytes_kb: float = Field(alias="bytesKb", default=0.0)


class BurnGapBrief(BaseModel):
    """差距项摘要 (诊断结论用)."""
    model_config = ConfigDict(populate_by_name=True)
    dimension: str
    severity: str
    delta: int
    current: int
    target: int
    # 诊断引擎给出的针对性改造动作 (LLM 定制引用材料具体发现 / 规则模板)
    action: str = ""


class BurnDiagnosisSummary(BaseModel):
    """脱敏诊断结论摘要: 8 维评分卡快照 + 差距清单概要 (审计报告核心价值内容)."""
    model_config = ConfigDict(populate_by_name=True)
    scorecard: Scorecard8D
    gap_count: int = Field(alias="gapCount")
    top_gaps: list[BurnGapBrief] = Field(alias="topGaps", default_factory=list)
    completed_at: IsoTimestamp = Field(alias="completedAt")
    # enclave 内提取的内容特征摘要 (与产物 contentDigest 同源)
    content_digest: list[str] = Field(alias="contentDigest", default_factory=list)
    # 诊断引擎溯源: "llm"=DeepSeek 深度诊断 (A 档), "rule"=规则基线 (B 档) — 审计必须可验证 LLM 真实参与
    engine: str = Field(default="rule")


class BurnAuditTrail(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    enterprise_id: Id = Field(alias="enterpriseId")
    destroyed_at: IsoTimestamp = Field(alias="destroyedAt")
    redis_keys_cleared: int = Field(alias="redisKeysCleared")
    three_pass_overwrite: bool = Field(alias="threePassOverwrite")
    weak_ref_finalized: bool = Field(alias="weakRefFinalized")
    # 被销毁原始数据的规范化哈希 — 与脱敏产物 rawHash 同算法, 可对账证明"销毁的即诊断的那份"
    raw_hash: str = Field(alias="rawHash", default="")
    # 有价值的审计内容: 销毁了什么数据 (概况) + 诊断出了什么结论 (评分/差距摘要)
    data_summary: BurnDataSummary | None = Field(alias="dataSummary", default=None)
    diagnosis_summary: BurnDiagnosisSummary | None = Field(alias="diagnosisSummary", default=None)
    chain_evidence: list[BurnChainEvidence] = Field(alias="chainEvidence", default_factory=list)


# ============================================================================
# ECO-02 阶梯定价
# ============================================================================

PricingDifficulty = Literal["green", "yellow", "orange", "r5_lite"]
SettlementStatus = Literal["pending", "calculated", "paid", "failed", "refunded"]


class SettlementCalcInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    enterprise_id: Id = Field(alias="enterpriseId")
    loan_amount: AmountInCents = Field(alias="loanAmount")
    original_rate: Percentage = Field(alias="originalRate")
    achieved_rate: Percentage = Field(alias="achievedRate")
    term_months: int = Field(alias="termMonths")
    difficulty: PricingDifficulty
    reform_case_id: Id | None = Field(alias="reformCaseId", default=None)


class SettlementRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    settlement_id: Id = Field(alias="settlementId")
    enterprise_id: Id = Field(alias="enterpriseId")
    loan_amount: AmountInCents = Field(alias="loanAmount")
    interest_saved: AmountInCents = Field(alias="interestSaved")
    difficulty: PricingDifficulty
    split_ratio: Ratio = Field(alias="splitRatio")
    platform_fee: AmountInCents = Field(alias="platformFee")
    enterprise_net: AmountInCents = Field(alias="enterpriseNet")
    status: SettlementStatus
    calculated_at: IsoTimestamp = Field(alias="calculatedAt")
    paid_at: IsoTimestamp | None = Field(alias="paidAt", default=None)
    auto_deducted_from_loan: bool | None = Field(alias="autoDeductedFromLoan", default=None)


# ============================================================================
# ECO-03 无接口适配器
# ============================================================================

BankOnboardingTier = Literal["tier_pdf", "tier_email", "tier_api_lite", "tier_api_full"]


class CreditApplicationInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    enterprise_id: Id = Field(alias="enterpriseId")
    bank_id: Id = Field(alias="bankId")
    loan_amount: AmountInCents = Field(alias="loanAmount")
    loan_term_months: int = Field(alias="loanTermMonths")
    loan_purpose: str = Field(alias="loanPurpose")
    reform_snapshot: Scorecard8D | None = Field(alias="reformSnapshot", default=None)
    credential_ref: Id | None = Field(alias="credentialRef", default=None)


class CreditApplicationRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    application_id: Id = Field(alias="applicationId")
    enterprise_id: Id = Field(alias="enterpriseId")
    bank_id: Id = Field(alias="bankId")
    pdf_url: str = Field(alias="pdfUrl")
    pdf_hash: str = Field(alias="pdfHash")
    submitted_at: IsoTimestamp = Field(alias="submittedAt")
    tier: BankOnboardingTier
    status: Literal["draft", "submitted", "received", "in_review", "approved", "rejected"]
    bank_received_at: IsoTimestamp | None = Field(alias="bankReceivedAt", default=None)
    bank_acknowledgement: str | None = Field(alias="bankAcknowledgement", default=None)


# ============================================================================
# ECO-04 联盟链凭证
# ============================================================================

CredentialType = Literal[
    "reform_completion", "credit_portability",
    "five_streams_verified", "guarantee_active", "compliance_green",
]
CredentialStatus = Literal["active", "suspended", "revoked", "expired"]


class CredentialIssueInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    enterprise_id: Id = Field(alias="enterpriseId")
    type: CredentialType
    expiry_months: int | None = Field(alias="expiryMonths", default=12)
    claims: list[str] | None = None


class VerifiableCredential(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    credential_id: Id = Field(alias="credentialId")
    enterprise_id: Id = Field(alias="enterpriseId")
    type: CredentialType
    issuer: Id
    issuance_date: IsoTimestamp = Field(alias="issuanceDate")
    expiration_date: IsoTimestamp = Field(alias="expirationDate")
    credential_subject: dict = Field(alias="credentialSubject")
    proof: dict
    status: CredentialStatus


class CredentialVerifyResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    valid: bool
    reason: str | None = None
    revocation_checked_at: IsoTimestamp = Field(alias="revocationCheckedAt")
    signature_valid: bool = Field(alias="signatureValid")
    blockchain_verified: bool = Field(alias="blockchainVerified")


# ============================================================================
# ECO-05 反向竞拍
# ============================================================================

TenderStatus = Literal["draft", "published", "bidding", "awarded", "closed", "cancelled"]


class TenderPublishInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    enterprise_id: Id = Field(alias="enterpriseId")
    enterprise_name: str = Field(alias="enterpriseName", default="")
    amount: AmountInCents
    term_months: int = Field(alias="termMonths")
    rate_floor: Percentage = Field(alias="rateFloor")
    rate_floor_label: str = Field(alias="rateFloorLabel", default="")
    purpose: str = ""
    credential_ref: Id | None = Field(alias="credentialRef", default=None)
    invited_bank_ids: list[Id] = Field(alias="invitedBankIds", default_factory=list)
    bidding_hours: int | None = Field(alias="biddingHours", default=24)


class Tender(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    tender_id: Id = Field(alias="tenderId")
    enterprise_id: Id = Field(alias="enterpriseId")
    enterprise_name: str = Field(alias="enterpriseName")
    amount: AmountInCents
    term_months: int = Field(alias="termMonths")
    rate_floor: Percentage = Field(alias="rateFloor")
    rate_floor_label: str = Field(alias="rateFloorLabel")
    purpose: str
    credential_ref: Id | None = Field(alias="credentialRef", default=None)
    profile_summary: str = Field(alias="profileSummary", default="")
    published_at: IsoTimestamp = Field(alias="publishedAt")
    deadline: IsoTimestamp
    status: TenderStatus
    invited_bank_ids: list[Id] = Field(alias="invitedBankIds")
    winner_bid_id: Id | None = Field(alias="winnerBidId", default=None)
    chain_evidence: list[BurnChainEvidence] = Field(alias="chainEvidence", default_factory=list)


class BidSubmitInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    tender_id: Id = Field(alias="tenderId")
    bank_id: Id = Field(alias="bankId")
    rate: Percentage
    amount: AmountInCents
    term_months: int = Field(alias="termMonths")
    time_to_fund_days: int = Field(alias="timeToFundDays")
    conditions: str = ""


class BankBid(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    bid_id: Id = Field(alias="bidId")
    tender_id: Id = Field(alias="tenderId")
    bank_id: Id = Field(alias="bankId")
    bank_name: str = Field(alias="bankName")
    bank_group: str | None = Field(alias="bankGroup", default=None)
    rate: Percentage
    amount: AmountInCents
    term_months: int = Field(alias="termMonths")
    time_to_fund_days: int = Field(alias="timeToFundDays")
    conditions: str = ""
    submitted_at: IsoTimestamp = Field(alias="submittedAt")
    status: Literal["pending", "winner", "archived", "disqualified"]
    is_fraudulent: bool = Field(alias="isFraudulent", default=False)
    fraud_reason: str | None = Field(alias="fraudReason", default=None)
    signed_hash: str = Field(alias="signedHash")


class CollusionEvidence(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    suspected_bid_ids: list[Id] = Field(alias="suspectedBidIds")
    reason: str
    rate_tolerance: float = Field(alias="rateTolerance")
    group_overlap: bool = Field(alias="groupOverlap")
    detected_at: IsoTimestamp = Field(alias="detectedAt")


class MultiHeadCheckResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    enterprise_id: Id = Field(alias="enterpriseId")
    net_assets: AmountInCents = Field(alias="netAssets")
    total_exposure: AmountInCents = Field(alias="totalExposure")
    exposure_ratio: Ratio = Field(alias="exposureRatio")
    threshold: float = Field(description="净资产倍数阈值 (如 5.0 = 5 倍)")
    within_limit: bool = Field(alias="withinLimit")


class AwardResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    winner_bid_id: Id = Field(alias="winnerBidId")
    ranking: list[BankBid]


# ============================================================================
# ECO-06 积分商城
# ============================================================================

BehaviorKind = Literal["scan_confirm", "exception_report", "streak_7d"]


class AwardPointsInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    worker_id: Id = Field(alias="workerId")
    behavior: BehaviorKind
    evidence: list[str] | None = None
    geo_fence: dict | None = Field(alias="geoFence", default=None)
    # APP-02 Task 11: 移动端 PWA 异步上链字段 (PC 端不传 → None → 跳过上链, 向后兼容)
    material_id: str | None = Field(alias="materialId", default=None)
    photo_hash: str | None = Field(alias="photoHash", default=None)
    location: dict | None = None  # {"value": "lat,lng", "accuracy": 10}
    from_mobile: bool | None = Field(alias="fromMobile", default=None)


class WorkerBalances(BaseModel):
    credit: int = 0
    carbon: int = 0
    easy_trust: int = Field(alias="easyTrust", default=0)


class AwardPointsResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    awarded: bool
    new_balances: WorkerBalances = Field(alias="newBalances")
    fraud_blocked: bool | None = Field(alias="fraudBlocked", default=None)
    reason: str | None = None
    # APP-02 Task 11: 异步上链 tx_hash (后台 stamp 完成后由 retry queue 回填, 响应阶段永远 null)
    chain_tx_hash: str | None = Field(alias="chainTxHash", default=None)


class WorkerAccount(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    worker_id: Id = Field(alias="workerId")
    name: str
    role: str
    enterprise_id: Id = Field(alias="enterpriseId")
    device_fp: str = Field(alias="deviceFp")
    balances: WorkerBalances
    streak_days: int = Field(alias="streakDays", default=0)
    monthly_consumption: AmountInCents = Field(alias="monthlyConsumption", default=0)
    created_at: IsoTimestamp = Field(alias="createdAt")


class ShopItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    item_id: Id = Field(alias="itemId")
    name: str
    icon: str = ""
    credit_cost: int = Field(alias="creditCost")
    currency_cost: AmountInCents = Field(alias="currencyCost")
    stock: int
    category: Literal["电子", "生活", "餐饮", "通讯", "娱乐"]


class ExchangeOrder(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    order_id: Id = Field(alias="orderId")
    worker_id: Id = Field(alias="workerId")
    item_id: Id = Field(alias="itemId")
    item_name: str = Field(alias="itemName")
    credit_cost: int = Field(alias="creditCost")
    currency_cost: AmountInCents = Field(alias="currencyCost")
    status: Literal["pending", "shipped", "delivered", "cancelled"]
    placed_at: IsoTimestamp = Field(alias="placedAt")
    shipped_at: IsoTimestamp | None = Field(alias="shippedAt", default=None)


class PlaceOrderInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    worker_id: Id = Field(alias="workerId")
    item_id: Id = Field(alias="itemId")


class FraudLogEntry(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    log_id: Id = Field(alias="logId")
    worker_id: Id = Field(alias="workerId")
    reason: str
    attempted_points: int = Field(alias="attemptedPoints")
    blocked: bool
    occurred_at: IsoTimestamp = Field(alias="occurredAt")
    geo_fence: dict | None = Field(alias="geoFence", default=None)


class CooperationRateResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    current: Ratio
    baseline: Ratio
    target: Ratio
    monthly_cost: AmountInCents = Field(alias="monthlyCost")
    within_budget: bool = Field(alias="withinBudget")


# ============================================================================
# ECO-07 行业合规指数
# ============================================================================

IndexType = Literal[
    "industry_reform_success", "industry_avg_credit",
    "interest_rate_benchmark", "compliance_distribution",
]


class IndexCalcInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    type: IndexType
    industry: str | None = None
    period: str


class ComplianceIndexSnapshot(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    index_id: Id = Field(alias="indexId")
    type: IndexType
    industry: str
    period: str
    value: float
    sample_size: int = Field(alias="sampleSize")
    methodology: str
    published_at: IsoTimestamp = Field(alias="publishedAt")
    signature: str


class IndexCompareResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    enterprise_value: float = Field(alias="enterpriseValue")
    industry_benchmark: float = Field(alias="industryBenchmark")
    percentile: Ratio
    industry: str
    period: str


# ============================================================================
# ECO-08 政府背书
# ============================================================================

GovReportType = Literal[
    "sandbox_penetration", "reform_outcome", "compliance_audit", "risk_alert",
]
GovReportStatus = Literal["draft", "submitted", "in_review", "endorsed", "rejected", "archived"]


class GovReportInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    enterprise_id: Id = Field(alias="enterpriseId")
    type: GovReportType
    desensitized_level: Literal["full", "partial", "aggregate"] = Field(
        alias="desensitizedLevel", default="full"
    )


class GovReport(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    report_id: Id = Field(alias="reportId")
    type: GovReportType
    enterprise_id: Id = Field(alias="enterpriseId")
    enterprise: str  # 冗余字段 (project_memory: log() 包含 enterprise)
    source: str  # project_memory: log() 包含 source
    content: str
    desensitized_level: Literal["full", "partial", "aggregate"] = Field(alias="desensitizedLevel")
    submitted_at: IsoTimestamp = Field(alias="submittedAt")
    status: GovReportStatus
    regulator_ack: dict | None = Field(alias="regulatorAck", default=None)


class GovEndorsement(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    endorsement_id: Id = Field(alias="endorsementId")
    enterprise_id: Id = Field(alias="enterpriseId")
    regulator: str
    level: Literal["provisional", "formal", "premium"]
    granted_at: IsoTimestamp = Field(alias="grantedAt")
    valid_until: IsoTimestamp = Field(alias="validUntil")
    scope: list[str]
    linked_report_id: Id = Field(alias="linkedReportId")


class GovEndorseApplyInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    enterprise_id: Id = Field(alias="enterpriseId")
    regulator: str
    scope: list[str]


class GovEndorseApplyResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    application_id: Id = Field(alias="applicationId")
    status: Literal["pending_review"] = "pending_review"


# ============================================================================
# ECO-09 数字分身
# ============================================================================

BotChannel = Literal["wechat", "dingtalk", "web", "api"]
BotIntentKind = Literal[
    "query_progress", "query_credit", "apply_financing",
    "submit_responsibility", "report_exception", "view_report",
    "answer_question", "unknown", "llm_fallback",
]


class BotParseInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    text: str
    channel: BotChannel
    enterprise_id: Id = Field(alias="enterpriseId")
    worker_id: Id | None = Field(alias="workerId", default=None)


class BotCommandParse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    intent: BotIntentKind
    confidence: Ratio
    entities: dict = Field(default_factory=dict)
    raw_text: str = Field(alias="rawText")
    original_channel: BotChannel = Field(alias="originalChannel")


class BotReplyCardField(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    label: str
    value: str
    emphasize: bool | None = None


class BotReplyCardAction(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    label: str
    action: str
    payload: dict | None = None


class BotReplyCard(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    card_type: Literal["progress_bar", "score_radar", "list", "chart", "action"] = Field(alias="cardType")
    title: str
    fields: list[BotReplyCardField] = Field(default_factory=list)
    actions: list[BotReplyCardAction] | None = None


class BotExecuteInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    parse: BotCommandParse
    conversation_id: Id | None = Field(alias="conversationId", default=None)


class BotCommandResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    command_id: Id = Field(alias="commandId")
    intent: BotIntentKind
    success: bool
    reply_text: str = Field(alias="replyText")
    reply_card: BotReplyCard | None = Field(alias="replyCard", default=None)
    linked_module: Literal["ECO-01", "ECO-05", "ECO-06", "ECO-08", "reform"] | None = Field(
        alias="linkedModule", default=None
    )
    linked_action_id: Id | None = Field(alias="linkedActionId", default=None)
    executed_at: IsoTimestamp = Field(alias="executedAt")
    duration_ms: int = Field(alias="durationMs")


class BotBroadcastInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    enterprise_id: Id = Field(alias="enterpriseId")
    channel: BotChannel | None = None
    title: str
    content: str
    actions: list[BotReplyCardAction] | None = None
    severity: Literal["info", "warning", "error"] = "info"


class BotBroadcastResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    pushed_to: list[BotChannel] = Field(alias="pushedTo")
    receipt_count: int = Field(alias="receiptCount")


class BotConfig(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    enterprise_id: Id = Field(alias="enterpriseId")
    bot_name: str = Field(alias="botName")
    avatar: str
    channels: list[BotChannel]
    default_language: Literal["zh-CN"] = Field(alias="defaultLanguage", default="zh-CN")
    llm_model: Literal["deepseek-v3", "deepseek-r1"] = Field(alias="llmModel")
    enabled_intents: list[BotIntentKind] = Field(alias="enabledIntents")
    rate_limit_per_min: int = Field(alias="rateLimitPerMin")


# ============================================================================
# 通用快捷别名 (用于响应包装)
# ============================================================================

BurnResultResponse = BurnDiagnosisResult
BurnAuditResponse = BurnAuditTrail
SettlementResponse = SettlementRecord
CreditAppResponse = CreditApplicationRecord
CredentialResponse = VerifiableCredential
TenderResponse = Tender
AwardResponse = AwardResult
WorkerResponse = WorkerAccount
OrderResponse = ExchangeOrder
AwardPointsResponse = AwardPointsResult
IndexResponse = ComplianceIndexSnapshot
GovReportResponse = GovReport
EndorsementResponse = GovEndorsement
BotCommandResponse = BotCommandResult
BotBroadcastResponse = BotBroadcastResult
