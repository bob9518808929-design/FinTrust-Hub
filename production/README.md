# FinTrust Hub 生产系统 (production/)

> **定位**: 本目录是 FinTrust Hub v3.1 的**真实生产系统**，按 `../.trae/specs/build-fintech-trust-hub/spec.md` L3495-3525 定义的技术栈构建。
>
> **与 simulation/ 的关系**: `../simulation/` 是浏览器端纯 JS 演示原型（概念验证/PPT 演示用），不承担生产职责。本目录才是面向真实部署的生产代码。

## 技术栈（对齐 spec.md L3495-3525）

| 层级 | 技术选型 | 目录 |
|---|---|---|
| 前端 | Vue 3 + TypeScript + Element Plus + ECharts + Vite | `frontend/` |
| 后端 | Python (FastAPI) + Java (Spring Cloud) | `backend/python/` `backend/java/` |
| 数据库 | PostgreSQL + Redis + ClickHouse + Neo4j | `db/` |
| 消息队列 | Kafka + EMQX (MQTT) | `infra/` |
| 容器 | Kubernetes + Docker | `infra/` |
| 区块链 | 蚂蚁链 / 至信链（司法联盟链） | `backend/python/app/chain/` |
| OCR | PaddleOCR / 云 OCR | `backend/python/app/ocr/` |
| IoT | EMQX MQTT Broker + 边缘网关 | `infra/` |
| 加密 | HE-SEAL (同态) + FF1 (格式保留) + Shamir (密钥分片) | `backend/python/app/crypto/` |
| CI/CD | GitLab CI / Jenkins | `infra/ci/` |

## 目录结构

```
production/
├── README.md                    # 本文件
├── ARCHITECTURE.md              # 分层架构 + 模块清单 + 接口边界
├── contracts/                   # TypeScript 接口契约（前后端共享）
│   ├── common.ts                # Enterprise/Credit/Loan 等基础类型
│   ├── reform-engine.ts         # MOD-16 改造引擎契约（对齐 spec L3527+）
│   └── eco-modules.ts           # ECO-01~09 9 个市场化破局模块契约
├── frontend/                    # Vue 3 + TS + Element Plus 前端
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── src/
│       ├── main.ts
│       ├── App.vue
│       ├── router/              # Vue Router
│       ├── stores/              # Pinia stores
│       ├── api/                 # Axios API client
│       ├── views/               # 页面级组件
│       │   ├── reform/          # Tab0 改造工作台
│       │   ├── enterprise/      # Tab1 企业端
│       │   ├── flow/            # Tab2 融资流程
│       │   ├── approval/        # Tab3 审批台
│       │   ├── bank/            # Tab4 银行端
│       │   ├── institution/     # Tab5 担保保险
│       │   ├── advisor/         # Tab6 顾问运营
│       │   ├── cockpit/         # Tab7 AI 驾驶舱
│       │   ├── fallback/        # Tab8 兜底引擎
│       │   ├── regulatory/      # Tab9 监管沙盒
│       │   ├── partner/         # Tab10 关联机构
│       │   ├── scf/             # Tab11 供应链金融
│       │   └── eco/             # Tab12-20 ECO 9 模块（v3.1 新增）
│       │       ├── BurnView.vue         # Tab12 阅后即焚
│       │       ├── RpaView.vue          # Tab13 无接口适配器
│       │       ├── PtsView.vue          # Tab14 积分商城
│       │       ├── BotView.vue          # Tab15 数字分身
│       │       ├── PayView.vue         # Tab16 成果定价
│       │       ├── CredView.vue        # Tab17 联盟链凭证
│       │       ├── BidView.vue         # Tab18 反向竞拍
│       │       ├── IdxView.vue         # Tab19 合规指数
│       │       └── GovView.vue         # Tab20 政府背书
│       └── components/          # 通用组件
├── backend/
│   ├── python/                  # FastAPI 主后端
│   │   ├── pyproject.toml
│   │   ├── app/
│   │   │   ├── main.py          # FastAPI 入口
│   │   │   ├── api/              # REST API 路由
│   │   │   │   ├── reform.py
│   │   │   │   ├── enterprise.py
│   │   │   │   ├── flow.py
│   │   │   │   ├── approval.py
│   │   │   │   ├── bank.py
│   │   │   │   ├── scf.py
│   │   │   │   └── eco/         # 9 个 ECO 模块 API
│   │   │   ├── models/          # SQLAlchemy ORM
│   │   │   ├── schemas/         # Pydantic 模型（对齐 contracts/）
│   │   │   ├── services/        # 业务逻辑层
│   │   │   ├── chain/           # 蚂蚁链/至信链 SDK 适配
│   │   │   ├── crypto/          # HE-SEAL/FF1/Shamir 加密
│   │   │   ├── ocr/             # PaddleOCR 适配
│   │   │   └── iot/             # EMQX MQTT 适配
│   │   └── tests/
│   └── java/                    # Spring Cloud（金融交易一致性，可选）
├── db/
│   ├── postgres/                # PostgreSQL schema
│   ├── redis/                   # Redis 键设计
│   ├── clickhouse/              # ClickHouse 指标表
│   └── neo4j/                   # Neo4j 图谱
├── infra/
│   ├── docker-compose.yml       # 本地开发环境
│   ├── k8s/                     # K8s manifests
│   └── ci/                      # GitLab CI / Jenkins
├── docs/                        # 架构文档 + API 文档 + 部署手册
└── reference/                   # 来自 simulation/ 的纯 JS 参考实现
    ├── README.md                # 说明参考定位
    └── js/                      # 11 个 ECO 模块纯 JS 实现（供 Vue 重写参考）
```

