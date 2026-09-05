<!-- 文件名：SlaCountdown.vue 职责：SLA 倒计时组件,任务卡显示距截止时间剩余,超期红标,每秒刷新
  -------------------------------------------------------------
  设计哲学 (project_memory 工程约定):
    - 任务看板每张任务卡显示距截止时间还剩多久, 自动超期红标
    - 已完成任务显示"已完成", 不再倒计时
    - 1 分钟级精度, 每秒刷新 (避免密集 setInterval 浪费)
    - 紧凑模式 (size=small) 用于卡片右侧; 详细模式用于任务详情抽屉

  使用:
    <SlaCountdown :due-at="task.dueAt" :status="task.status" />
    <SlaCountdown :due-at="task.dueAt" status="completed" size="small" />
-->
<template>
  <span class="sla-countdown" :class="rootClass">
    <el-icon v-if="iconName" class="sla-icon"><component :is="iconName" /></el-icon>
    <span class="sla-text">{{ displayText }}</span>
  </span>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  Clock,
  CircleCheck,
  WarningFilled,
  Timer,
} from '@element-plus/icons-vue';
import type { Component } from 'vue';

/**
 * SLA 状态联合类型:
 * - 标准状态: pending / in_progress / review / completed / cancelled
 * - Kanban 简写: todo / progress / done (与 InstitutionWorkbenchView 对齐)
 * 内部通过 statusToPhase 统一映射到 4 个阶段: pending / active / completed / cancelled
 */
type SlaStatus =
  | 'pending'
  | 'in_progress'
  | 'review'
  | 'completed'
  | 'cancelled'
  // Kanban 简写
  | 'todo'
  | 'progress'
  | 'done';

type SlaPhase = 'pending' | 'active' | 'completed' | 'cancelled';

const props = withDefaults(
  defineProps<{
    /** 截止时间 ISO 字符串或时间戳 (毫秒) */
    dueAt?: string | number | null;
    /** 任务状态, completed/cancelled/done 不再倒计时 */
    status?: SlaStatus;
    /** 尺寸: small 用于卡片, default 用于详情 */
    size?: 'small' | 'default';
  }>(),
  {
    dueAt: null,
    status: 'pending',
    size: 'default',
  },
);

/** 将扩展状态映射到内部 4 阶段 */
function statusToPhase(s: SlaStatus): SlaPhase {
  switch (s) {
    case 'completed':
    case 'done':
      return 'completed';
    case 'cancelled':
      return 'cancelled';
    case 'review':
    case 'in_progress':
    case 'progress':
      return 'active';
    case 'pending':
    case 'todo':
    default:
      return 'pending';
  }
}

const now = ref<number>(Date.now());
let timerId: number | null = null;

const phase = computed<SlaPhase>(() => statusToPhase(props.status));

onMounted(() => {
  // 已结束状态不需要刷新
  if (phase.value === 'completed' || phase.value === 'cancelled') return;
  if (!props.dueAt) return;
  // 每 1 秒刷新一次
  timerId = window.setInterval(() => {
    now.value = Date.now();
  }, 1000);
});

onBeforeUnmount(() => {
  if (timerId !== null) {
    window.clearInterval(timerId);
    timerId = null;
  }
});

const dueMs = computed<number | null>(() => {
  if (!props.dueAt) return null;
  const d = typeof props.dueAt === 'number' ? props.dueAt : Date.parse(props.dueAt);
  return Number.isNaN(d) ? null : d;
});

const isOverdue = computed<boolean>(() => {
  if (phase.value === 'completed' || phase.value === 'cancelled') return false;
  if (dueMs.value === null) return false;
  return now.value > dueMs.value;
});

const isUrgent = computed<boolean>(() => {
  if (isOverdue.value) return false;
  if (dueMs.value === null) return false;
  const diffMs = dueMs.value - now.value;
  // 24 小时内为紧急
  return diffMs > 0 && diffMs < 24 * 60 * 60 * 1000;
});

const iconName = computed<Component | null>(() => {
  if (phase.value === 'completed') return CircleCheck;
  if (phase.value === 'cancelled') return Timer;
  if (isOverdue.value) return WarningFilled;
  if (dueMs.value !== null) return Clock;
  return null;
});

const displayText = computed<string>(() => {
  if (phase.value === 'completed') return '已完成';
  if (phase.value === 'cancelled') return '已取消';
  if (dueMs.value === null) return '—';
  const diffMs = dueMs.value - now.value;
  if (diffMs <= 0) {
    // 超期: 显示超期多久
    const overdueMs = -diffMs;
    return `超期 ${humanize(overdueMs)}`;
  }
  // 未超期: 显示还剩多久
  return `剩 ${humanize(diffMs)}`;
});

const rootClass = computed(() => ({
  'is-overdue': isOverdue.value,
  'is-urgent': isUrgent.value,
  'is-completed': phase.value === 'completed',
  'is-cancelled': phase.value === 'cancelled',
  'is-small': props.size === 'small',
}));

/** 将毫秒转换为人类可读的 "1天2小时3分" 格式 */
function humanize(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  if (days > 0) {
    return `${days}天${hours}时`;
  }
  if (hours > 0) {
    return `${hours}时${mins}分`;
  }
  if (mins > 0) {
    return `${mins}分${sec % 60}秒`;
  }
  return `${sec}秒`;
}
</script>

<style lang="scss" scoped>
.sla-countdown {
  display: inline-flex;
  align-items: center;
  gap: $spacing-xs;
  font-size: $font-size-sm;
  font-weight: 500;
  color: $text-regular;
  white-space: nowrap;

  .sla-icon {
    font-size: 14px;
  }

  &.is-small {
    font-size: $font-size-xs;
    .sla-icon {
      font-size: 12px;
    }
  }

  &.is-urgent {
    color: $color-warning;
    .sla-icon {
      color: $color-warning;
    }
  }

  &.is-overdue {
    color: $color-danger;
    font-weight: 600;
    .sla-icon {
      color: $color-danger;
      animation: sla-pulse 1.4s ease-in-out infinite;
    }
  }

  &.is-completed {
    color: $color-success;
    .sla-icon {
      color: $color-success;
    }
  }

  &.is-cancelled {
    color: $text-secondary;
    text-decoration: line-through;
  }
}

@keyframes sla-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.2); }
}
</style>
