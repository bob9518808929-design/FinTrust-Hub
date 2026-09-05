/**
 * scf-data.js — 供应链金融 (SCF) 子系统初始 Mock 数据
 * 对齐 simulation-plan.md 第七章 + spec.md MOD-16/DATA-05/APP-09
 *
 * 4 层数据库架构:
 *   Layer 1 主数据: SCF_ENTERPRISES / SCF_PRODUCTS / SCF_INSTITUTIONS
 *   Layer 2 关系:   SCF_RELATIONSHIPS / SCF_TRADES / SCF_BLACKLIST / SCF_WHITELIST
 *   Layer 3 交易:   (运行时生成: 融资申请/放款/还款)
 *   Layer 4 风控:   (运行时生成: 风险事件/信用传导/履约记录)
 *
 * SCF 场景预设:
 *   scf_anchor     — 核心企业视角 (E001 宏达精密作为 Anchor)
 *   scf_supplier   — 供应商视角 (东方钢材 SCF-S001)
 *   scf_distributor— 经销商视角 (北方机电 SCF-D001)
 */

// ============================================================
// Layer 1: 主数据库
// ============================================================

/**
 * SCF 企业主数据 (5 家上下游企业: 3 家供应商 + 2 家经销商)
 * 核心企业沿用现有 E001-E004, 通过 linkedAnchorId 关联
 */
