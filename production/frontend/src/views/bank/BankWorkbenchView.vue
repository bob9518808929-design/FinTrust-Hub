<!--
  BankWorkbenchView.vue — CORE-01b 银行信任培育期渐进解锁工作台

  四阶段渐进解锁:
    L4_READONLY    培育期 (0-6 月)   AI 仅生成《风险提示函》零拦截
    L3_ADVISORY    验证期 (6-12 月)  AI 可发"建议拦截", 仍需人工确认
    L2_SMALL_AUTO  信任期 (12-24 月) AI 自动放行 <50 万, 大额仍需人工
    L1_FULL_AUTO   深度信任期 (24+ 月) AI 全自动决策, 仅事后审计

  布局:
    顶部:  当前信任阶段卡片 (4 阶段进度条, 当前阶段高亮, 显示下一阶段解锁进度)
           右侧操作按钮: 生成风险提示函 / 提交决策 / 升级信任阶段
    中部左: 风险提示函列表 (按企业筛选, 显示风险等级 + 摘要 + 时间)
    中部右: 决策日志 (AI 建议 vs 银行最终决策, 自动处理标绿, 人工处理标橙)
    底部:  统计卡片 (总笔数/自动通过/人工通过/拒绝/总额)

  project_memory 硬约束:
    - L4 培育期 AI 零拦截, 仅生成风险提示函
    - L2 信任期 <50 万自动放行 (50 万元 = 50,000,000 分)
    - 暗色主题, Element Plus 组件
