"""ECO-09 数字分身 ↔ DeepSeek 高并发压测脚本.

设计目标 (按用户要求):
    1. 模拟高并发场景下熔断器表现 (连续失败达阈值 → 熔断 → cooldown 后恢复)
    2. 模拟限流触发表现 (QPS 超阈值 → 走限流兜底, 不打 DeepSeek)
    3. 真实链路压测 (经 HTTP API → LLMService → DeepSeek, 验证端到端吞吐)

两种运行模式:
    --mode http     : 真实 HTTP 压测, 直连 /api/v1/eco-bot/parse, 调真实 DeepSeek
    --mode direct   : 直连 LLMService, monkeypatch _call_with_retry 注入故障, 验证熔断状态机

用法:
    # 真实链路压测 (注意会消耗 DeepSeek token)
    python tests/stress_eco_bot.py --mode http --concurrency 5 --total 20

    # 熔断器状态机验证 (无外部依赖, 故障注入)
    python tests/stress_eco_bot.py --mode direct --scenario circuit_breaker
    python tests/stress_eco_bot.py --mode direct --scenario rate_limit
    python tests/stress_eco_bot.py --mode direct --scenario mixed

输出:
    - 每个请求的 latency / fallback 原因
    - 汇总: 成功率 / p50/p95/p99 / fallback 分布 / 熔断器状态变化
"""

from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import sys
import time
from collections import Counter
from typing import Any

# 让 tests 目录可导入 app
sys.path.insert(0, ".")


COLOR_GREEN = "\033[32m"
COLOR_RED = "\033[31m"
COLOR_YELLOW = "\033[33m"
COLOR_CYAN = "\033[36m"
COLOR_RESET = "\033[0m"


def _c(text: str, color: str) -> str:
    return f"{color}{text}{COLOR_RESET}"


# ============================================================================
# 模式 1: HTTP 压测 (真实链路)
# ============================================================================

async def _http_one_request(client, payload: dict) -> dict:
    """单次 HTTP 请求, 返回 {latency, intent, fallback}."""
    t0 = time.perf_counter()
    try:
        import httpx
        r = await client.post("/api/v1/eco-bot/parse", json=payload, timeout=60.0)
        dt = (time.perf_counter() - t0) * 1000
        if r.status_code != 200:
            return {"latency": dt, "intent": "http_error", "fallback": f"http_{r.status_code}"}
        data = r.json().get("data", {})
        return {
            "latency": dt,
            "intent": data.get("intent"),
            "fallback": data.get("entities", {}).get("llm_fallback", "n/a"),
        }
    except Exception as e:
        dt = (time.perf_counter() - t0) * 1000
        return {"latency": dt, "intent": "exception", "fallback": f"exc:{type(e).__name__}"}


async def run_http_mode(concurrency: int, total: int, base_url: str) -> None:
    """真实 HTTP 压测."""
    import httpx

    # 故意用多个不同问法, 触发规则匹配和 LLM 兜底两条路径
    payloads = [
        {"text": "改造进度怎么样了", "channel": "web", "enterpriseId": "E001"},  # 命中规则
        {"text": "帮我分析下明天利率走势", "channel": "web", "enterpriseId": "E001"},  # 走 LLM
        {"text": "我的信用分多少", "channel": "web", "enterpriseId": "E001"},  # 命中规则
        {"text": "帮我预测下季度销售额", "channel": "web", "enterpriseId": "E001"},  # 走 LLM
    ]

    print(_c(f"\n[HTTP 压测] 并发={concurrency} 总数={total} 目标={base_url}", COLOR_CYAN))
    print("-" * 70)

    sem = asyncio.Semaphore(concurrency)
    results: list[dict] = []

    async with httpx.AsyncClient(base_url=base_url) as client:
        async def _worker(idx: int):
            async with sem:
                payload = payloads[idx % len(payloads)]
                r = await _http_one_request(client, payload)
                r["idx"] = idx
                results.append(r)
                tag = "✓" if r["fallback"] in ("none", "n/a") else "✗"
                color = COLOR_GREEN if tag == "✓" else COLOR_YELLOW
                print(f"  [{idx:3d}] {tag} {r['latency']:7.1f}ms  intent={r['intent']:15s}  fb={r['fallback'][:40]}"[:90])
                print(color, end="")  # 不实际换行, 用 reset
                print(COLOR_RESET, end="")

        await asyncio.gather(*[_worker(i) for i in range(total)])

    _print_summary(results)


