import type { Preset, PresetFolder } from '../types/preset';
import { callCommand } from './tauri';

/**
 * 库文件的形状（D87）：一个文件 = 一组条目。
 *
 * `file` 是**相对应用数据目录**的路径：
 * - `presets.json`（预设库，永远只有一份）
 * - `artists.json` / `tags.json`（数据根目录那份：手工新增 + 历史遗留）
 * - `dictionaries/<文件夹>/artists.json` / `.../tags.json`（导入词典时派生）
 *
 * 前端把它记在内存里（`Preset.sourceFile`，**不落盘**），
 * 因此「改一条」只会重写它所属的那一个文件，不会重写整库。
 */
export interface LibraryFile {
  file: string;
  items: Preset[];
}

/** 预设库只有一个文件 */
export const PRESETS_FILE = 'presets.json';

/** 从磁盘读取预设库（损坏的文件会被 Rust 侧改名留档，这里只会拿到空列表） */
export function loadPresetsFromDisk(): Promise<Preset[]> {
  return callCommand<Preset[]>('load_presets');
}

/** 原子写回预设库 */
export function savePresetsToDisk(presets: readonly Preset[]): Promise<void> {
  return callCommand<void>('save_presets', { presets });
}

/* ---------- 预设分组（D111） ---------- */

/**
 * 读取分组元数据（`preset-folders.json`）。
 *
 * 文件缺失 / 损坏都返回空数组 —— 这就是「无损降级」：组名仍从成员派生，
 * 只是勾选为空（自动跟随成员颜色）、一律折叠。
 */
export function loadPresetFolders(): Promise<PresetFolder[]> {
  return callCommand<PresetFolder[]>('load_preset_folders');
}

/** 原子写回分组元数据（组名 + 可见色 + 展开状态） */
export function savePresetFolders(folders: readonly PresetFolder[]): Promise<void> {
  return callCommand<void>('save_preset_folders', { folders });
}

/* ---------- 画师库 / Tag 库（多文件，D87） ---------- */

/** 库类型：Rust 侧按它决定文件名（`artists.json` / `tags.json`） */
export type LibraryKind = 'artists' | 'tags';

/**
 * 读取一个库的**全部文件**：数据根目录那份 + 每部词典文件夹里那份。
 *
 * 由调用方合并成一条数组（跨文件统计就是「各文件相加」），
 * 排序仍在渲染层统一做（`visiblePresets` 按权重降序）。
 */
export function loadLibrary(kind: LibraryKind): Promise<LibraryFile[]> {
  return callCommand<LibraryFile[]>('load_library', { kind });
}

/** 只写回一个库文件（改权重 / 删条 / 新增都只碰它） */
export function saveLibraryFile(
  kind: LibraryKind,
  file: string,
  items: readonly Preset[],
): Promise<void> {
  return callCommand<void>('save_library', { kind, file, items });
}
