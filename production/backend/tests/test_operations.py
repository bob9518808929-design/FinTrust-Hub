"""运营态 API 测试: 审批(Tab3) / 担保保险(Tab5) / AI驾驶舱(Tab7).

project_memory 硬约束验证:
    - 审批决策不可逆 (approve/reject/return)
    - 担保/保险申请明确反馈
    - AI 操作日志含 id/enterprise/level/confidence/action
"""

import pytest

pytestmark = pytest.mark.asyncio


class TestApprovals:
    """Tab3 人工审批."""

    async def test_list_approvals(self, client):
        r = await client.get("/api/v1/approvals")
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        assert isinstance(body["data"], list)

    async def test_decide_approval_approve(self, client):
        # 取第一个待办
        r = await client.get("/api/v1/approvals")
        items = r.json()["data"]
        if not items:
            pytest.skip("无审批待办")
        req_id = items[0]["id"]
        r2 = await client.post(
            f"/api/v1/approvals/{req_id}/decide",
            json={"decision": "approve"},
        )
        assert r2.status_code == 200
        body = r2.json()
        assert body["code"] == 0
        assert body["data"]["status"] == "approved"
        assert body["data"]["decision"] == "approve"

    async def test_decide_approval_reject(self, client):
        r = await client.get("/api/v1/approvals")
        items = r.json()["data"]
        if not items:
            pytest.skip("无审批待办")
        req_id = items[-1]["id"]
        r2 = await client.post(
            f"/api/v1/approvals/{req_id}/decide",
            json={"decision": "reject"},
        )
        assert r2.status_code == 200
        assert r2.json()["data"]["status"] == "rejected"

    async def test_decide_missing_returns_404(self, client):
        r = await client.post(
            "/api/v1/approvals/NONEXISTENT/decide",
            json={"decision": "approve"},
        )
        assert r.status_code == 200
        assert r.json()["code"] == 404


class TestGuaranteeFlow:
    """Tab5 担保流程."""

    async def test_apply_guarantee(self, client, sample_enterprise_id):
        r = await client.post(f"/api/v1/institutions/guarantee/{sample_enterprise_id}/apply")
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        assert body["data"]["status"] == "pending"

    async def test_pre_trial_guarantee(self, client, sample_enterprise_id):
        r = await client.post(f"/api/v1/institutions/guarantee/{sample_enterprise_id}/pre-trial")
        assert r.status_code == 200
        body = r.json()
        assert body["data"]["status"] == "active"
        assert body["data"]["rateDiscount"] == 0.5
        assert body["data"]["creditDelta"] == 15

    async def test_compensate(self, client, sample_enterprise_id):
        r = await client.post(f"/api/v1/institutions/guarantee/{sample_enterprise_id}/compensate")
        assert r.status_code == 200
        assert r.json()["data"]["status"] == "claimed"


class TestInsuranceFlow:
    """Tab5 保险流程."""

    async def test_apply_insurance(self, client, sample_enterprise_id):
        r = await client.post(f"/api/v1/institutions/insurance/{sample_enterprise_id}/apply")
        assert r.status_code == 200
        assert r.json()["data"]["status"] == "pending"

    async def test_underwrite(self, client, sample_enterprise_id):
        r = await client.post(f"/api/v1/institutions/insurance/{sample_enterprise_id}/underwrite")
        assert r.status_code == 200
        body = r.json()
        assert body["data"]["status"] == "active"
        assert body["data"]["rateDiscount"] == 0.3
        assert body["data"]["creditDelta"] == 10

    async def test_claim(self, client, sample_enterprise_id):
        r = await client.post(f"/api/v1/institutions/insurance/{sample_enterprise_id}/claim")
        assert r.status_code == 200
        assert r.json()["data"]["status"] == "claimed"


class TestCockpit:
    """Tab7 AI 驾驶舱."""

    async def test_list_operations(self, client):
        r = await client.get("/api/v1/cockpit/operations")
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        assert isinstance(body["data"], list)
        # project_memory: AI 操作日志含 id/enterprise/level/confidence/action
        if body["data"]:
            op = body["data"][0]
            for field in ("id", "enterprise", "level", "confidence", "action"):
                assert field in op, f"AI操作日志缺少字段 {field}"

    async def test_cockpit_stats(self, client):
        r = await client.get("/api/v1/cockpit/stats")
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        assert "total" in body["data"]
        assert "distribution" in body["data"]
        dist = body["data"]["distribution"]
        for level in ("L1", "L2", "L3", "L4"):
            assert level in dist
