"""CORE-02 人机协同网关测试 (R1.5).

覆盖:
    test_seed_5_tasks_and_workflows_present
    test_small_loan_serial_advances_correctly (贷款官→风险官 2 步串行)
    test_big_loan_parallel_all_three_must_approve (3 并行, 差 1 个仍是 PENDING)
    test_any_one_high_priority_short_circuit (AnyOne 一人通过即 APPROVED)
    test_24h_timeout_triggers_escalation_override (24h 超时自动升级)
    test_delegate_appends_record_with_delegated_from
    test_l4_routing_creates_approval_task (L4 路由生成任务, routed_to != AUTO_APPROVE)
    test_l1_low_amount_routes_to_auto_approve (L1 小额 routed_to == AUTO_APPROVE)
"""

from datetime import UTC, datetime, timedelta

import pytest

from app.api.v1.core.human_ai import router as human_ai_router
from app.main import app

_ROUTE_REGISTERED = False
for _r in app.routes:
    _path = getattr(_r, "path", "")
    if _path.startswith("/api/v1/core/human-ai"):
        _ROUTE_REGISTERED = True
        break
if not _ROUTE_REGISTERED:
    app.include_router(human_ai_router, prefix="/api/v1")

from app.schemas.human_ai_gateway import (
    ApprovalPriority,
    ApprovalStatus,
    CreateApprovalRequest,
)
from app.services.human_ai_gateway import (
    ANY_ONE_HIGH_PRIORITY_ID,
    AUTO_APPROVE_MARKER,
    BIG_LOAN_PARALLEL_ID,
    DEFAULT_L3_ADVISORY_ID,
    SMALL_LOAN_SERIAL_ID,
)

pytestmark = pytest.mark.asyncio


class TestSeedData:
    async def test_seed_5_tasks_and_workflows_present(self, client):
        r_wf = await client.get("/api/v1/core/human-ai/workflows")
        assert r_wf.status_code == 200
        wf_data = r_wf.json()
        assert wf_data["code"] == 0
        wfs = wf_data["data"]
        assert len(wfs) >= 4
        wf_ids = [w["id"] for w in wfs]
        assert SMALL_LOAN_SERIAL_ID in wf_ids
        assert BIG_LOAN_PARALLEL_ID in wf_ids
        assert ANY_ONE_HIGH_PRIORITY_ID in wf_ids
        assert DEFAULT_L3_ADVISORY_ID in wf_ids

        r_tasks = await client.get("/api/v1/core/human-ai/tasks")
        assert r_tasks.status_code == 200
        tasks_data = r_tasks.json()
        assert tasks_data["code"] == 0
        tasks = tasks_data["data"]
        assert len(tasks) >= 5
        statuses = [t["status"] for t in tasks]
        assert ApprovalStatus.PENDING.value in statuses
        assert ApprovalStatus.APPROVED.value in statuses
        assert ApprovalStatus.REJECTED.value in statuses
        assert ApprovalStatus.ESCALATED.value in statuses

        proxy_tasks = [t for t in tasks if any(
            a.get("proxyUsed") or a.get("proxy_used")
            for a in t.get("approvals", [])
        )]
        assert len(proxy_tasks) >= 1


class TestSmallLoanSerial:
    async def test_small_loan_serial_advances_correctly(self, client):
        from app.services.human_ai_gateway import HumanAIGatewayService
        svc = HumanAIGatewayService(db=None)

        req = CreateApprovalRequest(
            title="串行审批测试-小额 30万",
            summary="测试串行 2 步审批",
            amount_cents=30_000_000,
            priority=ApprovalPriority.MEDIUM,
            enterprise_id="E-TEST-SERIAL",
            execution_ref_id="DAG-TEST-001",
            workflow_rule_id=SMALL_LOAN_SERIAL_ID,
            deadline_hours=24,
        )
        task = await svc.create_task(req)
        assert task.status == ApprovalStatus.PENDING
        assert task.current_step == 0
        assert len(task.required_approvals) == 2

        task2 = await svc.approve(
            task_id=task.task_id,
            approver_id="U-LOAN-TEST",
            approver_role="loan_officer",
            decision="approve",
            comment="贷款官通过",
        )
        assert task2.status == ApprovalStatus.PENDING
        assert task2.current_step == 1
        assert len(task2.approvals) == 1

        task3 = await svc.approve(
            task_id=task.task_id,
            approver_id="U-RISK-TEST",
            approver_role="risk_manager",
            decision="approve",
            comment="风险官通过",
        )
        assert task3.status == ApprovalStatus.APPROVED
        assert task3.current_step == 2
        assert len(task3.approvals) == 2


class TestBigLoanParallel:
    async def test_big_loan_parallel_all_three_must_approve(self, client):
        from app.services.human_ai_gateway import HumanAIGatewayService
        svc = HumanAIGatewayService(db=None)

        req = CreateApprovalRequest(
            title="并行审批测试-大额 800万",
            summary="测试并行 3 人审批",
            amount_cents=800_000_000,
            priority=ApprovalPriority.URGENT,
            enterprise_id="E-TEST-PARALLEL",
            execution_ref_id="DAG-TEST-002",
            workflow_rule_id=BIG_LOAN_PARALLEL_ID,
            deadline_hours=24,
        )
        task = await svc.create_task(req)
        assert task.status == ApprovalStatus.PENDING
        assert len(task.required_approvals) == 3

        task2 = await svc.approve(
            task_id=task.task_id,
            approver_id="U-RISK-001",
            approver_role="risk_manager",
            decision="approve",
        )
        assert task2.status == ApprovalStatus.PENDING

        task3 = await svc.approve(
            task_id=task.task_id,
            approver_id="U-BRANCH-001",
            approver_role="branch_manager",
            decision="approve",
        )
        assert task3.status == ApprovalStatus.PENDING

        task4 = await svc.approve(
            task_id=task.task_id,
            approver_id="U-CFO-001",
            approver_role="cfo",
            decision="approve",
        )
        assert task4.status == ApprovalStatus.APPROVED
        assert len(task4.approvals) == 3


