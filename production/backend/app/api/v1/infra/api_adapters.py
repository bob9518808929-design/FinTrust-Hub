"""INFRA-01b 外部 API 适配层 API (P1 R2.11).

15 个适配器 + 限流 + 断路器 + fallback。
prefix="/infra/adapters", tags=["INFRA-01b API 适配层"]
"""

from __future__ import annotations

from fastapi import APIRouter, Body

from app.api.deps import make_ok
from app.schemas.api_adapters import (
    AdapterId,
    AdapterRuntime,
    InvokeRequest,
    InvokeResult,
)
from app.schemas.common import ApiResult
from app.services.api_adapter_registry import get_adapter_registry_sync

api_adapters_router = APIRouter(prefix="/infra/adapters", tags=["INFRA-01b API 适配层"])


def _reg():
    return get_adapter_registry_sync()


@api_adapters_router.get(
    "",
    response_model=ApiResult[dict[str, AdapterRuntime]],
    summary="列出 15 个适配器运行时状态",
)
async def list_runtimes():
    reg = _reg()
    rts = await reg.list_runtimes()
    out = {k.value: v for k, v in rts.items()}
    return make_ok(out)


@api_adapters_router.get(
    "/{adapter_id}",
    response_model=ApiResult[AdapterRuntime],
    summary="获取单个适配器运行时",
)
async def get_runtime(adapter_id: AdapterId):
    reg = _reg()
    rt = await reg.get_runtime(adapter_id)
    return make_ok(rt)


@api_adapters_router.post(
    "/{adapter_id}/invoke",
    response_model=ApiResult[InvokeResult],
    summary="调用适配器 (限流 + 超时重试 + 断路器 + fallback)",
)
async def invoke(adapter_id: AdapterId, payload: dict = Body(...)):
    reg = _reg()
    req = InvokeRequest(
        adapter_id=adapter_id,
        operation=payload.get("operation", "default"),
        params=payload.get("params", {}),
        timeout_ms=payload.get("timeoutMs", 3000),
        retry_times=payload.get("retryTimes", 3),
    )
    result = await reg.invoke(req)
    if result.status.value == "rate_limited":
        return make_ok(result, code=429, message="Rate limited - too many requests")
    return make_ok(result)


@api_adapters_router.post(
    "/{adapter_id}/circuit/trip",
    response_model=ApiResult[bool],
    summary="手动触发断路器 (强制 fallback)",
)
async def circuit_trip(adapter_id: AdapterId):
    reg = _reg()
    await reg.circuit_breaker_trip(adapter_id)
    return make_ok(True)


@api_adapters_router.post(
    "/{adapter_id}/circuit/reset",
    response_model=ApiResult[bool],
    summary="手动重置断路器 (恢复 OK 状态)",
)
async def circuit_reset(adapter_id: AdapterId):
    reg = _reg()
    await reg.circuit_breaker_reset(adapter_id)
    return make_ok(True)
