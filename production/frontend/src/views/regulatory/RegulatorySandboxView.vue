<!--
  RegulatorySandboxView.vue — Tab9 监管沙盒
  职责: 监管沙盒 + 脱敏式穿透报告 + 全链路审计追踪(含区块链存证) + 合规检查
  对齐: simulation/js/view-regulatory.js + project_memory 硬约束(穿透报告通知非阻塞toast+用户主动点击审阅+log含id/enterprise/source)
  APP-04 增强: 穿透报告审阅模态窗 (路由原因/资金水位/监管账户余额 + 状态标签 + 审阅操作 + 二次确认阻塞模态)
-->
<template>
  <div class="regulatory-sandbox">
    <el-alert
      title="Tab9 监管沙盒 — 脱敏式穿透报告 + 全链路审计"
      type="info"
      :closable="false"
      show-icon
      description="监管机构视角：触发可疑交易 → 生成脱敏式穿透报告 → 全链路审计追踪(含区块链存证) → 合规检查。原始敏感数据仅在内存计算后物理销毁，仅保留脱敏结果。"
    />

    <el-card shadow="never" class="mt-16">
      <template #header>
        <div class="card-header">
          <span>监管沙盒控制台</span>
          <el-button type="warning" @click="triggerSuspicious">触发可疑交易</el-button>
        </div>
      </template>
      <el-empty v-if="alerts.length === 0" description="当前无告警">
        <template #description>
          <p>当前无告警</p>
          <p class="muted">点击「触发可疑交易」按钮以自包含地演示监管穿透链路</p>
        </template>
      </el-empty>
      <el-table v-else :data="alerts" size="small" stripe>
        <el-table-column prop="id" label="告警ID" width="160" />
        <el-table-column prop="enterprise" label="企业(脱敏)" width="160" />
        <el-table-column prop="type" label="类型" width="140" />
        <el-table-column prop="source" label="数据源" width="120" />
        <el-table-column prop="riskLevel" label="风险等级" width="100">
          <template #default="{ row }"><el-tag size="small" :type="riskTag(row.riskLevel)">{{ row.riskLevel }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="timestamp" label="时间" width="180" />
      </el-table>
    </el-card>

    <el-card shadow="never" class="mt-16">
      <template #header>
        <div class="card-header">
          <span>穿透报告列表 (整卡片点击审阅)</span>
          <el-tag size="small" type="info" effect="plain">
            待审阅 {{ pendingReportCount }} / 已归档 {{ archivedReportCount }}
          </el-tag>
        </div>
      </template>
      <el-empty v-if="reports.length === 0" description="暂无穿透报告" />
      <div v-else class="report-list">
        <el-card
          v-for="r in reports"
          :key="r.id"
          shadow="hover"
          class="report-card"
          :class="`status-${r.status}`"
          @click="openReport(r)"
        >
          <div class="report-card-header">
            <span class="report-id">{{ r.id }}</span>
            <el-tag :type="reportStatusTag(r.status)" size="small">{{ reportStatusLabel(r.status) }}</el-tag>
            <span class="muted">{{ r.enterprise }} · {{ r.timestamp }}</span>
          </div>
          <p class="report-summary">{{ r.summary }}</p>
          <div class="report-card-meta">
            <el-tag size="small" :type="riskTag(r.riskLevel)" effect="plain">风险 {{ r.riskLevel }}</el-tag>
            <el-tag size="small" type="info" effect="plain">数据源: {{ r.source }}</el-tag>
            <span class="muted">点击查看详情 →</span>
          </div>
        </el-card>
      </div>
    </el-card>

    <el-card shadow="never" class="mt-16">
      <template #header><span>全链路审计追踪 (含区块链存证)</span></template>
      <el-timeline>
        <el-timeline-item
          v-for="log in auditLogs"
          :key="log.id"
          :timestamp="log.timestamp"
          :type="log.level === 'BLOCKCHAIN' ? 'success' : 'primary'"
          hollow
        >
          <div class="audit-row">
            <span class="audit-id">{{ log.id }}</span>
            <span class="audit-ent">{{ log.enterprise }}</span>
            <span class="audit-source">[{{ log.source }}]</span>
            <span class="audit-msg">{{ log.message }}</span>
            <span class="audit-hash" v-if="log.hash">指纹: {{ log.hash }}</span>
            <el-tag v-if="log.merkleRoot" size="small" type="success">Merkle: {{ log.merkleRoot }}</el-tag>
          </div>
        </el-timeline-item>
      </el-timeline>
    </el-card>

    <!-- ========== APP-04 穿透报告审阅模态窗 (整卡片点击打开) ========== -->
    <el-dialog
      v-model="reportDialogVisible"
      :title="`穿透报告审阅 — ${currentReport?.id ?? ''}`"
      width="760px"
      :close-on-click-modal="false"
      custom-class="review-modal"
    >
      <div v-if="currentReport" class="review-body">
        <!-- 状态标签 (待审阅/已归档/需补充/标记误报) -->
        <div class="review-status-row">
          <el-tag :type="reportStatusTag(currentReport.status)" size="large" effect="dark">
            {{ reportStatusLabel(currentReport.status) }}
          </el-tag>
          <el-tag :type="riskTag(currentReport.riskLevel)" size="large" effect="plain">
            风险等级: {{ currentReport.riskLevel }}
          </el-tag>
          <span class="muted">生成于 {{ currentReport.timestamp }}</span>
        </div>

        <!-- 报告详情: 路由原因/资金水位/监管账户余额 -->
        <el-descriptions :column="2" border size="small" class="mt-12">
          <el-descriptions-item label="报告ID">{{ currentReport.id }}</el-descriptions-item>
          <el-descriptions-item label="企业(脱敏)">{{ currentReport.enterprise }}</el-descriptions-item>
          <el-descriptions-item label="数据源">{{ currentReport.source }}</el-descriptions-item>
          <el-descriptions-item label="风险等级">{{ currentReport.riskLevel }}</el-descriptions-item>
          <el-descriptions-item label="生成时间">{{ currentReport.timestamp }}</el-descriptions-item>
          <el-descriptions-item label="区块链存证">{{ currentReport.chainHash ?? '—' }}</el-descriptions-item>
          <el-descriptions-item label="路由原因" :span="2">
            {{ currentReport.routeReason ?? '—' }}
          </el-descriptions-item>
          <el-descriptions-item label="资金水位">
            <span :class="fundLevelClass(currentReport.fundLevel)">
              {{ fundLevelLabel(currentReport.fundLevel) }}
            </span>
            <span v-if="currentReport.accountBalanceCents" class="ml-8">
              余额 ¥{{ formatAmountFromCents(currentReport.accountBalanceCents) }}
            </span>
          </el-descriptions-item>
          <el-descriptions-item label="监管账户余额">
            <span v-if="currentReport.supervisionBalanceCents">
              ¥{{ formatAmountFromCents(currentReport.supervisionBalanceCents) }}
            </span>
            <span v-else class="muted">—</span>
          </el-descriptions-item>
        </el-descriptions>

        <el-divider />

        <h4>穿透详情</h4>
        <p class="report-summary-text">{{ currentReport.summary }}</p>
        <p class="muted">{{ currentReport.detail }}</p>

        <!-- 已归档报告: 显示归档操作记录 -->
        <div v-if="currentReviewAction" class="action-record">
          <el-alert
            :type="currentReviewAction.action === 'archive' ? 'success' : 'warning'"
            :title="`已执行: ${reviewActionLabel(currentReviewAction.action)}`"
            :closable="false"
            show-icon
          >
            <template #default>
              <p>操作时间: {{ currentReviewAction.operatedAt }}</p>
              <p>操作原因: {{ currentReviewAction.reason }}</p>
            </template>
          </el-alert>
        </div>
      </div>

      <template #footer>
        <!-- 已审阅 (归档/误报): 仅显示关闭按钮, 不可重复操作 -->
        <div v-if="currentReport && (currentReport.status === 'archived' || currentReport.status === 'falsealarm')">
          <el-button @click="reportDialogVisible = false">关闭</el-button>
        </div>
        <!-- 待审阅/需补充: 显示完整审阅操作 -->
        <div v-else class="review-actions">
          <el-button @click="reportDialogVisible = false">关闭</el-button>
          <el-button type="warning" @click="requestSupplement">退回补充材料</el-button>
          <el-button type="danger" @click="requestFalseAlarm">标记误报</el-button>
          <el-button type="primary" @click="requestArchive">归档</el-button>
        </div>
      </template>
    </el-dialog>

    <!-- ========== APP-04 二次确认阻塞模态窗 (退回/误报不可逆操作, z-index=10000) ========== -->
    <el-dialog
      v-model="confirmModalVisible"
      :title="confirmModalTitle"
      width="520px"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      :show-close="false"
      append-to-body
      custom-class="review-confirm-modal"
    >
      <el-alert
        :type="pendingAction?.action === 'falsealarm' ? 'error' : 'warning'"
        :closable="false"
        show-icon
        :title="confirmAlertTitle"
      >
        <template #default>
          <div v-if="pendingAction" class="confirm-alert-body">
            <p v-if="pendingAction.action === 'falsealarm'">
              标记误报后该报告将移出审计追踪主列表, 不可恢复。
              <span class="text-danger">请确认该报告确系系统误判。</span>
            </p>
            <p v-else>
              退回补充材料后, 报告状态将变为"需补充", 申请人需在 3 个工作日内补充材料重新提交。
              <span class="text-warning">该操作可逆, 申请人补充材料后报告恢复"待审阅"。</span>
            </p>
            <p>报告 ID: <strong>{{ pendingAction.report.id }}</strong></p>
            <p>企业: <strong>{{ pendingAction.report.enterprise }}</strong></p>
          </div>
        </template>
      </el-alert>

      <el-input
        v-model="confirmReason"
        type="textarea"
        :rows="3"
        :placeholder="confirmReasonPlaceholder"
        class="mt-12"
      />

      <template #footer>
        <el-button :disabled="confirmSubmitting" @click="cancelConfirm">取消</el-button>
        <el-button
          :type="pendingAction?.action === 'falsealarm' ? 'danger' : 'warning'"
          :loading="confirmSubmitting"
          :disabled="!confirmReason.trim()"
          @click="executeConfirm"
        >
          {{ confirmExecuteLabel }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';

// === APP-04 类型定义 ===
type ReportStatus = 'pending' | 'archived' | 'supplement' | 'falsealarm';
type FundLevel = 'red' | 'yellow' | 'green' | 'unknown';
type ReviewAction = 'archive' | 'supplement' | 'falsealarm';

interface ActionRecord {
  action: ReviewAction;
  operatedAt: string;
  reason: string;
}

interface PenetrationReport {
  id: string;
  enterprise: string;
  source: string;
  riskLevel: string;
  status: ReportStatus;
  timestamp: string;
  summary: string;
  detail: string;
  chainHash?: string;
  // APP-04 增强: 路由原因/资金水位/监管账户余额
  routeReason?: string;
  fundLevel?: FundLevel;
  accountBalanceCents?: number;
  supervisionBalanceCents?: number;
  // 已审阅操作记录
  reviewAction?: ActionRecord;
}

interface AuditLog {
  id: string;
  enterprise: string;
  source: string;
  message: string;
  level: string;
  timestamp: string;
  hash?: string;
  merkleRoot?: string;
}

interface SandboxAlert {
  id: string;
  enterprise: string;
  type: string;
  source: string;
  riskLevel: string;
  timestamp: string;
}

interface PendingAction {
  report: PenetrationReport;
  action: ReviewAction;
}

const alerts = ref<SandboxAlert[]>([]);
const reports = ref<PenetrationReport[]>([]);
const auditLogs = ref<AuditLog[]>([]);
const reportDialogVisible = ref(false);
const currentReport = ref<PenetrationReport | null>(null);
// APP-04: 二次确认阻塞模态窗
const confirmModalVisible = ref(false);
const pendingAction = ref<PendingAction | null>(null);
const confirmReason = ref<string>('');
const confirmSubmitting = ref(false);

// === 派生状态 ===
const pendingReportCount = computed(
  () => reports.value.filter((r) => r.status === 'pending').length,
);
const archivedReportCount = computed(
  () => reports.value.filter((r) => r.status === 'archived').length,
);

const currentReviewAction = computed(() => currentReport.value?.reviewAction ?? null);

const confirmModalTitle = computed(() => {
  if (!pendingAction.value) return '操作确认';
  const action = pendingAction.value.action;
  if (action === 'archive') return '归档报告确认';
  if (action === 'supplement') return '退回补充材料确认';
  return '标记误报确认 (不可逆)';
});

const confirmAlertTitle = computed(() => {
  if (!pendingAction.value) return '';
  return pendingAction.value.action === 'falsealarm'
    ? '标记误报为不可逆操作, 请确认'
    : '退回补充材料';
});

const confirmReasonPlaceholder = computed(() => {
  if (!pendingAction.value) return '请填写操作原因';
  if (pendingAction.value.action === 'falsealarm') {
    return '请说明为何判定为误报 (审计追溯用, 不可空)';
  }
  if (pendingAction.value.action === 'supplement') {
    return '请说明需要补充哪些材料 (申请人可见, 不可空)';
  }
  return '归档原因 (可选)';
});

const confirmExecuteLabel = computed(() => {
  if (!pendingAction.value) return '确认';
  const action = pendingAction.value.action;
  if (action === 'archive') return '确认归档';
  if (action === 'supplement') return '确认退回';
  return '确认标记误报 (不可逆)';
});

function riskTag(l: string) {
  if (l === '高') return 'danger';
  if (l === '中') return 'warning';
  return 'info';
}

function reportStatusTag(s: ReportStatus) {
  const map: Record<ReportStatus, 'warning' | 'success' | 'info' | 'danger'> = {
    pending: 'warning',
    archived: 'success',
    supplement: 'info',
    falsealarm: 'danger',
  };
  return map[s] ?? 'info';
}

function reportStatusLabel(s: ReportStatus) {
  const map: Record<ReportStatus, string> = {
    pending: '待审阅',
    archived: '已归档',
    supplement: '需补充',
    falsealarm: '标记误报',
  };
  return map[s] ?? s;
}

function reviewActionLabel(a: ReviewAction) {
  const map: Record<ReviewAction, string> = {
    archive: '归档',
    supplement: '退回补充材料',
    falsealarm: '标记误报',
  };
  return map[a];
}

function fundLevelLabel(l?: FundLevel) {
  if (!l) return '—';
  const map: Record<FundLevel, string> = {
    red: '红灯 (低于 50 万)',
    yellow: '黄灯 (50-100 万)',
    green: '绿灯 (≥ 100 万)',
    unknown: '未知',
  };
  return map[l];
}

function fundLevelClass(l?: FundLevel) {
  if (!l) return '';
  return `text-${l === 'red' ? 'danger' : l === 'yellow' ? 'warning' : 'success'}`;
}

function formatAmountFromCents(cents: number): string {
  const yuan = cents / 100;
  if (yuan >= 10000) {
    return `${(yuan / 10000).toFixed(2)} 万`;
  }
  return yuan.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
}

async function triggerSuspicious() {
  const id = `ALERT-${Date.now().toString(36)}`;
  alerts.value.unshift({
    id, enterprise: '深圳***科技', type: '资金抽逃嫌疑', source: '银企直连', riskLevel: '高',
    timestamp: new Date().toLocaleString('zh-CN'),
  });
  // project_memory: 穿透报告生成通知非阻塞 toast
  ElMessage({
    type: 'warning',
    message: '可疑交易已触发，穿透报告生成中…（点击报告卡片审阅）',
    duration: 6500,
  });
  // 模拟生成穿透报告 + 审计日志
  const rid = `RPT-${Date.now().toString(36)}`;
  reports.value.unshift({
    id: rid, enterprise: '深圳***科技', source: '银企直连+税务+物流',
    riskLevel: '高', status: 'pending', timestamp: new Date().toLocaleString('zh-CN'),
    summary: '检测到企业账户在 48h 内向关联方转移资金 230 万，超过应收账款 40%，触发资金抽逃穿透。',
    detail: '穿透链路：银企直连(账户流水) → 税务(关联方识别) → 物流(货物流向比对) → 区块链存证。原始流水已物理销毁，仅保留脱敏结论。',
    chainHash: '0x' + Math.random().toString(16).slice(2, 18),
    routeReason: '触发规则: 关联方资金转移 > 应收账款 40% (实际 47.6%)',
    fundLevel: 'red',
    accountBalanceCents: 32_000_000, // 32 万 分
    supervisionBalanceCents: 56_000_000, // 56 万 分
  });
  auditLogs.value.unshift({
    id: rid, enterprise: '深圳***科技', source: '穿透引擎',
    message: '生成穿透报告并上链', level: 'BLOCKCHAIN',
    timestamp: new Date().toLocaleString('zh-CN'),
    hash: Math.random().toString(16).slice(2, 10),
    merkleRoot: '0x' + Math.random().toString(16).slice(2, 14),
  });
}

/** 整卡片点击打开审阅模态 */
function openReport(r: PenetrationReport) {
  currentReport.value = r;
  reportDialogVisible.value = true;
}

// === APP-04 审阅操作 (均触发二次确认阻塞模态) ===

function requestArchive() {
  if (!currentReport.value) return;
  // 归档为可逆操作, 但仍走二次确认避免误操作
  pendingAction.value = { report: currentReport.value, action: 'archive' };
  confirmReason.value = '';
  confirmModalVisible.value = true;
}

function requestSupplement() {
  if (!currentReport.value) return;
  pendingAction.value = { report: currentReport.value, action: 'supplement' };
  confirmReason.value = '';
  confirmModalVisible.value = true;
}

function requestFalseAlarm() {
  if (!currentReport.value) return;
  pendingAction.value = { report: currentReport.value, action: 'falsealarm' };
  confirmReason.value = '';
  confirmModalVisible.value = true;
}

function cancelConfirm() {
  confirmModalVisible.value = false;
  pendingAction.value = null;
  confirmReason.value = '';
}

async function executeConfirm() {
  const action = pendingAction.value;
  if (!action) return;
  if (!confirmReason.value.trim()) {
    ElMessage.warning('请填写操作原因');
    return;
  }
  confirmSubmitting.value = true;
  try {
    // 模拟异步操作 (真实场景调 POST /api/v1/regulatory/reports/{id}/review)
    await new Promise((resolve) => setTimeout(resolve, 200));
    const report = action.report;
    const record: ActionRecord = {
      action: action.action,
      operatedAt: new Date().toLocaleString('zh-CN'),
      reason: confirmReason.value.trim(),
    };
    if (action.action === 'archive') {
      report.status = 'archived';
    } else if (action.action === 'supplement') {
      report.status = 'supplement';
    } else {
      report.status = 'falsealarm';
    }
    report.reviewAction = record;
    ElMessage.success(`已执行: ${reviewActionLabel(action.action)}`);
    confirmModalVisible.value = false;
    pendingAction.value = null;
    confirmReason.value = '';
    // 审计日志追加
    auditLogs.value.unshift({
      id: report.id,
      enterprise: report.enterprise,
      source: '审阅操作',
      message: `审阅动作: ${reviewActionLabel(action.action)} — ${record.reason}`,
      level: 'INFO',
      timestamp: record.operatedAt,
    });
  } finally {
    confirmSubmitting.value = false;
  }
}

onMounted(() => {});
</script>

<style scoped lang="scss">
.mt-16 { margin-top: 16px; }
.mt-12 { margin-top: 12px; }
.ml-8 { margin-left: 8px; }
.muted { color: var(--el-text-color-secondary); font-size: 12px; }
.card-header { display: flex; justify-content: space-between; align-items: center; }
.report-list { display: flex; flex-direction: column; gap: 8px; }
.report-card {
  cursor: pointer;
  transition: all 0.25s ease;
  &:hover {
    transform: translateX(2px);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  }
  &.status-pending { border-left: 4px solid var(--el-color-warning); }
  &.status-archived { border-left: 4px solid var(--el-color-success); }
  &.status-supplement { border-left: 4px solid var(--el-color-info); }
  &.status-falsealarm { border-left: 4px solid var(--el-color-danger); opacity: 0.8; }
  .report-card-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 8px;
  }
  .report-id { font-family: monospace; color: var(--el-color-primary); font-weight: 600; }
  .report-summary { margin: 8px 0; color: var(--el-text-color-regular); font-size: 13px; line-height: 1.5; }
  .report-card-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    .muted { margin-left: auto; }
  }
}

.audit-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.audit-id { font-family: monospace; color: var(--el-color-primary); }
.audit-ent { font-weight: 600; }
.audit-source { color: var(--el-text-color-secondary); }
.audit-hash { font-family: monospace; font-size: 12px; color: var(--el-text-color-secondary); }

// === APP-04 审阅模态窗 ===
.review-body {
  .review-status-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    background: var(--el-fill-color-darker);
    border-radius: 6px;
    .muted { margin-left: auto; }
  }
  .report-summary-text {
    margin: 8px 0;
    color: var(--el-text-color-primary);
    line-height: 1.6;
  }
  .action-record {
    margin-top: 16px;
  }
}

.review-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

// === APP-04 二次确认阻塞模态窗 ===
.confirm-alert-body {
  p {
    margin: 6px 0;
    font-size: 13px;
    line-height: 1.5;
  }
}
</style>
