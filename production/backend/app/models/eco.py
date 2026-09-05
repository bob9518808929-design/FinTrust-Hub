"""ECO 9 模块共享 ORM models."""

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, IdMixin, TenantMixin, TimestampMixin


# ECO-01
class BurnAuditORM(Base, IdMixin, TenantMixin, TimestampMixin):
    """阅后即焚销毁审计."""

    __tablename__ = "burn_audits"
    enterprise_id: Mapped[str] = mapped_column(String(64), ForeignKey("enterprises.id"), nullable=False, index=True)
    destroyed_at: Mapped[str] = mapped_column(DateTime(timezone=True), nullable=False)
    redis_keys_cleared: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    three_pass_overwrite: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    weak_ref_finalized: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    chain_evidence: Mapped[dict] = mapped_column(JSON, nullable=False, default=list)
    raw_hash: Mapped[str] = mapped_column(String(128), nullable=False, comment="销毁前原始数据画像哈希")


# ECO-02
class SettlementORM(Base, IdMixin, TenantMixin, TimestampMixin):
    """阶梯定价分成结算."""

    __tablename__ = "settlement_records"
    enterprise_id: Mapped[str] = mapped_column(String(64), ForeignKey("enterprises.id"), nullable=False, index=True)
    loan_amount: Mapped[int] = mapped_column(Integer, nullable=False)
    interest_saved: Mapped[int] = mapped_column(Integer, nullable=False)
    difficulty: Mapped[str] = mapped_column(String(20), nullable=False)
    split_ratio: Mapped[float] = mapped_column(Numeric(5, 4), nullable=False)
    platform_fee: Mapped[int] = mapped_column(Integer, nullable=False)
    enterprise_net: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="calculated")
    paid_at: Mapped[str | None] = mapped_column(DateTime(timezone=True), nullable=True)
    auto_deducted_from_loan: Mapped[bool | None] = mapped_column(Boolean, nullable=True)


# ECO-03
class CreditApplicationORM(Base, IdMixin, TenantMixin, TimestampMixin):
    """信贷申报书."""

    __tablename__ = "credit_applications"
    enterprise_id: Mapped[str] = mapped_column(String(64), ForeignKey("enterprises.id"), nullable=False, index=True)
    bank_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    pdf_url: Mapped[str] = mapped_column(String(500), nullable=False)
    pdf_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    tier: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")
    bank_received_at: Mapped[str | None] = mapped_column(DateTime(timezone=True), nullable=True)
    bank_acknowledgement: Mapped[str | None] = mapped_column(Text, nullable=True)


# ECO-04
class CredentialORM(Base, IdMixin, TenantMixin, TimestampMixin):
    """联盟链凭证."""

    __tablename__ = "credentials"
    enterprise_id: Mapped[str] = mapped_column(String(64), ForeignKey("enterprises.id"), nullable=False, index=True)
    type: Mapped[str] = mapped_column(String(50), nullable=False)
    issuer: Mapped[str] = mapped_column(String(64), nullable=False)
    issuance_date: Mapped[str] = mapped_column(DateTime(timezone=True), nullable=False)
    expiration_date: Mapped[str] = mapped_column(DateTime(timezone=True), nullable=False)
    credential_subject: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    proof: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")


# ECO-05
class TenderORM(Base, IdMixin, TenantMixin, TimestampMixin):
    """融资标书."""

    __tablename__ = "tenders"
    enterprise_id: Mapped[str] = mapped_column(String(64), ForeignKey("enterprises.id"), nullable=False, index=True)
    enterprise_name: Mapped[str] = mapped_column(String(200), nullable=False)
    amount: Mapped[int] = mapped_column(Integer, nullable=False)
    term_months: Mapped[int] = mapped_column(Integer, nullable=False)
    rate_floor: Mapped[float] = mapped_column(Numeric(8, 4), nullable=False)
    rate_floor_label: Mapped[str] = mapped_column(String(50), nullable=False)
    purpose: Mapped[str] = mapped_column(Text, nullable=False, default="")
    credential_ref: Mapped[str | None] = mapped_column(String(64), nullable=True)
    profile_summary: Mapped[str] = mapped_column(Text, nullable=False, default="")
    published_at: Mapped[str] = mapped_column(DateTime(timezone=True), nullable=False)
    deadline: Mapped[str] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="published", index=True)
    invited_bank_ids: Mapped[dict] = mapped_column(JSON, nullable=False, default=list)
    winner_bid_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    chain_evidence: Mapped[dict] = mapped_column(JSON, nullable=False, default=list)


