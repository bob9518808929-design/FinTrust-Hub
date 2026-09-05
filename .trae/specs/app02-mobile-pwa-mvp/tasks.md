# Tasks — APP-02 移动端 PWA MVP

> 范围: APP02_MOBILE_PLAN.md §4.2 APP-02-a（MVP，2-3 周）
> v1.1 修订（DeepSeek 评审）：新增 Task 10（工人极简登录态）、Task 11（确权证据上链存证），Task 1/3/6 调整
> v1.2 修订（总架构师金版定稿补丁）：①数据迁移脚本明确 ②上链改 BackgroundTasks 异步 + PC 端兼容 ③离线队列存 Base64 + ScanConfirmView 负责上送 ④WORKER_AUTH_BYPASS 开发降级 ⑤useAuth → useWorkerAuth
> 依赖关系: Task 1/10（基础设施+登录态）→ Task 2/3/4/5/11 → Task 6/7 → Task 8 → Task 12（验收）

---

## Task 1: PWA 基础设施（manifest + Service Worker + vite-plugin-pwa）

- [ ] **1.1** 安装依赖：在 `frontend/` 执行 `pnpm add -D vite-plugin-pwa workbox-window`（workbox-window 用于 SW 注册）
- [ ] **1.2** 创建 [frontend/public/manifest.json](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/frontend/public/manifest.json)：name="FinTrust Hub 移动端"、short_name="FinTrust M"、start_url="/m/scan"、scope="/"、display="standalone"、theme_color="#0ea5e9"、background_color="#ffffff"、icons（192/512 PNG，先用占位图，图标文件放 `frontend/public/icons/`）
- [ ] **1.3** 修改 [frontend/vite.config.ts](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/frontend/vite.config.ts)：import `VitePWA` from 'vite-plugin-pwa'，注入到 `plugins` 数组
  - 配置 `strategies: 'injectManifest'`、`srcDir: 'src'`、`filename: 'sw.ts'`、`registerType: 'prompt'`
  - `injectManifest` 内 `globPatterns: ['**/*.{js,css,html,svg,png,woff2}']`
  - `runtimeCaching`：API（`/api/v1/eco-pts/shop`、`/api/v1/eco-pts/workers/*`）走 `NetworkFirst`，`/assets/*` 走 `CacheFirst`
- [ ] **1.4** 创建 [frontend/src/sw.ts](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/frontend/src/sw.ts)：使用 workbox 的 `precacheAndRoute`、`registerRoute`、`NetworkFirst`、`CacheFirst`，配置 Background Sync plugin（queue name: `pending-awards-queue`，maxRetentionTime: 60 分钟）
- [ ] **1.5** 修改 [frontend/src/main.ts](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/frontend/src/main.ts)：在 app.mount 前调用 `import('virtual:pwa-register')` 注册 SW，开发环境打开 `console.log` 提示 SW 状态
- [ ] **1.6** 创建 [frontend/src/utils/imageCompress.ts](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/frontend/src/utils/imageCompress.ts)：`compressImage(file: File): Promise<{ blob: Blob, base64: string }>` 使用 Canvas 重绘至 720p（最长边 720px）+ `toBlob('image/jpeg', 0.6)` 输出 < 200KB Blob，同时 `FileReader.readAsDataURL` 转出 Base64 字符串；输入非图片或压缩失败时返回原文件 + 空 base64 并 `console.warn`
- [ ] **1.7** 在 [frontend/src/utils/indexedDbQueue.ts](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/frontend/src/utils/indexedDbQueue.ts)（新建）封装 `pending-awards` 队列：`push(item)`、`getAll()`、`remove(id)`、`totalSize()`；**item schema 仅含 Base64 字符串与元数据**（`{ id, workerId, materialId, photoBase64, location, timestamp }`），不直接存 Blob/ArrayBuffer（避免 IndexedDB 二进制兼容性问题）；`push` 前检查 `totalSize() + newItemSize > 50 * 1024 * 1024` 则抛 `QueueFullError`，调用方据此禁用拍照按钮 + toast"存储空间不足，请联网同步后继续操作"
- [ ] **1.8** 创建 [frontend/src/composables/usePendingSync.ts](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/frontend/src/composables/usePendingSync.ts)：`flushPending()` 从 IndexedDB `getAll()` 取出条目，对每条 `Base64 → Blob`（`fetch(base64).then(r => r.blob())` 或 `Uint8Array` 转换）+ 构造 `FormData` + 调用 `ptsAwardPoints`，成功后 `remove(id)`；监听 `online` 事件自动触发 flush；ScanConfirmView 在 `onActivated` 时也调用一次（KeepAlive 唤醒场景）

