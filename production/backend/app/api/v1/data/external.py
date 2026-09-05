"""DATA-02 第三方数据源接入 API 路由.

端点 (prefix=/data/external, tags=["DATA-02 外部数据"]):
    GET    /health                                    所有数据源健康检查
    POST   /invoice/verify                            发票查验
    GET    /gsxt/{enterprise_id}                      GSXT 工商信息查询
    GET    /judiciary/{enterprise_id}                 司法案件查询
    GET    /judiciary/{enterprise_id}/risk            诉讼风险判定 (is_risk)
    GET    /ecds/bill/{bill_no}                       单张票据查询
    GET    /ecds/enterprise/{enterprise_id}?role=     企业票据列表

响应全部用 make_ok 包装, response_model 使用 ApiResult[T].
"""

from __future__ import annotations

from fastapi import APIRouter, Query

from app.api.deps import make_ok
from app.deps import CurrentUser
from app.schemas.common import ApiResult
from app.schemas.external_data import (
    AdapterHealth, BillRole, DataSourceType, ECDSBillRecord,
    GSXTEnterpriseInfo, InvoiceVerifyRequest, InvoiceVerifyResult,
    JudiciaryCaseRecord,
)
from app.services.data_source_registry import get_registry
from app.services.ecds_adapter import EcdsAdapterService
from app.services.gsxt_adapter import GsxtAdapterService
from app.services.invoice_verifier import InvoiceVerifierService
from app.services.judiciary_adapter import JudiciaryAdapterService


external_data_router = APIRouter(prefix="/data/external", tags=["DATA-02 外部数据"])


def _invoice_svc() -> InvoiceVerifierService:
    return InvoiceVerifierService(db=None)


def _gsxt_svc() -> GsxtAdapterService:
    return GsxtAdapterService(db=None)


def _judiciary_svc() -> JudiciaryAdapterService:
    return JudiciaryAdapterService(db=None)


def _ecds_svc() -> EcdsAdapterService:
    return EcdsAdapterService(db=None)


# ============================================================================
# 1. 所有数据源健康检查
# ============================================================================

@external_data_router.get(
    "/health",
    response_model=ApiResult[dict[str, AdapterHealth]],
    summary="所有数据源健康检查",
)
async def list_health(_user: CurrentUser):
    """聚合 4 个数据源适配器的健康状态."""
    registry = await get_registry()
    health_map = await registry.list_health()
    result = {k.value: v for k, v in health_map.items()}
    return make_ok(result)


# ============================================================================
# 2. 发票查验
# ============================================================================

@external_data_router.post(
    "/invoice/verify",
    response_model=ApiResult[InvoiceVerifyResult],
    summary="发票查验",
)
async def verify_invoice(payload: InvoiceVerifyRequest, _user: CurrentUser):
    """国税总局发票查验 (mock, 98% 成功率)."""
    result = await _invoice_svc().verify(payload)
    return make_ok(result)


# ============================================================================
# 3. GSXT 工商信息查询
# ============================================================================

@external_data_router.get(
    "/gsxt/{enterprise_id}",
    response_model=ApiResult[GSXTEnterpriseInfo],
    summary="GSXT 企业工商信息",
)
async def query_gsxt_enterprise(
    enterprise_id: str,
    enterprise_name: str = Query(default="", alias="enterpriseName", description="企业名称 (可选)"),
    _user: CurrentUser = None,
):
    """国家企业信用信息公示系统工商信息查询 (mock)."""
    info = await _gsxt_svc().query_enterprise(enterprise_id, enterprise_name)
    if not info:
        return make_ok(None, code=404, message=f"企业 {enterprise_id} 未在 GSXT 找到工商信息")
    return make_ok(info)


# ============================================================================
# 4 & 5. 司法案件查询 + 风险判定
# ============================================================================

@external_data_router.get(
    "/judiciary/{enterprise_id}",
    response_model=ApiResult[list[JudiciaryCaseRecord]],
    summary="司法案件查询",
)
async def query_judiciary_cases(
    enterprise_id: str,
    status: str | None = Query(default=None, description="按状态筛选 (如: 审理中)"),
    _user: CurrentUser = None,
):
    """企业涉诉案件查询 (mock, 裁判文书网 + 执行信息网)."""
    cases = await _judiciary_svc().query_cases(enterprise_id, status)
    return make_ok(cases)


@external_data_router.get(
    "/judiciary/{enterprise_id}/risk",
    response_model=ApiResult[dict],
    summary="诉讼风险判定",
)
async def get_litigation_risk(enterprise_id: str, _user: CurrentUser):
    """近 12 个月有未结案件返回 True.

    返回: { "isRisk": bool }
    """
    is_risk = await _judiciary_svc().has_litigation_risk(enterprise_id)
    return make_ok({"isRisk": is_risk})


# ============================================================================
# 6 & 7. ECDS 票据查询
# ============================================================================

@external_data_router.get(
    "/ecds/bill/{bill_no}",
    response_model=ApiResult[ECDSBillRecord],
    summary="单张票据查询",
)
async def query_ecds_bill(bill_no: str, _user: CurrentUser):
    """电子商业汇票单张票据查询 (mock, ECDS)."""
    bill = await _ecds_svc().query_bill(bill_no)
    if not bill:
        return make_ok(None, code=404, message=f"票据 {bill_no} 不存在")
    return make_ok(bill)


@external_data_router.get(
    "/ecds/enterprise/{enterprise_id}",
    response_model=ApiResult[list[ECDSBillRecord]],
    summary="企业票据列表",
)
async def list_ecds_bills(
    enterprise_id: str,
    role: BillRole = Query(default="drawer", description="角色: drawer/drawee/holder"),
    _user: CurrentUser = None,
):
    """按企业 ID + 角色列出票据 (mock, ECDS)."""
    bills = await _ecds_svc().list_bills_by_enterprise(enterprise_id, role)
    return make_ok(bills)
