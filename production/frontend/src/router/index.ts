/**
 * router/index.ts — Vue Router 4 路由配置
 *
 * 路由分组 (对齐 spec.md L3624+ 实施分期与 Tab 组织):
 *   1. 工作台   /                — 仪表板 (KPI 总览)
 *   2. 企业     /enterprise      — 企业列表 / 详情
 *   3. 改造     /reform          — 改造工作台 (MOD-16)
 *   4. 融资     /financing       — 融资流程 (MOD-01~15)
 *   5. 银行     /bank            — 银行工作台
 *   6. ECO     /eco/*           — 9 个 ECO 模块
 *   7. 关于     /about
 *   8. 移动端  /m/*             — APP-02 移动 PWA (扫码确权 / 积分钱包 / 我的分身 / 登录)
 *
 * 路由守卫:
 *   - beforeEach: 检查 enterprise store 是否已选企业 (除 / /enterprise 外)
 *   - 改造未完成访问 /financing → 跳转 /reform (project_memory: 融资入口锁定)
 *   - APP-02: 设备重定向 (移动端访问 PC 路由 → /m/scan, PC 访问 /m/* → /)
 *   - APP-02: /m/* 鉴权守卫 (requiresAuth 未登录 → /m/login?redirect=...)
 */

import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { mobileRoutes } from './mobile';
import { isMobileDevice } from '@/composables/useDevice';
import { useWorkerAuth } from '@/composables/useWorkerAuth';

const routes: readonly RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('@/views/HomeView.vue'),
    meta: { title: '工作台', icon: 'Odometer', keepAlive: true },
  },
  {
    path: '/enterprise',
    name: 'enterprise-list',
    component: () => import('@/views/enterprise/EnterpriseListView.vue'),
    meta: { title: '企业列表', icon: 'OfficeBuilding' },
  },
  {
    path: '/enterprise/:id',
    name: 'enterprise-detail',
    component: () => import('@/views/enterprise/EnterpriseDetailView.vue'),
    meta: { title: '企业详情', icon: 'OfficeBuilding', hidden: true },
  },
  {
    path: '/reform',
    name: 'reform',
    component: () => import('@/views/reform/ReformWorkbenchView.vue'),
    meta: { title: '改造工作台', icon: 'Tools', keepAlive: true },
  },
  {
    path: '/financing',
    name: 'financing',
    component: () => import('@/views/financing/FinancingFlowView.vue'),
    meta: { title: '融资流程', icon: 'Money', requiresReform: true },
  },
  {
    path: '/bank',
    name: 'bank',
    component: () => import('@/views/bank/BankWorkbenchView.vue'),
    meta: { title: '银行工作台', icon: 'CreditCard', keepAlive: true },
  },
  {
    path: '/approval',
    name: 'approval',
    component: () => import('@/views/approval/ApprovalWorkbenchView.vue'),
    meta: { title: '人工审批台', icon: 'Select', keepAlive: true },
  },
  {
    path: '/institution',
    name: 'institution',
    component: () => import('@/views/institution/InstitutionWorkbenchView.vue'),
    meta: { title: '担保保险协作台', icon: 'Shield', keepAlive: true },
  },
  {
    path: '/advisor',
    name: 'advisor',
    component: () => import('@/views/advisor/AdvisorWorkbenchView.vue'),
    meta: { title: '财务顾问运营台', icon: 'UserFilled', keepAlive: true },
  },
  {
    path: '/cockpit',
    name: 'cockpit',
    component: () => import('@/views/cockpit/CockpitView.vue'),
    meta: { title: 'AI 驾驶舱', icon: 'Monitor', keepAlive: true },
  },
  {
    path: '/fallback',
    name: 'fallback',
    component: () => import('@/views/fallback/FallbackConsoleView.vue'),
    meta: { title: '独立兜底引擎', icon: 'SetUp', keepAlive: true },
  },
  {
    path: '/regulatory',
    name: 'regulatory',
    component: () => import('@/views/regulatory/RegulatorySandboxView.vue'),
    meta: { title: '监管沙盒', icon: 'WarningFilled', keepAlive: true },
  },
  {
    path: '/partner',
    name: 'partner',
    component: () => import('@/views/partner/PartnerPortalView.vue'),
    meta: { title: '关联机构门户', icon: 'Connection', keepAlive: true },
  },
  {
    path: '/scf',
    name: 'scf',
    component: () => import('@/views/scf/ScfWorkbenchView.vue'),
    meta: { title: '供应链金融工作台', icon: 'Van', keepAlive: true },
  },
  // === PC 端身份选择登录页 (全屏独立布局, 不带 sidebar/header) ===
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    meta: { title: '登录', layout: 'standalone', hidden: true },
  },
  // === 企业自助门户 (企业老板登录后看的视角, 只看自己企业) ===
  {
    path: '/portal/enterprise',
    name: 'portal-enterprise',
    component: () => import('@/views/portal/EnterprisePortalView.vue'),
    meta: { title: '企业自助门户', icon: 'OfficeBuilding', keepAlive: true },
  },
  // === ECO 9 模块路由 (P5 充实组件) ===
  {
    path: '/eco',
    name: 'eco-group',
    redirect: '/eco/burn',
    meta: { title: 'ECO 模块', icon: 'Connection' },
    children: [
      {
        path: 'burn',
        name: 'eco-burn',
        component: () => import('@/views/eco/EcoBurnView.vue'),
        meta: { title: 'ECO-01 阅后即焚', icon: 'Lock', group: 'ECO' },
      },
      {
        path: 'pricing',
        name: 'eco-pricing',
        component: () => import('@/views/eco/EcoPricingView.vue'),
        meta: { title: 'ECO-02 阶梯定价', icon: 'Wallet', group: 'ECO' },
      },
      {
        path: 'rpa',
        name: 'eco-rpa',
        component: () => import('@/views/eco/EcoRpaView.vue'),
        meta: { title: 'ECO-03 无接口适配器', icon: 'Document', group: 'ECO' },
      },
      {
        path: 'credential',
        name: 'eco-credential',
        component: () => import('@/views/eco/EcoCredentialView.vue'),
        meta: { title: 'ECO-04 联盟链凭证', icon: 'Key', group: 'ECO' },
      },
      {
        path: 'bid',
        name: 'eco-bid',
        component: () => import('@/views/eco/EcoBidView.vue'),
        meta: { title: 'ECO-05 反向竞拍', icon: 'Auction', group: 'ECO' },
      },
      {
        path: 'pts',
        name: 'eco-pts',
        component: () => import('@/views/eco/EcoPtsView.vue'),
        meta: { title: 'ECO-06 积分商城', icon: 'Present', group: 'ECO' },
      },
      {
        path: 'index',
        name: 'eco-index',
        component: () => import('@/views/eco/EcoIndexView.vue'),
        meta: { title: 'ECO-07 行业合规指数', icon: 'TrendCharts', group: 'ECO' },
      },
      {
        path: 'gov',
        name: 'eco-gov',
        component: () => import('@/views/eco/EcoGovView.vue'),
        meta: { title: 'ECO-08 政府背书', icon: 'Stamp', group: 'ECO' },
      },
      {
        path: 'bot',
        name: 'eco-bot',
        component: () => import('@/views/eco/EcoBotView.vue'),
        meta: { title: 'ECO-09 数字分身', icon: 'ChatLineRound', group: 'ECO' },
      },
    ],
  },
  {
    path: '/glossary',
    name: 'glossary',
    component: () => import('@/views/help/GlossaryView.vue'),
    meta: { title: '金融词典', icon: 'Reading' },
  },
  {
    path: '/about',
    name: 'about',
    component: () => import('@/views/AboutView.vue'),
    meta: { title: '关于', icon: 'InfoFilled' },
  },
  // === APP-02 移动端 PWA 路由 (扫码确权 / 积分钱包 / 我的分身 / 登录) ===
  ...mobileRoutes,
  // 404 兜底
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/NotFoundView.vue'),
    meta: { title: '页面不存在', hidden: true },
  },
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior(_to, _from, savedPosition) {
    return savedPosition ?? { top: 0 };
  },
});

