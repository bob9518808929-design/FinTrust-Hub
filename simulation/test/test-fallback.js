/**
 * test-fallback.js — 独立运行兜底场景的 Node.js Mock 测试
 *
 * 用途:
 *   1. 不依赖浏览器,直接在 Node 中加载 mock-data.js + state.js,独立验证 C1-C7 在独立运行兜底场景下是否按预期激活
 *   2. 通过 console.info 日志(已在 state.js 关键分支加入)观察 API 断开/恢复时的状态流转
 *   3. 在浏览器测试前先在 Node 中跑一遍,排查明显 bug
 *
 * 运行方式:
 *   cd c:\Users\Windws\Desktop\caiwu\jinrong\simulation
 *   node test\test-fallback.js
 *
 * 测试用例覆盖:
 *   - T01: 初始状态验证 (默认 11/15 API connected, C3 active)
 *   - T02: 单 API 断开 → 对应 C 模块激活 (联动规则 4.11)
 *   - T03: 一键全断 → 11 个 connected API 全断 → 6/7 C 模块激活 (C1 因 API-11 默认已断开不触发)
 *   - T04: 单 API 恢复 → 不自动关闭 C 模块 (避免抖动)
 *   - T05: 切换独立运行模式 → 15 API 全断 + C1-C7 全激活 + 降级链 L3
 *   - T06: 关闭独立运行模式 → API 从快照恢复 + C1-C7 重置为默认
 *   - T07: 场景加载 api_priority → 全部 API connected + C 全 standby + L1
 *   - T08: 场景加载 independent_fallback → 0 API + 7 C active + L3 + 独立模式开
 *   - T09: 独立运行模式开启后,手动恢复 API 不应改变 C 模块状态(因为 forced_off)
 *   - T10: 手动激活/休眠单个 C 模块
 */

// ========================================
// 1. 构造 Mock 浏览器环境
// ========================================
const fs = require('fs');
const path = require('path');

// stub window/document/AIModal/echarts, 让 state.js 在 node 中可加载
global.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
};
global.document = {
  addEventListener: () => {},
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ style: {}, appendChild: () => {}, addEventListener: () => {} }),
};
global.echarts = { init: () => ({ setOption: () => {} }) };
global.AIModal = { toast: () => {}, modal: () => {} };
global.App = { switchTab: () => {}, renderAll: () => {} };
global.MockData = null; // 占位,稍后注入
global.State = null;    // 占位,稍后注入
global.LogPanel = { update: () => {} };
global.GuideManager = { init: () => {}, updateContent: () => {} };
global.SceneLoader = { renderSelector: () => '', init: () => {} };
global.FallbackEngine = null;
global.ViewFallback = null;

// ========================================
// 2. 加载 mock-data.js 与 state.js (通过 window.X = X 暴露)
// ========================================
const ROOT = path.resolve(__dirname, '..');
const mockDataCode = fs.readFileSync(path.join(ROOT, 'js', 'mock-data.js'), 'utf8');
const stateCode = fs.readFileSync(path.join(ROOT, 'js', 'state.js'), 'utf8');
const fbEngineCode = fs.readFileSync(path.join(ROOT, 'js', 'fallback-engine.js'), 'utf8');

// 每个文件内部用 const X = {...} 然后 window.X = X 暴露
// 这里只把全局依赖(window/document/console/MockData/App/AIModal)作为参数传入
// 不传 State/FallbackEngine 作为参数(避免与文件内部 const State 冲突)
// 而是让文件内部访问 window.MockData/window.State 这种"间接"形式
// 但 mock-data.js 内部不依赖外部变量,state.js 依赖 MockData(全局),fallback-engine.js 依赖 State(全局)
// 所以我们传入 window/document/console/MockData/App/AIModal,让 state.js/fallback-engine.js 通过 window.MockData/window.State 访问
const runInSandbox = (code) => {
  // 把 window 作为 this 上下文,使其在代码内可访问
  // 关键: 不传 State 作为参数,让文件内部的 const State 不冲突
  const fn = new Function('window', 'document', 'console', 'MockData', 'App', 'AIModal', code);
  fn(global.window, global.document, console, global.window.MockData, global.App, global.AIModal);
};

