"""DATA-03 银行流水解析服务 (R1.3).

设计:
    - 正则解析交易行, 按 借/贷/C/ 或 收入/支出 识别方向
    - 无法匹配时降级返回 0 条 + warning
    - 内置 3 条确定性银行流水样本 (工行/建行/招行), ocr_text 为空时返回 seed 样本
"""

from __future__ import annotations

import re
from datetime import datetime

from app.schemas.parsers import (
    BankStatementParseResult,
    BankStatementRecord,
    OcrRequest,
)
from app.services.ocr_service import OcrService, ocr_service

# ============================================================================
# 内置 seed 样本 (3 家银行)
# ============================================================================

_SEED_SAMPLES: dict[str, BankStatementParseResult] = {}


def _init_seed_samples() -> None:
    """初始化 3 家银行确定性 seed 样本."""

    _SEED_SAMPLES["ICBC"] = BankStatementParseResult(
        account_no_masked="6222 **** 8899",
        statement_start_iso="2026-01-01T00:00:00+00:00",
        statement_end_iso="2026-01-31T23:59:59+00:00",
        opening_balance_cents=500_000_00,
        closing_balance_cents=1_885_600_00,
        total_credits_count=5,
        total_debits_count=4,
        parse_confidence=0.92,
        errors=[],
        records=[
            BankStatementRecord(
                tx_date_iso="2026-01-15T00:00:00+00:00",
                amount_cents=500_000_00,
                direction="in",
                counterparty_name="广州供应链集团",
                counterparty_account="4403 0123 4567",
                purpose="货款",
                balance_cents_after=1_280_500_00,
                raw_text="2026-01-15 贷 500,000.00 广州供应链集团 货款 余额 1,280,500.00",
            ),
            BankStatementRecord(
                tx_date_iso="2026-01-16T00:00:00+00:00",
                amount_cents=35_000_00,
                direction="out",
                counterparty_name="深圳市税务局",
                counterparty_account="4403 9988 7766",
                purpose="增值税缴纳",
                balance_cents_after=1_245_500_00,
                raw_text="2026-01-16 借 35,000.00 深圳市税务局 增值税 余额 1,245,500.00",
            ),
            BankStatementRecord(
                tx_date_iso="2026-01-17T00:00:00+00:00",
                amount_cents=128_600_00,
                direction="in",
                counterparty_name="杭州智造机械有限公司",
                counterparty_account="3301 2233 4455",
                purpose="设备采购款",
                balance_cents_after=1_374_100_00,
                raw_text="2026-01-17 贷 128,600.00 杭州智造机械 设备款 余额 1,374,100.00",
            ),
            BankStatementRecord(
                tx_date_iso="2026-01-18T00:00:00+00:00",
                amount_cents=8_200_00,
                direction="out",
                counterparty_name="顺丰速运",
                counterparty_account="7559 1122 3344",
                purpose="物流运费",
                balance_cents_after=1_365_900_00,
                raw_text="2026-01-18 借 8,200.00 顺丰速运 运费 余额 1,365,900.00",
            ),
            BankStatementRecord(
                tx_date_iso="2026-01-19T00:00:00+00:00",
                amount_cents=350_000_00,
                direction="in",
                counterparty_name="上海贸易有限公司",
                counterparty_account="3101 5566 7788",
                purpose="货款",
                balance_cents_after=1_715_900_00,
                raw_text="2026-01-19 贷 350,000.00 上海贸易 货款 余额 1,715,900.00",
            ),
            BankStatementRecord(
                tx_date_iso="2026-01-20T00:00:00+00:00",
                amount_cents=120_000_00,
                direction="out",
                counterparty_name="东莞原材料厂",
                counterparty_account="4419 8899 0011",
                purpose="原材料采购",
                balance_cents_after=1_595_900_00,
                raw_text="2026-01-20 借 120,000.00 东莞原材料厂 采购 余额 1,595,900.00",
            ),
            BankStatementRecord(
                tx_date_iso="2026-01-21T00:00:00+00:00",
                amount_cents=95_500_00,
                direction="in",
                counterparty_name="北京科技公司",
                counterparty_account="1101 2233 4455",
                purpose="技术服务费",
                balance_cents_after=1_691_400_00,
                raw_text="2026-01-21 贷 95,500.00 北京科技 服务费 余额 1,691,400.00",
            ),
            BankStatementRecord(
                tx_date_iso="2026-01-22T00:00:00+00:00",
                amount_cents=15_800_00,
                direction="out",
                counterparty_name="供电局",
                counterparty_account="7559 3344 5566",
                purpose="电费缴纳",
                balance_cents_after=1_675_600_00,
                raw_text="2026-01-22 借 15,800.00 供电局 电费 余额 1,675,600.00",
            ),
            BankStatementRecord(
                tx_date_iso="2026-01-23T00:00:00+00:00",
                amount_cents=210_000_00,
                direction="in",
                counterparty_name="成都数字科技",
                counterparty_account="5101 7788 9900",
                purpose="项目回款",
                balance_cents_after=1_885_600_00,
                raw_text="2026-01-23 贷 210,000.00 成都数字科技 回款 余额 1,885,600.00",
            ),
        ],
    )

    _SEED_SAMPLES["CCB"] = BankStatementParseResult(
        account_no_masked="4367 **** 5566",
        statement_start_iso="2026-01-01T00:00:00+00:00",
        statement_end_iso="2026-01-31T23:59:59+00:00",
        opening_balance_cents=200_000_00,
        closing_balance_cents=768_500_00,
        total_credits_count=4,
        total_debits_count=2,
        parse_confidence=0.88,
        errors=[],
        records=[
            BankStatementRecord(
                tx_date_iso="2026-01-05T00:00:00+00:00",
                amount_cents=300_000_00,
                direction="in",
                counterparty_name="苏州新材料股份",
                counterparty_account="3205 1234 5678",
                purpose="货款",
                balance_cents_after=500_000_00,
                raw_text="2026/01/05 收入 300,000.00 苏州新材料 货款",
            ),
            BankStatementRecord(
                tx_date_iso="2026-01-10T00:00:00+00:00",
                amount_cents=50_000_00,
                direction="out",
                counterparty_name="员工工资代发",
                counterparty_account="",
                purpose="1月工资发放",
                balance_cents_after=450_000_00,
                raw_text="2026/01/10 支出 50,000.00 代发工资",
            ),
            BankStatementRecord(
                tx_date_iso="2026-01-15T00:00:00+00:00",
                amount_cents=180_000_00,
                direction="in",
                counterparty_name="武汉制造集团",
                counterparty_account="4201 9876 5432",
                purpose="订单回款",
                balance_cents_after=630_000_00,
                raw_text="2026/01/15 收入 180,000.00 武汉制造 回款",
            ),
            BankStatementRecord(
                tx_date_iso="2026-01-18T00:00:00+00:00",
                amount_cents=61_500_00,
                direction="out",
                counterparty_name="房东账户",
                counterparty_account="",
                purpose="厂房季度租金",
                balance_cents_after=568_500_00,
                raw_text="2026/01/18 支出 61,500.00 租金",
            ),
            BankStatementRecord(
                tx_date_iso="2026-01-25T00:00:00+00:00",
                amount_cents=150_000_00,
                direction="in",
                counterparty_name="南京贸易公司",
                counterparty_account="3201 1111 2222",
                purpose="货款",
                balance_cents_after=718_500_00,
                raw_text="2026/01/25 收入 150,000.00 南京贸易 货款",
            ),
            BankStatementRecord(
                tx_date_iso="2026-01-28T00:00:00+00:00",
                amount_cents=50_000_00,
                direction="in",
                counterparty_name="政府补贴专户",
                counterparty_account="",
                purpose="高新企业补贴",
                balance_cents_after=768_500_00,
                raw_text="2026/01/28 收入 50,000.00 政府补贴",
            ),
        ],
    )

    _SEED_SAMPLES["CMB"] = BankStatementParseResult(
        account_no_masked="6225 **** 7788",
        statement_start_iso="2026-01-01T00:00:00+00:00",
        statement_end_iso="2026-01-31T23:59:59+00:00",
        opening_balance_cents=800_000_00,
        closing_balance_cents=2_380_000_00,
        total_credits_count=6,
        total_debits_count=3,
        parse_confidence=0.90,
        errors=[],
        records=[
            BankStatementRecord(
                tx_date_iso="2026-01-03T00:00:00+00:00",
                amount_cents=450_000_00,
                direction="in",
                counterparty_name="招商证券托管",
                counterparty_account="",
                purpose="短期理财赎回",
                balance_cents_after=1_250_000_00,
                raw_text="20260103 C 450000.00 理财赎回",
            ),
            BankStatementRecord(
                tx_date_iso="2026-01-06T00:00:00+00:00",
                amount_cents=200_000_00,
                direction="out",
                counterparty_name="招商银行理财专户",
                counterparty_account="",
                purpose="购买30天理财",
                balance_cents_after=1_050_000_00,
                raw_text="20260106 D 200000.00 购买理财",
            ),
            BankStatementRecord(
                tx_date_iso="2026-01-08T00:00:00+00:00",
                amount_cents=380_000_00,
                direction="in",
                counterparty_name="深圳前海基金",
                counterparty_account="",
                purpose="货款结算",
                balance_cents_after=1_430_000_00,
                raw_text="20260108 C 380000.00 前海基金 货款",
            ),
            BankStatementRecord(
                tx_date_iso="2026-01-12T00:00:00+00:00",
                amount_cents=25_000_00,
                direction="out",
                counterparty_name="社保中心",
                counterparty_account="",
                purpose="1月社保公积金",
                balance_cents_after=1_405_000_00,
                raw_text="20260112 D 25000.00 社保公积金",
            ),
            BankStatementRecord(
                tx_date_iso="2026-01-14T00:00:00+00:00",
                amount_cents=620_000_00,
                direction="in",
                counterparty_name="字节跳动采购",
                counterparty_account="",
                purpose="SaaS服务年费",
                balance_cents_after=2_025_000_00,
                raw_text="20260114 C 620000.00 字节跳动 SaaS年费",
            ),
            BankStatementRecord(
                tx_date_iso="2026-01-16T00:00:00+00:00",
                amount_cents=95_000_00,
                direction="out",
                counterparty_name="腾讯云",
                counterparty_account="",
                purpose="云服务器季度费用",
                balance_cents_after=1_930_000_00,
                raw_text="20260116 D 95000.00 腾讯云服务费",
            ),
            BankStatementRecord(
                tx_date_iso="2026-01-20T00:00:00+00:00",
                amount_cents=175_000_00,
                direction="in",
                counterparty_name="小米生态链",
                counterparty_account="",
                purpose="IoT模块订单款",
                balance_cents_after=2_105_000_00,
                raw_text="20260120 C 175000.00 小米生态链 IoT订单",
            ),
            BankStatementRecord(
                tx_date_iso="2026-01-26T00:00:00+00:00",
                amount_cents=220_000_00,
                direction="in",
                counterparty_name="OPPO广东移动",
                counterparty_account="",
                purpose="联合研发项目款",
                balance_cents_after=2_325_000_00,
                raw_text="20260126 C 220000.00 OPPO 研发项目",
            ),
            BankStatementRecord(
                tx_date_iso="2026-01-30T00:00:00+00:00",
                amount_cents=55_000_00,
                direction="in",
                counterparty_name="税务局退税专户",
                counterparty_account="",
                purpose="增值税即征即退",
                balance_cents_after=2_380_000_00,
                raw_text="20260130 C 55000.00 退税",
            ),
        ],
    )


