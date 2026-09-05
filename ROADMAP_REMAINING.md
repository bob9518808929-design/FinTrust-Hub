# FinTrust Hub 剩余开发路线图

> **生成时间**: 2026-08-20
> **数据来源**: tools/spec_trace.py + tools/spec_code_drift.py (自动扫描)
> **范围**: spec.md 中 18 项 "未开始" Requirement (已剔除本轮修复的 INFRA-05)
> **目的**: 为下一阶段开发提供优先级排序与依赖关系

---

## 路线图概览

| 优先级 | 数量 | 预计工作量 | 核心目标 |
|---|---|---|---|
| **P0** (阻塞核心价值) | 5 项 | 30 天 | 数据接入 + AI 自主操作底座 |
| **P1** (业务闭环) | 11 项 | 40 天 | 业务模块 + 独立门户 + IoT |
| **P2** (战略储备) | 2 项 | 8 天 | 信用凭证 + 沙箱 |
| **总计** | 18 项 | ~78 天 | 完整 FinTrust Hub |

---

## Phase R1: P0 核心数据与 AI 底座 (30 天)

> **目标**: 打通数据接入主链路 + AI 自主操作能力, 使系统从"骨架"具备"造血"能力.

### R1.1 DATA-01 银企直连接口 (P0, 6 天)
- **Spec**: L822 `DATA-01 银企直连接口`
- **现状**: 部分实现 (enterprise_service.py stub 已存在, 前端 BankWorkbenchView 已实现)
- **缺失**: OAuth2.0 模块, bank_aggregator_service, 6 家银行 API 接入
- **交付物**:
  - `backend/app/services/bank_aggregator_service.py` (OAuth2 + 6 家银行适配)
  - `backend/app/api/v1/data/bank.py` (账户/交易 API)
  - 银行沙箱测试环境接入
- **依赖**: 外部 (工/建/农/中/交/招商 API 凭证)
- **验收**: 模拟银行授权流程成功 + 拉取模拟交易流水

### R1.2 DATA-02 第三方数据源接入 (P0, 5 天)
- **Spec**: L853
- **现状**: 未开始
- **交付物**:
  - `backend/app/services/invoice_verifier.py` (国税总局 API)
  - `backend/app/services/gsxt_adapter.py` (工商信息)
  - `backend/app/services/judiciary_adapter.py` (司法查询)
  - `backend/app/services/ecds_adapter.py` (票交所)
  - 数据源适配器框架 (热插拔)
- **依赖**: 外部 (国家税务总局/票交所/法院 API 凭证)
- **验收**: 每个适配器可独立调用 + 不可用时优雅降级

### R1.3 DATA-03 OCR 与文档解析 (P0, 4 天)
- **Spec**: L889
- **现状**: 未开始
- **交付物**:
  - `backend/app/services/ocr_service.py` (PDF/图片 OCR)
  - `backend/app/services/bank_statement_parser.py` (银行流水解析)
  - `backend/app/services/contract_parser.py` (合同解析)
  - `backend/app/services/invoice_parser.py` (发票解析)
- **依赖**: 外部 (PaddleOCR / 百度 OCR / 阿里 OCR API)
- **验收**: 银行流水解析率 ≥ 80%

### R1.4 CORE-01 AI 自主操作编排引擎 (P0, 8 天)
- **Spec**: L1947
- **现状**: 未开始
- **交付物**:
  - `backend/app/services/ai_orchestrator_service.py` (Temporal/Airflow DAG)
  - L1-L4 自主度级别实现
  - 决策日志存储 (Elasticsearch)
- **依赖**: 外部 (Temporal/Airflow, Elasticsearch)
- **验收**: L1 完全自主操作正确执行 + L4 仅建议不执行

### R1.5 CORE-02 人机协同网关 (P0, 7 天)
- **Spec**: L1994
- **现状**: 未开始
- **交付物**:
  - `backend/app/services/human_ai_gateway.py` (人机协同)
  - 人工审批工作流 (串行/并行/超时升级/代理审批)
  - 决策回溯 API
