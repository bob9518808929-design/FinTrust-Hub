<!--
  AppConfirmModal.vue — FinTrust Hub 阻塞式二次确认模态窗
  -------------------------------------------------------------
  设计哲学 (project_memory 硬约束):
    - 不可逆决策必须用阻塞模态窗 (z-index=10000), 二次确认避免误操作
    - Tab3 审批台 / Tab4 银行风控的不可逆决策: 通过/拒绝/放款/冻结
    - 不让用户做选择题, 只让用户做判断题 (是/否 二选一)
    - 危险操作 (如归档/冻结/标记误报) 显示红色 CTA + 警示语
    - 提供"决策依据"区域: 路由原因 / 资金水位 / 监管账户余额 等
    - 支持填写"操作原因" (审计追溯)

  使用:
    <AppConfirmModal
      v-model="visible"
      title="确认冻结监管账户?"
      :type="'danger'"
      :context="[
        { label: '账户ID', value: 'ACC-001' },
        { label: '当前余额', value: '¥1,234,567.89' },
      ]"
      confirm-text="确认冻结"
      cancel-text="取消"
      reason-required
      @confirm="onConfirm"
    />
-->
<template>
  <el-dialog
    :model-value="modelValue"
    :title="title"
    :width="width"
    :close-on-click-modal="false"
    :close-on-press-escape="!reasonRequired"
    :show-close="!reasonRequired"
    append-to-body
    align-center
    custom-class="app-confirm-modal"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
    @close="onClose"
  >
    <div class="confirm-body">
      <!-- 警示语 (danger 才显示) -->
      <div v-if="type === 'danger'" class="warning-banner">
        <el-icon class="warning-icon"><WarningFilled /></el-icon>
        <span class="warning-text">
          此操作<strong>不可撤回</strong>, 请再次确认后再继续.
        </span>
      </div>

      <!-- 决策依据区 -->
      <el-descriptions
        v-if="context && context.length > 0"
        :column="1"
        border
        size="small"
        class="confirm-context"
      >
        <el-descriptions-item
          v-for="item in context"
          :key="item.label"
          :label="item.label"
        >
          {{ item.value }}
        </el-descriptions-item>
      </el-descriptions>

      <!-- 自定义额外内容插槽 -->
      <div v-if="$slots.default" class="confirm-extra">
        <slot />
      </div>

      <!-- 操作原因输入 (reasonRequired 时必填) -->
      <div v-if="reasonRequired || reasonOptional" class="reason-block">
        <label class="reason-label">
          {{ reasonRequired ? '操作原因 (必填)' : '操作原因 (可选)' }}
        </label>
        <el-input
          v-model="reasonValue"
          type="textarea"
          :rows="2"
          :placeholder="reasonPlaceholder"
          maxlength="200"
          show-word-limit
        />
      </div>
    </div>

    <template #footer>
      <div class="confirm-footer">
        <el-button @click="onCancel">
          {{ cancelText }}
        </el-button>
        <el-button
          :type="confirmButtonType"
          :disabled="reasonRequired && !reasonValue.trim()"
          :loading="loading"
          @click="onConfirm"
        >
          <el-icon v-if="type === 'danger'" class="mr-4"><WarningFilled /></el-icon>
          {{ confirmText }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { WarningFilled } from '@element-plus/icons-vue';

export interface ConfirmContextItem {
  label: string;
  value: string | number;
}

const props = withDefaults(
  defineProps<{
    /** v-model 控制显示 */
    modelValue: boolean;
    /** 模态窗标题 */
    title: string;
    /** 模态窗类型: danger=危险操作, warning=警告, primary=正常 */
    type?: 'danger' | 'warning' | 'primary';
    /** 决策依据上下文 (label/value 列表) */
    context?: ConfirmContextItem[];
    /** 确认按钮文案 */
    confirmText?: string;
    /** 取消按钮文案 */
    cancelText?: string;
    /** 是否必填原因 */
    reasonRequired?: boolean;
    /** 是否可选填原因 (默认 false, true 时显示输入框但不强制) */
    reasonOptional?: boolean;
    /** 原因输入框 placeholder */
    reasonPlaceholder?: string;
    /** 宽度 */
    width?: string;
    /** 确认按钮 loading 状态 */
    loading?: boolean;
  }>(),
  {
    type: 'primary',
    context: () => [],
    confirmText: '确认',
    cancelText: '取消',
    reasonRequired: false,
    reasonOptional: false,
    reasonPlaceholder: '请说明本次操作原因, 用于审计追溯',
    width: '520px',
    loading: false,
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
  (e: 'confirm', reason: string): void;
  (e: 'cancel'): void;
  (e: 'close'): void;
}>();

const reasonValue = ref<string>('');

// 每次打开时清空原因
watch(
  () => props.modelValue,
  (v) => {
    if (v) reasonValue.value = '';
  },
);

const confirmButtonType = computed<'danger' | 'warning' | 'primary'>(() => {
  switch (props.type) {
    case 'danger':
      return 'danger';
    case 'warning':
      return 'warning';
    default:
      return 'primary';
  }
});

function onConfirm(): void {
  if (props.reasonRequired && !reasonValue.value.trim()) return;
  emit('confirm', reasonValue.value.trim());
}

function onCancel(): void {
  emit('cancel');
  emit('update:modelValue', false);
}

function onClose(): void {
  emit('close');
}
</script>

<style lang="scss">
/* 注意: el-dialog 通过 append-to-body 挂到 body, 不能用 scoped */
.app-confirm-modal {
  z-index: $z-modal !important; /* project_memory: 10000 */

  .el-dialog__header {
    background: $bg-tertiary;
    border-bottom: 1px solid $border-color;
    padding: 14px 20px;
    margin-right: 0;
    border-top-left-radius: $radius-lg;
    border-top-right-radius: $radius-lg;

    .el-dialog__title {
      color: $text-primary;
      font-weight: 600;
      font-size: $font-size-lg;
    }
  }

  .el-dialog__body {
    background: $bg-card;
    padding: 20px;
  }

  .el-dialog__footer {
    background: $bg-card;
    border-top: 1px solid $border-color;
    padding: 12px 20px;
    border-bottom-left-radius: $radius-lg;
    border-bottom-right-radius: $radius-lg;
  }

  .confirm-body {
    display: flex;
    flex-direction: column;
    gap: $spacing-base;

    .warning-banner {
      display: flex;
      align-items: center;
      gap: $spacing-sm;
      padding: $spacing-sm $spacing-base;
      background: rgba(239, 68, 68, 0.12);
      border: 1px solid rgba(239, 68, 68, 0.4);
      border-radius: $radius-base;

      .warning-icon {
        color: $color-danger;
        font-size: 20px;
        flex-shrink: 0;
      }
      .warning-text {
        color: $color-danger;
        font-size: $font-size-sm;
        font-weight: 500;

        strong {
          font-weight: 700;
          text-decoration: underline;
        }
      }
    }

    .confirm-extra {
      padding: $spacing-sm 0;
    }

    .reason-block {
      .reason-label {
        display: block;
        margin-bottom: $spacing-xs;
        font-size: $font-size-sm;
        color: $text-regular;
        font-weight: 500;
      }
    }
  }

  .confirm-footer {
    display: flex;
    justify-content: flex-end;
    gap: $spacing-sm;
  }
}

.mr-4 {
  margin-right: 4px;
}
</style>
