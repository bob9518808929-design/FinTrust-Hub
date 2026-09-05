/**
 * mock-data.js — FinTrust Hub 模拟系统预置数据
 * 包含: 3家企业 + 3家银行 + 担保公司 + 保险公司 + 12个责任节点 + 政策版本
 */

// === 责任节点模板（12个节点）===
const RESPONSIBILITY_NODES_TEMPLATE = [
  { nodeId: 'N01', name: '融资申请提交',      role: '财务负责人',     operator: '王财务',         approver: null,        method: '电子签名',     creditWeight: 0, stage: '融资前' },
  { nodeId: 'N02', name: '贷款合同签署',      role: '企业法人',       operator: '王总',           approver: null,        method: '电子签名+人脸', creditWeight: 0, stage: '融资中' },
  { nodeId: 'N03', name: '采购合同签订',      role: '采购负责人',     operator: '张采购',         approver: '王总',      method: '电子签名',     creditWeight: 2, stage: '采购' },
  { nodeId: 'N04', name: '采购付款审批',      role: '财务审批人',     operator: '李审批',         approver: '王总',      method: '双因子',       creditWeight: 3, stage: '采购' },
  { nodeId: 'N05', name: '原材料入库确认',    role: '仓库管理员',     operator: '张仓库',         approver: '李审批',    method: '扫码+GPS',     creditWeight: 2, stage: '仓储' },
  { nodeId: 'N06', name: '生产线领料确认',    role: '生产负责人',     operator: '赵生产',         approver: '李审批',    method: '扫码',         creditWeight: 2, stage: '生产' },
  { nodeId: 'N07', name: '成品入库确认',      role: '仓库管理员',     operator: '张仓库',         approver: '李审批',    method: '扫码+称重',    creditWeight: 2, stage: '仓储' },
  { nodeId: 'N08', name: '物流发运确认',      role: '物流负责人',     operator: '孙物流',         approver: '李审批',    method: '运单签章',     creditWeight: 2, stage: '物流' },
  { nodeId: 'N09', name: '客户签收确认',      role: '物流/客户',      operator: '孙物流',         approver: null,        method: 'GPS+电子签收', creditWeight: 3, stage: '物流' },
  { nodeId: 'N10', name: '应收款催收',        role: '销售/财务',      operator: '周销售',         approver: '王总',      method: '催收记录',     creditWeight: 2, stage: '回款' },
  { nodeId: 'N11', name: '回款入账确认',      role: '财务人员',       operator: '王财务',         approver: '李审批',    method: '系统确认',     creditWeight: 3, stage: '回款' },
  { nodeId: 'N12', name: '到期还款确认',      role: '财务人员',       operator: '王财务',         approver: '李审批',    method: '系统执行',     creditWeight: 3, stage: '还款' }
];

