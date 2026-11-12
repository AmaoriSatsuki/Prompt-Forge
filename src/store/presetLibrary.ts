import { create } from 'zustand';
import type { LibraryFile } from '../api/presets';
import { errorMessage } from '../api/tauri';
import type { Preset, PresetDraft } from '../types/preset';
import { mergeLibraryFiles } from '../utils/presetFiles';
import { sanitizePreset, sanitizePresets } from '../utils/presetSanitize';

/**
 * 「预设库 / 画师库 / Tag 库」共用的 Store 实现（D62 → D87）。
 *
 * 三个库的数据结构完全一致（都是 `Preset`），只是**落盘位置不同**：
 * - 预设库：`presets.json` 一个文件；
 * - 画师库 / Tag 库：**多文件**（数据根目录一份 + 每部词典文件夹一份，D87）。
 *
 * 因此工厂统一按「文件组」读写：`load` 返回 `LibraryFile[]`，
 * 内存里合并成一条数组（每条带 `sourceFile`），写盘由持久化 Hook 按文件分组进行。
 */
export interface PresetLibraryState {
  /** 这个库的全部条目（已合并所有文件；每条带 `sourceFile`） */
  presets: Preset[];  /** 是否已经完成一次磁盘读取（无论成功还是失败） */
  loaded: boolean;
  loading: boolean;
  /** 读取失败时的中文提示；非桌面环境或磁盘异常时会有值 */
  loadError: string | null;
  /**
   * 每个文件最近一次与磁盘内容一致的快照（键是 `sourceFile`）。
   * 落盘时逐文件比对，避免「启动加载 → 立刻又写回」这类无意义写入；
   * 也让「改一条」只重写它所属的那一个文件。
   */
  persisted: Record<string, string>;

  loadPresets: () => Promise<void>;
  /**
   * **强制重读**：导入 / 删除词典后磁盘上的库文件变了，
   * 但 Store 早已 `loaded`，`loadPresets` 会短路 —— 这里把 loaded 复位再读一次。
   */
  reloadPresets: () => Promise<void>;
  /** 新建条目，返回创建结果（写进当前库的根文件） */
  addPreset: (draft: PresetDraft) => Preset;
  updatePreset: (id: string, patch: PresetPatch) => void;
  removePreset: (id: string) => void;
  /** 权重：默认 100，最低 0，无上限 */
  setWeight: (id: string, weight: number) => void;
  replaceAll: (presets: Preset[]) => void;
  /** 记录某个文件已落盘（快照来自 `snapshotOf()`） */
  markPersisted: (file: string, snapshot: string) => void;
}

/**
 * 局部更新允许的字段（D111 加了 `folder`）。
 *
 * `folder` 不在 `PresetDraft` 里：草稿是「新建/编辑」对话框的形状，
 * 而分组是库里的编排动作（移入 / 移出），走的是同一个 `updatePreset`。
 * 清空分组用 `folder: ''` —— `undefined` 的语义是「这个字段不改」。
 */
export interface PresetPatch extends Partial<PresetDraft> {
  folder?: string;
}

/** 丢掉显式 undefined，避免局部更新把已有字段冲掉 */
function withoutUndefined(patch: PresetPatch): PresetPatch {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  return Object.fromEntries(entries) as PresetPatch;
}

function patchIn(
  presets: readonly Preset[],
  id: string,
  updater: (preset: Preset) => Preset,
): Preset[] {
  let changed = false;
  const next = presets.map((preset) => {
    if (preset.id !== id) return preset;
    changed = true;
    return updater(preset);
  });
  return changed ? next : (presets as Preset[]);
}

export interface PresetLibraryOptions {
  /** 从磁盘读取这个库（可能多个文件） */
  load: () => Promise<LibraryFile[]>;
  /** 读取失败时的中文前缀，例如「预设」「画师库」「Tag 库」 */
  label: string;
  /** 这个库「手工新增」的条目写进哪个文件（预设库 = `presets.json`） */
  rootFile: string;
}

export function createPresetLibrary({ load, label, rootFile }: PresetLibraryOptions) {
  return create<PresetLibraryState>((set, get) => {
    return {
      presets: [],
      loaded: false,
      loading: false,
      loadError: null,
      persisted: {},

      loadPresets: async () => {
        if (get().loaded || get().loading) return;
        set({ loading: true });
        try {
          // 合并多个文件（十万级也只 push，不用展开参数 —— 否则会爆栈，D87）
          const { presets, persisted } = mergeLibraryFiles(await load());
          set({ presets, loaded: true, loading: false, loadError: null, persisted });
        } catch (error) {
          set({
            loaded: true,
            loading: false,
            loadError: `${label}读取失败：${errorMessage(error)}`,
          });
        }
      },

      reloadPresets: async () => {
        // 先把 loaded 复位，否则 loadPresets 会因为「已加载过」直接短路
        set({ loaded: false, loading: false });
        await get().loadPresets();
      },

      addPreset: (draft) => {
        const created = sanitizePreset({
          ...draft,
          id: undefined,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        } as Partial<Preset>);
        // 手工新建的条目写进这个库的根文件（D87）
        const withFile: Preset = { ...created, sourceFile: rootFile };
        set((state) => ({ presets: [...state.presets, withFile] }));
        return withFile;
      },

      updatePreset: (id, patch) => {
        const safePatch = withoutUndefined(patch);
        set((state) => ({
          presets: patchIn(state.presets, id, (preset) => ({
            // `sourceFile` 不是数据字段，编辑时原样保留（不能丢，否则会写错文件）
            ...sanitizePreset({ ...preset, ...safePatch, updatedAt: Date.now() }),
            sourceFile: preset.sourceFile,
          })),
        }));
      },

      removePreset: (id) => {
        set((state) => ({ presets: state.presets.filter((preset) => preset.id !== id) }));
      },

      setWeight: (id, weight) => {
        get().updatePreset(id, { weight });
      },

      replaceAll: (presets) => {
        set({ presets: sanitizePresets(presets).map((preset) => ({ ...preset, sourceFile: rootFile })) });
      },

      markPersisted: (file, snapshot) =>
        set((state) => ({ persisted: { ...state.persisted, [file]: snapshot } })),
    };
  });
}
