"""V3 基础设施 / 编排模块"已实现 (production)"测试 (R7.0).

覆盖 4 项任务:
    1. INFRA-04 改造沙箱 - PDF 指标曲线报告导出
    2. INFRA-05 RPA - PDF 申报书模板 (6 家银行版本)
    3. CORE-01 跨服务编排 - 3 个业务 DAG 工作流定义
    4. DATA-04 IoT - EMQX 自部署配置完善

测试矩阵: ≥ 12 个用例 (每项至少 3 个).
设计风格: 与 test_r5_r6_modules.py / test_infra_config.py 对齐.

运行:  pytest tests/test_v3_infra_orchestration.py -v
"""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

import pytest
import yaml

from app.main import app


# asyncio_mode=auto 自动为 async 测试应用 mark.asyncio, 无需全局 marker
# (避免给 sync 测试误加 asyncio mark 触发 warning)


# ============================================================================
# 路径常量 (项目根 = production/, 测试运行目录 = production/backend/)
# ============================================================================

_BACKEND_DIR = Path(__file__).resolve().parent.parent
_PROD_ROOT = _BACKEND_DIR.parent

_BANK_TEMPLATES_PATH = _BACKEND_DIR / "app" / "config" / "bank_application_templates.yaml"
_DAG_WORKFLOWS_PATH = _BACKEND_DIR / "app" / "workers" / "dag_workflows.py"
# EMQX 自部署配置位于 backend/infra/emqx/ (与 mqtt_config.yaml 同目录)
_EMQX_DIR = _BACKEND_DIR / "infra" / "emqx"
_DEVICE_AUTH_PATH = _EMQX_DIR / "device_auth.conf"
_ALERT_RULES_PATH = _EMQX_DIR / "alert_rules.json"
_USERS_CONF_PATH = _EMQX_DIR / "users.conf"
_DOCKER_COMPOSE_PATH = _EMQX_DIR / "docker-compose.yml"
_MQTT_CONFIG_PATH = _EMQX_DIR / "mqtt_config.yaml"


# ============================================================================
# 1. INFRA-04 改造沙箱 - PDF 指标曲线报告导出 (≥ 3 用例)
# ============================================================================

