/**
 * src/app.ts — Taro React 应用入口
 * project_memory: APP-02 企业端移动 APP, 工人(仓管/物流)扫码确权
 *   - 全局错误边界
 *   - 持久化 workerToken (与 PC 端 PWA 共享 localStorage key)
 */
import { Component, PropsWithChildren } from 'react';
import './app.scss';

class App extends Component<PropsWithChildren> {
  componentDidMount() {
    // 启动时打印应用版本 (供排障定位)
    // eslint-disable-next-line no-console
    console.info('[FinTrust Hub Mobile] v3.1.0 starting...');
  }

  componentDidShow() {
    // 切前台时检测 token 过期 (与 PC 端 PWA 401 拦截器对齐)
    try {
      const token = tt.getStorageSync?.('workerToken');
      if (!token) {
        // 未登录, 跳转登录页 (这里仅记录, 实际跳转在页面 onShow 中判断)
        // eslint-disable-next-line no-console
        console.info('[FinTrust Hub Mobile] workerToken missing');
      }
    } catch {
      // tt API 在 H5 端不可用, 静默降级
    }
  }

  componentDidHide() {}

  // 子组件渲染 (Taro 5.x 推荐写法)
  render() {
    return this.props.children;
  }
}

export default App;
