/**
 * 移动端 PWA 全面测试脚本 (Playwright + iPhone 12 Pro 模拟)
 *
 * 用法: node tests/manual/mobile-full-test.mjs
 *
 * 输出: tests/manual/_artifacts/ 下生成截图 + 错误日志 + 结构化报告
 */
import { chromium, devices } from 'playwright';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const BASE = 'http://localhost:5173';
const ARTIFACTS = 'tests/manual/_artifacts';
if (!existsSync(ARTIFACTS)) mkdirSync(ARTIFACTS, { recursive: true });

const iphone = devices['iPhone 12 Pro'];

const result = {
  startedAt: new Date().toISOString(),
  pages: {},
  consoleErrors: [],
  networkErrors: [],
  flowIssues: [],
  buttonIssues: [],
  styleIssues: [],
  severity: { P0: [], P1: [], P2: [] },
};

async function newMobilePage(browser) {
  const ctx = await browser.newContext({
    ...iphone,
    viewport: { width: 390, height: 844 },
    ignoreHTTPSErrors: true,
  });
  const page = await ctx.newPage();

  // 收集控制台和网络错误
  page.on('console', (msg) => {
    const type = msg.type();
    if (type === 'error' || type === 'warning') {
      result.consoleErrors.push({
        page: page.url(),
        type,
        text: msg.text(),
        location: msg.location()?.url,
      });
    }
  });
  page.on('requestfailed', (req) => {
    result.networkErrors.push({
      page: page.url(),
      url: req.url(),
      failure: req.failure()?.errorText,
    });
  });

  return { ctx, page };
}

