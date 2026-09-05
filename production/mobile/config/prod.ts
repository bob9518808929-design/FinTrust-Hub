/**
 * config/prod.ts — Taro 生产环境配置
 * project_memory: prod 环境压缩 + 关闭 console, 压缩 JS/CSS/图片
 */
import type { UserConfigExport } from '@tarojs/cli';

export const prodConfig: UserConfigExport<'react'> = {
  mini: {},
  h5: {
    // 生产环境压缩
    enableExtract: true,
    miniCssExtractPluginOption: {
      ignoreOrder: true,
      filename: 'css/[name].[hash].css',
      chunkFilename: 'css/[name].[chunkhash].css',
    },
  },
};