**验证**: `pnpm build` 成功生成 `dist/sw.js` + `dist/manifest.json`；`pnpm dev` 后访问 `/m/scan` DevTools → Application → Service Workers 显示"activated"；`imageCompress` 单元测试：输入 5MB JPEG 输出 blob < 200KB + base64 非空；模拟队列累计 > 50MB 时 `push` 抛 `QueueFullError`；离线扫码入队 + 模拟 `online` 事件后 `usePendingSync.flushPending` 自动上送所有条目

---

## Task 2: 移动布局容器 MobileLayout.vue

- [ ] **2.1** 创建目录 `frontend/src/layouts/`（当前不存在）
- [ ] **2.2** 创建 [frontend/src/layouts/MobileLayout.vue](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/frontend/src/layouts/MobileLayout.vue)：SFC 结构
  - 顶部标题栏 `<header class="m-header">`：左侧返回按钮（路由历史回退，根路径隐藏）、中间动态标题（从路由 meta.title 取）、右侧留空
  - 中部 `<main class="m-main">`：`<router-view />`
  - 底部 Tab Bar `<nav class="m-tabbar">`：3 个 Tab（扫码 `/m/scan` / 积分 `/m/pts` / 我的 `/m/bot`），使用 `router-link` 高亮当前
- [ ] **2.3** 在 [frontend/src/styles/responsive.scss](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/frontend/src/styles/responsive.scss)（新建，见 Task 5）中定义 `.m-header`、`.m-main`、`.m-tabbar` 的样式：Tab Bar 高度 ≥ 48px、Tab 可点击区域 ≥ 48×48px（遵循 project_memory 拇指热区）
- [ ] **2.4** 在 MobileLayout 中渲染 `<router-view v-slot="{ Component }">` + `<KeepAlive>` 缓存扫码页（避免重复初始化摄像头）

**验证**: 手动在浏览器开启移动模拟器访问 `/m/scan`，底部 Tab Bar 显示 3 个入口，点击切换路由

---

## Task 3: 扫码确权页 ScanConfirmView.vue

- [ ] **3.1** 创建目录 `frontend/src/views/mobile/`
- [ ] **3.2** 创建 [frontend/src/views/mobile/ScanConfirmView.vue](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/frontend/src/views/mobile/ScanConfirmView.vue)：4 步状态机 `step: 'scan' | 'photo' | 'confirm' | 'done'`
- [ ] **3.3** 复用 [ScanInput.vue](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/frontend/src/components/common/ScanInput.vue)：传入 `@scan` 事件回调，识别后自动切换到 `step='photo'`，**不提供文字输入框**（遵循 spec.md L2734 不输入也能交）
- [ ] **3.4** 三模定位兜底（遵循 APP02_MOBILE_PLAN.md §7 风险表既定缓解措施）：
  - 主路径：`navigator.geolocation.getCurrentPosition` 取 GPS 坐标，5 秒超时；返回 `accuracy > 50m` 视为不可用
  - 兜底 1：GPS 失败时取 WiFi 指纹（`navigator.connection` 信息或 BSSID 哈希，受浏览器能力限制，仅做尽力而为采集）
  - 兜底 2：GPS + WiFi 均不可用或围栏漂移 > 10m 时显示"定位不准，请手工修正"按钮，点击弹出地图选点（默认中心为工位围栏中心，允许拖动 10m 内）
  - 围栏校验：定位点距工位预置围栏中心 > 半径则 toast"超出作业范围"并禁用提交按钮
  - 围栏配置：MVP 阶段硬编码示例围栏 `lat/lng/radius`，TODO 后续从 `GET /api/v1/eco-pts/workers/{workerId}/geofence` 拉取
