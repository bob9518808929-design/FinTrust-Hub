<!--
  ApprovalWorkbenchView.vue — Tab3 人工审批工作台
  职责: L3/L4 待办列表 + AI决策建议包 + 决策详情展开 + 同意/否决/退回补充材料
  对齐: simulation/js/view-approval.js + project_memory 硬约束(展示决策详情+退回补充材料+阻塞模态窗)
-->
<template>
  <div class="approval-workbench">
    <el-alert
      title="Tab3 人工审批工作台 — L3/L4 待办"
      type="info"
      :closable="false"
      show-icon
      description="人工处理 L3/L4 级融资审批工单，查看 AI 决策建议与完整决策上下文，决定通过/否决/退回补充材料。工单来源：Tab2 中金额≥500万或自主度≤L2 的融资请求自动推送至此。"
    />

    <el-card shadow="never" class="mt-16">
      <template #header>
        <div class="card-header">
          <span>L3/L4 待办列表</span>
          <el-tag :type="pending.length > 0 ? 'warning' : 'success'">{{ pending.length }} 件待办</el-tag>
        </div>
      </template>

      <el-empty v-if="pending.length === 0" description="暂无待审批工单">
        <template #description>
          <p>暂无待审批工单</p>
          <p class="muted">在 Tab2 中发起金额≥500万的融资，或切换至高风险企业 (L3) 发起融资，工单将出现在此</p>
        </template>
      </el-empty>

      <el-collapse v-else v-model="expandedNames" accordion>
        <el-collapse-item v-for="req in pending" :key="req.id" :name="req.id">
          <template #title>
            <div class="req-row">
              <span class="req-id">{{ req.id }}</span>
              <span class="req-ent">{{ req.enterprise }}</span>
              <el-tag size="small">{{ req.level }}</el-tag>
              <span class="req-amount">¥{{ formatAmount(req.amount) }}</span>
              <el-tag size="small" :type="confidenceTag(req.confidence)">置信度 {{ req.confidence }}%</el-tag>
            </div>
          </template>

          <el-descriptions :column="3" border size="small" class="mt-12">
            <el-descriptions-item label="路由原因">{{ req.reason }}</el-descriptions-item>
            <el-descriptions-item label="资金水位">{{ req.waterLevel ?? '—' }}</el-descriptions-item>
            <el-descriptions-item label="监管账户余额">¥{{ formatAmount(req.escrowBalance ?? 0) }}</el-descriptions-item>
            <el-descriptions-item label="责任链完整度">{{ req.chainCompleteness ?? '—' }}</el-descriptions-item>
            <el-descriptions-item label="五流验证">{{ req.fiveStreams ?? '—' }}</el-descriptions-item>
            <el-descriptions-item label="政策匹配">{{ req.policyMatch ?? '—' }}</el-descriptions-item>
          </el-descriptions>

          <div class="ai-suggestion mt-12">
            <strong>AI 建议：</strong>
            <el-tag :type="suggestionTag(req.suggestion)">{{ req.suggestion }}</el-tag>
            <span class="muted">{{ req.suggestionReason }}</span>
          </div>

          <div class="actions mt-16">
            <el-button type="success" @click="decide(req, 'approve')">✓ 同意</el-button>
            <el-button type="danger" @click="decide(req, 'reject')">✕ 否决</el-button>
            <el-button @click="decide(req, 'return')">↩ 退回补充材料</el-button>
          </div>
        </el-collapse-item>
      </el-collapse>
    </el-card>

    <el-card shadow="never" class="mt-16" v-if="processed.length > 0">
      <template #header><span>已处理工单 ({{ processed.length }})</span></template>
      <el-table :data="processed" size="small" stripe>
        <el-table-column prop="id" label="工单号" width="140" />
        <el-table-column prop="enterprise" label="企业" />
        <el-table-column prop="level" label="自主度" width="80" />
        <el-table-column label="金额" width="120"><template #default="{ row }">¥{{ formatAmount(row.amount) }}</template></el-table-column>
        <el-table-column prop="decision" label="决策" width="100">
          <template #default="{ row }">
            <el-tag :type="decisionTag(row.decision)" size="small">{{ row.decision }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="decidedAt" label="决策时间" width="180" />
      </el-table>
    </el-card>

    <el-dialog v-model="confirmVisible" title="二次确认" width="420px" :close-on-click-modal="false">
      <p>当前为不可逆决策，请二次确认：</p>
      <p class="muted">工单 {{ current?.id }} → 决策「{{ pendingAction }}」</p>
      <template #footer>
        <el-button @click="confirmVisible = false">取消</el-button>
        <el-button :type="actionType(pendingAction)" @click="confirmDecide">确认执行</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { useReformStore } from '@/stores/reform';

const reformStore = useReformStore();
const expandedNames = ref<string>('');
const confirmVisible = ref(false);
const current = ref<any>(null);
const pendingAction = ref<string>('');

const queue = computed(() => reformStore.approvalQueue ?? []);
const pending = computed(() => queue.value.filter((q: any) => q.status === 'pending'));
const processed = computed(() => queue.value.filter((q: any) => q.status !== 'pending'));

function formatAmount(amt: number): string {
  return (amt ?? 0).toLocaleString('zh-CN');
}
function confidenceTag(c: number) {
  if (c >= 80) return 'success';
  if (c >= 60) return 'warning';
  return 'danger';
}
function suggestionTag(s: string) {
  if (s === '通过') return 'success';
  if (s === '谨慎') return 'warning';
  return 'danger';
}
function decisionTag(d: string) {
  if (d === 'approve') return 'success';
  if (d === 'reject') return 'danger';
  return 'info';
}
function actionType(a: string) {
  if (a === 'approve') return 'success';
  if (a === 'reject') return 'danger';
  return 'primary';
}

function decide(req: any, action: string) {
  current.value = req;
  pendingAction.value = action;
  confirmVisible.value = true;
}

async function confirmDecide() {
  if (!current.value) return;
  try {
    await reformStore.decideApproval(current.value.id, pendingAction.value);
    ElMessage.success(`工单 ${current.value.id} 已${pendingAction.value === 'approve' ? '通过' : pendingAction.value === 'reject' ? '否决' : '退回'}`);
    confirmVisible.value = false;
  } catch (e: any) {
    ElMessage.error(e.message ?? '决策失败');
  }
}

onMounted(() => {
  reformStore.loadApprovalQueue().catch(() => {});
});
</script>

<style scoped lang="scss">
@use '@/styles/variables.scss' as *;

.mt-16 { margin-top: 16px; }
.mt-12 { margin-top: 12px; }
.muted { color: #94a3b8; font-size: 12px; font-weight: 600; }
.card-header { display: flex; justify-content: space-between; align-items: center; }
.req-row { display: flex; align-items: center; gap: 12px; width: 100%; flex-wrap: wrap; }
.req-id { font-family: monospace; color: #22d3ee; font-weight: 800; text-shadow: 0 0 6px rgba(34,211,238,0.45); }
.req-ent { font-weight: 700; color: $text-primary; }
.req-amount { color: #6ee7b7; font-weight: 800; text-shadow: 0 0 6px rgba(16,185,129,0.40); }
// ★ 这里就是用户看到的"淡色背景" — 原来是 var(--el-fill-color-light) Element Plus 默认 #f2f3f5
//   现在改为深空玻璃渐变 + 青紫霓虹边 + 内发光
.ai-suggestion {
  padding: 12px 16px;
  background: linear-gradient(135deg, rgba(30,41,59,0.55), rgba(15,23,42,0.60));
  border: 1px solid rgba(129,140,248,0.35);
  border-radius: 12px;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow: 0 0 0 1px rgba(34,211,238,0.08) inset, 0 4px 14px rgba(2,6,23,0.35);
  color: $text-primary;
  strong {
    font-weight: 800;
    background: $ai-gradient;
    -webkit-background-clip: text; background-clip: text;
    color: transparent;
    letter-spacing: 0.01em;
    margin-right: 8px;
  }
}
.actions { display: flex; gap: 10px; flex-wrap: wrap; }
</style>
