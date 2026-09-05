"""ECO-09 数字分身 AI Agent 路由.

端点:
    POST   /eco-bot/parse            意图识别
    POST   /eco-bot/execute          执行命令
    POST   /eco-bot/broadcast       群发消息
    GET    /eco-bot/config/{eid}     查企业 bot 配置

project_memory 硬约束: action 字符串用管道分隔 (如 switchTab|approval).
"""

from fastapi import APIRouter

from app.api.deps import make_ok
from app.deps import CurrentUser
from app.schemas.common import ApiResult
from app.schemas.eco import (
    BotBroadcastInput,
    BotBroadcastResult,
    BotCommandParse,
    BotCommandResult,
    BotConfig,
    BotExecuteInput,
    BotParseInput,
)
from app.services.eco_service import eco_bot_service

router = APIRouter(prefix="/eco-bot", tags=["ECO-09 数字分身"])


@router.post("/parse", response_model=ApiResult[BotCommandParse], summary="意图识别")
async def parse(payload: BotParseInput, _user: CurrentUser):
    result = await eco_bot_service.parse(
        payload.text, payload.channel, payload.enterprise_id, payload.worker_id,
    )
    return make_ok(result)


@router.post("/execute", response_model=ApiResult[BotCommandResult], summary="执行命令")
async def execute(payload: BotExecuteInput, _user: CurrentUser):
    result = await eco_bot_service.execute(payload)
    return make_ok(result)


@router.post("/broadcast", response_model=ApiResult[BotBroadcastResult], summary="群发消息")
async def broadcast(payload: BotBroadcastInput, _user: CurrentUser):
    result = await eco_bot_service.broadcast(payload)
    return make_ok(result)


@router.get("/config/{enterprise_id}", response_model=ApiResult[BotConfig], summary="查 bot 配置")
async def get_config(enterprise_id: str, _user: CurrentUser):
    result = await eco_bot_service.getConfig(enterprise_id)
    return make_ok(result)
