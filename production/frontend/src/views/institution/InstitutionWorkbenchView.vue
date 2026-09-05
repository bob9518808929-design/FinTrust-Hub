<!--
  InstitutionWorkbenchView.vue — Tab5 担保与保险协作台
  职责: 担保(申请受理/保前审查/反担保) + 保险(投保/核保/保单/理赔)
  对齐: simulation/js/view-institution.js + project_memory 硬约束(pending状态可交互/担保保险申请反馈/阻塞模态窗)
-->
<template>
  <div class="institution-workbench">
    <el-alert
      title="Tab5 担保与保险协作台"
      type="info"
      :closable="false"
      show-icon
      description="担保公司视角处理担保申请/保前审查/反担保；保险公司视角处理投保/核保/保单/理赔。担保生效：银行竞标利率额外 -0.5%、额度 +10%、信用分 +15；保险生效：利率额外 -0.3%、信用分 +10、B 级可升至 A 级。"
    />

    <el-row :gutter="16" class="mt-16">
      <el-col :span="12">
        <el-card shadow="never">
          <template #header>
            <div class="card-header">
              <span>担保公司 — {{ guarantor?.name ?? '—' }}</span>
              <el-tag :type="statusTag(guaranteeStatus)">{{ statusLabel(guaranteeStatus) }}</el-tag>
            </div>
          </template>
          <el-descriptions :column="1" size="small" border>
            <el-descriptions-item label="担保模式">{{ guaranteeMode }}</el-descriptions-item>
            <el-descriptions-item label="担保额度">¥{{ formatAmount(guarantorAmount) }}</el-descriptions-item>
            <el-descriptions-item label="担保费率">{{ guarantorRate }}%</el-descriptions-item>
            <el-descriptions-item label="反担保物">{{ counterGuarantee }}</el-descriptions-item>
          </el-descriptions>
          <div class="actions mt-12">
            <el-button
              v-if="guaranteeStatus === 'none'"
              type="primary"
              :disabled="!currentEnterpriseId"
              @click="applyGuarantee"
            >申请担保</el-button>
            <el-button
              v-else-if="guaranteeStatus === 'pending'"
              type="warning"
              @click="preTrialGuarantee"
            >保前审查</el-button>
            <el-button v-if="guaranteeStatus === 'active'" type="danger" @click="triggerCompensation">触发代偿</el-button>
          </div>
        </el-card>
      </el-col>

      <el-col :span="12">
        <el-card shadow="never">
          <template #header>
            <div class="card-header">
              <span>保险公司 — {{ insurer?.name ?? '—' }}</span>
              <el-tag :type="statusTag(insuranceStatus)">{{ statusLabel(insuranceStatus) }}</el-tag>
            </div>
          </template>
          <el-descriptions :column="1" size="small" border>
            <el-descriptions-item label="险种">{{ insuranceType }}</el-descriptions-item>
            <el-descriptions-item label="保额">¥{{ formatAmount(insuranceAmount) }}</el-descriptions-item>
            <el-descriptions-item label="保费">¥{{ formatAmount(insurancePremium) }}</el-descriptions-item>
            <el-descriptions-item label="免赔额">¥{{ formatAmount(insuranceDeductible) }}</el-descriptions-item>
          </el-descriptions>
          <div class="actions mt-12">
            <el-button
              v-if="insuranceStatus === 'none'"
              type="primary"
              :disabled="!currentEnterpriseId"
              @click="applyInsurance"
            >投保</el-button>
            <el-button
              v-else-if="insuranceStatus === 'pending'"
              type="warning"
              @click="underwrite"
            >核保</el-button>
            <el-button v-if="insuranceStatus === 'active'" type="danger" @click="triggerClaim">理赔</el-button>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never" class="mt-16">
      <template #header><span>利率优惠联动</span></template>
      <el-table :data="benefitRows" size="small" stripe>
        <el-table-column prop="item" label="优惠项" />
        <el-table-column prop="before" label="生效前" />
        <el-table-column prop="after" label="生效后" />
        <el-table-column prop="delta" label="变化" />
      </el-table>
    </el-card>

    <!-- ========== APP-07 任务看板 (Kanban 板) + 任务分配 + SLA 倒计时 ========== -->
    <el-card shadow="never" class="mt-16 kanban-card">
      <template #header>
        <div class="card-header">
          <span>📋 任务看板 (机构协作)</span>
          <div class="kanban-actions">
            <el-tag v-if="overdueKanbanCount > 0" type="danger" effect="dark" size="small">
              超期 {{ overdueKanbanCount }}
            </el-tag>
            <el-button type="primary" :icon="Plus" size="small" @click="openAssignDialog">
              分配任务
            </el-button>
          </div>
        </div>
      </template>

      <el-row :gutter="12" class="kanban-row">
        <!-- 待分配列 -->
        <el-col :span="6">
          <div class="kanban-col">
            <div class="kanban-col-head todo">
              <span>📌 待分配</span>
              <el-tag size="small" type="info">{{ todoTasks.length }}</el-tag>
            </div>
            <div class="kanban-col-body">
              <div
                v-for="t in todoTasks"
                :key="t.id"
                class="kanban-item"
                :class="{ 'is-overdue': isOverdueKanban(t) }"
                @click="openTaskDetail(t)"
              >
                <div class="item-head">
                  <span class="item-title">{{ t.title }}</span>
                  <el-tag size="small" :type="priorityTagType(t.priority)" effect="dark">
                    {{ priorityLabel(t.priority) }}
                  </el-tag>
                </div>
                <div class="item-row">
                  <span class="item-label">客户:</span>
                  <span class="item-value">{{ t.customerName }}</span>
                </div>
                <div v-if="t.assigneeName" class="item-row">
                  <span class="item-label">负责人:</span>
                  <span class="item-value">{{ t.assigneeName }}</span>
                </div>
                <div v-else class="item-row">
                  <span class="item-label warning">未分配</span>
                </div>
                <div v-if="t.dueAt" class="item-row">
                  <span class="item-label">SLA:</span>
                  <sla-countdown :due-at="t.dueAt" :status="t.status" />
                </div>
                <div class="item-actions">
                  <el-button size="small" type="primary" plain @click.stop="quickAssign(t)">
                    分配
                  </el-button>
                </div>
              </div>
              <el-empty v-if="todoTasks.length === 0" description="无待分配任务" :image-size="40" />
            </div>
          </div>
        </el-col>

        <!-- 进行中列 -->
        <el-col :span="6">
          <div class="kanban-col">
            <div class="kanban-col-head progress">
              <span>⚡ 进行中</span>
              <el-tag size="small" type="warning">{{ inProgressTasks.length }}</el-tag>
            </div>
            <div class="kanban-col-body">
              <div
                v-for="t in inProgressTasks"
                :key="t.id"
                class="kanban-item"
                :class="{ 'is-overdue': isOverdueKanban(t) }"
                @click="openTaskDetail(t)"
              >
                <div class="item-head">
                  <span class="item-title">{{ t.title }}</span>
                  <el-tag size="small" :type="priorityTagType(t.priority)" effect="dark">
                    {{ priorityLabel(t.priority) }}
                  </el-tag>
                </div>
                <div class="item-row">
                  <span class="item-label">客户:</span>
                  <span class="item-value">{{ t.customerName }}</span>
                </div>
                <div class="item-row">
                  <span class="item-label">负责人:</span>
                  <span class="item-value">{{ t.assigneeName || '—' }}</span>
                </div>
                <div v-if="t.dueAt" class="item-row">
                  <span class="item-label">SLA:</span>
                  <sla-countdown :due-at="t.dueAt" :status="t.status" />
                </div>
                <div class="item-actions">
                  <el-button size="small" type="success" @click.stop="advanceKanbanTask(t, 'review')">
                    提交审核
                  </el-button>
                </div>
              </div>
              <el-empty v-if="inProgressTasks.length === 0" description="无进行中任务" :image-size="40" />
            </div>
          </div>
        </el-col>

        <!-- 待审核列 -->
        <el-col :span="6">
          <div class="kanban-col">
            <div class="kanban-col-head review">
              <span>🔍 待审核</span>
              <el-tag size="small" type="primary">{{ reviewTasks.length }}</el-tag>
            </div>
            <div class="kanban-col-body">
              <div
                v-for="t in reviewTasks"
                :key="t.id"
                class="kanban-item"
                :class="{ 'is-overdue': isOverdueKanban(t) }"
                @click="openTaskDetail(t)"
              >
                <div class="item-head">
                  <span class="item-title">{{ t.title }}</span>
                  <el-tag size="small" :type="priorityTagType(t.priority)" effect="dark">
                    {{ priorityLabel(t.priority) }}
                  </el-tag>
                </div>
                <div class="item-row">
                  <span class="item-label">客户:</span>
                  <span class="item-value">{{ t.customerName }}</span>
                </div>
                <div class="item-row">
                  <span class="item-label">负责人:</span>
                  <span class="item-value">{{ t.assigneeName || '—' }}</span>
                </div>
                <div v-if="t.dueAt" class="item-row">
                  <span class="item-label">SLA:</span>
                  <sla-countdown :due-at="t.dueAt" :status="t.status" />
                </div>
                <div class="item-actions">
                  <el-button size="small" type="warning" @click.stop="advanceKanbanTask(t, 'done')">
                    审核通过
                  </el-button>
                </div>
              </div>
              <el-empty v-if="reviewTasks.length === 0" description="无待审核任务" :image-size="40" />
            </div>
          </div>
        </el-col>

        <!-- 已完成列 -->
        <el-col :span="6">
          <div class="kanban-col">
            <div class="kanban-col-head done">
              <span>✅ 已完成</span>
              <el-tag size="small" type="success">{{ doneTasks.length }}</el-tag>
            </div>
            <div class="kanban-col-body">
              <div
                v-for="t in doneTasks"
                :key="t.id"
                class="kanban-item done"
                @click="openTaskDetail(t)"
              >
                <div class="item-head">
                  <span class="item-title">{{ t.title }}</span>
                  <el-icon class="done-icon"><CircleCheckFilled /></el-icon>
                </div>
                <div class="item-row">
                  <span class="item-label">完成时间:</span>
                  <span class="item-value">{{ t.completedAt ? formatDateTime(t.completedAt) : '—' }}</span>
                </div>
              </div>
              <el-empty v-if="doneTasks.length === 0" description="无已完成任务" :image-size="40" />
            </div>
          </div>
        </el-col>
      </el-row>
    </el-card>

    <!-- === APP-07 任务分配模态窗 === -->
    <el-dialog
      v-model="assignDialogVisible"
      :title="assignDialogTitle"
      width="560px"
      :close-on-click-modal="false"
    >
      <el-form :model="assignForm" label-width="100px">
        <el-form-item label="任务标题" required>
          <el-input v-model="assignForm.title" placeholder="例如: 资金流水核查" />
        </el-form-item>
        <el-form-item label="关联客户" required>
          <el-input v-model="assignForm.customerName" placeholder="例如: 深圳科创电子" />
        </el-form-item>
        <el-form-item label="优先级" required>
          <el-radio-group v-model="assignForm.priority">
            <el-radio-button value="high">高</el-radio-button>
            <el-radio-button value="medium">中</el-radio-button>
            <el-radio-button value="low">低</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="分配给" required>
          <el-select
            v-model="assignForm.assigneeId"
            placeholder="选择机构成员"
            style="width: 100%"
          >
            <el-option
              v-for="m in institutionMembers"
              :key="m.id"
              :label="`${m.name} (${m.role})`"
              :value="m.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="截止时间" required>
          <el-date-picker
            v-model="assignForm.dueAt"
            type="datetime"
            placeholder="选择截止时间"
            format="YYYY-MM-DD HH:mm"
            value-format="YYYY-MM-DDTHH:mm:ss"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="任务说明">
          <el-input
            v-model="assignForm.note"
            type="textarea"
            :rows="2"
            placeholder="任务详情, 例如: 核查近 30 天资金流水, 关注关联方转移"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="assignDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="assignSubmitting" @click="submitAssign">
          确认分配
        </el-button>
      </template>
    </el-dialog>

    <!-- === APP-07 任务详情抽屉 === -->
    <el-drawer
      v-model="taskDetailVisible"
      :title="`任务详情 — ${currentTaskDetail?.title ?? ''}`"
      direction="rtl"
      size="440px"
    >
      <template v-if="currentTaskDetail">
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="任务ID">{{ currentTaskDetail.id }}</el-descriptions-item>
          <el-descriptions-item label="标题">{{ currentTaskDetail.title }}</el-descriptions-item>
          <el-descriptions-item label="客户">{{ currentTaskDetail.customerName }}</el-descriptions-item>
          <el-descriptions-item label="负责人">
            {{ currentTaskDetail.assigneeName || '未分配' }}
          </el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag size="small" :type="kanbanStatusTag(currentTaskDetail.status)">
              {{ kanbanStatusLabel(currentTaskDetail.status) }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="优先级">
            <el-tag size="small" :type="priorityTagType(currentTaskDetail.priority)" effect="dark">
              {{ priorityLabel(currentTaskDetail.priority) }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="截止时间">
            {{ formatDateTime(currentTaskDetail.dueAt) }}
          </el-descriptions-item>
          <el-descriptions-item v-if="currentTaskDetail.note" label="任务说明">
            {{ currentTaskDetail.note }}
          </el-descriptions-item>
        </el-descriptions>

        <el-divider content-position="left">SLA 状态</el-divider>
        <div class="sla-status-block">
          <sla-countdown
            v-if="currentTaskDetail.dueAt"
            :due-at="currentTaskDetail.dueAt"
            :status="currentTaskDetail.status"
            :show-detail="true"
          />
          <span v-else class="muted">无截止时间</span>
        </div>

        <el-divider content-position="left">流转操作</el-divider>
        <div class="detail-actions">
          <el-button
            v-if="currentTaskDetail.status === 'todo'"
            type="primary"
            @click="advanceKanbanTask(currentTaskDetail, 'progress')"
          >
            启动 (转入进行中)
          </el-button>
          <el-button
            v-if="currentTaskDetail.status === 'progress'"
            type="success"
            @click="advanceKanbanTask(currentTaskDetail, 'review')"
          >
            提交审核
          </el-button>
          <el-button
            v-if="currentTaskDetail.status === 'review'"
            type="warning"
            @click="advanceKanbanTask(currentTaskDetail, 'done')"
          >
            审核通过
          </el-button>
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, CircleCheckFilled } from '@element-plus/icons-vue';
import { useEnterpriseStore } from '@/stores/enterprise';
import { useReformStore } from '@/stores/reform';
import SlaCountdown from '@/components/common/SlaCountdown.vue';

const entStore = useEnterpriseStore();
const reformStore = useReformStore();

const currentEnterpriseId = computed(() => entStore.currentEnterpriseId);
const currentEnterprise = computed(() => entStore.currentEnterprise);
const guarantor = computed(() => reformStore.guarantors[0] ?? null);
const insurer = computed(() => reformStore.insurers[0] ?? null);

const guaranteeStatus = computed(() => currentEnterprise.value?.runtime?.guaranteeStatus ?? 'none');
const insuranceStatus = computed(() => currentEnterprise.value?.runtime?.insuranceStatus ?? 'none');
const guaranteeMode = computed(() => '推荐+协同');
const guarantorAmount = computed(() => currentEnterprise.value?.financials?.pendingAR ?? 0);
const guarantorRate = ref(1.5);
const counterGuarantee = ref('存货质押 + 实控人连带责任保证');
const insuranceType = ref('应收账款违约险');
const insuranceAmount = computed(() => currentEnterprise.value?.financials?.pendingAR ?? 0);
const insurancePremium = computed(() => Math.round((insuranceAmount.value * 0.6) / 100));
const insuranceDeductible = ref(50000);

const benefitRows = computed(() => [
  { item: '银行竞标利率', before: '基准', after: '-0.8%', delta: '担保 -0.5% + 保险 -0.3%' },
  { item: '授信额度', before: '基准', after: '+10%', delta: '担保生效' },
  { item: '信用分', before: String(currentEnterprise.value?.runtime?.creditScore ?? 0), after: '+25', delta: '担保 +15 + 保险 +10' },
]);

function formatAmount(amt: number): string { return (amt ?? 0).toLocaleString('zh-CN'); }
function statusTag(s: string) {
  if (s === 'active') return 'success';
  if (s === 'pending') return 'warning';
  if (s === 'claimed') return 'danger';
  return 'info';
}
function statusLabel(s: string) {
  return ({ none: '未申请', pending: '审查中', active: '已生效', claimed: '已代偿' } as Record<string, string>)[s] ?? s;
}

async function applyGuarantee() {
  if (!currentEnterpriseId.value) { ElMessage.warning('请先选择企业'); return; }
  try {
    await ElMessageBox.confirm('确认提交担保申请？', '担保申请', { type: 'warning' });
    await reformStore.applyGuarantee(currentEnterpriseId.value);
    ElMessage.success('担保申请已提交，等待保前审查');
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error(e.message ?? '申请失败');
  }
}
async function preTrialGuarantee() {
  try { await reformStore.preTrialGuarantee(currentEnterpriseId.value!); ElMessage.success('保前审查通过，担保已生效'); }
  catch (e: any) { ElMessage.error(e.message ?? '审查失败'); }
}
async function triggerCompensation() {
  try {
    await ElMessageBox.confirm('触发代偿将进入追偿流程，确认？', '代偿', { type: 'error', confirmButtonText: '确认代偿' });
    await reformStore.triggerCompensation(currentEnterpriseId.value!);
    ElMessage.success('代偿已触发，进入追偿流程');
  } catch (e: any) { if (e !== 'cancel') ElMessage.error(e.message ?? '代偿失败'); }
}
async function applyInsurance() {
  if (!currentEnterpriseId.value) { ElMessage.warning('请先选择企业'); return; }
  try {
    await ElMessageBox.confirm(`保费 ¥${formatAmount(insurancePremium.value)}，确认投保？`, '投保', { type: 'warning' });
    await reformStore.applyInsurance(currentEnterpriseId.value);
    ElMessage.success('投保已受理，等待核保');
  } catch (e: any) { if (e !== 'cancel') ElMessage.error(e.message ?? '投保失败'); }
}
async function underwrite() {
  try { await reformStore.underwrite(currentEnterpriseId.value!); ElMessage.success('核保通过，保单已生效'); }
  catch (e: any) { ElMessage.error(e.message ?? '核保失败'); }
}
async function triggerClaim() {
  try {
    await ElMessageBox.confirm('触发理赔将启动勘察定损，确认？', '理赔', { type: 'error', confirmButtonText: '确认理赔' });
    await reformStore.triggerClaim(currentEnterpriseId.value!);
    ElMessage.success('理赔已启动');
  } catch (e: any) { if (e !== 'cancel') ElMessage.error(e.message ?? '理赔失败'); }
}

// === APP-07 任务看板 (Kanban 板) ===
type KanbanStatus = 'todo' | 'progress' | 'review' | 'done';
type KanbanPriority = 'high' | 'medium' | 'low';

interface KanbanTask {
  id: string;
  title: string;
  customerName: string;
  assigneeId?: string;
  assigneeName?: string;
  priority: KanbanPriority;
  status: KanbanStatus;
  dueAt?: string;
  completedAt?: string;
  note?: string;
}

interface InstitutionMember {
  id: string;
  name: string;
  role: string;
}

// 机构成员种子 (project_memory: 零机构接入时仍能独立运行)
const institutionMembers = ref<InstitutionMember[]>([
  { id: 'M-001', name: '张三', role: '保前审查员' },
  { id: 'M-002', name: '李四', role: '核保员' },
  { id: 'M-003', name: '王五', role: '理赔专员' },
  { id: 'M-004', name: '赵六', role: '风控经理' },
]);

// Kanban 种子任务
const kanbanTasks = ref<KanbanTask[]>([
  {
    id: 'K-001',
    title: '深圳科创电子资金流水核查',
    customerName: '深圳科创电子',
    assigneeId: 'M-001',
    assigneeName: '张三',
    priority: 'high',
    status: 'progress',
    dueAt: new Date(Date.now() + 2 * 86400_000).toISOString(),
    note: '核查近 30 天资金流水, 关注关联方转移',
  },
  {
    id: 'K-002',
    title: '广州智造机械担保材料审查',
    customerName: '广州智造机械',
    assigneeId: 'M-002',
    assigneeName: '李四',
    priority: 'high',
    status: 'review',
    dueAt: new Date(Date.now() - 1 * 86400_000).toISOString(), // 已超期
    note: '反担保物清单 + 实控人连带责任保证',
  },
  {
    id: 'K-003',
    title: '东莞物流科技保单核保',
    customerName: '东莞物流科技',
    priority: 'medium',
    status: 'todo',
    dueAt: new Date(Date.now() + 5 * 86400_000).toISOString(),
  },
  {
    id: 'K-004',
    title: '深圳科创电子保单生效确认',
    customerName: '深圳科创电子',
    assigneeId: 'M-003',
    assigneeName: '王五',
    priority: 'medium',
    status: 'progress',
    dueAt: new Date(Date.now() + 3 * 86400_000).toISOString(),
  },
  {
    id: 'K-005',
    title: '上月佣金对账',
    customerName: '深圳科创电子',
    assigneeId: 'M-004',
    assigneeName: '赵六',
    priority: 'low',
    status: 'done',
    completedAt: new Date(Date.now() - 5 * 86400_000).toISOString(),
  },
]);

// SLA 倒计时刷新句柄 (SlaCountdown 内部自管理计时器, 这里仅作状态派生)

const todoTasks = computed(() => kanbanTasks.value.filter((t) => t.status === 'todo'));
const inProgressTasks = computed(() => kanbanTasks.value.filter((t) => t.status === 'progress'));
const reviewTasks = computed(() => kanbanTasks.value.filter((t) => t.status === 'review'));
const doneTasks = computed(() => kanbanTasks.value.filter((t) => t.status === 'done'));

const overdueKanbanCount = computed(
  () =>
    kanbanTasks.value.filter(
      (t) => t.status !== 'done' && t.dueAt && new Date(t.dueAt).getTime() < Date.now(),
    ).length,
);

function priorityLabel(p: KanbanPriority): string {
  return { high: '高', medium: '中', low: '低' }[p];
}

function priorityTagType(p: KanbanPriority): 'danger' | 'warning' | 'info' {
  return ({ high: 'danger', medium: 'warning', low: 'info' } as const)[p];
}

function kanbanStatusLabel(s: KanbanStatus): string {
  return ({ todo: '待分配', progress: '进行中', review: '待审核', done: '已完成' } as const)[s];
}

function kanbanStatusTag(s: KanbanStatus): 'info' | 'warning' | 'primary' | 'success' {
  return ({ todo: 'info', progress: 'warning', review: 'primary', done: 'success' } as const)[s];
}

function isOverdueKanban(t: KanbanTask): boolean {
  if (!t.dueAt || t.status === 'done') return false;
  return new Date(t.dueAt).getTime() < Date.now();
}

function formatDateTime(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return iso;
  }
}

