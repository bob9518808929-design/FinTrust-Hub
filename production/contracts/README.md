# contracts/ — FinTrust Hub 生产系统契约层

> **定位**: 此目录是 TypeScript 接口契约层，作为前后端数据交换的**单一真相源 (Single Source of Truth)**。
> 所有实现层 (frontend Vue 3 + TS / backend FastAPI Pydantic / db schema) 必须严格对齐此契约的字段名与语义，不可偏离。

## 设计依据

- `../../.trae/specs/build-fintech-trust-hub/spec.md` v3.1
  - L3495-3525 技术栈总览
  - L3527-3620 改造引擎核心 TypeScript 接口契约 (reform-engine-contracts.ts 原始定义)
  - L3897-3924 关键术语表 (注释中术语对齐)
  - L3624-3707 实施分期建议 (P0/P1/P2 优先级)
- `../../.trae/specs/build-fintech-trust-hub/tasks.md` Phase ECO 任务清单
- `../../.trae/specs/build-fintech-trust-hub/checklist.md` 验收项
- `../reference/js/eco-*.js` 11 个 ECO 模块业务逻辑参考实现

## 文件清单

| 文件 | 行数 | 职责 | 对齐 spec |
|---|---|---|---|
| `common.ts` | ~330 | 基础类型 (Enterprise/Bank/Guarantor/Insurer/Policy/Seasonal/DataFlow/ExternalApi/Fallback) | mock-data.js L1-260 |
| `scorecard.ts` | ~270 | 8 维评分卡 + ReformState/Phase/Action/Context/Result | spec L3527-3620 |
| `reform-engine.ts` | ~270 | R0-R10 改造引擎接口 + R5-A~H 子引擎 + 异常类 | spec L3514-3525, L3598-3619 |
| `eco.ts` | ~600 | 9 个 ECO 模块契约 (ECO-01~09) | spec v3.1 9 大脑洞 |
| `index.ts` | ~60 | 总导出 + 顶层类型别名 | — |

## 9 个 ECO 模块契约总览

| 模块 | 接口名 | 核心 | 阶段 |
|---|---|---|---|
| ECO-01 阅后即焚零信任诊断 | `EcoBurnEngine` | loadRawData / startDiagnosis / secureDestroy / getAuditTrail | P0 |
| ECO-02 成果导向阶梯定价 | `EcoPricingEngine` | calculate / autoPay / refund | P0 |
| ECO-03 无接口适配器 | `EcoRpaEngine` | generate (PDF) / submit / upgradeTier | P1 |
| ECO-04 信用凭证联盟链 | `EcoCredentialEngine` | issue / verify / revoke / portOut | P1 |
| ECO-05 反向竞拍融资大厅 | `EcoBidEngine` | publish / submitBid / award / detectCollusion / checkMultiHead | P2 |
| ECO-06 积分商城与行为挖矿 | `EcoPtsEngine` | awardPoints / placeOrder / getCooperationRate | P1 |
| ECO-07 FinTrust 企业合规指数 | `EcoIndexEngine` | calculate / compareEnterprise / publish | P2 |
| ECO-08 监管/政府背书催化剂 | `EcoGovEngine` | generateReport / submitReport / applyForEndorsement | P1 |
| ECO-09 微信/钉钉数字分身 | `EcoBotEngine` | parseCommand / executeCommand / broadcastNotification | P2 |

## 关键设计原则

### 1. 严格 readonly 防突变
所有接口字段默认 `readonly`，运行时可变字段显式标注 (如 `status` / `progress`)。

### 2. 字面量联合类型
避免魔法字符串：`ReformStatus = 'idle' | 'in_progress' | 'paused' | 'abandoned' | 'completed'`。

### 3. ISO 8601 时间统一
所有时间字段使用 `IsoTimestamp = string`，前端 Date 转换由调用方负责。

### 4. 金额最小货币单位
`AmountInCents = number`，1 元 = 100 分，避免浮点误差。

### 5. 跨模块事件总线
`EcoEvent` (common.ts) 定义跨 ECO 模块通信事件，前后端共享 WebSocket / Kafka topic。

### 6. 异常类型化
`ReformEngineError` / `BudgetExceededError` / `ComplianceBlockError` / `PrecheckIneligibleError` 显式区分错误码，便于前端国际化与异常恢复。

## 后端 Pydantic 镜像规则 (P6 生成)

| TS 类型 | Pydantic 类型 |
|---|---|
| `string` | `str` |
| `number` (整数) | `int` |
| `number` (浮点) | `float` |
| `boolean` | `bool` |
| `readonly T[]` | `tuple[T, ...]` 或 `List[T]` + `frozen=True` |
| `Record<K, V>` | `Dict[K, V]` |
| 联合字面量 `'a' \| 'b'` | `Literal['a', 'b']` |
| `interface X` | `class X(BaseModel)` |

字段命名: TS 用 camelCase，Pydantic 用 snake_case，通过 `alias_generator` 自动转换。

## 数据库 schema 镜像规则 (P7 生成)

| TS interface | PostgreSQL 表 |
|---|---|
| `Enterprise` | `enterprises` |
| `Bank` / `Guarantor` / `Insurer` | `banks` / `guarantors` / `insurers` |
| `ReformState` | `reform_states` (含 `phases` JSONB 子表) |
| `ReformCase` | `reform_cases` |
| `Tender` / `BankBid` | `tenders` / `bank_bids` |
| `VerifiableCredential` | `credentials` |
| `GovReport` / `GovEndorsement` | `gov_reports` / `gov_endorsements` |
| `WorkerAccount` / `ExchangeOrder` | `worker_accounts` / `exchange_orders` |
| `CreditApplicationRecord` | `credit_applications` |
| `SettlementRecord` | `settlement_records` |
| `ComplianceIndexSnapshot` | `compliance_indices` |

列名: snake_case (如 `enterprise_id` / `created_at`)。

## 跨语言一致性校验 (TODO P9)

P9 集成测试阶段补充：
1. TS 类型校验: `tsc --noEmit` 通过
2. Pydantic schema 校验: 调用 `/docs/openapi.json` 提取字段对齐
3. 数据库 schema 校验: 比较 `information_schema.columns` 与契约字段
4. 端到端契约测试: 前端发请求 → 后端响应 → 字段一致性断言

## 修改此目录的纪律

- **不要直接修改已发布接口**。如需扩展，新增可选字段并保留旧字段。
- **不要在前端 / 后端代码中绕过契约** (例如临时新增字段不入契约)。
- **修改契约必须同步修改 spec.md 对应章节** (保持单一真相源)。
- **每次修改后必须跑 `tsc --noEmit` 校验**，避免引入类型错误。
