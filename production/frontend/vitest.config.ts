/**
 * vitest.config.ts - FinTrust Hub 前端单元测试配置
 *
 * 设计依据:
 *   - 使用 vitest (Vite 原生集成, 无需额外转译)
 *   - jsdom 环境模拟 DOM (用于挂载 Vue 组件)
 *   - 复用 vite.config.ts 的别名/SCSS 配置
 *   - 测试文件约定: src 下 __tests__ 目录中的 .spec.ts 文件
 *   - CSS/SCSS 文件在测试环境中 stub (避免 element-plus 样式导入失败)
 */
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig({ mode: 'test', command: 'serve' }),
  defineConfig({
    test: {
      globals: true,
      environment: 'jsdom',
      include: ['src/**/__tests__/**/*.spec.ts', 'src/**/*.{test,spec}.ts', 'tests/unit/**/*.spec.ts'],
      // 启用 CSS 处理 (避免 element-plus .css 导入报错)
      css: false,
      // 服务器配置以处理 .css/.scss 文件
      server: {
        deps: {
          // 内联 element-plus 以正确处理其 CSS 导入
          inline: [/element-plus/, /@element-plus/],
        },
      },
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html'],
      },
    },
  }),
);