// === 任务分配模态窗 ===
const assignDialogVisible = ref(false);
const assignSubmitting = ref(false);
const currentTaskDetail = ref<KanbanTask | null>(null);
const taskDetailVisible = ref(false);

interface AssignForm {
  title: string;
  customerName: string;
  priority: KanbanPriority;
  assigneeId: string;
  dueAt: string;
  note: string;
  // 编辑时记录的 id
  id?: string;
}

const assignForm = reactive<AssignForm>({
  title: '',
  customerName: '',
  priority: 'medium',
  assigneeId: '',
  dueAt: '',
  note: '',
});

const assignDialogTitle = computed(() =>
  assignForm.id ? '编辑任务分配' : '新增任务分配',
);

function openAssignDialog(): void {
  Object.assign(assignForm, {
    title: '',
    customerName: '',
    priority: 'medium',
    assigneeId: '',
    dueAt: '',
    note: '',
    id: undefined,
  });
  assignDialogVisible.value = true;
}

function quickAssign(t: KanbanTask): void {
  // 快速分配: 已有任务但未分配时, 直接打开分配窗
  Object.assign(assignForm, {
    title: t.title,
    customerName: t.customerName,
    priority: t.priority,
    assigneeId: t.assigneeId || '',
    dueAt: t.dueAt ? t.dueAt.slice(0, 19) : '',
    note: t.note || '',
    id: t.id,
  });
  assignDialogVisible.value = true;
}

