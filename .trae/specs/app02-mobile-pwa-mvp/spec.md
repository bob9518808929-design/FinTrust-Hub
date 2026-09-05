# APP-02 移动端 PWA MVP Spec

> 来源: `production/docs/APP02_MOBILE_PLAN.md` §4.2 APP-02-a PWA MVP 详细任务
> 阶段: 仅覆盖 APP-02-a（PWA MVP，2-3 周交付）；APP-02-b 微信小程序与 APP-02-c Flutter 留作后续 change-id。
> 关联: build-fintech-trust-hub/spec.md `APP-02 企业端门户`（L1741）、`MOD-14 MobileEvidence`（L2411）、`UX-03 移动端扫拍点`、`ECO-06 积分商城`、`ECO-09 数字分身`

---

## Why

APP02_MOBILE_PLAN.md 已规划移动端 3 阶段路线，APP-02-a PWA MVP 是推荐首选交付：复用现有 Vue 3 + Vite 工程，2-3 周内让一线作业人员通过手机浏览器完成"扫码确权 → 积分到账 → AI 问答 → 积分查询"闭环，无需上架、无需下载。当前 `frontend/` 缺失 PWA manifest、Service Worker、移动布局容器、移动路由与移动视图，本 spec 补齐这些缺口并新增必要后端端点。

**v1.1 修订**（经 DeepSeek 评审）：补充 5 项关键缺口 ——
1. **工人极简登录态**：原方案 `workerId` 走查询参数，存在冒名确权漏洞；复用现有 JWT 体系（project_memory 记录 P0 已在 `deps.py` 实现）新增 `worker-login` 端点。
2. **室内定位兜底**：仓库/车间 GPS 信号弱导致大量误报，按 APP02_MOBILE_PLAN.md §7 风险表既定缓解措施改"GPS + WiFi 指纹 + 人工修正 10m 内"三模兜底（BLE 信标需部署硬件，留作 APP-02-b）。
3. **离线图片压缩**：单张 JPEG 2-5MB 易撑爆 IndexedDB，拍照后压缩至 720p / 质量 60%（<200KB），队列总大小上限 50MB。
4. **确权证据上链**：主 spec MOD-14 要求"责任链节点哈希上链存证"（L1554），但原方案移动端确权未调 MOD-08，形成数据断链；后端 `award` 处理成功后追加 MOD-08 stamp 调用，前端零感知。
5. **语音播报反馈**：车间嘈杂环境工人可能错过 toast，集成 Web Speech API 语音播报"积分到账 +X"。

## What Changes

- **新增** PWA manifest + Service Worker（`vite-plugin-pwa`）：离线缓存策略（API NetworkFirst / 静态资源 CacheFirst），支持"弱网可用"；离线队列存储压缩后图片（720p / 质量 60% / <200KB），队列总大小上限 50MB。
- **新增** 移动布局容器 [MobileLayout.vue](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/frontend/src/layouts/MobileLayout.vue)：顶部标题栏 + 底部 Tab Bar（扫码 / 积分 / 我的）。
- **新增** 3 个移动视图：
  - [ScanConfirmView.vue](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/frontend/src/views/mobile/ScanConfirmView.vue) — 复用 [ScanInput.vue](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/frontend/src/components/common/ScanInput.vue) + 三模定位兜底（GPS / WiFi 指纹 / 人工修正 10m） + 拍照取证 + 图片压缩 + 提交确权 + 积分到账 toast + 语音播报
  - [PtsWalletView.vue](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/frontend/src/views/mobile/PtsWalletView.vue) — 积分余额 + 最近 10 条明细 + 商品列表
  - [BotChatView.vue](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/frontend/src/views/mobile/BotChatView.vue) — 单输入框 + 对话气泡，复用 ECO-09 `botParseCommand` / `botExecute`
