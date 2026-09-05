"""AI 引擎底座 (INFRA-02).

spec.md L583-605 要求:
    - LLM 推理服务 (DeepSeek/通义千问, OpenAI 兼容格式)
    - ML 推理服务 (XGBoost/LightGBM)
    - 特征工程平台 (特征存储 schema + 计算 pipeline)
    - MLflow 模型版本管理 (注册/对比/A/B 测试)
    - 统一 AI 引擎 API: /ai/score, /ai/analyze, /ai/chat

当前实现状态:
    - ✅ LLM 推理服务 (P1, 见 services/llm_service.py)
    - 🚧 ML 推理服务 (P2 路线图, 见 services/ml_inference.py 桩)
    - 🚧 特征工程平台 (P2 路线图, 见 services/feature_store.py 桩)
    - 🚧 MLflow 模型版本管理 (P2 路线图, 见 services/model_registry.py 桩)

降级原则 (遵循 project_memory "零机构接入时仍可独立运行"):
    - API Key 未配置时返回 "LLM 未配置" 提示, 不报错
    - 超时 30 秒自动降级
    - 所有方法 async/await
"""

__all__ = ["llm_service", "ml_inference_service", "feature_store", "model_registry"]


def _lazy_import_llm():
    """懒加载 LLM 服务 (避免循环导入)."""
    from .services.llm_service import llm_service
    return llm_service


def _lazy_import_ml():
    """懒加载 ML 推理服务."""
    try:
        from .services.ml_inference import ml_inference_service
        return ml_inference_service
    except ImportError:
        return None


def _lazy_import_feature_store():
    """懒加载特征工程平台."""
    try:
        from .services.feature_store import feature_store
        return feature_store
    except ImportError:
        return None


def _lazy_import_model_registry():
    """懒加载 MLflow 模型注册."""
    try:
        from .services.model_registry import model_registry
        return model_registry
    except ImportError:
        return None


# 暴露懒加载属性 (访问时才真正导入)
class _LazyModule:
    def __getattr__(self, name):
        if name == "llm_service":
            return _lazy_import_llm()
        if name == "ml_inference_service":
            return _lazy_import_ml()
        if name == "feature_store":
            return _lazy_import_feature_store()
        if name == "model_registry":
            return _lazy_import_model_registry()
        raise AttributeError(f"module 'ai_engine' has no attribute {name!r}")


import sys as _sys
_sys.modules[__name__].__class__ = _LazyModule
