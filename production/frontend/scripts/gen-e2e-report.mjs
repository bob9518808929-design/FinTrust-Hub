#!/usr/bin/env node
/**
 * scripts/gen-e2e-report.mjs — Playwright 本次 run 的 Markdown 测试报告生成器
 *
 * 设计原则 (Experience 382921 证据链硬约束):
 *   1. 报告只引用本次 RUN_ID 目录里的截图/trace/json, 禁止回退到历史文件
 *   2. 找不到本次截图 → 明确标记"本次未产出截图", 不瞎拼
 *   3. 统计数字从 PLAYWRIGHT_JSON_REPORTER 的权威 JSON 读取, 不自算
 *
 * 依赖:
 *   - playwright.config.ts 配置了 json reporter 输出到 test-results/<RUN_ID>-results.json
 *   - screenshot='on' → 每个 test case 在 test-results/<RUN_ID>-artifacts/*/<test-file-name>/test.png
 *   - trace='retain-on-failure' → 失败用例保留 trace.zip
 *
 * 使用 (PS5 用户, 命令分开执行):
 *   $env:RUN_ID = (Get-Date -Format 'yyyyMMdd-HHmmss')
 *   npx playwright test tests/e2e/mobile-pwa-flow.spec.ts --project=mobile-chrome --reporter=list
 *   node scripts/gen-e2e-report.mjs
 *   # → 产出: test-results/$RUN_ID-report.md + 控制台摘要
 */
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, basename, relative, dirname } from 'node:path';

const FRONTEND = resolve(process.cwd());
const TEST_RESULTS = join(FRONTEND, 'test-results');

