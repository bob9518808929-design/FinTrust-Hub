#!/usr/bin/env node
/**
 * scripts/check-playwright-env.mjs — Playwright e2e 运行环境自动检测 + 安装指引
 *
 * 使用: node scripts/check-playwright-env.mjs
 *
 * 检测项:
 *   1. Node.js 版本 (Playwright 1.62 需要 >= 18)
 *   2. 包管理器 (npm/pnpm/yarn)
 *   3. @playwright/test 依赖是否已声明 + 是否已安装
 *   4. chromium 二进制是否已下载 (ms-playwright 目录)
 *   5. 后端服务端口 8767 是否可达
 *   6. 前端服务端口 5173/5174 是否可达
 *   7. 测试脚本是否存在
 *   8. 操作系统 + 磁盘可用空间 (chromium ~300MB)
 *
 * 输出: 每项 ✅/❌/⚠️ + 不满足时给出具体修复命令
 */
import { existsSync, statSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir, platform, freemem } from 'node:os';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = resolve(process.cwd());
const FRONTEND = existsSync(join(ROOT, 'package.json')) ? ROOT : join(ROOT, 'production', 'frontend');
const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
const WARN = '\x1b[33m!\x1b[0m';
const INFO = '\x1b[36mℹ\x1b[0m';

const results = [];
function add(level, name, detail, fix) {
  results.push({ level, name, detail, fix });
}

/** 检测是否为 PowerShell 5 (win32 下 $PSVersionTable.PSVersion.Major < 7 或没装 pwsh) */
function isLegacyPowerShell() {
  if (platform() !== 'win32') return false;
  try {
    // 用户如果直接在 ps 里 `node x.mjs`, ComSpec 是 cmd.exe, Parent 才是 powershell.
    // 用一个稳妥启发: 试运行 `powershell -NoProfile -Command $PSVersionTable.PSVersion.Major`
    const ps5Ver = tryExec('powershell -NoProfile -Command "$PSVersionTable.PSVersion.Major" 2>$null');
    const pwshVer = tryExec('pwsh -NoProfile -Command "$PSVersionTable.PSVersion.Major" 2>$null');
    return !pwshVer && !!ps5Ver;
  } catch {
    return false;
  }
}
const IS_PS5 = isLegacyPowerShell();
const CMD_SEP = IS_PS5 ? ' ;' : ' &&';

function line(char = '─', n = 72) {
  return char.repeat(n);
}

function tryExec(cmd) {
  try { return execSync(cmd, { stdio: 'pipe', timeout: 5000 }).toString().trim(); }
  catch { return null; }
}

function isPortListening(port) {
  const net = require('net');
  return new Promise((resolve) => {
    const s = new net.Socket();
    s.setTimeout(1500);
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('timeout', () => { s.destroy(); resolve(false); });
    s.on('error', () => { s.destroy(); resolve(false); });
    s.connect(port, '127.0.0.1');
  });
}

