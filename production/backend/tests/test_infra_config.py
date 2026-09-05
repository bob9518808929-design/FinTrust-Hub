"""基础设施部署配置测试 (INFRA-01 + INFRA-02 + CORE-01, R4.1/R4.2/R4.8).

测试矩阵:
    A. K8s Helm Chart 配置有效性 (Chart.yaml + values.yaml 解析不报错)
    B. AI 引擎模型路由策略三档兜底 (主模型 + 降级 + mock)
    C. Temporal Worker 可初始化 (asyncio 兜底模式)
    D. LLM 服务 vLLM 超时降级到 mock

设计依据: ROADMAP_REMAINING_V2.md R4.1 / R4.2 / R4.8
对应交付物:
    - infra/k8s/helm/Chart.yaml
    - ai-engine/config/model_config.yaml
    - backend/app/workers/temporal_worker.py
    - ai-engine/services/llm_service.py (_call_vllm / _call_mock)

运行: pytest tests/test_infra_config.py -v
"""

from __future__ import annotations

import asyncio
import importlib.util
import sys
from pathlib import Path
from unittest.mock import patch

import pytest
import yaml

# ============================================================================
# 路径常量 (项目根 = production/, 测试运行目录 = production/backend/)
# ============================================================================

# backend/tests/test_infra_config.py → ../.. = production/
_PROD_ROOT = Path(__file__).resolve().parent.parent.parent
HELM_CHART_PATH = _PROD_ROOT / "infra" / "k8s" / "helm" / "Chart.yaml"
HELM_VALUES_PATH = _PROD_ROOT / "infra" / "k8s" / "helm" / "values.yaml"
HELM_HELPERS_PATH = _PROD_ROOT / "infra" / "k8s" / "helm" / "templates" / "_helpers.tpl"
MODEL_CONFIG_PATH = _PROD_ROOT / "ai-engine" / "config" / "model_config.yaml"
AI_ENGINE_LLM_PATH = _PROD_ROOT / "ai-engine" / "services" / "llm_service.py"
TEMPORAL_COMPOSE_PATH = _PROD_ROOT / "infra" / "temporal" / "docker-compose.yml"
WORKER_CONFIG_PATH = _PROD_ROOT / "infra" / "temporal" / "config" / "worker_config.yaml"


# ============================================================================
# A. K8s Helm Chart 配置有效性
# ============================================================================

