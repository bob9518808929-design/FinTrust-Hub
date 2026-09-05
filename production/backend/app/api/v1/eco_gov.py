"""ECO-08 政府背书催化剂路由.

端点:
    POST   /eco-gov/reports              提交脱敏报告
    GET    /eco-gov/reports               列报告 (可选 enterpriseId)
    POST   /eco-gov/reports/{rid}/ack     监管回执
    POST   /eco-gov/endorsements          申请背书
    POST   /eco-gov/endorsements/{app}/grant  授予背书
    GET    /eco-gov/endorsements          列背书 (可选 enterpriseId)

project_memory 硬约束: log() 包含 id / enterprise / source 字段.
"""

from fastapi import APIRouter, status
from pydantic import BaseModel

from app.api.deps import make_ok
from app.deps import CurrentUser
from app.schemas.common import ApiResult
from app.schemas.eco import (
    GovEndorseApplyInput, GovEndorseApplyResult, GovEndorsement,
    GovReport, GovReportInput,
)
from app.services.eco_service import eco_gov_service

router = APIRouter(prefix="/eco-gov", tags=["ECO-08 政府背书"])


class AckReq(BaseModel):
    ack: dict


@router.post("/reports", response_model=ApiResult[GovReport], status_code=status.HTTP_201_CREATED, summary="提交脱敏报告")
async def submit_report(payload: GovReportInput, _user: CurrentUser):
    """project_memory: report 含 id/enterprise/source 字段."""
    result = await eco_gov_service.submitReport(payload)
    return make_ok(result)


@router.get("/reports", response_model=ApiResult[list[GovReport]], summary="列报告")
async def list_reports(enterprise_id: str | None = None, _user: CurrentUser = None):
    result = await eco_gov_service.listReports(enterprise_id)
    return make_ok(result)


@router.post("/reports/{report_id}/ack", response_model=ApiResult[GovReport], summary="监管回执")
async def ack_report(report_id: str, req: AckReq, _user: CurrentUser):
    try:
        result = await eco_gov_service.ackReport(report_id, req.ack)
        return make_ok(result)
    except ValueError as e:
        return make_ok(None, code=-1, message=str(e))


@router.post("/endorsements", response_model=ApiResult[GovEndorseApplyResult], status_code=status.HTTP_201_CREATED, summary="申请背书")
async def apply_endorsement(payload: GovEndorseApplyInput, _user: CurrentUser):
    result = await eco_gov_service.applyEndorsement(payload)
    return make_ok(result)


@router.post("/endorsements/{application_id}/grant", response_model=ApiResult[GovEndorsement], summary="授予背书")
async def grant_endorsement(application_id: str, level: str = "provisional", _user: CurrentUser = None):
    result = await eco_gov_service.grantEndorsement(application_id, level)
    return make_ok(result)


@router.get("/endorsements", response_model=ApiResult[list[GovEndorsement]], summary="列背书")
async def list_endorsements(enterprise_id: str | None = None, _user: CurrentUser = None):
    result = await eco_gov_service.listEndorsements(enterprise_id)
    return make_ok(result)
