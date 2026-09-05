"""改造引擎路由 (R0-R10) — 对齐前端 reform.ts API.

前端 API 调用与后端路由存在以下差异 (已通过适配层解决):
  - 前端 R0/R1 用 GET, 后端用 POST → 增加 GET 版本
  - 前端 R3 plan 需要独立端点 → 新增
  - 前端 execute-action/replan/compliance-check/store-case 路径不含 enterprise_id → 增加兼容路由
  - 前端需要 schedule/updates 轮询端点 → 新增
  - 前端需要 pause/resume/abandon/bank-match → 新增

核心路由 (RESTful):
  POST/GET /reform/{enterprise_id}/precheck           R0 接入意愿评估
  POST/GET /reform/{enterprise_id}/portrait           R1 全景画像
  POST     /reform/{enterprise_id}/gap-analysis       R2 差距诊断
  POST     /reform/{enterprise_id}/plan              R3 方案生成
  POST     /reform/{enterprise_id}/start             R4 启动改造
  POST     /reform/{enterprise_id}/actions/{aid}/execute  R5 执行动作
  POST     /reform/{enterprise_id}/actions/{aid}/compliance R6 合规检查
  POST     /reform/{enterprise_id}/replan            R7 动态重算
  GET      /reform/{enterprise_id}/monitor           R8 监控
  POST     /reform/{enterprise_id}/finalize          R9 终局
  POST     /reform/{enterprise_id}/store-case        R10 案例沉淀
  GET      /reform/{enterprise_id}/state             查状态
  GET      /reform/{enterprise_id}/schedule/updates  R4 进度轮询
  POST     /reform/{enterprise_id}/pause            暂停
  POST     /reform/{enterprise_id}/resume           恢复
  POST     /reform/{enterprise_id}/abandon          放弃
  POST     /reform/{enterprise_id}/bank-match       银行撮合
"""

from datetime import UTC

from fastapi import APIRouter, Response, status
from pydantic import BaseModel

from app.api.deps import make_ok
from app.deps import CurrentUser, DbSession
from app.schemas.common import ApiResult
from app.schemas.enterprise import ReformPrecheck
from app.schemas.reform import CaseStats
from app.schemas.scorecard import (
    ComplianceCheckResult,
    ReformActionResult,
    ReformCase,
    ReformMonitorResult,
    ReformPhase,
    ReformReplanResult,
    ReformState,
    Scorecard8D,
)
from app.services.bank_service import BankService
from app.services.reform_service import ReformService, _reform_store

router = APIRouter(prefix="/reform", tags=["改造引擎"])


def _svc(db: DbSession) -> ReformService:
    return ReformService(db=db)


class GapAnalysisReq(BaseModel):
    current: Scorecard8D
    aggression_level: str = "balanced"


class PlanReq(BaseModel):
    current: Scorecard8D
    target: Scorecard8D
    aggression_level: str = "balanced"


class StartReformReq(BaseModel):
    aggression_level: str = "balanced"


class ReplanReq(BaseModel):
    trigger_kind: str
    message: str


class ExecuteActionCompatReq(BaseModel):
    action: dict
    context: dict | None = None


class ComplianceCheckCompatReq(BaseModel):
    action: dict
    state: dict | None = None


class StoreCaseCompatReq(BaseModel):
    state: dict | None = None
    outcome: str = "success"


class AbandonReq(BaseModel):
    reason: str = ""


# ============================================================================
# R0-R10 核心路由 (RESTful, 含 enterprise_id)
# ============================================================================

# --- R0 接入意愿评估 (同时支持 GET 和 POST) ---

@router.get("/{enterprise_id}/precheck", response_model=ApiResult[ReformPrecheck], summary="R0 接入意愿评估 (GET)")
@router.post("/{enterprise_id}/precheck", response_model=ApiResult[ReformPrecheck], summary="R0 接入意愿评估 (POST)")
async def r0_precheck(enterprise_id: str, db: DbSession, _user: CurrentUser):
    result = await _svc(db).R0_precheck(enterprise_id)
    return make_ok(result)


# --- R1 全景画像 (同时支持 GET 和 POST) ---

