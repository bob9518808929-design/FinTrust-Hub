/**
 * demo-scf-scenario.js — 供应链金融子系统端到端模拟场景演示
 *
 * 演示场景: 宏达精密制造(E001)作为核心企业, 为上游供应商东方钢材(SCF-S001)
 *           发起保理融资全流程, 展示 SC1-SC10 引擎族实际运行效果。
 *
 * 演示流程:
 *   场景一: 正常保理融资全链路 (SC1→SC10 完整闭环)
 *   场景二: 黑名单拦截 (虚假贸易企业 SCF-S005 尝试融资被拒)
 *   场景三: 风险扩散预警 (SCF-S001 经营异常 → SC7 分析全链影响)
 *   场景四: 闭环回流验证 (按时还款 → SC3 信用提升 + SC10 案例入库)
 *
 * 运行方式:
 *   cd c:\Users\Windws\Desktop\caiwu\jinrong\simulation
 *   node test\demo-scf-scenario.js
 */

const fs = require('fs');
const path = require('path');

// === 测试环境模拟 ===
const memoryStore = {};
global.window = {
  addEventListener: () => {}, removeEventListener: () => {},
  SCFData: null, SCFEngine: null, SCFGraph: null, ViewSCF: null,
  MockData: null, State: null,
};
global.document = {
  addEventListener: () => {},
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
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

function loadFile(filename, extraParams = {}) {
  const code = fs.readFileSync(path.join(ROOT, 'js', filename), 'utf8');
  const paramNames = ['window', 'document', 'console', 'localStorage', 'echarts', 'AIModal', 'App', 'LogPanel', 'GuideManager', 'SceneLoader', 'FallbackEngine', ...Object.keys(extraParams)];
  const paramValues = [global.window, global.document, console, global.localStorage, global.echarts, global.AIModal, global.App, global.LogPanel, global.GuideManager, global.SceneLoader, global.FallbackEngine, ...Object.values(extraParams)];
  const fn = new Function(...paramNames, code);
  fn(...paramValues);
}

loadFile('mock-data.js');
loadFile('scf-data.js');
loadFile('state.js', { MockData: global.window.MockData, SCFData: global.window.SCFData });
loadFile('scf-engine.js', { MockData: global.window.MockData, State: global.window.State, SCFData: global.window.SCFData });
loadFile('scf-graph.js', { State: global.window.State });

const State = global.window.State;
const SCFEngine = global.window.SCFEngine;

// === 演示工具 ===
const COLORS = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m',
  bg_blue: '\x1b[44m', bg_green: '\x1b[42m', bg_red: '\x1b[41m', bg_yellow: '\x1b[43m',
};

function banner(text, color = 'bg_blue') {
  const line = '═'.repeat(Math.max(60, text.length + 20));
  console.info(`\n${COLORS[color]}${COLORS.bold}${line}${COLORS.reset}`);
  console.info(`${COLORS[color]}${COLORS.bold}  ${text}${COLORS.reset}`);
  console.info(`${COLORS[color]}${COLORS.bold}${line}${COLORS.reset}`);
}

function step(num, text) {
  console.info(`\n${COLORS.cyan}${COLORS.bold}[步骤 ${num}]${COLORS.reset} ${text}`);
}

function ok(text) { console.info(`  ${COLORS.green}✓${COLORS.reset} ${text}`); }
function warn(text) { console.info(`  ${COLORS.yellow}⚠${COLORS.reset} ${text}`); }
function fail(text) { console.info(`  ${COLORS.red}✗${COLORS.reset} ${text}`); }
function info(text) { console.info(`  ${COLORS.blue}ℹ${COLORS.reset} ${text}`); }
function kv(k, v) { console.info(`    ${COLORS.dim}${k}:${COLORS.reset} ${v}`); }

function money(n) {
  return '¥' + n.toLocaleString('zh-CN');
}

// === 初始化 ===
State.init();
console.info(`${COLORS.dim}[Setup] State 已初始化, SCF 数据库已加载${COLORS.reset}`);

