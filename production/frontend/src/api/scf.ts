/**
 * api/scf.ts — 供应链金融 (SCF) 引擎 API 调用
 *
 * 覆盖 9 个端点 (SC6/SC7/SC8/SC9/SC10 + 场景预设 + Reform 联动):
 *   - POST /scf/pricing                       SC6 综合定价
 *   - POST /scf/risk-propagation              SC7 风险扩散
 *   - POST /scf/match                         SC8 撮合 top-K
 *   - GET  /scf/alerts                        SC9 履约监控告警
 *   - GET  /scf/cases                         SC10 案例库列表
 *   - POST /scf/cases                          SC10 沉淀新案例
 *   - GET  /scf/scenarios                     列出场景预设
 *   - POST /scf/scenarios/{id}/load           加载场景预设
 *   - POST /scf/sync-from-reform              SCF↔Reform 联动
 *
 * 风格对齐: api/reform.ts (用 client 已注册的 axios 实例, get/post 解包 ApiResult.data)
 */

import { get, post } from './client';

// === 类型定义 (对齐后端 schemas/scf.py, 字段 camelCase) ===

export type ScfIndustry =
  | 'manufacturing' | 'high_tech' | 'trade' | 'service' | 'agriculture'
  | 'energy' | 'logistics' | 'real_estate_related';

export type GuaranteeMethod =
  | 'credit' | 'accounts_receivable' | 'inventory'
  | 'guarantee' | 'pledge' | 'endorsement';

export type ScfProduct =
  | 'accounts_receivable_financing' | 'prepayment_financing'
  | 'inventory_financing' | 'bill_discount' | 'reverse_factoring';

export type ScenarioId =
  | 'reverse_factoring_core' | 'inventory_pledge'
  | 'ar_transfer' | 'bill_discount';

export type AlertLevel = 'green' | 'yellow' | 'red';
export type CaseOutcome = 'success' | 'failed' | 'partial';
export type EnterpriseScale = 'micro' | 'small' | 'medium' | 'large';

export interface SCFScenario {
  scenarioId: ScenarioId;
  name: string;
  description: string;
  product: ScfProduct;
  defaultEnterprise: string;
  defaultAmount: number;
  defaultTermMonths: number;
  defaultGuarantee: GuaranteeMethod;
  prefill: Record<string, unknown>;
}

export interface PricingInput {
  enterpriseId: string;
  creditScore: number;
  industry: ScfIndustry;
  guaranteeMethod: GuaranteeMethod;
  termMonths: number;
  loanAmount: number;       // 分
  baseLpr?: number;        // %, 默认 3.45
}

export interface PricingOutput {
  enterpriseId: string;
  baseRate: number;
  riskPremium: number;
  collateralDiscount: number;
  finalRate: number;
  annualInterest: number;  // 分
  breakdown: Record<string, unknown>;
  computedAt: string;
}

export interface RiskPropagationInput {
  rootEnterpriseId: string;
  hops: number;
  shockAmount: number;     // 分
}

