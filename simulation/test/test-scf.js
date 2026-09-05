/**
 * test-scf.js — Tab11 供应链金融子系统端到端测试
 *
 * 覆盖场景 (对齐 simulation-plan.md 七.12 验收标准):
 *   T01: 4层数据库架构完整 (主数据/关系/交易/风控)
 *   T02: 13维画像计算正确 (8维继承 + 5维新增)
 *   T03: SC1 关系图谱构建 (nodes/edges/clusters)
 *   T04: SC2 黑白名单准入 (黑名单拒绝/白名单通过/信用不足拒绝)
 *   T05: SC3 三层信用传导 (独立/传导/场景)
 *   T06: SC4 贸易验证 (五流+贸易专项+虚假贸易→SC2)
 *   T07: SC5 产品路由 (5类产品匹配)
 *   T08: SC6 动态定价 (7项联动机制)
 *   T09: SC7 风险扩散 (节点故障影响范围)
 *   T10: SC8 机构撮合 (多方竞标)
 *   T11: SC9 履约监控 + 闭环回流 (SC9→SC2/SC3)
 *   T12: SC10 案例学习 (KNN检索+入库)
 *   T13: 端到端全链路 (SC1→SC10)
 *   T14: Tab0 协同 (改造等级≥B+ 才能成为核心企业)
 *   T15: localStorage 持久化 + 重置功能
 *
 * 运行方式:
 *   cd c:\Users\Windws\Desktop\caiwu\jinrong\simulation
 *   node test\test-scf.js
 */

const fs = require('fs');
const path = require('path');

// === 测试环境模拟 ===
const memoryStore = {};
global.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  SCFData: null,
  SCFEngine: null,
  SCFGraph: null,
  ViewSCF: null,
  MockData: null,
  State: null,
};
global.document = {
  addEventListener: () => {},
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ style: {}, appendChild: () => {}, addEventListener: () => {} }),
};
global.localStorage = {
  getItem: (k) => memoryStore[k] || null,
  setItem: (k, v) => { memoryStore[k] = String(v); },
  removeItem: (k) => { delete memoryStore[k]; },
};
global.echarts = { init: () => ({ setOption: () => {}, dispose: () => {} }) };
global.AIModal = { toast: () => {}, enqueue: () => {}, dismiss: () => {} };
global.App = { switchTab: () => {}, renderAll: () => {} };
global.LogPanel = { update: () => {} };
global.GuideManager = { init: () => {}, updateContent: () => {} };
global.SceneLoader = { renderSelector: () => '', init: () => {} };
global.FallbackEngine = { getHighlightCModuleByView: () => null };

const ROOT = path.resolve(__dirname, '..');

// 按文件定制沙箱参数 (避免 const 冲突)
function loadFile(filename, extraParams = {}) {
  const code = fs.readFileSync(path.join(ROOT, 'js', filename), 'utf8');
  const paramNames = ['window', 'document', 'console', 'localStorage', 'echarts', 'AIModal', 'App', 'LogPanel', 'GuideManager', 'SceneLoader', 'FallbackEngine', ...Object.keys(extraParams)];
  const paramValues = [global.window, global.document, console, global.localStorage, global.echarts, global.AIModal, global.App, global.LogPanel, global.GuideManager, global.SceneLoader, global.FallbackEngine, ...Object.values(extraParams)];
  const fn = new Function(...paramNames, code);
  fn(...paramValues);
  console.info(`[Setup] ${filename} loaded`);
}

// 1. mock-data.js (声明 const MockData, 不需要额外参数)
loadFile('mock-data.js');
// 2. scf-data.js (声明 const SCFData, 不需要额外参数)
loadFile('scf-data.js');
// 3. state.js (声明 const State, 引用 MockData/SCFData)
loadFile('state.js', { MockData: global.window.MockData, SCFData: global.window.SCFData });
// 4. scf-engine.js (声明 const SCFEngine, 引用 State/SCFData/MockData)
loadFile('scf-engine.js', { MockData: global.window.MockData, State: global.window.State, SCFData: global.window.SCFData });
// 5. scf-graph.js (声明 const SCFGraph, 引用 State)
loadFile('scf-graph.js', { State: global.window.State });