// === 企业数据 ===
const ENTERPRISES = [
  {
    id: 'E001',
    name: '宏达精密制造有限公司',
    industry: 'manufacturing',
    industryLabel: '制造业',
    industryPolicy: 'neutral',
    riskProfile: 'normal',
    riskLabel: '正常',
    dataFlows: { fund: true, contract: true, invoice: true, logistics: false, iot: false, personnel: false },
    modules: { fundMonitor: 'strong', billService: true, arInsurance: false, iotPerception: false, blockchainAnchor: true, aiAutonomyMax: 'L2' },
    cooperation: { enterpriseMode: ['custody','planning'], bankMode: ['post_loan','consulting'], guarantorMode: [], insuranceMode: [] },
    // 分层可见: 银行10项(贷后监管) > 担保6项(押品评估) > 保险3项(风险厘定) — 三类机构独立,互不覆盖
    dataVisibility: {
      bank:      ['enterpriseName','legalRep','registeredCapital','establishDate','transactions','counterparty_desensitized','creditScore','accountBalance','transactionHistory','financials'],
      guarantor: ['enterpriseName','legalRep','registeredCapital','creditScore','financials','billsHeld'],
      insurance: ['enterpriseName','creditScore','financials']
    },
    financials: {
      monthlyRevenue: 8000000,
      monthlyExpense: 6200000,
      accountBalance: 3500000,
      pendingAR: 12000000,
      billsHeld: [
        { billId: 'B001', amount: 2000000, dueDate: '2026-09-15', type: 'bank_acceptance', insured: false }
      ]
    },
    runtime: {
      creditCompleteness: 0.50,
      creditScore: 720,
      maxAmountMultiplier: 1.0,
      rateDiscount: 0,
      creditGradeCap: 'B',
      approvalSpeed: 'normal',
      waterLevel: 0.75,
      fiveStreams: { contract: false, invoice: false, logistics: false, fund: false, iot: false },
      guaranteeStatus: 'none',
      insuranceStatus: 'none',
      financingUnlocked: false,
      responsibilityChain: { nodes: [], completeness: 0, totalScore: 0, complianceReport: null }
    },
    reform: {
      hasReformed: false,
      reformedAt: null,
      beforeLevel: 'B',
      afterLevel: null,
      totalInvestmentHours: 0,
      totalCost: 0,
      beforeScorecard: { subject: 65, finance: 60, tax: 55, business: 62, assets: 60, credit: 68, policy: 55, capital: 58 },
      afterScorecard: null,
      completedActions: []
    }
  },
  {
    id: 'E002',
    name: '智芯科技有限公司',
    industry: 'high_tech',
    industryLabel: '高新技术',
    industryPolicy: 'encourage',
    riskProfile: 'premium',
    riskLabel: '优质',
    dataFlows: { fund: true, contract: true, invoice: true, logistics: true, iot: true, personnel: false },
    modules: { fundMonitor: 'strong', billService: true, arInsurance: true, iotPerception: true, blockchainAnchor: true, aiAutonomyMax: 'L1' },
    cooperation: { enterpriseMode: ['custody','financing_advisory'], bankMode: ['pre_loan','post_loan','consulting','delegation'], guarantorMode: [], insuranceMode: ['joint_underwriting','claim_collab'] },
    // 智芯科技=优质: 银行全量开放14项(含敏感员工/薪酬/账户号) / 担保9项(押品+票据) / 保险5项(保前核保)
    dataVisibility: {
      bank:      ['enterpriseName','legalRep','registeredCapital','establishDate','transactions','counterparty_desensitized','employeeCount','salaryTotal','accountNumber','accountBalance','creditScore','transactionHistory','billsHeld','financials'],
      guarantor: ['enterpriseName','legalRep','registeredCapital','establishDate','creditScore','financials','billsHeld','accountBalance','transactionHistory'],
      insurance: ['enterpriseName','creditScore','financials','billsHeld','registeredCapital']
    },
    financials: {
      monthlyRevenue: 15000000,
      monthlyExpense: 10000000,
      accountBalance: 8000000,
      pendingAR: 25000000,
      billsHeld: [
        { billId: 'B002', amount: 5000000, dueDate: '2026-10-20', type: 'bank_acceptance', insured: true }
      ]
    },
    runtime: {
      creditCompleteness: 0.83,
      creditScore: 850,
      maxAmountMultiplier: 1.3,
      rateDiscount: -0.5,
      creditGradeCap: 'A',
      approvalSpeed: 'fast',
      waterLevel: 0.85,
      fiveStreams: { contract: true, invoice: true, logistics: true, fund: true, iot: true },
      guaranteeStatus: 'none',
      insuranceStatus: 'active',
      financingUnlocked: false,
      responsibilityChain: { nodes: [], completeness: 0, totalScore: 0, complianceReport: null }
    },
    reform: {
      hasReformed: false,
      reformedAt: null,
      beforeLevel: 'A',
      afterLevel: null,
      totalInvestmentHours: 0,
      totalCost: 0,
      beforeScorecard: { subject: 92, finance: 88, tax: 90, business: 85, assets: 82, credit: 95, policy: 88, capital: 86 },
      afterScorecard: null,
      completedActions: []
    }
  },
  {
    id: 'E003',
    name: '鑫达贸易有限公司',
    industry: 'real_estate_related',
    industryLabel: '房地产关联',
    industryPolicy: 'restrict',
    riskProfile: 'high_risk',
    riskLabel: '高风险',
    dataFlows: { fund: true, contract: false, invoice: false, logistics: false, iot: false, personnel: false },
    modules: { fundMonitor: 'weak', billService: false, arInsurance: false, iotPerception: false, blockchainAnchor: false, aiAutonomyMax: 'L3' },
    cooperation: { enterpriseMode: ['advisory'], bankMode: ['discovery'], guarantorMode: ['collaborate','compensation'], insuranceMode: [] },
    // 鑫达贸易=高风险: 最小可见策略(仅名称+信用), 担保合作模式略多2项(财务+票据用于反担保评估)
    dataVisibility: {
      bank:      ['enterpriseName','creditScore'],
      guarantor: ['enterpriseName','legalRep','creditScore','financials','billsHeld'],
      insurance: ['enterpriseName']
    },
    financials: {
      monthlyRevenue: 5000000,
      monthlyExpense: 4800000,
      accountBalance: 800000,
      pendingAR: 3000000,
      billsHeld: []
    },
    runtime: {
      creditCompleteness: 0.17,
      creditScore: 580,
      maxAmountMultiplier: 0.5,
      rateDiscount: 2.0,
      creditGradeCap: 'C',
      approvalSpeed: 'slow',
      waterLevel: 0.30,
      fiveStreams: { contract: false, invoice: false, logistics: false, fund: false, iot: false },
      guaranteeStatus: 'pending',
      insuranceStatus: 'none',
      financingUnlocked: false,
      responsibilityChain: { nodes: [], completeness: 0, totalScore: 0, complianceReport: null }
    },
    reform: {
      hasReformed: false,
      reformedAt: null,
      beforeLevel: 'C',
      afterLevel: null,
      totalInvestmentHours: 0,
      totalCost: 0,
      beforeScorecard: { subject: 45, finance: 40, tax: 38, business: 42, assets: 40, credit: 48, policy: 30, capital: 35 },
      afterScorecard: null,
      completedActions: []
    }
  }
];

// === 银行数据 ===
const BANKS = [
  { id: 'BK001', name: '招商银行', baseRate: 'LPR+1.5%', baseRateValue: 4.45, maxAmount: 10000000, requiresGuarantee: false, label: '灵活, 无担保要求' },
  { id: 'BK002', name: '工商银行', baseRate: 'LPR+1.2%', baseRateValue: 4.15, maxAmount: 15000000, requiresGuarantee: true,  label: '利率低, 需担保' },
  { id: 'BK003', name: '网商银行', baseRate: 'LPR+2.0%', baseRateValue: 4.95, maxAmount: 5000000,  requiresGuarantee: false, label: '快速放款, 额度小' }
];

// === 担保公司 ===
const GUARANTORS = [
  { id: 'G001', name: '中小微融资担保公司', mode: 'collaborate', activeGuarantees: 0, guaranteeRate: '1.5%' }
];

// === 保险公司 ===
const INSURERS = [
  { id: 'I001', name: '太平洋保险', mode: 'joint_underwriting', activePolicies: 1, premiumRate: '0.8%' }
];

// === 政策版本 ===
const POLICY_VERSIONS = [
  { version: '2026-Q2', label: '2026年Q2', manufacturing: 'neutral', high_tech: 'encourage', real_estate_related: 'neutral' },
  { version: '2026-Q3', label: '2026年Q3', manufacturing: 'neutral', high_tech: 'encourage', real_estate_related: 'restrict' }
];

