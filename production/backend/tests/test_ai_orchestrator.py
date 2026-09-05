"""CORE-01 AI 自主操作编排引擎测试 (R1.4).

覆盖 5 个关键测试:
    test_register_and_list_3_dags                  种子 DAG 3 个
    test_l4_suggest_only_returns_recommendation_wo_execution L4 仅建议
    test_l1_full_auto_runs_complete_dag            L1 全自动跑完整 DAG
    test_l3_requires_human_approval_pauses         L3 每步人工 + approve 推进
    test_decision_logs_contain_evidence            SCORE/DECISION 节点证据 ID
"""

import pytest

from app.api.v1.core.ai_orchestrator import ai_orch_router
from app.main import app

_ORCH_ROUTE_REGISTERED = False
for _r in app.routes:
    _path = getattr(_r, "path", "")
    if _path.startswith("/api/v1/core/ai-orchestrator"):
        _ORCH_ROUTE_REGISTERED = True
        break
if not _ORCH_ROUTE_REGISTERED:
    app.include_router(ai_orch_router, prefix="/api/v1")


pytestmark = pytest.mark.asyncio


SEED_DAG_IDS = {"SCF-QUICK-APPROVAL", "CREDIT-REPORT-L4", "RIGOROUS-APPROVAL-L3"}


# =====================================================================
# 1. 种子 DAG 列表测试
# =====================================================================

class TestRegisterAndListDAGs:
    """test_register_and_list_3_dags: 验证内置 3 个种子 DAG."""

    async def test_list_dags_returns_3_seed(self, client):
        r = await client.get("/api/v1/core/ai-orchestrator/dags")
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        dags = body["data"]
        assert isinstance(dags, list)
        assert len(dags) >= 3
        dag_ids = {d["dagId"] for d in dags}
        assert SEED_DAG_IDS <= dag_ids

    async def test_dag_fields_camel_case_alias(self, client):
        """验证 camelCase 字段别名."""
        r = await client.get("/api/v1/core/ai-orchestrator/dags")
        dags = r.json()["data"]
        scf = next(d for d in dags if d["dagId"] == "SCF-QUICK-APPROVAL")
        assert "name" in scf
        assert "dagId" in scf
        assert "autonomyLevel" in scf
        assert "nodes" in scf
        assert isinstance(scf["nodes"], list)
        assert "edges" in scf
        first_node = scf["nodes"][0]
        assert "nodeId" in first_node
        assert "taskType" in first_node

    async def test_get_single_dag(self, client):
        r = await client.get("/api/v1/core/ai-orchestrator/dags/CREDIT-REPORT-L4")
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        assert body["data"]["dagId"] == "CREDIT-REPORT-L4"
        assert body["data"]["autonomyLevel"] == "L4_SUGGEST_ONLY"

    async def test_get_dag_not_found(self, client):
        r = await client.get("/api/v1/core/ai-orchestrator/dags/NONEXISTENT-XXX")
        body = r.json()
        assert body["code"] == 404
        assert body["data"] is None

    async def test_register_new_dag(self, client):
        payload = {
            "name": "自定义测试 DAG",
            "dagId": "TEST-CUSTOM-L1",
            "description": "L1 自定义 DAG",
            "nodes": [
                {"nodeId": "t1", "taskType": "FETCH_DATA", "params": {}, "dependsOn": None},
                {"nodeId": "t2", "taskType": "NOTIFY", "params": {}, "dependsOn": ["t1"]},
            ],
            "edges": [{"fromNode": "t1", "toNode": "t2", "condition": "on_success"}],
            "autonomyLevel": "L1_FULL_AUTO",
            "createdBy": "test",
            "timeoutSeconds": 600,
        }
        r = await client.post("/api/v1/core/ai-orchestrator/dags", json=payload)
        assert r.status_code == 201
        body = r.json()
        assert body["code"] == 0
        assert body["data"]["dagId"] == "TEST-CUSTOM-L1"
        assert body["data"]["autonomyLevel"] == "L1_FULL_AUTO"


# =====================================================================
# 2. L4 仅建议测试
# =====================================================================