// 1. 加载 mock-data.js → 内部 const MockData = {...}; window.MockData = MockData;
runInSandbox(mockDataCode);
global.MockData = global.window.MockData;
console.info('[Setup] mock-data.js loaded. MockData.EXTERNAL_APIS count=' + global.MockData.EXTERNAL_APIS.length);

// 2. 加载 state.js → 内部 const State = {...}; window.State = State;
//    但 state.js 中直接使用 MockData(未通过 window.MockData),需要让 MockData 在作用域中
//    我们传入 global.MockData 作为 MockData 参数
runInSandbox(stateCode);
global.State = global.window.State;
console.info('[Setup] state.js loaded. State object keys=' + Object.keys(global.State).length);

// 3. 加载 fallback-engine.js → 内部 const FallbackEngine = {...}; window.FallbackEngine = FallbackEngine;
//    fallback-engine.js 中使用 State(直接引用) 和 MockData(直接引用)
//    我们传入 global.State 和 global.MockData
const runFbEngine = new Function('window', 'document', 'console', 'MockData', 'State', 'App', 'AIModal', fbEngineCode);
runFbEngine(global.window, global.document, console, global.MockData, global.State, global.App, global.AIModal);
global.FallbackEngine = global.window.FallbackEngine;
console.info('[Setup] fallback-engine.js loaded.');

const { State, MockData, FallbackEngine } = global;
console.info('[Setup] ALL loaded. EXTERNAL_APIS=' + MockData.EXTERNAL_APIS.length + ', FALLBACK_MODULES=' + MockData.FALLBACK_MODULES.length);

// ========================================
// 3. 测试工具函数
// ========================================
const results = [];
function assert(name, condition, expected, actual) {
  const pass = !!condition;
  results.push({ name, pass, expected, actual });
  const tag = pass ? 'PASS' : 'FAIL';
  console.info(`[Test] ${tag} - ${name}${pass ? '' : ` | expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`}`);
}

function snapshot(label) {
  const s = {
    apis: State.externalApis.map(a => ({ id: a.id, status: a.status, circuit: a.circuitState })),
    cs: State.fallbackEngine.modules.map(m => ({ id: m.id, status: m.status })),
    chainLevel: State.fallbackEngine.fallbackChain.currentLevel,
    independentMode: State.fallbackEngine.independentMode.enabled,
    connectedApi: State.getConnectedApiCount(),
    activeC: State.getActiveFallbackCount(),
    alerts: State.activeAlerts.map(a => a.type),
  };
  console.info(`\n[Snapshot] ${label} ─ connected=${s.connectedApi}/15 activeC=${s.activeC}/7 chainL${s.chainLevel} indMode=${s.independentMode} alerts=[${s.alerts.join(',')}]`);
  return s;
}

function banner(text) {
  console.info('\n' + '='.repeat(70));
  console.info('  ' + text);
  console.info('='.repeat(70));
}

// ========================================
// 4. 初始化 State (重写 init 以避免 DOM 依赖)
// ========================================
// 由于 Node 环境没有完整 DOM,我们手动注入三档分类的初始数据
function initMinimal() {
  State.externalApis = JSON.parse(JSON.stringify(MockData.EXTERNAL_APIS));
  State.fallbackEngine = {
    modules: JSON.parse(JSON.stringify(MockData.FALLBACK_MODULES)),
    fallbackChain: { currentLevel: 1, triggerEvents: [], autoSwitchEnabled: true },
    independentMode: { enabled: false, activatedAt: null, degradedServices: [], availableServices: [] },
    selfOperatedTag: '自营兜底·非外部机构背书'
  };
  State.selfDevelopedModules = JSON.parse(JSON.stringify(MockData.SELF_DEVELOPED_MODULES));
  State.tierInvestment = JSON.parse(JSON.stringify(MockData.TIER_INVESTMENT));
  State.activeAlerts = [];
  State.linkageLog = [];
  State._apiSnapshotBeforeIndependentMode = null;
  State._highlightCModuleId = null;
  State._selectedBModuleId = null;
  State._tierDashboardMode = 'modules';
  // stub State.log
  if (!State.log) State.log = (cat, msg, type) => { /* console.info(`[State.log][${type}] ${msg}`); */ };
  if (!State._notify) State._notify = () => {};
  if (!State.addAlert) State.addAlert = (type, title, text, severity, extra) => {
    State.activeAlerts.push({ type, title, text, severity, id: 'ALT_' + Date.now() + '_' + Math.random(), createdAt: Date.now(), ...extra });
  };
  if (!State.clearAlerts) State.clearAlerts = (predicate) => { State.activeAlerts = State.activeAlerts.filter(a => !predicate(a)); };
  if (!State.clearAllAlerts) State.clearAllAlerts = () => { State.activeAlerts = []; };
  // 与生产 _initTierCapabilityData 保持一致: 调用 _recomputeFallbackChainLevel 重算降级链级别
  // (默认 API-06/11/13/14 断开 → C3 已 active → 降级链 L2)
  State._recomputeFallbackChainLevel();

  // stub: switchEnterprise 依赖完整的企业数据,但本测试只关注 fallback 联动,直接 mock
  State.switchEnterprise = (enterpriseId) => {
    State.currentEnterpriseId = enterpriseId;
    State.clearAllAlerts();
    State._notify();
  };
  // stub: currentEnterprise getter 可能依赖 enterprises 数组,这里返回一个最小对象避免崩溃
  Object.defineProperty(State, 'currentEnterprise', {
    get() { return { id: State.currentEnterpriseId, name: 'TestEnterprise', runtime: {}, modules: {}, financials: {} }; },
    configurable: true
  });
}

