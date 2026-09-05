<template>
  <div class="enterprise-detail-view">
    <el-page-header @back="$router.push('/enterprise')" title="返回企业列表">
      <template #content>
        <span class="header-title">{{ enterprise?.name || '企业详情' }}</span>
      </template>
    </el-page-header>

    <el-skeleton v-if="loading" :rows="8" animated />

    <template v-else-if="enterprise">
      <el-row :gutter="16">
        <el-col :span="8">
          <el-card>
            <template #header>
              <div class="card-header-flex">
                <span>基本信息</span>
                <el-button type="primary" size="small" :icon="Edit" @click="showEditDialog = true">
                  编辑
                </el-button>
              </div>
            </template>
            <el-descriptions :column="1" border>
              <el-descriptions-item label="ID">{{ enterprise.id }}</el-descriptions-item>
              <el-descriptions-item label="名称">{{ enterprise.name }}</el-descriptions-item>
              <el-descriptions-item label="行业">{{ enterprise.industryLabel }}</el-descriptions-item>
              <el-descriptions-item label="风险画像">{{ enterprise.riskLabel }}</el-descriptions-item>
              <el-descriptions-item label="信用等级上限">{{ enterprise.runtime.creditGradeCap }}</el-descriptions-item>
              <el-descriptions-item label="信用分">{{ enterprise.runtime.creditScore }}</el-descriptions-item>
              <el-descriptions-item label="资金水位">
                {{ (enterprise.runtime.waterLevel * 100).toFixed(0) }}%
              </el-descriptions-item>
              <el-descriptions-item label="月营收">
                ¥{{ formatAmount(enterprise.financials.monthlyRevenue) }}
              </el-descriptions-item>
              <el-descriptions-item label="月支出">
                ¥{{ formatAmount(enterprise.financials.monthlyExpense) }}
              </el-descriptions-item>
              <el-descriptions-item label="账户余额">
                ¥{{ formatAmount(enterprise.financials.accountBalance) }}
              </el-descriptions-item>
              <el-descriptions-item label="应收账款">
                ¥{{ formatAmount(enterprise.financials.pendingAR) }}
              </el-descriptions-item>
              <el-descriptions-item label="已开放数据流" :span="2">
                <el-tag
                  v-for="flow in enabledFlows"
                  :key="flow"
                  size="small"
                  class="flow-tag"
                >
                  {{ flow }}
                </el-tag>
              </el-descriptions-item>
            </el-descriptions>
          </el-card>
        </el-col>
        <el-col :span="16">
          <el-card header="📊 8 维评分卡 (改造前)">
            <ScorecardRadar :scorecard="enterprise.reform.beforeScorecard" />
          </el-card>
        </el-col>
      </el-row>

      <!-- UX-01: 企业健康体检仪 (8 维评分卡之后) -->
      <HealthCheckup
        :enterprise-id="enterprise.id"
        :scorecard="healthScorecard"
        @start-reform="onStartReform"
        @dim-click="onDimClick"
      />

      <el-card class="bottom-actions">
        <el-button type="primary" @click="$router.push('/reform')">
          🛠 前往改造工作台
        </el-button>
        <el-button
          type="success"
          :disabled="!enterprise.runtime.financingUnlocked"
          @click="$router.push('/financing')"
        >
          🚀 {{ enterprise.runtime.financingUnlocked ? '发起融资' : '融资入口锁定 (需先改造)' }}
        </el-button>
      </el-card>
    </template>

    <el-empty v-else description="企业不存在" />

    <EnterpriseFormDialog
      v-model="showEditDialog"
      :enterprise="enterprise"
      @success="onEdited"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Edit } from '@element-plus/icons-vue';
import { useEnterpriseStore } from '@/stores/enterprise';
import ScorecardRadar from '@/components/common/ScorecardRadar.vue';
import HealthCheckup from '@/components/common/HealthCheckup.vue';
import EnterpriseFormDialog from '@/components/enterprise/EnterpriseFormDialog.vue';
import type { Scorecard8D } from '@contracts/scorecard';
import type { DataFlowKey } from '@contracts/common';

defineOptions({ name: 'EnterpriseDetailView' });

const route = useRoute();
const router = useRouter();
const enterpriseStore = useEnterpriseStore();

const loading = ref(false);
const showEditDialog = ref(false);

const enterprise = computed(() =>
  enterpriseStore.enterprises.find((e) => e.id === route.params.id),
);

const enabledFlows = computed<DataFlowKey[]>(() => {
  const ent = enterprise.value;
  if (!ent) return [];
  return (Object.entries(ent.dataFlows) as [DataFlowKey, boolean][])
    .filter(([, v]) => v)
    .map(([k]) => k);
});

function formatAmount(cents: number): string {
  return (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

/**
 * 体检仪使用的评分卡: 优先用改造前评分 (beforeScorecard),
 * 缺失时回退到运行时 afterScorecard, 再缺失时构造一份基于信用分的推测评分.
 */
const healthScorecard = computed<Scorecard8D | null>(() => {
  const ent = enterprise.value;
  if (!ent) return null;
  const before = ent.reform?.beforeScorecard;
  if (before) return before as Scorecard8D;
  const after = ent.reform?.afterScorecard;
  if (after) return after as Scorecard8D;
  // 兜底: 基于 runtime 推测一份评分 (避免体检仪空白)
  const cs = ent.runtime?.creditScore ?? 600;
  const base = Math.max(30, Math.min(80, Math.round(cs / 10)));
  return {
    subject: base, finance: base - 5, tax: base, business: base + 5,
    assets: base, credit: Math.max(30, Math.min(100, Math.round(cs / 10))),
    policy: base + 10, capital: base - 3,
  } as Scorecard8D;
});

async function loadDetail() {
  if (!route.params.id) return;
  loading.value = true;
  try {
    await enterpriseStore.fetchEnterpriseDetail(route.params.id as string);
  } finally {
    loading.value = false;
  }
}

function onStartReform(enterpriseId: string) {
  // 一键发起改造: 跳转改造工作台并携带企业 ID (改造引擎 R2 差距诊断会基于此生成方案)
  ElMessage.success(`正在为企业 ${enterpriseId} 生成改造方案…`);
  router.push({ path: '/reform', query: { enterpriseId } });
}

function onDimClick(dim: string) {
  ElMessage.info(`已定位到「${dim}」维度异常项，请查看下方改善建议`);
}

async function onEdited() {
  // 编辑成功后重新拉详情保证本地数据新鲜
  await loadDetail();
  ElMessage.success('企业信息已刷新');
}

watch(() => route.params.id, loadDetail, { immediate: true });
</script>

<style lang="scss" scoped>
.enterprise-detail-view {
  display: flex;
  flex-direction: column;
  gap: $spacing-lg;

  .header-title {
    font-size: $font-size-xl;
    font-weight: 600;
  }

  .card-header-flex {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .flow-tag {
    margin-right: 4px;
    margin-bottom: 4px;
  }

  .bottom-actions {
    display: flex;
    gap: $spacing-base;
  }
}
</style>