- [ ] **3.5** 拍照取证 + 压缩：使用 `<input type="file" accept="image/*" capture="environment">` 调用相机，选完调用 Task 1.6 的 `compressImage(file)` 压缩至 < 200KB，再展示预览缩略图 + "确认" / "重拍"按钮（遵循 spec.md L2736 拇指热区，按钮位于屏幕底部 1/3）
- [ ] **3.6** 提交确权：点击"确认"先弹阻塞模态窗（z-index=10000）二次确认，确认后调用 [frontend/src/api/eco.ts](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/frontend/src/api/eco.ts) 的 `ptsAwardPoints({ workerId, behavior: 'scan-confirm', evidence: { photoHash: sha256(compressedBlob), materialId, photoBase64 }, location: { type: 'gps'|'wifi'|'manual', value }, fromMobile: true })`，请求头自动带 `Authorization: Bearer {workerToken}`（由 Task 10 的 useWorkerAuth + client.ts 拦截器注入）+ `User-Agent: MobilePWA/<version>`（标识移动端来源，后端据此判断走证据采集+上链）
- [ ] **3.7** 响应处理：成功 → 非阻塞 toast"积分到账 +{awarded}"（z-index=9500，含 × 关闭按钮，6.5s 自动消失，遵循 project_memory AI 通知 toast 规范）+ 调用 `useSpeech` 暴露的 `speak(`积分到账 ${awarded} 分`)` 语音播报；`fraudBlocked=true` → toast"该物料 5 分钟内已确权，请勿重复操作" + `speak("请勿重复操作")`；网络失败 → 调用 Task 1.7 的 `indexedDbQueue.push` 入队（仅存 Base64）+ 顶部横幅"待上传 N 条"；队列满（QueueFullError）→ toast"存储空间不足，请联网同步后继续操作"
- [ ] **3.8** 离线恢复上送：在 ScanConfirmView 的 `onActivated` 钩子调用 Task 1.8 的 `usePendingSync.flushPending()`，由组件上下文（非 SW）负责 Base64 → Blob → FormData → 调 `ptsAwardPoints` 上送；监听 `window.online` 事件也触发 flush；每条成功后 toast"积分到账 +X" + `speak`；语音播报降级（同 v1.1）：`useSpeech.ts` 内 `speechSupported = 'speechSynthesis' in window`；`speak(text)` 内部检查全局开关 + `speechSupported`，任一为 false 直接 return；ScanConfirmView 模板内 `<button v-if="speechSupported" @click="toggleVoice">` 允许工人关闭语音；浏览器不支持时跳过且不报错（遵循 project_memory 降级原则）

**验证**: 在 Chrome DevTools 移动模拟器中扫码（可用在线二维码生成器生成测试码）→ 拍照 → 确认 → 看到 toast + 听到语音"积分到账 X 分"；重复扫码 5 分钟内第二次看到防刷分 toast + 听到"请勿重复操作"；断网扫码入队后恢复网络 → DevTools Network 看 ScanConfirmView 主动发起的 multipart 上送；在 DevTools 关闭麦克风/Speech API 后流程不报错，仅 toast

---

## Task 4: 积分钱包页 PtsWalletView.vue

- [ ] **4.1** 创建 [frontend/src/views/mobile/PtsWalletView.vue](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/frontend/src/views/mobile/PtsWalletView.vue)
- [ ] **4.2** 余额区：`onMounted` 调用 [eco.ts](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/frontend/src/api/eco.ts) `ptsGetWorker(workerId)`，取 `balances.total`，大字号显示
- [ ] **4.3** 明细区：调用新增的 `ptsListOrders(workerId)`（Task 7）取最近 10 条，渲染为时间 / 行为 / ±积分 / 来源 4 列列表
- [ ] **4.4** 商品列表区：调用 `ptsListShopItems()` 取 `[{ itemId, name, iconUrl, cost }]`，网格 2 列布局，每个商品显示图标 + 名称 + 所需积分 + "兑换"按钮
- [ ] **4.5** 兑换交互：点击"兑换"弹阻塞模态窗（z-index=10000）二次确认"使用 X 积分兑换《商品名》？"，确认后调用 `ptsPlaceOrder({ workerId, itemId })`，成功 toast"兑换成功，待发货"，失败 toast"积分不足"或"商品已下架"；重复点击 toast"无需重复操作"（遵循 project_memory）

