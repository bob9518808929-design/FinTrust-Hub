"""ECO-07 行业合规指数路由.

端点:
    POST   /eco-index/calculate         计算指数快照
    GET    /eco-index/compare            企业 vs 行业基准对比
"""

from fastapi import APIRouter, status
from pydantic import BaseModel

from app.api.deps import make_ok
from app.deps import CurrentUser
from app.schemas.common import ApiResult
from app.schemas.eco import ComplianceIndexSnapshot, IndexCompareResult
from app.services.eco_service import eco_index_service

router = APIRouter(prefix="/eco-index", tags=["ECO-07 行业指数"])


class CalcReq(BaseModel):
    type: str
    industry: str | None = None
    period: str


class CompareReq(BaseModel):
    enterprise_value: float
    industry: str
    period: str


@router.post("/calculate", response_model=ApiResult[ComplianceIndexSnapshot], status_code=status.HTTP_201_CREATED, summary="计算指数快照")
async def calculate(req: CalcReq, _user: CurrentUser):
    result = await eco_index_service.calculate(req.type, req.industry, req.period)
    return make_ok(result)


@router.get("/compare", response_model=ApiResult[IndexCompareResult], summary="企业 vs 行业基准")
async def compare(enterprise_value: float, industry: str, period: str, _user: CurrentUser = None):
    result = await eco_index_service.compare(enterprise_value, industry, period)
    return make_ok(result)
