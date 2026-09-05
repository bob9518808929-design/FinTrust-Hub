/**
 * src/types/global.d.ts — Taro 项目全局类型补充
 * 注: Taro 编译环境自带类型, 这里仅补充编译期缺失的全局
 */

declare const __APP_VERSION__: string;

declare module '@tarojs/taro' {
  // Taro 多端 API 兼容补充 (实际类型来自 @tarojs/taro 包)
  interface scanCodeOption {
    onlyFromCamera?: boolean;
    scanType?: string[];
  }
  interface scanCodeResult {
    result: string;
    scanType: string;
    charSet: string;
    path: string;
    rawData: string;
  }
  function scanCode(option: scanCodeOption): Promise<scanCodeResult>;
}

declare module '*.scss';
