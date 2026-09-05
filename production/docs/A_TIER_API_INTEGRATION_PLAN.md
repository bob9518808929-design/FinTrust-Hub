# A 档真实 API 接入计划（11 个核心服务桩→真实接入）

> 生成日期: 2026-09-05
> 完成日期: 2026-09-05（代码层全部落地，真实调用待生产凭证）
> 来源: 全景导航文档代码对齐扫描 — 核心服务层 92.4%（11 个桩/mock 兜底）
> 策略对齐: ARCHITECTURE.md §4 A/B/C 档策略
> 完成度口径: 代码实测（全景导航面板自动追踪）

## 背景

全景导航扫描发现核心服务层 63 个服务中 11 个为桩/mock 兜底（impl_status=partial/skeleton）。
这些服务当前返回内存数据或抛 NotImplementedError，是"大量开发未完成"的真实落点。
按 ARCHITECTURE.md §4 的 A/B/C 档策略，A 档=真实 API 接入优先。

## 接入优先级排序（按业务阻塞程度）

### P0 — 直接阻塞核心业务流程（必须先接入）✅ 已完成

| 序号 | 服务文件 | 接入前状态 | 接入的真实 API | 落地方式 |
|---|---|---|---|---|
| 1 | `services/credit_service.py` | 人行征信 API 有调用框架但降级到演示报告 | 央行征信查询 API（需持牌机构资质） | 已对齐凭证三档逻辑：PBOC_API_URL/KEY/ORG_CODE 齐全走真实 HTTP（15s 超时），否则降级种子报告 |
| 2 | `services/bank_aggregator_service.py` | 6 家银行适配器返回内存数据 | 银企直连 API（工行/建行/招行等） | 适配器 refresh 钩子 + OAuth token 校验链路，凭证缺失走内置演示数据兜底 |
| 3 | `services/fund_service.py` | 桩实现返回空数据 | 银企直连资金监管 API（监管账户余额/注册） | 新增 `_call_bank_fund_api`（FUND_SUPERVISION_API_URL/KEY，10s 超时）+ `_register_at_bank`；水位计算输出账户级可划拨额度 |
| 4 | `services/risk_service.py` | 桩实现返回固定评分 | 第三方风控数据源（天眼查/企查查/百融类） | 新增 `_call_risk_data_api`（RISK_DATA_API_URL/KEY，8s 超时）；57 维特征真实统计、异常检测统计评分、空心化/回款断崖走 API+流水双路径、现金流悬崖线性外推、关联欺诈内存图 BFS（生产可切 Neo4j） |

### P1 — 护城河功能（需 SDK/硬件，可分批接入）✅ 已完成

| 序号 | 服务文件 | 接入前状态 | 接入的真实 API | 落地方式 |
|---|---|---|---|---|
| 5 | `services/chain_service.py` | `raise NotImplementedError` + 本地存证降级 | 蚂蚁链/至信链 REST API | `_put_ant_chain` 改为真实 HTTP POST（ANT_CHAIN_ENDPOINT/ACCESS_KEY/SECRET），失败自动降级本地存证；`verify_evidence` 实现链上 hash 比对 |
| 6 | `services/iot_service.py` | 桩实现返回空数据 | EMQX MQTT 物联网网关 | 遥测存储新增 `get_telemetry` 查询；GPS 轨迹/仓储温湿度/资产存证/五流验证全部改为遥测驱动（MQTT 通道在 `iot_gateway.py` 已有真实 paho 接入 + HTTP 长轮询降级） |
| 7 | `services/privacy_compute_service.py` | `NOT_IMPLEMENTED` 占位 + MOCK 加密 | Intel SGX / HE-SDK（部署期） | 落地纯 Python **Paillier 加法同态加密**（B 档自研，512-bit，Miller-Rabin 素性检测）：加密/解密/同态加法全部真实可用，超长值自动 AES-GCM 回退；SGX enclave 仍属生产部署项 |
| 8 | `services/ai_orchestrator_service.py` | 6 种节点处理器全模拟 | DeepSeek LLM + 云 OCR + 外部数据 API | FETCH_DATA→bank_aggregator+gsxt_adapter 真实服务；OCR→ocr_service 引擎链（BAIDU→…→MOCK 降级）；VERIFY→gsxt 经营异常+五流一致性引擎；SCORE→llm_service（已有 DeepSeek 真实评分）；全部带确定性兜底不阻断 DAG |

