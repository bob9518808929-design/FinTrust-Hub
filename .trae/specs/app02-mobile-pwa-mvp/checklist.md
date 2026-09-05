# Checklist — APP-02 移动端 PWA MVP 验收

> 对照 `APP02_MOBILE_PLAN.md` §8 验收标准 + spec.md 各 Requirement 的 Scenario
> 执行方式：每个 checkpoint 由验证 sub-agent 检查代码或运行测试后打勾

---

## Task 1: PWA Manifest 与 Service Worker

- [ ] `frontend/public/manifest.json` 存在，含 name/short_name/start_url="/m/scan"/display="standalone"/theme_color/icons 字段
- [ ] `frontend/vite.config.ts` 已注入 `VitePWA` 插件，`strategies: 'injectManifest'`
- [ ] `frontend/src/sw.ts` 存在，使用 workbox 的 `precacheAndRoute` + `registerRoute`
- [ ] API 路径 `/api/v1/eco-pts/shop`、`/api/v1/eco-pts/workers/*` 配置为 `NetworkFirst`
- [ ] 静态资源 `/assets/*`、`/manifest.json` 配置为 `CacheFirst`
- [ ] `sw.ts` 配置 Background Sync plugin，queue name = `pending-awards-queue`，maxRetentionTime = 60 分钟
- [ ] `frontend/src/main.ts` 注册 `virtual:pwa-register`
- [ ] `frontend/src/utils/imageCompress.ts` 存在，`compressImage(file)` 输出 720p / JPEG 质量 0.6 / < 200KB + 同时返回 Base64 字符串
- [ ] 单元测试：5MB JPEG 输入 `compressImage` 输出 blob < 200KB + base64 非空
- [ ] `frontend/src/utils/indexedDbQueue.ts` 存在，`push/getAll/remove/totalSize` 实现
- [ ] `indexedDbQueue` item schema 仅含 Base64 字符串与元数据（不存 Blob/ArrayBuffer）
- [ ] `indexedDbQueue.push` 在 `totalSize + newItemSize > 50MB` 时抛 `QueueFullError`
- [ ] `frontend/src/composables/usePendingSync.ts` 存在，`flushPending()` 实现 Base64 → Blob → FormData → ptsAwardPoints 上送
- [ ] `usePendingSync` 监听 `window.online` 事件自动触发 flush
- [ ] ScanConfirmView 在 `onActivated` 调用 `usePendingSync.flushPending()`
- [ ] `pnpm build` 成功生成 `dist/sw.js` + `dist/manifest.json` + `dist/registerSW.js`
- [ ] Lighthouse PWA 评分 ≥ 90（Chrome DevTools → Lighthouse → PWA 类别）

## Task 2: MobileLayout 容器

- [ ] `frontend/src/layouts/MobileLayout.vue` 存在
- [ ] 顶部 header 含返回按钮 + 动态标题（从 `route.meta.title` 取）
- [ ] 底部 Tab Bar 含 3 个 Tab：扫码 `/m/scan` / 积分 `/m/pts` / 我的 `/m/bot`
- [ ] Tab Bar 高度 ≥ 48px
- [ ] 每个 Tab 可点击区域 ≥ 48×48px
- [ ] 当前路由对应 Tab 高亮
- [ ] `<router-view>` 包裹在 `<KeepAlive>` 内（扫码页缓存）
- [ ] 移动模拟器访问 `/m/scan` 底部 Tab Bar 正确显示并可切换

## Task 3: ScanConfirmView 扫码确权页