const SCF_ENTERPRISES = [
  {
    id: 'SCF-S001',
    name: '东方钢材供应商',
    role: 'supplier',
    linkedAnchorId: 'E001',
    industry: 'manufacturing',
    registeredCapital: 10000000,
    establishDate: '2018-05-12',
    legalRep: '张明',
    supplyChainProfile: {
      cooperationYears: 3,
      annualTradeVolume: 12000000,
      tradeFrequency: 'monthly',
      paymentTerm: '60天',
      productCategory: '钢材原料',
      seatLevel: 'gold'
    },
    credit: {
      ownScore: 680,
      propagatedScore: null,
      sceneScore: null,
      creditHistory: [
        { date: '2026-06-15', event: '按时还款', impact: +5 },
        { date: '2026-07-20', event: '新增贷款', impact: -3 }
      ],
      blacklistStatus: 'clean'
    },
    tradeStats: {
      totalTrades: 36,
      verifiedTrades: 32,
      verificationRate: 0.89,
      avgTradeAmount: 350000,
      lastTradeDate: '2026-08-10',
      overdueCount: 0
    },
    dataVisibility: {
      anchor: ['tradeHistory', 'creditScore', 'financials'],
      bank: ['enterpriseName', 'creditScore', 'tradeStats'],
      guarantor: ['enterpriseName', 'creditScore']
    },
    profile: null,
    status: 'active',
    joinedAt: '2026-06-01',
    certifiedBy: 'E001'
  },
  {
    id: 'SCF-S002',
    name: '宏源包装材料',
    role: 'supplier',
    linkedAnchorId: 'E001',
    industry: 'manufacturing',
    registeredCapital: 5000000,
    establishDate: '2019-08-20',
    legalRep: '李华',
    supplyChainProfile: {
      cooperationYears: 2,
      annualTradeVolume: 4800000,
      tradeFrequency: 'monthly',
      paymentTerm: '45天',
      productCategory: '包装材料',
      seatLevel: 'silver'
    },
    credit: {
      ownScore: 640,
      propagatedScore: null,
      sceneScore: null,
      creditHistory: [],
      blacklistStatus: 'clean'
    },
    tradeStats: {
      totalTrades: 24,
      verifiedTrades: 20,
      verificationRate: 0.83,
      avgTradeAmount: 200000,
      lastTradeDate: '2026-08-05',
      overdueCount: 1
    },
    dataVisibility: {
      anchor: ['tradeHistory', 'creditScore'],
      bank: ['enterpriseName', 'creditScore'],
      guarantor: ['enterpriseName']
    },
    profile: null,
    status: 'active',
    joinedAt: '2026-06-15',
    certifiedBy: 'E001'
  },
  {
    id: 'SCF-S003',
    name: '创新电子元件',
    role: 'supplier',
    linkedAnchorId: 'E002',
    industry: 'manufacturing',
    registeredCapital: 8000000,
    establishDate: '2017-03-10',
    legalRep: '王强',
    supplyChainProfile: {
      cooperationYears: 4,
      annualTradeVolume: 9600000,
      tradeFrequency: 'biweekly',
      paymentTerm: '30天',
      productCategory: '电子元件',
      seatLevel: 'gold'
    },
    credit: {
      ownScore: 720,
      propagatedScore: null,
      sceneScore: null,
      creditHistory: [
        { date: '2026-05-10', event: '获评A级纳税信用', impact: +8 }
      ],
      blacklistStatus: 'clean'
    },
    tradeStats: {
      totalTrades: 96,
      verifiedTrades: 92,
      verificationRate: 0.96,
      avgTradeAmount: 100000,
      lastTradeDate: '2026-08-12',
      overdueCount: 0
    },
    dataVisibility: {
      anchor: ['tradeHistory', 'creditScore', 'financials', 'taxRecords'],
      bank: ['enterpriseName', 'creditScore', 'tradeStats'],
      guarantor: ['enterpriseName', 'creditScore']
    },
    profile: null,
    status: 'active',
    joinedAt: '2026-05-20',
    certifiedBy: 'E002'
  },
  {
    id: 'SCF-D001',
    name: '北方机电经销商',
    role: 'distributor',
    linkedAnchorId: 'E001',
    industry: 'retail',
    registeredCapital: 6000000,
    establishDate: '2018-11-05',
    legalRep: '赵伟',
    supplyChainProfile: {
      cooperationYears: 3,
      annualTradeVolume: 8500000,
      tradeFrequency: 'weekly',
      paymentTerm: '30天',
      productCategory: '机电产品',
      seatLevel: 'gold'
    },
    credit: {
      ownScore: 660,
      propagatedScore: null,
      sceneScore: null,
      creditHistory: [],
      blacklistStatus: 'clean'
    },
    tradeStats: {
      totalTrades: 144,
      verifiedTrades: 138,
      verificationRate: 0.96,
      avgTradeAmount: 60000,
      lastTradeDate: '2026-08-11',
      overdueCount: 0
    },
    dataVisibility: {
      anchor: ['tradeHistory', 'creditScore', 'salesRecords'],
      bank: ['enterpriseName', 'creditScore', 'tradeStats'],
      guarantor: ['enterpriseName']
    },
    profile: null,
    status: 'active',
    joinedAt: '2026-06-10',
    certifiedBy: 'E001'
  },
  {
    id: 'SCF-D002',
    name: '南方自动化设备',
    role: 'distributor',
    linkedAnchorId: 'E002',
    industry: 'retail',
    registeredCapital: 12000000,
    establishDate: '2016-07-22',
    legalRep: '钱多多',
    supplyChainProfile: {
      cooperationYears: 5,
      annualTradeVolume: 15000000,
      tradeFrequency: 'weekly',
      paymentTerm: '45天',
      productCategory: '自动化设备',
      seatLevel: 'platinum'
    },
    credit: {
      ownScore: 760,
      propagatedScore: null,
      sceneScore: null,
      creditHistory: [
        { date: '2026-04-18', event: '获评省级诚信企业', impact: +12 }
      ],
      blacklistStatus: 'clean'
    },
    tradeStats: {
      totalTrades: 240,
      verifiedTrades: 235,
      verificationRate: 0.98,
      avgTradeAmount: 62500,
      lastTradeDate: '2026-08-12',
      overdueCount: 0
    },
    dataVisibility: {
      anchor: ['tradeHistory', 'creditScore', 'financials', 'salesRecords'],
      bank: ['enterpriseName', 'creditScore', 'tradeStats', 'financials'],
      guarantor: ['enterpriseName', 'creditScore']
    },
    profile: null,
    status: 'active',
    joinedAt: '2026-05-15',
    certifiedBy: 'E002'
  }
];