// === 季节性窗口 ===
const SEASONAL_WINDOWS = {
  normal:           { label: '正常',           rateAdjust: 0,    desc: '' },
  quarter_end:      { label: '季末冲量窗口',    rateAdjust: -0.2, desc: '季末银行冲量，利率优惠' },
  year_end:         { label: '年末收紧',        rateAdjust: 0.3,  desc: '年末融资窗口收窄，建议提前规划' },
  spring_festival:  { label: '春节前紧张',      rateAdjust: 0.5,  desc: '春节前资金紧张预警' }
};

// === 数据流标签 ===
const DATA_FLOW_LABELS = {
  fund:       '资金流',
  contract:   '合同流',
  invoice:    '发票流',
  logistics:  '物流流',
  iot:        '物联流',
  personnel:  '人流'
};

// === 信用等级定义 ===
const CREDIT_GRADES = {
  A: { label: 'A级', desc: '五流合一验证通过', color: '#4caf50' },
  B: { label: 'B级', desc: '四流验证通过', color: '#2196f3' },
  C: { label: 'C级', desc: '基础验证', color: '#ff9800' }
};

// === AI自主度等级 ===
const AUTONOMY_LEVELS = {
  L1: { label: 'L1 全自主', desc: 'AI全权执行，事后通知', color: '#4caf50' },
  L2: { label: 'L2 自主+通知', desc: 'AI自主执行，同步通知人类', color: '#2196f3' },
  L3: { label: 'L3 建议+审批', desc: 'AI生成建议，人类审批', color: '#ff9800' },
  L4: { label: 'L4 人工执行', desc: 'AI仅提供信息，人类全权处理', color: '#f44336' }
};

// ================================================
// v4.3 新增: 三档分类能力数据 (spec v2.0 对齐 S1-S7)
// ================================================

// === 🟢 API 档: 15 个外部 API 适配层默认状态 (INFRA-01b) ===
const EXTERNAL_APIS = [
  { id: 'API-01', name: '银企直连流水抓取',     category: 'bank',       status: 'connected',    rateLimitCount: 0,  rateLimitMax: 100, circuitState: 'closed', fallbackTo: 'C7', lastLatencyMs: 320 },
  { id: 'API-02', name: '发票验真(国税总局)',   category: 'invoice',    status: 'connected',    rateLimitCount: 12, rateLimitMax: 100, circuitState: 'closed', fallbackTo: 'C5', lastLatencyMs: 180 },
  { id: 'API-03', name: '工商信息查询',          category: 'business',   status: 'connected',    rateLimitCount: 3,  rateLimitMax: 100, circuitState: 'closed', fallbackTo: 'C7', lastLatencyMs: 240 },
  { id: 'API-04', name: '司法查询(诉讼/失信)',  category: 'judicial',   status: 'connected',    rateLimitCount: 1,  rateLimitMax: 100, circuitState: 'closed', fallbackTo: 'C7', lastLatencyMs: 410 },
  { id: 'API-05', name: '票交所/ECDS 票据真伪',  category: 'bill',       status: 'connected',    rateLimitCount: 5,  rateLimitMax: 100, circuitState: 'closed', fallbackTo: 'C5', lastLatencyMs: 290 },
  { id: 'API-06', name: '物流 GPS 数据',         category: 'logistics',  status: 'disconnected', rateLimitCount: 0,  rateLimitMax: 100, circuitState: 'open',   fallbackTo: 'C3', lastLatencyMs: null },
  { id: 'API-07', name: '水电煤缴费记录',        category: 'utility',    status: 'connected',    rateLimitCount: 2,  rateLimitMax: 100, circuitState: 'closed', fallbackTo: 'C7', lastLatencyMs: 350 },
  { id: 'API-08', name: '电子签章服务',          category: 'contract',   status: 'connected',    rateLimitCount: 8,  rateLimitMax: 100, circuitState: 'closed', fallbackTo: 'C6', lastLatencyMs: 220 },
  { id: 'API-09', name: '区块链存证 SDK(蚂蚁链)',category: 'blockchain', status: 'connected',    rateLimitCount: 0,  rateLimitMax: 100, circuitState: 'closed', fallbackTo: 'C5', lastLatencyMs: 410 },
  { id: 'API-10', name: '关联方股权穿透',        category: 'business',   status: 'connected',    rateLimitCount: 1,  rateLimitMax: 100, circuitState: 'closed', fallbackTo: 'C4', lastLatencyMs: 380 },
  { id: 'API-11', name: '担保公司业务系统',      category: 'guarantee',  status: 'disconnected', rateLimitCount: 0,  rateLimitMax: 100, circuitState: 'open',   fallbackTo: 'C1', lastLatencyMs: null },
  { id: 'API-12', name: '保险公司业务系统',      category: 'insurance', status: 'connected',    rateLimitCount: 0,  rateLimitMax: 100, circuitState: 'closed', fallbackTo: 'C2', lastLatencyMs: 290 },
  { id: 'API-13', name: '法律意见书生成',        category: 'legal',      status: 'disconnected', rateLimitCount: 0,  rateLimitMax: 100, circuitState: 'open',   fallbackTo: 'C4', lastLatencyMs: null },
  { id: 'API-14', name: '外部审计师接口',       category: 'audit',      status: 'disconnected', rateLimitCount: 0,  rateLimitMax: 100, circuitState: 'open',   fallbackTo: 'C5', lastLatencyMs: null },
  { id: 'API-15', name: '征信机构(央行/百行)',   category: 'credit',     status: 'connected',    rateLimitCount: 4,  rateLimitMax: 100, circuitState: 'closed', fallbackTo: 'C7', lastLatencyMs: 480 }
];

