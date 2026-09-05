<!--
  EnterprisePortalView.vue — 企业自助门户 (企业老板视角)

  设计哲学 (project_memory 傻瓜式操作 + 不让用户做选择题, 只让做判断题或填空题):
    前因: 老板看不懂报表, 需要一个"我的企业仪表板"只看自己公司, 不能看其他企业
          (生产环境通过 SSO/JWT 强制锁定企业 ID, 当前 dev 用 currentEnterpriseId 兜底).
    用法: 顶部下拉选自己企业 → 进本页看 4 张大卡片 + 数字分身入口 + 融资单列表.
    后果: 老板拍板的融资申请回流到顾问工作台, 顾问代为对接银行.
-->
<template>
  <div class="enterprise-portal-view">
    <!-- ========== 1. 欢迎横幅 ========== -->
    <el-card shadow="never" class="welcome-card">
      <div class="welcome-content">
        <div class="welcome-left">
          <el-icon :size="48" color="#10b981"><OfficeBuilding /></el-icon>
          <div class="welcome-text">
            <h1 class="welcome-title">
              {{ enterprise ? `欢迎, ${enterprise.name}` : '请先在顶部选择你的企业' }}
            </h1>
            <p class="welcome-subtitle">
              {{ enterprise
                ? `${enterprise.industryLabel} · 信用等级 ${enterprise.runtime.creditGradeCap} · 改造状态 ${enterprise.reform.hasReformed ? '已改造' : '未改造'}`
                : '在顶部下拉选择你的企业后, 本页所有数据将自动刷新' }}
            </p>
          </div>
        </div>
        <div class="welcome-right">
          <el-button
            type="primary"
            size="large"
            :icon="ChatLineRound"
            :disabled="!enterprise"
            @click="$router.push('/eco/bot')"
          >
            💬 问我的数字分身
          </el-button>
        </div>
      </div>
    </el-card>

    <!-- ========== 2. 4 张大 KPI 卡片 ========== -->
    <el-row :gutter="16" v-if="enterprise">
      <el-col :xs="24" :sm="12" :md="6" v-for="kpi in kpis" :key="kpi.key">
        <el-card shadow="hover" :class="['kpi-card', `kpi-${kpi.theme}`]">
          <div class="kpi-content">
            <el-icon :size="32" :color="kpi.color"><component :is="kpi.icon" /></el-icon>
            <div class="kpi-info">
              <div class="kpi-label">{{ kpi.label }}</div>
              <div class="kpi-value">{{ kpi.value }}</div>
              <div class="kpi-extra">{{ kpi.extra }}</div>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- ========== 3. 改造进度 + 融资单状态 ========== -->
    <el-row :gutter="16" v-if="enterprise">
      <el-col :xs="24" :md="12">
        <el-card shadow="never" class="section-card">
          <template #header>
            <div class="card-header-flex">
              <span>📋 我的改造进度</span>
              <el-button type="primary" size="small" @click="$router.push('/reform')">
                前往改造台 →
              </el-button>
            </div>
          </template>
          <el-descriptions :column="2" border>
            <el-descriptions-item label="当前状态">
              <el-tag :type="reformStatusType" size="small">{{ reformStatusText }}</el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="当前等级">{{ enterprise.reform.beforeLevel || 'D' }}</el-descriptions-item>
            <el-descriptions-item label="目标等级" :span="2">
              {{ enterprise.reform.afterLevel || '待 R3 方案生成' }}
            </el-descriptions-item>
          </el-descriptions>
          <el-progress
            :percentage="reformProgress"
            :status="enterprise.reform.hasReformed ? 'success' : undefined"
            class="reform-progress"
          />
          <p class="hint">
            前 8 维评分卡总分 → 目标分 → 缺口 → R3 方案 → R4 启动 → R7 完成 → 融资入口解锁
          </p>
        </el-card>
      </el-col>
      <el-col :xs="24" :md="12">
        <el-card shadow="never" class="section-card">
          <template #header>
            <div class="card-header-flex">
              <span>💰 我的融资单状态</span>
              <el-button
                type="success"
                size="small"
                :disabled="!enterprise.runtime.financingUnlocked"
                @click="$router.push('/financing')"
              >
                {{ enterprise.runtime.financingUnlocked ? '发起融资 →' : '需先完成改造' }}
              </el-button>
            </div>
          </template>
          <el-descriptions :column="2" border>
            <el-descriptions-item label="融资入口">
              <el-tag :type="enterprise.runtime.financingUnlocked ? 'success' : 'danger'" size="small">
                {{ enterprise.runtime.financingUnlocked ? '已解锁' : '锁定中' }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="额度乘数">
              {{ enterprise.runtime.maxAmountMultiplier.toFixed(2) }}x
            </el-descriptions-item>
            <el-descriptions-item label="利率增减">
              <span :class="enterprise.runtime.rateDiscount < 0 ? 'text-success' : 'text-danger'">
                {{ enterprise.runtime.rateDiscount > 0 ? '+' : '' }}{{ enterprise.runtime.rateDiscount.toFixed(2) }}%
              </span>
            </el-descriptions-item>
            <el-descriptions-item label="审批速度">
              {{ { fast: '快', normal: '正常', slow: '慢' }[enterprise.runtime.approvalSpeed] }}
            </el-descriptions-item>
          </el-descriptions>
        </el-card>
      </el-col>
    </el-row>

    <!-- ========== 4. 资金水位监控 ========== -->
    <el-card v-if="enterprise" shadow="never" class="section-card">
      <template #header>
        <div class="card-header-flex">
          <span>💧 我的资金水位</span>
          <el-button type="primary" size="small" @click="$router.push('/bank')">
            查看监管账户 →
          </el-button>
        </div>
      </template>
      <el-progress
        :percentage="Math.round(enterprise.runtime.waterLevel * 100)"
        :stroke-width="20"
        :format="(p) => `${p}% (可划拨资金比例)`"
      />
      <p class="hint">
        前 因: 银行监管你的账户余额占比, 高于阈值才能放款, 低于阈值会触发告警
      </p>
    </el-card>

    <!-- ========== 5. 未选企业时引导 ========== -->
    <el-empty
      v-if="!enterprise"
      description="顶部下拉未选企业, 请先选择你的企业"
    >
      <el-button type="primary" @click="$router.push('/enterprise')">去企业列表选 →</el-button>
    </el-empty>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import {
  OfficeBuilding, ChatLineRound, Money, Tools, Bell, TrendCharts,
} from '@element-plus/icons-vue';
import { useEnterpriseStore } from '@/stores/enterprise';
import { useReformStore } from '@/stores/reform';

defineOptions({ name: 'EnterprisePortalView' });

const enterpriseStore = useEnterpriseStore();
const reformStore = useReformStore();

const enterprise = computed(() => enterpriseStore.currentEnterprise);

const kpis = computed(() => {
  const ent = enterprise.value;
  if (!ent) return [];
  return [
    {
      key: 'credit',
      label: '我的信用分',
      value: ent.runtime.creditScore,
      extra: `等级上限 ${ent.runtime.creditGradeCap}`,
      icon: TrendCharts,
      color: '#3b82f6',
      theme: 'blue',
    },
    {
      key: 'reform',
      label: '改造进度',
      value: ent.reform.hasReformed ? '✓ 已完成' : '进行中',
      extra: `${ent.reform.beforeLevel || 'D'} → ${ent.reform.afterLevel || '目标待定'}`,
      icon: Tools,
      color: '#f59e0b',
      theme: 'amber',
    },
    {
      key: 'financing',
      label: '融资入口',
      value: ent.runtime.financingUnlocked ? '已解锁' : '锁定',
      extra: `额度 ×${ent.runtime.maxAmountMultiplier.toFixed(2)}`,
      icon: Money,
      color: '#10b981',
      theme: 'green',
    },
    {
      key: 'water',
      label: '资金水位',
      value: `${Math.round(ent.runtime.waterLevel * 100)}%`,
      extra: '可划拨资金比例',
      icon: Bell,
      color: '#8b5cf6',
      theme: 'purple',
    },
  ];
});

const reformStatusText = computed(() => {
  if (!enterprise.value) return '未知';
  if (enterprise.value.reform.hasReformed) return '已完成';
  return reformStore.state?.status || '未启动';
});

const reformStatusType = computed<'success' | 'warning' | 'info'>(() => {
  if (!enterprise.value) return 'info';
  if (enterprise.value.reform.hasReformed) return 'success';
  if (reformStore.isInProgress) return 'warning';
  return 'info';
});

const reformProgress = computed(() => {
  if (!enterprise.value) return 0;
  if (enterprise.value.reform.hasReformed) return 100;
  return reformStore.progressPercent || 0;
});

onMounted(async () => {
  if (enterpriseStore.currentEnterpriseId && !reformStore.state) {
    await reformStore.loadReformState(enterpriseStore.currentEnterpriseId);
  }
});
</script>

<style lang="scss" scoped>
.enterprise-portal-view {
  display: flex;
  flex-direction: column;
  gap: 16px;

  .welcome-card {
    background: linear-gradient(135deg, #ecfdf5 0%, #f0fdf4 100%);

    .welcome-content {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;

      .welcome-left {
        display: flex;
        align-items: center;
        gap: 16px;

        .welcome-text {
          .welcome-title {
            font-size: 22px;
            font-weight: 700;
            color: #1f2937;
            margin: 0 0 4px 0;
          }

          .welcome-subtitle {
            font-size: 13px;
            color: #6b7280;
            margin: 0;
          }
        }
      }
    }
  }

  .kpi-card {
    border-top: 3px solid var(--el-color-primary);

    &.kpi-blue { border-top-color: #3b82f6; }
    &.kpi-amber { border-top-color: #f59e0b; }
    &.kpi-green { border-top-color: #10b981; }
    &.kpi-purple { border-top-color: #8b5cf6; }

    .kpi-content {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .kpi-info {
      .kpi-label {
        font-size: 12px;
        color: var(--el-text-color-secondary);
        margin-bottom: 4px;
      }

      .kpi-value {
        font-size: 22px;
        font-weight: 700;
        color: var(--el-text-color-primary);
        margin-bottom: 2px;
      }

      .kpi-extra {
        font-size: 11px;
        color: var(--el-text-color-secondary);
      }
    }
  }

  .section-card {
    .card-header-flex {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
  }

  .reform-progress {
    margin-top: 12px;
  }

  .hint {
    margin-top: 8px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
    line-height: 1.5;
  }
}
</style>
