/**
 * eco.ts — Phase ECO 9 个市场化破局模块契约
 *
 * 设计依据:
 *   - spec.md v3.1 L3495+ 技术栈 + 9 大脑洞与战略补充
 *   - project_memory "6 大战略级补充建议 + 3 个降维打击脑洞"
 *   - production/reference/js/eco-*.js 业务逻辑参考实现
 *
 * 9 模块清单:
 *   ECO-01 阅后即焚零信任诊断     (MOD-16.1, P0, 破解数据隐私恐惧)
 *   ECO-02 成果导向阶梯定价       (MOD-16.9 衍生, P0, 破解冷启动门槛)
 *   ECO-03 无接口适配器           (INFRA-05, P1, 破解银行接入惰性)
 *   ECO-04 信用凭证联盟链         (MOD-08b, P1, 破解跨行确权难)
 *   ECO-05 反向竞拍融资大厅       (R9 终极形态, P2, 翻转银企博弈)
 *   ECO-06 积分商城与行为挖矿     (MOD-14, P1, 破解物流端配合度)
 *   ECO-07 FinTrust 企业合规指数  (R10 衍生, P2, 行业基准飞轮)
 *   ECO-08 监管/政府背书催化剂    (APP-04 衍生, P1, 破解信任门槛)
 *   ECO-09 微信/钉钉数字分身      (APP-02 衍生, P2, 傻瓜式操作)
 *
 * 实现原则:
 *   1. 每模块独立单例接口, 跨模块通信通过 EcoEvent 总线 (common.ts)
 *   2. 真实生产环境用 Vue 3 + Pinia store + axios api
 *   3. 浏览器 localStorage 全部替换为 PostgreSQL + Redis
 *   4. crypto.subtle SHA-256 替换为后端 hashlib + 联盟链 SDK
 *   5. setTimeout 模拟替换为 Temporal/Airflow DAG 编排
 */

import type {
  Id, IsoTimestamp, AmountInCents, Ratio, Percentage, Score,
} from './common';
import type { Scorecard8D, GapItem } from './scorecard';

// ============================================================================
// ECO-01: 阅后即焚零信任诊断 (MOD-16.1, eco-burn.js 镜像)
// ============================================================================

/** 阅后即焚诊断状态 */
export type BurnStatus = 'idle' | 'loaded' | 'diagnosing' | 'completed' | 'destroyed';

/** 阅后即焚诊断阶段 */
export type BurnPhase = 'loading' | 'portrait' | 'gap_analysis' | 'finalizing' | 'destroying';

/** 原始数据类型 (银行流水/税务明细/两套账凭证等) */
export type BurnDataType = 'bank_statement' | 'tax_detail' | 'dual_books' | 'invoice_raw' | 'contract_raw';

/** 原始数据加载入参 */
export interface BurnRawDataInput {
  readonly enterpriseId: Id;
  readonly dataType: BurnDataType;
  readonly records: readonly Record<string, unknown>[];   // 已脱敏前的真实记录
  readonly source: 'bank_api' | 'ocr' | 'enterprise_upload' | 'tax_api';
}

/** 诊断进度 */
export interface BurnProgress {
  readonly enterpriseId: Id;
  readonly startedAt: IsoTimestamp;
  readonly elapsedSec: number;
  readonly totalSec: number;                // 120 秒 (spec L2855)
  readonly phase: BurnPhase;
  readonly percentage: Ratio;               // 0-1
}

/** 脱敏诊断产物 (销毁后唯一保留物) */
export interface BurnDiagnosisResult {
  readonly enterpriseId: Id;
  readonly scorecard: Scorecard8D;           // 8 维评分
  readonly gaps: readonly GapItem[];         // TOP 12 项 Gap (8 维 + 4 合规违规)
  readonly completedAt: IsoTimestamp;
  readonly rawHash: string;                  // 销毁前的原始数据画像哈希 (审计比对)
  /** 诊断引擎: 'llm' = DeepSeek 深度诊断 (A 档, 锚定规则基线±10); 'rule' = 规则基线 (B 档) */
  readonly engine?: 'llm' | 'rule' | string;
  /** enclave 内提取的脱敏内容特征摘要 (术语频次/数值统计/金额要素 — 原文不出 enclave) */
  readonly contentDigest?: readonly string[];
}

/** 被销毁原始数据概况 (脱敏: 仅类型/条数/来源/体积, 不含内容) */
export interface BurnDataSummary {
  readonly dataType: string;
  readonly recordCount: number;
  readonly source: string;
  readonly bytesKb: number;
}

/** 差距项摘要 (审计报告诊断结论用) */
export interface BurnGapBrief {
  readonly dimension: string;
  readonly severity: 'low' | 'medium' | 'high' | 'critical';
  readonly delta: number;
  readonly current: number;
  readonly target: number;
  /** 诊断引擎给出的针对性改造动作 (LLM 定制引用材料具体发现 / 规则模板) */
  readonly action?: string;
}