// === 🔴 兜底档: C1-C7 兜底子模块默认状态 (MOD-15) ===
const FALLBACK_MODULES = [
  { id: 'C1', name: '担保兜底',     spec: 'MOD-13 (S1)',            status: 'standby', enabled: true, lastActivatedAt: null, servicesProvided: '简化版保函受理+保前审查规则引擎',           capabilityBounds: '✅ 受理+审查 / ❌ 跨机构代偿联动 / ❌ 担保资金真池',     relatedApi: 'API-11', specRef: 'MOD-13 + S1' },
  { id: 'C2', name: '保险兜底',     spec: 'MOD-13 (S1)',            status: 'standby', enabled: true, lastActivatedAt: null, servicesProvided: '简化版保单核保+理赔规则',                  capabilityBounds: '✅ 核保+理算 / ❌ 真实资金池 / ❌ 共保联动',           relatedApi: 'API-12', specRef: 'MOD-13 + S1' },
  { id: 'C3', name: '评估兜底',     spec: 'MOD-13 (S1)',            status: 'active',  enabled: true, lastActivatedAt: '2026-08-12T10:00:00Z', servicesProvided: '算法评估(57维特征+现金流悬崖模型)',  capabilityBounds: '✅ 内部算法 / ❌ 第三方权威评估师 / ❌ 抵押物实地勘察', relatedApi: 'API-06', specRef: 'MOD-13 + S1' },
  { id: 'C4', name: '法律兜底',     spec: 'MOD-13 (S1)',            status: 'standby', enabled: true, lastActivatedAt: null, servicesProvided: '法律意见书模板库+规则匹配',                 capabilityBounds: '✅ 模板生成 / ❌ 律师事务所签字背书 / ❌ 司法效力',     relatedApi: 'API-13', specRef: 'MOD-13 + S1' },
  { id: 'C5', name: '审计兜底',     spec: 'MOD-13 (S1)',            status: 'standby', enabled: true, lastActivatedAt: null, servicesProvided: '规则引擎审计+异常交易自动标注',             capabilityBounds: '✅ 内部规则审计 / ❌ CPA 签字 / ❌ 监管认可',            relatedApi: 'API-14', specRef: 'MOD-13 + S1' },
  { id: 'C6', name: '合同兜底',     spec: 'MOD-13 (S1)',            status: 'standby', enabled: true, lastActivatedAt: null, servicesProvided: '基础合同模板库(购销/借款/担保)',            capabilityBounds: '✅ 模板生成 / ❌ 电子签章存证 / ❌ 司法背书',           relatedApi: 'API-08', specRef: 'MOD-13 + S1' },
  { id: 'C7', name: '替代征信兜底', spec: 'MOD-13 + DATA-02 (S1)', status: 'standby', enabled: true, lastActivatedAt: null, servicesProvided: '替代征信评分(公开数据+水电煤+纳税+社保)',   capabilityBounds: '✅ 替代数据评分 / ❌ 央行征信报告 / ❌ 失信被执行人实时同步', relatedApi: 'API-15', specRef: 'MOD-13 + DATA-02 + S1' }
];

// === 🟡 自研档: B1-B12 自研护城河模块矩阵 ===
const SELF_DEVELOPED_MODULES = [
  { id: 'B1',  name: 'AI 驾驶舱 L1-L4 自主度',                  status: 'active', keyMetric: 'L1-L4 路由器命中率 100%',         moatSummary: '行业首个金额×风险双因子动态自主度分级', specRef: 'CORE-01 + CORE-02',          embodiedIn: 'Tab2 流程模拟器(路由) + Tab3 审批台(L3/L4) + Tab7 AI 驾驶舱(全局)' },
  { id: 'B2',  name: '字段级数据可见性矩阵',                    status: 'active', keyMetric: '14字段×3机构 多选配置',           moatSummary: '颗粒度行业最细,银行/担保/保险独立配置',  specRef: 'CORE-03',                    embodiedIn: 'Tab1 企业端(配置) + Tab4 银行端(脱敏对比)' },
  { id: 'B3',  name: '责任链全景',                              status: 'active', keyMetric: '12 责任节点 + 信用分联动',       moatSummary: '人流作为第零流贯穿全程',                specRef: 'CORE-03 + 人流主线',         embodiedIn: 'Tab1 企业端(责任链全景) + Tab4 银行端(合规报告) + Tab7 AI驾驶舱(回溯)' },
  { id: 'B4',  name: '五流合一验证',                            status: 'active', keyMetric: '5 流 + 责任人确认闭环',           moatSummary: '行业唯一五流+人流六流模型',              specRef: 'MOD-12',                     embodiedIn: 'Tab2 流程模拟器(五流验证+责任人确认)' },
  { id: 'B5',  name: '现金流悬崖预测',                          status: 'active', keyMetric: '30 天缺口预测误差<15%',          moatSummary: 'AI 提前预警资金断裂',                   specRef: 'MOD-02',                     embodiedIn: 'Tab2 流程模拟器 + Tab4 银行端(水位) + Tab7 AI 驾驶舱(预警)' },
  { id: 'B6',  name: '数字契约 DSL',                            status: 'active', keyMetric: '缺口触发自动锁定',               moatSummary: '可编程资金监管契约',                    specRef: 'MOD-02',                     embodiedIn: 'Tab2 流程模拟器(契约执行) + Tab4 银行端(冻结)' },
  { id: 'B7',  name: '关联方图欺诈检测',                        status: 'active', keyMetric: '2 跳关联回流检测',                moatSummary: '基于 Neo4j 图数据库',                   specRef: 'MOD-07',                     embodiedIn: 'Tab7 AI 驾驶舱(图欺诈告警) + Tab4 银行端(预警列表)' },
  { id: 'B8',  name: '政策引擎',                                status: 'active', keyMetric: 'Q2→Q3 政策切换重算',            moatSummary: '行业/季节性双维度政策路由',             specRef: 'MOD-10',                     embodiedIn: 'Tab1 企业端(政策标签) + Tab4 银行端(利率联动) + 顶部政策选择器' },
  { id: 'B9',  name: '同态加密+分片密钥',                       status: 'active', keyMetric: 'Paillier + FPE + Shamir t=3,n=3', moatSummary: '三方分片密钥,单方不可解密',             specRef: 'MOD-08',                     embodiedIn: 'Tab4 银行端(脱敏对比) + Tab8 监管沙盒(穿透报告)' },
  { id: 'B10', name: '撮合佣金引擎',                            status: 'active', keyMetric: '匹配度算法 + 佣金分成',          moatSummary: '一手托两家商业模型核心',                specRef: 'APP-03',                     embodiedIn: 'Tab6 财务顾问运营台(撮合工作台)' },
  { id: 'B11', name: '监管沙盒穿透报告',                        status: 'active', keyMetric: '8 位哈希 + Merkle 根',           moatSummary: '司法取证级证据链',                      specRef: 'APP-04 + MOD-08',            embodiedIn: 'Tab8 监管沙盒(穿透报告列表) + 联动日志面板(指纹)' },
  { id: 'B12', name: 'Modal/Toast 决策矩阵 + 全局告警横幅',     status: 'active', keyMetric: '不可逆阻塞/可逆非阻塞',         moatSummary: '基于决策影响×风险等级的交互路由',         specRef: 'CORE-04',                    embodiedIn: '全局(告警横幅 + Modal/Toast + 联动日志)' }
];

