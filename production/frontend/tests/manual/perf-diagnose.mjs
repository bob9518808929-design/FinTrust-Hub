/**
 * 性能诊断: 记录每个页面的网络请求瀑布图, 找出慢请求/pending 请求/连接占用
 *
 * 用法: node tests/manual/perf-diagnose.mjs
 */
import { chromium, devices } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';

const BASE = 'http://localhost:5173';
const ARTIFACTS = 'tests/manual/_artifacts';
mkdirSync(ARTIFACTS, { recursive: true });

const iphone = devices['iPhone 12 Pro'];

const pagesToTest = [
  { name: 'PC-home', url: `${BASE}/`, viewport: { width: 1440, height: 900 } },
  { name: 'PC-bank', url: `${BASE}/bank`, viewport: { width: 1440, height: 900 } },
  { name: 'PC-approval', url: `${BASE}/approval`, viewport: { width: 1440, height: 900 } },
  { name: 'M-login', url: `${BASE}/m/login`, viewport: { width: 390, height: 844 }, mobile: true },
  { name: 'M-scan', url: `${BASE}/m/scan`, viewport: { width: 390, height: 844 }, mobile: true },
];

const allRequests = [];

async function diagnosePage(browser, cfg) {
  const ctx = await browser.newContext({
    viewport: cfg.viewport,
    ...(cfg.mobile ? iphone : {}),
  });
  const page = await ctx.newPage();
  const requests = [];

  page.on('request', (req) => {
    requests.push({
      url: req.url(),
      method: req.method(),
      resourceType: req.resourceType(),
      startedAt: Date.now(),
    });
  });

  page.on('response', async (res) => {
    const idx = requests.findIndex((r) => r.url === res.url() && !r.status);
    if (idx >= 0) {
      requests[idx].status = res.status();
      requests[idx].time = Date.now() - requests[idx].startedAt;
    }
  });

  const start = Date.now();
  await page.goto(cfg.url, { waitUntil: 'networkidle', timeout: 30000 }).catch(e => {
    console.log(`  ⚠️ goto timeout: ${e.message.slice(0, 100)}`);
  });
  const totalLoad = Date.now() - start;

  await page.waitForTimeout(3000);

  // 关闭页面前的网络状态
  const finalRequests = requests.map(r => ({
    url: r.url?.replace(BASE, ''),
    method: r.method,
    type: r.resourceType,
    status: r.status || 'PENDING',
    timeMs: r.time || 'PENDING',
  }));

  // 统计
  const apiReqs = finalRequests.filter(r => r.url.startsWith('/api/'));
  const pending = finalRequests.filter(r => r.timeMs === 'PENDING');
  const slow = finalRequests.filter(r => typeof r.timeMs === 'number' && r.timeMs > 500);

  console.log(`\n[${cfg.name}] ${cfg.url}`);
  console.log(`  总加载: ${totalLoad}ms, 请求总数: ${finalRequests.length}`);
  console.log(`  API 请求: ${apiReqs.length}, PENDING: ${pending.length}, 慢请求(>500ms): ${slow.length}`);

  if (pending.length > 0) {
    console.log(`  ⚠️ PENDING 请求 (${pending.length}):`);
    pending.slice(0, 10).forEach(r => console.log(`     ${r.method} ${r.url} [${r.type}]`));
  }

  if (slow.length > 0) {
    console.log(`  ⚠️ 慢请求 (>500ms, ${slow.length}):`);
    slow.sort((a, b) => b.timeMs - a.timeMs).slice(0, 10).forEach(r =>
      console.log(`     ${r.timeMs}ms ${r.method} ${r.url} [${r.status}]`)
    );
  }

  if (apiReqs.length > 0 && apiReqs.length <= 15) {
    console.log(`  API 详情:`);
    apiReqs.forEach(r => console.log(`     ${r.timeMs}ms ${r.method} ${r.url} [${r.status}]`));
  }

  await page.screenshot({ path: `${ARTIFACTS}/perf-${cfg.name}.png`, fullPage: true });
  allRequests.push({ page: cfg.name, totalLoad, requests: finalRequests });

  await ctx.close();
}

async function main() {
  console.log('=== 性能诊断启动 ===\n');
  const browser = await chromium.launch({ headless: true });

  for (const cfg of pagesToTest) {
    try {
      await diagnosePage(browser, cfg);
    } catch (e) {
      console.log(`\n[${cfg.name}] 异常: ${e.message}`);
    }
  }

  await browser.close();

  // 写报告
  writeFileSync(`${ARTIFACTS}/perf-report.json`, JSON.stringify(allRequests, null, 2));
  console.log(`\n=== 报告: ${ARTIFACTS}/perf-report.json ===`);

  // 总结
  console.log(`\n=== 总结 ===`);
  allRequests.forEach(p => {
    const pending = p.requests.filter(r => r.timeMs === 'PENDING').length;
    const slow = p.requests.filter(r => typeof r.timeMs === 'number' && r.timeMs > 500).length;
    console.log(`${p.page}: 加载${p.totalLoad}ms, PENDING=${pending}, 慢=${slow}`);
  });
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
