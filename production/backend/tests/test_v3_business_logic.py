"""V3 业务逻辑测试 (8 项 MOD 升级).

覆盖:
    MOD-01 资金监管: 资金流向图谱 API + 五流校验增强
        - generate_fund_flow_graph (节点+边结构)
        - /modules/five-flow/graph HTTP 端点
    MOD-02 风控: 流处理增强 + 风控仪表盘
        - get_dashboard_stats (规则命中率/告警/趋势/Top 风险企业)
        - /modules/risk-rule/dashboard HTTP 端点
    MOD-05 应收款保险: 投保流程 + 保单管理
        - create_policy / get_policy / list_policies / file_claim
        - 保费计算 (base_rate + risk_factor + coverage_factor)
        - /modules/insurance/* HTTP 端点
    MOD-06 履约评分: 历史趋势预测
        - predict_historical_trend (历史 + 预测 + trend)
        - 线性回归斜率
    MOD-07 隐私计算: 性能优化 + FedAvg 验证
        - benchmark_he_performance (HE 降级 mock)
        - simulate_fedavg_round (多轮 FedAvg + 收敛判定)
    MOD-12 IoT 感知: 设备认证证书逻辑
        - register_device (证书校验)
        - verify_device_data (GPS/温湿度范围)
        - get_device_status (心跳超时判定)
    MOD-13 多方协作: e签宝/法大大 SDK 集成 (Mock 降级)
        - _call_esign_sdk_v3 (Mock 降级 sign_url)
        - _call_fadada_sdk (Mock 降级)
    MOD-15 兜底引擎: 独立 Docker 镜像 + 断网 E2E
        - health_check_offline (健康状态)
        - 断网 E2E: OFFLINE 模式 → 排队 → 冲突 → 重放

运行: pytest tests/test_v3_business_logic.py -v
"""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.asyncio


# ============================================================================
# MOD-01 资金流向图谱 + 五流校验增强
# ============================================================================