_init_seed_samples()


# ============================================================================
# 银行流水解析服务
# ============================================================================

_DATE_PATTERNS = [
    re.compile(r"(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})"),
    re.compile(r"(20\d{2})(\d{2})(\d{2})"),
]

_AMOUNT_PATTERN = re.compile(r"([+-]?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})|\d+\.\d{1,2})")

_DIRECTION_KEYWORDS_IN = ["贷", "收入", "C", "credit", "转入", "入账", "回款"]
_DIRECTION_KEYWORDS_OUT = ["借", "支出", "D", "debit", "转出", "扣款", "缴费"]


def _parse_date(line: str) -> str:
    """从文本行解析 ISO 日期, 解析失败返回空字符串."""
    for pat in _DATE_PATTERNS:
        m = pat.search(line)
        if m:
            y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
            try:
                dt = datetime(y, mo, d)
                return dt.replace(tzinfo=None).isoformat() + "+00:00"
            except ValueError:
                continue
    return ""


def _parse_amount_cents(line: str) -> int:
    """从文本行解析金额 (元转分), 解析失败返回 0."""
    m = _AMOUNT_PATTERN.search(line)
    if not m:
        return 0
    amt_str = m.group(1).replace(",", "").replace("+", "")
    try:
        return round(float(amt_str) * 100)
    except ValueError:
        return 0


