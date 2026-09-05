"""CORE-03 企业可选配置引擎 API (P1 R2.10).

prefix="/core/opt-in", tags=["CORE-03 配置引擎"]
"""

from __future__ import annotations

from fastapi import APIRouter, Body, Query

from app.api.deps import make_ok
from app.schemas.common import ApiResult
from app.schemas.opt_in_config import (
    ConfigDiff,
    CooperationMethod,
    DataFlow,
    EnterpriseOptConfig,
    OptionalModule,
)
from app.services.opt_in_config_engine import opt_in_config_engine

opt_in_router = APIRouter(prefix="/core/opt-in", tags=["CORE-03 配置引擎"])


@opt_in_router.get(
    "/{enterprise_id}",
    response_model=ApiResult[EnterpriseOptConfig],
    summary="获取企业可选配置",
)
async def get_config(enterprise_id: str):
    cfg = await opt_in_config_engine.get_config(enterprise_id)
    return make_ok(cfg)


@opt_in_router.put(
    "/{enterprise_id}/flows",
    response_model=ApiResult[ConfigDiff],
    summary="设置启用的数据流 (6 条可选)",
)
async def set_flows(
    enterprise_id: str,
    flows: list[DataFlow] = Body(...),
):
    diff = await opt_in_config_engine.set_flows(enterprise_id, flows)
    return make_ok(diff)


@opt_in_router.put(
    "/{enterprise_id}/modules/{module}",
    response_model=ApiResult[ConfigDiff],
    summary="启停单个可选模块",
)
async def toggle_module(
    enterprise_id: str,
    module: OptionalModule,
    enabled: bool = Query(..., description="true=启用, false=停用"),
):
    diff = await opt_in_config_engine.toggle_module(enterprise_id, module, enabled)
    return make_ok(diff)


@opt_in_router.put(
    "/{enterprise_id}/cooperation",
    response_model=ApiResult[ConfigDiff],
    summary="设置合作方式 (FULL_TRUST/CO_LENDING/GUARANTEED/INSURED)",
)
async def set_cooperation(
    enterprise_id: str,
    method: CooperationMethod = Query(..., description="合作方式"),
):
    diff = await opt_in_config_engine.set_cooperation(enterprise_id, method)
    return make_ok(diff)


@opt_in_router.post(
    "/{enterprise_id}/reset",
    response_model=ApiResult[ConfigDiff],
    summary="重置为默认配置 (6 flow 全开 + 16 模块全启 + FULL_TRUST)",
)
async def reset_to_default(enterprise_id: str):
    diff = await opt_in_config_engine.reset_to_default(enterprise_id)
    return make_ok(diff)
