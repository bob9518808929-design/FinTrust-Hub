import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright 配置 - APP-02 移动端 PWA e2e
 *
 * 证据链原则 (匹配 Experience 382921 教训):
 *   - 截图/报告/trace 全部带 RUN_ID 前缀 (用户本地终端每次跑生成唯一 ID)
 *   - 禁止引用其他 run_id 的截图, 缺失时明确标记"本次未产出"
 *   - 报告只做索引: test-results/<run_id>-*/ + playwright-report/<run_id>-index.html
 *
 * 降级分支覆盖 (匹配 Experience 272545 教训):
 *   - 用 page.route 拦截 /api/v1/eco-pts/award, 验证请求字段 presence/absence → 模拟降级响应
 *   - 避免缺接口 mock 导致"停留在扫码/无法推进"的连锁失败
 *
 * 使用 (PS5 用户: 命令分开执行):
 *   $env:RUN_ID = (Get-Date -Format 'yyyyMMdd-HHmmss')
 *   npx playwright test tests/e2e/mobile-pwa-flow.spec.ts --project=mobile-chrome --reporter=list
 *   node scripts/gen-e2e-report.mjs
 */
const RUN_ID = process.env.RUN_ID || `local-${Date.now()}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  /**
   * 报告器三层:
   *   1) list        — 控制台实时进度 (用户看)
   *   2) html        — 可交互 UI, 内嵌截图/trace, 文件名带 run_id
   *   3) json        — 机器可读, 供 gen-e2e-report.mjs 聚合为 Markdown
   */
  reporter: [
    ['list'],
    ['html', {
      open: 'never',
      outputFolder: `playwright-report/${RUN_ID}`,
    }],
    ['json', { outputFile: `test-results/${RUN_ID}-results.json` }],
  ],
  timeout: 30000,
  expect: { timeout: 10000 },
  use: {
    baseURL: process.env.E2E_FRONTEND_URL || 'http://127.0.0.1:5173',
    /**
     * screenshot = 'on' — 每个用例不论成败都截图, 保障"每个步骤的截图"可追溯.
     * 对比默认 only-on-failure: 报告里成功用例也有截图作为证据.
     */
    screenshot: 'on',
    /**
     * trace = 'retain-on-failure' — 失败保留全量 trace,
     * 成功不保留 (避免 30MB/case 冗余). 失败时用
     * `npx playwright show-trace test-results/.../trace.zip` 可回溯.
     */
    trace: 'retain-on-failure',
    video: 'off',
    /**
     * channel: 'chrome' — 使用系统已安装 Chrome, 不强制下 ms-playwright/chromium-1217
     * (用户机器上两者都有, 任一 OK).
     */
    channel: 'chrome',
    // 当前测试断言文本中文, 以 zh-CN 作为 accept-language
    locale: 'zh-CN',
  },
  projects: [
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 5'],
        channel: 'chrome',
      },
    },
  ],
  /**
   * test-results 目录: 每个 RUN_ID 独立前缀, 报告脚本按 RUN_ID 过滤,
   * 避免引用历史截图 (Experience 382921 硬伤).
   */
  outputDir: `test-results/${RUN_ID}-artifacts`,
  // 优先复用用户已启动的 5173 dev server, 不要重启
  webServer: {
    command: 'npm run dev',
    url: process.env.E2E_FRONTEND_URL || 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 60000,
  },
});
