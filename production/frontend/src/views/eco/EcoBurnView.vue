<template>
  <div class="eco-burn-view">
    <el-card header="🔒 ECO-01 阅后即焚零信任诊断 (MOD-16.1, P0)">
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="零信任架构"
        description="原始敏感数据(银行流水/税务明细/两套账凭证)仅在 SGX enclave 内解密计算, R1 画像 + R2 差距诊断完成后物理销毁, 仅保留脱敏产物。"
      />

      <el-divider />

      <el-steps :active="burnStep" finish-status="success" simple>
        <el-step title="1. 加载原始数据" />
        <el-step title="2. 启动 120s 诊断" />
        <el-step title="3. 获取脱敏产物" />
        <el-step title="4. 物理销毁" />
        <el-step title="5. 审计报告" />
      </el-steps>

      <!-- 反向闭环指引: 诊断完成后提示下一步去改造工作台 -->
      <el-alert
        v-if="burnStep >= 2"
        class="next-step-alert"
        type="success"
        :closable="false"
        show-icon
      >
        <template #title>
          脱敏产物就绪后, 请前往
          <el-link type="primary" class="next-step-link" @click="$router.push('/reform')">改造工作台</el-link>
          执行 R1 全景画像 (画像数据来自本页脱敏产物, 原始材料已销毁不留痕)
        </template>
      </el-alert>

      <el-divider />

      <div v-if="burnProgress" class="burn-progress">
        <el-progress
          type="dashboard"
          :percentage="Math.round(burnProgress.percentage * 100)"
          :status="burnProgress.phase === 'destroying' ? 'exception' : undefined"
        />
        <p>已耗时: {{ burnProgress.elapsedSec }}s / {{ burnProgress.totalSec }}s · 阶段: {{ burnProgress.phase }}</p>
      </div>

      <el-divider />

      <div class="action-buttons">
        <el-select v-model="dataType" class="datatype-select" size="default">
          <el-option
            v-for="opt in DATA_TYPE_OPTIONS"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
          />
        </el-select>
        <el-upload
          action="#"
          :auto-upload="false"
          :on-change="onFileChange"
          :show-file-list="false"
          :accept="ACCEPT_EXTS"
        >
          <el-button type="primary">1. 加载原始数据 (JSON/CSV/DOCX/XLSX/PDF/图片)</el-button>
        </el-upload>
        <el-button type="primary" :disabled="!rawLoaded" :loading="diagnosing" @click="startDiagnosis">
          2. 启动 120s 诊断
        </el-button>
        <el-button type="success" :disabled="!diagnosisDone" @click="getResult">
          3. 获取脱敏产物
        </el-button>
        <el-button type="danger" :disabled="!diagnosisDone" :loading="destroying" @click="destroy">
          4. 物理销毁
        </el-button>
        <el-button :disabled="!auditDone" @click="getAudit">5. 查看审计报告</el-button>
      </div>

      <el-divider />

      <el-descriptions v-if="result" :column="2" border>
        <template #title>
          脱敏诊断产物
          <el-tag
            :type="result.engine === 'llm' ? 'success' : 'info'"
            size="small"
            effect="dark"
            class="engine-tag"
          >
            {{ result.engine === 'llm' ? '🧠 DeepSeek 深度诊断 (A 档)' : '📐 规则基线诊断 (B 档)' }}
          </el-tag>
        </template>
        <el-descriptions-item
          v-for="(value, key) in result.scorecard"
          :key="key"
          :label="DIM_LABELS[key as keyof typeof DIM_LABELS]"
        >
          {{ value }}
        </el-descriptions-item>
        <el-descriptions-item label="原始哈希">{{ result.rawHash }}</el-descriptions-item>
      </el-descriptions>
      <!-- enclave 内提取的内容特征摘要: 证明诊断与上传材料实际内容相关 -->
      <div v-if="result && result.contentDigest && result.contentDigest.length" class="content-digest">
        <div class="digest-title">📄 材料内容特征 (enclave 内脱敏提取, 原文不出 enclave):</div>
        <el-tag v-for="(line, i) in result.contentDigest" :key="i" size="small" effect="plain" class="digest-tag">
          {{ line }}
        </el-tag>
      </div>

      <!-- 销毁审计报告: 后端链上存证永久留存, 刷新页面/切换企业后自动恢复 -->
      <template v-if="audit">
        <el-divider />
        <el-alert
          type="success"
          :closable="false"
          show-icon
          title="原始数据已物理销毁: 内存仅保留脱敏产物, 以下为不可篡改的销毁审计报告 (含链上存证)"
        />
        <!-- 报告本体: 编号 + 正文叙述 + 结论 (下方两张表为其附件: 要素核对 / 链上存证) -->
        <div class="report-doc">
          <div class="report-head">
            <span class="report-title">📄 原始数据销毁审计报告</span>
            <el-tag type="success" effect="dark" size="small">已上链存证 · 不可篡改</el-tag>
          </div>
          <div class="report-meta">
            报告编号: {{ reportNo }} · 企业: {{ audit.enterpriseId }} · 出具时间: {{ fmtTs(audit.destroyedAt) }}
          </div>
          <p class="report-body">{{ auditNarrative }}</p>
          <p class="report-conclusion">
            <b>审计结论:</b> 销毁流程已按零信任规范完成, 原始数据不可恢复; 销毁事实已固化于 MOD-08 哈希链,
            可供监管与合作银行独立核验。本报告仅含脱敏信息, 不含任何原始数据内容。
          </p>
        </div>
        <!-- 诊断结论摘要: 审计报告的核心价值内容 (8 维评分 + 主要差距 + 引擎溯源) -->
        <div v-if="audit.diagnosisSummary" class="diagnosis-summary">
          <div class="summary-title">
            📊 脱敏诊断结论摘要
            <el-tag
              :type="audit.diagnosisSummary.engine === 'llm' ? 'success' : 'info'"
              size="small"
              effect="dark"
              class="engine-tag"
            >
              {{ audit.diagnosisSummary.engine === 'llm' ? '🧠 DeepSeek 深度诊断 (A 档)' : '📐 规则基线诊断 (B 档)' }}
            </el-tag>
            <span class="summary-sub">(原始数据销毁前在 SGX 内计算, 仅留存脱敏结果)</span>
          </div>
          <div v-if="audit.diagnosisSummary.contentDigest && audit.diagnosisSummary.contentDigest.length" class="content-digest">
            <div class="digest-title">📄 诊断依据的材料内容特征:</div>
            <el-tag v-for="(line, i) in audit.diagnosisSummary.contentDigest" :key="i" size="small" effect="plain" class="digest-tag">
              {{ line }}
            </el-tag>
          </div>
          <div class="score-grid">
            <div v-for="key in scoreKeys" :key="key" class="score-cell">
              <span class="score-label">{{ DIM_LABELS[key] }}</span>
              <div class="score-bar">
                <div class="score-fill" :style="{ width: (audit.diagnosisSummary.scorecard[key] as number) + '%' }" />
              </div>
              <span class="score-val">{{ audit.diagnosisSummary.scorecard[key] }}</span>
            </div>
          </div>
          <div v-if="audit.diagnosisSummary.topGaps.length" class="top-gaps">
            <div class="gaps-title">主要改造差距 (TOP {{ audit.diagnosisSummary.topGaps.length }} / 共 {{ audit.diagnosisSummary.gapCount }} 项):</div>
            <div
              v-for="g in audit.diagnosisSummary.topGaps"
              :key="g.dimension"
              class="gap-item"
            >
              <el-tag
                :type="severityTag(g.severity)"
                size="small"
                effect="plain"
                class="gap-tag"
              >
                {{ DIM_LABELS[g.dimension as keyof Scorecard8D] ?? g.dimension }}: {{ g.current }} → {{ g.target }} (差 {{ g.delta }} 分)
              </el-tag>
              <div v-if="g.action" class="gap-action">→ {{ g.action }}</div>
            </div>
          </div>
          <div v-else class="all-pass">✓ 8 维均已达到 A 档目标分, 无显著差距</div>
        </div>
        <el-descriptions title="销毁要素核对" :column="2" border class="audit-report">
          <el-descriptions-item label="企业编号">{{ audit.enterpriseId }}</el-descriptions-item>
          <el-descriptions-item label="销毁完成时间">{{ fmtTs(audit.destroyedAt) }}</el-descriptions-item>
          <el-descriptions-item label="安全内存键清空">
            {{ audit.redisKeysCleared }} 个 (原始数据 / 诊断进度 / 临时键)
          </el-descriptions-item>
          <el-descriptions-item label="三重覆写">
            {{ audit.threePassOverwrite ? '已执行 (0x00 → 0xFF → 随机字节)' : '未执行' }}
          </el-descriptions-item>
          <el-descriptions-item label="弱引用兜底终结">
            {{ audit.weakRefFinalized ? '已完成 (GC 不可达, 无法恢复)' : '未完成' }}
          </el-descriptions-item>
          <el-descriptions-item label="被销毁数据哈希 (SHA-256)">
            <span class="hash-text">{{ audit.rawHash || '—' }}</span>
            <div class="hash-hint">与脱敏产物 rawHash 同算法, 可对账: 销毁的即诊断所用那份</div>
          </el-descriptions-item>
        </el-descriptions>
        <el-descriptions title="链上存证 (MOD-08 哈希链)" :column="1" border class="chain-report">
          <el-descriptions-item
            v-for="ev in audit.chainEvidence"
            :key="ev.txId"
            :label="`区块 #${ev.block} · ${chainActionLabel(ev.action)}`"
          >
            <div class="chain-line">交易号: {{ ev.txId }}</div>
            <div class="chain-line">上链时间: {{ fmtTs(ev.ts) }}</div>
            <div class="chain-line hash-text">本块哈希: {{ ev.hash }}</div>
            <div class="chain-line hash-text">前块哈希: {{ ev.prevHash }}</div>
          </el-descriptions-item>
        </el-descriptions>
      </template>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, onUnmounted } from 'vue';
