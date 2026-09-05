<template>
  <div class="reform-workbench">
    <el-alert
      v-if="!enterpriseStore.currentEnterprise"
      title="请先选择企业"
      type="warning"
      :closable="false"
      show-icon
    >
      <el-button type="primary" size="small" @click="$router.push('/enterprise')">去选择企业</el-button>
    </el-alert>

    <template v-else>
      <!-- ========== 改造全流程指引 (业务链路: 材料从哪交 → 每步去哪做, 傻瓜式) ========== -->
      <el-card class="flow-guide" shadow="never">
        <template #header>
          <div class="flow-guide-head">
            <span class="flow-guide-title">🧭 改造全流程指引 (材料 → 画像 → 改造 → 融资)</span>
            <el-tag type="success" effect="light" round>{{ flowGuide.hint }}</el-tag>
          </div>
        </template>
        <el-steps :active="flowGuide.active" align-center finish-status="success">
          <el-step v-for="(step, idx) in flowSteps" :key="step.title" :title="step.title">
            <template #description>
              <div class="flow-step-desc">
                <span>{{ step.desc }}</span>
                <!-- 当前步: 主 CTA; 非当前步: 弱入口 -->
                <template v-if="idx === flowGuide.active">
                  <el-button
                    v-if="step.path"
                    type="primary"
                    size="small"
                    round
                    class="flow-cta"
                    @click="$router.push(step.path)"
                  >{{ step.cta }} →</el-button>
                  <el-button
                    v-else-if="step.action === 'precheck'"
                    type="primary"
                    size="small"
                    round
                    class="flow-cta"
                    :loading="reformStore.loading"
                    @click="runPrecheck"
                  >{{ step.cta }} →</el-button>
                  <el-button
                    v-else-if="step.action === 'portrait'"
                    type="primary"
                    size="small"
                    round
                    class="flow-cta"
                    :loading="reformStore.loading"
                    @click="runPortraitToPlan"
                  >{{ step.cta }} →</el-button>
                  <el-button
                    v-else-if="step.action === 'schedule'"
                    type="success"
                    size="small"
                    round
                    class="flow-cta"
                    :disabled="reformStore.phases.length === 0"
                    :loading="reformStore.loading"
                    @click="reformStore.startSchedule"
                  >{{ step.cta }} →</el-button>
                  <el-tag v-else-if="step.action === 'done'" type="success" effect="dark" size="small">✅ 已达标</el-tag>
                </template>
                <el-button
                  v-else-if="step.path"
                  link
                  type="info"
                  size="small"
                  @click="$router.push(step.path)"
                >进入</el-button>
              </div>
            </template>
          </el-step>
        </el-steps>
        <p class="material-note">
          💡 材料说明: 原始敏感材料 (银行流水/税务明细/两套账凭证) 在
          <el-link type="primary" @click="$router.push('/eco/burn')">ECO-01 阅后即焚</el-link>
          提交, SGX 可信环境内完成 R1 画像 + R2 诊断后物理销毁, 仅保留脱敏产物 — 原始数据不落库、不留痕。
        </p>
      </el-card>

      <el-card header="🛠 改造工作台 (MOD-16 系列)">
        <el-steps :active="currentStep" finish-status="success" align-center>
          <el-step title="R0 预检" description="接入意愿评估" />
          <el-step title="R1 画像" description="全景评分卡" />
          <el-step title="R2 差距" description="诊断 Gap" />
          <el-step title="R3 方案" description="生成 phases" />
          <el-step title="R4 调度" description="DAG 编排" />
          <el-step title="R7 合规" description="规则引擎" />
          <el-step title="完成" description="解锁融资" />
        </el-steps>

        <el-divider />

        <el-row :gutter="16">
          <el-col :span="12">
            <el-card header="当前评分卡" shadow="never">
              <ScorecardRadar
                v-if="currentScorecard"
                :scorecard="currentScorecard"
              />
              <el-empty v-else description="尚未执行 R1 画像" />
            </el-card>
          </el-col>
          <el-col :span="12">
            <el-card header="改造进度" shadow="never">
              <el-progress
                type="dashboard"
                :percentage="reformStore.progressPercent"
                :status="reformStore.isReady ? 'success' : undefined"
              />
              <p class="progress-info">
                {{ reformStore.state?.status || '未启动' }} ·
                {{ reformStore.currentLevel }} → {{ reformStore.targetLevel }}
              </p>
            </el-card>
          </el-col>
        </el-row>

        <el-divider />

        <el-card header="改造阶段 (R3 生成 / R4 执行产物)" shadow="never">
          <el-empty v-if="displayPhases.length === 0" description="尚未生成改造方案, 请先执行 R0→R3" />
          <el-timeline v-else>
            <el-timeline-item
              v-for="phase in displayPhases"
              :key="phase.id"
              :type="getPhaseTagType(phase.status)"
              :timestamp="phase.estimatedDays + ' 天'"
              placement="top"
            >
              <h4>{{ phase.name }} ({{ Math.round((phase.weight ?? 0) * 100) }}%)</h4>
              <p>{{ phase.description }}</p>
              <p class="hint">
                引擎: {{ phase.engine }} · 自主度: {{ phase.autonomyLevel }} · 维度: {{ phase.dimension }}
              </p>
              <template v-for="act in (phase.actions || [])" :key="act.id">
                <div v-if="act.result" class="act-result">
                  <el-tag size="small" type="success" effect="dark">
                    {{ act.status === 'completed' ? '✓ 已执行' : act.status }}
                  </el-tag>
                  <span class="act-result-text">{{ act.result }}</span>
                  <div v-if="act.evidence && act.evidence.length" class="act-evidence">
                    <el-tag
                      v-for="(ev, i) in act.evidence.slice(0, 3)"
                      :key="i"
                      size="small"
                      type="info"
                      effect="plain"
                    >{{ ev }}</el-tag>
                  </div>
                </div>
              </template>
            </el-timeline-item>
          </el-timeline>
        </el-card>

        <el-divider />

        <div class="action-buttons">
          <el-button type="primary" :loading="reformStore.loading" @click="runPrecheck">
            1. R0 接入意愿评估
          </el-button>
          <el-button type="primary" :loading="reformStore.loading" @click="runPortraitToPlan">
            2. R1→R3 一键画像+方案
          </el-button>
          <el-button
            type="success"
            :disabled="reformStore.phases.length === 0"
            :loading="reformStore.loading"
            @click="reformStore.startSchedule"
          >
            3. R4 启动调度
          </el-button>
          <el-button
            type="warning"
            :disabled="!reformStore.isInProgress"
            @click="reformStore.pause"
          >
            ⏸ 暂停
          </el-button>
          <el-button
            type="success"
            :disabled="reformStore.state?.status !== 'paused'"
            @click="reformStore.resume"
          >
            ▶ 恢复
          </el-button>
          <el-button
            type="danger"
            :disabled="!reformStore.state || reformStore.state.status === 'completed'"
            @click="onAbandon"
          >
            ✗ 放弃
          </el-button>
        </div>
      </el-card>

      <!-- ========== 数据销毁审计报告 (ECO-01): 原始材料销毁后自动生成, 打通 ECO-01 → 工作台 ========== -->
      <el-card class="burn-audit-card" shadow="never">
        <template #header>
          <div class="flow-guide-head">
            <span class="flow-guide-title">🔐 数据销毁审计报告 (ECO-01 阅后即焚)</span>
            <el-tag v-if="burnAudit" type="success" effect="light" round>已销毁 · 链上存证</el-tag>
            <el-tag v-else type="info" effect="plain" round>暂无记录</el-tag>
          </div>
        </template>
        <template v-if="burnAudit">
          <p class="audit-summary">
            企业 <b>{{ burnAudit.enterpriseId }}</b> 的原始敏感材料已于
            {{ fmtTs(burnAudit.destroyedAt) }} 在 SGX 安全内存中完成物理销毁
            (三重覆写{{ burnAudit.threePassOverwrite ? '完成' : '未完成' }},
            键清空 {{ burnAudit.redisKeysCleared }} 个, 弱引用终结{{ burnAudit.weakRefFinalized ? '完成' : '未完成' }}),
            数据不可恢复; 脱敏诊断产物仍持久保留, 供本工作台 R1 画像使用。
          </p>
          <!-- 数据概况 (脱敏) -->
          <div v-if="burnAudit.dataSummary" class="audit-line">
            销毁数据: {{ dataTypeLabel(burnAudit.dataSummary.dataType) }}
            {{ burnAudit.dataSummary.recordCount }} 条 · 来源 {{ burnAudit.dataSummary.source }}
            · 约 {{ burnAudit.dataSummary.bytesKb.toFixed(1) }} KB
          </div>
          <!-- 诊断结论摘要: R1 画像消费的就是这份脱敏产物 -->
          <div v-if="burnAudit.diagnosisSummary" class="audit-diag">
            <div class="audit-line">
              诊断结论: 8 维综合均值 <b class="hash-text">{{ burnScoreAvg }} 分</b>,
              识别 {{ burnAudit.diagnosisSummary.gapCount }} 项改造差距
              <span v-if="burnAudit.diagnosisSummary.topGaps.length">
                — 最突出:
                <el-tag
                  v-for="g in burnAudit.diagnosisSummary.topGaps.slice(0, 2)"
                  :key="g.dimension"
                  :type="g.severity === 'critical' ? 'danger' : g.severity === 'high' ? 'warning' : 'info'"
                  size="small"
                  effect="plain"
                  class="gap-tag"
                >{{ dimLabel(g.dimension) }}差 {{ g.delta }} 分</el-tag>
              </span>
            </div>
          </div>
          <div class="audit-line">
            销毁数据哈希 (SHA-256): <span class="hash-text">{{ burnAudit.rawHash || '—' }}</span>
          </div>
          <div v-if="burnFirstEv" class="audit-line">
            链上存证: 区块 #{{ burnFirstEv.block }} · 交易号 {{ burnFirstEv.txId }} ·
            上链时间 {{ fmtTs(burnFirstEv.ts) }}
          </div>
          <el-button link type="primary" @click="$router.push('/eco/burn')">查看完整审计报告 (8 维评分条 / 正文 / 链上存证) →</el-button>
        </template>
        <el-empty
          v-else
          description="该企业暂无销毁审计记录 — 在 ECO-01 阅后即焚完成「物理销毁」后自动生成并同步到此"
          :image-size="60"
        />
      </el-card>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { ElMessageBox, ElMessage } from 'element-plus';
