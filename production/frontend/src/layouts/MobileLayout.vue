<!-- 文件名：MobileLayout.vue 职责：移动端布局容器,顶部返回+动态标题、中部路由视图 KeepAlive、底部 3 Tab(扫码/积分/我的)
  -------------------------------------------------------------
  设计依据: APP02_MOBILE_PLAN.md §4.2 Task 2.2
  结构:
    - 顶部 .m-header: 返回按钮 (根路径隐藏) + 动态标题 (route.meta.title)
    - 中部 .m-main: <router-view> + <KeepAlive> 缓存扫码页 (避免重复初始化摄像头)
    - 底部 .m-tabbar: 3 个 Tab (扫码 / 积分 / 我的)

  样式: 见 src/styles/responsive.scss (移动端断点生效)
  project_memory 硬约束:
    - Tab Bar 高度 ≥ 48px (实际 56px), Tab 点击区域 ≥ 48×48px
    - 路由链接 router-link-active 高亮 var(--el-color-primary)
-->
<template>
  <div class="mobile-layout">
    <header class="m-header">
      <button
        v-if="canGoBack"
        class="m-back-btn"
        type="button"
        aria-label="返回"
        @click="goBack"
      >
        <span aria-hidden="true">&larr;</span>
      </button>
      <h1 class="m-title">{{ title }}</h1>
    </header>

    <main class="m-main">
      <router-view v-slot="{ Component }">
        <KeepAlive>
          <component :is="Component" />
        </KeepAlive>
      </router-view>
    </main>

    <nav class="m-tabbar" aria-label="主导航">
      <router-link to="/m/scan" class="m-tab" aria-label="扫码确权">
        <span class="m-tab-icon" aria-hidden="true"> scan </span>
        <span class="m-tab-label">扫码</span>
      </router-link>
      <router-link to="/m/pts" class="m-tab" aria-label="积分钱包">
        <span class="m-tab-icon" aria-hidden="true"> pts </span>
        <span class="m-tab-label">积分</span>
      </router-link>
      <router-link to="/m/bot" class="m-tab" aria-label="我的 AI 分身">
        <span class="m-tab-icon" aria-hidden="true"> bot </span>
        <span class="m-tab-label">我的</span>
      </router-link>
    </nav>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';

defineOptions({ name: 'MobileLayout' });

const route = useRoute();
const router = useRouter();

// 动态标题 (从路由 meta.title 取, 兜底 'FinTrust')
const title = computed(() => (route.meta?.title as string) || 'FinTrust');

// 返回按钮可见性: 历史长度 > 1 且非扫码根路径时显示
const canGoBack = computed(() => {
  if (typeof window === 'undefined') return false;
  // /m/scan 是移动端根路径, 不显示返回按钮
  if (route.path === '/m/scan') return false;
  return window.history.length > 1;
});

function goBack(): void {
  // router.back() 优先, 无历史时兜底跳扫码页
  if (window.history.length > 1) {
    router.back();
  } else {
    router.push('/m/scan');
  }
}
</script>
