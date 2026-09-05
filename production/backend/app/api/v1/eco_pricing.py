"""ECO-02 阶梯定价路由.

端点:
    POST   /eco-pricing/calculate         计算分成
    GET    /eco-pricing/enterprise/{eid}    列企业分成记录
"""

from fastapi import APIRouter, status

from app.api.deps import make_ok
from app.deps import CurrentUser
from app.schemas.common import ApiResult
from app.schemas.eco import SettlementCalcInput, SettlementRecord
from app.services.eco_service import eco_pricing_service

router = APIRouter(prefix="/eco-pricing", tags=["ECO-02 阶梯定价"])


@router.post("/calculate", response_model=ApiResult[SettlementRecord], status_code=status.HTTP_201_CREATED, summary="计算分成")
async def calculate(payload: SettlementCalcInput, _user: CurrentUser):
    try:
        result = await eco_pricing_service.calculate(payload)
        return make_ok(result)
    except ValueError as e:
        return make_ok(None, code=-1, message=str(e))


@router.get("/enterprise/{enterprise_id}", response_model=ApiResult[list[SettlementRecord]], summary="列企业分成记录")
async def list_by_enterprise(enterprise_id: str, _user: CurrentUser):
    result = await eco_pricing_service.listByEnterprise(enterprise_id)
    return make_ok(result)
