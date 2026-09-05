<!--
  ScfWorkbenchView.vue — Tab11 供应链金融工作台
  职责: SC1-SC10 引擎族 + 13维画像 + 关系图谱 + 黑白名单 + 5类SCF产品 + 独立业务闭环
  深化 (SCF-05/06/08/09):
    - 4 个场景预设一键加载 (反向保理/存货质押/应收账款转让/票据贴现)
    - SC6 定价计算器 (LPR + 风险溢价 - 担保抵扣)
    - SC7 风险扩散图 (核心企业违约 → 上下游 N 跳传播)
    - SC8 撮合结果 (top-3 候选: 企业-银行-额度-利率-置信度)
    - SC9 履约监控告警 (红/黄/绿灯)
    - SC10 案例库 (行业/产品/规模/结果四维分类 + 关键词匹配)
    - SCF↔Reform 联动 (R10 完成 → SC1 画像刷新 → SC8 撮合重算)
  对齐: simulation/js/view-scf.js (v6.0 新增)
-->
<template>
  <div class="scf-workbench">
    <el-alert
      title="Tab11 供应链金融工作台 — SC1-SC10 引擎族"
      type="info"
      :closable="false"
      show-icon
      description="供应链金融独立业务闭环：13 维企业画像 + 关系图谱 + 黑白名单 + 5 类 SCF 产品(应收账款融资/预付款融资/存货融资/票据贴现/反向保理)。v6.0 新增。"
    />

    <el-card shadow="never" class="mt-16">
      <template #header><span>SC1-SC10 引擎族状态</span></template>
      <el-row :gutter="12">
        <el-col v-for="e in scEngines" :key="e.id" :span="6" class="engine-col">
          <el-card shadow="hover" :body-style="{ padding: '12px' }">
            <div class="engine-head">
              <span class="engine-id">{{ e.id }}</span>
              <el-tag size="small" :type="e.status === 'ready' ? 'success' : 'warning'">{{ e.status === 'ready' ? '就绪' : '加载中' }}</el-tag>
            </div>
            <div class="engine-name">{{ e.name }}</div>
            <div class="muted">{{ e.desc }}</div>
          </el-card>
        </el-col>
      </el-row>
    </el-card>

    <!-- 场景预设: 一键加载 (SCF-08) -->
    <el-card shadow="never" class="mt-16 scenario-card">
      <template #header>
        <div class="card-header-flex">
          <span>场景预设 (SCF-08 一键加载)</span>
          <el-tag size="small" type="info">点击按钮自动填表到下方计算器</el-tag>
        </div>
      </template>
      <el-row :gutter="12">
        <el-col v-for="s in scenarios" :key="s.scenarioId" :span="6" class="scenario-col">
          <el-button
            :type="currentScenario?.scenarioId === s.scenarioId ? 'primary' : 'default'"
            class="scenario-btn"
            @click="applyScenario(s.scenarioId)"
          >
            <div class="scenario-btn-inner">
              <div class="scenario-btn-title">{{ s.name }}</div>
              <div class="scenario-btn-desc">{{ s.defaultEnterprise }} · {{ s.defaultTermMonths }}月</div>
            </div>
          </el-button>
        </el-col>
      </el-row>
      <div v-if="currentScenario" class="scenario-detail">
        <el-alert :title="currentScenario.description" type="success" :closable="false" show-icon />
        <div class="scenario-prefill">
          已填入: 信用分 <b>{{ pricingForm.creditScore }}</b> ·
          行业 <b>{{ industryLabel(pricingForm.industry) }}</b> ·
          担保方式 <b>{{ guaranteeLabel(pricingForm.guaranteeMethod) }}</b> ·
          期限 <b>{{ pricingForm.termMonths }}</b>月 ·
          金额 <b>¥{{ formatAmount(pricingForm.loanAmountYuan) }}</b>
        </div>
      </div>
    </el-card>

    <el-row :gutter="16" class="mt-16">
      <el-col :span="14">
        <el-card shadow="never">
          <template #header><span>13 维企业画像</span></template>
          <v-chart :option="radarOption" style="height: 320px" autoresize />
        </el-card>
      </el-col>
      <el-col :span="10">
        <el-card shadow="never">
          <template #header><span>关系图谱(简化)</span></template>
          <v-chart :option="graphOption" style="height: 320px" autoresize />
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never" class="mt-16">
      <template #header><span>5 类 SCF 产品</span></template>
      <el-table :data="scfProducts" size="small" stripe>
        <el-table-column prop="id" label="编号" width="80" />
        <el-table-column prop="name" label="产品" width="160" />
        <el-table-column prop="scene" label="适用场景" />
        <el-table-column label="额度上限" width="140"><template #default="{ row }">¥{{ formatAmount(row.maxAmount) }}</template></el-table-column>
        <el-table-column label="利率" width="80"><template #default="{ row }">{{ row.rate }}%</template></el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }"><el-tag size="small" :type="row.enabled ? 'success' : 'info'">{{ row.enabled ? '已开通' : '未开通' }}</el-tag></template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- SC6 定价计算器 -->
    <el-card shadow="never" class="mt-16">
      <template #header><span>SC6 定价计算器 (综合利率 = LPR + 风险溢价 - 担保抵扣)</span></template>
      <el-form :model="pricingForm" label-width="120px" size="small" inline>
        <el-form-item label="企业 ID">
          <el-input v-model="pricingForm.enterpriseId" placeholder="如 E-SZ-KC" style="width: 160px" />
        </el-form-item>
        <el-form-item label="信用评分">
          <el-input-number v-model="pricingForm.creditScore" :min="0" :max="100" controls-position="right" style="width: 120px" />
        </el-form-item>
        <el-form-item label="行业">
          <el-select v-model="pricingForm.industry" style="width: 160px">
            <el-option v-for="opt in industryOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="担保方式">
          <el-select v-model="pricingForm.guaranteeMethod" style="width: 160px">
            <el-option v-for="opt in guaranteeOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="期限(月)">
          <el-input-number v-model="pricingForm.termMonths" :min="1" :max="120" controls-position="right" style="width: 120px" />
        </el-form-item>
        <el-form-item label="融资金额(元)">
          <el-input-number v-model="pricingForm.loanAmountYuan" :min="0" :step="100000" controls-position="right" style="width: 180px" />
        </el-form-item>
        <el-form-item label="基础 LPR(%)">
          <el-input-number v-model="pricingForm.baseLpr" :min="0" :step="0.05" :precision="2" controls-position="right" style="width: 120px" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="scfStore.loading" @click="runPricing">计算定价</el-button>
        </el-form-item>
      </el-form>
      <div v-if="pricingResult" class="pricing-result">
        <el-descriptions :column="4" border size="small" title="定价明细">
          <el-descriptions-item label="基础利率 (LPR)">{{ pricingResult.baseRate }}%</el-descriptions-item>
          <el-descriptions-item label="风险溢价">
            <span class="text-warning">+{{ pricingResult.riskPremium }}%</span>
          </el-descriptions-item>
          <el-descriptions-item label="担保抵扣">
            <span class="text-success">-{{ pricingResult.collateralDiscount }}%</span>
          </el-descriptions-item>
          <el-descriptions-item label="最终综合利率">
            <span class="text-primary big">{{ pricingResult.finalRate }}%</span>
          </el-descriptions-item>
          <el-descriptions-item label="年利息(元)">{{ formatAmount(Math.round(pricingResult.annualInterest / 100)) }}</el-descriptions-item>
          <el-descriptions-item label="信用分档位">{{ (pricingResult.breakdown as any).creditScoreBucket }}</el-descriptions-item>
          <el-descriptions-item label="公式" :span="2">{{ (pricingResult.breakdown as any).formula }}</el-descriptions-item>
        </el-descriptions>
      </div>
    </el-card>

    <!-- SC7 风险扩散 -->
    <el-card shadow="never" class="mt-16">
      <template #header><span>SC7 风险扩散 (核心企业违约 → 上下游 N 跳传播)</span></template>
      <el-form :model="riskForm" label-width="120px" size="small" inline>
        <el-form-item label="根企业 ID">
          <el-input v-model="riskForm.rootEnterpriseId" placeholder="如 E-SZ-KC" style="width: 180px" />
        </el-form-item>
        <el-form-item label="传播跳数 N">
          <el-input-number v-model="riskForm.hops" :min="1" :max="5" controls-position="right" style="width: 120px" />
        </el-form-item>
        <el-form-item label="违约金额(元)">
          <el-input-number v-model="riskForm.shockAmountYuan" :min="0" :step="1000000" controls-position="right" style="width: 200px" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="scfStore.loading" @click="runRiskPropagation">模拟风险扩散</el-button>
        </el-form-item>
      </el-form>
      <div v-if="riskPropagationResult">
        <el-row :gutter="12" class="risk-summary">
          <el-col :span="6"><div class="stat-block"><div class="stat-num text-danger">{{ formatAmount(Math.round(riskPropagationResult.totalLoss / 100)) }}</div><div class="stat-label">总预计损失(元)</div></div></el-col>
          <el-col :span="6"><div class="stat-block"><div class="stat-num">{{ formatAmount(Math.round(riskPropagationResult.totalExposure / 100)) }}</div><div class="stat-label">总影响金额(元)</div></div></el-col>
          <el-col :span="6"><div class="stat-block"><div class="stat-num">{{ riskPropagationResult.affectedCount }}</div><div class="stat-label">受影响企业数</div></div></el-col>
          <el-col :span="6"><div class="stat-block"><div class="stat-num">{{ riskPropagationResult.hops }}</div><div class="stat-label">传播跳数</div></div></el-col>
        </el-row>
        <el-table :data="riskPropagationResult.propagationTree" size="small" stripe border>
          <el-table-column label="跳数" width="70"><template #default="{ row }">{{ row.hop === 0 ? '根' : row.hop }}</template></el-table-column>
          <el-table-column prop="enterpriseName" label="企业" min-width="180" />
          <el-table-column label="方向" width="90"><template #default="{ row }">
            <el-tag size="small" :type="row.direction === 'upstream' ? 'warning' : 'success'">{{ row.direction === 'upstream' ? '上游' : '下游' }}</el-tag>
          </template></el-table-column>
          <el-table-column prop="relationType" label="关联类型" min-width="140" />
          <el-table-column label="影响金额(元)" width="150"><template #default="{ row }">¥{{ formatAmount(Math.round(row.exposureAmount / 100)) }}</template></el-table-column>
          <el-table-column label="预计损失(元)" width="150"><template #default="{ row }"><span class="text-danger">¥{{ formatAmount(Math.round(row.lossGivenDefault / 100)) }}</span></template></el-table-column>
          <el-table-column label="传播比例" width="100"><template #default="{ row }">{{ (row.propagationRatio * 100).toFixed(1) }}%</template></el-table-column>
          <el-table-column label="严重度" width="100"><template #default="{ row }">
            <el-tag size="small" :type="severityType(row.severity)">{{ severityLabel(row.severity) }}</el-tag>
          </template></el-table-column>
        </el-table>
      </div>
    </el-card>

    <!-- SC8 撮合结果 -->
    <el-card shadow="never" class="mt-16">
      <template #header><span>SC8 撮合结果 (企业融资需求 ↔ 银行资金供给, top-3 候选)</span></template>
      <el-form :model="matchForm" label-width="120px" size="small" inline>
        <el-form-item label="企业 ID">
          <el-input v-model="matchForm.enterpriseId" placeholder="如 E-SZ-KC" style="width: 160px" />
        </el-form-item>
        <el-form-item label="信用评分">
          <el-input-number v-model="matchForm.creditScore" :min="0" :max="100" controls-position="right" style="width: 120px" />
        </el-form-item>
        <el-form-item label="融资金额(元)">
          <el-input-number v-model="matchForm.loanAmountYuan" :min="0" :step="100000" controls-position="right" style="width: 180px" />
        </el-form-item>
        <el-form-item label="期限(月)">
          <el-input-number v-model="matchForm.termMonths" :min="1" :max="120" controls-position="right" style="width: 120px" />
        </el-form-item>
        <el-form-item label="担保偏好">
          <el-select v-model="matchForm.guaranteePreference" style="width: 160px">
            <el-option v-for="opt in guaranteeOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="行业">
          <el-select v-model="matchForm.industry" style="width: 160px">
            <el-option v-for="opt in industryOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="scfStore.loading" @click="runMatch">撮合 top-3</el-button>
        </el-form-item>
      </el-form>
      <div v-if="matchResults && matchResults.candidates.length">
        <el-row :gutter="12">
          <el-col v-for="(c, idx) in matchResults.candidates" :key="c.bankId" :span="8" class="candidate-col">
            <el-card shadow="hover" :body-style="{ padding: '14px' }" class="candidate-card">
              <div class="candidate-rank">第 {{ idx + 1 }} 候选</div>
              <div class="candidate-bank">{{ c.bankName }}</div>
              <div class="muted candidate-product">{{ c.bankProduct }}</div>
              <el-descriptions :column="1" size="small" border class="candidate-desc">
                <el-descriptions-item label="核准额度">¥{{ formatAmount(Math.round(c.approvedAmount / 100)) }}</el-descriptions-item>
                <el-descriptions-item label="核准利率"><span class="text-primary">{{ c.approvedRate }}%</span></el-descriptions-item>
                <el-descriptions-item label="期限">{{ c.termMonths }} 月</el-descriptions-item>
                <el-descriptions-item label="置信度">
                  <el-progress :percentage="Math.round(c.confidence * 100)" :stroke-width="10" :status="confidenceStatus(c.confidence)" />
                </el-descriptions-item>
              </el-descriptions>
              <div v-if="c.matchReasons?.length" class="reason-list">
                <div v-for="r in c.matchReasons" :key="r" class="reason-item text-success">✓ {{ r }}</div>
              </div>
              <div v-if="c.mismatches?.length" class="reason-list">
                <div v-for="m in c.mismatches" :key="m" class="reason-item text-warning">△ {{ m }}</div>
              </div>
            </el-card>
          </el-col>
        </el-row>
      </div>
      <el-empty v-else-if="matchResults" description="无满足置信度阈值的候选银行" />
    </el-card>

    <!-- SC9 履约监控告警 -->
    <el-card shadow="never" class="mt-16">
      <template #header>
        <div class="card-header-flex">
          <span>SC9 履约监控告警 (还款/发货/收货/交付)</span>
          <el-button v-if="alerts" size="small" @click="loadAlerts">刷新</el-button>
        </div>
      </template>
      <div v-if="alerts">
        <el-row :gutter="8" class="alert-summary">
          <el-col :span="6"><div class="stat-block"><div class="stat-num text-success">{{ alerts.summary.greenCount }}</div><div class="stat-label">绿灯 (正常)</div></div></el-col>
          <el-col :span="6"><div class="stat-block"><div class="stat-num text-warning">{{ alerts.summary.yellowCount }}</div><div class="stat-label">黄灯 (预警)</div></div></el-col>
          <el-col :span="6"><div class="stat-block"><div class="stat-num text-danger">{{ alerts.summary.redCount }}</div><div class="stat-label">红灯 (逾期)</div></div></el-col>
          <el-col :span="6"><div class="stat-block"><div class="stat-num text-danger">¥{{ formatAmount(Math.round(alerts.summary.totalAtRiskAmount / 100)) }}</div><div class="stat-label">风险敞口(元)</div></div></el-col>
        </el-row>
        <el-table :data="alerts.alerts" size="small" stripe border>
          <el-table-column label="信号灯" width="90">
            <template #default="{ row }">
              <span class="traffic-light" :class="`light-${row.level}`">●</span>
              <span :class="`light-text-${row.level}`">{{ lightLabel(row.level) }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="enterpriseName" label="企业" min-width="160" />
          <el-table-column label="监控类型" width="100"><template #default="{ row }">{{ monitorKindLabel(row.monitorKind) }}</template></el-table-column>
          <el-table-column prop="message" label="告警信息" min-width="240" />
          <el-table-column label="履约金额(元)" width="140"><template #default="{ row }">¥{{ formatAmount(Math.round(row.amount / 100)) }}</template></el-table-column>
          <el-table-column label="逾期天数" width="90"><template #default="{ row }">{{ row.overdueDays > 0 ? `${row.overdueDays}天` : '-' }}</template></el-table-column>
          <el-table-column label="状态" width="100"><template #default="{ row }">
            <el-tag size="small" :type="alertStatusType(row.status)">{{ alertStatusLabel(row.status) }}</el-tag>
          </template></el-table-column>
        </el-table>
      </div>
      <el-empty v-else description="暂无告警数据, 点击刷新加载" />
    </el-card>

    <!-- SC10 案例库 -->
    <el-card shadow="never" class="mt-16">
      <template #header>
        <div class="card-header-flex">
          <span>SC10 案例库 (行业/产品/规模/结果四维分类 + 关键词匹配)</span>
          <el-button size="small" @click="loadCases">刷新</el-button>
        </div>
      </template>
      <el-form :model="caseFilter" size="small" inline class="case-filter">
        <el-form-item label="行业">
          <el-select v-model="caseFilter.industry" clearable placeholder="全部" style="width: 150px">
            <el-option v-for="opt in industryOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="结果">
          <el-select v-model="caseFilter.result" clearable placeholder="全部" style="width: 120px">
            <el-option label="成功" value="success" />
            <el-option label="失败" value="failed" />
            <el-option label="部分" value="partial" />
          </el-select>
        </el-form-item>
        <el-form-item label="关键词">
          <el-input v-model="caseFilter.keyword" clearable placeholder="如 存货/反向保理/杭州" style="width: 200px" @keyup.enter="loadCases" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" size="small" @click="loadCases">检索</el-button>
        </el-form-item>
      </el-form>
      <el-table :data="cases" size="small" stripe border>
        <el-table-column prop="caseId" label="案例编号" width="160" />
        <el-table-column prop="enterpriseName" label="企业" min-width="160" />
        <el-table-column label="行业" width="100"><template #default="{ row }">{{ industryLabel(row.industry) }}</template></el-table-column>
        <el-table-column label="产品" width="120"><template #default="{ row }">{{ productLabel(row.product) }}</template></el-table-column>
        <el-table-column label="规模" width="80"><template #default="{ row }">{{ scaleLabel(row.scale) }}</template></el-table-column>
        <el-table-column label="结果" width="80"><template #default="{ row }">
          <el-tag size="small" :type="outcomeType(row.outcome)">{{ outcomeLabel(row.outcome) }}</el-tag>
        </template></el-table-column>
        <el-table-column label="融资额(元)" width="140"><template #default="{ row }">¥{{ formatAmount(Math.round(row.loanAmount / 100)) }}</template></el-table-column>
        <el-table-column label="利率" width="80"><template #default="{ row }">{{ row.finalRate }}%</template></el-table-column>
        <el-table-column label="关键学习" min-width="280"><template #default="{ row }">
          <div v-for="(l, i) in row.keyLearnings" :key="i" class="learning-item">· {{ l }}</div>
        </template></el-table-column>
      </el-table>
    </el-card>

    <!-- SCF ↔ Reform 联动 -->
    <el-card shadow="never" class="mt-16">
      <template #header><span>SCF ↔ Reform 联动 (R10 完成 → SC1 画像刷新 → SC8 撮合重算)</span></template>
      <el-form :model="syncForm" label-width="140px" size="small" inline>
        <el-form-item label="企业 ID">
          <el-input v-model="syncForm.enterpriseId" placeholder="如 E-SZ-KC" style="width: 160px" />
        </el-form-item>
        <el-form-item label="改造案例 ID">
          <el-input v-model="syncForm.reformCaseId" placeholder="如 rfm-case-001" style="width: 180px" />
        </el-form-item>
        <el-form-item label="改造结果等级">
          <el-select v-model="syncForm.afterLevel" style="width: 100px">
            <el-option label="A 级" value="A" />
            <el-option label="B 级" value="B" />
            <el-option label="C 级" value="C" />
            <el-option label="D 级" value="D" />
          </el-select>
        </el-form-item>
        <el-form-item label="改造后信用分">
          <el-input-number v-model="syncForm.afterCreditScore" :min="0" :max="100" controls-position="right" style="width: 120px" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="scfStore.loading" @click="runSyncFromReform">触发联动</el-button>
        </el-form-item>
      </el-form>
      <div v-if="lastSyncResult" class="sync-result">
        <el-alert :title="lastSyncResult.message" :type="lastSyncResult.rematchTriggered ? 'success' : 'warning'" :closable="false" show-icon />
        <el-descriptions :column="3" border size="small" class="mt-8">
          <el-descriptions-item label="画像刷新">{{ lastSyncResult.portraitRefreshed ? '✓ 已刷新' : '× 未刷新' }}</el-descriptions-item>
          <el-descriptions-item label="新信用分">{{ lastSyncResult.newCreditScore }}</el-descriptions-item>
          <el-descriptions-item label="撮合重算">{{ lastSyncResult.rematchTriggered ? `✓ 已触发 (${lastSyncResult.newCandidatesCount} 个候选)` : '× 未触发' }}</el-descriptions-item>
        </el-descriptions>
      </div>
    </el-card>

    <el-row :gutter="16" class="mt-16">
      <el-col :span="12">
        <el-card shadow="never">
          <template #header><span>黑名单</span></template>
          <el-table :data="blacklist" size="small" stripe>
            <el-table-column prop="name" label="企业" />
            <el-table-column prop="reason" label="原因" />
            <el-table-column prop="since" label="列入时间" width="120" />
          </el-table>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card shadow="never">
          <template #header><span>白名单(优质核心企业)</span></template>
          <el-table :data="whitelist" size="small" stripe>
            <el-table-column prop="name" label="企业" />
            <el-table-column prop="grade" label="信用等级" width="100" />
            <el-table-column prop="upstream" label="上游数" width="80" />
            <el-table-column prop="downstream" label="下游数" width="80" />
          </el-table>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { useScfStore } from '@/stores/scf';
import type {
  AlertsResult, CaseOutcome, CaseQuery, CaseRecord, GuaranteeMethod,
  MatchOutput, PricingOutput, ReformSyncResult, RiskPropagationOutput,
  SCFScenario, ScenarioId, ScfIndustry,
} from '@/api/scf';

const scfStore = useScfStore();

// === 引擎族状态 (静态展示) ===
const scEngines = ref([
  { id: 'SC1', name: '画像引擎', desc: '13 维企业画像', status: 'ready' },
  { id: 'SC2', name: '关系图谱引擎', desc: '上下游+实控人穿透', status: 'ready' },
  { id: 'SC3', name: '应收账款引擎', desc: 'AR 确权+转让', status: 'ready' },
  { id: 'SC4', name: '存货融资引擎', desc: '押品估值+IoT 监管', status: 'ready' },
  { id: 'SC5', name: '票据引擎', desc: '汇票贴现+背书链', status: 'ready' },
  { id: 'SC6', name: '定价引擎', desc: 'LPR+风险溢价-担保抵扣', status: 'ready' },
  { id: 'SC7', name: '风险传导引擎', desc: '上下游风险穿透', status: 'ready' },
  { id: 'SC8', name: '撮合引擎', desc: '企业↔银行 top-3 匹配', status: 'ready' },
  { id: 'SC9', name: '履约监控引擎', desc: '红黄绿灯告警', status: 'ready' },
  { id: 'SC10', name: '案例学习引擎', desc: '四维分类+相似度', status: 'ready' },
]);

// === 13 维雷达 + 关系图谱 (静态) ===
const radarOption = ref({
  tooltip: {},
  radar: {
    indicator: [
      { name: '信用', max: 100 }, { name: '经营', max: 100 }, { name: '财务', max: 100 },
      { name: '供应链地位', max: 100 }, { name: '应收质量', max: 100 }, { name: '存货周转', max: 100 },
      { name: '票据质量', max: 100 }, { name: '上下游稳定', max: 100 }, { name: '实控人', max: 100 },
      { name: '合规', max: 100 }, { name: 'ESG', max: 100 }, { name: '行业前景', max: 100 },
      { name: '政策匹配', max: 100 },
    ],
  },
  series: [{
    type: 'radar', data: [
      { value: [88, 82, 76, 90, 85, 72, 80, 88, 75, 92, 68, 82, 86], name: '深圳科创电子' },
      { value: [72, 78, 68, 65, 70, 75, 62, 70, 80, 76, 60, 72, 78], name: '杭州智造机械' },
    ],
  }],
});

const graphOption = ref({
  tooltip: {},
  series: [{
    type: 'graph', layout: 'force', roam: true,
    force: { repulsion: 200 },
    data: [
      { name: '深圳科创电子', symbolSize: 40, category: 0 },
      { name: '上游A-晶圆厂', symbolSize: 20, category: 1 },
      { name: '上游B-封测', symbolSize: 20, category: 1 },
      { name: '下游C-品牌商', symbolSize: 25, category: 2 },
      { name: '下游D-分销', symbolSize: 18, category: 2 },
      { name: '实控人-张某', symbolSize: 22, category: 3 },
    ],
    links: [
      { source: '深圳科创电子', target: '上游A-晶圆厂' },
      { source: '深圳科创电子', target: '上游B-封测' },
      { source: '下游C-品牌商', target: '深圳科创电子' },
      { source: '下游D-分销', target: '深圳科创电子' },
      { source: '实控人-张某', target: '深圳科创电子' },
    ],
    categories: [{ name: '核心' }, { name: '上游' }, { name: '下游' }, { name: '实控人' }],
  }],
});

// === 5 类 SCF 产品 + 黑白名单 (静态) ===
const scfProducts = ref([
  { id: 'P1', name: '应收账款融资', scene: '上游企业凭对核心企业 AR 融资', maxAmount: 50000000, rate: 4.2, enabled: true },
  { id: 'P2', name: '预付款融资', scene: '下游经销商采购预付', maxAmount: 20000000, rate: 4.8, enabled: true },
  { id: 'P3', name: '存货融资', scene: '押品+IoT 监管', maxAmount: 30000000, rate: 5.2, enabled: true },
  { id: 'P4', name: '票据贴现', scene: '汇票贴现+背书链追溯', maxAmount: 100000000, rate: 3.8, enabled: true },
  { id: 'P5', name: '反向保理', scene: '核心企业主导付款', maxAmount: 80000000, rate: 4.0, enabled: false },
]);

const blacklist = ref([
  { name: '某某贸易', reason: '票据违约', since: '2026-05' },
  { name: '某某物流', reason: '运单造假', since: '2026-06' },
]);
const whitelist = ref([
  { name: '深圳科创电子', grade: 'A', upstream: 12, downstream: 28 },
  { name: '杭州智造机械', grade: 'B+', upstream: 8, downstream: 15 },
]);

// === 下拉选项 ===
const industryOptions = [
  { label: '高科技', value: 'high_tech' },
  { label: '制造业', value: 'manufacturing' },
  { label: '贸易', value: 'trade' },
  { label: '服务业', value: 'service' },
  { label: '农业', value: 'agriculture' },
  { label: '能源', value: 'energy' },
  { label: '物流', value: 'logistics' },
  { label: '房地产相关', value: 'real_estate_related' },
];
const guaranteeOptions = [
  { label: '信用', value: 'credit' },
  { label: '应收账款', value: 'accounts_receivable' },
  { label: '存货质押', value: 'inventory' },
  { label: '第三方担保', value: 'guarantee' },
  { label: '抵押', value: 'pledge' },
  { label: '票据背书', value: 'endorsement' },
];

// === 场景预设 (SCF-08) ===
const scenarios = ref<SCFScenario[]>([]);
const currentScenario = ref<SCFScenario | null>(null);

async function loadScenarios(): Promise<void> {
  const result = await scfStore.loadScenarios();
  scenarios.value = result;
}

async function applyScenario(scenarioId: ScenarioId): Promise<void> {
  const result = await scfStore.loadScenario(scenarioId);
  if (!result) {
    ElMessage.error('场景预设加载失败');
    return;
  }
  currentScenario.value = result;
  // 回写 prefill 到 SC6/SC7/SC8 表单
  const pre = result.prefill as Record<string, unknown>;
  if (pre.creditScore != null) pricingForm.creditScore = Number(pre.creditScore);
  if (pre.industry) pricingForm.industry = pre.industry as ScfIndustry;
  if (pre.guaranteeMethod) pricingForm.guaranteeMethod = pre.guaranteeMethod as GuaranteeMethod;
  if (pre.termMonths != null) pricingForm.termMonths = Number(pre.termMonths);
  if (pre.loanAmount != null) {
    pricingForm.loanAmountYuan = Number(pre.loanAmountYuan ?? Math.round(Number(pre.loanAmount) / 100));
    pricingForm.enterpriseId = result.defaultEnterprise;
  }
  // 同步 SC8 表单
  matchForm.enterpriseId = result.defaultEnterprise;
  matchForm.creditScore = pricingForm.creditScore;
  matchForm.loanAmountYuan = pricingForm.loanAmountYuan;
  matchForm.termMonths = pricingForm.termMonths;
  matchForm.guaranteePreference = pricingForm.guaranteeMethod;
  matchForm.industry = pricingForm.industry;
  // 同步 SC7 根企业
  riskForm.rootEnterpriseId = result.defaultEnterprise;
  ElMessage.success(`已加载场景预设: ${result.name}, 表单已自动填入`);
}

// === SC6 定价 ===
const pricingForm = reactive({
  enterpriseId: 'E-SZ-KC',
  creditScore: 88,
  industry: 'high_tech' as ScfIndustry,
  guaranteeMethod: 'accounts_receivable' as GuaranteeMethod,
  termMonths: 6,
  loanAmountYuan: 8000000,   // 元
  baseLpr: 3.45,
});
const pricingResult = ref<PricingOutput | null>(null);

async function runPricing(): Promise<void> {
  const result = await scfStore.loadPricing({
    enterpriseId: pricingForm.enterpriseId,
    creditScore: pricingForm.creditScore,
    industry: pricingForm.industry,
    guaranteeMethod: pricingForm.guaranteeMethod,
    termMonths: pricingForm.termMonths,
    loanAmount: pricingForm.loanAmountYuan * 100,  // 元 → 分
    baseLpr: pricingForm.baseLpr,
  });
  if (result) {
    pricingResult.value = result;
    ElMessage.success(`SC6 定价完成: 综合利率 ${result.finalRate}%`);
  } else {
    ElMessage.error('SC6 定价计算失败');
  }
}

// === SC7 风险扩散 ===
const riskForm = reactive({
  rootEnterpriseId: 'E-SZ-KC',
  hops: 2,
  shockAmountYuan: 10000000,  // 元
});
const riskPropagationResult = ref<RiskPropagationOutput | null>(null);

async function runRiskPropagation(): Promise<void> {
  const result = await scfStore.loadRiskPropagation({
    rootEnterpriseId: riskForm.rootEnterpriseId,
    hops: riskForm.hops,
    shockAmount: riskForm.shockAmountYuan * 100,
  });
  if (result) {
    riskPropagationResult.value = result;
    ElMessage.success(`SC7 风险扩散完成: 影响 ${result.affectedCount} 家企业, 总损失 ¥${formatAmount(Math.round(result.totalLoss / 100))}`);
  } else {
    ElMessage.error('SC7 风险扩散失败');
  }
}

// === SC8 撮合 ===
const matchForm = reactive({
  enterpriseId: 'E-SZ-KC',
  creditScore: 88,
  loanAmountYuan: 8000000,
  termMonths: 6,
  guaranteePreference: 'accounts_receivable' as GuaranteeMethod,
  industry: 'high_tech' as ScfIndustry,
});
const matchResults = ref<MatchOutput | null>(null);

async function runMatch(): Promise<void> {
  const result = await scfStore.loadMatch({
    enterpriseId: matchForm.enterpriseId,
    creditScore: matchForm.creditScore,
    loanAmount: matchForm.loanAmountYuan * 100,
    termMonths: matchForm.termMonths,
    guaranteePreference: matchForm.guaranteePreference,
    industry: matchForm.industry,
    topK: 3,
  });
  if (result) {
    matchResults.value = result;
    ElMessage.success(`SC8 撮合完成: 返回 ${result.candidates.length} 个候选`);
  } else {
    ElMessage.error('SC8 撮合失败');
  }
}

// === SC9 履约监控 ===
const alerts = ref<AlertsResult | null>(null);
async function loadAlerts(): Promise<void> {
  const result = await scfStore.loadAlerts();
  if (result) {
    alerts.value = result;
    ElMessage.success(`SC9 加载 ${result.alerts.length} 条告警`);
  } else {
    ElMessage.error('SC9 告警加载失败');
  }
}

// === SC10 案例库 ===
const cases = ref<CaseRecord[]>([]);
const caseFilter = reactive<{ industry: ScfIndustry | ''; result: CaseOutcome | ''; keyword: string }>({
  industry: '',
  result: '',
  keyword: '',
});

async function loadCases(): Promise<void> {
  const query: CaseQuery = {};
  if (caseFilter.industry) query.industry = caseFilter.industry as ScfIndustry;
  if (caseFilter.result) query.result = caseFilter.result as CaseOutcome;
  if (caseFilter.keyword) query.keyword = caseFilter.keyword;
  const result = await scfStore.loadCases(query);
  cases.value = result;
  ElMessage.success(`SC10 检索完成: ${result.length} 条案例`);
}

// === SCF ↔ Reform 联动 ===
const syncForm = reactive({
  enterpriseId: 'E-SZ-KC',
  reformCaseId: 'rfm-case-001',
  afterLevel: 'A' as 'D' | 'C' | 'B' | 'A',
  afterCreditScore: 92,
});
const lastSyncResult = ref<ReformSyncResult | null>(null);

async function runSyncFromReform(): Promise<void> {
  const result = await scfStore.syncFromReform({
    enterpriseId: syncForm.enterpriseId,
    reformCaseId: syncForm.reformCaseId,
    reformOutcome: 'success',
    afterLevel: syncForm.afterLevel,
    afterCreditScore: syncForm.afterCreditScore,
    completedAt: new Date().toISOString(),
  });
  if (result) {
    lastSyncResult.value = result;
    ElMessage.success('SCF↔Reform 联动成功: SC1 画像已刷新, SC8 撮合已重算');
  } else {
    ElMessage.error('SCF↔Reform 联动失败');
  }
}

// === 标签辅助函数 ===
function formatAmount(amt: number): string { return (amt ?? 0).toLocaleString('zh-CN'); }

function industryLabel(v: string): string {
  return industryOptions.find((o) => o.value === v)?.label ?? v;
}
function guaranteeLabel(v: string): string {
  return guaranteeOptions.find((o) => o.value === v)?.label ?? v;
}
function productLabel(v: string): string {
  const m: Record<string, string> = {
    accounts_receivable_financing: '应收账款融资',
    prepayment_financing: '预付款融资',
    inventory_financing: '存货融资',
    bill_discount: '票据贴现',
    reverse_factoring: '反向保理',
  };
  return m[v] ?? v;
}
function scaleLabel(v: string): string {
  const m: Record<string, string> = { micro: '微型', small: '小型', medium: '中型', large: '大型' };
  return m[v] ?? v;
}
function outcomeLabel(v: string): string {
  return { success: '成功', failed: '失败', partial: '部分' }[v] ?? v;
}
function outcomeType(v: string): 'success' | 'danger' | 'warning' {
  const m: Record<string, 'success' | 'danger' | 'warning'> = {
    success: 'success', failed: 'danger', partial: 'warning',
  };
  return m[v] ?? 'warning';
}
function lightLabel(v: string): string {
  return { green: '绿灯', yellow: '黄灯', red: '红灯' }[v] ?? v;
}
function monitorKindLabel(v: string): string {
  return { repayment: '还款', shipment: '发货', receipt: '收货', delivery: '交付' }[v] ?? v;
}
function alertStatusLabel(v: string): string {
  return { normal: '正常', warning: '预警', overdue: '逾期', defaulted: '违约', completed: '已结清' }[v] ?? v;
}
function alertStatusType(v: string): 'success' | 'warning' | 'danger' | 'info' {
  const m: Record<string, 'success' | 'warning' | 'danger' | 'info'> = {
    normal: 'success', warning: 'warning', overdue: 'danger', defaulted: 'danger', completed: 'info',
  };
  return m[v] ?? 'info';
}
function severityLabel(v: string): string {
  return { low: '低', medium: '中', high: '高', critical: '严重' }[v] ?? v;
}
function severityType(v: string): 'success' | 'info' | 'warning' | 'danger' {
  const m: Record<string, 'success' | 'info' | 'warning' | 'danger'> = {
    low: 'success', medium: 'info', high: 'warning', critical: 'danger',
  };
  return m[v] ?? 'info';
}
function confidenceStatus(c: number): 'success' | 'warning' | 'exception' {
  if (c >= 0.8) return 'success';
  if (c >= 0.6) return 'warning';
  return 'exception';
}

onMounted(() => {
  loadScenarios();
  loadAlerts();
  loadCases();
});
</script>

<style scoped lang="scss">
.mt-16 { margin-top: 16px; }
.mt-8 { margin-top: 8px; }
.muted { color: var(--el-text-color-secondary); font-size: 12px; }
.engine-col { margin-bottom: 12px; }
.engine-head { display: flex; justify-content: space-between; align-items: center; }
.engine-id { font-family: monospace; color: var(--el-color-primary); font-weight: 600; }
.engine-name { font-weight: 600; margin: 4px 0; }

.card-header-flex {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

/* 场景预设 */
.scenario-card { .scenario-col { margin-bottom: 8px; } }
.scenario-btn {
  width: 100%;
  height: 64px;
  text-align: left;
  padding: 8px 12px;
  .scenario-btn-inner { line-height: 1.4; }
  .scenario-btn-title { font-weight: 600; font-size: 14px; }
  .scenario-btn-desc { font-size: 12px; opacity: 0.75; margin-top: 2px; }
}
.scenario-detail { margin-top: 12px; }
.scenario-prefill {
  margin-top: 8px;
  padding: 8px 12px;
  background: var(--el-fill-color-light);
  border-radius: 4px;
  font-size: 13px;
  color: var(--el-text-color-regular);
  b { color: var(--el-color-primary); }
}

/* 定价结果 */
.pricing-result { margin-top: 12px; }
.big { font-size: 18px; font-weight: 700; }
.text-primary { color: var(--el-color-primary); font-weight: 600; }
.text-success { color: var(--el-color-success); }
.text-warning { color: var(--el-color-warning); }
.text-danger { color: var(--el-color-danger); font-weight: 600; }

/* 风险扩散 */
.risk-summary { margin-bottom: 12px; }
.stat-block {
  text-align: center;
  padding: 10px;
  background: var(--el-fill-color-light);
  border-radius: 4px;
  .stat-num { font-size: 18px; font-weight: 700; }
  .stat-label { font-size: 12px; color: var(--el-text-color-secondary); margin-top: 2px; }
}

/* SC8 撮合候选 */
.candidate-col { margin-bottom: 12px; }
.candidate-card { height: 100%; }
.candidate-rank {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.candidate-bank { font-weight: 700; font-size: 15px; margin: 2px 0; color: var(--el-color-primary); }
.candidate-product { margin-bottom: 6px; }
.candidate-desc { margin-bottom: 6px; }
.reason-list { margin-top: 6px; }
.reason-item { font-size: 12px; line-height: 1.6; }

/* SC9 红绿灯 */
.alert-summary { margin-bottom: 12px; }
.traffic-light { font-size: 16px; margin-right: 4px; }
.light-green { color: var(--el-color-success); }
.light-yellow { color: var(--el-color-warning); }
.light-red { color: var(--el-color-danger); }
.light-text-green { color: var(--el-color-success); font-weight: 600; }
.light-text-yellow { color: var(--el-color-warning); font-weight: 600; }
.light-text-red { color: var(--el-color-danger); font-weight: 600; }

/* 案例库 */
.case-filter { margin-bottom: 8px; }
.learning-item { font-size: 12px; line-height: 1.6; color: var(--el-text-color-regular); }

/* SCF↔Reform */
.sync-result { margin-top: 12px; }
</style>
