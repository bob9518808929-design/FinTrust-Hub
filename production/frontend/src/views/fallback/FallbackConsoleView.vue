<!--
  FallbackConsoleView.vue — Tab8 独立兜底引擎控制台
  职责: 15 外部 API + B1-B12 自研矩阵 + C1-C7 兜底 + 兜底降级链 + 独立运行模式 + 三档投入仪表盘
  对齐: simulation/js/view-fallback.js + spec L (A档API接入优先 + B档自研护城河 + C档独立兜底)
-->
<template>
  <div class="fallback-console">
    <el-alert
      title="Tab8 独立兜底引擎控制台"
      type="info"
      :closable="false"
      show-icon
      description="独立兜底引擎：A 档(15 外部 API 接入优先) + B 档(B1-B12 自研护城河矩阵) + C 档(C1-C7 独立兜底)。当 A 档失败自动降级 B 档，B 档失败自动降级 C 档，确保系统零机构接入时仍能独立运行。"
    />

    <el-card shadow="never" class="mt-16">
      <template #header><span>三档投入仪表盘</span></template>
      <el-row :gutter="16">
        <el-col :span="8">
          <el-statistic title="A 档 外部 API" :value="stats.aReady" suffix="/ 15" />
          <el-progress :percentage="Math.round(stats.aReady / 15 * 100)" :color="'#67c23a'" />
        </el-col>
        <el-col :span="8">
          <el-statistic title="B 档 自研护城河" :value="stats.bReady" suffix="/ 12" />
          <el-progress :percentage="Math.round(stats.bReady / 12 * 100)" :color="'#e6a23c'" />
        </el-col>
        <el-col :span="8">
          <el-statistic title="C 档 独立兜底" :value="stats.cReady" suffix="/ 7" />
          <el-progress :percentage="Math.round(stats.cReady / 7 * 100)" :color="'#f56c6c'" />
        </el-col>
      </el-row>
    </el-card>

    <el-tabs v-model="activeTab" class="mt-16">
      <el-tab-pane label="A 档 外部 API (15)" name="a">
        <el-table :data="aItems" size="small" stripe>
          <el-table-column prop="id" label="编号" width="60" />
          <el-table-column prop="name" label="API 名称" />
          <el-table-column prop="provider" label="提供方" width="120" />
          <el-table-column label="状态" width="100">
            <template #default="{ row }"><el-tag size="small" :type="row.status === 'ready' ? 'success' : row.status === 'fallback' ? 'warning' : 'danger'">{{ statusLabel(row.status) }}</el-tag></template>
          </el-table-column>
          <el-table-column prop="latency" label="延迟(ms)" width="100" />
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="B 档 自研护城河 (B1-B12)" name="b">
        <el-table :data="bItems" size="small" stripe>
          <el-table-column prop="id" label="编号" width="60" />
          <el-table-column prop="name" label="自研模块" />
          <el-table-column prop="desc" label="职责" />
          <el-table-column label="状态" width="100">
            <template #default="{ row }"><el-tag size="small" :type="row.status === 'ready' ? 'success' : 'warning'">{{ statusLabel(row.status) }}</el-tag></template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="C 档 独立兜底 (C1-C7)" name="c">
        <el-table :data="cItems" size="small" stripe>
          <el-table-column prop="id" label="编号" width="60" />
          <el-table-column prop="name" label="兜底方案" />
          <el-table-column prop="trigger" label="触发条件" />
          <el-table-column label="状态" width="100">
            <template #default="{ row }"><el-tag size="small" type="danger">{{ statusLabel(row.status) }}</el-tag></template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="降级链" name="chain">
        <el-steps direction="vertical" :active="degradeActive" finish-status="success">
          <el-step title="A 档 正常运行" description="15 外部 API 全可用，走标准链路" />
          <el-step title="A 档 部分降级" description="部分 API 超时/失败，B 档接管对应能力" />
          <el-step title="B 档 自研接管" description="B1-B12 自研模块全量承载业务" />
          <el-step title="B 档 部分降级" description="自研模块依赖的外部资源不可用" />
          <el-step title="C 档 独立兜底" description="C1-C7 本地缓存 + 静态规则 + 人工兜底，确保系统不宕机" />
        </el-steps>
      </el-tab-pane>
    </el-tabs>

    <el-card shadow="never" class="mt-16">
      <template #header>
        <div class="card-header">
          <span>独立运行模式</span>
          <el-switch v-model="standaloneMode" active-text="独立兜底模式" inline-prompt @change="(v: any) => toggleStandalone(!!v)" />
        </div>
      </template>
      <p class="muted">开启后系统强制走 C 档，所有外部依赖被隔离，仅依赖本地缓存 + 静态规则 + 人工兜底。用于演示与极端灾备场景。</p>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';

const activeTab = ref('a');
const standaloneMode = ref(false);
const degradeActive = ref(0);

