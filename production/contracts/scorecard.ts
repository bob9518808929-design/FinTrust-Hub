/**
 * scorecard.ts — 8 维评分卡 + 改造状态类型契约
 *
 * 设计依据: spec.md L3533-3596 (reform-engine-contracts.ts 原始定义)
 * 适用层: frontend / backend / db / R1-R10 引擎实现
 *
 * 关键不变式:
 *   1. Scorecard8D 各维度 0-100, 边界含端点
 *   2. ReformPhase.weight 各 phase 之和 = 1.0
 *   3. ReformPhase.dimension 取值必须属于 Scorecard8D 的 8 个键
 *   4. autonomyLevel: L4 全自动 / L3 建议决策 / L2 建议留痕 (注意: 与 AI 自主度反向)
 *      spec L3590-3593: L4 全自动 = AI 操作; L3 = AI 建议+人工批准; L2 = AI 建议+人工操作+AI 审核结果
 *   5. complianceCheck: green/yellow/red/pending, 由 R7 规则引擎输出, 零幻觉
 */

import type {
  Id, IsoTimestamp, AmountInCents, Ratio, Percentage,
  ReformLevel, AutonomyLevel, Score,
} from './common';

// ============================================================================
// 1. 8 维评分卡 (spec L3551-3560)
// ============================================================================

/** 8 维评分卡维度键 (spec L3543-3559, L3568 dimension 字段) */
export type ScorecardDimension =
  | 'subject'     // 主体资质
  | 'finance'     // 财务健康
  | 'tax'         // 税务合规
  | 'business'    // 业务真实性
  | 'assets'      // 资产质量
  | 'credit'      // 信用穿透
  | 'policy'      // 政策适配
  | 'capital';    // 资本结构

/** 8 维评分卡 (spec L3551-3560) */
export interface Scorecard8D {
  readonly subject: Score;       // 主体 0-100
  readonly finance: Score;       // 财务 0-100
  readonly tax: Score;           // 税务 0-100
  readonly business: Score;      // 业务真实性 0-100
  readonly assets: Score;        // 资产 0-100
  readonly credit: Score;        // 信用 0-100
  readonly policy: Score;        // 政策 0-100
  readonly capital: Score;       // 资本 0-100
}

/** 评分卡键的可读标签 (UI 显示用) */
export type ScorecardLabels = Readonly<Record<ScorecardDimension, string>>;

/** 评分差项 (spec L3602 R2_gapAnalysis 返回) */
export interface GapItem {
  readonly dimension: ScorecardDimension;
  readonly current: Score;
  readonly target: Score;
  readonly delta: number;                  // target - current, 正数=需提升
  readonly severity: 'low' | 'medium' | 'high' | 'critical';
  readonly suggestedActions: readonly string[];   // R3 建议的改造动作描述
  readonly estimatedDays: number;
  readonly estimatedCost: AmountInCents;
}

// ============================================================================
// 2. 改造动作 (spec L3578-3596)
// ============================================================================

/** 改造动作状态 (spec L3585) */
export type ReformActionStatus =
  | 'pending'
  | 'executing'
  | 'completed'
  | 'blocked'
  | 'failed';

/** 合规审核结论 (spec L3595, 由 R7 规则引擎输出, 非 LLM, 零幻觉) */
export type ComplianceLevel = 'green' | 'yellow' | 'red' | 'pending';

/** 改造动作引用 (用于 EnterpriseReformState.completedActions, 轻量引用) */
export interface ReformActionRef {
  readonly actionId: Id;
  readonly name: string;
  readonly completedAt: IsoTimestamp;
}

