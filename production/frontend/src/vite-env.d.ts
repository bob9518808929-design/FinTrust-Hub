/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/ban-types
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

interface ImportMetaEnv {
  readonly VITE_BACKEND_URL: string;
  readonly VITE_APP_TITLE: string;
  readonly VITE_APP_VERSION: string;
  readonly VITE_WS_URL: string;
  readonly VITE_DEEPSEEK_API_KEY: string;
  // APP-02: 工人登录开发降级 (前端只读, 实际降级由后端 WORKER_AUTH_BYPASS 控制)
  readonly VITE_WORKER_AUTH_BYPASS: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// APP-02: vite define 注入的应用版本号 (用于 X-App-Version header)
declare const __APP_VERSION__: string;
