<template>
  <div class="eco-gov-view">
    <el-card header="🏛 ECO-08 监管/政府背书催化剂 (APP-04 衍生, P1)">
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="穿透报告 + 监管背书"
        description="向监管机构推送脱敏穿透报告, 获取政府背书降低信任门槛. log() 包含 id / enterprise / source 三字段. "
      />

      <el-divider />

      <el-form inline>
        <el-form-item label="报告类型">
          <el-select v-model="form.type" style="width: 200px">
            <el-option label="监管沙盒穿透报告" value="sandbox_penetration" />
            <el-option label="改造成果报告" value="reform_outcome" />
            <el-option label="合规审计报告" value="compliance_audit" />
            <el-option label="风险预警报告" value="risk_alert" />
          </el-select>
        </el-form-item>
        <el-form-item label="脱敏级别">
          <el-select v-model="form.desensitizedLevel" style="width: 120px">
            <el-option label="全脱敏" value="full" />
            <el-option label="部分" value="partial" />
            <el-option label="聚合" value="aggregate" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="generate">生成报告</el-button>
        </el-form-item>
      </el-form>

      <el-divider />

      <h3>📋 已生成报告</h3>
      <el-empty v-if="!reports.length" description="尚无报告" />
      <el-table v-else :data="reports" stripe>
        <el-table-column prop="reportId" label="ID" width="160" />
        <el-table-column prop="type" label="类型" width="160" />
        <el-table-column prop="source" label="来源" width="100" />
        <el-table-column prop="enterprise" label="企业" width="180" />
        <el-table-column prop="status" label="状态" width="100" />
        <el-table-column prop="submittedAt" label="提交时间" />
        <el-table-column label="操作" width="200">
          <template #default="{ row }">
            <el-button size="small" @click="submit(row.reportId)">提交监管</el-button>
            <el-button size="small" type="success" @click="endorse(row.reportId)">申请背书</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { ElMessage } from 'element-plus';
import { useEcoStore } from '@/stores/eco';
import { useEnterpriseStore } from '@/stores/enterprise';
import * as ecoApi from '@/api/eco';
import type { GovReportType } from '@contracts/eco';

defineOptions({ name: 'EcoGovView' });

const ecoStore = useEcoStore();
const enterpriseStore = useEnterpriseStore();

const form = ref({
  type: 'sandbox_penetration' as GovReportType,
  desensitizedLevel: 'full' as 'full' | 'partial' | 'aggregate',
});

const reports = computed(() => {
  const entId = enterpriseStore.currentEnterpriseId;
  if (!entId) return [];
  return ecoStore.govReports[entId] ?? [];
});

async function generate() {
  const entId = enterpriseStore.currentEnterpriseId;
  if (!entId) {
    ElMessage.warning('请先选择企业');
    return;
  }
  try {
    await ecoStore.govGenerateReport({ ...form.value, enterpriseId: entId });
    ElMessage.success('报告已生成');
  } catch (e) {
    ElMessage.error('生成失败: ' + (e instanceof Error ? e.message : String(e)));
  }
}

async function submit(reportId: string) {
  try {
    await ecoApi.govSubmitReport(reportId, '中国证监会');
    ElMessage.success('已提交监管');
  } catch (e) {
    ElMessage.error('提交失败: ' + (e instanceof Error ? e.message : String(e)));
  }
}

async function endorse(_reportId: string) {
  const entId = enterpriseStore.currentEnterpriseId;
  if (!entId) return;
  try {
    await ecoApi.govApplyForEndorsement(entId, '工信部', ['高新认定', '专精特新']);
    ElMessage.success('背书申请已提交, 等待监管审核');
  } catch (e) {
    ElMessage.error('申请失败: ' + (e instanceof Error ? e.message : String(e)));
  }
}
</script>
