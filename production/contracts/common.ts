/**
 * common.ts — FinTrust Hub 生产系统基础类型契约
 *
 * 设计依据: spec.md v3.1 L3495-3525 技术栈总览 + mock-data.js 数据结构
 * 适用层: frontend (Vue 3 + TS) / backend (FastAPI Pydantic 镜像) / db (PostgreSQL schema 镜像)
 *
 * 原则:
 *   1. 所有类型严格 readonly, 防止运行时突变
 *   2. 字面量联合类型优先 (status / level / mode), 避免魔法字符串
 *   3. ISO 8601 时间字符串统一使用 string, 前端 Date 转换由调用方负责
 *   4. 金额统一最小货币单位 (分), 避免浮点误差
 *   5. 中文注释对齐 spec 术语表 (L3897+)
 */

import type { Scorecard8D, ReformActionRef } from './scorecard';

// ============================================================================
// 1. 通用包装类型
// ============================================================================

/** 资源 ID: 全局唯一, 字母数字下划线 */
export type Id = string;

/** ISO 8601 时间戳 (UTC, 如 2026-08-19T12:34:56.789Z) */
export type IsoTimestamp = string;

/** 金额: 最小货币单位 (分), 避免浮点误差. 1 元 = 100 */
export type AmountInCents = number;

/** 比率: 0-1 之间, 0% = 0, 100% = 1 */
export type Ratio = number;

/** 百分比: 0-100, 例如利率 4.5% = 4.5 */
export type Percentage = number;

/** 分数: 0-100, 用于 8 维评分卡 */
export type Score = number;

/** API 统一响应包装 */
export interface ApiResult<T> {
  code: number;          // 0 = 成功, 非 0 = 业务错误码
  message: string;
  data: T;
  requestId: Id;         // 链路追踪 ID
  timestamp: IsoTimestamp;
}

/** 分页结果 */
export interface PaginatedResult<T> {
  items: readonly T[];
  total: number;
  page: number;
  pageSize: number;
}

/** 分页查询参数 */
export interface PageQuery {
  page: number;          // 1-based
  pageSize: number;      // 1-100
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
}

// ============================================================================
// 2. 企业领域 (mock-data.js L23-178 镜像)
// ============================================================================

/** 行业大类 (mock-data.js industry 字段) */
export type Industry =
  | 'manufacturing'           // 制造业
  | 'high_tech'               // 高新技术
  | 'real_estate_related'     // 房地产关联
  | 'trade'                   // 贸易
  | 'service'                 // 服务业
  | 'agriculture'             // 农业
  | 'energy'                  // 能源
  | 'logistics';              // 物流

/** 行业政策导向 (mock-data.js industryPolicy 字段) */
export type IndustryPolicy = 'encourage' | 'neutral' | 'restrict';

/** 风险画像 (mock-data.js riskProfile 字段) */
export type RiskProfile = 'premium' | 'normal' | 'high_risk' | 'distress';

/** 数据流标识 (mock-data.js dataFlows 字段, 对齐术语表五流合一) */
export type DataFlowKey =
  | 'fund'        // 资金流
  | 'contract'    // 合同流
  | 'invoice'     // 发票流
  | 'logistics'   // 物流流
  | 'iot'         // 物联流
  | 'personnel';  // 人流 (第零流)

/** 数据流开关集合 */
export type DataFlowFlags = Readonly<Record<DataFlowKey, boolean>>;

/** 数据流标签 (UI 显示用) */
export type DataFlowLabels = Readonly<Record<DataFlowKey, string>>;

/** 信用等级 (mock-data.js CREDIT_GRADES, 确权等级分) */
export type CreditGrade = 'A' | 'B' | 'C';

/** 改造等级 (spec L3537 currentLevel, D 最低 A 最高) */
export type ReformLevel = 'D' | 'C' | 'B' | 'A';

/** AI 自主度等级 (spec L3916, L1 最高 L4 最低) */
export type AutonomyLevel = 'L1' | 'L2' | 'L3' | 'L4';