# ============================================================================
# 模式 2: 直连 LLMService (故障注入, 验证熔断状态机)
# ============================================================================

def _make_fault_injector(fail_rate: float, latency_ms: float = 0):
    """构造一个故障注入器: 按 fail_rate 抛异常, 否则返回成功响应.

    fail_rate=1.0 → 全部失败 (用来精准触发熔断)
    fail_rate=0.5 → 一半失败 (混合场景)
    """
    import random

    async def _fake_call(self, payload, headers, model):
        if latency_ms:
            await asyncio.sleep(latency_ms / 1000)
        if random.random() < fail_rate:
            import httpx
            raise httpx.ConnectError("fault-injected connect error")
        return {
            "choices": [{"message": {"content": f"模拟成功响应 (model={model})"}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 8},
            "model": model,
        }
    return _fake_call


async def run_circuit_breaker_scenario(concurrency: int, total: int) -> None:
    """熔断器场景: 持续故障注入, 验证阈值→熔断→半开→恢复."""
    from unittest.mock import patch
    from app.services.llm_service import LLMService, llm_service

    print(_c("\n[熔断器场景] 注入持续故障, 观察熔断阈值与恢复", COLOR_CYAN))
    print("-" * 70)
    print(f"  CircuitBreaker 默认 threshold=5, cooldown=60s")
    print(f"  并发={concurrency} 总数={total} 全部注入失败 (fail_rate=1.0)")
    print("-" * 70)

    # 重置全局单例熔断器
    llm_service.circuit._failures = 0
    llm_service.circuit._opened_at = 0.0
    # 强制设 Key 让熔断器可用性检查通过
    llm_service.api_key = "sk-stress-test-fake"

    # 缩短 cooldown 便于演示 (改成 3 秒)
    llm_service.circuit.cooldown = 3

    results: list[dict] = []
    sem = asyncio.Semaphore(concurrency)

    with patch("app.services.redis_client.rate_limit", new=_async_return_true), \
         patch.object(LLMService, "_call_with_retry", new=_make_fault_injector(fail_rate=1.0)):
        async def _worker(idx: int):
            async with sem:
                t0 = time.perf_counter()
                r = await llm_service.chat(
                    messages=[{"role": "user", "content": f"测试 {idx}"}],
                    enterprise_id=f"E{idx % 5:03d}",
                    scene="stress_test",
                    request_id=f"stress-{idx}",
                    use_cache=False,  # 关闭缓存, 避免干扰熔断器
                )
                dt = (time.perf_counter() - t0) * 1000
                results.append({"idx": idx, "latency": dt, **r})
                cb_state = "OPEN" if llm_service.circuit.is_open else f"CLOSED(fail={llm_service.circuit._failures})"
                tag = "⚡" if r["fallback"] != "none" else "✓"
                print(f"  [{idx:3d}] {tag} {dt:6.1f}ms  fb={r['fallback'][:35]:35s}  CB={cb_state}")

        await asyncio.gather(*[_worker(i) for i in range(total)])

    _print_circuit_breaker_state(llm_service)
    _print_summary(results)

    # 第二阶段: 等 cooldown 过后, 改 fail_rate=0, 验证恢复
    print(_c("\n--- 第二阶段: cooldown 过后注入成功, 验证熔断恢复 ---", COLOR_YELLOW))
    await asyncio.sleep(3.5)
    print(f"  等待 3.5s 后熔断器 is_open={llm_service.circuit.is_open}, _failures={llm_service.circuit._failures}")
    print("-" * 70)

    with patch("app.services.redis_client.rate_limit", new=_async_return_true), \
         patch.object(LLMService, "_call_with_retry", new=_make_fault_injector(fail_rate=0.0)):
        # 故意串行跑 3 个, 看熔断器在半开→闭的恢复过程
        for i in range(3):
            r = await llm_service.chat(
                messages=[{"role": "user", "content": f"恢复测试 {i}"}],
                enterprise_id="E001",
                scene="stress_recovery",
                request_id=f"recover-{i}",
                use_cache=False,
            )
            cb_state = "OPEN" if llm_service.circuit.is_open else f"CLOSED(fail={llm_service.circuit._failures})"
            tag = "✓" if r["fallback"] == "none" else "✗"
            print(f"  [R{i}] {tag} fb={r['fallback'][:30]:30s}  CB={cb_state}")


async def run_rate_limit_scenario(concurrency: int, total: int) -> None:
    """限流场景: 高并发同企业, 验证 10/分钟阈值."""
    from unittest.mock import patch
    from app.services.llm_service import llm_service

    print(_c("\n[限流场景] 同企业高并发, 验证 10/分钟阈值", COLOR_CYAN))
    print("-" * 70)
    print(f"  并发={concurrency} 总数={total} 同 enterprise_id=E001")
    print("-" * 70)

    # 重置状态
    llm_service.circuit._failures = 0
    llm_service.api_key = "sk-stress-test-fake"

    # 接入真实 redis_client.rate_limit (需 Redis 在跑)
    # 若 Redis 未跑, rate_limit 返回 True (降级放行), 无法测限流
    from app.services.redis_client import init_redis, get_redis
    await init_redis()
    redis = get_redis()
    if redis is None:
        print(_c("  ⚠ Redis 未启动, 限流场景无法真实触发, 自动降级放行全部请求", COLOR_YELLOW))
        print(_c("  解决: 先 docker compose up redis, 或本地启动 redis-server", COLOR_YELLOW))
        # 仍跑一遍, 验证降级行为
    else:
        print(_c("  ✓ Redis 已连接, 真实限流生效", COLOR_GREEN))

    with patch.object(llm_service.__class__, "_call_with_retry", new=_make_fault_injector(fail_rate=0.0)):
        sem = asyncio.Semaphore(concurrency)
        results: list[dict] = []

        async def _worker(idx: int):
            async with sem:
                t0 = time.perf_counter()
                r = await llm_service.chat(
                    messages=[{"role": "user", "content": f"限流测试 {idx}"}],
                    enterprise_id="E001",  # 故意同一企业
                    scene="stress_rate_limit",
                    request_id=f"rl-{idx}",
                    use_cache=False,
                )
                dt = (time.perf_counter() - t0) * 1000
                results.append({"idx": idx, "latency": dt, **r})
                tag = "🚦" if r["fallback"] == "rate-limited" else "✓"
                print(f"  [{idx:3d}] {tag} {dt:6.1f}ms  fb={r['fallback'][:35]}")

        await asyncio.gather(*[_worker(i) for i in range(total)])

    _print_summary(results)


async def run_mixed_scenario(concurrency: int, total: int) -> None:
    """混合场景: 50% 成功 50% 失败, 验证熔断器开闭切换稳定性."""
    from unittest.mock import patch
    from app.services.llm_service import LLMService, llm_service

    print(_c("\n[混合场景] 50% 故障注入, 验证熔断器开闭切换稳定性", COLOR_CYAN))
    print("-" * 70)

    llm_service.circuit._failures = 0
    llm_service.circuit.cooldown = 5
    llm_service.api_key = "sk-stress-test-fake"

    with patch("app.services.redis_client.rate_limit", new=_async_return_true), \
         patch.object(LLMService, "_call_with_retry", new=_make_fault_injector(fail_rate=0.5)):
        sem = asyncio.Semaphore(concurrency)
        results: list[dict] = []

        async def _worker(idx: int):
            async with sem:
                t0 = time.perf_counter()
                r = await llm_service.chat(
                    messages=[{"role": "user", "content": f"混合测试 {idx}"}],
                    enterprise_id=f"E{idx % 3:03d}",
                    scene="stress_mixed",
                    request_id=f"mix-{idx}",
                    use_cache=False,
                )
                dt = (time.perf_counter() - t0) * 1000
                results.append({"idx": idx, "latency": dt, **r})
                tag = "✓" if r["fallback"] == "none" else "✗"
                cb_state = "OPEN" if llm_service.circuit.is_open else "CLOSED"
                print(f"  [{idx:3d}] {tag} {dt:6.1f}ms  fb={r['fallback'][:25]:25s}  CB={cb_state}")

        await asyncio.gather(*[_worker(i) for i in range(total)])

    _print_summary(results)


# ============================================================================
# 工具
# ============================================================================

async def _async_return_true(*args, **kwargs):
    return True


def _print_summary(results: list[dict]) -> None:
    if not results:
        return
    latencies = [r["latency"] for r in results]
    latencies_sorted = sorted(latencies)

    def _p(p: float) -> float:
        idx = int(len(latencies_sorted) * p) - 1
        return latencies_sorted[max(0, min(idx, len(latencies_sorted) - 1))]

    fallbacks = Counter(r.get("fallback", "n/a") for r in results)
    success_count = sum(1 for r in results if r.get("fallback") in ("none", "n/a"))

    print("-" * 70)
    print(_c("汇总报告", COLOR_CYAN))
    print(f"  总请求数:      {len(results)}")
    print(f"  成功数:        {success_count} ({success_count * 100 / len(results):.1f}%)")
    print(f"  延迟 p50:      {_p(0.5):.1f}ms")
    print(f"  延迟 p95:      {_p(0.95):.1f}ms")
    print(f"  延迟 p99:      {_p(0.99):.1f}ms")
    print(f"  延迟 max:      {max(latencies):.1f}ms")
    print(f"  延迟 avg:      {statistics.mean(latencies):.1f}ms")
    print(f"  fallback 分布:")
    for fb, count in fallbacks.most_common():
        print(f"    - {fb[:50]:50s}  {count:4d}  ({count * 100 / len(results):.1f}%)")


def _print_circuit_breaker_state(svc) -> None:
    cb = svc.circuit
    print("-" * 70)
    print(_c("熔断器最终状态", COLOR_CYAN))
    print(f"  threshold:    {cb.threshold}")
    print(f"  cooldown:     {cb.cooldown}s")
    print(f"  _failures:    {cb._failures}")
    print(f"  _opened_at:   {cb._opened_at}")
    print(f"  is_open:      {cb.is_open}")


# ============================================================================
# 主入口
# ============================================================================

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="ECO-09 高并发压测脚本")
    p.add_argument("--mode", choices=["http", "direct"], default="direct",
                   help="http=真实链路, direct=故障注入直连 (default: direct)")
    p.add_argument("--scenario", choices=["circuit_breaker", "rate_limit", "mixed"],
                   default="circuit_breaker", help="direct 模式下的场景 (default: circuit_breaker)")
    p.add_argument("--concurrency", type=int, default=10, help="并发数 (default: 10)")
    p.add_argument("--total", type=int, default=30, help="总请求数 (default: 30)")
    p.add_argument("--base-url", default="http://localhost:8000", help="HTTP 模式目标地址")
    return p.parse_args()


async def main() -> None:
    args = parse_args()
    if args.mode == "http":
        await run_http_mode(args.concurrency, args.total, args.base_url)
    elif args.scenario == "circuit_breaker":
        await run_circuit_breaker_scenario(args.concurrency, args.total)
    elif args.scenario == "rate_limit":
        await run_rate_limit_scenario(args.concurrency, args.total)
    elif args.scenario == "mixed":
        await run_mixed_scenario(args.concurrency, args.total)


if __name__ == "__main__":
    asyncio.run(main())