**验证**: 进入 `/m/pts` 显示余额 + 明细 + 商品；点击兑换走完整流程；余额不足看到对应 toast

---

## Task 5: AI 问答页 BotChatView.vue

- [ ] **5.1** 创建 [frontend/src/views/mobile/BotChatView.vue](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/frontend/src/views/mobile/BotChatView.vue)：消息列表 `messages: ref<Array<{ role: 'user'|'bot', text: string }>>([])`
- [ ] **5.2** 底部输入区：单行 `<input>` + 发送按钮（拇指热区内），按 Enter 或点击发送
- [ ] **5.3** 发送流程：push 用户消息 → 调用 [eco.ts](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/frontend/src/api/eco.ts) `botParseCommand(text)` → 取 `intent` + `entities` + `confidence`；若 confidence ≥ 0.5 调用 `botExecute(intent, entities)` → 渲染结果为 bot 气泡
- [ ] **5.4** 兜底：confidence < 0.5 或 LLM 降级（参考 project_memory DeepSeek 集成）→ bot 气泡显示"未理解您的意思，请尝试：查询融资进度 / 我的积分 / 兑换商品"+ 3 个快捷短语按钮（点击即填入输入框）
- [ ] **5.5** 样式：用户气泡靠右（var(--el-color-primary)），bot 气泡靠左（var(--el-fill-color-light)），自动滚动到底部

**验证**: 输入"查询融资进度"看到 bot 返回结果；输入"asdfgh"看到兜底提示 + 3 个快捷按钮

---

## Task 6: 移动路由与设备重定向

- [ ] **6.1** 创建 [frontend/src/router/mobile.ts](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/frontend/src/router/mobile.ts)：定义 4 个路由 `/m/scan`、`/m/pts`、`/m/bot`、`/m/login`，`meta: { layout: 'mobile', title: '...' }`，component 用 `() => import('@/views/mobile/...')`；除 `/m/login` 外其他 3 个路由 `meta.requiresAuth = true`
- [ ] **6.2** 修改 [frontend/src/router/index.ts](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/frontend/src/router/index.ts)：import mobile routes 并 spread 到 `routes` 数组；在 `beforeEach` 守卫中调用 [useDevice](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/frontend/src/composables/useDevice.ts)（Task 8）+ [useWorkerAuth](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/frontend/src/composables/useWorkerAuth.ts)（Task 10）判断：
  - 移动端访问非 `/m/*` 路径 → `next('/m/scan')`
  - PC 端访问 `/m/*` → `next('/')`
  - 访问 `meta.requiresAuth=true` 路由且 `localStorage.workerToken` 不存在 → `next('/m/login?redirect=' + encodeURIComponent(to.path))`
  - 否则放行
- [ ] **6.3** 修改 App 根组件或 [frontend/src/App.vue](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/frontend/src/App.vue)：根据 `route.meta.layout` 选择渲染 `<MobileLayout>` 或现有 PC 布局
- [ ] **6.4** 在 [frontend/src/api/client.ts](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/frontend/src/api/client.ts) 增加响应拦截器：捕获 401 → 清空 `localStorage.workerToken` → 跳转 `/m/login?redirect=...` + toast"登录已过期，请重新登录"（非阻塞）

**验证**: 手机模拟器访问 `/` 自动跳转 `/m/scan`；未登录时再跳 `/m/login`；桌面访问 `/` 不跳转；桌面访问 `/m/scan` 跳回 `/`；模拟 401 响应后自动跳回登录页

---

## Task 7: 后端工人订单查询端点

- [ ] **7.1** 在 [backend/app/api/routers/eco.py](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/app/api/routers/eco.py) 的 eco-pts 路由组下新增 `GET /eco-pts/orders` 端点
  - 查询参数 `workerId: str`（必填，缺失返回 422）、`page: int = 1`、`pageSize: int = 20`
  - 从 [eco_service.py](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/app/services/eco_service.py) 调用新方法 `list_worker_orders(worker_id, page, page_size)`