/** 合作模式 (mock-data.js cooperation 字段) */
export interface CooperationModes {
  /** 企业模式 */
  enterpriseMode: readonly EnterpriseMode[];
  /** 银行模式 */
  bankMode: readonly BankMode[];
  /** 担保模式 */
  guarantorMode: readonly GuarantorMode[];
  /** 保险模式 */
  insuranceMode: readonly InsuranceMode[];
}

export type EnterpriseMode =
  | 'custody'               // 资金监管
  | 'planning'              // 改造规划
  | 'financing_advisory'    // 融资顾问
  | 'advisory'              // 一般顾问
  | 'self_operated';        // 自营兜底 (MOD-09 第 5 选项)

export type BankMode =
  | 'pre_loan'              // 贷前
  | 'post_loan'             // 贷后监管
  | 'consulting'            // 咨询
  | 'delegation'            // 委托
  | 'discovery';            // 仅发现

export type GuarantorMode =
  | 'collaborate'           // 协同
  | 'compensation'          // 代偿
  | 'counter_guarantee';    // 反担保

export type InsuranceMode =
  | 'joint_underwriting'    // 联合核保
  | 'claim_collab';         // 理赔协同

/** 数据可见范围 (mock-data.js dataVisibility 字段) */
export interface DataVisibility {
  bank: readonly string[];       // 银行可见字段名列表
  guarantor: readonly string[];
  insurance: readonly string[];
}

/** 企业模块配置 (mock-data.js modules 字段) */
export interface EnterpriseModules {
  fundMonitor: 'strong' | 'weak' | 'none';   // 资金监管强度
  billService: boolean;
  arInsurance: boolean;
  iotPerception: boolean;
  blockchainAnchor: boolean;
  aiAutonomyMax: AutonomyLevel;
}

/** 票据 (mock-data.js billsHeld 数组项) */
export interface Bill {
  billId: Id;
  amount: AmountInCents;
  dueDate: IsoTimestamp;
  type: 'bank_acceptance' | 'commercial_acceptance' | 'electronic';
  insured: boolean;
}

/** 企业财务指标 (mock-data.js financials 字段) */
export interface EnterpriseFinancials {
  monthlyRevenue: AmountInCents;
  monthlyExpense: AmountInCents;
  accountBalance: AmountInCents;
  pendingAR: AmountInCents;          // 应收账款
  billsHeld: readonly Bill[];
}

/** 五流验证状态 (mock-data.js runtime.fiveStreams 字段) */
export type FiveStreamsState = Readonly<Record<DataFlowKey, boolean>>;

/** 责任链节点 (mock-data.js RESPONSIBILITY_NODES_TEMPLATE) */
export interface ResponsibilityNode {
  nodeId: Id;                        // N01-N12
  name: string;
  role: string;
  operator: string;                  // 操作人姓名
  approver: string | null;           // 审批人
  method: string;                    // 确权方法 (电子签名/扫码+GPS 等)
  creditWeight: number;              // 信用权重
  stage: string;                     // 阶段 (融资前/采购/仓储/生产/物流/回款/还款)
}

/** 责任链状态 (mock-data.js runtime.responsibilityChain 字段) */
export interface ResponsibilityChain {
  nodes: readonly ResponsibilityNode[];
  completeness: Ratio;               // 已确认/应确认
  totalScore: number;
  complianceReport: unknown | null;
}

/** 担保/保险状态 (mock-data.js runtime.guaranteeStatus/insuranceStatus) */
export type GuaranteeStatus = 'none' | 'pending' | 'active' | 'rejected';
export type InsuranceStatus = 'none' | 'pending' | 'active' | 'rejected';

