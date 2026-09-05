<template>
  <div class="insurance-portal-view">
    <el-row class="breadcrumb-row" justify="center">
      <el-col :lg="20" :md="22" :sm="24">
        <el-breadcrumb separator="/">
          <el-breadcrumb-item>FinTrust Hub</el-breadcrumb-item>
          <el-breadcrumb-item>合作伙伴门户</el-breadcrumb-item>
          <el-breadcrumb-item><b>保险公司端</b></el-breadcrumb-item>
        </el-breadcrumb>
      </el-col>
    </el-row>

    <el-row class="page-title-row" justify="center">
      <el-col :lg="20" :md="22" :sm="24">
        <el-card shadow="never" class="title-card">
          <el-row :gutter="16" align="middle">
            <el-col :span="16">
              <h2>🧾 保险公司端门户 · APP-06</h2>
              <p class="subtitle">投保受理 → 核保审查 → 保单管理 → 理赔处理 → 保费结算 全流程工作台</p>
            </el-col>
            <el-col :span="8">
              <el-row :gutter="8">
                <el-col :span="12">
                  <el-statistic title="在效保单" :value="stats.activePolicies" />
                </el-col>
                <el-col :span="12">
                  <el-statistic title="在保保额(万元)" :value="stats.totalCoverage" :precision="0" />
                </el-col>
              </el-row>
            </el-col>
          </el-row>
        </el-card>
      </el-col>
    </el-row>

    <el-row class="tabs-row" justify="center">
      <el-col :lg="20" :md="22" :sm="24">
        <el-card shadow="never">
          <el-tabs v-model="activeTab" type="card">
            <el-tab-pane label="投保受理" name="apply">
              <h3 class="tab-title">📋 待受理投保单</h3>
              <el-table :data="applyList" border stripe>
                <el-table-column prop="proposalNo" label="投保单号" width="170" />
                <el-table-column prop="policyholder" label="投保人" />
                <el-table-column prop="productName" label="保险产品" width="180" />
                <el-table-column prop="coverageWan" label="保额(万)" width="120" align="right">
                  <template #default="{ row }">
                    <span class="amount">￥{{ row.coverageWan.toLocaleString() }}</span>
                  </template>
                </el-table-column>
                <el-table-column prop="premiumWan" label="保费(元)" width="110" align="right">
                  <template #default="{ row }">￥{{ row.premiumYuan.toLocaleString() }}</template>
                </el-table-column>
                <el-table-column prop="periodYear" label="期限(年)" width="90" align="center" />
                <el-table-column prop="status" label="状态" width="100">
                  <template #default="{ row }">
                    <el-tag size="small" :type="row.status === '待受理' ? 'warning' : 'info'">{{ row.status }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="appliedAt" label="投保时间" width="170" />
                <el-table-column label="操作" width="200" fixed="right">
                  <template #default>
                    <el-button size="small" type="primary">受理</el-button>
                    <el-button size="small">详情</el-button>
                  </template>
                </el-table-column>
              </el-table>
            </el-tab-pane>

            <el-tab-pane label="核保审查" name="uw">
              <h3 class="tab-title">🔍 核保审查中保单</h3>
              <el-table :data="uwList" border stripe>
                <el-table-column prop="proposalNo" label="投保单号" width="170" />
                <el-table-column prop="policyholder" label="投保人" />
                <el-table-column prop="productName" label="产品" width="160" />
                <el-table-column prop="underwriter" label="核保人" width="90" />
                <el-table-column prop="riskCategory" label="风险类别" width="100">
                  <template #default="{ row }">
                    <el-tag size="small" :type="row.riskCategory === '标准体' ? 'success' : row.riskCategory === '次标准' ? 'warning' : 'danger'">{{ row.riskCategory }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="uwScore" label="核保评分" width="100" align="center">
                  <template #default="{ row }">
                    <el-progress type="dashboard" :percentage="row.uwScore" :width="60" />
                  </template>
                </el-table-column>
                <el-table-column prop="uwProgress" label="核保进度" width="180">
                  <template #default="{ row }">
                    <el-progress :percentage="row.uwProgress" />
                  </template>
                </el-table-column>
                <el-table-column label="操作" width="220" fixed="right">
                  <template #default>
                    <el-button size="small" type="primary">核保结论</el-button>
                    <el-button size="small">资料</el-button>
                  </template>
                </el-table-column>
              </el-table>
            </el-tab-pane>

            <el-tab-pane label="保单管理" name="policy">
              <h3 class="tab-title">📑 在效保单管理</h3>
              <el-table :data="policyList" border stripe>
                <el-table-column prop="policyNo" label="保单号" width="180" />
                <el-table-column prop="policyholder" label="投保人" />
                <el-table-column prop="productName" label="保险产品" width="170" />
                <el-table-column prop="coverageWan" label="保额(万)" width="110" align="right">
                  <template #default="{ row }">
                    <span class="amount">￥{{ row.coverageWan.toLocaleString() }}</span>
                  </template>
                </el-table-column>
                <el-table-column prop="effectiveDate" label="生效日" width="110" />
                <el-table-column prop="expireDate" label="到期日" width="110" />
                <el-table-column prop="paymentStatus" label="缴费状态" width="100">
                  <template #default="{ row }">
                    <el-tag size="small" :type="row.paymentStatus === '已缴' ? 'success' : 'warning'">{{ row.paymentStatus }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="policyStatus" label="保单状态" width="100">
                  <template #default="{ row }">
                    <el-tag size="small" :type="row.policyStatus === '有效' ? 'success' : 'info'">{{ row.policyStatus }}</el-tag>
                  </template>
                </el-table-column>
              </el-table>
            </el-tab-pane>

            <el-tab-pane label="理赔处理" name="claim">
              <h3 class="tab-title">💼 理赔案件处理</h3>
              <el-table :data="claimList" border stripe>
                <el-table-column prop="claimNo" label="报案号" width="170" />
                <el-table-column prop="policyNo" label="关联保单号" width="170" />
                <el-table-column prop="policyholder" label="出险人" />
                <el-table-column prop="incidentType" label="事故类型" width="110">
                  <template #default="{ row }">
                    <el-tag size="small" :type="row.incidentType === '财产损失' ? 'warning' : row.incidentType === '责任事故' ? 'danger' : 'primary'">{{ row.incidentType }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="reportedAt" label="报案时间" width="160" />
                <el-table-column prop="estimatedLossWan" label="估损(万)" width="110" align="right">
                  <template #default="{ row }">￥{{ row.estimatedLossWan.toLocaleString() }}</template>
                </el-table-column>
                <el-table-column prop="stage" label="理赔阶段" width="130">
                  <template #default="{ row }">
                    <el-tag size="small" :type="row.stage === '调查中' ? 'warning' : row.stage === '已赔付' ? 'success' : row.stage === '拒赔' ? 'danger' : 'info'">{{ row.stage }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="settledWan" label="已赔付(万)" width="120" align="right">
                  <template #default="{ row }">￥{{ row.settledWan.toLocaleString() }}</template>
                </el-table-column>
              </el-table>
            </el-tab-pane>

            <el-tab-pane label="保费结算" name="billing">
              <h3 class="tab-title">💰 保费结算台账</h3>
              <el-table :data="billingList" border stripe>
                <el-table-column prop="settleNo" label="结算单号" width="170" />
                <el-table-column prop="partnerName" label="合作方" />
                <el-table-column prop="policyCount" label="保单数" width="90" align="center" />
                <el-table-column prop="grossPremiumWan" label="毛保费(万)" width="130" align="right">
                  <template #default="{ row }">￥{{ row.grossPremiumWan.toLocaleString() }}</template>
                </el-table-column>
                <el-table-column prop="commissionWan" label="佣金(万)" width="110" align="right">
                  <template #default="{ row }">￥{{ row.commissionWan.toLocaleString() }}</template>
                </el-table-column>
                <el-table-column prop="netPremiumWan" label="净保费(万)" width="120" align="right">
                  <template #default="{ row }"><b>￥{{ row.netPremiumWan.toLocaleString() }}</b></template>
                </el-table-column>
                <el-table-column prop="settlePeriod" label="结算周期" width="110" />
                <el-table-column prop="status" label="结算状态" width="100">
                  <template #default="{ row }">
                    <el-tag size="small" :type="row.status === '已结算' ? 'success' : 'warning'">{{ row.status }}</el-tag>
                  </template>
                </el-table-column>
              </el-table>
            </el-tab-pane>

            <el-tab-pane label="数据分析" name="analytics">
              <h3 class="tab-title">📈 保险业务数据分析</h3>
              <el-row :gutter="16">
                <el-col :lg="6" :md="12" :sm="24">
                  <el-card shadow="hover">
                    <el-statistic title="本年承保保单数" :value="428" />
                    <el-progress :percentage="89" :stroke-width="8" style="margin-top: 12px" />
                    <p class="hint">达成率 89% · 目标 480 单</p>
                  </el-card>
                </el-col>
                <el-col :lg="6" :md="12" :sm="24">
                  <el-card shadow="hover">
                    <el-statistic title="本年保费收入(万元)" :value="5820" :precision="0" />
                    <el-progress :percentage="78" status="warning" :stroke-width="8" style="margin-top: 12px" />
                    <p class="hint">达成率 78% · 目标 7500 万</p>
                  </el-card>
                </el-col>
                <el-col :lg="6" :md="12" :sm="24">
                  <el-card shadow="hover">
                    <el-statistic title="综合赔付率" :value="42.6" suffix="%" :precision="1" />
                    <el-progress :percentage="43" status="success" :stroke-width="8" style="margin-top: 12px" />
                    <p class="hint">优于盈亏线 (≤ 65%)</p>
                  </el-card>
                </el-col>
                <el-col :lg="6" :md="12" :sm="24">
                  <el-card shadow="hover">
                    <el-statistic title="13 个月保单继续率" :value="91.8" suffix="%" :precision="1" />
                    <el-progress :percentage="92" status="success" :stroke-width="8" style="margin-top: 12px" />
                    <p class="hint">高于目标线 85%</p>
                  </el-card>
                </el-col>
              </el-row>
            </el-tab-pane>
          </el-tabs>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { ElNotification } from 'element-plus';
import { useEnterpriseStore } from '@/stores/enterprise';
import { useAlertStore } from '@/stores/alertStore';

defineOptions({ name: 'InsurancePortalView' });

const enterpriseStore = useEnterpriseStore();
const alertStore = useAlertStore();

const activeTab = ref('apply');

const stats = reactive({
  activePolicies: 428,
  totalCoverage: 152600,
});

const applyList = ref([
  { proposalNo: 'INS-2026-0412', policyholder: '深圳科创电子有限公司', productName: '国内贸易信用保险', coverageWan: 500, premiumYuan: 48000, periodYear: 1, status: '待受理', appliedAt: '2026-08-18 09:30' },
  { proposalNo: 'INS-2026-0413', policyholder: '杭州智造机械股份', productName: '企业财产综合险', coverageWan: 2800, premiumYuan: 126000, periodYear: 1, status: '待受理', appliedAt: '2026-08-18 11:15' },
  { proposalNo: 'INS-2026-0414', policyholder: '苏州新材料科技', productName: '产品质量保证保险', coverageWan: 300, premiumYuan: 22500, periodYear: 1, status: '已受理', appliedAt: '2026-08-17 15:48' },
  { proposalNo: 'INS-2026-0415', policyholder: '广州新能源汽车配件', productName: '贷款保证保险', coverageWan: 1200, premiumYuan: 96000, periodYear: 3, status: '待受理', appliedAt: '2026-08-17 10:20' },
  { proposalNo: 'INS-2026-0416', policyholder: '成都生物医药科技', productName: '药品质量责任险', coverageWan: 1000, premiumYuan: 150000, periodYear: 1, status: '待受理', appliedAt: '2026-08-16 16:30' },
  { proposalNo: 'INS-2026-0417', policyholder: '武汉光电技术研究院', productName: '关键设备财产险', coverageWan: 4500, premiumYuan: 202500, periodYear: 2, status: '已受理', appliedAt: '2026-08-15 09:00' },
]);

const uwList = ref([
  { proposalNo: 'INS-2026-0401', policyholder: '东莞精密制造有限公司', productName: '雇主责任险', underwriter: '周核保', riskCategory: '标准体', uwScore: 88, uwProgress: 75 },
  { proposalNo: 'INS-2026-0403', policyholder: '上海软件开发有限公司', productName: '董监事责任险', underwriter: '陈核保', riskCategory: '标准体', uwScore: 93, uwProgress: 95 },
  { proposalNo: 'INS-2026-0405', policyholder: '重庆汽车零部件公司', productName: '产品责任保险', underwriter: '吴核保', riskCategory: '次标准', uwScore: 62, uwProgress: 50 },
  { proposalNo: 'INS-2026-0407', policyholder: '厦门海洋食品集团', productName: '货物运输险', underwriter: '周核保', riskCategory: '标准体', uwScore: 80, uwProgress: 60 },
  { proposalNo: 'INS-2026-0409', policyholder: '西安半导体设备公司', productName: '工程设备一切险', underwriter: '郑核保', riskCategory: '标准体', uwScore: 90, uwProgress: 85 },
]);

const policyList = ref([
  { policyNo: 'P-2025-8801', policyholder: '深圳科创电子有限公司', productName: '国内贸易信用保险', coverageWan: 500, effectiveDate: '2025-09-01', expireDate: '2026-08-31', paymentStatus: '已缴', policyStatus: '有效' },
  { policyNo: 'P-2025-8815', policyholder: '杭州智造机械股份', productName: '企业财产综合险', coverageWan: 2800, effectiveDate: '2025-10-15', expireDate: '2026-10-14', paymentStatus: '已缴', policyStatus: '有效' },
  { policyNo: 'P-2026-1002', policyholder: '苏州新材料科技', productName: '产品质量保证保险', coverageWan: 300, effectiveDate: '2026-02-01', expireDate: '2027-01-31', paymentStatus: '已缴', policyStatus: '有效' },
  { policyNo: 'P-2026-1008', policyholder: '广州新能源汽车配件', productName: '贷款保证保险', coverageWan: 1200, effectiveDate: '2026-03-10', expireDate: '2029-03-09', paymentStatus: '分期中', policyStatus: '有效' },
  { policyNo: 'P-2026-1015', policyholder: '成都生物医药科技', productName: '药品质量责任险', coverageWan: 1000, effectiveDate: '2026-05-01', expireDate: '2027-04-30', paymentStatus: '已缴', policyStatus: '有效' },
  { policyNo: 'P-2025-8775', policyholder: '武汉光电技术研究院', productName: '关键设备财产险', coverageWan: 4500, effectiveDate: '2025-08-20', expireDate: '2027-08-19', paymentStatus: '已缴', policyStatus: '有效' },
  { policyNo: 'P-2025-8782', policyholder: '西安半导体设备公司', productName: '工程设备一切险', coverageWan: 2200, effectiveDate: '2025-08-25', expireDate: '2026-08-24', paymentStatus: '已缴', policyStatus: '即将到期' },
]);

const claimList = ref([
  { claimNo: 'CLM-2026-0118', policyNo: 'P-2025-8801', policyholder: '深圳科创电子有限公司', incidentType: '应收账款损失', reportedAt: '2026-08-15 14:20', estimatedLossWan: 58, stage: '调查中', settledWan: 0 },
  { claimNo: 'CLM-2026-0115', policyNo: 'P-2025-8775', policyholder: '武汉光电技术研究院', incidentType: '财产损失', reportedAt: '2026-08-10 09:05', estimatedLossWan: 120, stage: '赔付阶段', settledWan: 85 },
  { claimNo: 'CLM-2026-0108', policyNo: 'P-2025-8815', policyholder: '杭州智造机械股份', incidentType: '责任事故', reportedAt: '2026-07-28 16:45', estimatedLossWan: 35, stage: '已赔付', settledWan: 32 },
  { claimNo: 'CLM-2026-0102', policyNo: 'P-2025-8758', policyholder: '佛山陶瓷贸易公司', incidentType: '自然灾害', reportedAt: '2026-07-10 20:10', estimatedLossWan: 250, stage: '拒赔', settledWan: 0 },
  { claimNo: 'CLM-2026-0098', policyNo: 'P-2026-1002', policyholder: '苏州新材料科技', incidentType: '财产损失', reportedAt: '2026-07-05 11:30', estimatedLossWan: 18, stage: '已赔付', settledWan: 18 },
]);

const billingList = ref([
  { settleNo: 'STL-2026-0815', partnerName: '招商银行-深分', policyCount: 28, grossPremiumWan: 385.5, commissionWan: 57.8, netPremiumWan: 327.7, settlePeriod: '2026-08', status: '已结算' },
  { settleNo: 'STL-2026-0815', partnerName: '工商银行-浙分', policyCount: 45, grossPremiumWan: 620.0, commissionWan: 93.0, netPremiumWan: 527.0, settlePeriod: '2026-08', status: '已结算' },
  { settleNo: 'STL-2026-0815', partnerName: '建设银行-苏分', policyCount: 22, grossPremiumWan: 285.8, commissionWan: 42.9, netPremiumWan: 242.9, settlePeriod: '2026-08', status: '待确认' },
  { settleNo: 'STL-2026-0815', partnerName: '平安担保-粤分', policyCount: 18, grossPremiumWan: 192.4, commissionWan: 28.9, netPremiumWan: 163.5, settlePeriod: '2026-08', status: '已结算' },
  { settleNo: 'STL-2026-0815', partnerName: '太平洋担保-华中', policyCount: 31, grossPremiumWan: 415.0, commissionWan: 62.3, netPremiumWan: 352.7, settlePeriod: '2026-08', status: '处理中' },
]);

onMounted(async () => {
  if (!enterpriseStore.enterprises.length) {
    try { await enterpriseStore.fetchEnterprises(); } catch (_e) { /* ignore */ }
  }
  ElNotification.success({ title: '保险端门户就绪', message: '已加载 6 个工作台模块，祝您工作顺利', duration: 3000 });
  alertStore;
});
</script>

<style lang="scss" scoped>
.insurance-portal-view {
  padding: $spacing-lg 0;

  .breadcrumb-row { margin-bottom: $spacing-base; }
  .page-title-row { margin-bottom: $spacing-lg; }

  .title-card {
    background: linear-gradient(135deg, #e8f5e9 0%, #fff 100%);
    border-left: 4px solid $color-success;
    h2 { margin: 0; font-size: 22px; }
    .subtitle { margin: $spacing-xs 0 0; color: $text-muted; }
  }

  .tab-title {
    margin: $spacing-sm 0 $spacing-base;
    font-size: 16px;
    color: $text-primary;
  }

  .amount { font-weight: 600; color: $color-primary; }
  .hint { margin: $spacing-xs 0 0; font-size: 12px; color: $text-muted; }
}
</style>