import { ElMessage } from 'element-plus';
import { useEcoStore } from '@/stores/eco';
import { useEnterpriseStore } from '@/stores/enterprise';
import { burnLoadRawFile } from '@/api/eco';
import type { Scorecard8D } from '@contracts/scorecard';
import type { BurnDataType } from '@contracts/eco';

defineOptions({ name: 'EcoBurnView' });

const ecoStore = useEcoStore();
const enterpriseStore = useEnterpriseStore();

// ========== 全格式材料上传 ==========
const ACCEPT_EXTS = '.json,.csv,.txt,.md,.docx,.xlsx,.xlsm,.pdf,.png,.jpg,.jpeg';
const DATA_TYPE_OPTIONS: { value: BurnDataType; label: string }[] = [
  { value: 'bank_statement', label: '银行流水' },
  { value: 'tax_detail', label: '税务明细' },
  { value: 'dual_books', label: '两套账凭证' },
  { value: 'invoice_raw', label: '发票原件' },
  { value: 'contract_raw', label: '合同原件' },
];
const dataType = ref<BurnDataType>('bank_statement');

const rawLoaded = ref(false);
const diagnosing = ref(false);
const destroying = ref(false);
const result = ref<{ scorecard: Scorecard8D; rawHash: string; engine?: string; contentDigest?: readonly string[] } | null>(null);

