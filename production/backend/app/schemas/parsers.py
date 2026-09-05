"""DATA-03 OCR 与文档解析 schemas (R1.3).

字段命名: snake_case (PEP 8), 通过 alias_generator 自动转 camelCase 与前端契约对齐.
"""

from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.schemas.common import AmountInCents, IsoTimestamp, Ratio


# === 基础 mixin (snake_case + camelCase alias) ===

class _ParserBase(BaseModel):
    """Parser schema 公共配置: snake_case 字段 + camelCase alias + 双向填充."""
    model_config = ConfigDict(
        populate_by_name=True,
        alias_generator=to_camel,
        use_enum_values=True,
    )


# === 适配器健康状态 (内联简化版本, schemas.external_data 不存在时使用) ===

class AdapterHealth(_ParserBase):
    """外部适配器健康状态."""
    status: Literal["online", "offline", "degraded"] = Field(description="状态 online/offline/degraded")
    latency_ms: int = Field(default=0, ge=0, description="延迟 (毫秒)")
    last_checked_at: IsoTimestamp = Field(description="最近检查时间 ISO")


# === OCR 枚举 ===

class OcrEngine(str, Enum):
    """OCR 引擎枚举 (PaddleOCR / 百度 / 阿里 + Mock 兜底)."""
    PADDLE = "PADDLE"
    BAIDU = "BAIDU"
    ALI = "ALI"
    MOCK = "MOCK"


SourceType = Literal["pdf", "image_png", "image_jpg"]
TxDirection = Literal["in", "out"]
InvoiceType = Literal["vat_special", "vat_general", "electronic"]


# === OCR 请求/响应 ===

class OcrRequest(_ParserBase):
    """OCR 识别请求."""
    source_type: SourceType = Field(description="源文件类型 pdf/image_png/image_jpg")
    base64_content: str = Field(default="", description="Base64 编码的文件内容 (MOCK 可空)")
    engine_preference: OcrEngine = Field(default=OcrEngine.MOCK, description="首选引擎")
    dpi: int = Field(default=300, ge=72, le=600, description="DPI (PDF 渲染用)")


class OcrBlock(_ParserBase):
    """OCR 文本块 (页面 + 位置 + 文本 + 置信度)."""
    page_no: int = Field(ge=1, description="页码 (从 1 开始)")
    bbox: list[float] = Field(description="边界框 [x1, y1, x2, y2] (4 项, 相对坐标 0-1)")
    text: str = Field(description="识别文本")
    confidence: Ratio = Field(description="置信度 0-1")


class OcrResult(_ParserBase):
    """OCR 识别结果."""
    engine_used: OcrEngine = Field(description="实际使用的引擎 (考虑 fallback)")
    text_length: int = Field(ge=0, description="总文本字符数")
    confidence_avg: Ratio = Field(description="平均置信度 0-1")
    pages: int = Field(ge=1, description="总页数")
    blocks: list[OcrBlock] = Field(default_factory=list, description="OCR 文本块列表")


# === 银行流水解析 ===

class BankStatementRecord(_ParserBase):
    """银行流水单条交易记录."""
    tx_date_iso: IsoTimestamp = Field(description="交易日期 ISO")
    amount_cents: AmountInCents = Field(description="交易金额 (分)")
    direction: TxDirection = Field(description="资金方向 in=收入 / out=支出")
    counterparty_name: str = Field(default="", description="对方账户名称")
    counterparty_account: str = Field(default="", description="对方账号")
    purpose: str = Field(default="", description="用途/摘要")
    balance_cents_after: AmountInCents = Field(default=0, description="交易后余额 (分)")
    raw_text: str = Field(default="", description="原始 OCR 文本行")


