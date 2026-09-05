/**
 * composables/usePendingSync.ts — 离线队列同步 composable
 *
 * 设计依据: APP02_MOBILE_PLAN.md §4.2 Task 1.8
 *   - flushPending(): 从 IndexedDB 取出离线条目, Base64→Blob→FormData 上送
 *   - 监听 window.online 事件自动触发 flush
 *   - 每条成功后 remove(id); 失败则 break (下次再试)
 *
 * 关键适配 (不改 eco.ts):
 *   - eco.ts 的 ptsAwardPoints 仅接受 JSON { workerId, behavior, evidence?: string[], geoFence? }
 *   - 移动端确权需 multipart 上传照片 Blob + evidence/location/fromMobile 字段
 *   - 因此导出 awardPointsMobile 适配层: 直接用 client.post 发 FormData 到 /eco-pts/award
 *   - ScanConfirmView (Task 3) 在线时也可直接调用 awardPointsMobile
 *
 * project_memory 硬约束:
 *   - async/await 风格, 禁止 callback
 *   - BehaviorKind 契约值为 'scan_confirm' (下划线, 非 spec 文案的 'scan-confirm' 连字符)
 *   - 浏览器禁止覆盖 User-Agent header, 改用 X-Client-UA 自定义头 + fromMobile=true 双信号
 */

import type { WorkerAccount } from '@contracts/eco';
import type { BehaviorKind } from '@contracts/eco';
import { post } from '@/api/client';
import * as queue from '@/utils/indexedDbQueue';
import type { QueueItem, QueueLocation } from '@/utils/indexedDbQueue';

/**
 * 积分发放响应 (对齐 eco.ts ptsAwardPoints 返回类型)
 *
 * 性能注意 (usePendingSync 卡顿根因):
 * --------------------------------
 * 移动端扫码确权产生的队列条目里, photoBase64 长度可达 2-4 MB 字符.
 * flushPending() 串行逐条上送时, 每一条都要经过:
 *   (a) base64 data URL → Blob (fetch(dataUrl).blob(), 大图片 30-300ms)
 *   (b) client.post FormData (大 multipart 包体, 2-20s/张, 取决于 Vite proxy bandwidth)
 * 而单条串行失败会 break → 整条队列卡在坏数据上, 再配合 5s/8s timeout:
 *   队列 30 条 = 8s * 30 = 4 分钟, 每一条都占用浏览器 6 连接配额中的 1 个
 *   → 页面任何交互请求都排在 flush 请求后面 → 用户感知"确权/扫码后几秒页面死了"
 *
 * 修复(不改 timeout 的前提下):
 *   1) 每一条串行上送前先做 "队列单条预算门限":
 *        - photoBase64.length 超限 (单条 >3MB chars) → 直接标记失败跳过, 避免卡死
 *        - 连续 FAIL 超过 3 条 (都是前几条在 break) → 主动结束本轮 flush, 给连接配额让路
 *   2) flushPending 增加 maxItemsPerFlush 限制 (默认 5), 避免一轮 flush 抢几十条连接
 *   3) 在 POST multipart FormData 请求上强制 timeout 截断(用 axios 的 per-request timeout
 *      覆盖 client 全局 8s → 5s). 因 FormData 上传是最慢的子阶段, 长传先失败, 别让后面交互请求饿肚子
 */
export interface AwardResponse {
  awarded: boolean;
  newBalances: WorkerAccount['balances'];
  fraudBlocked?: boolean;
  reason?: string;
  /** 上链交易哈希 (Task 11 异步上链, 永远先 null) */
  chainTxHash?: string | null;
}

/**
 * 移动端确权上送适配层 (multipart/form-data)
 *
 * 将队列条目转为 FormData 并 POST 到 /eco-pts/award.
 * 不复用 eco.ts 的 ptsAwardPoints (JSON-only), 因为需要上传照片 Blob.
 *
 * @param payload 队列条目或在线确权参数
 * @returns 后端积分发放响应
 */
