/**
 * reform-engine.ts — 改造引擎 R0-R10 接口契约 (MOD-16 系列)
 *
 * 设计依据:
 *   - spec.md L3527-3620 reform-engine-contracts.ts 原始定义
 *   - spec.md L3514-3525 改造引擎新增技术栈扩展
 *   - project_memory "MOD-16.0 必须新增 '接入意愿评估' 前置" 硬约束 (R0)
 *   - project_memory "R5 执行器需分为 8 类 (R5-A~R5-H)" 硬约束
 *
 * 实施分期对齐 (spec L3624+ 实施分期建议):
 *   P0: R0 + R1 + R2 + R7 + R8 (诊断变现, 不执行 R5)
 *   P1: 银行 L4 只读模式 (INFRA-05 无接口适配器)
 *   P2: R3 + R4 + R5 + R6 + R9 + R10 (全自动改造 + 撮合 + 案例沉淀)
 *
 * 实现注意:
 *   1. 所有方法 async, 返回 Promise (R4 是 AsyncGenerator)
 *   2. 任何引擎不得直接修改 ReformState.scorecard.current (R1 只读)
 *   3. R7 必须是规则引擎, 非 LLM, 零幻觉, 可审计
 *   4. R5 执行需消费 context.budgetLimit, 超预算必须 abort
 *   5. R10 案例沉淀必须计算 signature 防篡改
 */

import type {
  Id, IsoTimestamp, AmountInCents, Ratio,
  AutonomyLevel,
} from './common';
import type {
  Scorecard8D, ScorecardDimension, GapItem,
  ReformState, ReformPhase, ReformAction, ReformActionStatus,
  ReformContext, ReformActionResult, ReformTrigger, ReformReplanResult,
  ReformMonitorResult, BankProductMatch, ReformCase, ReformOutcome,
  ComplianceLevel, AggressionLevel,
} from './scorecard';
import type { ReformPrecheck } from './common';

// Re-export types that consumers expect from this module
export type {
  ReformTrigger, ReformReplanResult, ReformMonitorResult,
  ReformPrecheck,
};

// ============================================================================
// 1. R5 执行器子族标识 (project_memory 硬约束: 8 类 R5-A~R5-H)
// ============================================================================

/**
 * R5 执行器 8 类 (project_memory 硬约束)
 * 对齐 spec L3520 "任务执行 (R5-A~H) + INFRA-01b 适配层"
 * 对齐 project_memory "R5 执行器需分为 8 类 (R5-A~R5-H), 对应主体/财务/税务/业务/资产/信用/政策/资本改造"
 */
export type R5ExecutorKind =
  | 'R5-A'   // 主体改造 (主体资质提升: 法人/股权/治理结构)
  | 'R5-B'   // 财务改造 (账套规范化/审计对接)
  | 'R5-C'   // 税务修复 (补税/滞纳金/合规化)
  | 'R5-D'   // 业务改造 (业务真实性补强/合同/发票补全)
  | 'R5-E'   // 资产改造 (押品确权/资产盘点)
  | 'R5-F'   // 信用修复 (征信纠错/诉讼结案/失信修复)
  | 'R5-G'   // 政策适配 (高新/专精特新认定申请, 对齐 spec GREEN-010)
  | 'R5-H';  // 资本改造 (股权融资/引入战投)

/** 改造动作执行器映射 (dimension -> R5 子族) */
export const DIMENSION_TO_R5: Readonly<Record<ScorecardDimension, R5ExecutorKind>> = Object.freeze({
  subject: 'R5-A',
  finance: 'R5-B',
  tax: 'R5-C',
  business: 'R5-D',
  assets: 'R5-E',
  credit: 'R5-F',
  policy: 'R5-G',
  capital: 'R5-H',
});

// ============================================================================
// 2. R4 调度器迭代产物 (spec L3606 AsyncGenerator<ReformPhaseUpdate>)
// ============================================================================

/** R4 调度器单步更新 (spec L3606 AsyncGenerator<ReformPhaseUpdate>) */
/** R4 轮询携带的动作执行产物 (子引擎真实业务结果, 随 updates 送达前端时间线) */
export interface ReformActionUpdate {
  readonly id: Id;
  readonly name: string;
  readonly status: ReformActionStatus;
  readonly result?: string | null;
  readonly evidence?: readonly string[];
  readonly cost?: AmountInCents | null;
  readonly completedAt?: IsoTimestamp | null;
}

