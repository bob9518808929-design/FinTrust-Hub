"""第三方数据源接入 schemas (DATA-02).

设计依据: ROADMAP R1.2 DATA-02 第三方数据源接入.
数据源类型:
    INVOICE_VERIFIER    国税总局发票查验
    GSXT                国家企业信用信息公示系统 (工商信息)
    JUDICIARY           司法信息 (中国裁判文书网 / 执行信息公开网)
    ECDS                电子商业汇票系统 (票据信息)

字段命名: snake_case (PEP 8), 通过 alias_generator 自动转 camelCase 与前端契约对齐.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.schemas.common import AmountInCents, ApiResult, Id, IsoTimestamp

# === 枚举 ===

class DataSourceType(StrEnum):
    """第三方数据源类型."""
    INVOICE_VERIFIER = "INVOICE_VERIFIER"
    GSXT = "GSXT"
    JUDICIARY = "JUDICIARY"
    ECDS = "ECDS"


class AdapterHealthStatus(StrEnum):
    """适配器健康状态 (三档)."""
    OK = "ok"
    DEGRADED = "degraded"
    FAILED = "failed"


InvoiceStatus = Literal["valid", "voided", "reused"]
CaseType = Literal["civil", "criminal", "administrative"]
BillType = Literal["bank_acceptance", "commercial_acceptance"]
BillStatus = Literal["issued", "accepted", "discounted", "paid", "dishonored"]
BillRole = Literal["drawer", "drawee", "holder"]


# === 基础 mixin (snake_case + camelCase alias) ===

class _ExternalDataBase(BaseModel):
    """外部数据 schema 公共配置: snake_case 字段 + camelCase alias + 双向填充."""
    model_config = ConfigDict(
        populate_by_name=True,
        alias_generator=to_camel,
        use_enum_values=True,
    )


# === 适配器健康检查 ===

class AdapterHealth(_ExternalDataBase):
    """适配器健康状态."""
    status: AdapterHealthStatus = Field(description="健康状态 ok/degraded/failed")
    latency_ms: int = Field(ge=0, description="平均延迟 (毫秒)")
    last_checked_at: IsoTimestamp = Field(description="最近检查时间")


# === 发票查验 ===

class InvoiceVerifyRequest(_ExternalDataBase):
    """发票查验请求."""
    invoice_code: str = Field(description="发票代码")
    invoice_no: str = Field(description="发票号码")
    invoice_date_iso: IsoTimestamp = Field(description="开票日期 (ISO)")
    tax_amount_cents: AmountInCents = Field(description="税额 (分)")
    enterprise_id: Id = Field(description="申请查验的企业 ID")


class InvoiceVerifyResult(_ExternalDataBase):
    """发票查验结果."""
    verified: bool = Field(description="是否查验通过")
    invoice_status: InvoiceStatus = Field(description="发票状态 valid/voided/reused")
    verify_time_iso: IsoTimestamp = Field(description="查验时间 (ISO)")
    source: DataSourceType = Field(default=DataSourceType.INVOICE_VERIFIER, description="数据来源")


# === 工商信息 (GSXT) ===

class GSXTEnterpriseInfo(_ExternalDataBase):
    """GSXT 企业工商信息."""
    enterprise_id: Id = Field(description="企业 ID")
    enterprise_name: str = Field(description="企业名称")
    uscc: str = Field(description="统一社会信用代码")
    register_status: str = Field(description="登记状态 (存续/注销/吊销等)")
    register_capital_cents: AmountInCents = Field(description="注册资本 (分)")
    legal_representative: str = Field(description="法定代表人")
    industry_code: str = Field(description="行业代码")
    founded_date_iso: IsoTimestamp = Field(description="成立日期 (ISO)")
    abnormal_operations: list[str] = Field(default_factory=list, description="经营异常记录列表")


# === 司法信息 ===

class JudiciaryCaseRecord(_ExternalDataBase):
    """司法案件记录."""
    case_id: Id = Field(description="案件 ID")
    enterprise_id: Id = Field(description="企业 ID")
    case_type: CaseType = Field(description="案件类型 civil/criminal/administrative")
    court: str = Field(description="审理法院")
    case_status: str = Field(description="案件状态")
    filing_date_iso: IsoTimestamp = Field(description="立案日期 (ISO)")
    amount_cents: AmountInCents = Field(description="涉案金额 (分)")
    summary: str = Field(description="案件摘要")


# === 电子商业汇票 (ECDS) ===

class ECDSBillRecord(_ExternalDataBase):
    """ECDS 电子商业汇票记录."""
    bill_id: Id = Field(description="票据 ID")
    bill_type: BillType = Field(description="票据类型 bank_acceptance/commercial_acceptance")
    bill_no: str = Field(description="票据号码")
    drawer_enterprise_id: Id = Field(description="出票人企业 ID")
    drawee_enterprise_id: Id = Field(description="付款人企业 ID")
    acceptor_bank: str = Field(description="承兑银行")
    amount_cents: AmountInCents = Field(description="票面金额 (分)")
    issue_date_iso: IsoTimestamp = Field(description="出票日期 (ISO)")
    due_date_iso: IsoTimestamp = Field(description="到期日期 (ISO)")
    status: BillStatus = Field(description="票据状态 issued/accepted/discounted/paid/dishonored")


__all__ = [
    "AdapterHealth",
    "AdapterHealthStatus",
    "AmountInCents",
    "ApiResult",
    "BillRole",
    "BillStatus",
    "BillType",
    "CaseType",
    "DataSourceType",
    "ECDSBillRecord",
    "GSXTEnterpriseInfo",
    "Id",
    "InvoiceStatus",
    "InvoiceVerifyRequest",
    "InvoiceVerifyResult",
    "IsoTimestamp",
    "JudiciaryCaseRecord",
]