/** 脱敏诊断结论摘要 (8 维评分卡快照 + 主要差距) */
export interface BurnDiagnosisSummary {
  readonly scorecard: Scorecard8D;
  readonly gapCount: number;
  readonly topGaps: readonly BurnGapBrief[];
  readonly completedAt: IsoTimestamp;
  /** enclave 内提取的内容特征摘要 (与产物 contentDigest 同源) */
  readonly contentDigest?: readonly string[];
  /** 诊断引擎溯源: 'llm' = DeepSeek 深度诊断 (A 档); 'rule' = 规则基线 (B 档) */
  readonly engine?: 'llm' | 'rule' | string;
}

/** 销毁审计报告 (MOD-08 链上存证) */
export interface BurnAuditTrail {
  readonly enterpriseId: Id;
  readonly destroyedAt: IsoTimestamp;
  readonly redisKeysCleared: number;         // raw_* 键清空数
  readonly threePassOverwrite: boolean;      // 三重覆写 (0x00/0xFF/random)
  readonly weakRefFinalized: boolean;        // WeakRef 兜底
  readonly rawHash: string;                  // 被销毁原始数据哈希 (与脱敏产物 rawHash 对账)
  readonly dataSummary?: BurnDataSummary | null;       // 被销毁数据概况 (脱敏)
  readonly diagnosisSummary?: BurnDiagnosisSummary | null;  // 诊断结论摘要 (8 维评分+差距)
  readonly chainEvidence: readonly BurnChainEvidence[];
}

/** 链上销毁证据 */
export interface BurnChainEvidence {
  readonly txId: Id;
  readonly block: number;
  readonly hash: string;
  readonly prevHash: string;
  readonly action: 'raw_loaded' | 'diagnosed' | 'destroyed' | 'audit_logged';
  readonly ts: IsoTimestamp;
}

/** ECO-01 阅后即焚引擎接口 */
export interface EcoBurnEngine {
  /** 加载原始敏感数据进安全内存 (真实环境: SGX enclave) */
  loadRawData(input: BurnRawDataInput): Promise<{ loaded: boolean; recordCount: number; bytes: number }>;

  /** 启动 120 秒诊断 (R1 画像 + R2 差距) */
  startDiagnosis(enterpriseId: Id): Promise<void>;

  /** 获取诊断进度 */
  getProgress(enterpriseId: Id): Promise<BurnProgress | null>;

  /** 获取脱敏诊断产物 (仅在 status=completed 时可获取, destroyed 后只能获取审计报告) */
  getResult(enterpriseId: Id): Promise<BurnDiagnosisResult | null>;

  /** 物理销毁原始数据 (spec: 120 秒后自动焚毁, 也支持手动提前) */
  secureDestroy(enterpriseId: Id): Promise<BurnAuditTrail>;

  /** 获取销毁审计报告 */
  getAuditTrail(enterpriseId: Id): Promise<BurnAuditTrail | null>;

  /** 获取全部企业诊断状态 */
  getAllStatus(): Promise<readonly { enterpriseId: Id; status: BurnStatus }[]>;

  /** 订阅进度变化 (UI 沙漏动效驱动) */
  subscribe(callback: (progress: BurnProgress) => void): () => void;

  /** 清空某企业所有数据 (管理/重置用) */
  clearAllFor(enterpriseId: Id): Promise<void>;
}

// ============================================================================
// ECO-02: 成果导向阶梯定价 (spec L3850-3893)
// ============================================================================

/** 改造难度档位 (spec L3876-3883 分成比例) */
export type PricingDifficulty =
  | 'green'        // 绿灯轻改造, 20% 分成
  | 'yellow'       // 黄灯中改造, 30% 分成
  | 'orange'       // 橙灯重改造, 40% 分成
  | 'r5_lite';     // R5-Lite 供应链轻改造, 15% 分成

/** 成果结算状态 */
export type SettlementStatus = 'pending' | 'calculated' | 'paid' | 'failed' | 'refunded';

/** 成果分成计算入参 */
export interface SettlementCalcInput {
  readonly enterpriseId: Id;
  readonly loanAmount: AmountInCents;        // 实际放款金额
  readonly originalRate: Percentage;         // 改造前市场利率 (如 8%)
  readonly achievedRate: Percentage;         // 改造后实际利率 (如 4%)
  readonly termMonths: number;                // 贷款期限 (月)
  readonly difficulty: PricingDifficulty;
  readonly reformCaseId?: Id;                 // 关联改造案例 (R10)
}

