# AI 引擎底座 (INFRA-02)

> 状态: P1 桩实现 (2026-08-20 偿还技术债务)
> spec 引用: spec.md INFRA-02 (L583-605)
> 路线图: docs/P1_ROADMAP_TECH_IMPL.md

## 目录说明

本目录是 spec.md INFRA-02 要求的 AI 引擎底座独立目录,与 `backend/` 解耦。

### 内容
- `services/llm_service.py` — LLM 推理服务 (DeepSeek OpenAI 兼容格式) ✅ 已实现
- feature_store — 特征工程平台（P2 路线图项，尚未创建）
- model_registry — MLflow 模型版本管理（P2 路线图项，尚未创建）
- ml_inference — ML 推理服务 (XGBoost/LightGBM，P2 路线图项，尚未创建）

### 接口契约 (对齐 spec INFRA-02)

```
POST /ai/score    {model, features} → {score, level, confidence, reasons}
POST /ai/analyze  {task, doc_type, content} → {result, structured_data}
POST /ai/chat     {messages, stream} → {content, model, usage}
```

### 与 backend/ 的集成

backend/app/services/llm_service.py 重新导出本目录的实现 (向后兼容现有 import):
```python
from app.services.llm_service import llm_service  # 旧 import 保持不变
```

详见 `production/backend/app/services/llm_service.py`。