- [ ] **7.2** 在 [eco_service.py](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/app/services/eco_service.py) 实现 `list_worker_orders`：从订单表（参考 ECO-06 已有 `PlaceOrder` 实现，复用同一张表）查询 `worker_id == X` 的记录，按 `created_at DESC` 排序，返回 `[{ orderId, itemId, itemName, cost, status, createdAt }]`
- [ ] **7.3** 在 [backend/tests/](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/tests/) 新增 `test_eco_pts_orders.py`：
  - 测试用例 1：传 `workerId=W001` 返回订单列表，按时间倒序
  - 测试用例 2：不传 `workerId` 返回 422 + `workerId is required`
  - 测试用例 3：传不存在的 `workerId=W999` 返回空数组 `[]`（不报错）
  - 测试用例 4：分页参数 `page=2&pageSize=5` 返回第 6-10 条

**验证**: `pytest backend/tests/test_eco_pts_orders.py -v` 全部通过；`curl "http://localhost:8000/api/v1/eco-pts/orders?workerId=W001"` 返回 200 + 订单数组

---

## Task 8: 响应式样式与设备检测 composable

- [ ] **8.1** 创建 [frontend/src/styles/responsive.scss](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/frontend/src/styles/responsive.scss)：
  - 定义 mixin `@mixin mobile { @media (max-width: 767px) { @content; } }`
  - 定义 mixin `@mixin desktop { @media (min-width: 768px) { @content; } }`
  - 默认隐藏 `.mobile-only` 类，在 `@include mobile` 内显示
  - 在 `@include mobile` 内隐藏 `.desktop-only`
- [ ] **8.2** 在 [frontend/src/styles/main.scss](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/frontend/src/styles/main.scss) 顶部 `@use 'responsive' as *;`
- [ ] **8.3** 创建 [frontend/src/composables/useDevice.ts](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/frontend/src/composables/useDevice.ts)：
  - `isMobile()`：检查 `navigator.userAgent` 含 `Mobile|Android|iPhone` 或 `window.innerWidth < 768`
  - `useDevice()` 返回响应式 `isMobile: Ref<boolean>`，监听 `resize` 事件更新
  - 使用 `@vueuse/core` 的 `useMediaQuery` 简化实现

**验证**: 浏览器拖拽窗口宽度从 1000px 到 500px，控制台 `useDevice().isMobile` 从 false 变 true

---

> 注：v1.1 修订中新增 Task 10/11，原 Task 9（端到端验收）合并扩展为 Task 12（含登录态/上链/三模/语音的端到端验收），故编号跳过 9。

## Task 10: 工人极简登录态（前后端）

> 依赖: Task 1（main.ts/client.ts 已就位可被修改）；产物被 Task 3/4/5/6 依赖
> v1.2 补丁：①后端 worker-login 改用 `worker_no` 字段查询（非原 `workerId`）②新增 10.6 数据迁移脚本 ③新增 10.7 WORKER_AUTH_BYPASS 开发降级 ④前端 composable 改名 useWorkerAuth

- [ ] **10.1** 后端：在 [backend/app/api/routers/auth.py](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/app/api/routers/auth.py)（若不存在则新建）新增 `POST /auth/worker-login` 端点
  - 请求体：`{ enterpriseCode: str, workerNo: str }`（无密码）
  - 校验：先查 `enterprises.enterprise_code == X` 得 `enterpriseId`，再查 `worker_accounts.worker_no == Y AND enterprise_id == enterpriseId` 命中
  - 成功：调用现有 [deps.py](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/app/api/deps.py) 的 JWT 签发逻辑（project_memory 记录 P0 已实现），签发 7 天 JWT，含 `sub: workerId, role: 'worker', enterpriseId`（注意 sub 用 worker_accounts.id，非 worker_no）
  - 失败：返回 401 + `{ detail: "企业码或工号错误" }`
- [ ] **10.2** 后端测试：[backend/tests/test_auth_worker_login.py](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/tests/test_auth_worker_login.py)
  - 用例 1：合法企业码 + 工号 → 200 + 返回 JWT，jwt-decode 验证 sub/role/enterpriseId
  - 用例 2：企业码不存在 → 401 + "企业码或工号错误"
  - 用例 3：工号不在该企业下 → 401 + "企业码或工号错误"
  - 用例 4：JWT 过期时间 = 7 天（`exp - iat ≈ 7*24*3600`）
  - 用例 5：`WORKER_AUTH_BYPASS=true` 时跳过 DB 校验，返回 mock JWT（sub=W001, enterpriseId=E001）