function findLatestJsonRunId(): string | null {
  // 1) 优先 $env:RUN_ID (与 playwright.config.ts 一致)
  if (process.env.RUN_ID && existsSync(join(TEST_RESULTS, `${process.env.RUN_ID}-results.json`))) {
    return process.env.RUN_ID;
  }
  // 2) 没指定 → 选 test-results/*-results.json 最新的一个
  if (!existsSync(TEST_RESULTS)) return null;
  const candidates = readdirSync(TEST_RESULTS)
    .filter(f => f.endsWith('-results.json'))
    .map(f => ({ name: f.slice(0, -'-results.json'.length), mtime: statSync(join(TEST_RESULTS, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return candidates[0]?.name ?? null;
}

const RUN_ID = findLatestJsonRunId();

if (!RUN_ID) {
  console.error('\x1b[31m[gen-e2e-report] 找不到本次运行的 *-results.json\x1b[0m');
  console.error('请先执行: npx playwright test tests/e2e/mobile-pwa-flow.spec.ts --project=mobile-chrome --reporter=list');
  process.exit(1);
}

const JSON_PATH = join(TEST_RESULTS, `${RUN_ID}-results.json`);
const ARTIFACTS_DIR = join(TEST_RESULTS, `${RUN_ID}-artifacts`);
const HTML_REPORT_DIR = join(FRONTEND, 'playwright-report', RUN_ID);
const REPORT_PATH = join(TEST_RESULTS, `${RUN_ID}-report.md`);

console.log(`\n\x1b[36m检测到本次 RUN_ID = ${RUN_ID}\x1b[0m`);
console.log(`  JSON   : ${JSON_PATH}`);
console.log(`  截图   : ${ARTIFACTS_DIR}`);
console.log(`  HTML   : ${existsSync(HTML_REPORT_DIR) ? HTML_REPORT_DIR : '(未产出或目录不存在)'}\n`);

const REPORT = JSON.parse(readFileSync(JSON_PATH, 'utf-8'));

/**
 * 找该 test 的截图 (screenshot='on' 时 Playwright 固定在 case-dir/test-1.png ...)
 * 规则: 只搜 <ARTIFACTS_DIR>/<test-title-slug>*/ 下的 *.png, 找不到不回退历史
 */
function findScreenshotsForTest(test: any): string[] {
  if (!existsSync(ARTIFACTS_DIR)) return [];
  // Playwright 把 test path 做 slug, 目录形如:
  //   mobile-pwa-flow-spec-ts-app-02-award-jiang-ji-fen-zhi-15-jiang-ji-fen-zhi4-wan-zheng-yi-dong-duan-zheng-ju
  // 用 test._testId / title 匹配太脆弱, 改为: 用每个 spec 的 suite 层级 slug 匹配
  // 最稳妥: 遍历所有 png, 返回按 case 对应目录的 (用 test.file + line 的指纹匹配)
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '');
  const fileSlug = basename(test.path.join('-'), '.ts').replace(/[^a-z0-9]/gi, '-')
    .replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();

  // Playwright test-results 目录命名 = "<slug-of-title>-<line>". 取 case title.slug + line
  const titleSlug = slug(test.title);
  const line = test.line ? String(test.line) : '';

  const matches: string[] = [];
  for (const sub of readdirSync(ARTIFACTS_DIR)) {
    const abs = join(ARTIFACTS_DIR, sub);
    if (!statSync(abs).isDirectory()) continue;
    // 命中规则: dir 以 fileSlug 开头 + 包含 titleSlug 关键词 (或至少 title 中的编号 X 命中)
    const lower = sub.toLowerCase();
    const hit = lower.startsWith(`${fileSlug}-`) &&
                (lower.includes(titleSlug.slice(0, 30)) || /[\u4e00-\u9fa5]/.test(sub) ? true : false);
    if (!hit) continue;
    for (const f of readdirSync(abs)) {
      if (f.endsWith('.png')) matches.push(join(abs, f));
    }
  }
  // 还没命中 → 退而求其次: line 号精确命中的目录 (数字匹配)
  if (matches.length === 0 && line) {
    for (const sub of readdirSync(ARTIFACTS_DIR)) {
      const abs = join(ARTIFACTS_DIR, sub);
      if (!statSync(abs).isDirectory()) continue;
      if (!sub.includes(`-${line}`)) continue;
      for (const f of readdirSync(abs)) {
        if (f.endsWith('.png')) matches.push(join(abs, f));
      }
    }
  }
  return matches;
}

function pad(n: number, w = 2) { return String(n).padStart(w, '0'); }
function fmtDuration(ms: number) {
  const s = Math.round(ms) / 1000;
  return `${s.toFixed(2)}s`;
}

function fmtDT(tsIso: string) {
  const d = new Date(tsIso);
  if (isNaN(d.getTime())) return tsIso;
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// 汇总统计 (来自权威 JSON, 不自算)
const totalTests = REPORT.stats?.expected ?? (REPORT.suites?.reduce((acc: number, s: any) => acc + (s.specs?.length ?? 0), 0) || 0);
const passed = REPORT.stats?.passed ?? 0;
const failed = REPORT.stats?.failed ?? 0;
const skipped = REPORT.stats?.skipped ?? 0;
const flaky = REPORT.stats?.flaky ?? 0;
const duration = REPORT.stats?.duration ?? 0;
const startTime = REPORT.startTime ?? new Date().toISOString();

function* iterTests(suites: any[]): Generator<any, void, unknown> {
  for (const s of suites ?? []) {
    for (const sp of s.specs ?? []) {
      for (const tc of sp.tests ?? []) {
        for (const result of tc.results ?? []) {
          yield {
            suite: s.title,
            title: sp.title,
            file: s.file,
            line: sp.line,
            column: sp.column,
            status: result.status,   // expected | unexpected | skipped | ...
            duration: result.duration,
            errors: result.errors,
            stdout: result.stdout,
            stderr: result.stderr,
            retry: result.retry,
            startTime: result.startTime,
            path: [basename(s.file, '.ts'), s.title, sp.title].filter(Boolean),
          };
        }
      }
    }
    if (s.suites?.length) yield* iterTests(s.suites);
  }
}

const allTests = Array.from(iterTests(REPORT.suites ?? []));

// ===== 写 Markdown =====
let md = '';
md += `# APP-02 移动端 PWA E2E 测试报告\n\n`;
md += `> **RUN_ID**: \`${RUN_ID}\`  \n`;
md += `> **生成时间**: ${fmtDT(new Date().toISOString())}  \n`;
md += `> **测试启动时间**: ${fmtDT(startTime)}  \n`;
md += `> **Playwright 配置**: \`playwright.config.ts\` (mobile-chrome / Pixel 5 / screenshot=on)  \n`;
md += `> **证据链来源约束**: 本报告截图仅来自 \`test-results/${RUN_ID}-artifacts/\` 和 \`test-results/${RUN_ID}-results.json\`  \n\n`;

md += `## 一、汇总\n\n`;
md += `| 指标 | 值 |\n|---|---|\n`;
md += `| 总用例数 | ${totalTests} |\n`;
md += `| ✅ 通过 | ${passed} |\n`;
md += `| ❌ 失败 | ${failed} |\n`;
md += `| ⚠️ 跳过 | ${skipped} |\n`;
md += `| 🎲 flaky (同 case 重试后通过) | ${flaky} |\n`;
md += `| 总耗时 | ${fmtDuration(duration)} |\n`;
md += `| 通过率 | ${totalTests > 0 ? Math.round(passed * 1000 / totalTests) / 10 : 0}% |\n`;
md += `| 前端服务 | \`${process.env.E2E_FRONTEND_URL ?? 'http://127.0.0.1:5173 (默认)'}\` |\n\n`;

md += `## 二、降级分支覆盖矩阵\n\n`;
md += `> 来源: [CHANGES_APP02_DEGRADATION_LOGS.md §7/8](../docs/CHANGES_APP02_DEGRADATION_LOGS.md) 定义的 后端 award 5场景 + 前端断网 1场景\n\n`;

const coverageMatrix = [
  { n: 1, name: 'PC 端无字段 (无 evidence/location/X-Client-Type)', e2e: 12, level: '后端' },
  { n: 2, name: '仅 evidence, 缺 location', e2e: 13, level: '后端' },
  { n: 3, name: '仅 location, 缺 evidence', e2e: 14, level: '后端' },
  { n: 4, name: '移动端完整证据 + fromMobile → 异步上链不阻塞', e2e: 15, level: '后端' },
  { n: 5, name: 'chain_service 不可达 → award 返回 200 不阻塞', e2e: 16, level: '后端' },
  { n: 6, name: '断网/超时 → 前端入 IndexedDB → pending-banner', e2e: 17, level: '前端' },
];
md += `| # | 场景 | 覆盖层 | E2E case | 本报告 case 结果 |\n|---|---|---|---|---|\n`;
for (const row of coverageMatrix) {
  const matched = allTests.find(t => t.title.startsWith(`${row.e2e}. `));
  const emoji = !matched ? '❔未匹配' : matched.status === 'expected' || matched.status === 'passed' ? '✅通过' : '❌失败';
  md += `| ${row.n} | ${row.name} | ${row.level} | case-${row.e2e} | ${emoji} |\n`;
}
md += '\n';

md += `## 三、逐条用例详情（含截图 + 控制台日志）\n\n`;

const grouped: Record<string, any[]> = {};
for (const t of allTests) {
  const key = t.suite || '未分组';
  (grouped[key] ||= []).push(t);
}

for (const [suite, cases] of Object.entries(grouped)) {
  md += `### ${suite}\n\n`;
  for (const t of cases) {
    const pass = t.status === 'expected' || t.status === 'passed';
    const icon = pass ? '✅' : t.status === 'skipped' ? '⚠️' : '❌';
    md += `#### ${icon} ${t.title}\n\n`;
    md += `- **状态**: \`${t.status}\`\n`;
    md += `- **耗时**: ${fmtDuration(t.duration)}\n`;
    md += `- **文件位置**: \`${t.file}:${t.line}:${t.column}\`\n`;
    md += `- **重试次数**: ${t.retry}\n`;
    if (t.startTime) md += `- **执行时刻**: ${fmtDT(t.startTime)}\n`;
    md += '\n';

    // 截图 (仅本次 RUN_ID, 找不到 → 明确标记)
    const shots = findScreenshotsForTest(t);
    if (shots.length > 0) {
      md += `**截图 (本次 run 产物)**:\n\n`;
      shots.forEach((png, i) => {
        const rel = relative(dirname(REPORT_PATH), png).replace(/\\/g, '/');
        md += `![${t.title} step-${i+1}](${rel})\n\n`;
      });
    } else {
      md += `> ⚠️ **本次 RUN_ID 下未找到该用例截图** (截图目录: \`test-results/${RUN_ID}-artifacts/\`)\n\n`;
    }

    // stderr / stdout (前端日志, e.g. [imageCompress] warn)
    const logs: string[] = [];
    for (const item of [...(t.stdout ?? []), ...(t.stderr ?? [])]) {
      const text = typeof item === 'string' ? item : item?.text ?? '';
      if (text && text.trim()) logs.push(text);
    }
    if (logs.length > 0) {
      md += `**控制台日志 (stdout+stderr)**:\n\n`;
      md += '```\n' + logs.join('\n').slice(0, 4000) + (logs.join('\n').length > 4000 ? '\n...(truncated)' : '') + '\n```\n\n';
    }

    // 错误信息 (失败时)
    if (t.errors && t.errors.length > 0) {
      md += `**错误详情**:\n\n`;
      for (let i = 0; i < t.errors.length; i++) {
        const e = t.errors[i];
        md += `##### Error ${i + 1}\n\n`;
        md += '```\n' + (e.message || String(e)).slice(0, 3000) + '\n```\n\n';
        if (e.snippet) md += '<details><summary>代码定位</summary>\n\n```\n' + e.snippet.slice(0, 2000) + '\n```\n\n</details>\n\n';
      }
      md += `> 可回溯完整 trace (Playwright show-trace):\n> \`npx playwright show-trace "test-results/${RUN_ID}-artifacts/<case-dir>/trace.zip"\`\n\n`;
    }

    md += '---\n\n';
  }
}

md += `## 四、其他产物索引\n\n`;
if (existsSync(HTML_REPORT_DIR)) {
  const idx = join(HTML_REPORT_DIR, 'index.html');
  const rel = relative(dirname(REPORT_PATH), idx).replace(/\\/g, '/');
  md += `- Playwright HTML 交互式报告: [\`playwright-report/${RUN_ID}/index.html\`](${rel}) (在浏览器中打开, 支持点击用例查看截图+时间线)\n`;
} else {
  md += `- Playwright HTML 报告目录 \`playwright-report/${RUN_ID}/\` 不存在 (可能未生成)\n`;
}
md += `- 本次 JSON 全量明细: \`${basename(JSON_PATH)}\`\n`;
md += `- 本次产物目录: \`test-results/${RUN_ID}-artifacts/\` (截图 + trace.zip)\n\n`;

md += `## 五、遗留 / 建议\n\n`;
md += `以下部分 **Playwright 桌面 Chromium 无法覆盖**, 需在 Android 真机 Chrome 104+ 或 BrowserStack 手动验证:\n\n`;
md += `1. 真实扫码 (BarcodeDetector API)  → ScanInput 组件\n`;
md += `2. 真实相机拍照 + capture="environment" 调用后置相机 → <input type=file accept=image/* capture>\n`;
md += `3. 三模定位 (GPS 主路径 + WiFi 指纹兜底 + 10m 内人工修正围栏) → \`useGeolocation.ts\`\n`;
md += `4. Service Worker BackgroundSync 离线队列 (真实断网 → 再联网 → onSync 恢复) → 需要 chrome://inspect/#service-workers 调试\n`;
md += `5. HEIC / >20MB / EXIF 旋转 等真实图片输入 → \`compressImage.ts\` 的 8 条分支由 vitest 覆盖, 但最终端到端需要真机导入真实照片\n\n`;

md += `## 六、Playwright 重试指引 (PS5 用户)\n\n`;
md += `若失败用例需要重跑, 不要用 \`&&\`, 分两行:\n\n`;
md += '```powershell\n';
md += `$env:RUN_ID = (Get-Date -Format 'yyyyMMdd-HHmmss')\n`;
md += `npx playwright test tests/e2e/mobile-pwa-flow.spec.ts --project=mobile-chrome --grep "case名" --reporter=list\n`;
md += `node scripts/gen-e2e-report.mjs\n`;
md += '```\n\n';

mkdirSync(TEST_RESULTS, { recursive: true });
writeFileSync(REPORT_PATH, md, 'utf-8');
console.log(`\x1b[32m✅ Markdown 报告已生成: ${REPORT_PATH}\x1b[0m`);
console.log(`   (${md.length / 1024 | 0} KB, ${allTests.length} 条用例, ${passed}/${totalTests} 通过)`);

// 控制台摘要
console.log('\n\x1b[1m━━━ 控制台摘要 ━━━\x1b[0m');
console.log(`RUN_ID : ${RUN_ID}`);
console.log(`通过率 : ${passed}/${totalTests} (${totalTests > 0 ? Math.round(passed * 1000 / totalTests) / 10 : 0}%)  ❌ ${failed}  ⚠️ ${skipped}  🎲 ${flaky}`);
console.log(`时长   : ${fmtDuration(duration)}`);
for (const t of allTests) {
  const sym = t.status === 'expected' || t.status === 'passed' ? '✓' : t.status === 'skipped' ? '!' : '✗';
  console.log(`  ${sym} ${t.title}  (${fmtDuration(t.duration)})`);
}