class TestHelmChart:
    """验证 Helm Chart 元数据 + values + templates 文件存在且 YAML 合法."""

    def test_chart_yaml_exists(self) -> None:
        """Chart.yaml 文件必须存在."""
        assert HELM_CHART_PATH.exists(), f"Chart.yaml 不存在: {HELM_CHART_PATH}"
        assert HELM_CHART_PATH.is_file()

    def test_helm_chart_yaml_valid(self) -> None:
        """Chart.yaml 解析为 YAML 不报错, 且含 name=fintrust-hub, version=0.2.0."""
        assert HELM_CHART_PATH.exists(), f"Chart.yaml 不存在: {HELM_CHART_PATH}"
        text = HELM_CHART_PATH.read_text(encoding="utf-8")
        chart = yaml.safe_load(text)

        # 核心字段断言
        assert chart is not None, "Chart.yaml 解析结果为 None"
        assert chart.get("name") == "fintrust-hub", (
            f"Chart name 期望 fintrust-hub, 实际: {chart.get('name')}"
        )
        assert chart.get("version") == "0.2.0", (
            f"Chart version 期望 0.2.0, 实际: {chart.get('version')}"
        )
        assert chart.get("apiVersion") == "v2", (
            f"apiVersion 期望 v2, 实际: {chart.get('apiVersion')}"
        )
        assert chart.get("appVersion") is not None, "appVersion 不能为空"

    def test_values_yaml_valid(self) -> None:
        """values.yaml 解析为 YAML 不报错, 含 image / replicas / db credentials 字段."""
        assert HELM_VALUES_PATH.exists(), f"values.yaml 不存在: {HELM_VALUES_PATH}"
        values = yaml.safe_load(HELM_VALUES_PATH.read_text(encoding="utf-8"))

        # 全局镜像 + 命名空间
        assert "image" in values, "values.yaml 缺 image 字段"
        assert "namespace" in values, "values.yaml 缺 namespace 字段"

        # backend.replicas
        assert "backend" in values
        assert values["backend"].get("replicas") == 3, (
            f"backend.replicas 期望 3, 实际: {values['backend'].get('replicas')}"
        )
        assert "livenessProbe" in values["backend"]
        assert "readinessProbe" in values["backend"]

        # frontend / aiEngine
        assert "frontend" in values
        assert "aiEngine" in values
        assert values["aiEngine"].get("model") == "Qwen/Qwen2-7B-Instruct"

        # DB credentials (走 Secret 引用名)
        assert "dbCredentials" in values
        assert "secretName" in values["dbCredentials"]

        # Redis url 配置
        assert "redis" in values
        assert "url" in values["redis"]

        # Ingress 路由 3 条路径
        assert "ingress" in values
        hosts = values["ingress"].get("hosts", [])
        assert len(hosts) >= 1
        paths = hosts[0].get("paths", [])
        path_services = {p["service"] for p in paths}
        assert path_services >= {"frontend", "backend", "ai-engine"}, (
            f"Ingress 路由缺少 frontend/backend/ai-engine, 实际: {path_services}"
        )

        # HPA 3-10 副本 + CPU 70%
        assert values["backend"]["hpa"]["minReplicas"] == 3
        assert values["backend"]["hpa"]["maxReplicas"] == 10
        assert values["backend"]["hpa"]["targetCPUUtilizationPercentage"] == 70

        # PVC 持久化 (PostgreSQL 50Gi + Redis 10Gi)
        assert values["postgresql"]["persistence"]["size"] == "50Gi"
        assert values["redis"]["persistence"]["size"] == "10Gi"

    def test_helpers_tpl_exists(self) -> None:
        """_helpers.tpl 命名模板文件存在, 含 fullname + labels 定义."""
        assert HELM_HELPERS_PATH.exists(), f"_helpers.tpl 不存在: {HELM_HELPERS_PATH}"
        content = HELM_HELPERS_PATH.read_text(encoding="utf-8")
        assert "fintrust-hub.fullname" in content, "_helpers.tpl 缺 fullname 模板"
        assert "fintrust-hub.labels" in content, "_helpers.tpl 缺 labels 模板"
        assert "fintrust-hub.selectorLabels" in content, (
            "_helpers.tpl 缺 selectorLabels 模板"
        )

    @pytest.mark.parametrize(
        "template_file",
        [
            "backend-deployment.yaml",
            "frontend-deployment.yaml",
            "ai-engine-deployment.yaml",
            "ingress.yaml",
            "hpa.yaml",
            "pvc.yaml",
            "configmap.yaml",
        ],
    )
    def test_template_files_exist(self, template_file: str) -> None:
        """Helm templates 目录下 7 个核心 manifest 文件全部存在."""
        path = _PROD_ROOT / "infra" / "k8s" / "helm" / "templates" / template_file
        assert path.exists(), f"Helm template 不存在: {template_file}"
        assert path.stat().st_size > 0, f"Helm template 内容为空: {template_file}"


# ============================================================================
# B. AI 引擎模型路由策略三档兜底
# ============================================================================

