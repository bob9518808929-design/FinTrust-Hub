/**
 * api/eco.ts — ECO 9 模块 API 调用
 *
 * 按模块组织, 对齐 contracts/eco.ts 接口契约
 */

import type { Id, IsoTimestamp } from '@contracts/common';
import type {
  BurnRawDataInput, BurnProgress, BurnDiagnosisResult, BurnAuditTrail,
  SettlementCalcInput, SettlementRecord,
  CreditApplicationInput, CreditApplicationRecord,
  VerifiableCredential, CredentialType,
  TenderPublishInput, Tender, BankBid, CollusionEvidence, MultiHeadCheckResult,
  WorkerAccount, ExchangeOrder, ShopItem, BehaviorKind, FraudLogEntry,
  ComplianceIndexSnapshot, IndexType,
  GovReport, GovReportType, GovEndorsement,
  BotCommandParse, BotCommandResult, BotConfig, BotChannel, BotConversation, BotReplyAction,
} from '@contracts/eco';
import { get, post } from './client';

// ============================================================================
// ECO-01 阅后即焚 (后端 prefix=/eco-burn)
// ============================================================================

export async function burnLoadRaw(
  enterpriseId: Id,
  dataType: BurnRawDataInput['dataType'],
  records: unknown[],
): Promise<{ loaded: boolean; recordCount: number; bytes: number }> {
  return post(`/eco-burn/load`, { enterpriseId, dataType, records });
}

/** 全格式文件上传 (JSON/CSV/TXT/MD/DOCX/XLSX/PDF/图片), multipart → 后端分流解析.
 *  注意: client 响应拦截器已解包 ApiResult 并统一错误 toast, 这里直接拿业务 data. */
export async function burnLoadRawFile(
  enterpriseId: Id,
  dataType: BurnRawDataInput['dataType'],
  file: File,
): Promise<{ loaded: boolean; recordCount: number; bytes: number }> {
  const fd = new FormData();
  fd.append('enterprise_id', enterpriseId);
  fd.append('data_type', dataType);
  fd.append('file', file);
  // FormData 不设 Content-Type (浏览器自动 multipart+boundary); 30s 上传超时覆盖默认 8s
  return post(`/eco-burn/load-file`, fd, { timeout: 30000 });
}

export async function burnStartDiagnosis(enterpriseId: Id): Promise<void> {
  return post(`/eco-burn/${enterpriseId}/diagnose`, {});
}

export async function burnGetProgress(enterpriseId: Id): Promise<BurnProgress | null> {
  return get<BurnProgress | null>(`/eco-burn/${enterpriseId}/progress`);
}

export async function burnGetResult(enterpriseId: Id): Promise<BurnDiagnosisResult | null> {
  return get<BurnDiagnosisResult | null>(`/eco-burn/${enterpriseId}/result`);
}

export async function burnDestroy(enterpriseId: Id): Promise<BurnAuditTrail> {
  return post<BurnAuditTrail>(`/eco-burn/${enterpriseId}/destroy`, {});
}

export async function burnGetAudit(enterpriseId: Id, silent = false): Promise<BurnAuditTrail | null> {
  // silent=true: 页面加载时的探测性恢复请求, 未销毁 (业务 404) 不弹全局错误 toast
  return get<BurnAuditTrail | null>(
    `/eco-burn/${enterpriseId}/audit`,
    { _silent: silent } as Parameters<typeof get>[1],
  );
}

// ============================================================================
// ECO-02 阶梯定价 (后端 prefix=/eco-pricing)
// ============================================================================

export async function pricingCalc(input: SettlementCalcInput): Promise<SettlementRecord> {
  return post<SettlementRecord>(`/eco-pricing/calculate`, input);
}

export async function pricingAutoPay(settlementId: Id): Promise<{ paid: boolean; txId?: Id; failReason?: string }> {
  // 后端未实现 /eco-pricing/{id}/auto-pay (P2 路线图), 降级返回未支付 + 明确原因
  console.warn('[eco.ts] pricingAutoPay: 后端端点未实现, 降级返回未支付 (settlementId=', settlementId, ')');
  return { paid: false, failReason: '后端 auto-pay 端点尚未实现 (P2 路线图)' };
}