- **新增** 移动路由 `frontend/src/router/mobile.ts`：`/m/scan`、`/m/pts`、`/m/bot`，挂载到 [router/index.ts](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/frontend/src/router/index.ts) 作为子路由组。
- **新增** 响应式断点 [responsive.scss](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/frontend/src/styles/responsive.scss)（`<768px` 移动布局 / `>=768px` PC 布局）与设备检测 [useDevice.ts](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/frontend/src/composables/useDevice.ts)（UA + 屏宽判断，移动端访问根路径 `/` 自动重定向 `/m/scan`）。
- **新增** 工人极简登录态：[useWorkerAuth.ts](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/frontend/src/composables/useWorkerAuth.ts) composable（预防性命名，避免与未来 PC 端老板登录的 useAuth 冲突）+ 路由守卫拦截未登录访问 `/m/*`；后端新增端点 `POST /api/v1/auth/worker-login`（企业码 + 工号，无密码，7 天短期 JWT，复用现有 JWT 签发/校验逻辑；需要数据迁移补 `enterprises.enterprise_code` 与 `worker_accounts.worker_no` 字段，详见 Impact）；新增 `WORKER_AUTH_BYPASS` 开发降级开关。
- **新增** 后端端点 `GET /api/v1/eco-pts/orders?workerId=X` — 查询工人历史订单（APP02_MOBILE_PLAN.md §5.2 标注"APP-02-a 必须"，前端 `eco.ts` 已留 TODO）。
- **修改** 后端 `POST /api/v1/eco-pts/award`：积分入账后通过 FastAPI `BackgroundTasks` 异步触发 `stamp_award_evidence`，将 `{workerId, materialId, timestamp, photoHash, location_value}` 的 SHA256 哈希通过 MOD-08 上链；接口立即返回 `chainTxHash: null` 不等待链上回执（接口 < 200ms）；`evidence`/`location` 字段为 Optional，PC 端（APP-03 运营台）调用未传时自动跳过上链（向后兼容），仅当请求头 `User-Agent: MobilePWA/*` 或 body `fromMobile: true` 且证据完整时才走证据采集+上链逻辑；失败不阻塞积分入账（异步执行，主流程已结束）+ 写 `stamp_retry_queue` 表由 APScheduler 每 10 分钟重试 3 次后放弃；**不引入 Celery/RQ**（遵循 project_memory 最小化原则）。
- **不包含**：微信小程序（APP-02-b）、Flutter 原生（APP-02-c）、`POST /api/v1/auth/wx-login`（属 APP-02-b）、`POST /api/v1/eco-pts/fraud-log`（属 APP-02-b 可选）、BLE 信标定位（需部署硬件，属 APP-02-b）、愿望清单/车间排行榜/企业定制商城/异常模式检测（P2 演进，违反 MVP 最小化原则）。

## Impact

- **Affected specs**: build-fintech-trust-hub `APP-02 企业端门户`、`MOD-08 区块链存证与司法取证`（L1077）、`MOD-14 MobileEvidence`（L2411）、`UX-03 移动端扫拍点极简确权`、`ECO-06 积分商城`、`ECO-09 数字分身`。
- **Affected code**:
  - 前端新增：`frontend/public/manifest.json`、`frontend/src/sw.ts`、`frontend/src/layouts/MobileLayout.vue`、`frontend/src/views/mobile/{ScanConfirmView,PtsWalletView,BotChatView}.vue`、`frontend/src/views/mobile/LoginView.vue`、`frontend/src/router/mobile.ts`、`frontend/src/styles/responsive.scss`、`frontend/src/composables/useDevice.ts`、`frontend/src/composables/useWorkerAuth.ts`（预防性命名，避免与未来 PC 端老板登录的 useAuth 冲突）、`frontend/src/utils/imageCompress.ts`（拍照压缩）
  - 前端修改：`frontend/vite.config.ts`（注入 vite-plugin-pwa）、`frontend/src/router/index.ts`（挂载 mobile 路由组 + 移动端重定向守卫 + 未登录拦截）、`frontend/src/main.ts`（注册 SW）、`frontend/src/api/eco.ts`（移除 orders TODO，调用新端点；award 请求带 Authorization header）、`frontend/src/api/client.ts`（请求拦截器自动注入 workerToken）
  - 后端新增：`backend/app/api/routers/auth.py` 增加 `POST /auth/worker-login`；`backend/app/api/routers/eco.py` 增加 `GET /eco-pts/orders`（workerId 查询参数）
  - 后端修改：`backend/app/api/routers/eco.py` 的 `POST /eco-pts/award` 处理函数（积分入账后通过 FastAPI `BackgroundTasks` 异步触发 `stamp_award_evidence`，接口立即返回不等待链上回执）；`backend/app/services/eco_service.py` 新增 `list_worker_orders` + `stamp_award_evidence` 方法
  - 后端测试：`backend/tests/` 增加 `test_eco_pts_orders.py`、`test_auth_worker_login.py`、`test_eco_pts_award_stamps_chain.py`
  - 后端迁移：`backend/app/migrations/worker_auth_tables.sql` 新增 `enterprises.enterprise_code VARCHAR(8) UNIQUE NOT NULL` 与 `worker_accounts.worker_no VARCHAR(20) UNIQUE NOT NULL` 字段（核查确认现有 [enterprise.py](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/app/models/enterprise.py) 与 [eco.py](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/app/models/eco.py) 的 WorkerAccountORM 均未含此二字段，必须迁移否则 worker-login 上线即 500）
  - 文档更新：APP02_MOBILE_PLAN.md §5.1 表格将 orders 行从"需新增"改为"已实现"；§5.2 新增 worker-login 行

