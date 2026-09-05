/**
 * composables/useDevice.ts — 设备检测 composable (移动端/桌面端判断)
 *
 * 设计依据: APP02_MOBILE_PLAN.md §4.2 Task 8.3
 *   - useDevice(): 响应式 isMobile Ref<boolean>, 监听 resize 更新
 *   - isMobileDevice(): 同步判断 (路由守卫用)
 *
 * 判断逻辑 (任一满足即视为移动端):
 *   1. navigator.userAgent 含 Mobile|Android|iPhone
 *   2. useMediaQuery('(max-width: 767px)') 为 true (CSS 断点)
 *   3. window.innerWidth < 768 (兜底)
 *
 * project_memory 硬约束:
 *   - async/await 风格, 禁止 callback (本 composable 为响应式同步, 无异步)
 *   - @vueuse/core 的 useMediaQuery 简化实现
 */

import { ref, onMounted, onUnmounted, type Ref } from 'vue';
import { useMediaQuery } from '@vueuse/core';

/** UA 移动端正则 (大小写不敏感) */
const MOBILE_UA_RE = /Mobile|Android|iPhone/i;

/** 移动端断点 (px), 与 responsive.scss 的 @mixin mobile 一致 */
const MOBILE_BREAKPOINT = 768;

/**
 * 同步判断当前设备是否为移动端 (路由守卫 / 初始化用)
 * SSR 安全: navigator/window 不存在时返回 false
 *
 * 测试钩子: localStorage.force_mobile === '1' 时强制返回 true
 *   用途: PC 浏览器做移动端 PWA 端到端测试/验收 (无需真机/微信开发者工具)
 *   用法: 浏览器 console 执行 localStorage.setItem('force_mobile','1') 后刷新
 *   关闭: localStorage.removeItem('force_mobile') 后刷新
 *   生产环境无影响 (localStorage 默认无此项, 走真实判断)
 */
export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') {
    return false;
  }
  // 测试钩子: 开发/验收用, 不影响生产
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('force_mobile') === '1') {
      return true;
    }
  } catch { /* localStorage 不可用时降级到真实判断 */ }
  const uaMobile = MOBILE_UA_RE.test(navigator.userAgent);
  const narrowViewport = window.innerWidth < MOBILE_BREAKPOINT;
  return uaMobile || narrowViewport;
}

/**
 * 响应式设备检测 composable
 *
 * @returns
 *   - isMobile: Ref<boolean> 综合判断 (UA + 媒体查询 + 视口宽度)
 *   - isMobileMQ: Ref<boolean> 仅媒体查询结果 (CSS 断点)
 */
export function useDevice(): {
  isMobile: Ref<boolean>;
  isMobileMQ: Ref<boolean>;
} {
  // @vueuse/core 媒体查询 (响应式, 自动监听 matchMedia change)
  const isMobileMQ = useMediaQuery(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);

  // 综合判断 (UA + 视口 + 媒体查询)
  const isMobile = ref(false);

  function update(): void {
    if (typeof navigator === 'undefined' || typeof window === 'undefined') {
      isMobile.value = false;
      return;
    }
    // 测试钩子同步生效 (与 isMobileDevice 保持一致)
    try {
      if (typeof localStorage !== 'undefined' && localStorage.getItem('force_mobile') === '1') {
        isMobile.value = true;
        return;
      }
    } catch { /* noop */ }
    const uaMobile = MOBILE_UA_RE.test(navigator.userAgent);
    isMobile.value = uaMobile || isMobileMQ.value || window.innerWidth < MOBILE_BREAKPOINT;
  }

  onMounted(() => {
    update();
    window.addEventListener('resize', update);
  });

  onUnmounted(() => {
    window.removeEventListener('resize', update);
  });

  // 初始计算一次 (SSR 时为 false, 客户端 mount 后由 onMounted 更新)
  update();

  return { isMobile, isMobileMQ };
}
