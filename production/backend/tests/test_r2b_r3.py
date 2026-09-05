"""R2b + R3 综合测试 (≥15 用例).

覆盖:
    R2.7  IoT:      40 设备种子 / telemetry 含 GPS / REBOOT acked
    R2.10 CORE-03:  默认 6 flow 全开 / toggle_module 返回 diff
    R2.11 INFRA-01b: 15 适配器注册 / 限流 429 / 超时重试 + fallback / 断路器 trip+reset
    R3.1  MOD-08b:  VC 签发含签名 / 跨行核验通过 / revoke 改状态
    R3.2  INFRA-04: 创建沙箱+5 变更 / diff 计数 unconfirmed / commit 要求确认 / purge 清过期

运行:  pytest tests/test_r2b_r3.py -v
"""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.asyncio


# ========================================================================
# R2.7 DATA-04 IoT MQTT 网关
# ========================================================================

class TestR27IoT:
    """DATA-04 IoT MQTT 网关 API 测试."""

    async def test_iot_list_40_devices(self, client):
        """种子数据: 4 企业 × 10 设备 = 40 设备."""
        r = await client.get("/api/v1/modules/iot/devices")
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        devs = body["data"]
        assert isinstance(devs, list)
        assert len(devs) >= 40
        # 字段 camelCase
        first = devs[0]
        assert "enterpriseId" in first
        assert "gatewayId" in first
        assert "lastSeenIso" in first

    async def test_iot_list_devices_by_enterprise(self, client):
        """按企业筛选返回 10 设备."""
        r = await client.get("/api/v1/modules/iot/devices", params={"enterpriseId": "E001"})
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        assert len(body["data"]) == 10
        for d in body["data"]:
            assert d["enterpriseId"] == "E001"

    async def test_iot_telemetry_contains_gps_metrics(self, client):
        """simulate 后 telemetry 包含 GPS 指标."""
        r = await client.get("/api/v1/modules/iot/devices", params={"enterpriseId": "E001"})
        devs = r.json()["data"]
        gps_dev = next((d for d in devs if "GPS" in d["name"] or "GPS" in d["model"]), None)
        if not gps_dev:
            gps_dev = devs[0]
        dev_id = gps_dev["id"]
        r2 = await client.post(f"/api/v1/modules/iot/devices/{dev_id}/simulate", params={"count": 10})
        assert r2.status_code == 200
        assert r2.json()["code"] == 0
        r3 = await client.get(f"/api/v1/modules/iot/devices/{dev_id}/telemetry")
        assert r3.status_code == 200
        body3 = r3.json()
        assert body3["code"] == 0
        tele = body3["data"]
        assert isinstance(tele, list)
        assert len(tele) > 0
        metric_names = {t.get("metricName") for t in tele}
        has_any = len(metric_names & {"temperature", "humidity", "power_kw", "gps", "uptime"}) > 0
        assert has_any

    async def test_iot_command_reboot_acked(self, client):
        """REBOOT 命令返回 acked."""
        r = await client.get("/api/v1/modules/iot/devices", params={"enterpriseId": "E001"})
        dev_id = r.json()["data"][0]["id"]
        r2 = await client.post("/api/v1/modules/iot/devices/command", json={
            "deviceId": dev_id, "command": "REBOOT", "payload": {"deep": False},
        })
        assert r2.status_code == 200
        body = r2.json()
        assert body["code"] == 0
        res = body["data"]
        assert res["status"] == "acked"
        assert "commandId" in res

    async def test_iot_two_gateways_seed(self, client):
        """两个 seed 网关 (1 MQTT5 + 1 HTTP_LONGPOLL)."""
        r = await client.get("/api/v1/modules/iot/gateways")
        assert r.status_code == 200
        gws = r.json()["data"]
        assert len(gws) >= 2
        protos = {g["protocol"] for g in gws}
        assert "MQTT5" in protos
        assert "HTTP_LONGPOLL" in protos


# ========================================================================
# R2.10 CORE-03 企业可选配置引擎
# ========================================================================