## ADDED Requirements

### Requirement: PWA Manifest 与 Service Worker

APP-02-a SHALL 提供可安装的 PWA：访问 `/m/*` 时浏览器提示"添加到主屏幕"，离线状态下仍能扫码 + 缓存物料清单，恢复网络后自动上送。

#### Scenario: PWA 可安装性
- **WHEN** 用户在手机浏览器（Chrome / Edge / Safari）访问 `https://<domain>/m/scan`
- **THEN** 浏览器地址栏或菜单显示"添加到主屏幕"提示
- **AND** 安装后图标出现在主屏幕，启动无浏览器壳

#### Scenario: Service Worker 离线缓存策略
- **WHEN** 网络在线时访问 `/m/scan`
- **THEN** Service Worker 对 `/api/v1/eco-pts/shop`、`/api/v1/eco-pts/workers/*` 走 NetworkFirst（网络优先，失败回退缓存）
- **AND** 对 `/assets/*`、`/manifest.json` 走 CacheFirst（缓存优先）
- **AND** Lighthouse PWA 评分 ≥ 90

#### Scenario: 弱网扫码暂存与自动上送
- **WHEN** 工人在断网状态下完成扫码 + 拍照取证
- **THEN** 拍照图片先经 `imageCompress.ts` 压缩至 720p / JPEG 质量 60%（单张 < 200KB），再转 **Base64 字符串**（避免 IndexedDB 直接存 Blob/ArrayBuffer 的兼容性问题）
- **AND** 确权请求存入 IndexedDB 队列（key: `pending-awards`，schema: `{ id, workerId, materialId, photoBase64, location, timestamp }`），队列总大小上限 50MB
- **AND** 页面顶部显示"待上传 N 条"横幅
- **WHEN** 网络恢复且 ScanConfirmView 处于激活状态
- **THEN** **ScanConfirmView 组件内**（非 Service Worker）从 IndexedDB 取出 Base64 字符串，转换为 Blob 后构造 `FormData`，逐条调用 `POST /eco-pts/award` 上送
- **AND** 每条成功后从 IndexedDB 删除 + toast"积分到账 +X" + 语音播报
- **WHEN** ScanConfirmView 不激活但网络恢复
- **THEN** Service Worker 的 Background Sync 仅作为兜底唤醒机制触发组件重渲染，不直接构造 multipart（避免 SW 内拼接二进制的复杂性）
- **WHEN** 队列总大小达到 50MB 上限
- **THEN** 扫码页禁用拍照按钮 + toast"存储空间不足，请联网同步后继续操作"，避免 IndexedDB 撑爆

### Requirement: 移动布局容器 MobileLayout