@router.get("/{enterprise_id}/portrait", response_model=ApiResult[Scorecard8D], summary="R1 全景画像 (GET)")
@router.post("/{enterprise_id}/portrait", response_model=ApiResult[Scorecard8D], summary="R1 全景画像 (POST)")
async def r1_portrait(enterprise_id: str, db: DbSession, _user: CurrentUser):
    svc = _svc(db)
    result = await svc.R1_fullPortrait(enterprise_id)
    # 画像来源可解释性: 种子推导 + 材料已销毁 → 明确告知与上传文档无关 (禁止静默降级)
    message = "OK"
    cache = svc._portrait_cache.get(enterprise_id) or {}
    if cache.get("source") == "runtime_seed":
        try:
            from app.services.eco_service import eco_burn_service

            if await eco_burn_service.has_destroy_audit(enterprise_id):
                message = (
                    "⚠️ 原始材料已物理销毁且本次画像未消费到 ECO-01 脱敏产物, "
                    "当前画像为运行时种子推导 (与上传文档无关)。"
                    "请重新上传材料完成 ECO-01 诊断后再启动改造。"
                )
        except Exception:
            pass
    return make_ok(result, message=message)


# --- R2 差距诊断 ---

@router.post("/{enterprise_id}/gap-analysis", response_model=ApiResult[dict], summary="R2 差距诊断")
async def r2_gap_analysis(enterprise_id: str, req: GapAnalysisReq, db: DbSession, _user: CurrentUser):
    target, gaps = await _svc(db).R2_gapAnalysis(req.current, req.aggression_level)
    return make_ok({
        "target": target.model_dump(),
        "gaps": [g.model_dump(by_alias=True) for g in gaps],
    })


# --- R3 方案生成 (独立端点, 供前端 R1→R2→R3 一键调用) ---

@router.post("/{enterprise_id}/plan", response_model=ApiResult[list[ReformPhase]], summary="R3 方案生成")
async def r3_plan(enterprise_id: str, req: PlanReq, db: DbSession, _user: CurrentUser):
    svc = _svc(db)
    _, gaps = await svc.R2_gapAnalysis(req.current, req.aggression_level)
    phases = await svc.R3_generatePlan(
        enterprise_id, req.current, req.target, gaps, req.aggression_level,
    )
    return make_ok(phases)


# --- R4 启动改造 ---

@router.post("/{enterprise_id}/start", response_model=ApiResult[ReformState], status_code=status.HTTP_201_CREATED, summary="R4 启动改造")
async def r4_start(enterprise_id: str, req: StartReformReq, db: DbSession, _user: CurrentUser, response: Response):
    # 幂等防护: 改造进行中重复点击"启动改造"直接返回现有 state (200),
    # 不重置 DAG 进度 — 防止用户因看不到进度而反复点击导致进度清零的恶性循环.
    existing = await _reform_store.get_state(enterprise_id)
    if existing and existing.get("status") == "in_progress":
        # 幂等恢复: 后端重启后内存 runner 消失但 state 仍 in_progress → 重启调度,
        # 否则进度永久冻结 ("到启动改造环节又没消息了" 的真凶之一)
        _svc(db).ensure_scheduler(enterprise_id)
        response.status_code = status.HTTP_200_OK
        return make_ok(ReformState.model_validate(existing))
    try:
        state = await _svc(db).R4_startReform(enterprise_id, req.aggression_level)
        return make_ok(state)
    except ValueError as e:
        return make_ok(None, code=-1, message=str(e))


# --- R5 执行动作 ---

@router.post("/{enterprise_id}/actions/{action_id}/execute", response_model=ApiResult[ReformActionResult], summary="R5 执行动作")
async def r5_execute(enterprise_id: str, action_id: str, db: DbSession, _user: CurrentUser):
    try:
        result = await _svc(db).R5_executeAction(enterprise_id, action_id)
        return make_ok(result)
    except ValueError as e:
        return make_ok(None, code=-1, message=str(e))


# --- R6 合规检查 ---

@router.post("/{enterprise_id}/actions/{action_id}/compliance", response_model=ApiResult[ComplianceCheckResult], summary="R6 合规检查")
async def r6_compliance(enterprise_id: str, action_id: str, db: DbSession, _user: CurrentUser):
    result = await _svc(db).R6_complianceCheck(enterprise_id, action_id)
    return make_ok(result)


# --- R7 动态重算 ---

@router.post("/{enterprise_id}/replan", response_model=ApiResult[ReformReplanResult], summary="R7 动态重算")
async def r7_replan(enterprise_id: str, req: ReplanReq, db: DbSession, _user: CurrentUser):
    try:
        result = await _svc(db).R7_replan(enterprise_id, req.trigger_kind, req.message)
        return make_ok(result)
    except ValueError as e:
        return make_ok(None, code=-1, message=str(e))


