/**
 * stores/bank.ts — 银行信任培育期渐进解锁状态管理 (CORE-01b)
 *
 * 职责:
 *   1. 维护当前选中银行 ID (持久化)
 *   2. 缓存银行列表 / 信任档案 / 风险提示函 / 决策日志 / 统计
 *   3. 暴露 8 个 API action 与后端 /bank/* 端点对齐
 *   4. 切换银行时自动清空缓存 (避免跨银行污染)
 *
 * project_memory 硬约束:
 *   - L4 培育期 AI 零拦截, 仅生成风险提示函
 *   - L2 信任期 <50 万自动放行 (50 万元 = 50,000,000 分)
 *   - 切银行时清空风险提示函/决策/统计缓存
 */

import { defineStore } from 'pinia';
import { ref } from 'vue';
import * as bankApi from '@/api/bank';
import type {
  BankDecision, BankDecisionCreate, BankListItem, BankStatistics,
  BankTrustProfile, BankTrustStage, RiskLetter, RiskLetterCreate,
  StageUpgradeResult, SupervisionAccount, CreditMultiplierPayload,
  CreditMultiplierResult, FreezeAccountPayload, FreezeAccountResult,
} from '@/api/bank';

// === 阶段元数据 (供 UI 进度条/高亮使用) ===
export const STAGE_ORDER: BankTrustStage[] = [
  'L4_READONLY', 'L3_ADVISORY', 'L2_SMALL_AUTO', 'L1_FULL_AUTO',
];

export const STAGE_LABELS: Record<BankTrustStage, string> = {
  L4_READONLY: '培育期 (0-6 月)',
  L3_ADVISORY: '验证期 (6-12 月)',
  L2_SMALL_AUTO: '信任期 (12-24 月)',
  L1_FULL_AUTO: '深度信任期 (24+ 月)',
};

export const STAGE_SHORT_LABELS: Record<BankTrustStage, string> = {
  L4_READONLY: 'L4 只读',
  L3_ADVISORY: 'L3 建议',
  L2_SMALL_AUTO: 'L2 小额自动',
  L1_FULL_AUTO: 'L1 全自动',
};

// 50 万元 = 50,000,000 分 (与后端阈值对齐)
export const SMALL_AUTO_THRESHOLD_CENTS = 50_000_000;

