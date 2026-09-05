"""ECO-09 数字分身 ↔ DeepSeek 交互专项测试.

目标: 验证 EcoBotService.parse/execute 与 LLMService 的集成契约:
    1. 规则匹配优先, 不触发 LLM (低成本路径)
    2. 未命中规则时调用 LLMService.chat, 把回答透传给用户
    3. LLM 不可用 / 熔断 / 无 Key 时, LLMService 内部走 C 档兜底,
       ECO-09 仍能正常返回 (不抛异常, 业务连续性)
    4. 短文本不触发 LLM (避免空问请求消耗)
    5. execute 阶段 llm_fallback intent 正确渲染 LLM 回答
    6. 端到端: /eco-bot/parse 端点返回 intent=llm_fallback
    7. parse → execute 完整链路

mock 策略:
    - llm_service.chat: AsyncMock, 按用例返回成功/兜底/熔断
    - redis_client.rate_limit: AsyncMock(True), 避免真实 Redis 调用
    - 不 mock LLMService 内部逻辑 (保留 PII 脱敏/熔断/缓存的真实状态机)

运行: pytest tests/test_eco_bot_deepseek.py -v
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
def _restore_real_availability(monkeypatch: pytest.MonkeyPatch):
    """反制 conftest 全局禁 LLM fixture (类级 available property 被恒 False).

    本文件不发真实网络请求 (chat / _call_with_retry 均被 mock), 熔断状态机测试
    依赖真实语义 available = bool(api_key) — 否则熔断恢复用例永远走不到真实调用分支.
    """
    from app.services.llm_service import LLMService

    monkeypatch.setattr(LLMService, "available", property(lambda self: bool(self.api_key)))


# ============================================================================
# 辅助
# ============================================================================

def _api_chat_success(content: str = "明天贷款利率大概率会降 0.1%") -> dict:
    """构造 LLMService.chat 成功返回 (对齐 chat() 返回契约)."""
    return {
        "content": content,
        "model": "deepseek-chat",
        "usage": {"prompt_tokens": 12, "completion_tokens": 8},
        "cache_hit": False,
        "fallback": "none",
    }


def _api_chat_fallback(reason: str = "no_key_or_circuit", content: str | None = None) -> dict:
    """构造 LLMService.chat 走 C 档兜底的返回."""
    return {
        "content": content or f"AI 助手暂时不可用 ({reason})。您的问题已记录: 明天贷款...",
        "model": "fallback",
        "usage": {},
        "cache_hit": False,
        "fallback": reason,
    }


@pytest.fixture(autouse=True)
def _mock_rate_limit():
    """绕过真实 Redis 限流 (默认放行)."""
    with patch(
        "app.services.redis_client.rate_limit",
        new=AsyncMock(return_value=True),
    ):
        yield


@pytest.fixture
def reset_bot_service():
    """每个用例独立的 EcoBotService 实例, 避免共享态污染."""
    from app.services.eco_service import EcoBotService
    return EcoBotService()


# ============================================================================
# A. 规则匹配优先 (不触发 LLM)
# ============================================================================

class TestParseRuleMatching:
    """命中关键词规则时, 应直接走规则路径, 不调用 LLMService."""

    async def test_progress_keyword_skips_llm(self, reset_bot_service):
        with patch(
            "app.services.llm_service.llm_service.chat",
            new=AsyncMock(side_effect=AssertionError("规则命中不应调 LLM")),
        ):
            r = await reset_bot_service.parse("改造进度怎么样了", "web", "E001")
        assert r.intent == "query_progress"
        assert r.confidence == 0.85
        assert "llm_reply" not in r.entities

    async def test_credit_keyword_skips_llm(self, reset_bot_service):
        with patch(
            "app.services.llm_service.llm_service.chat",
            new=AsyncMock(side_effect=AssertionError("规则命中不应调 LLM")),
        ):
            r = await reset_bot_service.parse("我的信用分多少", "wechat", "E001")
        assert r.intent == "query_credit"

    async def test_financing_keyword_skips_llm(self, reset_bot_service):
        with patch(
            "app.services.llm_service.llm_service.chat",
            new=AsyncMock(side_effect=AssertionError("规则命中不应调 LLM")),
        ):
            r = await reset_bot_service.parse("想申请融资", "dingtalk", "E001")
        assert r.intent == "apply_financing"

    async def test_exception_keyword_skips_llm(self, reset_bot_service):
        with patch(
            "app.services.llm_service.llm_service.chat",
            new=AsyncMock(side_effect=AssertionError("规则命中不应调 LLM")),
        ):
            r = await reset_bot_service.parse("系统报错了", "web", "E001")
        assert r.intent == "report_exception"


# ============================================================================
# B. 未命中规则 → 调用 LLMService 成功
# ============================================================================

class TestParseLLMSuccess:
    """规则未命中且文本足够长 → 调用 LLM, intent=llm_fallback, entities 存回答."""

    async def test_unknown_intent_calls_llm(self, reset_bot_service):
        with patch(
            "app.services.llm_service.llm_service.chat",
            new=AsyncMock(return_value=_api_chat_success("明天利率大概率降 0.1%")),
        ) as mock_chat:
            r = await reset_bot_service.parse("帮我分析下明天利率走势", "web", "E001")

        assert mock_chat.await_count == 1
        # 入参 messages 至少含 system + user
        called_messages = mock_chat.await_args.kwargs.get("messages") \
            or mock_chat.await_args.args[0]
        assert any(m["role"] == "user" for m in called_messages)
        assert any(m["role"] == "system" for m in called_messages)
        # scene 应标注为对话
        assert mock_chat.await_args.kwargs.get("scene") == "dialogue"

        assert r.intent == "llm_fallback"
        assert r.confidence == 0.6  # fallback == "none" → 高置信
        assert r.entities.get("llm_reply") == "明天利率大概率降 0.1%"

    async def test_llm_passes_enterprise_id(self, reset_bot_service):
        """LLM 调用必须携带 enterprise_id, 用于按企业限流和指标归集."""
        with patch(
            "app.services.llm_service.llm_service.chat",
            new=AsyncMock(return_value=_api_chat_success()),
        ) as mock_chat:
            await reset_bot_service.parse("明天天气怎么样", "web", "E001")
        assert mock_chat.await_args.kwargs.get("enterprise_id") == "E001"


# ============================================================================
# C. LLM 不可用 / 无 Key → 走 C 档兜底 (业务不中断)
# ============================================================================

class TestParseLLMUnavailableFallback:
    """LLMService 内部检测到无 Key / 熔断 → 返回 fallback!=none, ECO-09 透传给用户."""

    async def test_no_api_key_returns_fallback_content(self, reset_bot_service):
        with patch(
            "app.services.llm_service.llm_service.chat",
            new=AsyncMock(return_value=_api_chat_fallback("no_key_or_circuit")),
        ):
            r = await reset_bot_service.parse("帮我看看明天天气", "web", "E001")
        assert r.intent == "llm_fallback"
        assert r.confidence == 0.3  # fallback != "none" → 低置信
        assert "暂时不可用" in r.entities["llm_reply"]

    async def test_circuit_open_returns_fallback_content(self, reset_bot_service):
        """熔断开启时 LLMService 走兜底, ECO-09 收到 fallback="no_key_or_circuit"."""
        with patch(
            "app.services.llm_service.llm_service.chat",
            new=AsyncMock(return_value=_api_chat_fallback("no_key_or_circuit",
                                                         "AI 助手暂时不可用 (no_key_or_circuit)。")),
        ):
            r = await reset_bot_service.parse("今天股市行情", "web", "E001")
        assert r.intent == "llm_fallback"
        assert r.confidence == 0.3
        assert "暂时不可用" in r.entities["llm_reply"]


# ============================================================================
# D. 端到端熔断状态机: 真实 LLMService + 熔断器开启
# ============================================================================

class TestCircuitBreakerEndToEnd:
    """直接构造熔断态的 LLMService, 验证 ECO-09 ↔ LLM 真实交互链路."""

    async def test_circuit_open_blocks_real_call(self, reset_bot_service):
        """熔断器开启 → 不应发起 httpx 调用, 直接走兜底."""
        from app.services.llm_service import CircuitBreaker, LLMService

        svc = LLMService()
        svc.api_key = "sk-fake-real-call"  # 模拟已配 Key
        svc.circuit = CircuitBreaker(threshold=1, cooldown=60)
        svc.circuit.record_failure()  # 主动触发熔断开启
        assert svc.circuit.is_open is True

        # 用 patch 把模块级单例替换为我们构造的 svc
        with patch("app.services.llm_service.llm_service", svc), \
                patch(
                    "app.services.redis_client.rate_limit",
                    new=AsyncMock(return_value=True),
                ), \
                patch(
                    "app.services.llm_service.LLMService._call_with_retry",
                    new=AsyncMock(side_effect=AssertionError("熔断时不应调 API")),
                ):
            r = await reset_bot_service.parse("帮我预测下个月销售额", "web", "E001")

        assert r.intent == "llm_fallback"
        assert r.confidence == 0.3
        assert "暂时不可用" in r.entities["llm_reply"]

    async def test_circuit_recovers_after_cooldown(self, reset_bot_service):
        """熔断 cooldown 过期后 → 半开, 允许重试, 成功后 reset 失败计数."""
        import time as _time

        from app.services.llm_service import CircuitBreaker, LLMService

        svc = LLMService()
        svc.api_key = "sk-fake"
        svc.circuit = CircuitBreaker(threshold=1, cooldown=1)
        svc.circuit.record_failure()
        assert svc.circuit.is_open is True

        # 模拟 cooldown 已过 (回拨 _opened_at)
        svc.circuit._opened_at = _time.time() - 2

        # 重试期间 _call_with_retry 返回成功响应
        async def _ok_call(*a, **kw):
            return {
                "choices": [{"message": {"content": "下个月销售额预计 80 万"}}],
                "usage": {"prompt_tokens": 5, "completion_tokens": 10},
            }

        with patch("app.services.llm_service.llm_service", svc), \
                patch(
                    "app.services.redis_client.rate_limit",
                    new=AsyncMock(return_value=True),
                ), \
                patch.object(LLMService, "_call_with_retry", new=_ok_call):
            r = await reset_bot_service.parse("帮我预测下个月销售额", "web", "E001")

        assert r.intent == "llm_fallback"
        assert r.confidence == 0.6  # 恢复成功 → fallback == "none"
        assert "80 万" in r.entities["llm_reply"]


# ============================================================================
# E. 边界: 短文本不触发 LLM
# ============================================================================

class TestParseEdgeCases:
    async def test_short_text_no_llm(self, reset_bot_service):
        """文本长度 ≤ 2 字符 → 不调用 LLM, intent=unknown."""
        with patch(
            "app.services.llm_service.llm_service.chat",
            new=AsyncMock(side_effect=AssertionError("短文本不应调 LLM")),
        ):
            r = await reset_bot_service.parse("hi", "web", "E001")
        assert r.intent == "unknown"
        assert r.confidence == 0.3
        assert "llm_reply" not in r.entities

    async def test_empty_text_no_llm(self, reset_bot_service):
        with patch(
            "app.services.llm_service.llm_service.chat",
            new=AsyncMock(side_effect=AssertionError("空文本不应调 LLM")),
        ):
            r = await reset_bot_service.parse("", "web", "E001")
        assert r.intent == "unknown"

    async def test_chinese_punctuation_not_treated_as_short(self, reset_bot_service):
        """3 字符以上的中文标点也算长文本, 会调用 LLM."""
        with patch(
            "app.services.llm_service.llm_service.chat",
            new=AsyncMock(return_value=_api_chat_success("好")),
        ) as mock_chat:
            r = await reset_bot_service.parse("你好？", "web", "E001")
        assert mock_chat.await_count == 1
        assert r.intent == "llm_fallback"


# ============================================================================
# F. execute 阶段: llm_fallback intent 正确渲染
# ============================================================================

class TestExecuteLLMFallback:
    """execute 收到 intent=llm_fallback → 把 entities.llm_reply 渲染成回复卡片."""

    async def test_llm_reply_in_response(self, reset_bot_service):
        from app.schemas.eco import BotCommandParse, BotExecuteInput

        parse = BotCommandParse(
            intent="llm_fallback",
            confidence=0.6,
            entities={"llm_reply": "明天贷款利率大概率会降 0.1%"},
            rawText="帮我分析下明天贷款利率走势",
            originalChannel="web",
        )
        inp = BotExecuteInput(parse=parse)
        r = await reset_bot_service.execute(inp)

        assert r.success is True
        assert r.intent == "llm_fallback"
        assert "明天贷款利率大概率会降 0.1%" in r.reply_text
        assert r.reply_card is not None
        assert r.reply_card.card_type == "list"

    async def test_llm_reply_missing_falls_back_to_default(self, reset_bot_service):
        """entities 缺失 llm_reply 时, execute 用默认提示语, 不抛异常."""
        from app.schemas.eco import BotCommandParse, BotExecuteInput

        parse = BotCommandParse(
            intent="llm_fallback",
            confidence=0.6,
            entities={},
            rawText="测试",
            originalChannel="web",
        )
        r = await reset_bot_service.execute(BotExecuteInput(parse=parse))
        assert r.success is True
        assert r.reply_text  # 至少有默认文案


# ============================================================================
# G. 端到端链路: parse → execute
# ============================================================================

class TestEndToEndChain:
    """parse → execute 完整链路, LLM 成功/降级两条路径都覆盖."""

    async def test_full_chain_llm_success(self, reset_bot_service):
        with patch(
            "app.services.llm_service.llm_service.chat",
            new=AsyncMock(return_value=_api_chat_success("明天利率降 0.1%")),
        ):
            parse = await reset_bot_service.parse(
                "帮我分析下明天利率走势", "web", "E001",
            )
            from app.schemas.eco import BotExecuteInput
            result = await reset_bot_service.execute(BotExecuteInput(parse=parse))

        assert parse.intent == "llm_fallback"
        assert result.success is True
        assert "明天利率降 0.1%" in result.reply_text

    async def test_full_chain_llm_fallback(self, reset_bot_service):
        """LLM 不可用 → parse 返回兜底内容 → execute 透传给用户."""
        with patch(
            "app.services.llm_service.llm_service.chat",
            new=AsyncMock(return_value=_api_chat_fallback("no_key_or_circuit")),
        ):
            parse = await reset_bot_service.parse(
                "帮我预测下季度销售额", "web", "E001",
            )
            from app.schemas.eco import BotExecuteInput
            result = await reset_bot_service.execute(BotExecuteInput(parse=parse))

        assert parse.intent == "llm_fallback"
        assert parse.confidence == 0.3  # 降级低置信
        assert result.success is True
        assert "暂时不可用" in result.reply_text


# ============================================================================
# H. HTTP 路由集成 (/eco-bot/parse 端点)
# ============================================================================

class TestHttpRouteIntegration:
    """通过 ASGI transport 验证 /eco-bot/parse 端点打通."""

    async def test_parse_route_returns_llm_fallback(self, client):
        payload = {
            "text": "帮我分析下明天利率走势",
            "channel": "web",
            "enterpriseId": "E001",
        }
        with patch(
            "app.services.llm_service.llm_service.chat",
            new=AsyncMock(return_value=_api_chat_success("明天利率降 0.1%")),
        ):
            r = await client.post("/api/v1/eco-bot/parse", json=payload)
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        data = body["data"]
        assert data["intent"] == "llm_fallback"
        assert data["confidence"] == 0.6
        assert "明天利率降 0.1%" in data["entities"]["llm_reply"]

    async def test_parse_route_rule_hit_no_llm(self, client):
        """规则命中路径在 HTTP 层也必须返回正确 intent, 不调 LLM."""
        payload = {
            "text": "改造进度怎么样了",
            "channel": "web",
            "enterpriseId": "E001",
        }
        with patch(
            "app.services.llm_service.llm_service.chat",
            new=AsyncMock(side_effect=AssertionError("规则命中不应调 LLM")),
        ):
            r = await client.post("/api/v1/eco-bot/parse", json=payload)
        assert r.status_code == 200
        assert r.json()["data"]["intent"] == "query_progress"

    async def test_execute_route_renders_llm_reply(self, client):
        """execute 端点收到 parse 结果 → 渲染 LLM 回答."""
        # 先调 parse 拿到结构
        parse_payload = {
            "text": "帮我分析下明天利率走势",
            "channel": "web",
            "enterpriseId": "E001",
        }
        with patch(
            "app.services.llm_service.llm_service.chat",
            new=AsyncMock(return_value=_api_chat_success("明天利率降 0.1%")),
        ):
            parse_resp = await client.post("/api/v1/eco-bot/parse", json=parse_payload)
        assert parse_resp.status_code == 200
        parse_data = parse_resp.json()["data"]

        # 把 parse 结果作为 execute 输入
        exec_payload = {"parse": parse_data}
        exec_resp = await client.post("/api/v1/eco-bot/execute", json=exec_payload)
        assert exec_resp.status_code == 200
        exec_data = exec_resp.json()["data"]
        assert exec_data["success"] is True
        assert exec_data["intent"] == "llm_fallback"
        assert "明天利率降 0.1%" in exec_data["replyText"]
