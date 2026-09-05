"""MOD-02 智能风控 — 风控规则 DSL + 热加载 + 流处理 API (R4.7).

prefix: /modules/risk-rule
tags:   MOD-02 风控规则

端点:
    GET    /rules                       列出规则 (query: ruleset_id, enabled_only)
    POST   /rules                       新增规则
    PUT    /rules/{rule_id}              更新规则
    DELETE /rules/{rule_id}              删除规则
    POST   /rules/{rule_id}/enable       启用规则
    POST   /rules/{rule_id}/disable      禁用规则
    GET    /rulesets                     列出规则集 (query: status)
    POST   /rulesets/{ruleset_id}/hot-reload   热加载规则集
    POST   /evaluate                     评估单笔交易 (body: tx_data dict)
    GET    /stream/events                列出流事件 (query: enterprise_id, processed, limit)
    POST   /stream/ingest                接收流事件并评估
    GET    /stream/stats                 流处理统计
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Body, Query
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.api.deps import make_ok
from app.deps import CurrentUser
from app.schemas.common import ApiResult
from app.schemas.risk_rule import (
    RiskEvaluationResult, RiskRule, RiskRuleCreate, RiskRuleSet,
    RiskRuleUpdate, RiskStreamEvent, RiskStreamEventCreate,
)
from app.services.risk_rule_engine import RiskRuleEngine, risk_rule_engine
from app.services.risk_stream_service import RiskStreamService, risk_stream_service


router = APIRouter(prefix="/modules/risk-rule", tags=["MOD-02 风控规则"])


def _engine_svc() -> RiskRuleEngine:
    return risk_rule_engine


def _stream_svc() -> RiskStreamService:
    return risk_stream_service


# === 请求体 ===

class _EvaluateReq(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True, alias_generator=to_camel, use_enum_values=True,
    )
    tx_data: dict = Field(default_factory=dict)


# === 规则 CRUD ===

@router.get(
    "/rules",
    response_model=ApiResult[list[RiskRule]],
    summary="列出规则 (可按 ruleset_id / enabled_only 过滤)",
)
async def list_rules(
    ruleset_id: Optional[str] = Query(default=None, alias="rulesetId"),
    enabled_only: bool = Query(default=False, alias="enabledOnly"),
    _user: CurrentUser = None,
):
    rules = await _engine_svc().list_rules(
        ruleset_id=ruleset_id, enabled_only=enabled_only,
    )
    return make_ok(rules)


@router.post(
    "/rules",
    response_model=ApiResult[RiskRule],
    summary="新增规则",
)
async def create_rule(
    payload: RiskRuleCreate, _user: CurrentUser = None,
):
    rule = await _engine_svc().add_rule(payload)
    return make_ok(rule)


@router.put(
    "/rules/{rule_id}",
    response_model=ApiResult[RiskRule],
    summary="更新规则",
)
async def update_rule(
    rule_id: str, payload: RiskRuleUpdate, _user: CurrentUser = None,
):
    patch = payload.model_dump(exclude_none=True, by_alias=True)
    rule = await _engine_svc().update_rule(rule_id, patch)
    return make_ok(rule)


@router.delete(
    "/rules/{rule_id}",
    response_model=ApiResult[dict],
    summary="删除规则",
)
async def delete_rule(rule_id: str, _user: CurrentUser = None):
    ok = await _engine_svc().delete_rule(rule_id)
    return make_ok({"ruleId": rule_id, "deleted": ok})


@router.post(
    "/rules/{rule_id}/enable",
    response_model=ApiResult[RiskRule],
    summary="启用规则",
)
async def enable_rule(rule_id: str, _user: CurrentUser = None):
    rule = await _engine_svc().enable_rule(rule_id)
    return make_ok(rule)


@router.post(
    "/rules/{rule_id}/disable",
    response_model=ApiResult[RiskRule],
    summary="禁用规则",
)
async def disable_rule(rule_id: str, _user: CurrentUser = None):
    rule = await _engine_svc().disable_rule(rule_id)
    return make_ok(rule)


# === 规则集 ===

@router.get(
    "/rulesets",
    response_model=ApiResult[list[RiskRuleSet]],
    summary="列出规则集 (可按 status 过滤)",
)
async def list_rulesets(
    status: Optional[str] = Query(default=None),
    _user: CurrentUser = None,
):
    items = await _engine_svc().list_rulesets(status=status)
    return make_ok(items)


@router.post(
    "/rulesets/{ruleset_id}/hot-reload",
    response_model=ApiResult[RiskRuleSet],
    summary="热加载规则集",
)
async def hot_reload_ruleset(ruleset_id: str, _user: CurrentUser = None):
    rs = await _engine_svc().hot_reload(ruleset_id)
    return make_ok(rs)


# === 评估 ===

@router.post(
    "/evaluate",
    response_model=ApiResult[RiskEvaluationResult],
    summary="评估单笔交易 (按当前规则集)",
)
async def evaluate_tx(payload: _EvaluateReq = Body(...), _user: CurrentUser = None):
    result = await _engine_svc().evaluate(payload.tx_data)
    return make_ok(result)


# === 流处理 ===

@router.get(
    "/stream/events",
    response_model=ApiResult[list[RiskStreamEvent]],
    summary="列出流事件 (可按 enterprise_id / processed 过滤)",
)
async def list_stream_events(
    enterprise_id: Optional[str] = Query(default=None, alias="enterpriseId"),
    processed: Optional[bool] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    _user: CurrentUser = None,
):
    items = await _stream_svc().list_events(
        enterprise_id=enterprise_id, processed=processed, limit=limit,
    )
    return make_ok(items)


@router.post(
    "/stream/ingest",
    response_model=ApiResult[RiskEvaluationResult],
    summary="接收流事件并评估",
)
async def ingest_stream_event(
    payload: RiskStreamEventCreate, _user: CurrentUser = None,
):
    now = _now_iso()
    event = RiskStreamEvent(
        event_id=_id("SE"),
        enterprise_id=payload.enterprise_id,
        tx_id=payload.tx_id,
        event_type=payload.event_type,
        payload=payload.payload,
        received_at_iso=now,
        processed=False,
        risk_result_id=None,
    )
    result = await _stream_svc().ingest(event)
    return make_ok(result)


@router.get(
    "/stream/stats",
    response_model=ApiResult[dict],
    summary="流处理统计",
)
async def stream_stats(_user: CurrentUser = None):
    raw = await _stream_svc().stream_stats()
    # 转换为 camelCase 键 (与前端契约对齐)
    stats = {
        "totalEvents": raw.get("total_events", 0),
        "processedCount": raw.get("processed_count", 0),
        "avgEvaluationTimeMs": raw.get("avg_evaluation_time_ms", 0.0),
        "blockCount": raw.get("block_count", 0),
        "flagCount": raw.get("flag_count", 0),
    }
    return make_ok(stats)


# === V3 风控仪表盘 (MOD-02) ===

@router.get(
    "/dashboard",
    response_model=ApiResult[dict],
    summary="实时风控仪表盘 (规则命中率/告警统计/趋势/Top 风险企业)",
)
async def risk_dashboard(_user: CurrentUser = None):
    stats = await _stream_svc().get_dashboard_stats()
    return make_ok(stats)


# === 工具函数 ===

def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def _id(prefix: str = "se") -> str:
    from uuid import uuid4
    return f"{prefix}-{uuid4().hex[:12]}"
