"""INFRA-04 改造沙箱仿真 API (P2 R3.2 + R5.7 + R7.0 PDF 导出).

prefix="/infra/reform-sandbox", tags=["INFRA-04 改造沙箱"]
"""

from __future__ import annotations

from fastapi import APIRouter, Body, Query
from fastapi.responses import Response

from app.api.deps import make_ok
from app.schemas.common import ApiResult
from app.schemas.reform_sandbox import (
    PurgeInfo, Sandbox, SandboxChange, SandboxDiff,
)
from app.schemas.sandbox_indicator import IndicatorCurve, SandboxReport
from app.services.reform_sandbox_service import reform_sandbox_service


reform_sandbox_router = APIRouter(prefix="/infra/reform-sandbox", tags=["INFRA-04 改造沙箱"])


@reform_sandbox_router.post(
    "",
    response_model=ApiResult[Sandbox],
    summary="创建沙箱快照 (默认保留 30 天)",
)
async def create_sandbox(payload: dict = Body(...)):
    eid = payload.get("enterprise_id") or payload.get("enterpriseId")
    baseline = payload.get("baseline_name") or payload.get("baselineName") or "未命名基线"
    retained_days_raw = payload.get("retained_days") if payload.get("retained_days") is not None else payload.get("retainedDays")
    retained_days = int(retained_days_raw if retained_days_raw is not None else 30)
    sb = await reform_sandbox_service.create_sandbox(eid, baseline, retained_days)
    return make_ok(sb)


@reform_sandbox_router.get(
    "/enterprise/{eid}",
    response_model=ApiResult[list[Sandbox]],
    summary="按企业列出沙箱",
)
async def list_by_enterprise(eid: str):
    items = await reform_sandbox_service.list_by_enterprise(eid)
    return make_ok(items)


@reform_sandbox_router.get(
    "/{id}",
    response_model=ApiResult[Sandbox],
    summary="获取沙箱详情",
)
async def get_sandbox(id: str):
    sb = await reform_sandbox_service.get_sandbox(id)
    if not sb:
        return make_ok(None, code=404, message=f"沙箱 {id} 不存在")
    return make_ok(sb)


@reform_sandbox_router.post(
    "/{id}/changes",
    response_model=ApiResult[SandboxChange],
    summary="应用变更 (未确认, 投入沙箱暂存)",
)
async def apply_change(id: str, change: SandboxChange = Body(...)):
    try:
        c = await reform_sandbox_service.apply_change(id, change)
        return make_ok(c)
    except ValueError as e:
        return make_ok(None, code=404, message=str(e))


@reform_sandbox_router.post(
    "/{id}/changes/{cid}/confirm",
    response_model=ApiResult[SandboxChange],
    summary="确认变更 (commit 前必须先确认)",
)
async def confirm_change(id: str, cid: str, payload: dict = Body(...)):
    operator = payload.get("operator", "anonymous")
    try:
        c = await reform_sandbox_service.confirm_change(id, cid, operator)
        return make_ok(c)
    except ValueError as e:
        return make_ok(None, code=404, message=str(e))


@reform_sandbox_router.get(
    "/{id}/diff",
    response_model=ApiResult[SandboxDiff],
    summary="获取沙箱差异统计 (新增/删除/修改 + 未确认数)",
)
async def diff_sandbox(id: str):
    try:
        d = await reform_sandbox_service.diff_sandbox(id)
        return make_ok(d)
    except ValueError as e:
        return make_ok(None, code=404, message=str(e))


@reform_sandbox_router.post(
    "/{id}/commit",
    response_model=ApiResult[Sandbox],
    summary="提交沙箱 (要求全部变更已 confirmed)",
)
async def commit(id: str, payload: dict = Body(...)):
    operator = payload.get("operator", "anonymous")
    try:
        sb = await reform_sandbox_service.commit(id, operator)
        return make_ok(sb)
    except ValueError as e:
        msg = str(e)
        code = 409 if "尚未确认" in msg or "无法提交" in msg else 404
        return make_ok(None, code=code, message=msg)


