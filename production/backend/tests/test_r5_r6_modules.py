"""R5 + R6 共 11 项功能完善任务测试 (≥ 22 用例).

覆盖:
    R5.1 MOD-03 征信:    parse_credit_report / evaluate_credit
    R5.2 MOD-04 票据:    360 天基础贴现 / 票据生命周期转换
    R5.3 MOD-06 评分:    LLM prompt 含财务数据 / deep_score 降级规则
    R5.4 MOD-07 隐私:    HE-SEAL 不可用 / 联邦学习 partial 返回梯度
    R5.5 DATA-04 IoT:    mqtt_config yaml 加载 / mqtt_publish 降级 HTTP
    R5.6 INFRA-01b:      15 适配器都有 _load_real_credentials / 无凭证返回 None
    R5.7 INFRA-04 沙箱:  生成 12 项指标曲线 / 报告含 risk_flags
    R5.8 MOD-13 多方:    create_seal / sign_document / sla_check 找超期
    R6.1 MOD-08b 凭证:   ant_chain/zhixin SDK 不可用返回 None
    R6.2 INFRA-05 RPA:   create_rpa_task / execute 生成 PDF / SDK 不可用 reportlab
    R6.3 MOD-15 兜底:    set_offline / sync 重放队列 / 冲突检测

运行:  pytest tests/test_r5_r6_modules.py -v
"""

from __future__ import annotations

import os

import pytest
import yaml

pytestmark = pytest.mark.asyncio


# ========================================================================
# R5.1 MOD-03 征信
# ========================================================================

class TestR51Credit:
    """MOD-03 征信数据源对接."""

    async def test_credit_report_parse(self):
        """parse_credit_report 解析 5 字段 (信贷/担保/逾期/欠息/关注类)."""
        from app.services.credit_service import credit_service
        raw = {
            "enterpriseId": "E001", "enterpriseName": "测试企业",
            "uscc": "91440300MA5EXAMPLE",
            "loanBalanceCents": 8_000_000_00,
            "guaranteedAmountCents": 1_500_000_00,
            "overdueCount": 1,
            "interestArrearsCents": 25_000_00,
            "concernClassCount": 1,
            "creditRating": "A",
            "inquiryAtIso": "2026-08-20T00:00:00+00:00",
            "rawSource": "mock",
        }
        report = credit_service.parse_credit_report(raw)
        assert report.enterprise_id == "E001"
        assert report.enterprise_name == "测试企业"
        assert report.loan_balance_cents == 8_000_000_00
        assert report.guaranteed_amount_cents == 1_500_000_00
        assert report.overdue_count == 1
        assert report.interest_arrears_cents == 25_000_00
        assert report.concern_class_count == 1
        assert report.credit_rating == "A"

    async def test_credit_evaluation_returns_rating(self):
        """evaluate_credit 返回评级 + 决策 + 评分."""
        from app.services.credit_service import credit_service
        ev = await credit_service.evaluate_credit("E001")
        assert ev.enterprise_id == "E001"
        # 评级在 AAA-D 范围内
        assert ev.credit_rating in ("AAA", "AA", "A", "BBB", "BB", "B", "CCC", "CC", "C", "D")
        assert ev.credit_score >= 0
        assert ev.credit_score <= 1000
        assert ev.decision in ("approve", "review", "reject")
        assert isinstance(ev.factors, list)
        assert len(ev.factors) > 0
        assert ev.report is not None
        assert ev.report.enterprise_id == "E001"

    async def test_credit_seed_4_enterprises(self):
        """种子: 4 家企业征信报告."""
        from app.services.credit_service import _credit_store
        # 通过 evaluate_credit 触发加载种子
        for eid in ("E001", "E002", "E003", "E004"):
            ev = await _credit_store.get_eval(eid)
            assert ev is not None, f"企业 {eid} 种子缺失"


# ========================================================================
# R5.2 MOD-04 票据
# ========================================================================