export async function pricingListByEnterprise(enterpriseId: Id): Promise<SettlementRecord[]> {
  return get<SettlementRecord[]>(`/eco-pricing/enterprise/${enterpriseId}`);
}

// ============================================================================
// ECO-03 无接口适配器 (后端 prefix=/eco-adapter, 子路径 /application, /{app_id}/ack)
// ============================================================================

export async function rpaGenerate(input: CreditApplicationInput): Promise<CreditApplicationRecord> {
  return post<CreditApplicationRecord>(`/eco-adapter/application`, input);
}

export async function rpaSubmit(applicationId: Id): Promise<{ submitted: boolean; failReason?: string }> {
  return post(`/eco-adapter/${applicationId}/ack`, {});
}

export async function rpaListByEnterprise(enterpriseId: Id): Promise<CreditApplicationRecord[]> {
  // 后端未实现 /eco-adapter/enterprise/{id} (P2 路线图), 降级返回空数组
  console.warn('[eco.ts] rpaListByEnterprise: 后端端点未实现, 降级返回空数组 (enterpriseId=', enterpriseId, ')');
  return [];
}

// ============================================================================
// ECO-04 联盟链凭证 (后端 prefix=/eco-credential, 参数 vc_id)
// ============================================================================

export async function credentialIssue(input: {
  enterpriseId: Id;
  type: CredentialType;
  expiryMonths?: number;
  claims?: readonly string[];
}): Promise<VerifiableCredential> {
  return post<VerifiableCredential>(`/eco-credential/issue`, input);
}

export async function credentialVerify(credentialId: Id): Promise<{
  valid: boolean; reason?: string; revocationCheckedAt: string;
  signatureValid: boolean; blockchainVerified: boolean;
}> {
  return get(`/eco-credential/${credentialId}/verify`);
}

export async function credentialRevoke(credentialId: Id, reason: string): Promise<VerifiableCredential> {
  return post<VerifiableCredential>(`/eco-credential/${credentialId}/revoke`, { reason });
}

export async function credentialListByEnterprise(enterpriseId: Id): Promise<VerifiableCredential[]> {
  return get<VerifiableCredential[]>(`/eco-credential/enterprise/${enterpriseId}`);
}

// ============================================================================
// ECO-05 反向竞拍 (后端 prefix=/eco-bid, 子路径 /tenders, /tenders/{id}/bids, /tenders/{id}/award)
// ============================================================================

export async function bidPublish(input: TenderPublishInput): Promise<Tender> {
  return post<Tender>(`/eco-bid/tenders`, input);
}

export async function bidList(filter?: { enterpriseId?: Id; status?: string }): Promise<Tender[]> {
  return get<Tender[]>(`/eco-bid/tenders`, { params: filter });
}

export async function bidListBids(tenderId: Id): Promise<BankBid[]> {
  return get<BankBid[]>(`/eco-bid/tenders/${tenderId}/bids`);
}

export async function bidSubmitBid(input: {
  tenderId: Id;
  bankId: Id;
  rate: number;
  amount: number;
  termMonths: number;
  timeToFundDays: number;
  conditions?: string;
}): Promise<BankBid> {
  return post<BankBid>(`/eco-bid/tenders/${input.tenderId}/bids`, input);
}

export async function bidAward(tenderId: Id): Promise<{ winnerBidId: Id; ranking: BankBid[] }> {
  return post(`/eco-bid/tenders/${tenderId}/award`, {});
}

export async function bidDetectCollusion(tenderId: Id): Promise<CollusionEvidence | null> {
  // 后端未实现 /eco-bid/tenders/{id}/detect-collusion (P2 路线图), 降级返回 null
  console.warn('[eco.ts] bidDetectCollusion: 后端端点未实现, 降级返回 null (tenderId=', tenderId, ')');
  return null;
}

export async function bidCheckMultiHead(enterpriseId: Id): Promise<MultiHeadCheckResult> {
  return get<MultiHeadCheckResult>(`/eco-bid/multi-head/${enterpriseId}`);
}

// ============================================================================
// ECO-06 积分商城 (后端 prefix=/eco-pts, 子路径 /shop, /orders, /workers/{id}, /cooperation)
// ============================================================================

