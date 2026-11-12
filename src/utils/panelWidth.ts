import {
  DEFAULT_VIEWPORT_WIDTH,
  PRESET_PANEL_DEFAULT_WIDTH,
  PRESET_PANEL_MAX_RATIO,
  PRESET_PANEL_MIN_WIDTH,
} from '../constants/limits';
import { clampRange } from './clamp';

/**
 * 预设库宽度的运行期夹取（纯函数，可离线断言）。
 *
 * 这里的上限是**视口相对**的：窗口宽度的 70%（用户 2026 轮：预设库可能有海量胶囊，
 * 挑选时值得更宽）。因此宽度不能在数据层固定成一个上限常量 ——
 * 草稿解析时还不知道窗口宽度，只能先按宽松上限夹一次（`utils/draft.ts`），
 * 挂载后再用本模块按真实窗口宽度夹一次（`AppShell`）。
 */

/** 视口宽度规范化：非有限数 / 非正数一律回落到兜底宽度，避免算出 0 或负数上限 */
function normalizeViewportWidth(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return DEFAULT_VIEWPORT_WIDTH;
  return viewportWidth;
}

/**
 * 当前窗口下预设库允许的最大宽度：窗口宽度的 70%。
 * 下限不低于 `PRESET_PANEL_MIN_WIDTH`，保证极窄窗口下也不会出现「上限比下限还小」。
 */
export function presetPanelMaxWidth(viewportWidth: number): number {
  const viewport = normalizeViewportWidth(viewportWidth);
  return Math.max(PRESET_PANEL_MIN_WIDTH, Math.round(viewport * PRESET_PANEL_MAX_RATIO));
}

/** 把任意宽度夹进「最低 ~ 窗口 70%」之间；非法值回落到默认宽度 */
export function clampPresetPanelWidth(width: number, viewportWidth: number): number {
  return clampRange(
    width,
    PRESET_PANEL_MIN_WIDTH,
    presetPanelMaxWidth(viewportWidth),
    PRESET_PANEL_DEFAULT_WIDTH,
  );
}
