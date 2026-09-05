# DeepSeek 模块故障演练计划 (Chaos Engineering)

> 目标: 在受控环境模拟 Redis + DeepSeek 同时不可用等极端场景,
> 验证 LLMService 的限流 / 熔断 / 兜底状态机在多故障叠加下的稳定性,
> 找出隐性 bug 与告警盲区.

## 一、演练前置条件

### 1.1 被测系统 (SUT)

| 组件 | 文件 | 关键状态机 |
|---|---|---|
| `EcoBotService` | [eco_service.py](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/app/services/eco_service.py) | parse → execute 链路 |
| `LLMService` | [llm_service.py](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/app/services/llm_service.py) | 限流 → PII → 缓存 → 熔断 → 重试 → 兜底 |
| `CircuitBreaker` | [llm_service.py:72](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/app/services/llm_service.py#L72) | CLOSED → OPEN → 半开 → CLOSED |
| `redis_client` | [redis_client.py](file:///c:/Users/Windcs/Desktop/caiwu/jinrong/production/backend/app/services/redis_client.py) | 限流 + 缓存读写 |

### 1.2 故障注入工具

| 工具 | 用途 | 安装 |
|---|---|---|
| `tests/stress_eco_bot.py` | 直连 LLMService 故障注入压测 | 已有 |
| `unittest.mock.patch` | Python 层 monkeypatch | Python 标准库 |
| `toxiproxy` 或 `socat` | 网络层故障注入 (端口级) | Docker 镜像 `ghcr.io/shopify/toxiproxy` |
| `docker compose stop` | 容器级停服 | Docker 内置 |
| `tc qdisc` | 限速/丢包 (Linux) | Linux 内置 |

### 1.3 监控面板 (实时观测)

- Grafana + Loki (见 `infra/observability/loki-promtail/`)
- 关键指标: `LLM_LIMIT_TRIGGER` / `LLM_RATE_DEGRADE` / `LLM_CB_OPEN` / `LLM_CB_FALLBACK` / `LLM_CB_RECOVERED` / `LLM_CALL_FAILED`
- 必跑命令 (验证埋点全开):
  ```bash
  python tests/stress_eco_bot.py --mode direct --scenario circuit_breaker --total 12
  ```

---

## 二、故障演练场景矩阵

### S1: Redis 单点不可用 (最常见)

| 项 | 值 |
|---|---|
| **场景目标** | 验证 Redis 挂掉后, 限流/缓存降级放行, LLM 调用本身仍能完成 |
| **故障注入** | `docker compose stop redis` |
| **预期行为** | `redis_client.rate_limit` 返回 True (降级放行)<br>`LLMService._get_cached` 返回 None (跳过缓存)<br>DeepSeek 调用正常成功, fallback="none" |
| **预期日志** | `WARNING redis_client:87 Redis 不可用, 限流降级放行` 每次调用 1 条 |
| **演练步骤** | 1. 启动后端 + Redis<br>2. 跑 1 次正常调用确认基线<br>3. `docker compose stop redis`<br>4. 跑 10 次同企业调用<br>5. 看日志确认降级放行 + DeepSeek 仍返回 200<br>6. `docker compose start redis` 验证恢复 |
| **失败信号** | 后端抛 ConnectionError 500; DeepSeek 被打爆 (无限放行); 无降级放行日志 |

### S2: LLM 单点不可用 (DeepSeek API 故障)

| 项 | 值 |
|---|---|
| **场景目标** | 验证 DeepSeek 5xx/超时时, 熔断器正确开启, 走 C 档兜底 |
| **故障注入** | `DEEPSEEK_BASE_URL=http://localhost:9999/v1` (指向不存在的端口)<br>或 `tests/stress_eco_bot.py --scenario circuit_breaker` |
| **预期行为** | 前 5 次失败 → 第 5 次熔断开启 → 第 6 次起走兜底, 不调 DeepSeek<br>cooldown 过后半开 → 第一次成功 → 恢复 CLOSED |
| **预期日志** | 5 条 `LLM 调用失败 (req=*)` + 1 条 `LLM 熔断器开启/续期`<br>N 条 `LLM 走熔断兜底`<br>1 条 `LLM 熔断器已恢复 (CLOSED, threshold=5, ...)` |
| **演练步骤** | 1. 跑 `python tests/stress_eco_bot.py --mode direct --scenario circuit_breaker --concurrency 5 --total 20`<br>2. 看日志 + 汇总报告<br>3. 确认熔断器状态机完整闭环 |
| **失败信号** | 熔断器始终 CLOSED (record_failure 未生效); 持续调 DeepSeek 浪费 token; 兜底内容为空 |

### S3: Redis + LLM 同时不可用 (复合故障, 高危)

| 项 | 值 |
|---|---|
| **场景目标** | 验证 Redis 与 DeepSeek 双双挂掉时, 系统不崩, 返回兜底内容, 业务连续 |
| **故障注入** | 1. `docker compose stop redis`<br>2. 修改 `.env` 设 `DEEPSEEK_API_KEY=` (空 Key)<br>3. 重启 backend |
| **预期行为** | `redis_client.rate_limit` → 返回 True (降级放行, 不限流)<br>`LLMService.available` = False → 走 `_fallback(reason="no_key_or_circuit")`<br>返回兜底内容 `"AI 助手暂时不可用 (no_key_or_circuit)..."` |
| **预期日志** | 每次请求: `WARNING redis_client:87 Redis 不可用, 限流降级放行`<br>+ `WARNING llm_service:201 LLM 走熔断兜底 (available=False, CB.is_open=False, ...)` |
| **演练步骤** | 1. 启动 backend + Redis<br>2. 停 Redis + 清 DEEPSEEK_API_KEY, 重启<br>3. 跑 20 次同企业调用<br>4. 看日志确认双降级<br>5. 启 Redis + 还原 Key, 验证全部恢复 |
| **失败信号** | 后端抛异常 500; 限流没降级放行 (DeepSeek 真调用, token 浪费); 兜底返回空 |

### S4: Redis 限流触发 + LLM 熔断兜底 (用户视角: 全部失败)

| 项 | 值 |
|---|---|
| **场景目标** | 验证限流和熔断同时生效时, 用户请求被双重拦截, 但响应仍优雅 |
| **故障注入** | 1. Redis 在跑<br>2. mock `_call_with_retry` 抛 ConnectError 触发熔断<br>3. 同一企业高频并发 (50 QPS) 触发 10/min 限流 |
| **预期行为** | 前 10 个请求: 走 DeepSeek 真调用 → 失败 → record_failure<br>第 11-20 个请求: 走熔断兜底 fallback="no_key_or_circuit"<br>同企业下: 限流可能在熔断期间生效, fallback="rate-limited" |
| **预期日志** | 部分 `LLM 限流触发` + 部分 `LLM 走熔断兜底` |
| **演练步骤** | 1. 写一个特殊压测: 50 并发, mock `rate_limit` 真实调用 Redis<br>2. mock `_call_with_retry` 抛 ConnectError<br>3. 跑 1 分钟, 看日志中两种 fallback 的分布 |
| **失败信号** | fallback 字段为空; 限流和熔断未同时生效 |

### S5: Redis 网络抖动 (间歇性失败, 边缘场景)

| 项 | 值 |
|---|---|
| **场景目标** | 验证 Redis 间歇性失败时, 限流逻辑不被卡住, LLM 仍能完成调用 |
| **故障注入** | 用 toxiproxy 对 Redis 端口注入 50% 丢包 + 100ms 延迟 |
| **预期行为** | 限流: 部分请求 rate_limit 抛异常 → 降级放行<br>缓存: _get_cached 抛异常 → 跳过缓存<br>LLM 调用: 仍成功 (受 DeepSeek 自身性能限制) |
| **预期日志** | 部分 `Redis 不可用, 限流降级放行` + 部分 `LLM 调用失败 (req=*): RedisError`<br>→ 这是当前已知盲点 (rate_limit Redis 操作异常未 try/except, 详见审计报告) |
| **演练步骤** | 1. 部署 toxiproxy 转发 redis:6379 → redis-real:6379<br>2. 注入 50% 丢包<br>3. 跑 50 并发压测<br>4. 看 fallback 分布 |
| **失败信号** | 后端崩; 部分请求超时未响应 |

### S6: LLM 慢响应触发超时 (DeepSeek 拥塞)

| 项 | 值 |
|---|---|
| **场景目标** | 验证 DeepSeek 响应 > 30s (chat) / 60s (reasoner) 时, 重试与超时机制生效 |
| **故障注入** | mock `_call_with_retry` sleep 60s 再返回成功 |
| **预期行为** | httpx 30s 超时 → 抛 TimeoutException → tenacity 重试 3 次<br>第 3 次仍超时 → 走 _fallback(reason="call_failed:ReadTimeout")<br>连续 5 次后熔断开启 |
| **预期日志** | `LLM 调用失败 (req=*): ReadTimeout` + `LLM 熔断器开启/续期` |
| **演练步骤** | 1. mock `_call_with_retry` sleep 60s<br>2. 跑 5 次串行调用 (避免并发干扰)<br>3. 看每次 fallback 是 call_failed:ReadTimeout<br>4. 第 5 次后熔断开启 |
| **失败信号** | 卡死等待; 无超时机制; 熔断未触发 |

---

## 三、演练流程 (Runbook)

### 3.1 演练前 (T-1 day)

- [ ] 备份当前 backend 镜像: `docker tag fintrust/backend:3.1.0 fintrust/backend:backup-pre-chaos`
- [ ] 通知团队演练时间窗口 (建议 30 min)
- [ ] 确认 Grafana 看板可访问, 告警通道 (钉钉/企微) 已通
- [ ] 准备回滚脚本: `scripts/rollback-chaos.sh`

### 3.2 演练中 (T+0)

每个场景按以下流程:

1. **基线** (T+0): 跑 1 次正常请求, 确认 fallback="none"
2. **注入故障** (T+1min): 按场景说明操作
3. **执行压测** (T+2min): 跑 `stress_eco_bot.py --mode direct --scenario <对应场景>`
4. **观测** (T+3min):
   - Grafana 看板指标曲线
   - Loki 实时日志流 (`{service="backend"} |= "LLM"`)
   - 告警是否触发
5. **记录** (T+5min): 截图 + fallback 分布统计
6. **恢复** (T+6min): 反向操作还原故障注入

### 3.3 演练后 (T+1 day)

- [ ] 编写演练报告 (对照每个场景的预期 vs 实际)
- [ ] 失败信号触发的项 → 立 P0/P1 bug 跟踪
- [ ] 更新 Runbook

---

## 四、复合故障演练脚本 (S3 专用)

```python
"""演练 S3: Redis + LLM 同时不可用"""
import asyncio
from unittest.mock import AsyncMock, patch
from app.services.llm_service import llm_service

async def main():
    # 模拟 DeepSeek Key 被清空 (LLM 不可用)
    llm_service.api_key = ""
    llm_service.circuit._failures = 0

    # Redis 未启动时, rate_limit 会自动降级放行 (无需 mock)
    # 但为了精准模拟, 显式 mock 返回 True 走"降级放行"日志
    # 真实演练用 docker compose stop redis, 不 mock

    print("=== 演练 S3: Redis + LLM 同时不可用 ===")
    for i in range(5):
        r = await llm_service.chat(
            messages=[{"role": "user", "content": f"测试 {i}"}],
            enterprise_id=f"E00{i}",
            scene="chaos_s3",
            request_id=f"chaos-s3-{i}",
            use_cache=False,
        )
        print(f"[{i}] fallback={r['fallback']}, content={r['content'][:60]}")

asyncio.run(main())
```

预期输出 (每行 1 条 WARNING + 1 条 WARNING):
```
WARNING redis_client:rate_limit:87 - Redis 不可用, 限流降级放行 (key=llm:rl:E00X, ...)
WARNING llm_service:chat:201       - LLM 走熔断兜底 (req=chaos-s3-X, ent=E00X, available=False, CB.is_open=False, CB._failures=0)
[0] fallback=no_key_or_circuit, content=AI 助手暂时不可用 (no_key_or_circuit)。您的问题已记录: 测试 0...
```

---

## 五、退出标准 (Pass Criteria)

| 场景 | Pass | Fail |
|---|---|---|
| S1 | 限流降级放行, LLM 仍成功 | 后端 500 / 无降级日志 |
| S2 | 熔断完整闭环, 不调 DeepSeek | 持续调 DeepSeek 浪费 token |
| S3 | 双降级, 兜底内容含"不可用" | 后端崩 / fallback 空 |
| S4 | 限流+熔断双 fallback | 任一未触发 |
| S5 | 限流降级放行 + 部分失败 | 后端卡死 |
| S6 | 超时重试 3 次后熔断 | 卡死等待 |

---

## 六、演练计划时间表 (建议)

| 阶段 | 周期 | 场景 |
|---|---|---|
| 第 1 周 | 周二 14:00-14:30 | S1 + S2 (单点故障) |
| 第 2 周 | 周二 14:00-14:30 | S3 (复合故障, 重点) |
| 第 3 周 | 周二 14:00-14:30 | S4 + S5 (边缘场景) |
| 第 4 周 | 周二 14:00-14:30 | S6 (超时场景) |
| 持续 | 每月 | 全场景回归 (Chaos Day) |

---

## 七、演练记录模板

```
## 演练 S1 (2026-MM-DD)
- 注入时间: 14:00
- 基线 (T+0): 5 次正常调用, 全部 fallback="none"
- 故障注入 (T+1min): docker compose stop redis
- 压测 (T+2min): python tests/stress_eco_bot.py --mode direct --scenario circuit_breaker --total 20
- 观测 (T+3min):
  - 日志: 20 条 "Redis 不可用, 限流降级放行" ✓
  - 告警: LLMRateLimitDegrade (critical) 触发 ✓
  - fallback 分布: no_key_or_circuit 20 (100%) — 因为 LLM 也停了, 全走兜底
- 恢复 (T+6min): docker compose start redis
- 结论: PASS

## 演练 S2 (2026-MM-DD)
...
```