import { useEnterpriseStore } from '@/stores/enterprise';
import { useReformStore } from '@/stores/reform';
import { useEcoStore } from '@/stores/eco';
import ScorecardRadar from '@/components/common/ScorecardRadar.vue';
import type { ReformPhaseStatus, Scorecard8D } from '@contracts/scorecard';

defineOptions({ name: 'ReformWorkbenchView' });

const enterpriseStore = useEnterpriseStore();
const reformStore = useReformStore();
const ecoStore = useEcoStore();

// ========== 改造全流程指引 (业务链路, 与下方 R0-R7 技术步骤条互补) ==========
interface FlowStep {
  title: string;
  desc: string;
  cta: string;
  /** 跳转型步骤 */
  path?: string;
  /** 就地执行型步骤 */
  action?: 'precheck' | 'portrait' | 'schedule' | 'done';
}

const flowSteps: FlowStep[] = [
  { title: '① 选企业', desc: '从企业列表选择要服务的企业', cta: '去选企业', path: '/enterprise' },
  { title: '② 提交材料', desc: 'ECO 阅后即焚: 交银行流水/税务明细', cta: '去交材料', path: '/eco/burn' },
  { title: '③ R0 预检', desc: '接入意愿评估', cta: '做预检', action: 'precheck' },
  { title: '④ R1 画像', desc: '全景评分卡 (数据来自脱敏产物)', cta: '生成画像', action: 'portrait' },
  { title: '⑤ R2→R3 方案', desc: '差距诊断 + 改造阶段方案', cta: '生成方案', action: 'portrait' },
  { title: '⑥ R4 调度', desc: '启动 DAG 改造执行', cta: '启动改造', action: 'schedule' },
  { title: '⑦ 改造完成', desc: '达标后解锁融资入口', cta: '', action: 'done' },
  { title: '⑧ 融资申请', desc: '进入融资流程提交申请', cta: '去融资', path: '/financing' },
];

