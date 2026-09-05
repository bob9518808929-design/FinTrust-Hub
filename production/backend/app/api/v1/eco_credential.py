"""ECO-04 联盟链凭证路由.

端点:
    POST   /eco-credential/issue             签发凭证
    GET    /eco-credential/{vc_id}/verify     验证凭证
    POST   /eco-credential/{vc_id}/revoke      吊销凭证
    GET    /eco-credential/enterprise/{eid}    列企业凭证
"""

from fastapi import APIRouter, status

from app.api.deps import make_ok
from app.deps import CurrentUser
from app.schemas.common import ApiResult
from app.schemas.eco import (
    CredentialIssueInput, CredentialVerifyResult, VerifiableCredential,
)
from app.services.eco_service import eco_credential_service

router = APIRouter(prefix="/eco-credential", tags=["ECO-04 联盟链凭证"])


@router.post("/issue", response_model=ApiResult[VerifiableCredential], status_code=status.HTTP_201_CREATED, summary="签发凭证")
async def issue(payload: CredentialIssueInput, _user: CurrentUser):
    result = await eco_credential_service.issue(payload)
    return make_ok(result)


@router.get("/{vc_id}/verify", response_model=ApiResult[CredentialVerifyResult], summary="验证凭证")
async def verify(vc_id: str, _user: CurrentUser):
    result = await eco_credential_service.verify(vc_id)
    return make_ok(result)


@router.post("/{vc_id}/revoke", response_model=ApiResult[dict], summary="吊销凭证")
async def revoke(vc_id: str, _user: CurrentUser):
    ok = await eco_credential_service.revoke(vc_id)
    if not ok:
        return make_ok(None, code=404, message=f"凭证 {vc_id} 不存在")
    return make_ok({"revoked": True, "vcId": vc_id})


@router.get("/enterprise/{enterprise_id}", response_model=ApiResult[list[VerifiableCredential]], summary="列企业凭证")
async def list_by_enterprise(enterprise_id: str, _user: CurrentUser):
    result = await eco_credential_service.listByEnterprise(enterprise_id)
    return make_ok(result)
