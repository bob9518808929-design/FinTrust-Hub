"""统一 LLM 推理服务 (INFRA-02).

A 档: DeepSeek (主, OpenAI 兼容格式)
B 档: OpenAI / Anthropic (备, config 字段已有, 暂未接入)
C 档: 规则匹配 + 占位提示 (兜底, 保证业务不中断)

设计依据: docs/DEEPSEEK_INTEGRATION_TECH_SPEC.md
测试契约: tests/test_llm_service.py (TDD, 本实现需满足该文件全部断言)
降级原则 (project_memory): Key 为空 / 网络异常 / 熔断 → 走 C 档兜底, 不抛异常
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
import time
from collections.abc import AsyncIterator

import httpx
from loguru import logger
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from app.config import settings

# === PII 脱敏 (请求侧脱敏, 响应侧还原) ===

_PII_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"\b\d{16,19}\b"), "[银行卡]"),
    (re.compile(r"\b\d{17,18}[Xx\d]\b"), "[身份证]"),
]


def _mask_pii(text: str) -> tuple[str, dict]:
    """脱敏 PII, 返回 (脱敏后文本, 占位符→原值 映射).

    用占位符 <<PII_i_j>> 替换敏感串, i=pattern 索引, j=该 pattern 的第几个匹配.
    响应里若引用占位符, _unmask_pii 可据 mapping 还原.
    """
    mapping: dict[str, str] = {}
    masked = text
    for i, (pattern, _placeholder) in enumerate(_PII_PATTERNS):
        for j, m in enumerate(pattern.findall(masked)):
            key = f"<<PII_{i}_{j}>>"
            mapping[key] = m
            masked = masked.replace(m, key, 1)
    return masked, mapping


def _unmask_pii(text: str, mapping: dict) -> str:
    """还原 PII (把占位符替换回原值)."""
    for key, val in mapping.items():
        text = text.replace(key, val)
    return text


def _sanitize_user_input(text: str) -> str:
    """清洗用户输入, 防 prompt 注入 + 限长 2000 字符."""
    for marker in ("忽略上述", "ignore above", "system:", "<|im_start|>", "</s>"):
        text = text.replace(marker, "")
    return text[:2000]


# === 熔断器 ===

class CircuitBreaker:
    """简单熔断器: 连续失败达阈值后开启 cooldown, 期间走兜底.

    状态流转: 闭 → (失败达 threshold) → 开 → (cooldown 过) → 半开(允许尝试) → ...
    """

    def __init__(self, threshold: int = 5, cooldown: int = 60):
        self.threshold = threshold
        self.cooldown = cooldown
        self._failures = 0
        self._opened_at = 0.0

    @property
    def is_open(self) -> bool:
        if self._failures < self.threshold:
            return False
        return (time.time() - self._opened_at) < self.cooldown

    def record_success(self) -> None:
        """成功重置失败计数. 若之前处于熔断态, 打 INFO 日志便于运维感知恢复."""
        was_open = self._failures >= self.threshold
        self._failures = 0
        if was_open:
            logger.info(
                f"LLM 熔断器已恢复 (CLOSED, threshold={self.threshold}, "
                f"cooldown={self.cooldown}s)"
            )

    def record_failure(self) -> None:
        """失败累加, 达阈值后每次刷新开启时间 (持续失败保持熔断)."""
        self._failures += 1
        if self._failures >= self.threshold:
            self._opened_at = time.time()
            logger.warning(f"LLM 熔断器开启/续期, {self.cooldown}s 内走兜底")


# === LLM 服务 ===

class LLMService:
    """统一 LLM 推理入口.

    chat() 返回结构: {content, model, usage, cache_hit, fallback}
    fallback == "none" 表示成功调用; 其他值为降级原因.
    """

    def __init__(self):
        self.api_key = settings.DEEPSEEK_API_KEY
        self.base_url = settings.DEEPSEEK_BASE_URL or "https://api.deepseek.com/v1"
        self.default_model = settings.DEEPSEEK_MODEL or "deepseek-chat"
        # 以下字段 config.py 暂未声明, 用 getattr 兜底 (见 DEEPSEEK_INTEGRATION_TECH_SPEC 步骤 1)
        self.reasoner_model = getattr(settings, "DEEPSEEK_REASONER_MODEL", "deepseek-reasoner")
        self._client: httpx.AsyncClient | None = None
        self.circuit = CircuitBreaker()

    @property
    def available(self) -> bool:
        return bool(self.api_key)

    def _get_client(self) -> httpx.AsyncClient:
        """懒加载 httpx 客户端."""
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=getattr(settings, "DEEPSEEK_TIMEOUT_CHAT", 30.0)
            )
        return self._client

    async def chat(
        self,
        messages: list[dict],
        enterprise_id: str = "default",
        scene: str = "chat",
        model: str | None = None,
        temperature: float = 0.7,
        max_tokens: int | None = None,
        use_cache: bool = True,
        request_id: str = "",
    ) -> dict:
        """非流式问答.

        流程: 限流 → PII 脱敏 → 缓存 → 可用性/熔断检查 → 真实调用 → 记指标.
        任一环失败走 C 档兜底, 不抛异常.
        """
        # 1. 限流 (复用 redis_client.rate_limit, Redis 挂时放行)
        from app.services.redis_client import rate_limit

        allowed = await rate_limit(
            key=f"llm:rl:{enterprise_id}", window_sec=60, max_req=10
        )
        if not allowed:
            logger.warning(
                f"LLM 限流触发 (req={request_id}, ent={enterprise_id}, "
                f"window=60s, max=10)"
            )
            return {
                "content": "您提问太快了, 请稍等再试",
                "model": "rate-limited",
                "usage": {},
                "cache_hit": False,
                "fallback": "rate-limited",
            }

        # 2. PII 脱敏 + 输入清洗 (仅 user 消息, system 不动)
        # 异常兜底: 若 content 非 str 或清洗失败, 降级用原 messages 不阻断调用
        safe_messages: list[dict] = []
        mapping: dict[str, str] = {}
        for m in messages:
            if m.get("role") == "user":
                try:
                    cleaned = _sanitize_user_input(str(m.get("content", "")))
                    masked, m_map = _mask_pii(cleaned)
                    mapping.update(m_map)
                    safe_messages.append({**m, "content": masked})
                except Exception as exc:
                    logger.warning(
                        f"LLM PII 脱敏失败, 降级用原消息 (req={request_id}): {exc}"
                    )
                    safe_messages = list(messages)
                    mapping = {}
                    break
            else:
                safe_messages.append(m)

        # 3. 缓存 (use_cache=True 时查 Redis, 命中则不调 API)
        used_model = model or self.default_model
        cache_key = self._make_cache_key(safe_messages, used_model) if use_cache else ""
        if use_cache and cache_key:
            cached = await self._get_cached(cache_key)
            if cached:
                return {
                    "content": _unmask_pii(cached, mapping),
                    "model": used_model,
                    "usage": {},
                    "cache_hit": True,
                    "fallback": "none",
                }

        # 4. 不可用 / 熔断 → C 档兜底
        if not self.available or self.circuit.is_open:
            logger.warning(
                f"LLM 走熔断兜底 (req={request_id}, ent={enterprise_id}, "
                f"available={self.available}, CB.is_open={self.circuit.is_open}, "
                f"CB._failures={self.circuit._failures})"
            )
            return self._fallback(safe_messages, mapping, "no_key_or_circuit")

        # 5. 真实调用 (带重试 / 超时 / 熔断 / 指标)
        payload = {
            "model": used_model,
            "messages": safe_messages,
            "temperature": temperature,
            "max_tokens": max_tokens
            or getattr(settings, "DEEPSEEK_MAX_TOKENS_PER_CALL", 2048),
            "stream": False,
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        t0 = time.time()
        try:
            # 按 model 设置超时 (reasoner 用更长 timeout)
            client = self._get_client()
            client.timeout = (
                getattr(settings, "DEEPSEEK_TIMEOUT_REASONER", 60.0)
                if used_model == self.reasoner_model
                else getattr(settings, "DEEPSEEK_TIMEOUT_CHAT", 30.0)
            )
            data = await self._call_with_retry(payload, headers, used_model)
            self.circuit.record_success()
            content = _unmask_pii(data["choices"][0]["message"]["content"], mapping)
            usage = data.get("usage", {})
            if cache_key:
                await self._set_cached(
                    cache_key,
                    content,
                    ttl=getattr(settings, "DEEPSEEK_CACHE_TTL_DEFAULT", 3600),
                )
            elapsed = time.time() - t0
            await self._record_metric(
                request_id, enterprise_id, used_model, scene,
                usage, elapsed, False, "none",
            )
            return {
                "content": content,
                "model": used_model,
                "usage": usage,
                "cache_hit": False,
                "fallback": "none",
            }
        except asyncio.CancelledError:
            # 客户端主动取消 (关闭页面/超时断开), 不计入熔断失败, 不写失败指标
            logger.info(
                f"LLM 调用被客户端取消 (req={request_id}, ent={enterprise_id}, "
                f"model={used_model}, scene={scene})"
            )
            raise  # 必须传播, 让 ASGI 正确关闭连接
        except Exception as exc:
            self.circuit.record_failure()
            logger.warning(f"LLM 调用失败 (req={request_id}): {exc}")
            elapsed = time.time() - t0
            await self._record_metric(
                request_id, enterprise_id, used_model, scene,
                {}, elapsed, False, f"call_failed:{type(exc).__name__}",
            )
            return self._fallback(
                safe_messages, mapping, f"call_failed:{type(exc).__name__}",
            )

    def _fallback(self, messages: list[dict], mapping: dict, reason: str) -> dict:
        """C 档兜底: 占位提示, 保证业务不中断.

        内容含降级原因 + 用户问题摘要(PII 还原), 便于用户认出自己问的什么.
        """
        last_user = next(
            (m["content"] for m in reversed(messages) if m.get("role") == "user"),
            "",
        )
        content = (
            f"AI 助手暂时不可用 ({reason})。"
            f"您的问题已记录: {_unmask_pii(last_user[:50], mapping)}..."
        )
        return {
            "content": content,
            "model": "fallback",
            "usage": {},
            "cache_hit": False,
            "fallback": reason,
        }

    async def chat_stream(
        self,
        messages: list[dict],
        enterprise_id: str = "default",
        **kw,
    ) -> AsyncIterator[str]:
        """流式输出 (SSE). 不走缓存, 复用熔断检查.

        yield 格式: "data: <chunk>\\n\\n" (对齐 OpenAI SSE)
        """
        if not self.available or self.circuit.is_open:
            yield "data: [LLM 不可用, 已降级]\n\n"
            return
        payload = {
            "model": kw.get("model") or self.default_model,
            "messages": messages,
            "stream": True,
            "temperature": kw.get("temperature", 0.7),
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        try:
            async with self._get_client().stream(
                "POST",
                f"{self.base_url}/chat/completions",
                json=payload,
                headers=headers,
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if line.startswith("data: "):
                        yield f"data: {line[6:]}\n\n"
        except asyncio.CancelledError:
            # 客户端关闭 SSE 连接 (高频正常行为), 不打 warning 避免日志噪音
            logger.info("LLM 流式被客户端取消 (用户关闭 SSE 连接)")
            raise  # 必须传播, 让 ASGI 正确关闭连接
        except Exception as exc:
            logger.warning(f"LLM 流式失败: {exc}")
            yield "data: [LLM 流式异常, 已降级]\n\n"

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=8),
        retry=retry_if_exception_type((httpx.TimeoutException, httpx.NetworkError)),
        reraise=True,
    )
    async def _call_with_retry(self, payload: dict, headers: dict, model: str) -> dict:
        """真实调用 DeepSeek (tenacity 重试, 仅网络层异常重试)."""
        client = self._get_client()
        resp = await client.post(
            f"{self.base_url}/chat/completions",
            json=payload,
            headers=headers,
        )
        resp.raise_for_status()
        return resp.json()

    def _make_cache_key(self, messages: list[dict], model: str) -> str:
        """缓存 key: sha256(messages+model)[:16]."""
        raw = json.dumps(
            {"m": messages, "model": model},
            sort_keys=True,
            ensure_ascii=False,
        )
        return hashlib.sha256(raw.encode()).hexdigest()[:16]

    async def _get_cached(self, key: str) -> str | None:
        """从 Redis 取缓存 (Redis 挂时返回 None)."""
        from app.services.redis_client import get_redis

        redis = get_redis()
        if redis is None:
            return None
        return await redis.get(f"llm:{key}")

    async def _set_cached(self, key: str, value: str, ttl: int = 3600) -> None:
        """写缓存到 Redis (Redis 挂时静默跳过)."""
        from app.services.redis_client import get_redis

        redis = get_redis()
        if redis is None:
            return
        await redis.set(f"llm:{key}", value, ex=ttl)

    async def _record_metric(
        self,
        request_id: str,
        enterprise_id: str,
        model: str,
        scene: str,
        usage: dict,
        elapsed: float,
        cache_hit: bool,
        fallback: str,
    ) -> None:
        """记录调用指标到 ClickHouse (不可用时降级到日志, 不阻断业务)."""
        # 配置开关: LLM_METRICS_ENABLED=false 时直接 return, 不再尝试写入
        if not getattr(settings, "LLM_METRICS_ENABLED", True):
            return
        try:
            from app.services import clickhouse_client

            get_ch = getattr(clickhouse_client, "get_clickhouse_client", None)
            if get_ch is None:
                return
            ch = get_ch()
            if ch is None:
                return
            ch.query(
                "INSERT INTO fintrust_metrics.llm_metrics "
                "(ts, request_id, enterprise_id, model, scene, "
                " in_tokens, out_tokens, latency_ms, cache_hit, fallback, cost_yuan) VALUES",
                [[
                    time.strftime("%Y-%m-%d %H:%M:%S"),
                    request_id,
                    enterprise_id,
                    model,
                    scene,
                    usage.get("prompt_tokens", 0),
                    usage.get("completion_tokens", 0),
                    int(elapsed * 1000),
                    int(cache_hit),
                    fallback,
                    0.0,
                ]],
            )
        except Exception as exc:
            # 指标降级, 不阻断业务, 但留 debug 日志便于排查"为什么指标没记录"
            # 受 LLM_METRICS_LOG_ON_FAILURE 开关控制, 默认 true
            if getattr(settings, "LLM_METRICS_LOG_ON_FAILURE", True):
                logger.debug(
                    f"LLM 指标落库失败, 已降级跳过 (req={request_id}, ent={enterprise_id}, "
                    f"scene={scene}, err={type(exc).__name__}: {exc})"
                )

    async def close(self) -> None:
        """关闭 httpx 客户端 (应用关闭时调用)."""
        if self._client:
            try:
                await self._client.aclose()
            except Exception as exc:
                logger.warning(f"LLM httpx 客户端 close 异常, 已忽略: {exc}")


llm_service = LLMService()
