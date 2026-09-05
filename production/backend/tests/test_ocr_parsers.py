"""DATA-03 OCR 与文档解析 测试 (R1.3).

覆盖:
    - test_ocr_mock_engine_returns_blocks:   Mock 引擎 OCR 返回确定性 blocks
    - test_bank_statement_parse_seed_sample_confidence_ge_08: 银行流水 seed 解析率 ≥ 80%
    - test_contract_parse_extracts_all_core_fields: 合同解析提取所有核心字段
    - test_invoice_parse_grand_total_matches_items_sum: 发票价税合计 = 条目金额+税额 之和
"""

from __future__ import annotations

import pytest

from app.api.v1.data.ocr_parsers import parsers_router
from app.main import app

_PARSERS_ROUTE_REGISTERED = False
for _r in app.routes:
    _path = getattr(_r, "path", "")
    if _path.startswith("/api/v1/data/parsers"):
        _PARSERS_ROUTE_REGISTERED = True
        break
if not _PARSERS_ROUTE_REGISTERED:
    app.include_router(parsers_router, prefix="/api/v1")


pytestmark = pytest.mark.asyncio


# ============================================================================
# 1. OCR Mock 引擎测试
# ============================================================================

class TestOcrMockEngine:
    """test_ocr_mock_engine_returns_blocks: Mock 引擎返回确定性 blocks."""

    async def test_ocr_pdf_mock_returns_30_blocks_5_pages(self, client):
        """PDF 类型: 5 页, 30 个 block."""
        payload = {
            "sourceType": "pdf",
            "base64Content": "",
            "enginePreference": "MOCK",
            "dpi": 300,
        }
        r = await client.post("/api/v1/data/parsers/ocr", json=payload)
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        data = body["data"]
        assert data["engineUsed"] == "MOCK"
        assert data["pages"] == 5
        assert len(data["blocks"]) == 30
        assert data["textLength"] > 0
        assert 0.85 <= data["confidenceAvg"] <= 0.92

    async def test_ocr_image_png_mock_returns_8_blocks(self, client):
        """PNG 图片: 1 页, 8 个 block."""
        payload = {
            "sourceType": "image_png",
            "base64Content": "",
            "enginePreference": "MOCK",
        }
        r = await client.post("/api/v1/data/parsers/ocr", json=payload)
        assert r.status_code == 200
        data = r.json()["data"]
        assert data["pages"] == 1
        assert len(data["blocks"]) == 8

    async def test_ocr_image_jpg_mock_returns_8_blocks(self, client):
        """JPG 图片: 1 页, 8 个 block."""
        payload = {
            "sourceType": "image_jpg",
            "base64Content": "",
            "enginePreference": "PADDLE",
        }
        r = await client.post("/api/v1/data/parsers/ocr", json=payload)
        assert r.status_code == 200
        data = r.json()["data"]
        assert data["engineUsed"] == "MOCK"
        assert data["pages"] == 1
        assert len(data["blocks"]) == 8

    async def test_ocr_block_has_valid_bbox_and_confidence(self, client):
        """每个 OcrBlock 具有合法 bbox (4 项) 与 confidence (0-1)."""
        payload = {"sourceType": "pdf", "base64Content": "", "enginePreference": "MOCK"}
        data = (await client.post("/api/v1/data/parsers/ocr", json=payload)).json()["data"]
        for block in data["blocks"]:
            assert isinstance(block["bbox"], list)
            assert len(block["bbox"]) == 4
            assert all(0.0 <= x <= 1.0 for x in block["bbox"])
            assert 0.85 <= block["confidence"] <= 0.92
            assert block["pageNo"] >= 1
            assert block["text"]

    async def test_ocr_health_returns_all_engines(self, client):
        """健康检查返回 4 个引擎状态."""
        r = await client.get("/api/v1/data/parsers/ocr/health")
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        health = body["data"]
        for engine in ["PADDLE", "BAIDU", "ALI", "MOCK"]:
            assert engine in health
            assert health[engine]["status"] in {"online", "offline", "degraded"}
            assert health[engine]["latencyMs"] >= 0
            assert "lastCheckedAt" in health[engine]
        assert health["MOCK"]["status"] == "online"


# ============================================================================
# 2. 银行流水解析测试
# ============================================================================

class TestBankStatementParser:
    """test_bank_statement_parse_seed_sample_confidence_ge_08: 解析率 ≥ 80% 约束."""

    async def _do_parse(self, client, bank_name: str = ""):
        payload = {"sourceType": "pdf", "base64Content": "", "enginePreference": "MOCK"}
        params = {"bankName": bank_name} if bank_name else {}
        r = await client.post("/api/v1/data/parsers/bank-statement", json=payload, params=params)
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        return body["data"]

    async def test_icbc_seed_confidence_ge_08(self, client):
        """工行 seed 样本: parse_confidence >= 0.80."""
        data = await self._do_parse(client, "ICBC")
        assert data["parseConfidence"] >= 0.80
        assert data["accountNoMasked"] == "6222 **** 8899"
        assert len(data["records"]) >= 8
        assert data["totalCreditsCount"] + data["totalDebitsCount"] == len(data["records"])

    async def test_ccb_seed_confidence_ge_08(self, client):
        """建行 seed 样本: 解析率 ≥ 80%."""
        data = await self._do_parse(client, "CCB")
        assert data["parseConfidence"] >= 0.80
        assert data["totalCreditsCount"] >= 3
        assert data["totalDebitsCount"] >= 1

    async def test_cmb_seed_confidence_ge_08(self, client):
        """招行 seed 样本: 解析率 ≥ 80%."""
        data = await self._do_parse(client, "CMB")
        assert data["parseConfidence"] >= 0.80
        assert len(data["records"]) >= 6

    async def test_bank_records_have_core_fields(self, client):
        """每条 BankStatementRecord 拥有核心字段: txDateIso/amountCents/direction."""
        data = await self._do_parse(client, "ICBC")
        for rec in data["records"]:
            assert rec["txDateIso"]
            assert rec["amountCents"] > 0
            assert rec["direction"] in {"in", "out"}
            assert rec["rawText"]

    async def test_bank_default_is_icbc(self, client):
        """不传 bankName 时默认返回工行 seed."""
        data = await self._do_parse(client)
        assert data["accountNoMasked"] == "6222 **** 8899"


