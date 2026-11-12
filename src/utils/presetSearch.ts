/**
 * 预设搜索。
 *
 * 默认按预设命名（用户自己起的中文名，可能带数字或字母）搜索；
 * 同时命中英文内容，作为附加匹配项 —— 界面不特意提示命中的是哪一边。
 */

/** 关键字为空即视为全部命中 */
export function matchPreset(
  preset: { label: string; english: string },
  keyword: string,
): boolean {
  const needle = keyword.trim().toLocaleLowerCase();
  if (!needle) return true;
  if (preset.label.toLocaleLowerCase().includes(needle)) return true;
  return preset.english.toLocaleLowerCase().includes(needle);
}

export function searchPresets<T extends { label: string; english: string }>(
  presets: readonly T[],
  keyword: string,
): T[] {
  if (!keyword.trim()) return [...presets];
  return presets.filter((preset) => matchPreset(preset, keyword));
}
