<!-- 文件名：AppHeader.vue 职责：应用页头组件,含侧栏折叠按钮、面包屑与右侧操作区 -->
<template>
  <header class="app-header">
    <div class="header-left">
      <el-icon class="collapse-btn" @click="$emit('toggle-sidebar')">
        <Fold v-if="!collapsed" />
        <Expand v-else />
      </el-icon>
      <el-breadcrumb separator="/">
        <el-breadcrumb-item :to="{ path: '/' }">工作台</el-breadcrumb-item>
        <el-breadcrumb-item>{{ currentTitle }}</el-breadcrumb-item>
      </el-breadcrumb>
    </div>

    <div class="header-right">
      <el-select
        v-model="enterpriseStore.currentEnterpriseId"
        placeholder="选择企业"
        class="enterprise-select"
        @change="onEnterpriseChange"
      >
        <el-option
          v-for="ent in enterpriseStore.enterprises"
          :key="ent.id"
          :label="ent.name"
          :value="ent.id"
        >
          <span style="float: left">{{ ent.name }}</span>
          <span style="float: right; color: #8492a6; font-size: 12px">
            {{ ent.industryLabel }}
          </span>
        </el-option>
      </el-select>

      <el-badge :value="alertCount" :hidden="alertCount === 0" class="alert-badge">
        <el-icon class="header-icon"><Bell /></el-icon>
      </el-badge>

      <!-- UX-05 一键求助按钮 (红色显眼, 按 F1 也可触发) -->
      <el-tooltip content="看不懂? 点这里或按 F1 求助" placement="bottom" effect="dark">
        <el-button
          class="help-button"
          type="danger"
          :icon="QuestionFilled"
          circle
          @click="onHelpClick"
        />
      </el-tooltip>

      <el-dropdown @command="onCommand">
        <span class="user-info">
          <el-avatar :size="28" class="user-avatar">顾问</el-avatar>
          <span class="user-name">财务顾问</span>
          <el-icon><ArrowDown /></el-icon>
        </span>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="profile">个人中心</el-dropdown-item>
            <el-dropdown-item command="settings">系统设置</el-dropdown-item>
            <el-dropdown-item command="guide">📖 操作指引</el-dropdown-item>
            <el-dropdown-item command="logout" divided>退出登录</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { QuestionFilled } from '@element-plus/icons-vue';
import { useEnterpriseStore } from '@/stores/enterprise';
import { useCoachMark } from '@/composables/useCoachMark';
import { useAlertStore } from '@/stores/alertStore';

defineProps<{ collapsed: boolean }>();
defineEmits<{ (e: 'toggle-sidebar'): void }>();

const route = useRoute();
const router = useRouter();
const enterpriseStore = useEnterpriseStore();
const coach = useCoachMark();
const alertStore = useAlertStore();
const alertCount = computed(() => alertStore.count);

const currentTitle = computed(() => (route.meta?.title as string) || '页面');

async function onEnterpriseChange(id: string) {
  await enterpriseStore.switchEnterprise(id);
  ElMessage.success('已切换企业, 全局告警已清空');
}

/**
 * 一键求助按钮回调 (UX-05).
 * 弹出当前路由默认引导; 已完成时弹确认框问是否再看一遍.
 */
function onHelpClick() {
  if (coach.visible.value) return; // 已经在显示, 不重复弹
  const tour = coach.getTourForRoute(route.name);
  if (tour.length === 0) {
    ElMessage.info('当前页面暂无引导, 可在工作台首页按 F1 体验');
    return;
  }
  if (coach.isRouteCompleted(route.name)) {
    ElMessageBox.confirm(
      '本页引导你已经看过一遍, 要再看一次吗?',
      '一键求助',
      { confirmButtonText: '再看一遍', cancelButtonText: '不用了', type: 'info' },
    )
      .then(() => coach.startTourForRoute(route.name, { force: true }))
      .catch(() => {/* 用户取消, 不再弹 */});
    return;
  }
  coach.startTourForRoute(route.name, { force: true });
}

function onCommand(command: string) {
  switch (command) {
    case 'profile':
      // 复用财务顾问运营台作为个人中心 (P2 独立 profile 页待规划)
      router.push({ name: 'advisor' });
      break;
    case 'settings':
      ElMessage.info('系统设置暂未开放, 当前版本通过浏览器开发者工具调整');
      break;
    case 'guide':
      // project_memory: 操作指南按钮显眼, 永远可见. 复用 Coach Mark 引导.
      onHelpClick();
      break;
    case 'logout':
      localStorage.removeItem('fintrust-token');
      ElMessage.success('已退出登录');
      window.location.href = '/';
      break;
  }
}
</script>

<style lang="scss" scoped>
.app-header {
  height: $header-height;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 $spacing-xl;
  background: $bg-page;
  border-bottom: 1px solid $border-color;

  .header-left {
    display: flex;
    align-items: center;
    gap: $spacing-base;

    .collapse-btn {
      font-size: 20px;
      cursor: pointer;
      color: $text-regular;

      &:hover {
        color: $color-primary;
      }
    }
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: $spacing-lg;

    .enterprise-select {
      width: 220px;
    }

    .header-icon {
      font-size: 18px;
      cursor: pointer;
      color: $text-regular;

      &:hover {
        color: $color-primary;
      }
    }

    /* UX-05 求助按钮: 红色显眼 + 微脉冲动画提示新手 */
    .help-button {
      width: 32px;
      height: 32px;
      padding: 0;
      font-size: 18px;
      box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.6);
      animation: help-pulse 2.4s ease-out infinite;

      &:hover {
        animation-play-state: paused;
        transform: scale(1.08);
      }
    }

    @keyframes help-pulse {
      0% {
        box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.6);
      }
      70% {
        box-shadow: 0 0 0 10px rgba(239, 68, 68, 0);
      }
      100% {
        box-shadow: 0 0 0 0 rgba(239, 68, 68, 0);
      }
    }

    .user-info {
      display: flex;
      align-items: center;
      gap: $spacing-sm;
      cursor: pointer;

      .user-avatar {
        background: $color-primary;
        color: white;
        font-size: 12px;
      }

      .user-name {
        font-size: $font-size-base;
        color: $text-regular;
      }
    }
  }
}
</style>
