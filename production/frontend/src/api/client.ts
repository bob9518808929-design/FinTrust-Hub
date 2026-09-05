/**
 * api/client.ts — axios HTTP 客户端
 *
 * 职责:
 *   1. 创建 axios 实例 (baseURL 由环境变量注入)
 *   2. 请求拦截器: 注入 Authorization / requestId / 时间戳
 *   3. 响应拦截器: 解包 ApiResult, 业务错误抛 Error, 网络错误重试
 *   4. 401 自动跳登录, 403 显示无权限, 5xx 显示服务异常 toast
 *
 * project_memory 硬约束:
 *   - 所有中间件 async/await, 无 callback 风格
 *   - 错误 toast 包含操作按钮 (如 "→ 联系顾问")
 */

import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from 'axios';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { ApiResult } from '@contracts/common';

// === 登录路由配置 (路线图项) ===
// 设计依据: spec CORE-01/02 (AI 作为操作者, 人类作为观察者), 用户身份从 JWT 解析
// 当前模式: dev-admin (后端 deps.py 在非 production 环境返回默认 dev-admin 用户)
// 路线图: 接入 SSO/OAuth2 后改为 '/login' 等独立路由
const LOGIN_ROUTE = import.meta.env.VITE_LOGIN_ROUTE || '/';
const TOKEN_STORAGE_KEY = 'fintrust-token';
// APP-02: 工人登录态独立 localStorage key (与 advisor token 区分, PWA 移动端用)
const WORKER_TOKEN_KEY = 'workerToken';
// APP-02: 移动端 PWA 路径前缀, 用于识别客户端类型并注入自定义 header
const MOBILE_PATH_PREFIX = '/m/';

/**
 * APP-02 客户端类型识别:
 *   浏览器禁止 JS 修改 User-Agent (spec 中 "User-Agent: MobilePWA" 的等价实现),
 *   故改用自定义 header X-Client-Type: MobilePWA + X-App-Version.
 *   后端 award / 防刷分逻辑应读取 X-Client-Type 而非 User-Agent (见交付报告).
 */
function isMobilePWA(): boolean {
  return typeof window !== 'undefined' && window.location.pathname.startsWith(MOBILE_PATH_PREFIX);
}

/**
 * APP-02 取当前请求应携带的 Bearer token:
 *   - 移动端 PWA 优先用 workerToken (工人 7 天 JWT)
 *   - 否则回退 fintrust-token (advisor web 端)
 */
function pickBearerToken(): string | null {
  if (typeof window === 'undefined') return null;
  if (isMobilePWA()) {
    const workerToken = localStorage.getItem(WORKER_TOKEN_KEY);
    if (workerToken) return workerToken;
  }
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

// APP-02: 应用版本 (vite define 注入, 缺失时回退到 VITE_APP_VERSION)
const APP_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined'
    ? __APP_VERSION__
    : import.meta.env.VITE_APP_VERSION || '3.1.0';

function redirectToLogin(): void {
  // APP-02: 按 isMobilePWA 分流
  //   - 移动端 PWA: 清空 worker 三件套 + 跳 /m/login + 非阻塞 toast (6.5s 自动消失)
  //   - PC 端: 保留原逻辑 (清 fintrust-token + 跳 LOGIN_ROUTE)
  if (isMobilePWA()) {
    localStorage.removeItem(WORKER_TOKEN_KEY);
    localStorage.removeItem('workerId');
    localStorage.removeItem('enterpriseId');

    // 非阻塞 toast (z-index 9500 由 main.scss 全局覆盖, 6.5s 自动消失, 含 × 关闭)
    ElMessage.warning({
      message: '登录已过期，请重新登录',
      duration: 6500,
      showClose: true,
      customClass: 'mobile-toast',
    });

    // 延迟跳转让 toast 有机会渲染 (新页面加载会卸载当前 toast)
    const current = window.location.pathname + window.location.search;
    const redirect = encodeURIComponent(current);
    setTimeout(() => {
      window.location.href = `${MOBILE_PATH_PREFIX}login?redirect=${redirect}`;
    }, 50);
    return;
  }

  // PC 端: 原逻辑 (清 advisor token, 跳 LOGIN_ROUTE, SSO 接入后改为 SSO 登录页)
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  const current = window.location.pathname + window.location.search;
  if (current !== LOGIN_ROUTE) {
    window.location.href = `${LOGIN_ROUTE}?redirect=${encodeURIComponent(current)}`;
  } else {
    window.location.href = LOGIN_ROUTE;
  }
}

// === 实例 ===
// baseURL: 默认走 Vite 代理 /api/v1 (后端路由统一前缀); 生产可由 VITE_BACKEND_URL 覆盖
const client: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_BACKEND_URL || '/api/v1',
  /**
   * 修复前端卡顿根因之一:
   *   原 timeout=30s (30000ms), 后端未启动时 Vite 代理 /api 会 hold 住 30s 才失败,
   *   页面同时发 N 个请求 → 浏览器每域名 6 连接配额全部被占满 → 所有后续请求排队 →
   *   用户感知"页面点不动/反应迟钝".
   * 改为: 移动端用 5s (断网→入离线队列快), PC 端用 8s.
   * project_memory: 失败快速降级, 不阻塞操作流.
   */
  timeout: (typeof window !== 'undefined' && window.location.pathname.startsWith('/m/')) ? 5000 : 8000,
  headers: {
    // 不设默认 Content-Type:
    //   - JSON 请求: axios 对 plain object 自动设 application/json
    //   - FormData 上传 (eco-burn/load-file): 必须让浏览器自动设
    //     multipart/form-data; boundary=... — 硬编码 json 头会覆盖 boundary
    //     导致后端 422 Unprocessable Content (踩坑记录 2026-09-05)
    'X-Client': 'fintrust-hub-frontend',
    'X-Client-Version': '3.1.0',
  },
});