async function shot(page, name) {
  const path = join(ARTIFACTS, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  return path;
}

async function getPageSummary(page, pageName) {
  const summary = await page.evaluate(() => {
    const body = document.body;
    const html = document.documentElement;
    const bg = window.getComputedStyle(body).backgroundColor;
    const bgHtml = window.getComputedStyle(html).backgroundColor;
    const hasMobileLayout = !!document.querySelector('.mobile-layout');
    const hasAppContainer = !!document.querySelector('.app-container');
    const hasMHeader = !!document.querySelector('.m-header');
    const hasMTabbar = !!document.querySelector('.m-tabbar');
    const buttons = Array.from(document.querySelectorAll('button, .el-button, [role="button"]')).length;
    const inputs = Array.from(document.querySelectorAll('input, textarea, select')).length;
    const toastCount = document.querySelectorAll('.el-message, .el-notification').length;
    return {
      url: window.location.href,
      pathname: window.location.pathname,
      title: document.title,
      bodyBg: bg,
      htmlBg: bgHtml,
      hasMobileLayout,
      hasAppContainer,
      hasMHeader,
      hasMTabbar,
      buttons,
      inputs,
      toastCount,
      scrollHeight: body.scrollHeight,
      viewportW: window.innerWidth,
      viewportH: window.innerHeight,
    };
  });
  result.pages[pageName] = summary;
  return summary;
}

async function main() {
  console.log('=== 启动移动端全面测试 (iPhone 12 Pro 模拟) ===\n');

  const browser = await chromium.launch({ headless: true });
  const { ctx, page } = await newMobilePage(browser);

  // ========== 页面 1: /m/login 登录页 ==========
  console.log('[1/4] 测试 /m/login 登录页');
  try {
    await page.goto(`${BASE}/m/login`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1500);
    const s = await getPageSummary(page, 'login');
    await shot(page, '01-login-initial');
    console.log(`  URL: ${s.url}`);
    console.log(`  布局: ${s.hasMobileLayout ? '✅ MobileLayout' : '❌ 非 MobileLayout (有 PC app-container=' + s.hasAppContainer + ')'}`);
    console.log(`  body 背景: ${s.bodyBg}`);
    console.log(`  按钮: ${s.buttons} 个, 输入框: ${s.inputs} 个`);
    console.log(`  Toast 数: ${s.toastCount}`);

    if (!s.hasMobileLayout) {
      result.severity.P0.push({
        page: '/m/login',
        issue: `未渲染 MobileLayout (hasMobileLayout=false), 实际渲染 PC appContainer=${s.hasAppContainer}`,
        evidence: '01-login-initial.png',
      });
    }

    // 用 placeholder 定位企业码 + 工号 (LoginView 用 ScanInput + el-input)
    const entInput = page.locator('input[placeholder*="企业码"]').first();
    const workerInput = page.locator('input[placeholder*="工号"]').first();
    const entCount = await entInput.count();
    const workerCount = await workerInput.count();
    console.log(`  企业码输入框 count=${entCount}, 工号输入框 count=${workerCount}`);

    if (entCount > 0 && workerCount > 0) {
      await entInput.fill('E001');
      await workerInput.fill('W01');
      await shot(page, '02-login-filled');
      console.log('  已填表 E001 / W01');
    } else {
      result.severity.P0.push({
        page: '/m/login',
        issue: `找不到企业码或工号输入框 (ent=${entCount}, worker=${workerCount})`,
      });
    }

    // 找提交按钮 (native-type="submit")
    const submitBtn = page.locator('button[type="submit"], button.el-button--primary').first();
    const btnCount = await submitBtn.count();
    console.log(`  提交按钮 count=${btnCount}`);
    if (btnCount > 0) {
      await submitBtn.click({ timeout: 5000 }).catch(e => {
        result.buttonIssues.push({ page: '/m/login', button: '提交', error: e.message });
      });
      await page.waitForTimeout(3000);
      await shot(page, '03-login-after-click');
      const after = await getPageSummary(page, 'login-after');
      console.log(`  点击后 URL: ${after.url}`);
      if (after.url.includes('/m/scan')) {
        console.log('  ✅ 登录后正确跳转 /m/scan');
      } else {
        // 检查是否有错误 toast
        const toastTexts = await page.locator('.el-message, .el-notification').allTextContents();
        console.log(`  Toast 内容: ${JSON.stringify(toastTexts)}`);
        result.flowIssues.push({
          page: '/m/login',
          issue: `登录后未跳 /m/scan, 实际跳到 ${after.url}, toast=${toastTexts.join(';')}`,
        });
        result.severity.P0.push({
          page: '/m/login',
          issue: `登录后跳转错误: 期望 /m/scan, 实际 ${after.pathname}, toast=${toastTexts.join(';')}`,
        });
      }
    }
  } catch (e) {
    result.severity.P0.push({ page: '/m/login', issue: `测试异常: ${e.message}` });
    console.log(`  ❌ 异常: ${e.message}`);
  }

  // ========== 页面 2: /m/scan 扫码确权页 ==========
  console.log('\n[2/4] 测试 /m/scan 扫码确权页');
  try {
    await page.goto(`${BASE}/m/scan`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1500);
    const s = await getPageSummary(page, 'scan');
    await shot(page, '04-scan-initial');
    console.log(`  URL: ${s.url}`);
    console.log(`  布局: ${s.hasMobileLayout ? '✅ MobileLayout' : '❌ 非 MobileLayout'}`);
    console.log(`  按钮: ${s.buttons} 个`);
    console.log(`  body 背景: ${s.bodyBg}`);

    if (!s.hasMobileLayout) {
      result.severity.P0.push({ page: '/m/scan', issue: `未渲染 MobileLayout` });
    }

    // 找扫码/拍照按钮
    const allButtons = await page.locator('button, .el-button, [role="button"]').allTextContents();
    console.log(`  按钮文本: ${JSON.stringify(allButtons.slice(0, 10))}`);

    // 测试离线降级
    await page.context().setOffline(true);
    await page.waitForTimeout(2000);
    await shot(page, '05-scan-offline');
    const offlineToast = await page.locator('.el-message, .el-notification').count();
    console.log(`  离线后 Toast 数: ${offlineToast}`);
    if (offlineToast === 0) {
      result.severity.P1.push({
        page: '/m/scan',
        issue: '断网后未显示 toast 提示 (期望"网络异常"toast)',
      });
    }
    await page.context().setOffline(false);
  } catch (e) {
    result.severity.P0.push({ page: '/m/scan', issue: `测试异常: ${e.message}` });
    console.log(`  ❌ 异常: ${e.message}`);
  }

  // ========== 页面 3: /m/pts 积分钱包页 ==========
  console.log('\n[3/4] 测试 /m/pts 积分钱包页');
  try {
    await page.goto(`${BASE}/m/pts`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1500);
    const s = await getPageSummary(page, 'pts');
    await shot(page, '06-pts-initial');
    console.log(`  URL: ${s.url}`);
    console.log(`  布局: ${s.hasMobileLayout ? '✅ MobileLayout' : '❌ 非 MobileLayout'}`);
    console.log(`  按钮: ${s.buttons} 个`);

    if (!s.hasMobileLayout) {
      result.severity.P0.push({ page: '/m/pts', issue: `未渲染 MobileLayout` });
    }

    // 检查积分数字发光
    const numberStyles = await page.evaluate(() => {
      const nums = Array.from(document.querySelectorAll('.pts-amount, .points-value, [class*="amount"], [class*="points"], [class*="balance"]')).slice(0, 3);
      return nums.map(n => ({
        text: n.textContent?.slice(0, 30),
        color: window.getComputedStyle(n).color,
        textShadow: window.getComputedStyle(n).textShadow,
      }));
    });
    console.log(`  数字元素: ${JSON.stringify(numberStyles)}`);
  } catch (e) {
    result.severity.P0.push({ page: '/m/pts', issue: `测试异常: ${e.message}` });
    console.log(`  ❌ 异常: ${e.message}`);
  }

  // ========== 页面 4: /m/bot 我的分身 Bot 聊天 ==========
  console.log('\n[4/4] 测试 /m/bot 我的分身 Bot 聊天');
  try {
    await page.goto(`${BASE}/m/bot`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1500);
    const s = await getPageSummary(page, 'bot');
    await shot(page, '07-bot-initial');
    console.log(`  URL: ${s.url}`);
    console.log(`  布局: ${s.hasMobileLayout ? '✅ MobileLayout' : '❌ 非 MobileLayout'}`);
    console.log(`  按钮: ${s.buttons} 个, 输入框: ${s.inputs} 个`);

    if (!s.hasMobileLayout) {
      result.severity.P0.push({ page: '/m/bot', issue: `未渲染 MobileLayout` });
    }

    // 找输入框发消息
    const msgInput = page.locator('textarea, input[type="text"], input[placeholder*="消息"], input[placeholder*="输入"]').last();
    const inputCount = await msgInput.count();
    console.log(`  聊天输入框 count=${inputCount}`);
    if (inputCount > 0) {
      await msgInput.fill('你好');
      await shot(page, '08-bot-typed');
      const sendBtn = page.locator('button:has-text("发送"), button[type="submit"], .send-btn').first();
      if (await sendBtn.count() > 0) {
        await sendBtn.click({ timeout: 3000 }).catch(e => {
          result.buttonIssues.push({ page: '/m/bot', button: '发送', error: e.message });
        });
        await page.waitForTimeout(5000);
        await shot(page, '09-bot-after-send');
        const after = await getPageSummary(page, 'bot-after');
        console.log(`  发送后 Toast 数: ${after.toastCount}`);
      }
    }
  } catch (e) {
    result.severity.P0.push({ page: '/m/bot', issue: `测试异常: ${e.message}` });
    console.log(`  ❌ 异常: ${e.message}`);
  }

  await ctx.close();
  await browser.close();

  result.endedAt = new Date().toISOString();

  // 写报告
  const reportPath = join(ARTIFACTS, 'mobile-test-report.json');
  writeFileSync(reportPath, JSON.stringify(result, null, 2));
  console.log(`\n=== 测试完成, 报告: ${reportPath} ===`);
  console.log(`\n=== 严重度汇总 ===`);
  console.log(`P0 (阻断): ${result.severity.P0.length} 条`);
  console.log(`P1 (严重): ${result.severity.P1.length} 条`);
  console.log(`P2 (细节): ${result.severity.P2.length} 条`);
  console.log(`\n控制台错误: ${result.consoleErrors.length} 条`);
  console.log(`网络错误: ${result.networkErrors.length} 条`);
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
