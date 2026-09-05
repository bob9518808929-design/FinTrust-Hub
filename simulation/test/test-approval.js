/**
 * test-approval.js — Tab3 审批队列单元测试
 *
 * 覆盖场景:
 *   - T01: 同意融资 → 工单状态变更 + 资金到账 + 水位更新
 *   - T02: 否决融资 → 工单状态变更 + 流程终止
 *   - T03: 退回补充材料 → 工单保持 pending + needsSupplement 标记
 *
 * 运行方式:
 *   cd c:\Users\Windws\Desktop\caiwu\jinrong\simulation
 *   node test\test-approval.js
 */

const fs = require('fs');
const path = require('path');

global.window = { addEventListener: () => {}, removeEventListener: () => {} };
global.document = {
  addEventListener: () => {},
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ style: {}, appendChild: () => {}, addEventListener: () => {} }),
};
global.echarts = { init: () => ({ setOption: () => {} }) };
global.AIModal = { toast: () => {}, enqueue: () => {}, dismiss: () => {} };
global.App = { switchTab: () => {}, renderAll: () => {} };
global.MockData = null;
global.State = null;
global.LogPanel = { update: () => {} };
global.GuideManager = { init: () => {}, updateContent: () => {} };
global.SceneLoader = { renderSelector: () => '', init: () => {} };

const ROOT = path.resolve(__dirname, '..');
const mockDataCode = fs.readFileSync(path.join(ROOT, 'js', 'mock-data.js'), 'utf8');
const stateCode = fs.readFileSync(path.join(ROOT, 'js', 'state.js'), 'utf8');

const runInSandbox = (code) => {
  const fn = new Function('window', 'document', 'console', 'MockData', 'App', 'AIModal', code);
  fn(global.window, global.document, console, global.window.MockData, global.App, global.AIModal);
};

runInSandbox(mockDataCode);
global.MockData = global.window.MockData;
console.info('[Setup] mock-data.js loaded');

runInSandbox(stateCode);
global.State = global.window.State;
console.info('[Setup] state.js loaded');

const tests = [];
const pass = (name) => { tests.push({ name, status: 'PASS' }); };
const fail = (name, err) => { tests.push({ name, status: 'FAIL', err }); };
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

// ========================================
// 测试数据构造
// ========================================
function createTestTicket(id, enterpriseId, enterpriseName, amount, routeLevel) {
  return {
    id,
    enterpriseId,
    enterpriseName,
    amount,
    routeLevel,
    riskScore: 700,
    creditGrade: 'A',
    timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    status: 'pending',
    aiSuggestion: '建议通过',
    aiConfidence: 75
  };
}

function setupFreshState() {
  global.State.init();
  // 清空已有工单,避免干扰
  global.State.approvalQueue = [];
}

// ========================================
// T01: 同意融资
// ========================================
function testApproveRequest() {
  try {
    setupFreshState();

    const ticketId = 'T01_TEST';
    const ticket = createTestTicket(ticketId, 'E001', '宏达精密制造有限公司', 5000000, 'L3');
    global.State.approvalQueue.push(ticket);

    const ent = global.State.enterprises.find(e => e.id === 'E001');
    const prevBalance = ent.financials.accountBalance;
    const prevWater = ent.runtime.waterLevel;

    global.State.approveRequest(ticketId, true);

    const updatedTicket = global.State.approvalQueue.find(q => q.id === ticketId);
    assert(updatedTicket.status === 'approved', `状态应为 approved, 实际为 ${updatedTicket.status}`);

    assert(ent.financials.accountBalance === prevBalance + 5000000,
      `资金应增加 500万, 预期 ${prevBalance + 5000000}, 实际 ${ent.financials.accountBalance}`);

    assert(ent.runtime.waterLevel > prevWater,
      `水位应上升, 预期 > ${prevWater}, 实际 ${ent.runtime.waterLevel}`);

    pass('T01: 同意融资 → 工单状态 approved + 资金到账 + 水位更新');
  } catch (e) {
    fail('T01: 同意融资', e.message);
  }
}

