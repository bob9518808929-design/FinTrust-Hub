/**
 * config/dev.ts — Taro 开发环境配置
 * project_memory: dev 环境打开 sourcemap, 关闭压缩便于调试
 */
import type { UserConfigExport } from '@tarojs/cli';

export const devConfig: UserConfigExport<'react'> = {
  logger: {
    quiet: false,
    stats: true,
  },
  mini: {},
  h5: {
    miniCssExtractPluginOption: {
      ignoreOrder: true,
      filename: 'css/[name].css',
      chunkFilename: 'css/[name].css',
    },
  },
};
