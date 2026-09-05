/**
 * run-scf-all.js — SCF 子系统全量测试打包脚本 (一键运行)
 *
 * 串联执行 4 个测试套件, 子进程隔离避免全局污染:
 *   1. demo-scf-scenario.js  — 端到端模拟演示 (4 个真实业务场景)
 *   2. test-scf.js            — 端到端验收测试 (T01-T15, 对齐 simulation-plan.md 七.12)
 *   3. test-scf-unit.js       — 单元测试 (SC2 黑白名单 + SC3 信用评分深度覆盖)
 *   4. test-scf-edge.js       — 极端边界条件测试 (E01-E23, 65+ 断言)
 *
 * 运行方式:
 *   cd c:\Users\Windws\Desktop\caiwu\jinrong\simulation
 *   node test\run-scf-all.js                  # 默认: 全部套件, 详细日志
 *   node test\run-scf-all.js --quiet          # 静默模式 (SCF_QUIET=1, 仅显示汇总)
 *   node test\run-scf-all.js --suite=demo     # 仅运行 demo
 *   node test\run-scf-all.js --suite=e2e      # 仅运行端到端
 *   node test\run-scf-all.js --suite=unit     # 仅运行单元测试
 *   node test\run-scf-all.js --suite=edge     # 仅运行边界测试
 *   node test\run-scf-all.js --suite=demo,unit  # 组合多个套件
 *   node test\run-scf-all.js --list           # 列出所有套件后退出
 *
 * 退出码:
 *   0 = 所有套件通过
 *   1 = 至少一个套件失败
 *   2 = 脚本参数错误
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

// ============================================================
// 配置: 套件清单
// ============================================================
const SUITES = [
  {
    id: 'demo',
    name: '端到端模拟演示',
    file: 'demo-scf-scenario.js',
    desc: '4 个真实业务场景 (正常保理/黑名单拦截/风险扩散/闭环回流)',
    summaryRegex: /演示完成!\s*(\d+)\s*个场景全部执行完毕/,
    parsePassFail: (stdout) => {
      // demo 没有标准的 pass/fail 格式, 通过退出码判断, 场景数固定为 4
      const m = stdout.match(/演示完成!\s*(\d+)\s*个场景全部执行完毕/);
      if (m) return { pass: parseInt(m[1], 10), fail: 0, total: parseInt(m[1], 10) };
      return { pass: 0, fail: 0, total: 0, unknown: true };
    },
  },
  {
    id: 'e2e',
    name: '端到端验收测试',
    file: 'test-scf.js',
    desc: 'T01-T15, 对齐 simulation-plan.md 七.12 验收标准',
    summaryRegex: /SCF 端到端测试结果:\s*✅\s*(\d+)\s*通过\s*\/\s*❌\s*(\d+)\s*失败/,
    parsePassFail: (stdout) => {
      const m = stdout.match(/SCF 端到端测试结果:\s*✅\s*(\d+)\s*通过\s*\/\s*❌\s*(\d+)\s*失败/);
      if (m) {
        const pass = parseInt(m[1], 10);
        const fail = parseInt(m[2], 10);
        return { pass, fail, total: pass + fail };
      }
      return { pass: 0, fail: 0, total: 0, unknown: true };
    },
  },
  {
    id: 'unit',
    name: '单元测试',
    file: 'test-scf-unit.js',
    desc: 'SC2 黑白名单 + SC3 信用评分深度覆盖 (模块 A/B)',
    summaryRegex: /SCF 单元测试结果:\s*✅\s*(\d+)\s*通过\s*\/\s*❌\s*(\d+)\s*失败/,
    parsePassFail: (stdout) => {
      const m = stdout.match(/SCF 单元测试结果:\s*✅\s*(\d+)\s*通过\s*\/\s*❌\s*(\d+)\s*失败/);
      if (m) {
        const pass = parseInt(m[1], 10);
        const fail = parseInt(m[2], 10);
        return { pass, fail, total: pass + fail };
      }
      return { pass: 0, fail: 0, total: 0, unknown: true };
    },
  },
  {
    id: 'edge',
    name: '极端边界条件测试',
    file: 'test-scf-edge.js',
    desc: 'E01-E23, 信用分阈值/NaN/Infinity/负数/上限钳位等极端场景',
    summaryRegex: /SCF 边界条件测试结果:\s*\[PASS\]\s*(\d+)\s*\/\s*\[FAIL\]\s*(\d+)/,
    parsePassFail: (stdout) => {
      const m = stdout.match(/SCF 边界条件测试结果:\s*\[PASS\]\s*(\d+)\s*\/\s*\[FAIL\]\s*(\d+)/);
      if (m) {
        const pass = parseInt(m[1], 10);
        const fail = parseInt(m[2], 10);
        return { pass, fail, total: pass + fail };
      }
      return { pass: 0, fail: 0, total: 0, unknown: true };
    },
  },
];

// ============================================================
// 参数解析
// ============================================================
function parseArgs(argv) {
  const args = { quiet: false, list: false, suites: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--quiet' || a === '-q') {
      args.quiet = true;
    } else if (a === '--list' || a === '-l') {
      args.list = true;
    } else if (a.startsWith('--suite=')) {
      const val = a.slice('--suite='.length).trim();
      if (!val) {
        console.error('错误: --suite= 参数不能为空');
        process.exit(2);
      }
      const ids = val.split(',').map((s) => s.trim()).filter(Boolean);
      const invalid = ids.filter((id) => !SUITES.find((s) => s.id === id));
      if (invalid.length > 0) {
        console.error('错误: 未知套件 ID: ' + invalid.join(', '));
        console.error('可用套件: ' + SUITES.map((s) => s.id).join(', '));
        process.exit(2);
      }
      args.suites = ids;
    } else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else {
      console.error('错误: 未知参数: ' + a);
      printHelp();
      process.exit(2);
    }
  }
  return args;
}

function printHelp() {
  console.info('用法: node test/run-scf-all.js [选项]');
  console.info('');
  console.info('选项:');
  console.info('  --quiet, -q           静默模式 (SCF_QUIET=1, 仅显示汇总)');
  console.info('  --suite=<id1,id2>     仅运行指定套件 (如 --suite=demo,unit)');
  console.info('  --list, -l            列出所有套件后退出');
  console.info('  --help, -h            显示帮助');
  console.info('');
  console.info('可用套件:');
  SUITES.forEach((s) => {
    console.info('  ' + s.id.padEnd(6) + ' ' + s.name + ' — ' + s.desc);
  });
}

function listSuites() {
  console.info('可用测试套件 (' + SUITES.length + ' 个):');
  console.info('');
  SUITES.forEach((s, i) => {
    console.info('  [' + (i + 1) + '] ' + s.id + ' — ' + s.name);
    console.info('      文件: test/' + s.file);
    console.info('      描述: ' + s.desc);
    console.info('');
  });
}

// ============================================================
// 输出工具 (无 ANSI 转义, Windows 兼容)
// ============================================================
const SEP_THICK = '='.repeat(80);
const SEP_THIN = '-'.repeat(80);

function banner(title) {
  console.info('');
  console.info(SEP_THICK);
  console.info('  ' + title);
  console.info(SEP_THICK);
}

function phaseHeader(index, total, suite) {
  console.info('');
  console.info(SEP_THIN);
  console.info('  [' + index + '/' + total + '] ' + suite.name + '  (test/' + suite.file + ')');
  console.info('  ' + suite.desc);
  console.info(SEP_THIN);
}

// ============================================================
// 单套件执行
// ============================================================
function runSuite(suite, quiet) {
  const testFile = path.resolve(__dirname, suite.file);
  if (!fs.existsSync(testFile)) {
    console.error('  [ERROR] 测试文件不存在: ' + testFile);
    return {
      suite: suite.id,
      name: suite.name,
      status: 'missing',
      pass: 0,
      fail: 0,
      total: 0,
      durationMs: 0,
      exitCode: -1,
      unknown: true,
    };
  }

  const env = Object.assign({}, process.env);
  if (quiet) {
    env.SCF_QUIET = '1';
  }

  const start = Date.now();
  const result = spawnSync('node', [testFile], {
    cwd: path.resolve(__dirname, '..'),
    env: env,
    encoding: 'utf8',
    windowsHide: true,
  });
  const durationMs = Date.now() - start;

  const stdout = result.stdout || '';
  const stderr = result.stderr || '';

  // 实时回放子进程输出 (保持原始颜色和格式)
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);

  const parsed = suite.parsePassFail(stdout);
  const status = result.status === 0 && parsed.fail === 0 && !parsed.unknown
    ? 'pass'
    : (result.status === 0 && parsed.unknown ? 'pass-with-warnings' : 'fail');

  return {
    suite: suite.id,
    name: suite.name,
    status: status,
    pass: parsed.pass,
    fail: parsed.fail,
    total: parsed.total,
    durationMs: durationMs,
    exitCode: result.status,
    unknown: !!parsed.unknown,
  };
}

// ============================================================
// 汇总报告
// ============================================================
function printSummary(results, totalDurationMs) {
  banner('汇总报告');

  // 表格表头
  const cols = [
    { key: 'idx', label: '#', width: 3 },
    { key: 'suite', label: '套件', width: 8 },
    { key: 'name', label: '名称', width: 22 },
    { key: 'pass', label: '通过', width: 8 },
    { key: 'fail', label: '失败', width: 8 },
    { key: 'total', label: '总计', width: 8 },
    { key: 'duration', label: '耗时', width: 10 },
    { key: 'status', label: '状态', width: 14 },
  ];
  const headerLine = cols.map((c) => pad(c.label, c.width)).join('  ');
  console.info('  ' + headerLine);
  console.info('  ' + cols.map((c) => '-'.repeat(c.width)).join('  '));

  let totalPass = 0;
  let totalFail = 0;
  let totalTests = 0;
  let failedSuites = 0;

  results.forEach((r, i) => {
    totalPass += r.pass || 0;
    totalFail += r.fail || 0;
    totalTests += r.total || 0;
    if (r.status === 'fail' || r.status === 'missing') failedSuites++;

    const statusLabel = r.status === 'pass' ? '[ OK ]'
      : r.status === 'pass-with-warnings' ? '[WARN]'
      : r.status === 'missing' ? '[MISS]'
      : '[FAIL]';

    const row = {
      idx: String(i + 1),
      suite: r.suite,
      name: r.name.length > 22 ? r.name.slice(0, 20) + '..' : r.name,
      pass: String(r.pass || 0),
      fail: String(r.fail || 0),
      total: String(r.total || 0),
      duration: (r.durationMs / 1000).toFixed(2) + 's',
      status: statusLabel,
    };
    const line = cols.map((c) => pad(row[c.key], c.width)).join('  ');
    console.info('  ' + line);
  });

  console.info('  ' + cols.map((c) => '-'.repeat(c.width)).join('  '));
  const totalRow = {
    idx: '',
    suite: '',
    name: '合计',
    pass: String(totalPass),
    fail: String(totalFail),
    total: String(totalTests),
    duration: (totalDurationMs / 1000).toFixed(2) + 's',
    status: failedSuites === 0 ? '[ ALL OK ]' : '[' + failedSuites + ' FAILED ]',
  };
  console.info('  ' + cols.map((c) => pad(totalRow[c.key], c.width)).join('  '));

  // 详细失败信息
  const failed = results.filter((r) => r.status === 'fail' || r.status === 'missing');
  if (failed.length > 0) {
    console.info('');
    console.info('  失败套件详情:');
    failed.forEach((r) => {
      console.info('    - ' + r.suite + ' (' + r.name + '): status=' + r.status + ', exitCode=' + r.exitCode + ', fail=' + r.fail);
    });
  }

  // 最终结论
  console.info('');
  if (failedSuites === 0) {
    console.info('  ' + SEP_THICK.substring(0, 60));
    console.info('  全部套件通过! (' + totalPass + ' 项断言, 耗时 ' + (totalDurationMs / 1000).toFixed(2) + 's)');
    console.info('  ' + SEP_THICK.substring(0, 60));
  } else {
    console.info('  ' + SEP_THICK.substring(0, 60));
    console.info('  有 ' + failedSuites + ' 个套件失败, 请检查上方输出');
    console.info('  ' + SEP_THICK.substring(0, 60));
  }
}

function pad(str, width) {
  str = String(str);
  // 中文字符占 2 列, 简单按字符数补齐 (中文场景下视觉对齐可能略有偏差, 但不影响可读性)
  if (str.length >= width) return str.slice(0, width);
  return str + ' '.repeat(width - str.length);
}

// ============================================================
// 主流程
// ============================================================
function main() {
  const args = parseArgs(process.argv);

  if (args.list) {
    listSuites();
    return;
  }

  const selectedSuites = args.suites
    ? SUITES.filter((s) => args.suites.includes(s.id))
    : SUITES;

  banner('FinTrust Hub v6.0 — SCF 子系统全量测试 (' + selectedSuites.length + ' 个套件)');
  console.info('  模式: ' + (args.quiet ? '静默 (SCF_QUIET=1)' : '详细日志'));
  console.info('  套件: ' + selectedSuites.map((s) => s.id).join(', '));
  console.info('  开始时间: ' + new Date().toISOString());

  const results = [];
  const totalStart = Date.now();

  selectedSuites.forEach((suite, i) => {
    phaseHeader(i + 1, selectedSuites.length, suite);
    const result = runSuite(suite, args.quiet);
    results.push(result);
    console.info('');
    console.info('  -> 套件 ' + suite.id + ' 完成: ' + result.status + ' (pass=' + result.pass + ', fail=' + result.fail + ', ' + (result.durationMs / 1000).toFixed(2) + 's)');
  });

  const totalDurationMs = Date.now() - totalStart;
  printSummary(results, totalDurationMs);

  // 退出码: 任一套件失败则退出 1
  const hasFailure = results.some((r) => r.status === 'fail' || r.status === 'missing');
  process.exit(hasFailure ? 1 : 0);
}

main();
