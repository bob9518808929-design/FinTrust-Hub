# FinTrust Hub 基础设施

## 目录结构
```
infra/
├── docker-compose.yml           本地开发全栈一键启动
├── Dockerfile.backend            后端镜像 (Python 3.12 + FastAPI)
├── Dockerfile.frontend           前端镜像 (Node 20 + Vite + Nginx)
├── nginx/
│   └── fintrust.conf              Nginx 配置 (SPA + API 代理 + 缓存)
├── k8s/                          Kubernetes 生产部署
│   ├── namespace.yaml
│   ├── config.yaml                ConfigMap + Secrets 模板
│   ├── postgres.yaml              PostgreSQL StatefulSet
│   ├── backend.yaml               Backend Deployment + HPA
│   └── frontend.yaml              Frontend Deployment + Ingress
└── ci-cd/
    └── github-actions.yml        CI/CD 流水线 (lint→test→build→deploy)
```

## 快速开始

### 本地开发 (Docker Compose)
```bash
cd production
docker compose -f infra/docker-compose.yml up -d

# 访问:
#   前端: http://localhost
#   后端 API: http://localhost:8000/api/docs
#   PostgreSQL: localhost:5432
#   Redis: localhost:6379
#   ClickHouse: localhost:8123
#   Neo4j: http://localhost:7474
```

### 生产部署 (K8s)
```bash
# 1. 创建命名空间 + 配置
kubectl apply -f infra/k8s/namespace.yaml
kubectl apply -f infra/k8s/config.yaml  # 修改 Secrets!

# 2. 部署数据库
kubectl apply -f infra/k8s/postgres.yaml

# 3. 部署后端 (HPA 自动伸缩 3-10 副本)
kubectl apply -f infra/k8s/backend.yaml

# 4. 部署前端 + Ingress
kubectl apply -f infra/k8s/frontend.yaml
```

### CI/CD
- push to main → lint + test + build
- tag v* → 以上 + deploy to K8s

## 设计约束 (project_memory)
- 后端镜像 4 worker (uvicorn --workers 4)
- 前端 Nginx 静态服务, 版本参数防缓存 (?v=)
- K8s HPA: CPU > 70% 自动扩容 (min 3, max 10)
- 数据库 StatefulSet + PVC 持久卷
- Secrets 必须在生产修改 (CHANGE_ME_IN_PRODUCTION)