export interface ReformPhaseUpdate {
  readonly phaseId: Id;
  readonly phaseName: string;
  readonly phaseStatus: ReformPhase['status'];
  readonly actionId?: Id;
  readonly actionName?: string;
  readonly actionStatus?: ReformActionStatus;
  readonly progress: Ratio;                 // 当前 phase 进度 0-1
  readonly overallProgress: Ratio;          // 总体进度 0-1
  readonly autonomyLevel: AutonomyLevel;
  readonly complianceLevel: ComplianceLevel;
  readonly timestamp: IsoTimestamp;
  readonly message?: string;
  readonly needHumanApproval?: boolean;     // L3 模式下是否需要人工审批
  /** 轮询端点 (SSE fallback) 附带: 该 phase 全部动作的执行产物详情 */
  readonly actions?: readonly ReformActionUpdate[];
  /** 轮询端点附带: ReformState.status (in_progress/paused/completed/abandoned) */
  readonly stateStatus?: string;
}

// ============================================================================
// 3. R7 合规审核输出 (spec L3612)
// ============================================================================

/** R7 合规审核结论 (spec L3612 R7_complianceCheck 返回) */
export interface ComplianceCheckResult {
  readonly level: ComplianceLevel;
  readonly ruleId: Id;                       // 命中规则 ID (RED-001 ~ RED-008 / YELLOW-001+ / GREEN-001+)
  readonly ruleText: string;                // 规则原文 (可审计, 非幻觉)
  readonly evidence: readonly string[];      // 证据链 (脱敏后)
  readonly suggestedAction?: string;        // 建议处理方式 (yellow/red 必填)
  readonly legalBasis?: string;              // 法律条文依据
  readonly checkedAt: IsoTimestamp;
}

// ============================================================================
// 4. MOD-16 系列统一接口 (spec L3598-3619 完整对齐 + R0 前置扩展)
// ============================================================================

/**
 * ReformEngineModule — 改造引擎统一接口 (MOD-16 系列)
 *
 * spec L3598 原文: "MOD-16 系列统一接口定义, 所有实现必须遵守此契约"
 * project_memory 扩展: 必须新增 R0 接入意愿评估前置 (MOD-16.0)
 */
export interface ReformEngineModule {
  /** 引擎版本 */
  readonly version: string;
  /** 引擎实例 ID (多租户/多实例隔离) */
  readonly instanceId: Id;

  // -------------------------------------------------------------
  // R0: 接入意愿评估前置 (project_memory 必须新增, MOD-16.0)
  // -------------------------------------------------------------
  /**
   * 接入意愿评估 + 改造可行性预检
   * 触发场景: 企业首次接入 / 月度回访 / 政策重大变更
   * 返回 ReformPrecheck, 据此决定是否进入 R1 画像流程
   * 硬约束: "接入失败兜底" 分支必须存在 (verdict=ineligible → fallback_only)
   */
  R0_precheck(enterpriseId: Id): Promise<ReformPrecheck>;

  // -------------------------------------------------------------
  // R1: 全景画像引擎 (spec L3600)
  // -------------------------------------------------------------
  /**
   * 企业全景画像 → 输出 scorecard.current
   * 设计哲学: project_memory "Tier-1 免费采集先行 + Lazy Loading"
   * 实现要求:
   *   1. 调用 INFRA-01b 适配层 (15 个外部 API 档)
   *   2. 失败时降级到 MOD-15 兜底 (C1-C7)
   *   3. 输出 Scorecard8D 8 维 0-100
   *   4. 原始敏感数据仅在内存 (ECO-01 阅后即焚), 计算后物理销毁
   */
  R1_fullPortrait(enterpriseId: Id): Promise<Scorecard8D>;

  // -------------------------------------------------------------
  // R2: 差距诊断引擎 (spec L3602)
  // -------------------------------------------------------------
  /**
   * 差距诊断 → 输出 current→target gap
   * 返回 target 评分卡 + TOP 优先级 GapItem 列表
   * aggressionLevel 决定 target 上调幅度 (conservative/balanced/innovative)
   */
  R2_gapAnalysis(
    current: Scorecard8D,
    aggressionLevel: AggressionLevel,
  ): Promise<{ target: Scorecard8D; gaps: GapItem[] }>;