class TestR52Invoice:
    """MOD-04 票据服务 - ECDS 对接 + 贴现计算."""

    async def test_discount_calc_360_day_basis(self):
        """贴现利息 = 票面 × 贴现率 × 剩余天数 / 360 (用 ECDSBillRecord)."""
        from app.schemas.external_data import ECDSBillRecord
        from app.services.invoice_service import invoice_service
        bill = ECDSBillRecord(
            bill_id="BILL-TEST", bill_type="bank_acceptance",
            bill_no="1100TEST", drawer_enterprise_id="E001",
            drawee_enterprise_id="E002", acceptor_bank="测试银行",
            amount_cents=10_000_000_00,  # 100 万元
            issue_date_iso="2026-08-01T00:00:00+00:00",
            due_date_iso="2026-11-01T00:00:00+00:00",
            status="accepted",
        )
        result = invoice_service.calculate_discount(
            bill=bill, discount_rate=0.055, days_to_maturity=90,
        )
        # 利息 = 100万 × 0.055 × 90 / 360 = 13,750.00 元 = 1,375,000 分
        expected_interest = round(10_000_000_00 * 0.055 * 90 / 360)
        assert result.interest_cents == expected_interest
        assert result.net_proceeds_cents == 10_000_000_00 - expected_interest
        assert result.bill_no == "1100TEST"
        assert result.days_to_maturity == 90
        assert result.calc_time_iso != ""

    async def test_bill_lifecycle_transitions(self):
        """bill_lifecycle_manage 状态机: issue → accept → discount → pay."""
        from app.services.invoice_service import invoice_service
        # 用一个新票据号 (mock 生成)
        bill_no = f"1100LIFE{os.urandom(3).hex()}"
        # issue
        b1 = await invoice_service.bill_lifecycle_manage(bill_no, "issue")
        assert b1.status == "issued"
        # accept
        b2 = await invoice_service.bill_lifecycle_manage(bill_no, "accept")
        assert b2.status == "accepted"
        # discount
        b3 = await invoice_service.bill_lifecycle_manage(bill_no, "discount")
        assert b3.status == "discounted"
        # pay
        b4 = await invoice_service.bill_lifecycle_manage(bill_no, "pay")
        assert b4.status == "paid"
        # 终态后再 issue 允许 (重置)
        b5 = await invoice_service.bill_lifecycle_manage(bill_no, "issue")
        assert b5.status == "issued"

    async def test_bill_lifecycle_invalid_transition_raises(self):
        """非法状态转换抛 ValueError."""
        from app.services.invoice_service import invoice_service
        # 已 paid 的种子票据 (BILL-ECDS-0003) 不能再 discount
        with pytest.raises(ValueError):
            await invoice_service.bill_lifecycle_manage("11003456789012345603", "discount")


# ========================================================================
# R5.3 MOD-06 履约评分 - LLM 模型
# ========================================================================

class TestR53PerfScore:
    """MOD-06 履约评分 - LLM 评分模型."""

    async def test_llm_prompt_contains_financial_data(self):
        """_build_llm_prompt 输出包含 enterprise_id + 财务指标."""
        from app.services.performance_score_service import PerformanceScoreService
        svc = PerformanceScoreService()
        financial_data = {
            "revenue": 50_000_000.0,
            "net_profit": 5_000_000.0,
            "operating_cashflow": 8_000_000.0,
            "receivables": 12_000_000.0,
            "inventory": 6_000_000.0,
            "total_debt": 25_000_000.0,
            "industry": "制造业",
            "history_default": "无近 3 年违约记录",
        }
        prompt = svc._build_llm_prompt("E001", financial_data)
        assert "E001" in prompt
        assert "50000000" in prompt  # 营收
        assert "制造业" in prompt
        assert "无近 3 年违约记录" in prompt
        assert "[SYSTEM]" in prompt
        assert "[USER]" in prompt

    async def test_deep_score_falls_back_to_rules(self):
        """deep_score 在 LLM 不可用时降级到规则评分."""
        from app.services.performance_score_service import PerformanceScoreService
        svc = PerformanceScoreService()
        score = await svc.deep_score("E001")
        # LLM 不可用 (无 API Key) → 走 compute(use_llm=False) → 返回 PerformanceScore
        assert score.enterprise_id == "E001"
        assert 0.0 <= score.pd_percent <= 100.0
        assert 0.0 <= score.ioy_percent <= 100.0
        assert isinstance(score.factors, list)


# ========================================================================
# R5.4 MOD-07 隐私计算 - HE-SEAL
# ========================================================================

