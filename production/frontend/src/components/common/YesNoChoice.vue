<!-- 文件名：YesNoChoice.vue 职责：是/否二选一组件,绿红大号按钮代替下拉,支持自定义场景化文案与 v-model
  -------------------------------------------------------------
  设计哲学 (project_memory 傻瓜式操作):
    不让用户做选择题, 只让用户做判断题.
    用两个大号绿/红按钮代替下拉/单选, 默认文案 "是 / 否",
    支持自定义场景化文案 (如 "立即放款 / 暂不放款").
    双向绑定 v-model = boolean.

  使用:
    <YesNoChoice v-model="answer" @change="onChange" />
    <YesNoChoice
      v-model="approved"
      yes-text="同意放款"
      no-text="打回补充资料"
      question="是否同意本次 80 万贷款放款?"
    />
-->
<template>
  <div class="yes-no-choice" :class="{ 'is-answered': modelValue !== null }">
    <div v-if="question" class="question">
      <el-icon class="question-icon"><QuestionFilled /></el-icon>
      <span>{{ question }}</span>
    </div>

    <div class="choices">
      <button
        type="button"
        class="choice yes"
        :class="{ active: modelValue === true }"
        :disabled="disabled"
        @click="choose(true)"
      >
        <el-icon class="choice-icon"><CircleCheck /></el-icon>
        <span class="choice-text">{{ yesText }}</span>
      </button>

      <button
        type="button"
        class="choice no"
        :class="{ active: modelValue === false }"
        :disabled="disabled"
        @click="choose(false)"
      >
        <el-icon class="choice-icon"><CircleClose /></el-icon>
        <span class="choice-text">{{ noText }}</span>
      </button>
    </div>

    <div v-if="hint && modelValue !== null" class="hint" :class="modelValue ? 'hint-yes' : 'hint-no'">
      <el-icon><InfoFilled /></el-icon>
      <span>{{ modelValue ? yesHint : noHint }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { CircleCheck, CircleClose, QuestionFilled, InfoFilled } from '@element-plus/icons-vue';

const props = withDefaults(
  defineProps<{
    /** 双向绑定, null=未选, true=是, false=否 */
    modelValue: boolean | null;
    /** 顶部问题文案 (可选) */
    question?: string;
    /** "是" 按钮文案 */
    yesText?: string;
    /** "否" 按钮文案 */
    noText?: string;
    /** 选 "是" 后的提示 */
    yesHint?: string;
    /** 选 "否" 后的提示 */
    noHint?: string;
    /** 禁用 (已确认后只读) */
    disabled?: boolean;
  }>(),
  {
    modelValue: null,
    yesText: '是',
    noText: '否',
    yesHint: '已记录你的选择: 是',
    noHint: '已记录你的选择: 否',
    disabled: false,
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
  (e: 'change', v: boolean): void;
}>();

const hint = computed(() => props.modelValue !== null);

function choose(v: boolean) {
  if (props.disabled) return;
  emit('update:modelValue', v);
  emit('change', v);
}
</script>

<style lang="scss" scoped>
.yes-no-choice {
  display: flex;
  flex-direction: column;
  gap: $spacing-base;

  .question {
    display: flex;
    align-items: center;
    gap: $spacing-sm;
    color: $text-primary;
    font-size: $font-size-base;
    font-weight: 500;

    .question-icon {
      color: $color-warning;
      font-size: 18px;
    }
  }

  .choices {
    display: flex;
    gap: $spacing-base;
    flex-wrap: wrap;
  }

  .choice {
    flex: 1;
    min-width: 140px;
    padding: 16px 20px;
    border: 2px solid $border-color;
    background: $bg-tertiary;
    color: $text-regular;
    border-radius: $radius-lg;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: $spacing-sm;
    font-size: $font-size-lg;
    font-weight: 600;
    transition: all 0.18s ease;

    .choice-icon {
      font-size: 22px;
    }

    &:hover:not(:disabled) {
      transform: translateY(-2px);
      border-color: $border-lighter;
    }

    &:disabled {
      cursor: not-allowed;
      opacity: 0.6;
    }

    &.yes {
      &:hover:not(:disabled):not(.active) {
        border-color: $color-success;
        color: $color-success;
      }

      &.active {
        background: $color-success;
        border-color: $color-success;
        color: white;
        box-shadow: 0 6px 16px rgba(16, 185, 129, 0.4);
      }
    }

    &.no {
      &:hover:not(:disabled):not(.active) {
        border-color: $color-danger;
        color: $color-danger;
      }

      &.active {
        background: $color-danger;
        border-color: $color-danger;
        color: white;
        box-shadow: 0 6px 16px rgba(239, 68, 68, 0.4);
      }
    }
  }

  .hint {
    display: flex;
    align-items: center;
    gap: $spacing-xs;
    padding: $spacing-sm $spacing-base;
    border-radius: $radius-base;
    font-size: $font-size-sm;

    &.hint-yes {
      background: rgba(16, 185, 129, 0.12);
      color: $color-success;
    }
    &.hint-no {
      background: rgba(239, 68, 68, 0.12);
      color: $color-danger;
    }
  }
}
</style>
