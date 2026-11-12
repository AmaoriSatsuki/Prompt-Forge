import {
  LIBRARY_PAGE_SIZE,
  LIBRARY_PAGE_SIZE_MAX,
  LIBRARY_PAGE_SIZE_MIN,
} from '../constants/limits';

/**
 * 界面偏好：列表分页阈值（D86）。
 *
 * 为什么存在本地存储而不是 `config.json`：
 * 它是**纯界面偏好**，后端一个字节都用不到（翻译、推流、词典解析都不关心分页）；
 * 与主题（`utils/theme.ts`）、输入框高度、面板宽度是同一类东西。
 * 按项目既有的分工，这类偏好放本地存储，Store 里只放纯数据。
 *
 * 键名带 `v1`：将来改结构时换个键就自动回落默认值，不需要迁移代码。
 */
export const LIBRARY_PAGE_SIZE_STORAGE_KEY = 'prompt-forge/library-page-size/v1';

/** 规范化：非数字 / 越界一律夹到 [下限, 上限]（输入框与落盘值都走它） */
export function clampLibraryPageSize(value: number): number {
  if (!Number.isFinite(value)) return LIBRARY_PAGE_SIZE;
  const rounded = Math.round(value);
  return Math.min(Math.max(rounded, LIBRARY_PAGE_SIZE_MIN), LIBRARY_PAGE_SIZE_MAX);
}

/** 解析本地存储里的值：认不出来就用默认值 100 */
export function parseLibraryPageSize(raw: string | null): number {
  if (raw === null || raw.trim() === '') return LIBRARY_PAGE_SIZE;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return LIBRARY_PAGE_SIZE;
  return clampLibraryPageSize(parsed);
}

/** localStorage 在隐私模式或非浏览器环境下可能直接抛异常，因此统一包一层 */
function safeStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadLibraryPageSize(storage: Storage | null = safeStorage()): number {
  if (!storage) return LIBRARY_PAGE_SIZE;
  try {
    return parseLibraryPageSize(storage.getItem(LIBRARY_PAGE_SIZE_STORAGE_KEY));
  } catch {
    return LIBRARY_PAGE_SIZE;
  }
}

export function saveLibraryPageSize(
  size: number,
  storage: Storage | null = safeStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(LIBRARY_PAGE_SIZE_STORAGE_KEY, String(clampLibraryPageSize(size)));
    return true;
  } catch {
    // 写不进去只影响「下次启动能不能记住」，不值得打断用户
    return false;
  }
}