/** 成果分成结算记录 */
export interface SettlementRecord {
  readonly settlementId: Id;
  readonly enterpriseId: Id;
  readonly loanAmount: AmountInCents;
  readonly interestSaved: AmountInCents;      // 企业节约利息
  readonly difficulty: PricingDifficulty;
  readonly splitRatio: Ratio;                 // 分成比例 (0.15-0.40)
  readonly platformFee: AmountInCents;        // FinTrust 服务费 = interestSaved × splitRatio
  readonly enterpriseNet: AmountInCents;       // 企业净收益
  readonly status: SettlementStatus;
  readonly calculatedAt: IsoTimestamp;
  readonly paidAt?: IsoTimestamp;
  readonly autoDeductedFromLoan?: boolean;    // 是否自动从放款资金中扣分成
}

/** ECO-02 成果导向阶梯定价引擎接口 */
export interface EcoPricingEngine {
  /** 计算分成 (融资成功触发) */
  calculate(input: SettlementCalcInput): Promise<SettlementRecord>;

  /** 执行自动扣款 (与银行协议分账, 不依赖企业主动付费, spec L3893) */
  autoPay(settlementId: Id): Promise<{ paid: boolean; txId?: Id; failReason?: string }>;

  /** 查询单笔结算 */
  get(settlementId: Id): Promise<SettlementRecord | null>;

  /** 列出企业全部结算记录 */
  listByEnterprise(enterpriseId: Id): Promise<readonly SettlementRecord[]>;

  /** 退款 (改造失败兜底, spec L3892: 失败则顾问公司承担 Tier-2 成本) */
  refund(settlementId: Id, reason: string): Promise<SettlementRecord>;
}

// ============================================================================
// ECO-03: 无接口适配器 (INFRA-05, eco-rpa.js 镜像)
// ============================================================================

/** 银行冷启动接入档位 */
export type BankOnboardingTier =
  | 'tier_pdf'        // 仅生成 PDF 信贷申报书 (零开发)
  | 'tier_email'      // PDF + 邮件自动提交
  | 'tier_api_lite'   // 轻量 API (银行单向接收)
  | 'tier_api_full';  // 全双向 API (成熟期切换 INFRA-01b)

/** 信贷申报书生成入参 */
export interface CreditApplicationInput {
  readonly enterpriseId: Id;
  readonly bankId: Id;
  readonly loanAmount: AmountInCents;
  readonly loanTermMonths: number;
  readonly loanPurpose: string;
  readonly reformSnapshot?: Scorecard8D;     // 改造后评分卡
  readonly credentialRef?: Id;                // ECO-04 联盟链凭证引用
}

/** 信贷申报书记录 */
export interface CreditApplicationRecord {
  readonly applicationId: Id;
  readonly enterpriseId: Id;
  readonly bankId: Id;
  readonly pdfUrl: string;                     // PDF 文件 URL (对象存储)
  readonly pdfHash: string;                    // SHA-256 内容指纹 (防篡改)
  readonly submittedAt: IsoTimestamp;
  readonly tier: BankOnboardingTier;
  readonly status: 'draft' | 'submitted' | 'received' | 'in_review' | 'approved' | 'rejected';
  readonly bankReceivedAt?: IsoTimestamp;
  readonly bankAcknowledgement?: string;
}

/** ECO-03 无接口适配器接口 */
export interface EcoRpaEngine {
  /** 生成标准信贷申报书 PDF (spec: 银行冷启动零开发接入) */
  generate(input: CreditApplicationInput): Promise<CreditApplicationRecord>;

  /** 提交到银行 (tier_pdf=线下, tier_email=邮件, tier_api_lite=API 推送) */
  submit(applicationId: Id): Promise<{ submitted: boolean; failReason?: string }>;

  /** 获取单份申报书 */
  get(applicationId: Id): Promise<CreditApplicationRecord | null>;

  /** 列出企业全部申报书 */
  listByEnterprise(enterpriseId: Id): Promise<readonly CreditApplicationRecord[]>;

  /** 列出某银行收到的全部申报书 */
  listByBank(bankId: Id): Promise<readonly CreditApplicationRecord[]>;

  /** 银行端确认收到 (用于 tier_email/api 模式回执) */
  acknowledgeReceipt(applicationId: Id, bankNote: string): Promise<CreditApplicationRecord>;

  /** 升级接入档位 (从 tier_pdf 渐进升级到 tier_api_full) */
  upgradeTier(bankId: Id, targetTier: BankOnboardingTier): Promise<{ upgraded: boolean; reason?: string }>;
}

// ============================================================================
// ECO-04: 信用凭证联盟链 (MOD-08b, W3C VC 标准)
// ============================================================================

/** 凭证类型 */
export type CredentialType =
  | 'reform_completion'    // 改造完成凭证 (R10 出具)
  | 'credit_portability'   // 信用跨行便携凭证
  | 'five_streams_verified' // 五流合一验证凭证
  | 'guarantee_active'     // 担保生效凭证
  | 'compliance_green';    // 合规绿灯凭证 (R7 出具)