// ========================================
// 5. 测试用例
// ========================================
banner('T01: 初始状态验证 (默认 11/15 API connected, C3 active 因 API-06 默认断开 → 降级链 L2)');
initMinimal();
let snap = snapshot('T01 initial');
assert('T01.1 默认 connected API 数=11', snap.connectedApi === 11, 11, snap.connectedApi);
assert('T01.2 默认 active C 模块=1 (C3)', snap.activeC === 1, 1, snap.activeC);
assert('T01.3 默认降级链 L2 (因 C3 已 active)', snap.chainLevel === 2, 2, snap.chainLevel);
assert('T01.4 默认独立运行模式关闭', snap.independentMode === false, false, snap.independentMode);
assert('T01.5 C3 状态=active', snap.cs.find(c => c.id === 'C3').status === 'active', 'active', snap.cs.find(c => c.id === 'C3').status);

// ----------------------------------------
banner('T02: 单 API 断开 → 对应 C 模块激活 (联动规则 4.11)');
// 断开 API-01 (银企直连流水抓取, fallbackTo=C7)
State.handleApiStatusChange('API-01', 'disconnected', { skipNotify: true });
snap = snapshot('T02 after disconnect API-01');
const api01 = State.getApiById('API-01');
const c7 = State.getCModuleById('C7');
assert('T02.1 API-01 状态=disconnected', api01.status === 'disconnected', 'disconnected', api01.status);
assert('T02.2 API-01 熔断器=open', api01.circuitState === 'open', 'open', api01.circuitState);
assert('T02.3 C7 状态=active (因 API-01 断开)', c7.status === 'active', 'active', c7.status);
assert('T02.4 降级链升级至 L2', snap.chainLevel === 2, 2, snap.chainLevel);
assert('T02.5 activeC=2 (C3+C7)', snap.activeC === 2, 2, snap.activeC);

// ----------------------------------------
banner('T03: 一键全断 → 11 个 connected API 全断 → 6/7 C 模块激活 (C1 因 API-11 默认已断开不触发)');
initMinimal();
State.simulateAllApisDisconnect();
snap = snapshot('T03 after simulateAllApisDisconnect');
assert('T03.1 connected API 数=0', snap.connectedApi === 0, 0, snap.connectedApi);
const activeCs = snap.cs.filter(c => c.status === 'active').map(c => c.id);
console.info(`[Test] T03.2 active C modules = [${activeCs.join(',')}]`);
// C1 关联 API-11 默认已 disconnected,所以 simulateAllApisDisconnect 不会触发 C1 激活 (无状态变更)
// 应激活 C2, C3, C4, C5, C6, C7 (6个); C1 因 API-11 无状态变更,不触发
assert('T03.3 activeC=6 (C1不激活,因API-11默认已断开)', snap.activeC === 6, 6, snap.activeC);
assert('T03.4 C1 状态=standby', snap.cs.find(c => c.id === 'C1').status === 'standby', 'standby', snap.cs.find(c => c.id === 'C1').status);
assert('T03.5 C2-C7 全部 active', ['C2','C3','C4','C5','C6','C7'].every(id => snap.cs.find(c => c.id === id).status === 'active'), true, ['C2','C3','C4','C5','C6','C7'].map(id => `${id}:${snap.cs.find(c => c.id === id).status}`));
assert('T03.6 降级链 L2 (activeC<7)', snap.chainLevel === 2, 2, snap.chainLevel);

