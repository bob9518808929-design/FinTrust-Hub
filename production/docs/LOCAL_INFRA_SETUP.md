# 本地基础设施连接配置模板 (Redis + ClickHouse)

> 范围: 本地开发环境一键拉起 Redis 与 ClickHouse, 并与后端 `redis_client.py` / `clickhouse_client.py` 对接
> 依据: spec.md L3503 技术栈总览、[redis_client.py](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/app/services/redis_client.py)、[clickhouse_client.py](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/app/services/clickhouse_client.py)
> 降级原则 (project_memory): 基础设施不可达时后端仅记 warning, 不阻断启动, 服务层降级到内存/PostgreSQL

---

## 1. 前置条件

| 组件 | 版本要求 | 验证命令 |
|---|---|---|
| Docker Desktop | 4.20+ (含 Compose v2) | `docker compose version` |
| Docker 引擎 | 24+ | `docker version` |
| 可用端口 | 6379 / 8123 / 9000 空闲 | `netstat -ano \| findstr "6379 8123 9000"` (Windows) |

---

## 2. .env 配置片段

以下片段对齐 [config.py](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/app/config.py) 字段名, 复制到 [backend/.env](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/.env) 即可。

### 2.1 Redis (缓存 / 限流 / 会话)

```ini
# === Redis ===
# 连接 URL 格式: redis://[password@]host:port/db
# 本地 docker (无密码): redis://localhost:6379/0
# 本地 docker (带密码): redis://:yourpass@localhost:6379/0
REDIS_URL=redis://localhost:6379/0
# 留空=无密码 (本地开发默认); 生产务必设置强密码
REDIS_PASSWORD=
```

**字段说明**:

| 字段 | 默认值 | 含义 |
|---|---|---|
| `REDIS_URL` | `redis://localhost:6379/0` | 连接地址, `/0` 表示使用第 0 号库 |
| `REDIS_PASSWORD` | (空) | 留空表示无密码鉴权 |

**库规划建议** (生产环境分库隔离):
- db0: 缓存 (业务热点数据)
- db1: 限流计数 (rate_limit)
- db2: 会话 (JWT refresh token / 钉钉会话上下文)

### 2.2 ClickHouse (时序指标)

```ini
# === ClickHouse ===
# HTTP 接口端口 (clickhouse_connect 使用, 非原生 TCP 9000)
CLICKHOUSE_HOST=localhost
CLICKHOUSE_PORT=8123
CLICKHOUSE_USER=default
# 留空=无密码 (本地开发默认); docker-compose 已开启 ACCESS_MANAGEMENT
CLICKHOUSE_PASSWORD=
CLICKHOUSE_DATABASE=fintrust_metrics
```

**字段说明**:

| 字段 | 默认值 | 含义 |
|---|---|---|
| `CLICKHOUSE_HOST` | `localhost` | ClickHouse HTTP 主机 |
| `CLICKHOUSE_PORT` | `8123` | HTTP 端口 (注意不是 9000 原生 TCP) |
| `CLICKHOUSE_USER` | `default` | 用户名 |
| `CLICKHOUSE_PASSWORD` | (空) | 密码, 留空表示无密码 |
| `CLICKHOUSE_DATABASE` | `fintrust_metrics` | 指标库, 不存在时需手动建库 |

---

## 3. 一键启动 (Docker Compose)

### 3.1 启动

```powershell
Set-Location c:\Users\Windws\Desktop\caiwu\jinrong\production\infra\docker
docker compose -f docker-compose.local.yml up -d
```

预期输出:

```
[+] Running 3/3
 ✔ Container fintrust-redis      Healthy
 ✔ Container fintrust-clickhouse Healthy
```

### 3.2 查看状态

```powershell
docker compose -f docker-compose.local.yml ps
docker compose -f docker-compose.local.yml logs -f redis clickhouse
```

### 3.3 停止

```powershell
# 停止 (保留数据卷, 下次启动数据还在)
docker compose -f docker-compose.local.yml down

# 停止并清空数据 (谨慎! 会丢失缓存和指标)
docker compose -f docker-compose.local.yml down -v
```

