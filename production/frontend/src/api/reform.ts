/**
 * api/reform.ts — 改造引擎 R0-R10 API 调用
 *
 * 实现说明:
 *   - R4 调度进度通过 SSE 订阅 (EventSource 或 fetch ReadableStream)
 *   - 其他 R0-R3, R5-R10 通过 REST API
 *   - 所有方法返回 Promise, 与 contracts/reform-engine.ts ReformEngineModule 对齐
 */

import type { Id, ReformPrecheck } from '@contracts/common';
import type {
  ReformState, Scorecard8D, GapItem, ReformPhase, ReformAction, ReformContext,
  ReformActionResult, ReformReplanResult, ReformMonitorResult, BankProductMatch, ReformCase,
} from '@contracts/scorecard';
import type { ReformTrigger, ComplianceCheckResult, ReformPhaseUpdate } from '@contracts/reform-engine';
import { get, post } from './client';

// === R0 接入意愿评估前置 ===
export async function precheck(enterpriseId: Id): Promise<ReformPrecheck> {
  return post<ReformPrecheck>(`/reform/${enterpriseId}/precheck`, {});
}

// === R1 全景画像 ===
// timeout 65000: A 档 LLM 深度画像 (DeepSeek) 需 2-10s, 默认 8s 会切断;
// 与 vite proxyTimeout 对齐, LLM 不可用时后端即时降级, 不依赖超时
export async function fullPortrait(enterpriseId: Id): Promise<Scorecard8D> {
  return post<Scorecard8D>(`/reform/${enterpriseId}/portrait`, {}, { timeout: 65000 });
}

// === R2 差距诊断 ===
export async function gapAnalysis(
  enterpriseId: Id,
  current: Scorecard8D,
  aggressionLevel: 'conservative' | 'balanced' | 'innovative',
): Promise<{ target: Scorecard8D; gaps: GapItem[] }> {
  return post<{ target: Scorecard8D; gaps: GapItem[] }>(
    `/reform/${enterpriseId}/gap-analysis`,
    { current, aggressionLevel },
  );
}

// === R3 方案生成 ===
// timeout 65000: R3 内含 DeepSeek 方案编排 (2-10s), 默认 8s 会切断 —
// 表现为工作台 R1 成功后卡住 ("画像/方案生成失败: timeout of 8000ms exceeded")
export async function generatePlan(
  enterpriseId: Id,
  current: Scorecard8D,
  target: Scorecard8D,
  aggressionLevel: 'conservative' | 'balanced' | 'innovative',
): Promise<ReformPhase[]> {
  return post<ReformPhase[]>(
    `/reform/${enterpriseId}/plan`,
    { current, target, aggressionLevel },
    { timeout: 65000 },
  );
}

// === R4 启动改造 ===
// timeout 65000: R4 串联 R1→R2→R3, R3 方案编排接 DeepSeek (2-10s), 默认 8s 会切断
export async function startReform(
  enterpriseId: Id,
  aggressionLevel: 'conservative' | 'balanced' | 'innovative' = 'balanced',
): Promise<ReformState> {
  return post<ReformState>(`/reform/${enterpriseId}/start`, { aggression_level: aggressionLevel }, { timeout: 65000 });
}

// === R4 进度订阅 (纯轮询, 后端无 SSE 端点, EventSource 会导致 404 Pending) ===
export function subscribeProgress(
  enterpriseId: Id,
  onUpdate: (update: ReformPhaseUpdate) => void,
): () => void {
  let closed = false;
  // 立即跑一次, 不等第一个 interval
  (async () => {
    if (closed) return;
    try {
      const updates = await get<ReformPhaseUpdate[]>(
        `/reform/${enterpriseId}/schedule/updates`,
      );
      updates.forEach(onUpdate);
    } catch (e) {
      console.error('[ReformApi] 轮询调度进度失败:', e);
    }
  })();

  const timer = window.setInterval(async () => {
    if (closed) return;
    try {
      const updates = await get<ReformPhaseUpdate[]>(
        `/reform/${enterpriseId}/schedule/updates`,
      );
      updates.forEach(onUpdate);
    } catch (e) {
      console.error('[ReformApi] 轮询调度进度失败:', e);
    }
  }, 3000);
  return () => {
    closed = true;
    window.clearInterval(timer);
  };
}

