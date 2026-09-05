<!-- 文件名：PlainButton.vue 职责：傻瓜式高亮主操作按钮,绿色大号肯定操作,禁用保留 70% 不透明度
  -------------------------------------------------------------
  设计哲学 (project_memory 傻瓜式操作):
    - 用户面对一屏按钮不知道点哪个? 这个按钮永远是"绿色大号 ✓ 动词".
    - 默认文案"✓ 采纳", 也支持自定义. 一眼能看出是"主要肯定操作".
    - 禁用时变灰且不可点击, 但保留 70% 不透明度避免"消失感".

  使用:
    <PlainButton @click="onAdopt" />                       // ✓ 采纳
    <PlainButton text="提交审批" icon="Check" />            // ✓ 提交审批
    <PlainButton text="确认放款" size="large" />
    <PlainButton text="已采纳" disabled />
-->
<template>
  <el-button
    class="plain-button"
    :class="[`is-${size}`, { 'is-block': block }]"
    type="success"
    :native-type="nativeType"
    :size="size"
    :disabled="disabled"
    :loading="loading"
    @click="onClick"
  >
    <el-icon v-if="!loading" class="plain-button-icon">
      <component :is="resolvedIcon" />
    </el-icon>
    <span class="plain-button-text">{{ displayText }}</span>
  </el-button>
</template>

<script setup lang="ts">
import { computed, type Component } from 'vue';
import { Check, Select, Promotion, Finished, CircleCheck } from '@element-plus/icons-vue';

const props = withDefaults(
  defineProps<{
    /** 按钮文案 (默认 "采纳") */
    text?: string;
    /** 图标组件 (默认 Check). 可传 Element Plus 图标或自定义 SVG 组件 */
    icon?: string | Component;
    /** 尺寸, 默认 default */
    size?: 'small' | 'default' | 'large';
    /** 是否占满父容器宽度 */
    block?: boolean;
    /** 禁用 */
    disabled?: boolean;
    /** 加载中 */
    loading?: boolean;
    /** 原生 type (默认 primary 显绿色) */
    nativeType?: 'button' | 'submit' | 'reset';
  }>(),
  {
    text: '采纳',
    icon: 'Check',
    size: 'default',
    block: false,
    disabled: false,
    loading: false,
    nativeType: 'button',
  },
);

const emit = defineEmits<{ (e: 'click', ev: MouseEvent): void }>();

const ICON_MAP: Record<string, Component> = {
  Check,
  Select,
  Promotion,
  Finished,
  CircleCheck,
};

const resolvedIcon = computed<Component>(() => {
  if (typeof props.icon === 'string') {
    return ICON_MAP[props.icon] ?? Check;
  }
  return props.icon;
});

const displayText = computed(() => {
  // 默认带 ✓ 前缀, 自定义文案不重复加
  const t = props.text ?? '采纳';
  if (/^[✓✗]/.test(t)) return t;
  return `✓ ${t}`;
});

function onClick(ev: MouseEvent) {
  emit('click', ev);
}
</script>

<style lang="scss" scoped>
.plain-button {
  /* 覆盖 Element Plus primary 默认蓝色, 改成"傻瓜绿" */
  background: $color-success !important;
  border-color: $color-success !important;
  color: white !important;
  font-weight: 600;
  letter-spacing: 0.4px;
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.35);
  transition: all 0.18s ease;
  border-radius: $radius-base;

  &:hover:not(.is-disabled) {
    background: lighten($color-success, 8%) !important;
    border-color: lighten($color-success, 8%) !important;
    box-shadow: 0 6px 20px rgba(16, 185, 129, 0.5);
    transform: translateY(-1px);
  }

  &:active:not(.is-disabled) {
    transform: translateY(0);
    box-shadow: 0 2px 6px rgba(16, 185, 129, 0.4);
  }

  &.is-disabled,
  &.is-loading {
    background: rgba(16, 185, 129, 0.45) !important;
    border-color: transparent !important;
    color: rgba(255, 255, 255, 0.7) !important;
    box-shadow: none;
    cursor: not-allowed;
  }

  &.is-large {
    padding: 12px 28px;
    font-size: $font-size-lg;
  }

  &.is-small {
    padding: 6px 14px;
    font-size: $font-size-sm;
  }

  &.is-block {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .plain-button-icon {
    margin-right: 6px;
    font-size: 16px;
  }

  .plain-button-text {
    vertical-align: middle;
  }
}
</style>
