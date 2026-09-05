"""DATA-03 OCR 与文档解析 API 路由 (R1.3).

端点 (prefix=/data/parsers):
    POST /ocr                        -> OcrResult
    GET  /ocr/health                 -> dict[OcrEngine, AdapterHealth]
    POST /bank-statement             -> BankStatementParseResult (body: OcrRequest)
    POST /contract                   -> ContractParseResult (body: OcrRequest, ?seed_contract_type)
    POST /invoice                    -> InvoiceParseResult (body: OcrRequest, ?seed_no)
"""

from __future__ import annotations

from fastapi import APIRouter, Query

from app.api.deps import make_ok
from app.schemas.common import ApiResult
from app.schemas.parsers import (
    BankStatementParseResult,
    ContractParseResult,
    InvoiceParseResult,
    OcrRequest,
    OcrResult,
)
from app.services.bank_statement_parser import BankStatementParserService
from app.services.contract_parser import ContractParserService
from app.services.invoice_parser import InvoiceParserService
from app.services.ocr_service import OcrService, ocr_service

parsers_router = APIRouter(prefix="/data/parsers", tags=["DATA-03 OCR 解析"])


def _ocr_svc() -> OcrService:
    return ocr_service


def _bank_svc() -> BankStatementParserService:
    return BankStatementParserService(ocr_svc=_ocr_svc())


def _contract_svc() -> ContractParserService:
    return ContractParserService(ocr_svc=_ocr_svc())


def _invoice_svc() -> InvoiceParserService:
    return InvoiceParserService(ocr_svc=_ocr_svc())


# ============================================================================
# 1. OCR 识别
# ============================================================================

@parsers_router.post("/ocr", response_model=ApiResult[OcrResult], summary="OCR 文本识别")
async def ocr_recognize(payload: OcrRequest):
    """执行 OCR 识别 (engine_preference 首选, 失败自动 fallback 到 MOCK)."""
    result = await _ocr_svc().ocr(payload)
    return make_ok(result)


@parsers_router.get("/ocr/health", summary="OCR 引擎健康检查")
async def ocr_health():
    """检查所有 OCR 引擎 (PaddleOCR / 百度 / 阿里 / Mock) 健康状态."""
    result = await _ocr_svc().check_engine_health()
    return make_ok(result)


# ============================================================================
# 2. 银行流水解析
# ============================================================================

@parsers_router.post(
    "/bank-statement",
    response_model=ApiResult[BankStatementParseResult],
    summary="银行流水解析",
)
async def parse_bank_statement(
    payload: OcrRequest,
    bank_name: str = Query(default="", alias="bankName", description="银行名 (用于选 seed 样本)"),
):
    """解析银行流水 (OCR + 正则提取交易行)."""
    result = await _bank_svc().parse_request(payload, bank_name=bank_name)
    return make_ok(result)


# ============================================================================
# 3. 合同解析
# ============================================================================

@parsers_router.post(
    "/contract",
    response_model=ApiResult[ContractParseResult],
    summary="合同文档解析",
)
async def parse_contract(
    payload: OcrRequest,
    seed_contract_type: str = Query(
        default="",
        alias="seedContractType",
        description="seed 合同类型: loan/supply_chain/guarantee",
    ),
):
    """解析合同文档 (OCR + 关键词正则提取核心条款)."""
    result = await _contract_svc().parse_request(payload, contract_type=seed_contract_type)
    return make_ok(result)


# ============================================================================
# 4. 发票解析
# ============================================================================

@parsers_router.post(
    "/invoice",
    response_model=ApiResult[InvoiceParseResult],
    summary="发票文档解析",
)
async def parse_invoice(
    payload: OcrRequest,
    seed_no: int = Query(
        default=1,
        alias="seedNo",
        ge=1,
        le=2,
        description="seed 发票号: 1=增值税专票(3条目), 2=电子普票(1条目)",
    ),
):
    """解析发票文档 (OCR + 正则提取购销方/金额/商品条目)."""
    result = await _invoice_svc().parse_request(payload, seed_no=seed_no)
    return make_ok(result)