async function submitAssign(): Promise<void> {
  if (!assignForm.title.trim()) {
    ElMessage.warning('请填写任务标题');
    return;
  }
  if (!assignForm.customerName.trim()) {
    ElMessage.warning('请填写关联客户');
    return;
  }
  if (!assignForm.assigneeId) {
    ElMessage.warning('请选择机构成员');
    return;
  }
  if (!assignForm.dueAt) {
    ElMessage.warning('请选择截止时间');
    return;
  }
  assignSubmitting.value = true;
  try {
    const member = institutionMembers.value.find((m) => m.id === assignForm.assigneeId);
    const dueAtIso = new Date(assignForm.dueAt).toISOString();
    if (assignForm.id) {
      // 编辑已有任务
      const idx = kanbanTasks.value.findIndex((t) => t.id === assignForm.id);
      if (idx >= 0) {
        const t = kanbanTasks.value[idx]!;
        t.title = assignForm.title;
        t.customerName = assignForm.customerName;
        t.priority = assignForm.priority;
        t.assigneeId = assignForm.assigneeId;
        t.assigneeName = member?.name || '';
        t.dueAt = dueAtIso;
        t.note = assignForm.note;
        // 若原来是 todo, 分配后转为 progress
        if (t.status === 'todo') {
          t.status = 'progress';
        }
      }
      ElMessage.success('任务已更新');
    } else {
      // 新增任务 (默认进入 todo 列)
      const newTask: KanbanTask = {
        id: `K-${String(kanbanTasks.value.length + 1).padStart(3, '0')}`,
        title: assignForm.title,
        customerName: assignForm.customerName,
        assigneeId: assignForm.assigneeId,
        assigneeName: member?.name || '',
        priority: assignForm.priority,
        status: 'progress', // 分配后即进入进行中
        dueAt: dueAtIso,
        note: assignForm.note,
      };
      kanbanTasks.value.push(newTask);
      ElMessage.success(`任务已分配给 ${member?.name || '负责人'}`);
    }
    assignDialogVisible.value = false;
  } finally {
    assignSubmitting.value = false;
  }
}