// === 📊 三档开发投入占比仪表盘数据 (S4+S7 修正) ===
const TIER_INVESTMENT = {
  apiAccess:     { modules: 15, hours: 320,  percentage: 18, label: 'API 接入档',     color: '#4caf50', desc: '仅做适配/限流/熔断/计费 — 不重复造轮子' },
  selfDeveloped: { modules: 12, hours: 1280, percentage: 72, label: '自研护城河档',  color: '#ff9800', desc: 'B1-B12 独有创新集中投入 — 核心竞争力' },
  fallback:      { modules: 7,  hours: 180,  percentage: 10, label: '独立兜底档',    color: '#f44336', desc: 'C1-C7 简化版兜底 — 不放弃独立运行能力' }
};

// === 兜底降级链级别定义 ===
const FALLBACK_CHAIN_LEVELS = {
  1: { label: 'API 接入',     color: '#4caf50', desc: '所有外部 API 正常接入,无需兜底',        icon: '🟢' },
  2: { label: 'C 兜底',       color: '#ff9800', desc: '部分 API 断开,对应 C 兜底子模块已激活',  icon: '🟠' },
  3: { label: '独立运行',     color: '#9c27b0', desc: '所有 API 强制断开,C1-C7 全部激活',      icon: '🟣' },
  4: { label: '拒绝服务',     color: '#f44336', desc: '系统无法提供该服务,明确告知用户原因',   icon: '🔴' }
};

// === 独立运行模式下能力清单 (S3 修正) ===
const INDEPENDENT_MODE_CAPABILITIES = {
  degradedServices: [
    '央行征信实时同步','跨机构代偿联动','律师签字背书',
    'CPA 签字审计','区块链外部背书','担保资金真池',
    '共保联动','抵押物实地勘察','失信被执行人实时同步'
  ],
  availableServices: [
    '替代征信评分','算法评估','规则引擎审计',
    '模板合同生成','法律意见模板','内部图欺诈检测',
    '五流合一验证','责任链全景','字段级可见性','AI 驾驶舱 L1-L4'
  ]
};

// ================================================
// v5.0 新增: Tab0 企业改造工作台数据 (simulation-plan.md v5.0 对齐)
// ================================================

// === 第4家企业: E004 海川物流 (测试用: 数据不合规的"改造前"状态) ===
// 典型不合规场景: 两本账 + 税务异常 + 业务佐证缺失 + 法人代持 + 三流不全
const E004_HAICHUAN_LOGISTICS = {
  id: 'E004',
  name: '海川物流有限公司',
  industry: 'logistics',
  industryLabel: '物流运输',
  industryPolicy: 'neutral',
  riskProfile: 'high_risk',           // 高风险: 多项不合规
  riskLabel: '高风险(待改造)',
  dataFlows: { fund: true, contract: false, invoice: false, logistics: false, iot: false, personnel: false },
  modules: { fundMonitor: 'weak', billService: false, arInsurance: false, iotPerception: false, blockchainAnchor: false, aiAutonomyMax: 'L3' },
  cooperation: { enterpriseMode: [], bankMode: [], guarantorMode: [], insuranceMode: [] },
  dataVisibility: {
    bank:      ['enterpriseName','legalRep','registeredCapital','accountBalance','creditScore'],
    guarantor: ['enterpriseName','legalRep','registeredCapital'],
    insurance: ['enterpriseName','creditScore']
  },
  financials: {
    monthlyRevenue: 4500000,          // 营收大幅低于行业平均
    monthlyExpense: 4800000,          // 支出>营收, 亏损经营
    accountBalance: 1200000,          // 账户余额低
    pendingAR: 3500000,               // 应收账款规模大, 回款慢
    billsHeld: []                     // 无票据持有
  },
  runtime: {
    creditCompleteness: 0.17,         // 仅 1/6 流, 信用完整度极低
    creditScore: 540,                 // 信用分低 (D级区间 520-560)
    maxAmountMultiplier: 0.7,
    rateDiscount: 1.0,
    creditGradeCap: 'C',              // 确权等级上限低
    approvalSpeed: 'slow',
    waterLevel: 0.28,                 // 水位红牌区
    fiveStreams: { contract: false, invoice: false, logistics: false, fund: true, iot: false },
    guaranteeStatus: 'none',
    insuranceStatus: 'none',
    financingUnlocked: false,
    responsibilityChain: { nodes: [], completeness: 0, totalScore: 0, complianceReport: null }
  },
  // v5.0: 企业改造画像 — 当前为"未改造"状态, 8维评分卡极低
  reform: {
    hasReformed: false,
    reformedAt: null,
    beforeLevel: 'D',
    afterLevel: null,
    totalInvestmentHours: 0,
    totalCost: 0,
    // 初始评分卡 (D级典型画像: 8维平均 <40)
    beforeScorecard: {
      subject: 35,    // 法人代持, 股权穿透未完成
      finance: 28,    // 两本账, 财务核算混乱
      tax: 22,        // 税务登记异常, Q3未申报
      business: 32,   // 业务真实性佐证缺失 (无合同/发票/物流单)
      assets: 38,     // 车辆产权不清, 固定资产未入账
      credit: 30,     // 未接入央行征信, 历史逾期
      policy: 35,     // 无任何政策资质
      capital: 25     // 实缴不足, 无增信
    },
    afterScorecard: null,
    completedActions: []
  }
};

