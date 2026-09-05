/**
 * test-scf-unit.js — 供应链金融子系统单元测试
 *
 * 聚焦两个核心模块的深度测试:
 *   模块A: SC2 黑白名单引擎 (5类触发条件 + 准入判定 + 申诉机制 + 去重)
 *   模块B: SC3 信用评分计算 (独立信用 + 传导信用 + 场景信用 + 闭环回流)
 *
 * 运行方式:
 *   cd c:\Users\Windws\Desktop\caiwu\jinrong\simulation
 *   node test\test-scf-unit.js
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
// 将 SCFData 设为全局变量, 使 state.js 中的 _loadSCFFromMock() 可以通过 typeof SCFData 检查
global.SCFData = global.window.SCFData;
loadFile('state.js', { MockData: global.window.MockData, SCFData: global.window.SCFData });
loadFile('scf-engine.js', { MockData: global.window.MockData, State: global.window.State, SCFData: global.window.SCFData });
loadFile('scf-graph.js', { State: global.window.State });

const State = global.window.State;
const SCFEngine = global.window.SCFEngine;

// 初始化 State (仅一次, 后续测试组使用 setup() 重置 SCF 数据库)
State.init();

// === 测试框架 ===
let passCount = 0;
let failCount = 0;
const failures = [];

// 详细日志开关 (可通过环境变量 SCF_VERBOSE=1 开启)
const VERBOSE = process.env.SCF_VERBOSE === '1' || process.env.SCF_VERBOSE === 'true';

/**
 * 关键节点日志: 用于排查黑名单触发/信用分计算等逻辑细节
 * 默认开启, 设置 SCF_QUIET=1 可关闭
 * 纯文本输出, 无 ANSI 转义码 (Windows Node 兼容)
 */
const QUIET = process.env.SCF_QUIET === '1' || process.env.SCF_QUIET === 'true';
function log(tag, message, data) {
  if (QUIET) return;
  const ts = new Date().toISOString().slice(11, 23);
  let line = '  [' + ts + '] [' + tag + '] ' + message;
  if (data !== undefined) {
    try {
      const dataStr = typeof data === 'object' ? JSON.stringify(data) : String(data);
      // 截断过长输出
      line += ' ' + (dataStr.length > 200 ? dataStr.slice(0, 200) + '...' : dataStr);
    } catch (e) {
      line += ' [unserializable]';
    }
  }
  console.info(line);
}

/** 信用分快照日志: 记录计算前后的信用分变化 */
function logCreditSnapshot(tag, entId, label) {
  const ent = State.getSCFEnterprise(entId);
  if (!ent) {
    log(tag, `${label} | 企业 ${entId} 不存在`);
    return;
  }
  log(tag, `${label} | ${ent.name}(${entId})`, {
    own: ent.credit.ownScore,
    propagated: ent.credit.propagatedScore,
    scene: ent.credit.sceneScore,
    blacklist: ent.credit.blacklistStatus,
    historyLen: ent.credit.creditHistory.length,
  });
}