// ========================================
// T02: 否决融资
// ========================================
function testRejectRequest() {
  try {
    setupFreshState();

    const ticketId = 'T02_TEST';
    const ticket = createTestTicket(ticketId, 'E002', '智芯科技有限公司', 3000000, 'L4');
    global.State.approvalQueue.push(ticket);

    const ent = global.State.enterprises.find(e => e.id === 'E002');
    const prevBalance = ent.financials.accountBalance;
    const prevWater = ent.runtime.waterLevel;
    const prevCredit = ent.runtime.creditScore;

    global.State.approveRequest(ticketId, false, '企业风险过高');

    const updatedTicket = global.State.approvalQueue.find(q => q.id === ticketId);
    assert(updatedTicket.status === 'rejected', `状态应为 rejected, 实际为 ${updatedTicket.status}`);

    // 否决后资金不变(资金未到账)
    assert(ent.financials.accountBalance === prevBalance,
      '否决后资金不应变动');

    // 否决后水位下降(业务逻辑:资金链压力上升)
    assert(ent.runtime.waterLevel < prevWater,
      `否决后水位应下降, 预期 < ${prevWater}, 实际 ${ent.runtime.waterLevel}`);

    // 否决后信用分下降
    assert(ent.runtime.creditScore < prevCredit,
      `否决后信用分应下降, 预期 < ${prevCredit}, 实际 ${ent.runtime.creditScore}`);

    pass('T02: 否决融资 → 工单状态 rejected + 资金不变 + 水位/信用分下降');
  } catch (e) {
    fail('T02: 否决融资', e.message);
  }
}

// ========================================
// T03: 退回补充材料
// ========================================
function testRejectWithSupplement() {
  try {
    setupFreshState();

    const ticketId = 'T03_TEST';
    const ticket = createTestTicket(ticketId, 'E003', '瑞丰贸易有限公司', 8000000, 'L3');
    global.State.approvalQueue.push(ticket);

    global.State.rejectWithSupplement(ticketId, '请补充近3个月经营数据');

    const updatedTicket = global.State.approvalQueue.find(q => q.id === ticketId);

    assert(updatedTicket.status === 'pending',
      `退回后状态应为 pending, 实际为 ${updatedTicket.status}`);

    assert(updatedTicket.needsSupplement === true,
      'needsSupplement 应为 true');

    assert(updatedTicket.supplementNote === '请补充近3个月经营数据',
      `退回原因不匹配, 预期 "请补充近3个月经营数据", 实际 "${updatedTicket.supplementNote}"`);

    // 验证工单仍在待办列表中
    const pendingTickets = global.State.approvalQueue.filter(q => q.status === 'pending');
    assert(pendingTickets.find(q => q.id === ticketId),
      '退回后的工单应仍在 pending 队列中');

    pass('T03: 退回补充材料 → 工单保持 pending + needsSupplement=true');
  } catch (e) {
    fail('T03: 退回补充材料', e.message);
  }
}

// ========================================
// T04: 默认退回原因
// ========================================
function testRejectWithDefaultNote() {
  try {
    setupFreshState();

    const ticketId = 'T04_TEST';
    const ticket = createTestTicket(ticketId, 'E001', '宏达精密制造有限公司', 1000000, 'L3');
    global.State.approvalQueue.push(ticket);

    global.State.rejectWithSupplement(ticketId, '');

    const updatedTicket = global.State.approvalQueue.find(q => q.id === ticketId);
    assert(updatedTicket.supplementNote === '请补充经营数据与回款凭证',
      `空备注应使用默认值, 实际为 "${updatedTicket.supplementNote}"`);

    pass('T04: 空备注使用默认退回原因');
  } catch (e) {
    fail('T04: 默认退回原因', e.message);
  }
}

// ========================================
// T05: 不存在的工单 ID
// ========================================
function testNonExistentTicket() {
  try {
    setupFreshState();

    const result1 = global.State.approveRequest('NONEXISTENT', true);
    assert(result1 === undefined, '不存在的工单 approveRequest 应返回 undefined');

    const result2 = global.State.rejectWithSupplement('NONEXISTENT', 'test');
    assert(result2 === undefined, '不存在的工单 rejectWithSupplement 应返回 undefined');

    pass('T05: 不存在的工单 ID 不应报错');
  } catch (e) {
    fail('T05: 不存在的工单 ID', e.message);
  }
}