- [ ] **10.3** 前端：创建 [frontend/src/views/mobile/LoginView.vue](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/frontend/src/views/mobile/LoginView.vue) 极简登录表单（企业码 6 位 + 工号 + "提交"按钮 + 可选"扫码登录"按钮调用 ScanInput 扫企业二维码自动填充）
- [ ] **10.4** 前端：创建 [frontend/src/composables/useWorkerAuth.ts](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/frontend/src/composables/useWorkerAuth.ts)（**预防性命名**，避免与未来 PC 端老板登录的 useAuth 冲突）+ [frontend/src/composables/useSpeech.ts](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/frontend/src/composables/useSpeech.ts)
  - `useWorkerAuth`：`login(enterpriseCode, workerNo) → POST /auth/worker-login → 存 localStorage.workerToken`、`logout()`、`isAuthenticated: ComputedRef<boolean>`、`workerId: ComputedRef<string|null>`、`workerToken: ComputedRef<string|null>`
  - `useSpeech`：`speechSupported = 'speechSynthesis' in window`、`voiceEnabled: Ref<boolean>`（默认 true，localStorage 持久化）、`speak(text: string)` 内部检查开关 + supported、使用 `SpeechSynthesisUtterance` + `lang='zh-CN'` + `rate=1.2`、`toggleVoice()`
- [ ] **10.5** 前端：在 [frontend/src/api/client.ts](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/frontend/src/api/client.ts) 请求拦截器自动注入 `Authorization: Bearer {localStorage.workerToken}`（仅当 token 存在，避免无 token 时发出 `Bearer undefined`）；响应拦截器捕获 401（已在 Task 6.4）；前端 `.env.development` 新增 `VITE_WORKER_AUTH_BYPASS=true`，开启时 useWorkerAuth 在 `isAuthenticated === false` 自动注入 mock token 跳过登录页（仅 dev 构建分支，生产构建时 tree-shaking 移除）
- [ ] **10.6** 后端数据迁移：创建 [backend/app/migrations/worker_auth_tables.sql](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/app/migrations/worker_auth_tables.sql)（同时新建 migrations 目录）
  - `ALTER TABLE enterprises ADD COLUMN enterprise_code VARCHAR(8) UNIQUE NOT NULL DEFAULT '';`（先加列允许空，再回填示例数据后强制 UNIQUE）
  - `ALTER TABLE worker_accounts ADD COLUMN worker_no VARCHAR(20) UNIQUE NOT NULL DEFAULT '';`
  - 回填示例数据：`UPDATE enterprises SET enterprise_code = 'E' || SUBSTRING(id::text, 1, 5) LIMIT 5;` + `UPDATE worker_accounts SET worker_no = 'W' || SUBSTRING(id::text, 1, 5);`
  - 同时在 [enterprise.py](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/app/models/enterprise.py) 与 [eco.py](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/app/models/eco.py) 的 ORM 模型对应新增 `enterprise_code: Mapped[str]` / `worker_no: Mapped[str]` 字段（保持 ORM 与 DB schema 一致，避免 SQLAlchemy 反射报错）
  - 在 [main.py](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/app/main.py) 的 `lifespan` 启动钩子中读取 `migrations/` 目录下的所有 `.sql` 文件并执行（dev 环境自动迁移，production 手动执行）
- [ ] **10.7** 后端开发降级：[backend/app/core/config.py](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/app/core/config.py) 新增配置项 `WORKER_AUTH_BYPASS: bool = False`（从 `os.getenv("WORKER_AUTH_BYPASS", "false").lower() == "true"` 读取）；`APP_ENV=production` 时强制覆盖为 False（生产环境忽略此 env），避免误开

