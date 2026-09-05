# FinTrust Hub 生产日志采集规则 (Loki + Promtail + Grafana)

## 设计目标

把后端 P0 关键埋点 (限流 / 熔断 / 熔断恢复 / Redis 降级放行) 实时采集到
Loki, 通过 Grafana 看板和告警规则让运维实时感知 DeepSeek 模块健康度.

## 文件清单

| 文件 | 用途 |
|---|---|
| `docker-compose.logging.yml` | Loki + Promtail + Grafana 一键拉起 (本地与生产同构) |
| `promtail-config.yml` | Promtail 采集规则: 监听 backend 日志文件, 解析 loguru JSON 行 |
| `loki-alerting-rules.yml` | Loki Ruler 告警规则: P0 关键日志触发告警 |
| `grafana-dashboard.json` | (略, 用户在 Grafana UI 导入即可) |

## P0 关键日志指纹 (告警依据)

| 标识 | 日志样本 (loguru serialize 后 record.message) | 含义 |
|---|---|---|
| `LLM_LIMIT_TRIGGER` | `LLM 限流触发 (req=*, ent=*, window=60s, max=10)` | 限流兜底, 企业 60s 内提问超 10 次 |
| `LLM_RATE_DEGRADE` | `Redis 不可用, 限流降级放行 (key=*, ...)` | Redis 挂掉, 限流失效, DeepSeek 直接被打爆风险 |
| `LLM_CB_OPEN` | `LLM 熔断器开启/续期, *s 内走兜底` | DeepSeek 连续失败达阈值, 进入熔断 |
| `LLM_CB_FALLBACK` | `LLM 走熔断兜底 (req=*, ent=*, CB.is_open=True, ...)` | 熔断期间请求走 C 档兜底 |
| `LLM_CB_RECOVERED` | `LLM 熔断器已恢复 (CLOSED, threshold=*, cooldown=*)` | cooldown 过后第一次成功, 熔断恢复 |
| `LLM_CALL_FAILED` | `LLM 调用失败 (req=*): *` | DeepSeek API 真实调用异常 |

## 启动

```bash
# 本地 / 生产同构
cd production/infra/observability/loki-promtail
docker compose -f docker-compose.logging.yml up -d

# 验证
curl http://localhost:3100/ready            # Loki ready
curl http://localhost:9080/metrics          # Promtail 采集指标
open http://localhost:3000                  # Grafana (admin/admin)
```

## K8s 生产部署

见 `infra/k8s/observability/`:
- `promtail-config-map.yaml` ConfigMap 形式的采集规则
- `loki-alerting-rules.yaml` ConfigMap 形式的告警规则
- 推荐用 Helm chart `grafana/loki-stack` 一键部署 (本配置可作为 values 覆盖)
