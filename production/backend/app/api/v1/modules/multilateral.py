"""MOD-13 多方协作 API (R5.8).

prefix="/modules/multilateral", tags=["MOD-13 多方协作"]
"""

from __future__ import annotations

from fastapi import APIRouter, Body, Query
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.api.deps import make_ok
from app.schemas.common import ApiResult
from app.schemas.multilateral import (
    CollaborationTask, ElectronicSeal, SLAMetric,
)
from app.services.multilateral_service import multilateral_service


router = APIRouter(prefix="/modules/multilateral", tags=["MOD-13 多方协作"])


class _Base(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True, alias_generator=to_camel, use_enum_values=True,
    )


class CreateSealReq(_Base):
    enterprise_id: str
    signatory_name: str
    certificate_no: str
    seal_type: str = "enterprise"


class SignDocumentReq(_Base):
    seal_id: str
    document_hash: str


class CreateTaskReq(_Base):
    enterprise_id: str
    title: str
    assignee_roles: list[str] = Field(default_factory=list)
    sla_hours: int = Field(default=48, ge=1, le=720)


class CompleteTaskReq(_Base):
    operator_role: str


# === 电子签章 ===

@router.post(
    "/seals",
    response_model=ApiResult[ElectronicSeal],
    summary="创建电子签章",
)
async def create_seal(payload: CreateSealReq = Body(...)):
    seal = await multilateral_service.create_seal(
        enterprise_id=payload.enterprise_id,
        signatory_name=payload.signatory_name,
        certificate_no=payload.certificate_no,
        seal_type=payload.seal_type,
    )
    return make_ok(seal)


@router.get(
    "/seals",
    response_model=ApiResult[list[ElectronicSeal]],
    summary="列出电子签章 (可按企业筛选)",
)
async def list_seals(
    enterprise_id: str | None = Query(default=None, alias="enterpriseId"),
):
    items = await multilateral_service.list_seals(enterprise_id)
    return make_ok(items)


@router.post(
    "/sign",
    summary="电子签章对文档签名 (SDK 不可用降级 mock)",
)
async def sign_document(payload: SignDocumentReq = Body(...)):
    result = await multilateral_service.sign_document(
        seal_id=payload.seal_id,
        document_hash=payload.document_hash,
    )
    return make_ok(result)


# === 协作任务 ===

@router.post(
    "/tasks",
    response_model=ApiResult[CollaborationTask],
    summary="创建协作任务 (含 SLA 截止时间)",
)
async def create_task(payload: CreateTaskReq = Body(...)):
    task = await multilateral_service.create_collaboration_task(
        enterprise_id=payload.enterprise_id,
        title=payload.title,
        assignee_roles=payload.assignee_roles,
        sla_hours=payload.sla_hours,
    )
    return make_ok(task)


@router.get(
    "/tasks",
    response_model=ApiResult[list[CollaborationTask]],
    summary="列出协作任务 (可按企业 / 状态筛选)",
)
async def list_tasks(
    enterprise_id: str | None = Query(default=None, alias="enterpriseId"),
    status: str | None = Query(default=None),
):
    items = await multilateral_service.list_tasks(enterprise_id, status)
    return make_ok(items)


@router.post(
    "/tasks/{task_id}/complete",
    response_model=ApiResult[CollaborationTask],
    summary="标记协作任务完成",
)
async def complete_task(task_id: str, payload: CompleteTaskReq = Body(...)):
    try:
        task = await multilateral_service.complete_task(task_id, payload.operator_role)
        return make_ok(task)
    except ValueError as e:
        return make_ok(None, code=404, message=str(e))


@router.get(
    "/sla/check",
    response_model=ApiResult[list[SLAMetric]],
    summary="扫描超期任务并生成 SLA 指标",
)
async def sla_check():
    metrics = await multilateral_service.sla_check()
    return make_ok(metrics)