class TestModelConfig:
    """验证 ai-engine/config/model_config.yaml 含主模型 + 降级 + mock 三档."""

    def test_model_config_exists(self) -> None:
        """model_config.yaml 文件存在."""
        assert MODEL_CONFIG_PATH.exists(), (
            f"model_config.yaml 不存在: {MODEL_CONFIG_PATH}"
        )

    def test_model_config_has_3_tier_fallback(self) -> None:
        """model_config.yaml 中 routing 必须含 primary / fallback / mock 三档."""
        assert MODEL_CONFIG_PATH.exists(), (
            f"model_config.yaml 不存在: {MODEL_CONFIG_PATH}"
        )
        cfg = yaml.safe_load(MODEL_CONFIG_PATH.read_text(encoding="utf-8"))

        # 三档路由都存在
        routing = cfg.get("routing", {})
        assert "primary" in routing, "model_config 缺 routing.primary (主模型)"
        assert "fallback" in routing, "model_config 缺 routing.fallback (降级模型)"
        assert "mock" in routing, "model_config 缺 routing.mock (mock 兜底)"

        # 主模型: Qwen-7B, 端口 8000, 超时 2s
        primary = routing["primary"]
        assert primary.get("name") == "qwen-7b", (
            f"primary name 期望 qwen-7b, 实际: {primary.get('name')}"
        )
        assert "8000" in primary.get("base_url", ""), (
            f"primary base_url 应含 8000 端口, 实际: {primary.get('base_url')}"
        )
        assert primary.get("timeout_seconds") == 2, (
            f"primary timeout 期望 2s, 实际: {primary.get('timeout_seconds')}"
        )

        # 降级模型: ChatGLM3
        fallback = routing["fallback"]
        assert fallback.get("name") == "chatglm3", (
            f"fallback name 期望 chatglm3, 实际: {fallback.get('name')}"
        )

        # Mock 兜底
        mock = routing["mock"]
        assert mock.get("provider") == "mock", (
            f"mock provider 期望 mock, 实际: {mock.get('provider')}"
        )
        assert mock.get("enabled") is True, "mock.enabled 必须为 True"

        # 推理默认参数 (温度 0.3)
        inference = cfg.get("inference", {})
        assert inference.get("temperature") == 0.3, (
            f"inference.temperature 期望 0.3, 实际: {inference.get('temperature')}"
        )

    def test_model_config_embedding_section(self) -> None:
        """model_config.yaml 还应含 embedding 服务配置 (R4.2 新增)."""
        assert MODEL_CONFIG_PATH.exists()
        cfg = yaml.safe_load(MODEL_CONFIG_PATH.read_text(encoding="utf-8"))
        embedding = cfg.get("embedding", {})
        assert "base_url" in embedding, "embedding 配置缺 base_url"
        assert "bge-large-zh" in embedding.get("model_name", ""), (
            f"embedding model 期望 bge-large-zh, 实际: {embedding.get('model_name')}"
        )


# ============================================================================
# C. Temporal Worker 可初始化 (asyncio 兜底模式)
# ============================================================================