// 路由守卫
router.beforeEach(async (to, _from) => {
  document.title = `${to.meta?.title ?? ''} | FinTrust Hub v3.1`;

  // === APP-02 设备重定向 (移动端 ↔ PC 端路由分流) ===
  const isMobile = isMobileDevice();
  const isMobilePath = to.path.startsWith('/m/');
  if (isMobile && !isMobilePath) {
    // 移动端访问非 /m/* 路由 → 跳 /m/scan (扫码确权是首要高频操作)
    // 例外: '/' 与 '/eco*' 暂不强转, 保留入口灰度过渡 (代理 E 端到端验收时可放宽)
    if (to.path !== '/' && !to.path.startsWith('/eco')) {
      return { name: 'mobile-scan' };
    }
  }
  if (!isMobile && isMobilePath) {
    // PC 端访问 /m/* → 跳 / (回 PC 工作台)
    return { name: 'home' };
  }

  // === APP-02 /m/* 鉴权守卫 (requiresAuth 未登录 → /m/login?redirect=...) ===
  if (to.meta?.requiresAuth) {
    const { isAuthenticated } = useWorkerAuth();
    // 开发降级: VITE_WORKER_AUTH_BYPASS=true 时跳过登录 (联调/验收用)
    const bypass = import.meta.env.VITE_WORKER_AUTH_BYPASS === 'true';
    if (!isAuthenticated.value && !bypass) {
      return { name: 'mobile-login', query: { redirect: to.fullPath } };
    }
  }

  // project_memory 硬约束: 改造未完成访问 /financing → 跳转 /reform
  if (to.meta?.requiresReform) {
    const { useEnterpriseStore } = await import('@/stores/enterprise');
    const { useReformStore } = await import('@/stores/reform');
    const entStore = useEnterpriseStore();
    const reformStore = useReformStore();

    if (!entStore.currentEnterpriseId) {
      return { name: 'enterprise-list', query: { redirect: to.fullPath } };
    }
    const reformState = await reformStore.loadReformState(entStore.currentEnterpriseId);
    if (!reformState || reformState.status !== 'completed') {
      // project_memory: 融资入口 financingUnlocked=false 时锁定, 跳转改造台
      return { name: 'reform', query: { enterpriseId: entStore.currentEnterpriseId } };
    }
  }
  return true;
});

export default router;

// 路由元数据类型扩展
declare module 'vue-router' {
  interface RouteMeta {
    title?: string;
    icon?: string;
    group?: string;
    keepAlive?: boolean;
    hidden?: boolean;
    requiresReform?: boolean;
    // APP-02 移动端路由元数据
    layout?: 'mobile' | 'pc' | 'standalone';
    requiresAuth?: boolean;
  }
}