- [ ] `frontend/src/views/mobile/ScanConfirmView.vue` 存在
- [ ] 4 步状态机 `step: 'scan' | 'photo' | 'confirm' | 'done'`
- [ ] 复用 `ScanInput.vue`，无文字输入框（遵循 spec.md L2734 不输入也能交）
- [ ] 扫码后自动识别物料 ID，自动切换到 photo 步
- [ ] 三模定位主路径：`navigator.geolocation.getCurrentPosition` 取 GPS，5 秒超时
- [ ] GPS `accuracy > 50m` 视为不可用，回退到 WiFi 指纹（`navigator.connection` 或 BSSID 哈希）
- [ ] GPS + WiFi 均不可用或围栏漂移 > 10m 时显示"定位不准，请手工修正"按钮
- [ ] 手工修正弹出地图选点，默认中心为工位围栏中心，允许拖动 10m 内
- [ ] 围栏校验：定位点距工位预置围栏中心 > 半径则 toast"超出作业范围"并禁用提交
- [ ] 拍照使用 `<input type="file" accept="image/*" capture="environment">`
- [ ] 拍照后立即调用 `compressImage` 压缩至 < 200KB + 转 Base64 再展示预览缩略图
- [ ] 缩略图旁显示"确认" / "重拍"按钮
- [ ] 主操作按钮位于屏幕底部 1/3 区域内（拇指热区，遵循 spec.md L2736）
- [ ] 点击"确认"弹阻塞模态窗（z-index=10000）二次确认
- [ ] 调用 `ptsAwardPoints({ workerId, behavior, evidence: { photoHash, materialId, photoBase64 }, location: { type, value }, fromMobile: true })`
- [ ] 请求头带 `Authorization: Bearer {workerToken}` + `User-Agent: MobilePWA/<version>`（双重标识）
- [ ] 成功 toast"积分到账 +X"，z-index=9500，含 × 关闭按钮，6.5s 自动消失
- [ ] 成功同时调用 `useSpeech.speak("积分到账 X 分")` 语音播报
- [ ] 响应含 `chainTxHash: null`（异步上链，前端不在主流程等）
- [ ] `fraudBlocked=true` 显示 toast"该物料 5 分钟内已确权，请勿重复操作" + 语音"请勿重复操作"
- [ ] 网络失败时调 `indexedDbQueue.push` 入队（仅存 Base64 + 元数据）+ 顶部"待上传 N 条"横幅
- [ ] `QueueFullError` 时禁用拍照按钮 + toast"存储空间不足，请联网同步后继续操作"
- [ ] ScanConfirmView 在 `onActivated` 钩子调用 `usePendingSync.flushPending()` 上送待传队列
- [ ] 监听 `window.online` 事件触发 flush
- [ ] flush 时由 ScanConfirmView 上下文（非 SW）负责 Base64 → Blob → FormData → ptsAwardPoints
- [ ] flush 成功后逐条 toast + 语音 + `indexedDbQueue.remove(id)`
- [ ] 浏览器不支持 Web Speech API 时跳过语音且不报错（降级）
- [ ] ScanConfirmView 模板含 `<button v-if="speechSupported" @click="toggleVoice">` 允许关闭语音
- [ ] 单次操作从扫码到提交 ≤ 5 秒（人工计时验证）
- [ ] 5 分钟内同物料重复扫码触发防刷分 toast + 语音

## Task 4: PtsWalletView 积分钱包页

- [ ] `frontend/src/views/mobile/PtsWalletView.vue` 存在
- [ ] 顶部显示当前积分余额（大字号 + 颜色高亮）
- [ ] 调用 `ptsGetWorker(workerId)` 取余额
- [ ] 显示最近 10 条明细（时间 / 行为 / ±积分 / 来源 4 列）
- [ ] 调用 `ptsListOrders(workerId)`（Task 7 新增）取明细
- [ ] 商品列表 2 列网格布局
- [ ] 调用 `ptsListShopItems()` 取商品
- [ ] 每个商品显示图标 + 名称 + 所需积分 + "兑换"按钮
- [ ] 点击"兑换"弹阻塞模态窗（z-index=10000）二次确认
- [ ] 调用 `ptsPlaceOrder({ workerId, itemId })`
- [ ] 成功 toast"兑换成功，待发货"
- [ ] 积分不足 toast"积分不足"
- [ ] 商品已下架 toast"商品已下架"
- [ ] 重复点击 toast"无需重复操作"（遵循 project_memory）

## Task 5: BotChatView AI 问答页