// ========================================
// T06: 退回后可重新审批
// ========================================
function testResubmitAfterSupplement() {
  try {
    setupFreshState();

    const ticketId = 'T06_TEST';
    const ticket = createTestTicket(ticketId, 'E002', '智芯科技有限公司', 2000000, 'L3');
    global.State.approvalQueue.push(ticket);

    // 退回
    global.State.rejectWithSupplement(ticketId, '请补充材料');
    let updated = global.State.approvalQueue.find(q => q.id === ticketId);
    assert(updated.status === 'pending', '退回后应为 pending');
    assert(updated.needsSupplement === true, 'needsSupplement 应为 true');

    // 重新同意
    global.State.approveRequest(ticketId, true);
    updated = global.State.approvalQueue.find(q => q.id === ticketId);
    assert(updated.status === 'approved', `重新同意后应为 approved, 实际为 ${updated.status}`);

    pass('T06: 退回后可重新审批通过');
  } catch (e) {
    fail('T06: 退回后重新审批', e.message);
  }
}

// ========================================
// T07: 多工单顺序处理
// ========================================
function testMultipleTickets() {
  try {
    setupFreshState();

    const t1 = createTestTicket('T1', 'E001', '宏达精密', 1000000, 'L3');
    const t2 = createTestTicket('T2', 'E002', '智芯科技', 2000000, 'L4');
    const t3 = createTestTicket('T3', 'E003', '瑞丰贸易', 3000000, 'L3');

    global.State.approvalQueue.push(t1, t2, t3);
    assert(global.State.approvalQueue.length === 3, '应有 3 个工单');

    // 处理 T1: 同意
    global.State.approveRequest('T1', true);
    // 处理 T2: 否决
    global.State.approveRequest('T2', false);
    // 处理 T3: 退回
    global.State.rejectWithSupplement('T3', '补充合同');

    const t1Status = global.State.approvalQueue.find(q => q.id === 'T1').status;
    const t2Status = global.State.approvalQueue.find(q => q.id === 'T2').status;
    const t3Status = global.State.approvalQueue.find(q => q.id === 'T3').status;

    assert(t1Status === 'approved', `T1 应为 approved, 实际 ${t1Status}`);
    assert(t2Status === 'rejected', `T2 应为 rejected, 实际 ${t2Status}`);
    assert(t3Status === 'pending', `T3 应为 pending(退回), 实际 ${t3Status}`);

    const pendingCount = global.State.approvalQueue.filter(q => q.status === 'pending').length;
    assert(pendingCount === 1, `应剩 1 个 pending 工单, 实际 ${pendingCount}`);

    pass('T07: 多工单顺序处理(同意/否决/退回)');
  } catch (e) {
    fail('T07: 多工单处理', e.message);
  }
}

// ========================================
// 执行所有测试
// ========================================
console.log('\n========== Tab3 审批队列单元测试 ==========\n');

testApproveRequest();
testRejectRequest();
testRejectWithSupplement();
testRejectWithDefaultNote();
testNonExistentTicket();
testResubmitAfterSupplement();
testMultipleTickets();

console.log('\n========== 测试结果 ==========\n');
const passed = tests.filter(t => t.status === 'PASS').length;
const failed = tests.filter(t => t.status === 'FAIL').length;

tests.forEach(t => {
  const icon = t.status === 'PASS' ? '✅' : '❌';
  console.log(`${icon} ${t.name}`);
  if (t.err) console.log(`   Error: ${t.err}`);
});

console.log(`\n总计: ${tests.length} 项 | 通过: ${passed} | 失败: ${failed}`);

// 写入日志
const logPath = path.join(__dirname, 'test-output.log');
fs.appendFileSync(logPath,
  `\n[${new Date().toISOString()}] Tab3审批队列测试: ${passed}/${tests.length} passed\n`);

process.exit(failed > 0 ? 1 : 0);
