/**
 * stores/eco.ts — ECO 9 模块跨模块状态管理
 *
 * 设计哲学:
 *   - 9 个 ECO 模块状态聚合在一处, 避免散落
 *   - 跨模块联动 (如 ECO-01 完成诊断 → 通知 ECO-09 数字分身)
 *   - 通过 EcoEvent 总线 (common.ts) 解耦
 *
 * project_memory 硬约束:
 *   - ECO-01 阅后即焚: 销毁后只能获取审计报告, 脱敏产物持久化
 *   - ECO-02 成果分成: 自动从放款资金扣分成 (不依赖企业主动付费)
 *   - ECO-05 反向竞拍: 串通检测 + 多头防控 (5 倍净资产)
 *   - ECO-06 积分商城: 防刷分 + 物流端配合度 10% → 90%
 *   - ECO-08 政府背书: log() 包含 id/enterprise/source 字段
 */

import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Id } from '@contracts/common';
import type {
  BurnDataType, BurnProgress, BurnDiagnosisResult, BurnAuditTrail, BurnStatus,
} from '@contracts/eco';
import type {
  SettlementRecord, PricingDifficulty,
} from '@contracts/eco';
import type { CreditApplicationRecord } from '@contracts/eco';
import type { VerifiableCredential } from '@contracts/eco';
import type { Tender, BankBid } from '@contracts/eco';
import type { WorkerAccount, ExchangeOrder } from '@contracts/eco';
import type { ComplianceIndexSnapshot } from '@contracts/eco';
import type { GovReport, GovEndorsement } from '@contracts/eco';
import type { BotConversation, BotConfig } from '@contracts/eco';
import * as ecoApi from '@/api/eco';