const aItems = ref([
  { id: 'A1', name: '银企直连-工行', provider: '工商银行', status: 'ready', latency: 120 },
  { id: 'A2', name: '银企直连-建行', provider: '建设银行', status: 'ready', latency: 135 },
  { id: 'A3', name: '银企直连-招行', provider: '招商银行', status: 'fallback', latency: 0 },
  { id: 'A4', name: '征信查询-央行', provider: '人行征信', status: 'ready', latency: 280 },
  { id: 'A5', name: '电子签章-e签宝', provider: 'e签宝', status: 'ready', latency: 90 },
  { id: 'A6', name: '区块链-蚂蚁链', provider: '蚂蚁链', status: 'fallback', latency: 0 },
  { id: 'A7', name: 'OCR-百度云', provider: '百度OCR', status: 'ready', latency: 210 },
  { id: 'A8', name: 'IoT-EMQX', provider: 'EMQX', status: 'down', latency: 0 },
  { id: 'A9', name: '微信机器人', provider: '企业微信', status: 'ready', latency: 60 },
  { id: 'A10', name: '钉钉机器人', provider: '钉钉', status: 'ready', latency: 65 },
  { id: 'A11', name: '税务数据', provider: '税务总局', status: 'fallback', latency: 0 },
  { id: 'A12', name: '工商数据', provider: '市场监管', status: 'ready', latency: 180 },
  { id: 'A13', name: '司法数据', provider: '中国裁判文书网', status: 'down', latency: 0 },
  { id: 'A14', name: '物流-顺丰', provider: '顺丰', status: 'ready', latency: 150 },
  { id: 'A15', name: '评估-中估联', provider: '中估联', status: 'ready', latency: 200 },
]);

const bItems = ref([
  { id: 'B1', name: 'AI 驾驶舱 L1-L4', desc: '自主度分级路由引擎', status: 'ready' },
  { id: 'B2', name: '字段级数据可见性矩阵', desc: '6 预设 + 字段级三方可见性', status: 'ready' },
  { id: 'B3', name: '责任链全景图', desc: '12 节点确权 + 信用分联动', status: 'ready' },
  { id: 'B4', name: '五流合一 + 边缘案例', desc: '10+ 边缘案例识别', status: 'ready' },
  { id: 'B5', name: '全局告警横幅', desc: '多 Tab 跳转 + 自动清除', status: 'ready' },
  { id: 'B6', name: '决策链路回溯', desc: '完整推理链可回溯', status: 'ready' },
  { id: 'B7', name: '改造引擎 R0-R10', desc: '企业合规改造全流程', status: 'ready' },
  { id: 'B8', name: '8维评分卡', desc: '行业×风险双维度评分', status: 'ready' },
  { id: 'B9', name: '供应链金融引擎', desc: 'SC1-SC10 引擎族', status: 'ready' },
  { id: 'B10', name: '兜底降级链', desc: 'A→B→C 自动降级', status: 'ready' },
  { id: 'B11', name: '联盟链凭证', desc: 'W3C VC 跨行确权', status: 'fallback' },
  { id: 'B12', name: '合规指数', desc: '行业基准飞轮', status: 'fallback' },
]);

const cItems = ref([
  { id: 'C1', name: '本地缓存降级', trigger: 'A 档全失败', status: 'ready' },
  { id: 'C2', name: '静态规则路由', trigger: 'AI 引擎不可用', status: 'ready' },
  { id: 'C3', name: '人工兜底台', trigger: 'L4 强制人工', status: 'ready' },
  { id: 'C4', name: '纸质单据 OCR', trigger: '电子签章失败', status: 'ready' },
  { id: 'C5', name: '电话/邮件确认', trigger: '机器人不可用', status: 'ready' },
  { id: 'C6', name: '离线合同生成', trigger: '联盟链失败', status: 'ready' },
  { id: 'C7', name: '监管沙盒冻结', trigger: '极端异常', status: 'ready' },
]);

const stats = computed(() => ({
  aReady: aItems.value.filter(i => i.status === 'ready').length,
  bReady: bItems.value.filter(i => i.status === 'ready').length,
  cReady: cItems.value.filter(i => i.status === 'ready').length,
}));

function statusLabel(s: string) {
  return ({ ready: '就绪', fallback: '降级中', down: '离线' } as Record<string, string>)[s] ?? s;
}

function toggleStandalone(v: boolean) {
  degradeActive.value = v ? 4 : 0;
  ElMessage.success(v ? '已切换至独立兜底模式（C 档强制启用）' : '已恢复标准链路（A→B→C 降级）');
}

onMounted(() => {});
</script>

<style scoped lang="scss">
.mt-16 { margin-top: 16px; }
.muted { color: var(--el-text-color-secondary); font-size: 12px; }
.card-header { display: flex; justify-content: space-between; align-items: center; }
</style>
