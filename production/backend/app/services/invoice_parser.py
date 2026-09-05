"""DATA-03 发票解析服务 (R1.3).

设计:
    - 识别发票代码/号码/日期/购销双方/商品条目
    - ocr_text 为空时返回 seed 样本:
        - seed_no=1 (默认): 增值税专票 1 张 3 商品条目
        - seed_no=2: 电子普票 1 张 1 条目
"""

from __future__ import annotations

import re
from datetime import datetime

from app.schemas.parsers import (
    InvoiceItem, InvoiceParseResult, OcrRequest,
)
from app.services.ocr_service import OcrService, ocr_service


# ============================================================================
# 内置 seed 样本 (2 张发票)
# ============================================================================

_SEED_SAMPLES: dict[int, InvoiceParseResult] = {}


def _iso(y: int, m: int, d: int) -> str:
    return datetime(y, m, d).isoformat() + "+00:00"


def _init_seed_samples() -> None:
    """初始化 2 张确定性 seed 发票样本."""

    _SEED_SAMPLES[1] = InvoiceParseResult(
        invoice_type="vat_special",
        invoice_code="044002600311",
        invoice_no="00283901",
        invoice_date_iso=_iso(2026, 1, 25),
        seller_name="深圳科创电子有限公司",
        seller_tax_id="91440300MA5DABCDE1",
        buyer_name="广州供应链集团股份有限公司",
        buyer_tax_id="91440100MA9KFGHIJ2",
        total_amount_cents=1_000_000_00,
        total_tax_cents=130_000_00,
        grand_total_cents=1_130_000_00,
        parse_confidence=0.96,
        warnings=[],
        items=[
            InvoiceItem(
                name="智能控制模块 IC-2000",
                specification="IC-2000-V3",
                unit="件",
                quantity=500.0,
                unit_price_cents=800_00,
                amount_cents=400_000_00,
                tax_rate=0.13,
                tax_cents=52_000_00,
            ),
            InvoiceItem(
                name="工业传感器套件 SEN-500",
                specification="SEN-500-PRO",
                unit="套",
                quantity=200.0,
                unit_price_cents=1_500_00,
                amount_cents=300_000_00,
                tax_rate=0.13,
                tax_cents=39_000_00,
            ),
            InvoiceItem(
                name="嵌入式主板 MB-X8",
                specification="MB-X8-64G",
                unit="块",
                quantity=60.0,
                unit_price_cents=5_000_00,
                amount_cents=300_000_00,
                tax_rate=0.13,
                tax_cents=39_000_00,
            ),
        ],
    )

    _SEED_SAMPLES[2] = InvoiceParseResult(
        invoice_type="electronic",
        invoice_code="044002100111",
        invoice_no="00982765",
        invoice_date_iso=_iso(2026, 1, 28),
        seller_name="深圳顺丰速运有限公司",
        seller_tax_id="91440300MA7FSPEED3",
        buyer_name="深圳科创电子有限公司",
        buyer_tax_id="91440300MA5DABCDE1",
        total_amount_cents=7_547_17,
        total_tax_cents=679_23,
        grand_total_cents=8_226_40,
        parse_confidence=0.94,
        warnings=["电子普票, 税额小数点自动四舍五入"],
        items=[
            InvoiceItem(
                name="物流运输服务费 (1月)",
                specification="国内标快 32 票",
                unit="票",
                quantity=32.0,
                unit_price_cents=235_85,
                amount_cents=7_547_17,
                tax_rate=0.09,
                tax_cents=679_23,
            ),
        ],
    )


_init_seed_samples()


# ============================================================================
# 解析正则
# ============================================================================

_CODE_PATTERNS = [
    re.compile(r"发票代码[:：]?\s*(\d{10,14})"),
]

_NO_PATTERNS = [
    re.compile(r"发票号码[:：]?\s*(\d{6,10})"),
]

_DATE_PATTERNS = [
    re.compile(r"开票日期[:：]?\s*(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})"),
]

_SELLER_NAME_PATTERNS = [
    re.compile(r"(?:销售方|销方|卖方)[:：]?\s*(?:名称)?[:：]?\s*([^\s\n\r，,;；]{2,40})"),
]

_SELLER_TAX_PATTERNS = [
    re.compile(r"(?:销售方|销方|卖方)[^\n\r]{0,20}(?:纳税人识别号|税号)[:：]?\s*([0-9A-Z]{15,20})"),
]

