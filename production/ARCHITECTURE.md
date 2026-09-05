# FinTrust Hub 生产系统架构文档

> **设计依据**: `../.trae/specs/build-fintech-trust-hub/spec.md` v3.1
>
> **核心哲学**: "AI 作为操作者" + "改造引擎 (MOD-16)" + "市场化破局 6 战略 + 3 脑洞" + "傻瓜式操作" + "API 接入优先 + 自研护城河 + 独立兜底备选"

## 1. 分层架构

```
┌────────────────────────────────────────────────────────────────┐
│  前端层 (frontend/)  Vue 3 + TS + Element Plus + ECharts        │
│  ─────────────────────────────────────────────────────────────  │
│  · views/reform|enterprise|flow|approval|bank|institution|...  │
│  · views/scf (Tab11 供应链金融)                                  │
│  · views/eco (Tab12-20 ECO 9 模块)                              │
│  · stores/ Pinia 状态管理                                        │
│  · api/ Axios API client (对齐 contracts/)                      │
└──────────────────────────┬─────────────────────────────────────┘
                           │ REST API + WebSocket
┌──────────────────────────┴─────────────────────────────────────┐
│  后端层 (backend/)                                              │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Python (FastAPI) — AI/数据处理/HTTP API                  │  │
│  │  · app/api/* REST 路由                                    │  │
│  │  · app/services/* 业务逻辑                                │  │
│  │  · app/chain/ 蚂蚁链 SDK 适配                             │  │
│  │  · app/crypto/ HE-SEAL/FF1/Shamir                         │  │
│  │  · app/ocr/ PaddleOCR                                     │  │
│  │  · app/iot/ EMQX MQTT                                     │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Java (Spring Cloud) — 金融交易一致性（可选/后期）        │  │
│  └──────────────────────────────────────────────────────────┘  │
└──────────────────────────┬─────────────────────────────────────┘
                           │ SQLAlchemy + Redis client + Kafka
┌──────────────────────────┴─────────────────────────────────────┐
│  数据层 (db/)                                                   │
│  · PostgreSQL — 关系数据（企业/凭证/合同/审批）                 │
│  · Redis — 缓存 + 会话 + raw_* 临时键                            │
│  · ClickHouse — IoT 时序 + 指标分析                              │
│  · Neo4j — 关系图谱 + 案例知识图谱                                │
└──────────────────────────┬─────────────────────────────────────┘
                           │
┌──────────────────────────┴─────────────────────────────────────┐
│  基础设施层 (infra/)                                            │
│  · Docker Compose 本地开发                                       │
│  · Kubernetes 生产部署                                           │
│  · Kafka 业务事件流                                              │
│  · EMQX MQTT Broker                                              │
│  · GitLab CI / Jenkins                                           │
└────────────────────────────────────────────────────────────────┘
```

## 2. 9 个 ECO 模块在分层架构中的归属

| ECO 模块 | 前端 Vue 组件 | 后端 FastAPI 路由 | 数据库 | 真实接入 |
|---|---|---|---|---|
| ECO-01 阅后即烕 | `views/eco/EcoBurnView.vue` | `api/v1/eco_burn.py` | PostgreSQL `eco_burn_reports` + Redis `eco_burn_raw_*` | **SGX/TrustZone enclave** (替代 simulation 的 crypto.subtle) |
| ECO-02 成果定价 | `views/eco/EcoPricingView.vue` | `api/v1/eco_pricing.py` | PostgreSQL `eco_pay_contracts` + `eco_pay_settlements` | 银行分账协议（自动从放款资金扣分成） |
| ECO-03 无接口适配器 | `views/eco/EcoRpaView.vue` | `api/v1/eco_adapter.py` | PostgreSQL `eco_rpa_templates` + `eco_rpa_docs` | **Apache POI + iText/PDFBox** (替代 Blob) + e签宝/法大大电子签章 |
| ECO-04 联盟链凭证 | `views/eco/EcoCredentialView.vue` | `api/v1/eco_credential.py` | PostgreSQL `eco_cred_credentials` + `eco_cred_revocations` | **蚂蚁链/至信链 SDK** (替代 SHA-256 模拟) |
| ECO-05 反向竞拍 | `views/eco/EcoBidView.vue` | `api/v1/eco_bid.py` | PostgreSQL `eco_bid_tenders` + `eco_bid_bids` | 银行竞价接口 + 蚂蚁链上链 |
| ECO-06 积分商城 | `views/eco/EcoPtsView.vue` | `api/v1/eco_pts.py` | PostgreSQL `eco_pts_accounts` + `eco_pts_orders` | 微信企业微信扫码 + GPS 围栏 |
| ECO-07 FinTrust 指数 | `views/eco/EcoIndexView.vue` | `api/v1/eco_index.py` | ClickHouse `eco_idx_history` + PostgreSQL `eco_idx_reports` | 财经媒体发布渠道 + API 订阅 |
| ECO-08 政府背书 | `views/eco/EcoGovView.vue` | `api/v1/eco_gov.py` | PostgreSQL `eco_gov_regulators` + `eco_gov_reports` | 金融监管局/工信局数据通道 |
| ECO-09 数字分身 | `views/eco/EcoBotView.vue` | `api/v1/eco_bot.py` | PostgreSQL `eco_bot_conversations` + Redis 会话缓存 | **企业微信 + 钉钉机器人 API** (替代模拟聊天 UI) + Web Speech API |

