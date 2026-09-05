<!-- 文件名：ScorecardRadar.vue 职责：评分卡雷达图组件,基于 ECharts 渲染 8 维 Scorecard8D 雷达图 -->
<template>
  <div class="scorecard-radar">
    <v-chart v-if="option" class="chart" :option="option" autoresize />
    <el-empty v-else description="无评分卡数据" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Scorecard8D } from '@contracts/scorecard';

const props = defineProps<{ scorecard?: Scorecard8D | null }>();

const DIM_LABELS: Record<keyof Scorecard8D, string> = {
  subject: '主体',
  finance: '财务',
  tax: '税务',
  business: '业务',
  assets: '资产',
  credit: '信用',
  policy: '政策',
  capital: '资本',
};

const option = computed(() => {
  if (!props.scorecard) return null;
  const dims = Object.keys(DIM_LABELS) as (keyof Scorecard8D)[];
  return {
    title: { text: '8 维评分卡', left: 'center', textStyle: { color: '#f3f4f6' } },
    tooltip: {},
    radar: {
      indicator: dims.map((d) => ({ name: DIM_LABELS[d], max: 100 })),
      shape: 'polygon',
      splitArea: { areaStyle: { color: ['rgba(55,65,81,0.3)', 'rgba(31,41,55,0.3)'] } },
      axisLine: { lineStyle: { color: '#4b5563' } },
      splitLine: { lineStyle: { color: '#4b5563' } },
      axisName: { color: '#d1d5db' },
    },
    series: [
      {
        type: 'radar',
        data: [
          {
            value: dims.map((d) => props.scorecard![d]),
            name: '当前评分',
            areaStyle: { color: 'rgba(59,130,246,0.3)' },
            lineStyle: { color: '#3b82f6' },
          },
        ],
      },
    ],
  };
});
</script>

<style lang="scss" scoped>
.scorecard-radar {
  width: 100%;
  height: 320px;

  .chart {
    width: 100%;
    height: 100%;
  }
}
</style>
