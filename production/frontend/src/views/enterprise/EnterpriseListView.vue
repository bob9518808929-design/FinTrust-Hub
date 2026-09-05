<template>
  <div class="enterprise-list-view">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>🏢 企业列表</span>
          <div class="header-actions">
            <el-input v-model="keyword" placeholder="搜索企业名/行业" style="width: 240px" clearable>
              <template #prefix><el-icon><Search /></el-icon></template>
            </el-input>
            <el-button type="primary" :icon="Plus" @click="showCreateDialog = true">
              新增企业
            </el-button>
          </div>
        </div>
      </template>

      <el-table v-loading="enterpriseStore.loading" :data="filteredEnterprises" stripe @row-click="onRowClick">
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="name" label="企业名称" min-width="180" />
        <el-table-column prop="industryLabel" label="行业" width="120" />
        <el-table-column prop="riskLabel" label="风险画像" width="100">
          <template #default="{ row }">
            <el-tag :type="getRiskTagType(row.riskProfile)" size="small">{{ row.riskLabel }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="信用分" width="100">
          <template #default="{ row }">
            <span :class="getCreditClass(row.runtime.creditScore)">{{ row.runtime.creditScore }}</span>
          </template>
        </el-table-column>
        <el-table-column label="改造状态" width="120">
          <template #default="{ row }">
            <el-tag :type="row.reform.hasReformed ? 'success' : 'info'" size="small">
              {{ row.reform.hasReformed ? '已改造' : '未改造' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="融资入口" width="100">
          <template #default="{ row }">
            <el-tag :type="row.runtime.financingUnlocked ? 'success' : 'danger'" size="small">
              {{ row.runtime.financingUnlocked ? '已解锁' : '锁定' }}
            </el-tag>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <EnterpriseFormDialog v-model="showCreateDialog" @success="onCreated" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { Search, Plus } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { useEnterpriseStore } from '@/stores/enterprise';
import EnterpriseFormDialog from '@/components/enterprise/EnterpriseFormDialog.vue';
import type { Enterprise, RiskProfile } from '@contracts/common';

defineOptions({ name: 'EnterpriseListView' });

const router = useRouter();
const enterpriseStore = useEnterpriseStore();
const keyword = ref('');
const showCreateDialog = ref(false);

const filteredEnterprises = computed<Enterprise[]>(() => {
  if (!keyword.value.trim()) return enterpriseStore.enterprises;
  const kw = keyword.value.toLowerCase();
  return enterpriseStore.enterprises.filter(
    (e) => e.name.toLowerCase().includes(kw) || e.industryLabel.toLowerCase().includes(kw),
  );
});

function onRowClick(row: Enterprise) {
  router.push(`/enterprise/${row.id}`);
}

async function onCreated(ent: Enterprise) {
  await enterpriseStore.fetchEnterprises();
  ElMessage.success(`已加载 ${ent.name} 到列表, 可在顶部下拉切换为当前企业`);
}

function getRiskTagType(profile: RiskProfile) {
  switch (profile) {
    case 'premium': return 'success' as const;
    case 'normal': return 'primary' as const;
    case 'high_risk': return 'warning' as const;
    case 'distress': return 'danger' as const;
    default: return 'info' as const;
  }
}

function getCreditClass(score: number) {
  if (score >= 750) return 'text-success';
  if (score >= 650) return '';
  if (score >= 600) return 'text-warning';
  return 'text-danger';
}

onMounted(async () => {
  if (enterpriseStore.enterprises.length === 0) {
    await enterpriseStore.fetchEnterprises();
  }
});
</script>

<style lang="scss" scoped>
.enterprise-list-view {
  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .header-actions {
    display: flex;
    gap: 12px;
    align-items: center;
  }
}
</style>
