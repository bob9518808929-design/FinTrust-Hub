"""LLM 推理服务 (INFRA-02).

spec 依据: INFRA-02 L583-605
- 对接 DeepSeek/通义千问 API (OpenAI 兼容格式)
- 支持流式输出
- 超时自动降级
- Key 未配置时降级为"LLM 未配置"提示

路线图: docs/P1_ROADMAP_TECH_IMPL.md §1

R4.2 升级 (2026-08-20): 新增 vLLM 本地推理 + embedding 服务
- _call_vllm():      调用本地 vLLM HTTP API (localhost:8000/v1/chat/completions), 超时 2s
                     超时/不可用自动降级到 _call_mock
- _call_embedding(): 调用本地 BGE embedding 服务 (localhost:8002/embed)
- _call_mock():      兜底占位, 保证业务不中断
"""

import logging
from typing import Any, AsyncIterator, Optional

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


# === 模型路由配置 (默认值, 与 ai-engine/config/model_config.yaml 同步) ===
# 这些常量在 LLMService 初始化时用作兜底默认值, 可通过构造参数覆盖.
VLLM_PRIMARY_URL: str = "http://localhost:8000/v1/chat/completions"
VLLM_FALLBACK_URL: str = "http://localhost:8001/v1/chat/completions"
VLLM_TIMEOUT: float = 2.0
VLLM_PRIMARY_MODEL: str = "qwen-7b"
VLLM_FALLBACK_MODEL: str = "chatglm3"

EMBEDDING_URL: str = "http://localhost:8002/embed"
EMBEDDING_TIMEOUT: float = 5.0
EMBEDDING_MODEL: str = "bge-large-zh-v1.5"