function openTaskDetail(t: KanbanTask): void {
  currentTaskDetail.value = t;
  taskDetailVisible.value = true;
}

function advanceKanbanTask(task: KanbanTask, target: KanbanStatus): void {
  // 状态流转: todo → progress → review → done (单向不可回退)
  const flow: Record<KanbanStatus, KanbanStatus[]> = {
    todo: ['progress'],
    progress: ['review'],
    review: ['done'],
    done: [],
  };
  if (!flow[task.status].includes(target)) {
    ElMessage.warning(`状态不可从 ${kanbanStatusLabel(task.status)} 跳到 ${kanbanStatusLabel(target)}`);
    return;
  }
  task.status = target;
  if (target === 'done') {
    task.completedAt = new Date().toISOString();
  }
  ElMessage.success(`任务「${task.title}」已流转到 ${kanbanStatusLabel(target)}`);
}

onMounted(() => {
  reformStore.loadInstitutions().catch(() => {});
});
</script>

<style scoped lang="scss">
// InstitutionWorkbenchView · Deepspace AI 深色版
// Experience 366208 教训: 所有"小块背景"必须显式语义化深色, 禁止写死 #fff / #e5e7eb / 依赖未声明的 --el-fill-color-dark 回退
@use '@/styles/variables.scss' as *;

