<!-- 文件名：AppToast.vue 职责：FinTrust Hub 非阻塞 toast 通知容器,右下角滑入 6.5s 自动消失,z-index 9500,队列上限 3
  -------------------------------------------------------------
  设计哲学 (project_memory 硬约束):
    - 信息通知用非阻塞 toast (右下角滑入, 6.5s 自动消失)
    - 不可逆决策用阻塞模态窗 (见 AppConfirmModal)
    - z-index = 9500 (低于模态窗 10000)
    - 所有 AI 通知 toast 含 × 关闭按钮 + 操作按钮 (如 "✓ 采纳并跳转")
    - toast 队列上限 3, 超限自动降级为最简单的 toast (不再带操作按钮)
    - 入场/出场动画: 右下角滑入, 透明度淡入

  使用:
    <AppToast />  // 全局挂载一次 (App.vue 末尾)
    const toast = useToast();
    toast.info('已生成报告', { actionLabel: '查看', onAction: () => {...} });
    toast.success('审批通过');
    toast.warning('SLA 即将超期');
    toast.error('提交失败, 请重试');
    toast.ai('AI 建议已就绪', { actionLabel: '采纳并跳转', onAction: jumpToBank });

  实现:
    - 单例 store (无需 Pinia), 全局响应式队列
    - useToast() 任意组件调用推送
-->
<template>
  <Teleport to="body">
    <div class="app-toast-root" role="region" aria-live="polite" aria-label="通知">
      <transition-group name="toast-slide" tag="div" class="toast-stack">
        <div
          v-for="item in queue"
          :key="item.id"
          class="toast-item"
          :class="[`is-${item.type}`, { 'is-compact': item.compact }]"
          @mouseenter="onMouseEnter(item.id)"
          @mouseleave="onMouseLeave(item.id)"
        >
          <el-icon class="toast-icon"><component :is="iconFor(item.type)" /></el-icon>

          <div class="toast-body">
            <div v-if="item.title" class="toast-title">{{ item.title }}</div>
            <div class="toast-message">{{ item.message }}</div>
          </div>

          <div v-if="item.actionLabel" class="toast-action">
            <button
              type="button"
              class="action-btn"
              @click="onAction(item.id)"
            >
              {{ item.actionLabel }}
            </button>
          </div>

          <button
            type="button"
            class="toast-close"
            aria-label="关闭通知"
            @click="dismiss(item.id)"
          >
            <el-icon><Close /></el-icon>
          </button>

          <div v-if="!item.paused" class="toast-progress">
            <div class="toast-progress-bar" :style="{ animationDuration: `${item.duration}ms` }" />
          </div>
        </div>
      </transition-group>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { onBeforeUnmount } from 'vue';
import {
  SuccessFilled,
  WarningFilled,
  CircleCloseFilled,
  InfoFilled,
  MagicStick,
  Close,
} from '@element-plus/icons-vue';
import type { Component } from 'vue';

defineOptions({ name: 'AppToast' });

export type ToastType = 'info' | 'success' | 'warning' | 'error' | 'ai';

export interface ToastItem {
  id: number;
  type: ToastType;
  title?: string;
  message: string;
  duration: number; // 0 = 手动关闭
  actionLabel?: string;
  onAction?: () => void;
  compact: boolean; // 队列超限时降级为紧凑 (无操作按钮)
  paused: boolean; // 鼠标悬停时暂停自动消失
}

// === 单例响应式队列 (模块级单例, 不需要 Pinia) ===
import { ref } from 'vue';

const queue = ref<ToastItem[]>([]);
const QUEUE_LIMIT = 3; // project_memory: AI 决策弹窗队列上限 3
const DEFAULT_DURATION = 6500; // project_memory: 6.5s 自动消失

let nextId = 1;
const timers = new Map<number, number>();

function iconFor(type: ToastType): Component {
  switch (type) {
    case 'success':
      return SuccessFilled;
    case 'warning':
      return WarningFilled;
    case 'error':
      return CircleCloseFilled;
    case 'ai':
      return MagicStick;
    default:
      return InfoFilled;
  }
}

function push(opts: {
  type?: ToastType;
  title?: string;
  message: string;
  duration?: number;
  actionLabel?: string;
  onAction?: () => void;
}): number {
  const type = opts.type ?? 'info';
  const duration = opts.duration ?? DEFAULT_DURATION;
  // 队列超限时降级为紧凑模式 (无操作按钮)
  const compact = queue.value.length >= QUEUE_LIMIT;
  const item: ToastItem = {
    id: nextId++,
    type,
    title: opts.title,
    message: opts.message,
    duration,
    actionLabel: compact ? undefined : opts.actionLabel,
    onAction: opts.onAction,
    compact,
    paused: false,
  };
  queue.value.push(item);
  if (duration > 0) {
    const tid = window.setTimeout(() => dismiss(item.id), duration);
    timers.set(item.id, tid);
  }
  return item.id;
}

function dismiss(id: number): void {
  const idx = queue.value.findIndex((t) => t.id === id);
  if (idx >= 0) {
    queue.value.splice(idx, 1);
  }
  const tid = timers.get(id);
  if (tid !== undefined) {
    window.clearTimeout(tid);
    timers.delete(id);
  }
}

function onMouseEnter(id: number): void {
  const item = queue.value.find((t) => t.id === id);
  if (item) item.paused = true;
  const tid = timers.get(id);
  if (tid !== undefined) {
    window.clearTimeout(tid);
    timers.delete(id);
  }
}