-->
<template>
  <div class="bank-workbench-view">
    <!-- ========== 顶部: 信任阶段进度卡片 + 操作按钮 ========== -->
    <el-card shadow="never" class="header-card">
      <div class="header-flex">
        <div class="header-left">
          <div class="header-title">
            <el-icon><OfficeBuilding /></el-icon>
            <span>银行信任培育工作台</span>
            <el-tag v-if="trustProfile" :type="stageTag(trustProfile.stage)" size="large" effect="dark">
              {{ stageShortLabel(trustProfile.stage) }}
            </el-tag>
          </div>
          <div v-if="trustProfile" class="header-meta">
            <span class="meta-item">
              <span class="meta-label">当前银行:</span>
              <el-select
                v-model="selectedBankId"
                placeholder="选择银行"
                size="default"
                class="bank-select"
                @change="onBankChange"
              >
                <el-option
                  v-for="b in banks"
                  :key="b.bankId"
                  :label="`${b.bankName} (${stageShortLabel(b.stage)})`"
                  :value="b.bankId"
                />
              </el-select>
            </span>
            <span class="meta-item">
              <span class="meta-label">接入月数:</span>
              <span class="meta-value">{{ trustProfile.joinedMonths }} 月</span>
            </span>
            <span class="meta-item">
              <span class="meta-label">累计决策:</span>
              <span class="meta-value">{{ trustProfile.totalApprovedCount }} 笔</span>
            </span>
            <span class="meta-item">
              <span class="meta-label">AI 自动处理:</span>
              <span class="meta-value text-success">{{ trustProfile.aiAutoApprovedCount }} 笔</span>
            </span>
            <span class="meta-item">
              <span class="meta-label">AI 拦截:</span>
              <span class="meta-value text-warning">{{ trustProfile.aiBlockedCount }} 笔</span>
            </span>
            <span class="meta-item">
              <span class="meta-label">转化率:</span>
              <span class="meta-value">{{ formatPercent(trustProfile.conversionRate) }}</span>
            </span>
          </div>

          <!-- 4 阶段进度条 -->
          <div class="stage-progress">
            <div
              v-for="(stage, idx) in STAGE_ORDER"
              :key="stage"
              class="stage-step"
              :class="{
                'is-active': trustProfile && trustProfile.stage === stage,
                'is-passed': trustProfile && stageIndex(trustProfile.stage) > idx,
              }"
            >
              <div class="stage-circle">
                <span class="stage-no">{{ 4 - idx }}</span>
              </div>
              <div class="stage-info">
                <div class="stage-name">{{ stageShortLabel(stage) }}</div>
                <div class="stage-desc">{{ STAGE_LABELS[stage] }}</div>
              </div>
              <el-icon v-if="idx < STAGE_ORDER.length - 1" class="stage-arrow"><ArrowRight /></el-icon>
            </div>
          </div>

          <!-- 下一阶段解锁进度 -->
          <div v-if="trustProfile && trustProfile.stage !== 'L1_FULL_AUTO'" class="unlock-progress">
            <span class="unlock-label">下一阶段解锁进度:</span>
            <el-progress
              :percentage="Math.round(trustProfile.nextStageUnlockProgress * 100)"
              :stroke-width="14"
              :color="unlockColor(trustProfile.nextStageUnlockProgress)"
              class="unlock-bar"
            >
              <span class="unlock-text">{{ formatPercent(trustProfile.nextStageUnlockProgress) }}</span>
            </el-progress>
            <el-tooltip :content="trustProfile.stageDescription" placement="top">
              <el-icon class="unlock-help"><InfoFilled /></el-icon>
            </el-tooltip>
          </div>
          <div v-else class="unlock-progress">
            <el-tag type="success" effect="dark" size="large">已达到最高信任阶段 (深度信任期全自动)</el-tag>
          </div>
        </div>

        <!-- 右侧操作按钮 -->
        <div class="header-actions">
          <el-button type="primary" :icon="DocumentAdd" @click="openLetterDialog">
            生成风险提示函
          </el-button>
          <el-button type="warning" :icon="Promotion" @click="openDecisionDialog">
            提交决策
          </el-button>
          <el-button type="success" :icon="TopRight" @click="openUpgradeDialog">
            升级信任阶段
          </el-button>
        </div>
      </div>
    </el-card>

    <!-- ========== 中部: 左风险提示函 / 右决策日志 ========== -->
    <el-row :gutter="16" class="middle-row">
      <!-- 中部左: 风险提示函 -->
      <el-col :span="12">
        <el-card shadow="never" class="list-card">
          <template #header>
            <div class="card-header">
              <span class="card-title">
                <el-icon><Document /></el-icon>
                风险提示函 (L4 培育期 AI 唯一输出)
              </span>
              <div class="card-filter">
                <el-input
                  v-model="letterFilterEnterprise"
                  placeholder="按企业 ID 筛选"
                  size="small"
                  clearable
                  class="filter-input"
                  @keyup.enter="applyLetterFilter"
                  @clear="applyLetterFilter"
                />
                <el-button size="small" type="primary" plain @click="applyLetterFilter">筛选</el-button>
              </div>
            </div>
          </template>

          <el-empty v-if="riskLetters.length === 0" description="暂无风险提示函" />

          <div v-else class="letter-list">
            <div
              v-for="letter in riskLetters"
              :key="letter.letterId"
              class="letter-item"
              :class="`risk-${letter.riskLevel}`"
            >
              <div class="letter-head">
                <el-tag :type="riskTagType(letter.riskLevel)" size="small" effect="dark">
                  {{ riskLabel(letter.riskLevel) }}
                </el-tag>
                <span class="letter-ent">{{ letter.enterpriseName || letter.enterpriseId }}</span>
                <span class="letter-time">{{ formatTime(letter.generatedAt) }}</span>
              </div>
              <div class="letter-summary">{{ letter.summary }}</div>
              <div v-if="letter.recommendations.length" class="letter-recs">
                <span class="rec-label">AI 建议:</span>
                <ul>
                  <li v-for="(rec, i) in letter.recommendations" :key="i">{{ rec }}</li>
                </ul>
              </div>
            </div>
          </div>
        </el-card>
      </el-col>

      <!-- 中部右: 决策日志 -->
      <el-col :span="12">
        <el-card shadow="never" class="list-card">
          <template #header>
            <div class="card-header">
              <span class="card-title">
                <el-icon><List /></el-icon>
                决策日志 (AI 建议 vs 银行最终决策)
              </span>
              <el-tag v-if="trustProfile" :type="stageTag(trustProfile.stage)" size="small" effect="plain">
                {{ stageShortLabel(trustProfile.stage) }}
              </el-tag>
            </div>
          </template>

          <el-empty v-if="decisions.length === 0" description="暂无决策记录" />

          <div v-else class="decision-list">
            <div
              v-for="dec in decisions"
              :key="dec.decisionId"
              class="decision-item"
              :class="dec.autoHandled ? 'auto-handled' : 'manual-handled'"
            >
              <div class="decision-head">
                <span class="dec-ent">{{ dec.enterpriseName || dec.enterpriseId }}</span>
                <el-tag
                  :type="dec.autoHandled ? 'success' : 'warning'"
                  size="small"
                  effect="dark"
                >
                  {{ dec.autoHandled ? 'AI 自动处理' : '人工处理' }}
                </el-tag>
              </div>
              <div class="decision-row">
                <span class="dec-label">金额:</span>
                <span class="dec-value">{{ formatAmount(dec.amount) }}</span>
                <span class="dec-label">阶段:</span>
                <el-tag size="small" :type="stageTag(dec.stage)">{{ stageShortLabel(dec.stage) }}</el-tag>
              </div>
              <div class="decision-row">
                <span class="dec-label">AI 建议:</span>
                <el-tag :type="recommendationTag(dec.aiRecommendation)" size="small">
                  {{ recommendationLabel(dec.aiRecommendation) }}
                </el-tag>
                <span class="dec-arrow">→</span>
                <span class="dec-label">银行最终:</span>
                <el-tag :type="finalDecisionTag(dec.bankFinalDecision)" size="small" effect="dark">
                  {{ finalDecisionLabel(dec.bankFinalDecision) }}
                </el-tag>
              </div>
              <div v-if="dec.reason" class="decision-reason">
                <el-icon><InfoFilled /></el-icon>
                <span>{{ dec.reason }}</span>
              </div>
              <div class="decision-time">{{ formatTime(dec.decidedAt) }}</div>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- ========== 底部: 统计卡片 ========== -->
    <el-card shadow="never" class="stats-card">
      <template #header>
        <span class="card-title">
          <el-icon><DataAnalysis /></el-icon>
          银行统计数据
        </span>
      </template>
      <el-row :gutter="16">
        <el-col :span="4">
          <div class="stat-box">
            <div class="stat-value">{{ statistics?.totalLoans ?? 0 }}</div>
            <div class="stat-label">总笔数</div>
          </div>
        </el-col>
        <el-col :span="4">
          <div class="stat-box success">
            <div class="stat-value">{{ statistics?.autoApprovedCount ?? 0 }}</div>
            <div class="stat-label">自动通过</div>
          </div>
        </el-col>
        <el-col :span="4">
          <div class="stat-box warning">
            <div class="stat-value">{{ statistics?.manualApprovedCount ?? 0 }}</div>
            <div class="stat-label">人工通过</div>
          </div>
        </el-col>
        <el-col :span="4">
          <div class="stat-box danger">
            <div class="stat-value">{{ statistics?.rejectedCount ?? 0 }}</div>
            <div class="stat-label">拒绝</div>
          </div>
        </el-col>
        <el-col :span="8">
          <div class="stat-box primary">
            <div class="stat-value">{{ formatAmount(statistics?.totalAmountCents ?? 0) }}</div>
            <div class="stat-label">总额</div>
          </div>
        </el-col>
      </el-row>
    </el-card>

    <!-- ========== APP-01 操作面板: 调整授信乘数 + 冻结/解冻监管账户 ========== -->
    <el-card shadow="never" class="ops-panel-card">
      <template #header>
        <div class="card-header">
          <span class="card-title">
            <el-icon><Operation /></el-icon>
            银行可交互操作面板
          </span>
          <el-tag size="small" type="info" effect="plain">APP-01</el-tag>
        </div>
      </template>
      <el-row :gutter="24">
        <!-- 左侧: 授信乘数调整 -->
        <el-col :span="12">
          <div class="ops-section">
            <div class="ops-section-title">
              <el-icon><ScaleToOriginal /></el-icon>
              <span>调整授信乘数</span>
              <el-tag size="small" :type="multiplierTagType(previewMultiplier)">
                {{ previewMultiplier.toFixed(2) }}x
              </el-tag>
            </div>
            <div class="ops-section-desc">
              调整乘数会影响该银行所有企业的可放款额度。乘数范围 0.5x ~ 3.0x, 步长 0.1x。
            </div>

            <div class="slider-row">
              <el-slider
                v-model="multiplierValue"
                :min="0.5"
                :max="3.0"
                :step="0.1"
                :marks="multiplierMarks"
                :format-tooltip="(v: number) => `${v.toFixed(1)}x`"
                class="multiplier-slider"
              />
            </div>

            <!-- 实时显示新授信额度 -->
            <div class="credit-preview">
              <div class="preview-row">
                <span class="preview-label">原授信额度:</span>
                <span class="preview-value">{{ formatAmount(bankStore.currentCreditLimitCents) }}</span>
              </div>
              <div class="preview-row">
                <span class="preview-label">当前乘数:</span>
                <span class="preview-value">{{ bankStore.currentMultiplier.toFixed(2) }}x</span>
              </div>
              <div class="preview-row highlight">
                <span class="preview-label">调整后新额度:</span>
                <span class="preview-value text-success">
                  {{ formatAmount(previewNewCreditLimitCents) }}
                </span>
                <el-tag v-if="deltaPercent !== 0" size="small" :type="deltaPercent > 0 ? 'success' : 'danger'">
                  {{ deltaPercent > 0 ? '+' : '' }}{{ deltaPercent.toFixed(1) }}%
                </el-tag>
              </div>
            </div>

            <el-input
              v-model="multiplierReason"
              placeholder="调整原因 (可选, 审计追溯用)"
              size="small"
              class="mt-8"
            />

            <div class="ops-actions mt-12">
              <el-button
                type="primary"
                :icon="Check"
                :loading="multiplierSubmitting"
                :disabled="!isMultiplierChanged"
                @click="submitMultiplier"
              >
                提交乘数调整
              </el-button>
              <el-button :icon="RefreshLeft" @click="resetMultiplier">重置</el-button>
            </div>
          </div>
        </el-col>

        <!-- 右侧: 监管账户冻结/解冻 -->
        <el-col :span="12">
          <div class="ops-section">
            <div class="ops-section-title">
              <el-icon><Lock /></el-icon>
              <span>监管账户冻结/解冻</span>
              <el-tag size="small" :type="frozenCount > 0 ? 'danger' : 'success'">
                冻结 {{ frozenCount }} / 总 {{ supervisionAccounts.length }}
              </el-tag>
            </div>
            <div class="ops-section-desc">
              冻结操作不可逆, 二次确认后账户无法收付资金。仅"已生效"账户可冻结, 已冻结账户可解冻。
            </div>

            <el-empty v-if="supervisionAccounts.length === 0" description="暂无监管账户" :image-size="60" />

            <div v-else class="account-list">
              <div
                v-for="acc in supervisionAccounts"
                :key="acc.accountId"
                class="account-item"
                :class="{ 'is-frozen': acc.status === 'frozen' }"
              >
                <div class="account-head">
                  <span class="account-id">{{ acc.accountId }}</span>
                  <el-tag
                    size="small"
                    :type="acc.status === 'frozen' ? 'danger' : 'success'"
                    effect="dark"
                  >
                    {{ acc.status === 'frozen' ? '已冻结' : '已生效' }}
                  </el-tag>
                </div>
                <div class="account-row">
                  <span class="account-label">企业:</span>
                  <span class="account-value">{{ acc.enterpriseName || acc.enterpriseId }}</span>
                </div>
                <div class="account-row">
                  <span class="account-label">余额:</span>
                  <span class="account-value">{{ formatAmount(acc.balanceCents) }}</span>
                </div>
                <div v-if="acc.lastOperationAt" class="account-row">
                  <span class="account-label">最近操作:</span>
                  <span class="account-value muted">{{ formatTime(acc.lastOperationAt) }}</span>
                </div>
                <div class="account-actions">
                  <el-switch
                    :model-value="acc.status === 'frozen'"
                    :active-text="'冻结'"
                    :inactive-text="'解冻'"
                    inline-prompt
                    :loading="freezeLoadingId === acc.accountId"
                    @change="(val) => onFreezeToggle(acc, val as boolean)"
                  />
                </div>
              </div>
            </div>
          </div>
        </el-col>
      </el-row>
    </el-card>

    <!-- ========== 弹窗: 生成风险提示函 ========== -->
    <el-dialog
      v-model="letterDialogVisible"
      title="生成风险提示函 (L4 培育期 AI 唯一输出)"
      width="560px"
      :close-on-click-modal="false"
    >
      <el-form :model="letterForm" label-width="100px" ref="letterFormRef" :rules="letterFormRules">
        <el-form-item label="企业 ID" prop="enterpriseId">
          <el-input v-model="letterForm.enterpriseId" placeholder="例如 E001" />
        </el-form-item>
        <el-form-item label="企业名称" prop="enterpriseName">
          <el-input v-model="letterForm.enterpriseName" placeholder="例如 深圳科创电子" />
        </el-form-item>
        <el-form-item label="风险等级" prop="riskLevel">
          <el-radio-group v-model="letterForm.riskLevel">
            <el-radio-button value="low">低风险</el-radio-button>
            <el-radio-button value="medium">中风险</el-radio-button>
            <el-radio-button value="high">高风险</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="风险摘要" prop="summary">
          <el-input
            v-model="letterForm.summary"
            type="textarea"
            :rows="3"
            placeholder="例如: 近 3 个月营收环比下滑 12%, 应收账款周转天数延长"
          />
        </el-form-item>
        <el-form-item label="AI 建议" prop="recommendations">
          <el-input
            v-model="letterForm.recommendationsText"
            type="textarea"
            :rows="3"
            placeholder="每行一条建议, 例如:&#10;建议补充 6 个月还款来源说明&#10;加强货物流水监控"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="letterDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitLetterForm">生成</el-button>
      </template>
    </el-dialog>

    <!-- ========== 弹窗: 提交决策 ========== -->
    <el-dialog
      v-model="decisionDialogVisible"
      title="提交银行决策"
      width="560px"
      :close-on-click-modal="false"
    >
      <el-alert
        v-if="trustProfile"
        :title="`当前阶段 ${stageShortLabel(trustProfile.stage)}: ${stageHint(trustProfile.stage)}`"
        :type="stageAlertType(trustProfile.stage)"
        :closable="false"
        show-icon
        class="decision-alert"
      />
      <el-form :model="decisionForm" label-width="100px" ref="decisionFormRef" :rules="decisionFormRules" class="mt-12">
        <el-form-item label="企业 ID" prop="enterpriseId">
          <el-input v-model="decisionForm.enterpriseId" placeholder="例如 E001" />
        </el-form-item>
        <el-form-item label="企业名称" prop="enterpriseName">
          <el-input v-model="decisionForm.enterpriseName" placeholder="例如 深圳科创电子" />
        </el-form-item>
        <el-form-item label="贷款金额" prop="amountYuan">
          <el-input-number
            v-model="decisionForm.amountYuan"
            :min="0"
            :step="10000"
            :max="100000000"
            controls-position="right"
            style="width: 100%"
          />
          <div class="form-tip">
            当前金额 (元): {{ decisionForm.amountYuan }} 元 ≈ {{ (decisionForm.amountYuan / 10000).toFixed(2) }} 万元
            <el-tag v-if="decisionForm.amountYuan < SMALL_AUTO_THRESHOLD_YUAN" size="small" type="success">小额</el-tag>
            <el-tag v-else size="small" type="warning">大额</el-tag>
          </div>
        </el-form-item>
        <el-form-item label="AI 建议" prop="aiRecommendation">
          <el-radio-group v-model="decisionForm.aiRecommendation">
            <el-radio-button value="approve">通过</el-radio-button>
            <el-radio-button value="review">复审</el-radio-button>
            <el-radio-button value="reject">否决</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="最终决策" prop="bankFinalDecision">
          <el-radio-group v-model="decisionForm.bankFinalDecision">
            <el-radio-button value="approve">通过</el-radio-button>
            <el-radio-button value="review">复审</el-radio-button>
            <el-radio-button value="reject">否决</el-radio-button>
            <el-radio-button value="pending">交 AI 自动</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="决策理由" prop="reason">
          <el-input v-model="decisionForm.reason" type="textarea" :rows="2" placeholder="可选, 决策理由说明" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="decisionDialogVisible = false">取消</el-button>
        <el-button type="warning" :loading="submitting" @click="submitDecisionForm">提交</el-button>
      </template>
    </el-dialog>

    <!-- ========== 弹窗: 升级信任阶段 ========== -->
    <el-dialog
      v-model="upgradeDialogVisible"
      title="升级信任阶段"
      width="520px"
      :close-on-click-modal="false"
    >
      <el-descriptions v-if="trustProfile" :column="1" border>
        <el-descriptions-item label="当前银行">{{ trustProfile.bankName }}</el-descriptions-item>
        <el-descriptions-item label="当前阶段">
          <el-tag :type="stageTag(trustProfile.stage)">{{ stageShortLabel(trustProfile.stage) }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="接入月数">{{ trustProfile.joinedMonths }} 月</el-descriptions-item>
        <el-descriptions-item label="累计决策数">{{ trustProfile.totalApprovedCount }} 笔</el-descriptions-item>
        <el-descriptions-item label="转化率">{{ formatPercent(trustProfile.conversionRate) }}</el-descriptions-item>
        <el-descriptions-item label="下一阶段解锁进度">
          {{ formatPercent(trustProfile.nextStageUnlockProgress) }}
        </el-descriptions-item>
      </el-descriptions>

      <el-alert
        v-if="trustProfile && trustProfile.nextStageUnlockProgress >= 1.0"
        type="success"
        title="阈值已达成, 可执行升级"
        :closable="false"
        show-icon
        class="mt-12"
      />
      <el-alert
        v-else-if="trustProfile"
        type="warning"
        title="阈值未达, 升级将失败 (仍可尝试, 后端将返回未达原因)"
        :closable="false"
        show-icon
        class="mt-12"
      />

      <template #footer>
        <el-button @click="upgradeDialogVisible = false">取消</el-button>
        <el-button type="success" :loading="submitting" @click="confirmUpgrade">确认升级</el-button>
      </template>
    </el-dialog>

    <!-- ========== APP-01 弹窗: 冻结/解冻账户二次确认 (阻塞模态, z-index=10000) ========== -->
    <el-dialog
      v-model="freezeConfirmVisible"
      :title="freezeConfirmTitle"
      width="520px"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      custom-class="freeze-confirm-modal"
    >
      <el-alert
        :type="pendingFreezeAction?.freeze ? 'error' : 'warning'"
        :closable="false"
        show-icon
        :title="pendingFreezeAction?.freeze ? '冻结操作不可逆' : '解冻操作'"
      >
        <template #default>
          <div v-if="pendingFreezeAction" class="freeze-alert-body">
            <p>
              即将对账户 <strong>{{ pendingFreezeAction.account.accountId }}</strong>
              (企业: {{ pendingFreezeAction.account.enterpriseName || pendingFreezeAction.account.enterpriseId }})
              执行 <strong>{{ pendingFreezeAction.freeze ? '冻结' : '解冻' }}</strong> 操作。
            </p>
            <p v-if="pendingFreezeAction.freeze" class="text-danger">
              冻结后该账户将无法收付资金, 企业融资流程的放款步骤将被阻塞。
            </p>
            <p v-else>解冻后该账户恢复正常收付, 企业融资流程可继续。</p>
          </div>
        </template>
      </el-alert>

      <el-input
        v-model="freezeReason"
        type="textarea"
        :rows="2"
        placeholder="请填写操作原因 (审计追溯用, 不可空)"
        class="mt-12"
      />

      <template #footer>
        <el-button @click="cancelFreeze">取消</el-button>
        <el-button
          :type="pendingFreezeAction?.freeze ? 'danger' : 'warning'"
          :loading="freezeSubmitting"
          :disabled="!freezeReason.trim()"
          @click="confirmFreeze"
        >
          {{ pendingFreezeAction?.freeze ? '确认冻结 (不可逆)' : '确认解冻' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import {
  DocumentAdd, Promotion, TopRight, Document, List,
  DataAnalysis, OfficeBuilding, ArrowRight, InfoFilled,
  Operation, ScaleToOriginal, Lock, Check, RefreshLeft,
} from '@element-plus/icons-vue';
import {
  useBankStore, STAGE_ORDER, STAGE_LABELS, STAGE_SHORT_LABELS,
} from '@/stores/bank';
import type {
  BankTrustStage, RiskLevel, AiRecommendation, BankFinalDecision,
  SupervisionAccount,
} from '@/api/bank';

defineOptions({ name: 'BankWorkbenchView' });

const bankStore = useBankStore();

// === 派生状态 ===
const banks = computed(() => bankStore.banks);
const trustProfile = computed(() => bankStore.trustProfile);
const riskLetters = computed(() => bankStore.riskLetters);
const decisions = computed(() => bankStore.decisions);
const statistics = computed(() => bankStore.statistics);
const supervisionAccounts = computed(() => bankStore.supervisionAccounts);

// === 阈值常量 ===
// 50 万元 = 50,000,000 分 (后端阈值)
const SMALL_AUTO_THRESHOLD_YUAN = 500000; // 50 万 元

// === 银行选择 ===
const selectedBankId = ref<string | null>(bankStore.currentBankId);

async function onBankChange(bankId: string | null): Promise<void> {
  if (!bankId) return;
  await bankStore.switchBank(bankId);
  await bankStore.loadAll(bankId);
}

// === 风险提示函筛选 ===
const letterFilterEnterprise = ref<string>('');
async function applyLetterFilter(): Promise<void> {
  const ent = letterFilterEnterprise.value.trim() || undefined;
  bankStore.setLetterEnterpriseFilter(ent);
  await bankStore.fetchRiskLetters();
}

// === 弹窗: 生成风险提示函 ===
const letterDialogVisible = ref(false);
const letterFormRef = ref<FormInstance>();
const submitting = ref(false);
const letterForm = reactive({
  enterpriseId: '',
  enterpriseName: '',
  riskLevel: 'medium' as RiskLevel,
  summary: '',
  recommendationsText: '',
});
const letterFormRules: FormRules = {
  enterpriseId: [{ required: true, message: '请输入企业 ID', trigger: 'blur' }],
  riskLevel: [{ required: true, message: '请选择风险等级', trigger: 'change' }],
  summary: [{ required: true, message: '请输入风险摘要', trigger: 'blur' }],
};

function openLetterDialog(): void {
  letterForm.enterpriseId = '';
  letterForm.enterpriseName = '';
  letterForm.riskLevel = 'medium';
  letterForm.summary = '';
  letterForm.recommendationsText = '';
  letterDialogVisible.value = true;
}

async function submitLetterForm(): Promise<void> {
  if (!letterFormRef.value) return;
  await letterFormRef.value.validate(async (valid) => {
    if (!valid) return;
    if (!bankStore.currentBankId) {
      ElMessage.warning('请先选择银行');
      return;
    }
    submitting.value = true;
    const recommendations = letterForm.recommendationsText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    const letter = await bankStore.generateRiskLetter({
      enterpriseId: letterForm.enterpriseId,
      enterpriseName: letterForm.enterpriseName,
      riskLevel: letterForm.riskLevel,
      summary: letterForm.summary,
      recommendations,
    });
    submitting.value = false;
    if (letter) {
      ElMessage.success('风险提示函已生成');
      letterDialogVisible.value = false;
    }
  });
}

// === 弹窗: 提交决策 ===
const decisionDialogVisible = ref(false);
const decisionFormRef = ref<FormInstance>();
const decisionForm = reactive({
  enterpriseId: '',
  enterpriseName: '',
  amountYuan: 100000,
  aiRecommendation: 'approve' as AiRecommendation,
  bankFinalDecision: 'approve' as BankFinalDecision,
  reason: '',
});
const decisionFormRules: FormRules = {
  enterpriseId: [{ required: true, message: '请输入企业 ID', trigger: 'blur' }],
  aiRecommendation: [{ required: true, message: '请选择 AI 建议', trigger: 'change' }],
};

function openDecisionDialog(): void {
  decisionForm.enterpriseId = '';
  decisionForm.enterpriseName = '';
  decisionForm.amountYuan = 100000;
  decisionForm.aiRecommendation = 'approve';
  decisionForm.bankFinalDecision = 'approve';
  decisionForm.reason = '';
  decisionDialogVisible.value = true;
}

async function submitDecisionForm(): Promise<void> {
  if (!decisionFormRef.value) return;
  await decisionFormRef.value.validate(async (valid) => {
    if (!valid) return;
    if (!bankStore.currentBankId) {
      ElMessage.warning('请先选择银行');
      return;
    }
    submitting.value = true;
    // 元转分 (1 元 = 100 分)
    const amountCents = Math.round(decisionForm.amountYuan * 100);
    const decision = await bankStore.submitDecision({
      enterpriseId: decisionForm.enterpriseId,
      enterpriseName: decisionForm.enterpriseName,
      amount: amountCents,
      aiRecommendation: decisionForm.aiRecommendation,
      bankFinalDecision: decisionForm.bankFinalDecision,
      reason: decisionForm.reason,
    });
    submitting.value = false;
    if (decision) {
      const handledMsg = decision.autoHandled
        ? 'AI 已自动处理'
        : '已转人工处理';
      ElMessage.success(`决策已提交, ${handledMsg}`);
      decisionDialogVisible.value = false;
      // 同步刷新统计
      await bankStore.fetchStatistics();
      await bankStore.fetchTrustProfile();
    }
  });
}

// === 弹窗: 升级信任阶段 ===
const upgradeDialogVisible = ref(false);

function openUpgradeDialog(): void {
  if (!trustProfile.value) {
    ElMessage.warning('请先选择银行');
    return;
  }
  upgradeDialogVisible.value = true;
}

async function confirmUpgrade(): Promise<void> {
  if (!bankStore.currentBankId) return;
  submitting.value = true;
  const result = await bankStore.upgradeStage();
  submitting.value = false;
  if (!result) return;
  upgradeDialogVisible.value = false;
  if (result.upgraded) {
    ElMessage.success(result.reason);
  } else {
    ElMessageBox.alert(
      `升级未成功: ${result.reason}`,
      '阈值未达',
      { type: 'warning', confirmButtonText: '我知道了' },
    );
  }
}

// === 格式化辅助 ===
function formatAmount(cents: number): string {
  // 分 → 元
  const yuan = cents / 100;
  if (yuan >= 10000) {
    return `${(yuan / 10000).toFixed(2)} 万元`;
  }
  return `${yuan.toFixed(2)} 元`;
}

function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

function formatTime(iso: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', { hour12: false });
  } catch {
    return iso;
  }
}

// === 阶段标签 ===
function stageShortLabel(stage: BankTrustStage): string {
  return STAGE_SHORT_LABELS[stage] ?? stage;
}

function stageIndex(stage: BankTrustStage): number {
  return STAGE_ORDER.indexOf(stage);
}

function stageTag(stage: BankTrustStage): 'danger' | 'warning' | 'primary' | 'success' {
  const map = {
    L4_READONLY: 'danger',
    L3_ADVISORY: 'warning',
    L2_SMALL_AUTO: 'primary',
    L1_FULL_AUTO: 'success',
  } as const;
  return map[stage];
}

function stageAlertType(stage: BankTrustStage): 'error' | 'warning' | 'info' | 'success' {
  const map = {
    L4_READONLY: 'error',
    L3_ADVISORY: 'warning',
    L2_SMALL_AUTO: 'info',
    L1_FULL_AUTO: 'success',
  } as const;
  return map[stage];
}

function stageHint(stage: BankTrustStage): string {
  const map = {
    L4_READONLY: '培育期 AI 零拦截, 决策必须人工',
    L3_ADVISORY: '验证期 AI 建议仍需人工确认',
    L2_SMALL_AUTO: '信任期 <50 万自动放行, 大额仍需人工',
    L1_FULL_AUTO: '深度信任期 AI 全自动决策',
  } as const;
  return map[stage];
}

function unlockColor(progress: number): string {
  if (progress >= 1.0) return '#10b981';
  if (progress >= 0.7) return '#3b82f6';
  if (progress >= 0.4) return '#f59e0b';
  return '#ef4444';
}

// === 风险等级标签 ===
function riskLabel(level: RiskLevel): string {
  const map = { low: '低风险', medium: '中风险', high: '高风险' } as const;
  return map[level];
}

function riskTagType(level: RiskLevel): 'success' | 'warning' | 'danger' {
  const map = { low: 'success', medium: 'warning', high: 'danger' } as const;
  return map[level];
}

// === 决策标签 ===
function recommendationLabel(rec: AiRecommendation): string {
  const map = { approve: '通过', review: '复审', reject: '否决' } as const;
  return map[rec];
}

function recommendationTag(rec: AiRecommendation): 'success' | 'warning' | 'danger' {
  const map = { approve: 'success', review: 'warning', reject: 'danger' } as const;
  return map[rec];
}

function finalDecisionLabel(dec: BankFinalDecision): string {
  const map = { approve: '通过', review: '复审', reject: '否决', pending: '交 AI 自动' } as const;
  return map[dec];
}

function finalDecisionTag(dec: BankFinalDecision): 'success' | 'warning' | 'danger' | 'info' {
  const map = { approve: 'success', review: 'warning', reject: 'danger', pending: 'info' } as const;
  return map[dec];
}

// === APP-01 操作面板: 调整授信乘数 ===
const multiplierValue = ref<number>(bankStore.currentMultiplier || 1.0);
const multiplierReason = ref<string>('');
const multiplierSubmitting = ref(false);

// 切换银行/乘数变化时同步 slider
watch(
  () => bankStore.currentMultiplier,
  (v) => {
    multiplierValue.value = v || 1.0;
  },
);

const multiplierMarks: Record<number, string> = {
  0.5: '0.5x',
  1.0: '1.0x',
  1.5: '1.5x',
  2.0: '2.0x',
  3.0: '3.0x',
};

const previewMultiplier = computed(() => multiplierValue.value);
const isMultiplierChanged = computed(
  () => Math.abs(multiplierValue.value - bankStore.currentMultiplier) >= 0.05,
);

/** 预览调整后新授信额度 (按比例换算, 实际值由后端返回) */
const previewNewCreditLimitCents = computed(() => {
  const base = bankStore.currentCreditLimitCents;
  if (base <= 0) return 0;
  // 当前乘数为 0 时退化为 1.0 基准
  const current = bankStore.currentMultiplier || 1.0;
  return Math.round((base / current) * multiplierValue.value);
});

const deltaPercent = computed(() => {
  const base = bankStore.currentCreditLimitCents;
  if (base <= 0) return 0;
  return ((previewNewCreditLimitCents.value - base) / base) * 100;
});

function multiplierTagType(v: number): 'success' | 'warning' | 'danger' | 'primary' {
  if (v >= 2.0) return 'success';
  if (v >= 1.0) return 'primary';
  if (v >= 0.7) return 'warning';
  return 'danger';
}

function resetMultiplier(): void {
  multiplierValue.value = bankStore.currentMultiplier || 1.0;
  multiplierReason.value = '';
}

async function submitMultiplier(): Promise<void> {
  if (!bankStore.currentBankId) {
    ElMessage.warning('请先选择银行');
    return;
  }
  if (!isMultiplierChanged.value) {
    ElMessage.info('乘数未变化, 无需提交');
    return;
  }
  multiplierSubmitting.value = true;
  const result = await bankStore.adjustCreditMultiplier({
    multiplier: Number(multiplierValue.value.toFixed(2)),
    reason: multiplierReason.value.trim() || undefined,
  });
  multiplierSubmitting.value = false;
  if (result) {
    ElMessage.success(
      `授信乘数已调整为 ${result.multiplier.toFixed(2)}x, 新额度 ${formatAmount(result.newCreditLimitCents)}`,
    );
    multiplierReason.value = '';
  }
}

// === APP-01 操作面板: 冻结/解冻监管账户 (阻塞模态二次确认) ===
interface PendingFreezeAction {
  account: SupervisionAccount;
  freeze: boolean;
}

const freezeConfirmVisible = ref(false);
const pendingFreezeAction = ref<PendingFreezeAction | null>(null);
const freezeReason = ref<string>('');
const freezeSubmitting = ref(false);
const freezeLoadingId = ref<string>('');

const frozenCount = computed(
  () => supervisionAccounts.value.filter((a) => a.status === 'frozen').length,
);

const freezeConfirmTitle = computed(() => {
  if (!pendingFreezeAction.value) return '账户操作确认';
  return pendingFreezeAction.value.freeze
    ? `确认冻结账户 ${pendingFreezeAction.value.account.accountId}`
    : `确认解冻账户 ${pendingFreezeAction.value.account.accountId}`;
});

/** Switch 变化触发: 打开阻塞模态二次确认 */
function onFreezeToggle(acc: SupervisionAccount, wantFreeze: boolean): void {
  // 已是该状态, 阻止重复操作
  if (acc.status === 'frozen' && wantFreeze) {
    ElMessage.info('该账户已冻结, 无需重复操作');
    return;
  }
  if (acc.status === 'active' && !wantFreeze) {
    ElMessage.info('该账户未冻结, 无需重复操作');
    return;
  }
  pendingFreezeAction.value = { account: acc, freeze: wantFreeze };
  freezeReason.value = '';
  freezeConfirmVisible.value = true;
}

function cancelFreeze(): void {
  freezeConfirmVisible.value = false;
  pendingFreezeAction.value = null;
  freezeReason.value = '';
  freezeLoadingId.value = '';
}

async function confirmFreeze(): Promise<void> {
  const action = pendingFreezeAction.value;
  if (!action) return;
  if (!freezeReason.value.trim()) {
    ElMessage.warning('请填写操作原因');
    return;
  }
  freezeSubmitting.value = true;
  freezeLoadingId.value = action.account.accountId;
  const result = await bankStore.freezeAccount(action.account.accountId, {
    freeze: action.freeze,
    reason: freezeReason.value.trim(),
  });
  freezeSubmitting.value = false;
  freezeLoadingId.value = '';
  if (result) {
    ElMessage.success(
      action.freeze
        ? `账户 ${result.accountId} 已冻结`
        : `账户 ${result.accountId} 已解冻`,
    );
    freezeConfirmVisible.value = false;
    pendingFreezeAction.value = null;
    freezeReason.value = '';
  }
}

// === 生命周期 ===
onMounted(async () => {
  await bankStore.fetchBanks();
  // 若无当前选中, 默认选第一个 (持久化恢复或新会话)
  if (!bankStore.currentBankId && banks.value.length > 0) {
    selectedBankId.value = banks.value[0]!.bankId;
    await bankStore.switchBank(selectedBankId.value);
  }
  if (bankStore.currentBankId) {
    selectedBankId.value = bankStore.currentBankId;
    await bankStore.loadAll();
  }
  // 同步 slider 初值 (后端实际乘数)
  multiplierValue.value = bankStore.currentMultiplier || 1.0;
});
</script>

<style scoped lang="scss">
// BankWorkbenchView · Deepspace AI 深色版
// Experience 366208 教训: 绝对禁止在 scoped style 里写 background:#fff / #f1f5f9 / #f9fafb 等浅色硬编码
//           所有"背景块"必须引用:
//             @use 变量 ($bg-card / $bg-tertiary / $ai-gradient-soft)
//             或 Element Plus 语义变量 (--el-fill-color-dark / --el-fill-color-darker)
@use '@/styles/variables.scss' as *;

.bank-workbench-view {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  // 让页面容器透出 body::before 的深空霓虹光晕, 而不是纯白/灰方块
  background: transparent;
  isolation: isolate;
  color: $text-primary;
}

// === 顶部信任阶段卡片 ===
.header-card {
  .header-flex {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 24px;
  }
  .header-left {
    flex: 1;
    min-width: 0;
  }
  .header-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 18px;
    font-weight: 700;
    margin-bottom: 12px;
    letter-spacing: 0.01em;
    background: $ai-gradient;
    -webkit-background-clip: text;
            background-clip: text;
    color: transparent;
    .el-icon {
      // 单独给图标保持霓虹原色 (避免被 -webkit-text-stroke 渐变 clip 吃掉)
      background: none;
      -webkit-text-fill-color: initial;
      color: $color-primary;
      filter: drop-shadow(0 0 6px rgba(56,189,248,0.35));
    }
  }
  .header-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    margin-bottom: 16px;
    font-size: 13px;
    .meta-item {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .meta-label {
      color: $text-secondary;
    }
    .meta-value {
      color: $text-primary;
      font-weight: 600;
    }
  }
  .bank-select {
    width: 240px;
  }
}

// === 4 阶段进度条 (修: --el-fill-color-dark 回退浅色 → 改为深空玻璃) ===
.stage-progress {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 12px 0;
  flex-wrap: wrap;
}
.stage-step {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 10px;
  // 修前: background: var(--el-fill-color-dark); (未定义时回退 slate-100 → 白块!)
  // 修后: 显式写死语义化深灰 + 玻璃模糊
  background: rgba(15, 23, 42, 0.55);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid $border-color;
  opacity: 0.65;
  transition: all $transition-base;

  &.is-active {
    opacity: 1;
    border-color: rgba(192, 132, 252, 0.55);
    background: linear-gradient(135deg, rgba(34,211,238,0.14), rgba(192,132,252,0.18));
    box-shadow: $shadow-glow-cyan;
  }
  &.is-passed {
    opacity: 0.9;
    border-color: rgba(16, 185, 129, 0.55);
    background: rgba(16, 185, 129, 0.12);
  }
  .stage-circle {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: linear-gradient(135deg, #818cf8, #c084fc);
    color: #0b1120;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 800;
    box-shadow: 0 0 0 1px rgba(192,132,252,0.35), 0 0 10px rgba(129,140,248,0.30);
  }
  &.is-active .stage-circle {
    background-image: $ai-gradient;
    box-shadow: $shadow-glow-cyan;
  }
  &.is-passed .stage-circle {
    background: linear-gradient(135deg, #10b981, #34d399);
    color: #022c22;
  }
  .stage-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .stage-name {
    font-size: 13px;
    font-weight: 700;
    color: $text-primary;
  }
  .stage-desc {
    font-size: 11px;
    color: $text-secondary;
  }
  .stage-arrow {
    margin-left: 4px;
    color: $text-muted;
  }
}

// === 解锁进度 ===
.unlock-progress {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
  .unlock-label {
    font-size: 13px;
    color: $text-regular;
    white-space: nowrap;
  }
  .unlock-bar {
    flex: 1;
    max-width: 480px;
  }
  .unlock-text {
    font-size: 12px;
    color: $text-primary;
    font-weight: 700;
  }
  .unlock-help {
    color: $text-secondary;
    cursor: help;
  }
}

// === 右侧操作按钮 ===
.header-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex-shrink: 0;
  .el-button {
    width: 160px;
    justify-content: flex-start;
  }
}

// === 中部行 ===
.middle-row {
  margin-top: 0;
}

// === 列表卡片 ===
.list-card {
  height: 540px;
  display: flex;
  flex-direction: column;
  :deep(.el-card__body) {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
  }
}
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  .card-title {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: 700;
    font-size: 14px;
    background: $ai-gradient;
    -webkit-background-clip: text;
            background-clip: text;
    color: transparent;
    .el-icon {
      background: none;
      -webkit-text-fill-color: initial;
      color: $color-primary;
      filter: drop-shadow(0 0 6px rgba(56,189,248,0.30));
    }
  }
  .card-filter {
    display: flex;
    gap: 6px;
    .filter-input {
      width: 160px;
    }
  }
}

// === 风险提示函列表 (修: 之前用 --el-fill-color-darker 回退浅色) ===
.letter-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.letter-item {
  padding: 12px 14px;
  border-radius: 10px;
  background: $bg-tertiary;
  border: 1px solid $border-color;
  border-left: 4px solid $color-info;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  transition: border-color $transition-base, box-shadow $transition-base, transform $transition-base;

  &:hover {
    border-color: $border-light;
    box-shadow: 0 6px 18px rgba(0,0,0,0.45);
    transform: translateY(-1px);
  }

  &.risk-low {
    border-left-color: $color-success;
    box-shadow: inset 0 0 0 1px rgba(16,185,129,0.20);
  }
  &.risk-medium {
    border-left-color: $color-warning;
    box-shadow: inset 0 0 0 1px rgba(251,191,36,0.20);
  }
  &.risk-high {
    border-left-color: $color-danger;
    box-shadow: inset 0 0 0 1px rgba(248,113,113,0.25);
  }
  .letter-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    .letter-ent {
      font-weight: 700;
      color: $text-primary;
    }
    .letter-time {
      margin-left: auto;
      font-size: 12px;
      color: $text-secondary;
    }
  }
  .letter-summary {
    font-size: 13px;
    color: $text-regular;
    margin-bottom: 6px;
    line-height: 1.6;
  }
  .letter-recs {
    font-size: 12px;
    color: $text-regular;
    .rec-label {
      color: $text-secondary;
      margin-right: 4px;
      font-weight: 600;
    }
    ul {
      margin: 4px 0 0;
      padding-left: 20px;
    }
    li {
      list-style: disc;
      line-height: 1.7;
    }
  }
}