// 把 E004 插入 ENTERPRISES 数组末尾
ENTERPRISES.push(E004_HAICHUAN_LOGISTICS);

// === 8维改造地图维度定义 ===
const REFORM_DIMENSIONS = {
  subject: {
    id: 'subject',
    name: '主体维度',
    icon: '🏢',
    desc: '法人/股权/工商主体合规',
    issues: ['代持法人','股权穿透不清晰','工商异常','注册地址失效'],
    solutions: ['法人变更为实控人','股权结构穿透梳理','工商异常移出','虚拟地址挂靠转实体'],
    weight: 0.15,
    bankImportance: 0.90
  },
  finance: {
    id: 'finance',
    name: '财务维度',
    icon: '📊',
    desc: '两账合一/财报规范/现金流',
    issues: ['内外账两套账','财报口径不标准','现金流悬崖','成本票缺失'],
    solutions: ['两账合一工程','引入标准会计科目','30天现金流预测','供应链票据梳理'],
    weight: 0.18,
    bankImportance: 0.95
  },
  tax: {
    id: 'tax',
    name: '税务维度',
    icon: '🧾',
    desc: '纳税规范/补税/发票合规',
    issues: ['税务异常','长期零申报','进销项不匹配','发票虚开风险'],
    solutions: ['税务异常移出','历史税款补缴','进项票梳理','发票电子化改造'],
    weight: 0.14,
    bankImportance: 0.92
  },
  business: {
    id: 'business',
    name: '业务维度',
    icon: '📦',
    desc: '真实性/合同/物流/交付链',
    issues: ['业务背景虚构','无交付证据','客户集中度高','关联交易不透明'],
    solutions: ['五流合一补齐','运单/签收链补全','客户集中度分散计划','关联方交易披露'],
    weight: 0.12,
    bankImportance: 0.88
  },
  assets: {
    id: 'assets',
    name: '资产维度',
    icon: '🏭',
    desc: '确权/押品/无形资产/存货',
    issues: ['固定资产未入账','无形资产未确权','存货账实不符','车辆/设备挂靠'],
    solutions: ['固定资产盘点入账','知识产权确权评估','存货盘点+RFID','车辆确权过户'],
    weight: 0.12,
    bankImportance: 0.80
  },
  credit: {
    id: 'credit',
    name: '信用维度',
    icon: '💳',
    desc: '征信/替代征信/失信记录',
    issues: ['征信空白','历史逾期','替代数据缺失','失信被执行人'],
    solutions: ['接入央行征信','替代征信(水电煤/社保)','失信修复','信用分目标850+'],
    weight: 0.15,
    bankImportance: 1.00
  },
  policy: {
    id: 'policy',
    name: '政策维度',
    icon: '📜',
    desc: '行业资质/补贴/优惠政策',
    issues: ['资质过期','未享行业优惠','环保/安全不达标','补贴未申请'],
    solutions: ['资质续期办理','高新技术企业认定','环保安全整改','专项补贴申请'],
    weight: 0.07,
    bankImportance: 0.65
  },
  capital: {
    id: 'capital',
    name: '资金维度',
    icon: '💰',
    desc: '注资/增资/战投/资本运作',
    issues: ['注册资本实缴为0','抽逃出资','无机构背书','资产负债率过高'],
    solutions: ['注册资本实缴','引入战略投资','担保+保险双增信','债转股方案'],
    weight: 0.07,
    bankImportance: 0.75
  }
};

// === 3级激进程度定义 ===
const AGGRESSIVENESS_LEVELS = {
  conservative: {
    id: 'conservative',
    name: '保守 · 绿区合规',
    color: '#4caf50',
    icon: '🟢',
    desc: '只走绝对安全的绿区改造路径，不触碰灰色地带，周期较长但风险最低',
    bounds: '✅ 绿区全部手段 / ❌ 灰区(含法律意见书) / ❌ 红区(一律拒绝)',
    avgTimelineDays: 120,
    costMultiplier: 0.8,
    legalRiskLevel: '极低'
  },
  balanced: {
    id: 'balanced',
    name: '平衡 · 绿区+灰区',
    color: '#ff9800',
    icon: '🟡',
    desc: '绿区全部执行，灰区经法律审查后选择性推进，兼顾速度与合规',
    bounds: '✅ 绿区全部 / ⚖ 灰区(经C4法律兜底审查) / ❌ 红区(一律拒绝)',
    avgTimelineDays: 60,
    costMultiplier: 1.0,
    legalRiskLevel: '可控'
  },
  innovative: {
    id: 'innovative',
    name: '创新 · 全合规空间',
    color: '#9c27b0',
    icon: '🟣',
    desc: '绿区+灰区全量推进，并启用复杂资本运作(债转股/反向收购等)，速度最快',
    bounds: '✅ 绿区+灰区全部 / 💼 复杂资本运作(反向收购/借壳/债转股) / ❌ 红区(一律拒绝)',
    avgTimelineDays: 30,
    costMultiplier: 1.4,
    legalRiskLevel: '高(但始终合规)'
  }
};