APP-02-a SHALL 提供统一的移动布局：顶部标题栏（动态显示当前页标题 + 返回按钮）+ 底部 Tab Bar（3 个固定入口：扫码 / 积分 / 我的）。

#### Scenario: 底部 Tab Bar 切换
- **WHEN** 工人在 `/m/scan` 点击底部"积分"Tab
- **THEN** 路由跳转到 `/m/pts`，"积分"Tab 高亮
- **AND** 顶部标题栏文案变更为"积分钱包"

#### Scenario: 拇指热区硬约束（遵循 project_memory + spec.md L2736）
- **WHEN** 渲染底部 Tab Bar
- **THEN** Tab Bar 高度 ≥ 48px，每个 Tab 可点击区域 ≥ 48×48px
- **AND** 主操作按钮（如"提交确权"）位于屏幕底部 1/3 区域内，单手拇指可达

### Requirement: 扫码确权页 ScanConfirmView

APP-02-a SHALL 提供"扫码 → 三模定位 → 拍照 → 提交"四步无键盘确权，单次操作 ≤ 5 秒，复用现有 [ScanInput.vue](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/frontend/src/components/common/ScanInput.vue) 与 `POST /api/v1/eco-pts/award` 端点。定位遵循 APP02_MOBILE_PLAN.md §7 风险表既定缓解措施：GPS 主路径 + WiFi 指纹兜底 + 人工修正 10m 内，避免室内 GPS 失效导致大量误报。

#### Scenario: 扫码确权主流程
- **WHEN** 工人在 `/m/scan` 进入页面
- **THEN** 摄像头自动开启（无文字输入框）
- **WHEN** 工人扫描物料二维码
- **THEN** 自动识别物料 ID 并显示物料名 + 工位
- **AND** 自动启动定位采集：优先 `navigator.geolocation` 取 GPS 坐标，5 秒内未返回或 accuracy > 50m 时回退到 WiFi 指纹（`navigator.connection` 或 BSSID 哈希）
- **AND** 围栏校验：若定位点距工位预置围栏中心 > 半径，提示"超出作业范围"并禁用提交
- **WHEN** GPS 与 WiFi 指纹均不可用或漂移 > 10m
- **THEN** 显示"定位不准，请手工修正"按钮，点击后弹出地图选点（默认中心为工位围栏中心，允许拖动 10m 内）
- **WHEN** 工人拍照取证
- **THEN** 拍照后立即压缩至 720p / 质量 60%（<200KB）再展示预览缩略图 + "确认" / "重拍"两个按钮
- **WHEN** 工人点击"确认"
- **THEN** 调用 `POST /api/v1/eco-pts/award`，body: `{ workerId, behavior: 'scan-confirm', evidence: { photoHash, materialId, photoBase64 }, location: { type: 'gps'|'wifi'|'manual', value }, fromMobile: true }`，请求头带 `Authorization: Bearer {workerToken}` + `User-Agent: MobilePWA/<version>`（双重标识移动端来源，便于后端判断是否走证据采集+上链）
- **AND** 5 秒内返回 toast"积分到账 +X"（非阻塞，z-index=9500，含 × 关闭按钮，6.5s 自动消失，遵循 project_memory）
- **AND** 同时触发语音播报"积分到账 X 分"（Web Speech API，中文，rate=1.2），车间嘈杂环境听声即知
- **AND** 接口立即返回（`chainTxHash: null`），上链由后端 `BackgroundTasks` 异步完成（详见"确权证据上链存证" Requirement）

#### Scenario: 防刷分窗口提示
- **WHEN** 工人 5 分钟内对同一物料重复扫码
- **THEN** 后端返回 `{ fraudBlocked: true, reason: "rate-limit" }`
- **AND** 前端显示 toast"该物料 5 分钟内已确权，请勿重复操作"（非阻塞）+ 语音播报"请勿重复操作"

#### Scenario: 误触防护
- **WHEN** 工人点击"确认提交"
- **THEN** 弹出阻塞模态窗（z-index=10000）二次确认"提交此次确权？"
- **AND** 模态窗含"确认提交" / "取消"两个按钮，遵循 project_memory"不可逆决策保持阻塞模态窗"