// === R5 执行单个动作 ===
export async function executeAction(
  enterpriseId: Id,
  action: ReformAction,
  context: ReformContext,
): Promise<ReformActionResult> {
  return post<ReformActionResult>(`/reform/${enterpriseId}/actions/${action.id}/execute`, { action, context });
}

// === R6 动态重规划 ===
// timeout 65000: replan 内部重跑 R3 (含 LLM 编排 2-10s)
export async function replan(
  enterpriseId: Id,
  state: ReformState,
  trigger: ReformTrigger,
): Promise<ReformReplanResult> {
  return post<ReformReplanResult>(`/reform/${enterpriseId}/replan`, { state, trigger }, { timeout: 65000 });
}

// === R7 合规审核 ===
export async function complianceCheck(
  enterpriseId: Id,
  action: ReformAction,
  state: ReformState,
): Promise<ComplianceCheckResult> {
  return post<ComplianceCheckResult>(`/reform/${enterpriseId}/actions/${action.id}/compliance`, { action, state });
}

// === R8 进度监控 ===
export async function monitorProgress(enterpriseId: Id): Promise<ReformMonitorResult> {
  return get<ReformMonitorResult>(`/reform/${enterpriseId}/monitor`);
}

// === R9 银行撮合 ===
export async function bankMatch(enterpriseId: Id): Promise<BankProductMatch[]> {
  return post<BankProductMatch[]>(`/reform/${enterpriseId}/bank-match`);
}

// === R10 案例沉淀 ===
export async function storeCase(
  enterpriseId: Id,
  outcome: 'success' | 'abandoned' | 'failed',
): Promise<ReformCase> {
  return post<ReformCase>(`/reform/${enterpriseId}/store-case`, { outcome });
}

// === 生命周期 ===
export async function getState(enterpriseId: Id): Promise<ReformState | null> {
  try {
    return await get<ReformState | null>(`/reform/${enterpriseId}/state`);
  } catch {
    return null;
  }
}

export async function pause(enterpriseId: Id): Promise<void> {
  await post(`/reform/${enterpriseId}/pause`, {});
}

export async function resume(enterpriseId: Id): Promise<void> {
  await post(`/reform/${enterpriseId}/resume`, {});
}

export async function abandon(enterpriseId: Id, reason: string): Promise<void> {
  await post(`/reform/${enterpriseId}/abandon`, { reason });
}

// === 运营态 API (Tab3/5/6/7 用) ===

/** 审批队列 (Tab3) */
export async function listApprovals(): Promise<any[]> {
  return get<any[]>('/approvals');
}
/** 审批决策 (Tab3) */
export async function decideApproval(reqId: string, decision: string): Promise<void> {
  await post(`/approvals/${reqId}/decide`, { decision });
}
/** 银行列表 (Tab6) */
export async function listBanks(): Promise<any[]> {
  return get<any[]>('/banks');
}
/** 担保公司列表 (Tab5) */
export async function listGuarantors(): Promise<any[]> {
  return get<any[]>('/guarantors');
}
/** 保险公司列表 (Tab5) */
export async function listInsurers(): Promise<any[]> {
  return get<any[]>('/insurers');
}
/** 担保申请 (Tab5) */
export async function applyGuarantee(enterpriseId: Id): Promise<void> {
  await post(`/institutions/guarantee/${enterpriseId}/apply`, {});
}
/** 担保保前审查 (Tab5) */
export async function preTrialGuarantee(enterpriseId: Id): Promise<void> {
  await post(`/institutions/guarantee/${enterpriseId}/pre-trial`, {});
}
/** 触发代偿 (Tab5) */
export async function triggerCompensation(enterpriseId: Id): Promise<void> {
  await post(`/institutions/guarantee/${enterpriseId}/compensate`, {});
}
/** 投保 (Tab5) */
export async function applyInsurance(enterpriseId: Id): Promise<void> {
  await post(`/institutions/insurance/${enterpriseId}/apply`, {});
}
/** 核保 (Tab5) */
export async function underwrite(enterpriseId: Id): Promise<void> {
  await post(`/institutions/insurance/${enterpriseId}/underwrite`, {});
}
/** 理赔 (Tab5) */
export async function triggerClaim(enterpriseId: Id): Promise<void> {
  await post(`/institutions/insurance/${enterpriseId}/claim`, {});
}
/** AI 操作日志 (Tab7) */
export async function listAiOperations(): Promise<any[]> {
  return get<any[]>('/cockpit/operations');
}