// ============================================================
// 场景一: 正常保理融资全链路
// ============================================================
function scenario1() {
  banner('场景一: 正常保理融资全链路 (SC1→SC10 完整闭环)', 'bg_blue');

  step(1, 'SC1 构建供应链画像与关系图谱');
  const profile = SCFEngine.SC1_buildProfile('SCF-S001');
  ok(`供应商 SCF-S001 东方钢材画像构建完成`);
  kv('主体维度', profile.baseDims.subject);
  kv('财务维度', profile.baseDims.finance);
  kv('税务维度', profile.baseDims.tax);
  kv('业务维度', profile.baseDims.business);
  kv('资产维度', profile.baseDims.assets);
  kv('信用维度', profile.baseDims.credit);
  kv('政策维度', profile.baseDims.policy);
  kv('资金维度', profile.baseDims.capital);
  kv('── SCF 5 维 ──', '');
  kv('交易稳定性', profile.scfDims.tradeStability);
  kv('贸易真实性', profile.scfDims.tradeAuthenticity);
  kv('合作忠诚度', profile.scfDims.cooperationLoyalty);
  kv('履约可靠度', profile.scfDims.performanceReliability);
  kv('网络位置分', profile.scfDims.networkPosition);
  kv('综合评分', `${COLORS.bold}${profile.overallScore}/100${COLORS.reset}`);

  SCFEngine.SC1_buildGraph();
  const graph = State.scfDatabase.graph;
  ok(`关系图谱构建: ${graph.nodes.length} 节点 / ${graph.edges.length} 边`);

  step(2, 'SC2 准入校验 (黑白名单)');
  const admission = SCFEngine.SC2_checkAdmission('SCF-S001');
  if (admission.admitted) {
    ok(`准入通过: ${admission.reason}`);
  } else {
    fail(`准入拒绝: ${admission.reason}`);
  }

  step(3, 'SC3 三层信用传导计算');
  const credit = SCFEngine.SC3_calculateTransmittedCredit('E001', 'SCF-S001');
  kv('独立信用分 (企业自身)', credit.originalScore);
  kv('核心企业信用分 (E001)', credit.anchorScore);
  kv('合作稳定系数', credit.stabilityFactor.toFixed(3));
  kv('历史交易加成', credit.cooperationBonus);
  const improvementStr = credit.improvement >= 0 ? `+${credit.improvement}` : `${credit.improvement}`;
  kv(`${COLORS.bold}传导信用分${COLORS.reset}`, `${COLORS.green}${credit.transmittedScore}${COLORS.reset} (${improvementStr})`);

  const sceneScore = SCFEngine.SC3_calculateSceneCredit(credit.transmittedScore, 'verified', 0.85);
  kv('场景信用分 (verified+押品85%)', sceneScore);

  step(4, 'SC4 贸易真实性验证');
  const verify = SCFEngine.SC4_verifyTrade('TRD-001');
  kv('验证等级', `${COLORS.green}${verify.level}${COLORS.reset}`);
  kv('基础五流通过', `${verify.basePassed}/${verify.baseTotal}`);
  kv('PO-发票匹配', verify.poInvoiceMatch ? `${COLORS.green}✓${COLORS.reset}` : `${COLORS.red}✗${COLORS.reset}`);
  kv('物流-合同匹配', verify.logisticsContractMatch ? `${COLORS.green}✓${COLORS.reset}` : `${COLORS.red}✗${COLORS.reset}`);

  step(5, 'SC5 产品智能路由');
  const matches = SCFEngine.SC5_matchProducts('TRD-001', 'SCF-S001');
  ok(`匹配到 ${matches.length} 个 SCF 产品:`);
  matches.forEach((m, i) => {
    const product = State.scfDatabase.products.find(p => p.id === m.productId);
    const advanceRate = m.advanceRate || (product ? product.advanceRate : 0);
    const baseRateAdj = m.baseRateAdj || (product ? product.baseRateAdj : 0);
    kv(`  #${i + 1}`, `${m.productName} (匹配度 ${m.matchScore}) | 融资比例 ${Math.round(advanceRate * 100)}% | 利率调整 +${baseRateAdj}%`);
  });

  step(6, 'SC6 动态定价');
  const bestMatch = matches[0];
  const pricing = SCFEngine.SC6_calculateRate(bestMatch.productId, 'TRD-001', 'SCF-S001', 'E001');
  kv('产品', pricing.productName);
  kv(`${COLORS.bold}最终利率${COLORS.reset}`, `${COLORS.green}${pricing.finalRate}%${COLORS.reset}`);
  console.info(`    ${COLORS.dim}── 定价明细 ──${COLORS.reset}`);
  kv('LPR 基准', `${pricing.breakdown.lpr}%`);
  kv('产品基础调整', `+${pricing.breakdown.productBaseAdj}%`);
  kv('核心企业信用调整', `${pricing.breakdown.anchorCreditAdj > 0 ? '+' : ''}${pricing.breakdown.anchorCreditAdj}%`);
  kv('贸易验证溢价', `${pricing.breakdown.verificationAdj > 0 ? '+' : ''}${pricing.breakdown.verificationAdj}%`);
  kv('黑白名单调整', `${pricing.breakdown.blacklistAdj > 0 ? '+' : ''}${pricing.breakdown.blacklistAdj}%`);
  kv('季节性波动', `${pricing.breakdown.seasonalAdj > 0 ? '+' : ''}${pricing.breakdown.seasonalAdj}%`);
  kv('政策导向调整', `${pricing.breakdown.policyAdj > 0 ? '+' : ''}${pricing.breakdown.policyAdj}%`);

  step(7, 'SC7 风险扩散评估');
  const risk = SCFEngine.SC7_analyzeRiskDiffusion('SCF-S001', { description: '初始风险评估', severity: 0.3 });
  kv('预警级别', `${risk.level}`);
  kv('受影响节点数', risk.impacted.length);
  kv('潜在损失', money(risk.potentialLoss || 0));

  step(8, 'SC8 机构撮合市场');
  const bids = SCFEngine.SC8_simulateBids('TRD-001', bestMatch.productId, 'SCF-S001');
  ok(`${bids.length} 家机构报价:`);
  bids.forEach((b, i) => {
    const tag = i === 0 ? `${COLORS.green}[最优]${COLORS.reset} ` : '         ';
    kv(`${tag}#${i + 1}`, `${b.institutionName} | 利率 ${b.rate}% | 金额 ${money(b.amount)} | ${b.condition}`);
  });

  step(9, '一键全链路执行 (SC1→SC10)');
  State.resetSCFDatabase();
  const result = SCFEngine.runFullPipeline('E001', 'SCF-S001', 'TRD-001');
  if (result.success) {
    ok(`全链路执行成功!`);
    console.info(`\n    ${COLORS.bg_green}${COLORS.bold}  🎉 融资成功  ${COLORS.reset}`);
    kv('核心企业', State.getAnchorEnterprise('E001').name);
    kv('融资方', State.getSCFEnterprise('SCF-S001').name);
    kv('产品类型', result.product.productName);
    kv('融资金额', `${COLORS.bold}${COLORS.green}${money(result.loan.amount)}${COLORS.reset}`);
    kv('融资利率', `${COLORS.bold}${COLORS.green}${result.loan.rate}%${COLORS.reset}`);
    kv('融资机构', result.loan.institutionName);
    kv('报价机构数', result.bids.length);
    kv('检索案例数', result.cases.length);
    kv('贷款ID', result.loan.id);
  } else {
    fail(`全链路执行失败: ${result.reason}`);
  }

  return result;
}

