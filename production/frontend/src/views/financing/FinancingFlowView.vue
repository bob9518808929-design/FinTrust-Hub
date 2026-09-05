<!--
  FinancingFlowView.vue — 融资流程入口 (MOD-11 再融资闭环)
  设计哲学:
    前因: 企业改造完成后要融资, 后端是"AI 推荐 4 款方案 + 用户选一个提交"模式,
          不是让用户填表单拍脑袋, 而是 AI 替用户做苦力, 用户做关键拍板.
    后果: 用户选定一个 AI 推荐方案并提交后, 申请进入审批流, 银行端审批结果回流到这里.
  布局:
    1. 顶部: 融资入口判定卡片 (eligible / gapSizeLabel / suggestedSchemes)
    2. 中部: AI 推荐方案卡片网格 (4 张, 每张含金额/利率/期限/通过率/总成本/理由)
    3. 底部: 6 个月现金流预测表 + 已提交融资单列表
-->
<template>
  <div class="financing-flow-view">
    <!-- ========== 1. 融资入口锁定提示 ========== -->
    <el-card v-if="!enterpriseStore.currentEnterprise?.runtime.financingUnlocked" class="lock-card">
      <el-alert
        title="融资入口未解锁"
        type="warning"
        description="请先在改造工作台完成企业改造 (R0→R7), 解锁 financingUnlocked 后再发起融资"
        show-icon
        :closable="false"
      >
        <el-button type="primary" size="small" @click="$router.push('/reform')">
          前往改造工作台
        </el-button>
      </el-alert>
    </el-card>

    <template v-else>
      <!-- ========== 2. 融资入口判定 ========== -->
      <el-card shadow="never" class="section-card">
        <template #header>
          <div class="card-header-flex">
            <span>📊 融资入口判定</span>
            <el-button
              type="primary"
              :icon="Refresh"
              :loading="loadingEntrance"
              size="small"
              @click="loadEntrance"
            >
              重新判定
            </el-button>
          </div>
        </template>

        <el-skeleton v-if="loadingEntrance" :rows="2" animated />
        <template v-else-if="entrance">
          <el-descriptions :column="3" border>
            <el-descriptions-item label="企业 ID">
              {{ entrance.enterpriseId }}
            </el-descriptions-item>
            <el-descriptions-item label="是否可融资">
              <el-tag :type="entrance.eligible ? 'success' : 'danger'" size="small">
                {{ entrance.eligible ? '✓ 可融资' : '✗ 暂不可融资' }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="缺口规模">
              <el-tag :type="gapSizeTag(entrance.gapSizeLabel)" size="small">
                {{ gapSizeLabel(entrance.gapSizeLabel) }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="建议融资方案" :span="3">
              <el-tag
                v-for="s in entrance.suggestedSchemes"
                :key="s"
                size="small"
                class="scheme-tag"
              >
                {{ s }}
              </el-tag>
              <span v-if="!entrance.suggestedSchemes.length" class="muted">无</span>
            </el-descriptions-item>
          </el-descriptions>
        </template>
        <el-empty v-else description="点击「重新判定」获取入口分析" />
      </el-card>

      <!-- ========== 3. AI 推荐融资方案 ========== -->
      <el-card shadow="never" class="section-card">
        <template #header>
          <div class="card-header-flex">
            <span>🤖 AI 推荐融资方案 (4 选 1, 选定后提交申请)</span>
            <el-button
              type="primary"
              :icon="MagicStick"
              :loading="loadingRecommend"
              size="small"
              @click="loadRecommendations"
            >
              重新生成推荐
            </el-button>
          </div>
        </template>

        <el-skeleton v-if="loadingRecommend" :rows="4" animated />
        <el-empty v-else-if="!recommendations.length" description="暂无 AI 推荐, 点击「重新生成推荐」" />
        <el-row v-else :gutter="12">
          <el-col
            v-for="rec in recommendations"
            :key="rec.recId"
            :span="12"
            class="rec-col"
          >
            <el-card
              shadow="hover"
              :class="['rec-card', { 'is-selected': selectedRecId === rec.recId }]"
              @click="selectRec(rec.recId)"
            >
              <div class="rec-head">
                <span class="rec-product">{{ rec.productName }}</span>
                <el-tag size="small" type="info">{{ rec.lender }}</el-tag>
              </div>
              <el-descriptions :column="2" size="small" border>
                <el-descriptions-item label="可贷金额">
                  <span class="text-primary big">¥{{ formatAmount(rec.amountCents) }}</span>
                </el-descriptions-item>
                <el-descriptions-item label="年利率">
                  {{ rec.annualRatePct.toFixed(2) }}%
                </el-descriptions-item>
                <el-descriptions-item label="期限">
                  {{ rec.termMonths }} 月
                </el-descriptions-item>
                <el-descriptions-item label="预期通过率">
                  <el-progress
                    :percentage="Math.round(rec.expectedApprovalProb * 100)"
                    :stroke-width="14"
                    :status="rec.expectedApprovalProb >= 0.7 ? 'success' : undefined"
                  />
                </el-descriptions-item>
                <el-descriptions-item label="总成本" :span="2">
                  <span class="text-warning">¥{{ formatAmount(rec.totalCostCents) }}</span>
                </el-descriptions-item>
                <el-descriptions-item label="AI 推荐理由" :span="2">
                  <ul class="rec-reasons">
                    <li v-for="(r, i) in rec.reasons" :key="i">{{ r }}</li>
                  </ul>
                </el-descriptions-item>
              </el-descriptions>
              <div class="rec-actions">
                <el-button
                  :type="selectedRecId === rec.recId ? 'success' : 'primary'"
                  size="small"
                  @click.stop="selectRec(rec.recId)"
                >
                  {{ selectedRecId === rec.recId ? '✓ 已选用' : '选用此方案' }}
                </el-button>
              </div>
            </el-card>
          </el-col>
        </el-row>

        <el-divider v-if="selectedRecId" />
        <div v-if="selectedRecId" class="submit-bar">
          <span class="muted">
            已选用方案:
            <strong>{{ selectedRec?.productName }} ({{ selectedRec?.lender }})</strong>
          </span>
          <el-button
            type="primary"
            size="default"
            :loading="submitting"
            :icon="Promotion"
            @click="onSubmit"
          >
            提交融资申请
          </el-button>
        </div>
      </el-card>

      <!-- ========== 4. 6 个月现金流预测 ========== -->
      <el-card shadow="never" class="section-card">
        <template #header>
          <div class="card-header-flex">
            <span>📈 6 个月现金流预测</span>
            <el-button
              :icon="Refresh"
              :loading="loadingCashflow"
              size="small"
              @click="loadCashflow"
            >
              刷新预测
            </el-button>
          </div>
        </template>

        <el-skeleton v-if="loadingCashflow" :rows="3" animated />
        <el-empty v-else-if="!cashflow.length" description="暂无现金流预测数据" />
        <el-table v-else :data="cashflow" stripe size="small">
          <el-table-column prop="monthIso" label="月份" width="120" />
          <el-table-column label="预计流入">
            <template #default="{ row }">¥{{ formatAmount(row.projectedInflowCents) }}</template>
          </el-table-column>
          <el-table-column label="预计流出">
            <template #default="{ row }">¥{{ formatAmount(row.projectedOutflowCents) }}</template>
          </el-table-column>
          <el-table-column label="当月缺口">
            <template #default="{ row }">
              <span :class="row.gapCents < 0 ? 'text-danger' : 'text-success'">
                ¥{{ formatAmount(Math.abs(row.gapCents)) }} {{ row.gapCents < 0 ? '(缺)' : '(余)' }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="累计缺口">
            <template #default="{ row }">
              <span :class="row.cumulativeGapCents < 0 ? 'text-danger' : ''">
                ¥{{ formatAmount(Math.abs(row.cumulativeGapCents)) }}
              </span>
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <!-- ========== 5. 已提交融资单列表 ========== -->
      <el-card shadow="never" class="section-card">
        <template #header>
          <div class="card-header-flex">
            <span>📋 已提交融资申请</span>
            <el-button :icon="Refresh" size="small" @click="loadSubmissions">刷新</el-button>
          </div>
        </template>
        <el-empty v-if="!submissions.length" description="暂无已提交申请" />
        <el-table v-else :data="submissions" stripe size="small">
          <el-table-column prop="recId" label="推荐方案 ID" width="160" />
          <el-table-column label="状态" width="140">
            <template #default="{ row }">
              <el-tag :type="submissionTagType(row.status)" size="small">
                {{ submissionLabel(row.status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="createdAt" label="提交时间" />
        </el-table>
      </el-card>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { Refresh, MagicStick, Promotion } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useEnterpriseStore } from '@/stores/enterprise';
import * as refinanceApi from '@/api/refinance';
import type {
  AIRecommendation,
  CashflowForecast,
  GapSizeLabel,
  RefinanceEntrance,
  RefinanceSubmission,
  SubmissionStatus,
} from '@/api/refinance';

defineOptions({ name: 'FinancingFlowView' });

const enterpriseStore = useEnterpriseStore();

const entrance = ref<RefinanceEntrance | null>(null);
const recommendations = ref<AIRecommendation[]>([]);
const cashflow = ref<CashflowForecast[]>([]);
const submissions = ref<RefinanceSubmission[]>([]);

const loadingEntrance = ref(false);
const loadingRecommend = ref(false);
const loadingCashflow = ref(false);
const submitting = ref(false);

const selectedRecId = ref<string | null>(null);
const selectedRec = computed(() =>
  recommendations.value.find((r) => r.recId === selectedRecId.value) ?? null,
);

function selectRec(recId: string) {
  selectedRecId.value = recId;
}

async function loadEntrance() {
  const entId = enterpriseStore.currentEnterpriseId;
  if (!entId) {
    ElMessage.warning('请先在顶部选择企业');
    return;
  }
  loadingEntrance.value = true;
  try {
    entrance.value = await refinanceApi.computeEntrance(entId);
  } catch (e) {
    ElMessage.error('入口判定失败: ' + (e instanceof Error ? e.message : String(e)));
  } finally {
    loadingEntrance.value = false;
  }
}

async function loadRecommendations() {
  const entId = enterpriseStore.currentEnterpriseId;
  if (!entId) {
    ElMessage.warning('请先在顶部选择企业');
    return;
  }
  loadingRecommend.value = true;
  selectedRecId.value = null;
  try {
    recommendations.value = await refinanceApi.aiRecommend(entId, true);
    if (recommendations.value.length === 0) {
      ElMessage.info('AI 暂无推荐方案, 可稍后再试或联系顾问');
    } else {
      ElMessage.success(`AI 已推荐 ${recommendations.value.length} 个方案, 请选一个提交`);
    }
  } catch (e) {
    ElMessage.error('AI 推荐生成失败: ' + (e instanceof Error ? e.message : String(e)));
  } finally {
    loadingRecommend.value = false;
  }
}

async function loadCashflow() {
  const entId = enterpriseStore.currentEnterpriseId;
  if (!entId) {
    ElMessage.warning('请先在顶部选择企业');
    return;
  }
  loadingCashflow.value = true;
  try {
    cashflow.value = await refinanceApi.forecastCashflow(entId, 6);
  } catch (e) {
    ElMessage.error('现金流预测失败: ' + (e instanceof Error ? e.message : String(e)));
  } finally {
    loadingCashflow.value = false;
  }
}

async function loadSubmissions() {
  // 后端未提供 list 接口, submissions 列表暂由本地维护 (提交后追加)
  // 路线图: 接入 GET /modules/refinance/{entId}/submissions 后改为拉取
}

async function onSubmit() {
  const entId = enterpriseStore.currentEnterpriseId;
  if (!entId || !selectedRecId.value) {
    ElMessage.warning('请先选用一个 AI 推荐方案');
    return;
  }
  const rec = selectedRec.value;
  if (!rec) return;
  try {
    await ElMessageBox.confirm(
      `确认提交融资申请?\n\n方案: ${rec.productName} (${rec.lender})\n金额: ¥${formatAmount(rec.amountCents)}\n利率: ${rec.annualRatePct.toFixed(2)}%\n期限: ${rec.termMonths} 月`,
      '提交确认',
      { confirmButtonText: '确认提交', cancelButtonText: '再想想', type: 'info' },
    );
  } catch {
    return; // 用户取消
  }
  submitting.value = true;
  try {
    const result = await refinanceApi.submitApplication(entId, selectedRecId.value);
    submissions.value.unshift(result);
    ElMessage.success(`融资申请已提交, 当前状态: ${submissionLabel(result.status)}`);
    selectedRecId.value = null;
  } catch (e) {
    ElMessage.error('提交失败: ' + (e instanceof Error ? e.message : String(e)));
  } finally {
    submitting.value = false;
  }
}

function formatAmount(cents: number): string {
  return (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function gapSizeLabel(label: GapSizeLabel): string {
  return { small: '小额', medium: '中额', large: '大额' }[label] ?? label;
}

function gapSizeTag(label: GapSizeLabel) {
  return ({ small: 'success', medium: 'warning', large: 'danger' } as const)[label] ?? 'info';
}

function submissionLabel(s: SubmissionStatus): string {
  return {
    draft: '草稿',
    submitted: '已提交',
    pending_approval: '审批中',
    approved: '已通过',
    rejected: '已拒绝',
  }[s] ?? s;
}

function submissionTagType(s: SubmissionStatus) {
  return ({
    draft: 'info',
    submitted: 'primary',
    pending_approval: 'warning',
    approved: 'success',
    rejected: 'danger',
  } as const)[s] ?? 'info';
}

onMounted(async () => {
  // 自动并行加载入口判定 + AI 推荐 + 现金流
  await Promise.allSettled([loadEntrance(), loadRecommendations(), loadCashflow()]);
});
</script>

<style lang="scss" scoped>
.financing-flow-view {
  .section-card {
    margin-bottom: 16px;
  }

  .card-header-flex {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .scheme-tag {
    margin-right: 6px;
    margin-bottom: 4px;
  }

  .rec-col {
    margin-bottom: 12px;
  }

  .rec-card {
    cursor: pointer;
    transition: border-color 0.2s, box-shadow 0.2s;

    &:hover {
      border-color: var(--el-color-primary);
    }

    &.is-selected {
      border-color: var(--el-color-success);
      box-shadow: 0 0 0 2px var(--el-color-success-light-5);
    }

    .rec-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;

      .rec-product {
        font-weight: 600;
        font-size: 15px;
      }
    }

    .rec-reasons {
      margin: 0;
      padding-left: 18px;
      font-size: 12px;
      color: var(--el-text-color-secondary);
    }

    .rec-actions {
      margin-top: 8px;
      text-align: right;
    }
  }

  .submit-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
    background: var(--el-color-primary-light-9);
    border-radius: 4px;
  }

  .muted {
    color: var(--el-text-color-secondary);
    font-size: 13px;
  }

  .big {
    font-size: 16px;
    font-weight: 600;
  }
}
</style>
