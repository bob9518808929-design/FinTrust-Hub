"""DATA-03 合同解析服务 (R1.3).

设计:
    - 关键词正则匹配合同号/签约方/金额/日期/法律条款
    - ocr_text 为空时返回 seed 样本 (贷款合同/供应链合同/担保合同 3 个)
    - 可用 contract_type 参数选 seed: loan / supply_chain / guarantee
"""

from __future__ import annotations

import re
from datetime import datetime

from app.schemas.parsers import ContractParseResult, OcrRequest
from app.services.ocr_service import OcrService, ocr_service


# ============================================================================
# 内置 seed 样本 (3 类合同)
# ============================================================================

_SEED_SAMPLES: dict[str, ContractParseResult] = {}


def _iso(y: int, m: int, d: int) -> str:
    return datetime(y, m, d).isoformat() + "+00:00"


def _init_seed_samples() -> None:
    """初始化 3 类确定性 seed 合同样本."""

    _SEED_SAMPLES["loan"] = ContractParseResult(
        contract_no="LOAN-SZ-2026-0088",
        party_a_name="深圳发展银行股份有限公司",
        party_b_name="深圳科创电子有限公司",
        amount_cents=5_000_000_00,
        signed_date_iso=_iso(2026, 1, 10),
        effective_date_iso=_iso(2026, 1, 15),
        expiry_date_iso=_iso(2027, 1, 14),
        governing_law="中华人民共和国民法典合同编",
        dispute_resolution="向甲方所在地人民法院提起诉讼",
        key_obligations=[
            "甲方应于生效日起 5 个工作日内发放贷款本金 500 万元",
            "乙方应按月付息, 年利率 4.35%, 每月 20 日为结息日",
            "乙方应于到期日一次性归还全部本金",
            "乙方应按季度向甲方提供财务报表及经营情况说明",
        ],
        risks_flagged=[
            "乙方信用等级 BBB, 应收账款周转天数 78 天偏高",
            "抵押物评估价值 820 万, 抵押率 61%, 存在波动风险",
            "贷款期限 12 个月, 与乙方现金流回款周期匹配度一般",
        ],
        parse_confidence=0.95,
    )

    _SEED_SAMPLES["supply_chain"] = ContractParseResult(
        contract_no="SC-GZ-2026-0156",
        party_a_name="广州供应链集团股份有限公司",
        party_b_name="深圳科创电子有限公司",
        amount_cents=3_200_000_00,
        signed_date_iso=_iso(2026, 1, 5),
        effective_date_iso=_iso(2026, 1, 8),
        expiry_date_iso=_iso(2026, 12, 31),
        governing_law="中华人民共和国民法典 + 供应链金融监管暂行办法",
        dispute_resolution="提交广州仲裁委员会按其现行规则仲裁",
        key_obligations=[
            "乙方按订单向甲方供应电子元器件, 月度采购额不低于 200 万",
            "甲方在收到货物验收合格后 30 天内以电子银行承兑汇票付款",
            "双方约定账期 60 天, 逾期按日万分之五支付违约金",
            "甲方提供核心企业确权, 乙方可持应收账款向银行融资",
        ],
        risks_flagged=[
            "乙方原材料库存周转天数 62 天, 需关注备货节奏",
            "甲方付款方式为承兑汇票, 存在贴现成本及兑付时效风险",
            "合同有效期 12 个月, 年度续约条款不够明确",
        ],
        parse_confidence=0.92,
    )

    _SEED_SAMPLES["guarantee"] = ContractParseResult(
        contract_no="GR-HZ-2026-0033",
        party_a_name="杭州智造机械有限公司",
        party_b_name="深圳市中小微企业融资担保有限公司",
        amount_cents=2_000_000_00,
        signed_date_iso=_iso(2026, 1, 12),
        effective_date_iso=_iso(2026, 1, 15),
        expiry_date_iso=_iso(2026, 7, 14),
        governing_law="中华人民共和国民法典担保制度司法解释",
        dispute_resolution="向合同签订地 (杭州市西湖区) 人民法院起诉",
        key_obligations=[
            "乙方为甲方向招商银行申请的 200 万半年期贷款提供连带责任保证",
            "甲方按月向乙方支付担保费, 费率年化 1.5%",
            "甲方以其名下设备 (评估值 380 万) 向乙方提供反担保抵押",
            "甲方发生重大经营变化时应提前 15 日书面通知乙方",
        ],
        risks_flagged=[
            "反担保设备变现能力一般, 需定期评估残值",
            "担保期限仅 6 个月, 到期后续保时银行可能重新审批",
            "甲方流动比率 1.1 偏低, 短期偿债能力需关注",
        ],
        parse_confidence=0.90,
    )


_init_seed_samples()


# ============================================================================
# 解析正则
# ============================================================================

_CONTRACT_NO_PATTERNS = [
    re.compile(r"(?:合同编号|合同号|编号)[:：]?\s*([A-Za-z0-9\-_]{6,})"),
    re.compile(r"No\.[:：]?\s*([A-Za-z0-9\-_]{6,})", re.IGNORECASE),
]

_PARTY_A_PATTERNS = [
    re.compile(r"(?:甲方|借款人|买方|委托人|被担保人)[:：]?\s*(?:名称|方名)?[:：]?\s*([^\s\n\r，,;；]{2,40})"),
]

_PARTY_B_PATTERNS = [
    re.compile(r"(?:乙方|出借人|贷款人|卖方|受托人|担保人)[:：]?\s*(?:名称|方名)?[:：]?\s*([^\s\n\r，,;；]{2,40})"),
]