def _detect_direction(line: str, amount_sign: str) -> str:
    """检测资金方向: in/out."""
    lower = line
    if amount_sign == "-":
        return "out"
    if amount_sign == "+":
        return "in"
    for kw in _DIRECTION_KEYWORDS_IN:
        if kw in lower:
            return "in"
    for kw in _DIRECTION_KEYWORDS_OUT:
        if kw in lower:
            return "out"
    return "out"


def _select_seed(bank_name: str) -> BankStatementParseResult:
    """根据银行名选择 seed 样本, 默认返回工行."""
    name = (bank_name or "").upper()
    if "CCB" in name or "建设" in bank_name:
        return _SEED_SAMPLES["CCB"]
    if "CMB" in name or "招商" in bank_name:
        return _SEED_SAMPLES["CMB"]
    return _SEED_SAMPLES["ICBC"]


class BankStatementParserService:
    """银行流水解析服务."""

    def __init__(self, ocr_svc: OcrService | None = None) -> None:
        self.ocr_svc = ocr_svc or ocr_service

    def parse_text(
        self, ocr_text: str, bank_name: str = "",
    ) -> BankStatementParseResult:
        """正则解析银行流水文本.

        - 按 借/贷/C/ 或 收入/支出 识别方向
        - 无法匹配时降级返回 0 条 + warning
        - ocr_text 为空时返回 seed 样本
        """
        if not ocr_text or not ocr_text.strip():
            return _select_seed(bank_name)

        errors: list[str] = []
        records: list[BankStatementRecord] = []

        lines = [l.strip() for l in ocr_text.splitlines() if l.strip()]

        for line in lines:
            date_iso = _parse_date(line)
            if not date_iso:
                continue

            amount_cents = _parse_amount_cents(line)
            if amount_cents <= 0:
                continue

            sign_match = re.search(r"([+-])\s*\d", line)
            amount_sign = sign_match.group(1) if sign_match else ""
            direction = _detect_direction(line, amount_sign)

            counterparty_name = ""
            name_match = re.search(
                r"(?:对方户名[:：]?|户名[:：]?)\s*([^\s,，;；]+)", line,
            )
            if name_match:
                counterparty_name = name_match.group(1)

            purpose = ""
            purpose_match = re.search(r"(?:用途[:：]?|摘要[:：]?)\s*([^\s,，;；]+)", line)
            if purpose_match:
                purpose = purpose_match.group(1)

            balance_cents_after = 0
            bal_match = re.search(
                r"(?:余额[:：]?)\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2}))", line,
            )
            if bal_match:
                try:
                    balance_cents_after = round(float(bal_match.group(1).replace(",", "")) * 100)
                except ValueError:
                    pass

            records.append(BankStatementRecord(
                tx_date_iso=date_iso,
                amount_cents=amount_cents,
                direction=direction,
                counterparty_name=counterparty_name,
                counterparty_account="",
                purpose=purpose,
                balance_cents_after=balance_cents_after,
                raw_text=line,
            ))

        if not records:
            errors.append("未匹配到任何交易行, 已降级返回 0 条记录")

        credits = sum(1 for r in records if r.direction == "in")
        debits = sum(1 for r in records if r.direction == "out")
        parse_confidence = round(min(1.0, len(records) / max(1, len(lines)) * 1.5 + 0.5), 4)

        return BankStatementParseResult(
            account_no_masked="",
            statement_start_iso="",
            statement_end_iso="",
            opening_balance_cents=0,
            closing_balance_cents=0,
            total_credits_count=credits,
            total_debits_count=debits,
            records=records,
            parse_confidence=parse_confidence,
            errors=errors,
        )

    async def parse_request(
        self, ocr_req: OcrRequest, bank_name: str = "",
    ) -> BankStatementParseResult:
        """先调用 OcrService 再 parse_text.

        base64_content 为空时 (MOCK seed 模式), 直接返回 seed 样本.
        """
        if not ocr_req.base64_content.strip():
            return self.parse_text("", bank_name=bank_name)
        ocr_result = await self.ocr_svc.ocr(ocr_req)
        full_text = "\n".join(b.text for b in ocr_result.blocks)
        return self.parse_text(full_text, bank_name=bank_name)


bank_statement_parser = BankStatementParserService()
