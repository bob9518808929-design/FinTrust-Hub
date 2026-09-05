<template>
  <div class="guarantee-portal-view">
    <el-row class="breadcrumb-row" justify="center">
      <el-col :lg="20" :md="22" :sm="24">
        <el-breadcrumb separator="/">
          <el-breadcrumb-item>FinTrust Hub</el-breadcrumb-item>
          <el-breadcrumb-item>合作伙伴门户</el-breadcrumb-item>
          <el-breadcrumb-item><b>担保公司端</b></el-breadcrumb-item>
        </el-breadcrumb>
      </el-col>
    </el-row>

    <el-row class="page-title-row" justify="center">
      <el-col :lg="20" :md="22" :sm="24">
        <el-card shadow="never" class="title-card">
          <el-row :gutter="16" align="middle">
            <el-col :span="16">
              <h2>🛡️ 担保公司端门户 · APP-05</h2>
              <p class="subtitle">保前审查 → 反担保管理 → 代偿处理 → 保后监管 全流程工作台</p>
            </el-col>
            <el-col :span="8">
              <el-row :gutter="8">
                <el-col :span="12">
                  <el-statistic title="在保申请" :value="stats.activeApplications" />
                </el-col>
                <el-col :span="12">
                  <el-statistic title="在保余额(万元)" :value="stats.totalGuaranteed" :precision="0" />
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
            <el-tab-pane label="担保申请受理" name="apply">
              <h3 class="tab-title">📋 待受理担保申请</h3>
              <el-table :data="applyList" border stripe>
                <el-table-column prop="applyNo" label="申请号" width="160" />
                <el-table-column prop="enterpriseName" label="申请企业" />
                <el-table-column prop="amountWan" label="担保金额(万)" width="130" align="right">
                  <template #default="{ row }">
                    <span class="amount">￥{{ row.amountWan.toLocaleString() }}</span>
                  </template>
                </el-table-column>
                <el-table-column prop="periodMonth" label="期限(月)" width="100" align="center" />
                <el-table-column prop="businessType" label="业务类型" width="120">
                  <template #default="{ row }">
                    <el-tag size="small" :type="row.businessType === '流贷' ? 'primary' : 'success'">{{ row.businessType }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="status" label="状态" width="110">
                  <template #default="{ row }">
                    <el-tag size="small" :type="row.status === '待受理' ? 'warning' : 'info'">{{ row.status }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="appliedAt" label="申请时间" width="170" />
                <el-table-column label="操作" width="200" fixed="right">
                  <template #default>
                    <el-button size="small" type="primary">受理</el-button>
                    <el-button size="small">详情</el-button>
                  </template>
                </el-table-column>
              </el-table>
            </el-tab-pane>

            <el-tab-pane label="保前审查" name="review">
              <h3 class="tab-title">🔍 保前审查中项目</h3>
              <el-table :data="reviewList" border stripe>
                <el-table-column prop="applyNo" label="申请号" width="160" />
                <el-table-column prop="enterpriseName" label="企业" />
                <el-table-column prop="reviewer" label="审查人" width="100" />
                <el-table-column prop="riskLevel" label="风险等级" width="100">
                  <template #default="{ row }">
                    <el-tag size="small" :type="row.riskLevel === '低' ? 'success' : row.riskLevel === '中' ? 'warning' : 'danger'">{{ row.riskLevel }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="creditScore" label="信用分" width="90" align="center">
                  <template #default="{ row }">
                    <el-progress type="dashboard" :percentage="row.creditScore" :width="60" />
                  </template>
                </el-table-column>
                <el-table-column prop="reviewProgress" label="审查进度" width="180">
                  <template #default="{ row }">
                    <el-progress :percentage="row.reviewProgress" />
                  </template>
                </el-table-column>
                <el-table-column label="操作" width="220" fixed="right">
                  <template #default>
                    <el-button size="small" type="primary">提交意见</el-button>
                    <el-button size="small">资料</el-button>
                  </template>
                </el-table-column>
              </el-table>
            </el-tab-pane>

            <el-tab-pane label="反担保管理" name="counter">
              <h3 class="tab-title">🏢 反担保品管理</h3>
              <el-table :data="counterList" border stripe>
                <el-table-column prop="certNo" label="反担保编号" width="160" />
                <el-table-column prop="enterpriseName" label="所属企业" />
                <el-table-column prop="collateralType" label="担保品类型" width="120" />
                <el-table-column prop="collateralDesc" label="担保品描述" />
                <el-table-column prop="appraisedValueWan" label="评估价值(万)" width="140" align="right">
                  <template #default="{ row }">
                    <span class="amount">￥{{ row.appraisedValueWan.toLocaleString() }}</span>
                  </template>
                </el-table-column>
                <el-table-column prop="ratio" label="抵质押率" width="100">
                  <template #default="{ row }">
                    <el-tag size="small">{{ (row.ratio * 100).toFixed(1) }}%</el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="status" label="状态" width="100">
                  <template #default="{ row }">
                    <el-tag size="small" :type="row.status === '已登记' ? 'success' : 'info'">{{ row.status }}</el-tag>
                  </template>
                </el-table-column>
              </el-table>
            </el-tab-pane>

            <el-tab-pane label="代偿处理" name="compensate">
              <h3 class="tab-title">⚠️ 代偿处理台账</h3>
              <el-table :data="compensateList" border stripe>
                <el-table-column prop="caseNo" label="代偿案件号" width="170" />
                <el-table-column prop="enterpriseName" label="企业" />
                <el-table-column prop="principalWan" label="代偿本金(万)" width="140" align="right">
                  <template #default="{ row }">￥{{ row.principalWan.toLocaleString() }}</template>
                </el-table-column>
                <el-table-column prop="interestWan" label="利息(万)" width="110" align="right">
                  <template #default="{ row }">￥{{ row.interestWan.toLocaleString() }}</template>
                </el-table-column>
                <el-table-column prop="totalWan" label="合计(万)" width="120" align="right">
                  <template #default="{ row }"><b>￥{{ row.totalWan.toLocaleString() }}</b></template>
                </el-table-column>
                <el-table-column prop="stage" label="阶段" width="130">
                  <template #default="{ row }">
                    <el-tag size="small" :type="row.stage === '追偿中' ? 'warning' : row.stage === '已结清' ? 'success' : 'danger'">{{ row.stage }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="recoveredWan" label="已追偿(万)" width="120" align="right">
                  <template #default="{ row }">￥{{ row.recoveredWan.toLocaleString() }}</template>
                </el-table-column>
              </el-table>
            </el-tab-pane>

            <el-tab-pane label="保后监管" name="monitor">
              <h3 class="tab-title">📊 保后监管清单</h3>
              <el-table :data="monitorList" border stripe>
                <el-table-column prop="guaranteeNo" label="保函编号" width="170" />
                <el-table-column prop="enterpriseName" label="企业" />
                <el-table-column prop="guaranteedWan" label="在保余额(万)" width="130" align="right">
                  <template #default="{ row }">￥{{ row.guaranteedWan.toLocaleString() }}</template>
                </el-table-column>
                <el-table-column prop="riskSignal" label="风险信号" width="110">
                  <template #default="{ row }">
                    <el-tag size="small" :type="row.riskSignal === '正常' ? 'success' : row.riskSignal === '关注' ? 'warning' : 'danger'">{{ row.riskSignal }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="nextInspectDate" label="下次检查" width="130" />
                <el-table-column prop="flowCheck" label="五流核验" width="100">
                  <template #default="{ row }">
                    <el-tag size="small" :type="row.flowCheck === '通过' ? 'success' : 'warning'">{{ row.flowCheck }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="iotOnline" label="IoT 在线" width="100">
                  <template #default="{ row }">
                    <el-tag size="small" :type="row.iotOnline ? 'success' : 'info'">{{ row.iotOnline ? '在线' : '离线' }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="操作" width="150" fixed="right">
                  <template #default>
                    <el-button size="small" type="primary">现场检查</el-button>
                  </template>
                </el-table-column>
              </el-table>
            </el-tab-pane>

            <el-tab-pane label="数据统计" name="stats">
              <h3 class="tab-title">📈 担保业务统计</h3>
              <el-row :gutter="16">
                <el-col :lg="6" :md="12" :sm="24">
                  <el-card shadow="hover">
                    <el-statistic title="本年新增担保笔数" :value="87" />
                    <el-progress :percentage="72" :stroke-width="8" style="margin-top: 12px" />
                    <p class="hint">达成率 72% · 目标 120 笔</p>
                  </el-card>
                </el-col>
                <el-col :lg="6" :md="12" :sm="24">
                  <el-card shadow="hover">
                    <el-statistic title="本年新增保额(亿元)" :value="3.65" :precision="2" />
                    <el-progress :percentage="61" status="warning" :stroke-width="8" style="margin-top: 12px" />
                    <p class="hint">达成率 61% · 目标 6 亿</p>
                  </el-card>
                </el-col>
                <el-col :lg="6" :md="12" :sm="24">
                  <el-card shadow="hover">
                    <el-statistic title="代偿率" :value="1.28" suffix="%" :precision="2" />
                    <el-progress :percentage="26" status="success" :stroke-width="8" style="margin-top: 12px" />
                    <p class="hint">优于警戒线 (≤ 3%)</p>
                  </el-card>
                </el-col>
                <el-col :lg="6" :md="12" :sm="24">
                  <el-card shadow="hover">
                    <el-statistic title="追偿回收率" :value="86.5" suffix="%" :precision="1" />
                    <el-progress :percentage="86" status="success" :stroke-width="8" style="margin-top: 12px" />
                    <p class="hint">高于目标 80%</p>
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

defineOptions({ name: 'GuaranteePortalView' });

const enterpriseStore = useEnterpriseStore();
const alertStore = useAlertStore();

const activeTab = ref('apply');

const stats = reactive({
  activeApplications: 156,
  totalGuaranteed: 32800,
});

const applyList = ref([
  { applyNo: 'GA-2026-0158', enterpriseName: '深圳科创电子有限公司', amountWan: 300, periodMonth: 12, businessType: '流贷', status: '待受理', appliedAt: '2026-08-18 10:25' },
  { applyNo: 'GA-2026-0159', enterpriseName: '杭州智造机械股份', amountWan: 500, periodMonth: 24, businessType: '项目贷', status: '待受理', appliedAt: '2026-08-18 11:32' },
  { applyNo: 'GA-2026-0160', enterpriseName: '苏州新材料科技', amountWan: 800, periodMonth: 18, businessType: '流贷', status: '已受理', appliedAt: '2026-08-17 16:08' },
  { applyNo: 'GA-2026-0161', enterpriseName: '广州新能源汽车配件', amountWan: 1200, periodMonth: 36, businessType: '项目贷', status: '待受理', appliedAt: '2026-08-17 09:15' },
  { applyNo: 'GA-2026-0162', enterpriseName: '成都生物医药科技', amountWan: 200, periodMonth: 6, businessType: '流贷', status: '待受理', appliedAt: '2026-08-16 14:40' },
  { applyNo: 'GA-2026-0163', enterpriseName: '武汉光电技术研究院', amountWan: 1500, periodMonth: 24, businessType: '项目贷', status: '已受理', appliedAt: '2026-08-15 17:22' },
]);

const reviewList = ref([
  { applyNo: 'GA-2026-0150', enterpriseName: '东莞精密制造有限公司', reviewer: '李工', riskLevel: '中', creditScore: 78, reviewProgress: 65 },
  { applyNo: 'GA-2026-0152', enterpriseName: '上海软件开发有限公司', reviewer: '张审', riskLevel: '低', creditScore: 91, reviewProgress: 90 },
  { applyNo: 'GA-2026-0153', enterpriseName: '重庆汽车零部件公司', reviewer: '王工', riskLevel: '高', creditScore: 58, reviewProgress: 40 },
  { applyNo: 'GA-2026-0155', enterpriseName: '厦门海洋食品集团', reviewer: '刘审', riskLevel: '中', creditScore: 72, reviewProgress: 55 },
  { applyNo: 'GA-2026-0157', enterpriseName: '西安半导体设备公司', reviewer: '李工', riskLevel: '低', creditScore: 86, reviewProgress: 80 },
]);

const counterList = ref([
  { certNo: 'CG-2026-0201', enterpriseName: '东莞精密制造有限公司', collateralType: '不动产抵押', collateralDesc: '东莞松山湖工业厂房 2 栋', appraisedValueWan: 2800, ratio: 0.32, status: '已登记' },
  { certNo: 'CG-2026-0202', enterpriseName: '深圳科创电子有限公司', collateralType: '动产质押', collateralDesc: 'SMT 高速贴片机 8 台', appraisedValueWan: 960, ratio: 0.42, status: '已登记' },
  { certNo: 'CG-2026-0203', enterpriseName: '广州新能源汽车配件', collateralType: '股权质押', collateralDesc: '核心子公司 49% 股权', appraisedValueWan: 2100, ratio: 0.50, status: '登记中' },
  { certNo: 'CG-2026-0204', enterpriseName: '苏州新材料科技', collateralType: '应收账款', collateralDesc: '某上市公司 6 个月应收款', appraisedValueWan: 540, ratio: 0.70, status: '已登记' },
  { certNo: 'CG-2026-0205', enterpriseName: '杭州智造机械股份', collateralType: '不动产抵押', collateralDesc: '杭州余杭工业用地 + 厂房', appraisedValueWan: 3500, ratio: 0.28, status: '已登记' },
  { certNo: 'CG-2026-0206', enterpriseName: '成都生物医药科技', collateralType: '知识产权', collateralDesc: '发明专利 5 项 + 商标 2 项', appraisedValueWan: 380, ratio: 0.55, status: '登记中' },
]);

const compensateList = ref([
  { caseNo: 'DC-2026-0012', enterpriseName: '佛山陶瓷贸易公司', principalWan: 280, interestWan: 23.5, totalWan: 303.5, stage: '追偿中', recoveredWan: 85 },
  { caseNo: 'DC-2026-0008', enterpriseName: '温州鞋服制造公司', principalWan: 150, interestWan: 12.3, totalWan: 162.3, stage: '诉讼阶段', recoveredWan: 0 },
  { caseNo: 'DC-2025-0035', enterpriseName: '绍兴纺织印染厂', principalWan: 420, interestWan: 41.8, totalWan: 461.8, stage: '追偿中', recoveredWan: 290 },
  { caseNo: 'DC-2025-0020', enterpriseName: '常州机械加工厂', principalWan: 90, interestWan: 5.2, totalWan: 95.2, stage: '已结清', recoveredWan: 95.2 },
  { caseNo: 'DC-2026-0003', enterpriseName: '临沂板材批发商', principalWan: 200, interestWan: 16.5, totalWan: 216.5, stage: '追偿中', recoveredWan: 40 },
]);

const monitorList = ref([
  { guaranteeNo: 'BH-2025-1085', enterpriseName: '深圳科创电子有限公司', guaranteedWan: 280, riskSignal: '正常', nextInspectDate: '2026-09-05', flowCheck: '通过', iotOnline: true },
  { guaranteeNo: 'BH-2025-1090', enterpriseName: '杭州智造机械股份', guaranteedWan: 450, riskSignal: '关注', nextInspectDate: '2026-08-28', flowCheck: '通过', iotOnline: true },
  { guaranteeNo: 'BH-2026-1002', enterpriseName: '苏州新材料科技', guaranteedWan: 720, riskSignal: '正常', nextInspectDate: '2026-09-20', flowCheck: '通过', iotOnline: true },
  { guaranteeNo: 'BH-2026-1005', enterpriseName: '广州新能源汽车配件', guaranteedWan: 1100, riskSignal: '预警', nextInspectDate: '2026-08-22', flowCheck: '待补充', iotOnline: false },
  { guaranteeNo: 'BH-2026-1010', enterpriseName: '成都生物医药科技', guaranteedWan: 180, riskSignal: '正常', nextInspectDate: '2026-10-01', flowCheck: '通过', iotOnline: true },
  { guaranteeNo: 'BH-2026-1015', enterpriseName: '武汉光电技术研究院', guaranteedWan: 1350, riskSignal: '关注', nextInspectDate: '2026-09-01', flowCheck: '通过', iotOnline: true },
  { guaranteeNo: 'BH-2025-1070', enterpriseName: '西安半导体设备公司', guaranteedWan: 650, riskSignal: '正常', nextInspectDate: '2026-09-15', flowCheck: '通过', iotOnline: true },
]);

onMounted(async () => {
  if (!enterpriseStore.enterprises.length) {
    try { await enterpriseStore.fetchEnterprises(); } catch (_e) { /* ignore */ }
  }
  ElNotification.success({ title: '担保端门户就绪', message: '已加载 6 个工作台模块，祝您工作顺利', duration: 3000 });
  alertStore;
});
</script>

<style lang="scss" scoped>
.guarantee-portal-view {
  padding: $spacing-lg 0;

  .breadcrumb-row { margin-bottom: $spacing-base; }
  .page-title-row { margin-bottom: $spacing-lg; }

  .title-card {
    background: linear-gradient(135deg, #fff8e1 0%, #fff 100%);
    border-left: 4px solid $color-warning;
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
