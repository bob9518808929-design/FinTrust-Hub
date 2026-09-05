/**
 * router/mobile.ts — APP-02 移动端 PWA 路由表 (MVP)
 *
 * 设计依据: APP02_MOBILE_PLAN.md §4 Task 6.1
 *   - 4 个核心移动视图 (扫码确权 / 积分钱包 / 我的分身 / 工人登录)
 *   - 全部 layout: 'mobile', 由 App.vue 切换到 MobileLayout
 *   - BotChatView 调 botParseCommand 需 enterpriseId (非 workerId), 故 /m/bot 也需鉴权
 *
 * project_memory 硬约束:
 *   - async/await 风格, 禁止 callback (组件懒加载为动态 import, 不涉及)
 *   - 资源 URL 加版本参数 ?v=22 (由 PWA 缓存策略处理, 此处仅声明路由)
 */

import type { RouteRecordRaw } from 'vue-router';

export const mobileRoutes: RouteRecordRaw[] = [
  {
    path: '/m/login',
    name: 'mobile-login',
    component: () => import('@/views/mobile/LoginView.vue'),
    meta: { layout: 'mobile', title: '工人登录' },
  },
  {
    path: '/m/scan',
    name: 'mobile-scan',
    component: () => import('@/views/mobile/ScanConfirmView.vue'),
    meta: { layout: 'mobile', title: '扫码确权', requiresAuth: true },
  },
  {
    path: '/m/pts',
    name: 'mobile-pts',
    component: () => import('@/views/mobile/PtsWalletView.vue'),
    meta: { layout: 'mobile', title: '积分钱包', requiresAuth: true },
  },
  {
    // BotChatView 调 botParseCommand 需 enterpriseId (非 workerId), 故也需鉴权
    path: '/m/bot',
    name: 'mobile-bot',
    component: () => import('@/views/mobile/BotChatView.vue'),
    meta: { layout: 'mobile', title: '我的分身', requiresAuth: true },
  },
  {
    // /m 默认入口 → /m/scan (扫码确权是首要高频操作)
    path: '/m',
    redirect: '/m/scan',
  },
];
