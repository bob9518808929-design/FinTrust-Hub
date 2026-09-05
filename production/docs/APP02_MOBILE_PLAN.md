# FinTrust Hub APP-02 移动端实现方案与路线图

> 版本: v1.0
> 状态: 规划中（待立项）
> 关联: UX-03（移动端"扫拍点"极简确权）、ECO-06（积分商城）、ECO-09（数字分身）
> 最后更新: 2026-08-20

---

## 1. 背景与定位

### 1.1 现状盘点

| 维度 | 现状 | 来源 |
|---|---|---|
| 独立移动 App | ❌ 未实现 | `production/` 无 mobile/、react-native/、taro/ 等目录 |
| 移动端组件 | 🟡 部分实现 | `frontend/src/components/common/ScanInput.vue`（246 LOC，仓管/物流扫码） |
| 路线图条目 | 📋 已规划 | 全景导航面板 UX-03 "移动端扫拍点极简确权" 🟡 部分实现（原 COMPLETION_MATRIX.md 已归档至 `docs/_archive/`） |
| 参考实现 | ✅ 已有 | `reference/js/eco-pts.js` 提到 APP-02 移动端扫码 + GPS 围栏（原 `view-eco-pts.js` 已迁移至 reference/） |
| 后端支持 | ✅ 已就绪 | ECO-06 积分商城 6 端点、ECO-09 数字分身 4 端点（`/api/v1/eco-pts/*`、`/api/v1/eco-bot/*`） |

### 1.2 设计意图（基于 spec L1631-1718 与 reference）

APP-02 在 spec 中定义为**企业端门户**，承担双重角色：

**角色一：企业老板/财务的移动门户**（spec L1631-1718 主线）
1. **资金看板**：监管账户余额、可划拨额度（动态水位）、近期回款预测、待办融资事项
2. **"傻瓜式"首页**：单一核心指标"银行贷款通过率"（红<40%/黄40-70%/绿>70%）+ 唯一行动按钮（Next Best Action 线性工作流）
3. **一键融资**：AI 推荐可用融资方案，企业选择后一键发起申请
4. **票据管理**：票据列表（真伪/到期日/可贴现额度）+ 批量贴现 + 票据池质押
5. **白话翻译引擎**：所有专业术语强制显示"通俗说 + 场景类比"（如"资产负债率"→"你欠的钱占你总资产的比重，超过 70% 银行会害怕"）
6. **数字分身**：微信/钉钉机器人对话式交互（"我这个月贷款通过率涨了没？"）

**角色二：一线作业人员的行为挖矿入口**（reference/js/eco-pts.js 推断 + ECO-06 积分商城）
1. **扫码确权**：扫码确认物料流转，自动记录 GPS 围栏、时间戳、行为证据，上链换积分
2. **极简确权**（UX-03）：3 步内完成"扫码→拍照→确认"，无需键盘输入，无培训门槛
3. **积分兑换**：积分商城兑换实物，移动端完成下单 + 物流跟踪

### 1.3 用户画像与场景

| 角色 | 核心场景 | 频次 | 关键约束 |
|---|---|---|---|
| 企业老板 | 贷款通过率看板、Next Best Action、AI 问答 | 中频（每日 1-3 次） | 单一指标 + 唯一按钮，零学习成本 |
| 企业财务 | 资金看板、票据管理、融资申请 | 中频（每日 3-10 次） | 与 PC 端数据实时同步 |
| 仓管 | 物料出入库扫码确权、积分查询 | 高频（每日 20-100 次） | 单次操作 < 5 秒，弱网可用 |
| 物流 | 配送签收、GPS 围栏打卡 | 中频（每日 5-20 次） | 离线缓存，进围栏自动签到 |
| 车间工人 | 工序完成打卡、积分兑换 | 低频（每日 1-5 次） | 误触防护，二次确认 |

---

## 2. 技术选型

### 2.1 三套方案对比

| 维度 | 方案 A：PWA | 方案 B：Taro 跨端小程序 | 方案 C：原生 Flutter |
|---|---|---|---|
| 复用现有代码 | ✅ 直接复用 Vue 3 组件 | 🟡 部分复用（需重写为 Taro 语法） | ❌ 完全重写 |
| 扫码/相机 | ✅ BarcodeDetector API + file capture | ✅ wx.scanCode / 原生 API | ✅ 原生插件 |
| 离线能力 | 🟡 Service Worker 缓存 | 🟡 小程序本地存储 | ✅ SQLite 本地 |
| 推送通知 | ❌ iOS 不支持 PWA Push | ✅ 模板消息 + 订阅消息 | ✅ FCM/极光 |
| 上架门槛 | ❌ 无需上架 | ✅ 微信审核（1-3 天） | ✅ App Store/Google Play（2-4 周） |
| 开发成本 | 低（2-3 周） | 中（4-6 周） | 高（8-12 周） |
| 推广摩擦 | 低（扫码即用） | 中（需小程序码） | 高（需下载安装） |
| **推荐度** | 🥇 首选 MVP | 🥈 二期扩展 | 🥉 三期备选 |

