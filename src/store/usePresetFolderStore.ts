import { create } from 'zustand';
import { errorMessage } from '../api/tauri';
import { loadPresetFolders } from '../api/presets';
import type { ColorId } from '../constants/colors';
import type { PresetFolder } from '../types/preset';
import {
  dissolveFolderInItems,
  folderAccepts,
  folderColorLabel,
  folderNamesOf,
  nextFolderName,
  normalizeFolderName,
  pruneEmptyFolders,
  renameFolderInItems,
  sanitizeFolders,
  type FolderRef,
} from '../utils/presetFolders';
import { usePresetStore } from './usePresetStore';

/**
 * 预设分组（D111 → D112 → D113）的 Store。
 *
 * 为什么单独一个 Store、而不是塞进 `createPresetLibrary`：
 * 那个工厂是**预设 / 画师 / Tag 三个库共用**的，分组只属于预设库；
 * 拆出来既不污染共用逻辑，也让「分组元数据」与「条目」各自只有一份真源。
 *
 * **组的身份 = 名字 + 颜色**（D113）：同名不同色是两个不同的组，
 * 因此这里所有动作都收 `FolderRef`（名字 + 颜色），不再用裸名字。
 *
 * 唯一的跨 Store 编排点（建组 / 改名 / 解散 / 移入 / 清理空组）都在这里，
 * 因为它必须**同时**动两个 Store，分散到组件里会出现「组改名了但成员还指着旧名」的半截状态。
 */

/** 移入 / 建组的结果：失败时带中文原因，调用方只负责把它弹出来 */
export type FolderActionResult =
  | { ok: true; name: string }
  | { ok: false; reason: 'color' | 'missing'; message: string };

export interface PresetFolderState {
  folders: PresetFolder[];
  loaded: boolean;
  loading: boolean;
  loadError: string | null;
  /** 最近一次与磁盘一致的快照（用于「内容没变就不写」） */
  persisted: string;

  loadFolders: () => Promise<void>;
  /**
   * **强制重读**（D115）：导入库会直接改写磁盘上的 `preset-folders.json`，
   * 而 `loadFolders` 对已加载过的 Store 会短路 —— 这里复位 loaded 再读一次。
   */
  reloadFolders: () => Promise<void>;
  markPersisted: (snapshot: string) => void;
  /** 默认组名（只避开已有名字，不保证唯一 —— 同名不同色是允许的） */
  suggestName: () => string;
  /**
   * 建组：颜色由**那颗被拖进来的胶囊**决定（D112），之后不可改。
   * 同名同色已存在 = 并入；同名不同色 = 另一个组（D113 允许）。
   */
  createFolder: (rawName: string, colorId: ColorId, presetId: string) => FolderActionResult;
  /** 改名：只改「同名同色」那一个组（成员与实体一起改） */
  renameFolder: (from: FolderRef, to: string) => string;
  /** 解散：成员回到未分组，组实体删除（**永不连带删除预设**） */
  dissolveFolder: (folder: FolderRef) => void;
  /** 折叠 / 展开（记住状态，免得每次重新双击） */
  toggleFolderExpanded: (folder: FolderRef) => void;
  /** 把一条预设移入某个组：只接受同色，异色返回 `reason: 'color'` */
  assignPreset: (presetId: string, folder: FolderRef) => FolderActionResult;
  /** 把一条预设移回未分组（组空了会被顺手清掉） */
  unassignPreset: (presetId: string) => void;
  /** 清掉没有成员的组实体（删预设之后调用） */
  pruneFolders: () => void;
}

function snapshotOf(folders: readonly PresetFolder[]): string {
  return JSON.stringify(folders);
}

function entityOf(folders: readonly PresetFolder[], folder: FolderRef): PresetFolder | undefined {
  return folders.find((item) => item.name === folder.name && item.colorId === folder.colorId);
}