  // -------------------------------------------------------------
  // R3: 方案生成引擎 (spec L3604)
  // -------------------------------------------------------------
  /**
   * 改造方案生成 → 输出 phases 数组
   * 实现技术: spec L3518 Pyomo/OR-Tools (约束求解) + 改造案例知识图谱
   * 约束: 所有 phase.weight 之和 = 1.0
   * 案例参考: R10 输出的 ReformCase 库 (向量检索)
   */
  R3_generatePlan(
    enterpriseId: Id,
    current: Scorecard8D,
    target: Scorecard8D,
    aggressionLevel: AggressionLevel,
  ): Promise<readonly ReformPhase[]>;

  // -------------------------------------------------------------
  // R4: 任务调度引擎 (spec L3606, DAG 编排)
  // -------------------------------------------------------------
  /**
   * 任务调度 → 执行 phases 内 actions
   * 实现技术: spec L3519 Temporal/Airflow (DAG 编排, 工作流状态持久化)
   * 设计: AsyncGenerator 逐步 yield ReformPhaseUpdate, 支持断点续跑
   * 失败处理: 失败动作触发 R6_replan
   */
  R4_schedulePhases(
    phases: readonly ReformPhase[],
  ): AsyncGenerator<ReformPhaseUpdate, void, ReformTrigger | void>;

  // -------------------------------------------------------------
  // R5-A~H: 任务执行引擎族 (spec L3608, 8 类见上方 R5ExecutorKind)
  // -------------------------------------------------------------
  /**
   * 执行单个 action
   * 实现: LLM Agent (DeepSeek V3) + INFRA-01b 适配层, L2~L4 自主度
   * 硬约束: context.budgetLimit 超限必须 abort, 抛 BudgetExceededError
   * 硬约束: autonomyLevel=L3 时需等待 auditUser 审批, L4 时直接执行
   */
  R5_executeAction(
    action: ReformAction,
    context: ReformContext,
  ): Promise<ReformActionResult>;

  // -------------------------------------------------------------
  // R6: 动态重规划引擎 (spec L3610)
  // -------------------------------------------------------------
  /**
   * 动态重规划 → task 失败/月度数据更新时重排后续路径
   * 实现技术: spec L3521 增量 DAG 重算 + R3 求解器热启动 (不停机改造)
   */
  R6_replan(
    state: ReformState,
    trigger: ReformTrigger,
  ): Promise<ReformReplanResult>;

  // -------------------------------------------------------------
  // R7: 合规审核引擎 (spec L3612, 规则引擎, 非 LLM, 零幻觉)
  // -------------------------------------------------------------
  /**
   * 合规审核 → 零幻觉, 可审计
   * 硬约束 (project_memory): "R7 必须是规则引擎, 非 LLM, 零幻觉可审计"
   * 规则集: spec L3670 "8 RED / 8 YELLOW / 10 GREEN"
   * 红线规则零误判 (spec KPI L3997: 100%)
   */
  R7_complianceCheck(
    action: ReformAction,
    state: ReformState,
  ): Promise<ComplianceCheckResult>;

  // -------------------------------------------------------------
  // R8: 进度监控与预警引擎 (spec L3614)
  // -------------------------------------------------------------
  /**
   * 里程碑追踪 + 异常预警
   * 实现技术: spec L3523 ECharts + Prometheus 指标采集
   */
  R8_monitorProgress(state: ReformState): Promise<ReformMonitorResult>;

  // -------------------------------------------------------------
  // R9: 银行撮合引擎 (spec L3616)
  // -------------------------------------------------------------
  /**
   * 改造完成后匹配银行产品
   * 实现技术: spec L3524 产品规则库 + 协同过滤匹配
   * KPI (spec L3996): M4 阶段 Top3 准确率 ≥ 70%, M5 ≥ 85%
   * 与 ECO-05 反向竞拍大厅联动: R9 推荐 → ECO-05 标书发布
   */
  R9_bankMatch(state: ReformState): Promise<readonly BankProductMatch[]>;

  // -------------------------------------------------------------
  // R10: 改造案例沉淀与学习引擎 (spec L3618)
  // -------------------------------------------------------------
  /**
   * 案例入库 + 模型再训练
   * 实现技术: spec L3525 PostgreSQL + 向量数据库 (Milvus) + 知识图谱 (Neo4j)
   * v3.1 修正: V1 规则引擎+向量检索并行影子模式, V2 深度强化学习需 500 案例触发
   * 案例签名: SHA256(enterpriseId + beforeScorecard + afterScorecard + totalActions + outcome)
   */
  R10_storeCase(
    state: ReformState,
    outcome: ReformOutcome,
  ): Promise<ReformCase>;

