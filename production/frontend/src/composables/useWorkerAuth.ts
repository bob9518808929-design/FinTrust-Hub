/**
 * useWorkerAuth.ts — APP-02 工人极简登录态 (PWA MVP)
 *
 * 职责:
 *   1. 持有工人登录态 (token / workerId / enterpriseId), 模块级共享
 *   2. login(): 调 /auth/worker-login 换 7 天 JWT 并持久化到 localStorage
 *   3. logout(): 清除登录态
 *
 * 设计:
 *   - 后端返回 ApiResult<WorkerLoginResponse>, client.ts 拦截器已解包到 data,
 *     故 post() 直接拿到 { token, workerId, enterpriseId, role }
 *   - token 同时写入 localStorage 'workerToken' 供 client.ts 请求拦截器读取
 *     (与 client.ts TOKEN_STORAGE_KEY='fintrust-token' 区分, 工人态独立)
 *   - async/await 风格, 无 callback (project_memory 硬约束)
 */

import { computed, ref } from 'vue';
import { post } from '@/api/client';

/** 后端 WorkerLoginResponse (camelCase, 已通过拦截器解包) */
export interface WorkerLoginResult {
  token: string;
  workerId: string;
  enterpriseId: string;
  role: string;
}

const TOKEN_KEY = 'workerToken';
const WORKER_ID_KEY = 'workerId';
const ENTERPRISE_ID_KEY = 'enterpriseId';

// === 模块级状态 (跨组件共享, 单例) ===
const token = ref<string | null>(localStorage.getItem(TOKEN_KEY));
const workerId = ref<string | null>(localStorage.getItem(WORKER_ID_KEY));
const enterpriseId = ref<string | null>(localStorage.getItem(ENTERPRISE_ID_KEY));

export function useWorkerAuth() {
  const isAuthenticated = computed(() => !!token.value);

  /**
   * 企业码 + 工号 登录. 成功后持久化并更新模块级状态.
   * 失败由 client.ts 响应拦截器抛出 (调用方 try/catch 或 .catch 处理).
   */
  async function login(enterpriseCode: string, workerNo: string): Promise<WorkerLoginResult> {
    const resp = await post<WorkerLoginResult>('/auth/worker-login', { enterpriseCode, workerNo });
    token.value = resp.token;
    workerId.value = resp.workerId;
    enterpriseId.value = resp.enterpriseId;
    localStorage.setItem(TOKEN_KEY, resp.token);
    localStorage.setItem(WORKER_ID_KEY, resp.workerId);
    localStorage.setItem(ENTERPRISE_ID_KEY, resp.enterpriseId);
    return resp;
  }

  /** 登出: 清除内存态 + localStorage. */
  function logout(): void {
    token.value = null;
    workerId.value = null;
    enterpriseId.value = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(WORKER_ID_KEY);
    localStorage.removeItem(ENTERPRISE_ID_KEY);
  }

  return { token, workerId, enterpriseId, isAuthenticated, login, logout };
}