# --- R8 监控 ---

@router.get("/{enterprise_id}/monitor", response_model=ApiResult[ReformMonitorResult], summary="R8 监控")
async def r8_monitor(enterprise_id: str, db: DbSession, _user: CurrentUser):
    result = await _svc(db).R8_monitor(enterprise_id)
    return make_ok(result)


# --- R9 终局 ---

@router.post("/{enterprise_id}/finalize", response_model=ApiResult[dict], summary="R9 终局解锁融资")
async def r9_finalize(enterprise_id: str, db: DbSession, _user: CurrentUser):
    try:
        result = await _svc(db).R9_finalizeAndFinance(enterprise_id)
        return make_ok(result)
    except ValueError as e:
        return make_ok(None, code=-1, message=str(e))


# --- R10 案例沉淀 ---

@router.post("/{enterprise_id}/store-case", response_model=ApiResult[ReformCase], status_code=status.HTTP_201_CREATED, summary="R10 案例沉淀")
async def r10_store_case(enterprise_id: str, db: DbSession, _user: CurrentUser):
    try:
        result = await _svc(db).R10_storeCase(enterprise_id)
        return make_ok(result)
    except ValueError as e:
        return make_ok(None, code=-1, message=str(e))


# --- 查询改造状态 ---

@router.get("/{enterprise_id}/state", response_model=ApiResult[ReformState], summary="查改造状态")
async def get_state(enterprise_id: str, db: DbSession, _user: CurrentUser):
    state = await _svc(db).get_reform_state(enterprise_id)
    if not state:
        return make_ok(None, code=404, message=f"企业 {enterprise_id} 无改造状态")
    return make_ok(state)


# ============================================================================
# R4 进度轮询端点 (替代 SSE, 前端 subscribeProgress 的 fallback)
# ============================================================================

@router.get("/{enterprise_id}/schedule/updates", response_model=ApiResult[list], summary="R4 调度进度轮询")
async def schedule_updates(enterprise_id: str, db: DbSession, _user: CurrentUser):
    """返回当前所有 phase 的进度更新 (前端 SSE fallback 轮询).

    每 phase 附 actions 执行产物详情 (result/evidence/completedAt) —
    子引擎的真实业务结果必须随轮询送达前端时间线, 不允许只给进度数字.
    """
    state = await _reform_store.get_state(enterprise_id)
    if not state:
        return make_ok([])

    updates = []
    for phase in state.get("phases", []):
        actions_out = [
            {
                "id": a.get("id"),
                "name": a.get("name", ""),
                "status": a.get("status", "pending"),
                "result": a.get("result"),
                "evidence": a.get("evidence") or [],
                "cost": a.get("cost"),
                "completedAt": a.get("completedAt"),
            }
            for a in phase.get("actions", [])
        ]
        updates.append({
            "phaseId": phase.get("id"),
            "phaseName": phase.get("name", ""),
            "phaseStatus": phase.get("status", "pending"),
            "progress": phase.get("progress", 0),
            "overallProgress": state.get("progress", 0),
            "stateStatus": state.get("status"),
            "actions": actions_out,
            "timestamp": phase.get("lastUpdatedAt"),
        })
    return make_ok(updates)


# ============================================================================
# 生命周期端点 (pause / resume / abandon)
# ============================================================================

@router.post("/{enterprise_id}/pause", response_model=ApiResult[ReformState], summary="暂停改造")
async def pause(enterprise_id: str, db: DbSession, _user: CurrentUser):
    state = await _reform_store.get_state(enterprise_id)
    if not state:
        return make_ok(None, code=404, message=f"企业 {enterprise_id} 无改造状态")
    _svc(db)._stop_scheduler(enterprise_id)  # 暂停 → 停自动调度
    state["status"] = "paused"
    state["pausedAt"] = _now_iso()
    await _reform_store.upsert_state(enterprise_id, state)
    return make_ok(ReformState.model_validate(state))


@router.post("/{enterprise_id}/resume", response_model=ApiResult[ReformState], summary="恢复改造")
async def resume(enterprise_id: str, db: DbSession, _user: CurrentUser):
    state = await _reform_store.get_state(enterprise_id)
    if not state:
        return make_ok(None, code=404, message=f"企业 {enterprise_id} 无改造状态")
    state["status"] = "in_progress"
    state["resumedAt"] = _now_iso()
    await _reform_store.upsert_state(enterprise_id, state)
    _svc(db)._start_scheduler(enterprise_id)  # 恢复 → 重启自动调度
    return make_ok(ReformState.model_validate(state))