// ============================================================
// 场景二: 黑名单拦截
// ============================================================
function scenario2() {
  banner('场景二: 黑名单拦截 (虚假贸易企业融资被拒)', 'bg_red');

  step(1, 'SCF-S005 虚假贸易公司尝试入驻');
  info(`企业: SCF-S005 虚假贸易公司`);
  info(`状态: 已在黑名单中 (虚假贸易·发票虚开/合同造假)`);

  step(2, 'SC2 准入校验');
  const admission = SCFEngine.SC2_checkAdmission('SCF-S005');
  if (!admission.admitted) {
    fail(`准入拒绝: ${admission.reason}`);
  } else {
    ok(`准入通过 (异常)`);
  }

  step(3, '尝试执行融资流程');
  const result = SCFEngine.runFullPipeline('E001', 'SCF-S005', 'TRD-001');
  if (!result.success) {
    fail(`融资被拒: ${result.reason}`);
    ok(`系统正确拦截了黑名单企业融资尝试`);
  } else {
    warn(`融资通过 (异常 - 应被拦截)`);
  }

  step(4, '演示 5 类黑名单触发条件');
  const triggers = [
    { type: 'fake_trade', desc: '虚假贸易·发票虚开/合同造假', source: 'SC4 贸易验证失败触发' },
    { type: 'severe_overdue', desc: '严重逾期·回款逾期>90天', source: 'SC9 履约监控触发' },
    { type: 'circular_trade', desc: '关联方循环交易', source: 'B7 图欺诈检测+图谱环检测' },
    { type: 'dishonest', desc: '失信被执行人', source: 'API-04 司法查询触发' },
    { type: 'low_credit', desc: '信用分<500持续30天', source: 'SC3 信用监控触发' },
  ];

  triggers.forEach(t => {
    const testEntId = `TEST-${t.type}`;
    info(`触发条件: ${t.type}`);
    kv('描述', t.desc);
    kv('来源', t.source);
    const entry = SCFEngine.SC2_triggerBlacklist(testEntId, t.type, [`演示证据-${t.type}`]);
    if (entry) {
      ok(`已拉黑: ${entry.reason}`);
      kv('规则', entry.triggerRule);
    }
    // 清理测试数据
    const idx = State.scfDatabase.blacklist.findIndex(b => b.enterpriseId === testEntId);
    if (idx >= 0) State.scfDatabase.blacklist.splice(idx, 1);
  });

  step(5, '图谱环检测 (关联方循环交易识别)');
  const cycles = global.window.SCFGraph.detectCycles();
  if (cycles.length > 0) {
    warn(`检测到 ${cycles.length} 个循环交易:`);
    cycles.forEach((c, i) => kv(`  环 #${i + 1}`, c.join(' → ')));
  } else {
    ok(`未检测到循环交易`);
  }
}