/**
 * 修复: EcoBurn 诊断轮询泄漏
 * ---------------------------
 * 旧代码: 点击「启动 120s 诊断」就创建 setInterval(1000ms),
 *         但「完成/失败/切页面销毁」都不会 clearInterval:
 *           - 同页多次点「启动诊断」 → N 个 1Hz 定时器并行 → 后端
 *             eco-burn/{eid}/progress QPS = N, Network 面板筷子堆
 *           - 用户 R4 诊断完切 Tab 去别的页面 → 定时器还在 1 次/秒,
 *             占满 6 连接配额 (axios 8s 超时都不一定能及时释放)
 *           - 组件卸载后依然发请求 → 占连接 / 打后端
 *
 * 修复点:
 *   1) 单例化: 同一时刻最多 1 个 progressTimer
 *   2) 进入后 N 次点击, 先 clearInterval 再建下一个
 *   3) 拿到 phase === 'destroying' / percentage >= 1 / 请求失败 → 都清理
 *   4) 组件销毁 onUnmounted 强制清理 (防御式, 避免页面被切走后泄漏)
 */
let progressTimer: number | null = null;
function clearProgressTimer() {
  if (progressTimer != null) {
    window.clearInterval(progressTimer);
    progressTimer = null;
  }
}
onUnmounted(clearProgressTimer);