/** 材料状态: 阅后即焚 diagnosis 完成或已销毁 (脱敏产物持久化) → 材料就绪 */
const hasBurnMaterial = computed(() => {
  const id = enterpriseStore.currentEnterpriseId;
  if (!id) return false;
  const s = ecoStore.burnStatuses[id];
  return s === 'completed' || s === 'destroyed';
});

// ========== 数据销毁审计报告 (ECO-01): 报告本体留存于后端, 此处拉取展示 ==========
const burnAudit = computed(() => {
  const id = enterpriseStore.currentEnterpriseId;
  return id ? (ecoStore.burnAudits[id] ?? null) : null;
});
/** 首条链上存证 (模板类型收窄用) */
const burnFirstEv = computed(() => burnAudit.value?.chainEvidence[0] ?? null);

/** 销毁审计里的诊断结论: 8 维评分均值 (R1 画像消费的即这份脱敏产物) */
const burnScoreAvg = computed(() => {
  const sc = burnAudit.value?.diagnosisSummary?.scorecard;
  if (!sc) return 0;
  const vals = Object.values(sc) as number[];
  return Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
});

const BURN_DIM_LABELS: Record<string, string> = {
  subject: '主体', finance: '财务', tax: '税务', business: '业务',
  assets: '资产', credit: '信用', policy: '政策', capital: '资本',
};
const BURN_DATA_TYPE_LABELS: Record<string, string> = {
  bank_statement: '银行流水', tax_detail: '税务明细', dual_books: '两套账',
  invoice_raw: '发票原件', contract_raw: '合同原件',
};
function dimLabel(dim: string): string {
  return BURN_DIM_LABELS[dim] ?? dim;
}
function dataTypeLabel(t: string): string {
  return BURN_DATA_TYPE_LABELS[t] ?? t;
}

