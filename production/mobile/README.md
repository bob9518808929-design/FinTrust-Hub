# FinTrust Hub 移动端 APP (Taro 跨端小程序)

> APP-02 企业端门户 — 移动端 APP

## 设计哲学 (project_memory 傻瓜式操作)

责任链工人(仓管/物流)不会打字, 在手机上只需两件事:
1. **看企业资金水位卡片** (红黄绿信号灯, 一眼判断是否告警)
2. **扫码确权** (扫发票/集装箱号自动填空, 提交即确认)

不让用户做选择题, 只做判断题或填空题.

## 项目结构

```
production/mobile/
├── config/                     # Taro 编译配置
│   ├── index.ts                # 多端编译入口 (微信小程序/支付宝/H5)
│   ├── dev.ts                  # 开发环境
│   ├── prod.ts                 # 生产环境
│   └── component.ts            # 自定义组件配置
├── src/
│   ├── app.ts                  # 应用入口 (React)
│   ├── app.config.ts           # 应用全局配置 (路由 + tabbar + 主题)
│   ├── app.scss                # 全局样式 (与 PC 端 variables.scss 对齐)
│   ├── index.html              # H5 入口模板
│   ├── styles/
│   │   └── variables.scss      # 样式变量 (与 PC 端对齐)
│   └── pages/
│       ├── index/              # 企业首页 (资金水位卡片 + 快捷操作)
│       │   ├── index.tsx
│       │   └── index.scss
│       └── scan/               # 扫码页 (调 ScanInput 逻辑)
│           ├── index.tsx
│           └── index.scss
├── package.json
├── tsconfig.json
├── babel.config.js
└── project.config.json         # 微信小程序项目配置
```

## 多端编译

```bash
# 微信小程序
npm run build:weapp

# 支付宝小程序
npm run build:alipay

# H5 (与 PC 端 PWA 互为补充)
npm run build:h5

# 开发模式 (watch)
npm run dev:weapp
npm run dev:h5
```

> **注意**: Taro 编译需要额外环境 (Node 18+ / Taro CLI 3.6+), 本仓库未集成到 PC 端 build 流水线. 编译产物输出到 `dist/` 后由对应平台 (微信开发者工具 / 浏览器) 加载.

## 与 PC 端对齐

| 项 | PC 端 | 移动端 (本项目) |
|----|----|----|
| 框架 | Vue 3 + TypeScript | React + TypeScript |
| 样式 | Element Plus + SCSS | Taro 内置组件 + SCSS |
| 主题 | 暗色 ($bg-page: #1e293b) | 暗色 (变量对齐) |
| 后端 | /api/v1 (axios) | /api/v1 (Taro.request) |
| Token | localStorage `fintrust-token` | localStorage `workerToken` (与 PC 端 PWA 共享) |
| 扫码 | 浏览器 BarcodeDetector API | Taro.scanCode (多端原生) + H5 降级 |
| 阈值 | 50 万红线 (SMALL_AUTO_THRESHOLD) | 50 万红线 (RED_LINE_YUAN, 对齐) |

## 资金水位阈值

- 红线: < 50 万元 (与 PC 端 `SMALL_AUTO_THRESHOLD_YUAN = 500000` 对齐)
- 黄线: 50 万 ~ 100 万元
- 绿灯: ≥ 100 万元
