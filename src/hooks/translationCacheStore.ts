import { loadCacheFromDisk, saveCacheToDisk } from '../api/cache';
import { CACHE_MAX_ENTRIES, CACHE_PERSIST_DEBOUNCE_MS } from '../constants/limits';
import { TranslationCache } from '../utils/translationCache';

/**
 * 翻译缓存的运行时持有者 + 落盘编排（V3 第一层）。
 *
 * 放在模块作用域而不是 React 状态里：调度层会高频读写它，
 * 放进状态只会带来无意义的重渲染。纯逻辑在 `utils/translationCache.ts`，
 * 这里只负责「什么时候读盘、什么时候写盘」。
 */

const cache = new TranslationCache({ maxEntries: CACHE_MAX_ENTRIES });

let loaded = false;
let loading: Promise<void> | null = null;

/**
 * 防抖写盘的定时器。
 *
 * **为什么触发点放在这里（用户 2026 轮排查卡顿）**：
 * 原来由 `useRealtimeTranslate` 的一个 effect 负责安排写盘，而它把 `modules` 当依赖 ——
 * 打字每敲一个字都会换一次 `modules` 引用，于是**每次都取消并重设一个 2 秒定时器**：
 * 纯浪费，还让「写磁盘」永远等不到稳定期。
 *
 * 现在改成**由真正写入缓存的 `cachePut` 触发**：写盘这件事只有一个触发源（谁改谁负责），
 * 与 React 的渲染、与 `modules` 引用都彻底解耦，也不再依赖「界面挂载了才写」。
 */
let persistTimer: ReturnType<typeof setTimeout> | null = null;

/** 安排一次防抖写盘（已有待写任务时顺延，磁盘最多每 CACHE_PERSIST_DEBOUNCE_MS 写一次） */
export function scheduleCachePersist(): void {
  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistCache();
  }, CACHE_PERSIST_DEBOUNCE_MS);
}

/** 取消待写任务（清空缓存 / 测试复位时用，避免把空缓存或旧内容写过盘） */
export function cancelScheduledCachePersist(): void {
  if (persistTimer === null) return;
  clearTimeout(persistTimer);
  persistTimer = null;
}

/** 启动时加载缓存（只做一次；失败静默降级为空缓存，不阻断使用） */
export function initializeCache(
  pushToast?: (text: string, tone?: 'info' | 'ok' | 'warn' | 'error') => void,
): Promise<void> {
  if (loaded) return Promise.resolve();
  if (loading) return loading;

  loading = loadCacheFromDisk()
    .then((records) => {
      cache.loadRecords(records);
      loaded = true;
    })
    .catch((error) => {
      // 读不到缓存不是致命问题：界面照常可用，只是这一轮没有命中
      loaded = true;
      pushToast?.(
        `翻译缓存读取失败，本次将不使用历史缓存：${error instanceof Error ? error.message : String(error)}`,
        'warn',
      );
    })
    .finally(() => {
      loading = null;
    });

  return loading;
}

export function cacheGet(key: string): string | null {
  return cache.get(key);
}

export function cachePut(key: string, value: string): void {
  cache.put(key, value);
  // 谁改谁负责：写入即安排一次防抖落盘，不再依赖界面层的 effect
  scheduleCachePersist();
}

/** 把当前缓存按 LRU 顺序原子写回磁盘 */
export async function persistCache(): Promise<void> {
  await saveCacheToDisk(cache.toRecords());
}

export function cacheStats(): { entries: number; chars: number; approxBytes: number } {
  return cache.stats();
}

/** 清空内存缓存；磁盘清理由 API 层的 clearCacheOnDisk 负责 */
export function cacheClear(): number {
  cancelScheduledCachePersist();
  return cache.clear();
}

/** 缓存开关：关掉后既不写入也不命中（用户在设置里可以关） */
export function setCacheEnabled(enabled: boolean): void {
  cache.setEnabled(enabled);
}

export function isCacheEnabled(): boolean {
  return cache.isEnabled();
}

/** 测试与调试用：重置加载标记 */
export function resetCacheForTest(): void {
  cancelScheduledCachePersist();
  cache.clear();
  loaded = false;
  loading = null;
}
