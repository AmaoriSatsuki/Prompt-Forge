import {
  INPUT_PANE_DEFAULT_HEIGHT,
  INPUT_PANE_MAX_HEIGHT,
  INPUT_PANE_MIN_HEIGHT,
  PRESET_PANEL_DEFAULT_WIDTH,
  PRESET_PANEL_MIN_WIDTH,
  PRESET_PANEL_STORAGE_MAX_WIDTH,
} from '../constants/limits';
import type { Module } from '../types/module';
import { clampRange } from './clamp';
import { sanitizeModules } from './moduleSanitize';

/**
 * 会话草稿：模块内容 + 布局偏好。
 *
 * V1 存在本地存储里（而不是磁盘 JSON）：草稿是「正在编辑中的临时状态」，
 * 量小、变化频繁、丢了也不致命；预设库与服务商配置才需要落盘 + 原子写。
 */

export const DRAFT_STORAGE_KEY = 'prompt-forge/draft/v1';

/**
 * 布局偏好的版本号（只影响布局，**不动模块内容**）。
 *
 * - v2（D48）：预设库初始宽度改成「刚好放下 8 个色块」（276px），旧草稿重置宽度。
 * - v3（D55）：输入框默认高度改成「刚好放下 6 个初始模块」（254px），旧草稿重置高度。
 * - v4（D75）：配色扩到 10 色 ⇒ 色块行 12 块，初始宽度 340 → 404px，旧草稿重置宽度。
 * - v5（D77）：初始宽度口径改成「一行 8 块」⇒ **404 → 276px**（12 块排成 8+4），
 *   旧草稿**再重置一次宽度**。理由同 v4：不重置的话，用户看到的一直是自己存的旧宽度，
 *   这次改动对他来说不生效。
 *
 * 每次都是**只重置那一项布局**：模块内容与另一项布局照旧保留。
 * 刻意不升级 `DRAFT_STORAGE_KEY` 的 v1：那会把用户正在编辑的模块内容一起丢掉。
 */
export const DRAFT_LAYOUT_VERSION = 5;

/** 左列的排版偏好，跟草稿一起恢复 */
export interface DraftLayout {
  /** 下方中文输入框的高度 */
  inputPaneHeight: number;
  /** 右侧预设库的宽度 */
  presetPanelWidth: number;
}

export interface ModuleDraft {
  modules: Module[];
  selectedModuleId: string;
  layout: DraftLayout;
  /** 布局口径版本；旧草稿没有这个字段，按 1 处理 */
  layoutVersion: number;
  savedAt: number;
}

export const DEFAULT_LAYOUT: DraftLayout = {
  inputPaneHeight: INPUT_PANE_DEFAULT_HEIGHT,
  presetPanelWidth: PRESET_PANEL_DEFAULT_WIDTH,
};

/** localStorage 在隐私模式或非浏览器环境下可能直接抛异常，因此统一包一层 */
function safeStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * 夹取布局偏好。
 *
 * 预设库宽度在这里只按**宽松上限**夹（真正的上限是窗口宽度的 70%，
 * 解析草稿时还不知道窗口宽度，见 `utils/panelWidth.ts`）。
 */
export function sanitizeLayout(raw: unknown): DraftLayout {
  const source = (raw ?? {}) as Partial<DraftLayout>;
  return {
    inputPaneHeight: clampRange(
      Number(source.inputPaneHeight),
      INPUT_PANE_MIN_HEIGHT,
      INPUT_PANE_MAX_HEIGHT,
      INPUT_PANE_DEFAULT_HEIGHT,
    ),
    presetPanelWidth: clampRange(
      Number(source.presetPanelWidth),
      PRESET_PANEL_MIN_WIDTH,
      PRESET_PANEL_STORAGE_MAX_WIDTH,
      PRESET_PANEL_DEFAULT_WIDTH,
    ),
  };
}

export function buildDraft(
  modules: readonly Module[],
  selectedModuleId: string,
  layout: DraftLayout,
  savedAt = Date.now(),
): ModuleDraft {
  return {
    modules: modules.map((module) => ({ ...module })),
    selectedModuleId,
    layout: sanitizeLayout(layout),
    layoutVersion: DRAFT_LAYOUT_VERSION,
    savedAt,
  };
}

export function serializeDraft(draft: ModuleDraft): string {
  return JSON.stringify(draft);
}

/**
 * 解析草稿。任何异常输入都返回 null（当作没有草稿），
 * 用户最多丢掉一次会话的临时内容，而不会打不开应用。
 */
export function parseDraft(raw: string | null): ModuleDraft | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const candidate = parsed as Partial<ModuleDraft>;
  const modules = sanitizeModules(candidate.modules);
  if (modules.length === 0) return null;

  const selectedModuleId =
    typeof candidate.selectedModuleId === 'string' &&
    modules.some((module) => module.id === candidate.selectedModuleId)
      ? candidate.selectedModuleId
      : modules[0].id;

  const layout = sanitizeLayout(candidate.layout);
  // 逐档迁移：v3 之前重置输入框高度；v4 / v5 各重置一次预设库宽度
  // （v4 是 12 块的 404px 口径，v5 是「一行 8 块」的 276px 口径）。
  // 几个判断分开写，避免「老草稿把用户后来拖好的另一项也一起重置」。
  const layoutVersion =
    typeof candidate.layoutVersion === 'number' ? candidate.layoutVersion : 1;
  if (layoutVersion < 5) layout.presetPanelWidth = PRESET_PANEL_DEFAULT_WIDTH;
  if (layoutVersion < 3) layout.inputPaneHeight = INPUT_PANE_DEFAULT_HEIGHT;

  return {
    modules,
    selectedModuleId,
    layout,
    layoutVersion: DRAFT_LAYOUT_VERSION,
    savedAt: typeof candidate.savedAt === 'number' ? candidate.savedAt : 0,
  };
}

export function loadDraft(storage: Storage | null = safeStorage()): ModuleDraft | null {
  if (!storage) return null;
  try {
    return parseDraft(storage.getItem(DRAFT_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function saveDraft(draft: ModuleDraft, storage: Storage | null = safeStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(DRAFT_STORAGE_KEY, serializeDraft(draft));
    return true;
  } catch {
    // 配额写满等情况：草稿丢了可以接受，不打断用户
    return false;
  }
}

export function clearDraft(storage: Storage | null = safeStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // 同上
  }
}
