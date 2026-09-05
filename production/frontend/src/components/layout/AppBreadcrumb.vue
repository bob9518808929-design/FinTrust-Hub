<!-- 文件名：AppBreadcrumb.vue 职责：应用面包屑导航组件,显示首页/分组/当前标题层级 -->
<template>
  <div class="app-breadcrumb">
    <el-breadcrumb separator="/">
      <el-breadcrumb-item :to="{ path: '/' }">
        <el-icon><HomeFilled /></el-icon>
      </el-breadcrumb-item>
      <el-breadcrumb-item v-if="currentGroup">{{ currentGroup }}</el-breadcrumb-item>
      <el-breadcrumb-item>{{ currentTitle }}</el-breadcrumb-item>
    </el-breadcrumb>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();

const currentGroup = computed(() => route.meta?.group as string | undefined);
const currentTitle = computed(() => (route.meta?.title as string) || '页面');
</script>

<style lang="scss" scoped>
.app-breadcrumb {
  height: $breadcrumb-height;
  display: flex;
  align-items: center;
  padding: 0 $spacing-xl;
  background: $bg-page;
  border-bottom: 1px solid $border-color;
}
</style>