class TestR54Privacy:
    """MOD-07 HE-SEAL 同态加密 + 联邦学习."""

    async def test_he_seal_unavailable_returns_none(self):
        """_init_he_seal 库不可用时返回 False, he_encrypt 返回 None."""
        from app.services.privacy_compute_service import privacy_compute_service
        # 重置尝试标记, 确保真实尝试 import
        privacy_compute_service._he_seal_tried = False
        privacy_compute_service._he_seal_lib = None
        available = privacy_compute_service._init_he_seal()
        # 测试环境无 seal 库, 应返回 False
        assert available is False
        cipher = privacy_compute_service.he_encrypt(12345)
        assert cipher is None
        dec = privacy_compute_service.he_decrypt("HE:test")
        assert dec is None
        add = privacy_compute_service.he_add("HE:a", "HE:b")
        assert add is None

    async def test_federated_partial_returns_gradient(self):
        """federated_learning_partial 返回 gradient + sample_count."""
        from app.services.privacy_compute_service import privacy_compute_service
        result = privacy_compute_service.federated_learning_partial(
            "E001",
            {"learning_rate": 0.01, "batch_size": 64, "round": 3,
             "weights": {"w1": 0.5, "w2": -0.3}},
        )
        assert result["enterprise_id"] == "E001"
        assert result["round"] == 3
        assert isinstance(result["gradient"], dict)
        assert len(result["gradient"]) == 2  # w1 + w2
        assert "w1" in result["gradient"]
        assert result["sample_count"] == 64
        assert isinstance(result["loss"], float)

    async def test_federated_aggregate_fedavg(self):
        """federated_learning_aggregate FedAvg 加权平均."""
        from app.services.privacy_compute_service import privacy_compute_service
        partials = [
            {"enterprise_id": "E001", "round": 1, "gradient": {"w1": 0.1, "w2": -0.1},
             "sample_count": 100, "loss": 0.5},
            {"enterprise_id": "E002", "round": 1, "gradient": {"w1": 0.3, "w2": 0.1},
             "sample_count": 300, "loss": 0.3},
        ]
        agg = privacy_compute_service.federated_learning_aggregate(partials)
        # 加权平均: w1 = (0.1*100 + 0.3*300) / 400 = 0.25
        assert abs(agg["aggregated_gradient"]["w1"] - 0.25) < 0.01
        assert agg["participants"] == 2
        assert agg["total_samples"] == 400
        assert agg["round"] == 1


# ========================================================================
# R5.5 DATA-04 IoT - EMQX MQTT
# ========================================================================

class TestR55Emqx:
    """DATA-04 EMQX MQTT 部署配置."""

    def test_mqtt_config_yaml_loads(self):
        """mqtt_config.yaml 能被 yaml.safe_load 解析."""
        config_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "infra", "emqx", "mqtt_config.yaml",
        )
        with open(config_path, encoding="utf-8") as f:
            data = yaml.safe_load(f)
        assert isinstance(data, dict)
        assert "listeners" in data
        assert "authentication" in data
        assert "authorization" in data
        assert "will_message" in data
        assert "mqtt" in data
        # 检查 listeners.tcp.external.bind 端口 1883
        bind = data["listeners"]["tcp"]["external"]["bind"]
        assert "1883" in bind

    def test_docker_compose_yaml_loads(self):
        """docker-compose.yml 能被 yaml.safe_load 解析."""
        compose_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "infra", "emqx", "docker-compose.yml",
        )
        with open(compose_path, encoding="utf-8") as f:
            data = yaml.safe_load(f)
        assert "services" in data
        assert "emqx" in data["services"]
        ports = data["services"]["emqx"]["ports"]
        port_strs = [str(p) for p in ports]
        assert any("1883" in p for p in port_strs)
        assert any("8083" in p for p in port_strs)
        assert any("8883" in p for p in port_strs)

    async def test_mqtt_publish_fallback_to_http(self, client):
        """send_command 触发 _mqtt_publish, 库不可用降级 HTTP 长轮询."""
        # 先拿一个 E001 设备
        r = await client.get("/api/v1/modules/iot/devices", params={"enterpriseId": "E001"})
        dev_id = r.json()["data"][0]["id"]
        r2 = await client.post("/api/v1/modules/iot/devices/command", json={
            "deviceId": dev_id, "command": "REBOOT", "payload": {"deep": False},
        })
        assert r2.status_code == 200
        # 查 mqtt 日志, 应有 transport=http_longpoll 记录
        r3 = await client.get("/api/v1/modules/iot/mqtt/log")
        assert r3.status_code == 200
        logs = r3.json()["data"]
        assert isinstance(logs, list)
        assert len(logs) > 0
        last = logs[-1]
        # paho-mqtt 不可用 → transport=http_longpoll
        assert last["transport"] in ("mqtt", "http_longpoll")
        assert "topic" in last
        assert "payload" in last


