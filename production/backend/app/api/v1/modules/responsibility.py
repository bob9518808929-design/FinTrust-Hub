"""文件名：responsibility.py 职责：MOD-14 人流责任链接口,提供 R0-R4 责任链阶段、行为挖掘与流程推进."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Query
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.api.deps import make_ok
from app.deps import CurrentUser
from app.schemas.common import ApiResult
from app.schemas.responsibility import (
    BehaviorMiningRecord, ChainStage, ResponsibilityChain, ResponsibilityResult,
)
from app.services.responsibility_chain_service import ResponsibilityChainService


class _AdvanceReq(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True, alias_generator=to_camel, use_enum_values=True,
    )
    target_stage: ChainStage
    evidences: Optional[list[str]] = None


class _BehaviorReq(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True, alias_generator=to_camel, use_enum_values=True,
    )
    person_id: str
    action: str
    weight: float = Field(default=0.5, ge=0.0, le=1.0)
    linked_tx_id: Optional[str] = None


router = APIRouter(prefix="/modules/responsibility", tags=["MOD-14 人流责任链"])


def _svc() -> ResponsibilityChainService:
    return ResponsibilityChainService(db=None)


@router.get(
    "/{enterprise_id}/chain",
    response_model=ApiResult[ResponsibilityChain],
    summary="获取企业责任链 (R0-R4 阶段 + 角色 + 完整度)",
)
async def get_chain(enterprise_id: str, _user: CurrentUser = None):
    chain = await _svc().get_chain(enterprise_id)
    return make_ok(chain)


@router.post(
    "/{enterprise_id}/advance",
    response_model=ApiResult[ResponsibilityResult],
    summary="推进责任链阶段 (补角色+补权限+积分奖励)",
)
async def advance_stage(
    enterprise_id: str,
    payload: _AdvanceReq,
    _user: CurrentUser = None,
):
    result = await _svc().advance_stage(
        enterprise_id, payload.target_stage, evidences=payload.evidences,
    )
    return make_ok(result)


@router.post(
    "/{enterprise_id}/behavior",
    response_model=ApiResult[BehaviorMiningRecord],
    summary="记录行为挖矿 (发积分)",
)
async def record_behavior(
    enterprise_id: str,
    payload: _BehaviorReq,
    _user: CurrentUser = None,
):
    rec = await _svc().record_behavior(
        enterprise_id=enterprise_id,
        person_id=payload.person_id,
        action=payload.action,
        weight=payload.weight,
        linked_tx_id=payload.linked_tx_id,
    )
    return make_ok(rec)


@router.get(
    "/{enterprise_id}/behaviors",
    response_model=ApiResult[list[BehaviorMiningRecord]],
    summary="列出行为挖矿记录 (可按人+天数筛选)",
)
async def list_behaviors(
    enterprise_id: str,
    person_id: Optional[str] = Query(default=None, alias="personId"),
    days: int = Query(default=30, ge=1, le=365),
    _user: CurrentUser = None,
):
    items = await _svc().list_behaviors(enterprise_id, person_id=person_id, days=days)
    return make_ok(items)
