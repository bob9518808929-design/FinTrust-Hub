/**
 * config/index.ts — Taro 多端编译配置
 * -------------------------------------------------------------
 * project_memory: APP-02 企业端移动 APP
 *   - 多端编译: 微信小程序 (weapp) / 支付宝小程序 (alipay) / H5
 *   - 设计依据: APP02_MOBILE_PLAN.md (与 PC 端 PWA 双轨, 本项目为 Taro 跨端补充)
 *   - 后端 API: 复用 PC 端 /api/v1, 通过 VITE_BACKEND_URL 或 devServer.proxy 注入
 *
 * 设计哲学 (project_memory 傻瓜式操作):
 *   责任链工人(仓管/物流)不会打字, 在手机上只需两件事:
 *     1. 看企业资金水位卡片 (是否触发还款悬崖)
 *     2. 扫码确权 (扫发票/集装箱号自动填空)
 */
import { defineConfig, type UserConfigExport } from '@tarojs/cli';
import path from 'node:path';
import { componentConfig } from './component';
import { devConfig } from './dev';
import { prodConfig } from './prod';

// https://taro-docs.jd.com/docs/next/config#defineconfig-辅助函数
export default defineConfig<'react'>(async (merge) => {
  const baseConfig: UserConfigExport<'react'> = {
    projectName: 'fintrust-hub-mobile',
    date: '2026-8-20',
    designWidth: 750,
    deviceRatio: {
      640: 2.34 / 2,
      750: 1,
      375: 2,
      828: 1.81 / 2,
    },
    sourceRoot: 'src',
    outputRoot: 'dist',
    plugins: [],
    defineConstants: {
      // 注入应用版本号 (供 X-App-Version header 使用)
      __APP_VERSION__: JSON.stringify('3.1.0'),
    },
    copy: {
      patterns: [
        // 复制静态资源到 dist (如图标/字体)
      ],
      options: {},
    },
    framework: 'react',
    compiler: 'webpack5',
    cache: {
      enable: false,
    },
    sass: {
      // 注入全局变量 (与 PC 端 variables.scss 对齐)
      data: `@import "@/styles/variables.scss";`,
    },
    alias: {
      '@': path.resolve(__dirname, '..', 'src'),
    },
    // 小程序端全局配置 (与 PC 端 PWA 一致的暗色主题)
    mini: {
      ...componentConfig,
      postcss: {
        pxtransform: {
          enable: true,
          config: {},
        },
        cssModules: {
          enable: false,
          config: {
            namingPattern: 'module',
            generateScopedName: '[name]__[local]___[hash:base64:5]',
          },
        },
      },
      // 小程序分包 (主包只含 index, scan 单独分包减小主包体积)
      ...merge(
        {},
        {
          commonChunks: ['runtime', 'vendors', 'taro', 'react', 'common'],
          addChunkPages(pages) {
            pages.set('pages/scan/index', ['pages/scan/scan']);
          },
        },
      ),
    },
    // H5 端配置 (与 PC 端 PWA 互为补充)
    h5: {
      ...componentConfig,
      devServer: {
        host: '0.0.0.0',
        port: 10086,
        // 后端 API 代理 (与 PC 端 Vite 代理对齐)
        proxy: {
          '/api': {
            target: process.env.VITE_BACKEND_URL || 'http://localhost:8000',
            changeOrigin: true,
          },
        },
      },
      router: {
        mode: 'browser',
      },
      publicPath: '/',
      staticDirectory: 'static',
      output: {
        filename: 'js/[name].[hash:8].js',
        chunkFilename: 'js/[name].[chunkhash:8].js',
      },
      miniCssExtractPluginOption: {
        ignoreOrder: true,
        filename: 'css/[name].[hash].css',
        chunkFilename: 'css/[name].[chunkhash].css',
      },
      postcss: {
        autoprefixer: {
          enable: true,
          config: {},
        },
        cssModules: {
          enable: false,
          config: {
            namingPattern: 'module',
            generateScopedName: '[name]__[local]___[hash:base64:5]',
          },
        },
      },
    },
    rn: {
      appName: 'FinTrustHub',
      output: {
        ios: 'ios',
        android: 'android',
      },
    },
  };

  // 合并 dev / prod 配置
  if (process.env.NODE_ENV === 'development') {
    return merge({}, baseConfig, devConfig);
  }
  return merge({}, baseConfig, prodConfig);
});