class TestL4SuggestOnly:
    """test_l4_suggest_only_returns_recommendation_wo_execution."""

    async def test_l4_all_nodes_skipped(self, client):
        """L4 所有节点 status=SKIPPED, 返回 recommendation_summary."""
        payload = {
            "dagId": "CREDIT-REPORT-L4",
            "enterpriseId": "E-L4-001",
            "context": {"amount_cents": 20_000_000},
        }
        r = await client.post("/api/v1/core/ai-orchestrator/executions", json=payload)
        assert r.status_code == 201
        body = r.json()
        assert body["code"] == 0
        exec_data = body["data"]
        assert exec_data["status"] == "COMPLETED"
        assert exec_data["dagId"] == "CREDIT-REPORT-L4"

        results = exec_data["resultsByNode"]
        assert len(results) >= 2
        for node_id, res in results.items():
            assert res["status"] == "SKIPPED", f"节点 {node_id} 应为 SKIPPED"
            assert res["endedAt"] is not None

        summary = exec_data["recommendationSummary"]
        assert summary is not None
        assert "mode" in summary
        assert summary["mode"] == "L4_SUGGEST_ONLY"
        assert "finalDecision" in summary
        fd = summary["finalDecision"]
        assert isinstance(fd, dict)
        assert "decision" in fd or "score" in fd

    async def test_l4_execution_id_persists(self, client):
        payload = {
            "dagId": "CREDIT-REPORT-L4",
            "enterpriseId": "E-L4-002",
            "context": {},
        }
        r = await client.post("/api/v1/core/ai-orchestrator/executions", json=payload)
        exec_id = r.json()["data"]["id"]

        r2 = await client.get(f"/api/v1/core/ai-orchestrator/executions/{exec_id}")
        assert r2.status_code == 200
        got = r2.json()["data"]
        assert got["id"] == exec_id
        assert got["status"] == "COMPLETED"


# =====================================================================
# 3. L1 全自动测试 (注册临时 L1 版 SCF DAG)
# =====================================================================

class TestL1FullAuto:
    """test_l1_full_auto_runs_complete_dag: L1 完整 DAG 全部 SUCCESS."""

    L1_DAG_ID = "SCF-QUICK-APPROVAL-L1-TEST"

    @pytest.fixture(autouse=True)
    async def _register_l1_dag(self, client):
        """注册一个 L1 版本 SCF DAG (复用 L2 节点结构)."""
        payload = {
            "name": "SCF 快速审批 L1 版",
            "dagId": self.L1_DAG_ID,
            "description": "L1 全自动, 不暂停",
            "nodes": [
                {"nodeId": "l1_fetch", "taskType": "FETCH_DATA", "params": {"sources": ["bank"]}, "dependsOn": None},
                {"nodeId": "l1_ocr", "taskType": "OCR", "params": {"doc_types": ["invoice"]}, "dependsOn": ["l1_fetch"]},
                {"nodeId": "l1_verify", "taskType": "VERIFY", "params": {"verify_invoice": True}, "dependsOn": ["l1_ocr"]},
                {"nodeId": "l1_score", "taskType": "SCORE", "params": {"scorecard": "test_l1"}, "dependsOn": ["l1_verify"]},
                {"nodeId": "l1_decision", "taskType": "DECISION", "params": {"policy": "auto"}, "dependsOn": ["l1_score"]},
                {"nodeId": "l1_notify", "taskType": "NOTIFY", "params": {}, "dependsOn": ["l1_decision"]},
            ],
            "edges": [],
            "autonomyLevel": "L1_FULL_AUTO",
            "createdBy": "test",
            "timeoutSeconds": 600,
        }
        await client.post("/api/v1/core/ai-orchestrator/dags", json=payload)

    async def test_l1_runs_complete(self, client):
        payload = {
            "dagId": self.L1_DAG_ID,
            "enterpriseId": "E-L1-001",
            "context": {"amount_cents": 5_000_000},
        }
        r = await client.post("/api/v1/core/ai-orchestrator/executions", json=payload)
        assert r.status_code == 201
        body = r.json()
        assert body["code"] == 0
        exec_data = body["data"]
        assert exec_data["status"] == "COMPLETED", f"应为 COMPLETED, 实际 {exec_data['status']}"
        assert exec_data["endAt"] is not None
        assert exec_data["waitingNodeId"] is None

        results = exec_data["resultsByNode"]
        assert len(results) == 6
        for nid, res in results.items():
            assert res["status"] == "SUCCESS", f"节点 {nid} 状态 {res['status']}, 错误: {res.get('error')}"
            assert res["endedAt"] is not None

        l1_dec = results["l1_decision"]["output"]
        assert "decision" in l1_dec
        assert l1_dec["decision"] in ("approve", "review", "reject")

    async def test_l1_list_executions_filter(self, client):
        """按 dagId / enterpriseId 筛选执行列表."""
        payload = {
            "dagId": self.L1_DAG_ID,
            "enterpriseId": "E-L1-FILTER",
            "context": {},
        }
        await client.post("/api/v1/core/ai-orchestrator/executions", json=payload)

        r = await client.get(
            f"/api/v1/core/ai-orchestrator/executions?dagId={self.L1_DAG_ID}"
            f"&enterpriseId=E-L1-FILTER&status=COMPLETED"
        )
        assert r.status_code == 200
        items = r.json()["data"]
        assert len(items) >= 1
        for it in items:
            assert it["dagId"] == self.L1_DAG_ID
            assert it["enterpriseId"] == "E-L1-FILTER"
            assert it["status"] == "COMPLETED"


# =====================================================================
# 4. L3 每步人工确认测试
# =====================================================================

