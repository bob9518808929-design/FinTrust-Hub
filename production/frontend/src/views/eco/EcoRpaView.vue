<template>
  <div class="eco-rpa-view">
    <el-card header="📄 ECO-03 无接口适配器 (INFRA-05, P1)">
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="银行冷启动零开发接入"
        description="通过生成标准信贷申报书 PDF 实现零开发接入, 降低银行对接难度。成熟期切换至 INFRA-01b API 直连。"
      />

      <el-divider />

      <el-form :model="form" label-width="140px" inline>
        <el-form-item label="目标银行">
          <el-input v-model="form.bankName" placeholder="如 招商银行" style="width: 180px" />
        </el-form-item>
        <el-form-item label="贷款金额(元)">
          <el-input-number v-model="form.loanAmount" :min="100000" :step="100000" />
        </el-form-item>
        <el-form-item label="期限(月)">
          <el-input-number v-model="form.loanTermMonths" :min="1" :max="60" />
        </el-form-item>
        <el-form-item label="用途">
          <el-input v-model="form.loanPurpose" placeholder="如 补充流动资金" style="width: 220px" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="generate">生成信贷申报书 PDF</el-button>
        </el-form-item>
      </el-form>

      <el-divider />

      <el-table v-if="apps.length" :data="apps" stripe>
        <el-table-column prop="applicationId" label="ID" width="160" />
        <el-table-column prop="tier" label="接入档位" width="120" />
        <el-table-column prop="status" label="状态" width="100" />
        <el-table-column prop="submittedAt" label="提交时间" />
        <el-table-column label="操作" width="200">
          <template #default="{ row }">
            <el-button size="small" type="primary" @click="download(row.pdfUrl)">下载 PDF</el-button>
            <el-button size="small" @click="submit(row.applicationId)">提交银行</el-button>
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
import type { CreditApplicationRecord } from '@contracts/eco';

defineOptions({ name: 'EcoRpaView' });

const ecoStore = useEcoStore();
const enterpriseStore = useEnterpriseStore();

const form = ref({
  bankName: '招商银行',
  loanAmount: 5000000,
  loanTermMonths: 12,
  loanPurpose: '补充流动资金',
});

const apps = computed<CreditApplicationRecord[]>(() => {
  const entId = enterpriseStore.currentEnterpriseId;
  if (!entId) return [];
  return ecoStore.creditApps[entId] ?? [];
});

async function generate() {
  const entId = enterpriseStore.currentEnterpriseId;
  if (!entId) {
    ElMessage.warning('请先选择企业');
    return;
  }
  try {
    await ecoStore.rpaGenerate({
      enterpriseId: entId,
      bankId: form.value.bankName, // 真实环境用 bankId
      loanAmount: form.value.loanAmount * 100,
      loanTermMonths: form.value.loanTermMonths,
      loanPurpose: form.value.loanPurpose,
    });
    ElMessage.success('PDF 已生成');
  } catch (e) {
    ElMessage.error('生成失败: ' + (e instanceof Error ? e.message : String(e)));
  }
}

function download(url: string) {
  window.open(url, '_blank');
}

async function submit(applicationId: string) {
  try {
    const { submitted, failReason } = await import('@/api/eco').then((m) => m.rpaSubmit(applicationId));
    if (submitted) {
      ElMessage.success('已提交银行');
    } else {
      ElMessage.error('提交失败: ' + (failReason || ''));
    }
  } catch (e) {
    ElMessage.error('提交失败: ' + (e instanceof Error ? e.message : String(e)));
  }
}
</script>
