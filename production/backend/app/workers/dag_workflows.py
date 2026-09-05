"""CORE-01 R7.0 - 业务 DAG 工作流定义 (3 个真实业务场景).

设计依据: ROADMAP_REMAINING_V3.md R7.0 + temporal_worker.py DAG_WORKFLOWS.

3 个业务 DAG:
    1. loan_approval_dag    贷款审批: 征信查询 → 风控评估 → 人工审批 → 放款
    2. invoice_discount_dag 票据贴现: 票据验真 → 额度计算 → 贴现执行
    3. fund_monitor_dag     资金监管: 五流校验 → 异常告警 → 人工复核

每个 DAG 由 DAGNode + DAGEdge 组成, 与 ai_orchestrator_service._seed 风格一致.
通过 AIOrchestratorService.register_predefined_dags() 注册到内存 _OrchStore.

降级策略:
    - Temporal SDK 不可用时, DAG 走 ai_orchestrator_service.execute_dag asyncio 顺序执行
      (已在 temporal_worker._AsyncioFallbackRunner 实现, 此模块无需感知)
    - DAG 节点 task_type 复用现有 TaskType 枚举 (FETCH_DATA/OCR/VERIFY/SCORE/DECISION/NOTIFY/WAIT)
      保证 _NodeHandlers.handle_* 已覆盖

用法:
    from app.workers.dag_workflows import BUSINESS_DAGS, get_business_dag
    from app.services.ai_orchestrator_service import ai_orchestrator_service
    await ai_orchestrator_service.register_predefined_dags()
"""

from __future__ import annotations

from typing import Any

from app.schemas.ai_orchestrator import (
    AIDAG, AutonomyLevel, DAGEdge, DAGNode, EdgeCondition, TaskType,
)


# ============================================================================
# 1. 贷款审批 DAG (L3 咨询式: 每步人工审批)
# ============================================================================

def _build_loan_approval_dag() -> dict[str, Any]:
    """贷款审批 DAG: 征信查询 → 风控评估 → 人工审批 → 放款.

    自主等级: L3_ADVISORY (每步需要人工审批, 适合大额贷款场景)
    节点 (5 个):
        - la1_fetch_credit   征信查询     FETCH_DATA (征信 + 银行流水)
        - la2_risk_score     风控评估     SCORE (风控模型评分)
        - la3_human_approve  人工审批     DECISION (人工最终决策, L3 阻塞)
        - la4_loan_disburse  放款执行     NOTIFY (放款通知 + 凭证上链)
        - la5_post_loan      贷后管理     VERIFY (贷后资金监管)
    """
    nodes: list[DAGNode] = [
        DAGNode(
            node_id="la1_fetch_credit",
            task_type=TaskType.FETCH_DATA,
            params={
                "sources": ["credit", "bank", "gsxt"],
                "fetch_credit_report": True,
                "fetch_bank_balance": True,
            },
            depends_on=None,
            autonomy_level_override=None,
        ),
        DAGNode(
            node_id="la2_risk_score",
            task_type=TaskType.SCORE,
            params={
                "scorecard": "loan_approval_v1",
                "factors": ["credit_history", "repayment_capacity", "industry_risk"],
            },
            depends_on=["la1_fetch_credit"],
            autonomy_level_override=None,
        ),
        DAGNode(
            node_id="la3_human_approve",
            task_type=TaskType.DECISION,
            params={
                "policy": "human_final",
                "approval_threshold": 80,
                "require_legal_sign": True,
            },
            depends_on=["la2_risk_score"],
            autonomy_level_override=AutonomyLevel.L3_ADVISORY,
        ),
        DAGNode(
            node_id="la4_loan_disburse",
            task_type=TaskType.NOTIFY,
            params={
                "channel": "bank_api",
                "action": "disburse_loan",
                "evidence_chain": True,
            },
            depends_on=["la3_human_approve"],
            autonomy_level_override=None,
        ),
        DAGNode(
            node_id="la5_post_loan",
            task_type=TaskType.VERIFY,
            params={
                "verify_type": "post_loan_fund_usage",
                "monitor_days": 30,
            },
            depends_on=["la4_loan_disburse"],
            autonomy_level_override=None,
        ),
    ]
    edges: list[DAGEdge] = [
        DAGEdge(from_node="la1_fetch_credit", to_node="la2_risk_score",
                condition=EdgeCondition.ON_SUCCESS),
        DAGEdge(from_node="la2_risk_score", to_node="la3_human_approve",
                condition=EdgeCondition.ON_SUCCESS),
        DAGEdge(from_node="la3_human_approve", to_node="la4_loan_disburse",
                condition=EdgeCondition.ON_SUCCESS),
        DAGEdge(from_node="la4_loan_disburse", to_node="la5_post_loan",
                condition=EdgeCondition.ALWAYS),  # 放款后必走贷后
    ]
    dag = AIDAG(
        name="贷款审批流程",
        dag_id="LOAN-APPROVAL-DAG",
        description=(
            "贷款审批 L3 流程: 征信查询 → 风控评分 → 人工审批 → 放款 → 贷后管理. "
            "适用 50 万以上大额贷款, 每步需人工确认."
        ),
        nodes=nodes,
        edges=edges,
        autonomy_level=AutonomyLevel.L3_ADVISORY,
        created_by="system",
        timeout_seconds=86400,
    )
    return dag.model_dump()


