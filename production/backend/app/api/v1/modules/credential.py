"""MOD-08b W3C VC 信用凭证 + 联盟链跨行 API (P2 R3.1).

prefix="/modules/credential", tags=["MOD-08b W3C VC"]
"""

from __future__ import annotations

from fastapi import APIRouter, Body, Query

from app.api.deps import make_ok
from app.schemas.common import ApiResult
from app.schemas.credential import (
    CredentialType, CrossChainVerifyRequest, CrossChainVerifyResult,
    W3cVerifiableCredential,
)
from app.services.credential_service import credential_service


credential_router = APIRouter(prefix="/modules/credential", tags=["MOD-08b W3C VC"])


@credential_router.post(
    "/issue",
    response_model=ApiResult[W3cVerifiableCredential],
    summary="签发 W3C 可验证信用凭证 (EcdsaSecp256k1 + 链上存证)",
)
async def issue(payload: dict = Body(...)):
    eid = payload.get("enterprise_id") or payload.get("enterpriseId")
    ctype_raw = payload.get("credential_type") or payload.get("credentialType")
    ctype = CredentialType(ctype_raw) if isinstance(ctype_raw, str) else CredentialType.ENTERPRISE_CREDIT_SCORE
    claim = payload.get("claim", {})
    valid_days = int(payload.get("valid_days", 365))
    vc = await credential_service.issue(eid, ctype, claim, valid_days)
    return make_ok(vc)


@credential_router.get(
    "/{vc_id}",
    response_model=ApiResult[W3cVerifiableCredential],
    summary="根据 ID 获取凭证详情",
)
async def get_vc(vc_id: str):
    from app.services.credential_service import _vc_store
    raw = await _vc_store.get_vc(vc_id)
    if not raw:
        return make_ok(None, code=404, message=f"凭证 {vc_id} 不存在")
    return make_ok(W3cVerifiableCredential.model_validate(raw))


@credential_router.post(
    "/{vc_id}/verify",
    response_model=ApiResult[bool],
    summary="验证凭证 (签名+吊销状态+有效期)",
)
async def verify(vc_id: str):
    ok = await credential_service.verify(vc_id)
    return make_ok(ok)


@credential_router.post(
    "/{vc_id}/revoke",
    response_model=ApiResult[W3cVerifiableCredential],
    summary="吊销凭证",
)
async def revoke(vc_id: str, payload: dict = Body(...)):
    reason = payload.get("reason", "manual")
    try:
        vc = await credential_service.revoke(vc_id, reason)
        return make_ok(vc)
    except ValueError as e:
        return make_ok(None, code=404, message=str(e))


@credential_router.get(
    "/enterprise/{eid}",
    response_model=ApiResult[list[W3cVerifiableCredential]],
    summary="按企业列出凭证",
)
async def list_by_enterprise(eid: str):
    items = await credential_service.list_by_enterprise(eid)
    return make_ok(items)


@credential_router.post(
    "/cross-chain-verify",
    response_model=ApiResult[CrossChainVerifyResult],
    summary="跨行联盟链凭证比对 (AntChain/ZhiXinChain/Local)",
)
async def cross_chain_verify(req: CrossChainVerifyRequest = Body(...)):
    result = await credential_service.cross_chain_verify(req)
    return make_ok(result)
