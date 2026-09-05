<!--
  PartnerPortalView.vue — Tab10 关联机构门户
  职责: 物流(运单确认) / 评估 / 律所 / 会计 → AI委派任务 → 报告回传
  对齐: simulation/js/view-partner.js
-->
<template>
  <div class="partner-portal">
    <el-alert
      title="Tab10 关联机构门户 — AI 委派任务 + 报告回传"
      type="info"
      :closable="false"
      show-icon
      description="关联机构视角：物流(运单确认)、评估机构、律师事务所、会计师事务所。AI 自动委派任务，机构完成后回传报告，系统自动核验并纳入责任链。"
    />

    <el-tabs v-model="activeRole" class="mt-16">
      <el-tab-pane label="物流公司" name="logistics">
        <el-card shadow="never">
          <template #header><span>运单确认待办</span></template>
          <el-table :data="logisticsTasks" size="small" stripe>
            <el-table-column prop="id" label="运单号" width="160" />
            <el-table-column prop="enterprise" label="企业" />
            <el-table-column prop="route" label="路线" width="180" />
            <el-table-column prop="goods" label="货物" width="120" />
            <el-table-column label="状态" width="100">
              <template #default="{ row }"><el-tag size="small" :type="row.status === 'pending' ? 'warning' : 'success'">{{ row.status === 'pending' ? '待确认' : '已确认' }}</el-tag></template>
            </el-table-column>
            <el-table-column label="操作" width="120">
              <template #default="{ row }">
                <el-button v-if="row.status === 'pending'" type="primary" size="small" @click="confirmWaybill(row)">确认运单</el-button>
                <span v-else class="muted">已回传</span>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <el-tab-pane label="评估机构" name="evaluation">
        <el-card shadow="never">
          <template #header><span>评估任务</span></template>
          <el-table :data="evalTasks" size="small" stripe>
            <el-table-column prop="id" label="任务号" width="160" />
            <el-table-column prop="enterprise" label="企业" />
            <el-table-column prop="asset" label="评估标的" />
            <el-table-column prop="type" label="评估类型" width="120" />
            <el-table-column label="操作" width="160">
              <template #default="{ row }">
                <el-button type="primary" size="small" @click="submitEvalReport(row)">回传评估报告</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <el-tab-pane label="律师事务所" name="law">
        <el-card shadow="never">
          <template #header><span>法律尽调任务</span></template>
          <el-table :data="lawTasks" size="small" stripe>
            <el-table-column prop="id" label="任务号" width="160" />
            <el-table-column prop="enterprise" label="企业" />
            <el-table-column prop="scope" label="尽调范围" />
            <el-table-column label="操作" width="160">
              <template #default="{ row }">
                <el-button type="primary" size="small" @click="submitLawReport(row)">回传尽调报告</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <el-tab-pane label="会计师事务所" name="accounting">
        <el-card shadow="never">
          <template #header><span>审计任务</span></template>
          <el-table :data="auditTasks" size="small" stripe>
            <el-table-column prop="id" label="任务号" width="160" />
            <el-table-column prop="enterprise" label="企业" />
            <el-table-column prop="period" label="审计期间" width="120" />
            <el-table-column prop="scope" label="审计范围" />
            <el-table-column label="操作" width="160">
              <template #default="{ row }">
                <el-button type="primary" size="small" @click="submitAuditReport(row)">回传审计报告</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>
    </el-tabs>

    <el-card shadow="never" class="mt-16">
      <template #header><span>AI 委派任务流</span></template>
      <el-timeline>
        <el-timeline-item v-for="t in delegationFlow" :key="t.id" :timestamp="t.timestamp" :type="(t.type as any)" hollow>
          <strong>{{ t.action }}</strong> · <span class="muted">{{ t.detail }}</span>
        </el-timeline-item>
      </el-timeline>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';

const activeRole = ref('logistics');

const logisticsTasks = ref([
  { id: 'WB-2026-0801', enterprise: '深圳科创电子', route: '深圳→上海', goods: '芯片 1200 箱', status: 'pending' },
  { id: 'WB-2026-0802', enterprise: '杭州智造机械', route: '杭州→广州', goods: '机械配件 80 托盘', status: 'pending' },
  { id: 'WB-2026-0803', enterprise: '苏州新材料', route: '苏州→北京', goods: '化工原料 200 桶', status: 'confirmed' },
]);
const evalTasks = ref([
  { id: 'EVAL-2026-0801', enterprise: '深圳科创电子', asset: '厂房+设备', type: '抵押物评估' },
  { id: 'EVAL-2026-0802', enterprise: '杭州智造机械', asset: '应收账款', type: '资产质量评估' },
]);
const lawTasks = ref([
  { id: 'LAW-2026-0801', enterprise: '深圳科创电子', scope: '股权结构+诉讼记录+对外担保' },
  { id: 'LAW-2026-0802', enterprise: '苏州新材料', scope: '环保合规+许可资质' },
]);
const auditTasks = ref([
  { id: 'AUD-2026-0801', enterprise: '杭州智造机械', period: '2025年度', scope: '财务报表审计+应收账款函证' },
  { id: 'AUD-2026-0802', enterprise: '深圳科创电子', period: '2026H1', scope: '专项审计(研发投入)' },
]);

const delegationFlow = ref([
  { id: 'd1', action: 'AI 委派物流运单确认', detail: '深圳科创电子 WB-2026-0801', timestamp: '2026-08-19 09:12', type: 'primary' },
  { id: 'd2', action: 'AI 委派评估机构', detail: '杭州智造机械 应收账款评估', timestamp: '2026-08-19 09:15', type: 'primary' },
  { id: 'd3', action: '物流回传运单确认', detail: '苏州新材料 WB-2026-0803 已核验入责任链', timestamp: '2026-08-19 10:30', type: 'success' },
  { id: 'd4', action: 'AI 委派律所尽调', detail: '深圳科创电子 股权+诉讼', timestamp: '2026-08-19 11:00', type: 'primary' },
  { id: 'd5', action: 'AI 委派会计师事务所', detail: '杭州智造机械 2025 年度审计', timestamp: '2026-08-19 11:05', type: 'primary' },
]);

function confirmWaybill(row: any) {
  row.status = 'confirmed';
  delegationFlow.value.unshift({
    id: 'd' + Date.now(), action: '物流回传运单确认', detail: `${row.enterprise} ${row.id} 已核验入责任链`,
    timestamp: new Date().toLocaleString('zh-CN'), type: 'success',
  });
  ElMessage.success('运单已确认，已纳入责任链第零流');
}
function submitEvalReport(row: any) {
  ElMessage.success(`${row.enterprise} 评估报告已回传，AI 自动核验中`);
}
function submitLawReport(row: any) {
  ElMessage.success(`${row.enterprise} 尽调报告已回传，纳入合规检查`);
}
function submitAuditReport(row: any) {
  ElMessage.success(`${row.enterprise} 审计报告已回传，纳入信用画像`);
}

onMounted(() => {});
</script>

<style scoped lang="scss">
.mt-16 { margin-top: 16px; }
.muted { color: var(--el-text-color-secondary); font-size: 12px; }
</style>