---

## 4. 健康检查

### 4.1 Redis 探活

```powershell
# 通过 docker exec
docker exec -it fintrust-redis redis-cli ping
# 预期: PONG

# 通过后端 (启动后端后访问日志会显示 "Redis 连接池已建立")
# 后端日志路径: backend/logs/fintrust-YYYY-MM-DD.log
```

### 4.2 ClickHouse 探活

```powershell
# HTTP ping
Invoke-WebRequest http://localhost:8123/ping -UseBasicParsing | Select-Object Content
# 预期: Ok.

# 建库 (首次启动后执行一次)
$body = "CREATE DATABASE IF NOT EXISTS fintrust_metrics"
Invoke-WebRequest -Uri http://localhost:8123/ -Method POST -Body $body -UseBasicParsing
```

### 4.3 后端启动日志验证

重启后端后, 日志应显示:

```
启动 FinTrust Hub Backend v3.1.0 (development)
数据库初始化完成 (开发模式 create_all)
Redis 连接池已建立
ClickHouse 客户端已建立
```

若服务未启动, 日志降级为 (应用仍可正常启动):

```
Redis 连接失败, 降级到无缓存: [Error...]
ClickHouse 连接失败, 时序指标降级到 PG/内存: [Error...]
```

---

## 5. 后端降级行为对照表

遵循 project_memory "零机构接入时仍可独立运行" 原则:

| 场景 | Redis 状态 | ClickHouse 状态 | 后端行为 |
|---|---|---|---|
| 全部就绪 | ✅ | ✅ | 缓存/限流/时序指标全功能 |
| Redis 挂 | ❌ | ✅ | 缓存穿透到业务层, 限流放行 (rate_limit 返回 True) |
| ClickHouse 挂 | ✅ | ❌ | 时序指标降级到 PostgreSQL/内存, 不报错 |
| 全挂 | ❌ | ❌ | 应用正常启动, 仅日志 warning, 业务接口可用 |
| driver 未安装 | — | — | redis[hiredis] / clickhouse-connect 缺失时同样降级 |

---

## 6. 常见故障排查

### 6.1 端口被占用

```
Error: Bind address already in use
```

处理: 修改 `docker-compose.local.yml` 端口映射, 或停止占用进程:

```powershell
# 查找占用进程
netstat -ano | findstr ":6379"
taskkill /PID <PID> /F
```

### 6.2 后端日志显示 "Redis 连接失败"

1. 确认容器健康: `docker compose -f docker-compose.local.yml ps` (应显示 healthy)
2. 确认 `.env` 的 `REDIS_URL` 端口与 compose 映射一致 (默认 6379)
3. Windows 防火墙放行 6379 入站 (本地开发通常默认放行)

### 6.3 ClickHouse 建库失败

- HTTP 8123 不通: 检查 `CLICKHOUSE_PORT` 应为 `8123` (非 9000)
- 权限不足: docker-compose 已开启 `CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1`, default 用户具备建库权限

### 6.4 数据卷清理

```powershell
# 彻底删除卷 (谨慎)
docker volume rm fintrust-redis-data fintrust-clickhouse-data fintrust-clickhouse-logs
```

---

## 7. 关联文档

- [P1_ROADMAP_TECH_IMPL.md](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/docs/P1_ROADMAP_TECH_IMPL.md) — DeepSeek/PDF/联盟链接入路线图
- [DEEPSEEK_INTEGRATION_TECH_SPEC.md](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/docs/DEEPSEEK_INTEGRATION_TECH_SPEC.md) — DeepSeek 详细集成方案 (含 Redis 缓存/限流复用)
- [redis_client.py](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/app/services/redis_client.py) — Redis 客户端实现 (含 rate_limit)
- [clickhouse_client.py](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/app/services/clickhouse_client.py) — ClickHouse 客户端实现
- [config.py](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/app/config.py) — 配置字段定义