// ----------------------------------------
banner('T04: 单 API 恢复 → 不自动关闭 C 模块 (避免抖动)');
initMinimal();
State.simulateAllApisDisconnect();
const activeBefore = State.getActiveFallbackCount();
// 恢复 API-01 (fallbackTo=C7) → C7 应保持 active (不自动关闭)
State.handleApiStatusChange('API-01', 'connected', { skipNotify: true });
snap = snapshot('T04 after reconnect API-01');
const c7After = State.getCModuleById('C7');
assert('T04.1 API-01 状态=connected', State.getApiById('API-01').status === 'connected', 'connected', State.getApiById('API-01').status);
assert('T04.2 API-01 熔断器=closed', State.getApiById('API-01').circuitState === 'closed', 'closed', State.getApiById('API-01').circuitState);
assert('T04.3 C7 仍=active (不自动关闭,避免抖动)', c7After.status === 'active', 'active', c7After.status);
assert('T04.4 activeC 不变 (仍=6)', snap.activeC === activeBefore, activeBefore, snap.activeC);

// ----------------------------------------
banner('T05: 切换独立运行模式 → 15 API 全断 + C1-C7 全激活 + 降级链 L3');
initMinimal();
State.toggleIndependentMode(true, { skipNotify: true });
snap = snapshot('T05 after toggleIndependentMode(true)');
assert('T05.1 connected API 数=0 (全断)', snap.connectedApi === 0, 0, snap.connectedApi);
assert('T05.2 activeC=7 (C1-C7 全激活)', snap.activeC === 7, 7, snap.activeC);
assert('T05.3 降级链 L3 (独立运行)', snap.chainLevel === 3, 3, snap.chainLevel);
assert('T05.4 独立运行模式=开启', snap.independentMode === true, true, snap.independentMode);
assert('T05.5 所有 API 熔断器=forced_off', State.externalApis.every(a => a.circuitState === 'forced_off'), true, State.externalApis.map(a => `${a.id}:${a.circuitState}`).join(','));
assert('T05.6 C1 已激活(独立模式强制激活)', snap.cs.find(c => c.id === 'C1').status === 'active', 'active', snap.cs.find(c => c.id === 'C1').status);
assert('T05.7 independent_mode 告警已添加', snap.alerts.includes('independent_mode'), true, snap.alerts);
assert('T05.8 degradedServices 已填充', State.fallbackEngine.independentMode.degradedServices.length > 0, true, State.fallbackEngine.independentMode.degradedServices.length);

// ----------------------------------------
banner('T06: 关闭独立运行模式 → API 从快照恢复 + C1-C7 重置为默认 (C3 仍 active 因 API-06 默认断开 → L2)');
// 先开独立模式 (保存快照),再关闭
State.toggleIndependentMode(false, { skipNotify: true });
snap = snapshot('T06 after toggleIndependentMode(false)');
assert('T06.1 connected API 数=11 (从快照恢复)', snap.connectedApi === 11, 11, snap.connectedApi);
assert('T06.2 activeC=1 (只有 C3 默认 active)', snap.activeC === 1, 1, snap.activeC);
assert('T06.3 降级链 L2 (因 C3 仍 active,API-06 默认断开)', snap.chainLevel === 2, 2, snap.chainLevel);
assert('T06.4 独立运行模式=关闭', snap.independentMode === false, false, snap.independentMode);
assert('T06.5 independent_mode 告警已清除', !snap.alerts.includes('independent_mode'), false, snap.alerts.includes('independent_mode'));
assert('T06.6 C3 状态=active (默认)', snap.cs.find(c => c.id === 'C3').status === 'active', 'active', snap.cs.find(c => c.id === 'C3').status);
assert('T06.7 C1 状态=standby (重置)', snap.cs.find(c => c.id === 'C1').status === 'standby', 'standby', snap.cs.find(c => c.id === 'C1').status);

