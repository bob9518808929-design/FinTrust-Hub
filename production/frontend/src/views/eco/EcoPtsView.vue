<template>
  <div class="eco-pts-view">
    <el-card header="🎁 ECO-06 积分商城与行为挖矿 (MOD-14, P1)">
      <el-alert
        type="success"
        :closable="false"
        show-icon
        title="物流端配合度 10% → 90%"
        description="仓管/物流司机每扫码确权一次 → 同步发放行为挖矿积分 → 兑换实物. 让最基层工人即时获得正向反馈. 单员工月均成本 30-50 元. "
      />

      <el-divider />

      <h3>🎯 行为挖矿规则</h3>
      <el-table :data="rules" stripe size="small">
        <el-table-column prop="behavior" label="行为" />
        <el-table-column prop="credit" label="信用分" width="100" />
        <el-table-column prop="carbon" label="碳积分" width="100" />
        <el-table-column prop="easyTrust" label="信易分" width="100" />
      </el-table>

      <el-divider />

      <h3>👥 工人账户</h3>
      <el-empty v-if="!workers.length" description="尚无工人账户 (TODO: P5 接入 E001-E004 花名册)" />
      <el-table v-else :data="workers" stripe>
        <el-table-column prop="workerId" label="ID" width="120" />
        <el-table-column prop="name" label="姓名" width="100" />
        <el-table-column prop="role" label="岗位" width="120" />
        <el-table-column label="信用分" width="100">
          <template #default="{ row }">{{ row.balances.credit }}</template>
        </el-table-column>
        <el-table-column label="碳积分" width="100">
          <template #default="{ row }">{{ row.balances.carbon }}</template>
        </el-table-column>
        <el-table-column label="信易分" width="100">
          <template #default="{ row }">{{ row.balances.easyTrust }}</template>
        </el-table-column>
        <el-table-column label="操作" width="200">
          <template #default="{ row }">
            <el-button size="small" type="primary" @click="award(row.workerId, 'scan_confirm')">
              模拟扫码确权
            </el-button>
            <el-button size="small" @click="openShop(row.workerId)">兑换商品</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-dialog v-model="shopDialog" title="积分商城" width="600px">
        <el-table :data="shopItems" size="small">
          <el-table-column prop="name" label="商品" />
          <el-table-column prop="creditCost" label="信用分" width="80" />
          <el-table-column prop="stock" label="库存" width="80" />
          <el-table-column label="操作" width="100">
            <template #default="{ row }: { row: any }">
              <el-button size="small" type="primary" @click="placeOrder(row)">兑换</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-dialog>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { useEcoStore } from '@/stores/eco';
import { useEnterpriseStore } from '@/stores/enterprise';
import * as ecoApi from '@/api/eco';
import type { WorkerAccount, ShopItem, BehaviorKind } from '@contracts/eco';

defineOptions({ name: 'EcoPtsView' });

const ecoStore = useEcoStore();
const enterpriseStore = useEnterpriseStore();

const shopDialog = ref(false);
const currentWorkerId = ref<string>('');
const shopItems = ref<ShopItem[]>([]);

const rules = [
  { behavior: '扫码确权', credit: 2, carbon: 5, easyTrust: 3 },
  { behavior: '异常上报', credit: 3, carbon: 2, easyTrust: 5 },
  { behavior: '连续7天准时', credit: 20, carbon: 0, easyTrust: 0 },
];

const workers = computed<WorkerAccount[]>(() => {
  const entId = enterpriseStore.currentEnterpriseId;
  if (!entId) return [];
  return Object.values(ecoStore.workerAccounts).filter((w) => w.enterpriseId === entId);
});

async function award(workerId: string, behavior: BehaviorKind) {
  try {
    const r = await ecoStore.ptsAwardPoints({ workerId, behavior });
    if (r.awarded) {
      ElMessage.success('积分已发放');
    } else if (r.fraudBlocked) {
      ElMessage.warning('防刷分拦截: ' + (r.reason || ''));
    }
  } catch (e) {
    ElMessage.error('发放失败: ' + (e instanceof Error ? e.message : String(e)));
  }
}

async function openShop(workerId: string) {
  currentWorkerId.value = workerId;
  if (shopItems.value.length === 0) {
    shopItems.value = await ecoApi.ptsListShopItems();
  }
  shopDialog.value = true;
}

async function placeOrder(item: ShopItem) {
  try {
    await ecoStore.ptsPlaceOrder(currentWorkerId.value, item.itemId);
    ElMessage.success(`${item.name} 兑换成功`);
  } catch (e) {
    ElMessage.error('兑换失败: ' + (e instanceof Error ? e.message : String(e)));
  }
}

onMounted(async () => {
  const entId = enterpriseStore.currentEnterpriseId;
  if (entId) {
    try {
      const list = await ecoApi.ptsListByEnterprise(entId);
      list.forEach((w) => {
        ecoStore.workerAccounts[w.workerId] = w;
      });
    } catch (e) {
      console.warn('[EcoPtsView] 拉取工人列表失败:', e);
    }
  }
});
</script>