/** 企业运行时状态 (mock-data.js runtime 字段) */
export interface EnterpriseRuntime {
  creditCompleteness: Ratio;         // 信用维度完整度 = 已开放数据流数/6
  creditScore: number;               // 信用分 0-850
  maxAmountMultiplier: number;        // 额度乘数 0.5-1.5
  rateDiscount: number;               // 利率增减 (百分点, 正数=上浮, 负数=下浮)
  creditGradeCap: CreditGrade;        // 信用等级上限
  approvalSpeed: 'fast' | 'normal' | 'slow';
  waterLevel: Ratio;                  // 动态水位 (可划拨资金比例)
  fiveStreams: FiveStreamsState;
  guaranteeStatus: GuaranteeStatus;
  insuranceStatus: InsuranceStatus;
  financingUnlocked: boolean;         // 融资入口是否解锁 (改造完成后置 true)
  responsibilityChain: ResponsibilityChain;
}

/** 企业主数据 (mock-data.js ENTERPRISES 数组项) */
export interface Enterprise {
  readonly id: Id;
  readonly name: string;
  readonly industry: Industry;
  readonly industryLabel: string;          // 中文标签
  readonly industryPolicy: IndustryPolicy;
  readonly riskProfile: RiskProfile;
  readonly riskLabel: string;
  readonly dataFlows: DataFlowFlags;
  readonly modules: EnterpriseModules;
  readonly cooperation: CooperationModes;
  readonly dataVisibility: DataVisibility;
  readonly financials: EnterpriseFinancials;
  runtime: EnterpriseRuntime;             // 运行时可变, 非 readonly
  reform: EnterpriseReformState;           // 改造状态, 非 readonly
}

/** 企业改造状态 (mock-data.js reform 字段) */
export interface EnterpriseReformState {
  hasReformed: boolean;
  reformedAt: IsoTimestamp | null;
  beforeLevel: ReformLevel;
  afterLevel: ReformLevel | null;
  totalInvestmentHours: number;
  totalCost: AmountInCents;
  beforeScorecard: Scorecard8D;            // 来自 scorecard.ts
  afterScorecard: Scorecard8D | null;
  completedActions: readonly ReformActionRef[];
}

// ============================================================================
// 3. 金融机构 (mock-data.js L181-195 镜像)
// ============================================================================

/** 银行 (mock-data.js BANKS 数组项) */
export interface Bank {
  readonly id: Id;                          // BK001-BK999
  readonly name: string;
  readonly baseRate: string;                // 显示用 "LPR+1.5%"
  readonly baseRateValue: Percentage;       // 数值 4.45
  readonly maxAmount: AmountInCents;        // 单笔最大额度
  readonly requiresGuarantee: boolean;      // 是否强制担保
  readonly label: string;
  readonly bankGroup?: string;             // 银行集团 (ECO-05 反向竞拍串通检测)
}

/** 担保公司 (mock-data.js GUARANTORS 数组项) */
export interface Guarantor {
  readonly id: Id;                          // G001+
  readonly name: string;
  readonly mode: GuarantorMode;
  activeGuarantees: number;                 // 在保笔数
  readonly guaranteeRate: string;            // "1.5%"
}

/** 保险公司 (mock-data.js INSURERS 数组项) */
export interface Insurer {
  readonly id: Id;                          // I001+
  readonly name: string;
  readonly mode: InsuranceMode;
  activePolicies: number;
  readonly premiumRate: string;             // "0.8%"
}

// ============================================================================
// 4. 政策与季节性 (mock-data.js L198-209 镜像)
// ============================================================================

/** 政策版本 (mock-data.js POLICY_VERSIONS 数组项) */
export interface PolicyVersion {
  readonly version: string;                 // "2026-Q2"
  readonly label: string;
  readonly manufacturing: IndustryPolicy;
  readonly high_tech: IndustryPolicy;
  readonly real_estate_related: IndustryPolicy;
  // 后续按 spec 行业大类表 (L4026+) 扩展
}

/** 季节性窗口标识 (mock-data.js SEASONAL_WINDOWS keys) */
export type SeasonalWindowKey =
  | 'normal'
  | 'quarter_end'
  | 'year_end'
  | 'spring_festival';

