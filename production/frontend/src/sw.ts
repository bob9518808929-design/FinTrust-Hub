/// <reference lib="webworker" />

/**
 * sw.ts — FinTrust Hub 移动端 PWA Service Worker (injectManifest 策略)
 *
 * 设计依据: APP02_MOBILE_PLAN.md §4.2 Task 1.4
 *   - precacheAndRoute: 预缓存构建产物 (由 vite-plugin-pwa 注入 manifest)
 *   - API NetworkFirst: /api/v1/eco-pts/shop、/workers/、/orders 优先网络, 离线降级缓存
 *   - /assets/* CacheFirst: 静态资源缓存优先
 *   - BackgroundSyncPlugin: POST /eco-pts/award 离线时入队, 恢复网络后重试
 *
 * project_memory 硬约束:
 *   - async/await 风格 (SW 内 registerRoute 仍为同步注册, 但回调内可用 async)
 *   - 外部依赖不可达不阻塞业务 (降级原则)
 *   - 资源 URL 版本参数 ?v=22 (构建时由 vite-plugin-pwa 处理 hash, 此处不重复)
 */

import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst, CacheFirst } from 'workbox-strategies';
import { BackgroundSyncPlugin } from 'workbox-background-sync';

declare const self: ServiceWorkerGlobalScope;

// === 1. 预缓存 (injectManifest 模式下, vite-plugin-pwa 注入 self.__WB_MANIFEST) ===
precacheAndRoute(self.__WB_MANIFEST || []);

// === 2. Background Sync 插件 (离线 award 请求重试队列) ===
// 日志: 追踪 SW 内离线请求恢复全过程 (Task 2 用户要求)
const SW_TAG = '[SW:BackgroundSync]';

const bgSyncPlugin = new BackgroundSyncPlugin('pending-awards-queue', {
  maxRetentionTime: 60, // 分钟 (60 分钟内重试, 超时丢弃)
  onSync: async ({ queue }) => {
    console.info(`${SW_TAG} onSync 触发, 开始恢复 pending-awards-queue`);

    // 取队列大小 (workbox 未直接暴露 size, 通过 shift+计数实现)
    let totalProcessed = 0;
    let totalSuccess = 0;
    let totalFailed = 0;

    let entry = await queue.shiftRequest();
    while (entry) {
      totalProcessed++;
      const url = entry.request.url;
      const method = entry.request.method;
      // FormData Body 无法直接序列化, 仅记录字节数
      const bodySize = entry.request.headers.get('content-length') || 'unknown';
      console.info(
        `${SW_TAG} [${totalProcessed}] 处理条目: method=${method} url=${url} bodySize=${bodySize}bytes`
      );

      try {
        const t0 = Date.now();
        const resp = await fetch(entry.request.clone());
        const elapsed = Date.now() - t0;
        if (resp.ok) {
          totalSuccess++;
          console.info(
            `${SW_TAG} [${totalProcessed}] ✅ 重试成功: HTTP ${resp.status} 耗时=${elapsed}ms`
          );
          // 尝试读取响应体 (调试用, 失败不阻塞)
          try {
            const respText = await resp.clone().text();
            console.info(
              `${SW_TAG} [${totalProcessed}] 响应体: ${respText.slice(0, 200)}${respText.length > 200 ? '...' : ''}`
            );
          } catch (_) {
            // 响应体读取失败忽略
          }
        } else {
          totalFailed++;
          console.warn(
            `${SW_TAG} [${totalProcessed}] ⚠️ 重试返回非 2xx: HTTP ${resp.status} 耗时=${elapsed}ms`
          );
          await queue.unshiftRequest(entry);
          throw new Error(`HTTP ${resp.status}`);
        }
      } catch (err) {
        totalFailed++;
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn(
          `${SW_TAG} [${totalProcessed}] ❌ 重试失败: ${errMsg}, 重新入队等待下次 sync`
        );
        await queue.unshiftRequest(entry);
        throw err;
      }
      entry = await queue.shiftRequest();
    }

    console.info(
      `${SW_TAG} onSync 完成: 共处理 ${totalProcessed} 条, 成功 ${totalSuccess}, 失败 ${totalFailed}`
    );

    // 通知所有客户端同步完成 (usePendingSync 可监听 message 补充 toast)
    const clients = await self.clients.matchAll({ type: 'window' });
    console.info(`${SW_TAG} 通知 ${clients.length} 个客户端: PENDING_AWARDS_SYNCED`);
    for (const client of clients) {
      client.postMessage({
        type: 'PENDING_AWARDS_SYNCED',
        payload: { totalProcessed, totalSuccess, totalFailed },
      });
    }
  },
});

// === 3. API 路由: NetworkFirst (优先网络, 离线降级缓存) ===
const apiNetworkFirst = new NetworkFirst({
  cacheName: 'api-cache',
  networkTimeoutSeconds: 5, // 5s 超时降级缓存
  plugins: [],
});

// 积分商城商品列表 (GET)
registerRoute(
  ({ url, request }) =>
    url.pathname === '/api/v1/eco-pts/shop' && request.method === 'GET',
  apiNetworkFirst,
);

// 工人账户查询 (GET /api/v1/eco-pts/workers/{id})
registerRoute(
  ({ url, request }) =>
    url.pathname.startsWith('/api/v1/eco-pts/workers/') && request.method === 'GET',
  apiNetworkFirst,
);

// 工人订单查询 (GET /api/v1/eco-pts/orders)
registerRoute(
  ({ url, request }) =>
    url.pathname === '/api/v1/eco-pts/orders' && request.method === 'GET',
  apiNetworkFirst,
);

// === 4. 静态资源: CacheFirst (哈希指纹资源, 缓存优先) ===
registerRoute(
  ({ url }) => url.pathname.startsWith('/assets/'),
  new CacheFirst({
    cacheName: 'assets-cache',
    plugins: [],
  }),
);

// 图标资源 (manifest icons)
registerRoute(
  ({ url }) => url.pathname.startsWith('/icons/'),
  new CacheFirst({
    cacheName: 'icons-cache',
    plugins: [],
  }),
);

// === 5. 积分发放 POST: BackgroundSync (离线入队, 联网重试) ===
registerRoute(
  ({ url, request }) =>
    url.pathname === '/api/v1/eco-pts/award' && request.method === 'POST',
  new NetworkFirst({
    cacheName: 'api-award-cache',
    networkTimeoutSeconds: 10,
    plugins: [bgSyncPlugin],
  }),
  'POST', // HTTP method
);

// === 6. SW 生命周期日志 (开发环境) ===
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// SW 激活后立即接管 (避免首次注册后需刷新才生效)
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

export {};