// === 决策日志列表 (修: 之前 rgba(245,158,11,0.06) + --el-fill-color-darker 混搭漏了) ===
.decision-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.decision-item {
  padding: 12px 14px;
  border-radius: 10px;
  border-left: 4px solid $color-warning;
  background: linear-gradient(90deg, rgba(251,191,36,0.10), rgba(15,23,42,0.55) 70%);
  border: 1px solid rgba(251,191,36,0.22);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);

  &.auto-handled {
    border-left-color: $color-success;
    background: linear-gradient(90deg, rgba(16,185,129,0.10), rgba(15,23,42,0.55) 70%);
    border-color: rgba(16,185,129,0.22);
  }
  .decision-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;
    .dec-ent {
      font-weight: 700;
      color: $text-primary;
    }
  }
  .decision-row {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    font-size: 13px;
    margin-bottom: 4px;
    .dec-label {
      color: $text-secondary;
      font-weight: 500;
    }
    .dec-value {
      color: $text-primary;
      font-weight: 700;
    }
    .dec-arrow {
      color: $text-muted;
      margin: 0 4px;
    }
  }
  .decision-reason {
    display: flex;
    align-items: flex-start;
    gap: 4px;
    font-size: 12px;
    color: $text-regular;
    margin-top: 6px;
    .el-icon {
      color: $color-info;
      flex-shrink: 0;
      margin-top: 2px;
    }
  }
  .decision-time {
    font-size: 11px;
    color: $text-secondary;
    margin-top: 4px;
    text-align: right;
  }
}