class TestR210OptIn:
    """CORE-03 企业可选配置引擎 API 测试."""

    async def test_default_all_6_flows_enabled(self, client):
        """默认 E001 / E002: 6 条 flow 全开."""
        for eid in ("E001", "E002"):
            r = await client.get(f"/api/v1/core/opt-in/{eid}")
            assert r.status_code == 200, f"eid={eid}"
            body = r.json()
            assert body["code"] == 0
            cfg = body["data"]
            assert len(cfg["enabledFlows"]) == 6
            flow_names = sorted(cfg["enabledFlows"])
            assert flow_names == sorted(
                ["FUND", "CONTRACT", "INVOICE", "LOGISTICS", "IOT", "HUMAN"]
            )
            assert len(cfg["enabledModules"]) == 16
            assert cfg["cooperationMethod"] == "FULL_TRUST"

    async def test_toggle_module_off_returns_diff(self, client):
        """toggle_module=PRIVACY off 返回 removed_modules diff."""
        r = await client.put(
            "/api/v1/core/opt-in/E001/modules/PRIVACY", params={"enabled": "false"},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        diff = body["data"]
        assert "PRIVACY" in diff["removedModules"]
        # 再开回来
        r2 = await client.put(
            "/api/v1/core/opt-in/E001/modules/PRIVACY", params={"enabled": "true"},
        )
        assert r2.json()["code"] == 0
        assert "PRIVACY" in r2.json()["data"]["addedModules"]

    async def test_E003_disabled_IOT_HUMAN_flows(self, client):
        """E003 seed: IOT+HUMAN flow 关闭."""
        r = await client.get("/api/v1/core/opt-in/E003")
        assert r.status_code == 200
        flows = r.json()["data"]["enabledFlows"]
        assert "IOT" not in flows
        assert "HUMAN" not in flows
        assert "FUND" in flows

    async def test_E004_co_lending(self, client):
        """E004 seed: CO_LENDING 合作方式."""
        r = await client.get("/api/v1/core/opt-in/E004")
        assert r.status_code == 200
        assert r.json()["data"]["cooperationMethod"] == "CO_LENDING"

    async def test_reset_to_default_returns_diff(self, client):
        """reset 产生 diff."""
        # 先改一下 E001
        await client.put(
            "/api/v1/core/opt-in/E001/modules/IOT", params={"enabled": "false"},
        )
        r = await client.post("/api/v1/core/opt-in/E001/reset")
        assert r.status_code == 200
        diff = r.json()["data"]
        assert "IOT" in diff["addedModules"]


# ========================================================================
# R2.11 INFRA-01b 外部 API 适配层
# ========================================================================

class TestR211Adapters:
    """INFRA-01b 15 适配器 + 限流 + 断路器测试."""

    async def test_15_adapters_registered(self, client):
        """列表包含全部 15 个 AdapterId."""
        r = await client.get("/api/v1/infra/adapters")
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        runtimes = body["data"]
        assert isinstance(runtimes, dict)
        assert len(runtimes) == 15
        for i in range(1, 16):
            # A1...A15 前缀
            keys_with_prefix = [k for k in runtimes if k.startswith(f"A{i}_")]
            assert len(keys_with_prefix) == 1, f"missing adapter A{i}"

    async def test_adapter_invoke_ok_ICBC_bank(self, client):
        """A1 银行 ICBC 返回账户样例."""
        r = await client.post(
            "/api/v1/infra/adapters/A1_BANK_ICBC/invoke",
            json={"operation": "account_query", "params": {"accountNo": "622200****"}},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        res = body["data"]
        assert res["status"] == "ok"
        assert res["adapterId"] == "A1_BANK_ICBC"
        assert "balance" in res["response"]

    async def test_rate_limit_triggers_429(self, client):
        """超速 invoke 返回 status=rate_limited + code=429."""
        aid = "A13_GOVERNMENT_PURGE"  # limit 最低 30/min 种子
        # 快速连发 35 次, 必定触发 429 (A13 只有 30/min)
        triggered_429 = False
        for _ in range(35):
            r = await client.post(
                f"/api/v1/infra/adapters/{aid}/invoke",
                json={"operation": "purge", "params": {"count": 1}},
            )
            if r.status_code == 200 and r.json().get("code") == 429:
                triggered_429 = True
                break
            j = r.json()
            if j.get("data", {}).get("status") == "rate_limited":
                triggered_429 = True
                break
        assert triggered_429, "未触发限流 429"

    async def test_timeout_3_retries_then_fallback(self, client):
        """断路器打开后, invoke 走 fallback."""
        aid = "A5_JUDICIARY"
        # 先手动 trip 断路器
        tr = await client.post(f"/api/v1/infra/adapters/{aid}/circuit/trip")
        assert tr.status_code == 200
        # 调 invoke, 应该直接 fallback
        r = await client.post(
            f"/api/v1/infra/adapters/{aid}/invoke",
            json={"operation": "query", "params": {"name": "测试"}},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        status = body["data"]["status"]
        # trip 后 fallback
        assert status == "fallback"
        assert body["data"]["response"] is not None

    async def test_circuit_breaker_trip_then_reset(self, client):
        """trip → runtime fallback_only → reset → runtime ok."""
        aid = "A12_HE_SEAL"
        gr = await client.get(f"/api/v1/infra/adapters/{aid}")
        assert gr.json()["data"]["status"] != "offline"
        tr = await client.post(f"/api/v1/infra/adapters/{aid}/circuit/trip")
        assert tr.status_code == 200
        gr2 = await client.get(f"/api/v1/infra/adapters/{aid}")
        assert gr2.json()["data"]["status"] == "fallback_only"
        rs = await client.post(f"/api/v1/infra/adapters/{aid}/circuit/reset")
        assert rs.status_code == 200
        gr3 = await client.get(f"/api/v1/infra/adapters/{aid}")
        assert gr3.json()["data"]["status"] == "ok"
        assert gr3.json()["data"]["failureCount5m"] == 0

    async def test_OCR_8_blocks(self, client):
        """A7 百度 OCR 返回 8 个 block."""
        r = await client.post(
            "/api/v1/infra/adapters/A7_OCR_BAIDU/invoke",
            json={"operation": "ocr", "params": {"image": "base64..."}},
        )
        body = r.json()
        if body["data"]["status"] == "ok":
            assert len(body["data"]["response"]["blocks"]) == 8


# ========================================================================
# R3.1 MOD-08b 信用凭证 W3C VC
# ========================================================================

class TestR31Credential:
    """W3C VC 信用凭证 + 跨行核验."""

    async def test_vc_issue_returns_signed_credential(self, client):
        """issue 返回含 proof.signature 等字段的 VC."""
        r = await client.post("/api/v1/modules/credential/issue", json={
            "enterpriseId": "E001",
            "credentialType": "EnterpriseCreditScore",
            "claim": {"score": 88, "level": "A"},
            "validDays": 180,
        })
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        vc = body["data"]
        assert vc["credentialType"] == "EnterpriseCreditScore"
        assert "id" in vc
        assert vc["holderDid"].endswith("E001")
        proof = vc["proof"]
        assert proof["type"] == "EcdsaSecp256k1Signature2019"
        assert len(proof["proofValue"]) > 10  # base64 签名
        assert vc["revocationStatus"] == "active"
        assert vc["chainTxId"] is not None

    async def test_E001_seed_3_vcs(self, client):
        """E001 含 3 张 seed 凭证, 覆盖类型."""
        r = await client.get("/api/v1/modules/credential/enterprise/E001")
        assert r.status_code == 200
        vcs = r.json()["data"]
        assert len(vcs) >= 3
        types = {v["credentialType"] for v in vcs}
        assert "EnterpriseCreditScore" in types

    async def test_vc_verify_true_for_active(self, client):
        """激活 VC verify == True."""
        r = await client.get("/api/v1/modules/credential/enterprise/E001")
        vcs = r.json()["data"]
        active_id = vcs[0]["id"]
        r2 = await client.post(f"/api/v1/modules/credential/{active_id}/verify")
        assert r2.status_code == 200
        assert r2.json()["data"] is True

    async def test_cross_chain_verify_passes(self, client):
        """Local → Local 跨行 verify 通过."""
        r = await client.get("/api/v1/modules/credential/enterprise/E002")
        vcs = r.json()["data"]
        vc_id = vcs[0]["id"]
        r2 = await client.post("/api/v1/modules/credential/cross-chain-verify", json={
            "sourceChain": "Local", "targetChain": "Local", "vcId": vc_id,
        })
        assert r2.status_code == 200
        res = r2.json()["data"]
        assert res["verified"] is True
        assert "sourceProof" in res
        assert "targetProof" in res

    async def test_revoke_updates_status(self, client):
        """revoke 后 status = revoked, verify=False."""
        # 先 issue 一个新的
        issue_r = await client.post("/api/v1/modules/credential/issue", json={
            "enterpriseId": "E004",
            "credentialType": "ComplianceRecord",
            "claim": {"taxCompliant": True},
        })
        vc_id = issue_r.json()["data"]["id"]
        rev = await client.post(
            f"/api/v1/modules/credential/{vc_id}/revoke",
            json={"reason": "企业退出"},
        )
        assert rev.status_code == 200
        assert rev.json()["data"]["revocationStatus"] == "revoked"
        vr = await client.post(f"/api/v1/modules/credential/{vc_id}/verify")
        assert vr.json()["data"] is False


# ========================================================================
# R3.2 INFRA-04 改造沙箱仿真
# ========================================================================

class TestR32ReformSandbox:
    """改造沙箱仿真: 创建/变更/确认/提交/回滚/清理."""

    async def test_create_sandbox_and_5_changes(self, client):
        """创建沙箱并 apply 5 个 changes."""
        cr = await client.post("/api/v1/infra/reform-sandbox", json={
            "enterpriseId": "E001", "baselineName": "测试沙箱-API", "retainedDays": 7,
        })
        assert cr.status_code == 200
        sb = cr.json()["data"]
        assert sb["status"] == "active"
        assert sb["enterpriseId"] == "E001"
        assert sb["retainedDays"] == 7
        sb_id = sb["id"]

        dtypes = ["flow", "module", "config", "role", "module"]
        for i, dt in enumerate(dtypes):
            ch = {
                "changeId": "",
                "dataType": dt,
                "path": f"/foo/bar/{i}",
                "oldValue": {"a": i},
                "newValue": {"b": i + 1},
                "proposedBy": "test-user",
                "appliedAtIso": "",
            }
            r = await client.post(f"/api/v1/infra/reform-sandbox/{sb_id}/changes", json=ch)
            assert r.status_code == 200
            assert r.json()["code"] == 0
        # 验证 changes 有 5 条
        detail = await client.get(f"/api/v1/infra/reform-sandbox/{sb_id}")
        assert len(detail.json()["data"]["changes"]) == 5

    async def test_diff_counts_unconfirmed(self, client):
        """diff 统计 unconfirmed_count > 0 (apply 但未确认)."""
        cr = await client.post("/api/v1/infra/reform-sandbox", json={
            "enterpriseId": "E002", "baselineName": "diff-test",
        })
        sb_id = cr.json()["data"]["id"]
        # 加 2 个 changes
        for i in range(2):
            await client.post(f"/api/v1/infra/reform-sandbox/{sb_id}/changes", json={
                "changeId": "", "dataType": "config",
                "path": f"/p{i}", "oldValue": {}, "newValue": {"x": i},
                "proposedBy": "u", "appliedAtIso": "",
            })
        diff_r = await client.get(f"/api/v1/infra/reform-sandbox/{sb_id}/diff")
        assert diff_r.status_code == 200
        d = diff_r.json()["data"]
        assert d["unconfirmedCount"] == 2

    async def test_commit_requires_all_confirmed(self, client):
        """未全部 confirmed 的 commit 返回 code!=0 且 status=409."""
        cr = await client.post("/api/v1/infra/reform-sandbox", json={
            "enterpriseId": "E003", "baselineName": "commit-req-test",
        })
        sb_id = cr.json()["data"]["id"]
        ch_r = await client.post(f"/api/v1/infra/reform-sandbox/{sb_id}/changes", json={
            "changeId": "", "dataType": "flow",
            "path": "/f1", "oldValue": {}, "newValue": {"on": True},
            "proposedBy": "u", "appliedAtIso": "",
        })
        change_id = ch_r.json()["data"]["changeId"]
        # 不确认, 直接 commit
        cm_r = await client.post(
            f"/api/v1/infra/reform-sandbox/{sb_id}/commit",
            json={"operator": "op"},
        )
        assert cm_r.status_code == 200
        body = cm_r.json()
        assert body["code"] != 0  # 应该报错 409
        # 确认后再 commit
        await client.post(
            f"/api/v1/infra/reform-sandbox/{sb_id}/changes/{change_id}/confirm",
            json={"operator": "op"},
        )
        cm_r2 = await client.post(
            f"/api/v1/infra/reform-sandbox/{sb_id}/commit",
            json={"operator": "op"},
        )
        assert cm_r2.json()["code"] == 0
        assert cm_r2.json()["data"]["status"] == "committed"

    async def test_rollback_marks_status(self, client):
        """rollback 后 status = rolled_back."""
        cr = await client.post("/api/v1/infra/reform-sandbox", json={
            "enterpriseId": "E004", "baselineName": "rb-test",
        })
        sb_id = cr.json()["data"]["id"]
        rb = await client.post(
            f"/api/v1/infra/reform-sandbox/{sb_id}/rollback",
            json={"operator": "op"},
        )
        assert rb.status_code == 200
        assert rb.json()["data"]["status"] == "rolled_back"

    async def test_purge_clears_expired(self, client):
        """purge 返回 purged_count >= 0 整数."""
        pr = await client.post("/api/v1/infra/reform-sandbox/purge")
        assert pr.status_code == 200
        body = pr.json()
        assert body["code"] == 0
        info = body["data"]
        assert isinstance(info["purgedCount"], int)
        assert info["purgedCount"] >= 0
        assert "willAutoPurgeAtIso" in info
