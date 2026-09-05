/** 文件名：babel.config.js 职责：Taro React 项目 Babel 配置,多端编译微信小程序/支付宝/H5 */
// project_memory: Taro 3.6 + React 18 多端编译 (微信小程序/支付宝/H5)
module.exports = {
  presets: [
    ['taro', {
      framework: 'react',
      ts: true,
      compiler: 'webpack5',
    }],
  ],
};