#### Scenario: 语音播报降级
- **WHEN** 浏览器不支持 Web Speech API（`'speechSynthesis' in window === false`）或用户关闭语音开关
- **THEN** 跳过语音播报，仅保留 toast 通知
- **AND** 不报错、不阻塞主流程（遵循 project_memory 降级原则）

### Requirement: 积分钱包页 PtsWalletView

APP-02-a SHALL 提供积分余额 + 最近 10 条明细 + 商品列表，复用 `GET /api/v1/eco-pts/workers/{workerId}` 与 `GET /api/v1/eco-pts/shop`。

#### Scenario: 余额与明细展示
- **WHEN** 工人进入 `/m/pts`
- **THEN** 顶部显示当前积分余额（大字号 + 颜色高亮）
- **AND** 下方显示最近 10 条明细（时间 / 行为 / ±积分 / 来源）
- **AND** 底部显示商品列表（图标 / 名称 / 所需积分 / "兑换"按钮）

#### Scenario: 积分兑换与误触防护
- **WHEN** 工人点击某商品的"兑换"按钮
- **THEN** 弹出阻塞模态窗二次确认"使用 X 积分兑换《商品名》？"
- **WHEN** 工人确认
- **THEN** 调用 `POST /api/v1/eco-pts/orders`，body: `{ workerId, itemId }`
- **AND** 成功 toast"兑换成功，待发货"；失败 toast"积分不足"或"商品已下架"

### Requirement: AI 问答页 BotChatView

APP-02-a SHALL 提供单输入框 + 对话气泡的 AI 问答，复用 ECO-09 `POST /api/v1/eco-bot/parse` + `POST /api/v1/eco-bot/execute`。

#### Scenario: 自然语言问答
- **WHEN** 工人在 `/m/bot` 输入框输入"查询融资进度"并点击发送
- **THEN** 调用 `POST /api/v1/eco-bot/parse`，返回 intent + entities
- **AND** 自动调用 `POST /api/v1/eco-bot/execute`，渲染执行结果为对话气泡
- **AND** 用户气泡靠右（蓝色），AI 气泡靠左（灰色）

#### Scenario: 解析失败兜底
- **WHEN** 后端 `parse` 返回 confidence < 0.5 或 LLM 降级（参考 project_memory DeepSeek 集成）
- **THEN** AI 气泡显示"未理解您的意思，请尝试：查询融资进度 / 我的积分 / 兑换商品"
- **AND** 提供 3 个快捷短语按钮，点击即填入输入框

### Requirement: 移动端路由与设备重定向

APP-02-a SHALL 提供 `/m/scan`、`/m/pts`、`/m/bot` 三个移动路由，并在移动端访问根路径 `/` 时自动重定向到 `/m/scan`。

#### Scenario: 移动端自动重定向
- **WHEN** UA 含 `Mobile|Android|iPhone` 或屏宽 `<768px` 的设备访问 `/`
- **THEN** 路由守卫 `beforeEach` 重定向到 `/m/scan`
- **AND** 不影响 PC 端用户访问 `/`

#### Scenario: PC 端访问移动路由
- **WHEN** PC 端用户手动访问 `/m/scan`
- **THEN** 重定向到对应 PC 路由 `/`（避免移动视图在桌面端错位渲染）

### Requirement: 后端工人订单查询端点

APP-02-a SHALL 新增 `GET /api/v1/eco-pts/orders?workerId=X` 端点，返回工人历史订单列表，供 PtsWalletView 展示。

#### Scenario: 查询工人历史订单
- **WHEN** 前端调用 `GET /api/v1/eco-pts/orders?workerId=W001`
- **THEN** 返回该工人的订单列表（订单 ID / 商品名 / 消耗积分 / 状态：待发货/已发货/已签收 / 下单时间）
- **AND** 按 `createdAt DESC` 排序，默认返回最近 20 条
- **AND** 支持分页参数 `?page=1&pageSize=20`