// ----------------------------------------
banner('T07: 场景加载 api_priority → 全部 API connected + C 全 standby + L1');
initMinimal();
State.loadScene('api_priority');
snap = snapshot('T07 after loadScene api_priority');
assert('T07.1 connected API 数=15 (全接入)', snap.connectedApi === 15, 15, snap.connectedApi);
assert('T07.2 activeC=0 (C 全 standby)', snap.activeC === 0, 0, snap.activeC);
assert('T07.3 降级链 L1', snap.chainLevel === 1, 1, snap.chainLevel);
assert('T07.4 独立运行模式=关闭', snap.independentMode === false, false, snap.independentMode);

// ----------------------------------------
banner('T08: 场景加载 independent_fallback → 0 API + 7 C active + L3 + 独立模式开');
initMinimal();
State.loadScene('independent_fallback');
snap = snapshot('T08 after loadScene independent_fallback');
assert('T08.1 connected API 数=0', snap.connectedApi === 0, 0, snap.connectedApi);
assert('T08.2 activeC=7 (全激活)', snap.activeC === 7, 7, snap.activeC);
assert('T08.3 降级链 L3', snap.chainLevel === 3, 3, snap.chainLevel);
assert('T08.4 独立运行模式=开启', snap.independentMode === true, true, snap.independentMode);
assert('T08.5 independent_mode 告警已添加', snap.alerts.includes('independent_mode'), true, snap.alerts);

// ----------------------------------------
banner('T09: 独立运行模式开启后,simulateAllApisRecover 应跳过 forced_off API (不能恢复)');
initMinimal();
State.toggleIndependentMode(true, { skipNotify: true });
// 尝试恢复 → 不应该恢复任何 API (因所有 API 都是 forced_off)
State.simulateAllApisRecover();
snap = snapshot('T09 after simulateAllApisRecover in independent mode');
assert('T09.1 connected API 数仍=0 (forced_off 不可恢复)', snap.connectedApi === 0, 0, snap.connectedApi);
assert('T09.2 activeC 仍=7 (C 不应被关闭)', snap.activeC === 7, 7, snap.activeC);
assert('T09.3 降级链仍 L3', snap.chainLevel === 3, 3, snap.chainLevel);

// ----------------------------------------
banner('T10: 手动激活/休眠单个 C 模块');
initMinimal();
// 手动激活 C1
State.activateFallbackModule('C1');
snap = snapshot('T10 after activateFallbackModule C1');
assert('T10.1 C1 状态=active', snap.cs.find(c => c.id === 'C1').status === 'active', 'active', snap.cs.find(c => c.id === 'C1').status);
assert('T10.2 activeC=2 (C1+C3)', snap.activeC === 2, 2, snap.activeC);
assert('T10.3 降级链 L2', snap.chainLevel === 2, 2, snap.chainLevel);
// 手动休眠 C1
State.deactivateFallbackModule('C1');
snap = snapshot('T10 after deactivateFallbackModule C1');
assert('T10.4 C1 状态=standby', snap.cs.find(c => c.id === 'C1').status === 'standby', 'standby', snap.cs.find(c => c.id === 'C1').status);
assert('T10.5 activeC=1 (只剩 C3)', snap.activeC === 1, 1, snap.activeC);
assert('T10.6 降级链 L2 (因 C3 仍 active,API-06 默认断开)', snap.chainLevel === 2, 2, snap.chainLevel);

// ========================================
// 6. 测试结果汇总
// ========================================
banner('测试结果汇总');
const passed = results.filter(r => r.pass).length;
const failed = results.filter(r => !r.pass).length;
console.info(`  PASS: ${passed} / ${results.length}`);
console.info(`  FAIL: ${failed} / ${results.length}`);
if (failed > 0) {
  console.info('\n失败用例详情:');
  results.filter(r => !r.pass).forEach(r => {
    console.info(`  ✗ ${r.name}`);
    console.info(`    expected: ${JSON.stringify(r.expected)}`);
    console.info(`    actual:   ${JSON.stringify(r.actual)}`);
  });
  process.exit(1);
} else {
  console.info('\n  ✅ 所有测试用例 PASS,C1-C7 在独立运行兜底场景下按预期激活!');
  process.exit(0);
}