// ============================================================
// 场景三: 风险扩散预警
// ============================================================
function scenario3() {
  banner('场景三: 风险扩散预警 (SCF-S001 经营异常)', 'bg_yellow');

  step(1, '场景设定');
  info(`事件: SCF-S001 东方钢材供应商发生经营异常`);
  info(`严重程度: 0.85 (高风险)`);

  step(2, 'SC7 风险扩散分析');
  const warning = SCFEngine.SC7_analyzeRiskDiffusion('SCF-S001', {
    description: '供应商经营异常 - 资金链紧张, 可能影响供货稳定性',
    severity: 0.85,
  });

  kv('预警级别', `${COLORS.red}${warning.level}${COLORS.reset}`);
  kv('风险源节点', warning.sourceNodeId || 'SCF-S001');
  kv('受影响节点数', `${warning.impacted.length}`);

  if (warning.impacted.length > 0) {
    console.info(`\n    ${COLORS.dim}── 受影响节点详情 ──${COLORS.reset}`);
    warning.impacted.forEach((node, i) => {
      const ent = State.getSCFEnterprise(node.enterpriseId) || { name: node.enterpriseId };
      const relLabel = { anchor: '核心企业', sibling: '同级伙伴', upstream: '上游', downstream: '下游' }[node.relationship] || node.relationship;
      kv(`  #${i + 1} ${ent.name}`, `关系: ${relLabel} | 关系强度: ${node.strength.toFixed(2)} | 影响程度: ${(node.impactScore * 100).toFixed(1)}%`);
    });

    // 计算潜在损失 (受影响节点的贸易金额总和 × 平均影响程度)
    const totalExposure = warning.impacted.reduce((sum, n) => {
      const trades = State.scfDatabase.trades.filter(t => t.partnerId === n.enterpriseId);
      const tradeVolume = trades.reduce((s, t) => s + t.amount, 0);
      return sum + tradeVolume * n.impactScore;
    }, 0);
    kv('潜在风险敞口', `${COLORS.red}${money(totalExposure)}${COLORS.reset}`);
  }

  step(3, '图算法分析');
  const centrality = global.window.SCFGraph.calcDegreeCentrality();
  info(`节点中心度排名 (Top 3):`);
  centrality.slice(0, 3).forEach((c, i) => {
    kv(`  #${i + 1}`, `${c.name} | 度=${c.degree} | 中心度=${c.centrality.toFixed(3)}`);
  });

  const connectivity = global.window.SCFGraph.analyzeConnectivity();
  kv('连通分量数', connectivity.totalComponents);
  connectivity.components.forEach(c => {
    kv(`  ${c.id}`, `规模 ${c.size} 节点`);
  });

  step(4, '风险预警已推送到引擎');
  const warnings = State.scfEngine.riskWarnings;
  ok(`已推送 ${warnings.length} 条风险预警`);
  warnings.forEach(w => {
    kv(`  [${w.level}]`, `${w.riskEvent.description} | 影响 ${w.impacted.length} 节点`);
  });
}