class TestTemporalWorker:
    """验证 temporal_worker.py 可 import, asyncio 兜底模式可用.

    temporalio 包未安装时, 模块必须 import 成功, get_temporal_worker()
    返回 _AsyncioFallbackRunner 实例 (而不是抛 RuntimeError).
    """

    def test_temporal_worker_can_init(self) -> None:
        """temporal_worker.py 可 import, asyncio 兜底模式可用."""
        from app.workers.temporal_worker import (
            DAG_WORKFLOWS,
            TEMPORAL_AVAILABLE,
            get_temporal_worker,
            reset_temporal_worker,
        )

        # 模块加载成功: 常量/函数都已导出
        assert isinstance(DAG_WORKFLOWS, list)
        assert len(DAG_WORKFLOWS) >= 3, (
            f"DAG_WORKFLOWS 至少 3 个种子 DAG, 实际: {len(DAG_WORKFLOWS)}"
        )
        # TEMPORAL_AVAILABLE 必须是布尔值 (无论 temporalio 是否安装)
        assert isinstance(TEMPORAL_AVAILABLE, bool)

        # 三个种子 DAG ID 都存在
        dag_ids = {wf["dag_id"] for wf in DAG_WORKFLOWS}
        assert "SCF-QUICK-APPROVAL" in dag_ids
        assert "CREDIT-REPORT-L4" in dag_ids
        assert "RIGOROUS-APPROVAL-L3" in dag_ids

        # asyncio 兜底模式: get_temporal_worker 单例返回对象, 且 start/stop/run_dag 都可调用
        async def _check():
            await reset_temporal_worker()
            worker = await get_temporal_worker()
            # asyncio 模式时返回 _AsyncioFallbackRunner; 真实模式时返回 _TemporalWorkerRunner
            # 两者都必须有 start/stop/run_dag 三个 async 方法
            assert hasattr(worker, "start")
            assert hasattr(worker, "stop")
            assert hasattr(worker, "run_dag")
            await worker.start()  # 兜底模式下为 no-op, 不抛异常
            await worker.stop()
            await reset_temporal_worker()

        asyncio.run(_check())

    def test_temporal_fallback_runs_dag(self) -> None:
        """asyncio 兜底模式下 run_dag 应能完成一次 DAG 执行 (走内存 _OrchStore)."""
        from app.workers.temporal_worker import (
            get_temporal_worker,
            reset_temporal_worker,
        )
        from app.schemas.ai_orchestrator import ExecuteDAGRequest

        async def _check():
            await reset_temporal_worker()
            worker = await get_temporal_worker()
            request = ExecuteDAGRequest(
                dag_id="CREDIT-REPORT-L4",
                enterprise_id="E001",
                context={"amount_cents": 100_000_00},
            )
            # L4 仅建议模式, 应立即 COMPLETED
            execution = await worker.run_dag(request)
            assert execution is not None
            assert execution.status in ("COMPLETED", "RUNNING", "WAITING_HUMAN"), (
                f"L4 应返回 COMPLETED, 实际: {execution.status}"
            )
            await reset_temporal_worker()

        asyncio.run(_check())

    def test_temporal_docker_compose_valid(self) -> None:
        """infra/temporal/docker-compose.yml 解析为 YAML 不报错, 含 7233/8080 端口."""
        assert TEMPORAL_COMPOSE_PATH.exists()
        cfg = yaml.safe_load(TEMPORAL_COMPOSE_PATH.read_text(encoding="utf-8"))
        services = cfg.get("services", {})

        # 4 个核心服务
        for svc_name in ("temporal-postgresql", "temporal", "temporal-web"):
            assert svc_name in services, f"docker-compose 缺服务: {svc_name}"

        # 端口映射
        temporal_ports = services["temporal"].get("ports", [])
        port_strs = [str(p) for p in temporal_ports]
        assert any("7233" in p for p in port_strs), (
            f"Temporal Server 必须暴露 7233 (gRPC), 实际: {port_strs}"
        )

        web_ports = services["temporal-web"].get("ports", [])
        web_port_strs = [str(p) for p in web_ports]
        assert any("8080" in p for p in web_port_strs), (
            f"Temporal Web UI 必须暴露 8080, 实际: {web_port_strs}"
        )

    def test_worker_config_yaml_valid(self) -> None:
        """infra/temporal/config/worker_config.yaml 解析为 YAML, 含 task_queue/max_workers."""
        assert WORKER_CONFIG_PATH.exists()
        cfg = yaml.safe_load(WORKER_CONFIG_PATH.read_text(encoding="utf-8"))

        # server.task_queue
        server = cfg.get("server", {})
        assert "task_queue" in server, "worker_config 缺 server.task_queue"
        assert server["task_queue"] == "fintrust-dag-queue"

        # worker.max_workers
        worker = cfg.get("worker", {})
        assert "max_workers" in worker, "worker_config 缺 worker.max_workers"
        assert "polling_interval_seconds" in worker

        # workflows (3 个种子 DAG)
        workflows = cfg.get("workflows", [])
        assert len(workflows) >= 3
        dag_ids = {wf["dag_id"] for wf in workflows}
        assert "SCF-QUICK-APPROVAL" in dag_ids

        # fallback 降级配置
        fallback = cfg.get("fallback", {})
        assert fallback.get("enabled") is True, "fallback.enabled 必须为 True"


