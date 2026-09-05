<template>
  <el-config-provider :locale="zhCn" :size="size">
    <!-- APP-02 移动端 PWA 布局 (route.meta.layout === 'mobile') -->
    <MobileLayout v-if="isMobileLayout" />

    <!-- 全屏独立布局 (route.meta.layout === 'standalone', 用于登录页等无 sidebar/header 的页面) -->
    <router-view v-else-if="isStandaloneLayout" />

    <!-- PC 布局 (默认) -->
    <div v-else class="app-container" :class="{ 'is-collapsed': sidebarCollapsed }">
      <AppSidebar :collapsed="sidebarCollapsed" @toggle="toggleSidebar" />

      <div class="app-main">
        <AppHeader :collapsed="sidebarCollapsed" @toggle-sidebar="toggleSidebar" />
        <AppBreadcrumb />

        <main class="app-content">
          <router-view v-slot="{ Component, route }">
            <transition name="fade-slide" mode="out-in">
              <keep-alive :include="cachedViews">
                <component :is="Component" :key="route.fullPath" />
              </keep-alive>
            </transition>
          </router-view>
        </main>

        <AppFooter />
      </div>
    </div>

    <!-- 全局一键求助 Coach Mark (UX-05), 挂在最外层保证 portal 优先级 -->
    <CoachMark />
  </el-config-provider>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import AppSidebar from '@/components/layout/AppSidebar.vue';
import AppHeader from '@/components/layout/AppHeader.vue';
import AppBreadcrumb from '@/components/layout/AppBreadcrumb.vue';
import AppFooter from '@/components/layout/AppFooter.vue';
import CoachMark from '@/components/common/CoachMark.vue';
import MobileLayout from '@/layouts/MobileLayout.vue';
import { useEnterpriseStore } from '@/stores/enterprise';
import { useReformStore } from '@/stores/reform';
import { useCoachMark } from '@/composables/useCoachMark';

defineOptions({ name: 'App' });

const coach = useCoachMark();

const route = useRoute();
const sidebarCollapsed = ref(false);
const size = ref<'large' | 'default' | 'small'>('default');

// APP-02: 按 route.meta.layout 选择移动布局 (MobileLayout 内部已自带 router-view + KeepAlive)
const isMobileLayout = computed(() => route.meta?.layout === 'mobile');

// 全屏独立布局 (登录页等, 无 sidebar/header)
const isStandaloneLayout = computed(() => route.meta?.layout === 'standalone');

// 缓存视图白名单 (只读视图才缓存, 编辑视图不缓存)
const cachedViews = computed<string[]>(() => {
  const cache: string[] = [];
  if (route.meta?.keepAlive) {
    cache.push(String(route.name || ''));
  }
  return cache;
});

const toggleSidebar = () => {
  sidebarCollapsed.value = !sidebarCollapsed.value;
};

// CORE-04: F1 快捷键解绑句柄
let unbindF1: (() => void) | null = null;

onMounted(async () => {
  // APP-02: 移动端布局跳过 PC 端企业列表 / 改造状态预取和 F1 求助引导
  if (isMobileLayout.value) return;

  const enterpriseStore = useEnterpriseStore();
  const reformStore = useReformStore();

  // 启动时拉取企业列表 (project_memory: 切换企业时清空全局告警)
  await enterpriseStore.fetchEnterprises();
  if (enterpriseStore.currentEnterpriseId) {
    await reformStore.loadReformState(enterpriseStore.currentEnterpriseId);
  }

  // project_memory 傻瓜式操作 (UX-05 / CORE-04): F1 全局快捷键调出当前页求助引导
  // 通过 useCoachMark.bindF1Shortcut 集中管理: 输入框聚焦时不拦截, 引导显示中按 F1 关闭
  unbindF1 = coach.bindF1Shortcut(() => route.name, {
    onNoTour: () => {
      ElMessage.info('当前页面暂无引导, 可在工作台首页按 F1 体验');
    },
  });
});

onBeforeUnmount(() => {
  if (isMobileLayout.value) return;
  if (unbindF1) {
    unbindF1();
    unbindF1 = null;
  }
});
</script>

<style lang="scss">
.app-container {
  display: flex;
  width: 100%;
  min-height: 100vh;
  background: var(--app-bg);

  .app-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    transition: margin-left 0.28s ease;
  }

  .app-content {
    flex: 1;
    padding: 16px 24px;
    overflow-y: auto;
    overflow-x: hidden;
  }
}

.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: all 0.25s ease;
}
.fade-slide-enter-from {
  opacity: 0;
  transform: translateX(-12px);
}
.fade-slide-leave-to {
  opacity: 0;
  transform: translateX(12px);
}
</style>