- **依赖**: R1.4 CORE-01
- **验收**: L3/L4 路由到人工审批工作台 + 24h 越权覆盖

---

## Phase R2: P1 业务模块闭环 (40 天)

> **目标**: 围绕 P0 底座, 完成核心业务模块, 实现企业流动性闭环.

### R2.1 MOD-06 AI 履约评分引擎 (P1, 5 天)
- **Spec**: L1192
- **交付物**: `backend/app/services/performance_score_service.py`
- **依赖**: R1.4 CORE-01 (AI 编排)
- **验收**: PD 违约概率计算 + IoY 履约能力评分

### R2.2 MOD-07 数据安全与隐私计算 (P1, 6 天)
- **Spec**: L1241
- **交付物**:
  - `backend/app/services/privacy_compute_service.py` (HE-SEAL 同态加密)
  - `backend/app/services/data_purge_service.py` (v3.1 MOD-07 Purge)
  - FF1 格式保留加密 + Shamir 密钥分片
- **依赖**: 外部 (HE-SEAL 库)
- **验收**: 数据脱敏 + 加密 + 存证 + 取证全链路

### R2.3 MOD-09 合作模式管理 (P1, 3 天)
- **Spec**: L1459
- **交付物**: `backend/app/services/cooperation_mode_service.py`
- **验收**: 4 种合作模式切换 + 权限矩阵动态调整

### R2.4 MOD-10 政策与行业因素 (P1, 4 天)
- **Spec**: L1561
- **交付物**: `backend/app/services/policy_factor_service.py`
- **验收**: 房地产限制/高新技术鼓励 + 银行季节性提醒

### R2.5 MOD-11 再融资再贴现闭环 (P1, 4 天)
- **Spec**: L1656
- **交付物**: `backend/app/services/refinance_service.py`
- **验收**: 现金流缺口预测 → 再融资入口 → AI 推荐 → 一键融资

### R2.6 MOD-14 人流责任链 (P1, 4 天)
- **Spec**: L2183
- **交付物**: `backend/app/services/responsibility_chain_service.py`
- **验收**: 第零流 (人流) + 积分商城行为挖矿联动

### R2.7 DATA-04 物联网数据采集网关 (P1, 5 天)
- **Spec**: L2026
- **交付物**:
  - `backend/app/services/iot_gateway.py` (MQTT 5.0)
  - 边缘计算网关
- **依赖**: 外部 (EMQX MQTT Broker)
- **验收**: 设备接入 + GPS/温湿度/能耗数据采集

### R2.8 APP-05 担保公司端门户 (P1, 3 天)
- **Spec**: L2462
- **交付物**: `frontend/src/views/partner/GuaranteePortalView.vue`
- **验收**: 担保申请受理 + 保前审查 + 反担保 + 代偿 + 保后监管

### R2.9 APP-06 保险公司端门户 (P1, 3 天)
- **Spec**: L2493
- **交付物**: `frontend/src/views/partner/InsurancePortalView.vue`
- **验收**: 投保受理 + 核保审查 + 保单管理 + 理赔处理

### R2.10 CORE-03 企业可选配置引擎 (P1, 3 天)
- **Spec**: L2580
- **交付物**: `backend/app/services/opt_in_config_engine.py`
- **验收**: 6 条数据流可选 + 模块独立启停 + 合作方式独立配置

### R2.11 INFRA-01b 外部 API 适配层 (P1, 5 天)
- **Spec**: L4544 (Phase A: A1-A15 共 15 个适配器)
- **交付物**: `backend/app/services/api_adapter_registry.py` + 限流容错引擎
- **验收**: 限流触发 429 + 超时 3 次重试 + 降级到 fallbackModule

---

## Phase R3: P2 战略储备 (8 天)

### R3.1 MOD-08b 信用凭证联盟链 (P2, 4 天)
- **Spec**: L1378
- **现状**: 部分实现 (EcoCredentialView.vue 已存在)
- **缺失**: VerifiableCredential 数据模型 + 联盟链跨行互通
- **交付物**: `backend/app/services/credential_service.py` (W3C VC + 联盟链)
- **验收**: 企业持私钥自主授权 + 跨行便携确权