// ============================================================
// 场景四: 闭环回流验证
// ============================================================
function scenario4() {
  banner('场景四: 闭环回流验证 (按时还款 → 信用提升 + 案例入库)', 'bg_green');

  step(1, '前置: 执行全链路生成 loan 记录');
  State.resetSCFDatabase();
  const pipeline = SCFEngine.runFullPipeline('E001', 'SCF-S001', 'TRD-001');
  if (!pipeline.success) {
    fail('前置全链路执行失败, 无法演示闭环回流');
    return;
  }
  ok(`全链路执行成功, 生成贷款 ${pipeline.loan.id}`);
  kv('融资金额', money(pipeline.loan.amount));
  kv('融资利率', `${pipeline.loan.rate}%`);

  step(2, '记录闭环前信用分');
  const beforeEnt = JSON.parse(JSON.stringify(State.getSCFEnterprise('SCF-S001')));
  kv('闭环前独立信用分', beforeEnt.credit.ownScore);
  kv('闭环前信用历史数', beforeEnt.credit.creditHistory.length);
  const beforeCases = State.scfDatabase.cases.length;
  kv('闭环前案例库数量', beforeCases);

  step(3, 'SC9 履约监控 - 模拟按时还款完成');
  // 模拟还款完成
  const loan = State.scfDatabase.loans.find(l => l.id === pipeline.loan.id);
  if (loan) {
    loan.repaidAmount = loan.amount; // 模拟全额还款
    loan.status = 'completed';
    ok(`已模拟全额还款: ${money(loan.repaidAmount)}`);
  }

  const performance = SCFEngine.SC9_monitorPerformance('TRD-001', pipeline.loan.id);
  kv('履约状态', `${COLORS.green}${performance.status}${COLORS.reset}`);
  kv('还款进度', `${(performance.repaymentProgress * 100).toFixed(0)}%`);
  kv('逾期天数', performance.overdueDays);

  step(4, '验证闭环回流 SC9 → SC3 (信用提升)');
  const afterEnt = State.getSCFEnterprise('SCF-S001');
  kv('闭环后独立信用分', `${COLORS.green}${afterEnt.credit.ownScore}${COLORS.reset} (+${afterEnt.credit.ownScore - beforeEnt.credit.ownScore})`);
  kv('闭环后信用历史数', afterEnt.credit.creditHistory.length);

  const newHistory = afterEnt.credit.creditHistory.slice(-1)[0];
  if (newHistory) {
    kv('最新信用事件', newHistory.event);
    kv('信用变化', `+${newHistory.impact}`);
  }

  if (afterEnt.credit.ownScore > beforeEnt.credit.ownScore) {
    ok(`✓ SC9→SC3 信用回流验证通过: 信用分提升 ${afterEnt.credit.ownScore - beforeEnt.credit.ownScore} 分`);
  } else {
    fail(`SC9→SC3 信用回流验证失败: 信用分未提升`);
  }

  step(5, '验证闭环回流 SC9 → SC10 (案例入库)');
  const afterCases = State.scfDatabase.cases.length;
  kv('闭环后案例库数量', `${afterCases} (+${afterCases - beforeCases})`);

  const newCases = State.scfDatabase.cases.slice(-(afterCases - beforeCases));
  if (newCases.length > 0) {
    ok(`✓ SC9→SC10 案例入库验证通过: 新增 ${newCases.length} 个案例`);
    newCases.forEach(c => {
      kv(`  ${c.id}`, c.title);
      kv(`    行业`, c.industry);
      kv(`    产品`, c.product);
      kv(`    金额`, money(c.amount));
      kv(`    利率`, `${c.rate}%`);
      kv(`    结果`, c.outcome);
    });
  } else {
    fail(`SC9→SC10 案例入库验证失败: 无新案例`);
  }

  step(6, '验证闭环回流 SC9 → SC2 (严重逾期拉黑)');
  info(`模拟: 另一笔贷款严重逾期 (>90天)`);
  const overdueLoan = {
    id: 'LOAN-OVERDUE-001',
    amount: 500000,
    repaidAmount: 0,
    status: 'severe_overdue',
    dueDate: '2026-05-01',
    productId: 'factoring',
    productName: '保理融资',
  };
  State.scfDatabase.loans.push(overdueLoan);

  const beforeBlacklist = State.scfDatabase.blacklist.length;
  const overduePerf = SCFEngine.SC9_monitorPerformance('TRD-001', 'LOAN-OVERDUE-001');
  kv('逾期履约状态', `${COLORS.red}${overduePerf.status}${COLORS.reset}`);
  kv('逾期天数', overduePerf.overdueDays);

  const afterBlacklist = State.scfDatabase.blacklist.length;
  if (afterBlacklist > beforeBlacklist) {
    ok(`✓ SC9→SC2 闭环回流验证通过: 严重逾期触发黑名单 (+${afterBlacklist - beforeBlacklist})`);
  } else {
    fail(`SC9→SC2 闭环回流验证失败: 未触发黑名单`);
  }
}