.mt-16 { margin-top: 16px; }
.mt-12 { margin-top: 12px; }
.muted { color: $text-secondary; font-size: 12px; }

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 700;
  font-size: 15px;
  .el-tag { margin-left: 8px; }
}
.actions { display: flex; gap: 8px; }

.institution-workbench {
  // 页面容器: 透明 → 透出 body::before 深空霓虹光晕
  background: transparent;
  isolation: isolate;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  color: $text-primary;

  // 顶部 info 提示条: 玻璃 + 渐变边
  :deep(.el-alert) {
    background: linear-gradient(135deg, rgba(34,211,238,0.10), rgba(129,140,248,0.14)) !important;
    border: 1px solid rgba(34,211,238,0.30) !important;
    color: $text-primary !important;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border-radius: 12px !important;
    :deep(.el-alert__title) { color: $text-primary; font-weight: 700; letter-spacing: 0.01em; }
    :deep(.el-alert__description) { color: $text-regular; line-height: 1.7; }
    :deep(.el-alert__icon) { color: $color-primary; filter: drop-shadow(0 0 6px rgba(56,189,248,0.45)); }
  }

  // 卡片 (担保/保险/利率联动/看板): 玻璃一致
  :deep(.el-card) {
    background: linear-gradient(180deg, rgba(15,23,42,0.70), rgba(3,7,18,0.82)) !important;
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

      // 卡头标题: AI 霓虹渐变字 (担保公司/保险公司/任务看板/利率优惠联动...)
      .card-header {
        > span:first-child,
        > .el-tag + span,
        > :first-child:not(.kanban-actions) {
          background: $ai-gradient;
          -webkit-background-clip: text;
                  background-clip: text;
          color: transparent;
          font-weight: 800;
          letter-spacing: 0.01em;
        }
      }
    }
    :deep(.el-card__body) {
      color: $text-primary;
    }
  }

  // Descriptions 描述表 (担保公司/保险公司 4 行/抽屉详情): 玻璃格子, 不出现浅白格
  :deep(.el-descriptions) {
    :deep(.el-descriptions__table) {
      border-color: $border-color !important;
    }
    :deep(.el-descriptions__label) {
      background: rgba(15,23,42,0.60) !important;
      border-color: $border-color !important;
      color: $text-secondary !important;
      font-weight: 600;
    }
    :deep(.el-descriptions__content) {
      background: rgba(30,41,59,0.40) !important;
      border-color: $border-color !important;
      color: $text-primary !important;
    }
  }

  // el-table stripe (利率优惠联动): 条纹改成深色交替, 原来 #fafafa / light 条纹是最大的浅块来源
  :deep(.el-table) {
    --el-table-bg-color: transparent;
    --el-table-tr-bg-color: transparent;
    --el-table-header-bg-color: rgba(15,23,42,0.65);
    --el-table-row-hover-bg-color: rgba(34,211,238,0.08);
    --el-table-border-color: #{$border-color};
    --el-table-text-color: #{$text-primary};
    --el-table-header-text-color: #{$text-primary};

    th.el-table__cell {
      font-weight: 800 !important;
      letter-spacing: 0.02em;
      background: rgba(15,23,42,0.75) !important;
      color: $text-primary !important;
    }
    // 偶数行: 深蓝玻璃条; 奇数行: 更浅的玻璃条; 消除 stripe 默认 #f8fafc 浅白块
    :deep(.el-table__row) {
      &:nth-child(2n) {
        background: rgba(30,41,59,0.35) !important;
      }
      &:nth-child(2n+1) {
        background: rgba(15,23,42,0.25) !important;
      }
      &:hover {
        background: rgba(129,140,248,0.18) !important;
      }
      td.el-table__cell {
        color: $text-primary !important;
        border-color: $border-color !important;
      }
    }
  }
}