const burnProgress = computed(() => {
  const entId = enterpriseStore.currentEnterpriseId;
  if (!entId) return null;
  return ecoStore.burnProgress[entId] ?? null;
});

/** 销毁审计报告: 单一数据源在 store (销毁时写入 / 页面加载时从后端静默恢复),
 *  不再用易失的本地 ref — 修复"刷新后审计报告消失、按钮变灰再也查不到" */
const audit = computed(() => {
  const entId = enterpriseStore.currentEnterpriseId;
  if (!entId) return null;
  return ecoStore.burnAudits[entId] ?? null;
});

/** 报告编号: AUD-{企业}-{日期}-{区块号}, 与链上存证一一对应 */
const reportNo = computed(() => {
  const a = audit.value;
  if (!a) return '';
  const day = (a.destroyedAt || '').slice(0, 10).replace(/-/g, '');
  const block = a.chainEvidence[0]?.block ?? 0;
  return `AUD-${a.enterpriseId}-${day}-${block}`;
});

/** 报告正文: 由审计要素自动成文 (要素明细与链上存证作为附件在下方表格展示) */
const DATA_TYPE_LABELS: Record<string, string> = {
  bank_statement: '银行流水', tax_detail: '税务明细', dual_books: '两套账',
  invoice_raw: '发票原件', contract_raw: '合同原件',
};
const SEVERITY_LABELS: Record<string, string> = {
  low: '低', medium: '中', high: '高', critical: '严重',
};
const auditNarrative = computed(() => {
  const a = audit.value;
  if (!a) return '';
  const tx = a.chainEvidence[0];
  const ds = a.dataSummary;
  const dg = a.diagnosisSummary;
  return [
    `企业 ${a.enterpriseId} 的原始敏感材料在 SGX 安全内存内完成 R1 画像与 R2 差距诊断后, 于 ${fmtTs(a.destroyedAt)} 执行物理销毁。`,
    ds
      ? `被销毁数据概况: ${DATA_TYPE_LABELS[ds.dataType] ?? ds.dataType} ${ds.recordCount} 条 (来源: ${ds.source}, 约 ${ds.bytesKb.toFixed(1)} KB)。`
      : '',
    dg
      ? `脱敏诊断结论: 8 维综合评分均值 ${scoreAvg.value} 分, 共识别 ${dg.gapCount} 项待改造差距`
        + (dg.topGaps.length
          ? `, 最突出为${dg.topGaps.map((g) => `${DIM_LABELS[g.dimension as keyof Scorecard8D] ?? g.dimension}维度(差 ${g.delta} 分, ${SEVERITY_LABELS[g.severity] ?? g.severity}度)`).join('、')}。`
          : ', 各维度已达 A 档目标。')
      : '',
    dg?.engine
      ? `诊断引擎: ${dg.engine === 'llm' ? 'DeepSeek 大模型深度诊断 (A 档, 评分锚定规则基线 ±10, 改造动作引用材料具体发现)' : '规则基线评分 (B 档, LLM 不可用时降级)'}。`
      : '',
    dg && dg.contentDigest && dg.contentDigest.length
      ? `诊断依据的材料内容特征 (enclave 内脱敏提取): ${dg.contentDigest.join('; ')}。上述特征证明本次诊断基于材料实际内容, 而非仅类型与条数。`
      : '',
    `销毁动作: 安全内存 ${a.redisKeysCleared} 个键全部清空; 存储区三重覆写 (0x00 → 0xFF → 随机字节)${a.threePassOverwrite ? '已完成' : '未完成'}; 弱引用兜底终结${a.weakRefFinalized ? '已完成' : '未完成'} — 原始数据在内存中不可恢复。`,
    `被销毁数据的 SHA-256 规范化哈希为 ${a.rawHash || '(未记录)'}, 与脱敏诊断产物 rawHash 同算法, 可对账证明"销毁的即诊断所用那份"。`,
    tx ? `销毁事实已写入 MOD-08 哈希链: 区块 #${tx.block}, 交易号 ${tx.txId}, 任何篡改都会破坏哈希链连续性而被发现。` : '',
  ].filter(Boolean).join('');
});

/** 诊断结论 8 维评分均值 */
const scoreAvg = computed(() => {
  const sc = audit.value?.diagnosisSummary?.scorecard;
  if (!sc) return 0;
  const vals = Object.values(sc) as number[];
  return Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
});

