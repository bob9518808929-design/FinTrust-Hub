/**
 * stores/scf.ts — 供应链金融 (SCF) 引擎状态管理
 *
 * 职责:
 *   1. 管理 SC6/SC7/SC8/SC9/SC10 计算结果与列表
 *   2. 4 个场景预设的一键加载与填表回写
 *   3. SCF↔Reform 联动 (R10 完成 → SC1 画像刷新 → SC8 撮合重算)
 *
 * project_memory 硬约束:
 *   - SC6 定价明细透明可解释 (baseRate/riskPremium/collateralDiscount/finalRate)
 *   - SC7 风险扩散每跳衰减, 不无限放大
 *   - SC8 撮合置信度 < 0.4 的候选过滤掉
 *   - SC9 红/黄/绿三色预警, 红灯必须银行介入
 *   - SC10 案例库四维分类 (行业/产品/规模/结果) + 关键词匹配
 */

import { defineStore } from 'pinia';
import { ref } from 'vue';
import * as scfApi from '@/api/scf';
import type {
  AlertsResult, CaseQuery, CaseRecord, MatchOutput, PricingOutput,
  ReformSyncEvent, ReformSyncResult, RiskPropagationOutput, SCFScenario,
  ScenarioId,
} from '@/api/scf';

export const useScfStore = defineStore('scf', () => {
  // === 状态 ===
  const pricingResult = ref<PricingOutput | null>(null);
  const riskPropagationResult = ref<RiskPropagationOutput | null>(null);
  const matchResults = ref<MatchOutput | null>(null);
  const alerts = ref<AlertsResult | null>(null);
  const cases = ref<CaseRecord[]>([]);
  const scenarios = ref<SCFScenario[]>([]);
  const currentScenario = ref<SCFScenario | null>(null);
  const lastSyncResult = ref<ReformSyncResult | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  // === 通用错误处理 ===
  function _handleError(op: string, e: unknown): void {
    error.value = e instanceof Error ? e.message : String(e);
    console.error(`[ScfStore] ${op} 失败:`, e);
  }

  // === 动作 ===

  /** SC6 加载定价计算 */
  async function loadPricing(input: scfApi.PricingInput): Promise<PricingOutput | null> {
    loading.value = true;
    error.value = null;
    try {
      const result = await scfApi.pricing(input);
      pricingResult.value = result;
      return result;
    } catch (e) {
      _handleError('SC6 定价', e);
      return null;
    } finally {
      loading.value = false;
    }
  }

  /** SC7 加载风险扩散 */
  async function loadRiskPropagation(input: scfApi.RiskPropagationInput): Promise<RiskPropagationOutput | null> {
    loading.value = true;
    error.value = null;
    try {
      const result = await scfApi.riskPropagation(input);
      riskPropagationResult.value = result;
      return result;
    } catch (e) {
      _handleError('SC7 风险扩散', e);
      return null;
    } finally {
      loading.value = false;
    }
  }

  /** SC8 加载撮合结果 (top-K 候选) */
  async function loadMatch(input: scfApi.MatchInput): Promise<MatchOutput | null> {
    loading.value = true;
    error.value = null;
    try {
      const result = await scfApi.match(input);
      matchResults.value = result;
      return result;
    } catch (e) {
      _handleError('SC8 撮合', e);
      return null;
    } finally {
      loading.value = false;
    }
  }

  /** SC9 加载履约监控告警 */
  async function loadAlerts(): Promise<AlertsResult | null> {
    loading.value = true;
    error.value = null;
    try {
      const result = await scfApi.listAlerts();
      alerts.value = result;
      return result;
    } catch (e) {
      _handleError('SC9 履约监控', e);
      return null;
    } finally {
      loading.value = false;
    }
  }

  /** SC10 加载案例库 (支持 行业/产品/规模/结果/关键词 筛选) */
  async function loadCases(query?: CaseQuery): Promise<CaseRecord[]> {
    loading.value = true;
    error.value = null;
    try {
      const result = await scfApi.listCases(query);
      cases.value = result;
      return result;
    } catch (e) {
      _handleError('SC10 案例库', e);
      return [];
    } finally {
      loading.value = false;
    }
  }

  /** SC10 沉淀新案例 */
  async function saveCase(record: CaseRecord): Promise<CaseRecord | null> {
    loading.value = true;
    error.value = null;
    try {
      const result = await scfApi.saveCase(record);
      // 追加到本地列表
      cases.value = [result, ...cases.value];
      return result;
    } catch (e) {
      _handleError('SC10 沉淀案例', e);
      return null;
    } finally {
      loading.value = false;
    }
  }

  /** 加载 4 个场景预设 */
  async function loadScenarios(): Promise<SCFScenario[]> {
    loading.value = true;
    error.value = null;
    try {
      const result = await scfApi.listScenarios();
      scenarios.value = result;
      return result;
    } catch (e) {
      _handleError('加载场景预设', e);
      return [];
    } finally {
      loading.value = false;
    }
  }

  /** 加载单个场景预设 (回写 currentScenario + 返回 prefill) */
  async function loadScenario(scenarioId: ScenarioId): Promise<SCFScenario | null> {
    loading.value = true;
    error.value = null;
    try {
      const result = await scfApi.loadScenario(scenarioId);
      currentScenario.value = result;
      return result;
    } catch (e) {
      _handleError('加载场景预设', e);
      return null;
    } finally {
      loading.value = false;
    }
  }

  /** SCF↔Reform 联动 (接收 reform 完成事件) */
  async function syncFromReform(event: ReformSyncEvent): Promise<ReformSyncResult | null> {
    loading.value = true;
    error.value = null;
    try {
      const result = await scfApi.syncFromReform(event);
      lastSyncResult.value = result;
      // 若联动成功且触发了 rematch, 可选触发本地 match 刷新
      return result;
    } catch (e) {
      _handleError('SCF↔Reform 联动', e);
      return null;
    } finally {
      loading.value = false;
    }
  }

  /** 清空所有计算结果 (切换场景时调用) */
  function reset(): void {
    pricingResult.value = null;
    riskPropagationResult.value = null;
    matchResults.value = null;
    error.value = null;
  }

  return {
    // state
    pricingResult,
    riskPropagationResult,
    matchResults,
    alerts,
    cases,
    scenarios,
    currentScenario,
    lastSyncResult,
    loading,
    error,
    // actions
    loadPricing,
    loadRiskPropagation,
    loadMatch,
    loadAlerts,
    loadCases,
    saveCase,
    loadScenarios,
    loadScenario,
    syncFromReform,
    reset,
  };
}, {
  persist: {
    key: 'fintrust-scf',
    storage: sessionStorage,
    paths: ['currentScenario'],
  },
});
