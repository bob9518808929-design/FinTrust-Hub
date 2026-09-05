<!-- 文件名：AppSidebar.vue 职责：侧边栏导航组件,按端/场景分组,工作台置顶,ECO 9 子项自动展开为子菜单

  设计哲学 (project_memory 傻瓜式操作):
    - 菜单按"端"分组, 不让用户在扁平列表里翻找
    - 工作台首页单独置顶 (最高频)
    - ECO 模块 9 个子项自动作为 el-sub-menu
    - 路由 meta.hidden=true 的不显示 (如 enterprise-detail / 404)
    - 路由 meta.group 字段控制分组归属 (无 group 的视为顶级项)
-->
<template>
  <aside class="app-sidebar" :class="{ 'is-collapsed': collapsed }">
    <div class="logo">
      <span class="logo-icon">FT</span>
      <span v-if="!collapsed" class="logo-text">FinTrust Hub</span>
    </div>
    <el-menu
      :default-active="activeMenu"
      :collapse="collapsed"
      :collapse-transition="false"
      router
      class="sidebar-menu"
    >
      <!-- 1. 工作台首页 (顶级项, 永远置顶) -->
      <el-menu-item index="/">
        <el-icon><Odometer /></el-icon>
        <template #title>🏠 工作台</template>
      </el-menu-item>

      <!-- 2. PC 端登录入口 (顶级项, 仅未登录时可见, 当前 dev-admin 兜底也保留入口) -->
      <el-menu-item index="/login">
        <el-icon><User /></el-icon>
        <template #title>🔐 切换身份登录</template>
      </el-menu-item>

      <!-- 3. 按分组聚合渲染 (跳过 home/login/ECO/hidden/无 group 的) -->
      <el-sub-menu
        v-for="group in groupedRoutes"
        :key="group.key"
        :index="group.key"
      >
        <template #title>
          <el-icon><component :is="getIcon(group.icon)" /></el-icon>
          <span>{{ group.title }}</span>
        </template>
        <el-menu-item
          v-for="item in group.items"
          :key="item.path"
          :index="item.path"
        >
          <el-icon v-if="item.icon"><component :is="getIcon(item.icon)" /></el-icon>
          <template #title>{{ item.title }}</template>
        </el-menu-item>
      </el-sub-menu>

      <!-- 4. ECO 模块 (路由表里已是 children, 自动作为 el-sub-menu) -->
      <el-sub-menu v-if="ecoGroup" index="/eco">
        <template #title>
          <el-icon><component :is="getIcon(ecoGroup.meta?.icon ?? 'Menu')" /></el-icon>
          <span>{{ ecoGroup.meta?.title ?? 'ECO 模块' }}</span>
        </template>
        <el-menu-item
          v-for="child in ecoGroup.children"
          :key="'/eco/' + child.path"
          :index="'/eco/' + child.path"
        >
          <el-icon v-if="child.meta?.icon"><component :is="getIcon(child.meta.icon)" /></el-icon>
          <template #title>{{ child.meta?.title }}</template>
        </el-menu-item>
      </el-sub-menu>

      <!-- 5. 辅助页 (glossary / about) 作为顶级项 -->
      <el-menu-item
        v-for="route in miscRoutes"
        :key="route.path"
        :index="route.path"
      >
        <el-icon v-if="route.meta?.icon"><component :is="getIcon(route.meta.icon)" /></el-icon>
        <template #title>{{ route.meta?.title }}</template>
      </el-menu-item>
    </el-menu>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, type RouteRecordRaw } from 'vue-router';
import * as ElementPlusIconsVue from '@element-plus/icons-vue';
import { Odometer, User } from '@element-plus/icons-vue';
import router from '@/router';

defineProps<{ collapsed: boolean }>();
const emit = defineEmits<{ (e: 'toggle'): void }>();
void emit;

const route = useRoute();
const activeMenu = computed(() => route.path);

// === 分组配置 (按"端/场景"分组, UI 层配置, 不动路由表) ===
interface GroupConfig {
  key: string;
  title: string;
  icon: string;
  /** 该分组包含的路由 name 列表 */
  includes: string[];
}

const GROUP_CONFIG: GroupConfig[] = [
  {
    key: 'enterprise-mgmt',
    title: '🏢 企业管理',
    icon: 'OfficeBuilding',
    includes: ['enterprise-list', 'reform'],
  },
  {
    key: 'business-flow',
    title: '💰 业务流程',
    icon: 'Money',
    includes: ['financing', 'approval'],
  },
  {
    key: 'workbench',
    title: '🏦 各端工作台',
    icon: 'Monitor',
    includes: ['bank', 'institution', 'advisor', 'scf'],
  },
  {
    key: 'ai-fallback',
    title: '🤖 AI 与兜底',
    icon: 'SetUp',
    includes: ['cockpit', 'fallback', 'regulatory', 'partner'],
  },
];

// 从路由表找出指定 name 的路由, 返回 {path, title, icon}
function findRouteByName(name: string): { path: string; title: string; icon: string } | null {
  for (const r of router.options.routes) {
    if (r.name === name && !r.meta?.hidden) {
      return {
        path: r.path,
        title: (r.meta?.title as string) || (r.name as string),
        icon: (r.meta?.icon as string) || 'Menu',
      };
    }
  }
  return null;
}

// 按分组聚合, 跳过找不到的项
const groupedRoutes = computed(() => {
  return GROUP_CONFIG.map((g) => ({
    key: g.key,
    title: g.title,
    icon: g.icon,
    items: g.includes
      .map((name) => findRouteByName(name))
      .filter((r): r is { path: string; title: string; icon: string } => r !== null),
  })).filter((g) => g.items.length > 0);
});

// ECO 路由组 (在路由表里是 children 结构)
const ecoGroup = computed<RouteRecordRaw | null>(() => {
  return router.options.routes.find((r) => r.name === 'eco-group') ?? null;
});

// 辅助路由 (无 group, 非 home/login/eco/hidden)
const MISC_NAMES = ['glossary', 'about'];
const miscRoutes = computed(() => {
  return router.options.routes.filter((r) =>
    MISC_NAMES.includes(r.name as string) && !r.meta?.hidden,
  );
});

function getIcon(name: string) {
  return (ElementPlusIconsVue as Record<string, unknown>)[name] || ElementPlusIconsVue.Menu;
}
</script>

<style lang="scss" scoped>
.app-sidebar {
  width: $sidebar-width;
  height: 100vh;
  background: $bg-page;
  border-right: 1px solid $border-color;
  transition: width 0.28s ease;
  overflow: hidden;

  &.is-collapsed {
    width: $sidebar-collapsed-width;
  }

  .logo {
    height: $header-height;
    display: flex;
    align-items: center;
    padding: 0 $spacing-lg;
    border-bottom: 1px solid $border-color;

    .logo-icon {
      width: 28px;
      height: 28px;
      background: linear-gradient(135deg, $color-primary, $color-info);
      border-radius: $radius-base;
      color: white;
      font-weight: 700;
      font-size: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .logo-text {
      margin-left: $spacing-sm;
      font-size: $font-size-lg;
      font-weight: 600;
      color: $text-primary;
      white-space: nowrap;
    }
  }

  .sidebar-menu {
    height: calc(100vh - #{$header-height});
    border-right: none;
    overflow-y: auto;
    overflow-x: hidden;

    &:not(.el-menu--collapse) {
      width: $sidebar-width;
    }
  }
}
</style>
