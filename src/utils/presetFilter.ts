import { sortPresets } from './presetSort';
import { searchPresets } from './presetSearch';

/**
 * 预设筛选：仅按颜色多选（需求 7），空选 = 全部；再按搜索关键字过滤。
 * 入参使用结构化类型而不是 Preset，便于在断言里用最小夹具。
 */
export function filterPresetsByColor<T extends { colorId: string }>(
  presets: readonly T[],
  colorIds: readonly string[],
): T[] {
  if (colorIds.length === 0) return [...presets];
  const selected = new Set(colorIds);
  return presets.filter((preset) => selected.has(preset.colorId));
}

/**
 * 界面上真正展示的预设列表：
 * 先按颜色筛选、再按关键字搜索，最后按「权重降序 → 名称升序 → id」排序。
 */
export function visiblePresets<
  T extends { id: string; label: string; english: string; weight: number; colorId: string },
>(presets: readonly T[], colorIds: readonly string[], keyword = ''): T[] {
  return sortPresets(searchPresets(filterPresetsByColor(presets, colorIds), keyword));
}
