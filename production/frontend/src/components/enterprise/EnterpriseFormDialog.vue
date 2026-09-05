<!--
  EnterpriseFormDialog.vue — 企业录入/编辑共享表单弹窗

  设计哲学 (project_memory 傻瓜式操作):
    - 让用户做填空题不做选择题: 必填字段标红 *, 可选字段折叠
    - 自动派生: industry/riskProfile 选中后自动填充 industryLabel/riskLabel, 减少录入
    - 元/分自动换算: 用户输入元, 提交时换算成 AmountInCents (分)
    - 一键求助: 表单内字段右上方带 ? 图标, 按 F1 触发当前页面引导
-->
<template>
  <el-dialog
    v-model="visible"
    :title="isEdit ? '编辑企业信息' : '新增企业'"
    width="640px"
    :close-on-click-modal="false"
    destroy-on-close
  >
    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      label-width="120px"
      label-position="right"
      @submit.prevent
    >
      <el-form-item label="企业名称" prop="name" required>
        <el-input v-model="form.name" placeholder="如 深圳市某某制造有限公司" maxlength="60" show-word-limit />
      </el-form-item>

      <el-form-item label="行业" prop="industry" required>
        <el-select v-model="form.industry" placeholder="选择行业" style="width: 100%" @change="onIndustryChange">
          <el-option v-for="opt in INDUSTRY_OPTIONS" :key="opt.value" :label="opt.label" :value="opt.value" />
        </el-select>
      </el-form-item>

      <el-form-item label="产业政策" prop="industryPolicy" required>
        <el-select v-model="form.industryPolicy" placeholder="政策导向" style="width: 100%">
          <el-option label="鼓励类 (encourage)" value="encourage" />
          <el-option label="中性 (neutral)" value="neutral" />
          <el-option label="限制类 (restrict)" value="restrict" />
        </el-select>
      </el-form-item>

      <el-form-item label="风险画像" prop="riskProfile" required>
        <el-select v-model="form.riskProfile" placeholder="风险等级" style="width: 100%" @change="onRiskChange">
          <el-option label="优质 (premium)" value="premium" />
          <el-option label="正常 (normal)" value="normal" />
          <el-option label="高风险 (high_risk)" value="high_risk" />
          <el-option label="困境 (distress)" value="distress" />
        </el-select>
      </el-form-item>

      <el-divider content-position="left">
        <span class="section-hint">财务指标 (单位: 元, 系统自动换算为分)</span>
      </el-divider>

      <el-form-item label="月营收" prop="monthlyRevenue" required>
        <el-input-number
          v-model="form.monthlyRevenue"
          :min="0"
          :step="100000"
          :precision="0"
          controls-position="right"
          style="width: 100%"
        />
      </el-form-item>

      <el-form-item label="月支出" prop="monthlyExpense" required>
        <el-input-number
          v-model="form.monthlyExpense"
          :min="0"
          :step="100000"
          :precision="0"
          controls-position="right"
          style="width: 100%"
        />
      </el-form-item>

      <el-form-item label="账户余额" prop="accountBalance" required>
        <el-input-number
          v-model="form.accountBalance"
          :min="0"
          :step="100000"
          :precision="0"
          controls-position="right"
          style="width: 100%"
        />
      </el-form-item>

      <el-form-item label="应收账款" prop="pendingAR">
        <el-input-number
          v-model="form.pendingAR"
          :min="0"
          :step="100000"
          :precision="0"
          controls-position="right"
          style="width: 100%"
        />
      </el-form-item>

      <el-divider content-position="left">
        <span class="section-hint">数据流开关 (可选, 不勾选则后端填默认)</span>
      </el-divider>

      <el-form-item label="已开放数据流">
        <el-checkbox-group v-model="form.enabledFlows">
          <el-checkbox v-for="opt in DATA_FLOW_OPTIONS" :key="opt.value" :label="opt.value">
            {{ opt.label }}
          </el-checkbox>
        </el-checkbox-group>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="onSubmit">
        {{ isEdit ? '保存修改' : '创建企业' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import * as enterpriseApi from '@/api/enterprise';
import type {
  Enterprise,
  Industry,
  IndustryPolicy,
  RiskProfile,
  DataFlowKey,
} from '@contracts/common';

const props = defineProps<{
  modelValue: boolean;
  /** 编辑模式时传入原企业; 新建模式不传 */
  enterprise?: Enterprise | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'success', ent: Enterprise): void;
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const isEdit = computed(() => !!props.enterprise);

interface FormState {
  name: string;
  industry: Industry | '';
  industryLabel: string;
  industryPolicy: IndustryPolicy | '';
  riskProfile: RiskProfile | '';
  riskLabel: string;
  monthlyRevenue: number;
  monthlyExpense: number;
  accountBalance: number;
  pendingAR: number;
  enabledFlows: DataFlowKey[];
}

const form = reactive<FormState>({
  name: '',
  industry: '',
  industryLabel: '',
  industryPolicy: '',
  riskProfile: '',
  riskLabel: '',
  monthlyRevenue: 0,
  monthlyExpense: 0,
  accountBalance: 0,
  pendingAR: 0,
  enabledFlows: ['fund', 'contract', 'invoice'],
});

const INDUSTRY_OPTIONS: { value: Industry; label: string }[] = [
  { value: 'manufacturing', label: '制造业' },
  { value: 'high_tech', label: '高新技术' },
  { value: 'real_estate_related', label: '房地产关联' },
  { value: 'trade', label: '贸易' },
  { value: 'service', label: '服务业' },
  { value: 'agriculture', label: '农业' },
  { value: 'energy', label: '能源' },
  { value: 'logistics', label: '物流' },
];

const DATA_FLOW_OPTIONS: { value: DataFlowKey; label: string }[] = [
  { value: 'fund', label: '资金流' },
  { value: 'contract', label: '合同流' },
  { value: 'invoice', label: '发票流' },
  { value: 'logistics', label: '物流流' },
  { value: 'iot', label: '物联流' },
  { value: 'personnel', label: '人流' },
];

const rules: FormRules = {
  name: [{ required: true, message: '请输入企业名称', trigger: 'blur' }],
  industry: [{ required: true, message: '请选择行业', trigger: 'change' }],
  industryPolicy: [{ required: true, message: '请选择产业政策', trigger: 'change' }],
  riskProfile: [{ required: true, message: '请选择风险画像', trigger: 'change' }],
  monthlyRevenue: [{ required: true, message: '请输入月营收', type: 'number', trigger: 'blur' }],
  monthlyExpense: [{ required: true, message: '请输入月支出', type: 'number', trigger: 'blur' }],
  accountBalance: [{ required: true, message: '请输入账户余额', type: 'number', trigger: 'blur' }],
};

const formRef = ref<FormInstance>();
const submitting = ref(false);

function onIndustryChange(v: Industry) {
  const opt = INDUSTRY_OPTIONS.find((o) => o.value === v);
  form.industryLabel = opt?.label ?? '';
}

function onRiskChange(v: RiskProfile) {
  const map: Record<RiskProfile, string> = {
    premium: '优质',
    normal: '正常',
    high_risk: '高风险',
    distress: '困境',
  };
  form.riskLabel = map[v] ?? '';
}

watch(
  () => props.enterprise,
  (ent) => {
    if (ent) {
      form.name = ent.name;
      form.industry = ent.industry;
      form.industryLabel = ent.industryLabel;
      form.industryPolicy = ent.industryPolicy;
      form.riskProfile = ent.riskProfile;
      form.riskLabel = ent.riskLabel;
      form.monthlyRevenue = Math.round(ent.financials.monthlyRevenue / 100);
      form.monthlyExpense = Math.round(ent.financials.monthlyExpense / 100);
      form.accountBalance = Math.round(ent.financials.accountBalance / 100);
      form.pendingAR = Math.round(ent.financials.pendingAR / 100);
      form.enabledFlows = (Object.entries(ent.dataFlows) as [DataFlowKey, boolean][])
        .filter(([, v]) => v)
        .map(([k]) => k);
    } else {
      form.name = '';
      form.industry = '';
      form.industryLabel = '';
      form.industryPolicy = '';
      form.riskProfile = '';
      form.riskLabel = '';
      form.monthlyRevenue = 0;
      form.monthlyExpense = 0;
      form.accountBalance = 0;
      form.pendingAR = 0;
      form.enabledFlows = ['fund', 'contract', 'invoice'];
    }
  },
  { immediate: true },
);

async function onSubmit() {
  if (!formRef.value) return;
  const valid = await formRef.value.validate().catch(() => false);
  if (!valid) return;

  submitting.value = true;
  try {
    const dataFlows = {
      fund: form.enabledFlows.includes('fund'),
      contract: form.enabledFlows.includes('contract'),
      invoice: form.enabledFlows.includes('invoice'),
      logistics: form.enabledFlows.includes('logistics'),
      iot: form.enabledFlows.includes('iot'),
      personnel: form.enabledFlows.includes('personnel'),
    };

    if (isEdit.value && props.enterprise) {
      const updated = await enterpriseApi.updateEnterprise(props.enterprise.id, {
        name: form.name,
        industry: form.industry as Industry,
        industryLabel: form.industryLabel,
        industryPolicy: form.industryPolicy as IndustryPolicy,
        riskProfile: form.riskProfile as RiskProfile,
        riskLabel: form.riskLabel,
        dataFlows,
        financials: {
          monthlyRevenue: Math.round(form.monthlyRevenue * 100),
          monthlyExpense: Math.round(form.monthlyExpense * 100),
          accountBalance: Math.round(form.accountBalance * 100),
          pendingAR: Math.round(form.pendingAR * 100),
          billsHeld: props.enterprise.financials.billsHeld,
        },
      });
      ElMessage.success('企业信息已更新');
      emit('success', updated);
    } else {
      const created = await enterpriseApi.createEnterprise({
        name: form.name,
        industry: form.industry as Industry,
        industryLabel: form.industryLabel,
        industryPolicy: form.industryPolicy as IndustryPolicy,
        riskProfile: form.riskProfile as RiskProfile,
        riskLabel: form.riskLabel,
        dataFlows,
        financials: {
          monthlyRevenue: Math.round(form.monthlyRevenue * 100),
          monthlyExpense: Math.round(form.monthlyExpense * 100),
          accountBalance: Math.round(form.accountBalance * 100),
          pendingAR: Math.round(form.pendingAR * 100),
          billsHeld: [],
        },
      });
      ElMessage.success(`企业「${created.name}」创建成功 (ID: ${created.id})`);
      emit('success', created);
    }
    visible.value = false;
  } catch (e) {
    ElMessage.error('提交失败: ' + (e instanceof Error ? e.message : String(e)));
  } finally {
    submitting.value = false;
  }
}
</script>

<style lang="scss" scoped>
.section-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
