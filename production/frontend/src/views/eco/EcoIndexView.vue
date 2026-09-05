<template>
  <div class="eco-index-view">
    <el-card header="📈 ECO-07 FinTrust 企业合规指数 (R10 衍生, P2)">
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="行业基准飞轮"
        description="基于 R10 案例库 + ECO-05 匿名归档, 生成行业改造成功率/平均信用分/利率基准/合规分布指数, 驱动生态飞轮. "
      />

      <el-divider />

      <el-form inline>
        <el-form-item label="指数类型">
          <el-select v-model="form.type" style="width: 220px">
            <el-option label="行业改造成功率" value="industry_reform_success" />
            <el-option label="行业平均信用分" value="industry_avg_credit" />
            <el-option label="行业利率基准" value="interest_rate_benchmark" />
            <el-option label="合规分布指数" value="compliance_distribution" />
          </el-select>
        </el-form-item>
        <el-form-item label="行业">
          <el-input v-model="form.industry" placeholder="如 manufacturing" style="width: 180px" />
        </el-form-item>
        <el-form-item label="周期">
          <el-input v-model="form.period" placeholder="如 2026-Q3" style="width: 120px" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="calc">计算指数</el-button>
        </el-form-item>
      </el-form>

      <el-divider />

      <h3>📊 指数历史</h3>
      <el-empty v-if="!indices.length" description="尚无指数数据" />
      <el-table v-else :data="indices" stripe>
        <el-table-column prop="type" label="类型" width="180" />
        <el-table-column prop="industry" label="行业" width="140" />
        <el-table-column prop="period" label="周期" width="120" />
        <el-table-column prop="value" label="指数值" width="100" />
        <el-table-column prop="sampleSize" label="样本数" width="100" />
        <el-table-column prop="publishedAt" label="发布时间" />
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { ElMessage } from 'element-plus';
import { useEcoStore } from '@/stores/eco';
import type { IndexType } from '@contracts/eco';

defineOptions({ name: 'EcoIndexView' });

const ecoStore = useEcoStore();

const form = ref({
  type: 'industry_reform_success' as IndexType,
  industry: 'manufacturing',
  period: '2026-Q3',
});

const indices = computed(() => ecoStore.indices);

async function calc() {
  try {
    await ecoStore.indexCalculate(form.value);
    ElMessage.success('指数已计算并发布');
  } catch (e) {
    ElMessage.error('计算失败: ' + (e instanceof Error ? e.message : String(e)));
  }
}
</script>