async function main() {
  console.log(`\n${line('═')}`);
  console.log('  Playwright e2e 运行环境检测');
  console.log(`  工作目录: ${FRONTEND}`);
  console.log(`  平台: ${platform()} | Node ${process.version}`);
  console.log(`${line('═')}\n`);

  // 1. Node 版本
  const nodeMajor = Number(process.version.slice(1).split('.')[0]);
  if (nodeMajor >= 18) {
    add('pass', 'Node.js 版本', `${process.version} (满足 >= 18)`);
  } else {
    add('fail', 'Node.js 版本', `${process.version} (需要 >= 18)`,
      `请升级 Node: 推荐使用 nvm-windows 安装 LTS 版本\n  https://github.com/coreybutler/nvm-windows/releases`);
  }

  // 2. 包管理器
  const pms = ['pnpm', 'yarn', 'npm'];
  const found = pms.filter(pm => tryExec(`${pm} --version`));
  if (found.length > 0) {
    add('pass', '包管理器', found.join(' / '));
  } else {
    add('fail', '包管理器', '未找到 npm/pnpm/yarn',
      '请安装 Node.js LTS 版本 (自带 npm)');
  }

  // 3. @playwright/test 依赖
  const pkgPath = join(FRONTEND, 'package.json');
  if (!existsSync(pkgPath)) {
    add('fail', 'package.json', `未找到: ${pkgPath}`, '请确认前端项目路径');
  } else {
    const pkg = JSON.parse(await import('node:fs').then(f => f.readFileSync(pkgPath, 'utf-8')));
    const declared = pkg.devDependencies?.['@playwright/test'] || pkg.dependencies?.['@playwright/test'];
    if (!declared) {
      add('fail', '@playwright/test 声明', 'package.json 中未声明',
        `cd ${FRONTEND} && npm install -D @playwright/test`);
    } else {
      const installed = existsSync(join(FRONTEND, 'node_modules', '@playwright', 'test'));
      if (installed) {
        add('pass', '@playwright/test 安装', `已安装 (${declared})`);
      } else {
        add('fail', '@playwright/test 安装', `已声明 (${declared}) 但 node_modules 缺失`,
          `cd ${FRONTEND} && npm install`);
      }
    }
  }

  // 4. chromium 二进制
  const PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const candidates = [];
  if (PLAYWRIGHT_BROWSERS_PATH) candidates.push(PLAYWRIGHT_BROWSERS_PATH);
  candidates.push(join(homedir(), 'AppData', 'Local', 'ms-playwright'));
  candidates.push(join(homedir(), '.cache', 'ms-playwright'));
  candidates.push(join('/Users', homedir().split('/').pop() || '', 'Library', 'Caches', 'ms-playwright'));

  let browserFound = false;
  let browserPath = '';
  for (const p of candidates) {
    if (existsSync(p)) {
      const entries = readdirSync(p);
      const chromiumDir = entries.find(e => e.toLowerCase().includes('chromium'));
      if (chromiumDir) {
        browserFound = true;
        browserPath = join(p, chromiumDir);
        break;
      }
    }
  }

  if (browserFound) {
    add('pass', 'chromium 浏览器', `已下载: ${browserPath}`);
  } else {
    add('fail', 'chromium 浏览器', '未下载 chromium 二进制',
      `cd ${FRONTEND} && npx playwright install chromium`);
  }

  // 5. 后端服务 (8767)
  const backendUp = await isPortListening(8767);
  if (backendUp) {
    add('pass', '后端服务', '127.0.0.1:8767 可达');
  } else {
    add('warn', '后端服务', '127.0.0.1:8767 未监听',
      `cd ${resolve(FRONTEND, '..', 'backend')}${CMD_SEP} uvicorn app.main:app --port 8767`);
  }

  // 6. 前端服务 (5173 或 5174)
  const frontend5173 = await isPortListening(5173);
  const frontend5174 = await isPortListening(5174);
  if (frontend5173 || frontend5174) {
    add('pass', '前端服务', `5173=${frontend5173} / 5174=${frontend5174}`);
  } else {
    add('warn', '前端服务', '5173/5174 均未监听',
      `cd ${FRONTEND}${CMD_SEP} npm run dev`);
  }

  // 7. 测试脚本
  const e2ePath = join(FRONTEND, 'tests', 'e2e', 'mobile-pwa-flow.spec.ts');
  if (existsSync(e2ePath)) {
    const size = statSync(e2ePath).size;
    add('pass', 'e2e 脚本', `${e2ePath} (${size} bytes)`);
  } else {
    add('fail', 'e2e 脚本', `未找到: ${e2ePath}`,
      '请确认移动端 e2e 测试脚本路径');
  }

  // 8. 磁盘空间
  const free = freemem();
  if (platform() === 'win32') {
    try {
      const wmic = tryExec('wmic logicaldisk get freespace /value 2>nul');
      const match = wmic && wmic.match(/FreeSpace=(\d+)/);
      if (match) {
        const freeGB = Math.round(Number(match[1]) / 1024 / 1024 / 1024);
        if (freeGB >= 1) {
          add('pass', '磁盘空间', `C: ~${freeGB} GB 可用`);
        } else {
          add('warn', '磁盘空间', `C: 仅剩 ${freeGB} GB`, 'chromium 至少需要 300MB');
        }
      }
    } catch {
      add('warn', '磁盘空间', '无法检测 (跳过)', '');
    }
  } else {
    const freeGB = Math.round(free / 1024 / 1024 / 1024);
    if (freeGB >= 1) {
      add('pass', '内存', `${freeGB} GB`);
    }
  }

  // 输出报告
  for (const r of results) {
    const sym = r.level === 'pass' ? PASS : r.level === 'warn' ? WARN : FAIL;
    console.log(`${sym} ${r.name}`);
    console.log(`    ${r.detail}`);
    if (r.fix) {
      console.log(`    \x1b[35m修复:\x1b[0m ${r.fix}`);
    }
    console.log();
  }

  // 汇总 + 一键安装命令
  const fails = results.filter(r => r.level === 'fail');
  const warns = results.filter(r => r.level === 'warn');
  console.log(line('─'));
  console.log(`\x1b[1m汇总: ${results.filter(r => r.level === 'pass').length} 通过 / ${warns.length} 警告 / ${fails.length} 失败\x1b[0m\n`);

  if (fails.length > 0 || warns.length > 0) {
    console.log(`${INFO} 一键修复命令（按顺序执行）:\n`);
    if (IS_PS5) {
      console.log(`  \x1b[35m提示: 检测到 Windows PowerShell 5 (不支持 &&). 请分多行执行或改用分号 " ;" 连接命令.\x1b[0m\n`);
    }
    console.log(`  cd ${FRONTEND}`);
    const needInstall = fails.some(r => r.name.includes('@playwright/test') || r.name.includes('chromium'));
    if (needInstall) console.log('  npm install -D @playwright/test');
    if (needInstall) console.log('  npx playwright install chromium');
    console.log('\n  # 启动后端 (新终端)');
    if (IS_PS5) {
      console.log(`  cd ${resolve(FRONTEND, '..', 'backend')}`);
      console.log('  uvicorn app.main:app --port 8767');
    } else {
      console.log(`  cd ${resolve(FRONTEND, '..', 'backend')} && uvicorn app.main:app --port 8767`);
    }
    console.log('\n  # 启动前端 (新终端)');
    if (IS_PS5) {
      console.log(`  cd ${FRONTEND}`);
      console.log('  npm run dev');
    } else {
      console.log(`  cd ${FRONTEND} && npm run dev`);
    }
    console.log('\n  # 跑 e2e');
    if (IS_PS5) {
      console.log(`  cd ${FRONTEND}`);
      console.log('  npx playwright test tests/e2e/mobile-pwa-flow.spec.ts --reporter=list');
    } else {
      console.log(`  cd ${FRONTEND} && npx playwright test tests/e2e/mobile-pwa-flow.spec.ts --reporter=list`);
    }
    console.log('');
  }

  if (fails.length === 0 && warns.length === 0) {
    console.log(`${PASS} \x1b[32m环境就绪, 可以直接跑 e2e 测试\x1b[0m\n`);
    if (IS_PS5) {
      console.log(`  cd ${FRONTEND}`);
      console.log(`  npx playwright test tests/e2e/mobile-pwa-flow.spec.ts --reporter=list\n`);
    } else {
      console.log(`  cd ${FRONTEND} && npx playwright test tests/e2e/mobile-pwa-flow.spec.ts --reporter=list\n`);
    }
  } else if (fails.length === 0) {
    console.log(`${WARN} 仅警告未阻塞, 但 e2e 需要前后端服务在线, 请先启动后再跑测试\n`);
    if (IS_PS5) {
      console.log('  PS5 小贴士: "cd x ; command" 可替代 "cd x && command"');
    }
  } else {
    console.log(`${FAIL} 存在 ${fails.length} 项必须修复后才能跑 e2e\n`);
    process.exit(1);
  }
}

main().catch(e => {
  console.error(`${FAIL} 检测失败:`, e);
  process.exit(1);
});