/**
 * SCF 产品数据库 (5 类产品)
 */
const SCF_PRODUCTS = [
  {
    id: 'factoring',
    name: '保理融资',
    category: 'receivable',
    targetRole: 'supplier',
    advanceRate: 0.8,
    baseRateAdj: 1.5,
    feeRateRange: [0.5, 2.0],
    minAmount: 100000,
    maxAmount: 5000000,
    requires: ['invoice', 'contract', 'receipt'],
    requiresAnchorConfirm: true,
    description: '供应商将应收账款转让给保理机构获取融资'
  },
  {
    id: 'reverse_factoring',
    name: '反保理',
    category: 'payable',
    targetRole: 'anchor',
    advanceRate: 0.9,
    baseRateAdj: 1.0,
    feeRateRange: [0.3, 1.0],
    minAmount: 500000,
    maxAmount: 10000000,
    requires: ['purchase_order', 'invoice', 'payment_commitment'],
    requiresAnchorConfirm: true,
    description: '核心企业发起,利用自身信用为上游供应商融资'
  },
  {
    id: 'advance_payment',
    name: '预付款融资',
    category: 'prepaid',
    targetRole: 'distributor',
    advanceRate: 0.5,
    baseRateAdj: 2.0,
    feeRateRange: [1.0, 2.5],
    minAmount: 200000,
    maxAmount: 3000000,
    requires: ['contract', 'supply_agreement'],
    requiresAnchorConfirm: false,
    description: '经销商以未来货权作质押获取预付款融资'
  },
  {
    id: 'inventory_finance',
    name: '存货融资',
    category: 'inventory',
    targetRole: 'both',
    advanceRate: 0.6,
    baseRateAdj: 2.5,
    feeRateRange: [1.5, 3.0],
    minAmount: 300000,
    maxAmount: 5000000,
    requires: ['inventory_check', 'iot_monitor', 'insurance'],
    requiresAnchorConfirm: false,
    description: '以存货作质押,通过IoT监控+保险增信获取融资'
  },
  {
    id: 'purchase_order',
    name: '订单融资',
    category: 'order',
    targetRole: 'supplier',
    advanceRate: 0.7,
    baseRateAdj: 1.8,
    feeRateRange: [0.8, 2.0],
    minAmount: 150000,
    maxAmount: 4000000,
    requires: ['purchase_order'],
    requiresAnchorConfirm: true,
    description: '基于核心企业采购订单为上游供应商提供融资'
  }
];

/**
 * SCF 机构数据库 (扩展现有银行/担保/保险, 增加保理公司)
 */
const SCF_INSTITUTIONS = [
  { id: 'BANK-SCF-01', name: '工商银行(保理中心)', type: 'bank', maxAmount: 8000000, baseRate: 4.35, supports: ['factoring', 'reverse_factoring'] },
  { id: 'BANK-SCF-02', name: '建设银行(供应链金融部)', type: 'bank', maxAmount: 10000000, baseRate: 4.45, supports: ['factoring', 'reverse_factoring', 'purchase_order'] },
  { id: 'FACTOR-01', name: '中信商业保理', type: 'factor', maxAmount: 5000000, baseRate: 5.20, supports: ['factoring'] },
  { id: 'FACTOR-02', name: '海通保理', type: 'factor', maxAmount: 4000000, baseRate: 5.50, supports: ['factoring', 'advance_payment'] },
  { id: 'GUAR-SCF-01', name: '中合担保', type: 'guarantor', maxAmount: 6000000, baseRate: 1.50, supports: ['factoring', 'inventory_finance'] },
  { id: 'INS-SCF-01', name: '人保财险(信用险)', type: 'insurer', maxAmount: 5000000, baseRate: 0.80, supports: ['factoring', 'purchase_order'] }
];

// ============================================================
// Layer 2: 关系数据库
// ============================================================

/**
 * 供应链关系 (核心企业 → 上下游)
 */