export interface PropagationNode {
  enterpriseId: string;
  enterpriseName: string;
  direction: 'upstream' | 'downstream';
  hop: number;
  exposureAmount: number;
  lossGivenDefault: number;
  propagationRatio: number;
  relationType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface RiskPropagationOutput {
  rootEnterpriseId: string;
  rootEnterpriseName: string;
  hops: number;
  totalExposure: number;
  totalLoss: number;
  affectedCount: number;
  propagationTree: PropagationNode[];
  computedAt: string;
}

export interface MatchInput {
  enterpriseId: string;
  creditScore: number;
  loanAmount: number;      // 分
  termMonths: number;
  guaranteePreference: GuaranteeMethod;
  industry: ScfIndustry;
  topK?: number;
}

export interface MatchCandidate {
  enterpriseId: string;
  enterpriseName: string;
  bankId: string;
  bankName: string;
  bankProduct: string;
  approvedAmount: number;
  approvedRate: number;
  termMonths: number;
  confidence: number;
  matchReasons: string[];
  mismatches: string[];
}

export interface MatchOutput {
  enterpriseId: string;
  candidates: MatchCandidate[];
  computedAt: string;
}

export interface MonitorAlert {
  alertId: string;
  enterpriseId: string;
  enterpriseName: string;
  contractId: string;
  monitorKind: 'repayment' | 'shipment' | 'receipt' | 'delivery';
  level: AlertLevel;
  status: 'normal' | 'warning' | 'overdue' | 'defaulted' | 'completed';
  dueDate: string;
  amount: number;
  overdueDays: number;
  message: string;
  raisedAt: string;
}

export interface MonitorStatusSummary {
  total: number;
  greenCount: number;
  yellowCount: number;
  redCount: number;
  totalAtRiskAmount: number;
}

export interface AlertsResult {
  alerts: MonitorAlert[];
  summary: MonitorStatusSummary;
}

export interface CaseRecord {
  caseId: string;
  enterpriseName: string;
  industry: ScfIndustry;
  product: ScfProduct;
  scale: EnterpriseScale;
  outcome: CaseOutcome;
  loanAmount: number;
  finalRate: number;
  durationDays: number;
  summary: string;
  keyLearnings: string[];
  similarityTags: string[];
  storedAt: string;
}

export interface CaseQuery {
  industry?: ScfIndustry;
  product?: ScfProduct;
  scale?: EnterpriseScale;
  result?: CaseOutcome;
  keyword?: string;
}

export interface ReformSyncEvent {
  enterpriseId: string;
  reformCaseId: string;
  reformOutcome: 'success' | 'failed' | 'abandoned';
  afterLevel: 'D' | 'C' | 'B' | 'A';
  afterCreditScore: number;
  completedAt: string;
}

export interface ReformSyncResult {
  enterpriseId: string;
  portraitRefreshed: boolean;
  newCreditScore: number;
  rematchTriggered: boolean;
  newCandidatesCount: number;
  message: string;
}

// === API 调用 ===

/** SC6 综合定价计算 */
export async function pricing(input: PricingInput): Promise<PricingOutput> {
  return post<PricingOutput>('/scf/pricing', input);
}

/** SC7 风险扩散 */
export async function riskPropagation(input: RiskPropagationInput): Promise<RiskPropagationOutput> {
  return post<RiskPropagationOutput>('/scf/risk-propagation', input);
}

/** SC8 双向撮合 (top-K 候选) */
export async function match(input: MatchInput): Promise<MatchOutput> {
  return post<MatchOutput>('/scf/match', input);
}

/** SC9 履约监控告警列表 */
export async function listAlerts(): Promise<AlertsResult> {
  return get<AlertsResult>('/scf/alerts');
}

/** SC10 案例库列表 (支持 行业/产品/规模/结果/关键词 筛选) */
export async function listCases(query?: CaseQuery): Promise<CaseRecord[]> {
  const params = new URLSearchParams();
  if (query?.industry) params.set('industry', query.industry);
  if (query?.product) params.set('product', query.product);
  if (query?.scale) params.set('scale', query.scale);
  if (query?.result) params.set('result', query.result);
  if (query?.keyword) params.set('keyword', query.keyword);
  const qs = params.toString();
  return get<CaseRecord[]>(`/scf/cases${qs ? `?${qs}` : ''}`);
}

/** SC10 沉淀新案例 */
export async function saveCase(record: CaseRecord): Promise<CaseRecord> {
  return post<CaseRecord>('/scf/cases', record);
}

/** 列出 4 个场景预设 */
export async function listScenarios(): Promise<SCFScenario[]> {
  return get<SCFScenario[]>('/scf/scenarios');
}

/** 加载场景预设 (返回 prefill 字段供前端填表) */
export async function loadScenario(scenarioId: ScenarioId): Promise<SCFScenario> {
  return post<SCFScenario>(`/scf/scenarios/${scenarioId}/load`, {});
}

/** SCF↔Reform 联动 (接收 reform 完成事件, 触发 SC1 画像刷新 + SC8 撮合重算) */
export async function syncFromReform(event: ReformSyncEvent): Promise<ReformSyncResult> {
  return post<ReformSyncResult>('/scf/sync-from-reform', event);
}