/** 凭证状态 */
export type CredentialStatus = 'active' | 'suspended' | 'revoked' | 'expired';

/** W3C Verifiable Credential 凭证主体 */
export interface VerifiableCredential {
  readonly credentialId: Id;
  readonly enterpriseId: Id;
  readonly type: CredentialType;
  readonly issuer: Id;                        // 签发方 (FinTrust 平台)
  readonly issuanceDate: IsoTimestamp;
  readonly expirationDate: IsoTimestamp;
  readonly credentialSubject: {
    readonly enterpriseName: string;
    readonly creditScore: Score;
    readonly reformLevel: string;
    readonly scorecard?: Scorecard8D;
    readonly claims: readonly string[];
  };
  readonly proof: {
    readonly type: 'Ed25519Signature2018' | 'BbsBlsSignature2020';
    readonly created: IsoTimestamp;
    readonly verificationMethod: string;
    readonly proofValue: string;              // base58 签名
    readonly blockchainAnchor?: {            // 联盟链锚定 (蚂蚁链/至信链)
      readonly chain: 'ant_chain' | 'zxin_chain';
      readonly txId: Id;
      readonly blockHeight: number;
      readonly blockHash: string;
    };
  };
  readonly status: CredentialStatus;
}

/** ECO-04 信用凭证联盟链引擎接口 */
export interface EcoCredentialEngine {
  /** 签发凭证 (改造完成 / 信用升级触发) */
  issue(input: {
    enterpriseId: Id;
    type: CredentialType;
    expiryMonths?: number;
    claims?: readonly string[];
  }): Promise<VerifiableCredential>;

  /** 验证凭证 (跨行核验) */
  verify(credentialId: Id): Promise<{
    valid: boolean;
    reason?: string;
    revocationCheckedAt: IsoTimestamp;
    signatureValid: boolean;
    blockchainVerified: boolean;
  }>;

  /** 吊销凭证 (企业失信/合规降级触发) */
  revoke(credentialId: Id, reason: string): Promise<VerifiableCredential>;

  /** 查询单个凭证 */
  get(credentialId: Id): Promise<VerifiableCredential | null>;

  /** 列出企业全部凭证 */
  listByEnterprise(enterpriseId: Id): Promise<readonly VerifiableCredential[]>;

  /** 跨行便携确权 (银行核验企业持证) */
  portableCheck(credentialId: Id, bankId: Id): Promise<{
    authorized: boolean;
    fields: readonly string[];                // 银行可见字段
    credential: VerifiableCredential;
  }>;

  /** 凭证转出 (合规版 NFT 转移, 跨行确权) */
  portOut(credentialId: Id, targetBankId: Id): Promise<{ ported: boolean; newCredentialId?: Id }>;
}

// ============================================================================
// ECO-05: 反向竞拍融资大厅 (eco-bid.js 镜像, spec L3311-3345)
// ============================================================================

/** 标书状态 */
export type TenderStatus =
  | 'draft' | 'published' | 'bidding' | 'awarded' | 'closed' | 'cancelled';

/** 标书发布入参 */
export interface TenderPublishInput {
  readonly enterpriseId: Id;
  readonly amount: AmountInCents;
  readonly termMonths: number;
  readonly rateFloor: Percentage;             // 利率下限 (企业期望最低利率)
  readonly purpose: string;
  readonly credentialRef?: Id;                 // ECO-04 凭证引用
  readonly invitedBankIds: readonly Id[];      // 邀请行白名单
  readonly biddingHours?: number;              // 竞价时长 (默认 24h)
}

/** 融资标书 */
export interface Tender {
  readonly tenderId: Id;
  readonly enterpriseId: Id;
  readonly enterpriseName: string;
  readonly amount: AmountInCents;
  readonly termMonths: number;
  readonly rateFloor: Percentage;
  readonly rateFloorLabel: string;
  readonly purpose: string;
  readonly credentialRef?: Id;
  readonly profileSummary: string;            // 脱敏企业画像摘要
  readonly publishedAt: IsoTimestamp;
  readonly deadline: IsoTimestamp;
  readonly status: TenderStatus;
  readonly invitedBankIds: readonly Id[];
  readonly winnerBidId?: Id;
  readonly chainEvidence: readonly BurnChainEvidence[];  // 链上存证 (复用)
}

/** 银行出价 */
export interface BankBid {
  readonly bidId: Id;
  readonly tenderId: Id;
  readonly bankId: Id;
  readonly bankName: string;
  readonly bankGroup?: string;
  readonly rate: Percentage;
  readonly amount: AmountInCents;
  readonly termMonths: number;
  readonly timeToFundDays: number;            // 放款时效 (天)
  readonly conditions: string;
  readonly submittedAt: IsoTimestamp;
  readonly status: 'pending' | 'winner' | 'archived' | 'disqualified';
  readonly isFraudulent: boolean;
  readonly fraudReason?: string;
  readonly signedHash: string;                 // 银行私钥签名
}

