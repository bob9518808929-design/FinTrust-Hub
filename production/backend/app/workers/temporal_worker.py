"""Temporal Worker 注册 + DAG 工作流定义 (CORE-01, R4.8).

设计依据: ROADMAP_REMAINING_V2.md R4.8 + backend/app/services/ai_orchestrator_service.py

降级策略:
    - temporalio 包未安装 / Server 不可达时, 自动降级为 asyncio DAG 执行器
      (复用 ai_orchestrator_service.AIOrchestratorService.execute_dag)
    - try/except ImportError 包裹所有 Temporal SDK 导入, 业务侧无需感知 SDK 缺失
    - 降级模式下, DAG 状态仍走 _OrchStore 内存单例 (生产部署 Temporal 后切换 PG)

测试覆盖: backend/tests/test_infra_config.py::test_temporal_worker_can_init

用法:
    from app.workers.temporal_worker import (
        get_temporal_worker,
        DAG_WORKFLOWS,
        TEMPORAL_AVAILABLE,
    )
    worker = get_temporal_worker()         # 单例
    await worker.start()                  # 启动 (降级模式下为 no-op)
    exec_result = await worker.run_dag(
        request=ExecuteDAGRequest(dag_id="SCF-QUICK-APPROVAL", enterprise_id="E001", context={})
    )
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

from app.schemas.ai_orchestrator import (
    DAGExecution,
    DAGStatus,
    ExecuteDAGRequest,
    TaskResult,
    TaskResultStatus,
)
from app.services.ai_orchestrator_service import (
    AIOrchestratorService,
    ai_orchestrator_service,
)

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    """返回 UTC ISO8601 时间戳 (用于 Activity 侧; Workflow 侧应使用 workflow.now())."""
    return datetime.now(UTC).isoformat()


# ============================================================================
# Temporal SDK 可选导入 (失败时降级 asyncio)
# ============================================================================

try:
    # temporalio 是可选依赖, 生产部署 Temporal 时安装
    # pyproject.toml 已声明 temporalio>=1.4.0, 但开发环境可能未安装
    # try/except ImportError 兜底: SDK 缺失时所有 Temporal 引用替换为占位对象
    from temporalio import activity, workflow
    from temporalio.client import Client
    from temporalio.common import RetryPolicy
    from temporalio.worker import Worker

    _TEMPORAL_AVAILABLE = True
    _TEMPORAL_IMPORT_ERROR: Exception | None = None
except ImportError as exc:
    # 降级模式: 不可用时所有 Temporal SDK 引用替换为占位对象, 业务侧不感知
    activity = None  # type: ignore[assignment]
    workflow = None  # type: ignore[assignment]
    Client = None  # type: ignore[assignment,misc]
    Worker = None  # type: ignore[assignment,misc]
    RetryPolicy = None  # type: ignore[assignment,misc]
    _TEMPORAL_AVAILABLE = False
    _TEMPORAL_IMPORT_ERROR = exc
    logger.warning(
        f"temporalio SDK 不可用, temporal_worker 降级为 asyncio DAG 执行器: {exc}"
    )


# 公开标志 (业务侧 / 测试用)
TEMPORAL_AVAILABLE: bool = _TEMPORAL_AVAILABLE


# ============================================================================
# 环境变量配置 (生产部署通过 systemd/k8s env 注入 Temporal Server 地址)
# ============================================================================

def _env_or(default: str, *names: str) -> str:
    """从环境变量读取, 多个候选名按顺序匹配, 全部未设置则返回 default."""
    for name in names:
        v = os.environ.get(name)
        if v:
            return v
    return default


# 模块加载时读取一次 (生产环境 env 通常进程级稳定)
TEMPORAL_HOST_ENV: str = _env_or("localhost", "TEMPORAL_HOST")
TEMPORAL_PORT_ENV: str = _env_or("7233", "TEMPORAL_PORT")
TEMPORAL_NAMESPACE_ENV: str = _env_or("fintrust", "TEMPORAL_NAMESPACE")
TEMPORAL_TASK_QUEUE_ENV: str = _env_or("fintrust-dag-queue", "TEMPORAL_TASK_QUEUE")


def _has_temporal_config() -> bool:
    """检查环境变量是否显式配置了 Temporal Server.

    Returns:
        True  - TEMPORAL_HOST / TEMPORAL_PORT 都显式设置, 视为真实部署
        False - 任一未设置, 走 asyncio 兜底 (即使 temporalio SDK 已安装)
    """
    return bool(os.environ.get("TEMPORAL_HOST")) and bool(
        os.environ.get("TEMPORAL_PORT")
    )


def _temporal_address_from_env() -> str:
    """组装 host:port 形式的 Temporal gRPC 地址."""
    return f"{TEMPORAL_HOST_ENV}:{TEMPORAL_PORT_ENV}"


# ============================================================================
# 真实 Temporal 工作流定义 (生产模式, SDK 可用时定义; 不可用时跳过)
# ============================================================================

# FinancingWorkflow 对应的 DAG ID (与 DAG_WORKFLOWS 条目对齐, run_dag 据此路由)
FINANCING_WORKFLOW_DAG_ID: str = "FINANCING-APPROVAL"

# 四步节点 ID (写入 DAGExecution.results_by_node, 与 _seed() 风格对齐)
_FINANCING_NODE_IDS: dict[str, str] = {
    "credit": "fa1_credit_check",
    "assessment": "fa2_credit_assessment",
    "contract": "fa3_contract_signing",
    "disbursement": "fa4_loan_disbursement",
}


def _build_financing_execution(
    request: ExecuteDAGRequest,
    workflow_result: dict,
) -> DAGExecution:
    """把 FinancingWorkflow 输出转回 DAGExecution.

    与 _AsyncioFallbackRunner.run_dag 返回结构对齐, 调用方无需感知是真实
    Temporal 还是 asyncio 兜底, 拿到的都是 DAGExecution.
    """
    now_iso = _now_iso()
    started_at = workflow_result.get("started_at") or now_iso
    results_by_node: dict[str, TaskResult] = {}
    for key, node_id in _FINANCING_NODE_IDS.items():
        payload = workflow_result.get(key, {})
        if not isinstance(payload, dict):
            payload = {"raw": payload}
        # Activity 标记 status=FAILED/SKIPPED 时映射到 TaskResultStatus.FAILED
        act_status = str(payload.get("status", "SUCCESS")).upper()
        task_status = (
            TaskResultStatus.SUCCESS
            if act_status == "SUCCESS"
            else (
                TaskResultStatus.SKIPPED
                if act_status == "SKIPPED"
                else TaskResultStatus.FAILED
            )
        )
        results_by_node[node_id] = TaskResult(
            node_id=node_id,
            status=task_status,
            started_at=started_at,
            ended_at=now_iso,
            output=payload,
            error=payload.get("error") if task_status == TaskResultStatus.FAILED else None,
        )

    wf_status = str(workflow_result.get("status", "COMPLETED")).upper()
    final_status = (
        DAGStatus.COMPLETED
        if wf_status == "COMPLETED"
        else DAGStatus.FAILED
    )
    return DAGExecution(
        id=workflow_result.get("execution_id") or f"EXEC-{uuid4().hex[:12]}",
        dag_id=request.dag_id,
        enterprise_id=request.enterprise_id,
        status=final_status,
        start_at=started_at,
        end_at=now_iso,
        results_by_node=results_by_node,
        context=dict(request.context),
        recommendation_summary={
            "workflow": "FinancingWorkflow",
            "final_decision": workflow_result.get("disbursement", {}),
            "evidence_ids": workflow_result.get("evidence_ids", []),
        },
        waiting_node_id=None,
    )


if _TEMPORAL_AVAILABLE:
    # ------------------------------------------------------------------
    # Activity 定义: 4 个 (征信查询 / 授信评估 / 合同签署 / 放款)
    # Activity 是 Temporal Worker 侧执行的最小单元, 必须可序列化 (无闭包)
    # ------------------------------------------------------------------

    @activity.defn
    async def financing_credit_check_activity(params: dict) -> dict:
        """Activity 1: 征信查询.

        复用 ai_orchestrator_service._NodeHandlers.handle_fetch_data 拉取
        征信 / 银行流水 / 工商数据. 生产环境可替换为真实征信中心 API 调用.
        """
        enterprise_id = params.get("enterprise_id", "default")
        context = params.get("context", {})
        try:
            # 延迟 import 避免模块循环依赖, 复用编排服务现有处理器
            from app.services.ai_orchestrator_service import _node_handlers

            output, evidence = await _node_handlers.handle_fetch_data(
                {"sources": ["credit", "bank", "gsxt"]},
                {"enterprise_id": enterprise_id, **context},
            )
            return {
                "enterprise_id": enterprise_id,
                "step": "credit_check",
                "credit_data": output,
                "evidence_ids": list(evidence),
                "status": "SUCCESS",
            }
        except Exception as exc:
            # 兜底: 不抛异常打断 workflow, 返回 FAILED 标记由 workflow 决定是否继续
            return {
                "enterprise_id": enterprise_id,
                "step": "credit_check",
                "credit_data": {},
                "evidence_ids": [],
                "status": "FAILED",
                "error": f"{type(exc).__name__}: {exc}",
            }

    @activity.defn
    async def financing_credit_assessment_activity(params: dict) -> dict:
        """Activity 2: 授信评估.

        基于 Activity 1 输出的征信数据, 复用 _NodeHandlers.handle_score
        计算评分 (repayment_capacity / credit_history / policy_alignment 等).
        """
        enterprise_id = params.get("enterprise_id", "default")
        context = params.get("context", {})
        credit_result = params.get("credit_result", {})
        try:
            from app.services.ai_orchestrator_service import _node_handlers

            output, evidence = await _node_handlers.handle_score(
                {"scorecard": "financing_v1"},
                {"enterprise_id": enterprise_id, **context},
            )
            return {
                "enterprise_id": enterprise_id,
                "step": "credit_assessment",
                "assessment": output,
                "based_on": credit_result.get("credit_data", {}),
                "evidence_ids": list(evidence),
                "status": "SUCCESS",
            }
        except Exception as exc:
            return {
                "enterprise_id": enterprise_id,
                "step": "credit_assessment",
                "assessment": {},
                "based_on": credit_result.get("credit_data", {}),
                "evidence_ids": [],
                "status": "FAILED",
                "error": f"{type(exc).__name__}: {exc}",
            }

    @activity.defn
    async def financing_contract_signing_activity(params: dict) -> dict:
        """Activity 3: 合同签署.

        基于授信结果生成合同号并标记签署状态 (mock, 生产环境对接电子合同平台).
        评分 >= 60 视为可签合同, 否则拒绝签署.
        """
        enterprise_id = params.get("enterprise_id", "default")
        assessment_result = params.get("assessment_result", {})
        assessment = assessment_result.get("assessment", {})
        score = int(assessment.get("score", 60) or 60)
        approved = score >= 60
        contract_no = (
            f"CT-{enterprise_id}-FIN-{uuid4().hex[:8].upper()}" if approved else ""
        )
        return {
            "enterprise_id": enterprise_id,
            "step": "contract_signing",
            "contract_no": contract_no,
            "signed": approved,
            "signed_at": _now_iso() if approved else None,
            "based_on_score": score,
            "evidence_ids": [contract_no] if approved else [],
            "status": "SUCCESS" if approved else "REJECTED",
        }

    @activity.defn
    async def financing_loan_disbursement_activity(params: dict) -> dict:
        """Activity 4: 放款.

        基于合同签署结果执行放款 (mock, 生产环境对接核心系统放款接口).
        合同未签署则跳过放款 (SKIPPED).
        """
        enterprise_id = params.get("enterprise_id", "default")
        context = params.get("context", {})
        contract_result = params.get("contract_result", {})
        if not contract_result.get("signed", False):
            return {
                "enterprise_id": enterprise_id,
                "step": "loan_disbursement",
                "disbursed": False,
                "reason": "合同未签署, 取消放款",
                "evidence_ids": [],
                "status": "SKIPPED",
            }
        # 默认 30 万元 (分), 可被 context.amount_cents 覆盖
        amount_cents = int(context.get("amount_cents", 0)) or 30_000_000
        disbursement_id = f"DISB-{enterprise_id}-{uuid4().hex[:10].upper()}"
        return {
            "enterprise_id": enterprise_id,
            "step": "loan_disbursement",
            "disbursement_id": disbursement_id,
            "disbursed": True,
            "amount_cents": amount_cents,
            "contract_no": contract_result.get("contract_no", ""),
            "evidence_ids": [disbursement_id],
            "status": "SUCCESS",
        }

    # ------------------------------------------------------------------
    # Workflow 定义: FinancingWorkflow
    # ------------------------------------------------------------------

    @workflow.defn
    class FinancingWorkflow:
        """融资审批工作流: 征信查询 → 授信评估 → 合同签署 → 放款.

        输入 (dict, JSON 可序列化):
            - dag_id: 关联 DAG ID (默认 FINANCING-APPROVAL)
            - enterprise_id: 企业 ID
            - context: 执行上下文 (含 amount_cents 等)
            - execution_id: 调用方生成的执行实例 ID (写入返回结果)
            - started_at: ISO 时间戳 (调用方传入, 回填到 DAGExecution.start_at)

        输出 (dict):
            - execution_id / dag_id / enterprise_id / started_at 透传
            - credit / assessment / contract / disbursement: 四步结果
            - status: COMPLETED (全 SUCCESS) / FAILED (任一步 FAILED)
            - evidence_ids: 累计证据 ID
        """

        @workflow.run
        async def run(self, request_input: dict) -> dict:
            enterprise_id = request_input.get("enterprise_id", "default")
            context = dict(request_input.get("context", {}))
            dag_id = request_input.get("dag_id", FINANCING_WORKFLOW_DAG_ID)
            execution_id = request_input.get(
                "execution_id", f"EXEC-{uuid4().hex[:12]}"
            )
            started_at = request_input.get("started_at") or _now_iso()
            common = {"enterprise_id": enterprise_id, "context": context}

            # 统一重试策略: 3 次, 1s 起步, 上限 10s, 2.0 退避
            retry_policy = RetryPolicy(
                maximum_attempts=3,
                initial_interval=timedelta(seconds=1),
                maximum_interval=timedelta(seconds=10),
                backoff_coefficient=2.0,
            )

            # 1. 征信查询
            credit_result = await workflow.execute_activity(
                financing_credit_check_activity,
                common,
                start_to_close_timeout=timedelta(seconds=120),
                retry_policy=retry_policy,
            )

            # 2. 授信评估
            assessment_result = await workflow.execute_activity(
                financing_credit_assessment_activity,
                {**common, "credit_result": credit_result},
                start_to_close_timeout=timedelta(seconds=120),
                retry_policy=retry_policy,
            )

            # 3. 合同签署 (基于授信结果)
            contract_result = await workflow.execute_activity(
                financing_contract_signing_activity,
                {**common, "assessment_result": assessment_result},
                start_to_close_timeout=timedelta(seconds=60),
                retry_policy=retry_policy,
            )

            # 4. 放款
            disbursement_result = await workflow.execute_activity(
                financing_loan_disbursement_activity,
                {**common, "contract_result": contract_result},
                start_to_close_timeout=timedelta(seconds=60),
                retry_policy=retry_policy,
            )

            evidence_ids: list[str] = []
            for r in (
                credit_result,
                assessment_result,
                contract_result,
                disbursement_result,
            ):
                ev = r.get("evidence_ids") if isinstance(r, dict) else None
                if ev:
                    evidence_ids.extend(ev)

            statuses = [
                credit_result.get("status"),
                assessment_result.get("status"),
                # 合同未签返回 REJECTED 也视为整体 FAILED
                "SUCCESS" if contract_result.get("status") == "SUCCESS"
                else contract_result.get("status"),
                disbursement_result.get("status"),
            ]
            final_status = (
                "COMPLETED"
                if all(s == "SUCCESS" for s in statuses)
                else "FAILED"
            )

            return {
                "execution_id": execution_id,
                "dag_id": dag_id,
                "enterprise_id": enterprise_id,
                "started_at": started_at,
                "status": final_status,
                "credit": credit_result,
                "assessment": assessment_result,
                "contract": contract_result,
                "disbursement": disbursement_result,
                "evidence_ids": evidence_ids,
            }

else:
    # temporalio SDK 不可用: 占位 None, _TemporalWorkerRunner 不会被实例化
    financing_credit_check_activity = None  # type: ignore[assignment]
    financing_credit_assessment_activity = None  # type: ignore[assignment]
    financing_contract_signing_activity = None  # type: ignore[assignment]
    financing_loan_disbursement_activity = None  # type: ignore[assignment]
    FinancingWorkflow = None  # type: ignore[assignment,misc]


# ============================================================================
# DAG 工作流定义 (与 worker_config.yaml workflows 字段对齐)
# ============================================================================

DAG_WORKFLOWS: list[dict[str, Any]] = [
    {
        "dag_id": "SCF-QUICK-APPROVAL",
        "name": "供应链融资快速审批",
        "task_queue": "fintrust-dag-queue",
        "timeout_seconds": 3600,
        "retry": {"max_attempts": 3, "initial_interval_seconds": 1,
                  "max_interval_seconds": 10, "backoff_coefficient": 2.0},
    },
    {
        "dag_id": "CREDIT-REPORT-L4",
        "name": "征信报告仅建议",
        "task_queue": "fintrust-dag-queue",
        "timeout_seconds": 1800,
        "retry": {"max_attempts": 1, "initial_interval_seconds": 1,
                  "max_interval_seconds": 5, "backoff_coefficient": 1.5},
    },
    {
        "dag_id": "RIGOROUS-APPROVAL-L3",
        "name": "严格审批流程",
        "task_queue": "fintrust-dag-queue",
        "timeout_seconds": 86400,
        "retry": {"max_attempts": 2, "initial_interval_seconds": 5,
                  "max_interval_seconds": 60, "backoff_coefficient": 2.0},
    },
    {
        # 融资审批 (征信查询 → 授信评估 → 合同签署 → 放款)
        # 真实模式: 走 FinancingWorkflow; 兜底模式: run_dag 转入 asyncio 编排
        "dag_id": "FINANCING-APPROVAL",
        "name": "融资审批流程",
        "task_queue": "fintrust-dag-queue",
        "timeout_seconds": 3600,
        "retry": {"max_attempts": 3, "initial_interval_seconds": 1,
                  "max_interval_seconds": 10, "backoff_coefficient": 2.0},
        "workflow": "FinancingWorkflow",
    },
]


# ============================================================================
# Temporal Worker 包装器 (含 asyncio 兜底)
# ============================================================================

class _AsyncioFallbackRunner:
    """asyncio 降级模式: 复用 AIOrchestratorService.execute_dag.

    Temporal SDK 不可用时启用, 调用方 API 与真实 Worker 一致,
    内部直接走内存 _OrchStore 执行.
    """

    def __init__(self, service: AIOrchestratorService) -> None:
        self._service = service
        logger.info(
            "temporal_worker 降级为 asyncio DAG 执行器 "
            f"(service={type(service).__name__})"
        )

    async def run_dag(self, request: ExecuteDAGRequest) -> DAGExecution:
        """运行 DAG (asyncio 降级模式, 直接调编排服务)."""
        return await self._service.execute_dag(request)

    async def start(self) -> None:
        """启动 Worker (asyncio 模式下为 no-op, 不需要后台 worker 进程)."""
        logger.info("temporal_worker (asyncio 兜底) start: no-op")
        return None

    async def stop(self) -> None:
        """停止 Worker (asyncio 模式下为 no-op)."""
        logger.info("temporal_worker (asyncio 兜底) stop: no-op")
        return None


class _TemporalWorkerRunner:
    """真实 Temporal Worker (生产部署 Temporal Server 后启用).

    真实模式:
        - start()     通过 temporalio Worker 注册 FinancingWorkflow + 4 个 activity
                      并后台启动拉取任务 (asyncio.create_task, 不阻塞调用方)
        - run_dag()   通过 client.start_workflow 启动 FinancingWorkflow,
                      等待 handle.result() 返回, 用 _build_financing_execution
                      转回 DAGExecution (与 asyncio 兜底返回结构一致)

    降级: Temporal Server 不可达 / Workflow 执行异常 / dag_id 不在
    FINANCING_WORKFLOW_DAG_ID 时, 自动走 service.execute_dag (asyncio 内存编排),
    业务侧无需感知.
    """

    def __init__(
        self,
        service: AIOrchestratorService,
        temporal_address: str = "localhost:7233",
        namespace: str = "fintrust",
        task_queue: str = "fintrust-dag-queue",
    ) -> None:
        if not _TEMPORAL_AVAILABLE:
            raise RuntimeError("temporalio SDK 不可用, 请安装 temporalio>=1.4.0")
        self._service = service
        self._address = temporal_address
        self._namespace = namespace
        self._task_queue = task_queue
        self._client: Any | None = None     # temporalio.client.Client
        self._worker: Any | None = None     # temporalio.worker.Worker
        self._started = False

    async def _connect(self) -> Any:
        """建立 Temporal Client 连接 (失败抛异常, 由 start/run_dag 捕获后降级)."""
        if self._client is None:
            assert Client is not None
            self._client = await Client.connect(
                self._address, namespace=self._namespace,
            )
        return self._client

    def _workflow_and_activities(self) -> tuple[list[Any], list[Any]]:
        """返回注册到 Worker 的 workflow 类 + activity 函数列表.

        生产环境可在此处扩展更多工作流 (如 InvoiceDiscountWorkflow 等).
        """
        if not _TEMPORAL_AVAILABLE:
            return [], []
        return [FinancingWorkflow], [
            financing_credit_check_activity,
            financing_credit_assessment_activity,
            financing_contract_signing_activity,
            financing_loan_disbursement_activity,
        ]

    async def run_dag(self, request: ExecuteDAGRequest) -> DAGExecution:
        """通过 Temporal 工作流启动 DAG.

        - dag_id == FINANCING_WORKFLOW_DAG_ID: 走真实 FinancingWorkflow
        - 其它 dag_id: 降级到 service.execute_dag (asyncio 内存编排, R5+ 扩展)
        - Temporal Server 不可达 / Workflow 异常: 降级到 service.execute_dag

        返回 DAGExecution, 与 _AsyncioFallbackRunner.run_dag 返回结构对齐.
        """
        # 仅 FINANCING_WORKFLOW_DAG_ID 走真实 Temporal Workflow
        if request.dag_id != FINANCING_WORKFLOW_DAG_ID:
            return await self._service.execute_dag(request)

        try:
            client = await self._connect()
            assert workflow is not None

            # 生成 workflow_id (含 uuid, 避免重复请求被去重)
            workflow_id = (
                f"financing-{request.enterprise_id}-{uuid4().hex[:12]}"
            )
            started_at = _now_iso()
            execution_id = f"EXEC-{uuid4().hex[:12]}"

            input_payload = {
                "dag_id": request.dag_id,
                "enterprise_id": request.enterprise_id,
                "context": dict(request.context),
                "execution_id": execution_id,
                "started_at": started_at,
            }

            # 启动 Workflow (异步, handle.result() 等待完成)
            handle = await client.start_workflow(
                FinancingWorkflow.run,
                input_payload,
                id=workflow_id,
                task_queue=self._task_queue,
                execution_timeout=timedelta(seconds=3600),
            )
            logger.info(
                f"Temporal Workflow 已启动 (workflow_id={workflow_id}, "
                f"dag_id={request.dag_id}, enterprise_id={request.enterprise_id})"
            )

            # 等待 Workflow 完成 (生产部署可改为 signal / query 异步通知)
            result = await handle.result()
            if not isinstance(result, dict):
                logger.warning(
                    f"Temporal Workflow 返回类型非 dict: {type(result).__name__}, "
                    "降级到 asyncio 编排"
                )
                return await self._service.execute_dag(request)

            return _build_financing_execution(request, result)
        except Exception as exc:
            logger.warning(
                f"Temporal Workflow 启动 / 等待失败, 降级到 asyncio 编排: {exc}"
            )
            return await self._service.execute_dag(request)

    async def start(self) -> None:
        """启动 Worker 后台进程 (监听 task_queue 拉取任务).

        失败时不抛异常, run_dag 仍可在不依赖 Worker 后台进程的情况下
        通过 client.start_workflow 提交任务 (由集群中其它 Worker 节点接收).
        """
        if self._started:
            logger.info("Temporal Worker 已启动, 跳过重复 start")
            return
        try:
            client = await self._connect()
            assert Worker is not None and RetryPolicy is not None

            workflows, activities = self._workflow_and_activities()
            self._worker = Worker(
                client=client,
                task_queue=self._task_queue,
                workflows=workflows,
                activities=activities,
            )
            logger.info(
                f"Temporal Worker 启动 (namespace={self._namespace}, "
                f"task_queue={self._task_queue}, "
                f"workflows={[getattr(w, '__name__', str(w)) for w in workflows]}, "
                f"activities={len(activities)})"
            )
            # 不阻塞调用方: 后台运行, 失败时由 run_dag 兜底
            # 必须持有引用, 否则事件循环可能 GC 回收该任务 (RUF006)
            self._run_task = asyncio.create_task(self._worker.run())  # type: ignore[arg-type]
            self._started = True
        except Exception as exc:
            logger.warning(
                f"Temporal Worker 启动失败, 降级为 asyncio 兜底: {exc}"
            )
            self._started = False

    async def stop(self) -> None:
        """停止 Worker."""
        if self._worker is not None:
            try:
                await self._worker.shutdown()  # type: ignore[attr-defined]
            except Exception as exc:
                logger.warning(f"Temporal Worker 关闭异常: {exc}")
        self._worker = None
        self._started = False


# ============================================================================
# 单例工厂 (自动选择真实 Worker / asyncio 兜底)
# ============================================================================

_worker_singleton: Any | None = None
_worker_lock = asyncio.Lock()


async def get_temporal_worker(
    service: AIOrchestratorService | None = None,
    temporal_address: str | None = None,
    namespace: str | None = None,
    task_queue: str | None = None,
) -> Any:
    """获取 Temporal Worker 单例 (自动降级).

    Args:
        service: AIOrchestratorService 实例 (默认 ai_orchestrator_service 单例)
        temporal_address: Temporal Server gRPC 地址
            (默认从 TEMPORAL_HOST/PORT 环境变量组装)
        namespace: Temporal 命名空间 (默认 TEMPORAL_NAMESPACE 环境变量)
        task_queue: Worker 监听的 TaskQueue (默认 TEMPORAL_TASK_QUEUE 环境变量)

    Returns:
        _TemporalWorkerRunner (真实模式) 或 _AsyncioFallbackRunner (降级模式)
        两者 API 一致: start() / stop() / run_dag(request)

    降级条件 (任一满足即降级到 asyncio 兜底):
        1. temporalio SDK 未安装 (ImportError)
        2. 环境变量未显式配置 Temporal Server (TEMPORAL_HOST/PORT)
        3. _TemporalWorkerRunner 初始化抛异常
    """
    global _worker_singleton
    async with _worker_lock:
        if _worker_singleton is not None:
            return _worker_singleton

        svc = service or ai_orchestrator_service

        # 默认值从环境变量读取 (调用时传入则覆盖)
        address = temporal_address or _temporal_address_from_env()
        ns = namespace or TEMPORAL_NAMESPACE_ENV
        tq = task_queue or TEMPORAL_TASK_QUEUE_ENV

        # 降级条件 1: temporalio SDK 未安装
        if not _TEMPORAL_AVAILABLE:
            logger.info(
                "temporalio SDK 未安装, 启用 asyncio 降级 Worker "
                f"(import_error={_TEMPORAL_IMPORT_ERROR})"
            )
            _worker_singleton = _AsyncioFallbackRunner(svc)
            return _worker_singleton

        # 降级条件 2: 环境变量未显式配置 Temporal Server
        # 即使 temporalio SDK 已安装, 也需要生产环境显式声明 host/port
        # 否则视为开发环境, 走 asyncio 兜底 (避免无谓连接 localhost:7233)
        if not _has_temporal_config():
            logger.info(
                "TEMPORAL_HOST/PORT 未显式配置, 启用 asyncio 降级 Worker "
                f"(host_env={TEMPORAL_HOST_ENV!r}, port_env={TEMPORAL_PORT_ENV!r})"
            )
            _worker_singleton = _AsyncioFallbackRunner(svc)
            return _worker_singleton

        try:
            _worker_singleton = _TemporalWorkerRunner(
                service=svc,
                temporal_address=address,
                namespace=ns,
                task_queue=tq,
            )
            logger.info(
                f"Temporal Worker 已初始化 (真实模式, address={address}, "
                f"namespace={ns}, task_queue={tq})"
            )
        except Exception as exc:
            logger.warning(
                f"Temporal Worker 初始化失败, 降级 asyncio: {exc}"
            )
            _worker_singleton = _AsyncioFallbackRunner(svc)
        return _worker_singleton


async def reset_temporal_worker() -> None:
    """重置单例 (测试用)."""
    global _worker_singleton
    async with _worker_lock:
        if _worker_singleton is not None:
            try:
                await _worker_singleton.stop()
            except Exception as exc:
                logger.warning(f"reset_temporal_worker stop 异常: {exc}")
        _worker_singleton = None


__all__ = [
    "DAG_WORKFLOWS",
    "FINANCING_WORKFLOW_DAG_ID",
    "TEMPORAL_AVAILABLE",
    "FinancingWorkflow",
    "get_temporal_worker",
    "reset_temporal_worker",
]