# ============================================================================
# 3. 合同解析测试
# ============================================================================

class TestContractParser:
    """test_contract_parse_extracts_all_core_fields: 核心字段全部提取."""

    async def _do_parse(self, client, contract_type: str = ""):
        payload = {"sourceType": "pdf", "base64Content": "", "enginePreference": "MOCK"}
        params = {"seedContractType": contract_type} if contract_type else {}
        r = await client.post("/api/v1/data/parsers/contract", json=payload, params=params)
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        return body["data"]

    async def test_loan_contract_all_core_fields_present(self, client):
        """贷款合同: 核心字段非空 (合同号/甲乙/金额/3 个日期/法律/争议)."""
        data = await self._do_parse(client, "loan")
        assert data["contractNo"] == "LOAN-SZ-2026-0088"
        assert data["partyAName"]
        assert data["partyBName"]
        assert data["amountCents"] == 5_000_000_00
        assert data["signedDateIso"]
        assert data["effectiveDateIso"]
        assert data["expiryDateIso"]
        assert data["governingLaw"]
        assert data["disputeResolution"]
        assert len(data["keyObligations"]) >= 3
        assert len(data["risksFlagged"]) >= 2
        assert data["parseConfidence"] >= 0.80

    async def test_supply_chain_contract_core_fields(self, client):
        """供应链合同: 核心字段齐全."""
        data = await self._do_parse(client, "supply_chain")
        assert data["contractNo"] == "SC-GZ-2026-0156"
        assert data["amountCents"] == 3_200_000_00
        assert data["governingLaw"]
        assert data["disputeResolution"]
        assert len(data["keyObligations"]) >= 3

    async def test_guarantee_contract_core_fields(self, client):
        """担保合同: 核心字段齐全."""
        data = await self._do_parse(client, "guarantee")
        assert data["contractNo"] == "GR-HZ-2026-0033"
        assert data["amountCents"] == 2_000_000_00
        assert data["partyAName"]
        assert data["partyBName"]
        assert data["signedDateIso"]

    async def test_contract_default_is_loan(self, client):
        """不传 seedContractType 默认是贷款合同."""
        data = await self._do_parse(client)
        assert data["contractNo"] == "LOAN-SZ-2026-0088"


# ============================================================================
# 4. 发票解析测试
# ============================================================================

class TestInvoiceParser:
    """test_invoice_parse_grand_total_matches_items_sum: 价税合计与条目和一致."""

    async def _do_parse(self, client, seed_no: int = 1):
        payload = {"sourceType": "image_png", "base64Content": "", "enginePreference": "MOCK"}
        params = {"seedNo": seed_no}
        r = await client.post("/api/v1/data/parsers/invoice", json=payload, params=params)
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        return body["data"]

    async def test_vat_special_grand_total_matches_items_sum(self, client):
        """增值税专票 seed_no=1: grand_total = Σ(amount + tax) across items."""
        data = await self._do_parse(client, 1)
        assert data["invoiceType"] == "vat_special"
        assert len(data["items"]) == 3
        items_amount_sum = sum(i["amountCents"] for i in data["items"])
        items_tax_sum = sum(i["taxCents"] for i in data["items"])
        expected_grand = items_amount_sum + items_tax_sum
        assert data["grandTotalCents"] == expected_grand
        assert data["grandTotalCents"] == 1_130_000_00
        assert data["totalAmountCents"] == items_amount_sum
        assert data["totalTaxCents"] == items_tax_sum

    async def test_electronic_invoice_grand_total_matches(self, client):
        """电子普票 seed_no=2: grand_total 匹配单条目金额+税额."""
        data = await self._do_parse(client, 2)
        assert data["invoiceType"] == "electronic"
        assert len(data["items"]) == 1
        item = data["items"][0]
        expected = item["amountCents"] + item["taxCents"]
        assert data["grandTotalCents"] == expected
        assert data["grandTotalCents"] == 8_226_40

    async def test_invoice_seed1_core_fields(self, client):
        """专票核心字段: 代码/号码/日期/购销方/税号齐全."""
        data = await self._do_parse(client, 1)
        assert data["invoiceCode"] == "044002600311"
        assert data["invoiceNo"] == "00283901"
        assert data["invoiceDateIso"]
        assert data["sellerName"] == "深圳科创电子有限公司"
        assert data["sellerTaxId"].startswith("91")
        assert data["buyerName"] == "广州供应链集团股份有限公司"
        assert data["buyerTaxId"].startswith("91")

    async def test_invoice_item_each_has_tax_consistency(self, client):
        """每个发票条目: tax ≈ amount * tax_rate (允许 ±1 分的四舍五入误差)."""
        data = await self._do_parse(client, 1)
        for item in data["items"]:
            expected_tax = round(item["amountCents"] * item["taxRate"])
            assert abs(item["taxCents"] - expected_tax) <= 2