/** 综合成本排序权重 (spec L3328: 利率 60% + 额度 20% + 时效 20%) */
export interface BidCostWeights {
  readonly rate: Ratio;                        // 默认 0.6
  readonly amount: Ratio;                      // 默认 0.2
  readonly speed: Ratio;                       // 默认 0.2
}

/** 串通检测证据 */
export interface CollusionEvidence {
  readonly suspectedBidIds: readonly Id[];
  readonly reason: string;
  readonly rateTolerance: number;              // 利率容差 (0.0001 = 0.01%)
  readonly groupOverlap: boolean;               // 是否有集团关联
  readonly detectedAt: IsoTimestamp;
}

/** 多头防控结果 */
export interface MultiHeadCheckResult {
  readonly enterpriseId: Id;
  readonly netAssets: AmountInCents;            // 净资产代理值
  readonly totalExposure: AmountInCents;        // 累计授信
  readonly exposureRatio: Ratio;                // totalExposure / netAssets
  readonly threshold: number;                   // 净资产倍数阈值 (5 = 5 倍, spec L3341)
  readonly withinLimit: boolean;
}

/** ECO-05 反向竞拍融资大厅引擎接口 */
export interface EcoBidEngine {
  /** 发布融资标书 (企业发标) */
  publish(input: TenderPublishInput): Promise<Tender>;

  /** 列出全部标书 (企业/银行视角) */
  list(filter?: { enterpriseId?: Id; status?: TenderStatus }): Promise<readonly Tender[]>;

  /** 获取单份标书 */
  get(tenderId: Id): Promise<Tender | null>;

  /** 银行提交出价 (链上签名) */
  submitBid(input: {
    tenderId: Id;
    bankId: Id;
    rate: Percentage;
    amount: AmountInCents;
    termMonths: number;
    timeToFundDays: number;
    conditions?: string;
  }): Promise<BankBid>;

  /** 列出标书全部出价 */
  listBids(tenderId: Id): Promise<readonly BankBid[]>;

  /** 中标确认 (按综合成本排序, spec L3328) */
  award(tenderId: Id): Promise<{ winnerBidId: Id; ranking: readonly BankBid[] }>;

  /** 串通报价检测 (利率容差 + 集团关联图谱, spec L3316) */
  detectCollusion(tenderId: Id): Promise<CollusionEvidence | null>;

  /** 多头防控 (累计授信 vs 5 倍净资产, spec L3341) */
  checkMultiHead(enterpriseId: Id): Promise<MultiHeadCheckResult>;

  /** 获取匿名归档 (未中标出价抹除银行名称, 供 MOD-16.10 行业基准分析) */
  getArchive(filter?: { tenderId?: Id }): Promise<readonly {
    readonly archiveId: Id;
    readonly tenderId: Id;
    readonly rate: Percentage;
    readonly amount: AmountInCents;
    readonly termMonths: number;
    readonly timeToFundDays: number;
    readonly archivedAt: IsoTimestamp;
    readonly reason: string;
  }[]>;
}

// ============================================================================
// ECO-06: 积分商城与行为挖矿 (eco-pts.js 镜像, spec L2283-2311)
// ============================================================================

/** 积分类型 (三种余额) */
export type PointsKind = 'credit' | 'carbon' | 'easyTrust';

/** 行为类型 (积分发放规则) */
export type BehaviorKind =
  | 'scan_confirm'        // 扫码确权: credit+2 / carbon+5 / easyTrust+3
  | 'exception_report'    // 异常上报: credit+3 / carbon+2 / easyTrust+5
  | 'streak_7d';          // 连续 7 天准时: credit+20

/** 工人账户 */
export interface WorkerAccount {
  readonly workerId: Id;
  readonly name: string;
  readonly role: string;
  readonly enterpriseId: Id;
  readonly deviceFp: string;                   // 设备指纹 (防刷分)
  readonly balances: {
    credit: number;                            // 信用分
    carbon: number;                            // 碳积分
    easyTrust: number;                         // 信易分
  };
  readonly streakDays: number;                 // 连续准时确权天数
  readonly monthlyConsumption: AmountInCents;  // 当月消耗金额
  readonly createdAt: IsoTimestamp;
}

/** 商品 */
export interface ShopItem {
  readonly itemId: Id;
  readonly name: string;
  readonly icon: string;
  readonly creditCost: number;
  readonly currencyCost: AmountInCents;        // 财务顾问公司团购成本 (spec L2293)
  readonly stock: number;
  readonly category: '电子' | '生活' | '餐饮' | '通讯' | '娱乐';
}

