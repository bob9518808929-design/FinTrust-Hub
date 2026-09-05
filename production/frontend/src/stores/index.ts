/**
 * stores/index.ts — Pinia 状态管理入口
 *
 * 设计哲学 (project_memory):
 *   - 跨模块状态共享通过 Pinia store, 不通过全局 window
 *   - 持久化用 pinia-plugin-persistedstate (localStorage 兜底)
 *   - ECO 9 模块统管在 eco.ts 单 store 中, 避免散落
 */

export { useEnterpriseStore } from './enterprise';
export { useReformStore } from './reform';
export { useEcoStore } from './eco';
export { useScfStore } from './scf';
