"""AI 自主操作编排引擎 schemas (CORE-01).

设计依据: ROADMAP R1.4 + spec.md L1-L4 自主等级.
- L1_FULL_AUTO    全自动: 不暂停, 完整 DAG 执行
- L2_SMALL_AUTO   半自动: 低风险自动, 高风险挂 WAITING_HUMAN
- L3_ADVISORY     咨询式: 每步 AI 建议 + WAITING_HUMAN
- L4_SUGGEST_ONLY 仅建议: 不执行, 仅生成 AI 建议, 所有节点 SKIPPED

字段命名: snake_case (PEP 8), alias_generator 自动转 camelCase 与前端契约对齐.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.schemas.common import Id, IsoTimestamp, Ratio

# === 枚举 ===

class AutonomyLevel(StrEnum):
    """自主等级 (L1-L4, 数字越小越自动化)."""
    L1_FULL_AUTO = "L1_FULL_AUTO"
    L2_SMALL_AUTO = "L2_SMALL_AUTO"
    L3_ADVISORY = "L3_ADVISORY"
    L4_SUGGEST_ONLY = "L4_SUGGEST_ONLY"


class DAGStatus(StrEnum):
    """DAG 执行状态."""
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    SUSPENDED = "SUSPENDED"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    WAITING_HUMAN = "WAITING_HUMAN"


class TaskResultStatus(StrEnum):
    """单个节点任务结果状态."""
    SUCCESS = "SUCCESS"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"
    HUMAN_REVIEWED = "HUMAN_REVIEWED"


class TaskType(StrEnum):
    """DAG 节点任务类型."""
    FETCH_DATA = "FETCH_DATA"
    OCR = "OCR"
    VERIFY = "VERIFY"
    SCORE = "SCORE"
    DECISION = "DECISION"
    NOTIFY = "NOTIFY"
    WAIT = "WAIT"


class EdgeCondition(StrEnum):
    """DAG 边条件."""
    ALWAYS = "always"
    ON_SUCCESS = "on_success"
    ON_FAILED = "on_failed"
    ON_SKIP = "on_skip"


HumanDecision = Literal["approve", "reject", None]


# === 基础 mixin ===

class _OrchBase(BaseModel):
    """编排 schema 公共配置: snake_case + camelCase alias + 双向填充."""
    model_config = ConfigDict(
        populate_by_name=True,
        alias_generator=to_camel,
        use_enum_values=True,
    )


# === DAG 定义 ===

class DAGNode(_OrchBase):
    """DAG 节点定义."""
    node_id: Id = Field(description="节点唯一 ID")
    task_type: TaskType = Field(description="任务类型")
    params: dict[str, Any] = Field(default_factory=dict, description="任务参数")
    depends_on: list[str] | None = Field(default=None, description="依赖的前置节点 ID 列表")
    autonomy_level_override: AutonomyLevel | None = Field(default=None, description="节点级自主等级覆盖")


class DAGEdge(_OrchBase):
    """DAG 边定义."""
    from_node: Id = Field(description="源节点 ID")
    to_node: Id = Field(description="目标节点 ID")
    condition: EdgeCondition = Field(default=EdgeCondition.ON_SUCCESS, description="触发条件")


class AIDAG(_OrchBase):
    """AI DAG 编排定义."""
    name: str = Field(description="DAG 名称")
    dag_id: Id = Field(description="DAG 唯一 ID")
    description: str = Field(default="", description="DAG 描述")
    nodes: list[DAGNode] = Field(description="节点列表")
    edges: list[DAGEdge] = Field(default_factory=list, description="边列表")
    autonomy_level: AutonomyLevel = Field(description="DAG 默认自主等级")
    created_by: str = Field(default="system", description="创建人")
    timeout_seconds: int = Field(default=3600, ge=1, description="超时秒数")


# === 任务结果 & DAG 执行 ===

class TaskResult(_OrchBase):
    """单个节点任务执行结果."""
    node_id: Id = Field(description="节点 ID")
    status: TaskResultStatus = Field(description="任务状态")
    started_at: IsoTimestamp = Field(description="开始时间")
    ended_at: IsoTimestamp | None = Field(default=None, description="结束时间")
    output: dict[str, Any] = Field(default_factory=dict, description="任务输出")
    error: str | None = Field(default=None, description="错误信息")
    human_decision: HumanDecision = Field(default=None, description="人工决策 approve/reject")


class DAGExecution(_OrchBase):
    """DAG 执行实例."""
    id: Id = Field(description="执行实例 ID")
    dag_id: Id = Field(description="关联 DAG ID")
    enterprise_id: Id = Field(default="default", description="企业 ID")
    status: DAGStatus = Field(description="执行状态")
    start_at: IsoTimestamp = Field(description="开始时间")
    end_at: IsoTimestamp | None = Field(default=None, description="结束时间")
    results_by_node: dict[str, TaskResult] = Field(default_factory=dict, description="节点结果映射")
    context: dict[str, Any] = Field(default_factory=dict, description="执行上下文")
    recommendation_summary: dict[str, Any] | None = Field(default=None, description="L4 建议摘要")
    waiting_node_id: Id | None = Field(default=None, description="当前等待人工审批的节点 ID")


# === 决策日志 ===

class DecisionLogEntry(_OrchBase):
    """决策日志条目 (含证据链, 用于五流合一验证)."""
    log_id: Id = Field(description="日志 ID")
    dag_execution_id: Id = Field(description="DAG 执行 ID")
    node_id: Id = Field(description="节点 ID")
    enterprise_id: Id = Field(default="default", description="企业 ID")
    autonomy_level: AutonomyLevel = Field(description="决策时自主等级")
    ai_recommendation: dict[str, Any] = Field(default_factory=dict, description="AI 建议")
    ai_confidence: Ratio = Field(default=0.0, description="AI 置信度 0-1")
    human_decision_override: dict[str, Any] | None = Field(default=None, description="人工覆盖决策")
    final_decision: dict[str, Any] = Field(default_factory=dict, description="最终决策")
    decided_at: IsoTimestamp = Field(description="决策时间")
    operator: str | None = Field(default=None, description="操作人")
    evidence_ids: list[str] = Field(default_factory=list, description="证据 ID 列表 (invoice_no/case_id/bank_tx_ids 等)")


# === 请求体 ===

class ExecuteDAGRequest(_OrchBase):
    """执行 DAG 请求."""
    dag_id: Id = Field(description="DAG ID")
    enterprise_id: Id = Field(default="default", description="企业 ID")
    context: dict[str, Any] = Field(default_factory=dict, description="执行上下文 (金额/发票号等)")


class ApproveNodeRequest(_OrchBase):
    """人工审批节点请求."""
    human_decision_override: dict[str, Any] = Field(default_factory=dict, description="人工覆盖决策")
    operator: str = Field(default="unknown", description="操作人")


__all__ = [
    "AIDAG",
    "ApproveNodeRequest",
    "AutonomyLevel",
    "DAGEdge",
    "DAGExecution",
    "DAGNode",
    "DAGStatus",
    "DecisionLogEntry",
    "EdgeCondition",
    "ExecuteDAGRequest",
    "HumanDecision",
    "TaskResult",
    "TaskResultStatus",
    "TaskType",
]
