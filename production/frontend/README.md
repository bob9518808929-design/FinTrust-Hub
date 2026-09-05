# FinTrust Hub 前端 (Vue 3 + TS + Element Plus + Vite)

> **定位**: `production/frontend/` 是 FinTrust Hub v3.1 的真实生产前端, 按 `../../.trae/specs/build-fintech-trust-hub/spec.md` L3499 技术栈构建。
> **与 `simulation/` 的关系**: `simulation/` 是浏览器端纯 JS 演示原型, 不承担生产职责。本目录才是面向真实部署的前端代码。

## 技术栈

| 类别 | 选型 | 版本 |
|---|---|---|
| 框架 | Vue 3 (Composition API + `<script setup>`) | ^3.4.21 |
| 语言 | TypeScript (严格模式) | ~5.4.3 |
| UI 库 | Element Plus (暗色主题默认) | ^2.6.3 |
| 状态 | Pinia + persistedstate | ^2.1.7 |
| 路由 | Vue Router 4 | ^4.3.0 |
| HTTP | axios | ^1.6.8 |
| 可视化 | ECharts + vue-echarts | ^5.5.0 |
| 构建 | Vite 5 (vue-tsc 类型校验) | ^5.2.6 |
| 工具 | dayjs / lodash-es / @vueuse/core | - |

## 目录结构

```
frontend/
├── package.json            # 依赖与脚本
├── vite.config.ts          # Vite 配置 (Element Plus 按需导入 / 代理)
├── tsconfig.json           # TypeScript 严格模式
├── tsconfig.node.json      # Node 环境配置 (vite.config)
├── index.html              # HTML 入口
├── .env.example            # 环境变量示例
├── .eslintrc.cjs           # ESLint 配置
├── .gitignore
└── src/
    ├── main.ts             # Vue 应用入口
    ├── App.vue             # 根组件 (布局)
    ├── vite-env.d.ts       # Vite 类型声明
    ├── router/index.ts     # 路由配置 (含 9 个 ECO 模块路由)
    ├── stores/             # Pinia 状态管理
    │   ├── enterprise.ts   # 企业状态 (含改造完成回写)
    │   ├── reform.ts       # 改造引擎 R0-R10 状态
    │   └── eco.ts          # ECO 9 模块跨模块状态
    ├── api/                # API 调用层 (对齐 contracts)
    │   ├── client.ts       # axios 实例 + 拦截器
    │   ├── enterprise.ts   # 企业 API
    │   ├── reform.ts       # 改造引擎 API (含 SSE 订阅)
    │   └── eco.ts          # 9 个 ECO 模块 API
    ├── components/
    │   ├── layout/         # 布局组件 (Sidebar/Header/Breadcrumb/Footer)
    │   └── common/         # 通用组件 (ScorecardRadar 等)
    ├── views/              # 视图 (按业务分组)
    │   ├── HomeView.vue    # 工作台
    │   ├── enterprise/     # 企业列表/详情
    │   ├── reform/         # 改造工作台 (R0-R10 全流程)
    │   ├── financing/      # 融资流程
    │   ├── bank/           # 银行工作台
    │   ├── eco/            # 9 个 ECO 模块视图
    │   ├── AboutView.vue
    │   └── NotFoundView.vue
    └── styles/             # 全局样式 (暗色主题)
        ├── variables.scss  # 主题变量
        ├── reset.scss      # 全局重置
        └── main.scss       # Element Plus 暗色覆盖
```

## 快速开始

```bash
# 1. 安装依赖 (推荐 pnpm)
pnpm install

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env, 设置 VITE_BACKEND_URL 指向 FastAPI 后端

# 3. 启动开发服务器
pnpm dev
# 访问 http://localhost:5173

# 4. 类型检查
pnpm type-check

# 5. 生产构建
pnpm build
# 输出在 dist/

# 6. 预览生产构建
pnpm preview
```

## 关键设计

### 1. 严格 TypeScript
`tsconfig.json` 启用全部 strict 选项 (`noUncheckedIndexedAccess` / `noImplicitReturns` / `noFallthroughCasesInSwitch` 等)。

### 2. 暗色主题默认
金融场景深色护眼。`styles/main.scss` 重写 Element Plus 颜色变量, 使用 SCSS 变量集中管理 (project_memory 硬约束)。

### 3. 奻傻式操作设计哲学
- 工作台首页只放判断题/填空题, 不放选择题
- 改造工作台步骤化 (R0→R7→解锁融资), 进度可视化
- ECO-09 数字分身用聊天交互替代表单
- 全局企业选择器置顶, 切换企业清空全局告警 (project_memory)

### 4. 路由守卫
- `/financing` 路由守卫检查 `financingUnlocked`, 未解锁跳转 `/reform` (project_memory)
- 401 自动跳登录, 5xx 显示 toast

### 5. 状态持久化
- `currentEnterpriseId` 持久化到 localStorage (刷新不丢失)
- `reform.currentEnterpriseId` 持久化到 sessionStorage (会话级)
- 其他状态默认不持久化, 避免脏数据

### 6. ECO 模块统管
9 个 ECO 模块的状态聚合在 `stores/eco.ts` 单 store 中, 跨模块联动 (如 ECO-01 完成诊断 → 通知 ECO-09 数字分身) 通过 EcoEvent 总线解耦。

## 与后端契约对齐

所有 API 调用严格对齐 `../contracts/` 的 TypeScript 接口契约:
- 请求/响应字段名一一对应
- 字段类型一致 (AmountInCents / IsoTimestamp / Ratio 等)
- 错误码统一通过 `ApiResult<T>` 包装

后端启动后, 访问 `/api/docs` 查看自动生成的 OpenAPI 文档, 应与前端契约一致。

## 已知限制 (后续路线图)

1. **登录系统**: 当前未实现, 假设单租户场景。生产前需补充 OAuth2 / OIDC 集成
2. **国际化**: 当前仅中文。需补充 i18n (中/英)
3. **PWA**: 离线支持未实现
4. **测试**: 单元测试 (Vitest) + E2E (Playwright) 待补充 (P9 阶段)
5. **性能**: 路由懒加载已实现, 但大表虚拟滚动待补充
6. **暗色主题切换**: 当前强制暗色, 后续补充亮色切换

## 修改此目录的纪律

1. **新增视图必须先在 `contracts/` 定义类型**, 不可绕过契约直接在 Vue 组件写 inline 类型
2. **修改 Pinia store 必须保持向后兼容**, 新增字段而非修改
3. **修改样式变量必须改 `styles/variables.scss`**, 不可在组件内 hardcode 颜色 (project_memory 硬约束)
4. **每次修改后跑 `pnpm type-check`**, 确保 TypeScript 严格模式通过