class LLMService:
    """统一 LLM 推理服务.

    主模型: DeepSeek (OpenAI 兼容 API)
    备选: 通义千问 / OpenAI / Anthropic (config 中已有字段)
    降级: Key 为空时返回"LLM 未配置"提示, 不抛异常

    R4.2 新增三档兜底:
      primary  → 本地 vLLM (Qwen-7B)
      fallback → 本地 vLLM (ChatGLM3)
      mock     → 占位提示
    """

    def __init__(self) -> None:
        self.api_key: str = getattr(settings, "DEEPSEEK_API_KEY", "") or ""
        self.base_url: str = (
            getattr(settings, "DEEPSEEK_BASE_URL", "")
            or "https://api.deepseek.com/v1"
        )
        self.model: str = getattr(settings, "DEEPSEEK_MODEL", "") or "deepseek-chat"
        self.timeout: float = 30.0
        self._client: Optional[httpx.AsyncClient] = (
            httpx.AsyncClient(timeout=self.timeout) if self.api_key else None
        )
        # vLLM 本地推理配置 (R4.2)
        self.vllm_primary_url: str = VLLM_PRIMARY_URL
        self.vllm_fallback_url: str = VLLM_FALLBACK_URL
        self.vllm_timeout: float = VLLM_TIMEOUT
        self.vllm_primary_model: str = VLLM_PRIMARY_MODEL
        self.vllm_fallback_model: str = VLLM_FALLBACK_MODEL
        # embedding 服务 (R4.2)
        self.embedding_url: str = EMBEDDING_URL
        self.embedding_timeout: float = EMBEDDING_TIMEOUT
        self.embedding_model: str = EMBEDDING_MODEL
        # 共享 HTTP 客户端 (vLLM + embedding), 与 self._client 独立避免 timeout 互相干扰
        self._vllm_client: Optional[httpx.AsyncClient] = httpx.AsyncClient(
            timeout=self.vllm_timeout
        )
        self._embedding_client: Optional[httpx.AsyncClient] = httpx.AsyncClient(
            timeout=self.embedding_timeout
        )

    @property
    def available(self) -> bool:
        """LLM 是否可用 (Key 已配置 + 客户端已初始化)."""
        return bool(self.api_key and self._client is not None)

    async def chat(
        self,
        messages: list[dict],
        model: Optional[str] = None,
        stream: bool = False,
        temperature: float = 0.7,
        max_tokens: int = 2048,
    ) -> dict | AsyncIterator[str]:
        """统一 chat 接口.

        Args:
            messages: OpenAI 消息数组 [{"role": "system"|"user"|"assistant", "content": "..."}]
            model: 模型名 (默认 self.model, 如 deepseek-chat / deepseek-reasoner)
            stream: 是否流式输出
            temperature: 温度 (0-2)
            max_tokens: 最大输出 tokens

        Returns:
            非流式: {"content": str, "model": str, "usage": dict}
            流式: AsyncIterator[str] (逐 chunk)
        """
        if not self.available:
            return {
                "content": "LLM 未配置, 请联系管理员设置 DEEPSEEK_API_KEY",
                "model": "fallback",
                "usage": {},
            }

        payload = {
            "model": model or self.model,
            "messages": messages,
            "stream": stream,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        try:
            if stream:
                return self._stream_chat(payload, headers)
            assert self._client is not None
            resp = await self._client.post(
                f"{self.base_url}/chat/completions", json=payload, headers=headers
            )
            resp.raise_for_status()
            data = resp.json()
            return {
                "content": data["choices"][0]["message"]["content"],
                "model": data.get("model", self.model),
                "usage": data.get("usage", {}),
            }
        except httpx.TimeoutException:
            logger.warning("LLM 响应超时, 降级返回")
            return {"content": "LLM 响应超时, 已降级", "model": "timeout-fallback"}
        except Exception as e:
            logger.exception("LLM 调用失败")
            return {"content": f"LLM 调用失败: {e}", "model": "error-fallback"}

    async def _stream_chat(
        self, payload: dict, headers: dict
    ) -> AsyncIterator[str]:
        """流式 chat (SSE 逐 chunk)."""
        assert self._client is not None
        async with self._client.stream(
            "POST",
            f"{self.base_url}/chat/completions",
            json=payload,
            headers=headers,
        ) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if line.startswith("data: "):
                    yield line[6:]

    async def analyze(
        self,
        task: str,
        doc_type: str,
        content: str,
        model: Optional[str] = None,
    ) -> dict:
        """统一分析接口 (对齐 spec POST /ai/analyze).

        Args:
            task: 任务类型 (doc_classify / risk_extract / contract_review / ...)
            doc_type: 文档类型 (bank_statement / contract / invoice / ...)
            content: 待分析内容
            model: 模型名

        Returns:
            {"result": {...}, "structured_data": {...}}
        """
        system_prompt = (
            f"你是 FinTrust Hub 的文档分析引擎, 任务类型: {task}, 文档类型: {doc_type}。"
            "请基于以下内容完成分析, 返回 JSON 格式结果。"
        )
        result = await self.chat(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": content},
            ],
            model=model,
            temperature=0.2,
            max_tokens=4096,
        )
        return {
            "result": result,
            "structured_data": {"task": task, "doc_type": doc_type},
        }

    async def score(
        self,
        model_name: str,
        features: dict,
    ) -> dict:
        """统一评分接口 (对齐 spec POST /ai/score).

        Args:
            model_name: 模型名 (如 risk_score_v1)
            features: 特征字典 {field: value}

        Returns:
            {"score": float, "level": str, "confidence": float, "reasons": list}
        """
        if not self.available:
            return {
                "score": 0.5,
                "level": "C",
                "confidence": 0.0,
                "reasons": ["LLM 未配置, 返回默认中等评分"],
            }

        system_prompt = (
            f"你是 FinTrust Hub 的风险评分引擎 (模型: {model_name})。"
            "基于给定特征, 输出 0-1 风险分 + A/B/C/D 等级 + 置信度 + 理由列表。"
            "返回 JSON: {\"score\": 0.85, \"level\": \"A\", \"confidence\": 0.92, \"reasons\": [...]}"
        )
        result = await self.chat(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": str(features)},
            ],
            temperature=0.1,
            max_tokens=1024,
        )
        # 简单解析 (生产环境应做严格 JSON 解析 + 校验)
        try:
            import json
            parsed = json.loads(result["content"])
            return parsed
        except (json.JSONDecodeError, KeyError):
            return {
                "score": 0.5,
                "level": "C",
                "confidence": 0.3,
                "reasons": ["LLM 返回格式异常, 降级默认评分"],
            }

    async def close(self) -> None:
        """关闭 HTTP 客户端 (在应用 shutdown 钩子中调用)."""
        if self._client:
            await self._client.aclose()
        if self._vllm_client is not None:
            await self._vllm_client.aclose()
        if self._embedding_client is not None:
            await self._embedding_client.aclose()

    # ------------------------------------------------------------------
    # R4.2 INFRA-02 升级: 本地 vLLM 推理 + embedding + mock 三档兜底
    # ------------------------------------------------------------------

    async def _call_vllm(
        self,
        messages: list[dict],
        model: Optional[str] = None,
        temperature: float = 0.3,
        max_tokens: int = 2048,
        use_fallback_model: bool = True,
    ) -> dict:
        """调用本地 vLLM HTTP API (OpenAI 兼容).

        优先用主模型 (Qwen-7B, localhost:8000); 主模型超时 (>2s) 或不可用时
        切换到降级模型 (ChatGLM3, localhost:8001); 降级模型同样失败则走 _call_mock.

        Args:
            messages: OpenAI 消息数组
            model: 指定模型名 (默认主模型 self.vllm_primary_model)
            temperature: 温度, 默认 0.3 (评分/分析场景需稳定输出)
            max_tokens: 最大输出 tokens
            use_fallback_model: 主模型失败时是否尝试降级模型 (默认 True)

        Returns:
            {"content": str, "model": str, "usage": dict, "fallback": str}
            fallback=="none" 表示主模型成功; "fallback_model" 表示降级模型;
            "mock" 表示走兜底占位.
        """
        # 主模型调用
        primary_result = await self._post_vllm(
            url=self.vllm_primary_url,
            model=model or self.vllm_primary_model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        if primary_result.get("fallback") == "none":
            return primary_result

        # 主模型失败, 尝试降级模型
        if use_fallback_model:
            logger.warning(
                f"vLLM 主模型调用失败 (fallback={primary_result.get('fallback')}), "
                f"降级到 ChatGLM3 模型"
            )
            fallback_result = await self._post_vllm(
                url=self.vllm_fallback_url,
                model=self.vllm_fallback_model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
            )
            if fallback_result.get("fallback") == "none":
                return fallback_result

        # 全部失败, 走 mock 兜底
        return self._call_mock(messages, reason="vllm_unavailable")

    async def _post_vllm(
        self,
        url: str,
        model: str,
        messages: list[dict],
        temperature: float = 0.3,
        max_tokens: int = 2048,
    ) -> dict:
        """对单个 vLLM endpoint 发起 POST 请求 (内部辅助函数).

        超时/网络异常时不抛出, 返回带 fallback 标记的降级结果.
        """
        payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
        }
        # vLLM 本地部署默认无需鉴权; 若配置了 api_key 则附带 Bearer
        headers = {"Content-Type": "application/json"}
        try:
            assert self._vllm_client is not None
            resp = await self._vllm_client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            return {
                "content": data["choices"][0]["message"]["content"],
                "model": data.get("model", model),
                "usage": data.get("usage", {}),
                "fallback": "none",
            }
        except httpx.TimeoutException:
            logger.warning(f"vLLM 调用超时 (url={url}, timeout={self.vllm_timeout}s)")
            return {"content": "", "model": model, "usage": {}, "fallback": "timeout"}
        except Exception as e:
            logger.warning(f"vLLM 调用失败 (url={url}): {type(e).__name__}: {e}")
            return {
                "content": "",
                "model": model,
                "usage": {},
                "fallback": f"error:{type(e).__name__}",
            }

    async def _call_embedding(
        self,
        texts: list[str],
        model: Optional[str] = None,
    ) -> dict:
        """调用本地 BGE embedding 服务 (localhost:8002/embed).

        Args:
            texts: 待向量化的文本数组 (批量调用)
            model: 模型名 (默认 bge-large-zh-v1.5)

        Returns:
            成功: {"embeddings": list[list[float]], "model": str, "fallback": "none"}
            失败: {"embeddings": [], "model": str, "fallback": "<reason>"}
        """
        payload: dict[str, Any] = {"inputs": texts}
        if model:
            payload["model"] = model
        headers = {"Content-Type": "application/json"}
        try:
            assert self._embedding_client is not None
            resp = await self._embedding_client.post(
                self.embedding_url, json=payload, headers=headers
            )
            resp.raise_for_status()
            data = resp.json()
            # TEI 返回 list[list[float]]; 兼容 {data: [{"embedding": [...]}]} 格式
            if isinstance(data, list):
                embeddings = data
            elif isinstance(data, dict) and "data" in data:
                embeddings = [item["embedding"] for item in data["data"]]
            else:
                embeddings = []
            return {
                "embeddings": embeddings,
                "model": model or self.embedding_model,
                "fallback": "none",
            }
        except httpx.TimeoutException:
            logger.warning(
                f"Embedding 调用超时 (url={self.embedding_url}, "
                f"timeout={self.embedding_timeout}s)"
            )
            return {
                "embeddings": [],
                "model": model or self.embedding_model,
                "fallback": "timeout",
            }
        except Exception as e:
            logger.warning(
                f"Embedding 调用失败 (url={self.embedding_url}): "
                f"{type(e).__name__}: {e}"
            )
            return {
                "embeddings": [],
                "model": model or self.embedding_model,
                "fallback": f"error:{type(e).__name__}",
            }

    def _call_mock(
        self,
        messages: list[dict],
        reason: str = "vllm_unavailable",
    ) -> dict:
        """兜底占位 (mock), 保证业务不中断.

        不发起任何网络请求, 直接返回占位内容. 用户问题摘要附带在内容里,
        便于用户认出自己问的什么. 模型字段标记为 "mock", fallback 字段
        标记为 reason, 调用方据此判断是否走真实模型.

        Args:
            messages: OpenAI 消息数组 (用于提取最后一条 user 内容)
            reason: 降级原因 (vllm_unavailable / timeout / error:...)

        Returns:
            {"content": str, "model": "mock", "usage": {}, "fallback": reason}
        """
        last_user = next(
            (m.get("content", "") for m in reversed(messages) if m.get("role") == "user"),
            "",
        )
        if isinstance(last_user, (dict, list)):
            last_user_text = str(last_user)[:50]
        else:
            last_user_text = str(last_user)[:50]
        content = (
            f"AI 引擎暂不可用 ({reason}), 已降级返回 mock 结果。"
            f"您的问题已记录: {last_user_text}..."
        )
        return {
            "content": content,
            "model": "mock",
            "usage": {},
            "fallback": reason,
        }


# 单例 (业务侧直接 from app.services.llm_service import llm_service)
llm_service = LLMService()