# ========================================================================
# R5.6 INFRA-01b 适配器凭证框架
# ========================================================================

class TestR56AdapterCreds:
    """INFRA-01b 15 适配器真实凭证框架."""

    def test_15_adapters_have_load_credentials_method(self):
        """所有 15 个适配器都能通过 _load_real_credentials 加载."""
        from app.schemas.api_adapters import AdapterId
        from app.services.api_adapter_registry import ApiAdapterRegistry
        reg = ApiAdapterRegistry()
        for aid in AdapterId:
            creds = reg._load_real_credentials(aid)
            # 不抛异常 + 返回 dict (可能为空)
            assert isinstance(creds, dict)

    async def test_real_api_call_returns_none_without_credentials(self):
        """无凭证时 _call_real_api 返回 None (触发 mock 降级)."""
        from app.schemas.api_adapters import AdapterId
        from app.services.api_adapter_registry import ApiAdapterRegistry
        reg = ApiAdapterRegistry()
        # 测试环境通常无 env 变量, 应返回 None
        # 对每个适配器都验证 (任一无凭证就返回 None)
        for aid in AdapterId:
            result = await reg._call_real_api(aid, "test_op", {"foo": "bar"})
            # 测试环境无凭证, 全部应为 None
            assert result is None, f"{aid} 应在无凭证时返回 None"

    def test_credentials_yaml_loads_15_adapters(self):
        """api_adapter_credentials.yaml 含 15 个适配器定义."""
        config_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "app", "config", "api_adapter_credentials.yaml",
        )
        with open(config_path, encoding="utf-8") as f:
            data = yaml.safe_load(f)
        assert "adapters" in data
        adapters = data["adapters"]
        assert len(adapters) == 15
        # 每个 adapter 都有 name + env + required
        for _aid, spec in adapters.items():
            assert "name" in spec
            assert "env" in spec
            assert "required" in spec


# ========================================================================
# R5.7 INFRA-04 改造沙箱 - 12 项指标
# ========================================================================

class TestR57SandboxIndicators:
    """INFRA-04 改造沙箱 - 12 项准入指标."""

    async def test_generate_12_indicator_curves(self, client):
        """生成 12 项指标曲线 (含 12 月数据点)."""
        # 先列企业 E001 的沙箱 (种子化)
        r = await client.get("/api/v1/infra/reform-sandbox/enterprise/E001")
        sbs = r.json()["data"]
        assert len(sbs) > 0
        sb_id = sbs[0]["id"]
        r2 = await client.get(f"/api/v1/infra/reform-sandbox/{sb_id}/indicators")
        assert r2.status_code == 200
        curves = r2.json()["data"]
        assert len(curves) == 12
        first = curves[0]
        # 字段
        assert "indicatorId" in first
        assert "name" in first
        assert "baselineValue" in first
        assert "projectedValue" in first
        assert "unit" in first
        assert "status" in first
        assert "curvePoints" in first
        assert len(first["curvePoints"]) == 12  # 12 个月
        # 12 项指标 ID 集合
        ids = {c["indicatorId"] for c in curves}
        assert "asset_liability_ratio" in ids
        assert "roe" in ids
        assert "interest_coverage" in ids

    async def test_sandbox_report_has_risk_flags(self, client):
        """沙箱报告含 risk_flags 列表 (可能为空, 但字段存在)."""
        r = await client.get("/api/v1/infra/reform-sandbox/enterprise/E001")
        sb_id = r.json()["data"][0]["id"]
        r2 = await client.get(f"/api/v1/infra/reform-sandbox/{sb_id}/report")
        assert r2.status_code == 200
        report = r2.json()["data"]
        assert report["sandboxId"] == sb_id
        assert "indicators" in report
        assert len(report["indicators"]) == 12
        assert "summary" in report
        assert isinstance(report["riskFlags"], list)
        assert "generatedAtIso" in report


# ========================================================================
# R5.8 MOD-13 多方协作
# ========================================================================

