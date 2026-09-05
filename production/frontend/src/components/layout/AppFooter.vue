<!-- 文件名：AppFooter.vue 职责：应用页脚组件,展示版本号、产品定位与 API 接入策略说明 -->
<template>
  <footer class="app-footer">
    <span>FinTrust Hub v3.1</span>
    <span class="separator">·</span>
    <span>企业改造与融资撮合信任枢纽</span>
    <span class="separator">·</span>
    <a href="#" @click.prevent>API 接入优先 · 自研护城河 · 独立兜底备选</a>
  </footer>
</template>

<script setup lang="ts">
defineOptions({ name: 'AppFooter' });
</script>

<style lang="scss" scoped>
.app-footer {
  height: $footer-height;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: $spacing-sm;
  padding: 0 $spacing-xl;
  background: $bg-page;
  border-top: 1px solid $border-color;
  font-size: $font-size-xs;
  color: $text-muted;

  .separator {
    color: $text-muted;
  }

  a {
    color: $color-primary;

    &:hover {
      text-decoration: underline;
    }
  }
}
</style>
