"""CORE-01 AI 自主操作编排引擎 API 路由.

端点 (prefix="/core/ai-orchestrator"):
    POST  /dags                                           注册 DAG
    GET   /dags                                           列出 DAG
    GET   /dags/{dag_id}                                  获取单个 DAG
    POST  /executions                                     执行 DAG
    GET   /executions/{execution_id}                      获取执行详情
    GET   /executions                                     执行列表 (dagId, status, enterpriseId)
    POST  /executions/{execution_id}/nodes/{node_id}/approve  推进人工确认节点
    GET   /decision-logs                                  决策日志 (executionId, enterpriseId, limit)
"""

from __future__ import annotations

from fastapi import APIRouter, Query, status

from app.api.deps import make_ok
from app.deps import CurrentUser
from app.schemas.ai_orchestrator import (
    AIDAG,
    ApproveNodeRequest,
    DAGExecution,
    DAGStatus,
    DecisionLogEntry,
    ExecuteDAGRequest,
    TaskResult,
)
from app.schemas.common import ApiResult
from app.services.ai_orchestrator_service import AIOrchestratorService

ai_orch_router = APIRouter(prefix="/core/ai-orchestrator", tags=["CORE-01 AI 编排"])


def _svc() -> AIOrchestratorService:
    return AIOrchestratorService(db=None, redis_client=None)


# ============================================================================
# 1. 注册 DAG
# ============================================================================

@ai_orch_router.post(
    "/dags",
    response_model=ApiResult[AIDAG],
    status_code=status.HTTP_201_CREATED,
    summary="注册 DAG",
)
async def register_dag(payload: AIDAG, _user: CurrentUser):
    """注册新的 AI 编排 DAG."""
    dag = await _svc().register_dag(payload)
    return make_ok(dag)


# ============================================================================
# 2. 列出 DAG
# ============================================================================

@ai_orch_router.get(
    "/dags",
    response_model=ApiResult[list[AIDAG]],
    summary="列出 DAG",
)
async def list_dags(_user: CurrentUser):
    """列出所有已注册的 DAG."""
    items = await _svc().list_dags()
    return make_ok(items)


# ============================================================================
# 3. 获取单个 DAG
# ============================================================================

@ai_orch_router.get(
    "/dags/{dag_id}",
    response_model=ApiResult[AIDAG | None],
    summary="获取 DAG",
)
async def get_dag(dag_id: str, _user: CurrentUser):
    """根据 dag_id 获取 DAG 定义."""
    dag = await _svc().get_dag(dag_id)
    if not dag:
        return make_ok(None, code=404, message=f"DAG {dag_id} 不存在")
    return make_ok(dag)


# ============================================================================
# 4. 执行 DAG
# ============================================================================

@ai_orch_router.post(
    "/executions",
    response_model=ApiResult[DAGExecution],
    status_code=status.HTTP_201_CREATED,
    summary="执行 DAG",
)
async def execute_dag(payload: ExecuteDAGRequest, _user: CurrentUser):
    """按自主性等级执行 DAG (L1/L2/L3/L4)."""
    try:
        execution = await _svc().execute_dag(payload)
        return make_ok(execution)
    except ValueError as exc:
        return make_ok(None, code=400, message=str(exc))


# ============================================================================
# 5. 获取执行详情
# ============================================================================

@ai_orch_router.get(
    "/executions/{execution_id}",
    response_model=ApiResult[DAGExecution | None],
    summary="获取执行详情",
)
async def get_execution(execution_id: str, _user: CurrentUser):
    """根据 execution_id 获取执行实例详情."""
    exec_instance = await _svc().get_execution(execution_id)
    if not exec_instance:
        return make_ok(None, code=404, message=f"执行 {execution_id} 不存在")
    return make_ok(exec_instance)


# ============================================================================
# 6. 执行列表
# ============================================================================

@ai_orch_router.get(
    "/executions",
    response_model=ApiResult[list[DAGExecution]],
    summary="执行列表",
)
async def list_executions(
    dag_id: str | None = Query(default=None, alias="dagId", description="按 DAG 筛选"),
    status: DAGStatus | None = Query(default=None, description="按状态筛选"),
    enterprise_id: str | None = Query(default=None, alias="enterpriseId", description="按企业筛选"),
    _user: CurrentUser = None,
):
    """列出 DAG 执行实例, 支持多维度筛选."""
    items = await _svc().list_executions(dag_id, status, enterprise_id)
    return make_ok(items)


# ============================================================================
# 7. 推进人工确认节点
# ============================================================================

@ai_orch_router.post(
    "/executions/{execution_id}/nodes/{node_id}/approve",
    response_model=ApiResult[TaskResult],
    summary="推进人工确认节点",
)
async def approve_node(
    execution_id: str,
    node_id: str,
    payload: ApproveNodeRequest,
    _user: CurrentUser,
):
    """人工审批通过 WAITING_HUMAN 节点, 推进 DAG 执行."""
    try:
        result = await _svc().approve_node(
            execution_id=execution_id,
            node_id=node_id,
            human_decision_override_dict=payload.human_decision_override,
            operator=payload.operator,
        )
        return make_ok(result)
    except ValueError as exc:
        return make_ok(None, code=400, message=str(exc))


# ============================================================================
# 8. 决策日志
# ============================================================================

@ai_orch_router.get(
    "/decision-logs",
    response_model=ApiResult[list[DecisionLogEntry]],
    summary="决策日志",
)
async def get_decision_logs(
    execution_id: str | None = Query(default=None, alias="executionId", description="按执行筛选"),
    enterprise_id: str | None = Query(default=None, alias="enterpriseId", description="按企业筛选"),
    limit: int = Query(default=200, ge=1, le=1000, description="返回条数上限"),
    _user: CurrentUser = None,
):
    """列出决策日志 (含证据链 ID, 用于五流合一验证)."""
    items = await _svc().get_decision_logs(execution_id, enterprise_id, limit)
    return make_ok(items)