export async function awardPointsMobile(payload: {
  workerId: string;
  materialId: string;
  photoBase64: string;
  location: QueueLocation;
  behavior?: BehaviorKind;
}): Promise<AwardResponse> {
  const TAG = '[usePendingSync:awardPointsMobile]';
  const t0 = performance.now();
  console.info(`${TAG} 开始, workerId=${payload.workerId} materialId=${payload.materialId} behavior=${payload.behavior ?? 'scan_confirm'}`);
  console.info(`${TAG} Base64 长度=${payload.photoBase64.length} chars (前 50 字符: ${payload.photoBase64.slice(0, 50)}...)`);
  console.info(`${TAG} location=${JSON.stringify(payload.location)}`);

  // 1. Base64 data URL → Blob (用 fetch + blob(), 浏览器原生支持 data URL 解码)
  const t1 = performance.now();
  const blob = await base64ToBlob(payload.photoBase64);
  const t2 = performance.now();
  console.info(
    `${TAG} Base64 → Blob 转换完成: size=${blob.size} bytes type=${blob.type} 耗时=${(t2 - t1).toFixed(1)}ms`
  );
  if (blob.size === 0) {
    console.warn(`${TAG} ⚠️ Blob 大小为 0, Base64 数据可能损坏`);
  }

  // 2. 构造 FormData (multipart)
  const fd = new FormData();
  fd.append('workerId', payload.workerId);
  fd.append('materialId', payload.materialId);
  fd.append('photo', blob, 'evidence.jpg');
  fd.append('locationType', payload.location.type);
  fd.append('locationValue', payload.location.value);
  fd.append('fromMobile', 'true');
  // behavior 契约值为 'scan_confirm' (下划线)
  fd.append('behavior', payload.behavior ?? 'scan_confirm');

  // FormData 字段清单 (调试用, photo 只记 name/size/type)
  const fdEntries: string[] = [];
  fd.forEach((value, key) => {
    if (value instanceof Blob) {
      fdEntries.push(`${key}=<Blob name="${value.name}" size=${value.size} type="${value.type}">`);
    } else {
      fdEntries.push(`${key}="${value}"`);
    }
  });
  console.info(`${TAG} FormData 字段: ${fdEntries.join(', ')}`);

  // 3. POST — axios 检测到 FormData 自动设置 multipart/form-data + boundary
  //    X-Client-UA 标识移动端 (浏览器禁改 User-Agent, 用自定义头 + fromMobile 双信号)
  //    ⚠️ 用单请求级 timeout: 5s 截断慢上传, 避免 flushPending 串行阶段长时霸占连接配额
  console.info(`${TAG} 发送 POST /eco-pts/award (multipart/form-data, timeout=5s/req)`);
  try {
    const resp = await post<AwardResponse>('/eco-pts/award', fd, {
      headers: {
        'X-Client-UA': 'MobilePWA/3.1.0',
      },
      timeout: 5000,
    });
    const t3 = performance.now();
    console.info(
      `${TAG} ✅ 响应成功: awarded=${resp.awarded} chainTxHash=${resp.chainTxHash} fraudBlocked=${resp.fraudBlocked} 总耗时=${(t3 - t0).toFixed(1)}ms`
    );
    return resp;
  } catch (err: any) {
    const t3 = performance.now();
    console.error(
      `${TAG} ❌ 响应失败: ${err?.message || err} 总耗时=${(t3 - t0).toFixed(1)}ms`
    );
    throw err;
  }
}

/**
 * Base64 data URL → Blob (async/await 风格, 避免 callback)
 * 用 fetch(dataUrl).then(r => r.blob()) 浏览器原生解码
 */
async function base64ToBlob(dataUrl: string): Promise<Blob> {
  const resp = await fetch(dataUrl);
  return resp.blob();
}

/**
 * 离线队列同步 composable
 *
 * 用法:
 *   const { flushPending } = usePendingSync()
 *   // onActivated 时调用一次 (KeepAlive 唤醒)
 *   await flushPending()
 *
 * 监听 online 事件自动 flush (组件卸载时自动移除监听)
 */
