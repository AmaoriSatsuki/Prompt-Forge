import type { Preset } from '../types/preset';
import { sanitizePresets } from './presetSanitize';

/**
 * 多文件库的纯函数工具（D87）。
 *
 * 背景：画师与 Tag 现在是「数据根目录一份 + 每部词典文件夹一份」。
 * 内存里只有**一条**合并后的数组（渲染/搜索/分页都对着它），
 * 每条通过 `sourceFile` 记住自己属于哪个文件 —— 这个字段**只在内存里**，
 * 写盘前必须去掉（`toDisk`），否则新旧文件会出现「多一个字段」的脏数据。
 */

/** 画师 / Tag 在数据根目录的那份文件名 */
export const ROOT_LIBRARY_FILE: Record<'artists' | 'tags', string> = {
  artists: 'artists.json',
  tags: 'tags.json',
};

/** 给一批条目打上所属文件（加载时用） */
export function withSourceFile(items: readonly Preset[], file: string): Preset[] {
  return items.map((item) => ({ ...item, sourceFile: file }));
}

/** 写盘前去掉只在内存里用的 `sourceFile` */
export function toDisk(items: readonly Preset[]): Preset[] {
  return items.map(({ sourceFile: _sourceFile, ...rest }) => rest);
}

/**
 * 按所属文件分组（写盘时用）。
 *
 * 文件顺序 = 首次出现的顺序，因此「同一个文件里的条目相对顺序」与内存一致；
 * 没有 `sourceFile` 的条目归到 `fallback`（老数据 / 直接 setState 的测试夹具）。
 */
export function groupByFile(
  items: readonly Preset[],
  fallback: string,
): Map<string, Preset[]> {
  const groups = new Map<string, Preset[]>();
  for (const item of items) {
    const file = item.sourceFile ?? fallback;
    const bucket = groups.get(file);
    if (bucket) bucket.push(item);
    else groups.set(file, [item]);
  }
  return groups;
}

/** 一组条目的落盘快照（用于「内容没变就不写」） */
export function snapshotOf(items: readonly Preset[]): string {
  return JSON.stringify(toDisk(items));
}

/** 合并结果：一条数组 + 每个文件各自的落盘快照 */
export interface MergedLibrary {
  presets: Preset[];
  persisted: Record<string, string>;
}

/**
 * 把「文件组」合并成一条数组（加载时用）。
 *
 * **绝不能写成 `presets.push(...items)`**：十万级词条时会抛
 * `RangeError: Maximum call stack size exceeded`（V8 对函数调用的展开参数有上限，
 * 用户实测「Tag 库读取失败：Maximum call stack size exceeded」就是这个 bug，D87 修）。
 * 这里逐个 push，条数再多也不会爆栈。
 */
export function mergeLibraryFiles(
  files: readonly { file: string; items: readonly Preset[] }[],
): MergedLibrary {
  const presets: Preset[] = [];
  const persisted: Record<string, string> = {};
  for (const file of files) {
    // 磁盘内容可能是手工改过或来自旧版本的，统一规范化后再进内存
    const items = sanitizePresets(file.items);
    persisted[file.file] = snapshotOf(items);
    // 直接给规范化后的对象打标记（不再 `{ ...item }` —— 十万级时那是几十万次多余拷贝）
    for (const item of items) {
      item.sourceFile = file.file;
      presets.push(item);
    }
  }
  return { presets, persisted };
}