## 开发流程

1. **接口契约先行**: 所有模块先在 `contracts/` 定义 TypeScript 接口，前后端共享
2. **前端 Vue 3 骨架**: `frontend/` 用 Vite 初始化，按 Tab 结构组织 views
3. **后端 FastAPI 骨架**: `backend/python/` 用 FastAPI 初始化，路由对齐前端
4. **数据库 schema**: `db/` 定义 schema，用 Alembic 管理 migration
5. **真实接入适配层**: 区块链/SGX/微信机器人等真实 API 在 `backend/python/app/{chain,crypto,ocr,iot}/` 适配，保留 mock 降级
6. **基础设施**: `infra/` Docker Compose 本地开发，K8s 生产部署

## 与 simulation/ 的边界

| 维度 | simulation/ | production/ |
|---|---|---|
| 定位 | 业务演示原型 | 真实生产系统 |
| 技术栈 | 纯 JS + localStorage + setTimeout | Vue 3 + TS + FastAPI + PostgreSQL |
| 数据持久化 | localStorage | PostgreSQL + Redis |
| 异步 | setTimeout | Kafka + Temporal/Airflow |
| 加密 | crypto.subtle | HE-SEAL + FF1 + Shamir |
| 区块链 | SHA-256 模拟 | 蚂蚁链/至信链 SDK |
| 微信/钉钉 | 模拟聊天 UI | 企业微信/钉钉真实 API |
| 部署 | 浏览器直开 | K8s + Docker |
| 用途 | PPT 演示/概念验证 | 真实生产环境 |

## 当前进度

- [x] P1 工程骨架 + 文档（README.md / ARCHITECTURE.md / reference/README.md）
- [x] P2 simulation/ 下 11 个 ECO 文件迁移到 reference/js/
- [x] P3 contracts/ TypeScript 接口契约（common / scorecard / reform-engine / eco / index）
- [x] P4 frontend/ Vue 3 + TS + Element Plus + Vite + Pinia + Vue Router 骨架
- [x] P5 9 个 ECO 模块 Vue 3 组件实现（Burn/Rpa/Pts/Bot/Pricing/Credential/Bid/Index/Gov）
- [x] P6 backend/ FastAPI + 9 个 ECO API + 改造/企业/银行 API + Pydantic schema + SQLAlchemy ORM + 内存双轨
- [x] P7 db/ 数据库 schema（PostgreSQL init/seed/indexes + Redis lua + ClickHouse metrics + Neo4j cypher + Alembic）
- [x] P8 infra/ Docker Compose + K8s manifests + GitHub Actions CI/CD + Nginx 反代
- [x] P9 全链路集成测试 + checklist 验收（自检脚本 / 健康检查 / ECO 联调）
- [x] P10 交付报告（见 docs/DELIVERY.md）
- [x] P11 21-Tab 前端补齐（approval/institution/advisor/cockpit/fallback/regulatory/partner/scf 8 个 Vue 视图 + 后端运营态 API 10 端点）
- [x] P12 后端测试套件（5 个测试文件 53 个用例，pytest 全绿）

> 交付详情请阅读 [docs/DELIVERY.md](./docs/DELIVERY.md)。