@router.post("/{enterprise_id}/abandon", response_model=ApiResult[ReformState], summary="放弃改造")
async def abandon(enterprise_id: str, req: AbandonReq, db: DbSession, _user: CurrentUser):
    state = await _reform_store.get_state(enterprise_id)
    if not state:
        return make_ok(None, code=404, message=f"企业 {enterprise_id} 无改造状态")
    _svc(db)._stop_scheduler(enterprise_id)  # 放弃 → 停自动调度
    state["status"] = "abandoned"
    state["abandonedAt"] = _now_iso()
    state["abandonReason"] = req.reason
    await _reform_store.upsert_state(enterprise_id, state)
    return make_ok(ReformState.model_validate(state))


# ============================================================================
# 银行撮合 (R9 前置查询)
# ============================================================================

@router.post("/{enterprise_id}/bank-match", response_model=ApiResult[list], summary="银行撮合匹配")
async def bank_match(enterprise_id: str, db: DbSession, _user: CurrentUser):
    """基于企业评分卡 + 后端真实银行列表计算撮合结果."""
    state = await _reform_store.get_state(enterprise_id)
    if not state:
        return make_ok(None, code=404, message=f"企业 {enterprise_id} 无改造状态")

    scorecard = state.get("scorecard", {})
    current_sc = scorecard.get("current", {})
    target_sc = scorecard.get("target", {})
    # 用目标评分卡 (改造后) 评估融资能力
    target_total = sum(target_sc.values()) / max(len(target_sc), 1)
    current_total = sum(current_sc.values()) / max(len(current_sc), 1)
    improvement = max(0, target_total - current_total)

    # 调用 BankService 获取真实银行列表 (信任培育阶段)
    bank_svc = BankService(db=db)
    banks = await bank_svc.list_banks()

    matches = []
    for bank in banks:
        # BankListItem 是 Pydantic model (snake_case 字段)
        b = bank.model_dump(by_alias=True) if hasattr(bank, "model_dump") else bank
        bid = b.get("bankId") or b.get("bank_id", "")
        bname = b.get("bankName") or b.get("bank_name", "")
        stage = b.get("stage", "")
        # stage 可能是枚举值 "L4_READONLY" 或带前缀, 取末段
        stage_key = str(stage).split(".")[-1] if "." in str(stage) else str(stage)
        conv_rate = b.get("conversionRate") or b.get("conversion_rate") or 0.0

        # 匹配度 = 银行转化率 * 企业评分提升幅度 * 阶段系数
        stage_mult = {"L4_READONLY": 0.6, "L3_ADVISORY": 0.8, "L2_SMALL_AUTO": 1.0, "L1_FULL_AUTO": 1.2}.get(stage_key, 0.7)
        match_score = round(min(0.99, conv_rate * 0.6 + (target_total / 100) * 0.3 + stage_mult * 0.1), 2)

        # 基于评分卡维度优势推荐产品
        products = []
        if target_sc.get("credit", 0) >= 80:
            products.append("应收账款融资")
        if target_sc.get("business", 0) >= 80:
            products.append("订单融资")
        if target_sc.get("assets", 0) >= 80:
            products.append("设备抵押")
        if target_sc.get("finance", 0) >= 80:
            products.append("流贷融资")
        if not products:
            products = ["基础授信"]

        # 利率基于匹配度反算 (匹配度越高利率越低)
        est_rate = round(4.0 + (1 - match_score) * 4, 2)
        # 授信倍数基于信用维度
        credit_score = target_sc.get("credit", 65)
        max_mult = round(0.8 + (credit_score - 60) / 100, 2)

        matches.append({
            "bankId": bid,
            "bankName": bname,
            "tier": stage,
            "matchScore": match_score,
            "products": products,
            "estimatedRate": est_rate,
            "maxAmountMultiplier": max_mult,
            "enterpriseId": enterprise_id,
            "improvement": round(improvement, 1),
        })

    # 按匹配度降序
    matches.sort(key=lambda x: x["matchScore"], reverse=True)
    return make_ok(matches)


# ============================================================================
# 兼容路由 (前端 reform.ts 旧 API 签名适配, 不含 enterprise_id)
# ============================================================================