/** 严重度对应 tag 类型 */
function severityTag(s: string): 'danger' | 'warning' | 'info' | 'success' {
  return s === 'critical' ? 'danger' : s === 'high' ? 'warning' : s === 'medium' ? 'info' : 'success';
}

const burnStep = computed(() => {
  if (audit.value) return 5;
  if (ecoStore.burnStatuses[enterpriseStore.currentEnterpriseId ?? ''] === 'destroyed') return 4;
  if (result.value) return 3;
  if (burnProgress.value) return 2;
  if (rawLoaded.value) return 1;
  return 0;
});

const diagnosisDone = computed(() => result.value !== null);
const auditDone = computed(() => audit.value !== null);

const DIM_LABELS: Record<keyof Scorecard8D, string> = {
  subject: '主体', finance: '财务', tax: '税务', business: '业务',
  assets: '资产', credit: '信用', policy: '政策', capital: '资本',
};
/** 8 维固定顺序 (评分条渲染用) */
const scoreKeys = Object.keys(DIM_LABELS) as (keyof Scorecard8D)[];

async function onFileChange(file: { raw?: File }) {
  const entId = enterpriseStore.currentEnterpriseId;
  if (!entId) {
    ElMessage.warning('请先选择企业');
    return;
  }
  if (!file.raw) return;
  try {
    // 全格式分流: .json 走结构化快路径; 其余 (CSV/DOCX/XLSX/PDF/图片/文本) 交给
    // 后端 /eco-burn/load-file 统一解析 (零依赖解析 + pdfplumber + OCR 降级链)
    const name = file.raw.name.toLowerCase();
    let recordCount: number;
    if (name.endsWith('.json')) {
      const text = await file.raw.text();
      const records = JSON.parse(text);
      const r = await ecoStore.burnLoadRaw(entId, dataType.value, records);
      recordCount = r.recordCount;
    } else {
      const r = await burnLoadRawFile(entId, dataType.value, file.raw);
      recordCount = r.recordCount;
    }
    rawLoaded.value = true;
    ElMessage.success(`原始数据已加载进安全内存 (${recordCount} 条记录)`);
  } catch (e) {
    ElMessage.error('加载失败: ' + (e instanceof Error ? e.message : String(e)));
  }
}

async function startDiagnosis() {
  const entId = enterpriseStore.currentEnterpriseId;
  if (!entId) return;
  diagnosing.value = true;
  clearProgressTimer();
  try {
    await ecoStore.burnStartDiagnosis(entId);
    // 后轮询进度, 最多 180s (120s 诊断 + 60s 缓冲), 防御僵死
    const MAX_WAIT_MS = 180_000;
    const startedAt = Date.now();
    progressTimer = window.setInterval(async () => {
      if (progressTimer == null) return;
      if (Date.now() - startedAt > MAX_WAIT_MS) {
        clearProgressTimer();
        ElMessage.warning('诊断超时 (>180s), 已停止轮询, 请手动获取产物');
        return;
      }
      try {
        const p = await ecoStore.burnGetProgress(entId);
        if (!p || p.phase === 'destroying' || p.percentage >= 1) {
          clearProgressTimer();
          await getResult();
        }
      } catch (e) {
        clearProgressTimer();
        ElMessage.error('进度查询失败: ' + (e instanceof Error ? e.message : String(e)));
      }
    }, 1000);
  } catch (e) {
    ElMessage.error('启动诊断失败: ' + (e instanceof Error ? e.message : String(e)));
  } finally {
    diagnosing.value = false;
  }
}

async function getResult() {
  const entId = enterpriseStore.currentEnterpriseId;
  if (!entId) return;
  const r = await ecoStore.burnGetResult(entId);
  if (r) {
    result.value = { scorecard: r.scorecard, rawHash: r.rawHash, engine: r.engine };
    ElMessage.success('脱敏产物已获取');
  } else {
    ElMessage.warning('诊断尚未完成');
  }
}

async function destroy() {
  const entId = enterpriseStore.currentEnterpriseId;
  if (!entId) return;
  destroying.value = true;
  try {
    await ecoStore.burnDestroy(entId); // store 写入 burnAudits → audit computed 自动展示完整报告
    result.value = null; // 销毁后清空脱敏产物展示 (后端仍持久化, 仅本页不再显示)
    ElMessage.success('原始数据已物理销毁, 审计报告已生成');
  } catch (e) {
    ElMessage.error('销毁失败: ' + (e instanceof Error ? e.message : String(e)));
  } finally {
    destroying.value = false;
  }
}