// ================ APP-07 Kanban 板 · Deepspace 版 ================
.kanban-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.kanban-card {
  :deep(.el-card__body) {
    padding: 12px;
  }
}

.kanban-row {
  margin-top: 0;
}

.kanban-col {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 280px;
  // 修: 原 --el-fill-color-darker 在之前 reset 没声明 → 回退 slate-100 白块
  background: rgba(15,23,42,0.70);
  border-radius: 14px;
  border: 1px solid $border-color;
  backdrop-filter: blur(12px) saturate(150%);
  -webkit-backdrop-filter: blur(12px) saturate(150%);
  box-shadow: $shadow-base;
  overflow: hidden;
}

.kanban-col-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  font-weight: 800;
  font-size: 13px;
  letter-spacing: 0.02em;
  border-bottom: 1px solid $border-color;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);

  &.todo {
    background: linear-gradient(90deg, rgba(129,140,248,0.25), rgba(129,140,248,0.08));
    color: #c7d2fe;
    text-shadow: 0 0 8px rgba(129,140,248,0.45);
  }
  &.progress {
    background: linear-gradient(90deg, rgba(251,191,36,0.28), rgba(251,191,36,0.06));
    color: #fde68a;
    text-shadow: 0 0 8px rgba(251,191,36,0.45);
  }
  &.review {
    background: linear-gradient(90deg, rgba(56,189,248,0.26), rgba(56,189,248,0.06));
    color: #a5f3fc;
    text-shadow: 0 0 8px rgba(56,189,248,0.45);
  }
  &.done {
    background: linear-gradient(90deg, rgba(16,185,129,0.26), rgba(16,185,129,0.06));
    color: #a7f3d0;
    text-shadow: 0 0 8px rgba(16,185,129,0.45);
  }

  .el-tag {
    margin-left: 6px;
  }
}