**验证**: `pytest backend/tests/test_auth_worker_login.py -v` 5 用例全过；前端 `.env.development` 含 `VITE_WORKER_AUTH_BYPASS=true` 时访问 `/m/scan` 直接跳过登录页；后端 `WORKER_AUTH_BYPASS=true` 时 `POST /auth/worker-login` 任意输入均返回 mock JWT；正常模式前端访问 `/m/scan` 未登录 → 跳 `/m/login` → 输入企业码 + 工号 → 跳回 `/m/scan`；DevTools Network 看后续请求带 Authorization header；输入错误企业码看到 toast"企业码或工号错误"；启动后端日志显示"applied migrations: worker_auth_tables.sql"

---

## Task 11: 确权证据上链存证（后端 MOD-08 集成）

> 依赖: Task 7（eco_service 已有 award 处理函数）；产物被 Task 3.6 的 award 调用感知（仅新增响应字段 chainTxHash）
> v1.2 补丁：①上链改 FastAPI BackgroundTasks 异步执行（接口不等待）②PC 端调用 evidence/location 缺失时自动跳过上链（向后兼容）③重试机制用 APScheduler 不引入 Celery/RQ

- [ ] **11.1** 后端：在 [eco_service.py](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/app/services/eco_service.py) 新增 `stamp_award_evidence(award_record) → str | None` 方法
  - 计算 `evidence_hash = SHA256(f"{workerId}{materialId}{timestamp}{photoHash}{location_value}")`（location_value 为 gps/wifi/manual 的归一化字符串）
  - 调用 MOD-08 [blockchain_client.py](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/app/services/blockchain_client.py) 的 `stamp(evidence_hash, timestamp)`（若 MOD-08 客户端尚未实现，按 project_memory 降级原则：捕获异常 + `logger.warning("blockchain stamp failed: ...")` + 返回 None）
  - 返回 `tx_hash` 或 `None`；失败时把记录插入 `stamp_retry_queue` 表
- [ ] **11.2** 后端：修改 [eco.py](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/app/api/routers/eco.py) 的 `POST /eco-pts/award` 处理函数
  - **接口签名变更**：`evidence` 与 `location` 字段改为 Optional（默认 None），新增 `fromMobile: Optional[bool] = None`
  - **同步流程**（必须 ≤ 200ms）：积分入账（fraudBlocked 检查 + 写 worker_accounts.balances）
  - **异步上链触发条件**（满足全部三条才调度）：
    1. `fraudBlocked == false`（积分实际入账）
    2. `evidence is not None AND location is not None`（移动端补传完整证据）
    3. `request.headers.get("user-agent", "").startswith("MobilePWA") OR fromMobile is True`
  - 满足条件：`background_tasks.add_task(stamp_award_evidence, award_record)` 调度异步上链（FastAPI BackgroundTasks 内置）
  - 不满足条件（PC 端补录）：跳过 stamp 调度 + `logger.info(f"PC-side award skipped stamp: award_id={award_id}")` + award 记录 `chainTxHash=null`
  - **响应体**：立即返回 `{ awarded, newBalances, fraudBlocked, chainTxHash: null }`（chainTxHash 永远先 null，前端下次拉取订单/明细时才看到真实值）
- [ ] **11.3** 后端：在 [eco.py](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/app/models/eco.py) 新增 `StampRetryQueueORM` 模型（表名 `stamp_retry_queue`，字段 `id, award_id, evidence_hash, retry_count, next_retry_at, status`）；在 [main.py](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/app/main.py) 的 lifespan 启动钩子中用 APScheduler 调度每 10 分钟扫描 `status='pending' AND retry_count < 3` 重试 stamp，成功 `status='done'`，3 次失败 `status='abandoned'`；**不引入 Celery/RQ**（避免 MVP 引入消息中间件依赖，遵循 project_memory "外部依赖不可达不阻塞业务 + 最小化原则"）
- [ ] **11.4** 后端测试：[backend/tests/test_eco_pts_award_stamps_chain.py](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/tests/test_eco_pts_award_stamps_chain.py)
  - 用例 1：移动端调用（User-Agent: MobilePWA + 完整 evidence + location + fromMobile=true）+ mock MOD-08 stamp 成功 → award 响应 200 + chainTxHash=null（异步）+ 后台 stamp 完成后查 award 记录 chainTxHash 非空
  - 用例 2：移动端调用 + mock MOD-08 stamp 抛异常 → award 响应 200 + chainTxHash=null + 积分仍入账 + stamp_retry_queue 新增 1 条 pending
  - 用例 3：PC 端调用（无 User-Agent: MobilePWA，无 evidence/location）→ award 响应 200 + chainTxHash=null + 跳过 stamp 调度 + 日志含"PC-side award skipped stamp"
  - 用例 4：PC 端误传 evidence 但无 location → 仍跳过上链
  - 用例 5：模拟 APScheduler 重试队列扫描 → pending 记录 stamp 成功后变 done
  - 用例 6：连续失败 3 次 → 记录变 abandoned，不再重试