#### Scenario: 未传 workerId 参数
- **WHEN** 前端调用 `GET /api/v1/eco-pts/orders`（无 workerId）
- **THEN** 返回 422 + `{ detail: "workerId is required" }`

### Requirement: 工人极简登录态

APP-02-a SHALL 提供工人极简登录态：无密码（依赖企业码 + 工号组合，适合工厂场景），复用现有 JWT 签发/校验逻辑（project_memory 记录 P0 已在 [deps.py](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/app/api/deps.py) 实现），签发 7 天短期 JWT，避免 `workerId` 走查询参数导致的冒名确权漏洞。**数据基础**：现有 [enterprise.py](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/app/models/enterprise.py) 的 Enterprise 表与 [eco.py](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/app/models/eco.py) 的 WorkerAccountORM 表均缺少 `enterprise_code` / `worker_no` 字段，必须通过迁移脚本补齐。

#### Scenario: 工人首次登录
- **WHEN** 工人首次打开 PWA 访问 `/m/scan`，路由守卫检测 `localStorage.workerToken` 不存在
- **THEN** 重定向到 `/m/login`，显示极简登录表单：企业码（6 位） + 工号 + "扫码登录"按钮（可选扫企业二维码自动填充）
- **WHEN** 工人提交企业码 + 工号
- **THEN** 调用 `POST /api/v1/auth/worker-login`，body: `{ enterpriseCode, workerNo }`
- **AND** 后端查 `enterprises.enterprise_code == X` 得 `enterpriseId`，再查 `worker_accounts.worker_no == Y AND enterprise_id == enterpriseId`，命中即签发 7 天 JWT，含 `sub: workerId, role: 'worker', enterpriseId`
- **AND** 前端将 token 存入 `localStorage.workerToken`，跳转回 `/m/scan`

#### Scenario: 请求自动携带 token
- **WHEN** 工人在 `/m/scan`、`/m/pts`、`/m/bot` 发起任何 `/api/v1/eco-pts/*` 或 `/api/v1/eco-bot/*` 请求
- **THEN** [api/client.ts](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/frontend/src/api/client.ts) 请求拦截器自动注入 `Authorization: Bearer {workerToken}`
- **AND** 后端 [deps.py](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/app/api/deps.py) 的 `get_current_user` 解析 token，取 `sub` 作为 workerId（开发环境降级到 dev-admin，遵循 project_memory）

#### Scenario: 开发环境登录绕过
- **WHEN** 后端 `.env` 含 `WORKER_AUTH_BYPASS=true`（仅开发环境）
- **THEN** 后端 `worker-login` 端点跳过数据库校验，直接签发 mock JWT（`sub: W001, role: 'worker', enterpriseId: E001`）返回 200
- **AND** 前端 `.env.development` 含 `VITE_WORKER_AUTH_BYPASS=true` 时，访问 `/m/scan` 自动注入 mock token 并跳过登录页
- **AND** 生产环境强制关闭此开关（`APP_ENV=production` 时后端忽略此 env，前端构建时移除分支）

#### Scenario: token 过期与刷新
- **WHEN** JWT 已过期（>7 天）或被服务端拒绝（401）
- **THEN** 前端捕获 401，清空 `localStorage.workerToken`，重定向到 `/m/login`
- **AND** 显示 toast"登录已过期，请重新登录"（非阻塞）

#### Scenario: 企业码或工号错误
- **WHEN** 工人提交的企业码不存在或工号不匹配
- **THEN** 后端返回 401 + `{ detail: "企业码或工号错误" }`
- **AND** 前端 toast"企业码或工号错误，请重试"，输入框保留工号、清空企业码

### Requirement: 确权证据上链存证

APP-02-a SHALL 在移动端扫码确权积分入账后，将证据哈希通过 MOD-08 区块链存证模块**异步**上链，满足主 spec MOD-14"责任链节点哈希上链存证"要求（L1554）。**关键设计**：上链通过 FastAPI `BackgroundTasks` 异步执行，`/eco-pts/award` 接口立即返回（含 `chainTxHash: null`），不等待链上回执，避免接口响应从 200ms 恶化到 1.5s。**PC 端兼容**：`evidence` 与 `location` 字段为 Optional，PC 端（APP-03 运营台）调用时未传则跳过上链。