export const usePresetFolderStore = create<PresetFolderState>((set, get) => {
  function upsert(folder: PresetFolder): void {
    set((state) => {
      const index = state.folders.findIndex(
        (item) => item.name === folder.name && item.colorId === folder.colorId,
      );
      if (index < 0) return { folders: [...state.folders, folder] };
      const next = [...state.folders];
      next[index] = folder;
      return { folders: next };
    });
  }

  function findPreset(presetId: string) {
    return usePresetStore.getState().presets.find((preset) => preset.id === presetId);
  }

  return {
    folders: [],
    loaded: false,
    loading: false,
    loadError: null,
    persisted: '[]',

    loadFolders: async () => {
      if (get().loaded || get().loading) return;
      set({ loading: true });
      try {
        const folders = sanitizeFolders(await loadPresetFolders());
        set({
          folders,
          loaded: true,
          loading: false,
          loadError: null,
          persisted: snapshotOf(folders),
        });
      } catch (error) {
        // 读不到就当成「没有分组配置」：功能仍可用（组名与颜色都由成员派生）
        set({
          folders: [],
          loaded: true,
          loading: false,
          loadError: `分组配置读取失败：${errorMessage(error)}`,
          persisted: snapshotOf([]),
        });
      }
    },

    markPersisted: (snapshot) => set({ persisted: snapshot }),

    reloadFolders: async () => {
      set({ loaded: false, loading: false });
      await get().loadFolders();
    },

    suggestName: () =>
      nextFolderName(
        folderNamesOf(usePresetStore.getState().presets).concat(
          get().folders.map((folder) => folder.name),
        ),
      ),

    createFolder: (rawName, colorId, presetId) => {
      const wanted = normalizeFolderName(rawName) || get().suggestName();
      const preset = findPreset(presetId);
      if (!preset) {
        return { ok: false, reason: 'missing', message: '找不到这条预设，可能已被删除' };
      }

      // 同名同色 = 同一个组（并入）；同名不同色是另一个组，照常新建
      if (!entityOf(get().folders, { name: wanted, colorId })) {
        upsert({ name: wanted, colorId, expanded: true });
      }
      usePresetStore.getState().updatePreset(presetId, { folder: wanted });
      return { ok: true, name: wanted };
    },

    renameFolder: (from, to) => {
      const target = normalizeFolderName(to);
      if (!target || target === from.name) return from.name;
      // 撞上「同色同名」的另一个组才真的冲突（不同色同名是允许的）
      if (entityOf(get().folders, { name: target, colorId: from.colorId })) return from.name;

      const presets = usePresetStore.getState().presets;
      usePresetStore.getState().replaceAll(renameFolderInItems(presets, from, target));
      set((state) => ({
        folders: state.folders.map((folder) =>
          folder.name === from.name && folder.colorId === from.colorId
            ? { ...folder, name: target }
            : folder,
        ),
      }));
      return target;
    },

    dissolveFolder: (folder) => {
      const presets = usePresetStore.getState().presets;
      usePresetStore.getState().replaceAll(dissolveFolderInItems(presets, folder));
      set((state) => ({
        folders: state.folders.filter(
          (item) => !(item.name === folder.name && item.colorId === folder.colorId),
        ),
      }));
    },

    toggleFolderExpanded: (folder) => {
      const current = entityOf(get().folders, folder);
      upsert({ ...(current ?? { ...folder, expanded: false }), expanded: !current?.expanded });
    },

    assignPreset: (presetId, folder) => {
      const name = normalizeFolderName(folder.name);
      const preset = findPreset(presetId);
      if (!preset) {
        return { ok: false, reason: 'missing', message: '找不到这条预设，可能已被删除' };
      }
      if (!name) {
        return { ok: false, reason: 'missing', message: '分组名不能为空' };
      }
      if (!folderAccepts(folder.colorId, preset.colorId)) {
        return {
          ok: false,
          reason: 'color',
          message: `「${name}」是${folderColorLabel(folder.colorId)}色分组，只收纳同色预设`,
        };
      }

      if (!entityOf(get().folders, { name, colorId: folder.colorId })) {
        // 降级路径：有成员但还没实体（文件丢了 / 老数据），补建时沿用调用方给的组色
        upsert({ name, colorId: folder.colorId, expanded: false });
      }
      usePresetStore.getState().updatePreset(presetId, { folder: name });
      return { ok: true, name };
    },

    unassignPreset: (presetId) => {
      // 用空串清空：`updatePreset` 会丢掉 undefined（那是「不改这个字段」的语义）
      usePresetStore.getState().updatePreset(presetId, { folder: '' });
      get().pruneFolders();
    },

    pruneFolders: () => {
      const presetState = usePresetStore.getState();
      /*
       * D119：预设还没读到时绝不能判「组是空的」。
       *
       * 踩过的坑：启动时 `preset-folders.json` 很小、先读完，`presets.json` 还在解析，
       * 这一刻 prune 认为所有组都没有成员 → 把组实体整批删掉 → 防抖落盘把 `[]` 写回磁盘。
       * 后果是「组展开了，下次启动又全折叠」，而且组色 / 展开状态再也回不来
       * （成员还在，组会由成员重新派生，但派生出来的一律折叠）。
       */
      if (!presetState.loaded || presetState.loadError) return;
      const next = pruneEmptyFolders(get().folders, presetState.presets);
      if (next.length !== get().folders.length) set({ folders: next });
    },
  };
});