/** 页面加载/切换企业时拉取销毁审计: 打通 ECO-01 → 工作台;
 *  同时恢复刷新后丢失的"已销毁"状态 (burnGetAudit 命中会写 burnStatuses),
 *  避免流程指引在已销毁后仍提示"先去交材料" */
async function restoreBurnAudit() {
  const id = enterpriseStore.currentEnterpriseId;
  if (!id) return;
  try {
    await ecoStore.burnGetAudit(id); // 默认 silent: 未销毁时业务 404 静默不弹错
  } catch {
    // 尚未销毁 → 无审计报告, 展示空态即可
  }
}
onMounted(restoreBurnAudit);
watch(() => enterpriseStore.currentEnterpriseId, restoreBurnAudit);

function fmtTs(ts: string | null | undefined): string {
  return ts ? ts.replace('T', ' ').slice(0, 19) : '—';
}

const flowGuide = computed(() => {
  if (!enterpriseStore.currentEnterprise) {
    return { active: 0, hint: '👇 先选择一家企业开始' };
  }
  if (!hasBurnMaterial.value) {
    const s = ecoStore.burnStatuses[enterpriseStore.currentEnterpriseId ?? ''];
    if (s === 'loaded' || s === 'diagnosing') {
      return { active: 1, hint: '材料诊断进行中, 去阅后即焚页查看进度' };
    }
    return { active: 1, hint: '👇 先去 ECO 阅后即焚提交原始材料 (银行流水/税务明细)' };
  }
  if (!reformStore.precheck) {
    return { active: 2, hint: '✅ 材料已就绪, 先做 R0 接入意愿评估' };
  }
  if (!reformStore.state?.scorecard.current) {
    return { active: 3, hint: '预检通过, 执行 R1 全景画像' };
  }
  if (reformStore.phases.length === 0) {
    return { active: 4, hint: '画像已生成, 继续 R2 差距诊断 + R3 方案' };
  }
  if (!reformStore.isReady) {
    return { active: 5, hint: '方案已生成, 启动 R4 调度开始改造' };
  }
  return { active: 6, hint: '🎉 改造已达标, 融资入口已解锁, 去申请融资' };
});

const currentStep = computed(() => {
  if (reformStore.state?.status === 'completed') return 6;
  if (reformStore.phases.length > 0) return 4;
  if (reformStore.gapTarget) return 3;
  if (reformStore.portrait) return 1;
  if (reformStore.precheck) return 1;
  return 0;
});

/** R1 画像分: 优先持久化 state, 未启动 R4 时用独立 portrait 信号 */
const currentScorecard = computed<Scorecard8D | null>(
  () => reformStore.state?.scorecard.current ?? reformStore.portrait,
);

/** 阶段清单: R4 启动后用 store.phases (轮询实时合并子引擎执行产物 result/evidence),
 *  未启动时回退 R3 计划 phases */
const displayPhases = computed<readonly any[]>(
  () => (reformStore.phases.length > 0 ? reformStore.phases : ((reformStore.state?.phases as readonly any[]) ?? [])),
);

