"""INFRA-05 RPA 适配层 API (R6.2 + R7.0 银行申报书模板).

prefix="/infra/rpa", tags=["INFRA-05 RPA 适配层"]
"""

from __future__ import annotations

from fastapi import APIRouter, Body, Query
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.api.deps import make_ok
from app.schemas.common import ApiResult
from app.schemas.rpa import RPATask
from app.services.rpa_service import get_bank_templates, rpa_service

router = APIRouter(prefix="/infra/rpa", tags=["INFRA-05 RPA 适配层"])


class _Base(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True, alias_generator=to_camel, use_enum_values=True,
    )


class CreateTaskReq(_Base):
    enterprise_id: str
    task_type: str = Field(
        description="BANK_STATEMENT_PDF / INVOICE_PDF / CONTRACT_PDF",
    )
    target_bank: str | None = None


@router.post(
    "/tasks",
    response_model=ApiResult[RPATask],
    summary="创建 RPA 任务",
)
async def create_task(payload: CreateTaskReq = Body(...)):
    try:
        task = await rpa_service.create_rpa_task(
            enterprise_id=payload.enterprise_id,
            task_type=payload.task_type,
            target_bank=payload.target_bank,
        )
        return make_ok(task)
    except ValueError as e:
        return make_ok(None, code=400, message=str(e))


@router.get(
    "/tasks",
    response_model=ApiResult[list[RPATask]],
    summary="列出 RPA 任务 (可按企业 / 状态筛选)",
)
async def list_tasks(
    enterprise_id: str | None = Query(default=None, alias="enterpriseId"),
    status: str | None = Query(default=None),
):
    items = await rpa_service.list_tasks(enterprise_id, status)
    return make_ok(items)


@router.get(
    "/tasks/{task_id}",
    response_model=ApiResult[RPATask],
    summary="获取 RPA 任务详情",
)
async def get_task(task_id: str):
    from app.services.rpa_service import _rpa_store
    raw = await _rpa_store.get_task(task_id)
    if not raw:
        return make_ok(None, code=404, message=f"RPA 任务 {task_id} 不存在")
    return make_ok(RPATask.model_validate(raw))


@router.post(
    "/tasks/{task_id}/execute",
    response_model=ApiResult[RPATask],
    summary="执行 RPA 任务 (SDK 不可用 → reportlab → 文本降级)",
)
async def execute_task(task_id: str):
    try:
        task = await rpa_service.execute_rpa_task(task_id)
        return make_ok(task)
    except ValueError as e:
        return make_ok(None, code=404, message=str(e))


# ========================================================================
# R7.0 银行冷启动 PDF 申报书模板 (6 家银行: ICBC/CCB/ABC/BOC/BOCOM/CMB)
# ========================================================================

class ApplicationDataReq(_Base):
    """银行申报书数据 (统一 schema, 见 bank_application_templates.yaml)."""
    enterprise_name: str | None = None
    uscc: str | None = None
    legal_representative: str | None = None
    registered_capital: float | None = None
    established_at: str | None = None
    industry_code: str | None = None
    contact_phone: str | None = None
    contact_address: str | None = None
    loan_amount: float | None = None
    loan_term_months: int | None = None
    loan_purpose: str | None = None
    repayment_source: str | None = None
    annual_revenue: float | None = None
    net_profit: float | None = None
    total_assets: float | None = None
    total_liabilities: float | None = None
    bank_account_no: str | None = None
    credit_rating: str | None = None
    existing_loans_balance: float | None = None


@router.get(
    "/application-templates",
    response_model=ApiResult[dict],
    summary="列出 6 家银行申报书模板 (R7.0)",
)
async def list_bank_application_templates():
    """列出 6 家银行申报书模板元信息 (bank_code → bank_name/full_name/version)."""
    tpls = get_bank_templates()
    summary = {
        bc: {
            "bank_name": tpl.get("bank_name", ""),
            "full_name": tpl.get("full_name", ""),
            "template_version": tpl.get("template_version", ""),
            "header_color": tpl.get("header_color", ""),
            "sections_count": len(tpl.get("sections", [])),
        }
        for bc, tpl in tpls.items()
    }
    return make_ok(summary)


@router.post(
    "/application-pdf/{bank_code}",
    summary="生成银行 PDF 申报书 (R7.0, application/pdf)",
    responses={
        200: {"content": {"application/pdf": {}}, "description": "银行申报书 PDF bytes"},
        400: {"description": "未知 bank_code"},
    },
)
async def generate_bank_application_pdf(
    bank_code: str,
    enterprise_id: str = Query(..., alias="enterpriseId"),
    payload: ApplicationDataReq = Body(default=None),
):
    """生成指定银行的 PDF 申报书 (6 家银行模板 + 字段映射).

    Args:
        bank_code: 银行代码 (路径参数, ICBC/CCB/ABC/BOC/BOCOM/CMB)
        enterprise_id: 企业 ID (Query)
        payload: 申报数据 (ApplicationDataReq, 见 schema)
    """
    application_data = payload.model_dump(by_alias=False) if payload else {}
    # 移除 None 字段
    application_data = {k: v for k, v in application_data.items() if v is not None}
    try:
        pdf_bytes = await rpa_service.generate_bank_application_pdf(
            enterprise_id=enterprise_id,
            bank_code=bank_code,
            application_data=application_data,
            save_to_file=False,
        )
    except ValueError as e:
        return Response(
            content=str(e).encode("utf-8"),
            media_type="text/plain",
            status_code=400,
        )
    media_type = (
        "application/pdf"
        if isinstance(pdf_bytes, (bytes, bytearray)) and pdf_bytes[:4] == b"%PDF"
        else "text/plain"
    )
    return Response(content=bytes(pdf_bytes), media_type=media_type)