# ============================================================================
# 2. 票据贴现 DAG (L2 小额自动, 大额需人工)
# ============================================================================

def _build_invoice_discount_dag() -> dict[str, Any]:
    """票据贴现 DAG: 票据验真 → 额度计算 → 贴现执行.

    自主等级: L2_SMALL_AUTO (小额贴现自动, 大额触发人工审批)
    节点 (4 个):
        - id1_invoice_verify   票据验真   VERIFY (ECDS 票据状态 + 票面信息)
        - id2_amount_calc      额度计算   SCORE (贴现利息 + 净额计算)
        - id3_discount_exec    贴现执行   DECISION (贴现决策 + 资金划转)
        - id4_settlement       资金清算   NOTIFY (清算通知 + 凭证归档)
    """
    nodes: list[DAGNode] = [
        DAGNode(
            node_id="id1_invoice_verify",
            task_type=TaskType.VERIFY,
            params={
                "verify_invoice": True,
                "verify_ecds_status": True,
                "verify_bank_acceptance": True,
                "verify_endorser_chain": True,
            },
            depends_on=None,
            autonomy_level_override=None,
        ),
        DAGNode(
            node_id="id2_amount_calc",
            task_type=TaskType.SCORE,
            params={
                "scorecard": "invoice_discount_v1",
                "calc_model": "360_day_basis",
                "discount_rate_default": 0.045,
            },
            depends_on=["id1_invoice_verify"],
            autonomy_level_override=None,
        ),
        DAGNode(
            node_id="id3_discount_exec",
            task_type=TaskType.DECISION,
            params={
                "policy": "auto_threshold_with_human_override",
                "auto_threshold_cents": 50_000_000,  # 50 万以下自动
                "require_human_above": True,
            },
            depends_on=["id2_amount_calc"],
            autonomy_level_override=None,  # 走 DAG 默认 L2
        ),
        DAGNode(
            node_id="id4_settlement",
            task_type=TaskType.NOTIFY,
            params={
                "channel": "bank_settlement",
                "action": "fund_transfer",
                "evidence_chain": True,
            },
            depends_on=["id3_discount_exec"],
            autonomy_level_override=None,
        ),
    ]
    edges: list[DAGEdge] = [
        DAGEdge(from_node="id1_invoice_verify", to_node="id2_amount_calc",
                condition=EdgeCondition.ON_SUCCESS),
        DAGEdge(from_node="id2_amount_calc", to_node="id3_discount_exec",
                condition=EdgeCondition.ON_SUCCESS),
        DAGEdge(from_node="id3_discount_exec", to_node="id4_settlement",
                condition=EdgeCondition.ON_SUCCESS),
    ]
    dag = AIDAG(
        name="票据贴现流程",
        dag_id="INVOICE-DISCOUNT-DAG",
        description=(
            "票据贴现 L2 流程: 票据验真 → 额度计算 → 贴现决策 → 资金清算. "
            "50 万以下小额自动放款, 50 万以上触发人工审批."
        ),
        nodes=nodes,
        edges=edges,
        autonomy_level=AutonomyLevel.L2_SMALL_AUTO,
        created_by="system",
        timeout_seconds=3600,
    )
    return dag.model_dump()


# ============================================================================
# 3. 资金监管 DAG (L3 咨询式: 五流校验 + 异常告警 + 人工复核)
# ============================================================================