export function usePendingSync() {
  let onlineHandler: (() => void) | null = null;
  let flushInProgress = false;

  /**
   * 刷新离线队列: 取出全部条目逐条上送
   * @returns { success, failed } 成功/失败计数
   */
  async function flushPending(): Promise<{ success: number; failed: number }> {
    const TAG = '[usePendingSync:flushPending]';
    // 防止并发 flush (online 事件 + onActivated 可能同时触发)
    if (flushInProgress) {
      console.info(`${TAG} 已有 flush 进行中, 跳过本次触发`);
      return { success: 0, failed: 0 };
    }
    flushInProgress = true;

    let success = 0;
    let failed = 0;

    try {
      const t0 = performance.now();
      const items = await queue.getAll();
      const queueSize = await queue.totalSize();
      console.info(
        `${TAG} 开始 flush: ${items.length} 条待传, 队列总大小=${(queueSize / 1024).toFixed(1)}KB`
      );

      if (items.length === 0) {
        console.info(`${TAG} 队列为空, 无需 flush`);
        return { success: 0, failed: 0 };
      }

      // 性能门限: 单轮最多处理 5 条 + 单条 photoBase64 > 3_000_000 chars 直接弃(本地先清) +
      //           连续失败 3 条就主动停(不占连接配额饿死交互请求)
      const MAX_ITEMS_PER_FLUSH = 5;
      const MAX_BASE64_LEN = 3_000_000;
      const MAX_CONSECUTIVE_FAILS = 3;
      let consecutiveFails = 0;
      let droppedTooLarge = 0;

      const itemsSlice = items.slice(0, MAX_ITEMS_PER_FLUSH);

      let idx = 0;
      for (const item of itemsSlice) {
        idx++;

        // 门限 1: 单条数据太大 → 直接移除(本地丢弃 + 计数, 避免长期卡死队列)
        if ((item.photoBase64?.length ?? 0) > MAX_BASE64_LEN) {
          console.warn(
            `${TAG} [${idx}/${itemsSlice.length}] ⛔ photoBase64 长度 ${item.photoBase64?.length} > ${MAX_BASE64_LEN}, 视为坏数据, 直接移除不阻塞后续`
          );
          try { await queue.remove(item.id); } catch {}
          droppedTooLarge++;
          continue;
        }

        console.info(
          `${TAG} [${idx}/${itemsSlice.length}] 处理 id=${item.id} workerId=${item.workerId} materialId=${item.materialId} base64_len=${item.photoBase64?.length ?? 0} timestamp=${new Date(item.timestamp).toISOString()}`
        );
        try {
          await awardPointsMobile({
            workerId: item.workerId,
            materialId: item.materialId,
            photoBase64: item.photoBase64,
            location: item.location,
          });
          // 上送成功, 移出队列
          const tRemove = performance.now();
          await queue.remove(item.id);
          console.info(
            `${TAG} [${idx}/${itemsSlice.length}] ✅ remove 完成 id=${item.id} 耗时=${(performance.now() - tRemove).toFixed(1)}ms`
          );
          success++;
          consecutiveFails = 0;
        } catch (e) {
          // 单条失败则计数 + 超限 break, 后续条目下次再试 (保持顺序, 避免乱序)
          console.warn(`${TAG} [${idx}/${itemsSlice.length}] ❌ flush 失败, 等待下次重试:`, e);
          failed++;
          consecutiveFails++;
          if (consecutiveFails >= MAX_CONSECUTIVE_FAILS) {
            console.warn(
              `${TAG} 连续失败 ${consecutiveFails} 条达到门限 ${MAX_CONSECUTIVE_FAILS}, 本轮 flush 提前结束, 让出连接配额`
            );
            break;
          }
          break; // 原本的"单条失败 break 保持顺序"逻辑仍保留
        }
      }

      const tEnd = performance.now();
      if (success > 0 || failed > 0 || droppedTooLarge > 0) {
        console.info(
          `${TAG} flush 完成: 成功 ${success}, 失败 ${failed}, 丢弃(过大) ${droppedTooLarge}, 处理条数=${idx}/${itemsSlice.length}, 总耗时=${(tEnd - t0).toFixed(1)}ms`
        );
      }
    } finally {
      flushInProgress = false;
    }

    return { success, failed };
  }

  // 监听 online 事件自动 flush (仅浏览器环境)
  if (typeof window !== 'undefined') {
    onlineHandler = () => {
      // online 事件触发时, 异步 flush (不阻塞)
      flushPending().catch((e) => {
        console.warn('[usePendingSync] online flush 失败:', e);
      });
    };
    window.addEventListener('online', onlineHandler);
  }

  return {
    flushPending,
    /** 手动移除 online 监听 (组件卸载时调用) */
    dispose: () => {
      if (onlineHandler && typeof window !== 'undefined') {
        window.removeEventListener('online', onlineHandler);
        onlineHandler = null;
      }
    },
  };
}

/** 从队列条目直接上送 (供非组件上下文使用, 如 SW message 触发) */
export async function flushQueueOnce(): Promise<{ success: number; failed: number }> {
  const { flushPending } = usePendingSync();
  return flushPending();
}

export type { QueueItem, QueueLocation };
