"""银企直连 DATA-01 API 路由 (R1.1).

端点 (prefix=/data/bank, tags=["DATA-01 银企直连"]):
    GET    /adapters                   列出 6 家银行适配器
    POST   /oauth/authorize            发起 OAuth 授权
    POST   /oauth/callback             完成 OAuth 回调换 token
    GET    /accounts                   聚合查询账户 (可选 adapter_id)
    GET    /transactions               聚合查询交易 (可选 adapter_id/account_id/days)
    POST   /refresh                    触发聚合刷新 (并行+超时+重试+降级)

所有接口用 make_ok 包装 (与 v1/router.py 其他路由一致).
"""

from __future__ import annotations

from fastapi import APIRouter, Query, status

from app.api.deps import make_ok
from app.deps import CurrentUser
from app.schemas.bank_aggregator import (
    AggregatedResult, BankAccount, BankAdapterInfo, BankTransaction,
    OAuthAuthorizationRequest, OAuthAuthorizationResponse, OAuthTokenResult,
)
from app.schemas.common import ApiResult
from app.services.bank_aggregator_service import BankAggregatorService


data_bank_router = APIRouter(prefix="/data/bank", tags=["DATA-01 银企直连"])


def _svc() -> BankAggregatorService:
    return BankAggregatorService(db=None)


# ============================================================================
# 1. GET /adapters - 列出 6 家银行适配器
# ============================================================================

@data_bank_router.get(
    "/adapters",
    response_model=ApiResult[list[BankAdapterInfo]],
    summary="列出银行适配器",
)
async def list_adapters(_user: CurrentUser):
    items = await _svc().list_adapters()
    return make_ok(items)


# ============================================================================
# 2. POST /oauth/authorize - 发起 OAuth 授权
# ============================================================================

@data_bank_router.post(
    "/oauth/authorize",
    response_model=ApiResult[OAuthAuthorizationResponse],
    summary="发起 OAuth 授权",
)
async def start_oauth(payload: OAuthAuthorizationRequest, _user: CurrentUser):
    resp = await _svc().start_oauth(
        enterprise_id=payload.enterprise_id,
        adapter_id=payload.adapter_id,
        redirect_uri=payload.redirect_uri,
        scopes=payload.scopes,
    )
    return make_ok(resp)


# ============================================================================
# 3. POST /oauth/callback - 完成 OAuth 回调换 token
# ============================================================================

@data_bank_router.post(
    "/oauth/callback",
    response_model=ApiResult[OAuthTokenResult],
    status_code=status.HTTP_201_CREATED,
    summary="完成 OAuth 回调",
)
async def complete_oauth(
    enterprise_id: str = Query(..., alias="enterpriseId"),
    adapter_id: str = Query(..., alias="adapterId"),
    code: str = Query(...),
    state: str = Query(...),
    _user: CurrentUser = None,
):
    token = await _svc().complete_oauth(
        enterprise_id=enterprise_id,
        adapter_id=adapter_id,
        code=code,
        state=state,
    )
    return make_ok(token)


# ============================================================================
# 4. GET /accounts - 聚合查询账户
# ============================================================================

@data_bank_router.get(
    "/accounts",
    response_model=ApiResult[list[BankAccount]],
    summary="聚合查询账户",
)
async def list_accounts(
    enterprise_id: str = Query(..., alias="enterpriseId"),
    adapter_id: str | None = Query(default=None, alias="adapterId"),
    _user: CurrentUser = None,
):
    items = await _svc().list_accounts(
        enterprise_id=enterprise_id,
        adapter_id=adapter_id,
    )
    return make_ok(items)


# ============================================================================
# 5. GET /transactions - 聚合查询交易
# ============================================================================

@data_bank_router.get(
    "/transactions",
    response_model=ApiResult[list[BankTransaction]],
    summary="聚合查询交易",
)
async def list_transactions(
    enterprise_id: str = Query(..., alias="enterpriseId"),
    adapter_id: str | None = Query(default=None, alias="adapterId"),
    account_id: str | None = Query(default=None, alias="accountId"),
    days: int = Query(default=30, ge=1, le=365),
    _user: CurrentUser = None,
):
    items = await _svc().list_transactions(
        enterprise_id=enterprise_id,
        account_id=account_id,
        days=days,
        adapter_id=adapter_id,
    )
    return make_ok(items)


# ============================================================================
# 6. POST /refresh - 触发聚合刷新
# ============================================================================

@data_bank_router.post(
    "/refresh",
    response_model=ApiResult[AggregatedResult],
    summary="触发聚合刷新",
)
async def trigger_refresh(
    enterprise_id: str = Query(..., alias="enterpriseId"),
    adapter_ids: list[str] | None = Query(default=None, alias="adapterIds"),
    _user: CurrentUser = None,
):
    result = await _svc().trigger_aggregate_refresh(
        enterprise_id=enterprise_id,
        adapter_ids=adapter_ids,
    )
    return make_ok(result)
