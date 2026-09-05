"""人机协同网关 API 路由 (CORE-02 R1.5).

端点 (prefix=/core/human-ai):
    GET    /workflows                       列出工作流规则
    POST   /tasks                           创建审批任务
    GET    /tasks                           列表 (query: status, approverRole, enterpriseId)
    GET    /tasks/{task_id}                 任务详情
    POST   /tasks/{task_id}/approve         审批
    POST   /tasks/{task_id}/escalate        升级
    POST   /tasks/{task_id}/delegate        代理
    POST   /timeout-override                扫超期执行越权覆盖
    POST   /route-from-ai                   路由决策 (AI 网关专用)
    GET    /tasks/{task_id}/chain           决策回溯链
"""

from __future__ import annotations

from fastapi import APIRouter, Query, status

from app.api.deps import make_ok
from app.deps import CurrentUser
from app.schemas.common import ApiResult
from app.schemas.human_ai_gateway import (
    ApprovalPriority, ApprovalRecord, ApprovalStatus, ApprovalTask,
    ApproverRole, ApproveRequest, CreateApprovalRequest, DelegateRequest,
    EscalateRequest, HumanRoutingDecision, RouteFromAIRequest, WorkflowRule,
)
from app.services.human_ai_gateway import HumanAIGatewayService


router = APIRouter(prefix="/core/human-ai", tags=["CORE-02 人机协同"])


def _svc() -> HumanAIGatewayService:
    return HumanAIGatewayService(db=None)


@router.get("/workflows", response_model=ApiResult[list[WorkflowRule]], summary="列出工作流规则")
async def list_workflows(_user: CurrentUser):
    items = await _svc().list_workflows()
    return make_ok(items)


@router.post(
    "/tasks",
    response_model=ApiResult[ApprovalTask],
    status_code=status.HTTP_201_CREATED,
    summary="创建审批任务",
)
async def create_task(payload: CreateApprovalRequest, _user: CurrentUser):
    task = await _svc().create_task(payload)
    return make_ok(task)


@router.get("/tasks", response_model=ApiResult[list[ApprovalTask]], summary="审批任务列表")
async def list_tasks(
    status: ApprovalStatus | None = Query(default=None, description="按状态筛选"),
    approver_role: ApproverRole | None = Query(default=None, alias="approverRole", description="按审批角色筛选"),
    enterprise_id: str | None = Query(default=None, alias="enterpriseId", description="按企业筛选"),
    _user: CurrentUser = None,
):
    items = await _svc().list_tasks(
        status=status,
        approver_role=approver_role,
        enterprise_id=enterprise_id,
    )
    return make_ok(items)


@router.get("/tasks/{task_id}", response_model=ApiResult[ApprovalTask], summary="审批任务详情")
async def get_task(task_id: str, _user: CurrentUser):
    task = await _svc().get_task(task_id)
    if not task:
        return make_ok(None, code=404, message=f"任务 {task_id} 不存在")
    return make_ok(task)


@router.post(
    "/tasks/{task_id}/approve",
    response_model=ApiResult[ApprovalTask],
    summary="审批决策",
)
async def approve_task(task_id: str, payload: ApproveRequest, _user: CurrentUser):
    try:
        task = await _svc().approve(
            task_id=task_id,
            approver_id=payload.approver_id,
            approver_role=payload.approver_role,
            decision=payload.decision,
            comment=payload.comment,
            delegated_from_role=payload.delegated_from_role,
            proxy=payload.proxy,
        )
        return make_ok(task)
    except ValueError as e:
        return make_ok(None, code=400, message=str(e))


@router.post(
    "/tasks/{task_id}/escalate",
    response_model=ApiResult[ApprovalTask],
    summary="立即升级",
)
async def escalate_task(task_id: str, payload: EscalateRequest, _user: CurrentUser):
    try:
        task = await _svc().escalate(task_id, payload.reason)
        return make_ok(task)
    except ValueError as e:
        return make_ok(None, code=400, message=str(e))


@router.post(
    "/tasks/{task_id}/delegate",
    response_model=ApiResult[ApprovalTask],
    summary="代理审批",
)
async def delegate_task(task_id: str, payload: DelegateRequest, _user: CurrentUser):
    try:
        task = await _svc().delegate(
            task_id=task_id,
            from_role=payload.from_role,
            to_role=payload.to_role,
            approver_id=payload.approver_id,
        )
        return make_ok(task)
    except ValueError as e:
        return make_ok(None, code=400, message=str(e))


@router.post(
    "/timeout-override",
    response_model=ApiResult[list[ApprovalTask]],
    summary="扫超期执行越权覆盖",
)
async def timeout_override(
    now_iso: str | None = Query(default=None, alias="nowIso", description="指定当前时间 ISO (测试用)"),
    _user: CurrentUser = None,
):
    items = await _svc().check_timeout_and_override(now_iso=now_iso)
    return make_ok(items)


@router.post(
    "/route-from-ai",
    response_model=ApiResult[HumanRoutingDecision],
    summary="AI 路由决策",
)
async def route_from_ai(payload: RouteFromAIRequest, _user: CurrentUser):
    decision = await _svc().route_from_ai(
        autonomy_level=payload.autonomy_level,
        execution_ref_id=payload.execution_ref_id,
        amount_cents=payload.amount_cents,
        title=payload.title,
        summary=payload.summary,
        enterprise_id=payload.enterprise_id,
    )
    return make_ok(decision)


@router.get(
    "/tasks/{task_id}/chain",
    response_model=ApiResult[list[ApprovalRecord]],
    summary="决策回溯链",
)
async def get_approval_chain(task_id: str, _user: CurrentUser):
    chain = await _svc().get_approval_chain(task_id)
    return make_ok(chain)