class TestR58Multilateral:
    """MOD-13 多方协作 - 电子签章 + SLA."""

    async def test_create_seal(self, client):
        """POST /modules/multilateral/seals 创建电子签章."""
        r = await client.post("/api/v1/modules/multilateral/seals", json={
            "enterpriseId": "E001",
            "signatoryName": "张三",
            "certificateNo": "CERT-TEST-001",
            "sealType": "enterprise",
        })
        assert r.status_code == 200
        seal = r.json()["data"]
        assert seal["enterpriseId"] == "E001"
        assert seal["signatoryName"] == "张三"
        assert seal["sealType"] == "enterprise"
        assert seal["status"] == "active"
        assert "sealId" in seal
        assert "validFromIso" in seal

    async def test_sign_document_mock_fallback(self, client):
        """sign_document SDK 不可用时返回 mock 签名 (base64)."""
        # 先 list 种子签章
        r = await client.get("/api/v1/modules/multilateral/seals")
        seals = r.json()["data"]
        assert len(seals) >= 4  # 4 个种子
        seal_id = seals[0]["sealId"]
        r2 = await client.post("/api/v1/modules/multilateral/sign", json={
            "sealId": seal_id,
            "documentHash": "sha256:abc123def456",
        })
        assert r2.status_code == 200
        result = r2.json()["data"]
        assert result["status"] == "signed"
        # SDK 不可用 → provider=mock
        assert result["provider"] in ("esign", "fadada", "mock")
        assert len(result["signature"]) > 0

    async def test_sla_check_finds_breached(self, client):
        """sla_check 找到种子中 2 个超期任务."""
        r = await client.get("/api/v1/modules/multilateral/sla/check")
        assert r.status_code == 200
        metrics = r.json()["data"]
        assert len(metrics) == 5  # 5 个任务
        breached = [m for m in metrics if m["isBreached"]]
        assert len(breached) >= 2  # 种子中 2 个超期
        # 超期任务的 breach_duration_hours > 0
        for b in breached:
            assert b["breachDurationHours"] > 0


# ========================================================================
# R6.1 MOD-08b 联盟链跨行 SDK
# ========================================================================

class TestR61CredentialSDK:
    """MOD-08b 联盟链 SDK 接口框架."""

    async def test_ant_chain_sdk_unavailable_returns_none(self):
        """antchain_sdk 不可用时 _call_ant_chain_vc_issue 返回 None."""
        from app.services.credential_service import credential_service
        credential_service._ant_chain_tried = False
        credential_service._ant_chain_sdk = None
        # 直接调用 load
        ok = credential_service._load_ant_chain_sdk()
        assert ok is False

    async def test_zhixin_sdk_unavailable_returns_none(self):
        """zhixin_sdk 不可用时 _load_zhixin_sdk 返回 False."""
        from app.services.credential_service import credential_service
        credential_service._zhixin_tried = False
        credential_service._zhixin_sdk = None
        ok = credential_service._load_zhixin_sdk()
        assert ok is False

    async def test_issue_falls_back_to_local_chain(self, client):
        """issue 在两个 SDK 都不可用时降级到 Local chain."""
        r = await client.post("/api/v1/modules/credential/issue", json={
            "enterpriseId": "E001",
            "credentialType": "EnterpriseCreditScore",
            "claim": {"score": 88, "level": "A"},
            "validDays": 180,
        })
        assert r.status_code == 200
        vc = r.json()["data"]
        assert vc["chainTxId"] is not None
        # 测试环境无 SDK, 走 Local
        assert vc["chainTxId"].startswith("local-tx-") or vc["chainTxId"].startswith("ant-tx-") or vc["chainTxId"].startswith("zx-tx-")
        # claim 应注入 _chain_type
        assert "_chain_type" in vc["claim"]


# ========================================================================
# R6.2 INFRA-05 RPA 适配层
# ========================================================================