const SCF_RELATIONSHIPS = [
  {
    id: 'REL-001',
    anchorId: 'E001',
    partnerId: 'SCF-S001',
    partnerRole: 'supplier',
    relationshipType: 'upstream',
    strength: {
      cooperationYears: 3,
      tradeStability: 0.85,
      concentrationRisk: 0.32,
      dependencyLevel: 'medium'
    },
    terms: {
      paymentTerm: '60天',
      settlementMethod: 'bank_transfer',
      contractValue: 12000000,
      avgOrderCycle: 30
    },
    status: 'active',
    establishedAt: '2023-06-01',
    lastTradeAt: '2026-08-10'
  },
  {
    id: 'REL-002',
    anchorId: 'E001',
    partnerId: 'SCF-S002',
    partnerRole: 'supplier',
    relationshipType: 'upstream',
    strength: {
      cooperationYears: 2,
      tradeStability: 0.72,
      concentrationRisk: 0.18,
      dependencyLevel: 'low'
    },
    terms: {
      paymentTerm: '45天',
      settlementMethod: 'bank_transfer',
      contractValue: 4800000,
      avgOrderCycle: 30
    },
    status: 'active',
    establishedAt: '2024-06-15',
    lastTradeAt: '2026-08-05'
  },
  {
    id: 'REL-003',
    anchorId: 'E001',
    partnerId: 'SCF-D001',
    partnerRole: 'distributor',
    relationshipType: 'downstream',
    strength: {
      cooperationYears: 3,
      tradeStability: 0.88,
      concentrationRisk: 0.25,
      dependencyLevel: 'medium'
    },
    terms: {
      paymentTerm: '30天',
      settlementMethod: 'bank_transfer',
      contractValue: 8500000,
      avgOrderCycle: 7
    },
    status: 'active',
    establishedAt: '2023-06-10',
    lastTradeAt: '2026-08-11'
  },
  {
    id: 'REL-004',
    anchorId: 'E002',
    partnerId: 'SCF-S003',
    partnerRole: 'supplier',
    relationshipType: 'upstream',
    strength: {
      cooperationYears: 4,
      tradeStability: 0.92,
      concentrationRisk: 0.40,
      dependencyLevel: 'high'
    },
    terms: {
      paymentTerm: '30天',
      settlementMethod: 'bank_transfer',
      contractValue: 9600000,
      avgOrderCycle: 15
    },
    status: 'active',
    establishedAt: '2022-05-20',
    lastTradeAt: '2026-08-12'
  },
  {
    id: 'REL-005',
    anchorId: 'E002',
    partnerId: 'SCF-D002',
    partnerRole: 'distributor',
    relationshipType: 'downstream',
    strength: {
      cooperationYears: 5,
      tradeStability: 0.95,
      concentrationRisk: 0.50,
      dependencyLevel: 'high'
    },
    terms: {
      paymentTerm: '45天',
      settlementMethod: 'bank_transfer',
      contractValue: 15000000,
      avgOrderCycle: 7
    },
    status: 'active',
    establishedAt: '2021-05-15',
    lastTradeAt: '2026-08-12'
  }
];

/**
 * 贸易记录 (10 条, 覆盖各种验证状态)
 */