/** 兑换订单 */
export interface ExchangeOrder {
  readonly orderId: Id;
  readonly workerId: Id;
  readonly itemId: Id;
  readonly itemName: string;
  readonly creditCost: number;
  readonly currencyCost: AmountInCents;
  readonly status: 'pending' | 'shipped' | 'delivered' | 'cancelled';
  readonly placedAt: IsoTimestamp;
  readonly shippedAt?: IsoTimestamp;
}

/** 防刷分审计日志 */
export interface FraudLogEntry {
  readonly logId: Id;
  readonly workerId: Id;
  readonly reason: string;                     // 重复扫码 / 设备异常 / GPS 越界
  readonly attemptedPoints: number;
  readonly blocked: boolean;
  readonly occurredAt: IsoTimestamp;
  readonly geoFence?: { lat: number; lng: number; radiusKm: number };
}

/** ECO-06 积分商城与行为挖矿引擎接口 */
export interface EcoPtsEngine {
  /** 发放积分 (行为触发: 扫码确权 / 异常上报 / 连续奖励) */
  awardPoints(input: {
    workerId: Id;
    behavior: BehaviorKind;
    evidence?: readonly string[];
    geoFence?: { lat: number; lng: number };
  }): Promise<{ awarded: boolean; newBalances: WorkerAccount['balances']; fraudBlocked?: boolean; reason?: string }>;

  /** 获取工人账户 */
  getAccount(workerId: Id): Promise<WorkerAccount | null>;

  /** 列出企业全部工人账户 */
  listByEnterprise(enterpriseId: Id): Promise<readonly WorkerAccount[]>;

  /** 商品库 */
  listShopItems(): Promise<readonly ShopItem[]>;

  /** 兑换商品 */
  placeOrder(workerId: Id, itemId: Id): Promise<ExchangeOrder>;

  /** 列出工人全部兑换订单 */
  listOrders(workerId: Id): Promise<readonly ExchangeOrder[]>;

  /** 查询防刷分审计日志 */
  getFraudLog(filter?: { workerId?: Id; from?: IsoTimestamp; to?: IsoTimestamp }): Promise<readonly FraudLogEntry[]>;

  /** 查询企业物流端配合度 (spec KPI: 10% → 90%) */
  getCooperationRate(enterpriseId: Id): Promise<{
    current: Ratio;                             // 当前配合度
    baseline: Ratio;                            // 10% 基线
    target: Ratio;                              // 90% 目标
    monthlyCost: AmountInCents;                 // 当月消耗
    withinBudget: boolean;                       // 是否在 30-50 元/人/月 范围内
  }>;
}

// ============================================================================
// ECO-07: FinTrust 企业合规指数 (R10 衍生, 行业基准飞轮)
// ============================================================================

/** 指数类型 */
export type IndexType =
  | 'industry_reform_success'    // 行业改造成功率指数
  | 'industry_avg_credit'        // 行业平均信用分指数
  | 'interest_rate_benchmark'    // 行业利率基准指数 (ECO-05 匿名归档衍生)
  | 'compliance_distribution';   // 合规分布指数 (R7 红黄绿占比)

/** 指数快照 */
export interface ComplianceIndexSnapshot {
  readonly indexId: Id;
  readonly type: IndexType;
  readonly industry: string;
  readonly period: string;                    // "2026-Q3"
  readonly value: number;                     // 指数值
  readonly sampleSize: number;                 // 样本数 (案例库规模)
  readonly methodology: string;                // 计算方法说明
  readonly publishedAt: IsoTimestamp;
  readonly signature: string;                 // 防篡改指纹
}

/** ECO-07 FinTrust 企业合规指数引擎接口 */
export interface EcoIndexEngine {
  /** 计算指数 (基于 R10 案例库 + ECO-05 匿名归档) */
  calculate(input: {
    type: IndexType;
    industry?: string;
    period: string;
  }): Promise<ComplianceIndexSnapshot>;

  /** 查询指数历史 */
  getHistory(filter: {
    type: IndexType;
    industry?: string;
    from?: IsoTimestamp;
    to?: IsoTimestamp;
  }): Promise<readonly ComplianceIndexSnapshot[]>;

  /** 企业 vs 行业基准对比 */
  compareEnterprise(enterpriseId: Id, type: IndexType): Promise<{
    enterpriseValue: number;
    industryBenchmark: number;
    percentile: Ratio;                        // 行业百分位 0-1
    industry: string;
    period: string;
  }>;

  /** 发布指数 (公开 / 私有 / 监管可见) */
  publish(snapshot: ComplianceIndexSnapshot, visibility: 'public' | 'private' | 'regulator'): Promise<void>;
}

// ============================================================================
// ECO-08: 监管/政府背书催化剂 (eco-gov.js 镜像, APP-04 衍生)
// ============================================================================