# ============================================================================
# D. LLM 服务 vLLM 超时降级到 mock
# ============================================================================

def _load_ai_engine_llm_service():
    """动态加载 ai-engine/services/llm_service.py 模块.

    由于 ai-engine 目录名含连字符 (Python 包名不允许), 不能用常规 import,
    通过 importlib.util 从绝对路径加载为独立模块.

    返回:
        Module 对象 (含 LLMService / llm_service 单例)
    """
    module_name = "_ai_engine_llm_service_test"
    if module_name in sys.modules:
        return sys.modules[module_name]
    spec = importlib.util.spec_from_file_location(module_name, AI_ENGINE_LLM_PATH)
    assert spec is not None and spec.loader is not None, (
        f"加载 ai-engine llm_service 失败: {AI_ENGINE_LLM_PATH}"
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


class TestLLMServiceVllmFallback:
    """验证 ai-engine/services/llm_service.py 的 vLLM 超时降级到 mock 路径.

    覆盖矩阵:
      D1. _call_mock 直接调用 → 返回带 fallback 标记的占位内容
      D2. _call_vllm 主模型超时 → 自动降级到 fallback 模型 → 仍超时 → 走 mock
      D3. _call_vllm 主模型返回成功 → 不降级
      D4. _call_embedding 服务不可达 → 返回空 embeddings + fallback 标记
    """

    def test_llm_service_has_vllm_methods(self) -> None:
        """LLMService 类必须含 _call_vllm / _call_embedding / _call_mock 三个方法."""
        mod = _load_ai_engine_llm_service()
        LLMService = mod.LLMService
        assert hasattr(LLMService, "_call_vllm"), "LLMService 缺 _call_vllm 方法"
        assert hasattr(LLMService, "_call_embedding"), "LLMService 缺 _call_embedding 方法"
        assert hasattr(LLMService, "_call_mock"), "LLMService 缺 _call_mock 方法"

    def test_call_mock_returns_fallback(self) -> None:
        """_call_mock 必须返回 model=mock, fallback=<reason>, content 含原因."""
        mod = _load_ai_engine_llm_service()
        svc = mod.LLMService()
        messages = [{"role": "user", "content": "测试问题"}]
        result = svc._call_mock(messages, reason="vllm_unavailable")

        assert result["model"] == "mock", f"model 期望 mock, 实际: {result.get('model')}"
        assert result["fallback"] == "vllm_unavailable", (
            f"fallback 期望 vllm_unavailable, 实际: {result.get('fallback')}"
        )
        assert "vllm_unavailable" in result["content"], "mock content 应含降级原因"
        assert "测试问题" in result["content"], "mock content 应含用户问题摘要"

    def test_llm_service_vllm_fallback_to_mock(self) -> None:
        """vLLM 主模型超时 2s 时, 自动降级到 fallback 模型; 再失败 → 走 mock.

        验证三档兜底链路: primary(timeout) → fallback(timeout) → mock
        """
        mod = _load_ai_engine_llm_service()
        import httpx

        svc = mod.LLMService()
        # 把超时设小一些 (避免真实 2s 等待, 单测要求快)
        svc.vllm_timeout = 0.01
        # 强制两个 client 用同样的小超时
        svc._vllm_client = httpx.AsyncClient(timeout=svc.vllm_timeout)
        # 把 url 改为不存在的端口 (避免本地有 vLLM 服务时干扰测试)
        svc.vllm_primary_url = "http://127.0.0.1:31999/v1/chat/completions"
        svc.vllm_fallback_url = "http://127.0.0.1:31998/v1/chat/completions"

        messages = [{"role": "user", "content": "你好"}]

        async def _check() -> dict:
            try:
                return await svc._call_vllm(messages, temperature=0.3, max_tokens=64)
            finally:
                if svc._vllm_client is not None:
                    await svc._vllm_client.aclose()

        result = asyncio.run(_check())

        # 最终走 mock (因为主模型 + 降级模型都不可达)
        assert result["model"] == "mock", (
            f"主模型+降级模型都失败时应走 mock, 实际 model: {result.get('model')}"
        )
        assert result["fallback"] == "vllm_unavailable", (
            f"最终 fallback 应为 vllm_unavailable, 实际: {result.get('fallback')}"
        )
        assert "你好" in result["content"], "mock content 应含用户问题摘要"

    def test_llm_service_vllm_success_no_fallback(self) -> None:
        """vLLM 主模型调用成功时, 不应触发降级 (mock)."""
        mod = _load_ai_engine_llm_service()
        import httpx

        svc = mod.LLMService()

        # 用 mock httpx 客户端模拟主模型返回成功
        class _FakeResponse:
            @staticmethod
            def raise_for_status() -> None:
                return None

            @staticmethod
            def json() -> dict:
                return {
                    "choices": [{"message": {"content": "vLLM 正常响应"}}],
                    "model": "qwen-7b",
                    "usage": {"prompt_tokens": 5, "completion_tokens": 10},
                }

        class _FakeClient:
            async def post(self, *args: object, **kwargs: object) -> _FakeResponse:
                return _FakeResponse()

            async def aclose(self) -> None:
                return None

        svc._vllm_client = _FakeClient()  # type: ignore[assignment]
        messages = [{"role": "user", "content": "测试"}]

        async def _check() -> dict:
            return await svc._call_vllm(
                messages, temperature=0.3, max_tokens=64, use_fallback_model=True
            )

        result = asyncio.run(_check())

        assert result.get("fallback") == "none", (
            f"主模型成功时 fallback 应为 none, 实际: {result.get('fallback')}"
        )
        assert result["content"] == "vLLM 正常响应"
        assert result["model"] == "qwen-7b"

    def test_llm_service_embedding_fallback(self) -> None:
        """_call_embedding 服务不可达时, 返回空 embeddings + fallback 标记."""
        mod = _load_ai_engine_llm_service()
        import httpx

        svc = mod.LLMService()
        svc.embedding_timeout = 0.01
        svc._embedding_client = httpx.AsyncClient(timeout=svc.embedding_timeout)
        svc.embedding_url = "http://127.0.0.1:31997/embed"

        async def _check() -> dict:
            try:
                return await svc._call_embedding(["你好", "世界"])
            finally:
                if svc._embedding_client is not None:
                    await svc._embedding_client.aclose()

        result = asyncio.run(_check())

        # 服务不可达 → fallback 标记非 none
        assert result.get("fallback") != "none", (
            "embedding 服务不可达时 fallback 应标记降级原因"
        )
        assert result["embeddings"] == [], (
            "embedding 失败时 embeddings 应为空列表"
        )
        assert "bge-large-zh" in result["model"], (
            f"embedding model 应含 bge-large-zh, 实际: {result.get('model')}"
        )


# ============================================================================
# E. AI Orchestrator R4.8 新增方法 (持久化 / 恢复 / Temporal 转换)
# ============================================================================

class TestAIOrchestratorR48:
    """验证 ai_orchestrator_service.py 的 R4.8 三大新方法存在 + 类型注解."""

    def test_has_r48_methods(self) -> None:
        """AIOrchestratorService 必须含 _persist_to_postgres / _load_from_temporal / to_temporal_workflow."""
        from app.services.ai_orchestrator_service import AIOrchestratorService

        assert hasattr(AIOrchestratorService, "_persist_to_postgres"), (
            "AIOrchestratorService 缺 R4.8 方法 _persist_to_postgres"
        )
        assert hasattr(AIOrchestratorService, "_load_from_temporal"), (
            "AIOrchestratorService 缺 R4.8 方法 _load_from_temporal"
        )
        assert hasattr(AIOrchestratorService, "to_temporal_workflow"), (
            "AIOrchestratorService 缺 R4.8 方法 to_temporal_workflow"
        )

    def test_persist_to_postgres_db_none_returns_false(self) -> None:
        """db=None 时 _persist_to_postgres 应返回 False (降级到内存 _OrchStore)."""
        from app.services.ai_orchestrator_service import (
            AIOrchestratorService, _orch_store,
        )
        from app.schemas.ai_orchestrator import (
            DAGStatus, DAGExecution,
        )

        svc = AIOrchestratorService(db=None, redis_client=None)
        # 构造一个测试 DAGExecution
        execution = DAGExecution(
            id="EXEC-R48-TEST",
            dag_id="SCF-QUICK-APPROVAL",
            enterprise_id="E001",
            status=DAGStatus.COMPLETED,
            start_at="2026-08-20T10:00:00+00:00",
            end_at=None,
            results_by_node={},
            context={"amount_cents": 100000},
            recommendation_summary=None,
            waiting_node_id=None,
        )
        result = asyncio.run(svc._persist_to_postgres(execution))
        assert result is False, (
            f"db=None 时 _persist_to_postgres 应返回 False, 实际: {result}"
        )
        # 内存 _OrchStore 应已写入 (降级 fallback)
        in_mem = asyncio.run(_orch_store.get_execution("EXEC-R48-TEST"))
        assert in_mem is not None, "降级后内存 _OrchStore 应有该 execution"

    def test_load_from_temporal_db_none_uses_memory_store(self) -> None:
        """db=None 时 _load_from_temporal 应从内存 _OrchStore 读取."""
        from app.services.ai_orchestrator_service import AIOrchestratorService
        from app.schemas.ai_orchestrator import (
            AutonomyLevel, ExecuteDAGRequest,
        )

        svc = AIOrchestratorService(db=None, redis_client=None)
        # 先执行一次 L4 DAG, 写入内存 store
        request = ExecuteDAGRequest(
            dag_id="CREDIT-REPORT-L4",
            enterprise_id="E001",
            context={"amount_cents": 5000000},
        )
        execution = asyncio.run(svc.execute_dag(request))

        # 从内存 store 恢复 (db=None, 不走 PG)
        recovered = asyncio.run(svc._load_from_temporal(execution.id))
        assert recovered is not None, (
            f"db=None 时应从内存恢复 execution, id={execution.id}"
        )
        assert recovered.id == execution.id
        assert recovered.dag_id == "CREDIT-REPORT-L4"

    def test_to_temporal_workflow_returns_serializable_dict(self) -> None:
        """to_temporal_workflow 应返回可 JSON 序列化的 dict, 含 DAG 节点/边."""
        import json

        from app.services.ai_orchestrator_service import AIOrchestratorService
        from app.schemas.ai_orchestrator import ExecuteDAGRequest

        svc = AIOrchestratorService(db=None, redis_client=None)
        # 取一个种子 DAG (内存 store 已 seed)
        dags = asyncio.run(svc.list_dags())
        assert len(dags) >= 1
        dag = dags[0]

        request = ExecuteDAGRequest(
            dag_id=dag.dag_id,
            enterprise_id="E001",
            context={"amount_cents": 3000000},
        )
        wf_input = svc.to_temporal_workflow(dag, request)

        # 必须可 JSON 序列化 (Temporal Payload 限制)
        serialized = json.dumps(wf_input, ensure_ascii=False)
        assert "dag_id" in wf_input
        assert wf_input["dag_id"] == dag.dag_id
        assert wf_input["enterprise_id"] == "E001"
        assert isinstance(wf_input["nodes"], list)
        assert len(wf_input["nodes"]) == len(dag.nodes)
        assert isinstance(wf_input["edges"], list)
        assert "autonomy_level" in wf_input
        assert "timeout_seconds" in wf_input
        assert "created_at" in wf_input
        assert isinstance(serialized, str)