class BankBidORM(Base, IdMixin, TenantMixin, TimestampMixin):
    """银行出价."""

    __tablename__ = "bank_bids"
    tender_id: Mapped[str] = mapped_column(String(64), ForeignKey("tenders.id"), nullable=False, index=True)
    bank_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    bank_name: Mapped[str] = mapped_column(String(200), nullable=False)
    bank_group: Mapped[str | None] = mapped_column(String(100), nullable=True)
    rate: Mapped[float] = mapped_column(Numeric(8, 4), nullable=False)
    amount: Mapped[int] = mapped_column(Integer, nullable=False)
    term_months: Mapped[int] = mapped_column(Integer, nullable=False)
    time_to_fund_days: Mapped[int] = mapped_column(Integer, nullable=False)
    conditions: Mapped[str] = mapped_column(Text, nullable=False, default="")
    submitted_at: Mapped[str] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    is_fraudulent: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    fraud_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    signed_hash: Mapped[str] = mapped_column(String(128), nullable=False)


# ECO-06
class WorkerAccountORM(Base, IdMixin, TenantMixin, TimestampMixin):
    """工人账户."""

    __tablename__ = "worker_accounts"
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    # APP-02: 工人登录工号 (与 enterprise_code 组合登录, sub 用本表 id)
    worker_no: Mapped[str] = mapped_column(String(20), unique=True, nullable=False, default="", comment="工号 (工人登录)")
    role: Mapped[str] = mapped_column(String(50), nullable=False)
    enterprise_id: Mapped[str] = mapped_column(String(64), ForeignKey("enterprises.id"), nullable=False, index=True)
    device_fp: Mapped[str] = mapped_column(String(100), nullable=False, comment="设备指纹")
    balances: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict, comment="信用/碳/信易分")
    streak_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    monthly_consumption: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class ExchangeOrderORM(Base, IdMixin, TenantMixin, TimestampMixin):
    """兑换订单."""

    __tablename__ = "exchange_orders"
    worker_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    item_id: Mapped[str] = mapped_column(String(64), nullable=False)
    item_name: Mapped[str] = mapped_column(String(200), nullable=False)
    credit_cost: Mapped[int] = mapped_column(Integer, nullable=False)
    currency_cost: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    placed_at: Mapped[str] = mapped_column(DateTime(timezone=True), nullable=False)
    shipped_at: Mapped[str | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ShopItemORM(Base, IdMixin, TimestampMixin):
    """商品库."""

    __tablename__ = "shop_items"
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    icon: Mapped[str] = mapped_column(String(20), nullable=False, default="")
    credit_cost: Mapped[int] = mapped_column(Integer, nullable=False)
    currency_cost: Mapped[int] = mapped_column(Integer, nullable=False)
    stock: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    category: Mapped[str] = mapped_column(String(20), nullable=False)


# ECO-07
class ComplianceIndexORM(Base, IdMixin, TenantMixin, TimestampMixin):
    """行业合规指数快照."""

    __tablename__ = "compliance_indices"
    type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    industry: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    period: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    value: Mapped[float] = mapped_column(Numeric(10, 4), nullable=False)
    sample_size: Mapped[int] = mapped_column(Integer, nullable=False)
    methodology: Mapped[str] = mapped_column(Text, nullable=False)
    signature: Mapped[str] = mapped_column(String(128), nullable=False)


# ECO-08
class GovReportORM(Base, IdMixin, TenantMixin, TimestampMixin):
    """政府报告."""

    __tablename__ = "gov_reports"
    type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    enterprise_id: Mapped[str] = mapped_column(String(64), ForeignKey("enterprises.id"), nullable=False, index=True)
    enterprise: Mapped[str] = mapped_column(String(200), nullable=False, comment="企业名 (冗余, project_memory)")
    source: Mapped[str] = mapped_column(String(50), nullable=False, comment="来源 (project_memory)")
    content: Mapped[str] = mapped_column(Text, nullable=False)
    desensitized_level: Mapped[str] = mapped_column(String(20), nullable=False, default="full")
    submitted_at: Mapped[str] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft", index=True)
    regulator_ack: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class GovEndorsementORM(Base, IdMixin, TenantMixin, TimestampMixin):
    """政府背书."""

    __tablename__ = "gov_endorsements"
    enterprise_id: Mapped[str] = mapped_column(String(64), ForeignKey("enterprises.id"), nullable=False, index=True)
    regulator: Mapped[str] = mapped_column(String(200), nullable=False)
    level: Mapped[str] = mapped_column(String(20), nullable=False, default="provisional")
    granted_at: Mapped[str] = mapped_column(DateTime(timezone=True), nullable=False)
    valid_until: Mapped[str] = mapped_column(DateTime(timezone=True), nullable=False)
    scope: Mapped[dict] = mapped_column(JSON, nullable=False, default=list)
    linked_report_id: Mapped[str] = mapped_column(String(64), ForeignKey("gov_reports.id"), nullable=False)


# ECO-09
class BotConversationORM(Base, IdMixin, TenantMixin, TimestampMixin):
    """数字分身会话."""

    __tablename__ = "bot_conversations"
    enterprise_id: Mapped[str] = mapped_column(String(64), ForeignKey("enterprises.id"), nullable=False, index=True)
    worker_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    channel: Mapped[str] = mapped_column(String(20), nullable=False)
    messages: Mapped[dict] = mapped_column(JSON, nullable=False, default=list)
    last_active_at: Mapped[str] = mapped_column(DateTime(timezone=True), nullable=False)


class BotConfigORM(Base, IdMixin, TenantMixin, TimestampMixin):
    """数字分身配置."""

    __tablename__ = "bot_configs"
    enterprise_id: Mapped[str] = mapped_column(String(64), ForeignKey("enterprises.id"), nullable=False, unique=True)
    bot_name: Mapped[str] = mapped_column(String(100), nullable=False)
    avatar: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    channels: Mapped[dict] = mapped_column(JSON, nullable=False, default=list)
    default_language: Mapped[str] = mapped_column(String(10), nullable=False, default="zh-CN")
    llm_model: Mapped[str] = mapped_column(String(50), nullable=False, default="deepseek-v3")
    enabled_intents: Mapped[dict] = mapped_column(JSON, nullable=False, default=list)
    rate_limit_per_min: Mapped[int] = mapped_column(Integer, nullable=False, default=60)


# APP-02 Task 11: 异步上链重试队列
class StampRetryQueueORM(Base, IdMixin, TimestampMixin):
    """异步上链存证重试队列.

    schedule: APScheduler 每 10 分钟扫描 status='pending' AND retry_count<3,
              成功 → status='done', 失败重试 → retry_count+=1, 3 次失败 → status='abandoned'.
    """

    __tablename__ = "stamp_retry_queue"
    award_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True, comment="关联的 awardId")
    evidence_hash: Mapped[str] = mapped_column(String(64), nullable=False, comment="证据 SHA-256")
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    next_retry_at: Mapped[str | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending", index=True,
        comment="pending / done / abandoned",
    )
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True, comment="最近一次失败原因")
