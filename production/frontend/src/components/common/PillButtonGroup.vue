<!-- 文件名：PillButtonGroup.vue 职责：多选 pill 按钮组,药丸状高亮已选项,支持图标/颜色配置与多选切换
  -------------------------------------------------------------
  设计哲学 (project_memory 硬约束):
    - 合作模式 (企业/银行/担保/保险) 必须支持多选, 而非单选 select
    - 使用 pill 按钮 (药丸状), 高亮显示已选项直观可见
    - 切换企业后保持选中状态 (由调用方持久化)
    - 每个选项可配置图标/颜色, 视觉上直观区分
    - 不让用户做选择题 (单选), 只让用户做"是否启用"的判断题 (多 pill 切换)

  使用:
    <PillButtonGroup
      v-model="selectedModes"
      :options="[
        { value: 'enterprise', label: '企业模式', icon: 'OfficeBuilding' },
        { value: 'bank', label: '银行模式', icon: 'CreditCard' },
        { value: 'guarantee', label: '担保模式', icon: 'Shield' },
        { value: 'insurance', label: '保险模式', icon: 'Umbrella' },
      ]"
      :multiple="true"
    />
-->
<template>
  <div
    class="pill-button-group"
    :class="{ 'is-disabled': disabled }"
    role="group"
    :aria-label="ariaLabel"
  >
    <button
      v-for="opt in options"
      :key="String(opt.value)"
      type="button"
      class="pill-btn"
      :class="[
        `is-${opt.color ?? 'default'}`,
        {
          'is-active': isSelected(opt.value),
          'is-disabled': opt.disabled,
        },
      ]"
      :disabled="disabled || opt.disabled"
      @click="onClick(opt.value)"
    >
      <el-icon v-if="opt.icon" class="pill-icon">
        <component :is="resolveIcon(opt.icon)" />
      </el-icon>
      <span class="pill-label">{{ opt.label }}</span>
      <el-icon v-if="isSelected(opt.value)" class="pill-check">
        <Check />
      </el-icon>
    </button>
  </div>
</template>

<script setup lang="ts">
import { type Component } from 'vue';
import { Check } from '@element-plus/icons-vue';
import * as ElIcons from '@element-plus/icons-vue';

export type PillColor = 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

export interface PillOption<V extends string | number = string> {
  value: V;
  label: string;
  /** 图标名 (Element Plus 图标组件名, 如 'OfficeBuilding') 或自定义组件 */
  icon?: string | Component;
  /** 颜色主题 */
  color?: PillColor;
  /** 单独禁用 */
  disabled?: boolean;
}

const props = withDefaults(
  defineProps<{
    /** v-model: 选中值数组 (多选) 或单值 (单选模式) */
    modelValue: string[] | string | null;
    /** 选项列表 */
    options: PillOption[];
    /** 是否多选, 默认 true (project_memory: 合作模式必须多选) */
    multiple?: boolean;
    /** 全组禁用 */
    disabled?: boolean;
    /** 语义化 aria-label, 默认 '选项组' */
    ariaLabel?: string;
  }>(),
  {
    multiple: true,
    disabled: false,
    ariaLabel: '选项组',
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', v: string[]): void;
  (e: 'change', v: string[]): void;
}>();

function resolveIcon(icon: string | Component): Component {
  if (typeof icon === 'string') {
    const comp = (ElIcons as Record<string, Component>)[icon];
    if (comp) return comp;
    console.warn(`[PillButtonGroup] 未找到图标: ${icon}`);
    return Check;
  }
  return icon;
}

function isSelected(value: string | number): boolean {
  if (Array.isArray(props.modelValue)) {
    return props.modelValue.includes(String(value));
  }
  if (props.modelValue === null) return false;
  return props.modelValue === String(value);
}

function onClick(value: string | number): void {
  const v = String(value);
  if (props.multiple) {
    const arr = Array.isArray(props.modelValue) ? [...props.modelValue] : [];
    const idx = arr.indexOf(v);
    if (idx >= 0) {
      arr.splice(idx, 1);
    } else {
      arr.push(v);
    }
    emit('update:modelValue', arr);
    emit('change', arr);
  } else {
    // 单选模式
    const current = Array.isArray(props.modelValue)
      ? props.modelValue[0] ?? null
      : props.modelValue;
    const next = current === v ? '' : v;
    emit('update:modelValue', next ? [next] : []);
    emit('change', next ? [next] : []);
  }
}
</script>

<style lang="scss" scoped>
.pill-button-group {
  display: inline-flex;
  flex-wrap: wrap;
  gap: $spacing-sm;

  &.is-disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
}

.pill-btn {
  display: inline-flex;
  align-items: center;
  gap: $spacing-xs;
  padding: 6px 14px;
  border-radius: 999px;
  border: 1px solid $border-color;
  background: $bg-tertiary;
  color: $text-regular;
  font-size: $font-size-sm;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.18s ease;
  white-space: nowrap;

  .pill-icon {
    font-size: 14px;
  }

  &:hover:not(.is-disabled):not(.is-active) {
    border-color: $border-lighter;
    color: $text-primary;
    background: $bg-hover;
  }

  &.is-disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  /* 未选中状态: 按 color 区分 */
  &.is-default {
    &:hover:not(.is-disabled) {
      border-color: $color-info;
      color: $color-info;
    }
  }
  &.is-primary {
    &:hover:not(.is-disabled) {
      border-color: $color-primary;
      color: $color-primary;
    }
  }
  &.is-success {
    &:hover:not(.is-disabled) {
      border-color: $color-success;
      color: $color-success;
    }
  }
  &.is-warning {
    &:hover:not(.is-disabled) {
      border-color: $color-warning;
      color: $color-warning;
    }
  }
  &.is-danger {
    &:hover:not(.is-disabled) {
      border-color: $color-danger;
      color: $color-danger;
    }
  }
  &.is-info {
    &:hover:not(.is-disabled) {
      border-color: $color-info;
      color: $color-info;
    }
  }

  /* 选中状态: 实色背景 + 白字 */
  &.is-active {
    &.is-default {
      background: $color-info;
      border-color: $color-info;
      color: white;
    }
    &.is-primary {
      background: $color-primary;
      border-color: $color-primary;
      color: white;
      box-shadow: 0 2px 8px rgba(59, 130, 246, 0.35);
    }
    &.is-success {
      background: $color-success;
      border-color: $color-success;
      color: white;
      box-shadow: 0 2px 8px rgba(16, 185, 129, 0.35);
    }
    &.is-warning {
      background: $color-warning;
      border-color: $color-warning;
      color: white;
      box-shadow: 0 2px 8px rgba(245, 158, 11, 0.35);
    }
    &.is-danger {
      background: $color-danger;
      border-color: $color-danger;
      color: white;
      box-shadow: 0 2px 8px rgba(239, 68, 68, 0.35);
    }
    &.is-info {
      background: $color-info;
      border-color: $color-info;
      color: white;
      box-shadow: 0 2px 8px rgba(99, 102, 241, 0.35);
    }

    .pill-check {
      font-size: 12px;
    }
  }
}
</style>
