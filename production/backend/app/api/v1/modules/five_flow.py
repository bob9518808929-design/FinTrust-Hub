"""MOD-01 资金监管 — 五流合一校验引擎 API (R4.6).

prefix: /modules/five-flow
tags:   MOD-01 五流合一

端点:
    POST /check                 单笔交易六流一致性校验
    POST /batch-check           批量校验
    GET  /records/{eid}/{tx_id} 列出该交易的流记录
    GET  /monitor/rules         列出监控规则 (query: flow_type)
    POST /monitor/rules         新增监控规则
    GET  /monitor/alerts       列出告警 (query: enterprise_id, status)
    POST /monitor/alerts/{id}/acknowledge   确认告警
    POST /monitor/alerts/{id}/resolve       解决告警
    POST /locks                 锁定资金账户
    POST /locks/{lock_id}/release  释放锁定
    GET  /locks                 列出锁定 (query: enterprise_id, status)
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Query
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.api.deps import make_ok
from app.deps import CurrentUser
from app.schemas.common import ApiResult
from app.schemas.five_flow import (
    ConsistencyCheckResult, FlowRecord, FlowType, FundAccountLock,
    FundAccountLockCreate, MonitorAlert, MonitorRule, MonitorRuleCreate,
)
from app.services.five_flow_consistency_service import FiveFlowConsistencyService
from app.services.monitor_rules_service import MonitorRulesService


router = APIRouter(prefix="/modules/five-flow", tags=["MOD-01 五流合一"])


def _consistency_svc() -> FiveFlowConsistencyService:
    return FiveFlowConsistencyService(db=None)


def _monitor_svc() -> MonitorRulesService:
    return MonitorRulesService(db=None)


# === 请求体 ===

class _CheckReq(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True, alias_generator=to_camel, use_enum_values=True,
    )
    enterprise_id: str
    tx_id: str


class _BatchCheckReq(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True, alias_generator=to_camel, use_enum_values=True,
    )
    enterprise_id: str
    tx_ids: list[str] = Field(default_factory=list)


# === 一致性校验端点 ===

@router.post(
    "/check",
    response_model=ApiResult[ConsistencyCheckResult],
    summary="单笔交易六流一致性校验",
)
async def check_consistency(payload: _CheckReq, _user: CurrentUser = None):
    result = await _consistency_svc().check_consistency(
        payload.enterprise_id, payload.tx_id,
    )
    return make_ok(result)


@router.post(
    "/batch-check",
    response_model=ApiResult[list[ConsistencyCheckResult]],
    summary="批量校验多笔交易",
)
async def batch_check(payload: _BatchCheckReq, _user: CurrentUser = None):
    results = await _consistency_svc().batch_check(
        payload.enterprise_id, payload.tx_ids,
    )
    return make_ok(results)


@router.get(
    "/records/{enterprise_id}/{tx_id}",
    response_model=ApiResult[list[FlowRecord]],
    summary="列出该交易的所有流记录",
)
async def list_flow_records(
    enterprise_id: str, tx_id: str, _user: CurrentUser = None,
):
    records = await _consistency_svc().collect_flow_records(enterprise_id, tx_id)
    return make_ok(records)


# === V3 资金流向图谱 (MOD-01) ===

@router.get(
    "/graph",
    response_model=ApiResult[dict],
    summary="按企业/时间段生成资金流入流出图谱 (节点+边结构)",
)
async def fund_flow_graph(
    enterprise_id: str = Query(..., alias="enterpriseId"),
    start_date: Optional[str] = Query(default=None, alias="startDate"),
    end_date: Optional[str] = Query(default=None, alias="endDate"),
    _user: CurrentUser = None,
):
    graph = await _consistency_svc().generate_fund_flow_graph(
        enterprise_id=enterprise_id,
        start_date=start_date,
        end_date=end_date,
    )
    return make_ok(graph)


# === 监控规则 ===

@router.get(
    "/monitor/rules",
    response_model=ApiResult[list[MonitorRule]],
    summary="列出监控规则 (可按 flow_type 过滤)",
)
async def list_monitor_rules(
    flow_type: Optional[str] = Query(default=None, alias="flowType"),
    _user: CurrentUser = None,
):
    ft = None
    if flow_type:
        try:
            ft = FlowType(flow_type)
        except ValueError:
            ft = None
    rules = await _monitor_svc().list_rules(flow_type=ft)
    return make_ok(rules)


@router.post(
    "/monitor/rules",
    response_model=ApiResult[MonitorRule],
    summary="新增监控规则",
)
async def create_monitor_rule(
    payload: MonitorRuleCreate, _user: CurrentUser = None,
):
    rule = await _monitor_svc().add_rule(payload)
    return make_ok(rule)


# === 监控告警 ===

@router.get(
    "/monitor/alerts",
    response_model=ApiResult[list[MonitorAlert]],
    summary="列出监控告警 (可按 enterprise_id / status 过滤)",
)
async def list_monitor_alerts(
    enterprise_id: Optional[str] = Query(default=None, alias="enterpriseId"),
    status: Optional[str] = Query(default=None),
    _user: CurrentUser = None,
):
    alerts = await _monitor_svc().list_alerts(
        enterprise_id=enterprise_id, status=status,
    )
    return make_ok(alerts)


@router.post(
    "/monitor/alerts/{alert_id}/acknowledge",
    response_model=ApiResult[MonitorAlert],
    summary="确认告警",
)
async def acknowledge_alert(alert_id: str, _user: CurrentUser = None):
    alert = await _monitor_svc().acknowledge_alert(alert_id)
    return make_ok(alert)


@router.post(
    "/monitor/alerts/{alert_id}/resolve",
    response_model=ApiResult[MonitorAlert],
    summary="解决告警",
)
async def resolve_alert(alert_id: str, _user: CurrentUser = None):
    alert = await _monitor_svc().resolve_alert(alert_id)
    return make_ok(alert)


# === 账户锁定 ===

@router.post(
    "/locks",
    response_model=ApiResult[FundAccountLock],
    summary="锁定资金账户",
)
async def lock_fund_account(
    payload: FundAccountLockCreate, _user: CurrentUser = None,
):
    lock = await _monitor_svc().lock_fund_account(
        enterprise_id=payload.enterprise_id,
        account_id=payload.account_id,
        amount_cents=payload.amount_cents,
        reason=payload.reason,
        duration_hours=payload.duration_hours,
    )
    return make_ok(lock)


@router.post(
    "/locks/{lock_id}/release",
    response_model=ApiResult[FundAccountLock],
    summary="释放资金账户锁定",
)
async def release_fund_account(lock_id: str, _user: CurrentUser = None):
    lock = await _monitor_svc().release_fund_account(lock_id)
    return make_ok(lock)


@router.get(
    "/locks",
    response_model=ApiResult[list[FundAccountLock]],
    summary="列出资金账户锁定 (可按 enterprise_id / status 过滤)",
)
async def list_fund_locks(
    enterprise_id: Optional[str] = Query(default=None, alias="enterpriseId"),
    status: Optional[str] = Query(default=None),
    _user: CurrentUser = None,
):
    locks = await _monitor_svc().list_locks(
        enterprise_id=enterprise_id, status=status,
    )
    return make_ok(locks)