/** 报告类型 */
export type GovReportType =
  | 'sandbox_penetration'    // 监管沙盒穿透报告
  | 'reform_outcome'         // 改造成果报告
  | 'compliance_audit'       // 合规审计报告
  | 'risk_alert';            // 风险预警报告

/** 报告状态 */
export type GovReportStatus =
  | 'draft' | 'submitted' | 'in_review' | 'endorsed' | 'rejected' | 'archived';

/** 监管沙盒穿透报告 (project_memory: log() 需包含 id/enterprise/source 字段) */
export interface GovReport {
  readonly reportId: Id;
  readonly type: GovReportType;
  readonly enterpriseId: Id;
  readonly enterprise: string;                // 企业名称 (冗余字段, 跨模块兼容)
  readonly source: string;                     // 报告数据来源 (FINTRUST/REGULATOR/BANK)
  readonly content: string;                    // 报告正文 (脱敏后)
  readonly desensitizedLevel: 'full' | 'partial' | 'aggregate';
  readonly submittedAt: IsoTimestamp;
  readonly status: GovReportStatus;
  readonly regulatorAck?: {
    readonly regulator: string;
    readonly acknowledgedAt: IsoTimestamp;
    readonly note: string;
    readonly endorsementGranted: boolean;
  };
}

/** 政府背书 */
export interface GovEndorsement {
  readonly endorsementId: Id;
  readonly enterpriseId: Id;
  readonly regulator: string;                 // 监管机构名称
  readonly level: 'provisional' | 'formal' | 'premium';
  readonly grantedAt: IsoTimestamp;
  readonly validUntil: IsoTimestamp;
  readonly scope: readonly string[];          // 背书覆盖范围
  readonly linkedReportId: Id;
}

/** ECO-08 监管/政府背书催化剂引擎接口 */
export interface EcoGovEngine {
  /** 生成穿透报告 (project_memory: log() 需包含 id/enterprise/source) */
  generateReport(input: {
    enterpriseId: Id;
    type: GovReportType;
    desensitizedLevel?: 'full' | 'partial' | 'aggregate';
  }): Promise<GovReport>;

  /** 提交报告到监管机构 */
  submitReport(reportId: Id, regulator: string): Promise<GovReport>;

  /** 获取单份报告 */
  getReport(reportId: Id): Promise<GovReport | null>;

  /** 列出企业全部报告 */
  listReports(enterpriseId: Id): Promise<readonly GovReport[]>;

  /** 监管机构确认收到并附注 */
  acknowledgeReport(reportId: Id, regulator: string, note: string, endorse: boolean): Promise<GovReport>;

  /** 获取企业获得的全部背书 */
  listEndorsements(enterpriseId: Id): Promise<readonly GovEndorsement[]>;

  /** 申请背书 (主动申请, 监管审核后由 acknowledgeReport 触发) */
  applyForEndorsement(enterpriseId: Id, regulator: string, scope: readonly string[]): Promise<{ applicationId: Id; status: 'pending_review' }>;

  /** 监管沙盒访问令牌 (临时授权访问脱敏穿透报告) */
  issueRegulatorAccessToken(reportId: Id, regulator: string, ttlHours: number): Promise<{ token: Id; expiresAt: IsoTimestamp }>;
}

// ============================================================================
// ECO-09: 微信/钉钉数字分身 AI Agent (eco-bot.js 镜像, APP-02 衍生)
// ============================================================================

/** 数字分身宿主渠道 */
export type BotChannel = 'wechat' | 'dingtalk' | 'web' | 'api';

/** 数字分身命令意图 */
export type BotIntentKind =
  | 'query_progress'         // 查询改造进度
  | 'query_credit'           // 查询信用分
  | 'apply_financing'        // 发起融资 (联动 ECO-05)
  | 'submit_responsibility'  // 提交责任链确权 (联动 ECO-06)
  | 'report_exception'       // 异常上报 (联动 ECO-06)
  | 'view_report'            // 查看穿透报告 (联动 ECO-08)
  | 'answer_question'         // 业务问答 (LLM 兜底)
  | 'unknown';

/** 命令解析结果 */
export interface BotCommandParse {
  readonly intent: BotIntentKind;
  readonly confidence: Ratio;
  readonly entities: Record<string, string>;   // 提取的实体 (金额/期限/节点 ID 等)
  readonly rawText: string;
  readonly originalChannel: BotChannel;
}

/** 命令执行结果 */
export interface BotCommandResult {
  readonly commandId: Id;
  readonly intent: BotIntentKind;
  readonly success: boolean;
  readonly replyText: string;                  // 回复用户的文本
  readonly replyCard?: BotReplyCard;            // 富媒体卡片
  readonly linkedModule?: 'ECO-01' | 'ECO-05' | 'ECO-06' | 'ECO-08' | 'reform';
  readonly linkedActionId?: Id;
  readonly executedAt: IsoTimestamp;
  readonly durationMs: number;
}