def _build_fund_monitor_dag() -> dict[str, Any]:
    """资金监管 DAG: 五流校验 → 异常告警 → 人工复核.

    自主等级: L3_ADVISORY (异常必须人工复核)
    节点 (4 个):
        - fm1_fetch_data      数据采集     FETCH_DATA (资金/合同/发票/货物流/税流)
        - fm2_five_flow_check 五流校验     VERIFY (五流合一一致性校验)
        - fm3_anomaly_alert   异常告警     SCORE (异常分级 + 告警决策)
        - fm4_human_review    人工复核     DECISION (人工复核 + 处置决策)
        - fm5_action_exec     处置执行     NOTIFY (执行冻结/限制/放行)
    """
    nodes: list[DAGNode] = [
        DAGNode(
            node_id="fm1_fetch_data",
            task_type=TaskType.FETCH_DATA,
            params={
                "sources": ["bank", "invoice", "contract", "tax", "logistics"],
                "fetch_window_days": 7,
            },
            depends_on=None,
            autonomy_level_override=None,
        ),
        DAGNode(
            node_id="fm2_five_flow_check",
            task_type=TaskType.VERIFY,
            params={
                "verify_type": "five_flow_consistency",
                "flows": ["funds", "contract", "invoice", "goods", "tax"],
                "tolerance_pct": 0.05,
            },
            depends_on=["fm1_fetch_data"],
            autonomy_level_override=None,
        ),
        DAGNode(
            node_id="fm3_anomaly_alert",
            task_type=TaskType.SCORE,
            params={
                "scorecard": "fund_anomaly_v1",
                "alert_levels": ["low", "medium", "high", "critical"],
                "auto_freeze_threshold": 90,
            },
            depends_on=["fm2_five_flow_check"],
            autonomy_level_override=None,
        ),
        DAGNode(
            node_id="fm4_human_review",
            task_type=TaskType.DECISION,
            params={
                "policy": "human_final",
                "require_compliance_officer": True,
            },
            depends_on=["fm3_anomaly_alert"],
            autonomy_level_override=AutonomyLevel.L3_ADVISORY,
        ),
        DAGNode(
            node_id="fm5_action_exec",
            task_type=TaskType.NOTIFY,
            params={
                "channel": "bank_api",
                "action": "fund_restriction",
                "evidence_chain": True,
            },
            depends_on=["fm4_human_review"],
            autonomy_level_override=None,
        ),
    ]
    edges: list[DAGEdge] = [
        DAGEdge(from_node="fm1_fetch_data", to_node="fm2_five_flow_check",
                condition=EdgeCondition.ON_SUCCESS),
        DAGEdge(from_node="fm2_five_flow_check", to_node="fm3_anomaly_alert",
                condition=EdgeCondition.ALWAYS),  # 即使无异常也要走告警判断
        DAGEdge(from_node="fm3_anomaly_alert", to_node="fm4_human_review",
                condition=EdgeCondition.ON_SUCCESS),
        DAGEdge(from_node="fm4_human_review", to_node="fm5_action_exec",
                condition=EdgeCondition.ON_SUCCESS),
    ]
    dag = AIDAG(
        name="资金监管流程",
        dag_id="FUND-MONITOR-DAG",
        description=(
            "资金监管 L3 流程: 数据采集 → 五流校验 → 异常告警 → 人工复核 → 处置执行. "
            "适用大额资金监管场景, 异常需人工复核处置."
        ),
        nodes=nodes,
        edges=edges,
        autonomy_level=AutonomyLevel.L3_ADVISORY,
        created_by="system",
        timeout_seconds=7200,
    )
    return dag.model_dump()


# ============================================================================
# 公开接口: BUSINESS_DAGS 列表 + 工厂函数
# ============================================================================

# 3 个业务 DAG 工厂函数 (调用时构造, 避免模块导入时副作用)
_DAG_BUILDERS: dict[str, Any] = {
    "LOAN-APPROVAL-DAG": _build_loan_approval_dag,
    "INVOICE-DISCOUNT-DAG": _build_invoice_discount_dag,
    "FUND-MONITOR-DAG": _build_fund_monitor_dag,
}


def get_business_dag(dag_id: str) -> dict[str, Any] | None:
    """根据 dag_id 获取业务 DAG 定义 (dict, model_dump 形式).

    Args:
        dag_id: DAG ID (LOAN-APPROVAL-DAG / INVOICE-DISCOUNT-DAG / FUND-MONITOR-DAG)

    Returns:
        DAG dict (含 nodes/edges/autonomy_level 等) 或 None
    """
    builder = _DAG_BUILDERS.get(dag_id)
    if not builder:
        return None
    return builder()


# 完整列表 (调用各 builder)
BUSINESS_DAGS: list[dict[str, Any]] = [
    _build_loan_approval_dag(),
    _build_invoice_discount_dag(),
    _build_fund_monitor_dag(),
]


# 业务 DAG 元数据 (与 temporal_worker.DAG_WORKFLOWS 风格对齐, 用于 Worker 注册)
BUSINESS_DAG_WORKFLOWS: list[dict[str, Any]] = [
    {
        "dag_id": "LOAN-APPROVAL-DAG",
        "name": "贷款审批流程",
        "task_queue": "fintrust-dag-queue",
        "timeout_seconds": 86400,
        "retry": {"max_attempts": 2, "initial_interval_seconds": 5,
                  "max_interval_seconds": 60, "backoff_coefficient": 2.0},
        "autonomy_level": "L3_ADVISORY",
    },
    {
        "dag_id": "INVOICE-DISCOUNT-DAG",
        "name": "票据贴现流程",
        "task_queue": "fintrust-dag-queue",
        "timeout_seconds": 3600,
        "retry": {"max_attempts": 3, "initial_interval_seconds": 1,
                  "max_interval_seconds": 10, "backoff_coefficient": 2.0},
        "autonomy_level": "L2_SMALL_AUTO",
    },
    {
        "dag_id": "FUND-MONITOR-DAG",
        "name": "资金监管流程",
        "task_queue": "fintrust-dag-queue",
        "timeout_seconds": 7200,
        "retry": {"max_attempts": 2, "initial_interval_seconds": 5,
                  "max_interval_seconds": 30, "backoff_coefficient": 1.5},
        "autonomy_level": "L3_ADVISORY",
    },
]


__all__ = [
    "BUSINESS_DAGS",
    "BUSINESS_DAG_WORKFLOWS",
    "get_business_dag",
]