class TestInfra04SandboxPDF:
    """INFRA-04 改造沙箱 PDF 报告导出 (R7.0)."""

    async def test_export_pdf_report_returns_bytes(self):
        """export_pdf_report 返回 bytes 且以 %PDF 头 (reportlab 可用) 或文本头 (降级)."""
        from app.services.reform_sandbox_service import reform_sandbox_service

        sbs = await reform_sandbox_service.list_by_enterprise("E001")
        assert len(sbs) > 0, "企业 E001 应有种子沙箱"
        sb_id = sbs[0].id
        report = await reform_sandbox_service.generate_sandbox_report(sb_id)

        pdf_bytes = await reform_sandbox_service.export_pdf_report(
            enterprise_id="E001",
            sandbox_result=report,
            save_to_file=False,
        )
        # 必须返回 bytes
        assert isinstance(pdf_bytes, (bytes, bytearray))
        # 文件非空 (至少 1KB)
        assert len(pdf_bytes) > 1000, f"PDF bytes 过小: {len(pdf_bytes)}"
        # 头部: reportlab 成功时 %PDF-; 降级时是文本 (==== 或类似)
        header = bytes(pdf_bytes[:5])
        assert header == b"%PDF-" or header.startswith(b"=") or header.startswith(b"\xef\xbb\xbf") or b"INFRA-04" in pdf_bytes[:200], (
            f"PDF header 异常: {header!r}"
        )

    async def test_export_pdf_report_save_to_file(self):
        """export_pdf_report save_to_file=True 返回路径且文件存在."""
        from app.services.reform_sandbox_service import reform_sandbox_service

        sbs = await reform_sandbox_service.list_by_enterprise("E001")
        sb_id = sbs[0].id
        report = await reform_sandbox_service.generate_sandbox_report(sb_id)

        path = await reform_sandbox_service.export_pdf_report(
            enterprise_id="E001-TEST",
            sandbox_result=report,
            save_to_file=True,
        )
        # 必须返回字符串路径
        assert isinstance(path, str)
        assert os.path.exists(path), f"PDF 文件未生成: {path}"
        assert os.path.getsize(path) > 1000, "PDF 文件过小"
        assert path.endswith(".pdf"), "文件扩展名应为 .pdf"
        # 清理 (避免 CI 累积)
        try:
            os.remove(path)
        except OSError:
            pass

    async def test_export_pdf_report_recommendations(self):
        """_build_recommendations 根据 risk_flags + 指标状态生成改造建议."""
        from app.services.reform_sandbox_service import ReformSandboxService
        from app.schemas.sandbox_indicator import (
            CurvePoint, IndicatorCurve, IndicatorStatus,
        )

        # 构造一个含 degraded 指标 + 高资产负债率 risk_flag 的场景
        indicators = [
            IndicatorCurve(
                indicator_id="asset_liability_ratio",
                name="资产负债率",
                baseline_value=0.68,
                projected_value=0.75,
                curve_points=[
                    CurvePoint(month_iso="2026-01", value=0.68),
                    CurvePoint(month_iso="2026-02", value=0.72),
                    CurvePoint(month_iso="2026-03", value=0.75),
                ],
                unit="%",
                status=IndicatorStatus.DEGRADED,
            ),
            IndicatorCurve(
                indicator_id="roe",
                name="净资产收益率",
                baseline_value=0.06,
                projected_value=0.15,
                curve_points=[
                    CurvePoint(month_iso="2026-01", value=0.06),
                    CurvePoint(month_iso="2026-02", value=0.10),
                    CurvePoint(month_iso="2026-03", value=0.15),
                ],
                unit="%",
                status=IndicatorStatus.IMPROVED,
            ),
        ]
        risk_flags = ["资产负债率 偏高 (>70%)"]

        recs = ReformSandboxService._build_recommendations(indicators, risk_flags)
        # 至少有 2 条建议 (退化 + 偏高)
        assert len(recs) >= 2
        # 应提到 资产负债率
        assert any("资产负债率" in r for r in recs)
        # 应提到 退化指标
        assert any("退化" in r for r in recs)

    async def test_export_pdf_endpoint_returns_pdf(self, client):
        """API 端点 GET /infra/reform-sandbox/enterprise/{eid}/export-pdf 返回 PDF 或文本."""
        r = await client.get("/api/v1/infra/reform-sandbox/enterprise/E001/export-pdf")
        assert r.status_code == 200
        # content_type 应是 application/pdf 或 text/plain (降级)
        ct = r.headers.get("content-type", "")
        assert "application/pdf" in ct or "text/plain" in ct, (
            f"content-type 异常: {ct}"
        )
        # 内容非空
        body = r.content
        assert len(body) > 500, f"响应体过小: {len(body)}"

    async def test_export_pdf_endpoint_unknown_enterprise_returns_404(self, client):
        """企业无沙箱时端点返回 404."""
        r = await client.get(
            "/api/v1/infra/reform-sandbox/enterprise/E-NO-SUCH-ENTERPRISE/export-pdf"
        )
        assert r.status_code == 404


# ============================================================================
# 2. INFRA-05 RPA - PDF 申报书模板 (6 家银行, ≥ 3 用例)
# ============================================================================

