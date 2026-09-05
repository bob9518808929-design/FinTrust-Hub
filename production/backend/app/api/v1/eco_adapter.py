"""ECO-03 无接口适配器路由.

端点:
    POST   /eco-adapter/application        生成信贷申报书 PDF
    POST   /eco-adapter/{app_id}/ack       银行回执
"""

from fastapi import APIRouter, status
from pydantic import BaseModel

from app.api.deps import make_ok
from app.deps import CurrentUser
from app.schemas.common import ApiResult
from app.schemas.eco import CreditApplicationInput, CreditApplicationRecord
from app.services.eco_service import eco_adapter_service

router = APIRouter(prefix="/eco-adapter", tags=["ECO-03 无接口适配器"])


class AckReq(BaseModel):
    acknowledgement: str


@router.post("/application", response_model=ApiResult[CreditApplicationRecord], status_code=status.HTTP_201_CREATED, summary="生成信贷申报书")
async def generate_application(payload: CreditApplicationInput, _user: CurrentUser):
    result = await eco_adapter_service.generateApplication(payload)
    return make_ok(result)


@router.post("/{app_id}/ack", response_model=ApiResult[CreditApplicationRecord], summary="银行回执")
async def acknowledge(app_id: str, req: AckReq, _user: CurrentUser):
    try:
        result = await eco_adapter_service.acknowledge(app_id, req.acknowledgement)
        return make_ok(result)
    except ValueError as e:
        return make_ok(None, code=-1, message=str(e))