### R3.2 INFRA-04 改造沙箱仿真 (P2, 4 天)
- **Spec**: L639
- **现状**: 未开始
- **交付物**: `backend/app/services/reform_sandbox_service.py`
- **验收**: 沙箱副本保留 30 天 + 未确认投入自动 Purge

---

## 依赖关系图

```
P0 (Phase R1):
  R1.1 DATA-01 ──┐
  R1.2 DATA-02 ──┤
  R1.3 DATA-03 ──┴─→ 数据基座 (前置)
                     │
  R1.4 CORE-01 ──────→ AI 编排 (核心)
       │
       └─→ R1.5 CORE-02 (人机协同)

P1 (Phase R2):
  R2.1 MOD-06 ←─ R1.4
  R2.2 MOD-07 (独立)
  R2.3 MOD-09 (独立)
  R2.4 MOD-10 (独立)
  R2.5 MOD-11 ←─ R1.4
  R2.6 MOD-14 (独立)
  R2.7 DATA-04 (独立, 依赖 EMQX)
  R2.8 APP-05 (独立)
  R2.9 APP-06 (独立)
  R2.10 CORE-03 (独立)
  R2.11 INFRA-01b ←─ R1.1/R1.2/R1.3 (适配器依赖数据源)

P2 (Phase R3):
  R3.1 MOD-08b (独立, 可与 R2 并行)
  R3.2 INFRA-04 (独立)
```

---

## 外部依赖清单

| 依赖项 | 影响范围 | 获取难度 | 备注 |
|---|---|---|---|
| 银行 API 凭证 (6 家) | R1.1 | 高 | 需商务洽谈, 可先用聚合 API (聚水潭/银企联云) |
| 国家税务总局 API | R1.2 | 高 | 需申请接入资质 |
| 票交所 ECDS API | R1.2 | 高 | 需金融资质 |
| OCR 引擎 | R1.3 | 低 | PaddleOCR 开源 / 百度阿里 API |
| Temporal/Airflow | R1.4 | 中 | 开源, 可自部署 |
| Elasticsearch | R1.4 | 低 | 开源 |
| EMQX MQTT Broker | R2.7 | 低 | 开源 |
| HE-SEAL 同态加密库 | R2.2 | 高 | 学术库, 性能受限 |
| 金融监管局通道 | R3.2 | 高 | 需政府关系 |

---

## 关键里程碑

| 里程碑 | 完成条件 | 预计时间 |
|---|---|---|
| **M1: 数据基座就绪** | R1.1+R1.2+R1.3 完成 | T+15 天 |
| **M2: AI 自主操作可用** | R1.4+R1.5 完成 | T+30 天 |
| **M3: 业务闭环** | R2.1-R2.6 完成 | T+55 天 |
| **M4: 独立门户上线** | R2.8+R2.9 完成 | T+60 天 |
| **M5: 全量上线** | R3.1+R3.2 完成 | T+78 天 |

---

## 风险与缓解

| 风险 | 概率 | 影响 | 缓解策略 |
|---|---|---|---|
| 银行 API 接入受阻 | 高 | R1.1 阻塞 | 先用 INFRA-05 无接口模式 (RPA 生成申报书 PDF) |
| 同态加密性能不足 | 中 | R2.2 性能瓶颈 | 降级为 FF1 格式保留 + Shamir 分片 |
| Temporal 部署复杂 | 中 | R1.4 阻塞 | 降级为 Celery + Redis (已就绪) |
| EMQX 运维成本高 | 低 | R2.7 延迟 | 降级为 HTTP 长轮询 |

---

> **维护说明**: 本路线图由 `tools/spec_trace.py` 自动扫描生成, 每完成一个 R 任务后建议重跑:
> ```bash
> python tools/spec_trace.py --json tools/trace_report.json
> python tools/spec_code_drift.py
> ```
> 以保持 spec.md 与代码同步.