- [ ] `frontend/src/views/mobile/BotChatView.vue` 存在
- [ ] 消息列表 `messages: ref<Array<{ role, text }>>`
- [ ] 底部单行输入框 + 发送按钮（拇指热区内）
- [ ] Enter 键或点击发送均可触发
- [ ] 调用 `botParseCommand(text)` 取 intent + entities + confidence
- [ ] confidence ≥ 0.5 时调用 `botExecute(intent, entities)`
- [ ] 执行结果渲染为 bot 气泡
- [ ] confidence < 0.5 显示兜底提示 + 3 个快捷短语按钮
- [ ] 用户气泡靠右（`var(--el-color-primary)`）
- [ ] bot 气泡靠左（`var(--el-fill-color-light)`）
- [ ] 新消息后自动滚动到底部
- [ ] 输入"查询融资进度"返回有效结果
- [ ] 输入"asdfgh"显示兜底提示 + 3 个快捷按钮

## Task 6: 移动路由与设备重定向

- [ ] `frontend/src/router/mobile.ts` 存在，定义 `/m/scan`、`/m/pts`、`/m/bot`、`/m/login`
- [ ] 每个 route 的 `meta.layout = 'mobile'`
- [ ] `/m/scan`、`/m/pts`、`/m/bot` 的 `meta.requiresAuth = true`，`/m/login` 不需要
- [ ] `frontend/src/router/index.ts` 引入并注册 mobile routes
- [ ] `beforeEach` 守卫调用 `useDevice` + `useAuth`
- [ ] 移动端访问 `/` → 重定向 `/m/scan`
- [ ] PC 端访问 `/` → 不重定向
- [ ] PC 端访问 `/m/scan` → 重定向 `/`
- [ ] 未登录访问 `requiresAuth=true` 路由 → 重定向 `/m/login?redirect=...`
- [ ] 登录成功后跳回 redirect 路径（无 redirect 时跳 `/m/scan`）
- [ ] App 根组件根据 `route.meta.layout` 切换布局
- [ ] `frontend/src/api/client.ts` 响应拦截器捕获 401
- [ ] 401 时清空 `localStorage.workerToken` + 跳 `/m/login?redirect=...` + toast"登录已过期，请重新登录"

## Task 7: 后端工人订单查询端点

- [ ] `GET /api/v1/eco-pts/orders` 端点存在
- [ ] 必填参数 `workerId` 缺失返回 422 + `workerId is required`
- [ ] 可选参数 `page` 默认 1，`pageSize` 默认 20
- [ ] 返回结构 `[{ orderId, itemId, itemName, cost, status, createdAt }]`
- [ ] 按 `createdAt DESC` 排序
- [ ] 不存在的 workerId 返回空数组 `[]`
- [ ] 分页参数正确生效（page=2&pageSize=5 返回第 6-10 条）
- [ ] `backend/tests/test_eco_pts_orders.py` 4 个测试用例全部通过
- [ ] 全量 `pytest backend/tests/` 无回归（参考 project_memory：145 测试基线）
- [ ] `frontend/src/api/eco.ts` 中 orders TODO 已移除，新增 `ptsListOrders(workerId, page?, pageSize?)` 调用

## Task 8: 响应式样式与设备检测

- [ ] `frontend/src/styles/responsive.scss` 存在
- [ ] `@mixin mobile` 使用 `@media (max-width: 767px)`
- [ ] `@mixin desktop` 使用 `@media (min-width: 768px)`
- [ ] `.mobile-only` 默认隐藏，`@include mobile` 内显示
- [ ] `.desktop-only` 默认显示，`@include mobile` 内隐藏
- [ ] `frontend/src/styles/main.scss` 顶部 `@use 'responsive' as *;`
- [ ] `frontend/src/composables/useDevice.ts` 存在
- [ ] `isMobile()` 检查 UA + 屏宽
- [ ] `useDevice()` 返回响应式 `Ref<boolean>`
- [ ] 监听 `resize` 事件更新
- [ ] 使用 `@vueuse/core` 的 `useMediaQuery`
- [ ] 浏览器拖拽窗口宽度从 1000px → 500px，`useDevice().isMobile` 从 false 变 true

