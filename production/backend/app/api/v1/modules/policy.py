"""文件名：policy.py 职责：MOD-10 政策与行业因素接口,提供政策因素列表与企业政策分析."""
from __future__ import annotations

from fastapi import APIRouter

from app.api.deps import make_ok
from app.deps import CurrentUser
from app.schemas.common import ApiResult
from app.schemas.policy_factor import EnterprisePolicyAnalysis, PolicyFactor
from app.services.policy_factor_service import PolicyFactorService

router = APIRouter(prefix="/modules/policy", tags=["MOD-10 政策与行业因素"])


def _svc() -> PolicyFactorService:
    return PolicyFactorService(db=None)


@router.get(
    "/factors",
    response_model=ApiResult[list[PolicyFactor]],
    summary="列出全部 8 条政策因子",
)
async def list_factors(_user: CurrentUser = None):
    items = await _svc().list_factors()
    return make_ok(items)


@router.get(
    "/analyze/{enterprise_id}",
    response_model=ApiResult[EnterprisePolicyAnalysis],
    summary="分析企业政策命中与行业调整系数",
)
async def analyze_enterprise(enterprise_id: str, _user: CurrentUser = None):
    result = await _svc().analyze_enterprise(enterprise_id)
    return make_ok(result)
