import { PRESET_LABEL_PREFIX } from '../constants/limits';
import type { Preset } from '../types/preset';
import { stripAllAnchors } from './placeholder';

/**
 * 生成预设的默认命名：「胶囊 1」「胶囊 2」……
 * 取当前未被占用的最小序号（**从 1 开始**），因此第一次保存就是「胶囊 1」，
 * 用户把某个预设改名后，该序号会被回收给下一个新预设。
 */
export function nextPresetLabel(presets: readonly Pick<Preset, 'label'>[]): string {
  const used = new Set(presets.map((preset) => preset.label));
  let index = 1;
  while (used.has(`${PRESET_LABEL_PREFIX} ${index}`)) index += 1;
  return `${PRESET_LABEL_PREFIX} ${index}`;
}

/**
 * 自动胶囊名的长度上限（按**字符**数算，一个汉字与一个字母各算一个）。
 *
 * 用户 2026 轮的例子：「千早爱音来自MyGO是一个非常可爱的女孩」→ 取「千早爱音来自MyGO」，
 * 正好 10 个字符（6 个汉字 + MyGO 的 4 个字母），因此这里取 10。
 */
export const CAPSULE_AUTO_NAME_MAX = 10;

/**
 * 「第一个分句」的分隔符：中文逗号 / 顿号 / 分号 / 句号 / 问号 / 感叹号、英文对应，
 * 以及换行。
 *
 * 用户口径：「如果出现逗号截断取前，例如『千早爱音，来自MyGO』这个时候就只取千早爱音」。
 * 顿号与句号同理 —— 名字只取第一句才像个名字。
 *
 * 刻意**不含**英文句点 `.` 与冒号 `:`：这两样更可能出现在正常的英文片段里（例如 `v1.5`），
 * 误切比不切更难解释。
 */
const NAME_SEPARATORS = /[，,、;；。！？!?\n\r]+/;

/**
 * 从模块的中文源内容里猜一个胶囊名（D84）。
 *
 * 目的：在用模块枢把译文存成胶囊时，省掉「手打名字」这一步 —— 输入框里写的是什么，
 * 胶囊就叫什么。
 *
 * 规则（按顺序）：
 * 1. 去掉全部胶囊锚点（`[[cap:…]]` 是给渲染用的标记，用户看不到它，也不该出现在名字里）；
 * 2. 只取**第一个分句**（遇到逗号/顿号/分号/句号/问号/感叹号/换行就截断）；
 * 3. 把连续空白收成一个空格并 trim；
 * 4. 最多 {@link CAPSULE_AUTO_NAME_MAX} 个字符（按码点切，不切坏 emoji）。
 *
 * 返回空字符串表示「没有可用的中文」（例如模块里只有胶囊、或干脆是空的），
 * 调用方应当回落到 {@link nextPresetLabel} 的默认名。
 */
export function capsuleNameFromSource(sourceText: string): string {
  const visible = stripAllAnchors(sourceText);
  const firstClause = visible.split(NAME_SEPARATORS)[0] ?? '';
  const condensed = firstClause.replace(/\s+/g, ' ').trim();
  if (!condensed) return '';
  return Array.from(condensed).slice(0, CAPSULE_AUTO_NAME_MAX).join('').trim();
}

/**
 * 让自动名不撞车：同名已存在时追加「 2」「 3」……（与默认名「胶囊 1」的写法一致）。
 *
 * 为什么必须去重：预设编辑器会校验重名（`isPresetLabelTaken`），
 * 自动名若撞上已有预设，用户点保存只会看到一条错误 —— 比默认名还难用。
 */
export function uniquePresetLabel(
  label: string,
  presets: readonly Pick<Preset, 'label'>[],
): string {
  const trimmed = label.trim();
  if (!trimmed) return trimmed;
  const used = new Set(presets.map((preset) => preset.label.trim()));
  if (!used.has(trimmed)) return trimmed;
  let index = 2;
  while (used.has(`${trimmed} ${index}`)) index += 1;
  return `${trimmed} ${index}`;
}

/** 命名是否已被占用（编辑自身时用 exceptId 排除自己） */
export function isPresetLabelTaken(
  presets: readonly Pick<Preset, 'id' | 'label'>[],
  label: string,
  exceptId?: string,
): boolean {
  const target = label.trim();
  return presets.some((preset) => preset.id !== exceptId && preset.label.trim() === target);
}