// === 统计卡片 (修: --el-fill-color-darker 回退浅色 → 玻璃块) ===
.stats-card {
  .stat-box {
    padding: 16px 12px;
    border-radius: 12px;
    background: rgba(15, 23, 42, 0.55);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    text-align: center;
    border: 1px solid $border-color;
    transition: transform $transition-base, box-shadow $transition-base, border-color $transition-base;
    &:hover {
      transform: translateY(-2px);
      box-shadow: $shadow-lg;
      border-color: $border-light;
    }
    &.success {
      background: linear-gradient(135deg, rgba(16,185,129,0.16), rgba(16,185,129,0.08));
      border-color: rgba(16,185,129,0.40);
      .stat-value { color: #a7f3d0; font-weight: 800; }
    }
    &.warning {
      background: linear-gradient(135deg, rgba(251,191,36,0.16), rgba(251,191,36,0.08));
      border-color: rgba(251,191,36,0.40);
      .stat-value { color: #fde68a; font-weight: 800; }
    }
    &.danger {
      background: linear-gradient(135deg, rgba(248,113,113,0.16), rgba(248,113,113,0.08));
      border-color: rgba(248,113,113,0.42);
      .stat-value { color: #fecaca; font-weight: 800; }
    }
    &.primary {
      background: $ai-gradient-soft;
      border-color: rgba(192,132,252,0.40);
      .stat-value {
        background: $ai-gradient;
        -webkit-background-clip: text;
                background-clip: text;
        color: transparent;
        font-weight: 800;
      }
    }
    .stat-value {
      font-size: 26px;
      font-weight: 800;
      color: $text-primary;
      line-height: 1.2;
      letter-spacing: -0.01em;
    }
    .stat-label {
      font-size: 12px;
      color: $text-secondary;
      margin-top: 6px;
      letter-spacing: 0.03em;
    }
  }
}

// === 弹窗辅助 ===
.decision-alert {
  margin-bottom: 12px;
}
.mt-12 {
  margin-top: 12px;
}
.mt-8 {
  margin-top: 8px;
}
.form-tip {
  margin-top: 4px;
  font-size: 12px;
  color: $text-secondary;
  display: flex;
  align-items: center;
  gap: 6px;
}

// === APP-01 操作面板 ===
.ops-panel-card {
  .ops-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
    height: 100%;
  }
  .ops-section-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 15px;
    font-weight: 700;
    background: $ai-gradient;
    -webkit-background-clip: text;
            background-clip: text;
    color: transparent;
    letter-spacing: 0.01em;
    .el-icon {
      background: none;
      -webkit-text-fill-color: initial;
      color: $color-primary;
      filter: drop-shadow(0 0 6px rgba(56,189,248,0.30));
    }
  }
  .ops-section-desc {
    font-size: 12px;
    color: $text-secondary;
    line-height: 1.6;
  }
  .slider-row {
    padding: 10px 14px;
    // 修: 之前 --el-fill-color-darker 回退浅色
    background: rgba(15, 23, 42, 0.65);
    border: 1px solid $border-color;
    border-radius: 10px;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
  }
  .multiplier-slider {
    width: 100%;
  }
  .credit-preview {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px 14px;
    border-radius: 10px;
    // 修: 之前 --el-fill-color-darker 回退浅色
    background: rgba(15, 23, 42, 0.65);
    border: 1px solid $border-color;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    .preview-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      &.highlight {
        padding-top: 8px;
        border-top: 1px dashed $border-color;
        .preview-value {
          font-weight: 800;
          font-size: 16px;
        }
      }
    }
    .preview-label {
      color: $text-secondary;
      min-width: 100px;
    }
    .preview-value {
      color: $text-primary;
      font-weight: 700;
    }
  }
  .ops-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .account-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 320px;
    overflow-y: auto;
  }
  .account-item {
    padding: 10px 12px;
    border-radius: 10px;
    // 修: 之前 --el-fill-color-darker 回退浅色
    background: rgba(15, 23, 42, 0.65);
    border: 1px solid $border-color;
    border-left: 4px solid $color-success;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    transition: border-color $transition-base, box-shadow $transition-base;
    &:hover {
      border-color: rgba(16,185,129,0.55);
      box-shadow: 0 6px 18px rgba(0,0,0,0.45);
    }
    &.is-frozen {
      border-left-color: $color-danger;
      background: linear-gradient(90deg, rgba(239,68,68,0.12), rgba(15,23,42,0.55) 70%);
      border-color: rgba(239,68,68,0.30);
      &:hover {
        box-shadow: 0 6px 18px rgba(248,113,113,0.18);
      }
    }
    .account-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
      .account-id {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        color: $text-primary;
        background: $ai-gradient;
        -webkit-background-clip: text;
                background-clip: text;
        color: transparent;
        font-weight: 700;
        letter-spacing: 0.01em;
      }
    }
    .account-row {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      margin-bottom: 2px;
      .account-label {
        color: $text-secondary;
        min-width: 64px;
      }
      .account-value {
        color: $text-primary;
      }
      .muted {
        color: $text-secondary;
      }
    }
    .account-actions {
      margin-top: 6px;
      display: flex;
      justify-content: flex-end;
    }
  }
}

.freeze-alert-body {
  p {
    margin: 4px 0;
    font-size: 13px;
    color: $text-regular;
  }
}
</style>