const State = global.window.State;
const SCFEngine = global.window.SCFEngine;
const SCFData = global.window.SCFData;
const MockData = global.window.MockData;

// === 测试框架 ===
let passCount = 0;
let failCount = 0;
const failures = [];

// 关键节点日志工具 (默认开启, SCF_QUIET=1 关闭)
// 纯文本输出, 无 ANSI 转义码 (Windows Node 兼容)
const QUIET = process.env.SCF_QUIET === '1' || process.env.SCF_QUIET === 'true';
function log(tag, message, data) {
  if (QUIET) return;
  const ts = new Date().toISOString().slice(11, 23);
  let line = '  [' + ts + '] [' + tag + '] ' + message;
  if (data !== undefined) {
    try {
      const dataStr = typeof data === 'object' ? JSON.stringify(data) : String(data);
      line += ' ' + (dataStr.length > 200 ? dataStr.slice(0, 200) + '...' : dataStr);
    } catch (e) {
      line += ' [unserializable]';
    }
  }
  console.info(line);
}

function logCreditSnapshot(tag, entId, label) {
  const ent = State.getSCFEnterprise(entId);
  if (!ent) { log(tag, `${label} | 企业 ${entId} 不存在`); return; }
  log(tag, `${label} | ${ent.name}(${entId})`, {
    own: ent.credit.ownScore, propagated: ent.credit.propagatedScore,
    scene: ent.credit.sceneScore, blacklist: ent.credit.blacklistStatus,
    historyLen: ent.credit.creditHistory.length,
  });
}

function logBlacklistSnapshot(tag, label) {
  const list = State.scfDatabase.blacklist;
  log(tag, `${label} | 黑名单数量=${list.length}`, list.map(b => ({
    id: b.enterpriseId, reason: b.reason, rule: b.triggerRule, appeal: b.appealStatus,
  })));
}

function assert(condition, message) {
  if (condition) {
    passCount++;
    console.info('  [PASS] ' + message);
  } else {
    failCount++;
    failures.push(message);
    console.info('  [FAIL] ' + message);
  }
}

function assertEqual(actual, expected, message) {
  assert(actual === expected, message + ' (期望: ' + expected + ', 实际: ' + actual + ')');
}

function testGroup(name, fn) {
  console.info('\n=== ' + name + ' ===');
  fn();
}

// === 初始化 SCF 数据库 ===
State.init();
console.info('[Setup] State initialized');

// === 开始测试 ===

testGroup('T01: 4层数据库架构完整', () => {
  const db = State.scfDatabase;
  // Layer 1: 主数据
  assert(db.enterprises.length >= 5, `Layer1 主数据: 企业≥5 (实际: ${db.enterprises.length})`);
  assert(db.products.length === 5, `Layer1 主数据: 产品=5 (实际: ${db.products.length})`);
  assert(db.institutions.length >= 4, `Layer1 主数据: 机构≥4 (实际: ${db.institutions.length})`);
  // Layer 2: 关系数据
  assert(db.relationships.length >= 3, `Layer2 关系数据: 关系≥3 (实际: ${db.relationships.length})`);
  assert(db.trades.length >= 10, `Layer2 关系数据: 贸易≥10 (实际: ${db.trades.length})`);
  assert(db.blacklist.length >= 2, `Layer2 关系数据: 黑名单≥2 (实际: ${db.blacklist.length})`);
  // Layer 3: 交易数据 (运行时)
  assert(Array.isArray(db.financingRequests), 'Layer3 交易数据: financingRequests 数组已初始化');
  assert(Array.isArray(db.loans), 'Layer3 交易数据: loans 数组已初始化');
  assert(Array.isArray(db.repayments), 'Layer3 交易数据: repayments 数组已初始化');
  // Layer 4: 风控数据 (运行时)
  assert(Array.isArray(db.riskEvents), 'Layer4 风控数据: riskEvents 数组已初始化');
  assert(Array.isArray(db.creditPropagation), 'Layer4 风控数据: creditPropagation 数组已初始化');
  assert(Array.isArray(db.performanceRecords), 'Layer4 风控数据: performanceRecords 数组已初始化');
});