  // -------------------------------------------------------------
  // 生命周期管理
  // -------------------------------------------------------------
  /** 获取当前企业改造状态 (从持久化存储恢复) */
  getState(enterpriseId: Id): Promise<ReformState | null>;

  /** 持久化改造状态 (PostgreSQL + Redis 缓存) */
  saveState(state: ReformState): Promise<void>;

  /** 暂停改造 (status → paused) */
  pause(enterpriseId: Id): Promise<void>;

  /** 恢复改造 (status → in_progress, 从 R4 断点续跑) */
  resume(enterpriseId: Id): Promise<void>;

  /** 放弃改造 (status → abandoned, 触发 R10_storeCase outcome=abandoned) */
  abandon(enterpriseId: Id, reason: string): Promise<void>;
}

// ============================================================================
// 5. R5 子引擎接口 (8 个独立子引擎, 分族实现)
// ============================================================================

/**
 * R5 子引擎接口 — 每个 R5-A~R5-H 子族独立实现
 * 主 ReformEngineModule.R5_executeAction 根据 action.engine 路由到子引擎
 */
export interface R5SubEngine {
  readonly kind: R5ExecutorKind;
  readonly dimension: ScorecardDimension;
  /** 子引擎执行单个动作 */
  execute(action: ReformAction, context: ReformContext): Promise<ReformActionResult>;
  /** 该子引擎的能力描述 (R3 方案生成时引用) */
  describeCapabilities(): {
    readonly supportedActions: readonly string[];
    readonly avgDaysPerAction: number;
    readonly avgCostPerAction: AmountInCents;
    readonly autonomyLevel: AutonomyLevel;
  };
}

// ============================================================================
// 6. 改造引擎事件流 (跨模块通信)
// ============================================================================

/** 改造引擎发出的事件 (订阅者: APP-08 AI 驾驶舱 / APP-02 企业门户 / ECO-09 数字分身) */
export type ReformEngineEventKind =
  | 'reform:precheck_completed'
  | 'reform:portrait_completed'
  | 'reform:gap_analyzed'
  | 'reform:plan_generated'
  | 'reform:phase_started'
  | 'reform:phase_completed'
  | 'reform:action_started'
  | 'reform:action_completed'
  | 'reform:action_blocked'
  | 'reform:action_failed'
  | 'reform:compliance_red'
  | 'reform:compliance_yellow'
  | 'reform:replan_triggered'
  | 'reform:paused'
  | 'reform:resumed'
  | 'reform:abandoned'
  | 'reform:completed'
  | 'reform:bank_matched'
  | 'reform:case_stored';

export interface ReformEngineEvent<TPayload = unknown> {
  readonly kind: ReformEngineEventKind;
  readonly enterpriseId: Id;
  readonly payload: TPayload;
  readonly occurredAt: IsoTimestamp;
  readonly traceId: Id;
}

// ============================================================================
// 7. 改造引擎异常类型
// ============================================================================

/** 改造引擎基础异常 */
export class ReformEngineError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly enterpriseId?: Id,
    public readonly phaseId?: Id,
    public readonly actionId?: Id,
  ) {
    super(message);
    this.name = 'ReformEngineError';
  }
}

/** 预算超限异常 (R5 执行超预算) */
export class BudgetExceededError extends ReformEngineError {
  constructor(enterpriseId: Id, budgetLimit: AmountInCents, attemptedCost: AmountInCents) {
    super(
      `预算超限: 企业 ${enterpriseId} 预算 ${budgetLimit} 分, 当前动作预计 ${attemptedCost} 分`,
      'BUDGET_EXCEEDED',
      enterpriseId,
    );
    this.name = 'BudgetExceededError';
  }
}

/** 合规审核阻断异常 (R7 返回 red) */
export class ComplianceBlockError extends ReformEngineError {
  constructor(enterpriseId: Id, actionId: Id, ruleId: Id, ruleText: string) {
    super(
      `合规审核阻断: 规则 ${ruleId} - ${ruleText}`,
      'COMPLIANCE_RED',
      enterpriseId,
      undefined,
      actionId,
    );
    this.name = 'ComplianceBlockError';
  }
}

/** 接入意愿评估拒绝 (R0 verdict=ineligible) */
export class PrecheckIneligibleError extends ReformEngineError {
  constructor(enterpriseId: Id, reason: string) {
    super(
      `接入意愿评估拒绝: 企业 ${enterpriseId}, 原因: ${reason}`,
      'PRECHECK_INELIGIBLE',
      enterpriseId,
    );
    this.name = 'PrecheckIneligibleError';
  }
}
