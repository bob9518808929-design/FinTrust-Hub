"""运营态 API 路由 (Tab3 审批 / Tab5 担保保险流程 / Tab7 AI驾驶舱).

职责:
    1. /approvals                 人工审批队列 + 决策 (Tab3)
    2. /institutions/guarantee/*  担保申请/保前审查/代偿 (Tab5)
    3. /institutions/insurance/*  投保/核保/理赔 (Tab5)
    4. /cockpit/operations        AI 操作日志 (Tab7)

project_memory 硬约束:
    - 审批决策(approve/reject)为不可逆, 前端阻塞模态窗二次确认; 后端仅记录决策
    - 担保/保险申请需明确反馈
    - AI 操作日志含 id/enterprise/level/confidence/action/timestamp
"""

from __future__ import annotations

from datetime import UTC

from fastapi import APIRouter

from app.api.deps import make_ok
from app.deps import CurrentUser
from app.schemas.common import ApiResult

# ============================================================================
# 内存兜底数据 (C 档独立兜底, 后端无 DB 时返回)
# ============================================================================

_APPROVAL_QUEUE: list[dict] = [
    {
        "id": "APR-2026-0001", "enterprise": "深圳科创电子", "level": "L3",
        "amount": 8000000, "confidence": 82, "suggestion": "通过",
        "suggestionReason": "8维评分卡达 B+ 级, 责任链完整度 88%, 五流验证通过",
        "reason": "金额 800万 超过 L1 阈值(100万)", "waterLevel": "65%",
        "escrowBalance": 1200000, "chainCompleteness": "88%",
        "fiveStreams": "5/5 通过", "policyMatch": "战略新兴-芯片",
        "status": "pending", "timestamp": "2026-08-19 09:30:00",
    },
    {
        "id": "APR-2026-0002", "enterprise": "杭州智造机械", "level": "L4",
        "amount": 12000000, "confidence": 58, "suggestion": "否决",
        "suggestionReason": "信用等级 C, 责任链完整度仅 42%, 资金水位偏低",
        "reason": "高风险企业强制 L4", "waterLevel": "32%",
        "escrowBalance": 380000, "chainCompleteness": "42%",
        "fiveStreams": "3/5 货流待补", "policyMatch": "传统制造-限制类",
        "status": "pending", "timestamp": "2026-08-19 10:15:00",
    },
]

_AI_OPERATIONS: list[dict] = [
    {"id": "OP-0001", "enterprise": "深圳科创电子", "level": "L1", "confidence": 95,
     "action": "小额融资自动审批 80万", "timestamp": "2026-08-19 09:12:33",
     "result": "通过", "trace": []},
    {"id": "OP-0002", "enterprise": "杭州智造机械", "level": "L3", "confidence": 72,
     "action": "融资路由推送审批台", "timestamp": "2026-08-19 10:15:00",
     "result": "待审批", "trace": []},
    {"id": "OP-0003", "enterprise": "苏州新材料", "level": "L2", "confidence": 88,
     "action": "授信额度自动调整 +15%", "timestamp": "2026-08-19 11:20:45",
     "result": "已通知企业", "trace": []},
    {"id": "OP-0004", "enterprise": "深圳科创电子", "level": "L1", "confidence": 91,
     "action": "IoT 监测货物位移正常", "timestamp": "2026-08-19 14:00:12",
     "result": "通过", "trace": []},
]


# ============================================================================
# Tab3 人工审批
# ============================================================================

approvals_router = APIRouter(prefix="/approvals", tags=["人工审批"])


@approvals_router.get("", response_model=ApiResult[list[dict]], summary="审批队列")
async def list_approvals(_user: CurrentUser):
    """L3/L4 待办 + 已处理工单 (Tab3)."""
    return make_ok(list(_APPROVAL_QUEUE))