testGroup('T02: 13维画像计算正确 (8+5)', () => {
  const profile = SCFEngine.SC1_buildProfile('SCF-S001');
  assert(profile !== null, 'SC1 画像构建返回非 null');
  // 8 基础维度
  const baseDims = profile.baseDims;
  assert(baseDims.subject !== undefined, '基础维度: subject (主体) 存在');
  assert(baseDims.finance !== undefined, '基础维度: finance (财务) 存在');
  assert(baseDims.tax !== undefined, '基础维度: tax (税务) 存在');
  assert(baseDims.business !== undefined, '基础维度: business (业务) 存在');
  assert(baseDims.assets !== undefined, '基础维度: assets (资产) 存在');
  assert(baseDims.credit !== undefined, '基础维度: credit (信用) 存在');
  assert(baseDims.policy !== undefined, '基础维度: policy (政策) 存在');
  assert(baseDims.capital !== undefined, '基础维度: capital (资金) 存在');
  // 5 SCF 维度
  const scfDims = profile.scfDims;
  assert(scfDims.tradeStability !== undefined, 'SCF维度: tradeStability (交易稳定性) 存在');
  assert(scfDims.tradeAuthenticity !== undefined, 'SCF维度: tradeAuthenticity (贸易真实性) 存在');
  assert(scfDims.cooperationLoyalty !== undefined, 'SCF维度: cooperationLoyalty (合作忠诚度) 存在');
  assert(scfDims.performanceReliability !== undefined, 'SCF维度: performanceReliability (履约可靠度) 存在');
  assert(scfDims.networkPosition !== undefined, 'SCF维度: networkPosition (网络位置分) 存在');
  // 数值有效性
  assert(profile.overallScore > 0 && profile.overallScore <= 100, `综合分有效 (0-100): ${profile.overallScore}`);
  assert(!isNaN(profile.baseDims.subject), '基础维度 subject 为有效数字');
  assert(!isNaN(profile.scfDims.tradeStability), 'SCF维度 tradeStability 为有效数字');
});

testGroup('T03: SC1 关系图谱构建', () => {
  SCFEngine.SC1_buildGraph();
  const graph = State.scfDatabase.graph;
  assert(graph.nodes.length >= 5, `图谱节点≥5 (实际: ${graph.nodes.length})`);
  assert(graph.edges.length >= 3, `图谱边≥3 (实际: ${graph.edges.length})`);
  // 节点结构验证
  const anchorNode = graph.nodes.find(n => n.type === 'anchor');
  assert(anchorNode !== undefined, '图谱包含核心企业节点 (type=anchor)');
  const supplierNode = graph.nodes.find(n => n.type === 'supplier');
  assert(supplierNode !== undefined, '图谱包含供应商节点 (type=supplier)');
});