async function getAudit() {
  const entId = enterpriseStore.currentEnterpriseId;
  if (!entId) return;
  try {
    const a = await ecoStore.burnGetAudit(entId, false);
    if (a) ElMessage.success('审计报告已从后端获取 (链上存证, 不可篡改)');
  } catch {
    // 全局拦截器已提示具体原因 (如"企业 X 无销毁审计")
  }
}

/** 页面加载 / 切换企业时静默恢复审计报告: 后端 _audits 永久留存, 刷新不丢 */
async function restoreAudit(entId: string) {
  try {
    await ecoStore.burnGetAudit(entId, true);
  } catch {
    // 尚未销毁 → 业务 404, 静默忽略不弹 toast
  }
}
onMounted(() => {
  const entId = enterpriseStore.currentEnterpriseId;
  if (entId) void restoreAudit(entId);
});
watch(() => enterpriseStore.currentEnterpriseId, (id) => {
  if (id) void restoreAudit(id);
});

function fmtTs(ts: string | undefined | null): string {
  if (!ts) return '—';
  return ts.replace('T', ' ').slice(0, 19);
}

const CHAIN_ACTION_LABELS: Record<string, string> = {
  raw_loaded: '原始数据载入安全内存',
  diagnosed: '脱敏诊断完成',
  destroyed: '物理销毁',
  audit_logged: '审计留痕',
};
function chainActionLabel(action: string): string {
  return CHAIN_ACTION_LABELS[action] ?? action;
}
</script>

<style lang="scss" scoped>
// EcoBurnView · Deepspace AI 深色版
// Experience 366208 教训: 局部 view 必须显式覆盖内部 Element Plus 组件 (card/alert/descriptions/divider/steps/progress)
//                 否则子节点会回退 Element Plus 默认 light 白底 → 用户看到"零信任架构那段下面全浅色"
@use '@/styles/variables.scss' as *;

