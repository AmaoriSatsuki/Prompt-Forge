/**
 * 本地词典的数据形状。
 *
 * 三条硬约定（与 Rust 侧 `models.rs` 一一对应）：
 * 1. 标准 JSON 的键名**严格是小写 `cn` / `en`**，落盘时不再包一层；
 * 2. 索引里的 `id` 就是文件名（同一目录内唯一），因此手工把文件放进文件夹再扫描也不会丢状态；
 * 3. `order` 越小优先级越高（列表最上面 = 最高优先级）。
 */

/** 一条标准词典条目 */
export interface DictionaryEntry {
  cn: string;
  en: string;
}

/** 索引里的一条词典 */
export interface DictionaryItem {
  id: string;
  /** 用户命名的显示名（导入前输入；旧数据没有时回落到 label/文件名） */
  displayName: string;
  /** 文件名词干（保留给旧索引与排查用；界面显示 displayName） */
  label: string;
  /** 相对 dictionaries/ 的文件名 */
  file: string;
  /** 优先级：0 最高 */
  order: number;
  enabled: boolean;
  entryCount: number;
  /** 来源格式：csv / json / sqlite（手工放进去的标准 JSON 记作 json） */
  format: string;
  importedAt: number;
}

/** 解析结果里的一张表（CSV / JSON 只有一张，SQLite 可能多张） */
export interface DictionaryTableInspection {
  name: string;
  fields: string[];
  /** 前 5 行样本 */
  sampleRows: string[][];
  /** 白名单识别结果；识别不出是 null */
  suggestedCnIndex: number | null;
  suggestedEnIndex: number | null;
}

export interface DictionaryInspection {
  format: 'csv' | 'json' | 'sqlite' | string;
  tables: DictionaryTableInspection[];
}

/** 导入结果：`warnings` 只提示、不阻断（大词典可能引起卡顿） */
export interface DictionaryImportReport {
  /** 写进词典库的那一部；整个文件都是画师行时是 null（D62） */
  item: DictionaryItem | null;
  skipped: number;
  duplicates: number;
  /** 本次转成画师条目（写进 artists.json）的数量 */
  artistCount: number;
  /** 画师行里中文或英文为空、被丢掉的数量 */
  artistSkipped: number;
  /** 画师行里因为作品数低于阈值（100）被过滤的数量（D63） */
  artistFiltered: number;
  /** 本次写进 Tag 库（`tags.json`）的条目数（D86） */
  tagCount: number;
  warnings: string[];
}

export interface DictionaryEntryGroup {
  id: string;
  entries: DictionaryEntry[];
}

export interface DictionaryList {
  items: DictionaryItem[];
  /** 文件被手动删除、本次扫描剔除的显示名 */
  removed: string[];
}