// === 改造场景的 L2-L4 自主度等级 (不同于融资场景, 范围更窄) ===
const REFORM_AUTONOMY_LEVELS = {
  L2: { id: 'L2', name: 'L2 文档生成', color: '#2196f3', desc: 'AI生成改造方案+所需材料清单+合规意见书模板,人工审核后提交', bounds: '文档自动生成 / 外部提交由人工操作' },
  L3: { id: 'L3', name: 'L3 API对接',   color: '#ff9800', desc: 'L2+自动对接工商/税务/资质等外部API,自动提交材料,关键节点人工确认', bounds: 'API自动对接提交 / 支付/签字节点人工确认' },
  L4: { id: 'L4', name: 'L4 全自动化', color: '#4caf50', desc: 'L3+AI全程执行,遇异常动态重规划,仅战略节点(如是否接受某战投)需人类拍板', bounds: '全流程AI自主 / 资本结构/战略决策节点人工拍板' }
};

// === R1-R10 改造引擎定义 ===
const REFORM_ENGINES = {
  R1: { id: 'R1', name: '全景画像引擎',    short: 'R1 画像',   color: '#2196f3', desc: '从8维度采集公开+授权+私有数据,构建60+变量企业全景画像', inputs: ['工商/司法API','企业授权数据','水电煤/社保替代数据'], outputs: ['EnterpriseProfile 画像','60+变量初值','异常标记清单'], status: 'active', keyMetric: '变量覆盖率 95%+' },
  R2: { id: 'R2', name: '差距诊断引擎',    short: 'R2 诊断',   color: '#f44336', desc: '对比银行准入要求与当前画像,量化每维度差距,生成差距诊断报告(GapReport)', inputs: ['EnterpriseProfile','银行准入规则库','目标信用等级'], outputs: ['GapReport 差距报告','优先级排序的问题清单','每维得分/目标分'], status: 'active', keyMetric: '诊断命中率 90%+' },
  R3: { id: 'R3', name: '方案生成引擎',    short: 'R3 方案',   color: '#4caf50', desc: '基于约束求解(60+变量),组合具体改造动作,输出N条可选路径+预估ROI', inputs: ['GapReport','激进程度','时间/预算约束','合规边界'], outputs: ['ReformPlan 方案集(3条)','每条预估耗时/成本/得分提升','关键路径标记'], status: 'active', keyMetric: '方案可执行率 85%+' },
  R4: { id: 'R4', name: '任务调度引擎',    short: 'R4 调度',   color: '#ff9800', desc: '把方案拆为DAG任务图,管理依赖与关键路径,支持并行/串行调度', inputs: ['ReformPlan','任务依赖规则','日历/排期约束'], outputs: ['TaskDAG 任务图','关键路径(CPM)','执行人/交付物/截止日期'], status: 'active', keyMetric: 'DAG 边冲突检测 100%' },
  R5: { id: 'R5', name: '执行引擎家族',    short: 'R5 执行',   color: '#9c27b0', desc: 'R5-A主体/R5-B财务/R5-C税务/R5-D业务/R5-E资产/R5-F信用/R5-G政策/R5-H资本 — 8个子引擎(R5-A~R5-H),对应8维度改造动作', inputs: ['TaskDAG 单节点','目标API或模板','企业授权'], outputs: ['执行结果','证据材料','外部回执编号'], status: 'active', keyMetric: '子引擎成功率 92%+' },
  R6: { id: 'R6', name: '动态重规划引擎',  short: 'R6 重规划', color: '#00bcd4', desc: '任务失败/超时/政策变更时自动回溯DAG,重新计算关键路径,不中断改造', inputs: ['失败事件','当前进度快照','新政策版本'], outputs: ['RePlan 新调度方案','受影响节点列表','延期/追加预算说明'], status: 'active', keyMetric: '异常自动恢复率 80%+' },
  R7: { id: 'R7', name: '合规审查引擎',    short: 'R7 合规',   color: '#e91e63', desc: '基于红/灰/绿三区边界+Drools规则,每个改造动作执行前后自动合规检查', inputs: ['待执行动作','激进程度配置','当前法规版本'], outputs: ['PASS 放行 / REVIEW 需律师 / REJECT 拒绝','合规意见书摘要'], status: 'active', keyMetric: '红区拦截率 100%' },
  R8: { id: 'R8', name: '进度监控引擎',    short: 'R8 监控',   color: '#607d8b', desc: '关键节点KPI实时看板,提前预警延期/超支,自动生成日报/周报', inputs: ['TaskDAG 进度','实际成本数据','质量抽检结果'], outputs: ['进度仪表盘','延期/超支预警','日报/周报自动推送'], status: 'active', keyMetric: '预警提前量 ≥3天' },
  R9: { id: 'R9', name: '银行匹配引擎',    short: 'R9 匹配',   color: '#3f51b5', desc: '改造中/后实时对接银行产品库,动态匹配可准入产品,推送预审额度', inputs: ['当前进度快照','银行产品库','银行风险偏好'], outputs: ['可准入银行列表','预授信额度/利率','预审通过概率'], status: 'active', keyMetric: '银行匹配准确率 88%+' },
  R10:{ id: 'R10',name: '案例学习引擎',    short: 'R10 学习',  color: '#795548', desc: '把已完成改造(E004等)入库为CaseBase,新方案自动检索相似案例提取最佳实践', inputs: ['新企业画像','CaseBase 案例库','成功/失败标签'], outputs: ['Top3 相似案例','最佳实践推荐','常见失败陷阱预警'], status: 'active', keyMetric: '案例检索召回率 85%+' }
};