const SCF_TRADES = [
  {
    id: 'TRD-001',
    relationshipId: 'REL-001',
    anchorId: 'E001',
    partnerId: 'SCF-S001',
    tradeType: 'purchase',
    amount: 450000,
    tradeDate: '2026-08-10',
    dueDate: '2026-10-10',
    productCategory: '钢材原料',
    quantity: 100,
    unitPrice: 4500,
    verification: {
      contract: { passed: true, evidence: '合同#CT2026081001' },
      invoice: { passed: true, evidence: '发票#INV20260810001' },
      logistics: { passed: true, evidence: '运单#WL20260810' },
      fund: { passed: true, evidence: '流水#20260810001' },
      iot: { passed: false, evidence: null },
      poInvoiceMatch: { passed: true },
      logisticsContractMatch: { passed: true }
    },
    verificationLevel: 'verified',
    canUseForFinancing: true,
    financingStatus: 'available',
    financedAmount: 0
  },
  {
    id: 'TRD-002',
    relationshipId: 'REL-001',
    anchorId: 'E001',
    partnerId: 'SCF-S001',
    tradeType: 'purchase',
    amount: 320000,
    tradeDate: '2026-07-15',
    dueDate: '2026-09-15',
    productCategory: '钢材原料',
    quantity: 80,
    unitPrice: 4000,
    verification: {
      contract: { passed: true, evidence: '合同#CT2026071501' },
      invoice: { passed: true, evidence: '发票#INV20260715001' },
      logistics: { passed: true, evidence: '运单#WL20260715' },
      fund: { passed: true, evidence: '流水#20260715001' },
      iot: { passed: false, evidence: null },
      poInvoiceMatch: { passed: true },
      logisticsContractMatch: { passed: true }
    },
    verificationLevel: 'verified',
    canUseForFinancing: true,
    financingStatus: 'financed',
    financedAmount: 256000
  },
  {
    id: 'TRD-003',
    relationshipId: 'REL-002',
    anchorId: 'E001',
    partnerId: 'SCF-S002',
    tradeType: 'purchase',
    amount: 180000,
    tradeDate: '2026-08-05',
    dueDate: '2026-09-20',
    productCategory: '包装材料',
    quantity: 6000,
    unitPrice: 30,
    verification: {
      contract: { passed: true, evidence: '合同#CT2026080501' },
      invoice: { passed: true, evidence: '发票#INV20260805001' },
      logistics: { passed: false, evidence: null },
      fund: { passed: true, evidence: '流水#20260805001' },
      iot: { passed: false, evidence: null },
      poInvoiceMatch: { passed: true },
      logisticsContractMatch: { passed: false }
    },
    verificationLevel: 'partial',
    canUseForFinancing: true,
    financingStatus: 'available',
    financedAmount: 0
  },
  {
    id: 'TRD-004',
    relationshipId: 'REL-003',
    anchorId: 'E001',
    partnerId: 'SCF-D001',
    tradeType: 'sale',
    amount: 60000,
    tradeDate: '2026-08-11',
    dueDate: '2026-09-11',
    productCategory: '机电产品',
    quantity: 10,
    unitPrice: 6000,
    verification: {
      contract: { passed: true, evidence: '合同#CT2026081101' },
      invoice: { passed: true, evidence: '发票#INV20260811001' },
      logistics: { passed: true, evidence: '运单#WL20260811' },
      fund: { passed: false, evidence: null },
      iot: { passed: false, evidence: null },
      poInvoiceMatch: { passed: true },
      logisticsContractMatch: { passed: true }
    },
    verificationLevel: 'partial',
    canUseForFinancing: true,
    financingStatus: 'available',
    financedAmount: 0
  },
  {
    id: 'TRD-005',
    relationshipId: 'REL-004',
    anchorId: 'E002',
    partnerId: 'SCF-S003',
    tradeType: 'purchase',
    amount: 100000,
    tradeDate: '2026-08-12',
    dueDate: '2026-09-12',
    productCategory: '电子元件',
    quantity: 1000,
    unitPrice: 100,
    verification: {
      contract: { passed: true, evidence: '合同#CT2026081201' },
      invoice: { passed: true, evidence: '发票#INV20260812001' },
      logistics: { passed: true, evidence: '运单#WL20260812' },
      fund: { passed: true, evidence: '流水#20260812001' },
      iot: { passed: true, evidence: 'IoT#GPS20260812' },
      poInvoiceMatch: { passed: true },
      logisticsContractMatch: { passed: true }
    },
    verificationLevel: 'verified',
    canUseForFinancing: true,
    financingStatus: 'available',
    financedAmount: 0
  },
  {
    id: 'TRD-006',
    relationshipId: 'REL-005',
    anchorId: 'E002',
    partnerId: 'SCF-D002',
    tradeType: 'sale',
    amount: 62500,
    tradeDate: '2026-08-12',
    dueDate: '2026-09-27',
    productCategory: '自动化设备',
    quantity: 5,
    unitPrice: 12500,
    verification: {
      contract: { passed: true, evidence: '合同#CT2026081202' },
      invoice: { passed: true, evidence: '发票#INV20260812002' },
      logistics: { passed: true, evidence: '运单#WL20260812B' },
      fund: { passed: true, evidence: '流水#20260812002' },
      iot: { passed: true, evidence: 'IoT#GPS20260812B' },
      poInvoiceMatch: { passed: true },
      logisticsContractMatch: { passed: true }
    },
    verificationLevel: 'verified',
    canUseForFinancing: true,
    financingStatus: 'available',
    financedAmount: 0
  },
  {
    id: 'TRD-007',
    relationshipId: 'REL-001',
    anchorId: 'E001',
    partnerId: 'SCF-S001',
    tradeType: 'purchase',
    amount: 280000,
    tradeDate: '2026-06-20',
    dueDate: '2026-08-20',
    productCategory: '钢材原料',
    quantity: 70,
    unitPrice: 4000,
    verification: {
      contract: { passed: true, evidence: '合同#CT2026062001' },
      invoice: { passed: true, evidence: '发票#INV20260620001' },
      logistics: { passed: true, evidence: '运单#WL20260620' },
      fund: { passed: true, evidence: '流水#20260620001' },
      iot: { passed: false, evidence: null },
      poInvoiceMatch: { passed: true },
      logisticsContractMatch: { passed: true }
    },
    verificationLevel: 'verified',
    canUseForFinancing: true,
    financingStatus: 'settled',
    financedAmount: 224000
  },
  {
    id: 'TRD-008',
    relationshipId: 'REL-003',
    anchorId: 'E001',
    partnerId: 'SCF-D001',
    tradeType: 'sale',
    amount: 48000,
    tradeDate: '2026-07-30',
    dueDate: '2026-08-30',
    productCategory: '机电产品',
    quantity: 8,
    unitPrice: 6000,
    verification: {
      contract: { passed: true, evidence: '合同#CT2026073001' },
      invoice: { passed: true, evidence: '发票#INV20260730001' },
      logistics: { passed: true, evidence: '运单#WL20260730' },
      fund: { passed: true, evidence: '流水#20260730001' },
      iot: { passed: false, evidence: null },
      poInvoiceMatch: { passed: true },
      logisticsContractMatch: { passed: true }
    },
    verificationLevel: 'verified',
    canUseForFinancing: true,
    financingStatus: 'settled',
    financedAmount: 38400
  },
  {
    id: 'TRD-009',
    relationshipId: 'REL-002',
    anchorId: 'E001',
    partnerId: 'SCF-S002',
    tradeType: 'purchase',
    amount: 220000,
    tradeDate: '2026-07-10',
    dueDate: '2026-08-25',
    productCategory: '包装材料',
    quantity: 7333,
    unitPrice: 30,
    verification: {
      contract: { passed: false, evidence: null },
      invoice: { passed: true, evidence: '发票#INV20260710001' },
      logistics: { passed: false, evidence: null },
      fund: { passed: false, evidence: null },
      iot: { passed: false, evidence: null },
      poInvoiceMatch: { passed: false },
      logisticsContractMatch: { passed: false }
    },
    verificationLevel: 'unverified',
    canUseForFinancing: false,
    financingStatus: 'rejected',
    financedAmount: 0
  },
  {
    id: 'TRD-010',
    relationshipId: 'REL-004',
    anchorId: 'E002',
    partnerId: 'SCF-S003',
    tradeType: 'purchase',
    amount: 150000,
    tradeDate: '2026-07-28',
    dueDate: '2026-08-28',
    productCategory: '电子元件',
    quantity: 1500,
    unitPrice: 100,
    verification: {
      contract: { passed: true, evidence: '合同#CT2026072801' },
      invoice: { passed: true, evidence: '发票#INV20260728001' },
      logistics: { passed: true, evidence: '运单#WL20260728' },
      fund: { passed: true, evidence: '流水#20260728001' },
      iot: { passed: true, evidence: 'IoT#GPS20260728' },
      poInvoiceMatch: { passed: true },
      logisticsContractMatch: { passed: true }
    },
    verificationLevel: 'verified',
    canUseForFinancing: true,
    financingStatus: 'settled',
    financedAmount: 105000
  }
];