### 2.2 推荐方案：PWA + 微信小程序双轨

**MVP 阶段（PWA）**：
- 复用 `frontend/` 现有 Vue 3 + Vite 工程加 PWA manifest
- 直接调用 [ScanInput.vue](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/frontend/src/components/common/ScanInput.vue)
- 通过浏览器 `navigator.geolocation` 获取 GPS
- Service Worker 缓存离线场景

**二期（微信小程序）**：
- 用 Taro 4 将核心 3 个场景（扫码确权、积分查询、AI 问答）重写为小程序
- 复用后端 API（`/api/v1/eco-pts/*`、`/api/v1/eco-bot/*`），无需改后端
- 微信扫码能力 + 模板消息推送

---

## 3. 核心功能模块

### 3.1 扫码确权（对应 ECO-06 `ptsAwardPoints`）

```
[扫码] → [识别物料/工位二维码] → [GPS 围栏校验] → [拍照取证] → [提交确权] → [积分到账 toast]
```

**API 调用**：`POST /api/v1/eco-pts/award`
- 请求体：`{ workerId, behavior, evidence, geoFence: { lat, lng } }`
- 响应：`{ awarded, newBalances, fraudBlocked, reason }`

**防刷分机制**（已在 [01_init.lua](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/db/redis/01_init.lua#L56) 实现）：
- Redis Key：`fintrust:ratelimit:scan:{worker_id}:{material_id}` TTL 300 秒
- 5 分钟内同物料不重发积分

### 3.2 积分商城（对应 ECO-06 `ptsListShopItems`、`ptsPlaceOrder`）

```
[积分余额] → [商品列表] → [商品详情] → [确认兑换] → [订单生成] → [发货通知]
```

**API 调用**：
- `GET /api/v1/eco-pts/shop` — 商品列表
- `POST /api/v1/eco-pts/orders` — 下单（body: `{ workerId, itemId }`）

### 3.3 数字分身触达（对应 ECO-09 `botParseCommand`、`botBroadcast`）

```
[广播消息列表] → [详情] → [AI 问答输入框] → [解析命令] → [执行结果]
```

**API 调用**：
- `POST /api/v1/eco-bot/parse` — 解析自然语言指令
- `POST /api/v1/eco-bot/execute` — 执行命令
- `POST /api/v1/eco-bot/broadcast` — 推送广播（管理端用）

### 3.4 融资进度查询（复用 PC 端数据）

```
[企业列表] → [企业详情] → [改造状态] → [资金水位] → [AI 研判建议]
```

**API 调用**：
- `GET /api/v1/enterprises` — 企业列表
- `GET /api/v1/reform/{enterpriseId}/state` — 改造状态

---

## 4. 实施路线图

### 4.1 三阶段规划

| 阶段 | 周期 | 目标 | 关键交付 |
|---|---|---|---|
| **APP-02-a：PWA MVP** | 2-3 周 | 扫码确权 + 积分查询跑通 | PWA manifest + 3 个移动视图 + Service Worker 离线 |
| **APP-02-b：微信小程序** | 4-6 周 | 上架微信，触达一线工人 | Taro 4 工程 + 3 个核心场景 + 模板消息 |
| **APP-02-c：原生增强** | 8-12 周 | 离线作业 + 推送 + 生物识别 | Flutter App + SQLite 同步 + FCM 推送 |

### 4.2 APP-02-a PWA MVP 详细任务

| 任务 | 文件 | 说明 |
|---|---|---|
| PWA manifest | `frontend/public/manifest.json` | 应用名、图标、theme color、start_url |
| Service Worker | `frontend/src/sw.ts` + `vite-plugin-pwa` | 离线缓存策略：API 走 NetworkFirst，静态资源走 CacheFirst |
| 移动布局容器 | `frontend/src/layouts/MobileLayout.vue` | 顶部标题栏 + 底部 Tab Bar（扫码/积分/我的） |
| 扫码确权页 | `frontend/src/views/mobile/ScanConfirmView.vue` | 复用 [ScanInput.vue](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/frontend/src/components/common/ScanInput.vue) + GPS 获取 + 拍照取证 |
| 积分查询页 | `frontend/src/views/mobile/PtsWalletView.vue` | 余额 + 历史明细 + 商品列表 |
| AI 问答页 | `frontend/src/views/mobile/BotChatView.vue` | 复用 ECO-09 API，简化为单输入框 + 对话气泡 |
| 移动路由 | `frontend/src/router/mobile.ts` | `/m/scan`、`/m/pts`、`/m/bot` |
| 响应式断点 | `frontend/src/styles/responsive.scss` | `< 768px` 移动布局，`>= 768px` PC 布局 |
| 移动端检测 | `frontend/src/composables/useDevice.ts` | UA + 屏宽判断，自动重定向 `/m/*` |

### 4.3 APP-02-b 微信小程序任务（概要）

| 任务 | 说明 |
|---|---|
| Taro 4 工程 | `mobile/miniapp/` 独立目录，Taro 4 + React + TypeScript |
| 扫码场景 | `wx.scanCode` + `wx.getLocation` + `wx.chooseImage` |
| 模板消息 | 接入 ECO-09 `botBroadcast` 推送，订阅消息授权 |
| 登录鉴权 | `wx.login` → 后端换 JWT（复用 PC 端 `/api/v1/auth/*`） |
| 上架审核 | 微信小程序后台提交，业务类目"工具-效率" |

---

## 5. 数据契约与后端依赖

### 5.1 复用现有后端端点（零改动）

| 移动场景 | 后端端点 | 状态 |
|---|---|---|
| 扫码确权 | `POST /api/v1/eco-pts/award` | ✅ 已实现 |
| 积分账户 | `GET /api/v1/eco-pts/workers/{workerId}` | ✅ 已实现 |
| 商品列表 | `GET /api/v1/eco-pts/shop` | ✅ 已实现 |
| 下单兑换 | `POST /api/v1/eco-pts/orders` | ✅ 已实现 |
| AI 问答 | `POST /api/v1/eco-bot/parse` + `/execute` | ✅ 已实现 |
| 广播接收 | `GET /api/v1/eco-bot/config/{enterpriseId}` | ✅ 已实现 |
| 企业/融资 | `GET /api/v1/enterprises` + `/api/v1/reform/{id}/state` | ✅ 已实现 |

### 5.2 需新增的后端端点

| 端点 | 用途 | 优先级 |
|---|---|---|
| `POST /api/v1/auth/wx-login` | 微信小程序 code 换 JWT | APP-02-b 必须 |
| `GET /api/v1/eco-pts/orders?workerId=X` | 查询工人历史订单（前端已加 TODO） | APP-02-a 必须 |
| `POST /api/v1/eco-pts/fraud-log` | 防刷分日志查询（前端已加 TODO） | APP-02-b 可选 |

---

## 6. 设计原则（遵循 project_memory "傻瓜式操作"）

1. **不让用户做选择题**：扫码后自动识别物料类型，无需手动选择
2. **只让用户做判断题**：拍照后自动框选，用户只需点"确认"或"重拍"
3. **只让用户做填空题**：仅极少数必填项（如数量），其余自动带出
4. **5 秒法则**：单次确权操作从扫码到提交不超过 5 秒
5. **弱网可用**：Service Worker 缓存物料清单，离线时本地比对，恢复网络后批量上送
6. **误触防护**：积分兑换、提交确权等不可逆操作需二次确认（模态窗）

---

## 7. 风险与缓解

| 风险 | 等级 | 缓解措施 |
|---|---|---|
| PWA 在 iOS Safari 限制（无 Push、缓存策略差异） | 中 | 二期上微信小程序补齐推送 |
| 扫码识别率（强光/污损/小码） | 中 | 加手电筒按钮 + 多帧融合识别 |
| GPS 围栏漂移（室内/地下室） | 高 | 加 WiFi 指纹定位兜底 + 允许人工修正（10m 内） |
| 防刷分绕过（同物料重复扫、代扫） | 高 | Redis 防刷分窗口（已实现）+ 设备指纹 + 异常行为审计 |
| 微信小程序审核被拒 | 低 | 业务类目选"工具-效率"，避免金融敏感词 |

---

## 8. 验收标准

### APP-02-a PWA MVP 验收

- [ ] 手机浏览器访问 `https://<domain>/m/scan` 能扫码识别二维码
- [ ] GPS 自动获取，围栏外提示"超出作业范围"
- [ ] 拍照取证后 5 秒内提交，积分到账 toast 提示
- [ ] 断网状态下能扫码 + 缓存，恢复网络后自动上送
- [ ] 积分查询页显示余额 + 最近 10 条明细
- [ ] AI 问答页能解析"查询融资进度"并返回结果
- [ ] Lighthouse PWA 评分 ≥ 90

---

## 9. 关联文档

- [EXTERNAL_API_CONFIG.md](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/docs/EXTERNAL_API_CONFIG.md) — 后端 API 配置清单
- [COMPLETION_MATRIX.md](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/docs/COMPLETION_MATRIX.md) — UX-03 进度
- [DELIVERY.md](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/docs/DELIVERY.md) — P11-P15 路线图
- [ScanInput.vue](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/frontend/src/components/common/ScanInput.vue) — 现有扫码组件
- [reference/js/eco-pts.js](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/reference/js/eco-pts.js) — 移动端扫码参考实现