export async function ptsAwardPoints(input: {
  workerId: Id;
  behavior: BehaviorKind;
  evidence?: readonly string[];
  geoFence?: { lat: number; lng: number };
}): Promise<{ awarded: boolean; newBalances: WorkerAccount['balances']; fraudBlocked?: boolean; reason?: string }> {
  return post(`/eco-pts/award`, input);
}

export async function ptsGetAccount(workerId: Id): Promise<WorkerAccount | null> {
  return get<WorkerAccount | null>(`/eco-pts/workers/${workerId}`);
}

export async function ptsListByEnterprise(enterpriseId: Id): Promise<WorkerAccount[]> {
  // 后端未实现 /eco-pts/enterprise/{id} (P2 路线图), 降级返回空数组
  console.warn('[eco.ts] ptsListByEnterprise: 后端端点未实现, 降级返回空数组 (enterpriseId=', enterpriseId, ')');
  return [];
}

export async function ptsListShopItems(): Promise<ShopItem[]> {
  return get<ShopItem[]>(`/eco-pts/shop`);
}

export async function ptsPlaceOrder(workerId: Id, itemId: Id): Promise<ExchangeOrder> {
  return post<ExchangeOrder>(`/eco-pts/orders`, { workerId, itemId });
}

export async function ptsListOrders(workerId: Id): Promise<ExchangeOrder[]> {
  return get<ExchangeOrder[]>(`/eco-pts/orders`, { params: { workerId } });
}

export async function ptsGetFraudLog(filter?: { workerId?: Id; from?: string; to?: string }): Promise<FraudLogEntry[]> {
  // 后端未实现 /eco-pts/fraud-log (P2 路线图), 降级返回空数组
  console.warn('[eco.ts] ptsGetFraudLog: 后端端点未实现, 降级返回空数组 (filter=', filter, ')');
  return [];
}

export async function ptsGetCooperationRate(enterpriseId: Id): Promise<{
  current: number; baseline: number; target: number;
  monthlyCost: number; withinBudget: boolean;
}> {
  return get(`/eco-pts/cooperation`, { params: { enterpriseId } });
}

// ============================================================================
// ECO-07 行业合规指数 (后端 prefix=/eco-index, 子路径 /calculate, /compare)
// ============================================================================

export async function indexCalculate(input: {
  type: IndexType;
  industry?: string;
  period: string;
}): Promise<ComplianceIndexSnapshot> {
  return post<ComplianceIndexSnapshot>(`/eco-index/calculate`, input);
}

export async function indexGetHistory(filter: {
  type: IndexType;
  industry?: string;
  from?: string;
  to?: string;
}): Promise<ComplianceIndexSnapshot[]> {
  // 后端未实现 /eco-index/history (P2 路线图), 降级返回空数组
  console.warn('[eco.ts] indexGetHistory: 后端端点未实现, 降级返回空数组 (filter=', filter, ')');
  return [];
}

export async function indexCompareEnterprise(enterpriseId: Id, type: IndexType): Promise<{
  enterpriseValue: number;
  industryBenchmark: number;
  percentile: number;
  industry: string;
  period: string;
}> {
  return get(`/eco-index/compare`, { params: { enterpriseId, type } });
}

// ============================================================================
// ECO-08 政府背书 (后端 prefix=/eco-gov, 子路径 /reports, /endorsements)
// ============================================================================

export async function govGenerateReport(input: {
  enterpriseId: Id;
  type: GovReportType;
  desensitizedLevel?: 'full' | 'partial' | 'aggregate';
}): Promise<GovReport> {
  return post<GovReport>(`/eco-gov/reports`, input);
}

export async function govSubmitReport(reportId: Id, regulator: string): Promise<GovReport> {
  // 后端未实现 /eco-gov/reports/{id}/submit (仅有 /ack, P2 路线图), 降级返回 submitted 状态报告
  console.warn('[eco.ts] govSubmitReport: 后端端点未实现, 降级返回 submitted 状态报告 (reportId=', reportId, ')');
  return {
    reportId,
    type: 'compliance_audit',
    enterpriseId: '' as Id,
    enterprise: '',
    source: 'FINTRUST',
    content: '[降级] 后端 submit 端点尚未实现, 报告状态已本地标记为 submitted',
    desensitizedLevel: 'partial',
    submittedAt: new Date().toISOString() as IsoTimestamp,
    status: 'submitted',
    regulatorAck: {
      regulator,
      acknowledgedAt: new Date().toISOString() as IsoTimestamp,
      note: '降级: 等待后端 submit 端点实现',
      endorsementGranted: false,
    },
  };
}