/** 改造动作 (spec L3578-3596 完整定义) */
export interface ReformAction {
  readonly id: Id;
  readonly phaseId: Id;
  readonly name: string;
  readonly description: string;
  readonly dimension: ScorecardDimension;
  readonly engine: string;                 // R5-A ~ R5-H
  status: ReformActionStatus;              // 可变 (执行中→完成)
  readonly startedAt?: IsoTimestamp;
  readonly completedAt?: IsoTimestamp;
  readonly result?: string;
  readonly cost?: AmountInCents;
  /** 子引擎执行产物证据 (账户号/链上交易哈希/报告编号), R5 完成后填充 */
  readonly evidence?: readonly string[];
  /** spec L3590-3593 自主度语义:
   *  L4 全自动: AI 操作, 仅战略节点跳转 L3 申请人工审核
   *  L3 建议决策: AI 建议 + 人工批准后执行
   *  L2 建议留痕: AI 建议 + 人工操作 + AI 审核结果
   *  注意: 与 AI 自主度等级 (L1-L4) 反向, 这里 L4 最高
   */
  readonly autonomyLevel: AutonomyLevel;
  complianceCheck: ComplianceLevel;        // 可变 (pending→green/yellow/red)
}

// ============================================================================
// 3. 改造阶段 (spec L3562-3576)
// ============================================================================

/** 改造阶段状态 (spec L3569) */
export type ReformPhaseStatus =
  | 'pending'
  | 'executing'
  | 'completed'
  | 'blocked'
  | 'failed';

/** 改造阶段 (spec L3562-3576) */
export interface ReformPhase {
  readonly id: Id;
  readonly name: string;
  readonly description: string;
  readonly weight: Ratio;                   // 0-1, 所有 phase 之和 = 1
  progress: Ratio;                          // 0-1, 可变
  readonly dimension: ScorecardDimension;
  status: ReformPhaseStatus;                // 可变
  readonly estimatedDays: number;
  readonly actualDays?: number;
  readonly cost?: AmountInCents;
  readonly engine: string;                  // R1-R10 中负责调度此 phase 的引擎
  readonly autonomyLevel: AutonomyLevel;
  readonly actions?: readonly ReformAction[];
}

// ============================================================================
// 4. 改造整体状态 (spec L3533-3549)
// ============================================================================

/** 改造整体状态 (spec L3535) */
export type ReformStatus =
  | 'idle'
  | 'in_progress'
  | 'paused'
  | 'abandoned'
  | 'completed';

/** 改造激进程度 (spec L3539) */
export type AggressionLevel = 'conservative' | 'balanced' | 'innovative';

/** 改造整体状态 (spec L3533-3549, R1-R10 的工作内存对象) */
export interface ReformState {
  readonly enterpriseId: Id;
  status: ReformStatus;                     // 可变
  progress: Ratio;                          // 0-1, 可变
  currentLevel: ReformLevel;
  targetLevel: ReformLevel;
  readonly aggressionLevel: AggressionLevel;
  readonly startedAt?: IsoTimestamp;
  readonly completedAt?: IsoTimestamp;
  readonly planId?: Id;
  readonly scorecard: {
    readonly current: Scorecard8D;
    readonly target?: Scorecard8D;
  };
  readonly phases?: readonly ReformPhase[];
  readonly completedActions?: readonly ReformAction[];
}

// ============================================================================
// 5. 改造执行上下文与结果 (spec L3608 R5_executeAction 入参 / 返回)
// ============================================================================

/** 改造触发器 (spec L3610 R6_replan 入参) */
export type ReformTriggerKind =
  | 'action_failed'              // 动作执行失败
  | 'action_blocked'             // 合规审核阻断
  | 'monthly_data_update'        // 月度数据更新 (R1 重新画像)
  | 'policy_change'              // 政策变化 (MOD-10)
  | 'enterprise_request'         // 企业主动调整
  | 'external_event';            // 外部事件 (抽逃/冻结/IoT 断线)

export interface ReformTrigger {
  readonly kind: ReformTriggerKind;
  readonly source: string;                  // 触发源 (engine id / 用户操作 / 系统)
  readonly message: string;
  readonly occurredAt: IsoTimestamp;
  readonly affectedDimension?: ScorecardDimension;
  readonly evidence?: readonly string[];
}

/** 改造执行上下文 (spec L3608 R5_executeAction 第二入参) */
export interface ReformContext {
  readonly state: ReformState;
  readonly enterpriseId: Id;
  readonly budgetLimit: AmountInCents;       // 预算上限 (project_memory Tier-2 控本)
  readonly tier: 'tier1' | 'tier2';         // 当前数据采集档位
  readonly auditUser?: Id;                  // L2/L3 模式下审批人
}