testGroup('T04: SC2 黑白名单准入', () => {
  logBlacklistSnapshot('T04-START', '测试开始前黑名单状态');

  // 黑名单企业 → 拒绝
  log('T04-ADMIT', `▶ 准入校验 SCF-S005 (预置黑名单企业)`);
  const blacklistResult = SCFEngine.SC2_checkAdmission('SCF-S005');
  log('T04-ADMIT', `◀ 准入结果`, { admitted: blacklistResult.admitted, reason: blacklistResult.reason, channel: blacklistResult.channel });
  assert(!blacklistResult.admitted, `黑名单企业 SCF-S005 被拒绝 (原因: ${blacklistResult.reason})`);

  // 信用分不足 → 拒绝
  const ent = State.scfDatabase.enterprises.find(e => e.credit.ownScore < 600);
  if (ent) {
    log('T04-ADMIT', `▶ 准入校验 ${ent.id} (低信用企业, 信用=${ent.credit.ownScore})`);
    const creditResult = SCFEngine.SC2_checkAdmission(ent.id);
    log('T04-ADMIT', `◀ 准入结果`, { admitted: creditResult.admitted, reason: creditResult.reason, channel: creditResult.channel });
    assert(!creditResult.admitted, `低信用企业 ${ent.id} 被拒绝 (信用: ${ent.credit.ownScore})`);
  }

  // 正常企业 → 通过
  log('T04-ADMIT', `▶ 准入校验 SCF-S001 (正常企业)`);
  const normalResult = SCFEngine.SC2_checkAdmission('SCF-S001');
  log('T04-ADMIT', `◀ 准入结果`, { admitted: normalResult.admitted, reason: normalResult.reason, channel: normalResult.channel });
  assert(normalResult.admitted, `正常企业 SCF-S001 准入通过 (原因: ${normalResult.reason})`);

  // 5类触发条件存在
  const triggerTypes = ['fake_trade', 'severe_overdue', 'circular_trade', 'dishonest', 'low_credit'];
  triggerTypes.forEach(t => {
    log('T04-TRIGGER', `▶ 触发黑名单: ${t}`);
    const entry = SCFEngine.SC2_triggerBlacklist('SCF-TEST', t, ['test evidence']);
    log('T04-TRIGGER', `◀ 触发结果`, { entId: entry ? entry.enterpriseId : null, reason: entry ? entry.reason : null });
    assert(entry !== null, `SC2 触发条件 ${t} 有效`);
    // 清理测试数据
    const idx = State.scfDatabase.blacklist.findIndex(b => b.enterpriseId === 'SCF-TEST');
    if (idx >= 0) State.scfDatabase.blacklist.splice(idx, 1);
  });
  logBlacklistSnapshot('T04-END', '测试结束后黑名单状态');
});

testGroup('T05: SC3 三层信用传导', () => {
  logCreditSnapshot('T05-START', 'SCF-S001', '传导计算前');
  log('T05-CALC', `▶ 调用 SC3_calculateTransmittedCredit('E001', 'SCF-S001')`);
  const result = SCFEngine.SC3_calculateTransmittedCredit('E001', 'SCF-S001');
  log('T05-CALC', `◀ 传导计算结果`, {
    original: result.originalScore, anchor: result.anchorScore,
    stability: result.stabilityFactor, bonus: result.cooperationBonus,
    transmitted: result.transmittedScore, improvement: result.improvement,
  });
  assert(result !== null, 'SC3 信用传导返回非 null');
  // 独立信用
  assert(result.originalScore === 680, `独立信用分 = 680 (实际: ${result.originalScore})`);
  // 传导信用
  assert(result.transmittedScore > 0, `传导信用分 > 0 (实际: ${result.transmittedScore})`);
  assert(result.transmittedScore <= 850, `传导信用分 ≤ 850 (实际: ${result.transmittedScore})`);
  // 场景信用
  log('T05-SCENE', `▶ 计算场景信用分 (verified, 押品覆盖率=0.8)`);
  const sceneScore = SCFEngine.SC3_calculateSceneCredit(result.transmittedScore, 'verified', 0.8);
  log('T05-SCENE', `◀ 场景信用分=${sceneScore} (传导=${result.transmittedScore})`);
  assert(sceneScore > 0, `场景信用分 > 0 (实际: ${sceneScore})`);
  // 传导公式验证: 传导分 = 基础分×0.5 + 核心企业分×0.3×稳定系数 + 加成×0.2
  const expectedMin = result.originalScore * 0.5;
  log('T05-FORMULA', `公式下界验证: 传导分(${result.transmittedScore}) ≥ 基础×0.5(${expectedMin})`);
  assert(result.transmittedScore >= expectedMin, `传导分≥基础分×0.5 (传导: ${result.transmittedScore}, 基础×0.5: ${expectedMin})`);
  logCreditSnapshot('T05-END', 'SCF-S001', '传导计算后');
});