.eco-burn-view {
  // 页面容器: 透明 → 透出 body::before 深空霓虹光晕
  background: transparent;
  isolation: isolate;
  padding: 16px;
  color: $text-primary;

  // 🔒 整块大卡片: 玻璃 + 渐变霓虹边 + 卡头 AI 渐变字
  :deep(.el-card) {
    background: linear-gradient(180deg, rgba(15,23,42,0.72), rgba(3,7,18,0.82)) !important;
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
      font-weight: 800;
      letter-spacing: 0.01em;
      // 标题文字: AI 霓虹渐变 (🔒 ECO-01 阅后即焚...)
      background-image: $ai-gradient;
      -webkit-background-clip: text;
              background-clip: text;
      color: transparent;
    }
    :deep(.el-card__body) {
      color: $text-primary;
    }
  }

  // 🔒 零信任架构 Info Alert (你说的浅色元凶! 默认 light 是白+浅蓝边)
  :deep(.el-alert) {
    border-radius: 14px !important;
    border: 1px solid rgba(34,211,238,0.35) !important;
    background: linear-gradient(135deg, rgba(34,211,238,0.12), rgba(129,140,248,0.18)) !important;
    backdrop-filter: blur(10px) saturate(160%);
    -webkit-backdrop-filter: blur(10px) saturate(160%);
    box-shadow: $shadow-glow-cyan;

    :deep(.el-alert__content) {
      color: $text-primary !important;
    }
    :deep(.el-alert__title) {
      color: $text-primary !important;
      font-weight: 800;
      letter-spacing: 0.02em;
      font-size: 15px;
      // 标题"零信任架构"也做 AI 霓虹渐变字
      background: $ai-gradient;
      -webkit-background-clip: text;
              background-clip: text;
      color: transparent;
    }
    :deep(.el-alert__description) {
      color: $text-regular !important;
      line-height: 1.75;
      margin-top: 4px;
      font-size: 13px;
    }
    :deep(.el-alert__icon) {
      color: $color-primary;
      filter: drop-shadow(0 0 8px rgba(56,189,248,0.55));
    }
  }

  // 销毁成功 Alert (绿色)
  :deep(.el-alert--success) {
    border-color: rgba(16,185,129,0.45) !important;
    background: linear-gradient(135deg, rgba(16,185,129,0.16), rgba(6,78,59,0.10)) !important;
    box-shadow: 0 0 0 1px rgba(16,185,129,0.20), 0 6px 20px rgba(16,185,129,0.18);
    :deep(.el-alert__title) {
      background: linear-gradient(90deg, #a7f3d0, #6ee7b7);
      -webkit-background-clip: text;
              background-clip: text;
      color: transparent;
    }
    :deep(.el-alert__icon) {
      color: #34d399;
      filter: drop-shadow(0 0 6px rgba(16,185,129,0.55));
    }
  }

  // 🔒 分隔线 (默认 light 是浅灰线 → 改成半透明霓虹细线)
  :deep(.el-divider) {
    --el-border-color: #{ $border-color };
    border-top: 1px solid $border-color !important;
    background: transparent;
    &::before, &::after {
      background: transparent !important;
    }
  }

  // 🔒 5 步骤条 (steps simple 模式): 图标/文字颜色统一深空高对比
  :deep(.el-steps) {
    --el-steps-border-color: #{ $border-color };
    padding: 8px 0;

    .el-step.is-simple {
      :deep(.el-step__title) {
        color: $text-secondary;
        font-weight: 600;
        letter-spacing: 0.01em;
      }
      :deep(.el-step__head.is-wait) {
        color: rgba(148,163,184,0.55);
        border-color: rgba(148,163,184,0.40);
      }
      :deep(.el-step__head.is-process) {
        color: $text-primary;
        border-color: $color-primary;
      }
      :deep(.el-step__head.is-success) {
        color: #34d399;
        border-color: #34d399;
      }
      :deep(.el-step__title.is-wait)    { color: rgba(148,163,184,0.55); }
      :deep(.el-step__title.is-process) {
        color: $text-primary;
        font-weight: 800;
        text-shadow: 0 0 8px rgba(56,189,248,0.40);
      }
      :deep(.el-step__title.is-success) { color: #a7f3d0; }
    }
  }

  // 🔒 Dashboard 进度仪表盘 + 文字 (默认 light 底色是 #fff)
  .burn-progress {
    text-align: center;
    padding: 14px 16px;
    // 仪表盘底座: 玻璃胶囊, 修"零信任架构下面全白块"(因为仪表盘外层 + p 文字区域有 light 留白)
    background: rgba(15,23,42,0.55);
    border: 1px solid $border-color;
    border-radius: 16px;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    box-shadow: inset 0 0 0 1px rgba(129,140,248,0.10);

    :deep(.el-progress__text) {
      color: $text-primary !important;
      font-weight: 800 !important;
      background: $ai-gradient;
      -webkit-background-clip: text;
              background-clip: text;
      color: transparent;
    }
    :deep(.el-progress-circle svg .el-progress-circle__track) {
      stroke: rgba(148,163,184,0.18) !important;
    }
    p {
      margin-top: $spacing-base;
      color: $text-secondary;
      font-weight: 600;
      letter-spacing: 0.01em;
    }
  }

  // 🔒 Descriptions 脱敏诊断产物 8 格 (默认 light 格子是 #fff / 浅灰 → 深蓝玻璃交替)
  :deep(.el-descriptions) {
    border-radius: 14px;
    overflow: hidden;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);

    :deep(.el-descriptions__header),
    :deep(.el-descriptions__title) {
      color: $text-primary !important;
      font-weight: 800 !important;
      letter-spacing: 0.02em;
      background: $ai-gradient;
      -webkit-background-clip: text;
              background-clip: text;
      color: transparent !important;
    }
    :deep(.el-descriptions__label) {
      background: rgba(15,23,42,0.65) !important;
      border-color: $border-color !important;
      color: $text-secondary !important;
      font-weight: 700;
    }
    :deep(.el-descriptions__content) {
      background: rgba(30,41,59,0.42) !important;
      border-color: $border-color !important;
      color: $text-primary !important;
    }
    :deep(.el-descriptions__table) {
      border-color: $border-color !important;
    }
  }

  // 🔒 操作按钮行
  .action-buttons {
    display: flex;
    gap: $spacing-sm;
    flex-wrap: wrap;
    padding: 10px 0 6px;

    .datatype-select {
      width: 150px;
    }

    // 注: 按钮 8 态强对比 (primary/success/warning/danger/info/default × 正常/禁用)
    //    统一写在 main.scss → .eco-burn-view @include eco-button-strong-contrast
    //    避免 eco 模块 9 个页面每个页面写一份重复规则 (Experience 366208 漏改教训)
  }

  // 诊断引擎徽章
  .engine-tag {
    margin-left: $spacing-sm;
    vertical-align: middle;
  }

  // 诊断结论摘要: 8 维评分条 + 差距标签
  .diagnosis-summary {
    margin-top: $spacing-base;
    padding: $spacing-base $spacing-lg;
    background: rgba(15, 23, 42, 0.55);
    border: 1px solid $border-color;
    border-radius: 14px;

    .summary-title {
      font-weight: 700;
      font-size: 14px;
      color: $text-primary;

      .summary-sub {
        font-weight: 400;
        font-size: 12px;
        color: $text-secondary;
      }
    }
    .score-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: $spacing-sm $spacing-lg;
      margin-top: $spacing-sm;
    }
    .score-cell {
      display: flex;
      align-items: center;
      gap: 8px;

      .score-label {
        width: 36px;
        flex-shrink: 0;
        font-size: 12px;
        color: $text-secondary;
      }
      .score-bar {
        flex: 1;
        height: 8px;
        border-radius: 4px;
        background: rgba(255, 255, 255, 0.08);
        overflow: hidden;

        .score-fill {
          height: 100%;
          border-radius: 4px;
          background: $ai-gradient;
        }
      }
      .score-val {
        width: 28px;
        text-align: right;
        font-size: 12px;
        font-family: 'Cascadia Code', Consolas, monospace;
        color: $color-primary;
      }
    }
    .top-gaps {
      margin-top: $spacing-sm;

      .gaps-title {
        font-size: 12px;
        color: $text-secondary;
        margin-bottom: 6px;
      }
      .gap-item {
        margin-bottom: 6px;

        .gap-tag {
          margin: 0 8px 4px 0;
        }
        .gap-action {
          font-size: 12px;
          color: $text-secondary;
          line-height: 1.5;
          padding-left: 4px;
        }
      }
    }
    .all-pass {
      margin-top: $spacing-sm;
      font-size: 13px;
      color: $color-success;
    }
  }

  // 报告本体: 文档式呈现 (编号/正文/结论), 下方两张表为附件
  .report-doc {
    margin-top: $spacing-base;
    padding: $spacing-base $spacing-lg;
    background: rgba(15, 23, 42, 0.55);
    border: 1px solid $border-color;
    border-radius: 14px;
    backdrop-filter: blur(10px);

    .report-head {
      display: flex;
      align-items: center;
      gap: $spacing-sm;

      .report-title {
        font-weight: 800;
        font-size: 15px;
        background: $ai-gradient;
        -webkit-background-clip: text;
                background-clip: text;
        color: transparent;
      }
    }
    .report-meta {
      margin-top: 6px;
      font-size: 12px;
      color: $text-secondary;
    }
    .content-digest {
      margin-top: $spacing-base;

      .digest-title {
        font-size: 12px;
        color: $text-secondary;
        margin-bottom: 4px;
      }

      .digest-tag {
        margin: 2px 4px 2px 0;
      }
    }
    .report-body {
      margin: $spacing-base 0 0;
      font-size: 13px;
      line-height: 2;
      color: $text-regular;
      text-align: justify;
    }
    .report-conclusion {
      margin: $spacing-sm 0 0;
      font-size: 13px;
      line-height: 1.9;
      color: $text-primary;
    }
  }

  // 销毁审计报告: 哈希等长串用等宽字体 + 强制换行, 防止撑破玻璃卡片
  .audit-report,
  .chain-report {
    margin-top: $spacing-base;
  }
  .hash-text {
    font-family: 'Cascadia Code', 'JetBrains Mono', Consolas, monospace;
    font-size: 12px;
    line-height: 1.7;
    word-break: break-all;
    color: $color-primary;
  }
  .hash-hint {
    margin-top: 4px;
    font-size: 12px;
    color: $text-secondary;
  }
  .chain-line {
    font-size: 13px;
    line-height: 1.9;
  }
}
</style>
