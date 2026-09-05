<template>
  <div class="eco-bid-view">
    <el-card header="🏆 ECO-05 反向竞拍融资大厅 (R9 终极形态, P2)">
      <el-alert
        type="success"
        :closable="false"
        show-icon
        title="企业发标 · 银行竞价"
        description="把'企业求银行'翻转为'银行抢优质资产', FinTrust Hub 掌握绝对定价权。T+24h 在线竞价, 利率低/额度高/放款快者胜出。"
      />

      <el-divider />

      <h3>📋 当前标书</h3>
      <el-empty v-if="!tenders.length" description="尚未发布标书" />
      <el-table v-else :data="tenders" stripe @row-click="onRowClick">
        <el-table-column prop="tenderId" label="ID" width="140" />
        <el-table-column prop="enterpriseName" label="企业" min-width="180" />
        <el-table-column prop="amount" label="金额(元)" width="120">
          <template #default="{ row }">{{ (row.amount / 100).toLocaleString() }}</template>
        </el-table-column>
        <el-table-column prop="rateFloor" label="利率下限" width="100" />
        <el-table-column prop="status" label="状态" width="100" />
        <el-table-column prop="deadline" label="截止时间" />
      </el-table>

      <el-divider />

      <el-button type="primary" @click="publishDialog = true">📢 发布新标书</el-button>
    </el-card>

    <el-dialog v-model="publishDialog" title="发布融资标书" width="600px">
      <el-form :model="form" label-width="120px">
        <el-form-item label="融资金额(元)">
          <el-input-number v-model="form.amount" :min="100000" :step="100000" />
        </el-form-item>
        <el-form-item label="期限(月)">
          <el-input-number v-model="form.termMonths" :min="1" :max="60" />
        </el-form-item>
        <el-form-item label="利率下限(%)">
          <el-input-number v-model="form.rateFloor" :min="2" :max="20" :step="0.1" />
        </el-form-item>
        <el-form-item label="用途">
          <el-input v-model="form.purpose" type="textarea" />
        </el-form-item>
        <el-form-item label="邀请银行">
          <el-input v-model="invitedBanksText" placeholder="逗号分隔银行 ID, 留空则公开" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="publishDialog = false">取消</el-button>
        <el-button type="primary" @click="publish">发布</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { useEcoStore } from '@/stores/eco';
import { useEnterpriseStore } from '@/stores/enterprise';
import * as ecoApi from '@/api/eco';

defineOptions({ name: 'EcoBidView' });

const ecoStore = useEcoStore();
const enterpriseStore = useEnterpriseStore();

const publishDialog = ref(false);
const form = ref({
  amount: 2000000,
  termMonths: 12,
  rateFloor: 3.5,
  purpose: '补充流动资金',
});

const invitedBanksText = ref('');

const tenders = computed(() => ecoStore.tenders);

import { computed } from 'vue';

async function publish() {
  const entId = enterpriseStore.currentEnterpriseId;
  if (!entId) {
    ElMessage.warning('请先选择企业');
    return;
  }
  try {
    const invitedBankIds = invitedBanksText.value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    await ecoStore.bidPublish({
      enterpriseId: entId,
      amount: form.value.amount * 100,
      termMonths: form.value.termMonths,
      rateFloor: form.value.rateFloor,
      purpose: form.value.purpose,
      invitedBankIds,
    });
    ElMessage.success('标书已发布, T+24h 竞价中');
    publishDialog.value = false;
  } catch (e) {
    ElMessage.error('发布失败: ' + (e instanceof Error ? e.message : String(e)));
  }
}

function onRowClick(row: { tenderId: string }) {
  // 跳转到标书详情 (TODO P5: 独立详情页)
  ElMessage.info(`标书 ${row.tenderId} 详情 (TODO P5)`);
}

onMounted(async () => {
  try {
    const list = await ecoApi.bidList();
    ecoStore.tenders = list;
  } catch (e) {
    // 后端未启动时静默
    console.warn('[EcoBidView] 拉取标书失败:', e);
  }
});
</script>