testGroup('T06: SC4 贸易验证', () => {
  // verified 贸易
  const verifiedResult = SCFEngine.SC4_verifyTrade('TRD-001');
  assert(verifiedResult !== null, 'SC4 贸易验证返回非 null');
  assert(verifiedResult.level === 'verified', `TRD-001 验证等级=verified (实际: ${verifiedResult.level})`);
  assert(verifiedResult.basePassed >= 4, `基础五流通过≥4 (实际: ${verifiedResult.basePassed}/5)`);
  // 贸易专项验证
  assert(typeof verifiedResult.poInvoiceMatch === 'boolean', 'PO-发票匹配结果为 boolean');
  assert(typeof verifiedResult.logisticsContractMatch === 'boolean', '物流-合同匹配结果为 boolean');
});

testGroup('T07: SC5 产品路由 (5类产品)', () => {
  const matches = SCFEngine.SC5_matchProducts('TRD-001', 'SCF-S001');
  assert(Array.isArray(matches), 'SC5 返回匹配数组');
  assert(matches.length > 0, `SCF-S001+TRD-001 匹配到产品 (数量: ${matches.length})`);
  // 验证匹配的产品类型
  const productIds = matches.map(m => m.productId);
  assert(productIds.includes('factoring'), '匹配包含保理融资 (factoring)');
  // 验证匹配度排序
  if (matches.length >= 2) {
    assert(matches[0].matchScore >= matches[1].matchScore, '匹配度降序排列');
  }
  // 验证 5 类产品都存在于产品库
  const allProductIds = State.scfDatabase.products.map(p => p.id);
  ['factoring', 'reverse_factoring', 'advance_payment', 'inventory_finance', 'purchase_order'].forEach(pid => {
    assert(allProductIds.includes(pid), `产品库包含 ${pid}`);
  });
});

testGroup('T08: SC6 动态定价 (7项联动)', () => {
  const pricing = SCFEngine.SC6_calculateRate('factoring', 'TRD-001', 'SCF-S001', 'E001');
  assert(pricing !== null, 'SC6 定价返回非 null');
  assert(!pricing.rejected, 'SC6 定价未被拒绝');
  assert(pricing.finalRate > 0, `最终利率 > 0 (实际: ${pricing.finalRate}%)`);
  // 验证 7 项联动机制
  const bd = pricing.breakdown;
  assert(bd.lpr !== undefined, '联动1: LPR 基准存在');
  assert(bd.productBaseAdj !== undefined, '联动2: 产品基础调整存在');
  assert(bd.anchorCreditAdj !== undefined, '联动3: 核心企业信用调整存在');
  assert(bd.verificationAdj !== undefined, '联动4: 贸易验证溢价存在');
  assert(bd.blacklistAdj !== undefined, '联动5: 黑白名单调整存在');
  assert(bd.seasonalAdj !== undefined, '联动6: 季节性波动存在');
  assert(bd.policyAdj !== undefined, '联动7: 政策导向调整存在');
});

testGroup('T09: SC7 风险扩散', () => {
  const warning = SCFEngine.SC7_analyzeRiskDiffusion('SCF-S001', { description: '供应商经营异常', severity: 0.8 });
  assert(warning !== null, 'SC7 风险扩散返回非 null');
  assert(Array.isArray(warning.impacted), '受影响节点列表为数组');
  assert(['red', 'orange', 'yellow'].includes(warning.level), `预警级别有效 (实际: ${warning.level})`);
  // 风险事件已记录
  assert(State.scfDatabase.riskEvents.length > 0, '风险事件已记录到数据库');
  // 风险预警已推送
  assert(State.scfEngine.riskWarnings.length > 0, '风险预警已推送到引擎');
});

