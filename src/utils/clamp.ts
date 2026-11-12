import { PRESET_WEIGHT_DEFAULT, PRESET_WEIGHT_MIN } from '../constants/limits';

/** 数值夹取；非有限数回落为下限。 */
export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/** 权重：整数、最低 0、无上限（需求 5）。非法输入回落为默认 100。 */
export function clampWeight(weight: number): number {
  if (!Number.isFinite(weight)) return PRESET_WEIGHT_DEFAULT;
  return Math.max(Math.floor(weight), PRESET_WEIGHT_MIN);
}

/** 通用区间夹取：非法输入回落为 fallback 而不是边界值（超时、温度等配置用） */
export function clampRange(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}