// ============================================================
// 主流程
// ============================================================
console.info(`${COLORS.bold}${COLORS.cyan}`);
console.info('╔══════════════════════════════════════════════════════════════╗');
console.info('║   FinTrust Hub v6.0 供应链金融子系统端到端模拟演示          ║');
console.info('║   simulation-plan.md 第七章 · SC1-SC10 引擎族              ║');
console.info('╚══════════════════════════════════════════════════════════════╝');
console.info(`${COLORS.reset}`);

scenario1();
scenario2();
scenario3();
scenario4();

console.info(`\n${COLORS.bold}${COLORS.green}${'═'.repeat(60)}${COLORS.reset}`);
console.info(`${COLORS.bold}${COLORS.green}  演示完成! 4 个场景全部执行完毕${COLORS.reset}`);
console.info(`${COLORS.bold}${COLORS.green}${'═'.repeat(60)}${COLORS.reset}`);
console.info(`\n${COLORS.dim}演示覆盖:${COLORS.reset}`);
console.info(`  • 场景一: 正常保理融资全链路 (SC1→SC10)`);
console.info(`  • 场景二: 黑名单拦截 (5类触发条件+图谱环检测)`);
console.info(`  • 场景三: 风险扩散预警 (SC7+图算法分析)`);
console.info(`  • 场景四: 闭环回流 (SC9→SC3信用提升 / SC9→SC10案例入库 / SC9→SC2严重逾期拉黑)`);