> 注：v1.1 修订中新增 Task 10/11，原 Task 9（端到端验收）合并扩展为 Task 12（含登录态/上链/三模/语音的端到端验收），故编号跳过 9。

## Task 10: 工人极简登录态

- [ ] 后端 `POST /api/v1/auth/worker-login` 端点存在
- [ ] 请求体 `{ enterpriseCode, workerNo }`（无密码，注意字段名 workerNo 非 workerId）
- [ ] 后端校验链：`enterprises.enterprise_code == X` → 得 enterpriseId → `worker_accounts.worker_no == Y AND enterprise_id == enterpriseId` 命中
- [ ] 合法企业码 + 工号返回 7 天 JWT，含 `sub: worker_accounts.id, role: 'worker', enterpriseId`
- [ ] 企业码不存在返回 401 + "企业码或工号错误"
- [ ] 工号不在该企业下返回 401 + "企业码或工号错误"
- [ ] `backend/tests/test_auth_worker_login.py` 5 个测试用例全部通过（含 WORKER_AUTH_BYPASS 用例）
- [ ] 前端 `frontend/src/views/mobile/LoginView.vue` 存在
- [ ] 登录表单：企业码（6 位）+ 工号 + "提交"按钮 + 可选"扫码登录"
- [ ] `frontend/src/composables/useWorkerAuth.ts` 存在（**预防性命名，不是 useAuth.ts**）
- [ ] `useWorkerAuth.login()` 调用 `/auth/worker-login` 并存 `localStorage.workerToken`
- [ ] `useWorkerAuth.logout()` 清空 token
- [ ] `useWorkerAuth.isAuthenticated` / `workerId` / `workerToken` 计算属性正确
- [ ] `frontend/src/composables/useSpeech.ts` 存在
- [ ] `useSpeech.speechSupported` = `'speechSynthesis' in window`
- [ ] `useSpeech.voiceEnabled` 默认 true，localStorage 持久化
- [ ] `useSpeech.speak(text)` 检查开关 + supported，使用 `SpeechSynthesisUtterance` + `lang='zh-CN'` + `rate=1.2`
- [ ] `useSpeech.toggleVoice()` 切换开关
- [ ] `frontend/src/api/client.ts` 请求拦截器自动注入 `Authorization: Bearer {workerToken}`
- [ ] 仅当 token 存在时注入，避免无 token 时发出 `Bearer undefined`
- [ ] `backend/app/migrations/worker_auth_tables.sql` 存在
- [ ] migrations 含 `ALTER TABLE enterprises ADD COLUMN enterprise_code VARCHAR(8) UNIQUE NOT NULL DEFAULT '';`
- [ ] migrations 含 `ALTER TABLE worker_accounts ADD COLUMN worker_no VARCHAR(20) UNIQUE NOT NULL DEFAULT '';`
- [ ] migrations 含示例数据回填（E + 5 字符 / W + 5 字符）
- [ ] `enterprise.py` ORM 模型新增 `enterprise_code: Mapped[str]`
- [ ] `eco.py` WorkerAccountORM 新增 `worker_no: Mapped[str]`
- [ ] `main.py` lifespan 启动钩子读取并执行 migrations/*.sql（dev 自动 / production 手动）
- [ ] 启动后端日志显示"applied migrations: worker_auth_tables.sql"
- [ ] `backend/app/core/config.py` 新增 `WORKER_AUTH_BYPASS: bool = False` 配置
- [ ] `APP_ENV=production` 时强制 `WORKER_AUTH_BYPASS=False`
- [ ] `WORKER_AUTH_BYPASS=true` 时 `POST /auth/worker-login` 跳过 DB 校验返回 mock JWT
- [ ] 前端 `.env.development` 含 `VITE_WORKER_AUTH_BYPASS=true`
- [ ] 前端 dev 模式访问 `/m/scan` 自动注入 mock token 跳过登录页
- [ ] 前端生产构建（`pnpm build`）后 tree-shaking 移除 bypass 分支
- [ ] 未登录访问 `/m/scan` → 跳 `/m/login` → 输入正确凭据 → 跳回 `/m/scan`
- [ ] DevTools Network 看后续请求带 `Authorization` header
- [ ] 输入错误企业码看到 toast"企业码或工号错误"

## Task 11: 确权证据上链存证

- [ ] `eco_service.stamp_award_evidence(award_record)` 方法存在
- [ ] 计算 `evidence_hash = SHA256(workerId + materialId + timestamp + photoHash + location_value)`
- [ ] 调用 MOD-08 `blockchain_client.stamp(evidence_hash, timestamp)`
- [ ] MOD-08 不可达时捕获异常 + `logger.warning("blockchain stamp failed: ...")` + 返回 None + 写 stamp_retry_queue
- [ ] 返回 `tx_hash` 或 `None`
- [ ] `POST /eco-pts/award` 处理函数积分入账后**通过 FastAPI BackgroundTasks 异步调度** `stamp_award_evidence`
- [ ] **接口立即返回，不等待链上回执**（接口响应 < 200ms）
- [ ] award 响应体新增 `chainTxHash: null` 字段（永远先 null，异步完成后回填）
- [ ] **PC 端兼容**：`evidence` 与 `location` 字段为 Optional
- [ ] PC 端调用（无 User-Agent: MobilePWA，无 evidence/location）跳过 stamp 调度 + 日志含"PC-side award skipped stamp"
- [ ] PC 端误传 evidence 但无 location → 仍跳过上链
- [ ] 移动端调用三条件全满足才调度（fraudBlocked=false + evidence + location + User-Agent: MobilePWA 或 fromMobile=true）
- [ ] **关键约束**：上链失败不阻塞积分入账主流程（异步执行，主流程已结束）
- [ ] `StampRetryQueueORM` 模型存在，表 `stamp_retry_queue`，字段 `id/award_id/evidence_hash/retry_count/next_retry_at/status`
- [ ] `main.py` lifespan 启动 APScheduler 后台任务，每 10 分钟扫描 `status='pending' AND retry_count < 3`
- [ ] 重试成功 → `status='done'` + chainTxHash 回填
- [ ] 3 次失败后 `status='abandoned'`，不再重试
- [ ] **不引入 Celery/RQ**（确认 dependencies.txt 无 celery/rq，仅 apscheduler）
- [ ] `backend/tests/test_eco_pts_award_stamps_chain.py` 6 个测试用例全部通过
- [ ] 用例 1：移动端调用 + mock stamp 成功 → 响应 200 + chainTxHash=null + 异步完成后查 DB 非空
- [ ] 用例 2：移动端调用 + mock stamp 抛异常 → 响应 200 + chainTxHash=null + 积分仍入账 + 队列新增 pending
- [ ] 用例 3：PC 端调用（无 evidence/location）→ 响应 200 + chainTxHash=null + 跳过调度 + 日志含"PC-side award skipped stamp"
- [ ] 用例 4：PC 端误传 evidence 但无 location → 仍跳过上链
- [ ] 用例 5：模拟 APScheduler 扫描 → pending 变 done
- [ ] 用例 6：连续失败 3 次 → 变 abandoned
- [ ] 全量 `pytest backend/tests/` 无回归（参考 project_memory 145 + 20 + 6 上链 + 5 登录 = 176+ 测试基线）
- [ ] 移动端 `curl -X POST /api/v1/eco-pts/award -H "Authorization: Bearer <token>" -H "User-Agent: MobilePWA/1.0" -d '{...,"fromMobile":true}'` 响应 200 + `chainTxHash=null` + 接口 < 200ms
- [ ] 后台异步完成后查 `SELECT chain_tx_hash FROM award WHERE id=X` 非空
- [ ] PC 端 `curl -X POST /api/v1/eco-pts/award -d '{"workerId":"W001"}'`（无 evidence）响应 200 + 日志含"PC-side award skipped stamp"
- [ ] kill MOD-08 服务后移动端调用 → 仍 200 + 日志含"blockchain stamp failed" + stamp_retry_queue 新增 pending

## Task 12: 端到端验收（APP02_MOBILE_PLAN.md §8）

- [ ] 手机浏览器访问 `https://<domain>/m/scan` 未登录时跳 `/m/login`
- [ ] 输入企业码 + 工号登录后跳回 `/m/scan`
- [ ] `.env.development` 设 `VITE_WORKER_AUTH_BYPASS=true` 时跳过登录页直接进 `/m/scan`
- [ ] 能扫码识别二维码
- [ ] 三模定位：GPS / WiFi 指纹 / 人工修正 10m 内均能完成定位
- [ ] 围栏外提示"超出作业范围"
- [ ] 拍照取证后 5 秒内提交（接口 < 200ms），积分到账 toast + 语音"积分到账 X 分"
- [ ] award 响应立即返回 `chainTxHash: null`（异步上链）
- [ ] 断网状态下能扫码 + 缓存（图片压缩 < 200KB + Base64），恢复网络后 ScanConfirmView 自动 flush 上送
- [ ] 累计 50MB 离线队列时禁用拍照 + toast"存储空间不足"
- [ ] 积分查询页显示余额 + 最近 10 条明细
- [ ] AI 问答页能解析"查询融资进度"并返回结果
- [ ] Lighthouse PWA 评分 ≥ 90
- [ ] DevTools Network 看所有 `/api/v1/*` 请求带 `Authorization: Bearer` + User-Agent: MobilePWA
- [ ] 后端日志确认移动端 award 触发 BackgroundTasks 异步 stamp
- [ ] 后端日志确认 PC 端 award 跳过 stamp（含"PC-side award skipped stamp"）
- [ ] MOD-08 关停后 award 仍成功 + chainTxHash 留空 + stamp_retry_queue 新增 pending
- [ ] APScheduler 后台任务 10 分钟内自动重试 pending → done（链恢复后）
- [ ] 启动后端日志显示"applied migrations: worker_auth_tables.sql"
- [ ] `vue-tsc --noEmit` 退出码 0（无类型错误）
- [ ] `pnpm build` 成功，无 TypeScript 报错
- [ ] `pnpm build` 后 grep 不到 `VITE_WORKER_AUTH_BYPASS` 分支（tree-shaking 移除）
- [ ] `pnpm dev` 后浏览器控制台无 SW 注册错误

## project_memory 合规检查

- [ ] 所有 AI 通知 toast 含 × 关闭按钮 + 操作按钮，z-index=9500
- [ ] AI 通知 toast 自动消失时间 = 6.5s
- [ ] 不可逆决策（提交确权、积分兑换）使用阻塞模态窗，z-index=10000
- [ ] Tab Bar 拇指热区 ≥ 48×48px
- [ ] 功能按钮前置检查失败显示 toast 提示原因
- [ ] 浏览器缓存控制：移动视图资源 URL 含版本参数
- [ ] 所有 middleware / async 操作使用 async/await（无 callback 风格）
- [ ] 外部依赖不可达不阻塞业务（MOD-08 / DeepSeek LLM 失败时降级）
- [ ] 重复点击不可逆操作 toast"无需重复操作"
- [ ] 路由文件不被中间件 refactor 修改（中间件仅修改 main.ts）
- [ ] 异步任务用 APScheduler 不引入 Celery/RQ（避免 MVP 引入消息中间件依赖）
- [ ] 接口性能约束：award 同步流程 ≤ 200ms（外部调用走 BackgroundTasks 异步）
- [ ] PC 端 / 移动端调用同接口的向后兼容性（Optional 字段 + 来源标识）
- [ ] 前端 composable 预防性命名（useWorkerAuth 避免与未来 useAuth 冲突）
- [ ] 生产构建后 dev-only 分支被 tree-shaking 移除（VITE_WORKER_AUTH_BYPASS 不进 prod bundle）