@router.post("/execute-action", response_model=ApiResult[ReformActionResult], summary="R5 执行动作 (兼容)")
async def r5_execute_compat(req: ExecuteActionCompatReq, db: DbSession, _user: CurrentUser):
    """前端旧签名: POST /reform/execute-action { action, context }.
    从 action.phaseId 反查 enterprise_id."""
    action_id = req.action.get("id", "")
    req.action.get("phaseId", "")
    if not action_id:
        return make_ok(None, code=400, message="缺少 action.id")
    result = await _svc(db).R5_executeAction("__compat__", action_id)
    return make_ok(result)


@router.post("/replan", response_model=ApiResult[ReformReplanResult], summary="R7 动态重算 (兼容)")
async def r7_replan_compat(req: dict, db: DbSession, _user: CurrentUser):
    """前端旧签名: POST /reform/replan { state, trigger }.
    从 state.enterpriseId 提取企业 ID."""
    enterprise_id = req.get("state", {}).get("enterpriseId", "")
    trigger = req.get("trigger", {})
    trigger_kind = trigger.get("kind", "")
    message = trigger.get("message", "")
    if not enterprise_id:
        return make_ok(None, code=400, message="缺少 state.enterpriseId")
    result = await _svc(db).R7_replan(enterprise_id, trigger_kind, message)
    return make_ok(result)


@router.post("/compliance-check", response_model=ApiResult[ComplianceCheckResult], summary="R6 合规检查 (兼容)")
async def r6_compliance_compat(req: ComplianceCheckCompatReq, db: DbSession, _user: CurrentUser):
    """前端旧签名: POST /reform/compliance-check { action, state }."""
    action_id = req.action.get("id", "")
    enterprise_id = req.state.get("enterpriseId", "__compat__") if req.state else "__compat__"
    if not action_id:
        return make_ok(None, code=400, message="缺少 action.id")
    result = await _svc(db).R6_complianceCheck(enterprise_id, action_id)
    return make_ok(result)


@router.post("/monitor", response_model=ApiResult[ReformMonitorResult], summary="R8 监控 (兼容)")
async def r8_monitor_compat(req: dict, db: DbSession, _user: CurrentUser):
    """前端旧签名: POST /reform/monitor { state }.
    从 state.enterpriseId 提取企业 ID."""
    enterprise_id = req.get("state", {}).get("enterpriseId", "")
    if not enterprise_id:
        return make_ok(None, code=400, message="缺少 state.enterpriseId")
    result = await _svc(db).R8_monitor(enterprise_id)
    return make_ok(result)


@router.post("/bank-match", response_model=ApiResult[list], summary="银行撮合 (兼容)")
async def bank_match_compat(req: dict, db: DbSession, _user: CurrentUser):
    """前端旧签名: POST /reform/bank-match { state }."""
    enterprise_id = req.get("state", {}).get("enterpriseId", "")
    if not enterprise_id:
        return make_ok(None, code=400, message="缺少 state.enterpriseId")
    return await bank_match(enterprise_id, db, _user)


@router.post("/store-case", response_model=ApiResult[ReformCase], summary="R10 案例沉淀 (兼容)")
async def store_case_compat(req: dict, db: DbSession, _user: CurrentUser):
    """前端旧签名: POST /reform/store-case { state, outcome }."""
    enterprise_id = req.get("state", {}).get("enterpriseId", "")
    if not enterprise_id:
        return make_ok(None, code=400, message="缺少 state.enterpriseId")
    return await r10_store_case(enterprise_id, db, _user)


# ============================================================================
# R10 案例库 (保持不变)
# ============================================================================

@router.get("/cases/similar", response_model=ApiResult[list[ReformCase]], summary="R10 相似案例检索")
async def r10_similar_cases(
    query: str = "",
    top_k: int = 5,
    db: DbSession = None,
    _user: CurrentUser = None,
):
    svc = _svc(db) if db else ReformService(db=None)
    cases = await svc.search_similar_cases(query, top_k)
    return make_ok(cases)


@router.get("/cases/stats", response_model=ApiResult[CaseStats], summary="R10 案例库统计")
async def r10_case_stats(db: DbSession = None, _user: CurrentUser = None):
    svc = _svc(db) if db else ReformService(db=None)
    stats = await svc.get_case_stats()
    return make_ok(stats)


@router.get("/cases", response_model=ApiResult[list[ReformCase]], summary="列案例库")
async def list_cases(industry: str | None = None, db: DbSession = None, _user: CurrentUser = None):
    svc = _svc(db) if db else ReformService(db=None)
    cases = await svc.list_cases(industry)
    return make_ok(cases)


def _now_iso() -> str:
    from datetime import datetime
    return datetime.now(UTC).isoformat()