export const useEcoStore = defineStore('eco', () => {
  // === ECO-01 阅后即焚 ===
  const burnProgress = ref<Record<Id, BurnProgress>>({});
  const burnResults = ref<Record<Id, BurnDiagnosisResult>>({});
  const burnAudits = ref<Record<Id, BurnAuditTrail>>({});
  const burnStatuses = ref<Record<Id, BurnStatus>>({});

  // === ECO-02 阶梯定价 ===
  const settlements = ref<Record<Id, SettlementRecord[]>>({});

  // === ECO-03 无接口适配器 ===
  const creditApps = ref<Record<Id, CreditApplicationRecord[]>>({});

  // === ECO-04 联盟链凭证 ===
  const credentials = ref<Record<Id, VerifiableCredential[]>>({});

  // === ECO-05 反向竞拍 ===
  const tenders = ref<Tender[]>([]);
  const bids = ref<Record<Id, BankBid[]>>({});

  // === ECO-06 积分商城 ===
  const workerAccounts = ref<Record<Id, WorkerAccount>>({});
  const exchangeOrders = ref<Record<Id, ExchangeOrder[]>>({});

  // === ECO-07 行业指数 ===
  const indices = ref<ComplianceIndexSnapshot[]>([]);

  // === ECO-08 政府背书 ===
  const govReports = ref<Record<Id, GovReport[]>>({});
  const govEndorsements = ref<Record<Id, GovEndorsement[]>>({});

  // === ECO-09 数字分身 ===
  const botConversations = ref<Record<Id, BotConversation[]>>({});
  const botConfigs = ref<Record<Id, BotConfig>>({});

  // === 动作 (P5 充实具体调用) ===

  // ECO-01
  async function burnLoadRaw(enterpriseId: Id, dataType: BurnDataType, records: unknown[]) {
    return ecoApi.burnLoadRaw(enterpriseId, dataType, records);
  }
  async function burnStartDiagnosis(enterpriseId: Id) {
    return ecoApi.burnStartDiagnosis(enterpriseId);
  }
  async function burnGetProgress(enterpriseId: Id) {
    const p = await ecoApi.burnGetProgress(enterpriseId);
    if (p) burnProgress.value[enterpriseId] = p;
    return p;
  }
  async function burnGetResult(enterpriseId: Id) {
    const r = await ecoApi.burnGetResult(enterpriseId);
    if (r) burnResults.value[enterpriseId] = r;
    return r;
  }
  async function burnDestroy(enterpriseId: Id) {
    const audit = await ecoApi.burnDestroy(enterpriseId);
    burnAudits.value[enterpriseId] = audit;
    delete burnResults.value[enterpriseId];
    burnStatuses.value[enterpriseId] = 'destroyed';
    return audit;
  }
  /** 拉取销毁审计报告; silent=true 用于页面加载/切换企业时静默恢复 (未销毁不弹错误) */
  async function burnGetAudit(enterpriseId: Id, silent = true) {
    const a = await ecoApi.burnGetAudit(enterpriseId, silent);
    if (a) {
      burnAudits.value[enterpriseId] = a;
      burnStatuses.value[enterpriseId] = 'destroyed';
    }
    return a;
  }

  // ECO-02
  async function pricingCalc(input: {
    enterpriseId: Id;
    loanAmount: number;
    originalRate: number;
    achievedRate: number;
    termMonths: number;
    difficulty: PricingDifficulty;
  }) {
    const s = await ecoApi.pricingCalc(input);
    if (!settlements.value[input.enterpriseId]) {
      settlements.value[input.enterpriseId] = [];
    }
    settlements.value[input.enterpriseId]!.push(s);
    return s;
  }

  // ECO-03
  async function rpaGenerate(input: {
    enterpriseId: Id;
    bankId: Id;
    loanAmount: number;
    loanTermMonths: number;
    loanPurpose: string;
  }) {
    const app = await ecoApi.rpaGenerate(input);
    if (!creditApps.value[input.enterpriseId]) {
      creditApps.value[input.enterpriseId] = [];
    }
    creditApps.value[input.enterpriseId]!.unshift(app);
    return app;
  }

  // ECO-04
  async function credentialIssue(input: {
    enterpriseId: Id;
    type: 'reform_completion' | 'credit_portability' | 'five_streams_verified' | 'guarantee_active' | 'compliance_green';
  }) {
    const cred = await ecoApi.credentialIssue(input);
    if (!credentials.value[input.enterpriseId]) {
      credentials.value[input.enterpriseId] = [];
    }
    credentials.value[input.enterpriseId]!.push(cred);
    return cred;
  }

  // ECO-05
  async function bidPublish(input: Parameters<typeof ecoApi.bidPublish>[0]) {
    const t = await ecoApi.bidPublish(input);
    tenders.value.unshift(t);
    return t;
  }
  async function bidListBids(tenderId: Id) {
    const list = await ecoApi.bidListBids(tenderId);
    bids.value[tenderId] = list;
    return list;
  }
  async function bidAward(tenderId: Id) {
    return ecoApi.bidAward(tenderId);
  }

  // ECO-06
  async function ptsAwardPoints(input: {
    workerId: Id;
    behavior: 'scan_confirm' | 'exception_report' | 'streak_7d';
    geoFence?: { lat: number; lng: number };
  }) {
    const r = await ecoApi.ptsAwardPoints(input);
    if (r.newBalances) {
      const acc = workerAccounts.value[input.workerId];
      if (acc) {
        workerAccounts.value[input.workerId] = { ...acc, balances: r.newBalances };
      }
    }
    return r;
  }
  async function ptsPlaceOrder(workerId: Id, itemId: Id) {
    const order = await ecoApi.ptsPlaceOrder(workerId, itemId);
    if (!exchangeOrders.value[workerId]) {
      exchangeOrders.value[workerId] = [];
    }
    exchangeOrders.value[workerId]!.unshift(order);
    return order;
  }

  // ECO-07
  async function indexCalculate(input: {
    type: 'industry_reform_success' | 'industry_avg_credit' | 'interest_rate_benchmark' | 'compliance_distribution';
    industry?: string;
    period: string;
  }) {
    const snap = await ecoApi.indexCalculate(input);
    indices.value.unshift(snap);
    return snap;
  }

  // ECO-08
  async function govGenerateReport(input: {
    enterpriseId: Id;
    type: 'sandbox_penetration' | 'reform_outcome' | 'compliance_audit' | 'risk_alert';
    desensitizedLevel?: 'full' | 'partial' | 'aggregate';
  }) {
    const r = await ecoApi.govGenerateReport(input);
    if (!govReports.value[input.enterpriseId]) {
      govReports.value[input.enterpriseId] = [];
    }
    govReports.value[input.enterpriseId]!.unshift(r);
    return r;
  }

  // ECO-09
  async function botExecute(text: string, channel: 'wechat' | 'dingtalk' | 'web' | 'api', enterpriseId: Id, workerId?: Id) {
    const parse = await ecoApi.botParseCommand({ text, channel, enterpriseId, workerId });
    const result = await ecoApi.botExecuteCommand(parse);
    return result;
  }
  async function botBroadcast(input: Parameters<typeof ecoApi.botBroadcast>[0]) {
    return ecoApi.botBroadcast(input);
  }

  return {
    // state
    burnProgress, burnResults, burnAudits, burnStatuses,
    settlements,
    creditApps,
    credentials,
    tenders, bids,
    workerAccounts, exchangeOrders,
    indices,
    govReports, govEndorsements,
    botConversations, botConfigs,
    // actions
    burnLoadRaw, burnStartDiagnosis, burnGetProgress, burnGetResult, burnDestroy, burnGetAudit,
    pricingCalc,
    rpaGenerate,
    credentialIssue,
    bidPublish, bidListBids, bidAward,
    ptsAwardPoints, ptsPlaceOrder,
    indexCalculate,
    govGenerateReport,
    botExecute, botBroadcast,
  };
}, {
  persist: false,
});