function onMouseLeave(id: number): void {
  const item = queue.value.find((t) => t.id === id);
  if (!item || item.duration === 0) return;
  item.paused = false;
  // 重启计时 (剩余时间不再精确, 重置为完整 duration, 用户能多看一会也无妨)
  const tid = window.setTimeout(() => dismiss(id), item.duration);
  timers.set(id, tid);
}

function onAction(id: number): void {
  const item = queue.value.find((t) => t.id === id);
  if (!item) return;
  try {
    item.onAction?.();
  } finally {
    dismiss(id);
  }
}

// 清空所有 toast (路由切换时调用)
function clearAll(): void {
  timers.forEach((tid) => window.clearTimeout(tid));
  timers.clear();
  queue.value.splice(0, queue.value.length);
}

onBeforeUnmount(() => {
  clearAll();
});

// === 暴露 useToast API ===
defineExpose({
  push,
  dismiss,
  clearAll,
  info: (msg: string, opts?: { title?: string; actionLabel?: string; onAction?: () => void }) =>
    push({ ...opts, type: 'info', message: msg }),
  success: (msg: string, opts?: { title?: string; actionLabel?: string; onAction?: () => void }) =>
    push({ ...opts, type: 'success', message: msg }),
  warning: (msg: string, opts?: { title?: string; actionLabel?: string; onAction?: () => void }) =>
    push({ ...opts, type: 'warning', message: msg }),
  error: (msg: string, opts?: { title?: string; actionLabel?: string; onAction?: () => void }) =>
    push({ ...opts, type: 'error', message: msg }),
  ai: (msg: string, opts?: { title?: string; actionLabel?: string; onAction?: () => void }) =>
    push({ ...opts, type: 'ai', message: msg, title: opts?.title ?? 'AI 研判建议' }),
});
</script>

<style lang="scss" scoped>
.app-toast-root {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: $z-toast; /* project_memory: 9500 */
  pointer-events: none;
  max-width: 380px;

  .toast-stack {
    display: flex;
    flex-direction: column-reverse; /* 后入的在底部, 视觉上最新的在底部 */
    gap: $spacing-sm;
  }
}

.toast-item {
  position: relative;
  pointer-events: auto;
  display: flex;
  align-items: flex-start;
  gap: $spacing-sm;
  padding: $spacing-sm $spacing-base;
  padding-right: 56px; /* 关闭按钮预留 */
  background: $bg-card;
  border: 1px solid $border-color;
  border-left: 4px solid $color-info;
  border-radius: $radius-lg;
  box-shadow: $shadow-lg;
  color: $text-primary;
  min-width: 280px;
  overflow: hidden;

  &.is-success {
    border-left-color: $color-success;
    .toast-icon { color: $color-success; }
    .toast-progress-bar { background: $color-success; }
  }
  &.is-warning {
    border-left-color: $color-warning;
    .toast-icon { color: $color-warning; }
    .toast-progress-bar { background: $color-warning; }
  }
  &.is-error {
    border-left-color: $color-danger;
    .toast-icon { color: $color-danger; }
    .toast-progress-bar { background: $color-danger; }
  }
  &.is-ai {
    border-left-color: $color-primary;
    background: linear-gradient(135deg, $bg-card 0%, rgba(59, 130, 246, 0.08) 100%);
    .toast-icon { color: $color-primary; }
    .toast-progress-bar { background: $color-primary; }
  }
  &.is-info {
    border-left-color: $color-info;
    .toast-icon { color: $color-info; }
    .toast-progress-bar { background: $color-info; }
  }

  &.is-compact {
    padding-right: 32px;
    .toast-action {
      display: none;
    }
  }

  .toast-icon {
    font-size: 20px;
    flex-shrink: 0;
    margin-top: 2px;
  }

  .toast-body {
    flex: 1;
    min-width: 0;

    .toast-title {
      font-size: $font-size-base;
      font-weight: 600;
      color: $text-primary;
      margin-bottom: 2px;
    }
    .toast-message {
      font-size: $font-size-sm;
      color: $text-regular;
      line-height: 1.5;
      word-break: break-word;
    }
  }

  .toast-action {
    flex-shrink: 0;
    align-self: center;

    .action-btn {
      background: rgba(59, 130, 246, 0.15);
      color: $color-primary;
      border: 1px solid rgba(59, 130, 246, 0.4);
      border-radius: $radius-base;
      padding: 4px 10px;
      font-size: $font-size-xs;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;

      &:hover {
        background: rgba(59, 130, 246, 0.3);
        border-color: $color-primary;
      }
    }
  }

  .toast-close {
    position: absolute;
    top: 8px;
    right: 8px;
    background: transparent;
    border: 0;
    color: $text-secondary;
    cursor: pointer;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: $radius-sm;
    transition: all 0.15s ease;

    &:hover {
      background: $bg-hover;
      color: $text-primary;
    }
  }

  .toast-progress {
    position: absolute;
    left: 0;
    bottom: 0;
    width: 100%;
    height: 2px;
    background: rgba(255, 255, 255, 0.06);

    .toast-progress-bar {
      height: 100%;
      width: 100%;
      animation: toast-progress linear forwards;
      transform-origin: left center;
    }
  }
}

@keyframes toast-progress {
  from { transform: scaleX(1); }
  to { transform: scaleX(0); }
}

/* 入场: 右下角滑入 */
.toast-slide-enter-active,
.toast-slide-leave-active {
  transition: all 0.35s cubic-bezier(0.22, 1, 0.36, 1);
}
.toast-slide-enter-from {
  opacity: 0;
  transform: translateX(40px);
}
.toast-slide-leave-to {
  opacity: 0;
  transform: translateX(40px);
}
.toast-slide-move {
  transition: transform 0.35s ease;
}
</style>
