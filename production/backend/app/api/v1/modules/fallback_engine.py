"""MOD-15 兜底引擎 API (R6.3).

prefix="/modules/fallback", tags=["MOD-15 兜底引擎"]
"""

from __future__ import annotations

from fastapi import APIRouter, Body
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.api.deps import make_ok
from app.schemas.common import ApiResult
from app.schemas.fallback_engine import (
    FallbackConfig,
    FallbackMode,
    SyncResult,
)
from app.services.fallback_engine_service import fallback_engine_service

router = APIRouter(prefix="/modules/fallback", tags=["MOD-15 兜底引擎"])


class _Base(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True, alias_generator=to_camel, use_enum_values=True,
    )


class SetModeReq(_Base):
    mode: FallbackMode


class QueueOpReq(_Base):
    operation: dict = Field(default_factory=dict)


@router.get(
    "/{enterprise_id}/config",
    response_model=ApiResult[FallbackConfig],
    summary="获取企业兜底配置",
)
async def get_config(enterprise_id: str):
    cfg = await fallback_engine_service.get_config(enterprise_id)
    return make_ok(cfg)


@router.post(
    "/{enterprise_id}/mode",
    response_model=ApiResult[FallbackConfig],
    summary="切换运行模式 (ONLINE/OFFLINE/DEGRADED)",
)
async def set_mode(enterprise_id: str, payload: SetModeReq = Body(...)):
    cfg = await fallback_engine_service.set_mode(enterprise_id, payload.mode)
    return make_ok(cfg)


@router.post(
    "/{enterprise_id}/queue",
    response_model=ApiResult[int],
    summary="排队操作 (离线模式, 返回队列长度)",
)
async def queue_op(enterprise_id: str, payload: QueueOpReq = Body(...)):
    count = await fallback_engine_service.queue_operation(
        enterprise_id, payload.operation,
    )
    return make_ok(count)


@router.post(
    "/{enterprise_id}/conflict-check",
    summary="检测本地与远程数据冲突",
)
async def check_conflict(enterprise_id: str):
    conflicts = await fallback_engine_service.check_conflict(enterprise_id)
    return make_ok(conflicts)


@router.post(
    "/{enterprise_id}/sync",
    response_model=ApiResult[SyncResult],
    summary="数据同步: 重放队列 + 冲突检测 + 增量",
)
async def sync_data(enterprise_id: str):
    result = await fallback_engine_service.sync_data(enterprise_id)
    return make_ok(result)


# === V3 离线模式健康检查 (MOD-15) ===

@router.get(
    "/health/offline",
    response_model=ApiResult[dict],
    summary="离线模式健康状态 (供独立 Docker 镜像 healthcheck 使用)",
)
async def health_check_offline():
    result = await fallback_engine_service.health_check_offline()
    return make_ok(result)
