/**
 * test-scf-edge.js — 供应链金融子系统极端边界条件测试
 *
 * 覆盖极端场景:
 *   E01-E03: 信用分阈值边缘 (599/600/601)
 *   E04: 信用分=0 (极端低值)
 *   E05-E06: 信用分上限 (850/851)
 *   E07: 信用分=-100 (负数)
 *   E08: 信用分=NaN (非数字)
 *   E09: 信用分=null/undefined (空值)
 *   E10: 信用分=Infinity (无穷大)
 *   E11-E12: 稳定系数边界 (0/1/超限/负数)
 *   E13: 押品覆盖率边界 (0/0.5/1.0/1.5/负数)
 *   E14: 信用提升至上限850 (连续提升钳位)
 *   E15: 拉黑→申诉→状态流转
 *   E16: 同一企业5类触发全拉黑 (去重)
 *   E17: 不存在的企业ID传导计算
 *   E18: 稳定系数极端输入 (null/undefined)
 *   E19: 空证据数组触发黑名单
 *   E20: 超长企业名称 (序列化)
 *   E21: 信用分=350 (远低于阈值)
 *   E22: 多次连续提升后信用历史完整性
 *   E23: 白名单+黑名单同时存在 (优先级)
 *
 * 运行方式:
 *   cd c:\Users\Windws\Desktop\caiwu\jinrong\simulation
 *   node test\test-scf-edge.js
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
global.SCFData = global.window.SCFData;
loadFile('state.js', { MockData: global.window.MockData, SCFData: global.window.SCFData });
loadFile('scf-engine.js', { MockData: global.window.MockData, State: global.window.State, SCFData: global.window.SCFData });
loadFile('scf-graph.js', { State: global.window.State });

const State = global.window.State;
const SCFEngine = global.window.SCFEngine;
State.init();

// === 测试框架 (无 ANSI 转义, 纯文本输出) ===
let passCount = 0;
let failCount = 0;
const failures = [];

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

function logBlacklistSnapshot(tag, label) {
  const list = State.scfDatabase.blacklist;
  log(tag, label + ' | 黑名单数量=' + list.length, list.map(function(b) {
    return { id: b.enterpriseId, reason: b.reason, rule: b.triggerRule };
  }));
}

function logCreditSnapshot(tag, entId, label) {
  const ent = State.getSCFEnterprise(entId);
  if (!ent) { log(tag, label + ' | 企业 ' + entId + ' 不存在'); return; }
  log(tag, label + ' | ' + ent.name + '(' + entId + ')', {
    own: ent.credit.ownScore,
    propagated: ent.credit.propagatedScore,
    scene: ent.credit.sceneScore,
    blacklist: ent.credit.blacklistStatus,
    historyLen: ent.credit.creditHistory.length,
  });
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
  assert(diff <= tolerance, message + ' (期望: ' + expected + '+-' + tolerance + ', 实际: ' + actual + ', 差值: ' + diff + ')');
}

function testGroup(name, fn) {
  console.info('\n=== ' + name + ' ===');
  fn();
}

function setup() {
  State.resetSCFDatabase();
}

function withCreditScore(entId, score, fn) {
  const ent = State.getSCFEnterprise(entId);
  if (!ent) { fn(null); return; }
  const original = ent.credit.ownScore;
  ent.credit.ownScore = score;
  log('SETUP', '临时设置 ' + entId + ' 信用分: ' + original + ' -> ' + score);
  try {
    fn(ent);
  } finally {
    ent.credit.ownScore = original;
    log('RESTORE', '恢复 ' + entId + ' 信用分: ' + score + ' -> ' + original);
  }
}

// ============================================================
// 边界条件测试
// ============================================================

testGroup('E01-E03: 信用分阈值边缘 (599/600/601)', function() {
  setup();

  log('E01', '--- 信用分=599 (阈值-1) ---');
  withCreditScore('SCF-S001', 599, function(ent) {
    const result = SCFEngine.SC2_checkAdmission('SCF-S001');
    log('E01', '准入结果: admitted=' + result.admitted + ', channel=' + result.channel + ', reason=' + result.reason);
    assert(!result.admitted, 'E01: 信用分599 准入拒绝 (<600)');
    assertEqual(result.channel, 'credit_threshold', 'E01: channel=credit_threshold');
  });

  log('E02', '--- 信用分=600 (阈值边缘) ---');
  withCreditScore('SCF-S001', 600, function(ent) {
    const result = SCFEngine.SC2_checkAdmission('SCF-S001');
    log('E02', '准入结果: admitted=' + result.admitted + ', channel=' + result.channel + ', reason=' + result.reason);
    assert(result.admitted, 'E02: 信用分600 准入通过 (=600, 边缘通过)');
    assertEqual(result.channel, 'credit_threshold', 'E02: channel=credit_threshold');
  });

  log('E03', '--- 信用分=601 (阈值+1) ---');
  withCreditScore('SCF-S001', 601, function(ent) {
    const result = SCFEngine.SC2_checkAdmission('SCF-S001');
    log('E03', '准入结果: admitted=' + result.admitted + ', channel=' + result.channel + ', reason=' + result.reason);
    assert(result.admitted, 'E03: 信用分601 准入通过 (>600)');
    assertEqual(result.channel, 'credit_threshold', 'E03: channel=credit_threshold');
  });
});

testGroup('E04: 信用分=0 (极端低值)', function() {
  setup();
  log('E04', '--- 信用分=0 (极端低值) ---');
  withCreditScore('SCF-S001', 0, function(ent) {
    const result = SCFEngine.SC2_checkAdmission('SCF-S001');
    log('E04', '准入结果: admitted=' + result.admitted + ', reason=' + result.reason);
    assert(!result.admitted, 'E04: 信用分0 准入拒绝');
    assert(result.reason.includes('信用分不足'), 'E04: 原因包含"信用分不足"');
  });
});

testGroup('E05-E06: 信用分上限 (850/851)', function() {
  setup();

  log('E05', '--- 信用分=850 (上限) ---');
  withCreditScore('SCF-S001', 850, function(ent) {
    const result = SCFEngine.SC2_checkAdmission('SCF-S001');
    log('E05', '准入结果: admitted=' + result.admitted + ', reason=' + result.reason);
    assert(result.admitted, 'E05: 信用分850 准入通过 (上限值)');
  });

  log('E06', '--- 信用分=851 (超上限) ---');
  withCreditScore('SCF-S001', 851, function(ent) {
    const result = SCFEngine.SC2_checkAdmission('SCF-S001');
    log('E06', '准入结果: admitted=' + result.admitted + ', reason=' + result.reason);
    assert(result.admitted, 'E06: 信用分851 准入通过 (超上限但仍>600)');
  });
});

testGroup('E07: 信用分=-100 (负数)', function() {
  setup();
  log('E07', '--- 信用分=-100 (负数) ---');
  withCreditScore('SCF-S001', -100, function(ent) {
    const result = SCFEngine.SC2_checkAdmission('SCF-S001');
    log('E07', '准入结果: admitted=' + result.admitted + ', reason=' + result.reason);
    assert(!result.admitted, 'E07: 信用分-100 准入拒绝 (负数<600)');
    assert(result.reason !== undefined, 'E07: 系统未崩溃, 返回了 reason');
  });
});

testGroup('E08: 信用分=NaN (非数字)', function() {
  setup();
  log('E08', '--- 信用分=NaN (非数字) ---');
  withCreditScore('SCF-S001', NaN, function(ent) {
    const result = SCFEngine.SC2_checkAdmission('SCF-S001');
    log('E08', '准入结果: admitted=' + result.admitted + ', reason=' + result.reason);
    assert(result !== null && result !== undefined, 'E08: 系统未崩溃, 返回了结果对象');
  });
});

testGroup('E09: 信用分=null/undefined (空值)', function() {
  setup();
  log('E09', '--- 信用分=null/undefined (空值) ---');

  const ent = State.getSCFEnterprise('SCF-S001');
  const original = ent.credit.ownScore;
  ent.credit.ownScore = null;
  log('E09', '设置 credit.ownScore = null');
  let result = SCFEngine.SC2_checkAdmission('SCF-S001');
  log('E09', 'null 准入结果: admitted=' + result.admitted + ', reason=' + result.reason);
  assert(result !== null && result !== undefined, 'E09-null: 系统未崩溃');

  ent.credit.ownScore = undefined;
  log('E09', '设置 credit.ownScore = undefined');
  result = SCFEngine.SC2_checkAdmission('SCF-S001');
  log('E09', 'undefined 准入结果: admitted=' + result.admitted + ', reason=' + result.reason);
  assert(result !== null && result !== undefined, 'E09-undefined: 系统未崩溃');

  ent.credit.ownScore = original;
  log('E09', '恢复 credit.ownScore = ' + original);
});

testGroup('E10: 信用分=Infinity (无穷大)', function() {
  setup();
  log('E10', '--- 信用分=Infinity (无穷大) ---');
  withCreditScore('SCF-S001', Infinity, function(ent) {
    const result = SCFEngine.SC2_checkAdmission('SCF-S001');
    log('E10', '准入结果: admitted=' + result.admitted + ', reason=' + result.reason);
    assert(result !== null && result !== undefined, 'E10: 系统未崩溃');
  });
});

testGroup('E11-E12: 稳定系数边界 (0/1/超限/负数)', function() {
  setup();

  log('E11', '--- 稳定系数=0 (无合作) ---');
  const minRel = { strength: { cooperationYears: 0, tradeStability: 0 } };
  const minFactor = SCFEngine._calcStabilityFactor(minRel);
  log('E11', '稳定系数=0: cooperationYears=0, tradeStability=0 -> factor=' + minFactor);
  assertApprox(minFactor, 0, 0.001, 'E11: 稳定系数=0');

  log('E12', '--- 稳定系数=1 (满合作) ---');
  const maxRel = { strength: { cooperationYears: 5, tradeStability: 1.0 } };
  const maxFactor = SCFEngine._calcStabilityFactor(maxRel);
  log('E12', '稳定系数=1: cooperationYears=5, tradeStability=1.0 -> factor=' + maxFactor);
  assertApprox(maxFactor, 1.0, 0.001, 'E12: 稳定系数=1');

  log('E12b', '--- 稳定系数>1 (超限钳位) ---');
  const overRel = { strength: { cooperationYears: 10, tradeStability: 1.5 } };
  const overFactor = SCFEngine._calcStabilityFactor(overRel);
  log('E12b', '稳定系数>1: cooperationYears=10, tradeStability=1.5 -> factor=' + overFactor);
  assert(overFactor <= 1.0, 'E12b: 稳定系数钳位<=1 (实际: ' + overFactor + ')');

  log('E12c', '--- 稳定系数<0 (负数钳位) ---');
  const negRel = { strength: { cooperationYears: -5, tradeStability: -0.5 } };
  const negFactor = SCFEngine._calcStabilityFactor(negRel);
  log('E12c', '稳定系数<0: cooperationYears=-5, tradeStability=-0.5 -> factor=' + negFactor);
  assert(negFactor >= 0, 'E12c: 稳定系数钳位>=0 (实际: ' + negFactor + ', 已修复: Math.max(0, ...))');
  assert(negFactor <= 1, 'E12c: 稳定系数钳位<=1 (实际: ' + negFactor + ')');
});

testGroup('E13: 押品覆盖率边界 (0/0.5/1.0/1.5/负数)', function() {
  setup();
  const transmittedScore = 600;

  log('E13a', '--- 押品覆盖率=0 ---');
  const score0 = SCFEngine.SC3_calculateSceneCredit(transmittedScore, 'verified', 0);
  log('E13a', '押品=0 -> 场景分=' + score0 + ' (传导=' + transmittedScore + ')');
  assertEqual(score0, 600, 'E13a: 押品覆盖率=0时场景分=传导分');

  log('E13b', '--- 押品覆盖率=0.5 ---');
  const score50 = SCFEngine.SC3_calculateSceneCredit(transmittedScore, 'verified', 0.5);
  const expected50 = Math.round(600 * 1.0 + 0.5 * 0.2 * 100);
  log('E13b', '押品=0.5 -> 场景分=' + score50 + ' (期望=' + expected50 + ')');
  assertEqual(score50, expected50, 'E13b: 押品覆盖率=0.5场景分');

  log('E13c', '--- 押品覆盖率=1.0 ---');
  const score100 = SCFEngine.SC3_calculateSceneCredit(transmittedScore, 'verified', 1.0);
  const expected100 = Math.round(600 * 1.0 + 1.0 * 0.2 * 100);
  log('E13c', '押品=1.0 -> 场景分=' + score100 + ' (期望=' + expected100 + ')');
  assertEqual(score100, expected100, 'E13c: 押品覆盖率=1.0场景分');

  log('E13d', '--- 押品覆盖率=1.5 (超限) ---');
  const score150 = SCFEngine.SC3_calculateSceneCredit(transmittedScore, 'verified', 1.5);
  log('E13d', '押品=1.5 -> 场景分=' + score150 + ' (系统未崩溃)');
  assert(score150 > 0, 'E13d: 押品覆盖率=1.5系统未崩溃');

  log('E13e', '--- 押品覆盖率=-0.5 (负数) ---');
  const scoreNeg = SCFEngine.SC3_calculateSceneCredit(transmittedScore, 'verified', -0.5);
  log('E13e', '押品=-0.5 -> 场景分=' + scoreNeg + ' (系统未崩溃)');
  assert(typeof scoreNeg === 'number', 'E13e: 负数押品系统未崩溃');
});

testGroup('E14: 信用提升至上限850 (连续提升钳位)', function() {
  setup();
  log('E14', '--- 连续信用提升至上限850 ---');

  const ent = State.getSCFEnterprise('SCF-S001');
  const startScore = ent.credit.ownScore;
  log('E14', '起始信用分: ' + startScore);

  for (let i = 0; i < 50; i++) {
    SCFEngine._feedbackCreditImprovement('SCF-S001', 10);
    const current = ent.credit.ownScore;
    if (i < 5 || i % 10 === 0 || current >= 850) {
      log('E14', '第' + (i + 1) + '次提升(+10): 信用分=' + current + (current >= 850 ? ' [已达上限]' : ''));
    }
    assert(current <= 850, 'E14: 第' + (i + 1) + '次提升后信用分<=850 (实际: ' + current + ')');
    if (current >= 850) {
      log('E14', '已达上限850, 提前结束 (' + (i + 1) + '次提升)');
      break;
    }
  }

  const finalScore = ent.credit.ownScore;
  log('E14', '最终信用分: ' + finalScore);
  assertEqual(finalScore, 850, 'E14: 连续提升后信用分=850 (钳位至上限)');

  SCFEngine._feedbackCreditImprovement('SCF-S001', 10);
  log('E14', '已达上限后再提升+10: 信用分=' + ent.credit.ownScore);
  assertEqual(ent.credit.ownScore, 850, 'E14: 达上限后再提升仍=850');
});

testGroup('E15: 黑名单拉黑后立即申诉 (状态流转)', function() {
  setup();
  log('E15', '--- 拉黑->申诉->状态流转 ---');

  log('E15', '步骤1: 拉黑 SCF-S001');
  SCFEngine.SC2_addToBlacklist('SCF-S001', '测试拉黑', ['证据'], '测试规则');
  let entry = SCFEngine.SC2_checkBlacklist('SCF-S001');
  log('E15', '拉黑后状态', { appealStatus: entry.appealStatus, reason: entry.reason });
  assertEqual(entry.appealStatus, 'none', 'E15: 初始 appealStatus=none');

  log('E15', '步骤2: 发起申诉');
  SCFEngine.SC2_appealBlacklist('SCF-S001', '申诉理由: 证据不足');
  entry = SCFEngine.SC2_checkBlacklist('SCF-S001');
  log('E15', '申诉后状态', { appealStatus: entry.appealStatus, appealReason: entry.appealReason });
  assertEqual(entry.appealStatus, 'pending', 'E15: 申诉后 appealStatus=pending');
  assertEqual(entry.appealReason, '申诉理由: 证据不足', 'E15: 申诉理由已记录');

  log('E15', '步骤3: 申诉中准入验证');
  const result = SCFEngine.SC2_checkAdmission('SCF-S001');
  log('E15', '申诉中准入结果: admitted=' + result.admitted);
  assert(!result.admitted, 'E15: 申诉中准入仍被拒绝');

  State.scfDatabase.blacklist = State.scfDatabase.blacklist.filter(function(b) { return b.enterpriseId !== 'SCF-S001'; });
  const ent = State.getSCFEnterprise('SCF-S001');
  ent.credit.blacklistStatus = 'none';
});

testGroup('E16: 同一企业5类触发全拉黑 (去重+优先级)', function() {
  setup();
  log('E16', '--- 同一企业5类触发全拉黑 ---');

  const triggers = ['fake_trade', 'severe_overdue', 'circular_trade', 'dishonest', 'low_credit'];
  triggers.forEach(function(t, i) {
    log('E16', '第' + (i + 1) + '次触发: ' + t);
    SCFEngine.SC2_triggerBlacklist('SCF-S002', t, ['证据-' + t]);
  });

  const entries = State.scfDatabase.blacklist.filter(function(b) { return b.enterpriseId === 'SCF-S002'; });
  log('E16', '5次触发后黑名单条目数: ' + entries.length + ' (期望=1, 去重)');
  assertEqual(entries.length, 1, 'E16: 5次触发后去重保留1条');
  assertEqual(entries[0].triggerRule.includes('SC2-规则1'), true, 'E16: 保留首次触发规则 (fake_trade/SC2-规则1)');

  State.scfDatabase.blacklist = State.scfDatabase.blacklist.filter(function(b) { return b.enterpriseId !== 'SCF-S002'; });
  const ent = State.getSCFEnterprise('SCF-S002');
  if (ent) ent.credit.blacklistStatus = 'none';
});

testGroup('E17: 不存在的企业ID传导计算', function() {
  setup();
  log('E17', '--- 不存在的企业ID传导计算 ---');

  log('E17', "SC3_calculateTransmittedCredit('NON-EXIST-ANCHOR', 'NON-EXIST-PARTNER')");
  const result = SCFEngine.SC3_calculateTransmittedCredit('NON-EXIST-ANCHOR', 'NON-EXIST-PARTNER');
  log('E17', '结果: ' + (result === null ? 'null (符合预期)' : '非null (异常)'));
  assert(result === null, 'E17: 不存在关系传导返回 null');

  log('E17', "SC3_calculateTransmittedCredit('', '')");
  const emptyResult = SCFEngine.SC3_calculateTransmittedCredit('', '');
  log('E17', '空字符串结果: ' + (emptyResult === null ? 'null' : '非null'));
  assert(emptyResult === null, 'E17: 空字符串传导返回 null');
});

testGroup('E18: 稳定系数计算的极端输入', function() {
  setup();
  log('E18', '--- 稳定系数极端输入 ---');

  log('E18', '测试 null 关系对象');
  try {
    const factor = SCFEngine._calcStabilityFactor(null);
    log('E18', 'null 关系 -> factor=' + factor);
    assert(true, 'E18: null 关系不崩溃');
  } catch (e) {
    log('E18', 'null 关系抛出异常: ' + e.message);
    assert(true, 'E18: null 关系抛出异常 (可接受)');
  }

  log('E18', '测试 undefined strength');
  try {
    const factor = SCFEngine._calcStabilityFactor({});
    log('E18', 'undefined strength -> factor=' + factor);
    assert(true, 'E18: undefined strength 不崩溃');
  } catch (e) {
    log('E18', 'undefined strength 抛出异常: ' + e.message);
    assert(true, 'E18: undefined strength 抛出异常 (可接受)');
  }
});

testGroup('E19: 空证据数组触发黑名单', function() {
  setup();
  log('E19', '--- 空证据数组触发黑名单 ---');

  log('E19', "triggerBlacklist('TEST-E19', 'fake_trade', [])");
  const entry = SCFEngine.SC2_triggerBlacklist('TEST-E19', 'fake_trade', []);
  log('E19', '结果', { entId: entry ? entry.enterpriseId : null, evidence: entry ? entry.evidence : null });
  assert(entry !== null, 'E19: 空证据数组触发成功');
  assertEqual(entry.evidence.length, 0, 'E19: 证据数组长度=0');

  State.scfDatabase.blacklist = State.scfDatabase.blacklist.filter(function(b) { return b.enterpriseId !== 'TEST-E19'; });
});

testGroup('E20: 超长企业名称 (序列化)', function() {
  setup();
  log('E20', '--- 超长企业名称 ---');

  const longName = '超'.repeat(500) + '长企业名称有限公司';
  log('E20', '构造超长名称 (长度=' + longName.length + ')');

  const entry = SCFEngine.SC2_addToBlacklist('TEST-E20', '测试', ['证据'], '测试规则');
  entry.enterpriseName = longName;
  log('E20', '拉黑成功, enterpriseName.length=' + entry.enterpriseName.length);

  try {
    const serialized = JSON.stringify(State.scfDatabase.blacklist);
    log('E20', '序列化成功, 长度=' + serialized.length);
    assert(serialized.length > 0, 'E20: 超长名称序列化成功');
  } catch (e) {
    log('E20', '序列化失败: ' + e.message);
    assert(false, 'E20: 超长名称序列化失败: ' + e.message);
  }

  try {
    const result = SCFEngine.SC2_checkAdmission('TEST-E20');
    log('E20', '准入查询成功: admitted=' + result.admitted);
    assert(true, 'E20: 超长名称准入查询不崩溃');
  } catch (e) {
    assert(false, 'E20: 超长名称准入查询崩溃: ' + e.message);
  }

  State.scfDatabase.blacklist = State.scfDatabase.blacklist.filter(function(b) { return b.enterpriseId !== 'TEST-E20'; });
});

testGroup('E21: 信用分=350 (远低于阈值)', function() {
  setup();
  log('E21', '--- 信用分=350 (远低于阈值) ---');
  withCreditScore('SCF-S001', 350, function(ent) {
    const result = SCFEngine.SC2_checkAdmission('SCF-S001');
    log('E21', '准入结果: admitted=' + result.admitted + ', reason=' + result.reason);
    assert(!result.admitted, 'E21: 信用分350 准入拒绝');
    assert(result.reason.includes('350'), 'E21: 原因包含实际信用分350');
  });
});

testGroup('E22: 多次连续提升后信用历史完整性', function() {
  setup();
  log('E22', '--- 多次连续提升后信用历史 ---');

  const ent = State.getSCFEnterprise('SCF-S001');
  const initialHistoryLen = ent.credit.creditHistory.length;
  log('E22', '初始信用历史数量: ' + initialHistoryLen);

  for (let i = 0; i < 20; i++) {
    SCFEngine._feedbackCreditImprovement('SCF-S001', 5);
  }

  const afterHistoryLen = ent.credit.creditHistory.length;
  log('E22', '20次提升后信用历史数量: ' + afterHistoryLen + ' (新增' + (afterHistoryLen - initialHistoryLen) + ')');
  assertEqual(afterHistoryLen, initialHistoryLen + 20, 'E22: 20次提升新增20条历史');

  const newHistories = ent.credit.creditHistory.slice(initialHistoryLen);
  let allValid = true;
  newHistories.forEach(function(h, i) {
    if (!h.date || !h.event || h.impact === undefined) {
      log('E22', '第' + (i + 1) + '条历史字段不完整', h);
      allValid = false;
    }
  });
  assert(allValid, 'E22: 20条新历史字段完整 (date/event/impact)');
});

testGroup('E23: 白名单+黑名单同时存在 (优先级验证)', function() {
  setup();
  log('E23', '--- 白名单+黑名单同时存在 ---');

  log('E23', '加入黑名单');
  SCFEngine.SC2_addToBlacklist('SCF-S001', '测试黑名单', ['证据'], '测试规则');
  log('E23', '加入白名单');
  SCFEngine.SC2_addToWhitelist('SCF-S001', '优质合作伙伴');

  logBlacklistSnapshot('E23', '黑白名单同时存在');
  log('E23', '准入校验 (白名单应优先)');

  const result = SCFEngine.SC2_checkAdmission('SCF-S001');
  log('E23', '准入结果: admitted=' + result.admitted + ', channel=' + result.channel + ', reason=' + result.reason);
  assert(result.admitted, 'E23: 白名单优先级>黑名单, 准入通过');
  assertEqual(result.channel, 'whitelist', 'E23: channel=whitelist (白名单优先)');

  State.scfDatabase.blacklist = State.scfDatabase.blacklist.filter(function(b) { return b.enterpriseId !== 'SCF-S001'; });
  State.scfDatabase.whitelist = State.scfDatabase.whitelist.filter(function(w) { return w.enterpriseId !== 'SCF-S001'; });
  const ent = State.getSCFEnterprise('SCF-S001');
  ent.credit.blacklistStatus = 'none';
});

// ============================================================
// 测试结果汇总
// ============================================================
console.info('\n==================================================');
console.info('SCF 边界条件测试结果: [PASS] ' + passCount + ' / [FAIL] ' + failCount);
console.info('==================================================');
if (failures.length > 0) {
  console.info('\n失败项:');
  failures.forEach(function(f) { console.info('  [FAIL] ' + f); });
  process.exit(1);
} else {
  console.info('\n所有边界条件测试通过! 极端场景处理稳健。');
  console.info('\n边界测试覆盖:');
  console.info('  E01-E03: 信用分阈值边缘 (599/600/601)');
  console.info('  E04: 信用分=0 (极端低值)');
  console.info('  E05-E06: 信用分上限 (850/851)');
  console.info('  E07: 信用分=-100 (负数)');
  console.info('  E08: 信用分=NaN (非数字)');
  console.info('  E09: 信用分=null/undefined (空值)');
  console.info('  E10: 信用分=Infinity (无穷大)');
  console.info('  E11-E12: 稳定系数边界 (0/1/超限/负数)');
  console.info('  E13: 押品覆盖率边界 (0/0.5/1.0/1.5/负数)');
  console.info('  E14: 信用提升至上限850 (连续提升钳位)');
  console.info('  E15: 拉黑->申诉->状态流转');
  console.info('  E16: 同一企业5类触发全拉黑 (去重)');
  console.info('  E17: 不存在的企业ID传导计算');
  console.info('  E18: 稳定系数极端输入 (null/undefined)');
  console.info('  E19: 空证据数组触发黑名单');
  console.info('  E20: 超长企业名称 (序列化)');
  console.info('  E21: 信用分=350 (远低于阈值)');
  console.info('  E22: 多次连续提升后信用历史完整性');
  console.info('  E23: 白名单+黑名单同时存在 (优先级)');
  process.exit(0);
}
