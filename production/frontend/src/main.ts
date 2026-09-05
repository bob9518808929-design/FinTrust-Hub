/**
 * main.ts — FinTrust Hub 前端入口
 *
 * 职责:
 *   1. 创建 Vue 应用实例
 *   2. 安装 Pinia (状态管理) + persist 插件
 *   3. 安装 Vue Router 4
 *   4. 全量注册 Element Plus (开发期; 生产期切按需导入)
 *   5. 注册 ECharts 全局组件 (VueECharts)
 *   6. 挂载到 #app
 *
 * 设计哲学 (project_memory 傻瓜式操作):
 *   - 全局错误边界 (ErrorBoundary 组件捕获未处理异常)
 *   - 路由守卫 (未授权跳登录; 改造未完成跳改造台)
 *   - 暗色主题默认 (金融场景深色护眼)
 */

import { createApp } from 'vue';
import { createPinia } from 'pinia';
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate';
import ElementPlus from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import 'element-plus/dist/index.css';
import * as ElementPlusIconsVue from '@element-plus/icons-vue';

import ECharts from 'vue-echarts';
import 'echarts';

// PWA Service Worker 注册 (vite-plugin-pwa injectManifest 模式)
// 设计依据: APP02_MOBILE_PLAN.md §4.2 Task 1.5
import { registerSW } from 'virtual:pwa-register';

import App from './App.vue';
import router from './router';
import './styles/main.scss';
import { ElNotification } from 'element-plus';
import { useAlertStore } from '@/stores/alertStore';

const app = createApp(App);

// Pinia + 持久化 (localStorage 兜底; 生产切换为 sessionStorage 或后端 token)
const pinia = createPinia();
pinia.use(piniaPluginPersistedstate);
app.use(pinia);

// Vue Router
app.use(router);

// Element Plus 中文 + 暗色主题默认
app.use(ElementPlus, { locale: zhCn, size: 'default' });

// 全量注册图标 (按需注册可优化打包体积, 后期优化)
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component);
}

// ECharts 全局组件 (评分雷达图 / 关系图谱 / 风险扩散条等)
app.component('VChart', ECharts);

// 全局错误处理 (ECO-09 数字分身通知, 兜底降级不抛错)
app.config.errorHandler = (err, _instance, info) => {
  console.error('[FinTrust 全局错误]', err, '信息:', info);
  try {
    ElNotification({
      title: '系统异常',
      message: `${err instanceof Error ? err.message : String(err)}`,
      type: 'error',
      duration: 6000,
    });
  } catch {
    // ElNotification 调用失败时仅 console (避免无限错误循环)
  }
};

// 全局未捕获 Promise 异常 (ECO-09 数字分身 + ECO-08 监管报告)
window.addEventListener('unhandledrejection', (event) => {
  console.error('[FinTrust 未处理 Promise 异常]', event.reason);
  try {
    const alertStore = useAlertStore();
    alertStore.addAlert({
      level: 'orange',
      caseType: 'chain_break',
      title: '系统检测到异常',
      message: event.reason instanceof Error ? event.reason.message : String(event.reason),
      enterpriseId: 'system',
      jumpTarget: '/workbench',
    });
  } catch {
    // 降级: alertStore 不可用时仅记录
  }
});

// === PWA Service Worker 注册 (Task 1.5) ===
// registerType: 'prompt' 模式, 检测到新版本时由 onNeedRefresh 回调通知 (MVP 仅 console, Task 12 接 UI)
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    // 新版本可用, MVP 仅 console 提示; 后续可弹 toast 引导用户刷新
    console.info('[PWA] 检测到新版本, 刷新页面以更新');
  },
  onOfflineReady() {
    console.info('[PWA] 离线就绪, 应用可离线使用');
  },
  onRegisteredSW(swUrl, registration) {
    // dev 环境打印 SW 注册状态 (project_memory: 开发环境打开 console.log 提示 SW 状态)
    if (import.meta.env.DEV) {
      console.info('[PWA] SW 已注册:', swUrl, registration?.scope);
    }
  },
  onRegisterError(error) {
    console.warn('[PWA] SW 注册失败:', error);
  },
});

// 暴露到全局以便手动触发 update (调试用, 不污染 window 类型)
if (import.meta.env.DEV) {
  (window as unknown as { __PWA_UPDATE?: () => Promise<void> }).__PWA_UPDATE = updateSW;
}

app.mount('#app');