export const useBankStore = defineStore('bank', () => {
  // === state ===
  const currentBankId = ref<string | null>(null);
  const banks = ref<BankListItem[]>([]);
  const trustProfile = ref<BankTrustProfile | null>(null);
  const riskLetters = ref<RiskLetter[]>([]);
  const decisions = ref<BankDecision[]>([]);
  const statistics = ref<BankStatistics | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  /** 风险提示函筛选企业 ID */
  const letterEnterpriseFilter = ref<string | undefined>(undefined);
  /** APP-01: 监管账户列表 */
  const supervisionAccounts = ref<SupervisionAccount[]>([]);
  /** APP-01: 当前授信乘数 (默认 1.0, 后端可调整) */
  const currentMultiplier = ref<number>(1.0);
  /** APP-01: 当前授信额度 (分) */
  const currentCreditLimitCents = ref<number>(0);

  // === helpers ===

  /** 切换银行时清空业务缓存 (保留 banks 列表) */
  function _clearBusinessCache(): void {
    trustProfile.value = null;
    riskLetters.value = [];
    decisions.value = [];
    statistics.value = null;
    letterEnterpriseFilter.value = undefined;
    supervisionAccounts.value = [];
    currentMultiplier.value = 1.0;
    currentCreditLimitCents.value = 0;
  }

  // === actions (与 8 个端点对齐) ===

  /** 端点 1: 列出所有银行 (并自动选中第一个) */
  async function fetchBanks(): Promise<BankListItem[]> {
    loading.value = true;
    error.value = null;
    try {
      const result = await bankApi.listBanks();
      banks.value = result;
      if (!currentBankId.value && result.length > 0) {
        currentBankId.value = result[0]!.bankId;
      }
      return result;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      console.error('[BankStore] 拉取银行列表失败:', e);
      return [];
    } finally {
      loading.value = false;
    }
  }

  /** 切换当前银行 (清空业务缓存) */
  async function switchBank(bankId: string): Promise<void> {
    if (bankId === currentBankId.value) return;
    currentBankId.value = bankId;
    _clearBusinessCache();
  }

  /** 端点 2: 银行信任档案 */
  async function fetchTrustProfile(bankId?: string): Promise<BankTrustProfile | null> {
    const id = bankId ?? currentBankId.value;
    if (!id) return null;
    try {
      const profile = await bankApi.getTrustProfile(id);
      trustProfile.value = profile;
      return profile;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      console.error('[BankStore] 拉取信任档案失败:', e);
      return null;
    }
  }

  /** 端点 3: 升级信任阶段 */
  async function upgradeStage(bankId?: string): Promise<StageUpgradeResult | null> {
    const id = bankId ?? currentBankId.value;
    if (!id) return null;
    try {
      const result = await bankApi.upgradeStage(id);
      // 升级成功后刷新信任档案
      if (result.upgraded) {
        await fetchTrustProfile(id);
        await fetchBanks();
      }
      return result;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      console.error('[BankStore] 升级阶段失败:', e);
      return null;
    }
  }

  /** 端点 4: 风险提示函列表 (可按企业筛选) */
  async function fetchRiskLetters(
    bankId?: string,
    enterpriseId?: string,
  ): Promise<RiskLetter[]> {
    const id = bankId ?? currentBankId.value;
    if (!id) return [];
    try {
      const filterEnt = enterpriseId ?? letterEnterpriseFilter.value;
      const result = await bankApi.listRiskLetters(id, filterEnt);
      riskLetters.value = result;
      return result;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      console.error('[BankStore] 拉取风险提示函失败:', e);
      return [];
    }
  }

  /** 设置风险提示函筛选企业 */
  function setLetterEnterpriseFilter(enterpriseId?: string): void {
    letterEnterpriseFilter.value = enterpriseId;
  }

  /** 端点 5: 生成风险提示函 (L4 培育期 AI 唯一输出) */
  async function generateRiskLetter(
    payload: RiskLetterCreate,
    bankId?: string,
  ): Promise<RiskLetter | null> {
    const id = bankId ?? currentBankId.value;
    if (!id) return null;
    try {
      const letter = await bankApi.generateRiskLetter(id, payload);
      // 写入缓存列表头部
      riskLetters.value = [letter, ...riskLetters.value];
      return letter;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      console.error('[BankStore] 生成风险提示函失败:', e);
      return null;
    }
  }

  /** 端点 6: 决策日志 */
  async function fetchDecisions(bankId?: string): Promise<BankDecision[]> {
    const id = bankId ?? currentBankId.value;
    if (!id) return [];
    try {
      const result = await bankApi.listDecisions(id);
      decisions.value = result;
      return result;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      console.error('[BankStore] 拉取决策日志失败:', e);
      return [];
    }
  }

  /** 端点 7: 提交决策 (根据 stage 自动判定 autoHandled) */
  async function submitDecision(
    payload: BankDecisionCreate,
    bankId?: string,
  ): Promise<BankDecision | null> {
    const id = bankId ?? currentBankId.value;
    if (!id) return null;
    try {
      const decision = await bankApi.submitDecision(id, payload);
      decisions.value = [decision, ...decisions.value];
      return decision;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      console.error('[BankStore] 提交决策失败:', e);
      return null;
    }
  }

  /** 端点 8: 统计数据 */
  async function fetchStatistics(bankId?: string): Promise<BankStatistics | null> {
    const id = bankId ?? currentBankId.value;
    if (!id) return null;
    try {
      const stats = await bankApi.getStatistics(id);
      statistics.value = stats;
      return stats;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      console.error('[BankStore] 拉取统计失败:', e);
      return null;
    }
  }

  /** 一键加载当前银行的全部数据 (切换银行后调用) */
  async function loadAll(bankId?: string): Promise<void> {
    const id = bankId ?? currentBankId.value;
    if (!id) return;
    await Promise.all([
      fetchTrustProfile(id),
      fetchRiskLetters(id),
      fetchDecisions(id),
      fetchStatistics(id),
      fetchSupervisionAccounts(id),
    ]);
  }

  /** APP-01 端点 9: 调整授信乘数 */
  async function adjustCreditMultiplier(
    payload: CreditMultiplierPayload,
    bankId?: string,
  ): Promise<CreditMultiplierResult | null> {
    const id = bankId ?? currentBankId.value;
    if (!id) return null;
    try {
      const result = await bankApi.adjustCreditMultiplier(id, payload);
      currentMultiplier.value = result.multiplier;
      currentCreditLimitCents.value = result.newCreditLimitCents;
      return result;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      console.error('[BankStore] 调整授信乘数失败:', e);
      return null;
    }
  }

  /** APP-01 端点 10: 冻结/解冻监管账户 */
  async function freezeAccount(
    accountId: string,
    payload: FreezeAccountPayload,
    bankId?: string,
  ): Promise<FreezeAccountResult | null> {
    const id = bankId ?? currentBankId.value;
    if (!id) return null;
    try {
      const result = await bankApi.freezeAccount(id, accountId, payload);
      // 同步更新本地缓存
      const idx = supervisionAccounts.value.findIndex((a) => a.accountId === accountId);
      if (idx >= 0) {
        supervisionAccounts.value[idx] = {
          ...supervisionAccounts.value[idx]!,
          status: result.status,
          lastOperationAt: result.operatedAt,
        };
      }
      return result;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      console.error('[BankStore] 冻结/解冻账户失败:', e);
      return null;
    }
  }

  /** APP-01 端点 11: 列出监管账户 */
  async function fetchSupervisionAccounts(
    bankId?: string,
  ): Promise<SupervisionAccount[]> {
    const id = bankId ?? currentBankId.value;
    if (!id) return [];
    try {
      const result = await bankApi.listSupervisionAccounts(id);
      supervisionAccounts.value = result;
      // 推断当前授信乘数 (若已有账户, 取最大授信额度对应企业, 否则默认 1.0)
      const maxBalance = result.reduce((m, a) => Math.max(m, a.balanceCents), 0);
      if (maxBalance > 0) {
        currentCreditLimitCents.value = maxBalance;
      }
      return result;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      console.error('[BankStore] 拉取监管账户失败:', e);
      return [];
    }
  }

  return {
    // state
    currentBankId,
    banks,
    trustProfile,
    riskLetters,
    decisions,
    statistics,
    loading,
    error,
    letterEnterpriseFilter,
    supervisionAccounts,
    currentMultiplier,
    currentCreditLimitCents,
    // actions
    fetchBanks,
    switchBank,
    fetchTrustProfile,
    upgradeStage,
    fetchRiskLetters,
    setLetterEnterpriseFilter,
    generateRiskLetter,
    fetchDecisions,
    submitDecision,
    fetchStatistics,
    loadAll,
    adjustCreditMultiplier,
    freezeAccount,
    fetchSupervisionAccounts,
  };
}, {
  persist: {
    key: 'fintrust-bank',
    storage: localStorage,
    paths: ['currentBankId'],
  },
});