@approvals_router.post("/{req_id}/decide", response_model=ApiResult[dict], summary="审批决策")
async def decide_approval(req_id: str, payload: dict, _user: CurrentUser):
    """审批决策: approve / reject / return (Tab3, 不可逆)."""
    decision = payload.get("decision", "return")
    for r in _APPROVAL_QUEUE:
        if r["id"] == req_id:
            r["status"] = {"approve": "approved", "reject": "rejected", "return": "returned"}.get(decision, "returned")
            r["decision"] = decision
            from datetime import datetime
            r["decidedAt"] = datetime.now(UTC).isoformat()
            return make_ok(r)
    return make_ok(None, code=404, message="工单不存在")


# ============================================================================
# Tab5 担保与保险流程
# ============================================================================

institutions_router = APIRouter(prefix="/institutions", tags=["担保保险"])


@institutions_router.post("/guarantee/{enterprise_id}/apply", response_model=ApiResult[dict], summary="担保申请")
async def apply_guarantee(enterprise_id: str, _user: CurrentUser):
    """担保申请 (Tab5)."""
    return make_ok({"enterpriseId": enterprise_id, "status": "pending", "message": "担保申请已提交, 等待保前审查"})


@institutions_router.post("/guarantee/{enterprise_id}/pre-trial", response_model=ApiResult[dict], summary="保前审查")
async def pre_trial_guarantee(enterprise_id: str, _user: CurrentUser):
    """保前审查通过后担保生效 (Tab5)."""
    return make_ok({"enterpriseId": enterprise_id, "status": "active", "rateDiscount": 0.5, "amountBoost": 0.1, "creditDelta": 15})


@institutions_router.post("/guarantee/{enterprise_id}/compensate", response_model=ApiResult[dict], summary="触发代偿")
async def trigger_compensation(enterprise_id: str, _user: CurrentUser):
    """触发代偿进入追偿 (Tab5)."""
    return make_ok({"enterpriseId": enterprise_id, "status": "claimed", "message": "代偿已触发, 进入追偿流程"})


@institutions_router.post("/insurance/{enterprise_id}/apply", response_model=ApiResult[dict], summary="投保")
async def apply_insurance(enterprise_id: str, _user: CurrentUser):
    """投保受理 (Tab5)."""
    return make_ok({"enterpriseId": enterprise_id, "status": "pending", "message": "投保已受理, 等待核保"})


@institutions_router.post("/insurance/{enterprise_id}/underwrite", response_model=ApiResult[dict], summary="核保")
async def underwrite(enterprise_id: str, _user: CurrentUser):
    """核保通过保单生效 (Tab5)."""
    return make_ok({"enterpriseId": enterprise_id, "status": "active", "rateDiscount": 0.3, "creditDelta": 10})


@institutions_router.post("/insurance/{enterprise_id}/claim", response_model=ApiResult[dict], summary="理赔")
async def trigger_claim(enterprise_id: str, _user: CurrentUser):
    """触发理赔 (Tab5)."""
    return make_ok({"enterpriseId": enterprise_id, "status": "claimed", "message": "理赔已启动, 勘察定损中"})


# ============================================================================
# Tab7 AI 驾驶舱
# ============================================================================

cockpit_router = APIRouter(prefix="/cockpit", tags=["AI驾驶舱"])


@cockpit_router.get("/operations", response_model=ApiResult[list[dict]], summary="AI操作日志")
async def list_ai_operations(_user: CurrentUser):
    """AI 操作实时流 (Tab7)."""
    return make_ok(list(_AI_OPERATIONS))


@cockpit_router.get("/stats", response_model=ApiResult[dict], summary="L1-L4 分布统计")
async def cockpit_stats(_user: CurrentUser):
    """L1-L4 自主度分布 (Tab7)."""
    counts = {"L1": 0, "L2": 0, "L3": 0, "L4": 0}
    for op in _AI_OPERATIONS:
        if op["level"] in counts:
            counts[op["level"]] += 1
    return make_ok({"total": len(_AI_OPERATIONS), "distribution": counts})