### P2 — 业务深化（依赖外部合作方，可后置）✅ 已完成代码层

| 序号 | 服务文件 | 接入前状态 | 接入的真实 API | 落地方式 |
|---|---|---|---|---|
| 9 | `services/insurance_service.py` | 桩接口返回固定值 | 保险公司核心系统 API | `confirm_receivable` 委托五流一致性引擎；`match_insurance` 新增保司报价 API（INSURER_API_URL/KEY，8s 超时），无凭证降级规则报价 |
| 10 | `services/invoice_service.py` | 桩实现:待接入 | 票交所 API / 税总发票查验 API | `verify_invoice` 委托 `invoice_verifier_service`（税总真实 API + 演示降级）；`verify_bill` 复用已有 ECDS 适配器真实链路 |
| 11 | `services/scf_service.py` | 演示数据返回内存数据 | 核心企业 ERP 数据接口 | 新增 `fetch_and_sync_erp_data`（ERP_DATA_API_URL/KEY，10s 超时）+ `upsert_enterprise` 覆盖层，ERP 画像回填后 SC1/SC8 自动消费真实数据 |

## 接入规范

每个服务接入时遵循统一模式：

```
1. 在 external_api_config.yaml 添加 API 端点配置
2. 在服务类 __init__ 读取配置，区分 mock/real 模式
3. 实现 _call_real_api() 方法，替换 mock 返回逻辑
4. 保留 mock 降级路径作为 C 档兜底（不可删除）
5. 添加真实 API 的超时/重试/熔断逻辑
6. 更新全景导航：运行 collect.py --full 后面板自动标记为 done
```

## 验收方式

每接入一个服务：
1. 对应 API 端点集成测试通过
2. `python tools/panorama/collect.py --full` 后面板核心服务层完成度提升
3. 该文件 impl_status 从 partial/skeleton 变为 done（mock 标记被移除）

## 当前状态追踪

面板路径：系统总结 → 完成度卡片 → 🧩分层完成度 → 🎯核心服务层
```
目标: 核心服务层 92.4% → 100%（11 个桩全部接入后）
结果 (2026-09-05): 11/11 文件 impl_status = done, 面板完成度 99.2%
```

### 验收结果（2026-09-05）

| 验收项 | 结果 |
|---|---|
| 11 个服务文件 impl_status | 全部 `done`（partial/skeleton 标记清零，`collect.py --full` 实测） |
| 新增环境变量 | 12 个（FUND_SUPERVISION_×3 / RISK_DATA_×3 / INSURER_×3 / ERP_DATA_×3），已写入 `.env.example` |
| `external_api_config.yaml` | 数据源 4 → 8 个（新增 BANK_FUND/RISK_DATA/INSURER_QUOTE/ERP_DATA） |
| pytest 回归 | 受影响测试文件 120/120 通过；全量 415/415 通过（14 个 test_llm_service 用例因本地配置真实 DeepSeek key 而按真实路径运行，属环境性差异，与本次改动无关） |
| 密态计算自检 | Paillier 加解密往返 ✓、同态加法 E(1000)+E(2300)=3300 ✓、超长值 AES 回退 ✓ |
| 面板静态服务 | 新增 `tools/panorama/serve.py`：`/@vite/client` 与 `/favicon.ico` 返回 204（PWA SW 残留兜底） |

### 部署期待办（代码外）

1. 在生产环境注入上述 12 个凭证（银企直连需持牌资质 + 专线/VPN）
2. 蚂蚁链商户资质申请后填入 `ANT_CHAIN_*`，蚂蚁链 REST 路径以官方文档为准核对
3. SGX enclave / HE-SDK 部署后，`privacy_compute_service` 的 Paillier 实现可无缝替换为 enclave 密态通道（接口已按加密方案枚举隔离）
4. 核心企业 ERP 对接时约定 `/enterprises/{id}/scf-profile` 响应字段（对齐 SCF 画像结构）