// === 请求拦截器 ===
client.interceptors.request.use(
  (config) => {
    // 注入 token (APP-02: 移动端优先 workerToken, 否则 advisor token)
    const token = pickBearerToken();
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    // 注入 requestId (链路追踪)
    config.headers['X-Request-Id'] = generateRequestId();
    config.headers['X-Request-At'] = new Date().toISOString();
    // APP-02: 移动端 PWA 标识 (User-Agent 浏览器禁改, 用自定义头)
    if (isMobilePWA() && config.headers) {
      config.headers['X-Client-Type'] = 'MobilePWA';
      config.headers['X-App-Version'] = APP_VERSION;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// === 响应拦截器 ===
/** 探测性请求可在 AxiosRequestConfig 上传 _silent: true, 拦截器跳过全局错误 toast
 *  (用于页面加载时静默恢复状态, 如 ECO-01 刷新后拉取销毁审计报告; 业务错误仍 reject). */
type SilentConfig = AxiosRequestConfig & { _silent?: boolean };

client.interceptors.response.use(
  (response: AxiosResponse<ApiResult<unknown>>) => {
    const result = response.data;
    const silent = (response.config as SilentConfig)._silent === true;
    // HTTP 2xx 但业务 code 非 0
    if (result.code !== 0) {
      const message = result.message || `业务错误 (${result.code})`;
      if (!silent) ElMessage.error({ message, duration: 5000, showClose: true });
      return Promise.reject(new BusinessError(message, result.code, result.requestId));
    }
    // code=0 但携带警告文案 (后端降级可解释性提示, 如 R1 画像种子降级 + 材料已销毁)
    // → 非阻塞 warning toast, 禁止静默降级
    if (!silent && result.message && result.message !== 'OK') {
      ElMessage.warning({ message: result.message, duration: 8000, showClose: true });
    }
    // 返回 data 字段 (调用方直接拿业务数据)
    return result.data as unknown as AxiosResponse;
  },
  async (error) => {
    const silent = (error?.config as SilentConfig | undefined)?._silent === true;
    if (!error.response) {
      // 网络错误 / 超时
      if (!silent) ElMessage.error({ message: '网络异常, 请检查连接', duration: 5000 });
      return Promise.reject(new NetworkError(error.message));
    }
    const { status, data } = error.response;
    const message = (data as ApiResult<unknown>)?.message || error.message;

    switch (status) {
      case 401:
        // APP-02: 移动端 PWA 用非阻塞 toast + 直接跳转 (project_memory 硬约束)
        // PC 端保留原有 ElMessageBox.alert (阻塞 modal, 用户确认后再跳);
        // 静默探测请求遇 401 不弹框, 直接跳转登录
        if (isMobilePWA() || silent) {
          redirectToLogin();
        } else {
          ElMessageBox.alert('登录已过期, 请重新登录', '会话过期', {
            confirmButtonText: '重新登录',
            type: 'warning',
          }).then(redirectToLogin);
        }
        break;
      case 403:
        if (!silent) ElMessage.error({ message: '无权限访问: ' + message, duration: 5000 });
        break;
      case 404:
        if (!silent) ElMessage.warning({ message: '资源不存在', duration: 4000 });
        break;
      case 422:
        // 后端 Pydantic 校验失败
        if (!silent) ElMessage.error({ message: '参数校验失败: ' + message, duration: 6000 });
        break;
      case 429:
        if (!silent) ElMessage.warning({ message: '请求过于频繁, 请稍后重试', duration: 4000 });
        break;
      case 500:
      case 502:
      case 503:
      case 504:
        if (!silent) ElMessage.error({ message: '服务异常, 请稍后重试或联系顾问', duration: 6000 });
        break;
      default:
        if (!silent) ElMessage.error({ message: `请求失败 (${status}): ${message}`, duration: 5000 });
    }
    return Promise.reject(new HttpError(message, status, data));
  },
);

// === 自定义错误类 ===
export class BusinessError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly requestId: string,
  ) {
    super(message);
    this.name = 'BusinessError';
  }
}

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

// === 工具函数 ===
function generateRequestId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 10);
  return `req-${ts}-${rand}`;
}

// === 通用请求封装 (业务侧用) ===
export async function get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  return (await client.get(url, config)) as unknown as T;
}

export async function post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
  return (await client.post(url, data, config)) as unknown as T;
}

export async function put<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
  return (await client.put(url, data, config)) as unknown as T;
}

export async function patch<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
  return (await client.patch(url, data, config)) as unknown as T;
}

export async function del<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  return (await client.delete(url, config)) as unknown as T;
}

export default client;