_BUYER_NAME_PATTERNS = [
    re.compile(r"(?:购买方|购方|买方)[:：]?\s*(?:名称)?[:：]?\s*([^\s\n\r，,;；]{2,40})"),
]

_BUYER_TAX_PATTERNS = [
    re.compile(r"(?:购买方|购方|买方)[^\n\r]{0,20}(?:纳税人识别号|税号)[:：]?\s*([0-9A-Z]{15,20})"),
]

_GRAND_TOTAL_PATTERNS = [
    re.compile(r"价税合计[^\n\r]{0,30}([\d,，]+\.\d{2})"),
    re.compile(r"小写[^\n\r]{0,10}¥\s*([\d,，]+\.\d{2})"),
]

_TOTAL_AMOUNT_PATTERNS = [
    re.compile(r"(?:合计金额|金额合计|不含税金额)[^\n\r]{0,30}([\d,，]+\.\d{2})"),
]

_TOTAL_TAX_PATTERNS = [
    re.compile(r"(?:合计税额|税额合计)[^\n\r]{0,30}([\d,，]+\.\d{2})"),
]


def _parse_amount(text: str, patterns: list[re.Pattern]) -> int:
    """解析金额 (元转分)."""
    for pat in patterns:
        m = pat.search(text)
        if m:
            try:
                amt = float(m.group(1).replace(",", "").replace("，", ""))
                return int(round(amt * 100))
            except ValueError:
                continue
    return 0


def _parse_invoice_date(text: str) -> str:
    for pat in _DATE_PATTERNS:
        m = pat.search(text)
        if m:
            try:
                dt = datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)))
                return dt.isoformat() + "+00:00"
            except ValueError:
                continue
    return ""


def _first_match(patterns: list[re.Pattern], text: str) -> str:
    for pat in patterns:
        m = pat.search(text)
        if m:
            return m.group(1).strip()
    return ""


def _detect_invoice_type(text: str) -> str:
    if "专票" in text or "专用发票" in text or "vat_special" in text.lower():
        return "vat_special"
    if "电子" in text or "electronic" in text.lower():
        return "electronic"
    return "vat_general"


def _parse_items(text: str) -> list[InvoiceItem]:
    """从文本中解析商品条目 (简化实现)."""
    items: list[InvoiceItem] = []
    lines = [l.strip() for l in text.splitlines() if l.strip()]

    qty_pattern = re.compile(r"(\d+(?:\.\d+)?)")
    money_pattern = re.compile(r"(\d{1,3}(?:,\d{3})*\.\d{2})")
    rate_pattern = re.compile(r"(\d+(?:\.\d+)?)\s*%")

    item_buffer: list[str] = []
    for line in lines:
        if any(kw in line for kw in ["名称", "规格", "单位", "数量", "单价", "金额", "税率", "税额"]):
            if item_buffer:
                items.append(_make_item_from_lines(item_buffer, qty_pattern, money_pattern, rate_pattern))
                item_buffer = []
            continue
        if any(kw in line for kw in ["合计", "价税", "销售方", "购买方", "备注"]):
            if item_buffer:
                items.append(_make_item_from_lines(item_buffer, qty_pattern, money_pattern, rate_pattern))
                item_buffer = []
            continue
        item_buffer.append(line)
        if len(item_buffer) >= 3 and money_pattern.search(line):
            items.append(_make_item_from_lines(item_buffer, qty_pattern, money_pattern, rate_pattern))
            item_buffer = []

    if item_buffer:
        items.append(_make_item_from_lines(item_buffer, qty_pattern, money_pattern, rate_pattern))

    return [i for i in items if i.name and i.amount_cents > 0]


def _make_item_from_lines(
    lines: list[str],
    qty_pat: re.Pattern,
    money_pat: re.Pattern,
    rate_pat: re.Pattern,
) -> InvoiceItem:
    text = " ".join(lines)
    moneys = [
        int(round(float(m.replace(",", "")) * 100))
        for m in money_pat.findall(text)
    ]
    unit_price = moneys[0] if len(moneys) >= 1 else 0
    amount = moneys[1] if len(moneys) >= 2 else (moneys[0] if moneys else 0)
    tax_cents = moneys[2] if len(moneys) >= 3 else 0

    qty_match = qty_pat.search(text)
    qty = float(qty_match.group(1)) if qty_match else 0.0

    rate_match = rate_pat.search(text)
    tax_rate = round(float(rate_match.group(1)) / 100.0, 4) if rate_match else 0.13

    name = lines[0] if lines else ""
    spec = ""
    unit = ""
    if len(lines) >= 2:
        spec = lines[1]
    if len(lines) >= 3:
        unit = lines[2]

    return InvoiceItem(
        name=name,
        specification=spec,
        unit=unit,
        quantity=qty,
        unit_price_cents=unit_price,
        amount_cents=amount,
        tax_rate=tax_rate,
        tax_cents=tax_cents,
    )


