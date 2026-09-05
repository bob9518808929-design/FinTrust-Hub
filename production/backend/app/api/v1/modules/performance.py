"""文件名：performance.py 职责：MOD-06 AI 履约评分引擎接口,计算企业 PD/IOY 评分与 N 个月趋势."""
from __future__ import annotations

from fastapi import APIRouter, Query

from app.api.deps import make_ok
from app.deps import CurrentUser
from app.schemas.common import ApiResult
from app.schemas.performance import PerformanceScore, PerfTrend
from app.services.performance_score_service import PerformanceScoreService

router = APIRouter(prefix="/modules/performance", tags=["MOD-06 AI 履约评分引擎"])


def _svc() -> PerformanceScoreService:
    return PerformanceScoreService(db=None)


@router.get(
    "/{enterprise_id}",
    response_model=ApiResult[PerformanceScore],
    summary="计算企业履约评分 (PD + IOY)",
)
async def compute_score(
    enterprise_id: str,
    use_llm: bool = Query(default=True, alias="useLlm"),
    _user: CurrentUser = None,
):
    score = await _svc().compute(enterprise_id, use_llm=use_llm)
    return make_ok(score)


@router.get(
    "/{enterprise_id}/trend",
    response_model=ApiResult[list[PerfTrend]],
    summary="履约能力趋势 (N 个月)",
)
async def get_trend(
    enterprise_id: str,
    months: int = Query(default=12, ge=1, le=36),
    _user: CurrentUser = None,
):
    items = await _svc().trend(enterprise_id, months=months)
    return make_ok(items)


@router.post(
    "/{enterprise_id}/deep-score",
    response_model=ApiResult[PerformanceScore],
    summary="LLM 深度评分 (MOD-06 R5.3, 降级到规则评分)",
)
async def deep_score(
    enterprise_id: str,
    _user: CurrentUser = None,
):
    score = await _svc().deep_score(enterprise_id)
    return make_ok(score)
