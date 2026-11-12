import type { CacheRecord } from '../utils/translationCache';
import { callCommand } from './tauri';

/**
 * 翻译缓存的落盘通道（与预设库、配置同一套：Rust 侧原子写 + 损坏留档）。
 *
 * 存储位置：`%APPDATA%\com.promptforge.app\cache.json`
 * （跟随项目既有的应用标识符，不另起一个目录）。
 */

export function loadCacheFromDisk(): Promise<CacheRecord[]> {
  return callCommand<CacheRecord[]>('load_cache');
}

export function saveCacheToDisk(entries: readonly CacheRecord[]): Promise<void> {
  return callCommand<void>('save_cache', { entries });
}

export function clearCacheOnDisk(): Promise<void> {
  return callCommand<void>('clear_cache');
}
