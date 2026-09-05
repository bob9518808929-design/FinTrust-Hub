<!-- 文件名：CoachMark.vue 职责：全局一键求助引导气泡,F1 触发,全屏遮罩反向挖洞高亮目标元素并分步提示
  -------------------------------------------------------------
  设计哲学 (project_memory 傻瓜式操作):
    - 任何页面按 F1 或点顶部"求助"按钮, 弹出当前页面关键元素说明
    - 全屏遮罩 + 目标元素 box-shadow 反向挖洞高亮
    - 气泡显示 标题/正文/步骤计数 + 上一步/下一步/跳过/完成
    - 暗色主题, 气泡精致 (8px 圆角 + 主色边框 + 阴影)
    - 点击遮罩 = 关闭; ESC = 关闭; 支持自动滚动到目标元素
    - 已完成的路由不再自动弹出 (由 useCoachMark 记忆)

  全局挂载位置: App.vue 末尾 <CoachMark />, 本组件自带 portal 到 body.
-->
<template>
  <Teleport to="body">
    <div v-if="coach.visible.value" class="coach-mark-root" @click.self="onMaskClick">
      <!-- 高亮框 (跟随目标元素位置/尺寸) -->
      <div
        v-if="targetRect"
        class="coach-highlight"
        :style="highlightStyle"
      >
        <span class="coach-highlight-arrow" :class="placement" />
      </div>

      <!-- 气泡卡片 -->
      <div
        v-if="targetRect && currentStep"
        class="coach-bubble"
        :class="placement"
        :style="bubbleStyle"
      >
        <div class="bubble-header">
          <div class="bubble-title">
            <el-icon><Promotion /></el-icon>
            <span>{{ currentStep.title }}</span>
          </div>
          <el-tag type="info" size="small" effect="dark" round>
            {{ currentStepIndex + 1 }} / {{ total }}
          </el-tag>
        </div>

        <div class="bubble-body">{{ currentStep.content }}</div>

        <div class="bubble-actions">
          <el-button
            v-if="!isFirst"
            size="small"
            text
            @click="coach.prev()"
          >
            <el-icon><ArrowLeft /></el-icon>
            上一步
          </el-button>

          <el-button size="small" text type="info" @click="coach.skip()">
            跳过引导
          </el-button>

          <div class="action-right">
            <el-button
              v-if="!isLast"
              type="primary"
              size="small"
              @click="coach.next()"
            >
              下一步
              <el-icon><ArrowRight /></el-icon>
            </el-button>
            <el-button
              v-else
              type="success"
              size="small"
              @click="onComplete"
            >
              <el-icon><Check /></el-icon>
              完成
            </el-button>
          </div>
        </div>
      </div>

      <!-- 无目标元素时的居中提示 (找不到 selector) -->
      <div v-else class="coach-fallback">
        <div class="fallback-card">
          <div class="fallback-title">
            <el-icon><QuestionFilled /></el-icon>
            <span>{{ currentStep?.title ?? '操作指引' }}</span>
          </div>
          <div class="fallback-body">{{ currentStep?.content ?? '当前页面暂无可高亮元素, 直接关闭即可.' }}</div>
          <div class="fallback-actions">
            <el-button size="small" text type="info" @click="coach.skip()">跳过</el-button>
            <el-button v-if="!isLast" type="primary" size="small" @click="coach.next()">下一步</el-button>
            <el-button v-else type="success" size="small" @click="onComplete">完成</el-button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useCoachMark, type CoachPlacement } from '@/composables/useCoachMark';

defineOptions({ name: 'CoachMark' });

const coach = useCoachMark();
const route = useRoute();

const targetRect = ref<DOMRect | null>(null);
const currentPlacement = ref<CoachPlacement>('bottom');

const currentStep = computed(() => coach.currentStep.value);
const placement = computed<CoachPlacement>(() => currentStep.value?.placement ?? 'bottom');
const currentStepIndex = computed(() => coach.currentStepIndex.value);
const total = computed(() => coach.total.value);
const isFirst = computed(() => coach.isFirst.value);
const isLast = computed(() => coach.isLast.value);

