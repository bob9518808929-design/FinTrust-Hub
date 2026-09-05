/**
 * utils/indexedDbQueue.ts — 离线确权队列 (IndexedDB 持久化)
 *
 * 设计依据: APP02_MOBILE_PLAN.md §4.2 Task 1.7
 *   - 离线扫码确权时入队 (仅存 Base64 字符串 + 元数据, 不存 Blob/ArrayBuffer)
 *   - 网络恢复后由 usePendingSync.flushPending 取出上送
 *   - 容量上限 50MB, 超限抛 QueueFullError (调用方禁用拍照按钮 + toast)
 *
 * project_memory 硬约束:
 *   - async/await 风格, 禁止 callback
 *   - item schema 仅含 Base64 字符串与元数据 (避免 IndexedDB 二进制兼容性问题)
 */

/** 定位方式 */
export type LocationType = 'gps' | 'wifi' | 'manual';

/** 定位信息 */
export interface QueueLocation {
  type: LocationType;
  /** 归一化字符串: GPS 为 "lat,lng" / WiFi 为 BSSID 哈希 / manual 为 "lat,lng" */
  value: string;
}

/** 队列条目 (仅含 Base64 字符串, 不存 Blob) */
export interface QueueItem {
  /** UUID, 主键 */
  id: string;
  /** 工人 ID */
  workerId: string;
  /** 物料 ID (扫码识别) */
  materialId: string;
  /** 照片 Base64 (data URL 格式) */
  photoBase64: string;
  /** 定位信息 */
  location: QueueLocation;
  /** 入队时间戳 (ms) */
  timestamp: number;
}

/** 队列满错误 (调用方据此禁用拍照 + toast) */
export class QueueFullError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueueFullError';
  }
}

// === IndexedDB 配置 ===
const DB_NAME = 'fintrust-mobile';
const DB_VERSION = 1;
const STORE_NAME = 'pending-awards';
/** 容量上限 50MB (防止 IndexedDB 无限膨胀) */
const MAX_SIZE = 50 * 1024 * 1024;

let dbPromise: Promise<IDBDatabase> | null = null;

/** 打开/初始化数据库 (单例) */
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB 不可用 (隐私模式或浏览器不支持)'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        // 按时间排序索引 (ASC)
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 打开失败'));
  });
  return dbPromise;
}

/** 包装 IDBRequest 为 Promise (async/await 风格) */
function wrapRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 请求失败'));
  });
}

/**
 * 估算单条目大小 (UTF-16 近似, JSON.stringify 字符数 × 2 bytes)
 * 注意: Base64 字符串占用主要体积, 此估算偏保守 (实际 char 通常 1 byte, 但 JS 字符串为 UTF-16)
 */
function estimateItemSize(item: QueueItem): number {
  return JSON.stringify(item).length * 2;
}

/**
 * 当前队列总大小 (bytes)
 * 用 getAll 后累加 JSON.stringify 长度估算 (MVP 简化方案, 避免遍历 cursor)
 */
export async function totalSize(): Promise<number> {
  const items = await getAllRaw();
  let total = 0;
  for (const item of items) {
    total += JSON.stringify(item).length * 2;
  }
  return total;
}

/** 内部: 不排序的 getAll (用于 size 估算) */
async function getAllRaw(): Promise<QueueItem[]> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  return wrapRequest<QueueItem[]>(store.getAll());
}

/**
 * 入队 (容量检查通过后写入)
 * @throws QueueFullError 当 totalSize + newItemSize > MAX_SIZE
 */
export async function push(item: QueueItem): Promise<void> {
  const newSize = estimateItemSize(item);
  const current = await totalSize();
  if (current + newSize > MAX_SIZE) {
    throw new QueueFullError(
      `离线队列已满 (${Math.round(current / 1024 / 1024)}MB / ${MAX_SIZE / 1024 / 1024}MB), 请联网同步后继续操作`,
    );
  }

  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  await wrapRequest(store.add(item));
  // 等待事务完成 (确保写入落盘)
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 事务失败'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 事务中止'));
  });
}

/**
 * 取出全部条目 (按 timestamp ASC 排序, 先入先上送)
 */
export async function getAll(): Promise<QueueItem[]> {
  const items = await getAllRaw();
  return items.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * 删除指定条目 (上送成功后调用)
 */
export async function remove(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  await wrapRequest(store.delete(id));
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 删除失败'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 删除中止'));
  });
}

/**
 * 清空队列 (调试/重置用, MVP 不强制导出)
 */
export async function clear(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  await wrapRequest(store.clear());
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 清空失败'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 清空中止'));
  });
}

/**
 * 生成 UUID v4 (无 crypto.randomUUID 降级)
 */
export function genId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // 降级: 时间戳 + 随机数
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 10)}`;
}
