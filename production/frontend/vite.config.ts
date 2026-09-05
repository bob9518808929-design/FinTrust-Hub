/**
 * vite.config.ts — FinTrust Hub 前端 Vite 构建配置
 *
 * 设计依据: spec.md v3.1 L3499 前端技术栈 "Vue 3 + TypeScript + Element Plus + ECharts"
 * 关键特性:
 *   1. Element Plus 按需自动导入 (unplugin-vue-components + unplugin-auto-import)
 *   2. Vue 3 + JSX 双支持 (SFC 优先, 复杂逻辑用 JSX)
 *   3. 路径别名 @ → src/, @contracts → ../contracts
 *   4. 后端代理: /api → http://localhost:8000 (FastAPI), /ws → WebSocket
 *   5. 生产构建 chunk 分包 (vue/element/echarts/其他)
 */

import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import vueJsx from '@vitejs/plugin-vue-jsx';
import AutoImport from 'unplugin-auto-import/vite';
import Components from 'unplugin-vue-components/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const isProd = mode === 'production';
  // proxy 转发目标：优先 VITE_PROXY_TARGET（仅服务器端转发，不影响浏览器 baseURL），
  // 其次 VITE_BACKEND_URL，最后默认 8000。
  // 注意：VITE_BACKEND_URL 同时被 client.ts 用作直连 baseURL，非空时会绕过 proxy 且丢失 /api/v1 前缀；
  // 本地改端口联调请用 VITE_PROXY_TARGET（浏览器仍走相对路径 /api/v1 → proxy 转发）。
  const backendUrl = env.VITE_PROXY_TARGET || env.VITE_BACKEND_URL || 'http://localhost:8000';

  return {
    plugins: [
      vue(),
      vueJsx(),
      AutoImport({
        imports: ['vue', 'vue-router', 'pinia', '@vueuse/core'],
        resolvers: [ElementPlusResolver()],
        dts: 'src/auto-imports.d.ts',
        eslintrc: { enabled: true, filepath: './.eslintrc-auto-import.json' },
      }),
      Components({
        resolvers: [ElementPlusResolver()],
        dts: 'src/components.d.ts',
        dirs: ['src/components'],
      }),
      // === PWA 插件 (injectManifest 策略, SW 源码 src/sw.ts) ===
      // 设计依据: APP02_MOBILE_PLAN.md §4.2 Task 1.3
      VitePWA({
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        registerType: 'prompt',
        injectManifest: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        },
        // 使用独立 manifest.json (不在此声明 manifest 字段)
        manifest: false,
        // dev 环境不启用 SW (避免热更新冲突)
        devOptions: {
          enabled: false,
        },
      }),
    ],

    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '@contracts': fileURLToPath(new URL('../contracts', import.meta.url)),
      },
      extensions: ['.ts', '.js', '.vue', '.tsx', '.jsx', '.json'],
    },

    css: {
      preprocessorOptions: {
        scss: {
          additionalData: `@use "@/styles/variables.scss" as *;`,
        },
      },
    },

    // APP-02: 注入应用版本号常量, 供 client.ts 在 X-App-Version header 中携带
    define: {
      __APP_VERSION__: JSON.stringify(env.VITE_APP_VERSION || '3.1.0'),
    },

    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: false,
      open: false,
      proxy: {
        '/api': {
          target: backendUrl,
          changeOrigin: true,
          rewrite: (path) => path,
          /**
           * 超时设置:
           *   - 普通接口后端本身极快 (健康检查 6-22ms), 不受超时影响.
           *   - 后端未启动时连接立即 ECONNREFUSED, 也不靠超时快速失败.
           *   - 但 DeepSeek LLM 调用 (R1 画像 / deep_score / 合同提取) 通常 2-10s,
           *     原 3500ms 会切断 AI 请求 → 前端报错重试 → 卡顿. 故放宽到 65s.
           *   - timeout: 客户端→proxy 等待; proxyTimeout: proxy→后端等待.
           */
          timeout: 65000,
          proxyTimeout: 65000,
        },
        '/ws': {
          target: backendUrl.replace('http', 'ws'),
          ws: true,
          changeOrigin: true,
        },
      },
    },

    build: {
      target: 'es2020',
      outDir: 'dist',
      assetsDir: 'assets',
      sourcemap: !isProd,
      chunkSizeWarningLimit: 1500,
      rollupOptions: {
        output: {
          manualChunks: {
            'vue-vendor': ['vue', 'vue-router', 'pinia'],
            'element-vendor': ['element-plus', '@element-plus/icons-vue'],
            'echarts-vendor': ['echarts', 'vue-echarts'],
            'utils-vendor': ['axios', 'dayjs', 'lodash-es', '@vueuse/core'],
          },
        },
      },
    },

    optimizeDeps: {
      include: ['vue', 'vue-router', 'pinia', 'element-plus', 'echarts', 'axios', 'dayjs'],
      exclude: ['@contracts'],
    },

    esbuild: {
      drop: isProd ? ['console', 'debugger'] : [],
    },
  };
});