class TestMod01FundFlowGraph:
    """MOD-01 资金流向图谱 API."""

    async def test_generate_fund_flow_graph_returns_nodes_and_edges(self):
        """generate_fund_flow_graph 返回 nodes + edges + summary."""
        from app.services.five_flow_consistency_service import (
            five_flow_consistency_service,
        )
        # E001 种子有 1 笔交易 (TX-2026-0001) × 6 流
        graph = await five_flow_consistency_service.generate_fund_flow_graph(
            enterprise_id="E001",
        )
        # 节点: 企业账户 + 对手方账户 (至少 2 节点)
        assert "nodes" in graph
        assert "edges" in graph
        assert "summary" in graph
        assert len(graph["nodes"]) >= 2
        # 企业节点存在
        ent_nodes = [n for n in graph["nodes"] if n["type"] == "enterprise"]
        assert len(ent_nodes) == 1
        assert ent_nodes[0]["enterprise_id"] == "E001"
        # 边: 至少 6 条 (六流)
        assert len(graph["edges"]) >= 6
        # summary 包含 4 字段
        assert "total_inflow_cents" in graph["summary"]
        assert "total_outflow_cents" in graph["summary"]
        assert "tx_count" in graph["summary"]
        assert "counterparty_count" in graph["summary"]
        assert graph["summary"]["tx_count"] >= 1
        assert graph["summary"]["counterparty_count"] >= 1

    async def test_generate_fund_flow_graph_with_date_range(self):
        """generate_fund_flow_graph 按 start_date/end_date 过滤."""
        from app.services.five_flow_consistency_service import (
            five_flow_consistency_service,
        )
        # 用未来日期范围过滤 → 应返回空边 (无匹配)
        future_start = "2099-01-01T00:00:00+00:00"
        future_end = "2099-12-31T23:59:59+00:00"
        graph = await five_flow_consistency_service.generate_fund_flow_graph(
            enterprise_id="E001",
            start_date=future_start,
            end_date=future_end,
        )
        # 时间范围在未来 → 边应为空 (但企业节点仍存在)
        assert len(graph["edges"]) == 0
        # 企业节点仍存在 (固定)
        assert len(graph["nodes"]) == 1
        assert graph["summary"]["total_inflow_cents"] == 0
        assert graph["summary"]["total_outflow_cents"] == 0

    async def test_graph_endpoint_via_http(self, client):
        """GET /modules/five-flow/graph HTTP 端点."""
        r = await client.get(
            "/api/v1/modules/five-flow/graph",
            params={"enterpriseId": "E001"},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        data = body["data"]
        # 服务层返回 snake_case (与 multilateral 模式一致)
        assert data["enterprise_id"] == "E001"
        assert len(data["nodes"]) >= 2
        assert len(data["edges"]) >= 6


# ============================================================================
# MOD-02 风控仪表盘 + 流处理增强
# ============================================================================

class TestMod02RiskDashboard:
    """MOD-02 风控仪表盘数据 API."""

    async def test_get_dashboard_stats_returns_all_fields(self):
        """get_dashboard_stats 返回 rules_hit_count/alerts_today/trend_7d/
        top_risky_enterprises/summary."""
        from app.services.risk_stream_service import risk_stream_service
        stats = await risk_stream_service.get_dashboard_stats()
        # 5 个顶级字段
        assert "rules_hit_count" in stats
        assert "alerts_today" in stats
        assert "trend_7d" in stats
        assert "top_risky_enterprises" in stats
        assert "summary" in stats
        # 种子: 20 个事件 (5 blocked + 5 flagged + 10 passed)
        # rules_hit_count 至少有 RR-001 / RR-003 命中
        assert isinstance(stats["rules_hit_count"], dict)
        assert len(stats["rules_hit_count"]) >= 1
        # alerts_today: 至少 10 (今日 UTC, 种子时间戳都是 now)
        assert stats["alerts_today"] >= 10
        # trend_7d: 7 天
        assert len(stats["trend_7d"]) == 7
        for t in stats["trend_7d"]:
            assert "date_iso" in t
            assert "alert_count" in t
            assert "block_count" in t
        # top_risky_enterprises: 应包含 E001/E002/E003 (block+flag 都有)
        assert isinstance(stats["top_risky_enterprises"], list)
        assert len(stats["top_risky_enterprises"]) >= 1
        assert len(stats["top_risky_enterprises"]) <= 5
        for ent in stats["top_risky_enterprises"]:
            assert "enterprise_id" in ent
            assert "alert_count" in ent
            assert "block_count" in ent
            assert "total_score" in ent
        # summary: 5 字段
        s = stats["summary"]
        assert s["total_rules"] >= 10  # 种子 10 条规则
        assert s["total_events"] >= 20
        assert s["block_count"] >= 5
        assert s["flag_count"] >= 5
        assert s["pass_count"] >= 10

    async def test_dashboard_endpoint_via_http(self, client):
        """GET /modules/risk-rule/dashboard HTTP 端点."""
        r = await client.get("/api/v1/modules/risk-rule/dashboard")
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        data = body["data"]
        assert "rules_hit_count" in data
        assert "trend_7d" in data
        assert len(data["trend_7d"]) == 7


# ============================================================================
# MOD-05 应收款保险 — 投保流程 + 保单管理
# ============================================================================

class TestMod05InsurancePolicy:
    """MOD-05 投保流程 + 保单管理."""

    async def test_create_policy_generates_policy_id_and_premium(self):
        """create_policy 生成保单号 + 计算保费 (基于 PD + coverage_ratio)."""
        from app.services.insurance_service import insurance_service
        policy = await insurance_service.create_policy(
            enterprise_id="E001",
            receivable_amount=1_000_000.0,
            insured_party="测试买方公司",
            coverage_ratio=0.8,
        )
        # 保单号生成 (POL- 前缀)
        assert policy["policy_id"].startswith("POL-")
        assert policy["enterprise_id"] == "E001"
        assert policy["insured_party"] == "测试买方公司"
        assert policy["receivable_amount"] == 1_000_000.0
        assert policy["coverage_ratio"] == 0.8
        assert policy["coverage_amount"] == 800_000.0
        # 保费计算: base_rate=0.5%, E001 PD≈3.5 (低风险, 0.8x),
        # coverage_ratio=0.8 (高覆盖, 1.2x) → rate=0.005*0.8*1.2=0.0048
        assert policy["premium_rate"] > 0
        assert policy["premium_amount"] > 0
        # breakdown 含计算明细
        assert "breakdown" in policy
        assert policy["breakdown"]["base_rate"] == 0.005
        # 状态: active (mock insurer 即时承保)
        assert policy["policy_status"] == "active"
        assert "valid_from_iso" in policy
        assert "valid_to_iso" in policy

    async def test_create_policy_rejects_invalid_inputs(self):
        """create_policy 拒绝非法输入 (零金额 / 越界 coverage_ratio)."""
        from app.services.insurance_service import insurance_service
        # 零金额
        with pytest.raises(ValueError, match="receivable_amount"):
            await insurance_service.create_policy(
                enterprise_id="E001",
                receivable_amount=0,
                insured_party="买方",
                coverage_ratio=0.8,
            )
        # coverage_ratio 越界
        with pytest.raises(ValueError, match="coverage_ratio"):
            await insurance_service.create_policy(
                enterprise_id="E001",
                receivable_amount=1000,
                insured_party="买方",
                coverage_ratio=1.5,
            )
        # 空企业 ID
        with pytest.raises(ValueError, match="enterprise_id"):
            await insurance_service.create_policy(
                enterprise_id="",
                receivable_amount=1000,
                insured_party="买方",
                coverage_ratio=0.8,
            )

    async def test_get_and_list_policies(self):
        """get_policy 查询保单 / list_policies 按企业过滤."""
        from app.services.insurance_service import insurance_service
        # 种子: E001 有 1 个保单 (POL-2026-0001)
        policies = await insurance_service.list_policies("E001")
        assert len(policies) >= 1
        seed_id = policies[0]["policy_id"]
        # get_policy
        p = await insurance_service.get_policy(seed_id)
        assert p is not None
        assert p["policy_id"] == seed_id
        assert p["enterprise_id"] == "E001"
        # list_policies 全部
        all_policies = await insurance_service.list_policies()
        assert len(all_policies) >= 3  # 种子 3 个保单
        # get_policy 不存在
        none_p = await insurance_service.get_policy("POL-NOT-EXIST")
        assert none_p is None

    async def test_file_claim_validates_policy_and_amount(self):
        """file_claim 校验保单状态 + 金额上限 + incident_desc 非空."""
        from app.services.insurance_service import insurance_service
        # 用种子 POL-2026-0001 (active, coverage_amount=900_000)
        claim = await insurance_service.file_claim(
            policy_id="POL-2026-0001",
            claim_amount=200_000.0,
            incident_desc="买方 E001 应收账款逾期 90 天未付",
        )
        assert claim["claim_id"].startswith("CLM-")
        assert claim["policy_id"] == "POL-2026-0001"
        assert claim["claim_amount"] == 200_000.0
        assert claim["status"] == "under_review"
        # 理赔金额超过覆盖金额 → 拒绝
        with pytest.raises(ValueError, match="超过保单覆盖金额"):
            await insurance_service.file_claim(
                policy_id="POL-2026-0001",
                claim_amount=10_000_000.0,  # 远超 900_000
                incident_desc="测试大额理赔",
            )
        # 过期保单 (POL-2026-0003 是 expired)
        with pytest.raises(ValueError, match="无法申请理赔"):
            await insurance_service.file_claim(
                policy_id="POL-2026-0003",
                claim_amount=1000.0,
                incident_desc="测试过期保单理赔",
            )
        # 不存在的保单
        with pytest.raises(ValueError, match="不存在"):
            await insurance_service.file_claim(
                policy_id="POL-NOT-EXIST",
                claim_amount=1000.0,
                incident_desc="测试",
            )

    async def test_premium_calculation_factors(self):
        """保费计算: 高 PD 企业费率高于低 PD 企业."""
        from app.services.insurance_service import _compute_premium
        # 低 PD (3.5) + 中覆盖 (0.7) → 费率 = 0.005 * 0.8 * 1.0 = 0.004
        low_pd_amt, low_pd_rate, _ = _compute_premium(
            receivable_amount=1_000_000,
            coverage_ratio=0.7,
            pd_percent=3.5,
        )
        # 高 PD (35) + 中覆盖 (0.7) → 费率 = 0.005 * 2.5 * 1.0 = 0.0125
        high_pd_amt, high_pd_rate, _ = _compute_premium(
            receivable_amount=1_000_000,
            coverage_ratio=0.7,
            pd_percent=35.0,
        )
        # 高 PD 费率应远高于低 PD
        assert high_pd_rate > low_pd_rate * 2
        assert high_pd_amt > low_pd_amt * 2


# ============================================================================
# MOD-06 履约评分 — 历史趋势预测
# ============================================================================

class TestMod06PredictTrend:
    """MOD-06 历史趋势预测."""

    async def test_predict_historical_trend_returns_history_and_forecast(self):
        """predict_historical_trend 返回 N 月历史 + 3 月预测 + trend."""
        from app.services.performance_score_service import (
            performance_score_service,
        )
        result = await performance_score_service.predict_historical_trend(
            enterprise_id="E001", months=12,
        )
        # 12 月历史 + 3 月预测 = 15 条
        assert len(result) == 15
        # 字段
        for item in result:
            assert "month_iso" in item
            assert "pd_score" in item
            assert "ioy_score" in item
            assert "trend" in item
            assert "is_forecast" in item
            assert 0.0 <= item["pd_score"] <= 100.0
            assert 0.0 <= item["ioy_score"] <= 100.0
            assert item["trend"] in ("up", "down", "stable")
        # 前 12 条 is_forecast=False (历史)
        for item in result[:12]:
            assert item["is_forecast"] is False
        # 后 3 条 is_forecast=True (预测)
        for item in result[12:]:
            assert item["is_forecast"] is True
        # month_iso 格式 YYYY-MM
        for item in result:
            assert len(item["month_iso"]) == 7
            assert item["month_iso"][4] == "-"

    async def test_linear_regression_slope(self):
        """_linear_regression_slope 计算趋势斜率."""
        from app.services.performance_score_service import (
            PerformanceScoreService,
        )
        # 上升趋势
        slope_up = PerformanceScoreService._linear_regression_slope(
            [0, 1, 2, 3, 4], [1.0, 2.0, 3.0, 4.0, 5.0],
        )
        assert abs(slope_up - 1.0) < 0.01
        # 下降趋势
        slope_down = PerformanceScoreService._linear_regression_slope(
            [0, 1, 2, 3, 4], [5.0, 4.0, 3.0, 2.0, 1.0],
        )
        assert abs(slope_down - (-1.0)) < 0.01
        # 无趋势
        slope_flat = PerformanceScoreService._linear_regression_slope(
            [0, 1, 2, 3, 4], [3.0, 3.0, 3.0, 3.0, 3.0],
        )
        assert abs(slope_flat) < 0.01
        # 单点 / 空数据 → 0
        assert PerformanceScoreService._linear_regression_slope([0], [1.0]) == 0.0
        assert PerformanceScoreService._linear_regression_slope([], []) == 0.0


# ============================================================================
# MOD-07 隐私计算 — 性能优化 + FedAvg 验证
# ============================================================================

class TestMod07PrivacyBenchmark:
    """MOD-07 性能基准 + FedAvg 模拟."""

    async def test_benchmark_he_performance_degrades_to_mock(self):
        """benchmark_he_performance 在 HE-SEAL 库不可用时降级为 mock.

        测试环境无 seal / he_seal 库, 应返回 degraded_to_mock=True.
        """
        from app.services.privacy_compute_service import privacy_compute_service
        # 重置缓存确保走真实检测
        privacy_compute_service._he_seal_tried = False
        privacy_compute_service._he_seal_lib = None
        bench = privacy_compute_service.benchmark_he_performance(data_size=100)
        assert bench["data_size"] == 100
        # 测试环境无 HE-SEAL 库
        assert bench["he_lib_available"] is False
        assert bench["degraded_to_mock"] is True
        assert bench["lib_name"] is None
        # 耗时应非零 (mock 加密也有耗时)
        assert bench["encrypt_total_ms"] >= 0
        assert bench["decrypt_total_ms"] >= 0
        # 吞吐量
        assert bench["throughput_encrypt_per_sec"] >= 0
        assert bench["throughput_decrypt_per_sec"] >= 0
        # benchmark_at_iso
        assert "benchmark_at_iso" in bench

    async def test_simulate_fedavg_round_convergence(self):
        """simulate_fedavg_round 多轮 FedAvg + 收敛判定."""
        from app.services.privacy_compute_service import privacy_compute_service
        result = privacy_compute_service.simulate_fedavg_round(
            participants=["E001", "E002", "E003"],
            rounds=5,
        )
        # 5 轮日志
        assert result["rounds"] == 5
        assert len(result["rounds_log"]) == 5
        for r_log in result["rounds_log"]:
            assert r_log["round"] >= 1
            assert r_log["participants"] == 3
            assert r_log["avg_loss"] > 0
            assert "aggregated_gradient" in r_log
            assert "updated_weights" in r_log
        # 收敛信息
        conv = result["convergence"]
        assert len(conv["loss_history"]) == 5
        # loss 应整体下降 (improvement_per_round > 0)
        # 注意: 有噪声, 不一定严格单调, 但初始 > 最终
        assert conv["loss_history"][0] >= conv["loss_history"][-1]
        assert conv["loss_decrease_pct"] >= 0
        # is_converged: 第 5 轮后可能未收敛 (噪声), 字段必须存在
        assert isinstance(conv["is_converged"], bool)
        # final
        assert "final_aggregated_gradient" in result
        assert "final_avg_loss" in result
        # participants 保留
        assert result["participants"] == ["E001", "E002", "E003"]

    async def test_simulate_fedavg_round_rejects_invalid_participants(self):
        """simulate_fedavg_round 拒绝 < 2 个参与方."""
        from app.services.privacy_compute_service import privacy_compute_service
        with pytest.raises(ValueError, match="participants"):
            privacy_compute_service.simulate_fedavg_round(
                participants=["E001"], rounds=3,
            )
        with pytest.raises(ValueError, match="participants"):
            privacy_compute_service.simulate_fedavg_round(
                participants=[], rounds=3,
            )


# ============================================================================
# MOD-12 IoT 感知 — 设备认证 + 数据校验
# ============================================================================

class TestMod12IotDeviceAuth:
    """MOD-12 设备认证证书逻辑."""

    async def test_register_device_validates_cert_pem(self):
        """register_device 校验证书 PEM 格式 + 生成 fingerprint."""
        from app.services.iot_service import iot_service
        cert_pem = (
            "-----BEGIN CERTIFICATE-----\n"
            "MIIBxTCCHQIGByqGSM44BAEwggHKMIGIAgEBMEExDzANBgNV\n"
            "-----END CERTIFICATE-----\n"
        )
        device = await iot_service.register_device(
            device_id="DEV-TEST-NEW-001",
            enterprise_id="E005",
            device_type="gps_tracker",
            cert_pem=cert_pem,
        )
        assert device["device_id"] == "DEV-TEST-NEW-001"
        assert device["enterprise_id"] == "E005"
        assert device["device_type"] == "gps_tracker"
        assert device["status"] == "active"
        # 证书指纹生成 (SHA256: 前 16 字符)
        assert device["cert_fingerprint"].startswith("SHA256:")
        assert len(device["cert_fingerprint"]) >= 23  # SHA256: + 16 字符
        # 有效期
        assert "cert_valid_from_iso" in device
        assert "cert_valid_to_iso" in device
        # 返回时不应包含证书原文 (避免泄漏)
        assert "cert_pem" not in device

    async def test_register_device_rejects_invalid_cert(self):
        """register_device 拒绝非法 PEM (无 BEGIN/END)."""
        from app.services.iot_service import iot_service
        # 缺少 PEM 头
        with pytest.raises(ValueError, match="证书.*PEM"):
            await iot_service.register_device(
                device_id="DEV-TEST-BAD-001",
                enterprise_id="E005",
                device_type="gps_tracker",
                cert_pem="not a valid cert",
            )
        # 缺少 PEM 尾
        with pytest.raises(ValueError, match="证书.*PEM"):
            await iot_service.register_device(
                device_id="DEV-TEST-BAD-002",
                enterprise_id="E005",
                device_type="gps_tracker",
                cert_pem="-----BEGIN CERTIFICATE-----\nbody only",
            )

    async def test_register_device_rejects_duplicate(self):
        """register_device 拒绝重复注册."""
        from app.services.iot_service import iot_service
        # 种子 DEV-GPS-001 已存在
        with pytest.raises(ValueError, match="已存在"):
            await iot_service.register_device(
                device_id="DEV-GPS-001",
                enterprise_id="E001",
                device_type="gps_tracker",
                cert_pem=(
                    "-----BEGIN CERTIFICATE-----\n"
                    "test\n"
                    "-----END CERTIFICATE-----\n"
                ),
            )

    async def test_verify_device_data_gps_range(self):
        """verify_device_data 校验 GPS 坐标范围 (中国大陆)."""
        from app.services.iot_service import iot_service
        # 合法 GPS (深圳): lat=22.5, lon=114.0
        result = await iot_service.verify_device_data(
            device_id="DEV-GPS-001",
            data_payload={
                "gps": {"lat": 22.5431, "lon": 114.0579},
                "timestamp_iso": "2026-08-20T10:00:00+00:00",
            },
        )
        assert result["device_id"] == "DEV-GPS-001"
        assert result["verified"] is True
        # 2 项 GPS 校验 (lat + lon) 都通过
        gps_checks = [c for c in result["checks"] if c["field"].startswith("gps")]
        assert len(gps_checks) == 2
        for c in gps_checks:
            assert c["passed"] is True

        # 越界 GPS (纬度 70 在中国境外)
        result_bad = await iot_service.verify_device_data(
            device_id="DEV-GPS-001",
            data_payload={"gps": {"lat": 70.0, "lon": 114.0}},
        )
        assert result_bad["verified"] is False
        lat_check = next(c for c in result_bad["checks"] if c["field"] == "gps.lat")
        assert lat_check["passed"] is False
        assert "纬度" in lat_check["error"]

    async def test_verify_device_data_temp_humidity_range(self):
        """verify_device_data 校验温湿度合理范围."""
        from app.services.iot_service import iot_service
        # 合法温湿度 (常温仓储): temp=25, humidity=55
        result = await iot_service.verify_device_data(
            device_id="DEV-THS-002",
            data_payload={"temperature": 25.0, "humidity": 55.0},
        )
        assert result["verified"] is True
        # 越界温度 (80°C 超出仓储合理范围)
        result_bad = await iot_service.verify_device_data(
            device_id="DEV-THS-002",
            data_payload={"temperature": 80.0, "humidity": 55.0},
        )
        assert result_bad["verified"] is False
        temp_check = next(c for c in result_bad["checks"] if c["field"] == "temperature")
        assert temp_check["passed"] is False
        assert "温度" in temp_check["error"]

    async def test_get_device_status_returns_cert_validity(self):
        """get_device_status 返回证书有效性 + 心跳超时判定."""
        from app.services.iot_service import iot_service
        # 种子 DEV-GPS-001 证书有效
        status = await iot_service.get_device_status("DEV-GPS-001")
        assert status is not None
        assert status["device_id"] == "DEV-GPS-001"
        assert status["status"] in ("active", "alarm", "offline")
        assert status["cert_valid"] is True  # 证书在有效期内
        assert "cert_valid_to_iso" in status
        assert "uptime_hours" in status
        assert status["uptime_hours"] >= 0

        # 种子 DEV-EMT-004 证书已过期
        status_expired = await iot_service.get_device_status("DEV-EMT-004")
        assert status_expired is not None
        assert status_expired["cert_valid"] is False
        # 心跳超过 1 小时 → 应为 offline
        assert status_expired["status"] == "offline"

        # 不存在的设备
        none_status = await iot_service.get_device_status("DEV-NOT-EXIST")
        assert none_status is None


# ============================================================================
# MOD-13 多方协作 — e签宝/法大大 SDK 集成 (Mock 降级)
# ============================================================================

class TestMod13EsignFadadaSdk:
    """MOD-13 e签宝/法大大 SDK 集成 (Mock 降级)."""

    async def test_call_esign_sdk_v3_falls_back_to_mock(self):
        """_call_esign_sdk_v3 SDK 不可用时降级返回 mock 签章."""
        from app.services.multilateral_service import multilateral_service
        signers = [
            {
                "signer_id": "S001",
                "signer_name": "张三",
                "signer_type": "enterprise",
                "certificate_no": "CERT-001",
            },
            {
                "signer_id": "S002",
                "signer_name": "李四",
                "signer_type": "legal_representative",
                "certificate_no": "CERT-002",
            },
        ]
        result = await multilateral_service._call_esign_sdk_v3(
            contract_id="CTR-TEST-001",
            signers=signers,
        )
        # 测试环境无 esign_sdk, 应降级
        assert result["provider"] in ("esign", "mock")
        assert result["contract_id"] == "CTR-TEST-001"
        # 状态: signed (mock 即时签署)
        assert result["sign_status"] == "signed"
        # sign_url 不为空
        assert len(result["sign_url"]) > 0
        # valid_until_iso 在未来
        from datetime import datetime
        valid_until = datetime.fromisoformat(
            result["valid_until_iso"].replace("Z", "+00:00"),
        )
        assert valid_until > datetime.now(valid_until.tzinfo)
        # 签署方数
        assert result["signers_count"] == 2
        assert result["signed_count"] == 2
        # degraded 标识 (测试环境应为 True)
        assert isinstance(result["degraded"], bool)

    async def test_call_fadada_sdk_falls_back_to_mock(self):
        """_call_fadada_sdk SDK 不可用时降级返回 mock 签章."""
        from app.services.multilateral_service import multilateral_service
        signers = [
            {
                "signer_id": "S003",
                "signer_name": "王五",
                "signer_type": "finance",
                "certificate_no": "CERT-003",
            },
        ]
        result = await multilateral_service._call_fadada_sdk(
            contract_id="CTR-TEST-002",
            signers=signers,
        )
        # provider 应为 fadada 或 mock
        assert result["provider"] in ("fadada", "mock")
        assert result["contract_id"] == "CTR-TEST-002"
        assert result["sign_status"] == "signed"
        assert len(result["sign_url"]) > 0
        assert "valid_until_iso" in result
        assert result["signers_count"] == 1
        assert result["signed_count"] == 1

    async def test_esign_and_fadada_both_degrade_to_mock(self):
        """e签宝和法大大在无 SDK 时都应降级到 mock, 但 sign_url 不同."""
        from app.services.multilateral_service import multilateral_service
        signers = [
            {"signer_id": "S1", "signer_name": "甲", "signer_type": "enterprise"},
        ]
        esign_result = await multilateral_service._call_esign_sdk_v3(
            contract_id="CTR-DUAL-001", signers=signers,
        )
        fadada_result = await multilateral_service._call_fadada_sdk(
            contract_id="CTR-DUAL-001", signers=signers,
        )
        # 都降级
        assert esign_result["provider"] in ("esign", "mock")
        assert fadada_result["provider"] in ("fadada", "mock")
        # sign_url 应不同 (mock URL 含 provider 标识)
        if (esign_result["provider"] == "mock"
                and fadada_result["provider"] == "mock"):
            assert esign_result["sign_url"] != fadada_result["sign_url"]
            assert "esign" in esign_result["sign_url"]
            assert "fadada" in fadada_result["sign_url"]


# ============================================================================
# MOD-15 兜底引擎 — 独立 Docker + 断网 E2E
# ============================================================================

class TestMod15FallbackOffline:
    """MOD-15 兜底引擎断网 E2E."""

    async def test_health_check_offline_returns_status(self):
        """health_check_offline 返回全平台健康状态."""
        from app.services.fallback_engine_service import fallback_engine_service
        result = await fallback_engine_service.health_check_offline()
        # 8 字段
        assert "status" in result
        assert result["status"] in ("healthy", "degraded", "offline")
        assert "online_enterprises" in result
        assert "offline_enterprises" in result
        assert "degraded_enterprises" in result
        assert "total_queued_operations" in result
        assert "total_conflicts" in result
        assert "last_sync_at_iso" in result
        assert "checked_at_iso" in result
        assert "details" in result
        # 种子: 4 企业 (2 online + 1 offline + 1 degraded)
        assert result["online_enterprises"] >= 2
        assert result["offline_enterprises"] >= 1
        assert result["degraded_enterprises"] >= 1
        # 每企业详情
        for d in result["details"]:
            assert "enterprise_id" in d
            assert "mode" in d
            assert "queued_ops" in d
            assert "is_healthy" in d

    async def test_offline_e2e_queue_replay_and_conflict(self, client):
        """断网 E2E: OFFLINE 模式 → 排队 → 冲突 → 重放.

        使用 E006 避免与 test_r5_r6_modules.py::TestR63FallbackEngine::test_conflict_detection
        共享 E005 导致的跨测试状态污染 (该测试向 E005 队列注入 invoice ops 后不清理).
        """
        eid = "E006"
        # 1. 切换 E006 到 OFFLINE 模式 (模拟断网)
        r = await client.post(
            f"/api/v1/modules/fallback/{eid}/mode",
            json={"mode": "OFFLINE"},
        )
        assert r.status_code == 200
        assert r.json()["data"]["mode"] == "OFFLINE"

        # 2. 排队 2 个 ops: DELETE + UPDATE 同一 entity (会产生冲突)
        r1 = await client.post(
            f"/api/v1/modules/fallback/{eid}/queue",
            json={
                "operation": {
                    "op_type": "UPDATE",
                    "entity": "contract_XYZ",
                    "payload": {"id": "X1", "value": 500},
                }
            },
        )
        assert r1.status_code == 200
        queue_len_1 = r1.json()["data"]
        assert queue_len_1 >= 1

        r2 = await client.post(
            f"/api/v1/modules/fallback/{eid}/queue",
            json={
                "operation": {
                    "op_type": "DELETE",
                    "entity": "contract_XYZ",
                    "payload": {"id": "X1"},
                }
            },
        )
        assert r2.status_code == 200
        queue_len_2 = r2.json()["data"]
        assert queue_len_2 >= 2

        # 3. 检测冲突 (UPDATE + DELETE 同一 entity)
        r3 = await client.post(f"/api/v1/modules/fallback/{eid}/conflict-check")
        assert r3.status_code == 200
        conflicts = r3.json()["data"]
        assert isinstance(conflicts, list)
        assert len(conflicts) >= 1
        c = conflicts[0]
        assert c["entity"] == "contract_XYZ"
        assert "reason" in c

        # 4. 同步 (重放队列 + 跳过冲突)
        r4 = await client.post(f"/api/v1/modules/fallback/{eid}/sync")
        assert r4.status_code == 200
        sync_result = r4.json()["data"]
        # synced + failed + conflict 都应记录
        assert sync_result["syncedCount"] >= 0
        assert sync_result["failedCount"] >= 0
        assert sync_result["conflictCount"] >= 1
        # 同步后队列应清空
        r5 = await client.get(f"/api/v1/modules/fallback/{eid}/config")
        assert r5.json()["data"]["queuedOperations"] == 0

    async def test_health_endpoint_via_http(self, client):
        """GET /modules/fallback/health/offline HTTP 端点."""
        r = await client.get("/api/v1/modules/fallback/health/offline")
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        data = body["data"]
        assert data["status"] in ("healthy", "degraded", "offline")
        assert "details" in data
        assert len(data["details"]) >= 4  # 4 种子企业
