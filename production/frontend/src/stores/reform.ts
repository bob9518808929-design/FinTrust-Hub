/**
 * stores/reform.ts — 改造引擎状态管理 (R0-R10)
 *
 * 职责:
 *   1. 加载/缓存企业改造状态 (ReformState)
 *   2. 触发 R0 预检 → R1 画像 → R2 差距 → R3 方案 → R4 调度
 *   3. 订阅 R4 调度进度 (SSE/WebSocket 实时推送)
 *   4. R5 执行 / R6 重规划 / R7 合规审核 / R8 监控 / R9 撮合 / R10 案例沉淀
 *
 * project_memory 硬约束:
 *   - 改造前置融资入口锁定 (financingUnlocked=false)
 *   - R7 必须规则引擎, 零幻觉
 *   - R5 超预算 abort
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Id, ReformPrecheck } from '@contracts/common';
import type {
  ReformState, Scorecard8D, GapItem, ReformPhase,
  ReformAction, BankProductMatch, ReformCase,
} from '@contracts/scorecard';
import type { ReformEngineModule, ComplianceCheckResult, ReformMonitorResult, ReformPhaseUpdate } from '@contracts/reform-engine';
import * as reformApi from '@/api/reform';

export const useReformStore = defineStore('reform', () => {
  // === 状态 ===
  const currentEnterpriseId = ref<Id | null>(null);
  const state = ref<ReformState | null>(null);
  // R1 画像 / R2 目标: 独立于 state 跟踪 (state 由后端 R4 启动时才创建;
  // 之前寄生在 state 上导致新企业做完 R1-R3 后流程指引永远卡在 R1)
  const portrait = ref<Scorecard8D | null>(null);
  const gapTarget = ref<Scorecard8D | null>(null);
  const precheck = ref<ReformPrecheck | null>(null);
  const phases = ref<ReformPhase[]>([]);
  const currentPhaseUpdates = ref<ReformPhaseUpdate[]>([]);
  const bankMatches = ref<BankProductMatch[]>([]);
  const lastCase = ref<ReformCase | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  // SSE/WS 订阅句柄
  let progressUnsubscribe: (() => void) | null = null;

  // === 计算属性 ===
  const isReady = computed<boolean>(() => state.value?.status === 'completed');
  const isInProgress = computed<boolean>(() => state.value?.status === 'in_progress');
  const progressPercent = computed<number>(() => Math.round((state.value?.progress ?? 0) * 100));
  const currentLevel = computed(() => state.value?.currentLevel ?? 'D');
  const targetLevel = computed(() => state.value?.targetLevel ?? 'A');

  // === 动作 ===

  /** 加载企业改造状态 (持久化恢复) */
  async function loadReformState(enterpriseId: Id): Promise<ReformState | null> {
    currentEnterpriseId.value = enterpriseId;
    loading.value = true;
    error.value = null;
    try {
      const result = await reformApi.getState(enterpriseId);
      state.value = result;
      // 与持久化 state 对齐 (切换企业/刷新后恢复, 无 state 则清空避免串企业)
      portrait.value = result?.scorecard?.current ?? null;
      gapTarget.value = result?.scorecard?.target ?? null;
      if (result?.phases) {
        phases.value = [...result.phases];
      }
      return result;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      console.error('[ReformStore] 加载改造状态失败:', e);
      return null;
    } finally {
      loading.value = false;
    }
  }

  /** R0 接入意愿评估前置 (project_memory 必须新增) */
  async function runPrecheck(enterpriseId: Id): Promise<ReformPrecheck> {
    const result = await reformApi.precheck(enterpriseId);
    precheck.value = result;
    return result;
  }

  /** R1 全景画像 (零信任, 联动 ECO-01 阅后即焚) */
  async function runFullPortrait(enterpriseId: Id): Promise<Scorecard8D> {
    const scorecard = await reformApi.fullPortrait(enterpriseId);
    portrait.value = scorecard; // 无条件记录 (state 由 R4 才创建, 不能作为唯一载体)
    if (state.value) {
      // 写回 scorecard.current (R1 只读, 通过 store 不可直接修改)
      state.value = { ...state.value, scorecard: { ...state.value.scorecard, current: scorecard } };
    }
    return scorecard;
  }

  /** R2 差距诊断 */
  async function runGapAnalysis(
    current: Scorecard8D,
    aggressionLevel: 'conservative' | 'balanced' | 'innovative',
  ): Promise<{ target: Scorecard8D; gaps: GapItem[] }> {
    const result = await reformApi.gapAnalysis(currentEnterpriseId.value!, current, aggressionLevel);
    gapTarget.value = result.target; // 无条件记录
    if (state.value) {
      state.value = {
        ...state.value,
        scorecard: { ...state.value.scorecard, target: result.target },
      };
    }
    return result;
  }

  /** R3 方案生成 */
  async function runGeneratePlan(
    enterpriseId: Id,
    current: Scorecard8D,
    target: Scorecard8D,
    aggressionLevel: 'conservative' | 'balanced' | 'innovative',
  ): Promise<ReformPhase[]> {
    const result = await reformApi.generatePlan(enterpriseId, current, target, aggressionLevel);
    phases.value = [...result];
    return result;
  }

  /** R4 调度执行: 调后端 start 持久化 state + 订阅进度轮询 */
  async function startSchedule(): Promise<void> {
    if (!currentEnterpriseId.value) {
      throw new Error('未选择企业');
    }
    if (!state.value && phases.value.length === 0) {
      // 注意: 不能要求 state 已存在 — state 恰恰是 R4 启动后端才创建的 (鸡生蛋)
      // 后端 start 内部会重跑 R0→R1→R2→R3, 只要有方案或旧 state 即可启动
      throw new Error('改造方案未生成, 无法调度');
    }
    // 调后端 R4 start: 持久化 ReformState, 后端内部会重跑 R0→R1→R2→R3 保证 state 完整
    const started = await reformApi.startReform(currentEnterpriseId.value, 'balanced');
    // 用后端返回的 state 同步前端 (保证 phases id 一致, 轮询能匹配)
    state.value = started;
    phases.value = [...(started.phases ?? [])];
    // 清空旧进度
    currentPhaseUpdates.value = [];
    progressUnsubscribe = reformApi.subscribeProgress(
      currentEnterpriseId.value,
      (update: ReformPhaseUpdate) => {
        currentPhaseUpdates.value.push(update);
        const idx = phases.value.findIndex((p) => p.id === update.phaseId);
        if (idx >= 0) {
          phases.value[idx] = {
            ...phases.value[idx]!,
            progress: update.progress,
            status: update.phaseStatus,
          };
          // 轮询携带的动作执行产物 (子引擎业务结果) 合并进 phases → 时间线展示
          if (update.actions && update.actions.length > 0) {
            const actions = [...(phases.value[idx]!.actions ?? [])];
            for (const ua of update.actions) {
              const ai = actions.findIndex((a) => a.id === ua.id);
              if (ai >= 0) {
                actions[ai] = { ...actions[ai]!, status: ua.status, result: ua.result ?? actions[ai]!.result, evidence: ua.evidence ?? actions[ai]!.evidence, cost: ua.cost ?? actions[ai]!.cost, completedAt: ua.completedAt ?? actions[ai]!.completedAt };
              } else {
                actions.push(ua as unknown as typeof actions[number]);
              }
            }
            phases.value[idx] = { ...phases.value[idx]!, actions };
          }
        }
        if (state.value) {
          const prevCompletedAt = state.value.completedAt;
          state.value = {
            ...state.value,
            progress: update.overallProgress,
            // 轮询携带 stateStatus: completed 时推进流程指引 ⑥→⑦
            status: (update.stateStatus as ReformState['status']) ?? state.value.status,
            completedAt: update.stateStatus === 'completed' ? new Date().toISOString() : prevCompletedAt,
          };
        }
      },
    );
  }

  /** 停止 R4 调度 */
  function stopSchedule(): void {
    if (progressUnsubscribe) {
      progressUnsubscribe();
      progressUnsubscribe = null;
    }
  }

  /** R5 执行单个动作 */
  async function executeAction(
    action: ReformAction,
    context: Parameters<ReformEngineModule['R5_executeAction']>[1],
  ): Promise<{ success: boolean; result?: unknown; error?: string }> {
    try {
      const result = await reformApi.executeAction(currentEnterpriseId.value!, action, context);
      return { success: result.success, result };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, error: msg };
    }
  }

  /** R6 动态重规划 */
  async function replan(
    trigger: Parameters<ReformEngineModule['R6_replan']>[1],
  ): Promise<{ newPhases: readonly ReformPhase[]; impact: unknown }> {
    if (!state.value) throw new Error('无活跃改造状态');
    const result = await reformApi.replan(currentEnterpriseId.value!, state.value, trigger);
    phases.value = [...result.newPhases];
    return result;
  }

  /** R7 合规审核 (规则引擎, 零幻觉) */
  async function complianceCheck(
    action: ReformAction,
  ): Promise<ComplianceCheckResult> {
    if (!state.value) throw new Error('无活跃改造状态');
    return await reformApi.complianceCheck(currentEnterpriseId.value!, action, state.value);
  }

  /** R8 监控 */
  async function monitorProgress(): Promise<ReformMonitorResult> {
    if (!currentEnterpriseId.value) throw new Error('无企业');
    return await reformApi.monitorProgress(currentEnterpriseId.value);
  }

  /** R9 银行撮合 */
  async function bankMatch(): Promise<BankProductMatch[]> {
    if (!currentEnterpriseId.value) throw new Error('无企业');
    const result = await reformApi.bankMatch(currentEnterpriseId.value);
    bankMatches.value = [...result];
    return result;
  }

  /** R10 案例沉淀 */
  async function storeCase(
    outcome: 'success' | 'abandoned' | 'failed',
  ): Promise<ReformCase> {
    if (!currentEnterpriseId.value) throw new Error('无企业');
    const result = await reformApi.storeCase(currentEnterpriseId.value, outcome);
    lastCase.value = result;
    return result;
  }

  /** 暂停改造 */
  async function pause(): Promise<void> {
    if (!currentEnterpriseId.value) return;
    await reformApi.pause(currentEnterpriseId.value);
    if (state.value) {
      state.value = { ...state.value, status: 'paused' };
    }
  }

  /** 恢复改造 */
  async function resume(): Promise<void> {
    if (!currentEnterpriseId.value) return;
    await reformApi.resume(currentEnterpriseId.value);
    if (state.value) {
      state.value = { ...state.value, status: 'in_progress' };
    }
  }

  /** 放弃改造 */
  async function abandon(reason: string): Promise<void> {
    if (!currentEnterpriseId.value) return;
    await reformApi.abandon(currentEnterpriseId.value, reason);
    if (state.value) {
      state.value = { ...state.value, status: 'abandoned' };
    }
    stopSchedule();
  }

  // === 运营态状态 (审批/机构/AI操作，供 Tab3/5/6/7 使用) ===
  const approvalQueue = ref<any[]>([]);
  const aiOperations = ref<any[]>([]);
  const banks = ref<any[]>([]);
  const guarantors = ref<any[]>([]);
  const insurers = ref<any[]>([]);

  // === 本地降级种子数据 (后端不可用时兜底, project_memory: C档独立兜底) ===
  const SEED_BANKS = [
    { id: 'B-ICBC', name: '工商银行', type: '国有大行', baseRate: 4.1, maxAmountMultiplier: 2.0 },
    { id: 'B-CMB', name: '招商银行', type: '股份制', baseRate: 4.5, maxAmountMultiplier: 1.8 },
    { id: 'B-CMBC', name: '民生银行', type: '股份制', baseRate: 4.8, maxAmountMultiplier: 1.6 },
  ];
  const SEED_GUARANTORS = [
    { id: 'G-01', name: '深圳高新投担保', guaranteeRate: 1.5, maxCoverage: 0.8 },
    { id: 'G-02', name: '广东融资再担保', guaranteeRate: 1.2, maxCoverage: 0.7 },
  ];
  const SEED_INSURERS = [
    { id: 'I-01', name: '人保财险', insuranceType: '应收账款违约险', premiumRate: 0.6 },
    { id: 'I-02', name: '平安产险', insuranceType: '应收账款违约险', premiumRate: 0.65 },
  ];

  /** 加载审批队列 (Tab3) */
  async function loadApprovalQueue(): Promise<void> {
    try {
      approvalQueue.value = await reformApi.listApprovals();
    } catch {
      approvalQueue.value = [];
    }
  }
  /** 审批决策 (Tab3: approve/reject/return) */
  async function decideApproval(reqId: string, decision: string): Promise<void> {
    await reformApi.decideApproval(reqId, decision);
    const idx = approvalQueue.value.findIndex((q) => q.id === reqId);
    if (idx >= 0) {
      approvalQueue.value[idx] = {
        ...approvalQueue.value[idx],
        status: decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'returned',
        decision: decision,
        decidedAt: new Date().toISOString(),
      };
    }
  }
  /** 加载金融机构 (银行/担保/保险, Tab5/6) */
  async function loadBanks(): Promise<void> {
    try { banks.value = await reformApi.listBanks(); } catch { banks.value = SEED_BANKS; }
  }
  async function loadInstitutions(): Promise<void> {
    try {
      const [g, i] = await Promise.all([reformApi.listGuarantors(), reformApi.listInsurers()]);
      guarantors.value = g; insurers.value = i;
    } catch { guarantors.value = SEED_GUARANTORS; insurers.value = SEED_INSURERS; }
  }
  /** 担保流程 (Tab5) */
  async function applyGuarantee(eid: Id): Promise<void> { await reformApi.applyGuarantee(eid); }
  async function preTrialGuarantee(eid: Id): Promise<void> { await reformApi.preTrialGuarantee(eid); }
  async function triggerCompensation(eid: Id): Promise<void> { await reformApi.triggerCompensation(eid); }
  /** 保险流程 (Tab5) */
  async function applyInsurance(eid: Id): Promise<void> { await reformApi.applyInsurance(eid); }
  async function underwrite(eid: Id): Promise<void> { await reformApi.underwrite(eid); }
  async function triggerClaim(eid: Id): Promise<void> { await reformApi.triggerClaim(eid); }
  /** AI 操作日志 (Tab7) */
  async function loadAiOperations(): Promise<void> {
    try { aiOperations.value = await reformApi.listAiOperations(); } catch { aiOperations.value = []; }
  }

  return {
    // state
    currentEnterpriseId,
    state,
    precheck,
    portrait,
    gapTarget,
    phases,
    currentPhaseUpdates,
    bankMatches,
    lastCase,
    loading,
    error,
    approvalQueue,
    aiOperations,
    banks,
    guarantors,
    insurers,
    // getters
    isReady,
    isInProgress,
    progressPercent,
    currentLevel,
    targetLevel,
    // actions
    loadReformState,
    runPrecheck,
    runFullPortrait,
    runGapAnalysis,
    runGeneratePlan,
    startSchedule,
    stopSchedule,
    executeAction,
    replan,
    complianceCheck,
    monitorProgress,
    bankMatch,
    storeCase,
    pause,
    resume,
    abandon,
    loadApprovalQueue,
    decideApproval,
    loadBanks,
    loadInstitutions,
    applyGuarantee,
    preTrialGuarantee,
    triggerCompensation,
    applyInsurance,
    underwrite,
    triggerClaim,
    loadAiOperations,
  };
}, {
  persist: {
    key: 'fintrust-reform',
    storage: sessionStorage,
    paths: ['currentEnterpriseId'],
  },
});
