/**
 * api/bank.ts — 银行信任培育期渐进解锁 (CORE-01b) API 调用
 *
 * 8 个端点:
 *   GET    /bank                              列出所有银行
 *   GET    /bank/{bankId}/trust-profile        银行信任档案
 *   POST   /bank/{bankId}/upgrade-stage        升级信任阶段
 *   GET    /bank/{bankId}/risk-letters         风险提示函列表 (可选 ?enterpriseId=)
 *   POST   /bank/{bankId}/risk-letters         生成风险提示函
 *   GET    /bank/{bankId}/decisions            决策日志
 *   POST   /bank/{bankId}/decisions            提交决策
 *   GET    /bank/{bankId}/statistics           统计数据
 *
 * 参考 api/reform.ts 风格, 与后端 schemas/bank.py 字段对齐.
 */

import { get, post } from './client';

// === 类型定义 (镜像后端 schemas/bank.py) ===

export type BankTrustStage =
  | 'L4_READONLY'    // 培育期 (0-6 月)
  | 'L3_ADVISORY'    // 验证期 (6-12 月)
  | 'L2_SMALL_AUTO'  // 信任期 (12-24 月)
  | 'L1_FULL_AUTO';  // 深度信任期 (24+ 月)

export type RiskLevel = 'low' | 'medium' | 'high';
export type AiRecommendation = 'approve' | 'review' | 'reject';
export type BankFinalDecision = 'approve' | 'review' | 'reject' | 'pending';

export interface BankListItem {
  bankId: string;
  bankName: string;
  stage: BankTrustStage;
  joinedMonths: number;
  conversionRate: number;
}

export interface BankTrustProfile {
  bankId: string;
  bankName: string;
  stage: BankTrustStage;
  joinedMonths: number;
  totalApprovedCount: number;
  aiAutoApprovedCount: number;
  aiBlockedCount: number;
  conversionRate: number;
  nextStageUnlockProgress: number;
  stageDescription: string;
}

export interface RiskLetter {
  letterId: string;
  bankId: string;
  enterpriseId: string;
  enterpriseName: string;
  riskLevel: RiskLevel;
  summary: string;
  recommendations: string[];
  generatedAt: string;
}

export interface RiskLetterCreate {
  enterpriseId: string;
  enterpriseName?: string;
  riskLevel: RiskLevel;
  summary: string;
  recommendations?: string[];
}

export interface BankDecision {
  decisionId: string;
  bankId: string;
  enterpriseId: string;
  enterpriseName: string;
  amount: number;
  aiRecommendation: AiRecommendation;
  bankFinalDecision: BankFinalDecision;
  autoHandled: boolean;
  stage: BankTrustStage;
  reason: string;
  decidedAt: string;
}

export interface BankDecisionCreate {
  enterpriseId: string;
  enterpriseName?: string;
  amount: number;
  aiRecommendation: AiRecommendation;
  bankFinalDecision?: BankFinalDecision;
  reason?: string;
}

export interface BankStatistics {
  bankId: string;
  totalLoans: number;
  autoApprovedCount: number;
  manualApprovedCount: number;
  rejectedCount: number;
  totalAmountCents: number;
}

export interface StageUpgradeResult {
  bankId: string;
  previousStage: BankTrustStage;
  currentStage: BankTrustStage;
  upgraded: boolean;
  reason: string;
  conversionRate: number;
  totalApprovedCount: number;
}

// === 8 个端点调用 ===

/** 端点 1: 列出所有银行 */
export async function listBanks(): Promise<BankListItem[]> {
  return get<BankListItem[]>('/bank');
}

/** 端点 2: 银行信任档案 */
export async function getTrustProfile(bankId: string): Promise<BankTrustProfile | null> {
  return get<BankTrustProfile | null>(`/bank/${bankId}/trust-profile`);
}

/** 端点 3: 升级信任阶段 */
export async function upgradeStage(bankId: string): Promise<StageUpgradeResult> {
  return post<StageUpgradeResult>(`/bank/${bankId}/upgrade-stage`);
}

