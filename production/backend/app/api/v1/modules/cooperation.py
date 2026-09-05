"""文件名：cooperation.py 职责：MOD-09 合作模式管理接口,提供 4 种合作模式(企业/银行/担保/保险)列表与切换."""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from app.api.deps import make_ok
from app.deps import CurrentUser
from app.schemas.common import ApiResult
from app.schemas.cooperation import (
    CooperationMode, ModeConfig, SwitchResult,
)
from app.services.cooperation_mode_service import CooperationModeService


class _SwitchReq(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True, alias_generator=to_camel, use_enum_values=True,
    )
    new_mode: CooperationMode


router = APIRouter(prefix="/modules/cooperation", tags=["MOD-09 合作模式管理"])


def _svc() -> CooperationModeService:
    return CooperationModeService(db=None)


@router.get(
    "/modes",
    response_model=ApiResult[list[ModeConfig]],
    summary="列出全部 4 种合作模式及配置",
)
async def list_modes(_user: CurrentUser = None):
    items = _svc().list_all_configs()
    return make_ok(items)


@router.get(
    "/enterprise/{enterprise_id}",
    response_model=ApiResult[CooperationMode],
    summary="查询企业当前合作模式",
)
async def get_enterprise_mode(enterprise_id: str, _user: CurrentUser = None):
    mode = await _svc().get_enterprise_mode(enterprise_id)
    return make_ok(mode)


@router.post(
    "/enterprise/{enterprise_id}/switch",
    response_model=ApiResult[SwitchResult],
    summary="切换企业合作模式",
)
async def switch_enterprise_mode(
    enterprise_id: str,
    payload: _SwitchReq,
    _user: CurrentUser = None,
):
    result = await _svc().switch_enterprise_mode(enterprise_id, payload.new_mode)
    return make_ok(result)