class BankStatementParseResult(_ParserBase):
    """银行流水解析结果."""
    account_no_masked: str = Field(default="", description="脱敏后账号")
    statement_start_iso: IsoTimestamp = Field(default="", description="流水起始日期")
    statement_end_iso: IsoTimestamp = Field(default="", description="流水结束日期")
    opening_balance_cents: AmountInCents = Field(default=0, description="期初余额 (分)")
    closing_balance_cents: AmountInCents = Field(default=0, description="期末余额 (分)")
    total_credits_count: int = Field(default=0, ge=0, description="贷方笔数 (收入)")
    total_debits_count: int = Field(default=0, ge=0, description="借方笔数 (支出)")
    records: list[BankStatementRecord] = Field(default_factory=list, description="交易记录列表")
    parse_confidence: Ratio = Field(default=0.0, description="解析置信度 0-1")
    errors: list[str] = Field(default_factory=list, description="解析错误/警告列表")


# === 合同解析 ===

class ContractParseResult(_ParserBase):
    """合同解析结果."""
    contract_no: str = Field(default="", description="合同编号")
    party_a_name: str = Field(default="", description="甲方名称")
    party_b_name: str = Field(default="", description="乙方名称")
    amount_cents: AmountInCents = Field(default=0, description="合同金额 (分)")
    signed_date_iso: IsoTimestamp = Field(default="", description="签约日期")
    effective_date_iso: IsoTimestamp = Field(default="", description="生效日期")
    expiry_date_iso: IsoTimestamp = Field(default="", description="到期日期")
    governing_law: str = Field(default="", description="适用法律")
    dispute_resolution: str = Field(default="", description="争议解决方式")
    key_obligations: list[str] = Field(default_factory=list, description="关键义务条款列表")
    risks_flagged: list[str] = Field(default_factory=list, description="识别的风险点列表")
    parse_confidence: Ratio = Field(default=0.0, description="解析置信度 0-1")


# === 发票解析 ===

class InvoiceItem(_ParserBase):
    """发票商品条目."""
    name: str = Field(description="商品/服务名称")
    specification: str = Field(default="", description="规格型号")
    unit: str = Field(default="", description="单位")
    quantity: float = Field(default=0.0, ge=0, description="数量")
    unit_price_cents: AmountInCents = Field(default=0, description="单价 (分)")
    amount_cents: AmountInCents = Field(default=0, description="金额 (分)")
    tax_rate: Ratio = Field(default=0.0, description="税率 0-1 (如 0.13 = 13%)")
    tax_cents: AmountInCents = Field(default=0, description="税额 (分)")


class InvoiceParseResult(_ParserBase):
    """发票解析结果."""
    invoice_type: InvoiceType = Field(default="vat_general", description="发票类型 vat_special/vat_general/electronic")
    invoice_code: str = Field(default="", description="发票代码")
    invoice_no: str = Field(default="", description="发票号码")
    invoice_date_iso: IsoTimestamp = Field(default="", description="开票日期")
    seller_name: str = Field(default="", description="销售方名称")
    seller_tax_id: str = Field(default="", description="销售方纳税人识别号")
    buyer_name: str = Field(default="", description="购买方名称")
    buyer_tax_id: str = Field(default="", description="购买方纳税人识别号")
    items: list[InvoiceItem] = Field(default_factory=list, description="商品条目列表")
    total_amount_cents: AmountInCents = Field(default=0, description="合计金额 (不含税, 分)")
    total_tax_cents: AmountInCents = Field(default=0, description="合计税额 (分)")
    grand_total_cents: AmountInCents = Field(default=0, description="价税合计 (分)")
    parse_confidence: Ratio = Field(default=0.0, description="解析置信度 0-1")
    warnings: list[str] = Field(default_factory=list, description="解析警告列表")


__all__ = [
    "AdapterHealth",
    "OcrEngine",
    "SourceType",
    "TxDirection",
    "InvoiceType",
    "OcrRequest",
    "OcrBlock",
    "OcrResult",
    "BankStatementRecord",
    "BankStatementParseResult",
    "ContractParseResult",
    "InvoiceItem",
    "InvoiceParseResult",
]