def _select_seed(seed_no: int) -> InvoiceParseResult:
    """根据 seed_no 选发票样本, 默认 1 (增值税专票)."""
    try:
        no = int(seed_no) if seed_no else 1
    except (ValueError, TypeError):
        no = 1
    return _SEED_SAMPLES.get(no, _SEED_SAMPLES[1])


class InvoiceParserService:
    """发票解析服务."""

    def __init__(self, ocr_svc: OcrService | None = None) -> None:
        self.ocr_svc = ocr_svc or ocr_service

    def parse_text(
        self, ocr_text: str, seed_no: int = 1,
    ) -> InvoiceParseResult:
        """识别发票核心字段.

        - 识别发票代码/号码/日期/购销双方/商品条目
        - ocr_text 为空时返回 seed 样本
        """
        if not ocr_text or not ocr_text.strip():
            return _select_seed(seed_no)

        warnings: list[str] = []

        invoice_type = _detect_invoice_type(ocr_text)
        invoice_code = _first_match(_CODE_PATTERNS, ocr_text)
        invoice_no = _first_match(_NO_PATTERNS, ocr_text)
        invoice_date = _parse_invoice_date(ocr_text)

        seller_name = _first_match(_SELLER_NAME_PATTERNS, ocr_text)
        seller_tax_id = _first_match(_SELLER_TAX_PATTERNS, ocr_text)
        buyer_name = _first_match(_BUYER_NAME_PATTERNS, ocr_text)
        buyer_tax_id = _first_match(_BUYER_TAX_PATTERNS, ocr_text)

        total_amount = _parse_amount(ocr_text, _TOTAL_AMOUNT_PATTERNS)
        total_tax = _parse_amount(ocr_text, _TOTAL_TAX_PATTERNS)
        grand_total = _parse_amount(ocr_text, _GRAND_TOTAL_PATTERNS)

        items = _parse_items(ocr_text)

        if not items:
            warnings.append("未识别到商品条目明细")
        if not grand_total and items:
            sum_amt = sum(i.amount_cents for i in items)
            sum_tax = sum(i.tax_cents for i in items)
            grand_total = sum_amt + sum_tax
            total_amount = sum_amt
            total_tax = sum_tax
        if grand_total != total_amount + total_tax:
            warnings.append(
                f"价税合计 {grand_total} 与 金额+税额 {total_amount + total_tax} 存在差异, 已按条目和校准"
            )
            total_amount = sum(i.amount_cents for i in items) or total_amount
            total_tax = sum(i.tax_cents for i in items) or total_tax
            grand_total = total_amount + total_tax

        extracted = sum(1 for x in [
            invoice_code, invoice_no, invoice_date,
            seller_name, seller_tax_id, buyer_name, buyer_tax_id,
            grand_total,
        ] if x)
        parse_confidence = round(min(1.0, extracted / 8.0 + 0.15 + (0.1 if items else 0)), 4)

        return InvoiceParseResult(
            invoice_type=invoice_type,
            invoice_code=invoice_code,
            invoice_no=invoice_no,
            invoice_date_iso=invoice_date,
            seller_name=seller_name,
            seller_tax_id=seller_tax_id,
            buyer_name=buyer_name,
            buyer_tax_id=buyer_tax_id,
            items=items,
            total_amount_cents=total_amount,
            total_tax_cents=total_tax,
            grand_total_cents=grand_total,
            parse_confidence=parse_confidence,
            warnings=warnings,
        )

    async def parse_request(
        self, ocr_req: OcrRequest, seed_no: int = 1,
    ) -> InvoiceParseResult:
        """先调用 OcrService 再 parse_text.

        base64_content 为空时 (MOCK seed 模式), 直接返回 seed 样本.
        """
        if not ocr_req.base64_content.strip():
            return self.parse_text("", seed_no=seed_no)
        ocr_result = await self.ocr_svc.ocr(ocr_req)
        full_text = "\n".join(b.text for b in ocr_result.blocks)
        return self.parse_text(full_text, seed_no=seed_no)


invoice_parser = InvoiceParserService()
