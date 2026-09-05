"""人机协同网关服务 (CORE-02 R1.5).

严格遵循 bank_service.py 模式: 内存单例 Store + asyncio.Lock + seed.
内置 4 个标准审批工作流:
    a. SMALL_LOAN_SERIAL    <50 万串行: loan_officer → risk_manager, 24h
    b. BIG_LOAN_PARALLEL    >500 万并行: risk_manager & branch_manager & cfo 全部通过
    c. ANY_ONE_HIGH_PRIORITY  3 角色 AnyOne 审批
    d. DEFAULT_L3_ADVISORY  CORE-01 L3 节点: loan_officer → risk_manager
24h 超时自动升级到 escalation_role (cfo 或 branch_manager).
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from app.schemas.human_ai_gateway import (
    ApprovalPriority, ApprovalRecord, ApprovalStatus, ApprovalTask,
    ApproverRole, ApproverSlot, CreateApprovalRequest, EscalateRequest,
    HumanRoutingDecision, WorkflowRule, WorkflowType,
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _now_dt() -> datetime:
    return datetime.now(timezone.utc)


def _parse_iso(iso: str) -> datetime:
    return datetime.fromisoformat(iso)


def _id(prefix: str = "app") -> str:
    return f"{prefix}-{uuid4().hex[:12]}"


def _ev(enum_or_str: Any) -> str:
    """兼容 Enum.value 和 已转换为字符串的情况 (use_enum_values=True 下 Pydantic 返回 str)."""
    if enum_or_str is None:
        return ""
    return enum_or_str.value if hasattr(enum_or_str, "value") else str(enum_or_str)


SMALL_LOAN_SERIAL_ID = "WF-SMALL-SERIAL"
BIG_LOAN_PARALLEL_ID = "WF-BIG-PARALLEL"
ANY_ONE_HIGH_PRIORITY_ID = "WF-ANYONE-HIGH"
DEFAULT_L3_ADVISORY_ID = "WF-L3-ADVISORY"

SMALL_THRESHOLD = 500_000 * 100
BIG_THRESHOLD = 5_000_000 * 100

AUTO_APPROVE_MARKER = "AUTO_APPROVE"


class _HumanAIStore:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._workflows: dict[str, dict] = {}
        self._tasks: dict[str, dict] = {}
        self._delegations: dict[str, list[dict]] = {}
        self._seed()

    def _seed(self) -> None:
        wf_small_serial = {
            "id": SMALL_LOAN_SERIAL_ID,
            "name": "小额贷款串行审批 (<50万)",
            "type": WorkflowType.SERIAL.value,
            "approvers": [
                {"role": "loan_officer", "min_level": 1, "required": True},
                {"role": "risk_manager", "min_level": 2, "required": True},
            ],
            "timeoutHours": 24,
            "escalationRole": "branch_manager",
        }
        wf_big_parallel = {
            "id": BIG_LOAN_PARALLEL_ID,
            "name": "大额贷款并行审批 (>500万)",
            "type": WorkflowType.PARALLEL.value,
            "approvers": [
                {"role": "risk_manager", "min_level": 2, "required": True},
                {"role": "branch_manager", "min_level": 3, "required": True},
                {"role": "cfo", "min_level": 4, "required": True},
            ],
            "timeoutHours": 24,
            "escalationRole": "cfo",
        }
        wf_anyone_high = {
            "id": ANY_ONE_HIGH_PRIORITY_ID,
            "name": "高优先级快速通道 (AnyOne)",
            "type": WorkflowType.ANY_ONE.value,
            "approvers": [
                {"role": "risk_manager", "min_level": 2, "required": True},
                {"role": "branch_manager", "min_level": 3, "required": True},
                {"role": "cfo", "min_level": 4, "required": True},
            ],
            "timeoutHours": 24,
            "escalationRole": "cfo",
        }
        wf_l3_advisory = {
            "id": DEFAULT_L3_ADVISORY_ID,
            "name": "CORE-01 L3 验证期审批",
            "type": WorkflowType.SERIAL.value,
            "approvers": [
                {"role": "loan_officer", "min_level": 1, "required": True},
                {"role": "risk_manager", "min_level": 2, "required": True},
            ],
            "timeoutHours": 24,
            "escalationRole": "branch_manager",
        }
        for wf in [wf_small_serial, wf_big_parallel, wf_anyone_high, wf_l3_advisory]:
            self._workflows[wf["id"]] = dict(wf)

        now = _now_dt()
        deadline_pending = (now + timedelta(hours=24)).isoformat()
        deadline_past = (now - timedelta(hours=25)).isoformat()

        tasks_seed = [
            {
                "task_id": _id("TASK"),
                "workflow_id": SMALL_LOAN_SERIAL_ID,
                "execution_ref_id": "DAG-EXEC-001",
                "enterprise_id": "E001",
                "title": "深圳科创电子 30万流动资金贷款",
                "summary": "L3 节点审批, 已由贷款官初审通过, 等待风险官复核",
                "amount_cents": 30_000_000,
                "priority": ApprovalPriority.MEDIUM.value,
                "deadline_iso": deadline_pending,
                "current_step": 1,
                "status": ApprovalStatus.PENDING.value,
                "approvals": [
                    {
                        "task_id": "",
                        "step": 0,
                        "approver_id": "U-LOAN-001",
                        "approver_role": "loan_officer",
                        "decision": "approve",
                        "comment": "材料齐全, 信用良好, 建议通过",
                        "decided_at": _now_iso(),
                        "delegated_from_role": None,
                        "proxy_used": False,
                    },
                ],
                "required_approvals": [
                    {"role": "loan_officer", "min_level": 1, "required": True},
                    {"role": "risk_manager", "min_level": 2, "required": True},
                ],
                "escalation_role": "branch_manager",
                "escalation_triggered": False,
                "created_at": _now_iso(),
            },
            {
                "task_id": _id("TASK"),
                "workflow_id": SMALL_LOAN_SERIAL_ID,
                "execution_ref_id": "DAG-EXEC-002",
                "enterprise_id": "E002",
                "title": "杭州智造机械 45万设备贷款",
                "summary": "串行审批已全部通过",
                "amount_cents": 45_000_000,
                "priority": ApprovalPriority.HIGH.value,
                "deadline_iso": deadline_pending,
                "current_step": 2,
                "status": ApprovalStatus.APPROVED.value,
                "approvals": [
                    {
                        "task_id": "",
                        "step": 0,
                        "approver_id": "U-LOAN-002",
                        "approver_role": "loan_officer",
                        "decision": "approve",
                        "comment": "第一还款来源充足",
                        "decided_at": _now_iso(),
                        "delegated_from_role": None,
                        "proxy_used": False,
                    },
                    {
                        "task_id": "",
                        "step": 1,
                        "approver_id": "U-RISK-001",
                        "approver_role": "risk_manager",
                        "decision": "approve",
                        "comment": "风险可控, 通过",
                        "decided_at": _now_iso(),
                        "delegated_from_role": None,
                        "proxy_used": False,
                    },
                ],
                "required_approvals": [
                    {"role": "loan_officer", "min_level": 1, "required": True},
                    {"role": "risk_manager", "min_level": 2, "required": True},
                ],
                "escalation_role": "branch_manager",
                "escalation_triggered": False,
                "created_at": _now_iso(),
            },
            {
                "task_id": _id("TASK"),
                "workflow_id": SMALL_LOAN_SERIAL_ID,
                "execution_ref_id": "DAG-EXEC-003",
                "enterprise_id": "E003",
                "title": "苏州新材料 28万周转贷款 - 驳回",
                "summary": "应收账款周转天数过长, 风险官驳回",
                "amount_cents": 28_000_000,
                "priority": ApprovalPriority.MEDIUM.value,
                "deadline_iso": deadline_pending,
                "current_step": 1,
                "status": ApprovalStatus.REJECTED.value,
                "approvals": [
                    {
                        "task_id": "",
                        "step": 0,
                        "approver_id": "U-LOAN-003",
                        "approver_role": "loan_officer",
                        "decision": "approve",
                        "comment": "基本条件满足",
                        "decided_at": _now_iso(),
                        "delegated_from_role": None,
                        "proxy_used": False,
                    },
                    {
                        "task_id": "",
                        "step": 1,
                        "approver_id": "U-RISK-002",
                        "approver_role": "risk_manager",
                        "decision": "reject",
                        "comment": "DSO 92 天, 超阈值 60 天",
                        "decided_at": _now_iso(),
                        "delegated_from_role": None,
                        "proxy_used": False,
                    },
                ],
                "required_approvals": [
                    {"role": "loan_officer", "min_level": 1, "required": True},
                    {"role": "risk_manager", "min_level": 2, "required": True},
                ],
                "escalation_role": "branch_manager",
                "escalation_triggered": False,
                "created_at": _now_iso(),
            },
            {
                "task_id": _id("TASK"),
                "workflow_id": BIG_LOAN_PARALLEL_ID,
                "execution_ref_id": "DAG-EXEC-004",
                "enterprise_id": "E004",
                "title": "广州新能源 800万产能贷款 - 超时升级",
                "summary": "24h 超时未完成审批, 已自动升级至 CFO",
                "amount_cents": 800_000_000,
                "priority": ApprovalPriority.URGENT.value,
                "deadline_iso": deadline_past,
                "current_step": 0,
                "status": ApprovalStatus.ESCALATED.value,
                "approvals": [
                    {
                        "task_id": "",
                        "step": 0,
                        "approver_id": "U-RISK-003",
                        "approver_role": "risk_manager",
                        "decision": "approve",
                        "comment": "风控评估通过",
                        "decided_at": _now_iso(),
                        "delegated_from_role": None,
                        "proxy_used": False,
                    },
                ],
                "required_approvals": [
                    {"role": "risk_manager", "min_level": 2, "required": True},
                    {"role": "branch_manager", "min_level": 3, "required": True},
                    {"role": "cfo", "min_level": 4, "required": True},
                ],
                "escalation_role": "cfo",
                "escalation_triggered": True,
                "created_at": _now_iso(),
            },
            {
                "task_id": _id("TASK"),
                "workflow_id": DEFAULT_L3_ADVISORY_ID,
                "execution_ref_id": "DAG-EXEC-005",
                "enterprise_id": "E005",
                "title": "北京智慧医疗 55万贷款 - 代理审批",
                "summary": "贷款官外出, 由代理审批人完成",
                "amount_cents": 55_000_000,
                "priority": ApprovalPriority.HIGH.value,
                "deadline_iso": deadline_pending,
                "current_step": 1,
                "status": ApprovalStatus.PENDING.value,
                "approvals": [
                    {
                        "task_id": "",
                        "step": 0,
                        "approver_id": "U-LOAN-PROXY",
                        "approver_role": "loan_officer",
                        "decision": "approve",
                        "comment": "代理审批: 材料完整, 建议通过",
                        "decided_at": _now_iso(),
                        "delegated_from_role": "loan_officer",
                        "proxy_used": True,
                    },
                ],
                "required_approvals": [
                    {"role": "loan_officer", "min_level": 1, "required": True},
                    {"role": "risk_manager", "min_level": 2, "required": True},
                ],
                "escalation_role": "branch_manager",
                "escalation_triggered": False,
                "created_at": _now_iso(),
            },
        ]

        for t in tasks_seed:
            for a in t["approvals"]:
                a["task_id"] = t["task_id"]
            self._tasks[t["task_id"]] = dict(t)

    async def list_workflows(self) -> list[dict]:
        async with self._lock:
            return [dict(w) for w in self._workflows.values()]

    async def get_workflow(self, wf_id: str) -> dict | None:
        async with self._lock:
            w = self._workflows.get(wf_id)
            return dict(w) if w else None

    async def add_task(self, task: dict) -> dict:
        async with self._lock:
            self._tasks[task["task_id"]] = dict(task)
            return dict(task)

    async def get_task(self, task_id: str) -> dict | None:
        async with self._lock:
            t = self._tasks.get(task_id)
            return dict(t) if t else None

    async def update_task(self, task_id: str, task: dict) -> dict:
        async with self._lock:
            self._tasks[task_id] = dict(task)
            return dict(task)

    async def list_tasks(
        self,
        status: str | None = None,
        approver_role: str | None = None,
        enterprise_id: str | None = None,
    ) -> list[dict]:
        async with self._lock:
            tasks = list(self._tasks.values())
            if status:
                tasks = [t for t in tasks if t.get("status") == status]
            if enterprise_id:
                tasks = [t for t in tasks if t.get("enterprise_id") == enterprise_id]
            if approver_role:
                filtered = []
                for t in tasks:
                    reqs = t.get("required_approvals", [])
                    matched = any(r.get("role") == approver_role for r in reqs)
                    if matched:
                        filtered.append(t)
                tasks = filtered
            return [dict(t) for t in tasks]

    async def add_delegation(self, task_id: str, delegation: dict) -> None:
        async with self._lock:
            if task_id not in self._delegations:
                self._delegations[task_id] = []
            self._delegations[task_id].append(dict(delegation))


_human_ai_store = _HumanAIStore()


class HumanAIGatewayService:
    def __init__(self, db: Any | None = None) -> None:
        self.db = db
        self._ai_orchestrator = None
        try:
            from app.services.ai_orchestrator_service import AIOrchestratorService
            self._ai_orchestrator = AIOrchestratorService(db=db)
        except (ImportError, Exception):
            self._ai_orchestrator = None

    @staticmethod
    def _workflow_from_dict(wf_dict: dict) -> WorkflowRule:
        return WorkflowRule.model_validate(wf_dict)

    @staticmethod
    def _task_from_dict(task_dict: dict) -> ApprovalTask:
        return ApprovalTask.model_validate(task_dict)

    async def list_workflows(self) -> list[WorkflowRule]:
        items = await _human_ai_store.list_workflows()
        return [self._workflow_from_dict(w) for w in items]

    async def get_workflow(self, workflow_id: str) -> WorkflowRule | None:
        w = await _human_ai_store.get_workflow(workflow_id)
        return self._workflow_from_dict(w) if w else None

    def _select_workflow_for_amount(self, amount_cents: int) -> str:
        if amount_cents < SMALL_THRESHOLD:
            return SMALL_LOAN_SERIAL_ID
        if amount_cents >= BIG_THRESHOLD:
            return BIG_LOAN_PARALLEL_ID
        return DEFAULT_L3_ADVISORY_ID

    async def create_task(self, request: CreateApprovalRequest) -> ApprovalTask:
        wf = await _human_ai_store.get_workflow(request.workflow_rule_id)
        if not wf:
            raise ValueError(f"Workflow rule {request.workflow_rule_id} not found")

        now = _now_dt()
        deadline = now + timedelta(hours=request.deadline_hours)
        workflow = self._workflow_from_dict(wf)

        task_dict = {
            "task_id": _id("TASK"),
            "workflow_id": workflow.id,
            "execution_ref_id": request.execution_ref_id,
            "enterprise_id": request.enterprise_id,
            "title": request.title,
            "summary": request.summary,
            "amount_cents": request.amount_cents,
            "priority": _ev(request.priority),
            "deadline_iso": deadline.isoformat(),
            "current_step": 0,
            "status": ApprovalStatus.PENDING.value,
            "approvals": [],
            "required_approvals": [a.model_dump(mode="json", by_alias=True) for a in workflow.approvers],
            "escalation_role": workflow.escalation_role,
            "escalation_triggered": False,
            "created_at": _now_iso(),
        }
        await _human_ai_store.add_task(task_dict)
        return self._task_from_dict(task_dict)

    def _is_step_completed_serial(self, task_dict: dict, step: int) -> bool:
        approvals = task_dict.get("approvals", [])
        step_approvals = [a for a in approvals if a.get("step") == step]
        if not step_approvals:
            return False
        last = step_approvals[-1]
        return last.get("decision") == "approve"

    def _is_serial_fully_approved(self, task_dict: dict) -> bool:
        reqs = task_dict.get("required_approvals", [])
        for i in range(len(reqs)):
            if not self._is_step_completed_serial(task_dict, i):
                return False
        return True

    def _parallel_approved_count(self, task_dict: dict) -> int:
        reqs = task_dict.get("required_approvals", [])
        approvals = task_dict.get("approvals", [])
        count = 0
        for req in reqs:
            role = req.get("role")
            role_approvals = [a for a in approvals if a.get("approver_role") == role]
            if any(a.get("decision") == "approve" for a in role_approvals):
                count += 1
        return count

    def _is_parallel_fully_approved(self, task_dict: dict) -> bool:
        reqs = task_dict.get("required_approvals", [])
        return self._parallel_approved_count(task_dict) >= len(reqs)

    def _has_any_approval(self, task_dict: dict) -> bool:
        approvals = task_dict.get("approvals", [])
        return any(a.get("decision") == "approve" for a in approvals)

    def _has_any_rejection(self, task_dict: dict) -> bool:
        approvals = task_dict.get("approvals", [])
        return any(a.get("decision") == "reject" for a in approvals)

    async def approve(
        self,
        task_id: str,
        approver_id: str,
        approver_role: ApproverRole,
        decision: Literal["approve", "reject"],
        comment: str = "",
        delegated_from_role: ApproverRole | None = None,
        proxy: bool = False,
    ) -> ApprovalTask:
        task_dict = await _human_ai_store.get_task(task_id)
        if not task_dict:
            raise ValueError(f"Task {task_id} not found")

        wf = await _human_ai_store.get_workflow(task_dict["workflow_id"])
        if not wf:
            raise ValueError(f"Workflow {task_dict['workflow_id']} not found")
        workflow_type = wf.get("type", WorkflowType.SERIAL.value)

        current_step = task_dict.get("current_step", 0)

        now = _now_iso()
        record = {
            "task_id": task_id,
            "step": current_step,
            "approver_id": approver_id,
            "approver_role": approver_role,
            "decision": decision,
            "comment": comment,
            "decided_at": now,
            "delegated_from_role": delegated_from_role,
            "proxy_used": proxy,
        }
        task_dict["approvals"] = list(task_dict.get("approvals", [])) + [record]

        if decision == "reject":
            task_dict["status"] = ApprovalStatus.REJECTED.value
            await _human_ai_store.update_task(task_id, task_dict)
            return self._task_from_dict(task_dict)

        if workflow_type == WorkflowType.SERIAL.value:
            reqs = task_dict.get("required_approvals", [])
            if self._is_step_completed_serial(task_dict, current_step):
                if current_step + 1 < len(reqs):
                    task_dict["current_step"] = current_step + 1
                else:
                    task_dict["status"] = ApprovalStatus.APPROVED.value
                    task_dict["current_step"] = len(reqs)
        elif workflow_type == WorkflowType.PARALLEL.value:
            if self._is_parallel_fully_approved(task_dict):
                task_dict["status"] = ApprovalStatus.APPROVED.value
        elif workflow_type == WorkflowType.ANY_ONE.value:
            if self._has_any_approval(task_dict):
                task_dict["status"] = ApprovalStatus.APPROVED.value

        await _human_ai_store.update_task(task_id, task_dict)
        return self._task_from_dict(task_dict)

    async def escalate(self, task_id: str, reason: str = "") -> ApprovalTask:
        task_dict = await _human_ai_store.get_task(task_id)
        if not task_dict:
            raise ValueError(f"Task {task_id} not found")

        task_dict["status"] = ApprovalStatus.ESCALATED.value
        task_dict["escalation_triggered"] = True

        wf = await _human_ai_store.get_workflow(task_dict["workflow_id"])
        escalation_role = wf.get("escalationRole", "cfo") if wf else "cfo"
        now = _now_iso()
        record = {
            "task_id": task_id,
            "step": task_dict.get("current_step", 0),
            "approver_id": "SYSTEM-ESCALATION",
            "approver_role": escalation_role,
            "decision": "approve",
            "comment": f"系统自动升级: {reason}" if reason else "系统自动升级: 超时或人工触发",
            "decided_at": now,
            "delegated_from_role": None,
            "proxy_used": False,
        }
        task_dict["approvals"] = list(task_dict.get("approvals", [])) + [record]

        await _human_ai_store.update_task(task_id, task_dict)
        return self._task_from_dict(task_dict)

    async def delegate(
        self,
        task_id: str,
        from_role: ApproverRole,
        to_role: ApproverRole,
        approver_id: str,
    ) -> ApprovalTask:
        task_dict = await _human_ai_store.get_task(task_id)
        if not task_dict:
            raise ValueError(f"Task {task_id} not found")

        task_dict["status"] = ApprovalStatus.DELEGATED.value
        delegation = {
            "task_id": task_id,
            "from_role": from_role,
            "to_role": to_role,
            "approver_id": approver_id,
            "delegated_at": _now_iso(),
        }
        await _human_ai_store.add_delegation(task_id, delegation)

        reqs = task_dict.get("required_approvals", [])
        new_reqs = []
        for r in reqs:
            if r.get("role") == from_role:
                new_req = dict(r)
                new_req["role"] = to_role
                new_reqs.append(new_req)
            else:
                new_reqs.append(dict(r))
        task_dict["required_approvals"] = new_reqs
        task_dict["status"] = ApprovalStatus.PENDING.value

        await _human_ai_store.update_task(task_id, task_dict)
        return self._task_from_dict(task_dict)

    async def check_timeout_and_override(
        self, now_iso: str | None = None
    ) -> list[ApprovalTask]:
        now = _parse_iso(now_iso) if now_iso else _now_dt()
        all_tasks = await _human_ai_store.list_tasks()
        escalated: list[ApprovalTask] = []

        for t in all_tasks:
            status = t.get("status", "")
            if status not in (ApprovalStatus.PENDING.value,):
                continue
            if t.get("escalation_triggered", False):
                continue
            deadline = _parse_iso(t.get("deadline_iso", now.isoformat()))
            if now >= deadline:
                result = await self.escalate(t["task_id"], "24h 审批超时自动越权覆盖")
                t2 = await _human_ai_store.get_task(t["task_id"])
                if t2:
                    t2["status"] = ApprovalStatus.TIMEOUT_OVERRIDE.value
                    await _human_ai_store.update_task(t["task_id"], t2)
                    escalated.append(self._task_from_dict(t2))
                else:
                    escalated.append(result)

        return escalated

    async def get_task(self, task_id: str) -> ApprovalTask | None:
        t = await _human_ai_store.get_task(task_id)
        return self._task_from_dict(t) if t else None

    async def list_tasks(
        self,
        status: ApprovalStatus | None = None,
        approver_role: ApproverRole | None = None,
        enterprise_id: str | None = None,
    ) -> list[ApprovalTask]:
        status_str = _ev(status) if status else None
        items = await _human_ai_store.list_tasks(status_str, approver_role, enterprise_id)
        return [self._task_from_dict(t) for t in items]

    async def route_from_ai(
        self,
        autonomy_level: Literal["L1", "L2", "L3", "L4"],
        execution_ref_id: str,
        amount_cents: int,
        title: str,
        summary: str,
        enterprise_id: str,
    ) -> HumanRoutingDecision:
        needs_human = False
        reason_parts = []

        if autonomy_level in ("L3", "L4"):
            needs_human = True
            reason_parts.append(f"自治等级 {autonomy_level} 需人工审批")

        if autonomy_level == "L2" and amount_cents >= SMALL_THRESHOLD:
            needs_human = True
            reason_parts.append("L2 金额 >= 50万 需人工审批")

        if autonomy_level == "L4":
            needs_human = True
            reason_parts.append("L4 培育期全人工")

        if not needs_human:
            return HumanRoutingDecision(
                task_id=None,
                routed_to=AUTO_APPROVE_MARKER,
                reason=f"自治等级 {autonomy_level}, 金额 {amount_cents} 分 < 50万阈值, 自动放行",
                autonomy_level=autonomy_level,
                pending_steps=0,
                escalated=False,
            )

        wf_id = self._select_workflow_for_amount(amount_cents)
        if autonomy_level == "L3" or autonomy_level == "L4":
            wf_id = DEFAULT_L3_ADVISORY_ID

        priority = ApprovalPriority.URGENT if amount_cents >= BIG_THRESHOLD else (
            ApprovalPriority.HIGH if amount_cents >= SMALL_THRESHOLD else ApprovalPriority.MEDIUM
        )
        req = CreateApprovalRequest(
            title=title,
            summary=summary or f"AI {autonomy_level} 路由自动创建审批任务",
            amount_cents=amount_cents,
            priority=priority,
            enterprise_id=enterprise_id,
            execution_ref_id=execution_ref_id,
            workflow_rule_id=wf_id,
            deadline_hours=24,
        )
        task = await self.create_task(req)
        pending = len(task.required_approvals) - task.current_step

        return HumanRoutingDecision(
            task_id=task.task_id,
            routed_to=f"WORKFLOW:{wf_id}",
            reason="; ".join(reason_parts) or "需要人工审批",
            autonomy_level=autonomy_level,
            pending_steps=max(0, pending),
            escalated=False,
        )

    async def get_approval_chain(self, task_id: str) -> list[ApprovalRecord]:
        t = await _human_ai_store.get_task(task_id)
        if not t:
            return []
        approvals = t.get("approvals", [])
        sorted_approvals = sorted(
            approvals,
            key=lambda a: (a.get("step", 0), a.get("decided_at", "")),
        )
        return [ApprovalRecord.model_validate(a) for a in sorted_approvals]


human_ai_gateway_service = HumanAIGatewayService(db=None)
