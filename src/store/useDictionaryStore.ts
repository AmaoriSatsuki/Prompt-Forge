import { create } from 'zustand';
import * as api from '../api/dictionaries';
import { errorMessage, isDesktopRuntime } from '../api/tauri';
import type {
  DictionaryEntry,
  DictionaryImportReport,
  DictionaryInspection,
  DictionaryItem,
} from '../types/dictionary';
import {
  buildGlossaryIndex,
  formatGlossaryOutput,
  glossaryFingerprint,
  resolveGlossaryTerm,
  sanitizeEntries,
} from '../utils/glossary';
import type { GlossaryIndex } from '../utils/glossary';

/**
 * 本地词典的运行时状态。
 *
 * 分工（与其他 store 同一套）：
 * - 纯数据（词典列表、条目、索引、指纹）在这里；
 * - 落盘与解析全在 Rust（`api/dictionaries.ts` 是唯一 invoke 出口）；
 * - 匹配规则是纯函数 `utils/glossary.ts`，本 store 只负责「把索引建好」。
 *
 * **索引与指纹都在写入时算好**：翻译链路的实时路径（每敲一次字）不该重新合并几十万条词条。
 */

export interface DictionaryState {
  /** 索引里的词典（按 order 升序 = 优先级从高到低） */
  items: DictionaryItem[];
  /** 已加载的条目：只加载**启用**的词典（停用的不占内存） */
  entriesById: Record<string, DictionaryEntry[]>;
  /** 合并后的匹配表：先出现的词典优先 */
  glossaryIndex: GlossaryIndex;
  /** 参与翻译缓存键的指纹（任何导入/排序/启停/条数变化都会变） */
  fingerprint: string;
  loading: boolean;
  error: string | null;
  /** 本次扫描发现文件已丢失、被剔除的显示名 */
  removed: string[];

  load: () => Promise<void>;
  inspect: (path: string) => Promise<DictionaryInspection>;
  importFromPath: (
    path: string,
    displayName: string,
    table: string | null,
    cnIndex: number,
    enIndex: number,
    /** 画师热度阈值（D65）：作品数低于它的画师行会被跳过 */
    minPostCount: number,
  ) => Promise<DictionaryImportReport>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  reorder: (ids: string[]) => Promise<void>;
  remove: (id: string) => Promise<void>;
  rescan: () => Promise<void>;
  openFolder: () => Promise<void>;
  /** 匹配一个切片：命中返回最终英文（含 @ 前缀规则），否则 null */
  resolve: (segment: string) => string | null;
}

/** 由列表与条目算派生值（索引 + 指纹），两处状态更新共用 */
function derive(
  items: readonly DictionaryItem[],
  entriesById: Record<string, DictionaryEntry[]>,
): Pick<DictionaryState, 'glossaryIndex' | 'fingerprint'> {
  const ordered = [...items].sort((left, right) => left.order - right.order);
  return {
    glossaryIndex: buildGlossaryIndex(
      ordered.map((item) => ({ enabled: item.enabled, entries: entriesById[item.id] ?? [] })),
    ),
    fingerprint: glossaryFingerprint(ordered),
  };
}

/** 把命令返回的分组写进 entriesById（只覆盖拿到的，没拿到的保持不变） */
function mergeGroups(
  base: Record<string, DictionaryEntry[]>,
  groups: readonly { id: string; entries: readonly DictionaryEntry[] }[],
): Record<string, DictionaryEntry[]> {
  const next = { ...base };
  for (const group of groups) next[group.id] = sanitizeEntries(group.entries);
  return next;
}

export const useDictionaryStore = create<DictionaryState>((set, get) => ({
  items: [],
  entriesById: {},
  glossaryIndex: { map: new Map(), size: 0 },
  fingerprint: 'empty',
  loading: false,
  error: null,
  removed: [],

  load: async () => {
    if (!isDesktopRuntime()) {
      // 浏览器预览：没有本地词典，也不该报错
      set({ loading: false });
      return;
    }
    set({ loading: true, error: null });
    try {
      const list = await api.listDictionaries();
      const groups = await api.readDictionaryEntries();
      const entriesById = mergeGroups({}, groups);
      set({
        items: list.items,
        entriesById,
        removed: list.removed,
        ...derive(list.items, entriesById),
        loading: false,
      });
    } catch (error) {
      set({ loading: false, error: errorMessage(error) });
    }
  },

  inspect: (path) => api.inspectDictionaryFile(path),

  importFromPath: async (path, displayName, table, cnIndex, enIndex, minPostCount) => {
    set({ error: null });
    const report = await api.importDictionaryFile(
      path,
      displayName,
      table,
      cnIndex,
      enIndex,
      minPostCount,
    );
    // 导入后重新读列表与条目：新词典的条目要立刻参与匹配
    await get().load();
    return report;
  },

  setEnabled: async (id, enabled) => {
    try {
      await api.setDictionaryEnabled(id, enabled);
      const items = get().items.map((item) => (item.id === id ? { ...item, enabled } : item));
      let entriesById = get().entriesById;
      if (enabled && !entriesById[id]) {
        // 停用的词典启动时没有加载条目，第一次启用时补读一次
        entriesById = mergeGroups(entriesById, await api.readDictionaryEntries());
      }
      set({ items, entriesById, ...derive(items, entriesById) });
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },

  reorder: async (ids) => {
    const byId = new Map(get().items.map((item) => [item.id, item]));
    const ordered: DictionaryItem[] = [];
    for (const id of ids) {
      const item = byId.get(id);
      if (item) ordered.push({ ...item, order: ordered.length });
    }
    const seen = new Set(ordered.map((item) => item.id));
    for (const item of get().items) {
      if (!seen.has(item.id)) ordered.push({ ...item, order: ordered.length });
    }
    set({ items: ordered, ...derive(ordered, get().entriesById) });
    try {
      await api.reorderDictionaries(ids);
    } catch (error) {
      set({ error: errorMessage(error) });
      await get().load();
    }
  },

  remove: async (id) => {
    try {
      await api.deleteDictionary(id, true);
      const items = get().items.filter((item) => item.id !== id);
      const entriesById = { ...get().entriesById };
      delete entriesById[id];
      set({ items, entriesById, ...derive(items, entriesById) });
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },

  rescan: async () => {
    try {
      const list = await api.rescanDictionaries();
      const groups = await api.readDictionaryEntries();
      const entriesById = mergeGroups(get().entriesById, groups);
      set({
        items: list.items,
        entriesById,
        removed: list.removed,
        ...derive(list.items, entriesById),
      });
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },

  openFolder: async () => {
    try {
      await api.openDictionariesFolder();
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },

  resolve: (segment) => {
    const hit = resolveGlossaryTerm(get().glossaryIndex, segment);
    return hit ? formatGlossaryOutput(hit) : null;
  },
}));
