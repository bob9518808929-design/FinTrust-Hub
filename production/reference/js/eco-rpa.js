// FinTrust Hub v3.1 - ECO-03 INFRA-05 无接口适配器 - 模拟器实现
//
// 模块定位: 银行冷启动期"无接口"破局层。AI 把改造后企业画像/五流证据链/建议授信
// 自动渲染成《XX 银行标准信贷申报书(含 AI 预审章)》, 银行客户经理零开发导入或打印上交。
// 当银行尝到"坏账率下降"甜头后, 触发《API 直连价值评估报告》, 推动其升级到 INFRA-01b。
//
// 模拟器实现策略(浏览器端, 无后端):
//   - Apache POI(Excel) + iText/PDFBox(PDF)  →  Blob + URL.createObjectURL 生成 .csv / .html
//   - e签宝/法大大电子签章 + MOD-08 链上存证  →  window.crypto.subtle.digest SHA-256 哈希
//   - YAML 银行模板库                         →  JS 对象字面量 (banks)
//   - 申报书/反馈/业绩持久化                   →  localStorage
//
// State 全局对象只读访问: window.State.enterprises / window.State.currentEnterpriseId

window.EcoRpa = (function () {
  'use strict';

  // ============================================================
  //  RPA.2 银行模板库 (模拟 YAML 配置, 按银行维度字段映射 + 必填校验)
  // ============================================================
  // 每家银行: 申报字段映射 / 必填项 / 导入格式 / 模板分节顺序 / 风控偏好
  const BANK_TEMPLATES = {
    CMB: {
      id: 'CMB',
      name: '招商银行',
      shortName: '招行',
      icon: '🏦',
      color: 'var(--accent-red)',
      docPrefix: 'CMB-CR',
      productLine: '招企贷',
      baseRate: 4.45,
      maxAmount: 10000000,
      defaultTerm: 12,
      requiresGuarantee: false,
      importFormat: 'xlsx',
      fieldMappings: {
        docNo: '申报书编号', customerName: '客户名称', creditCode: '统一社会信用代码',
        establishDate: '成立日期', legalRep: '法定代表人', registeredCapital: '注册资本',
        businessScope: '经营范围', industry: '所属行业',
        creditScore: '信用评分', taxGrade: '纳税信用等级', debtRatio: '资产负债率(%)',
        currentRatio: '流动比率', recommendedAmount: '建议授信额度(元)', recommendedRate: '建议利率(%)',
        recommendedTerm: '建议期限(月)', riskGrade: '风险评级',
        fiveStreamContract: '合同流验证率(%)', fiveStreamInvoice: '发票流验证率(%)',
        fiveStreamLogistics: '物流流验证率(%)', fiveStreamFund: '资金流验证率(%)',
        fiveStreamIot: '物联流验证率(%)',
        aiPreApprovalHash: 'AI预审章哈希', aiConfidence: 'AI预审置信度(%)',
        chainEvidenceId: '链上存证编号'
      },
      requiredFields: ['customerName', 'creditCode', 'legalRep', 'creditScore', 'recommendedAmount', 'aiPreApprovalHash'],
      sectionOrder: ['basic', 'scorecard', 'fiveStreams', 'credit', 'aiPreApproval'],
      riskAppetite: 'flexible',
      remark: '招行闪电贷通道, 接受 AI 预审章作为初审参考, 无担保要求'
    },
    ICBC: {
      id: 'ICBC',
      name: '工商银行',
      shortName: '工行',
      icon: '🏛',
      color: 'var(--accent-blue)',
      docPrefix: 'ICBC-CR',
      productLine: '经营快贷',
      baseRate: 4.15,
      maxAmount: 15000000,
      defaultTerm: 12,
      requiresGuarantee: true,
      importFormat: 'xml',
      fieldMappings: {
        docNo: '法人客户申报编号', customerName: '客户全称', creditCode: '组织机构代码/统一社会信用代码',
        establishDate: '注册日期', legalRep: '法人代表', registeredCapital: '注册资本(万元)',
        businessScope: '经营范围', industry: '行业分类',
        creditScore: '内部信用评级', taxGrade: '纳税评级', debtRatio: '资产负债率',
        currentRatio: '流动比', recommendedAmount: '授信额度(元)', recommendedRate: '执行利率(%)',
        recommendedTerm: '期限(月)', riskGrade: '风险等级',
        fiveStreamContract: '合同流核验率', fiveStreamInvoice: '发票流核验率',
        fiveStreamLogistics: '物流流核验率', fiveStreamFund: '资金流核验率',
        fiveStreamIot: '物联流核验率',
        aiPreApprovalHash: 'AI预审电子印章', aiConfidence: 'AI预审可信度',
        chainEvidenceId: '区块链存证流水号'
      },
      requiredFields: ['customerName', 'creditCode', 'legalRep', 'registeredCapital', 'creditScore', 'recommendedAmount', 'aiPreApprovalHash'],
      sectionOrder: ['basic', 'scorecard', 'fiveStreams', 'credit', 'aiPreApproval'],
      riskAppetite: 'conservative',
      remark: '工行大行风控严, 利率低需担保, AI 预审章作为补强材料'
    },
    CCB: {
      id: 'CCB',
      name: '建设银行',
      shortName: '建行',
      icon: '🏗',
      color: 'var(--accent-blue)',
      docPrefix: 'CCB-CR',
      productLine: '小微快贷',
      baseRate: 4.25,
      maxAmount: 12000000,
      defaultTerm: 24,
      requiresGuarantee: false,
      importFormat: 'csv',
      fieldMappings: {
        docNo: '建行申报流水号', customerName: '借款人名称', creditCode: '社会信用代码',
        establishDate: '开业日期', legalRep: '负责人', registeredCapital: '资本金(元)',
        businessScope: '主营范围', industry: '行业类型',
        creditScore: '信用得分', taxGrade: '纳税级别', debtRatio: '资产负债率',
        currentRatio: '流动比率', recommendedAmount: '建议贷款额(元)', recommendedRate: '建议年利率(%)',
        recommendedTerm: '贷款期(月)', riskGrade: '风险级别',
        fiveStreamContract: '合同五流核验率', fiveStreamInvoice: '发票五流核验率',
        fiveStreamLogistics: '物流五流核验率', fiveStreamFund: '资金五流核验率',
        fiveStreamIot: '物联五流核验率',
        aiPreApprovalHash: 'AI预审签章', aiConfidence: '预审置信度',
        chainEvidenceId: '存证编号'
      },
      requiredFields: ['customerName', 'creditCode', 'legalRep', 'creditScore', 'recommendedAmount', 'aiPreApprovalHash'],
      sectionOrder: ['basic', 'scorecard', 'fiveStreams', 'credit', 'aiPreApproval'],
      riskAppetite: 'balanced',
      remark: '建行小微快贷线上化程度高, 兼容 CSV 导入, 接受 AI 预审'
    },
    BCM: {
      id: 'BCM',
      name: '交通银行',
      shortName: '交行',
      icon: '🚦',
      color: 'var(--accent-blue)',
      docPrefix: 'BCM-CR',
      productLine: '普惠e贷',
      baseRate: 4.35,
      maxAmount: 8000000,
      defaultTerm: 12,
      requiresGuarantee: false,
      importFormat: 'xlsx',
      fieldMappings: {
        docNo: '交行信贷申报号', customerName: '授信客户名称', creditCode: '统一信用代码',
        establishDate: '成立时间', legalRep: '法定代表人', registeredCapital: '注册资本',
        businessScope: '经营范围', industry: '行业',
        creditScore: '信用分', taxGrade: '纳税等级', debtRatio: '资产负债率(%)',
        currentRatio: '流动比率', recommendedAmount: '建议授信(元)', recommendedRate: '建议利率(%)',
        recommendedTerm: '期限(月)', riskGrade: '风险评级',
        fiveStreamContract: '合同流验证率', fiveStreamInvoice: '发票流验证率',
        fiveStreamLogistics: '物流流验证率', fiveStreamFund: '资金流验证率',
        fiveStreamIot: '物联流验证率',
        aiPreApprovalHash: 'AI预审章', aiConfidence: '预审置信度',
        chainEvidenceId: '链上存证号'
      },
      requiredFields: ['customerName', 'creditCode', 'legalRep', 'creditScore', 'recommendedAmount', 'aiPreApprovalHash'],
      sectionOrder: ['basic', 'scorecard', 'fiveStreams', 'credit', 'aiPreApproval'],
      riskAppetite: 'flexible',
      remark: '交行普惠e贷主打线上秒批, 高度接受 AI 预审章'
    },
    BOC: {
      id: 'BOC',
      name: '中国银行',
      shortName: '中行',
      icon: '🏛',
      color: 'var(--accent-red)',
      docPrefix: 'BOC-CR',
      productLine: '中银企贷',
      baseRate: 4.30,
      maxAmount: 14000000,
      defaultTerm: 18,
      requiresGuarantee: true,
      importFormat: 'xml',
      fieldMappings: {
        docNo: '中行授信申请编号', customerName: '客户全称', creditCode: '统一社会信用代码',
        establishDate: '注册成立日期', legalRep: '法定代表人', registeredCapital: '注册资本(元)',
        businessScope: '经营范围', industry: '行业类别',
        creditScore: '信用评级', taxGrade: '纳税信用级别', debtRatio: '资产负债率',
        currentRatio: '流动比率', recommendedAmount: '建议授信额度', recommendedRate: '建议利率',
        recommendedTerm: '授信期限', riskGrade: '风险等级',
        fiveStreamContract: '合同流通过率', fiveStreamInvoice: '发票流通过率',
        fiveStreamLogistics: '物流流通过率', fiveStreamFund: '资金流通过率',
        fiveStreamIot: '物联流通过率',
        aiPreApprovalHash: 'AI预审电子章', aiConfidence: '预审置信度',
        chainEvidenceId: '区块链存证号'
      },
      requiredFields: ['customerName', 'creditCode', 'legalRep', 'registeredCapital', 'creditScore', 'recommendedAmount', 'aiPreApprovalHash'],
      sectionOrder: ['basic', 'scorecard', 'fiveStreams', 'credit', 'aiPreApproval'],
      riskAppetite: 'conservative',
      remark: '中行大行风控稳健, 需担保, AI 预审章作为风控补强'
    }
  };

  // ============================================================
  //  localStorage 持久化键
  // ============================================================
  const LS_DOCS = 'fintrust_eco_rpa_docs_v31';
  const LS_FEEDBACK = 'fintrust_eco_rpa_feedback_v31';
  const LS_SEEDED = 'fintrust_eco_rpa_seeded_v31';

  // 银行放款业绩种子数据 (模拟该行通过本系统历史累计业绩, 用于 API 升级触发演示)
  // ourBadDebtRate 显著低于 bankOverallBadDebtRate (低 50%+), 满足 spec 升级条件
  const SEED_STATS = {
    CMB:  { baselineLoans: 15, baselineAmount: 82000000,  baselineBadDebt: 0, bankOverallBadDebtRate: 0.028 },
    ICBC: { baselineLoans: 9,  baselineAmount: 64000000,  baselineBadDebt: 1, bankOverallBadDebtRate: 0.031 },
    CCB:  { baselineLoans: 4,  baselineAmount: 22000000,  baselineBadDebt: 0, bankOverallBadDebtRate: 0.029 },
    BCM:  { baselineLoans: 2,  baselineAmount: 9000000,   baselineBadDebt: 0, bankOverallBadDebtRate: 0.026 },
    BOC:  { baselineLoans: 1,  baselineAmount: 5000000,   baselineBadDebt: 0, bankOverallBadDebtRate: 0.030 }
  };

  // API 升级触发阈值 (spec: 累计放款笔数 ≥ 20 且 坏账率显著低 50%+)
  const UPGRADE_LOAN_THRESHOLD = 20;
  const UPGRADE_BAD_DEBT_RATIO = 0.5; // our rate < overall * 0.5

  // ============================================================
  //  localStorage 读写辅助
  // ============================================================
  function _lsRead(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function _lsWrite(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* 配额满忽略 */ }
  }
  function _getDocs() { return _lsRead(LS_DOCS, {}); }
  function _setDocs(d) { _lsWrite(LS_DOCS, d); }
  function _getFeedback() { return _lsRead(LS_FEEDBACK, []); }
  function _setFeedback(f) { _lsWrite(LS_FEEDBACK, f); }

  // 首次加载种子化 (写入一个标记, 不重复种子)
  function _ensureSeeded() {
    if (_lsRead(LS_SEEDED, false)) return;
    _lsWrite(LS_SEEDED, true);
  }
  _ensureSeeded();

  // ============================================================
  //  企业数据抽取辅助 (只读 window.State)
  // ============================================================
  function _getEnterprise(entId) {
    if (typeof window === 'undefined' || !window.State) return null;
    const list = window.State.enterprises || [];
    return list.find(e => e.id === entId) || null;
  }

  // 8 维评分卡: 优先改造后 afterScorecard, 回退 beforeScorecard, 再回退默认
  const DIM_META = {
    subject:  { label: '主体资质', icon: '🏢' },
    finance:  { label: '财务规范', icon: '📊' },
    tax:      { label: '税务合规', icon: '🧾' },
    business: { label: '业务真实性', icon: '📦' },
    assets:   { label: '资产确权', icon: '🏗' },
    credit:   { label: '信用维度', icon: '💳' },
    policy:   { label: '政策红利', icon: '🎖' },
    capital:  { label: '资金管理', icon: '💰' }
  };
  function _extractScorecard(ent) {
    const r = ent.reform || {};
    const sc = r.afterScorecard || r.beforeScorecard || {
      subject: 60, finance: 60, tax: 60, business: 60, assets: 60, credit: 60, policy: 60, capital: 60
    };
    return sc;
  }

  // 五流证据链通过率: 已验证(fiveStreams true)→100%, 数据流开通未验证→60%, 否则 0%
  function _extractFiveStreams(ent) {
    const fs = (ent.runtime && ent.runtime.fiveStreams) || {};
    const df = ent.dataFlows || {};
    const rate = (verified, flowOpen) => verified ? 100 : (flowOpen ? 60 : 0);
    return {
      contract:  rate(fs.contract, df.contract),
      invoice:   rate(fs.invoice, df.invoice),
      logistics: rate(fs.logistics, df.logistics),
      fund:      rate(fs.fund, df.fund),
      iot:       rate(fs.iot, df.iot)
    };
  }

  // 纳税信用等级 (由税务维度分映射, 模拟税务 A/B/C/D/M 评级)
  function _taxGrade(taxScore) {
    if (taxScore >= 90) return 'A';
    if (taxScore >= 80) return 'B';
    if (taxScore >= 70) return 'C';
    if (taxScore >= 60) return 'M';
    return 'D';
  }

  // 资产负债率 / 流动比率 (由财务数据派生模拟值)
  function _deriveRatios(ent) {
    const f = ent.financials || {};
    const rev = f.monthlyRevenue || 1;
    const exp = f.monthlyExpense || 1;
    const bal = f.accountBalance || 0;
    const expenseRatio = exp / rev;
    const debtRatio = Math.min(72, Math.max(32, 32 + expenseRatio * 40));
    const currentRatio = +Math.min(3.0, Math.max(0.8, bal / Math.max(exp, 1))).toFixed(2);
    return { debtRatio: +debtRatio.toFixed(1), currentRatio };
  }

  // 企业基本信息 (部分字段不在 State 中, 用确定性 mock 补全模拟器体验)
  const _BASIC_CACHE = {
    E001: { creditCode: '91310115MA1E001001X', establishDate: '2015-06-18', legalRep: '王建国', registeredCapital: 50000000, businessScope: '精密机械零部件研发、制造与销售' },
    E002: { creditCode: '91310115MA1E002002X', establishDate: '2018-03-22', legalRep: '李智明', registeredCapital: 30000000, businessScope: '集成电路设计与人工智能硬件研发' },
    E003: { creditCode: '91310115MA1E003003X', establishDate: '2012-11-09', legalRep: '赵鑫',   registeredCapital: 10000000, businessScope: '建筑材料贸易与房地产关联供应链' },
    E004: { creditCode: '91310115MA1E004004X', establishDate: '2019-07-15', legalRep: '孙海川', registeredCapital: 8000000,  businessScope: '物流运输与仓储服务' }
  };
  function _entBasicInfo(ent) {
    const cache = _BASIC_CACHE[ent.id] || {
      creditCode: '91310115MA1' + ent.id + 'X',
      establishDate: '2016-01-01',
      legalRep: '法定代表人',
      registeredCapital: 10000000,
      businessScope: (ent.industryLabel || '综合') + '相关业务'
    };
    return {
      name: ent.name,
      industry: ent.industryLabel || ent.industry || '未分类',
      creditCode: cache.creditCode,
      establishDate: cache.establishDate,
      legalRep: cache.legalRep,
      registeredCapital: cache.registeredCapital,
      businessScope: cache.businessScope
    };
  }

  // 建议授信测算 (模拟 MOD-16.9 可贷额度算法)
  function _computeRecommendedCredit(ent, bank) {
    const score = (ent.runtime && ent.runtime.creditScore) || 650;
    const monthlyRev = (ent.financials && ent.financials.monthlyRevenue) || 5000000;
    const mult = score >= 800 ? 4 : score >= 700 ? 3 : score >= 600 ? 2 : 1;
    let amount = monthlyRev * mult * (score / 750);
    amount = Math.min(amount, bank.maxAmount);
    amount = Math.max(Math.round(amount / 100000) * 100000, 500000); // 取整到 10 万, 下限 50 万
    const rateAdj = (ent.runtime && ent.runtime.rateDiscount) || 0;
    const rate = +(bank.baseRate + (score < 650 ? 1 : 0) + rateAdj).toFixed(2);
    const term = bank.defaultTerm || 12;
    const grade = score >= 800 ? 'A' : score >= 700 ? 'B' : score >= 600 ? 'C' : 'D';
    return { amount, rate, term, grade, productLine: bank.productLine };
  }

  // AI 预审置信度 (由信用完整度 + 五流通过率派生, 0-100)
  function _computeConfidence(ent, fiveStreams) {
    const completeness = (ent.runtime && ent.runtime.creditCompleteness) || 0.5;
    const avgStream = (fiveStreams.contract + fiveStreams.invoice + fiveStreams.logistics + fiveStreams.fund + fiveStreams.iot) / 5;
    return Math.round(Math.min(98, completeness * 60 + avgStream * 0.38));
  }

  // 风险评级 (由信用分映射, 供 AI 预审章使用)
  function _riskGrade(ent) {
    const score = (ent.runtime && ent.runtime.creditScore) || 650;
    if (score >= 800) return 'R1 低风险';
    if (score >= 700) return 'R2 中低风险';
    if (score >= 600) return 'R3 中风险';
    return 'R4 高风险';
  }

  // ============================================================
  //  RPA.1 + RPA.3 标准信贷申报书自动渲染 (模板引擎)
  // ============================================================

  /**
   * 生成该银行的标准信贷申报书
   * @param {string} enterpriseId 企业 ID
   * @param {string} bankId 银行模板 ID (CMB/ICBC/CCB/BCM/BOC)
   * @returns {Promise<object>} 申报书对象
   */
  async function generateApplication(enterpriseId, bankId) {
    const ent = _getEnterprise(enterpriseId);
    const bank = BANK_TEMPLATES[bankId];
    if (!ent) throw new Error('企业不存在: ' + enterpriseId);
    if (!bank) throw new Error('银行模板不存在: ' + bankId);

    const basic = _entBasicInfo(ent);
    const scorecard = _extractScorecard(ent);
    const fiveStreams = _extractFiveStreams(ent);
    const ratios = _deriveRatios(ent);
    const credit = _computeRecommendedCredit(ent, bank);
    const confidence = _computeConfidence(ent, fiveStreams);
    const riskGrade = _riskGrade(ent);

    const docId = bank.docPrefix + '-' + enterpriseId + '-' + Date.now();
    const doc = {
      docId,
      enterpriseId,
      bankId,
      bankName: bank.name,
      productLine: bank.productLine,
      generatedAt: new Date().toISOString(),
      generatedAtLabel: new Date().toLocaleString('zh-CN', { hour12: false }),
      basic,
      scorecard,
      fiveStreams,
      ratios,
      recommendedCredit: credit,
      aiPreApproval: {
        signed: false,
        confidence,
        riskGrade,
        hash: null,
        chainEvidenceId: null,
        signedAt: null,
        signer: 'FinTrust Hub AI 预审引擎 v3.1',
        disclaimer: '本报告由 FinTrust Hub AI 预审生成, 仅供银行信贷员参考'
      },
      importFormat: bank.importFormat,
      requiredFields: bank.requiredFields,
      // 用于哈希的稳定内容串 (生成时不带签名, 签名时再算)
      _contentFingerprint: ''
    };
    doc._contentFingerprint = _buildFingerprint(doc);

    // 持久化
    const docs = _getDocs();
    docs[docId] = doc;
    _setDocs(docs);
    return doc;
  }

  // 构建申报书内容指纹串 (用于 SHA-256 链上存证, 不含签名本身)
  function _buildFingerprint(doc) {
    return JSON.stringify({
      docId: doc.docId, enterpriseId: doc.enterpriseId, bankId: doc.bankId,
      basic: doc.basic, scorecard: doc.scorecard, fiveStreams: doc.fiveStreams,
      ratios: doc.ratios, recommendedCredit: doc.recommendedCredit,
      generatedAt: doc.generatedAt
    });
  }

  /**
   * 获取已生成的申报书内容 (HTML 字符串, 用于预览与 .html 下载)
   * @param {string} entId 企业 ID
   * @param {string} bankId 银行 ID
   * @returns {string} 完整 HTML 文档字符串
   */
  function getApplicationDoc(entId, bankId) {
    const doc = _findDoc(entId, bankId);
    if (!doc) return '<div style="padding:20px;color:#888">尚未生成申报书</div>';
    return _renderDocHtml(doc);
  }

  // 按 (entId, bankId) 查找最近一份申报书
  function _findDoc(entId, bankId) {
    const docs = _getDocs();
    const list = Object.values(docs).filter(d => d.enterpriseId === entId && d.bankId === bankId);
    if (list.length === 0) return null;
    list.sort((a, b) => (b.generatedAt || '').localeCompare(a.generatedAt || ''));
    return list[0];
  }

  // 列出某企业的全部申报书
  function listApplications(entId) {
    const docs = _getDocs();
    return Object.values(docs).filter(d => d.enterpriseId === entId)
      .sort((a, b) => (b.generatedAt || '').localeCompare(a.generatedAt || ''));
  }

  // 渲染申报书为完整 HTML 文档 (深色主题, 自包含样式, 兼容打印)
  function _renderDocHtml(doc) {
    const bank = BANK_TEMPLATES[doc.bankId];
    const fm = bank.fieldMappings;
    const ap = doc.aiPreApproval || {};
    const sc = doc.scorecard;
    const fs = doc.fiveStreams;
    const rc = doc.recommendedCredit;
    const amt = (n) => {
      if (n >= 100000000) return (n / 100000000).toFixed(2) + ' 亿';
      if (n >= 10000) return (n / 10000).toFixed(0) + ' 万';
      return n + ' 元';
    };
    const streamRow = (label, val) => `
      <tr><td style="padding:6px 10px;border:1px solid #30363d">${label}</td>
      <td style="padding:6px 10px;border:1px solid #30363d;text-align:center">
        <span style="color:${val >= 100 ? '#3fb950' : val >= 60 ? '#d29922' : '#f85149'};font-weight:700">${val}%</span>
      </td></tr>`;
    return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<title>${doc.bankName}标准信贷申报书 - ${doc.basic.name}</title>
<style>
  body{font-family:'Microsoft YaHei',sans-serif;background:#0d1117;color:#e6edf3;padding:24px;margin:0}
  .doc{max-width:820px;margin:0 auto;background:#161b22;border:1px solid #30363d;border-radius:8px;padding:28px}
  h1{font-size:20px;text-align:center;color:#58a6ff;margin:0 0 4px}
  .sub{text-align:center;color:#8b949e;font-size:12px;margin-bottom:18px}
  h2{font-size:14px;color:#bc8cff;border-left:3px solid #bc8cff;padding-left:8px;margin:18px 0 8px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  td{padding:6px 10px;border:1px solid #30363d}
  td:first-child{color:#8b949e;width:38%;background:#1c2333}
  .stamp{margin-top:18px;padding:14px;border:2px dashed #bc8cff;border-radius:8px;background:rgba(188,140,255,0.06);text-align:center}
  .stamp .title{color:#bc8cff;font-weight:700;font-size:15px}
  .disclaimer{margin-top:14px;font-size:11px;color:#6e7681;text-align:center;border-top:1px dashed #30363d;padding-top:10px}
</style></head><body><div class="doc">
  <h1>${bank.icon} ${doc.bankName} · ${doc.productLine}标准信贷申报书</h1>
  <div class="sub">${fm.docNo}: ${doc.docId} &nbsp;|&nbsp; 生成时间: ${doc.generatedAtLabel} &nbsp;|&nbsp; 导入格式: ${doc.importFormat.toUpperCase()}</div>

  <h2>一、企业基本信息</h2>
  <table>
    <tr><td>${fm.customerName}</td><td>${doc.basic.name}</td></tr>
    <tr><td>${fm.creditCode}</td><td>${doc.basic.creditCode}</td></tr>
    <tr><td>${fm.establishDate}</td><td>${doc.basic.establishDate}</td></tr>
    <tr><td>${fm.legalRep}</td><td>${doc.basic.legalRep}</td></tr>
    <tr><td>${fm.registeredCapital}</td><td>${amt(doc.basic.registeredCapital)}</td></tr>
    <tr><td>${fm.industry}</td><td>${doc.basic.industry}</td></tr>
    <tr><td>${fm.businessScope}</td><td>${doc.basic.businessScope}</td></tr>
  </table>

  <h2>二、改造后 8 维画像</h2>
  <table>
    <tr><td>${fm.creditScore}</td><td>${(window.State && window.State.enterprises ? (window.State.enterprises.find(e=>e.id===doc.enterpriseId)||{}).runtime||{} : {}).creditScore || '-'}</td></tr>
    <tr><td>${fm.taxGrade}</td><td>${_taxGrade(sc.tax)} (${sc.tax}分)</td></tr>
    <tr><td>${fm.debtRatio}</td><td>${doc.ratios.debtRatio}%</td></tr>
    <tr><td>${fm.currentRatio}</td><td>${doc.ratios.currentRatio}</td></tr>
    <tr><td>主体资质</td><td>${sc.subject}</td></tr>
    <tr><td>财务规范</td><td>${sc.finance}</td></tr>
    <tr><td>业务真实性</td><td>${sc.business}</td></tr>
    <tr><td>资产确权</td><td>${sc.assets}</td></tr>
    <tr><td>信用维度</td><td>${sc.credit}</td></tr>
    <tr><td>政策红利</td><td>${sc.policy}</td></tr>
    <tr><td>资金管理</td><td>${sc.capital}</td></tr>
    <tr><td>${fm.riskGrade}</td><td>${ap.riskGrade || '-'}</td></tr>
  </table>

  <h2>三、五流证据链摘要</h2>
  <table>
    ${streamRow(fm.fiveStreamContract, fs.contract)}
    ${streamRow(fm.fiveStreamInvoice, fs.invoice)}
    ${streamRow(fm.fiveStreamLogistics, fs.logistics)}
    ${streamRow(fm.fiveStreamFund, fs.fund)}
    ${streamRow(fm.fiveStreamIot, fs.iot)}
  </table>

  <h2>四、建议授信额度 (基于 MOD-16.9 测算)</h2>
  <table>
    <tr><td>${fm.recommendedAmount}</td><td><b style="color:#3fb950">${amt(rc.amount)}</b></td></tr>
    <tr><td>${fm.recommendedRate}</td><td>${rc.rate}%</td></tr>
    <tr><td>${fm.recommendedTerm}</td><td>${rc.term} 个月</td></tr>
    <tr><td>建议产品</td><td>${rc.productLine}</td></tr>
  </table>

  <div class="stamp">
    <div class="title">🛡 AI 预审章 (电子签章 + 链上存证)</div>
    <div style="font-size:12px;color:#8b949e;margin-top:6px">
      ${ap.signed ? '已签发' : '未签发 (请先执行 AI 预审章签发)'}<br>
      ${fm.aiConfidence}: ${ap.confidence}% &nbsp;|&nbsp; ${fm.riskGrade}: ${ap.riskGrade || '-'}<br>
      ${ap.signed ? `${fm.aiPreApprovalHash}: <code style="color:#3fb950">${ap.hash}</code><br>${fm.chainEvidenceId}: <code>${ap.chainEvidenceId}</code><br>签发时间: ${ap.signedAt}` : ''}
    </div>
  </div>

  <div class="disclaimer">${ap.disclaimer}</div>
</div></body></html>`;
  }

  // ============================================================
  //  RPA.1 下载 (Blob + URL.createObjectURL, 模拟 Excel/PDF)
  // ============================================================

  /**
   * 下载申报书 (.csv 模拟 Excel / .html 模拟 PDF)
   * @param {string} entId 企业 ID
   * @param {string} bankId 银行 ID
   * @param {string} format 'csv' | 'html'
   */
  function downloadApplication(entId, bankId, format) {
    const doc = _findDoc(entId, bankId);
    if (!doc) {
      alert('请先生成申报书后再下载');
      return;
    }
    const bank = BANK_TEMPLATES[bankId];
    if (format === 'html') {
      const html = _renderDocHtml(doc);
      _triggerDownload(html, `${bankId}_${entId}_信贷申报书.html`, 'text/html;charset=utf-8');
    } else if (format === 'csv') {
      const csv = _renderDocCsv(doc, bank);
      // BOM 前缀保证 Excel 正确识别 UTF-8
      _triggerDownload('\ufeff' + csv, `${bankId}_${entId}_信贷申报书.csv`, 'text/csv;charset=utf-8');
    } else {
      throw new Error('不支持的格式: ' + format + ' (仅支持 csv / html)');
    }
  }

  function _triggerDownload(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // 释放对象 URL, 避免内存泄漏
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // 渲染为 CSV (按银行字段映射表头, 两列: 字段名 / 值, 兼容银行信贷系统导入)
  function _renderDocCsv(doc, bank) {
    const fm = bank.fieldMappings;
    const sc = doc.scorecard;
    const fs = doc.fiveStreams;
    const rc = doc.recommendedCredit;
    const ap = doc.aiPreApproval;
    const ent = _getEnterprise(doc.enterpriseId) || {};
    const creditScore = (ent.runtime && ent.runtime.creditScore) || '-';
    const rows = [
      [fm.docNo, doc.docId],
      [fm.customerName, doc.basic.name],
      [fm.creditCode, doc.basic.creditCode],
      [fm.establishDate, doc.basic.establishDate],
      [fm.legalRep, doc.basic.legalRep],
      [fm.registeredCapital, doc.basic.registeredCapital],
      [fm.industry, doc.basic.industry],
      [fm.businessScope, doc.basic.businessScope],
      [fm.creditScore, creditScore],
      [fm.taxGrade, _taxGrade(sc.tax)],
      [fm.debtRatio, doc.ratios.debtRatio + '%'],
      [fm.currentRatio, doc.ratios.currentRatio],
      ['主体资质', sc.subject],
      ['财务规范', sc.finance],
      ['业务真实性', sc.business],
      ['资产确权', sc.assets],
      ['信用维度', sc.credit],
      ['政策红利', sc.policy],
      ['资金管理', sc.capital],
      [fm.fiveStreamContract, fs.contract + '%'],
      [fm.fiveStreamInvoice, fs.invoice + '%'],
      [fm.fiveStreamLogistics, fs.logistics + '%'],
      [fm.fiveStreamFund, fs.fund + '%'],
      [fm.fiveStreamIot, fs.iot + '%'],
      [fm.recommendedAmount, rc.amount],
      [fm.recommendedRate, rc.rate + '%'],
      [fm.recommendedTerm, rc.term],
      [fm.riskGrade, ap.riskGrade || '-'],
      [fm.aiConfidence, ap.confidence + '%'],
      [fm.aiPreApprovalHash, ap.hash || '(未签发)'],
      [fm.chainEvidenceId, ap.chainEvidenceId || '(未签发)']
    ];
    return rows.map(r => _csvCell(r[0]) + ',' + _csvCell(r[1])).join('\r\n');
  }
  function _csvCell(v) {
    const s = String(v == null ? '' : v);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  // ============================================================
  //  RPA.4 AI 预审章电子签章 + MOD-08 链上存证
  // ============================================================

  /**
   * AI 预审章电子签章 + 上链存证 (SHA-256 哈希模拟不可篡改存证)
   * @param {string} docId 申报书 ID
   * @returns {Promise<object>} 签章信息 { hash, chainEvidenceId, signedAt, confidence, riskGrade }
   */
  async function signAiPreApproval(docId) {
    const docs = _getDocs();
    const doc = docs[docId];
    if (!doc) throw new Error('申报书不存在: ' + docId);
    if (doc.aiPreApproval && doc.aiPreApproval.signed) {
      // 已签发, 幂等返回 (链上存证不可篡改, 重复签发返回同一哈希)
      return doc.aiPreApproval;
    }
    // 模拟 MOD-08 链上存证: SHA-256(内容指纹 + 签发方 + 时间戳)
    const payload = doc._contentFingerprint + '|' + (doc.aiPreApproval.signer) + '|' + Date.now();
    const hash = await _sha256(payload);
    const chainEvidenceId = 'MOD08-' + hash.substring(0, 16).toUpperCase();
    const signedAt = new Date().toLocaleString('zh-CN', { hour12: false });

    doc.aiPreApproval = Object.assign({}, doc.aiPreApproval, {
      signed: true,
      hash,
      chainEvidenceId,
      signedAt
    });
    docs[docId] = doc;
    _setDocs(docs);
    return doc.aiPreApproval;
  }

  // SHA-256 via Web Crypto (浏览器原生, 不可篡改模拟)
  async function _sha256(text) {
    const buf = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', buf);
    const bytes = Array.from(new Uint8Array(digest));
    return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ============================================================
  //  RPA.6 APP-03 银行审批结果回填接口
  // ============================================================

  /**
   * 银行审批结果回填 (通过/拒绝/调整额度)
   * @param {string} bankId 银行 ID
   * @param {object} approval { enterpriseId, docId, result, approvedAmount, approvedRate, approvedTerm, note }
   * @returns {Promise<object>} 回填后的反馈记录
   */
  async function recordBankFeedback(bankId, approval) {
    const bank = BANK_TEMPLATES[bankId];
    if (!bank) throw new Error('银行模板不存在: ' + bankId);
    const result = approval.result || 'approved';
    if (['approved', 'rejected', 'adjusted'].indexOf(result) < 0) {
      throw new Error('审批结果非法: ' + result + ' (仅支持 approved/rejected/adjusted)');
    }
    const record = {
      feedbackId: 'FB-' + bankId + '-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      bankId,
      bankName: bank.name,
      enterpriseId: approval.enterpriseId,
      docId: approval.docId || null,
      result,
      approvedAmount: result === 'rejected' ? 0 : (approval.approvedAmount || 0),
      approvedRate: approval.approvedRate || null,
      approvedTerm: approval.approvedTerm || null,
      note: approval.note || '',
      feedbackAt: new Date().toISOString(),
      feedbackAtLabel: new Date().toLocaleString('zh-CN', { hour12: false })
    };
    const list = _getFeedback();
    list.push(record);
    _setFeedback(list);
    return record;
  }

  // 列出某银行的全部反馈
  function listBankFeedback(bankId) {
    return _getFeedback().filter(f => f.bankId === bankId)
      .sort((a, b) => (b.feedbackAt || '').localeCompare(a.feedbackAt || ''));
  }

  // ============================================================
  //  RPA.7 银行放款业绩统计 + 坏账率对比 + API 升级价值报告
  // ============================================================

  /**
   * 该银行"无接口"放款业绩统计 (含种子历史 + 回填记录)
   * @param {string} bankId 银行 ID
   * @returns {object} 业绩统计
   */
  function getBankStats(bankId) {
    const bank = BANK_TEMPLATES[bankId];
    if (!bank) throw new Error('银行模板不存在: ' + bankId);
    const seed = SEED_STATS[bankId] || { baselineLoans: 0, baselineAmount: 0, baselineBadDebt: 0, bankOverallBadDebtRate: 0.03 };

    // 累计回填的通过/调整记录 (模拟为已放款)
    const feedback = _getFeedback().filter(f => f.bankId === bankId);
    const approved = feedback.filter(f => f.result === 'approved' || f.result === 'adjusted');
    const rejected = feedback.filter(f => f.result === 'rejected');
    const recordedLoans = approved.length;
    const recordedAmount = approved.reduce((s, f) => s + (f.approvedAmount || 0), 0);

    // 本系统推荐资产的坏账 (种子 + 回填; 回填部分按企业风险确定性派生, 整体保持低坏账)
    let recordedBadDebt = 0;
    approved.forEach(f => {
      const ent = _getEnterprise(f.enterpriseId);
      if (ent && ent.riskProfile === 'high_risk') recordedBadDebt += 1; // 高风险企业 1 笔坏账
    });

    const totalLoans = seed.baselineLoans + recordedLoans;
    const totalAmount = seed.baselineAmount + recordedAmount;
    const badDebtCount = seed.baselineBadDebt + recordedBadDebt;
    const ourBadDebtRate = totalLoans > 0 ? +(badDebtCount / totalLoans).toFixed(4) : 0;
    const bankOverallBadDebtRate = seed.bankOverallBadDebtRate;

    // API 升级触发条件: 累计放款 ≥ 阈值 且 本系统坏账率显著低于该行整体(低 50%+)
    const significantlyLower = bankOverallBadDebtRate > 0 && ourBadDebtRate < bankOverallBadDebtRate * UPGRADE_BAD_DEBT_RATIO;
    const apiUpgradeTriggered = totalLoans >= UPGRADE_LOAN_THRESHOLD && significantlyLower;

    return {
      bankId,
      bankName: bank.name,
      totalApplications: feedback.length,
      approvedCount: approved.length,
      rejectedCount: rejected.length,
      totalLoans,
      totalAmount,
      badDebtCount,
      ourBadDebtRate,
      bankOverallBadDebtRate,
      badDebtReduction: bankOverallBadDebtRate > 0
        ? +((1 - ourBadDebtRate / bankOverallBadDebtRate) * 100).toFixed(1)
        : 0,
      apiUpgradeTriggered,
      threshold: UPGRADE_LOAN_THRESHOLD,
      progressToThreshold: Math.min(100, +(totalLoans / UPGRADE_LOAN_THRESHOLD * 100).toFixed(0)),
      remainingToThreshold: Math.max(0, UPGRADE_LOAN_THRESHOLD - totalLoans)
    };
  }

  /**
   * 触发《API 直连价值评估报告》(spec: 量化展示放款笔数/金额/坏账率对比, 建议升级 API 直连)
   * @param {string} bankId 银行 ID
   * @returns {object} 报告内容
   */
  function getApiUpgradeReport(bankId) {
    const stats = getBankStats(bankId);
    const bank = BANK_TEMPLATES[bankId];
    const triggered = stats.apiUpgradeTriggered;
    const ourRatePct = (stats.ourBadDebtRate * 100).toFixed(2);
    const overallPct = (stats.bankOverallBadDebtRate * 100).toFixed(2);
    const amt = (n) => {
      if (n >= 100000000) return (n / 100000000).toFixed(2) + ' 亿';
      if (n >= 10000) return (n / 10000).toFixed(0) + ' 万';
      return n + ' 元';
    };
    return {
      bankId,
      bankName: bank.name,
      generatedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
      triggered,
      headline: triggered
        ? `建议 ${bank.name} 升级至 API 直连 (INFRA-01b) 以扩大合作规模`
        : `${bank.name} 暂未达到 API 直连升级阈值 (累计放款 ${stats.totalLoans}/${UPGRADE_LOAN_THRESHOLD} 笔)`,
      metrics: {
        totalLoans: stats.totalLoans,
        totalAmount: amt(stats.totalAmount),
        ourBadDebtRate: ourRatePct + '%',
        bankOverallBadDebtRate: overallPct + '%',
        badDebtReduction: stats.badDebtReduction + '%',
        threshold: UPGRADE_LOAN_THRESHOLD,
        remaining: stats.remainingToThreshold
      },
      recommendation: triggered
        ? `贵行通过本系统推荐资产 ${stats.totalLoans} 笔, 累计金额 ${amt(stats.totalAmount)}, 坏账率 ${ourRatePct}% (vs 贵行整体 ${overallPct}%), ` +
          `坏账率降低 ${stats.badDebtReduction}%. 建议升级 API 直连以扩大规模, INFRA-05 无接口模式将降级为备份通道.`
        : `贵行通过本系统推荐资产 ${stats.totalLoans} 笔, 坏账率 ${ourRatePct}% (vs 贵行整体 ${overallPct}%). ` +
          `再累计 ${stats.remainingToThreshold} 笔放款且坏账率维持低位, 即可触发 API 直连升级建议.`,
      actionOnUpgrade: '银行主动发起 API 直连后, 该行切换至 INFRA-01b 模式, INFRA-05 降级为备份通道',
      specRef: 'INFRA-05 Scenario: 银行反馈收集与 API 升级触发'
    };
  }

  // ============================================================
  //  RPA.5 多银行模板适配 + 一键生成多银行版本
  // ============================================================

  /**
   * 一键生成多银行版本申报书 (并行投递, 提高撮合成功率)
   * @param {string} entId 企业 ID
   * @param {string[]} [bankIds] 可选, 指定银行列表; 默认全部 5 家
   * @returns {Promise<object[]>} 各银行申报书对象数组
   */
  async function generateMultiBank(entId, bankIds) {
    const ids = bankIds && bankIds.length ? bankIds : Object.keys(BANK_TEMPLATES);
    const results = [];
    for (const bid of ids) {
      try {
        const doc = await generateApplication(entId, bid);
        // 多银行版本自动加盖 AI 预审章 (并行投递需带章)
        const signed = await signAiPreApproval(doc.docId);
        doc.aiPreApproval = signed; // 同步更新内存对象, 使返回值反映已签发状态
        results.push(doc);
      } catch (e) {
        results.push({ bankId: bid, error: e.message });
      }
    }
    return results;
  }

  // ============================================================
  //  公共 API 导出
  // ============================================================
  return {
    banks: BANK_TEMPLATES,
    bankList: Object.values(BANK_TEMPLATES),
    generateApplication,
    getApplicationDoc,
    downloadApplication,
    signAiPreApproval,
    recordBankFeedback,
    getBankStats,
    getApiUpgradeReport,
    generateMultiBank,
    // 辅助方法 (供视图层调用)
    listApplications,
    listBankFeedback,
    findDoc: _findDoc,
    dimMeta: DIM_META,
    version: 'ECO-03 INFRA-05 v3.1'
  };
})();
