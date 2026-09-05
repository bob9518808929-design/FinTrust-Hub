<!-- 文件名：PlainTextTooltip.vue 职责：金融术语白话文翻译气泡,悬停显示一句通俗解释,支持内联任意文本
  -------------------------------------------------------------
  设计哲学 (project_memory 傻瓜式操作):
  金融术语对老板/仓管/物流工人是天书, 悬停即可看到一句白话文翻译,
  不用切页, 不用百度, 不用问人.

  使用方式 (内联任意文本):
    <PlainTextTooltip term="反向保理">反向保理</PlainTextTooltip>
    <PlainTextTooltip term="LPR" />   (不传 slot, 默认显示 term)
    <PlainTextTooltip term="实控人穿透">
      <strong>实控人穿透</strong>
    </PlainTextTooltip>

  找不到术语时优雅降级: 只显示问号图标 + 提示"暂无白话文翻译".
-->
<template>
  <el-tooltip
    :content="tooltipContent"
    :raw-content="false"
    placement="top"
    :show-after="120"
    :hide-after="80"
    effect="dark"
    popper-class="plain-text-tooltip"
  >
    <span class="plain-text-term" :class="{ 'is-known': hasPlain, 'is-unknown': !hasPlain }">
      <slot>{{ term }}</slot>
      <el-icon class="plain-text-icon" :class="{ 'is-known-icon': hasPlain }">
        <QuestionFilled v-if="!hasPlain" />
        <InfoFilled v-else />
      </el-icon>
    </span>
  </el-tooltip>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { lookupEntry, translateToPlain } from '@/utils/plainTextTranslator';

const props = defineProps<{
  /** 专业术语 (如 "反向保理" / "LPR") */
  term: string;
  /** 是否显示问号图标, 默认 true */
  showIcon?: boolean;
}>();

const entry = computed(() => lookupEntry(props.term));
const hasPlain = computed(() => !!entry.value);

const tooltipContent = computed(() => {
  if (!entry.value) {
    return `白话文: 暂无翻译 (${props.term})`;
  }
  const plain = translateToPlain(props.term);
  if (entry.value.detail) {
    return `${plain}\n${entry.value.detail}`;
  }
  return plain;
});
</script>

<style lang="scss" scoped>
.plain-text-term {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  cursor: help;
  border-bottom: 1px dashed $border-lighter;
  transition: color $transition-fast;

  &.is-known {
    color: $color-primary;

    &:hover {
      color: lighten($color-primary, 10%);
      border-bottom-color: $color-primary;
    }
  }

  &.is-unknown {
    color: $text-secondary;
    border-bottom-style: dotted;

    &:hover {
      color: $text-regular;
    }
  }

  .plain-text-icon {
    font-size: 12px;
    line-height: 1;
    opacity: 0.85;

    &.is-known-icon {
      color: $color-primary;
    }
  }
}
</style>

<style lang="scss">
/* el-tooltip 全局 popper 样式, 需写在非 scoped 块中 */
.plain-text-tooltip.el-popper {
  max-width: 360px;
  background: $bg-card !important;
  color: $text-primary !important;
  border: 1px solid $border-light !important;
  font-size: $font-size-sm !important;
  line-height: 1.6 !important;
  padding: $spacing-sm $spacing-base !important;
  white-space: pre-line; /* 支持 \n 换行 */
  box-shadow: $shadow-lg !important;

  .el-popper__arrow::before {
    background: $bg-card !important;
    border-color: $border-light !important;
  }
}
</style>
