/**
 * 全库导入导出（D115）的数据形状。
 *
 * 后端返回的字段名是 camelCase，与本文件一一对应（Rust `models.rs` 里的 `Bundle*`）。
 * 这里只描述**概况与账目**：真正的条目内容不进前端 ——
 * 词典与画师 / Tag 是十万级，走 JSON IPC 会把 WebView 卡住（D116）。
 */

/** 导入导出里的五个库 */
export interface BundleIncluded {
  presets: boolean;
  artists: boolean;
  tags: boolean;
  dictionaries: boolean;
  snapshots: boolean;
}

export type BundleLibraryKey = keyof BundleIncluded;

/** 遇到同名条目时的两种操作（默认重命名，不破坏原有内容） */
export type BundleDuplicatePolicy = 'rename' | 'overwrite';

/** 一个库的合并账目 */
export interface BundleMergeStats {
  added: number;
  overwritten: number;
  renamed: number;
}

/** 导入结果：逐库报账 */
export interface BundleImportReport {
  presets: BundleMergeStats;
  folders: BundleMergeStats;
  artists: BundleMergeStats;
  tags: BundleMergeStats;
  dictionaries: BundleMergeStats;
  snapshots: BundleMergeStats;
}

/** 导入前展示：这个文件里有哪些库、各多少条 */
export interface BundleSummary {
  app: string;
  version: number;
  exportedAt: number;
  included: BundleIncluded;
  presetCount: number;
  presetFolderCount: number;
  /** 画师库 / Tag 库的条数都是**整个库**（含词典文件夹里的那些，D117） */
  artistCount: number;
  tagCount: number;
  dictionaryCount: number;
  /** 词典译词条数（画师 / Tag 已算在上面两行，不重复计数） */
  dictionaryEntryCount: number;
  dictionaryNames: string[];
  snapshotCount: number;
}

/** 导出结果：写到哪儿、各类各多少条 */
export interface BundleExportReport {
  path: string;
  bytes: number;
  presets: number;
  presetFolders: number;
  artists: number;
  tags: number;
  dictionaries: number;
  snapshots: number;
}