/** 黑名单快照日志: 记录触发前后的黑名单状态 */
function logBlacklistSnapshot(tag, label) {
  const list = State.scfDatabase.blacklist;
  log(tag, `${label} | 黑名单数量=${list.length}`, list.map(b => ({
    id: b.enterpriseId,
    name: b.enterpriseName,
    reason: b.reason,
    rule: b.triggerRule,
    appeal: b.appealStatus,
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

function assertApprox(actual, expected, tolerance, message) {
  const diff = Math.abs(actual - expected);
  assert(diff <= tolerance, message + ' (期望: ' + expected + '±' + tolerance + ', 实际: ' + actual + ', 差值: ' + diff + ')');
}

function testGroup(name, fn) {
  console.info('\n=== ' + name + ' ===');
  fn();
}

function setup() {
  // 只重置 SCF 数据库, 不调用 State.init() 避免从 localStorage 恢复污染数据
  State.resetSCFDatabase();
}

// ============================================================
// 模块A: SC2 黑白名单引擎单元测试
// ============================================================

testGroup('A1: SC2 黑名单基础功能 - addToBlacklist', () => {
  setup();

  // 测试1: 正常添加黑名单
  const entry = SCFEngine.SC2_addToBlacklist('SCF-S001', '测试原因', ['证据1', '证据2'], '测试规则');
  assert(entry !== null, 'addToBlacklist 返回非 null');
  assertEqual(entry.enterpriseId, 'SCF-S001', '黑名单条目 enterpriseId 正确');
  assertEqual(entry.reason, '测试原因', '黑名单条目 reason 正确');
  assertEqual(entry.triggerRule, '测试规则', '黑名单条目 triggerRule 正确');
  assertEqual(entry.evidence.length, 2, '黑名单条目 evidence 数量=2');
  assertEqual(entry.appealStatus, 'none', '黑名单条目初始 appealStatus=none');
  assertEqual(entry.blacklistedBy, 'SC2引擎自动', '黑名单条目 blacklistedBy 正确');

  // 验证已写入数据库
  const inDb = State.scfDatabase.blacklist.find(b => b.enterpriseId === 'SCF-S001');
  assert(inDb !== undefined, '黑名单条目已写入数据库');

  // 验证企业状态已更新
  const ent = State.getSCFEnterprise('SCF-S001');
  assertEqual(ent.credit.blacklistStatus, 'blacklist', '企业 credit.blacklistStatus 已更新为 blacklist');

  // 清理
  State.scfDatabase.blacklist = State.scfDatabase.blacklist.filter(b => b.enterpriseId !== 'SCF-S001');
  ent.credit.blacklistStatus = 'none';
});

testGroup('A2: SC2 黑名单去重 - 同一企业不重复拉黑', () => {
  setup();

  // 第一次拉黑
  SCFEngine.SC2_addToBlacklist('SCF-S002', '第一次拉黑', ['证据1'], '规则1');
  const countAfter1 = State.scfDatabase.blacklist.filter(b => b.enterpriseId === 'SCF-S002').length;
  assertEqual(countAfter1, 1, '第一次拉黑后黑名单中该企业数量=1');

  // 第二次拉黑同一企业 (应被去重)
  SCFEngine.SC2_addToBlacklist('SCF-S002', '第二次拉黑', ['证据2'], '规则2');
  const countAfter2 = State.scfDatabase.blacklist.filter(b => b.enterpriseId === 'SCF-S002').length;
  assertEqual(countAfter2, 1, '第二次拉黑后黑名单中该企业数量仍=1 (去重生效)');

  // 清理
  State.scfDatabase.blacklist = State.scfDatabase.blacklist.filter(b => b.enterpriseId !== 'SCF-S002');
});

testGroup('A3: SC2 黑名单查询 - checkBlacklist', () => {
  setup();

  // 测试已存在的黑名单企业
  const blacklisted = SCFEngine.SC2_checkBlacklist('SCF-S005');
  assert(blacklisted !== null && blacklisted !== undefined, 'SCF-S005 (预置黑名单) 查询返回非 null');
  assert(blacklisted.reason.includes('虚假贸易'), 'SCF-S005 黑名单原因包含"虚假贸易"');

  // 测试不在黑名单的企业 (Array.find 找不到时返回 undefined, 不是 null)
  const clean = SCFEngine.SC2_checkBlacklist('SCF-S001');
  assert(!clean, 'SCF-S001 (未拉黑) 查询返回 null/undefined');

  // 测试不存在的企业ID
  const notExist = SCFEngine.SC2_checkBlacklist('NON-EXISTENT');
  assert(!notExist, '不存在的企业ID查询返回 null/undefined');
});

testGroup('A4: SC2 5类触发条件 - triggerBlacklist', () => {
  setup();
  logBlacklistSnapshot('A4-START', '触发前黑名单状态');

  const triggerTypes = [
    { type: 'fake_trade', desc: '虚假贸易·发票虚开/合同造假', expectedReason: '虚假贸易', expectedRule: 'SC2-规则1', expectedSource: 'SC4' },
    { type: 'severe_overdue', desc: '严重逾期·回款逾期>90天', expectedReason: '严重逾期', expectedRule: 'SC2-规则2', expectedSource: 'SC9' },
    { type: 'circular_trade', desc: '关联方循环交易', expectedReason: '循环交易', expectedRule: 'SC2-规则3', expectedSource: 'B7' },
    { type: 'dishonest', desc: '失信被执行人', expectedReason: '失信', expectedRule: 'SC2-规则4', expectedSource: 'API-04' },
    { type: 'low_credit', desc: '信用分<500持续30天', expectedReason: '信用分', expectedRule: 'SC2-规则5', expectedSource: 'SC3' },
  ];

  triggerTypes.forEach((t, idx) => {
    const testEntId = `TEST-A4-${idx + 1}`;
    log('A4-TRIGGER', `▶ 触发条件 #${idx + 1}: ${t.type}`, { entId: testEntId, desc: t.desc });

    const beforeCount = State.scfDatabase.blacklist.length;
    const entry = SCFEngine.SC2_triggerBlacklist(testEntId, t.type, [`演示证据-${t.type}`]);
    const afterCount = State.scfDatabase.blacklist.length;

    log('A4-TRIGGER', `◀ 触发结果: 黑名单 ${beforeCount}→${afterCount}`, {
      entId: entry ? entry.enterpriseId : null,
      reason: entry ? entry.reason : null,
      rule: entry ? entry.triggerRule : null,
      evidence: entry ? entry.evidence : null,
    });

    assert(entry !== null, `触发条件 ${t.type} 返回非 null`);
    assert(entry.reason.includes(t.expectedReason), `${t.type} 原因包含"${t.expectedReason}"`);
    assert(entry.triggerRule.includes(t.expectedRule), `${t.type} 规则包含"${t.expectedRule}"`);
    assert(entry.triggerRule.includes(t.expectedSource), `${t.type} 规则包含"${t.expectedSource}" (来源)`);

    // 清理测试数据
    State.scfDatabase.blacklist = State.scfDatabase.blacklist.filter(b => b.enterpriseId !== testEntId);
  });

  // 测试无效触发类型
  log('A4-TRIGGER', `▶ 测试无效触发类型: invalid_type`);
  const invalid = SCFEngine.SC2_triggerBlacklist('TEST-A4-INVALID', 'invalid_type', ['无效']);
  log('A4-TRIGGER', `◀ 无效触发结果: ${invalid === null ? 'null (符合预期)' : '非null (异常)'}`);
  assert(invalid === null, '无效触发类型返回 null');

  logBlacklistSnapshot('A4-END', '触发后黑名单状态 (已清理测试数据)');
});

testGroup('A5: SC2 准入判定 - checkAdmission (4种通道)', () => {
  setup();

  // 通道1: 白名单优先 (白名单企业直接通过)
  SCFEngine.SC2_addToWhitelist('SCF-S001', '优质合作伙伴');
  const whitelistResult = SCFEngine.SC2_checkAdmission('SCF-S001');
  assert(whitelistResult.admitted, '白名单企业准入通过');
  assertEqual(whitelistResult.channel, 'whitelist', '白名单企业 channel=whitelist');
  assert(whitelistResult.reason.includes('白名单'), '白名单企业 reason 包含"白名单"');
  // 清理白名单
  State.scfDatabase.whitelist = State.scfDatabase.whitelist.filter(w => w.enterpriseId !== 'SCF-S001');

  // 通道2: 黑名单拒绝
  const blacklistResult = SCFEngine.SC2_checkAdmission('SCF-S005');
  assert(!blacklistResult.admitted, '黑名单企业准入拒绝');
  assertEqual(blacklistResult.channel, 'blacklist', '黑名单企业 channel=blacklist');
  assert(blacklistResult.reason.includes('黑名单'), '黑名单企业 reason 包含"黑名单"');

  // 通道3: 信用分不足拒绝
  // 找一个信用分<600的企业 (或临时修改)
  const lowCreditEnt = State.scfDatabase.enterprises.find(e => e.credit.ownScore < 600);
  if (lowCreditEnt) {
    const creditResult = SCFEngine.SC2_checkAdmission(lowCreditEnt.id);
    assert(!creditResult.admitted, `低信用企业 ${lowCreditEnt.id} 准入拒绝`);
    assertEqual(creditResult.channel, 'credit_threshold', '低信用企业 channel=credit_threshold');
    assert(creditResult.reason.includes('信用分不足'), '低信用企业 reason 包含"信用分不足"');
  } else {
    // 手动构造低信用场景
    const ent = State.getSCFEnterprise('SCF-S001');
    const originalScore = ent.credit.ownScore;
    ent.credit.ownScore = 550;
    const creditResult = SCFEngine.SC2_checkAdmission('SCF-S001');
    assert(!creditResult.admitted, '临时低信用(550)企业准入拒绝');
    assertEqual(creditResult.channel, 'credit_threshold', '低信用企业 channel=credit_threshold');
    ent.credit.ownScore = originalScore; // 恢复
  }

  // 通道4: 信用分达标通过
  const normalResult = SCFEngine.SC2_checkAdmission('SCF-S001');
  assert(normalResult.admitted, '正常信用企业 SCF-S001 准入通过');
  assertEqual(normalResult.channel, 'credit_threshold', '正常企业 channel=credit_threshold');
  assert(normalResult.reason.includes('信用分达标'), '正常企业 reason 包含"信用分达标"');

  // 通道5: 企业不存在
  const notExistResult = SCFEngine.SC2_checkAdmission('NON-EXISTENT');
  assert(!notExistResult.admitted, '不存在企业准入拒绝');
  assertEqual(notExistResult.channel, 'not_found', '不存在企业 channel=not_found');
});

testGroup('A6: SC2 黑名单申诉机制 - appealBlacklist', () => {
  setup();

  // 对已拉黑企业发起申诉
  const entry = SCFEngine.SC2_appealBlacklist('SCF-S005', '贸易真实, 发票可验证');
  assert(entry !== null, '申诉返回非 null');
  assertEqual(entry.appealStatus, 'pending', '申诉后 appealStatus=pending');
  assertEqual(entry.appealReason, '贸易真实, 发票可验证', '申诉理由已记录');

  // 对未拉黑企业发起申诉 (应返回 null/undefined)
  const noEntry = SCFEngine.SC2_appealBlacklist('SCF-S001', '测试申诉');
  assert(!noEntry, '未拉黑企业申诉返回 null/undefined');
});

testGroup('A7: SC2 白名单管理 - addToWhitelist', () => {
  setup();

  // 添加白名单
  const entry = SCFEngine.SC2_addToWhitelist('SCF-S002', '战略合作伙伴');
  assert(entry !== null, 'addToWhitelist 返回非 null');
  assertEqual(entry.enterpriseId, 'SCF-S002', '白名单条目 enterpriseId 正确');
  assertEqual(entry.reason, '战略合作伙伴', '白名单条目 reason 正确');
  assertEqual(entry.type, 'whitelist', '白名单条目 type=whitelist');

  // 验证已写入数据库
  const inDb = State.scfDatabase.whitelist.find(w => w.enterpriseId === 'SCF-S002');
  assert(inDb !== undefined, '白名单条目已写入数据库');

  // 验证白名单优先级 > 黑名单 (即使企业在黑名单中, 白名单也优先)
  SCFEngine.SC2_addToBlacklist('SCF-S002', '测试黑名单', ['证据'], '测试规则');
  const admission = SCFEngine.SC2_checkAdmission('SCF-S002');
  assert(admission.admitted, '白名单优先级 > 黑名单: 同时在黑白名单中, 准入通过');
  assertEqual(admission.channel, 'whitelist', '白名单优先: channel=whitelist');

  // 清理
  State.scfDatabase.whitelist = State.scfDatabase.whitelist.filter(w => w.enterpriseId !== 'SCF-S002');
  State.scfDatabase.blacklist = State.scfDatabase.blacklist.filter(b => b.enterpriseId !== 'SCF-S002');
});

testGroup('A8: SC2 闭环触发 - SC4虚假贸易→SC2拉黑', () => {
  setup();
  logBlacklistSnapshot('A8-START', 'SC4验证前黑名单状态');

  // 找一条验证失败的贸易 (或构造一条)
  const trade = State.scfDatabase.trades.find(t => t.id === 'TRD-001');
  const originalVerification = JSON.parse(JSON.stringify(trade.verification));
  log('A8-SETUP', `贸易 ${trade.id} 原始验证状态`, { partner: trade.partnerId, amount: trade.amount });

  // 构造虚假贸易场景 (基础五流通过≤1)
  log('A8-SETUP', `▶ 构造虚假贸易场景: 五流全部失败`);
  trade.verification = {
    contract: { passed: false },
    invoice: { passed: false },
    logistics: { passed: false },
    fund: { passed: false },
    iot: { passed: false },
    poInvoiceMatch: { passed: false },
    logisticsContractMatch: { passed: false }
  };

  const beforeBlacklist = State.scfDatabase.blacklist.length;
  log('A8-VERIFY', `▶ 调用 SC4_verifyTrade('${trade.id}')`);
  const result = SCFEngine.SC4_verifyTrade('TRD-001');
  const afterBlacklist = State.scfDatabase.blacklist.length;
  log('A8-VERIFY', `◀ SC4验证结果`, { level: result.level, basePassed: result.basePassed, baseTotal: result.baseTotal });
  log('A8-VERIFY', `◀ 黑名单变化: ${beforeBlacklist}→${afterBlacklist} (新增${afterBlacklist - beforeBlacklist}条)`);

  // 查看新增的黑名单条目
  if (afterBlacklist > beforeBlacklist) {
    const newEntry = State.scfDatabase.blacklist[afterBlacklist - 1];
    log('A8-CLOSED-LOOP', `SC4→SC2 闭环触发详情`, { entId: newEntry.enterpriseId, reason: newEntry.reason, rule: newEntry.triggerRule });
  }

  assertEqual(result.level, 'unverified', '虚假贸易验证等级=unverified');
  assertEqual(result.basePassed, 0, '虚假贸易基础五流通过=0');
  assert(afterBlacklist > beforeBlacklist, `SC4→SC2 闭环触发: 黑名单数量增加 (${beforeBlacklist}→${afterBlacklist})`);

  // 恢复贸易数据
  log('A8-CLEANUP', `恢复贸易 ${trade.id} 原始验证状态, 清理测试黑名单`);
  trade.verification = originalVerification;
  State.scfDatabase.blacklist = State.scfDatabase.blacklist.slice(0, beforeBlacklist);
  logBlacklistSnapshot('A8-END', '清理后黑名单状态');
});

// ============================================================
// 模块B: SC3 信用评分计算单元测试
// ============================================================

testGroup('B1: SC3 独立信用分 - 基础读取', () => {
  setup();

  const ent = State.getSCFEnterprise('SCF-S001');
  assert(ent !== null, 'SCF-S001 企业存在');
  assertEqual(ent.credit.ownScore, 680, 'SCF-S001 独立信用分=680');

  const ent2 = State.getSCFEnterprise('SCF-S002');
  assert(ent2 !== null, 'SCF-S002 企业存在');
  assertEqual(ent2.credit.ownScore, 640, 'SCF-S002 独立信用分=640');
});

testGroup('B2: SC3 传导信用分 - 公式验证', () => {
  setup();
  logCreditSnapshot('B2-START', 'SCF-S001', '传导计算前');

  log('B2-CALC', `▶ 调用 SC3_calculateTransmittedCredit('E001', 'SCF-S001')`);
  const result = SCFEngine.SC3_calculateTransmittedCredit('E001', 'SCF-S001');
  log('B2-CALC', `◀ 传导计算结果`, {
    originalScore: result.originalScore,
    anchorScore: result.anchorScore,
    stabilityFactor: result.stabilityFactor,
    cooperationBonus: result.cooperationBonus,
    transmittedScore: result.transmittedScore,
    improvement: result.improvement,
  });

  // 公式分解日志
  const part1 = result.originalScore * 0.5;
  const part2 = result.anchorScore * 0.3 * result.stabilityFactor;
  const part3 = result.cooperationBonus * 0.2;
  log('B2-FORMULA', `公式分解: 传导分 = 基础×0.5 + 核心×0.3×稳定系数 + 加成×0.2`, {
    '基础×0.5': part1,
    '核心×0.3×稳定系数': part2,
    '加成×0.2': part3,
    '合计': part1 + part2 + part3,
    '实际传导分': result.transmittedScore,
  });

  assert(result !== null, '传导信用分计算返回非 null');

  // 公式: 传导分 = 基础分×0.5 + 核心企业分×0.3×稳定系数 + 历史交易加成×0.2
  const expectedMin = result.originalScore * 0.5;
  const expectedMax = result.originalScore * 0.5 + 850 * 0.3 * 1.0 + 50 * 0.2;
  assert(result.transmittedScore >= expectedMin, `传导分≥基础分×0.5 (传导: ${result.transmittedScore}, 下界: ${expectedMin})`);
  assert(result.transmittedScore <= 850, `传导分≤850 (实际: ${result.transmittedScore})`);
  assert(result.transmittedScore <= expectedMax, `传导分≤理论上界 (传导: ${result.transmittedScore}, 上界: ${expectedMax})`);

  // 验证稳定系数范围 (0-1)
  assert(result.stabilityFactor >= 0 && result.stabilityFactor <= 1, `稳定系数在0-1范围内 (实际: ${result.stabilityFactor})`);

  // 验证合作加成范围 (0-50)
  assert(result.cooperationBonus >= 0 && result.cooperationBonus <= 50, `合作加成在0-50范围内 (实际: ${result.cooperationBonus})`);

  // 验证传导记录已写入数据库
  const records = State.scfDatabase.creditPropagation.filter(r => r.partnerId === 'SCF-S001');
  log('B2-PERSIST', `传导记录已写入 creditPropagation: ${records.length} 条`);
  assert(records.length > 0, '传导记录已写入 creditPropagation');

  // 验证企业传导信用分已更新
  logCreditSnapshot('B2-END', 'SCF-S001', '传导计算后');
  const ent = State.getSCFEnterprise('SCF-S001');
  assertEqual(ent.credit.propagatedScore, result.transmittedScore, '企业 credit.propagatedScore 已更新');
});

testGroup('B3: SC3 传导信用分 - 稳定系数计算', () => {
  setup();

  // _calcStabilityFactor 公式: min(1, (years/5)*0.4 + stability*0.6)
  // SCF-S001 与 E001 关系: cooperationYears=3, tradeStability=0.85
  // 期望: min(1, (3/5)*0.4 + 0.85*0.6) = min(1, 0.24 + 0.51) = 0.75
  const rel = State.scfDatabase.relationships.find(r => r.anchorId === 'E001' && r.partnerId === 'SCF-S001');
  assert(rel !== undefined, 'SCF-S001 与 E001 关系存在');
  assertEqual(rel.strength.cooperationYears, 3, '合作年限=3');
  assertEqual(rel.strength.tradeStability, 0.85, '贸易稳定性=0.85');

  const stabilityFactor = SCFEngine._calcStabilityFactor(rel);
  assertApprox(stabilityFactor, 0.75, 0.001, `稳定系数=0.75 (公式: (3/5)*0.4 + 0.85*0.6)`);

  // 测试边界: 5年合作 + 1.0稳定性 → 系数=1.0
  const maxRel = { strength: { cooperationYears: 5, tradeStability: 1.0 } };
  const maxFactor = SCFEngine._calcStabilityFactor(maxRel);
  assertApprox(maxFactor, 1.0, 0.001, '5年合作+1.0稳定性 → 系数=1.0');

  // 测试边界: 0年合作 + 0稳定性 → 系数=0
  const minRel = { strength: { cooperationYears: 0, tradeStability: 0 } };
  const minFactor = SCFEngine._calcStabilityFactor(minRel);
  assertApprox(minFactor, 0, 0.001, '0年合作+0稳定性 → 系数=0');
});

testGroup('B4: SC3 传导信用分 - 合作加成计算', () => {
  setup();

  // _calcCooperationBonus 公式: min(50, round(anchorCredit * 0.15 * volumeFactor * yearFactor))
  // E001 信用分=720, contractValue=12000000, years=3
  // volumeFactor = min(1, 12000000/10000000) = 1.0
  // yearFactor = min(1, 3/5) = 0.6
  // 期望: min(50, round(720 * 0.15 * 1.0 * 0.6)) = min(50, round(64.8)) = min(50, 65) = 50
  const bonus = SCFEngine._calcCooperationBonus(720, 12000000, 3);
  assertEqual(bonus, 50, `合作加成=50 (公式: min(50, 720*0.15*1.0*0.6)=min(50,65)=50)`);

  // 测试小额合同
  const smallBonus = SCFEngine._calcCooperationBonus(600, 1000000, 1);
  // volumeFactor = min(1, 1000000/10000000) = 0.1
  // yearFactor = min(1, 1/5) = 0.2
  // 期望: min(50, round(600 * 0.15 * 0.1 * 0.2)) = min(50, round(1.8)) = min(50, 2) = 2
  assertEqual(smallBonus, 2, `小额合同合作加成=2 (公式: 600*0.15*0.1*0.2=1.8→2)`);
});

testGroup('B5: SC3 场景信用分 - 三种验证等级', () => {
  setup();

  const transmittedScore = 600;

  // verified: 场景分 = 600 * 1.0 + coverage * 0.2 * 100
  const verifiedScore = SCFEngine.SC3_calculateSceneCredit(transmittedScore, 'verified', 0.8);
  const expectedVerified = Math.round(600 * 1.0 + 0.8 * 0.2 * 100);
  assertEqual(verifiedScore, expectedVerified, `verified 场景分=${expectedVerified} (600*1.0 + 80*0.2)`);

  // partial: 场景分 = 600 * 0.7 + coverage * 0.2 * 100
  const partialScore = SCFEngine.SC3_calculateSceneCredit(transmittedScore, 'partial', 0.8);
  const expectedPartial = Math.round(600 * 0.7 + 0.8 * 0.2 * 100);
  assertEqual(partialScore, expectedPartial, `partial 场景分=${expectedPartial} (600*0.7 + 80*0.2)`);

  // unverified: 场景分 = 600 * 0.3 + coverage * 0.2 * 100
  const unverifiedScore = SCFEngine.SC3_calculateSceneCredit(transmittedScore, 'unverified', 0.8);
  const expectedUnverified = Math.round(600 * 0.3 + 0.8 * 0.2 * 100);
  assertEqual(unverifiedScore, expectedUnverified, `unverified 场景分=${expectedUnverified} (600*0.3 + 80*0.2)`);

  // 验证: verified > partial > unverified (相同传导分和押品覆盖率)
  assert(verifiedScore > partialScore, `verified场景分(${verifiedScore}) > partial场景分(${partialScore})`);
  assert(partialScore > unverifiedScore, `partial场景分(${partialScore}) > unverified场景分(${unverifiedScore})`);

  // 测试押品覆盖率为0
  const noCollateral = SCFEngine.SC3_calculateSceneCredit(transmittedScore, 'verified', 0);
  assertEqual(noCollateral, 600, '押品覆盖率=0时 verified场景分=传导分*1.0');
});

testGroup('B6: SC3 闭环回流 - 按时还款信用提升', () => {
  setup();
  logCreditSnapshot('B6-START', 'SCF-S001', '全链路执行前');

  // 先执行全链路生成 loan
  log('B6-PIPELINE', `▶ 调用 runFullPipeline('E001', 'SCF-S001', 'TRD-001')`);
  const pipeline = SCFEngine.runFullPipeline('E001', 'SCF-S001', 'TRD-001');
  log('B6-PIPELINE', `◀ 全链路结果`, { success: pipeline.success, loanId: pipeline.loan ? pipeline.loan.id : null, amount: pipeline.loan ? pipeline.loan.amount : null });
  assert(pipeline.success, '全链路执行成功 (准备闭环测试)');

  logCreditSnapshot('B6-BEFORE-REPAY', 'SCF-S001', '还款前');
  const beforeScore = State.getSCFEnterprise('SCF-S001').credit.ownScore;
  const beforeHistoryLen = State.getSCFEnterprise('SCF-S001').credit.creditHistory.length;
  log('B6-METRICS', `还款前指标`, { score: beforeScore, historyLen: beforeHistoryLen });

  // 模拟按时还款
  const loan = State.scfDatabase.loans.find(l => l.id === pipeline.loan.id);
  log('B6-REPAY', `▶ 模拟全额还款`, { loanId: loan.id, amount: loan.amount, beforeStatus: loan.status });
  loan.repaidAmount = loan.amount;
  loan.status = 'completed';

  log('B6-SC9', `▶ 调用 SC9_monitorPerformance('TRD-001', '${pipeline.loan.id}')`);
  const performance = SCFEngine.SC9_monitorPerformance('TRD-001', pipeline.loan.id);
  log('B6-SC9', `◀ SC9 履约监控结果`, { status: performance.status, repaymentProgress: performance.repaymentProgress, overdueDays: performance.overdueDays });
  assertEqual(performance.status, 'completed', '履约状态=completed');

  logCreditSnapshot('B6-AFTER-REPAY', 'SCF-S001', '还款后');
  const afterScore = State.getSCFEnterprise('SCF-S001').credit.ownScore;
  const afterHistoryLen = State.getSCFEnterprise('SCF-S001').credit.creditHistory.length;
  log('B6-METRICS', `还款后指标`, { score: afterScore, historyLen: afterHistoryLen, scoreDelta: afterScore - beforeScore, historyDelta: afterHistoryLen - beforeHistoryLen });

  // 验证信用分提升 +5
  log('B6-ASSERT', `验证信用分提升: ${beforeScore} + 5 = ${beforeScore + 5} (实际: ${afterScore})`);
  assertEqual(afterScore, beforeScore + 5, `SC9→SC3 信用回流: 信用分+5 (${beforeScore}→${afterScore})`);

  // 验证信用历史新增一条
  assertEqual(afterHistoryLen, beforeHistoryLen + 1, `信用历史新增1条 (${beforeHistoryLen}→${afterHistoryLen})`);

  // 验证最新信用事件内容
  const latestHistory = State.getSCFEnterprise('SCF-S001').credit.creditHistory[afterHistoryLen - 1];
  log('B6-HISTORY', `最新信用事件`, latestHistory);
  assert(latestHistory.event.includes('按时还款'), '最新信用事件包含"按时还款"');
  assertEqual(latestHistory.impact, 5, '信用事件 impact=5');

  // 验证不超过上限850
  log('B6-CEILING', `▶ 连续40次信用提升, 验证上限850`);
  for (let i = 0; i < 40; i++) {
    SCFEngine._feedbackCreditImprovement('SCF-S001', 5);
  }
  const finalScore = State.getSCFEnterprise('SCF-S001').credit.ownScore;
  log('B6-CEILING', `◀ 连续提升后信用分: ${finalScore} (上限850)`);
  logCreditSnapshot('B6-END', 'SCF-S001', '连续提升后');
  assertEqual(finalScore, 850, `连续信用提升后不超过上限850 (实际: ${finalScore})`);
});

testGroup('B7: SC3 闭环回流 - 严重逾期触发黑名单', () => {
  setup();
  logCreditSnapshot('B7-START', 'SCF-S001', '全链路执行前');
  logBlacklistSnapshot('B7-START', '全链路执行前黑名单');

  // 执行全链路生成 loan
  const pipeline = SCFEngine.runFullPipeline('E001', 'SCF-S001', 'TRD-001');
  log('B7-PIPELINE', `全链路执行`, { success: pipeline.success, loanId: pipeline.loan.id });
  const loan = State.scfDatabase.loans.find(l => l.id === pipeline.loan.id);

  // 模拟严重逾期 (>90天)
  log('B7-SETUP', `▶ 构造严重逾期场景`, { loanId: loan.id, originalStatus: loan.status, originalDueDate: loan.dueDate });
  loan.repaidAmount = 0;
  loan.status = 'severe_overdue';
  loan.dueDate = '2026-05-01'; // 逾期>90天

  const beforeBlacklist = State.scfDatabase.blacklist.length;
  logBlacklistSnapshot('B7-BEFORE-SC9', 'SC9监控前黑名单');

  log('B7-SC9', `▶ 调用 SC9_monitorPerformance (严重逾期场景)`);
  const performance = SCFEngine.SC9_monitorPerformance('TRD-001', pipeline.loan.id);
  const afterBlacklist = State.scfDatabase.blacklist.length;
  log('B7-SC9', `◀ SC9 履约监控结果`, { status: performance.status, overdueDays: performance.overdueDays });
  log('B7-SC9', `◀ 黑名单变化: ${beforeBlacklist}→${afterBlacklist}`);

  assertEqual(performance.status, 'severe_overdue', '履约状态=severe_overdue');
  assert(performance.overdueDays > 90, `逾期天数>90 (实际: ${performance.overdueDays})`);
  assert(afterBlacklist > beforeBlacklist, `SC9→SC2 闭环触发: 黑名单数量增加 (${beforeBlacklist}→${afterBlacklist})`);

  // 验证黑名单条目内容
  const newEntry = State.scfDatabase.blacklist[afterBlacklist - 1];
  log('B7-CLOSED-LOOP', `SC9→SC2 闭环触发详情`, { entId: newEntry.enterpriseId, reason: newEntry.reason, rule: newEntry.triggerRule });
  logBlacklistSnapshot('B7-END', 'SC9监控后黑名单');
  logCreditSnapshot('B7-END', 'SCF-S001', 'SC9监控后');

  assert(newEntry.enterpriseId === 'SCF-S001', '黑名单条目为 SCF-S001');
  assert(newEntry.reason.includes('严重逾期'), '黑名单原因包含"严重逾期"');
  assert(newEntry.triggerRule.includes('SC2-规则2'), '黑名单规则包含"SC2-规则2"');
});

testGroup('B8: SC3 信用分阈值边界测试', () => {
  setup();

  // 测试信用分=599 (低于600阈值, 应被拒绝准入)
  const ent = State.getSCFEnterprise('SCF-S001');
  const originalScore = ent.credit.ownScore;

  ent.credit.ownScore = 599;
  const result599 = SCFEngine.SC2_checkAdmission('SCF-S001');
  assert(!result599.admitted, '信用分599 准入拒绝 (<600)');

  // 测试信用分=600 (等于阈值, 应通过)
  ent.credit.ownScore = 600;
  const result600 = SCFEngine.SC2_checkAdmission('SCF-S001');
  assert(result600.admitted, '信用分600 准入通过 (=600)');

  // 测试信用分=601 (高于阈值, 应通过)
  ent.credit.ownScore = 601;
  const result601 = SCFEngine.SC2_checkAdmission('SCF-S001');
  assert(result601.admitted, '信用分601 准入通过 (>600)');

  // 恢复
  ent.credit.ownScore = originalScore;
});

testGroup('B9: SC3 传导信用分 - 不同核心企业对比', () => {
  setup();

  // 验证: 同一供应商对不同核心企业的传导分不同
  // SCF-S001 与 E001 关系: cooperationYears=3, tradeStability=0.85
  const resultE001 = SCFEngine.SC3_calculateTransmittedCredit('E001', 'SCF-S001');

  // 如果存在其他核心企业关系, 验证传导分差异
  const otherRels = State.scfDatabase.relationships.filter(r => r.partnerId === 'SCF-S001' && r.anchorId !== 'E001');
  if (otherRels.length > 0) {
    const resultOther = SCFEngine.SC3_calculateTransmittedCredit(otherRels[0].anchorId, 'SCF-S001');
    assert(resultOther !== null, `SCF-S001 对 ${otherRels[0].anchorId} 传导分计算成功`);
    // 传导分应该不同 (因为稳定系数和合作加成不同)
    assert(resultE001.transmittedScore !== resultOther.transmittedScore || resultE001.anchorScore !== resultOther.anchorScore, '不同核心企业传导分或基础分不同');
  }

  // 验证: 不存在的关系返回 null
  const noRel = SCFEngine.SC3_calculateTransmittedCredit('NON-EXIST', 'SCF-S001');
  assert(noRel === null, '不存在的关系传导分返回 null');
});

testGroup('B10: SC3 信用历史记录完整性', () => {
  setup();

  const ent = State.getSCFEnterprise('SCF-S001');
  const initialHistoryLen = ent.credit.creditHistory.length;

  // 触发信用提升
  SCFEngine._feedbackCreditImprovement('SCF-S001', 10);

  const afterEnt = State.getSCFEnterprise('SCF-S001');
  assertEqual(afterEnt.credit.creditHistory.length, initialHistoryLen + 1, '信用历史新增1条');

  const newRecord = afterEnt.credit.creditHistory[afterEnt.credit.creditHistory.length - 1];
  assert(newRecord.date !== undefined, '信用历史记录包含 date');
  assert(newRecord.event !== undefined, '信用历史记录包含 event');
  assert(newRecord.event.includes('10'), '信用历史 event 包含提升分数');
  assertEqual(newRecord.impact, 10, '信用历史 impact=10');

  // 验证日期格式 (YYYY-MM-DD)
  assert(/^\d{4}-\d{2}-\d{2}$/.test(newRecord.date), `信用历史日期格式正确 (实际: ${newRecord.date})`);

  // 验证不存在企业不报错
  SCFEngine._feedbackCreditImprovement('NON-EXIST', 10); // 不应抛出异常
  assert(true, '不存在企业的信用提升不抛出异常');
});

// ============================================================
// 测试结果汇总
// ============================================================
console.info('\n═══════════════════════════════════════════════════');
console.info(`📊 SCF 单元测试结果: ✅ ${passCount} 通过 / ❌ ${failCount} 失败`);
console.info('═══════════════════════════════════════════════════');
if (failures.length > 0) {
  console.info('\n失败项:');
  failures.forEach(f => console.info(`  ❌ ${f}`));
  process.exit(1);
} else {
  console.info('\n🎉 所有单元测试通过! 黑白名单触发和信用评分计算逻辑验证完整。');
  console.info('\n测试覆盖:');
  console.info('  模块A: SC2 黑白名单引擎 (8个测试组)');
  console.info('    A1: addToBlacklist 基础功能');
  console.info('    A2: 黑名单去重');
  console.info('    A3: checkBlacklist 查询');
  console.info('    A4: 5类触发条件 (fake_trade/severe_overdue/circular_trade/dishonest/low_credit)');
  console.info('    A5: checkAdmission 4种通道 (白名单/黑名单/信用阈值/不存在)');
  console.info('    A6: appealBlacklist 申诉机制');
  console.info('    A7: addToWhitelist + 白名单优先级');
  console.info('    A8: SC4→SC2 闭环触发');
  console.info('  模块B: SC3 信用评分计算 (10个测试组)');
  console.info('    B1: 独立信用分基础读取');
  console.info('    B2: 传导信用分公式验证');
  console.info('    B3: 稳定系数计算 (含边界)');
  console.info('    B4: 合作加成计算');
  console.info('    B5: 场景信用分三种验证等级');
  console.info('    B6: 闭环回流-按时还款信用提升 (含上限850)');
  console.info('    B7: 闭环回流-严重逾期触发黑名单');
  console.info('    B8: 信用分阈值边界测试 (599/600/601)');
  console.info('    B9: 不同核心企业传导分对比');
  console.info('    B10: 信用历史记录完整性');
  process.exit(0);
}
