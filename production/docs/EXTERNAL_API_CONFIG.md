# FinTrust Hub v3.1 外部 API 依赖配置清单

> 适用版本: v3.1.0  
> 数据来源: 本清单基于 `backend/.env.example` 与 `backend/app/config.py` 实际字段提取（已 Read 校验），并补充架构规划中的 Phase A1–A15 / 6b 外部依赖。  
> 配置注入方式: 所有配置通过环境变量注入，由 `backend/app/config.py` 的 `Settings(BaseSettings)` 读取（`env_file=".env"`，`case_sensitive=False`，`extra="ignore"`）。  
> 最后更新: 2026-08-19

---

## 目录

- [配置读取机制](#配置读取机制)
- [1. 银行与征信类](#1-银行与征信类)
- [2. 区块链类](#2-区块链类)
- [3. OCR 类](#3-ocr-类)
- [4. IoT 与物联网类](#4-iot-与物联网类)
- [5. 通信与通知类](#5-通信与通知类)
- [6. 政府数据类](#6-政府数据类)
- [7. 物流与评估类](#7-物流与评估类)
- [8. LLM 类](#8-llm-类)
- [9. 时序任务类](#9-时序任务类)
- [10. 中间件类](#10-中间件类)
- [11. 安全与认证类（JWT）](#11-安全与认证类jwt)
- [12. 接入优先级建议](#12-接入优先级建议)

---

## 配置读取机制

```python
# backend/app/config.py
class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",          # 多余字段忽略, 不报错
    )
```

- 环境变量优先级: 系统环境变量 > `.env` 文件 > 代码默认值。
- 所有字段在 `config.py` 均有默认值，**未配置时不会阻断启动**，相关功能降级或禁用。
- 标记说明:
  - `[已落地]` = 字段已存在于 `.env.example` 与 `config.py`
  - `[规划中]` = 架构规划但 `.env.example` 暂未显式声明，需后续补充

---

## 1. 银行与征信类

### 1.1 A1–A2 银企直连（工行 / 建行）

| 字段 | 内容 |
| --- | --- |
| API 名称 | 工商银行 / 建设银行 银企直连（Bank-Enterprise Direct Connect） |
| 所属 Phase | A1–A2 |
| 用途 | 直连查询企业账户余额、流水、回单，用于融资授信数据采集 |
| 必需配置项 | `BANK_API_001_URL`（工行接口地址）<br>`BANK_API_001_APP_ID` / `BANK_API_001_APP_SECRET`（应用密钥）<br>`BANK_API_001_CERT_PATH` / `BANK_API_001_CERT_PASSWORD`（数字证书）<br>建行同理 `BANK_API_002_*` `[已落地]` |
| 申请渠道 | 各行企业网银后台 → 银企直连业务申请，或联系客户经理 |
| 申请难度 | 困难（需企业资质 + 银行授信审批 + 数字证书） |
| 费用 | 按年付费（各行不同，通常数千至数万/年） |
| 降级方案 | URL 为空时，相关银行数据接口返回空集，前端展示"未接入"；可改用人工上传流水 + OCR 解析 |
| 接入文档 | 工行: <https://open.icbc.com.cn/> ；建行: <https://developer.ccb.com/> |
| 优先级 | P1（重要） |

示例配置:

```ini
BANK_API_001_URL=https://api.icbc.com.cn/fintrust/v1
BANK_API_002_URL=https://api.ccb.com.cn/fintrust/v1
# 证书 (挂载到容器, 非 .env):
# /etc/fintrust/certs/icbc.pfx  /  CCB.cer
```

### 1.2 A3–A4 银企直连（招行 / 民生）

| 字段 | 内容 |
| --- | --- |
| API 名称 | 招商银行 / 民生银行 银企直连 |
| 所属 Phase | A3–A4 |
| 用途 | 同上，扩展支持的银行渠道 |
| 必需配置项 | 复用 `BANK_API_001_URL` / `BANK_API_002_URL` 或扩展 `BANK_API_003_URL` 等 `[规划中]`，附各行证书 |
| 申请渠道 | 招行: <https://open.cmbchina.com/> ；民生: <https://open.cmbc.com.cn/> |
| 申请难度 | 困难（需企业资质 + 证书） |
| 费用 | 按年付费 |
| 降级方案 | 同 1.1 |
| 接入文档 | 见各银行开放平台 |
| 优先级 | P2（可选，二期接入） |

### 1.3 A4 央行征信查询

| 字段 | 内容 |
| --- | --- |
| API 名称 | 中国人民银行征信中心查询（PBOC Credit Report） |
| 所属 Phase | A4 |
| 用途 | 查询企业/个人征信报告，用于信用评估与风险定价 |
| 必需配置项 | `PBOC_CREDIT_API_URL`（征信系统地址）<br>`PBOC_CREDIT_API_KEY`（查询授权码）<br>`PBOC_CREDIT_ORG_CODE`（机构信用代码）`[已落地]` |
| 申请渠道 | 中国人民银行征信中心 <https://www.pbccrc.org.cn/> |
| 申请难度 | 困难（需持牌金融机构或经授权的接入资质） |
| 费用 | 按次计费 |
| 降级方案 | 未接入时关闭征信查询入口，前端提示"需线下授权后查询"；可用第三方征信（如朴道、百行征信）替代 |
| 接入文档 | 征信中心接入指南（需线下申请） |
| 优先级 | P1（重要，强相关风控） |

### 1.4 通用银行 API 占位

| 字段 | 内容 |
| --- | --- |
| API 名称 | 通用银行 API 占位接口（Bank API Slot 001/002） |
| 所属 Phase | INFRA-01b（基础设施对接） |
| 用途 | `.env.example` 预留的通用银行接口 URL 占位，可指向任意已对接的银行 API 网关 |
| 必需配置项 | `BANK_API_001_URL: str` `[已落地]`<br>`BANK_API_002_URL: str` `[已落地]` |
| 申请渠道 | 取决于所指向的实际银行 |
| 申请难度 | 视实际银行而定 |
| 费用 | 视实际银行而定 |
| 降级方案 | 为空时该 URL 不生效，对应数据源不可用 |
| 接入文档 | - |
| 优先级 | P1（重要） |

示例配置:

```ini
BANK_API_001_URL=<your-bank-api-url-here>
BANK_API_002_URL=<your-bank-api-url-here>
```

---

## 2. 区块链类

### 2.1 A6 蚂蚁链

| 字段 | 内容 |
| --- | --- |
| API 名称 | 蚂蚁链（Ant Chain / AntChain） |
| 所属 Phase | A6 |
| 用途 | 数据存证、电子合同上链、供应链金融溯源，保障交易不可篡改 |
| 必需配置项 | `ANT_CHAIN_ENDPOINT: str` `[已落地]`（接入点）<br>`ANT_CHAIN_ACCESS_KEY: str` `[已落地]`（AccessKey）<br>`ANT_CHAIN_SECRET: str` `[已落地]`（AccessSecret） |
| 申请渠道 | 蚂蚁链开放平台 <https://antchain.antgroup.com/> |
| 申请难度 | 中等（需实名认证 + 企业实名） |
| 费用 | 按量计费（存证/调用次数） |
| 降级方案 | Key 为空时跳过上链，数据仅落 PostgreSQL；功能降级为"本地存证"，不影响主流程 |
| 接入文档 | <https://docs.antchain.antgroup.com/> |
| 优先级 | P1（重要） |

示例配置:

```ini
ANT_CHAIN_ENDPOINT=https://openapi.antchain.antgroup.com/
ANT_CHAIN_ACCESS_KEY=<your-access-key-here>
ANT_CHAIN_SECRET=<your-secret-here>
```

### 2.2 至信链

| 字段 | 内容 |
| --- | --- |
| API 名称 | 至信链（ZXIN Chain / Zhixin Chain） |
| 所属 Phase | A6（区块链证据固化） |
| 用途 | 司法可信存证，对接法院/公证处，提升电子证据效力 |
| 必需配置项 | `ZXIN_CHAIN_ENDPOINT: str` `[已落地]`（接入点）<br>另需业务 ID、密钥 `[规划中]` |
| 申请渠道 | 至信链开放平台 <https://trustsql.tencent.com/> |
| 申请难度 | 中等（需企业实名 + 资质审核） |
| 费用 | 按量计费 |
| 降级方案 | Endpoint 为空时禁用至信链存证，可由蚂蚁链兜底 |
| 接入文档 | <https://trustsql.tencent.com/document> |
| 优先级 | P2（可选，与蚂蚁链二选一） |

示例配置:

```ini
ZXIN_CHAIN_ENDPOINT=https://trustsql.tencent.com/v1
```

---

## 3. OCR 类

### 3.1 A7 PaddleOCR（本地）

| 字段 | 内容 |
| --- | --- |
| API 名称 | PaddleOCR 本地 OCR 引擎 |
| 所属 Phase | A7 |
| 用途 | 本地解析营业执照、银行流水、发票、合同等影像资料，提取结构化字段 |
| 必需配置项 | `PADDLE_OCR_LANG: str` `[已落地]`（识别语言，默认 `ch`） |
| 申请渠道 | 开源仓库 <https://github.com/PaddlePaddle/PaddleOCR> |
| 申请难度 | 容易（本地部署，无需申请） |
| 费用 | 免费（开源） |
| 降级方案 | 依赖随 `requirements.txt` 的 `paddleocr>=2.7.0` 安装；若安装失败则 OCR 功能不可用，前端提示"OCR 模块未就绪" |
| 接入文档 | <https://github.com/PaddlePaddle/PaddleOCR/blob/main/README.md> |
| 优先级 | P0（必须，核心解析能力） |

示例配置:

```ini
PADDLE_OCR_LANG=ch
```

### 3.2 云 OCR（阿里云 / 百度 / 腾讯）

| 字段 | 内容 |
| --- | --- |
| API 名称 | 云端 OCR 识别服务（Cloud OCR） |
| 所属 Phase | A7（云端补充） |
| 用途 | 当本地 PaddleOCR 精度不足或负载高时，回退到云 OCR（票据/证件高精度识别） |
| 必需配置项 | `CLOUD_OCR_PROVIDER: str` `[已落地]`（`aliyun` / `baidu` / `tencent`）<br>`CLOUD_OCR_KEY: str` `[已落地]`（云厂商 API Key） |
| 申请渠道 | 阿里云视觉智能 <https://vision.aliyun.com/> ；百度智能云 <https://cloud.baidu.com/product/ocr.html> ；腾讯云 <https://cloud.tencent.com/product/ocr> |
| 申请难度 | 容易（实名认证即可） |
| 费用 | 按量计费（各厂均有免费额度） |
| 降级方案 | Key 为空时禁用云 OCR，由本地 PaddleOCR 兜底；精度可能略低 |
| 接入文档 | 阿里云: <https://help.aliyun.com/zh/vision/> ；百度: <https://cloud.baidu.com/doc/OCR/index.html> ；腾讯: <https://cloud.tencent.com/document/product/866> |
| 优先级 | P2（可选，作为本地 OCR 的精度补充） |

示例配置:

```ini
CLOUD_OCR_PROVIDER=aliyun
CLOUD_OCR_KEY=<your-cloud-ocr-key-here>
```

---

## 4. IoT 与物联网类

### 4.1 A8 EMQX MQTT

| 字段 | 内容 |
| --- | --- |
| API 名称 | EMQX MQTT 物联网消息代理 |
| 所属 Phase | A8 |
| 用途 | 接入企业生产设备/能耗/仓储传感器，实时采集物联网数据用于经营画像 |
| 必需配置项 | MQTT Broker 地址、端口、ClientID、用户名/密码 `[规划中]`（`.env.example` 暂无独立字段，建议新增 `MQTT_BROKER_HOST` / `MQTT_PORT` / `MQTT_USERNAME` / `MQTT_PASSWORD`） |
| 申请渠道 | 开源自部署 <https://www.emqx.io/> ；或 EMQX Cloud <https://www.emqx.com/cloud> |
| 申请难度 | 容易（自部署）/ 中等（Cloud 需企业实名） |
| 费用 | 免费（开源版）/ 按量（Cloud） |
| 降级方案 | 未配置时关闭 IoT 数据采集，经营画像仅依赖财务/税务等静态数据 |
| 接入文档 | <https://docs.emqx.com/zh/> |
| 优先级 | P2（可选，取决于业务是否需设备数据） |

示例配置（建议新增）:

```ini
MQTT_BROKER_HOST=localhost
MQTT_PORT=1883
MQTT_USERNAME=<your-mqtt-user-here>
MQTT_PASSWORD=<your-mqtt-password-here>
```

### 4.2 6b 物联网数据采集网关

| 字段 | 内容 |
| --- | --- |
| API 名称 | 边缘物联网数据采集网关（IoT Edge Gateway） |
| 所属 Phase | 6b |
| 用途 | 边缘侧汇聚多协议（Modbus / OPC UA / MQTT）传感器数据，清洗后上报至 EMQX |
| 必需配置项 | 网关硬件、协议适配配置 `[规划中]` |
| 申请渠道 | 需采购边缘网关硬件（如研华、华为 AR、移远等），或自研边缘程序 |
| 申请难度 | 困难（需硬件 + 现场部署 + 企业资质） |
| 费用 | 一次性硬件采购 + 部署成本 |
| 降级方案 | 无网关时 IoT 数据缺失，对应经营指标置空 |
| 接入文档 | 视网关厂商而定 |
| 优先级 | P2（可选，按行业场景决定） |

---

## 5. 通信与通知类

### 5.1 A9 微信企业号机器人

| 字段 | 内容 |
| --- | --- |
| API 名称 | 企业微信应用机器人（WeCom Work Bot） |
| 所属 Phase | A9 |
| 用途 | 推送审批提醒、告警、放款通知等消息到企业微信 |
| 必需配置项 | 企业 `corpid`、应用 `secret`、应用 `agentid` `[规划中]`（建议新增 `WECOM_CORPID` / `WECOM_SECRET` / `WECOM_AGENT_ID`） |
| 申请渠道 | 企业微信管理后台 <https://work.weixin.qq.com/> |
| 申请难度 | 容易（注册企业微信即可） |
| 费用 | 免费 |
| 降级方案 | 未配置时关闭企业微信通道，通知改走站内消息 + 邮件 |
| 接入文档 | <https://developer.work.weixin.qq.com/document/> |
| 优先级 | P1（重要，通知能力） |

示例配置（建议新增）:

```ini
WECOM_CORPID=<your-corpid-here>
WECOM_SECRET=<your-secret-here>
WECOM_AGENT_ID=<your-agentid-here>
```

### 5.2 A10 钉钉机器人

| 字段 | 内容 |
| --- | --- |
| API 名称 | 钉钉自定义机器人 / 应用机器人（DingTalk Bot） |
| 所属 Phase | A10 |
| 用途 | 推送审批/告警消息到钉钉群或工作通知 |
| 必需配置项 | 应用 `app_key`、`app_secret`（或自定义机器人 webhook + secret）`[规划中]`（建议新增 `DINGTALK_APP_KEY` / `DINGTALK_APP_SECRET`） |
| 申请渠道 | 钉钉开放平台 <https://open.dingtalk.com/> |
| 申请难度 | 容易 |
| 费用 | 免费 |
| 降级方案 | 未配置时关闭钉钉通道，由企业微信或站内消息兜底 |
| 接入文档 | <https://open.dingtalk.com/document/> |
| 优先级 | P1（重要） |

示例配置（建议新增）:

```ini
DINGTALK_APP_KEY=<your-app-key-here>
DINGTALK_APP_SECRET=<your-app-secret-here>
```

---

## 6. 政府数据类

### 6.1 A11 税务数据

| 字段 | 内容 |
| --- | --- |
| API 名称 | 税务数据查询接口（Tax Data API） |
| 所属 Phase | A11 |
| 用途 | 查询企业纳税申报、开票、欠税等数据，用于融资授信核验 |
| 必需配置项 | `TAX_API_URL: str` `[已落地]`（税务接口地址）<br>另需税务授权令牌 `[规划中]` |
| 申请渠道 | 电子税务局授权接入，或金税服务商（如航天信息、百望） |
| 申请难度 | 困难（需企业授权 + 税务局备案） |
| 费用 | 按次或按年（金税服务商） |
| 降级方案 | URL 为空时关闭税务自动查询，改由企业手动上传税务报表 + OCR |
| 接入文档 | 各省电子税务局；金税服务商文档 |
| 优先级 | P0（必须，融资风控核心数据） |

示例配置:

```ini
TAX_API_URL=<your-tax-api-url-here>
```

### 6.2 A12 工商数据

| 字段 | 内容 |
| --- | --- |
| API 名称 | 工商/发票数据查询接口（Invoice & Business Registry API） |
| 所属 Phase | A12 |
| 用途 | 查询企业工商登记、股权、发票明细，用于企业画像与发票核验 |
| 必需配置项 | `INVOICE_API_URL: str` `[已落地]`（发票/工商接口地址）<br>另需 API Token `[规划中]` |
| 申请渠道 | 国家企业信用信息公示系统，或第三方（天眼查 <https://open.tianyancha.com/>、企查查 <https://openapi.qcc.com/>） |
| 申请难度 | 中等（第三方）/ 困难（官方直连） |
| 费用 | 按量计费或包年（第三方） |
| 降级方案 | URL 为空时关闭自动工商查询，前端引导人工录入工商信息 |
| 接入文档 | 第三方开放平台文档 |
| 优先级 | P0（必须，企业基础信息核验） |

示例配置:

```ini
INVOICE_API_URL=<your-invoice-api-url-here>
```

### 6.3 A13 司法数据

| 字段 | 内容 |
| --- | --- |
| API 名称 | 司法/裁判文书查询接口（Judicial Data API） |
| 所属 Phase | A13 |
| 用途 | 查询企业涉诉、被执行、失信记录，用于风险预警 |
| 必需配置项 | 司法数据接口地址 + Token `[规划中]`（建议新增 `JUDICIAL_API_URL` / `JUDICIAL_API_TOKEN`） |
| 申请渠道 | 中国裁判文书网 <https://wenshu.court.gov.cn/> ；或第三方（天眼查、企查查司法模块） |
| 申请难度 | 困难（官方需授权）/ 中等（第三方） |
| 费用 | 按量计费（第三方） |
| 降级方案 | 未接入时关闭司法风险评分，前端提示"司法数据未接入" |
| 接入文档 | 第三方开放平台文档 |
| 优先级 | P1（重要，风控补充） |

示例配置（建议新增）:

```ini
JUDICIAL_API_URL=<your-judicial-api-url-here>
JUDICIAL_API_TOKEN=<your-token-here>
```

---

## 7. 物流与评估类

### 7.1 A14 物流数据

| 字段 | 内容 |
| --- | --- |
| API 名称 | 物流数据查询接口（Logistics Data API） |
| 所属 Phase | A14 |
| 用途 | 查询企业货运、仓储数据，用于贸易真实性核验与供应链金融 |
| 必需配置项 | 物流公司接口地址 + 密钥 `[规划中]`（建议新增 `LOGISTICS_API_URL` / `LOGISTICS_API_KEY`） |
| 申请渠道 | 顺丰开放平台 <https://open.sf-express.com/> ；京东物流开放平台 <https://open.jdl.com/> ；或其他物流公司 |
| 申请难度 | 中等 |
| 费用 | 按量计费或商务洽谈 |
| 降级方案 | 未接入时关闭物流数据自动采集，由企业上传物流单据 + OCR |
| 接入文档 | 各物流公司开放平台 |
| 优先级 | P2（可选，供应链金融场景） |

### 7.2 A15 评估数据

| 字段 | 内容 |
| --- | --- |
| API 名称 | 第三方评估机构数据接口（Appraisal Data API） |
| 所属 Phase | A15 |
| 用途 | 获取抵押物/资产评估报告，用于抵质押融资估值 |
| 必需配置项 | 评估机构接口地址 + 授权 `[规划中]`（建议新增 `APPRAISAL_API_URL` / `APPRAISAL_API_KEY`） |
| 申请渠道 | 对接持牌评估机构，或行业协会评估数据平台 |
| 申请难度 | 困难（需企业资质 + 商务合作） |
| 费用 | 按次或商务包年 |
| 降级方案 | 未接入时由评估师线下出具报告 + 人工录入 |
| 接入文档 | 评估机构提供 |
| 优先级 | P2（可选，抵质押场景） |

---

## 8. LLM 类

### 8.1 DeepSeek

| 字段 | 内容 |
| --- | --- |
| API 名称 | DeepSeek 大语言模型 API |
| 所属 Phase | LLM（贯穿各 Phase 智能问答/报告生成） |
| 用途 | 智能风控问答、融资方案生成、报告自动撰写 |
| 必需配置项 | `DEEPSEEK_API_KEY: str` `[已落地]`<br>`DEEPSEEK_BASE_URL: str` `[已落地]`（默认 `https://api.deepseek.com/v1`）<br>`DEEPSEEK_MODEL: str` `[已落地]`（默认 `deepseek-chat`） |
| 申请渠道 | DeepSeek 开放平台 <https://platform.deepseek.com/> |
| 申请难度 | 容易（注册即用，支持人民币支付） |
| 费用 | 按量计费（token 计费，价格较低） |
| 降级方案 | Key 为空时禁用 LLM 功能，智能问答/报告生成返回"LLM 未配置"提示 |
| 接入文档 | <https://platform.deepseek.com/api-docs/> |
| 优先级 | P0（必须，核心智能能力） |

示例配置:

```ini
DEEPSEEK_API_KEY=<your-deepseek-key-here>
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat
```

### 8.2 OpenAI

| 字段 | 内容 |
| --- | --- |
| API 名称 | OpenAI GPT API |
| 所属 Phase | LLM（备选模型） |
| 用途 | DeepSeek 之外的备选大模型，支持多模型路由 |
| 必需配置项 | `OPENAI_API_KEY: str` `[已落地]` |
| 申请渠道 | OpenAI 平台 <https://platform.openai.com/> |
| 申请难度 | 中等（需海外网络 + 海外支付方式） |
| 费用 | 按量计费（token） |
| 降级方案 | Key 为空时禁用 OpenAI 路由，统一使用 DeepSeek |
| 接入文档 | <https://platform.openai.com/docs> |
| 优先级 | P2（可选，备选模型） |

示例配置:

```ini
OPENAI_API_KEY=<your-openai-key-here>
```

### 8.3 Anthropic

| 字段 | 内容 |
| --- | --- |
| API 名称 | Anthropic Claude API |
| 所属 Phase | LLM（备选模型） |
| 用途 | 备选大模型，长文档分析场景 |
| 必需配置项 | `ANTHROPIC_API_KEY: str` `[已落地]` |
| 申请渠道 | Anthropic 控制台 <https://console.anthropic.com/> |
| 申请难度 | 中等 |
| 费用 | 按量计费（token） |
| 降级方案 | Key 为空时禁用 Claude 路由 |
| 接入文档 | <https://docs.anthropic.com/> |
| 优先级 | P2（可选，备选模型） |

示例配置:

```ini
ANTHROPIC_API_KEY=<your-anthropic-key-here>
```

---

## 9. 时序任务类

### 9.1 Temporal 工作流

| 字段 | 内容 |
| --- | --- |
| API 名称 | Temporal 工作流编排引擎 |
| 所属 Phase | 时序任务编排（贯穿业务流程） |
| 用途 | 编排长时序业务流程（融资审批、放款、对账等），保证可靠重试与状态机 |
| 必需配置项 | `TEMPORAL_HOST: str` `[已落地]`（默认 `localhost:7233`）<br>`TEMPORAL_NAMESPACE: str` `[已落地]`（默认 `fintrust`） |
| 申请渠道 | 开源自部署 <https://temporal.io/> ；或 Temporal Cloud <https://temporal.io/cloud> |
| 申请难度 | 容易（自部署）/ 中等（Cloud） |
| 费用 | 免费（自部署）/ 按量（Cloud） |
| 降级方案 | 依赖随 `requirements.txt` 的 `temporalio>=1.4.0`；未连接时 `main.py` 中 Temporal worker 标记为 TODO 不启动，流程改走同步调用（APScheduler 兜底） |
| 接入文档 | <https://docs.temporal.io/> |
| 优先级 | P1（重要，生产级流程编排） |

示例配置:

```ini
TEMPORAL_HOST=localhost:7233
TEMPORAL_NAMESPACE=fintrust
```

---

## 10. 中间件类

### 10.1 PostgreSQL

| 字段 | 内容 |
| --- | --- |
| API 名称 | PostgreSQL 关系型数据库 |
| 所属 Phase | 基础设施（数据持久化主库） |
| 用途 | 业务主数据库，存储企业、用户、融资、合同等核心数据 |
| 必需配置项 | `DATABASE_URL: str` `[已落地]`（异步连接串）<br>`DATABASE_POOL_SIZE: int` `[已落地]`（默认 10）<br>`DATABASE_MAX_OVERFLOW: int` `[已落地]`（默认 20）<br>`DATABASE_ECHO: bool` `[已落地]`（默认 false，SQL 日志） |
| 申请渠道 | 自部署（Docker `postgres:16-alpine`）或云数据库（RDS） |
| 申请难度 | 容易 |
| 费用 | 免费（自部署）/ 按量（云） |
| 降级方案 | driver 缺失或连接失败时，`database.py` 自动降级到内存 store，不阻断启动（持久化失效） |
| 接入文档 | <https://www.postgresql.org/docs/> |
| 优先级 | P0（必须） |

示例配置:

```ini
DATABASE_URL=postgresql+asyncpg://fintrust:fintrust@localhost:5432/fintrust_hub
DATABASE_POOL_SIZE=10
DATABASE_MAX_OVERFLOW=20
DATABASE_ECHO=false
```

### 10.2 Redis

| 字段 | 内容 |
| --- | --- |
| API 名称 | Redis 缓存 |
| 所属 Phase | 基础设施（缓存/会话/限流） |
| 用途 | 缓存、会话、分布式锁、限流 |
| 必需配置项 | `REDIS_URL: str` `[已落地]`（默认 `redis://localhost:6379/0`）<br>`REDIS_PASSWORD: str` `[已落地]`（默认空） |
| 申请渠道 | 自部署（Docker `redis:7-alpine`）或云 Redis |
| 申请难度 | 容易 |
| 费用 | 免费（自部署）/ 按量（云） |
| 降级方案 | 连接失败时缓存失效，请求直连 DB（性能下降但可用） |
| 接入文档 | <https://redis.io/docs/> |
| 优先级 | P0（必须） |

示例配置:

```ini
REDIS_URL=redis://localhost:6379/0
REDIS_PASSWORD=<your-redis-password-here>
```

### 10.3 ClickHouse

| 字段 | 内容 |
| --- | --- |
| API 名称 | ClickHouse 时序数据库 |
| 所属 Phase | 基础设施（指标/日志时序存储） |
| 用途 | 存储企业经营指标、监控指标、审计日志时序数据 |
| 必需配置项 | `CLICKHOUSE_HOST: str` `[已落地]`（默认 localhost）<br>`CLICKHOUSE_PORT: int` `[已落地]`（默认 8123）<br>`CLICKHOUSE_USER: str` `[已落地]`（默认 default）<br>`CLICKHOUSE_PASSWORD: str` `[已落地]`（默认空）<br>`CLICKHOUSE_DATABASE: str` `[已落地]`（默认 fintrust_metrics） |
| 申请渠道 | 自部署（Docker `clickhouse/clickhouse-server:24-alpine`）或 ClickHouse Cloud |
| 申请难度 | 容易 |
| 费用 | 免费（自部署）/ 按量（Cloud） |
| 降级方案 | 连接失败时禁用时序写入，指标改落 PostgreSQL（或丢弃，不影响主流程） |
| 接入文档 | <https://clickhouse.com/docs> |
| 优先级 | P1（重要） |

示例配置:

```ini
CLICKHOUSE_HOST=localhost
CLICKHOUSE_PORT=8123
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=<your-clickhouse-password-here>
CLICKHOUSE_DATABASE=fintrust_metrics
```

### 10.4 Neo4j

| 字段 | 内容 |
| --- | --- |
| API 名称 | Neo4j 图数据库 |
| 所属 Phase | 基础设施（关系图谱/知识图谱） |
| 用途 | 存储企业关系图谱（股权、担保、关联交易），支撑关联风险传染分析 |
| 必需配置项 | `NEO4J_URI: str` `[已落地]`（默认 `bolt://localhost:7687`）<br>`NEO4J_USER: str` `[已落地]`（默认 neo4j）<br>`NEO4J_PASSWORD: str` `[已落地]`（默认 fintrust） |
| 申请渠道 | 自部署（Docker `neo4j:5-community`）或 Neo4j Aura <https://neo4j.com/cloud/aura/> |
| 申请难度 | 容易 |
| 费用 | 免费（社区版自部署）/ 按量（Aura） |
| 降级方案 | 连接失败时关闭图谱查询，关联关系改由 PostgreSQL 递归查询兜底 |
| 接入文档 | <https://neo4j.com/docs/> |
| 优先级 | P1（重要） |

示例配置:

```ini
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=<your-neo4j-password-here>
```

### 10.5 Kafka

| 字段 | 内容 |
| --- | --- |
| API 名称 | Apache Kafka 消息队列 |
| 所属 Phase | 基础设施（异步事件总线） |
| 用途 | 异步事件驱动（数据采集、通知、审计事件解耦） |
| 必需配置项 | `KAFKA_BOOTSTRAP_SERVERS: str` `[已落地]`（默认 `localhost:9092`）<br>`KAFKA_CLIENT_ID: str` `[已落地]`（默认 fintrust-hub） |
| 申请渠道 | 自部署或 Confluent Cloud <https://www.confluent.io/> |
| 申请难度 | 容易（自部署）/ 中等（生产级调优） |
| 费用 | 免费（自部署）/ 按量（Cloud） |
| 降级方案 | 未连接时 Kafka consumer 不启动（`main.py` 标记 TODO），事件改走同步处理 |
| 接入文档 | <https://kafka.apache.org/documentation/> |
| 优先级 | P1（重要） |

示例配置:

```ini
KAFKA_BOOTSTRAP_SERVERS=localhost:9092
KAFKA_CLIENT_ID=fintrust-hub
```

---

## 11. 安全与认证类（JWT）

### 11.1 JWT 鉴权

| 字段 | 内容 |
| --- | --- |
| API 名称 | JWT 令牌签发与校验（JSON Web Token） |
| 所属 Phase | 基础设施（认证鉴权） |
| 用途 | 用户登录态签发与接口鉴权 |
| 必需配置项 | `JWT_SECRET: str` `[已落地]`（签名密钥，默认 `change-me-in-production`）<br>`JWT_ALGORITHM: str` `[已落地]`（默认 `HS256`）<br>`JWT_EXPIRE_MINUTES: int` `[已落地]`（默认 1440 = 24h） |
| 申请渠道 | 无需申请，本地生成 |
| 申请难度 | 容易 |
| 费用 | 免费 |
| 降级方案 | 无（必填）；默认值仅用于开发，**生产部署必须修改 `JWT_SECRET`** |
| 接入文档 | <https://jwt.io/introduction> |
| 优先级 | P0（必须） |

> **安全警示**: `JWT_SECRET` 默认值为 `change-me-in-production`，仅用于本地开发。生产环境（`APP_ENV=production`）部署前**必须**替换为高熵随机字符串。K8s 部署时通过 `infra/k8s/config.yaml` 的 Secret `db-secrets.jwt-secret` 注入。

示例配置:

```ini
JWT_SECRET=<your-strong-random-secret-here>
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=1440
```

---

## 12. 接入优先级建议

按 MVP（最小可用产品）→ 完整版分阶段接入。**MVP 必接**项缺一不可，其余可后期补充。

| 优先级 | API / 依赖 | 所属 Phase | 是否 MVP 必接 | 说明 |
| --- | --- | --- | --- | --- |
| P0 | PostgreSQL | 基础设施 | 是 | 主数据库，无则数据不持久（仅内存） |
| P0 | Redis | 基础设施 | 是 | 缓存/会话 |
| P0 | JWT | 认证 | 是 | 鉴权（生产必须改 secret） |
| P0 | PaddleOCR | A7 | 是 | 核心影像解析（本地，免申请） |
| P0 | DeepSeek | LLM | 是 | 智能问答/报告（国内易申请） |
| P0 | 税务数据 | A11 | 是 | 融资风控核心数据源 |
| P0 | 工商数据 | A12 | 是 | 企业基础信息核验 |
| P1 | 通用银行 API（BANK_API_001/002） | INFRA-01b | 否 | 银行流水直连，二期接 |
| P1 | 央行征信 | A4 | 否 | 强风控，需资质，可线下兜底 |
| P1 | 蚂蚁链 | A6 | 否 | 数据存证，无则本地存证兜底 |
| P1 | 企业微信机器人 | A9 | 否 | 通知通道，可站内消息兜底 |
| P1 | 钉钉机器人 | A10 | 否 | 通知通道，与企业微信二选一 |
| P1 | 司法数据 | A13 | 否 | 风控补充，第三方可后期接 |
| P1 | ClickHouse | 基础设施 | 否 | 时序指标，无则落 PG |
| P1 | Neo4j | 基础设施 | 否 | 关系图谱，无则 PG 递归查询 |
| P1 | Kafka | 基础设施 | 否 | 事件总线，无则同步处理 |
| P1 | Temporal | 时序任务 | 否 | 流程编排，无则 APScheduler 兜底 |
| P2 | 银企直连（招行/民生） | A3–A4 | 否 | 扩展银行渠道 |
| P2 | 至信链 | A6 | 否 | 与蚂蚁链二选一 |
| P2 | 云 OCR | A7 | 否 | 本地 OCR 精度补充 |
| P2 | EMQX MQTT | A8 | 否 | 取决于是否需设备数据 |
| P2 | 物联网网关 | 6b | 否 | 按行业场景决定 |
| P2 | 物流数据 | A14 | 否 | 供应链金融场景 |
| P2 | 评估数据 | A15 | 否 | 抵质押融资场景 |
| P2 | OpenAI | LLM | 否 | DeepSeek 备选模型 |
| P2 | Anthropic | LLM | 否 | DeepSeek 备选模型 |

### MVP 接入建议（最小可上线集合）

1. **基础设施**: PostgreSQL + Redis（Docker Compose 一键起）
2. **认证**: JWT（改 secret）
3. **核心能力**: PaddleOCR（本地）+ DeepSeek（国内易申请）
4. **数据源**: 税务数据（A11）+ 工商数据（A12）
5. 其余全部走降级方案，待业务跑通后按 P1 → P2 顺序逐步接入。

### 接入顺序建议

```
阶段一 (MVP):  P0 全部  →  系统可独立运行 + 融资风控闭环
阶段二 (风控增强): P1 央行征信 + 司法数据 + 蚂蚁链 + 通知(企业微信/钉钉) + 中间件(ClickHouse/Neo4j/Kafka/Temporal)
阶段三 (生态扩展): P2 银企直连扩展 + 云OCR + IoT + 物流 + 评估 + 备选LLM
```