/**
 * 黑名单 (2 条: 虚假贸易 + 关联方循环)
 */
const SCF_BLACKLIST = [
  {
    enterpriseId: 'SCF-S005',
    enterpriseName: '某虚假贸易公司',
    type: 'blacklist',
    reason: '虚假贸易·发票虚开',
    evidence: ['发票号INV20260512001验真失败', '合同与物流单据不匹配'],
    triggerRule: 'SC2-规则1: 贸易真实性验证失败',
    blacklistedAt: '2026-07-15',
    blacklistedBy: 'SC2引擎自动',
    appealStatus: 'none'
  },
  {
    enterpriseId: 'SCF-S006',
    enterpriseName: '关联方循环交易公司',
    type: 'blacklist',
    reason: '关联方循环交易',
    evidence: ['SCF-S006→SCF-S007→SCF-S008→SCF-S006 形成交易闭环', 'B7图欺诈检测命中'],
    triggerRule: 'SC2-规则3: 关联方循环交易 (B7图欺诈检测+图谱环检测)',
    blacklistedAt: '2026-07-20',
    blacklistedBy: 'SC2引擎自动',
    appealStatus: 'pending'
  }
];

/**
 * 白名单 (示例)
 */
const SCF_WHITELIST = [
  {
    enterpriseId: 'SCF-D002',
    enterpriseName: '南方自动化设备',
    type: 'whitelist',
    reason: '合作年限5年+零逾期+信用分760',
    addedAt: '2026-06-01',
    addedBy: 'SC2引擎自动 (核心企业E002推荐)'
  }
];

