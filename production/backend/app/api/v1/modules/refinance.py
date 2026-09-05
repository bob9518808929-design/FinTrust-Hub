"""文件名：refinance.py 职责：MOD-11 再融资再贴现闭环接口,提供再融资入口、AI 推荐与现金流预测."""
from __future__ import annotations

from fastapi import APIRouter, Query

from app.api.deps import make_ok
from app.deps import CurrentUser
from app.schemas.common import ApiResult
from app.schemas.refinance import (
    AIRecommendation, CashflowForecast, RefinanceEntrance, RefinanceSubmission,
)
from app.services.refinance_service import RefinanceService

router = APIRouter(prefix="/modules/refinance", tags=["MOD-11 再融资再贴现闭环"])


def _svc() -> RefinanceService:
    return RefinanceService(db=None)


@router.get(
    "/{enterprise_id}/cashflow",
    response_model=ApiResult[list[CashflowForecast]],
    summary="6 个月现金流预测",
)
async def forecast_cashflow(
    enterprise_id: str,
    months: int = Query(default=6, ge=1, le=24),
    _user: CurrentUser = None,
):
    items = await _svc().forecast_cashflow(enterprise_id, months=months)
    return make_ok(items)


@router.get(
    "/{enterprise_id}/entrance",
    response_model=ApiResult[RefinanceEntrance],
    summary="再融资入口判定与缺口规模标签",
)
async def compute_entrance(enterprise_id: str, _user: CurrentUser = None):
    result = await _svc().compute_entrance(enterprise_id)
    return make_ok(result)


@router.get(
    "/{enterprise_id}/recommend",
    response_model=ApiResult[list[AIRecommendation]],
    summary="AI 推荐 4 款再融资产品",
)
async def ai_recommend(
    enterprise_id: str,
    use_llm: bool = Query(default=True, alias="useLlm"),
    _user: CurrentUser = None,
):
    items = await _svc().ai_recommend(enterprise_id, use_llm=use_llm)
    return make_ok(items)


@router.post(
    "/{enterprise_id}/submit",
    response_model=ApiResult[RefinanceSubmission],
    summary="提交再融资申请 (指定 rec_id)",
)
async def submit_application(
    enterprise_id: str,
    rec_id: str = Query(..., alias="recId"),
    _user: CurrentUser = None,
):
    result = await _svc().submit(enterprise_id, rec_id)
    return make_ok(result)