// === 改造案例库 (海川物流作为标杆案例, 以及若干行业模板) ===
const REFORM_CASES = [
  {
    id: 'CASE-001',
    enterpriseName: '海川物流有限公司',
    industry: '物流运输',
    beforeLevel: 'D',
    afterLevel: 'A-',
    creditBefore: 520,
    creditAfter: 820,
    cost: 380000,
    days: 105,
    aggressiveness: 'balanced',
    keyActions: ['法人变更','两账合一','补税35万','五流补齐','担保+保险双增信','引入战投300万'],
    bankOutcome: '招商银行预授信1200万 / 利率LPR+1.2%',
    tags: ['标杆案例','物流行业','双增信','战投引入']
  },
  {
    id: 'CASE-002',
    enterpriseName: '某精密五金制造厂',
    industry: '制造业',
    beforeLevel: 'C',
    afterLevel: 'B+',
    creditBefore: 610,
    creditAfter: 760,
    cost: 220000,
    days: 75,
    aggressiveness: 'conservative',
    keyActions: ['财务规范','进项票梳理','固定资产入账','责任链完善'],
    bankOutcome: '工商银行预授信600万 / 需担保',
    tags: ['制造业模板','保守路径']
  },
  {
    id: 'CASE-003',
    enterpriseName: '某AI软件公司',
    industry: '高新技术',
    beforeLevel: 'B',
    afterLevel: 'A',
    creditBefore: 700,
    creditAfter: 860,
    cost: 550000,
    days: 45,
    aggressiveness: 'innovative',
    keyActions: ['高新技术企业认定','软著确权','债转股方案','研发费用加计扣除'],
    bankOutcome: '网商银行+招商银行联合授信2500万 / 利率LPR+0.5%',
    tags: ['高新技术模板','创新路径','知识产权确权']
  },
  {
    id: 'CASE-004',
    enterpriseName: '某建材贸易公司',
    industry: '贸易',
    beforeLevel: 'D',
    afterLevel: 'B',
    creditBefore: 540,
    creditAfter: 720,
    cost: 290000,
    days: 90,
    aggressiveness: 'balanced',
    keyActions: ['税务异常移出','进销项匹配','客户集中度分散','存货盘点入账'],
    bankOutcome: '招商银行预授信500万',
    tags: ['贸易行业模板','税务修复']
  }
];

// === APP-07 关联机构配置 (spec: 物流/评估/律所/会计通用协作门户) ===
const PARTNER_INSTITUTIONS = {
  logistics: {
    id: 'PRT_LOG',
    name: '顺达物流',
    icon: '🚚',
    desc: '运单确认 + GPS轨迹签收证明 + 货物状态核验',
    capabilities: ['运单确认', 'GPS轨迹关联', '签收证明生成', '温控核验']
  },
  appraisal: {
    id: 'PRT_APP',
    name: '中诚资产评估',
    icon: '📊',
    desc: '资产评估 + 抵押物估值 + 无形资产评估',
    capabilities: ['资产评估', '抵押物估值', '市场价值核定']
  },
  law: {
    id: 'PRT_LAW',
    name: '德恒律师事务所',
    icon: '⚖️',
    desc: '法律审查 + 合同合规性 + 法律意见书',
    capabilities: ['法律审查', '合同合规', '法律意见书', '风险提示']
  },
  audit: {
    id: 'PRT_AUD',
    name: '华兴会计师事务所',
    icon: '📝',
    desc: '财务审计 + 报表核验 + 审计报告',
    capabilities: ['财务审计', '报表核验', '审计报告', '内控评价']
  }
};

// 导出所有数据
window.MockData = {
  ENTERPRISES,
  BANKS,
  GUARANTORS,
  INSURERS,
  POLICY_VERSIONS,
  SEASONAL_WINDOWS,
  RESPONSIBILITY_NODES_TEMPLATE,
  DATA_FLOW_LABELS,
  CREDIT_GRADES,
  AUTONOMY_LEVELS,
  PARTNER_INSTITUTIONS,
  // v4.3 三档分类能力数据
  EXTERNAL_APIS,
  FALLBACK_MODULES,
  SELF_DEVELOPED_MODULES,
  TIER_INVESTMENT,
  FALLBACK_CHAIN_LEVELS,
  INDEPENDENT_MODE_CAPABILITIES,
  // v5.0 Tab0 企业改造工作台数据
  REFORM_DIMENSIONS,
  AGGRESSIVENESS_LEVELS,
  REFORM_AUTONOMY_LEVELS,
  REFORM_ENGINES,
  REFORM_CASES,
  // v6.0 SCF 子系统市场动态数据 (SCF_PRODUCTS/SCF_INSTITUTIONS/SCF_ENTERPRISES/SCF_RELATIONSHIPS/SCF_TRADES/SCF_BLACKLIST/SCF_WHITELIST/SCF_CASES 在 scf-data.js 中定义)
  SCF_MARKET: {
    // 行业景气指数 (0-1, 越高越景气, 影响整体融资意愿)
    industryIndex: {
      manufacturing: 0.85,
      retail: 0.72,
      logistics: 0.68,
      technology: 0.90,
      agriculture: 0.65
    },
    // 资金面松紧 (影响利率基线: loose -0.2%, tight +0.3%)
    liquidityIndex: 'normal',  // loose / normal / tight
    // 政策导向 (与 POLICY_VERSIONS 联动)
    policyBias: 'encourage_scf',  // encourage_scf / neutral / restrict_scf
    // 季节性需求 (与 SEASONAL_WINDOWS 联动)
    seasonalDemand: {
      quarter_end: 0.30,   // 季末需求+30%
      year_end: 0.50,      // 年末需求+50%
      normal: 0.0
    },
    // LPR 基准利率 (用于 SCF 产品定价基线)
    lprBase: 3.45,
    // 行业风险溢价 (bps, 1% = 100bps)
    industryRiskPremium: {
      manufacturing: 80,
      retail: 120,
      logistics: 150,
      technology: 60,
      agriculture: 200
    }
  }
};