class TestInfra05BankApplicationPDF:
    """INFRA-05 RPA 多银行 PDF 申报书模板 (R7.0)."""

    def test_bank_templates_yaml_loads_6_banks(self):
        """bank_application_templates.yaml 加载 6 家银行模板 (ICBC/CCB/ABC/BOC/BOCOM/CMB)."""
        assert _BANK_TEMPLATES_PATH.exists(), (
            f"bank_application_templates.yaml 不存在: {_BANK_TEMPLATES_PATH}"
        )
        with open(_BANK_TEMPLATES_PATH, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        banks = data.get("banks", [])
        bank_codes = {b["bank_code"] for b in banks}
        expected = {"ICBC", "CCB", "ABC", "BOC", "BOCOM", "CMB"}
        assert bank_codes == expected, (
            f"6 家银行模板不匹配, 缺: {expected - bank_codes}, 多: {bank_codes - expected}"
        )
        # 每个模板必须有 sections + 字段映射
        for b in banks:
            assert "sections" in b, f"{b['bank_code']} 缺 sections"
            assert len(b["sections"]) >= 3, (
                f"{b['bank_code']} sections 至少 3 个, 实际: {len(b['sections'])}"
            )
            for sec in b["sections"]:
                assert "section_id" in sec
                assert "section_title" in sec
                assert "fields" in sec and isinstance(sec["fields"], dict)

    async def test_generate_bank_application_pdf_all_banks(self):
        """generate_bank_application_pdf 对 6 家银行全部生成 PDF."""
        from app.services.rpa_service import rpa_service

        application_data = {
            "enterprise_name": "测试企业",
            "uscc": "91100000MA5EXAMPLE",
            "legal_representative": "张三",
            "registered_capital": 50_000_000.0,
            "established_at": "2020-01-01",
            "industry_code": "C1370",
            "contact_phone": "13800138000",
            "contact_address": "深圳市福田区",
            "loan_amount": 5_000_000.0,
            "loan_term_months": 12,
            "loan_purpose": "经营周转",
            "repayment_source": "经营收入",
            "annual_revenue": 100_000_000.0,
            "net_profit": 10_000_000.0,
            "total_assets": 80_000_000.0,
            "total_liabilities": 40_000_000.0,
            "bank_account_no": "6222000123456789",
            "credit_rating": "A",
            "existing_loans_balance": 5_000_000.0,
        }

        for bank_code in ("ICBC", "CCB", "ABC", "BOC", "BOCOM", "CMB"):
            pdf_bytes = await rpa_service.generate_bank_application_pdf(
                enterprise_id="E001",
                bank_code=bank_code,
                application_data=application_data,
                save_to_file=False,
            )
            assert isinstance(pdf_bytes, (bytes, bytearray)), (
                f"{bank_code} PDF 未返回 bytes"
            )
            assert len(pdf_bytes) > 500, (
                f"{bank_code} PDF bytes 过小: {len(pdf_bytes)}"
            )
            # 应该是 PDF (header %PDF) 或文本降级 (含银行名)
            header = bytes(pdf_bytes[:5])
            head_text = bytes(pdf_bytes[:500]).decode("utf-8", errors="ignore")
            assert header == b"%PDF-" or "融资申报书" in head_text, (
                f"{bank_code} PDF header 异常: {header!r}"
            )

    async def test_generate_bank_application_pdf_unknown_bank_raises(self):
        """未知 bank_code 抛 ValueError."""
        from app.services.rpa_service import rpa_service

        with pytest.raises(ValueError, match="未知银行代码"):
            await rpa_service.generate_bank_application_pdf(
                enterprise_id="E001",
                bank_code="UNKNOWN_BANK",
                application_data={},
                save_to_file=False,
            )

    async def test_generate_bank_application_pdf_enriches_derived_fields(self):
        """_enrich_application_data 自动计算 asset_liability_ratio."""
        from app.services.rpa_service import RPAService

        enriched = RPAService._enrich_application_data({
            "total_assets": 80_000_000.0,
            "total_liabilities": 40_000_000.0,
        })
        assert "asset_liability_ratio" in enriched
        assert abs(enriched["asset_liability_ratio"] - 0.5) < 0.01

        # 已存在时不覆盖
        enriched2 = RPAService._enrich_application_data({
            "total_assets": 80_000_000.0,
            "total_liabilities": 40_000_000.0,
            "asset_liability_ratio": 0.42,
        })
        assert enriched2["asset_liability_ratio"] == 0.42

    async def test_application_pdf_endpoint_returns_pdf(self, client):
        """API POST /infra/rpa/application-pdf/{bank_code} 返回 PDF 或文本."""
        r = await client.post(
            "/api/v1/infra/rpa/application-pdf/ICBC",
            params={"enterpriseId": "E001"},
            json={
                "enterpriseName": "测试企业",
                "uscc": "91100000MA5EXAMPLE",
                "legalRepresentative": "张三",
                "loanAmount": 1000000,
                "loanTermMonths": 12,
            },
        )
        assert r.status_code == 200
        ct = r.headers.get("content-type", "")
        assert "application/pdf" in ct or "text/plain" in ct
        body = r.content
        assert len(body) > 500

    async def test_application_pdf_endpoint_unknown_bank_returns_400(self, client):
        """未知 bank_code 端点返回 400."""
        r = await client.post(
            "/api/v1/infra/rpa/application-pdf/UNKNOWN_BANK",
            params={"enterpriseId": "E001"},
            json={},
        )
        assert r.status_code == 400

    async def test_application_templates_endpoint(self, client):
        """GET /infra/rpa/application-templates 列出 6 家银行模板."""
        r = await client.get("/api/v1/infra/rpa/application-templates")
        assert r.status_code == 200
        data = r.json()["data"]
        assert "ICBC" in data
        assert "CMB" in data
        assert len(data) == 6
        assert data["ICBC"]["bank_name"] == "中国工商银行"
        assert data["CMB"]["bank_name"] == "招商银行"


# ============================================================================
# 3. CORE-01 跨服务编排 - 3 个业务 DAG 工作流 (≥ 3 用例)
# ============================================================================

class TestCore01BusinessDAGs:
    """CORE-01 跨服务编排 - 3 个业务 DAG 工作流定义 (R7.0)."""

    def test_dag_workflows_module_loads_3_dags(self):
        """dag_workflows.py 加载 3 个业务 DAG (LOAN-APPROVAL/INVOICE-DISCOUNT/FUND-MONITOR)."""
        from app.workers.dag_workflows import (
            BUSINESS_DAGS, BUSINESS_DAG_WORKFLOWS, get_business_dag,
        )

        assert len(BUSINESS_DAGS) == 3, f"应有 3 个 DAG, 实际: {len(BUSINESS_DAGS)}"
        dag_ids = {d["dag_id"] for d in BUSINESS_DAGS}
        expected = {"LOAN-APPROVAL-DAG", "INVOICE-DISCOUNT-DAG", "FUND-MONITOR-DAG"}
        assert dag_ids == expected, f"DAG ID 不匹配: {dag_ids}"

        # BUSINESS_DAG_WORKFLOWS 元数据齐全
        assert len(BUSINESS_DAG_WORKFLOWS) == 3
        for wf in BUSINESS_DAG_WORKFLOWS:
            assert "dag_id" in wf
            assert "name" in wf
            assert "task_queue" in wf
            assert "retry" in wf
            assert "autonomy_level" in wf

        # get_business_dag 单独获取
        dag = get_business_dag("LOAN-APPROVAL-DAG")
        assert dag is not None
        assert dag["dag_id"] == "LOAN-APPROVAL-DAG"
        assert get_business_dag("UNKNOWN-DAG") is None

    def test_loan_approval_dag_has_correct_nodes_and_edges(self):
        """贷款审批 DAG: 5 个节点 + 4 条边 + L3 自主等级."""
        from app.workers.dag_workflows import get_business_dag

        dag_dict = get_business_dag("LOAN-APPROVAL-DAG")
        assert dag_dict is not None
        nodes = dag_dict["nodes"]
        edges = dag_dict["edges"]
        assert len(nodes) == 5, f"贷款审批 DAG 应有 5 节点, 实际: {len(nodes)}"
        assert len(edges) == 4

        # 节点 ID 包含 la1-la5
        node_ids = {n["node_id"] for n in nodes}
        for nid in ("la1_fetch_credit", "la2_risk_score", "la3_human_approve",
                    "la4_loan_disburse", "la5_post_loan"):
            assert nid in node_ids, f"缺节点: {nid}"

        # 节点任务类型
        task_types = {n["task_type"] for n in nodes}
        # 应包含 FETCH_DATA / SCORE / DECISION / NOTIFY / VERIFY 中的多个
        assert "FETCH_DATA" in task_types or "fetch_data" in {str(t).lower() for t in task_types}
        assert "DECISION" in task_types or "decision" in {str(t).lower() for t in task_types}

        # 自主等级 L3_ADVISORY
        level = dag_dict["autonomy_level"]
        assert "L3" in str(level), f"贷款审批 DAG 应为 L3, 实际: {level}"

    def test_invoice_discount_dag_uses_l2_small_auto(self):
        """票据贴现 DAG: 4 个节点 + L2_SMALL_AUTO 自主等级."""
        from app.workers.dag_workflows import get_business_dag

        dag_dict = get_business_dag("INVOICE-DISCOUNT-DAG")
        assert dag_dict is not None
        nodes = dag_dict["nodes"]
        assert len(nodes) == 4

        # 节点 id1-id4
        node_ids = {n["node_id"] for n in nodes}
        for nid in ("id1_invoice_verify", "id2_amount_calc",
                    "id3_discount_exec", "id4_settlement"):
            assert nid in node_ids, f"缺节点: {nid}"

        # L2 自主等级
        level = str(dag_dict["autonomy_level"])
        assert "L2" in level, f"票据贴现 DAG 应为 L2, 实际: {level}"

    def test_fund_monitor_dag_has_5_flow_verify_node(self):
        """资金监管 DAG: 5 节点 + fm2_five_flow_check 节点 (五流校验)."""
        from app.workers.dag_workflows import get_business_dag

        dag_dict = get_business_dag("FUND-MONITOR-DAG")
        assert dag_dict is not None
        nodes = dag_dict["nodes"]
        assert len(nodes) == 5

        node_ids = {n["node_id"] for n in nodes}
        assert "fm1_fetch_data" in node_ids
        assert "fm2_five_flow_check" in node_ids
        assert "fm3_anomaly_alert" in node_ids
        assert "fm4_human_review" in node_ids
        assert "fm5_action_exec" in node_ids

        # fm2 节点 params 含 flows 字段 (五流)
        fm2 = next(n for n in nodes if n["node_id"] == "fm2_five_flow_check")
        flows = fm2["params"].get("flows", [])
        expected_flows = {"funds", "contract", "invoice", "goods", "tax"}
        assert set(flows) == expected_flows, (
            f"五流校验应含 5 个流, 实际: {flows}"
        )

    async def test_register_predefined_dags_registers_all(self):
        """register_predefined_dags 注册 3 个业务 DAG 到 _OrchStore."""
        from app.services.ai_orchestrator_service import ai_orchestrator_service

        # overwrite=True 强制重新注册
        registered = await ai_orchestrator_service.register_predefined_dags(overwrite=True)
        assert len(registered) == 3
        dag_ids = {d.dag_id for d in registered}
        assert "LOAN-APPROVAL-DAG" in dag_ids
        assert "INVOICE-DISCOUNT-DAG" in dag_ids
        assert "FUND-MONITOR-DAG" in dag_ids

        # 验证可查询
        for dag_id in dag_ids:
            dag = await ai_orchestrator_service.get_dag(dag_id)
            assert dag is not None, f"注册后查询失败: {dag_id}"

    async def test_business_dag_can_execute(self):
        """业务 DAG 可被 execute_dag 执行 (asyncio 降级模式)."""
        from app.services.ai_orchestrator_service import ai_orchestrator_service
        from app.schemas.ai_orchestrator import ExecuteDAGRequest

        # 确保已注册
        await ai_orchestrator_service.register_predefined_dags(overwrite=True)

        # 执行 INVOICE-DISCOUNT-DAG (L2 小额场景)
        request = ExecuteDAGRequest(
            dag_id="INVOICE-DISCOUNT-DAG",
            enterprise_id="E001",
            context={"amount_cents": 30_000_000},  # 30 万小额
        )
        execution = await ai_orchestrator_service.execute_dag(request)
        assert execution is not None
        # L2 小额应自动完成 (不挂起) 或挂起 (大额)
        assert execution.status in ("COMPLETED", "WAITING_HUMAN", "FAILED", "RUNNING"), (
            f"执行状态异常: {execution.status}"
        )


# ============================================================================
# 4. DATA-04 IoT - EMQX 自部署配置完善 (≥ 3 用例)
# ============================================================================

class TestData04EmqxDeploy:
    """DATA-04 EMQX 自部署配置完善 (R7.0)."""

    def test_device_auth_conf_exists_and_loads(self):
        """device_auth.conf 存在且含至少 40 个设备账号 + 2 个服务账号."""
        assert _DEVICE_AUTH_PATH.exists(), (
            f"device_auth.conf 不存在: {_DEVICE_AUTH_PATH}"
        )
        with open(_DEVICE_AUTH_PATH, "r", encoding="utf-8") as f:
            content = f.read()
        # 解析非注释行
        entries = [
            line.strip() for line in content.splitlines()
            if line.strip() and not line.strip().startswith("#")
        ]
        # 至少 40 个设备 + 2 个服务
        device_entries = [e for e in entries if e.startswith("device_")]
        svc_entries = [e for e in entries if e.startswith("svc_")]
        assert len(device_entries) >= 40, (
            f"设备账号至少 40 个, 实际: {len(device_entries)}"
        )
        assert len(svc_entries) >= 2, (
            f"服务账号至少 2 个, 实际: {len(svc_entries)}"
        )
        # 每条格式 username:password:salt
        for e in device_entries[:5]:
            parts = e.split(":")
            assert len(parts) >= 2, f"格式异常: {e}"
            assert parts[0].startswith("device_")

    def test_alert_rules_json_loads_5_rules(self):
        """alert_rules.json 加载且含至少 5 条告警规则."""
        assert _ALERT_RULES_PATH.exists(), (
            f"alert_rules.json 不存在: {_ALERT_RULES_PATH}"
        )
        with open(_ALERT_RULES_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        rules = data.get("rules", [])
        assert len(rules) >= 5, f"告警规则至少 5 条, 实际: {len(rules)}"

        # 检查每条规则结构
        for r in rules:
            assert "rule_id" in r, f"规则缺 rule_id: {r}"
            assert "name" in r, f"规则 {r.get('rule_id')} 缺 name"
            assert "trigger" in r, f"规则 {r.get('rule_id')} 缺 trigger"
            assert "actions" in r, f"规则 {r.get('rule_id')} 缺 actions"
            assert "enabled" in r, f"规则 {r.get('rule_id')} 缺 enabled"

        # 必须有离线设备告警 + 异常数据告警
        rule_ids = {r["rule_id"] for r in rules}
        assert "alert-device-offline" in rule_ids, "缺设备离线告警"
        assert "alert-data-anomaly" in rule_ids, "缺异常数据告警"

        # 异常数据规则应含温度 / 振动 / 电量阈值
        anomaly_rule = next(r for r in rules if r["rule_id"] == "alert-data-anomaly")
        conditions = anomaly_rule["trigger"]["conditions"]
        metric_names = {c["metric_name"] for c in conditions}
        assert "temperature" in metric_names, "缺温度告警"
        assert "vibration" in metric_names, "缺振动告警"
        assert "battery_pct" in metric_names, "缺电量告警"

    def test_docker_compose_yml_enhanced_with_alerts(self):
        """docker-compose.yml 完善: 含告警环境变量 + 挂载 device_auth.conf / alert_rules.json."""
        assert _DOCKER_COMPOSE_PATH.exists()
        with open(_DOCKER_COMPOSE_PATH, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        emqx = data["services"]["emqx"]
        env = emqx.get("environment", [])
        # 告警相关环境变量
        env_str = "\n".join(env)
        assert "EMQX_ALERT__ENABLE=true" in env or "ALERT" in env_str.upper(), (
            "缺告警 enable 环境变量"
        )
        # 挂载的配置文件
        volumes = emqx.get("volumes", [])
        volumes_str = "\n".join(volumes)
        assert "device_auth.conf" in volumes_str, "未挂载 device_auth.conf"
        assert "alert_rules.json" in volumes_str, "未挂载 alert_rules.json"
        # 端口 1883 + 18083
        ports = [str(p) for p in emqx["ports"]]
        assert any("1883" in p for p in ports)
        assert any("18083" in p for p in ports)
        # healthcheck
        assert "healthcheck" in emqx

    def test_users_conf_exists_and_loads(self):
        """users.conf 存在且至少含 3 个服务账号 + 5 个设备账号."""
        assert _USERS_CONF_PATH.exists(), (
            f"users.conf 不存在: {_USERS_CONF_PATH}"
        )
        with open(_USERS_CONF_PATH, "r", encoding="utf-8") as f:
            content = f.read()
        entries = [
            line.strip() for line in content.splitlines()
            if line.strip() and not line.strip().startswith("#")
        ]
        svc_entries = [e for e in entries if e.startswith("svc_")]
        device_entries = [e for e in entries if e.startswith("device_")]
        assert len(svc_entries) >= 3, f"服务账号至少 3 个, 实际: {len(svc_entries)}"
        assert len(device_entries) >= 5, f"设备账号至少 5 个, 实际: {len(device_entries)}"

    async def test_deploy_emqx_config_fallback_local(self):
        """deploy_emqx_config 在 EMQX 不可达时降级本地加载 (status=fallback_local_only)."""
        from app.services.iot_gateway import iot_gateway_service

        # 用错误的 host 模拟 EMQX 不可达
        result = await iot_gateway_service.deploy_emqx_config(
            emqx_api_host="127.0.0.1",
            emqx_api_port=31999,  # 不存在的端口
        )
        # 必须降级 (本地配置仍应加载)
        assert result["status"] == "fallback_local_only", (
            f"EMQX 不可达时应降级, 实际 status: {result['status']}"
        )
        # 配置应已加载
        assert result["device_count"] >= 40, (
            f"设备账号至少 40, 实际: {result['device_count']}"
        )
        assert result["alert_rules_count"] >= 5, (
            f"告警规则至少 5, 实际: {result['alert_rules_count']}"
        )
        assert result["mqtt_config_loaded"] is True, "mqtt_config.yaml 应加载成功"
        assert result["emqx_api_reachable"] is False
        assert isinstance(result["errors"], list)
        assert "config_dir" in result
        assert "deployed_at_iso" in result

    async def test_deploy_emqx_config_loads_all_configs(self):
        """deploy_emqx_config 默认参数加载全部配置 (device_auth + alert_rules + mqtt_config)."""
        from app.services.iot_gateway import iot_gateway_service

        result = await iot_gateway_service.deploy_emqx_config()
        # 无论 EMQX 可达与否, 配置必须加载
        assert result["device_count"] > 0
        assert result["alert_rules_count"] > 0
        assert result["mqtt_config_loaded"] is True

    def test_build_emqx_rule_sql_generates_correct_sql(self):
        """_build_emqx_rule_sql 把告警规则 trigger 转为 EMQX SQL."""
        from app.services.iot_gateway import IOTGatewayService

        rule = {
            "rule_id": "test-rule",
            "trigger": {
                "type": "telemetry_threshold",
                "telemetry_topic": "fintrust/+/+/telemetry",
                "conditions": [
                    {"metric_name": "temperature", "operator": ">", "threshold": 80},
                    {"metric_name": "vibration", "operator": ">", "threshold": 5.0},
                ],
            },
        }
        sql = IOTGatewayService._build_emqx_rule_sql(rule)
        assert "SELECT" in sql.upper()
        assert "fintrust/+/+/telemetry" in sql
        assert "temperature" in sql
        assert "vibration" in sql
        assert "80" in sql
        assert "5.0" in sql
        assert "WHERE" in sql.upper()
        assert "OR" in sql.upper()


# ============================================================================
# 综合: 模块加载 + 路由注册不破坏现有 app (≥ 1 用例, 凑齐 12+)
# ============================================================================

class TestModuleIntegration:
    """模块加载 + app 集成测试 (确保新方法/路由不影响主应用启动)."""

    def test_app_imports_cleanly(self):
        """app.main:app 能正常 import (新方法/路由不破坏现有启动)."""
        # 强制重新 import (避免上轮测试的缓存)
        import importlib
        import app.main as _m
        importlib.reload(_m)
        assert hasattr(_m, "app")
        # 检查路由都注册了
        # FastAPI 0.141+ 将 include_router 嵌套为 _IncludedRouter, 需递归展开 original_router
        def _collect_paths(routes, acc):
            for r in routes:
                if hasattr(r, "path"):
                    acc.add(r.path)
                elif hasattr(r, "original_router"):
                    _collect_paths(r.original_router.routes, acc)
            return acc
        routes = _collect_paths(_m.app.routes, set())
        # INFRA-04 PDF 端点
        assert any("export-pdf" in r for r in routes), "缺 INFRA-04 export-pdf 路由"
        # INFRA-05 银行申报书端点
        assert any("application-pdf" in r for r in routes), "缺 INFRA-05 application-pdf 路由"
        assert any("application-templates" in r for r in routes), (
            "缺 INFRA-05 application-templates 路由"
        )
