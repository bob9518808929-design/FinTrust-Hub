# FinTrust Hub v3.1 本地部署指南

> 适用版本: v3.1.0  
> 文档说明: 本指南所有命令均经过实际文件校验（`backend/.env.example`、`frontend/package.json`、`backend/requirements.txt`、`infra/docker-compose.yml`、`infra/k8s/*.yaml`、`backend/app/main.py`、`backend/app/database.py`、`frontend/vite.config.ts`）。  
> 最后更新: 2026-08-19

---

## 目录

- [1. 前置依赖](#1-前置依赖)
- [2. 场景 A: 纯本地开发（无 Docker，最快启动）](#2-场景-a-纯本地开发无-docker最快启动)
- [3. 场景 B: Docker Compose 一键启动（含全部中间件）](#3-场景-b-docker-compose-一键启动含全部中间件)
- [4. 场景 C: 混合模式（Docker 起中间件 + 本地起前后端）](#4-场景-c-混合模式docker-起中间件--本地起前后端)
- [5. 常见问题排查](#5-常见问题排查)
- [6. 测试命令](#6-测试命令)
- [7. 生产部署（K8s）](#7-生产部署k8s)
- [附录: 端口与连接信息速查表](#附录-端口与连接信息速查表)

---

## 1. 前置依赖

| 依赖 | 版本要求 | 说明 |
| --- | --- | --- |
| Python | **3.11+**（推荐 3.11 / 3.12） | 注意: 3.14 存在 pydantic v1 兼容警告，不推荐。`pyproject.toml` 声明 `requires-python = ">=3.11"`，`Dockerfile.backend` 使用 `python:3.12-slim` |
| Node.js | **18+** | `frontend/package.json` 的 `engines.node = ">=18.0.0"` |
| pnpm | **8+** | `frontend/package.json` 的 `engines.pnpm = ">=8.0.0"` |
| Docker Desktop | 4.x | 需启用 Docker Compose v2（`docker compose` 子命令） |
| Git | 任意近期版本 | 克隆仓库 |

### 1.1 安装依赖（首次环境准备）

```bash
# 1. 克隆仓库
git clone <repo-url> fintrust-hub
cd fintrust-hub/production

# 2. 检查 Python 版本（需 3.11+，推荐 3.12）
python --version

# 3. 检查 Node.js 与 pnpm
node --version        # >= v18
pnpm --version        # >= 8.0.0
# 若 pnpm 未安装:
npm install -g pnpm

# 4. 检查 Docker
docker --version
docker compose version
```

> 仓库根目录为 `production/`，本指南后续所有相对路径均以此为基准。

---

## 2. 场景 A: 纯本地开发（无 Docker，最快启动）

> 适用: 仅想快速跑起前后端做接口/页面联调，无需真实中间件。  
> 行为: 后端在 DB 不可用时**自动降级到内存 store**（见 `backend/app/database.py` 的 `get_db()` / `init_db()`，driver 缺失或连接失败时 `yield None`，服务层降级），不阻断启动；持久化失效，重启后数据丢失。

### 2.1 启动后端

```bash
# 1. 进入后端目录
cd production/backend

# 2. 创建并激活虚拟环境
# Windows (PowerShell):
python -m venv .venv
.\.venv\Scripts\Activate.ps1
# Windows (CMD):
python -m venv .venv
.\.venv\Scripts\activate.bat
# Linux / macOS:
python -m venv .venv
source .venv/bin/activate

# 3. 安装依赖（文件已校验: backend/requirements.txt 存在）
pip install -r requirements.txt

# 4. 复制环境变量模板并编辑
# Windows:
copy .env.example .env
# Linux / macOS:
cp .env.example .env
```

编辑 `production/backend/.env`，参考 `backend/.env.example` 的默认值：

```ini
# === 应用 ===
APP_NAME=FinTrust Hub Backend
APP_VERSION=3.1.0
APP_ENV=development
APP_DEBUG=true
APP_HOST=0.0.0.0
APP_PORT=8000

# === 数据库 (本地无 Docker 时保留默认值即可, 启动会降级到内存) ===
DATABASE_URL=postgresql+asyncpg://fintrust:fintrust@localhost:5432/fintrust_hub

# === Redis / ClickHouse / Neo4j / Kafka ===
REDIS_URL=redis://localhost:6379/0
CLICKHOUSE_HOST=localhost
CLICKHOUSE_PORT=8123
NEO4J_URI=bolt://localhost:7687
KAFKA_BOOTSTRAP_SERVERS=localhost:9092

# === LLM (可选, 不填则 LLM 功能禁用) ===
DEEPSEEK_API_KEY=<your-key-here>
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat

# === JWT (本地可用默认值) ===
JWT_SECRET=change-me-in-production
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=1440
```

> 注意: `CORS_ORIGINS` 默认值在 `backend/app/config.py` 中为 `http://localhost:5173,http://localhost:3000`，已包含 Vite 默认前端地址，本地开发无需额外配置。如需 `.env` 中显式覆盖，可新增一行 `CORS_ORIGINS=http://localhost:5173`。

```bash
# 5. 设置 PYTHONPATH (main.py 入口为 app.main:app, 必须能 import app 包)
# Windows (CMD):
set PYTHONPATH=.
# Windows (PowerShell):
$env:PYTHONPATH="."
# Linux / macOS:
export PYTHONPATH=.

# 6. 启动后端 (main.py 的 __main__ 调用 uvicorn.run, 监听 APP_HOST:APP_PORT)
python -m app.main
```

后端启动后输出示例:

```
启动 FinTrust Hub Backend v3.1.0 (development)
数据库初始化完成 (开发模式 create_all)   # 或: driver 缺失, 跳过建表
Uvicorn running on http://0.0.0.0:8000
```

### 2.2 验证后端

浏览器打开:

- Swagger UI: <http://localhost:8000/api/docs>
- ReDoc: <http://localhost:8000/api/redoc>
- 健康检查: <http://localhost:8000/health>
- OpenAPI JSON: <http://localhost:8000/api/openapi.json>

> 上述路径来自 `backend/app/main.py`: `docs_url="/api/docs"`、`redoc_url="/api/redoc"`、`@app.get("/health")`。

### 2.3 启动前端

```bash
# 1. 进入前端目录
cd production/frontend

# 2. 安装依赖 (package.json 已校验: engines 要求 node>=18, pnpm>=8)
pnpm install

# 3. 启动开发服务器 (vite.config.ts 已校验: server.port = 5173)
pnpm run dev
```

### 2.4 验证前端

浏览器打开 <http://localhost:5173>，应看到 FinTrust Hub 工作台。

> Vite 已配置代理（`frontend/vite.config.ts`）: `/api` → `http://localhost:8000`，`/ws` → `ws://localhost:8000/ws`，因此前端请求 `/api/*` 会自动转发到后端，无需额外配置跨域。

---

## 3. 场景 B: Docker Compose 一键启动（含全部中间件）

> 适用: 体验完整技术栈（PostgreSQL 16 + Redis 7 + ClickHouse 24 + Neo4j 5 + 后端 + 前端）。  
> 编排文件: `production/infra/docker-compose.yml`（已校验）。

### 3.1 启动

```bash
cd production/infra

# 一键启动全部服务 (后台运行)
docker compose up -d
```

`docker-compose.yml` 包含的服务:

| 服务 | 镜像 | 容器名 | 端口 | 依赖 |
| --- | --- | --- | --- | --- |
| postgres | postgres:16-alpine | fintrust-postgres | 5432 | - |
| redis | redis:7-alpine | fintrust-redis | 6379 | - |
| clickhouse | clickhouse/clickhouse-server:24-alpine | fintrust-clickhouse | 8123, 9000 | - |
| neo4j | neo4j:5-community | fintrust-neo4j | 7474, 7687 | - |
| backend | 构建 `infra/Dockerfile.backend` | fintrust-backend | 8000 | postgres(healthy), redis(healthy) |
| frontend | 构建 `infra/Dockerfile.frontend` | fintrust-frontend | 80, 443 | backend |

### 3.2 查看状态与健康检查

```bash
# 查看各服务状态 (含 healthcheck)
docker compose ps

# 跟踪启动日志
docker compose logs -f backend
```

> postgres / redis 配置了 `healthcheck`；backend 容器 `HEALTHCHECK` 探测 `http://localhost:8000/health`。等待 `docker compose ps` 显示为 `healthy` 即就绪。

### 3.3 访问入口

| 入口 | 地址 |
| --- | --- |
| 后端 Swagger UI | <http://localhost:8000/api/docs> |
| 后端健康检查 | <http://localhost:8000/health> |
| 前端工作台 | <http://localhost:80> |

### 3.4 数据库连接信息

| 中间件 | 连接地址 | 凭据 | 库 / 备注 |
| --- | --- | --- | --- |
| PostgreSQL | `localhost:5432` | 用户 `fintrust` / 密码 `fintrust` | 库 `fintrust_hub` |
| Redis | `localhost:6379` | 无密码 | DB 0 |
| ClickHouse (HTTP) | `localhost:8123` | 用户 `default` / 密码 `fintrust` | 库 `fintrust_metrics` |
| ClickHouse (TCP) | `localhost:9000` | 同上 | 原生协议 |
| Neo4j (浏览器) | `http://localhost:7474` | 用户 `neo4j` / 密码 `fintrust` | 首次登录需改密（社区版可跳过） |
| Neo4j (Bolt) | `bolt://localhost:7687` | 同上 | Cypher 连接 |

> 上述凭据来自 `infra/docker-compose.yml` 的 `environment` 段，仅适用于本地开发，生产环境必须替换。

### 3.5 停止与清理

```bash
cd production/infra

# 停止并移除容器 (保留数据卷)
docker compose down

# 停止并删除数据卷 (彻底清理, 不可恢复)
docker compose down -v
```

---

## 4. 场景 C: 混合模式（Docker 起中间件 + 本地起前后端）

> 适用: 开发调试——既想用真实中间件（PostgreSQL / Redis / ClickHouse / Neo4j），又想在本地 IDE 里调试前后端代码（断点 / 热重载）。

### 4.1 启动中间件

```bash
cd production/infra

# 只启动 4 个中间件 (不启 backend / frontend)
docker compose up -d postgres redis clickhouse neo4j

# 确认就绪
docker compose ps
```

> 此时中间件监听在 `localhost`（端口见 [附录](#附录-端口与连接信息速查表)），本地后端可直接连接。

### 4.2 启动后端（本地）

```bash
cd production/backend

# 激活虚拟环境
.\.venv\Scripts\Activate.ps1      # Windows PowerShell
# source .venv/bin/activate       # Linux / macOS

# 确认 .env 中 DATABASE_URL 指向 localhost (默认即如此)
# DATABASE_URL=postgresql+asyncpg://fintrust:fintrust@localhost:5432/fintrust_hub

# 设置 PYTHONPATH 并启动
$env:PYTHONPATH="."               # Windows PowerShell
# set PYTHONPATH=.                # Windows CMD
# export PYTHONPATH=.             # Linux / macOS
python -m app.main
```

### 4.3 启动前端（本地）

```bash
cd production/frontend
pnpm run dev
```

访问 <http://localhost:5173>，前端经 Vite 代理请求本地后端，本地后端连接 Docker 中的真实中间件。

---

## 5. 常见问题排查

| 现象 | 原因 / 排查 | 解决方案 |
| --- | --- | --- |
| 后端启动报 `ModuleNotFoundError: No module named 'app'` | `PYTHONPATH` 未设置或 venv 未激活 | 在 `production/backend` 目录下 `set PYTHONPATH=.`（Windows）/ `export PYTHONPATH=.`（Linux），并确认 `(.venv)` 前缀出现 |
| 前端 `pnpm: command not found` | 未安装 pnpm | `npm install -g pnpm` |
| 端口冲突（8000 / 5173 / 80） | 端口被占用 | 后端改 `backend/.env` 的 `APP_PORT`；前端改 `frontend/vite.config.ts` 的 `server.port`；Docker 前端改 `infra/docker-compose.yml` 的 `"80:80"` 映射 |
| DB 连接失败 | PostgreSQL 未启动或凭据不符 | 后端会**自动降级到内存 store**（见 `backend/app/database.py`），不阻断启动，但持久化失效。启动中间件: `docker compose up -d postgres` |
| CORS 错误（前端请求被拦截） | `CORS_ORIGINS` 未包含前端地址 | `backend/app/config.py` 默认 `CORS_ORIGINS=http://localhost:5173,http://localhost:3000`。若前端地址不同，在 `backend/.env` 新增 `CORS_ORIGINS=http://<your-frontend-origin>` 后重启后端 |
| Docker 容器启动失败 | 镜像构建失败 / 配置错误 | `docker compose logs <service>` 查看日志；`docker compose up -d --build` 强制重建镜像 |
| 后端 Docker 健康检查不通过 | `/health` 接口未就绪 | 等待 30s（`initialDelaySeconds`）；检查 `docker compose logs backend` |
| Neo4j 首次登录要求改密 | 社区版默认行为 | 浏览器 <http://localhost:7474> 登录后改密，或在 `docker-compose.yml` 设 `NEO4J_AUTH=none`（仅开发） |

---

## 6. 测试命令

### 6.1 后端测试

> 注意: `pytest` 不在 `requirements.txt` 中，而在 `pyproject.toml` 的 `[project.optional-dependencies].dev` 中。运行测试前需先安装开发依赖。

```bash
cd production/backend

# 激活虚拟环境
.\.venv\Scripts\Activate.ps1      # Windows PowerShell
# source .venv/bin/activate       # Linux / macOS

# 安装开发依赖 (含 pytest / pytest-asyncio / pytest-cov / ruff / mypy)
pip install -e ".[dev]"

# 设置 PYTHONPATH
$env:PYTHONPATH="."               # Windows PowerShell
# set PYTHONPATH=.                # Windows CMD
# export PYTHONPATH=.             # Linux / macOS

# 运行测试 (pyproject.toml 已配置 testpaths=tests, asyncio_mode=auto, 自动加 -v --cov)
python -m pytest tests/ -v
```

### 6.2 前端类型检查

```bash
cd production/frontend

# TypeScript 类型检查 (脚本已校验: package.json scripts.type-check = vue-tsc --noEmit)
pnpm run type-check
```

### 6.3 前端构建

```bash
cd production/frontend

# 生产构建 (先 vue-tsc --noEmit 类型检查, 再 vite build, 产物在 dist/)
pnpm run build

# 本地预览构建产物 (端口 4173, 已校验: scripts.preview = vite preview --port 4173)
pnpm run preview
```

---

## 7. 生产部署（K8s）

> 清单目录: `production/infra/k8s/`（已校验，包含 5 个文件）。  
> Namespace: `fintrust`。

### 7.1 K8s 清单文件

| 文件 | 资源 | 说明 |
| --- | --- | --- |
| `namespace.yaml` | Namespace `fintrust` | 命名空间 |
| `config.yaml` | ConfigMap `backend-config` + Secret `db-secrets` | 应用配置与数据库密钥模板 |
| `postgres.yaml` | StatefulSet + Service | PostgreSQL 16，PVC 20Gi |
| `backend.yaml` | Deployment(3 副本) + Service + HPA | FastAPI 后端，CPU>70% 自动扩缩 3~10 副本 |
| `frontend.yaml` | Deployment(2 副本) + Service + Ingress | 前端 Nginx，Ingress host `fintrust.example.com` |

### 7.2 部署前准备

1. **修改密钥**: 编辑 `infra/k8s/config.yaml` 中的 Secret，替换占位值:

   ```yaml
   stringData:
     postgres-password: CHANGE_ME_IN_PRODUCTION   # 改为强密码
     jwt-secret: CHANGE_ME_IN_PRODUCTION          # 改为随机长字符串
     deepseek-api-key: <your-key-here>
   ```

2. **构建并推送镜像**: K8s 清单引用 `fintrust/backend:3.1.0` 与 `fintrust/frontend:3.1.0`，需先构建并推送到集群可访问的镜像仓库:

   ```bash
   cd production/infra
   docker build -t fintrust/backend:3.1.0  -f Dockerfile.backend  ..
   docker build -t fintrust/frontend:3.1.0 -f Dockerfile.frontend ..
   # 推送到你的镜像仓库 (示例):
   docker tag fintrust/backend:3.1.0  <registry>/fintrust/backend:3.1.0
   docker push <registry>/fintrust/backend:3.1.0
   ```

3. **(可选) 中间件补充**: 当前 K8s 清单仅含 PostgreSQL。生产环境 Redis / ClickHouse / Neo4j 建议使用云厂商托管服务，或自行补充对应清单后挂载到 `backend-config`。

### 7.3 按顺序部署

```bash
cd production/infra/k8s

# 1. 创建命名空间
kubectl apply -f namespace.yaml

# 2. 应用配置与密钥
kubectl apply -f config.yaml

# 3. 部署 PostgreSQL
kubectl apply -f postgres.yaml

# 4. 部署后端 (依赖 postgres 就绪, readinessProbe 探测 /health)
kubectl apply -f backend.yaml

# 5. 部署前端 (依赖 backend)
kubectl apply -f frontend.yaml
```

### 7.4 验证部署

```bash
# 查看所有资源
kubectl get all -n fintrust

# 查看 HPA 状态
kubectl get hpa -n fintrust

# 查看 Ingress
kubectl get ingress -n fintrust

# 查看 pod 日志
kubectl logs -n fintrust -l app=backend --tail=100 -f
```

### 7.5 访问

将 `fintrust.example.com` 解析到 Ingress Controller 的入口 IP（或修改 `frontend.yaml` 中 Ingress 的 `host`），浏览器访问 <https://fintrust.example.com>。

> 生产环境必须修改 `config.yaml` 中 Secret 的 `jwt-secret`、`postgres-password` 等占位值，并配置 TLS 证书（Ingress TLS）。

---

## 附录: 端口与连接信息速查表

| 服务 | 本地端口 | 容器端口 | 连接串 / 地址 |
| --- | --- | --- | --- |
| 后端 (FastAPI) | 8000 | 8000 | <http://localhost:8000> |
| 前端 (Vite Dev) | 5173 | - | <http://localhost:5173> |
| 前端 (Docker/Nginx) | 80, 443 | 80, 443 | <http://localhost:80> |
| PostgreSQL | 5432 | 5432 | `postgresql+asyncpg://fintrust:fintrust@localhost:5432/fintrust_hub` |
| Redis | 6379 | 6379 | `redis://localhost:6379/0` |
| ClickHouse (HTTP) | 8123 | 8123 | `http://localhost:8123` |
| ClickHouse (TCP) | 9000 | 9000 | `clickhouse://default:fintrust@localhost:9000/fintrust_metrics` |
| Neo4j (浏览器) | 7474 | 7474 | <http://localhost:7474> |
| Neo4j (Bolt) | 7687 | 7687 | `bolt://neo4j:fintrust@localhost:7687` |
| Kafka | 9092 | 9092 | `localhost:9092` |
| Temporal | 7233 | 7233 | `localhost:7233` |
