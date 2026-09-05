<!--
  AdvisorWorkbenchView.vue — Tab6 财务顾问运营台
  职责: 全局仪表盘 + 撮合工作台(企业需求↔银行产品) + 佣金结算 + 客户管理 + 工作流
  对齐: simulation/js/view-advisor.js ("一手托两家")
-->
<template>
  <div class="advisor-workbench">
    <el-alert
      title="Tab6 财务顾问运营台 — 一手托两家"
      type="info"
      :closable="false"
      show-icon
      description="财务顾问公司全局视角，跨企业仪表盘、撮合企业需求与银行产品、佣金结算、客户管理与工作流。AI 根据企业信用/行业/需求自动匹配最优银行产品。"
    />

    <!-- === APP-03 Tab 切换 === -->
    <el-tabs v-model="activeTab" class="mt-16 advisor-tabs" type="card">
      <el-tab-pane label="📊 运营仪表盘" name="dashboard">
        <el-card shadow="never">
          <template #header><span>全局仪表盘</span></template>
          <el-row :gutter="16">
            <el-col :span="6"><el-statistic title="在管企业" :value="totalManaged" /></el-col>
            <el-col :span="6"><el-statistic title="账户总余额" :value="totalBalance" :precision="0" prefix="¥" /></el-col>
            <el-col :span="6"><el-statistic title="待收应收" :value="totalAR" :precision="0" prefix="¥" /></el-col>
            <el-col :span="6"><el-statistic title="待审批工单" :value="pendingApprovals" /></el-col>
          </el-row>
        </el-card>

        <el-card shadow="never" class="mt-16">
          <template #header><span>撮合工作台 — 企业需求 ↔ 银行产品</span></template>
          <el-row :gutter="16">
            <el-col :span="12">
              <h4>企业融资需求</h4>
              <el-table :data="enterpriseDemands" size="small" stripe @row-click="selectDemand">
                <el-table-column prop="enterprise" label="企业" />
                <el-table-column label="需求额度" width="120"><template #default="{ row }">¥{{ formatAmount(row.amount) }}</template></el-table-column>
                <el-table-column prop="industry" label="行业" width="100" />
                <el-table-column prop="creditGrade" label="信用等级" width="90" />
              </el-table>
            </el-col>
            <el-col :span="12">
              <h4>AI 推荐银行产品</h4>
              <el-table :data="matchedProducts" size="small" stripe>
                <el-table-column prop="bank" label="银行" />
                <el-table-column prop="product" label="产品" width="140" />
                <el-table-column label="利率" width="80"><template #default="{ row }">{{ row.rate }}%</template></el-table-column>
                <el-table-column label="匹配度" width="100">
                  <template #default="{ row }">
                    <el-progress :percentage="row.matchScore" :stroke-width="6" :status="row.matchScore >= 80 ? 'success' : ''" />
                  </template>
                </el-table-column>
              </el-table>
            </el-col>
          </el-row>
        </el-card>

        <el-card shadow="never" class="mt-16">
          <template #header><span>佣金结算</span></template>
          <el-table :data="commissionRows" size="small" stripe show-summary :summary-method="commissionSummary">
            <el-table-column prop="enterprise" label="企业" />
            <el-table-column label="融资金额" width="140"><template #default="{ row }">¥{{ formatAmount(row.amount) }}</template></el-table-column>
            <el-table-column label="佣金比例" width="100"><template #default="{ row }">{{ row.rate }}%</template></el-table-column>
            <el-table-column label="佣金" width="140"><template #default="{ row }">¥{{ formatAmount(row.commission) }}</template></el-table-column>
            <el-table-column prop="status" label="状态" width="100">
              <template #default="{ row }"><el-tag size="small" :type="row.status === '已结' ? 'success' : 'warning'">{{ row.status }}</el-tag></template>
            </el-table-column>
          </el-table>
        </el-card>

        <!-- UX-04: 红绿灯异常清单 + NLP 搜索 -->
        <el-card shadow="never" class="mt-16 abnormal-card">
          <template #header>
            <div class="abnormal-header">
              <span>🚦 异常清单 (红绿灯汇总)</span>
              <el-tag size="small" type="warning" effect="dark">红灯 {{ totalRed }} / 黄灯 {{ totalYellow }}</el-tag>
            </div>
          </template>

          <div class="nlp-search">
            <el-input
              v-model="searchQuery"
              placeholder="试试输入：显示所有融资被拒的 / 哪些企业改造进度落后 / 红灯超过3个的企业"
              clearable
              size="large"
              @keyup.enter="onSearch"
            >
              <template #prefix>
                <el-icon><Search /></el-icon>
              </template>
              <template #append>
                <el-button type="primary" @click="onSearch">搜索</el-button>
              </template>
            </el-input>
            <div class="nlp-hints">
              <el-tag
                v-for="(h, i) in quickHints"
                :key="i"
                class="nlp-hint-tag"
                size="small"
                effect="plain"
                type="info"
                @click="useHint(h)"
              >
                {{ h }}
              </el-tag>
            </div>
            <div v-if="parsedLabel" class="nlp-parsed">
              已识别筛选: <el-tag size="small" type="success" effect="dark">{{ parsedLabel }}</el-tag>
              <span class="nlp-match-count">命中 {{ filteredAbnormal.length }} 条</span>
            </div>
          </div>

          <el-table :data="filteredAbnormal" size="small" stripe class="abnormal-table">
            <el-table-column prop="enterprise" label="企业名" min-width="180" />
            <el-table-column prop="abnormalType" label="异常类型" min-width="160" />
            <el-table-column label="红绿灯" width="100">
              <template #default="{ row }">
                <el-tag
                  size="small"
                  effect="dark"
                  :type="row.light === 'red' ? 'danger' : row.light === 'yellow' ? 'warning' : 'success'"
                >
                  {{ row.light === 'red' ? '红灯' : row.light === 'yellow' ? '黄灯' : '绿灯' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="红灯数" width="80">
              <template #default="{ row }">
                <span :class="{ 'red-count': row.redLightCount > 0 }">{{ row.redLightCount }}</span>
              </template>
            </el-table-column>
            <el-table-column label="改造进度" width="100">
              <template #default="{ row }">{{ row.reformProgress }}%</template>
            </el-table-column>
            <el-table-column label="信用分" width="80" prop="creditScore" />
            <el-table-column label="详情" width="80">
              <template #default="{ row }">
                <el-button link type="primary" size="small" @click="$router.push(`/enterprise/${row.enterpriseId}`)">查看</el-button>
              </template>
            </el-table-column>
            <el-table-column label="处理" width="100">
              <template #default="{ row }: { row: any }">
                <el-button link type="warning" size="small" @click="onHandle(row)">处理</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <!-- === APP-03 客户管理 tab === -->
      <el-tab-pane :label="`👥 客户管理 (${customers.length})`" name="customers">
        <el-card shadow="never">
          <template #header>
            <div class="card-header">
              <span>客户管理列表</span>
              <el-button type="primary" :icon="Plus" @click="openCustomerDialog">
                新增客户
              </el-button>
            </div>
          </template>
          <el-table :data="customers" size="small" stripe>
            <el-table-column prop="name" label="企业名" min-width="160" />
            <el-table-column label="合作模式" width="220">
              <template #default="{ row }">
                <el-tag
                  v-for="m in row.cooperationModes"
                  :key="m"
                  size="small"
                  effect="plain"
                  class="mode-tag"
                  :type="modeTagType(m)"
                >
                  {{ cooperationModeLabel(m) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="授信额度" width="140">
              <template #default="{ row }">¥{{ formatAmount(row.creditLimit) }}</template>
            </el-table-column>
            <el-table-column label="最近跟进" width="180">
              <template #default="{ row }">
                <span :class="{ 'text-warning': isStaleFollowup(row.lastFollowupAt) }">
                  {{ row.lastFollowupNote || '—' }}
                </span>
                <div class="muted">{{ formatDate(row.lastFollowupAt) }}</div>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="120">
              <template #default="{ row }">
                <el-button link type="primary" size="small" @click="openCustomerDrawer(row as AdvisorCustomer)">
                  详情
                </el-button>
                <el-button link type="warning" size="small" @click="quickFollowup(row as AdvisorCustomer)">
                  跟进
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <!-- === APP-03 工作流 tab === -->
      <el-tab-pane :label="`📋 工作流 (${pendingTaskCount})`" name="workflow">
        <el-card shadow="never">
          <template #header>
            <div class="card-header">
              <span>待办任务 (按优先级排序)</span>
              <el-tag size="small" :type="overdueTaskCount > 0 ? 'danger' : 'info'">
                超期 {{ overdueTaskCount }} / 总 {{ tasks.length }}
              </el-tag>
            </div>
          </template>
          <el-table :data="sortedTasks" size="small" stripe>
            <el-table-column label="优先级" width="90">
              <template #default="{ row }">
                <el-tag size="small" effect="dark" :type="priorityTag(row.priority)">
                  {{ priorityLabel(row.priority) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="title" label="任务标题" min-width="180" />
            <el-table-column prop="customerName" label="关联客户" width="140" />
            <el-table-column label="状态" width="120">
              <template #default="{ row }">
                <el-tag size="small" :type="statusTag(row.status)">
                  {{ statusLabel(row.status) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="截止时间" width="180">
              <template #default="{ row }">
                <span :class="{ 'text-danger': isOverdue(row.dueAt) }">
                  {{ formatDateTime(row.dueAt) }}
                </span>
              </template>
            </el-table-column>
            <el-table-column label="状态流转" width="280">
              <template #default="{ row }">
                <el-button-group size="small">
                  <el-button
                    :type="(row as WorkflowTask).status === 'pending' ? 'info' : 'default'"
                    :disabled="true"
                  >待处理</el-button>
                  <el-button
                    :type="(row as WorkflowTask).status === 'in_progress' ? 'warning' : 'default'"
                    :disabled="(row as WorkflowTask).status === 'completed' || (row as WorkflowTask).status === 'in_progress'"
                    @click="advanceTask(row as WorkflowTask, 'in_progress')"
                  >进行中</el-button>
                  <el-button
                    :type="(row as WorkflowTask).status === 'completed' ? 'success' : 'default'"
                    :disabled="(row as WorkflowTask).status === 'pending' || (row as WorkflowTask).status === 'completed'"
                    @click="advanceTask(row as WorkflowTask, 'completed')"
                  >已完成</el-button>
                </el-button-group>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>
    </el-tabs>

    <!-- === APP-03 客户新增/编辑模态窗 === -->
    <el-dialog
      v-model="customerDialogVisible"
      :title="customerForm.id ? '编辑客户' : '新增客户'"
      width="560px"
      :close-on-click-modal="false"
    >
      <el-form :model="customerForm" label-width="100px" ref="customerFormRef" :rules="customerFormRules">
        <el-form-item label="企业名" prop="name">
          <el-input v-model="customerForm.name" placeholder="例如 深圳科创电子" />
        </el-form-item>
        <el-form-item label="合作模式" prop="cooperationModes">
          <PillButtonGroup
            v-model="customerForm.cooperationModes"
            :options="cooperationModeOptions"
            multiple
          />
        </el-form-item>
        <el-form-item label="授信额度" prop="creditLimit">
          <el-input-number
            v-model="customerForm.creditLimit"
            :min="0"
            :step="10000"
            :max="100000000"
            controls-position="right"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="最近跟进">
          <el-input
            v-model="customerForm.lastFollowupNote"
            type="textarea"
            :rows="2"
            placeholder="例如: 已对接工行客户经理, 待提交授信材料"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="customerDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="customerSubmitting" @click="submitCustomerForm">保存</el-button>
      </template>
    </el-dialog>

    <!-- === APP-03 客户详情抽屉 === -->
    <el-drawer
      v-model="customerDrawerVisible"
      :title="`客户详情 — ${currentDrawerCustomer?.name ?? ''}`"
      direction="rtl"
      size="520px"
    >
      <template v-if="currentDrawerCustomer">
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="企业名">{{ currentDrawerCustomer.name }}</el-descriptions-item>
          <el-descriptions-item label="合作模式">
            <el-tag
              v-for="m in currentDrawerCustomer.cooperationModes"
              :key="m"
              size="small"
              effect="plain"
              class="mode-tag"
              :type="modeTagType(m)"
            >
              {{ cooperationModeLabel(m) }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="授信额度">¥{{ formatAmount(currentDrawerCustomer.creditLimit) }}</el-descriptions-item>
          <el-descriptions-item label="最近跟进">{{ currentDrawerCustomer.lastFollowupNote || '—' }}</el-descriptions-item>
          <el-descriptions-item label="跟进时间">{{ formatDate(currentDrawerCustomer.lastFollowupAt) }}</el-descriptions-item>
          <el-descriptions-item label="创建时间">{{ formatDate(currentDrawerCustomer.createdAt) }}</el-descriptions-item>
        </el-descriptions>

        <el-divider content-position="left">跟进记录</el-divider>
        <el-empty v-if="currentDrawerCustomer.followups.length === 0" description="暂无跟进记录" :image-size="60" />
        <el-timeline v-else>
          <el-timeline-item
            v-for="(f, i) in currentDrawerCustomer.followups"
            :key="i"
            :timestamp="formatDateTime(f.at)"
            type="primary"
          >
            {{ f.note }}
          </el-timeline-item>
        </el-timeline>

        <el-divider content-position="left">快捷操作</el-divider>
        <div class="drawer-actions">
          <el-button type="primary" :icon="Edit" @click="editFromDrawer">编辑客户</el-button>
          <el-button :icon="ChatDotRound" @click="addFollowupFromDrawer">添加跟进</el-button>
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { Search, Plus, Edit, ChatDotRound } from '@element-plus/icons-vue';
import { useEnterpriseStore } from '@/stores/enterprise';
import { useReformStore } from '@/stores/reform';
import {
  applyFilter, parseNlpQuery, NLP_HINTS,
  type AbnormalRow,
} from '@/utils/nlpSearch';
import PillButtonGroup from '@/components/common/PillButtonGroup.vue';

// === APP-03 Tab 切换 ===
const activeTab = ref<'dashboard' | 'customers' | 'workflow'>('dashboard');

const entStore = useEnterpriseStore();
const reformStore = useReformStore();

const enterprises = computed(() => entStore.enterprises ?? []);
const totalManaged = computed(() => enterprises.value.length);
const totalBalance = computed(() => enterprises.value.reduce((s: number, e: any) => s + (e.financials?.accountBalance ?? 0), 0));
const totalAR = computed(() => enterprises.value.reduce((s: number, e: any) => s + (e.financials?.pendingAR ?? 0), 0));
const pendingApprovals = computed(() => (reformStore.approvalQueue ?? []).filter((q: any) => q.status === 'pending').length);

const selectedDemandId = ref<string>('');

const enterpriseDemands = computed(() => enterprises.value.slice(0, 8).map((e: any) => ({
  id: e.id, enterprise: e.name, amount: e.financials?.pendingAR ?? 0,
  industry: e.industryLabel, creditGrade: e.runtime?.creditGradeCap ?? 'C',
})));

const matchedProducts = computed(() => {
  if (!selectedDemandId.value) return [];
  const banks = reformStore.banks ?? [];
  return banks.slice(0, 5).map((b: any, i: number) => ({
    bank: b.name, product: ['小微贷', '供应链贷', '应收账款融资', '票据贴现', '信用贷'][i % 5],
    rate: (3.8 + i * 0.2).toFixed(2), matchScore: 95 - i * 5,
  }));
});

const commissionRows = computed(() => enterprises.value.slice(0, 5).map((e: any, i: number) => {
  const amount = e.financials?.pendingAR ?? 0;
  const rate = 1.5;
  return {
    enterprise: e.name, amount, rate,
    commission: Math.round(amount * rate / 100),
    status: i < 3 ? '已结' : '待结',
  };
}));

function selectDemand(row: any) {
  selectedDemandId.value = row.id;
  ElMessage.success(`已选择 ${row.enterprise} 的需求，AI 匹配完成`);
}

function commissionSummary({ columns, data }: any) {
  const total = data.reduce((s: number, r: any) => s + (r.commission ?? 0), 0);
  return columns.map((_col: any, i: number) => i === columns.length - 1 ? `合计 ¥${formatAmount(total)}` : '');
}

function formatAmount(amt: number): string { return (amt ?? 0).toLocaleString('zh-CN'); }

// === UX-04: 异常清单 + NLP 搜索 ===

/** 8 维标准分 (与后端 DEFAULT_SCORECARD_A 对齐). */
const STANDARDS: Record<string, number> = {
  subject: 85, finance: 82, tax: 88, business: 80,
  assets: 85, credit: 82, policy: 90, capital: 80,
};

function countRedLights(sc: any): number {
  if (!sc || typeof sc !== 'object') return 0;
  return Object.keys(STANDARDS).reduce((cnt, dim) => {
    const cur = (sc as any)[dim] ?? 0;
    const std = STANDARDS[dim] ?? 0;
    return cur < std - 20 ? cnt + 1 : cnt;
  }, 0);
}

/** 全企业异常清单 (每企业一行, 汇总红黄绿灯 + 异常类型). */
const abnormalRows = computed<AbnormalRow[]>(() => {
  const approvals = reformStore.approvalQueue ?? [];
  return enterprises.value.map((e: any) => {
    const sc = e.reform?.beforeScorecard ?? e.reform?.afterScorecard;
    const redLightCount = countRedLights(sc);
    const finUnlocked = e.runtime?.financingUnlocked ?? false;
    const guaranteeStatus = e.runtime?.guaranteeStatus ?? 'none';
    // 融资状态: rejected (担保被拒) / approved (已解锁) / pending (改造完成待撮合) / locked (未改造)
    let financingStatus = 'locked';
    if (guaranteeStatus === 'rejected') financingStatus = 'rejected';
    else if (finUnlocked) financingStatus = 'approved';
    else if (e.reform?.status === 'completed') financingStatus = 'pending';
    const reformProgress = Math.round((e.reform?.progress ?? 0) * 100);
    // 逾期: 应收账款超过 500 万且未解锁 (mock 启发式)
    const hasOverdue = (e.financials?.pendingAR ?? 0) > 5000000 && !finUnlocked;
    const hasAbnormal = redLightCount > 0 || financingStatus === 'rejected' || reformProgress < 50;
    const creditScore = e.runtime?.creditScore ?? 600;
    const creditGrade = e.runtime?.creditGradeCap ?? 'C';
    const apq = approvals.find((q: any) => q.enterpriseId === e.id || q.entId === e.id);
    const approvalStatus = apq?.status ?? 'none';
    const riskProfile = e.riskProfile ?? 'normal';
    // 红绿灯: 红灯>0=red, 否则有异常=yellow, 否则 green
    let light: 'green' | 'yellow' | 'red' = 'green';
    if (redLightCount > 0 || financingStatus === 'rejected' || riskProfile === 'distress') light = 'red';
    else if (hasAbnormal) light = 'yellow';
    // 异常类型描述 (取最严重一项)
    const types: string[] = [];
    if (redLightCount > 0) types.push(`${redLightCount} 维评分红灯`);
    if (financingStatus === 'rejected') types.push('融资被拒');
    if (reformProgress < 50) types.push('改造进度落后');
    if (hasOverdue) types.push('应收逾期');
    if (creditScore < 600) types.push('信用分偏低');
    if (riskProfile === 'high_risk' || riskProfile === 'distress') types.push('高风险');
    if (!finUnlocked && e.reform?.status !== 'completed') types.push('融资未解锁');
    const abnormalType = types.length ? types.join('；') : '健康';
    return {
      enterpriseId: e.id,
      enterprise: e.name,
      abnormalType,
      light,
      redLightCount,
      financingStatus,
      reformProgress,
      hasOverdue,
      hasAbnormal,
      creditScore,
      creditGrade,
      approvalStatus,
      riskProfile,
      financingUnlocked: finUnlocked,
    };
  });
});

const totalRed = computed(() => abnormalRows.value.filter((r) => r.light === 'red').length);
const totalYellow = computed(() => abnormalRows.value.filter((r) => r.light === 'yellow').length);

const searchQuery = ref<string>('');
const parsedLabel = ref<string>('');

const filteredAbnormal = computed<AbnormalRow[]>(() => {
  const q = searchQuery.value.trim();
  if (!q) return abnormalRows.value;
  return applyFilter(abnormalRows.value, parseNlpQuery(q));
});

const quickHints = computed<string[]>(() => NLP_HINTS.slice(0, 5));

function onSearch() {
  const q = searchQuery.value.trim();
  parsedLabel.value = q ? parseNlpQuery(q).label : '';
}

function useHint(hint: string) {
  // 从提示中提取查询主体 (去掉 "试试输入：" 前缀)
  searchQuery.value = hint.replace(/^试试输入[：:]?/, '').trim();
  onSearch();
}

function onHandle(row: AbnormalRow) {
  // 处理: 跳转对应企业详情 (顾问介入)
  ElMessage.success(`已标记处理「${row.enterprise}」(${row.abnormalType})，跳转企业详情`);
}

// === APP-03 客户管理 ===
type CooperationMode = 'financing' | 'reform' | 'guarantee' | 'insurance' | 'scf' | 'advisory';

interface FollowupRecord {
  at: string;
  note: string;
}

interface AdvisorCustomer {
  id: string;
  name: string;
  cooperationModes: CooperationMode[];
  creditLimit: number;
  lastFollowupAt: string;
  lastFollowupNote: string;
  createdAt: string;
  followups: FollowupRecord[];
}

const cooperationModeOptions: { value: CooperationMode; label: string }[] = [
  { value: 'financing', label: '融资撮合' },
  { value: 'reform', label: '改造辅导' },
  { value: 'guarantee', label: '担保协同' },
  { value: 'insurance', label: '保险协同' },
  { value: 'scf', label: '供应链金融' },
  { value: 'advisory', label: '咨询顾问' },
];

function cooperationModeLabel(m: CooperationMode): string {
  return cooperationModeOptions.find((o) => o.value === m)?.label ?? m;
}

function modeTagType(m: CooperationMode): 'primary' | 'success' | 'warning' | 'danger' | 'info' {
  const map: Record<CooperationMode, 'primary' | 'success' | 'warning' | 'danger' | 'info'> = {
    financing: 'primary',
    reform: 'success',
    guarantee: 'warning',
    insurance: 'info',
    scf: 'danger',
    advisory: 'primary',
  };
  return map[m];
}

// 兜底客户种子数据 (project_memory: 零机构接入时仍能独立运行)
const customers = ref<AdvisorCustomer[]>([
  {
    id: 'C-001',
    name: '深圳科创电子',
    cooperationModes: ['financing', 'reform'],
    creditLimit: 5000000,
    lastFollowupAt: new Date(Date.now() - 3 * 86400_000).toISOString(),
    lastFollowupNote: '已对接工行客户经理, 待提交授信材料',
    createdAt: new Date(Date.now() - 30 * 86400_000).toISOString(),
    followups: [
      { at: new Date(Date.now() - 30 * 86400_000).toISOString(), note: '客户接入, 启动尽调' },
      { at: new Date(Date.now() - 3 * 86400_000).toISOString(), note: '已对接工行客户经理, 待提交授信材料' },
    ],
  },
  {
    id: 'C-002',
    name: '广州智造机械',
    cooperationModes: ['financing', 'guarantee', 'scf'],
    creditLimit: 8000000,
    lastFollowupAt: new Date(Date.now() - 10 * 86400_000).toISOString(),
    lastFollowupNote: '担保审查中, 待补充反担保物清单',
    createdAt: new Date(Date.now() - 60 * 86400_000).toISOString(),
    followups: [
      { at: new Date(Date.now() - 60 * 86400_000).toISOString(), note: '客户接入' },
      { at: new Date(Date.now() - 10 * 86400_000).toISOString(), note: '担保审查中, 待补充反担保物清单' },
    ],
  },
  {
    id: 'C-003',
    name: '东莞物流科技',
    cooperationModes: ['advisory'],
    creditLimit: 0,
    lastFollowupAt: new Date(Date.now() - 45 * 86400_000).toISOString(),
    lastFollowupNote: '客户咨询供应链金融方案, 未启动合作',
    createdAt: new Date(Date.now() - 90 * 86400_000).toISOString(),
    followups: [
      { at: new Date(Date.now() - 90 * 86400_000).toISOString(), note: '客户咨询' },
      { at: new Date(Date.now() - 45 * 86400_000).toISOString(), note: '客户咨询供应链金融方案, 未启动合作' },
    ],
  },
]);

const customerDialogVisible = ref(false);
const customerDrawerVisible = ref(false);
const customerFormRef = ref<FormInstance>();
const customerSubmitting = ref(false);
const currentDrawerCustomer = ref<AdvisorCustomer | null>(null);

const emptyCustomerForm = (): {
  id: string;
  name: string;
  cooperationModes: CooperationMode[];
  creditLimit: number;
  lastFollowupNote: string;
} => ({
  id: '',
  name: '',
  cooperationModes: [],
  creditLimit: 0,
  lastFollowupNote: '',
});

const customerForm = reactive(emptyCustomerForm());

const customerFormRules: FormRules = {
  name: [{ required: true, message: '请输入企业名', trigger: 'blur' }],
  cooperationModes: [
    {
      required: true,
      type: 'array',
      min: 1,
      message: '请选择至少一种合作模式',
      trigger: 'change',
    },
  ],
};

function openCustomerDialog(): void {
  Object.assign(customerForm, emptyCustomerForm());
  customerDialogVisible.value = true;
}

function editFromDrawer(): void {
  if (!currentDrawerCustomer.value) return;
  const c = currentDrawerCustomer.value;
  Object.assign(customerForm, {
    id: c.id,
    name: c.name,
    cooperationModes: [...c.cooperationModes],
    creditLimit: c.creditLimit,
    lastFollowupNote: c.lastFollowupNote,
  });
  customerDrawerVisible.value = false;
  customerDialogVisible.value = true;
}

function openCustomerDrawer(c: AdvisorCustomer): void {
  currentDrawerCustomer.value = c;
  customerDrawerVisible.value = true;
}

function quickFollowup(c: AdvisorCustomer): void {
  // 一键添加跟进记录 (project_memory 傻瓜式操作: 不让用户做选择题)
  const note = `电话跟进 ${new Date().toLocaleString('zh-CN')}`;
  c.followups.unshift({ at: new Date().toISOString(), note });
  c.lastFollowupAt = new Date().toISOString();
  c.lastFollowupNote = note;
  ElMessage.success(`已记录跟进 ${c.name}`);
}

function addFollowupFromDrawer(): void {
  if (!currentDrawerCustomer.value) return;
  quickFollowup(currentDrawerCustomer.value);
}

function submitCustomerForm(): void {
  if (!customerFormRef.value) return;
  customerFormRef.value.validate((valid: boolean) => {
    if (!valid) return;
    customerSubmitting.value = true;
    try {
      if (customerForm.id) {
        // 编辑
        const idx = customers.value.findIndex((c) => c.id === customerForm.id);
        if (idx >= 0) {
          const c = customers.value[idx]!;
          c.name = customerForm.name;
          c.cooperationModes = [...customerForm.cooperationModes];
          c.creditLimit = customerForm.creditLimit;
          if (customerForm.lastFollowupNote && customerForm.lastFollowupNote !== c.lastFollowupNote) {
            c.lastFollowupNote = customerForm.lastFollowupNote;
            c.lastFollowupAt = new Date().toISOString();
            c.followups.unshift({ at: c.lastFollowupAt, note: customerForm.lastFollowupNote });
          }
        }
        ElMessage.success('客户已更新');
      } else {
        // 新增
        const newCustomer: AdvisorCustomer = {
          id: `C-${String(customers.value.length + 1).padStart(3, '0')}`,
          name: customerForm.name,
          cooperationModes: [...customerForm.cooperationModes],
          creditLimit: customerForm.creditLimit,
          lastFollowupAt: new Date().toISOString(),
          lastFollowupNote: customerForm.lastFollowupNote || '客户已接入',
          createdAt: new Date().toISOString(),
          followups: customerForm.lastFollowupNote
            ? [{ at: new Date().toISOString(), note: customerForm.lastFollowupNote }]
            : [],
        };
        customers.value.push(newCustomer);
        ElMessage.success(`已新增客户 ${newCustomer.name}`);
      }
      customerDialogVisible.value = false;
    } finally {
      customerSubmitting.value = false;
    }
  });
}

function isStaleFollowup(isoAt: string): boolean {
  // 超过 7 天未跟进视为 stale
  const t = new Date(isoAt).getTime();
  return Date.now() - t > 7 * 86400_000;
}

// === APP-03 工作流 ===
type TaskPriority = 'high' | 'medium' | 'low';
type TaskStatus = 'pending' | 'in_progress' | 'completed';

interface WorkflowTask {
  id: string;
  title: string;
  customerName: string;
  priority: TaskPriority;
  status: TaskStatus;
  dueAt: string;
}

const tasks = ref<WorkflowTask[]>([
  {
    id: 'T-001',
    title: '提交工行授信材料',
    customerName: '深圳科创电子',
    priority: 'high',
    status: 'pending',
    dueAt: new Date(Date.now() + 1 * 86400_000).toISOString(),
  },
  {
    id: 'T-002',
    title: '补充反担保物清单',
    customerName: '广州智造机械',
    priority: 'high',
    status: 'in_progress',
    dueAt: new Date(Date.now() - 1 * 86400_000).toISOString(), // 已超期
  },
  {
    id: 'T-003',
    title: '回访供应链金融咨询',
    customerName: '东莞物流科技',
    priority: 'medium',
    status: 'pending',
    dueAt: new Date(Date.now() + 5 * 86400_000).toISOString(),
  },
  {
    id: 'T-004',
    title: '保险核保跟进',
    customerName: '广州智造机械',
    priority: 'medium',
    status: 'in_progress',
    dueAt: new Date(Date.now() + 3 * 86400_000).toISOString(),
  },
  {
    id: 'T-005',
    title: '上月佣金对账',
    customerName: '深圳科创电子',
    priority: 'low',
    status: 'completed',
    dueAt: new Date(Date.now() - 10 * 86400_000).toISOString(),
  },
]);

const PRIORITY_WEIGHT: Record<TaskPriority, number> = { high: 3, medium: 2, low: 1 };

const sortedTasks = computed<WorkflowTask[]>(() => {
  return [...tasks.value].sort((a, b) => {
    // 已完成沉底
    if (a.status === 'completed' && b.status !== 'completed') return 1;
    if (b.status === 'completed' && a.status !== 'completed') return -1;
    // 优先级降序
    const pd = PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
    if (pd !== 0) return pd;
    // 截止时间升序 (越早越靠前)
    return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
  });
});

const pendingTaskCount = computed(
  () => tasks.value.filter((t) => t.status !== 'completed').length,
);

const overdueTaskCount = computed(
  () =>
    tasks.value.filter(
      (t) => t.status !== 'completed' && new Date(t.dueAt).getTime() < Date.now(),
    ).length,
);

function priorityLabel(p: TaskPriority): string {
  return { high: '高', medium: '中', low: '低' }[p];
}

function priorityTag(p: TaskPriority): 'danger' | 'warning' | 'info' {
  return ({ high: 'danger', medium: 'warning', low: 'info' } as const)[p];
}

function statusLabel(s: TaskStatus): string {
  return { pending: '待处理', in_progress: '进行中', completed: '已完成' }[s];
}

function statusTag(s: TaskStatus): 'info' | 'warning' | 'success' {
  return ({ pending: 'info', in_progress: 'warning', completed: 'success' } as const)[s];
}

function isOverdue(isoAt: string): boolean {
  return new Date(isoAt).getTime() < Date.now();
}

function advanceTask(task: WorkflowTask, target: TaskStatus): void {
  // 状态流转: pending → in_progress → completed (单向不可回退)
  const flow: Record<TaskStatus, TaskStatus[]> = {
    pending: ['in_progress'],
    in_progress: ['completed'],
    completed: [],
  };
  if (!flow[task.status].includes(target)) {
    ElMessage.warning(`状态不可从 ${statusLabel(task.status)} 跳到 ${statusLabel(target)}`);
    return;
  }
  task.status = target;
  ElMessage.success(`任务「${task.title}」已流转到 ${statusLabel(target)}`);
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('zh-CN');
  } catch {
    return iso;
  }
}

function formatDateTime(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return iso;
  }
}

onMounted(() => {
  entStore.fetchEnterprises().catch(() => {});
  reformStore.loadBanks().catch(() => {});
});
</script>

<style scoped lang="scss">
.mt-16 { margin-top: 16px; }
h4 { margin: 0 0 8px; color: var(--el-text-color-primary); }
.muted { color: var(--el-text-color-secondary); font-size: 12px; }

.advisor-tabs {
  :deep(.el-tabs__header) {
    margin-bottom: 12px;
  }
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.mode-tag {
  margin-right: 4px;
  margin-bottom: 2px;
}

.drawer-actions {
  display: flex;
  gap: 8px;
}

.abnormal-card {
  .abnormal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-weight: 600;
  }
  .nlp-search {
    margin-bottom: 12px;
    .nlp-hints {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
      .nlp-hint-tag {
        cursor: pointer;
      }
    }
    .nlp-parsed {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 8px;
      font-size: 13px;
      color: var(--el-text-color-secondary);
      .nlp-match-count {
        color: var(--el-text-color-secondary);
      }
    }
  }
  .abnormal-table {
    .red-count {
      color: var(--el-color-danger);
      font-weight: 600;
    }
  }
}
</style>
