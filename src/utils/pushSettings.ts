import { PUSH_DEFAULT_PORT, PUSH_PORT_MAX, PUSH_PORT_MIN } from '../constants/limits';
import type { PushSettings } from '../types/settings';

/**
 * 推送设置的纯逻辑（D80）：端口夹取 + 磁盘数据兜底。
 *
 * 只做两件事，全部可离线断言：
 * - `clampPort`：把任意数字夹进 1024–65535；非数字 / 缺失回落到默认 8713。
 * - `normalizePushSettings`：把磁盘上可能残缺/脏的数据收敛成合法形状。
 *
 * **越界一律夹到边界、不回落默认值**：用户输入 80 时看到 1024，比"悄悄变回 8713"更好理解
 * （Rust 侧 `PushSettings::normalized` 是同一条口径）。
 */
export function clampPort(value: number): number {
  if (!Number.isFinite(value)) return PUSH_DEFAULT_PORT;
  const rounded = Math.round(value);
  if (rounded < PUSH_PORT_MIN) return PUSH_PORT_MIN;
  if (rounded > PUSH_PORT_MAX) return PUSH_PORT_MAX;
  return rounded;
}

/** 磁盘/旧数据兜底：缺字段就补默认值，端口一律夹取 */
export function normalizePushSettings(raw: unknown): PushSettings {
  const source = (raw ?? {}) as Partial<PushSettings>;
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : true,
    port: typeof source.port === 'number' ? clampPort(source.port) : PUSH_DEFAULT_PORT,
  };
}

/** 端口是否在合法区间内（输入框用来决定"要不要提示"） */
export function isValidPort(value: number): boolean {
  return Number.isFinite(value) && value >= PUSH_PORT_MIN && value <= PUSH_PORT_MAX;
}