#### Scenario: 移动端确权异步上链
- **WHEN** `POST /api/v1/eco-pts/award` 收到请求且请求头 `User-Agent` 含 `MobilePWA` 或 body `fromMobile: true`
- **THEN** 主流程同步执行积分入账（fraudBlocked 检查 + 写 worker_accounts.balances）
- **AND** 通过 FastAPI `BackgroundTasks.add_task(stamp_award_evidence, award_record)` 调度异步上链
- **AND** 接口立即返回 200 + `{ awarded, newBalances, fraudBlocked, chainTxHash: null }`
- **WHEN** BackgroundTasks 在请求结束后执行 `stamp_award_evidence`
- **THEN** 计算 `evidence_hash = SHA256(workerId + materialId + timestamp + photoHash + location_value)`
- **AND** 调用 MOD-08 `blockchain_client.stamp(evidence_hash, timestamp)`
- **AND** 链上返回的 `tx_hash` 异步回填到 award 记录的 `chainTxHash` 字段（前端下次拉取订单/明细时可见）

#### Scenario: PC 端调用兼容性
- **WHEN** PC 端（APP-03 运营台）调用 `POST /api/v1/eco-pts/award` 补录积分，body 缺失 `evidence` 或 `location`，且 `User-Agent` 不含 `MobilePWA`
- **THEN** 后端跳过 `stamp_award_evidence` 调度，仅记录 `chainTxHash: null`
- **AND** 不报错、不阻塞积分入账
- **AND** 后端 logger.info 记录"PC-side award skipped stamp: award_id=..."
- **WHEN** PC 端误传 evidence 但无 location
- **THEN** 仍跳过上链（缺任一字段即视为 PC 端补录，不强制走证据链）

#### Scenario: 上链失败降级与重试
- **WHEN** `stamp_award_evidence` 内部 MOD-08 调用抛异常（链节点不可达、超时、签名错误）
- **THEN** 捕获异常 + `logger.warning("blockchain stamp failed: award_id=... reason=...")` + award 记录 `chainTxHash` 留空
- **AND** 不影响已返回给前端的 200 响应（异步执行，主流程已结束）
- **AND** 失败记录写入 `stamp_retry_queue` 表（字段 `id/award_id/evidence_hash/retry_count/next_retry_at/status`），后台定时任务每 10 分钟扫描 `status='pending' AND retry_count < 3` 重试，3 次失败后 `status='abandoned'`（实现机制：FastAPI lifespan 启动 asyncio 后台任务 + APScheduler，**不引入 Celery/RQ**，避免 MVP 引入消息中间件依赖）

#### Scenario: 证据可验证
- **WHEN** 法院出具《调查令》或管理员调取证据
- **THEN** 通过 award 记录的 `chainTxHash` 在链上查询存证哈希
- **AND** 重新计算 `SHA256(workerId + materialId + timestamp + photoHash + location_value)` 与链上对比，一致则判定证据未被篡改
- **AND** 若 `chainTxHash` 为 null（PC 端补录或上链失败后未补），返回"证据未上链，仅为内部积分记录"提示

## MODIFIED Requirements

### Requirement: APP-02 企业端门户（build-fintech-trust-hub spec.md L1741）

原 spec 中 APP-02 仅定义 PC 端企业老板门户。本次修改在 APP-02 能力下**新增移动端 PWA 入口**，承担"一线作业人员行为挖矿"角色（扫码确权 + 积分兑换 + AI 问答），与 PC 端企业老板门户共享后端 API（`/api/v1/eco-pts/*`、`/api/v1/eco-bot/*`）。复用现有后端服务（JWT 在 [deps.py](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/app/api/deps.py) / MOD-08 区块链存证 / ECO-06 积分商城 / ECO-09 数字分身），仅新增 2 个轻量端点（`POST /auth/worker-login`、`GET /eco-pts/orders`）+ 1 处 MOD-08 stamp 集成，不引入新的后端服务。

## REMOVED Requirements

无。