/** 端点 4: 风险提示函列表 (可选按企业筛选) */
export async function listRiskLetters(
  bankId: string,
  enterpriseId?: string,
): Promise<RiskLetter[]> {
  const query = enterpriseId ? `?enterpriseId=${encodeURIComponent(enterpriseId)}` : '';
  return get<RiskLetter[]>(`/bank/${bankId}/risk-letters${query}`);
}

/** 端点 5: 生成风险提示函 */
export async function generateRiskLetter(
  bankId: string,
  payload: RiskLetterCreate,
): Promise<RiskLetter> {
  return post<RiskLetter>(`/bank/${bankId}/risk-letters`, payload);
}

/** 端点 6: 决策日志 */
export async function listDecisions(bankId: string): Promise<BankDecision[]> {
  return get<BankDecision[]>(`/bank/${bankId}/decisions`);
}

/** 端点 7: 提交决策 */
export async function submitDecision(
  bankId: string,
  payload: BankDecisionCreate,
): Promise<BankDecision> {
  return post<BankDecision>(`/bank/${bankId}/decisions`, payload);
}

/** 端点 8: 统计数据 */
export async function getStatistics(bankId: string): Promise<BankStatistics> {
  return get<BankStatistics>(`/bank/${bankId}/statistics`);
}

// === APP-01 操作面板端点 ===

/** 监管账户冻结状态 */
export type AccountFreezeStatus = 'active' | 'frozen';

export interface SupervisionAccount {
  /** 账户号 (脱敏) */
  accountId: string;
  /** 当前冻结状态 */
  status: AccountFreezeStatus;
  /** 监管账户余额 (分) */
  balanceCents: number;
  /** 关联企业 ID */
  enterpriseId: string;
  /** 关联企业名称 (脱敏) */
  enterpriseName: string;
  /** 最近一次冻结/解冻操作时间 */
  lastOperationAt?: string;
}

export interface CreditMultiplierPayload {
  /** 授信乘数 0.5-3.0 */
  multiplier: number;
  /** 操作原因 (可选, 审计用) */
  reason?: string;
}

export interface CreditMultiplierResult {
  /** 银行 ID */
  bankId: string;
  /** 应用后的乘数 */
  multiplier: number;
  /** 应用后的新授信额度 (分) */
  newCreditLimitCents: number;
  /** 原授信额度 (分) */
  previousCreditLimitCents: number;
  /** 操作时间 */
  appliedAt: string;
}

export interface FreezeAccountPayload {
  /** true=冻结, false=解冻 */
  freeze: boolean;
  /** 操作原因 (审计) */
  reason?: string;
}

export interface FreezeAccountResult {
  /** 账户号 */
  accountId: string;
  /** 当前冻结状态 */
  status: AccountFreezeStatus;
  /** 操作时间 */
  operatedAt: string;
  /** 操作前状态 */
  previousStatus: AccountFreezeStatus;
}

/** APP-01 端点 9: 调整授信乘数 */
export async function adjustCreditMultiplier(
  bankId: string,
  payload: CreditMultiplierPayload,
): Promise<CreditMultiplierResult> {
  return post<CreditMultiplierResult>(`/bank/${bankId}/credit-multiplier`, payload);
}

/** APP-01 端点 10: 冻结/解冻监管账户 */
export async function freezeAccount(
  bankId: string,
  accountId: string,
  payload: FreezeAccountPayload,
): Promise<FreezeAccountResult> {
  return post<FreezeAccountResult>(
    `/bank/${bankId}/freeze-account`,
    { ...payload, accountId },
  );
}

/** APP-01 端点 11: 列出监管账户 */
export async function listSupervisionAccounts(
  bankId: string,
): Promise<SupervisionAccount[]> {
  return get<SupervisionAccount[]>(`/bank/${bankId}/supervision-accounts`);
}