@reform_sandbox_router.post(
    "/{id}/rollback",
    response_model=ApiResult[Sandbox],
    summary="回滚沙箱 (标记 rolled_back)",
)
async def rollback(id: str, payload: dict = Body(...)):
    operator = payload.get("operator", "anonymous")
    try:
        sb = await reform_sandbox_service.rollback(id, operator)
        return make_ok(sb)
    except ValueError as e:
        return make_ok(None, code=404, message=str(e))


@reform_sandbox_router.post(
    "/purge",
    response_model=ApiResult[PurgeInfo],
    summary="自动清理过期沙箱及未确认超 30 天变更",
)
async def auto_purge():
    info = await reform_sandbox_service.check_auto_purge()
    return make_ok(info)


# ====================================================================
# R5.7 12 项准入指标 + 沙箱报告
# ====================================================================

@reform_sandbox_router.get(
    "/{id}/indicators",
    response_model=ApiResult[list[IndicatorCurve]],
    summary="生成 12 项准入指标曲线 (R5.7)",
)
async def get_indicators(id: str):
    try:
        curves = await reform_sandbox_service.generate_indicator_curves(id)
        return make_ok(curves)
    except ValueError as e:
        return make_ok(None, code=404, message=str(e))


@reform_sandbox_router.get(
    "/{id}/report",
    response_model=ApiResult[SandboxReport],
    summary="生成沙箱报告 (含 12 指标 + 风险标注, R5.7)",
)
async def get_report(id: str):
    try:
        report = await reform_sandbox_service.generate_sandbox_report(id)
        return make_ok(report)
    except ValueError as e:
        return make_ok(None, code=404, message=str(e))


# ====================================================================
# R7.0 沙箱预演报告 PDF 导出 (指标曲线图 + risk_flags 表格 + 改造建议)
# ====================================================================

@reform_sandbox_router.get(
    "/enterprise/{enterprise_id}/export-pdf",
    summary="导出沙箱预演报告 PDF (application/pdf, R7.0)",
    responses={
        200: {"content": {"application/pdf": {}}, "description": "PDF 报告 bytes"},
        404: {"description": "企业无沙箱"},
    },
)
async def export_pdf_report(
    enterprise_id: str,
    sandbox_id: str | None = Query(
        default=None, alias="sandboxId",
        description="指定沙箱 ID; 不传则取企业最近一个沙箱",
    ),
):
    """导出沙箱预演报告 PDF (含 12 项指标曲线图 + risk_flags 表格 + 改造建议).

    Args:
        enterprise_id: 企业 ID (路径参数)
        sandbox_id: 沙箱 ID (Query, 可选; 不传取企业最近沙箱)

    Returns:
        application/pdf (PDF bytes; reportlab 不可用降级为 UTF-8 文本 bytes)
    """
    # 选定沙箱 ID
    sb_id = sandbox_id
    if not sb_id:
        sbs = await reform_sandbox_service.list_by_enterprise(enterprise_id)
        if not sbs:
            return Response(
                content=f"企业 {enterprise_id} 无沙箱".encode("utf-8"),
                media_type="text/plain",
                status_code=404,
            )
        sb_id = sbs[0].id
    try:
        report = await reform_sandbox_service.generate_sandbox_report(sb_id)
    except ValueError as e:
        return Response(
            content=str(e).encode("utf-8"),
            media_type="text/plain",
            status_code=404,
        )
    pdf_bytes = await reform_sandbox_service.export_pdf_report(
        enterprise_id=enterprise_id,
        sandbox_result=report,
        save_to_file=False,
    )
    # reportlab 不可用时降级为文本 bytes (扩展名仍 .pdf, 内容是文本)
    media_type = (
        "application/pdf"
        if isinstance(pdf_bytes, (bytes, bytearray)) and pdf_bytes[:4] == b"%PDF"
        else "text/plain"
    )
    return Response(content=bytes(pdf_bytes), media_type=media_type)