- [ ] **11.5** 全量回归：`pytest backend/tests/` 全过（参考 project_memory 145 测试基线 + 之前 20 ECO+LLM 用例 = 165+，新增 6 个上链用例 + 5 个登录用例 = 176+），无现有用例破坏

**验证**: `pytest backend/tests/test_eco_pts_award_stamps_chain.py -v` 6 用例全过；移动端 `curl -X POST /api/v1/eco-pts/award -H "Authorization: Bearer <token>" -H "User-Agent: MobilePWA/1.0" -d '{"workerId":"W001","evidence":{...},"location":{...},"fromMobile":true}'` 响应 200 + `chainTxHash=null`（接口 < 200ms）；后台异步完成后查 `SELECT chain_tx_hash FROM award WHERE id=X` 非空；PC 端 `curl -X POST /api/v1/eco-pts/award -d '{"workerId":"W001"}'`（无 evidence）响应 200 + 日志含"PC-side award skipped stamp"；kill MOD-08 服务后移动端调用 → 仍 200 + 后端日志含"blockchain stamp failed" + stamp_retry_queue 新增 pending

---

## Task 12: 端到端验收（对照 APP02_MOBILE_PLAN.md §8 验收标准）

- [ ] **12.1** 验收清单见 [checklist.md](file:///c:/Users/Windws/Desktop/caiwu/jinrong/.trae/specs/app02-mobile-pwa-mvp/checklist.md)，由验证阶段逐项执行并打勾

---

# Task Dependencies

- Task 1（PWA 基础设施 + imageCompress + IndexedDB 队列 + usePendingSync）无依赖，最先开工
- Task 10（工人极简登录态 + 数据迁移 + WORKER_AUTH_BYPASS）依赖 Task 1（client.ts 可被改拦截器），可与 Task 1 并行启动后端部分（10.1/10.2/10.6/10.7 可立即开工）
- Task 2（MobileLayout）依赖 Task 1（manifest 已就位）
- Task 3/4/5（3 个移动视图）依赖 Task 2（布局容器）+ Task 10（useWorkerAuth + useSpeech + client.ts 拦截器就位，否则请求无 Authorization + 无语音）
- Task 6（移动路由 + 401 拦截）依赖 Task 3/4/5（视图存在）+ Task 10（useWorkerAuth 就位）
- Task 7（后端 orders 端点）无前端依赖，可与 Task 1-6 并行
- Task 8（响应式 + useDevice）依赖 Task 1（main.ts 已注册 SW），可与其他任务并行
- Task 11（上链存证）依赖 Task 7（eco_service award 函数已存在）+ Task 10.6（migrations 目录已就位，便于 StampRetryQueueORM 建表），可与其他任务并行
- Task 12（验收）依赖 Task 1-11 全部完成

# 并行化建议

- **代理 A（前端基础设施）**: Task 1 → Task 2 → Task 8（串行，含 imageCompress/indexedDbQueue/usePendingSync）
- **代理 B（移动视图）**: Task 3、Task 4、Task 5（并行，依赖 Task 2 + Task 10 完成后启动）
- **代理 C（登录态 + 路由）**: Task 10（独立，可立即开工：10.1 后端 + 10.6 迁移 + 10.7 配置 + 10.3/10.4 前端）→ Task 6（依赖 Task 3/4/5 + Task 10）
- **代理 D（后端）**: Task 7（orders）+ Task 11（上链 + APScheduler）（并行，无前端依赖，可立即开工；Task 11 等 Task 10.6 migrations 目录就位后启动 ORM 建表）
- **代理 E（验收）**: Task 12（全部完成后启动）