export async function govListReports(enterpriseId: Id): Promise<GovReport[]> {
  return get<GovReport[]>(`/eco-gov/reports`, { params: { enterpriseId } });
}

export async function govAcknowledgeReport(
  reportId: Id,
  regulator: string,
  note: string,
  endorse: boolean,
): Promise<GovReport> {
  return post<GovReport>(`/eco-gov/reports/${reportId}/ack`, { regulator, note, endorse });
}

export async function govListEndorsements(enterpriseId: Id): Promise<GovEndorsement[]> {
  return get<GovEndorsement[]>(`/eco-gov/endorsements`, { params: { enterpriseId } });
}

export async function govApplyForEndorsement(
  enterpriseId: Id,
  regulator: string,
  scope: readonly string[],
): Promise<{ applicationId: Id; status: 'pending_review' }> {
  return post(`/eco-gov/endorsements`, { enterpriseId, regulator, scope });
}

// ============================================================================
// ECO-09 数字分身 (后端 prefix=/eco-bot, 子路径 /parse, /execute, /broadcast, /config/{id})
// ============================================================================

export async function botParseCommand(input: {
  text: string;
  channel: BotChannel;
  enterpriseId: Id;
  workerId?: Id;
}): Promise<BotCommandParse> {
  return post<BotCommandParse>(`/eco-bot/parse`, input);
}

export async function botExecuteCommand(parse: BotCommandParse, conversationId?: Id): Promise<BotCommandResult> {
  return post<BotCommandResult>(`/eco-bot/execute`, { parse, conversationId });
}

export async function botGetConversation(conversationId: Id): Promise<BotConversation | null> {
  // 后端未实现 /eco-bot/conversation/{id} (P2 路线图), 降级返回 null
  console.warn('[eco.ts] botGetConversation: 后端端点未实现, 降级返回 null (conversationId=', conversationId, ')');
  return null;
}

export async function botListConversations(enterpriseId: Id): Promise<BotConversation[]> {
  // 后端未实现 /eco-bot/conversations/{enterpriseId} (P2 路线图), 降级返回空数组
  console.warn('[eco.ts] botListConversations: 后端端点未实现, 降级返回空数组 (enterpriseId=', enterpriseId, ')');
  return [];
}

export async function botGetConfig(enterpriseId: Id): Promise<BotConfig | null> {
  return get<BotConfig | null>(`/eco-bot/config/${enterpriseId}`);
}

export async function botUpdateConfig(enterpriseId: Id, patch: Partial<BotConfig>): Promise<BotConfig> {
  // 后端未实现 PUT /eco-bot/config/{id} (仅 GET, P2 路线图), 降级返回 patch 本身作为新配置
  console.warn('[eco.ts] botUpdateConfig: 后端端点未实现, 降级返回 patch 本地副本 (enterpriseId=', enterpriseId, ')');
  return { ...(patch as BotConfig) };
}

export async function botBroadcast(input: {
  enterpriseId: Id;
  channel?: BotChannel;
  title: string;
  content: string;
  actions?: readonly BotReplyAction[];
  severity?: 'info' | 'warning' | 'error';
}): Promise<{ pushedTo: BotChannel[]; receiptCount: number }> {
  return post(`/eco-bot/broadcast`, input);
}

export async function botFallbackAnswer(question: string, enterpriseId: Id): Promise<{ answer: string; sources: string[] }> {
  // 后端未实现 /eco-bot/fallback (P2 路线图), 降级返回提示文本 + 空来源
  console.warn('[eco.ts] botFallbackAnswer: 后端端点未实现, 降级返回兜底答案 (enterpriseId=', enterpriseId, ')');
  return {
    answer: `抱歉, 数字分身尚在学习中 (问题: "${question}"). 该能力对应后端 /eco-bot/fallback 端点, 已列入 P2 路线图.`,
    sources: [],
  };
}
