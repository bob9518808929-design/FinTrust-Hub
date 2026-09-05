<!--
  CockpitView.vue — Tab7 AI 驾驶舱 (全局观察台)
  职责: AI操作实时流 + L1-L4分布 + 决策链路回溯(含置信度) + 责任链回溯
  对齐: simulation/js/view-cockpit.js + project_memory 硬约束(Tab7 AI研判建议非阻塞toast)
-->
<template>
  <div class="cockpit-view">
    <el-alert
      title="Tab7 AI 驾驶舱 — 全局观察台"
      type="info"
      :closable="false"
      show-icon
      description="全局观察 AI 所有操作，回溯决策链路(含置信度)，查看 L1-L4 自主度分布，进行假设分析。AI 操作来源：Tab2 融资路由 / IoT 监测 / 责任链审计 / 边缘案例自动记录。"
    />

    <el-card shadow="never" class="mt-16">
      <template #header><span>全局统计</span></template>
      <el-row :gutter="16">
        <el-col :span="6"><el-statistic title="AI 操作总数" :value="ops.length" /></el-col>
        <el-col :span="6"><el-statistic title="L1 全自主" :value="levelCounts.L1" /></el-col>
        <el-col :span="6"><el-statistic title="L2 通知" :value="levelCounts.L2" /></el-col>
        <el-col :span="6"><el-statistic title="L3+L4 人工" :value="levelCounts.L3 + levelCounts.L4" /></el-col>
      </el-row>
    </el-card>

    <el-row :gutter="16" class="mt-16">
      <el-col :span="10">
        <el-card shadow="never">
          <template #header><span>L1-L4 分布</span></template>
          <v-chart :option="pieOption" style="height: 280px" autoresize />
        </el-card>
      </el-col>
      <el-col :span="14">
        <el-card shadow="never">
          <template #header><span>AI 操作实时流</span></template>
          <el-timeline>
            <el-timeline-item
              v-for="op in ops.slice(0, 20)"
              :key="op.id"
              :timestamp="op.timestamp"
              :type="levelTimelineType(op.level)"
              hollow
            >
              <div class="op-item">
                <el-tag size="small" :type="levelTag(op.level)">{{ op.level }}</el-tag>
                <span class="op-ent">{{ op.enterprise }}</span>
                <span class="op-action">{{ op.action }}</span>
                <el-tag size="small" :type="confidenceTag(op.confidence)">置信度 {{ op.confidence }}%</el-tag>
                <el-button link type="primary" size="small" @click="showTrace(op)">决策回溯</el-button>
                <el-button link type="warning" size="small" @click="showWhatIf(op)">假设分析</el-button>
              </div>
            </el-timeline-item>
          </el-timeline>
        </el-card>
      </el-col>
    </el-row>

    <el-dialog v-model="traceVisible" title="决策链路回溯" width="640px">
      <el-timeline v-if="currentTrace.length">
        <el-timeline-item v-for="(t, i) in currentTrace" :key="i" :timestamp="t.time" placement="top">
          <strong>{{ t.step }}</strong>
          <p class="muted">{{ t.detail }}</p>
          <p v-if="t.confidence != null">置信度: {{ t.confidence }}%</p>
        </el-timeline-item>
      </el-timeline>
      <el-empty v-else description="暂无回溯数据" />
    </el-dialog>

    <el-dialog v-model="whatIfVisible" title="假设分析 — 如果当时否决" width="560px">
      <p>当前结果：<el-tag type="success">{{ current?.result ?? '通过' }}</el-tag></p>
      <p class="mt-12">假设否决后的替代路径：</p>
      <el-alert type="warning" :closable="false" show-icon :title="whatIfResult" />
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { useReformStore } from '@/stores/reform';

const reformStore = useReformStore();
const ops = computed(() => reformStore.aiOperations ?? []);

const levelCounts = computed(() => {
  const c = { L1: 0, L2: 0, L3: 0, L4: 0 };
  ops.value.forEach((o: any) => { if (o.level in c) (c as any)[o.level]++; });
  return c;
});

const pieOption = computed(() => ({
  tooltip: { trigger: 'item' },
  legend: { bottom: 0 },
  series: [{
    type: 'pie', radius: ['40%', '70%'],
    data: [
      { name: 'L1 全自主', value: levelCounts.value.L1 },
      { name: 'L2 通知', value: levelCounts.value.L2 },
      { name: 'L3 建议+审批', value: levelCounts.value.L3 },
      { name: 'L4 人工', value: levelCounts.value.L4 },
    ],
  }],
}));

const traceVisible = ref(false);
const whatIfVisible = ref(false);
const current = ref<any>(null);
const currentTrace = ref<any[]>([]);
const whatIfResult = ref('');

function levelTag(l: string) {
  return ({ L1: 'success', L2: 'primary', L3: 'warning', L4: 'danger' } as Record<string, any>)[l] ?? 'info';
}
function levelTimelineType(l: string) {
  return ({ L1: 'success', L2: 'primary', L3: 'warning', L4: 'danger' } as Record<string, any>)[l] ?? 'info';
}
function confidenceTag(c: number) {
  if (c >= 80) return 'success';
  if (c >= 60) return 'warning';
  return 'danger';
}

function showTrace(op: any) {
  current.value = op;
  currentTrace.value = op.trace ?? [
    { step: '数据采集', detail: '采集企业五流 + 责任链 + 历史信用', time: op.timestamp, confidence: 92 },
    { step: '风险分析', detail: '8维评分卡 + 行业政策匹配', time: op.timestamp, confidence: 88 },
    { step: '路由决策', detail: `金额/自主度 → ${op.level}`, time: op.timestamp, confidence: op.confidence },
    { step: '执行', detail: op.action, time: op.timestamp, confidence: op.confidence },
  ];
  traceVisible.value = true;
}

function showWhatIf(op: any) {
  current.value = op;
  whatIfResult.value = `若否决，企业将转向 ECO-05 反向竞拍大厅寻求其他银行，预计利率上浮 0.5-1.0%，融资周期延长 3-5 个工作日。`;
  whatIfVisible.value = true;
  // project_memory: Tab7 AI 研判建议非阻塞 toast
  ElMessage({ type: 'info', message: '假设分析已生成（非阻塞）', duration: 6500 });
}

onMounted(() => { reformStore.loadAiOperations().catch(() => {}); });
</script>

<style scoped lang="scss">
.mt-16 { margin-top: 16px; }
.mt-12 { margin-top: 12px; }
.muted { color: var(--el-text-color-secondary); font-size: 12px; }
.op-item { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.op-ent { font-weight: 600; }
.op-action { color: var(--el-text-color-regular); }
</style>