testGroup('T10: SC8 机构撮合', () => {
  const bids = SCFEngine.SC8_simulateBids('TRD-001', 'factoring', 'SCF-S001');
  assert(Array.isArray(bids), 'SC8 返回报价数组');
  assert(bids.length > 0, `机构报价数量>0 (实际: ${bids.length})`);
  // 验证排序 (利率最低优先)
  if (bids.length >= 2) {
    assert(bids[0].rate <= bids[1].rate, '报价按利率升序排列');
  }
  // 验证报价结构
  const bid = bids[0];
  assert(bid.institutionId !== undefined, '报价包含机构ID');
  assert(bid.institutionName !== undefined, '报价包含机构名称');
  assert(bid.rate > 0, '报价利率>0');
  assert(bid.amount > 0, '报价金额>0');
});

testGroup('T11: SC9 履约监控 + 闭环回流', () => {
  logCreditSnapshot('T11-START', 'SCF-S001', '全链路执行前');
  logBlacklistSnapshot('T11-START', '全链路执行前黑名单');

  // 先执行全链路创建 loan 记录
  log('T11-PIPELINE', `▶ 调用 runFullPipeline('E001', 'SCF-S001', 'TRD-001')`);
  const pipelineResult = SCFEngine.runFullPipeline('E001', 'SCF-S001', 'TRD-001');
  log('T11-PIPELINE', `◀ 全链路结果`, { success: pipelineResult.success, loanId: pipelineResult.loan ? pipelineResult.loan.id : null });
  assert(pipelineResult.success === true, '全链路执行成功 (为 SC9 测试准备 loan)');

  const loan = pipelineResult.loan;
  assert(loan !== undefined, '全链路生成 loan 记录');

  // SC9 履约监控 (按时还款场景)
  logCreditSnapshot('T11-BEFORE-SC9', 'SCF-S001', 'SC9监控前');
  log('T11-SC9', `▶ 调用 SC9_monitorPerformance('TRD-001', '${loan.id}')`);
  const performance = SCFEngine.SC9_monitorPerformance('TRD-001', loan.id);
  log('T11-SC9', `◀ SC9 履约结果`, { status: performance.status, progress: performance.repaymentProgress, overdue: performance.overdueDays });
  assert(performance !== null, 'SC9 履约监控返回非 null');
  assert(performance.status === 'completed', `履约状态=completed (实际: ${performance.status})`);

  // 闭环回流验证: SC9 → SC3 信用提升
  logCreditSnapshot('T11-AFTER-SC9', 'SCF-S001', 'SC9监控后');
  const ent = State.getSCFEnterprise('SCF-S001');
  log('T11-CLOSED-LOOP', `SC9→SC3 信用回流验证: 当前信用分=${ent.credit.ownScore} (原始680)`);
  assert(ent.credit.ownScore >= 680, `SC9→SC3 信用回流: 信用分已提升 (当前: ${ent.credit.ownScore})`);
  assert(ent.credit.creditHistory.some(h => h.event.includes('按时还款')), 'SC9→SC3 信用历史已记录按时还款');

  // 闭环回流验证: SC9 → SC10 案例入库
  const beforeCases = State.scfDatabase.cases.length;
  const newCases = State.scfDatabase.cases.filter(c => c.partnerId === 'SCF-S001' && c.createdAt === new Date().toISOString().slice(0, 10));
  log('T11-CLOSED-LOOP', `SC9→SC10 案例入库: 案例库总数=${State.scfDatabase.cases.length}, 今日新增=${newCases.length}`);
  assert(newCases.length > 0, `SC9→SC10 案例入库: 新增 ${newCases.length} 个案例`);
});

testGroup('T12: SC10 案例学习', () => {
  const ent = State.getSCFEnterprise('SCF-S001');
  const trade = State.scfDatabase.trades.find(t => t.id === 'TRD-001');
  const cases = SCFEngine.SC10_searchCases(ent, trade, 'factoring');
  assert(Array.isArray(cases), 'SC10 返回案例数组');
  assert(cases.length > 0, `案例检索命中 (数量: ${cases.length})`);
  assert(cases.length <= 3, `案例返回≤3个 (实际: ${cases.length})`);
});