class TestAnyOneShortCircuit:
    async def test_any_one_high_priority_short_circuit(self, client):
        from app.services.human_ai_gateway import HumanAIGatewayService
        svc = HumanAIGatewayService(db=None)

        req = CreateApprovalRequest(
            title="AnyOne 短路测试",
            summary="任意一人通过即 APPROVED",
            amount_cents=100_000_000,
            priority=ApprovalPriority.HIGH,
            enterprise_id="E-TEST-ANYONE",
            execution_ref_id="DAG-TEST-003",
            workflow_rule_id=ANY_ONE_HIGH_PRIORITY_ID,
            deadline_hours=24,
        )
        task = await svc.create_task(req)
        assert task.status == ApprovalStatus.PENDING

        task2 = await svc.approve(
            task_id=task.task_id,
            approver_id="U-BRANCH-FAST",
            approver_role="branch_manager",
            decision="approve",
            comment="快速通道, 分支行长直接通过",
        )
        assert task2.status == ApprovalStatus.APPROVED
        assert len(task2.approvals) == 1


class TestTimeoutOverride:
    async def test_24h_timeout_triggers_escalation_override(self, client):
        from app.services.human_ai_gateway import HumanAIGatewayService
        svc = HumanAIGatewayService(db=None)

        req = CreateApprovalRequest(
            title="超时测试任务",
            summary="测试 24h 超时自动升级",
            amount_cents=60_000_000,
            priority=ApprovalPriority.MEDIUM,
            enterprise_id="E-TEST-TIMEOUT",
            execution_ref_id="DAG-TEST-TIMEOUT",
            workflow_rule_id=SMALL_LOAN_SERIAL_ID,
            deadline_hours=24,
        )
        task = await svc.create_task(req)
        assert task.status == ApprovalStatus.PENDING
        assert task.escalation_triggered is False

        future_iso = (datetime.now(UTC) + timedelta(hours=25)).isoformat()
        overridden = await svc.check_timeout_and_override(now_iso=future_iso)

        matched = [t for t in overridden if t.task_id == task.task_id]
        assert len(matched) >= 1

        updated = await svc.get_task(task.task_id)
        assert updated is not None
        assert updated.escalation_triggered is True
        assert updated.status in (
            ApprovalStatus.ESCALATED.value,
            ApprovalStatus.TIMEOUT_OVERRIDE.value,
        )


class TestDelegate:
    async def test_delegate_appends_record_with_delegated_from(self, client):
        from app.services.human_ai_gateway import HumanAIGatewayService
        svc = HumanAIGatewayService(db=None)

        req = CreateApprovalRequest(
            title="代理审批测试",
            summary="测试 loan_officer 代理给 auditor",
            amount_cents=25_000_000,
            priority=ApprovalPriority.MEDIUM,
            enterprise_id="E-TEST-DELEGATE",
            execution_ref_id="DAG-TEST-DELEGATE",
            workflow_rule_id=SMALL_LOAN_SERIAL_ID,
            deadline_hours=24,
        )
        task = await svc.create_task(req)
        roles_before = [r["role"] if isinstance(r, dict) else r.role for r in task.required_approvals]
        assert "loan_officer" in roles_before

        delegated = await svc.delegate(
            task_id=task.task_id,
            from_role="loan_officer",
            to_role="auditor",
            approver_id="U-AUDITOR-PROXY",
        )
        roles_after = [
            r["role"] if isinstance(r, dict) else getattr(r, "role", None)
            for r in delegated.required_approvals
        ]
        assert "auditor" in roles_after

        await svc.approve(
            task_id=task.task_id,
            approver_id="U-AUDITOR-PROXY",
            approver_role="auditor",
            decision="approve",
            comment="代理审批通过",
            delegated_from_role="loan_officer",
            proxy=True,
        )
        chain = await svc.get_approval_chain(task.task_id)
        assert len(chain) >= 1
        first = chain[0]
        assert first.delegated_from_role == "loan_officer"
        assert first.proxy_used is True


class TestAIRouting:
    async def test_l4_routing_creates_approval_task(self, client):
        from app.services.human_ai_gateway import HumanAIGatewayService
        svc = HumanAIGatewayService(db=None)

        decision = await svc.route_from_ai(
            autonomy_level="L4",
            execution_ref_id="DAG-AI-L4-001",
            amount_cents=500_000,
            title="L4 路由测试",
            summary="L4 培育期必须人工",
            enterprise_id="E-AI-L4",
        )
        assert decision.autonomy_level == "L4"
        assert decision.routed_to != AUTO_APPROVE_MARKER
        assert decision.task_id is not None
        assert decision.pending_steps >= 1

        task = await svc.get_task(decision.task_id)
        assert task is not None
        assert task.workflow_id == DEFAULT_L3_ADVISORY_ID

    async def test_l1_low_amount_routes_to_auto_approve(self, client):
        from app.services.human_ai_gateway import HumanAIGatewayService
        svc = HumanAIGatewayService(db=None)

        decision = await svc.route_from_ai(
            autonomy_level="L1",
            execution_ref_id="DAG-AI-L1-001",
            amount_cents=20_000_000,
            title="L1 小额自动放行",
            summary="L1 + <50万 直接放行",
            enterprise_id="E-AI-L1",
        )
        assert decision.autonomy_level == "L1"
        assert decision.routed_to == AUTO_APPROVE_MARKER
        assert decision.task_id is None
        assert decision.pending_steps == 0
        assert decision.escalated is False