/** 季节性窗口 (mock-data.js SEASONAL_WINDOWS 值) */
export interface SeasonalWindow {
  readonly key: SeasonalWindowKey;
  readonly label: string;
  readonly rateAdjust: Percentage;          // 利率调整 (正=上浮, 负=下浮)
  readonly desc: string;
}

// ============================================================================
// 5. 三档能力: API 档 / 自研护城河档 / 兜底档 (project_memory 工程约定)
// ============================================================================

/** API 档状态 (mock-data.js EXTERNAL_APIS 数组项, INFRA-01b) */
export type ExternalApiStatus = 'connected' | 'disconnected' | 'degraded' | 'circuit_open';
export type CircuitState = 'closed' | 'open' | 'half_open';
export type ApiCategory =
  | 'bank' | 'invoice' | 'business' | 'judicial' | 'bill' | 'logistics'
  | 'utility' | 'contract' | 'blockchain' | 'guarantee' | 'insurance'
  | 'legal' | 'audit' | 'credit';

export interface ExternalApi {
  readonly id: Id;                          // API-01 ~ API-15
  readonly name: string;
  readonly category: ApiCategory;
  readonly status: ExternalApiStatus;
  readonly rateLimitCount: number;
  readonly rateLimitMax: number;
  readonly circuitState: CircuitState;
  readonly fallbackTo: FallbackModuleId;    // 失败时降级到哪个兜底模块
  readonly lastLatencyMs: number | null;
}

/** 兜底模块 ID (mock-data.js FALLBACK_MODULES, C1-C7 + MOD-15 独立兜底) */
export type FallbackModuleId =
  | 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6' | 'C7'
  | 'MOD15';                                // 独立兜底引擎 (project_memory 必须新增)

// ============================================================================
// 6. 改造前置预检 (MOD-16.0, project_memory 必须新增 "接入意愿评估" 前置)
// ============================================================================

/** 预检结论 (MOD-16.0 接入意愿评估前置 + 改造可行性) */
export type PrecheckVerdict =
  | 'eligible'           // 可直接进入改造
  | 'reluctant'          // 接入意愿不足, 需劝导
  | 'needs_data'         // 数据缺口大, 需补采 Tier-1
  | 'ineligible'         // 不符合准入, 拒绝
  | 'fallback_only';     // 仅可走独立兜底模式

export interface ReformPrecheck {
  enterpriseId: Id;
  verdict: PrecheckVerdict;
  willingnessScore: Score;                  // 接入意愿评分 0-100
  dataCompleteness: Ratio;                   // 数据完整度
  topGaps: readonly string[];                // TOP3 阻碍因素
  recommendedTier: 'tier1' | 'tier2' | 'fallback';  // 推荐数据采集档位
  checkedAt: IsoTimestamp;
}

// ============================================================================
// 7. 公共事件类型 (跨 ECO 模块通信)
// ============================================================================

/** 跨模块事件类型 (前后端共享 WebSocket / Kafka topic) */
export type EcoEventKind =
  | 'reform:phase_started'
  | 'reform:phase_completed'
  | 'reform:action_blocked'
  | 'reform:state_changed'
  | 'financing:unlocked'
  | 'bid:published'
  | 'bid:new_bid'
  | 'bid:awarded'
  | 'bid:collusion_detected'
  | 'pts:points_awarded'
  | 'pts:order_placed'
  | 'gov:report_submitted'
  | 'gov:endorsement_granted'
  | 'bot:command_executed'
  | 'credential:issued'
  | 'index:published'
  | 'pricing:settlement_paid'
  | 'rpa:pdf_generated'
  | 'burn:data_destroyed';

export interface EcoEvent<TPayload = unknown> {
  kind: EcoEventKind;
  enterpriseId: Id;
  payload: TPayload;
  occurredAt: IsoTimestamp;
  traceId: Id;
}