testGroup('T13: 端到端全链路 (SC1→SC10)', () => {
  // 重置数据库确保干净环境
  State.resetSCFDatabase();
  const result = SCFEngine.runFullPipeline('E001', 'SCF-S001', 'TRD-001');
  assert(result.success === true, `全链路执行成功: ${result.product.productName} 融资 ${result.loan.amount} @ ${result.loan.rate}%`);
  // 验证所有引擎状态为 completed
  const statuses = State.scfEngine.engineStatus;
  ['SC1', 'SC2', 'SC3', 'SC4', 'SC5', 'SC6', 'SC7', 'SC8', 'SC9', 'SC10'].forEach(sc => {
    assert(statuses[sc].status === 'completed', `引擎 ${sc} 状态=completed`);
  });
  // 验证产出
  assert(result.loan.amount > 0, `融资金额>0 (实际: ${result.loan.amount})`);
  assert(result.loan.rate > 0, `融资利率>0 (实际: ${result.loan.rate}%)`);
  assert(result.product.productId === 'factoring', `匹配产品=factoring (实际: ${result.product.productId})`);
  assert(result.bids.length > 0, `机构报价>0 (实际: ${result.bids.length})`);
  assert(result.cases.length > 0, `案例检索>0 (实际: ${result.cases.length})`);
});

testGroup('T14: Tab0 协同 (改造等级≥B+)', () => {
  // 验证 getAnchorReformLevel 方法存在
  assert(typeof State.getAnchorReformLevel === 'function', 'getAnchorReformLevel 方法存在');
  // 验证 E001 改造等级可获取
  const level = State.getAnchorReformLevel('E001');
  assert(typeof level === 'string', `E001 改造等级为字符串 (实际: ${level})`);
  // 验证等级体系
  const validLevels = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C', 'D'];
  assert(validLevels.includes(level), `E001 改造等级有效 (实际: ${level})`);
});

testGroup('T15: localStorage 持久化 + 重置', () => {
  // 验证持久化
  State._persistSCF();
  const saved = global.localStorage.getItem('fintrust_scf_db_v1');
  assert(saved !== null, 'localStorage 持久化成功');
  const parsed = JSON.parse(saved);
  assert(parsed.enterprises.length >= 5, `持久化数据: 企业≥5 (实际: ${parsed.enterprises.length})`);
  assert(parsed.products.length === 5, `持久化数据: 产品=5 (实际: ${parsed.products.length})`);

  // 验证重置
  const beforeCount = State.scfDatabase.enterprises.length;
  State.scfDatabase.enterprises.push({ id: 'TEST', name: '测试企业' }); // 添加测试数据
  State.resetSCFDatabase();
  const afterCount = State.scfDatabase.enterprises.length;
  assert(afterCount === beforeCount, `重置后企业数恢复 (重置前: ${beforeCount}, 重置后: ${afterCount})`);
  assert(!State.scfDatabase.enterprises.find(e => e.id === 'TEST'), '测试数据已被清除');
  // 验证运行时数据已清空
  assert(State.scfDatabase.loans.length === 0, '重置后 loans 已清空');
  assert(State.scfDatabase.riskEvents.length === 0, '重置后 riskEvents 已清空');
  assert(State.scfEngine.status === 'idle', '重置后引擎状态=idle');
});

// === 测试结果汇总 ===
console.info('\n═══════════════════════════════════════════════════');
console.info(`📊 SCF 端到端测试结果: ✅ ${passCount} 通过 / ❌ ${failCount} 失败`);
console.info('═══════════════════════════════════════════════════');
if (failures.length > 0) {
  console.info('\n失败项:');
  failures.forEach(f => console.info(`  ❌ ${f}`));
  process.exit(1);
} else {
  console.info('\n🎉 所有测试通过! SCF 子系统验收标准全部满足。');
  process.exit(0);
}