async function refreshTargetRect() {
  if (!currentStep.value) {
    targetRect.value = null;
    return;
  }
  const step = currentStep.value;
  let el: Element | null = null;
  try {
    el = document.querySelector(step.target) ?? (step.fallback ? document.querySelector(step.fallback) : null);
  } catch {
    el = null;
  }
  if (!el) {
    targetRect.value = null;
    return;
  }
  // 滚动到可见区域
  (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  // 等待滚动完成再测量
  await nextTick();
  // 多帧测量以兼容滚动动画
  const measure = () => {
    const r = (el as HTMLElement).getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    targetRect.value = r;
    currentPlacement.value = placement.value;
    return true;
  };
  if (!measure()) {
    requestAnimationFrame(() => requestAnimationFrame(measure));
  }
}

const highlightStyle = computed(() => {
  const r = targetRect.value;
  if (!r) return {};
  return {
    left: `${r.left}px`,
    top: `${r.top}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
  };
});

// 气泡智能定位: 默认按 placement, 边缘自动翻转
const bubbleStyle = computed(() => {
  const r = targetRect.value;
  if (!r) return {};
  const bubbleWidth = 320;
  const bubbleHeight = 180; // 估算, 实际由内容决定
  const margin = 12;
  let p = currentPlacement.value;
  let left = 0;
  let top = 0;

  // 边缘翻转
  const flipTop = r.top - bubbleHeight - margin < 8;
  const flipBottom = r.bottom + bubbleHeight + margin > window.innerHeight - 8;
  if (p === 'top' && flipTop) p = 'bottom';
  if (p === 'bottom' && flipBottom) p = 'top';
  const flipLeft = r.left - bubbleWidth - margin < 8;
  const flipRight = r.right + bubbleWidth + margin > window.innerWidth - 8;
  if (p === 'left' && flipLeft) p = 'right';
  if (p === 'right' && flipRight) p = 'left';

  if (p === 'top') {
    left = r.left + r.width / 2 - bubbleWidth / 2;
    top = r.top - bubbleHeight - margin;
  } else if (p === 'bottom') {
    left = r.left + r.width / 2 - bubbleWidth / 2;
    top = r.bottom + margin;
  } else if (p === 'left') {
    left = r.left - bubbleWidth - margin;
    top = r.top + r.height / 2 - bubbleHeight / 2;
  } else {
    // right
    left = r.right + margin;
    top = r.top + r.height / 2 - bubbleHeight / 2;
  }

  // 边界裁剪
  left = Math.max(8, Math.min(left, window.innerWidth - bubbleWidth - 8));
  top = Math.max(8, Math.min(top, window.innerHeight - bubbleHeight - 8));

  return {
    left: `${left}px`,
    top: `${top}px`,
    width: `${bubbleWidth}px`,
  };
});

function onMaskClick() {
  coach.close();
}

function onComplete() {
  coach.complete(route.name);
}

function onKeydown(e: KeyboardEvent) {
  if (!coach.visible.value) return;
  if (e.key === 'Escape') {
    coach.close();
    e.preventDefault();
  } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
    if (!isLast.value) coach.next();
    else onComplete();
    e.preventDefault();
  } else if (e.key === 'ArrowLeft') {
    if (!isFirst.value) coach.prev();
    e.preventDefault();
  }
}

// 监听 visible / currentStep 变化, 重新测量目标元素
watch(
  () => [coach.visible.value, coach.currentStepIndex.value],
  () => {
    if (coach.visible.value) {
      void refreshTargetRect();
    } else {
      targetRect.value = null;
    }
  },
  { immediate: true },
);

// 监听窗口滚动/resize, 实时同步高亮位置
function onScrollOrResize() {
  if (coach.visible.value) {
    void refreshTargetRect();
  }
}

window.addEventListener('scroll', onScrollOrResize, true);
window.addEventListener('resize', onScrollOrResize);
window.addEventListener('keydown', onKeydown);

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScrollOrResize, true);
  window.removeEventListener('resize', onScrollOrResize);
  window.removeEventListener('keydown', onKeydown);
});
</script>

<style lang="scss" scoped>
.coach-mark-root {
  position: fixed;
  inset: 0;
  z-index: 9999;

  /* 反向 box-shadow 实现"挖洞遮罩" */
  background: transparent;
  box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.78);

  /* 防止文字被选中 */
  user-select: none;
}

.coach-highlight {
  position: absolute;
  border-radius: $radius-base;
  pointer-events: none;
  z-index: 10000;
  box-shadow:
    0 0 0 2px $color-primary,
    0 0 0 6px rgba(59, 130, 246, 0.25),
    0 4px 16px rgba(0, 0, 0, 0.6);
  background: rgba(59, 130, 246, 0.06);
  transition: all 0.18s ease;

  .coach-highlight-arrow {
    position: absolute;
    width: 12px;
    height: 12px;
    background: $bg-card;
    transform: rotate(45deg);

    &.top {
      top: -8px;
      left: 50%;
      margin-left: -6px;
    }
    &.bottom {
      bottom: -8px;
      left: 50%;
      margin-left: -6px;
    }
    &.left {
      left: -8px;
      top: 50%;
      margin-top: -6px;
    }
    &.right {
      right: -8px;
      top: 50%;
      margin-top: -6px;
    }
  }
}

.coach-bubble {
  position: absolute;
  z-index: 10001;
  background: $bg-card;
  border: 1px solid $border-light;
  border-left: 4px solid $color-primary;
  border-radius: $radius-lg;
  box-shadow: $shadow-lg;
  padding: $spacing-base $spacing-lg;
  color: $text-primary;
  font-size: $font-size-base;
  transition: all 0.18s ease;
  display: flex;
  flex-direction: column;
  gap: $spacing-sm;

  .bubble-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: $spacing-sm;

    .bubble-title {
      display: flex;
      align-items: center;
      gap: $spacing-xs;
      font-size: $font-size-lg;
      font-weight: 600;
      color: $color-primary;
    }
  }

  .bubble-body {
    color: $text-regular;
    line-height: 1.6;
    white-space: pre-line;
    min-height: 40px;
  }

  .bubble-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: $spacing-sm;
    border-top: 1px dashed $border-color;
    padding-top: $spacing-sm;

    .action-right {
      margin-left: auto;
      display: flex;
      gap: $spacing-xs;
    }
  }
}

.coach-fallback {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;

  .fallback-card {
    pointer-events: auto;
    background: $bg-card;
    border: 1px solid $border-light;
    border-left: 4px solid $color-warning;
    border-radius: $radius-lg;
    box-shadow: $shadow-lg;
    padding: $spacing-lg $spacing-xl;
    min-width: 320px;
    max-width: 480px;

    .fallback-title {
      display: flex;
      align-items: center;
      gap: $spacing-sm;
      font-size: $font-size-lg;
      font-weight: 600;
      color: $color-warning;
      margin-bottom: $spacing-sm;
    }

    .fallback-body {
      color: $text-regular;
      line-height: 1.6;
      margin-bottom: $spacing-base;
    }

    .fallback-actions {
      display: flex;
      justify-content: flex-end;
      gap: $spacing-xs;
    }
  }
}
</style>