/** 改造动作执行结果 (spec L3608 R5_executeAction 返回) */
export interface ReformActionResult {
  readonly actionId: Id;
  readonly success: boolean;
  readonly status: ReformActionStatus;
  readonly result?: string;
  readonly cost?: AmountInCents;
  readonly durationMs: number;
  readonly evidence: readonly string[];      // 执行证据 (用于 R10 案例沉淀)
  readonly nextActionId?: Id;                // 链式调度下一动作
}

// ============================================================================
// 6. 重规划影响评估 (spec L3610 R6_replan 返回)
// ============================================================================

/** 重规划影响评估 (spec L3610 R6_replan 返回 impact) */
export interface ReformImpact {
  readonly deltaProgress: Ratio;             // 进度变化 (-1 ~ +1)
  readonly deltaCost: AmountInCents;         // 成本变化
  readonly deltaDays: number;                // 工期变化
  readonly affectedPhases: readonly Id[];   // 受影响的 phase id 列表
  readonly riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

/** R6 重规划返回 (spec L3610) */
export interface ReformReplanResult {
  readonly newPhases: readonly ReformPhase[];
  readonly impact: ReformImpact;
  readonly replanReason: string;
}

// ============================================================================
// 7. 里程碑与告警 (spec L3614 R8_monitorProgress 返回)
// ============================================================================

/** 改造里程碑 (spec L3614 R8_monitorProgress 返回) */
export interface Milestone {
  readonly id: Id;
  readonly name: string;
  readonly plannedDate: IsoTimestamp;
  readonly actualDate?: IsoTimestamp;
  readonly status: 'pending' | 'achieved' | 'missed' | 'at_risk';
  readonly phaseId?: Id;
}

/** 告警级别 (spec L3614 R8_monitorProgress 返回 alerts) */
export type AlertSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface Alert {
  readonly id: Id;
  readonly severity: AlertSeverity;
  readonly kind: string;                    // budget_overrun / phase_delayed / compliance_red / data_gap
  readonly message: string;
  readonly phaseId?: Id;
  readonly actionId?: Id;
  readonly raisedAt: IsoTimestamp;
  readonly acknowledgedAt?: IsoTimestamp;
}

/** R8 监控返回 (spec L3614) */
export interface ReformMonitorResult {
  readonly milestones: readonly Milestone[];
  readonly alerts: readonly Alert[];
  readonly overallProgress: Ratio;
  readonly estimatedCompletionAt?: IsoTimestamp;
}

// ============================================================================
// 8. 银行撮合结果 (spec L3616 R9_bankMatch 返回)
// ============================================================================

/** 银行产品匹配结果 (spec L3616 R9_bankMatch 返回) */
export interface BankProductMatch {
  readonly bankId: Id;
  readonly bankName: string;
  readonly productCode: string;
  readonly productName: string;
  readonly matchedAmount: AmountInCents;
  readonly offeredRate: Percentage;
  readonly requiresGuarantee: boolean;
  readonly matchScore: Ratio;                // 0-1, 越高越匹配
  readonly matchReasons: readonly string[]; // 匹配原因 (R9 输出)
  readonly estimatedApprovalDays: number;
}

// ============================================================================
// 9. 改造案例沉淀 (spec L3618 R10_storeCase)
// ============================================================================

/** 改造案例结果 (spec L3618 R10_storeCase 第二入参) */
export type ReformOutcome = 'success' | 'abandoned' | 'failed';

/** 改造案例 (R10 案例库条目, 用于知识图谱+向量检索) */
export interface ReformCase {
  readonly caseId: Id;
  readonly enterpriseId: Id;
  readonly industry: string;
  readonly outcome: ReformOutcome;
  readonly beforeScorecard: Scorecard8D;
  readonly afterScorecard: Scorecard8D | null;
  readonly totalDays: number;
  readonly totalCost: AmountInCents;
  readonly totalActions: number;
  readonly topLevelReached: ReformLevel | null;
  readonly storedAt: IsoTimestamp;
  readonly signature: string;               // 案例指纹 (哈希), 防篡改
}