## 3. 接口边界（前后端契约）

所有前后端共享的 TypeScript 类型定义在 `contracts/`：

- `contracts/common.ts` — 基础类型（Enterprise / Credit / Loan / Reform / FiveStreams 等）
- `contracts/reform-engine.ts` — MOD-16 改造引擎契约（对齐 spec.md L3527+ 的 `reform-engine-contracts.ts`）
- `contracts/eco.ts` — 9 个 ECO 模块契约（BURN/PAY/RPA/CRED/BID/PTS/IDX/GOV/BOT）

前端 `frontend/src/api/` 用 Axios 调用后端，请求/响应类型从 `contracts/` 导入。
后端 `backend/app/schemas/` 用 Pydantic 定义，与 `contracts/` 字段对齐。

## 4. 真实接入 vs mock 适配层（A/B/C 档策略）

按用户工程哲学"API 接入优先 + 自研护城河 + 独立兜底备选"，每个外部依赖分三档：

| 外部能力 | A 档（API 接入优先） | B 档（自研护城河） | C 档（独立兜底） |
|---|---|---|---|
| 区块链存证 | 蚂蚁链/至信链 SDK | 自研 SHA-256 + 时间戳链 | localStorage 离线缓存 |
| 电子签章 | e签宝/法大大 API | 自研 PKI + RSA | PDF 嵌入 hash 字段 |
| 银行直连 | INFRA-01b 银企直连 API | INFRA-05 RPA 申报书 | 人工录入 |
| OCR | 云 OCR (百度/阿里) | PaddleOCR 自部署 | 人工录入 |
| 微信/钉钉 | 企业微信/钉钉开放 API | 自研 NLP 路由 | Web Speech API 浏览器端 |
| SGX 可信计算 | Intel SGX SDK | ARM TrustZone | crypto.subtle + 闭包隔离 |
| IoT | EMQX MQTT | 边缘网关自部署 | 人工触发 |

## 5. 代码迁移策略（simulation → reference/js → Vue3 已完成）

`reference/js/` 下的 11 个纯 JS 文件（6 核心 + 5 视图）作为**业务逻辑参考**，不直接复制到 `frontend/`：

1. **业务流程参考**: 阅读 `reference/js/eco-burn.js` 的 `runDiagnosis()` 流程，在 Vue 3 + TS 重写时保留同样的状态机（idle→loaded→diagnosing→completed→destroyed）
2. **数据结构参考**: `reference/js/eco-rpa.js` 的 `BANK_TEMPLATES` 字段映射逻辑直接对齐到 `db/postgres/eco_rpa_templates.sql` schema
3. **不复制代码**: 纯 JS 风格与 Vue 3 + TS 不兼容（无类型/无响应式/无组件化），重写时只参考逻辑

## 6. 部署拓扑

```
┌─ K8s Cluster ────────────────────────────────────────────┐
│  ┌─ Frontend Pod (Vue 3 静态资源 + Nginx) ───────────┐  │
│  └──────────────────────────────────────────────────┘  │
│  ┌─ Backend Pod (FastAPI + Uvicorn) ─────────────────┐  │
│  │  └─ 连接 PostgreSQL / Redis / ClickHouse / Neo4j │  │
│  └──────────────────────────────────────────────────┘  │
│  ┌─ Java Pod (Spring Cloud, 可选) ───────────────────┐  │
│  └──────────────────────────────────────────────────┘  │
│  ┌─ Worker Pod (Temporal/Airflow + Kafka consumer) ──┐  │
│  └──────────────────────────────────────────────────┘  │
│  ┌─ StatefulSet: PostgreSQL / Redis / ClickHouse ───┐  │
│  └──────────────────────────────────────────────────┘  │
│  ┌─ StatefulSet: Neo4j ──────────────────────────────┐  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

## 7. 开发阶段路线图

| 阶段 | 范围 | 优先级 |
|---|---|---|
| P1 | 工程骨架 + 文档（本目录） | ✅ 完成 |
| P2 | simulation/ 11 个 ECO 文件迁移到 reference/js/ | ✅ 完成 |
| P3 | contracts/ TypeScript 接口契约 | ✅ 完成 |
| P4 | frontend/ Vue 3 + TS + Element Plus 项目骨架 | ✅ 完成 |
| P5 | 9 个 ECO 模块 Vue 3 组件实现 | ✅ 完成 |
| P6 | backend/ FastAPI + 9 个 ECO API | ✅ 完成 |
| P7 | db/ PostgreSQL + Redis + ClickHouse + Neo4j schema | ✅ 完成 |
| P8 | infra/ Docker Compose + K8s + CI/CD | ✅ 完成 |
| P9 | 全链路集成测试 + checklist 验收 | ✅ 完成 |
| P10 | 交付报告 + 后续路线图 | 待启动 |
