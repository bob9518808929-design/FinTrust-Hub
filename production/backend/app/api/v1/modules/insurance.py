"""MOD-05 应收款保险 API (V3).

prefix="/modules/insurance", tags=["MOD-05 应收款保险"]

端点:
    POST   /policies            创建保单 (生成保单号, 计算保费)
    GET    /policies/{id}        查询保单
    GET    /policies             列出保单 (query: enterprise_id)
    POST   /claims               理赔申请
"""

from __future__ import annotations

from fastapi import APIRouter, Body, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.api.deps import make_ok
from app.deps import CurrentUser
from app.schemas.common import ApiResult
from app.services.insurance_service import insurance_service

router = APIRouter(prefix="/modules/insurance", tags=["MOD-05 应收款保险"])


class _Base(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True, alias_generator=to_camel, use_enum_values=True,
    )


# === 请求体 ===

class CreatePolicyReq(_Base):
    enterprise_id: str = Field(..., description="投保企业 ID")
    receivable_amount: float = Field(..., gt=0, description="应收账款金额 (元)")
    insured_party: str = Field(..., description="被保险方 (买方名称)")
    coverage_ratio: float = Field(
        default=0.8, gt=0.0, le=1.0, description="覆盖比例 0-1",
    )


class FileClaimReq(_Base):
    policy_id: str = Field(..., description="关联保单 ID")
    claim_amount: float = Field(..., gt=0, description="理赔金额 (元)")
    incident_desc: str = Field(..., description="事故描述 (买方违约/逾期等)")


# === 端点 ===

@router.post(
    "/policies",
    response_model=ApiResult[dict],
    summary="创建保单 (生成保单号, 计算保费)",
)
async def create_policy(payload: CreatePolicyReq = Body(...), _user: CurrentUser = None):
    try:
        policy = await insurance_service.create_policy(
            enterprise_id=payload.enterprise_id,
            receivable_amount=payload.receivable_amount,
            insured_party=payload.insured_party,
            coverage_ratio=payload.coverage_ratio,
        )
        return make_ok(policy)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None


@router.get(
    "/policies/{policy_id}",
    response_model=ApiResult[dict | None],
    summary="查询保单",
)
async def get_policy(policy_id: str, _user: CurrentUser = None):
    policy = await insurance_service.get_policy(policy_id)
    if not policy:
        return make_ok(None, code=404, message=f"保单 {policy_id} 不存在")
    return make_ok(policy)


@router.get(
    "/policies",
    response_model=ApiResult[list[dict]],
    summary="列出保单 (可按企业筛选)",
)
async def list_policies(
    enterprise_id: str | None = Query(default=None, alias="enterpriseId"),
    _user: CurrentUser = None,
):
    items = await insurance_service.list_policies(enterprise_id)
    return make_ok(items)


@router.post(
    "/claims",
    response_model=ApiResult[dict],
    summary="理赔申请",
)
async def file_claim(payload: FileClaimReq = Body(...), _user: CurrentUser = None):
    try:
        claim = await insurance_service.file_claim(
            policy_id=payload.policy_id,
            claim_amount=payload.claim_amount,
            incident_desc=payload.incident_desc,
        )
        return make_ok(claim)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None
