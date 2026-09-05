"""R4.6 / R4.7 HTTP 端点集成测试 (通过 ASGI client).

验证:
    - POST /modules/five-flow/check
    - POST /modules/five-flow/batch-check
    - GET  /modules/five-flow/records/{eid}/{tx_id}
    - GET  /modules/five-flow/monitor/rules
    - POST /modules/five-flow/monitor/rules
    - GET  /modules/five-flow/monitor/alerts
    - POST /modules/five-flow/monitor/alerts/{id}/acknowledge
    - POST /modules/five-flow/locks
    - POST /modules/five-flow/locks/{id}/release
    - GET  /modules/five-flow/locks

    - GET    /modules/risk-rule/rules
    - POST   /modules/risk-rule/rules
    - PUT    /modules/risk-rule/rules/{id}
    - DELETE /modules/risk-rule/rules/{id}
    - POST   /modules/risk-rule/rules/{id}/enable
    - GET    /modules/risk-rule/rulesets
    - POST   /modules/risk-rule/rulesets/{id}/hot-reload
    - POST   /modules/risk-rule/evaluate
    - GET    /modules/risk-rule/stream/events
    - POST   /modules/risk-rule/stream/ingest
    - GET    /modules/risk-rule/stream/stats
"""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.asyncio


class TestR46FiveFlowHTTP:
    async def test_check_endpoint(self, client):
        r = await client.post(
            "/api/v1/modules/five-flow/check",
            json={"enterpriseId": "E001", "txId": "TX-2026-0001"},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        data = body["data"]
        assert data["txId"] == "TX-2026-0001"
        assert data["consistencyScore"] == 100
        assert data["passed"] is True

    async def test_batch_check_endpoint(self, client):
        r = await client.post(
            "/api/v1/modules/five-flow/batch-check",
            json={"enterpriseId": "E001", "txIds": ["TX-2026-0001"]},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        assert isinstance(body["data"], list)
        assert len(body["data"]) == 1
        assert body["data"][0]["consistencyScore"] == 100

    async def test_records_endpoint(self, client):
        r = await client.get(
            "/api/v1/modules/five-flow/records/E001/TX-2026-0001",
        )
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        assert len(body["data"]) == 6

    async def test_monitor_rules_list(self, client):
        r = await client.get("/api/v1/modules/five-flow/monitor/rules")
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        # seed 8 条规则
        assert len(body["data"]) >= 8

    async def test_monitor_alerts_list(self, client):
        r = await client.get("/api/v1/modules/five-flow/monitor/alerts")
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        # seed 5 条告警
        assert len(body["data"]) >= 5

    async def test_locks_flow(self, client):
        # 锁定
        r = await client.post(
            "/api/v1/modules/five-flow/locks",
            json={
                "enterpriseId": "E001",
                "accountId": "ACC-HTTP-001",
                "amountCents": 200_000_000,
                "reason": "HTTP 测试锁定",
                "durationHours": 24,
            },
        )
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        lock_id = body["data"]["lockId"]
        assert body["data"]["status"] == "locked"

        # 列出锁定
        r2 = await client.get(
            "/api/v1/modules/five-flow/locks",
            params={"enterpriseId": "E001", "status": "locked"},
        )
        assert r2.status_code == 200
        assert r2.json()["code"] == 0
        locks = r2.json()["data"]
        assert any(l["lockId"] == lock_id for l in locks)

        # 释放
        r3 = await client.post(f"/api/v1/modules/five-flow/locks/{lock_id}/release")
        assert r3.status_code == 200
        assert r3.json()["data"]["status"] == "released"


class TestR47RiskRuleHTTP:
    async def test_rules_list(self, client):
        r = await client.get("/api/v1/modules/risk-rule/rules")
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        # seed 10 条规则
        assert len(body["data"]) >= 10

    async def test_rulesets_list(self, client):
        r = await client.get("/api/v1/modules/risk-rule/rulesets")
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        assert len(body["data"]) >= 2  # 标准 + 严格

    async def test_evaluate_endpoint(self, client):
        r = await client.post(
            "/api/v1/modules/risk-rule/evaluate",
            json={
                "txData": {
                    "enterprise_id": "E001",
                    "tx_id": "TX-HTTP-001",
                    "amount": 6_000_000,
                    "counterparty": "正常公司",
                    "is_cross_border": False,
                    "hour": 10,
                },
            },
        )
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        assert body["data"]["action"] == "block"

    async def test_stream_stats_endpoint(self, client):
        r = await client.get("/api/v1/modules/risk-rule/stream/stats")
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        assert body["data"]["totalEvents"] >= 20
        assert body["data"]["blockCount"] >= 5

    async def test_stream_ingest_endpoint(self, client):
        r = await client.post(
            "/api/v1/modules/risk-rule/stream/ingest",
            json={
                "enterpriseId": "E001",
                "txId": "TX-HTTP-STREAM-001",
                "eventType": "tx",
                "payload": {
                    "amount": 6_000_000,
                    "counterparty": "正常公司",
                    "hour": 10,
                },
            },
        )
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        assert body["data"]["action"] == "block"
        assert body["data"]["enterpriseId"] == "E001"

    async def test_hot_reload_endpoint(self, client):
        r = await client.post(
            "/api/v1/modules/risk-rule/rulesets/RS-STD-001/hot-reload",
        )
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        assert body["data"]["rulesetId"] == "RS-STD-001"

    async def test_rules_crud_flow(self, client):
        # 新增
        r = await client.post(
            "/api/v1/modules/risk-rule/rules",
            json={
                "ruleName": "HTTP 测试规则",
                "description": "amount > 100 → flag",
                "conditions": [
                    {"fieldPath": "amount", "operator": "GT", "value": 100},
                ],
                "logic": "ALL",
                "action": "flag",
                "riskScoreDelta": 5,
                "priority": 99,
                "enabled": True,
            },
        )
        assert r.status_code == 200
        rule_id = r.json()["data"]["ruleId"]

        # 禁用
        r2 = await client.post(f"/api/v1/modules/risk-rule/rules/{rule_id}/disable")
        assert r2.status_code == 200
        assert r2.json()["data"]["enabled"] is False

        # 启用
        r3 = await client.post(f"/api/v1/modules/risk-rule/rules/{rule_id}/enable")
        assert r3.status_code == 200
        assert r3.json()["data"]["enabled"] is True

        # 删除
        r4 = await client.delete(f"/api/v1/modules/risk-rule/rules/{rule_id}")
        assert r4.status_code == 200
        assert r4.json()["data"]["deleted"] is True