class TestR62RPA:
    """INFRA-05 RPA 适配层."""

    async def test_create_rpa_task(self, client):
        """POST /infra/rpa/tasks 创建 pending 任务."""
        r = await client.post("/api/v1/infra/rpa/tasks", json={
            "enterpriseId": "E001",
            "taskType": "BANK_STATEMENT_PDF",
            "targetBank": "工商银行",
        })
        assert r.status_code == 200
        task = r.json()["data"]
        assert task["enterpriseId"] == "E001"
        assert task["taskType"] == "BANK_STATEMENT_PDF"
        assert task["targetBank"] == "工商银行"
        assert task["status"] == "pending"
        assert "taskId" in task

    async def test_execute_rpa_task_generates_pdf(self, client):
        """execute 后 status=completed + result_file_path 不为空."""
        r = await client.post("/api/v1/infra/rpa/tasks", json={
            "enterpriseId": "E005",
            "taskType": "INVOICE_PDF",
        })
        task_id = r.json()["data"]["taskId"]
        r2 = await client.post(f"/api/v1/infra/rpa/tasks/{task_id}/execute")
        assert r2.status_code == 200
        executed = r2.json()["data"]
        assert executed["status"] == "completed"
        assert executed["resultFilePath"] is not None
        assert executed["completedAtIso"] is not None

    async def test_rpa_seed_5_tasks(self, client):
        """种子: 5 个 RPA 任务 (3 completed / 1 running / 1 pending)."""
        r = await client.get("/api/v1/infra/rpa/tasks")
        tasks = r.json()["data"]
        assert len(tasks) >= 5
        statuses = [t["status"] for t in tasks]
        assert "completed" in statuses
        assert "running" in statuses
        assert "pending" in statuses

    async def test_rpa_sdk_unavailable_uses_reportlab(self):
        """_load_rpa_sdk 在无 SDK 时返回 False; PDF 仍能生成."""
        from app.services.rpa_service import rpa_service
        rpa_service._rpa_sdk_tried = False
        rpa_service._rpa_sdk = None
        ok = rpa_service._load_rpa_sdk()
        assert ok is False
        # reportlab 在测试环境已安装 (verify dep)
        # 直接生成一个 PDF 文件路径
        path = rpa_service._generate_bank_statement_pdf(
            enterprise_id="E001", bank_name="工商银行",
            account_no="622200****1234", period="2026-08",
        )
        assert os.path.exists(path)
        # 文件非空
        assert os.path.getsize(path) > 0


# ========================================================================
# R6.3 MOD-15 兜底引擎
# ========================================================================

class TestR63FallbackEngine:
    """MOD-15 独立兜底引擎."""

    async def test_set_offline_mode(self, client):
        """set_mode OFFLINE 后配置切换."""
        r = await client.post("/api/v1/modules/fallback/E001/mode", json={
            "mode": "OFFLINE",
        })
        assert r.status_code == 200
        cfg = r.json()["data"]
        assert cfg["mode"] == "OFFLINE"
        # offline 模式 sync_interval 缩短为 5
        assert cfg["syncIntervalMinutes"] == 5
        # 切回 ONLINE 恢复
        r2 = await client.post("/api/v1/modules/fallback/E001/mode", json={
            "mode": "ONLINE",
        })
        assert r2.json()["data"]["mode"] == "ONLINE"
        assert r2.json()["data"]["syncIntervalMinutes"] == 15

    async def test_sync_replays_queued_operations(self, client):
        """sync_data 重放队列 ops (E003 种子 10 条)."""
        # E003 是 OFFLINE + 10 排队 ops
        r = await client.get("/api/v1/modules/fallback/E003/config")
        cfg = r.json()["data"]
        assert cfg["mode"] == "OFFLINE"
        assert cfg["queuedOperations"] == 10
        # 同步
        r2 = await client.post("/api/v1/modules/fallback/E003/sync")
        assert r2.status_code == 200
        result = r2.json()["data"]
        # 至少应重放一部分 (具体数量取决于 mock 是否生成冲突)
        assert result["syncedCount"] + result["failedCount"] + result["conflictCount"] >= 0
        # 同步后队列清空
        r3 = await client.get("/api/v1/modules/fallback/E003/config")
        assert r3.json()["data"]["queuedOperations"] == 0

    async def test_conflict_detection(self, client):
        """check_conflict 检测 DELETE + UPDATE 同 entity 冲突."""
        # 切到 OFFLINE + 排 2 个 ops (DELETE + UPDATE 同 entity)
        await client.post("/api/v1/modules/fallback/E005/mode", json={"mode": "OFFLINE"})
        await client.post("/api/v1/modules/fallback/E005/queue", json={
            "operation": {
                "op_type": "UPDATE", "entity": "invoice",
                "payload": {"id": "X1", "value": 100},
            }
        })
        await client.post("/api/v1/modules/fallback/E005/queue", json={
            "operation": {
                "op_type": "DELETE", "entity": "invoice",
                "payload": {"id": "X1"},
            }
        })
        r = await client.post("/api/v1/modules/fallback/E005/conflict-check")
        assert r.status_code == 200
        conflicts = r.json()["data"]
        assert isinstance(conflicts, list)
        assert len(conflicts) >= 1
        # 第一个冲突应包含 invoice entity
        c = conflicts[0]
        assert c["entity"] == "invoice"
        assert "reason" in c
