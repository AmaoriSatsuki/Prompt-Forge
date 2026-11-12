import { DEFAULT_PRESET_COLOR_ID } from '../constants/colors';
import { PRESET_WEIGHT_DEFAULT } from '../constants/limits';
import type { Preset } from '../types/preset';
import { clampWeight } from './clamp';
import { normalizePresetColor } from './color';
import { createId } from './id';
import { normalizeFolderName } from './presetFolders';

/** 命名缺失时的中文兜底名。界面只出现中文，因此这里不用英文占位。 */
export const FALLBACK_PRESET_LABEL = '未命名预设';

/**
 * 规范化一条来自磁盘（可能被手工改过、或来自旧版本）的预设。
 * 目标：任何输入都能得到一条可用的预设，绝不因为一条脏数据让整个预设库报废。
 */
export function sanitizePreset(raw: Partial<Preset> | null | undefined): Preset {
  const source = raw ?? {};
  const now = Date.now();

  const id = typeof source.id === 'string' && source.id.trim() ? source.id : createId('preset');
  const label =
    typeof source.label === 'string' && source.label.trim()
      ? source.label.trim()
      : FALLBACK_PRESET_LABEL;
  const english = typeof source.english === 'string' ? source.english : '';
  const weight =
    typeof source.weight === 'number' ? clampWeight(source.weight) : PRESET_WEIGHT_DEFAULT;
  // D111：分组名归一；空串/缺字段一律视为「未分组」，不落盘
  const folder = normalizeFolderName(source.folder);

  return {
    id,
    label,
    english,
    weight,
    colorId: normalizePresetColor(source.colorId ?? DEFAULT_PRESET_COLOR_ID),
    ...(folder ? { folder } : {}),
    createdAt: typeof source.createdAt === 'number' ? source.createdAt : now,
    updatedAt: typeof source.updatedAt === 'number' ? source.updatedAt : now,
  };
}

/**
 * 规范化整个预设库，并保证 id 唯一（重复 id 会让 React 列表 key 冲突）。
 * 非数组输入直接返回空列表。
 */
export function sanitizePresets(rawList: unknown): Preset[] {
  if (!Array.isArray(rawList)) return [];

  const seenIds = new Set<string>();
  return rawList.map((item) => {
    const preset = sanitizePreset(item as Partial<Preset>);
    if (seenIds.has(preset.id)) {
      preset.id = createId('preset');
    }
    seenIds.add(preset.id);
    return preset;
  });
}