/** 富媒体回复卡片 */
/** 机器人回复卡片动作元素 */
export interface BotReplyAction {
  readonly label: string;
  readonly action: string;
  readonly payload?: Record<string, unknown>;
}

export interface BotReplyCard {
  readonly cardType: 'progress_bar' | 'score_radar' | 'list' | 'chart' | 'action';
  readonly title: string;
  readonly fields: readonly { label: string; value: string; emphasize?: boolean }[];
  readonly actions?: readonly BotReplyAction[];
}

/** 会话记录 */
export interface BotConversation {
  readonly conversationId: Id;
  readonly enterpriseId: Id;
  readonly workerId?: Id;
  readonly channel: BotChannel;
  readonly messages: readonly {
    readonly role: 'user' | 'bot';
    readonly text: string;
    readonly ts: IsoTimestamp;
    readonly commandId?: Id;
  }[];
  readonly createdAt: IsoTimestamp;
  readonly lastActiveAt: IsoTimestamp;
}

/** 数字分身配置 */
export interface BotConfig {
  readonly enterpriseId: Id;
  readonly botName: string;
  readonly avatar: string;
  readonly channels: readonly BotChannel[];
  readonly defaultLanguage: 'zh-CN';
  readonly llmModel: 'deepseek-v3' | 'deepseek-r1';
  readonly enabledIntents: readonly BotIntentKind[];
  readonly rateLimitPerMin: number;
}

/** ECO-09 微信/钉钉数字分身 AI Agent 接口 */
export interface EcoBotEngine {
  /** 解析自然语言命令 */
  parseCommand(input: {
    text: string;
    channel: BotChannel;
    enterpriseId: Id;
    workerId?: Id;
  }): Promise<BotCommandParse>;

  /** 执行命令 (路由到对应 ECO 模块或 LLM 兜底) */
  executeCommand(parse: BotCommandParse, conversationId?: Id): Promise<BotCommandResult>;

  /** 获取会话历史 */
  getConversation(conversationId: Id): Promise<BotConversation | null>;

  /** 列出企业全部会话 */
  listConversations(enterpriseId: Id): Promise<readonly BotConversation[]>;

  /** 获取/更新数字分身配置 */
  getConfig(enterpriseId: Id): Promise<BotConfig | null>;
  updateConfig(enterpriseId: Id, patch: Partial<BotConfig>): Promise<BotConfig>;

  /** 主动推送通知 (如改造里程碑达成 / 风险预警 / 积分到账) */
  broadcastNotification(input: {
    enterpriseId: Id;
    channel?: BotChannel;
    title: string;
    content: string;
    actions?: readonly BotReplyAction[];
    severity?: 'info' | 'warning' | 'error';
  }): Promise<{ pushedTo: readonly BotChannel[]; receiptCount: number }>;

  /** 兜底应答 (LLM 处理 intent=unknown 的查询) */
  fallbackAnswer(question: string, enterpriseId: Id): Promise<{ answer: string; sources: readonly string[] }>;
}

// ============================================================================
// 9 模块汇总导出
// ============================================================================

/** 9 个 ECO 模块引擎接口汇总 (依赖注入容器用) */
export interface EcoEngines {
  readonly eco01_burn: EcoBurnEngine;
  readonly eco02_pricing: EcoPricingEngine;
  readonly eco03_rpa: EcoRpaEngine;
  readonly eco04_credential: EcoCredentialEngine;
  readonly eco05_bid: EcoBidEngine;
  readonly eco06_pts: EcoPtsEngine;
  readonly eco07_index: EcoIndexEngine;
  readonly eco08_gov: EcoGovEngine;
  readonly eco09_bot: EcoBotEngine;
}

/** 模块代码 (跨模块引用时使用, 避免魔法字符串) */
export type EcoModuleCode =
  | 'ECO-01' | 'ECO-02' | 'ECO-03' | 'ECO-04' | 'ECO-05'
  | 'ECO-06' | 'ECO-07' | 'ECO-08' | 'ECO-09';

/** 模块代码 → 引擎键映射 (依赖注入解析用) */
export const ECO_MODULE_KEY_MAP: Readonly<Record<EcoModuleCode, keyof EcoEngines>> = Object.freeze({
  'ECO-01': 'eco01_burn',
  'ECO-02': 'eco02_pricing',
  'ECO-03': 'eco03_rpa',
  'ECO-04': 'eco04_credential',
  'ECO-05': 'eco05_bid',
  'ECO-06': 'eco06_pts',
  'ECO-07': 'eco07_index',
  'ECO-08': 'eco08_gov',
  'ECO-09': 'eco09_bot',
});