.kanban-col-body {
  flex: 1;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
  max-height: 480px;
}

.kanban-item {
  padding: 12px 14px;
  // 修: 原 --el-bg-color, #1f2937 兜底在不同浏览器会有 light 回退
  background: linear-gradient(180deg, rgba(30,41,59,0.65), rgba(15,23,42,0.65));
  border-radius: 12px;
  border-left: 4px solid $color-info;
  border-top: 1px solid rgba(148,163,184,0.12);
  border-right: 1px solid rgba(148,163,184,0.08);
  border-bottom: 1px solid rgba(148,163,184,0.08);
  cursor: pointer;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  transition: all $transition-base;

  &:hover {
    transform: translateX(2px);
    box-shadow:
      0 10px 26px rgba(0, 0, 0, 0.55),
      0 0 0 1px rgba(192,132,252,0.25),
      0 0 18px rgba(129,140,248,0.20);
    border-top-color: rgba(192,132,252,0.30);
  }

  &.is-overdue {
    border-left-color: $color-danger;
    background: linear-gradient(180deg, rgba(248,113,113,0.20), rgba(15,23,42,0.65));
    box-shadow: inset 0 0 0 1px rgba(248,113,113,0.22);
  }

  &.done {
    border-left-color: $color-success;
    background: linear-gradient(180deg, rgba(16,185,129,0.18), rgba(15,23,42,0.65));
    box-shadow: inset 0 0 0 1px rgba(16,185,129,0.20);
    opacity: 0.95;
  }

  .item-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
    .item-title {
      font-size: 13px;
      font-weight: 700;
      color: $text-primary;
      flex: 1;
      line-height: 1.45;
    }
    .done-icon {
      color: #a7f3d0;
      font-size: 18px;
      filter: drop-shadow(0 0 4px rgba(16,185,129,0.55));
    }
  }

  .item-row {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    margin-bottom: 4px;
    .item-label {
      color: $text-secondary;
      &.warning {
        color: #fbbf24;
        text-shadow: 0 0 6px rgba(251,191,36,0.35);
      }
    }
    .item-value {
      color: $text-primary;
    }
  }

  .item-actions {
    display: flex;
    gap: 6px;
    margin-top: 8px;
  }
}

// === 任务详情抽屉 · SLA 状态块 ===
.sla-status-block {
  padding: 14px 16px;
  // 修: 原 --el-fill-color-darker 未声明会回退浅色
  background: linear-gradient(135deg, rgba(34,211,238,0.10), rgba(192,132,252,0.14));
  border: 1px solid $border-color;
  border-radius: 12px;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.detail-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