class TestL3HumanApproval:
    """test_l3_requires_human_approval_pauses: L3 WAITING_HUMAN + approve 推进."""

    async def test_l3_returns_waiting_human_on_first_node(self, client):
        """L3 第一步 (FETCH_DATA) 就应挂 WAITING_HUMAN."""
        payload = {
            "dagId": "RIGOROUS-APPROVAL-L3",
            "enterpriseId": "E-L3-001",
            "context": {"amount_cents": 80_000_000},
        }
        r = await client.post("/api/v1/core/ai-orchestrator/executions", json=payload)
        assert r.status_code == 201
        body = r.json()
        assert body["code"] == 0
        exec_data = body["data"]
        assert exec_data["status"] == "WAITING_HUMAN"
        waiting = exec_data["waitingNodeId"]
        assert waiting is not None
        assert waiting.startswith("r1_") or waiting in {"r1_fetch", "r2_ocr", "r3_verify"}
        return exec_data["id"], waiting

    async def test_approve_advances_execution(self, client):
        """approve_node 推进 WAITING_HUMAN 节点."""
        exec_id, wait_node = await self.test_l3_returns_waiting_human_on_first_node(client)

        approve_payload = {
            "humanDecisionOverride": {"decision": "approve", "note": "人工确认通过"},
            "operator": "tester@bank.com",
        }
        r = await client.post(
            f"/api/v1/core/ai-orchestrator/executions/{exec_id}/nodes/{wait_node}/approve",
            json=approve_payload,
        )
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        tr = body["data"]
        assert tr["nodeId"] == wait_node
        assert tr["humanDecision"] in ("approve", "reject") or tr["status"] == "HUMAN_REVIEWED"

        # 检查执行实例推进 (下一个节点应为 WAITING_HUMAN 或 COMPLETED)
        r2 = await client.get(f"/api/v1/core/ai-orchestrator/executions/{exec_id}")
        exec2 = r2.json()["data"]
        assert exec2["status"] in ("WAITING_HUMAN", "COMPLETED")
        prev_result = exec2["resultsByNode"].get(wait_node)
        assert prev_result is not None
        assert prev_result["status"] == "HUMAN_REVIEWED"


# =====================================================================
# 5. 决策日志证据测试
# =====================================================================

class TestDecisionLogsEvidence:
    """test_decision_logs_contain_evidence: SCORE/DECISION 节点有证据 ID."""

    async def test_decision_logs_have_evidence_ids(self, client):
        """执行 L4 DAG 后, 决策日志中 SCORE/DECISION 节点应含证据 IDs."""
        exec_payload = {
            "dagId": "CREDIT-REPORT-L4",
            "enterpriseId": "E-EVIDENCE-001",
            "context": {"amount_cents": 15_000_000},
        }
        r = await client.post("/api/v1/core/ai-orchestrator/executions", json=exec_payload)
        exec_id = r.json()["data"]["id"]

        logs_resp = await client.get(
            f"/api/v1/core/ai-orchestrator/decision-logs?executionId={exec_id}"
        )
        assert logs_resp.status_code == 200
        body = logs_resp.json()
        assert body["code"] == 0
        logs = body["data"]
        assert isinstance(logs, list)
        assert len(logs) >= 2, "L4 至少 SCORE + DECISION 两条决策日志"

        found_score = False
        found_decision = False
        for log in logs:
            assert "logId" in log
            assert "dagExecutionId" in log
            assert "nodeId" in log
            assert "autonomyLevel" in log
            assert "aiRecommendation" in log
            assert "evidenceIds" in log
            assert isinstance(log["evidenceIds"], list)
            assert len(log["evidenceIds"]) >= 1, "决策日志证据 IDs 不能为空"
            assert 0.0 <= log["aiConfidence"] <= 1.0
            assert "finalDecision" in log
            nid = log["nodeId"]
            if "score" in nid.lower() or nid.startswith("c1_"):
                found_score = True
                for eid in log["evidenceIds"]:
                    assert eid, "证据 ID 非空字符串"
            if "decision" in nid.lower() or nid.startswith("c2_"):
                found_decision = True
                for eid in log["evidenceIds"]:
                    assert eid.startswith("DEC-") or len(eid) > 3

        assert found_score, "SCORE 节点的决策日志未找到"
        assert found_decision, "DECISION 节点的决策日志未找到"

    async def test_decision_logs_filter_by_enterprise(self, client):
        """按 enterpriseId 筛选决策日志."""
        ent_id = "E-EVIDENCE-FILTER"
        ep = {
            "dagId": "CREDIT-REPORT-L4",
            "enterpriseId": ent_id,
            "context": {},
        }
        await client.post("/api/v1/core/ai-orchestrator/executions", json=ep)

        r = await client.get(
            f"/api/v1/core/ai-orchestrator/decision-logs?enterpriseId={ent_id}&limit=50"
        )
        logs = r.json()["data"]
        assert len(logs) >= 2
        for l in logs:
            assert l["enterpriseId"] == ent_id