/**
 * SCF 标杆案例库 (3 个)
 */
const SCF_CASES = [
  {
    id: 'CASE-SCF-001',
    title: 'E001宏达精密-保理融资成功案例',
    industry: 'manufacturing',
    product: 'factoring',
    role: 'supplier',
    partnerId: 'SCF-S001',
    anchorId: 'E001',
    amount: 320000,
    rate: 5.85,
    duration: 60,
    outcome: 'success',
    keyFactors: ['五流验证通过', '核心企业信用传导+45分', '合作年限3年'],
    description: 'SCF-S001东方钢材基于与E001宏达精密的应收账款,通过保理融资32万,利率5.85%,按时还款。',
    createdAt: '2026-07-20'
  },
  {
    id: 'CASE-SCF-002',
    title: 'E002智芯科技-反保理批量案例',
    industry: 'manufacturing',
    product: 'reverse_factoring',
    role: 'anchor',
    partnerId: 'SCF-S003',
    anchorId: 'E002',
    amount: 1000000,
    rate: 5.20,
    duration: 30,
    outcome: 'success',
    keyFactors: ['核心企业信用分780', '采购订单+发票+付款承诺齐备', '合作年限4年'],
    description: 'E002智芯科技作为核心企业发起反保理,为上游SCF-S003创新电子元件融资100万,利率5.20%。',
    createdAt: '2026-07-25'
  },
  {
    id: 'CASE-SCF-003',
    title: 'E001宏达精密-经销商预付款融资',
    industry: 'retail',
    product: 'advance_payment',
    role: 'distributor',
    partnerId: 'SCF-D001',
    anchorId: 'E001',
    amount: 200000,
    rate: 6.35,
    duration: 30,
    outcome: 'success',
    keyFactors: ['经销商信用分660', '合同+供应协议齐备', '合作年限3年+零逾期'],
    description: 'SCF-D001北方机电基于与E001的供货合同,通过预付款融资20万,利率6.35%,30天周期。',
    createdAt: '2026-08-01'
  }
];

// ============================================================
// 导出
// ============================================================
window.SCFData = {
  SCF_ENTERPRISES,
  SCF_PRODUCTS,
  SCF_INSTITUTIONS,
  SCF_RELATIONSHIPS,
  SCF_TRADES,
  SCF_BLACKLIST,
  SCF_WHITELIST,
  SCF_CASES
};
