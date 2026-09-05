/**
 * src/app.config.ts — Taro 应用全局配置 (页面路由 + 全局窗口样式)
 * -------------------------------------------------------------
 * project_memory: APP-02 企业端移动 APP
 *   - 主包: 首页 (资金水位卡片 + 快捷操作)
 *   - 主包: 扫码页 (调用 ScanInput 组件逻辑)
 *   - 全局窗口: 暗色主题, 与 PC 端保持一致
 */
export default {
  pages: [
    'pages/index/index',
    'pages/scan/index',
  ],
  window: {
    backgroundTextStyle: 'dark',
    navigationBarBackgroundColor: '#0f172a',
    navigationBarTitleText: 'FinTrust Hub',
    navigationBarTextStyle: 'white',
    backgroundColor: '#1e293b',
  },
  // 全局样式 (每个页面自动引入)
  tabBar: {
    color: '#9ca3af',
    selectedColor: '#3b82f6',
    backgroundColor: '#1f2937',
    borderStyle: 'black',
    list: [
      {
        pagePath: 'pages/index/index',
        text: '首页',
        // 图标本地路径 (生产环境替换为真实图标)
        iconPath: 'assets/tab-home.png',
        selectedIconPath: 'assets/tab-home-active.png',
      },
      {
        pagePath: 'pages/scan/index',
        text: '扫一扫',
        iconPath: 'assets/tab-scan.png',
        selectedIconPath: 'assets/tab-scan-active.png',
      },
    ],
  },
  // 网络请求配置 (与 PC 端 client.ts 对齐)
  request: {
    timeout: 30000,
  },
  // 主题
  darkmode: true,
  themeLocation: 'theme.json',
};