async function runPrecheck() {
  if (!enterpriseStore.currentEnterpriseId) return;
  try {
    const result = await reformStore.runPrecheck(enterpriseStore.currentEnterpriseId);
    ElMessage.success(`预检完成: ${result.verdict} (意愿 ${result.willingnessScore} 分)`);
  } catch (e) {
    ElMessage.error('预检失败: ' + (e instanceof Error ? e.message : String(e)));
  }
}

async function runPortraitToPlan() {
  if (!enterpriseStore.currentEnterpriseId) return;
  const entId = enterpriseStore.currentEnterpriseId;
  try {
    const scorecard = await reformStore.runFullPortrait(entId);
    ElMessage.success(`R1 画像完成, 总分 ${sumScore(scorecard)}`);
    const { target, gaps } = await reformStore.runGapAnalysis(scorecard, 'balanced');
    ElMessage.success(`R2 差距诊断完成, ${gaps.length} 项 Gap, 目标总分 ${sumScore(target)}`);
    const phases = await reformStore.runGeneratePlan(entId, scorecard, target, 'balanced');
    ElMessage.success(`R3 方案生成完成, ${phases.length} 个阶段`);
  } catch (e) {
    ElMessage.error('画像/方案生成失败: ' + (e instanceof Error ? e.message : String(e)));
  }
}

async function onAbandon() {
  try {
    const { value } = await ElMessageBox.prompt('请输入放弃原因', '放弃改造', {
      confirmButtonText: '确认放弃',
      cancelButtonText: '取消',
      type: 'warning',
    });
    await reformStore.abandon(value);
    ElMessage.success('改造已放弃');
  } catch {
    // 用户取消
  }
}

function getPhaseTagType(status: ReformPhaseStatus) {
  switch (status) {
    case 'completed': return 'success' as const;
    case 'executing': return 'primary' as const;
    case 'blocked': return 'warning' as const;
    case 'failed': return 'danger' as const;
    default: return 'info' as const;
  }
}

function sumScore(s: { subject: number; finance: number; tax: number; business: number; assets: number; credit: number; policy: number; capital: number }): number {
  return s.subject + s.finance + s.tax + s.business + s.assets + s.credit + s.policy + s.capital;
}
</script>

<style lang="scss" scoped>
.reform-workbench {
  display: flex;
  flex-direction: column;
  gap: $spacing-lg;

  .flow-guide {
    .flow-guide-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: $spacing-sm;

      .flow-guide-title {
        font-weight: 600;
        font-size: $font-size-base;
      }
    }

    .flow-step-desc {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: $text-muted;

      .flow-cta {
        margin-top: 2px;
        animation: flow-pulse 1.6s ease-in-out infinite;
      }
    }

    .material-note {
      margin: $spacing-base 0 0;
      font-size: $font-size-sm;
      color: $text-muted;
    }

    @keyframes flow-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(64, 158, 255, 0.4); }
      50% { box-shadow: 0 0 0 6px rgba(64, 158, 255, 0); }
    }
  }

  .burn-audit-card {
    .audit-summary {
      margin: 0 0 $spacing-sm;
      font-size: $font-size-base;
      line-height: 1.9;
    }

    .audit-line {
      margin-bottom: 4px;
      font-size: $font-size-sm;
      color: $text-muted;
    }

    .audit-diag {
      padding: $spacing-xs $spacing-sm;
      margin: $spacing-xs 0;
      background: rgba($color-primary, 0.06);
      border-radius: 8px;

      .gap-tag {
        margin-left: 6px;
      }
    }

    .hash-text {
      font-family: 'Cascadia Code', 'JetBrains Mono', Consolas, monospace;
      word-break: break-all;
      color: $color-primary;
    }
  }

  .progress-info {
    text-align: center;
    margin-top: $spacing-base;
    color: $text-muted;
  }

  .action-buttons {
    display: flex;
    gap: $spacing-sm;
    flex-wrap: wrap;
  }

  .hint {
    color: $text-muted;
    font-size: $font-size-sm;
  }

  .act-result {
    margin-top: 6px;
    padding: 8px 10px;
    background: var(--el-fill-color-light);
    border-radius: 6px;
    font-size: $font-size-sm;
    line-height: 1.6;

    .act-result-text {
      margin-left: 6px;
    }

    .act-evidence {
      margin-top: 4px;
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
  }
}
</style>
