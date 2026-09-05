<template>
  <div class="eco-pricing-view">
    <el-card header="💰 ECO-02 成果导向阶梯定价 (P0, 冷启动破局)">
      <el-alert
        type="success"
        :closable="false"
        show-icon
        title="0 元接入 + 融资成本节约分成"
        description="改造失败不收费, 改造成功才分钱。彻底将甲乙双方利益捆绑, 互联网免费/对赌思维打穿金融行业壁垒。"
      />

      <el-divider />

      <el-form :model="form" label-width="140px" inline>
        <el-form-item label="贷款金额(元)">
          <el-input-number v-model="form.loanAmount" :min="100000" :step="100000" />
        </el-form-item>
        <el-form-item label="原市场利率(%)">
          <el-input-number v-model="form.originalRate" :min="3" :max="24" :step="0.1" />
        </el-form-item>
        <el-form-item label="改造后利率(%)">
          <el-input-number v-model="form.achievedRate" :min="2" :max="20" :step="0.1" />
        </el-form-item>
        <el-form-item label="期限(月)">
          <el-input-number v-model="form.termMonths" :min="1" :max="60" />
        </el-form-item>
        <el-form-item label="改造难度">
          <el-select v-model="form.difficulty" style="width: 140px">
            <el-option label="绿灯轻改造 (20%)" value="green" />
            <el-option label="黄灯中改造 (30%)" value="yellow" />
            <el-option label="橙灯重改造 (40%)" value="orange" />
            <el-option label="R5-Lite 供应链 (15%)" value="r5_lite" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="calculate">计算分成</el-button>
        </el-form-item>
      </el-form>

      <el-divider />

      <el-descriptions v-if="result" title="分成结算结果" :column="2" border>
        <el-descriptions-item label="企业节约利息">
          <span class="text-success">¥ {{ formatYuan(result.interestSaved) }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="分成比例">{{ (result.splitRatio * 100).toFixed(0) }}%</el-descriptions-item>
        <el-descriptions-item label="FinTrust 服务费">
          <span class="text-warning">¥ {{ formatYuan(result.platformFee) }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="企业净收益">
          <span class="text-success">¥ {{ formatYuan(result.enterpriseNet) }}</span>
        </el-descriptions-item>
      </el-descriptions>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import { useEcoStore } from '@/stores/eco';
import { useEnterpriseStore } from '@/stores/enterprise';
import type { SettlementRecord, PricingDifficulty } from '@contracts/eco';

defineOptions({ name: 'EcoPricingView' });

const ecoStore = useEcoStore();
const enterpriseStore = useEnterpriseStore();

const form = ref({
  loanAmount: 2000000,
  originalRate: 8,
  achievedRate: 4,
  termMonths: 12,
  difficulty: 'yellow' as PricingDifficulty,
});

const result = ref<SettlementRecord | null>(null);

async function calculate() {
  const entId = enterpriseStore.currentEnterpriseId;
  if (!entId) {
    ElMessage.warning('请先选择企业');
    return;
  }
  try {
    result.value = await ecoStore.pricingCalc({
      enterpriseId: entId,
      loanAmount: form.value.loanAmount * 100, // 元 → 分
      originalRate: form.value.originalRate,
      achievedRate: form.value.achievedRate,
      termMonths: form.value.termMonths,
      difficulty: form.value.difficulty,
    });
    ElMessage.success('分成计算完成');
  } catch (e) {
    ElMessage.error('计算失败: ' + (e instanceof Error ? e.message : String(e)));
  }
}

function formatYuan(cents: number): string {
  return (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
</script>

<style lang="scss" scoped>
// EcoPricingView · Deepspace AI 深色版
// Experience 366208 教训: 此文件此前没有 <style scoped>, 完全依赖 Element Plus 默认 light 主题 →
//     success alert / descriptions border / form-item label 全部回退浅白, 用户看到"都是浅色"
//     必须在组件内显式 :deep 覆盖 5 个子组件.
@use '@/styles/variables.scss' as *;

.eco-pricing-view {
  // 页面容器: 透明 → 透出深空青+紫光晕
  background: transparent;
  isolation: isolate;
  padding: 16px;
  color: $text-primary;

  // 🔒 大卡片: 玻璃 + 渐变霓虹边 + 卡头 AI 渐变字
  :deep(.el-card) {
    background: linear-gradient(180deg, rgba(15,23,42,0.72), rgba(3,7,18,0.82)) !important;
    backdrop-filter: blur(20px) saturate(160%);
    -webkit-backdrop-filter: blur(20px) saturate(160%);
    border: 1px solid $border-color !important;
    border-radius: $radius-xl !important;
    box-shadow: $shadow-lg !important;
    overflow: hidden;

    :deep(.el-card__header) {
      background: rgba(15,23,42,0.55) !important;
      border-bottom: 1px solid $border-color !important;
      padding: 14px 20px;
      color: $text-primary;
      font-weight: 800;
      letter-spacing: 0.01em;
      // 💰 ECO-02 标题: AI 霓虹渐变字
      background: $ai-gradient;
      -webkit-background-clip: text;
              background-clip: text;
      color: transparent;
    }
    :deep(.el-card__body) {
      color: $text-primary;
      padding: 18px 20px;
    }
  }

  // 🔒 Hero 成功 Alert (你说的 "0 元接入 + 融资成本节约分成" 那块): 绿→琥珀渐变玻璃 + 发光边框
  :deep(.el-alert--success) {
    border-radius: 16px !important;
    border: 1px solid rgba(16,185,129,0.45) !important;
    background:
      linear-gradient(135deg, rgba(16,185,129,0.18), rgba(6,78,59,0.06) 45%, rgba(251,191,36,0.16) 100%) !important;
    backdrop-filter: blur(12px) saturate(160%);
    -webkit-backdrop-filter: blur(12px) saturate(160%);
    box-shadow:
      0 0 0 1px rgba(16,185,129,0.20),
      0 8px 24px rgba(16,185,129,0.18),
      inset 0 0 0 1px rgba(251,191,36,0.10);

    :deep(.el-alert__content) {
      color: $text-primary !important;
    }
    :deep(.el-alert__title) {
      color: $text-primary !important;
      font-weight: 800 !important;
      letter-spacing: 0.02em !important;
      font-size: 16px !important;
      line-height: 1.4;
      // 标题"0 元接入 + 融资成本节约分成" → AI 渐变字
      background: linear-gradient(90deg, #6ee7b7, #fde68a, #fcd34d);
      -webkit-background-clip: text;
              background-clip: text;
      color: transparent !important;
      text-shadow: 0 0 10px rgba(16,185,129,0.20);
    }
    :deep(.el-alert__description) {
      color: $text-regular !important;
      line-height: 1.85;
      margin-top: 6px;
      font-size: 13.5px;
    }
    :deep(.el-alert__icon) {
      color: #34d399 !important;
      filter: drop-shadow(0 0 8px rgba(16,185,129,0.60));
    }
  }

  // 🔒 分隔线 (默认 light 是浅灰白条 → 改成半透霓虹细线)
  :deep(.el-divider) {
    --el-border-color: #{ $border-color };
    border-top: 1px solid $border-color !important;
    background: transparent;
    &::before, &::after {
      background: transparent !important;
    }
  }

  // 🔒 分成结算表单 el-form (默认 light label 是深灰 + 背景白 → 改成玻璃格一致)
  :deep(.el-form) {
    color: $text-primary;
  }
  :deep(.el-form-item__label) {
    color: $text-secondary !important;
    font-weight: 700 !important;
    letter-spacing: 0.01em;
  }
  // el-input-number / el-select 输入块: 玻璃胶囊
  :deep(.el-input-number),
  :deep(.el-select) {
    :deep(.el-input__wrapper) {
      background: rgba(15,23,42,0.55) !important;
      border: 1px solid $border-color !important;
      box-shadow: none !important;
      border-radius: 12px;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);

      :deep(.el-input__inner) {
        color: $text-primary !important;
        font-weight: 700;
      }
      &.is-focus {
        border-color: rgba(192,132,252,0.80) !important;
        box-shadow:
          0 0 0 3px rgba(34,211,238,0.18),
          0 0 18px rgba(192,132,252,0.22) !important;
      }
    }
  }
  // select 下拉菜单项: 玻璃 hover
  :deep(.el-select-dropdown) {
    background: rgba(15,23,42,0.92) !important;
    border: 1px solid $border-color !important;
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    :deep(.el-select-dropdown__item) {
      color: $text-primary;
      background: transparent !important;
      &.is-hover,
      &.hover,
      &:hover {
        background: rgba(129,140,248,0.20) !important;
      }
      &.selected {
        background: linear-gradient(90deg, rgba(34,211,238,0.22), rgba(192,132,252,0.18)) !important;
        color: $text-primary !important;
        font-weight: 800;
      }
    }
  }

  // 🔒 分成结算 Descriptions 结果 4 格 (默认 light border 是浅白格 → 深蓝玻璃交替)
  :deep(.el-descriptions) {
    border-radius: 16px;
    overflow: hidden;
    box-shadow: $shadow-base;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);

    :deep(.el-descriptions__header),
    :deep(.el-descriptions__title) {
      color: $text-primary !important;
      font-weight: 800 !important;
      letter-spacing: 0.02em !important;
      // "分成结算结果" → AI 渐变字
      background: $ai-gradient;
      -webkit-background-clip: text;
              background-clip: text;
      color: transparent !important;
    }
    :deep(.el-descriptions__label) {
      background: rgba(15,23,42,0.68) !important;
      border-color: $border-color !important;
      color: $text-secondary !important;
      font-weight: 700;
    }
    :deep(.el-descriptions__content) {
      background: rgba(30,41,59,0.45) !important;
      border-color: $border-color !important;
      color: $text-primary !important;
      font-weight: 700;
    }
    :deep(.el-descriptions__table) {
      border-color: $border-color !important;
    }
  }

  // 结算结果里的 2 个 text-success (企业节约利息 / 净收益) + 1 个 text-warning (服务费)
  :deep(.text-success) {
    color: #6ee7b7 !important;
    font-weight: 800 !important;
    text-shadow: 0 0 8px rgba(16,185,129,0.50);
  }
  :deep(.text-warning) {
    color: #fcd34d !important;
    font-weight: 800 !important;
    text-shadow: 0 0 8px rgba(251,191,36,0.50);
  }
}
</style>