_AMOUNT_PATTERNS = [
    re.compile(r"(?:人民币|大写)[^\d]{0,10}([\d,，]+(?:\.\d+)?)\s*元"),
    re.compile(r"金额[:：]?\s*([\d,，]+(?:\.\d+)?)\s*元"),
    re.compile(r"¥\s*([\d,，]+(?:\.\d+)?)"),
]

_DATE_PATTERNS = [
    re.compile(r"(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})[日号]?"),
]

_GOVERNING_LAW_PATTERNS = [
    re.compile(r"(?:适用法律|法律适用|准据法)[:：]?\s*([^\n\r。.]{5,60})"),
]

_DISPUTE_PATTERNS = [
    re.compile(r"(?:争议解决|争议处理|管辖)[:：]?\s*([^\n\r。.]{5,80})"),
]


def _parse_date(text: str, keyword: str | None = None) -> str:
    """从文本中提取日期, keyword 优先匹配上下文."""
    lines = text.splitlines()
    candidate_lines = lines[:]
    if keyword:
        candidate_lines = [l for l in lines if keyword in l] + lines
    for line in candidate_lines:
        for pat in _DATE_PATTERNS:
            m = pat.search(line)
            if m:
                try:
                    dt = datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)))
                    return dt.isoformat() + "+00:00"
                except ValueError:
                    continue
    return ""


def _parse_amount_cents(text: str) -> int:
    """解析合同金额 (元转分)."""
    for pat in _AMOUNT_PATTERNS:
        m = pat.search(text)
        if m:
            try:
                amt = float(m.group(1).replace(",", "").replace("，", ""))
                return int(round(amt * 100))
            except ValueError:
                continue
    return 0


def _first_match(patterns: list[re.Pattern], text: str) -> str:
    """匹配第一个正则结果."""
    for pat in patterns:
        m = pat.search(text)
        if m:
            return m.group(1).strip()
    return ""


def _select_seed(contract_type: str) -> ContractParseResult:
    """根据 contract_type 选 seed, 默认 loan."""
    ct = (contract_type or "").lower()
    if "supply" in ct or "chain" in ct or "供应链" in ct:
        return _SEED_SAMPLES["supply_chain"]
    if "guar" in ct or "担保" in ct or "保证" in ct:
        return _SEED_SAMPLES["guarantee"]
    return _SEED_SAMPLES["loan"]


class ContractParserService:
    """合同解析服务."""

    def __init__(self, ocr_svc: OcrService | None = None) -> None:
        self.ocr_svc = ocr_svc or ocr_service

    def parse_text(
        self, ocr_text: str, contract_type: str = "",
    ) -> ContractParseResult:
        """关键词正则匹配合同核心字段.

        - 匹配合同号/签约方/金额/日期/法律条款
        - ocr_text 为空时返回 seed 样本
        """
        if not ocr_text or not ocr_text.strip():
            return _select_seed(contract_type)

        contract_no = _first_match(_CONTRACT_NO_PATTERNS, ocr_text)
        party_a = _first_match(_PARTY_A_PATTERNS, ocr_text)
        party_b = _first_match(_PARTY_B_PATTERNS, ocr_text)
        amount_cents = _parse_amount_cents(ocr_text)

        signed_date = _parse_date(ocr_text, "签订") or _parse_date(ocr_text, "签署")
        effective_date = _parse_date(ocr_text, "生效") or signed_date
        expiry_date = _parse_date(ocr_text, "到期") or _parse_date(ocr_text, "届满") or effective_date

        governing_law = _first_match(_GOVERNING_LAW_PATTERNS, ocr_text)
        dispute_resolution = _first_match(_DISPUTE_PATTERNS, ocr_text)

        obligations: list[str] = []
        for pat in [
            re.compile(r"(?:义务|责任)[:：]?\s*([^\n\r。.]{10,80})"),
            re.compile(r"(?:甲方|乙方)(?:应|须|需)([^\n\r。.]{5,80})"),
        ]:
            for m in pat.finditer(ocr_text):
                obligations.append(m.group(1).strip())
        obligations = obligations[:4]

        risks: list[str] = []
        for pat in [
            re.compile(r"(?:风险|违约|赔偿)[:：]?\s*([^\n\r。.]{10,80})"),
        ]:
            for m in pat.finditer(ocr_text):
                risks.append(m.group(1).strip())
        risks = risks[:3]

        extracted = sum(1 for x in [
            contract_no, party_a, party_b, amount_cents,
            signed_date, governing_law, dispute_resolution,
        ] if x)
        parse_confidence = round(min(1.0, extracted / 7.0 + 0.2), 4)

        return ContractParseResult(
            contract_no=contract_no,
            party_a_name=party_a,
            party_b_name=party_b,
            amount_cents=amount_cents,
            signed_date_iso=signed_date,
            effective_date_iso=effective_date,
            expiry_date_iso=expiry_date,
            governing_law=governing_law,
            dispute_resolution=dispute_resolution,
            key_obligations=obligations,
            risks_flagged=risks,
            parse_confidence=parse_confidence,
        )

    async def parse_request(
        self, ocr_req: OcrRequest, contract_type: str = "",
    ) -> ContractParseResult:
        """先调用 OcrService 再 parse_text.

        base64_content 为空时 (MOCK seed 模式), 直接返回 seed 样本.
        """
        if not ocr_req.base64_content.strip():
            return self.parse_text("", contract_type=contract_type)
        ocr_result = await self.ocr_svc.ocr(ocr_req)
        full_text = "\n".join(b.text for b in ocr_result.blocks)
        return self.parse_text(full_text, contract_type=contract_type)


contract_parser = ContractParserService()
