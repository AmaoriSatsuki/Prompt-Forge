import { DICTIONARY_COLOR_ID } from '../constants/colors';
import {
  MODULE_DEFAULT_HEIGHT,
  MODULE_MAX_COUNT,
  MODULE_MAX_HEIGHT,
  MODULE_MIN_HEIGHT,
} from '../constants/limits';
import type { Capsule, Module, ModuleStatus } from '../types/module';
import { migrateWeightFromEnglish, roundCapsuleWeight } from './capsuleWeight';
import { clamp } from './clamp';
import { normalizeModuleColor, normalizePresetColor } from './color';
import { createId } from './id';
import { pruneAnchors } from './placeholder';

/** 胶囊命名缺失时的中文兜底名（编辑器里的药丸与标签行共用） */
export const FALLBACK_CAPSULE_LABEL = '未命名胶囊';

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function sanitizeCapsule(raw: unknown): Capsule | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Partial<Capsule>;
  const id = asString(source.id).trim();
  if (!id) return null;
  // D85：词典 Tag 是唯一带 kind 的胶囊；它的归属色固定是词典色（不进预设色池）
  const isTag = source.kind === 'tag';

  /**
   * D121：权重从 D120 的「写进 english」搬进数据字段。
   *
   * 旧草稿 / 旧快照里 english 可能带着 `(tag:1.5)`，而 weight 字段不存在 ——
   * 直接按 1 处理会让界面上显示 1 而实际输出 1.5。因此这里做一次性迁移：
   * **只有全部段一致、且值是 D120 的规范形状**才剥出来写进字段；
   * `(x:1.234)` / `(x:9)` 这类用户手写的值原样保留（绝不 round/夹断）。
   * 字段判定与快照侧统一：必须是有限数字，`null` / 字符串都不算「有字段」。
   */
  const storedEnglish = asString(source.english);
  const rawWeight = source.weight;
  const hasWeightField = typeof rawWeight === 'number' && Number.isFinite(rawWeight);
  const migrated = hasWeightField ? null : migrateWeightFromEnglish(storedEnglish);

  return {
    id,
    label: asString(source.label).trim() || FALLBACK_CAPSULE_LABEL,
    presetId: asString(source.presetId),
    // 英文内容只参与复制/推流拼接，永不进入界面（D110：Tag 也不再显示英文）
    english: migrated ? migrated.english : storedEnglish,
    // 胶囊颜色跟着预设走；旧草稿里没有这个字段，回落到「白」（无属性）
    colorId: isTag ? DICTIONARY_COLOR_ID : normalizePresetColor(source.colorId),
    ...(hasWeightField ? { weight: roundCapsuleWeight(rawWeight) } : {}),
    ...(migrated?.weight != null ? { weight: migrated.weight } : {}),
    ...(isTag ? { kind: 'tag' as const } : {}),
  };
}

function sanitizeCapsules(raw: unknown): Capsule[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const capsules: Capsule[] = [];
  for (const item of raw) {
    const capsule = sanitizeCapsule(item);
    if (!capsule || seen.has(capsule.id)) continue;
    seen.add(capsule.id);
    capsules.push(capsule);
  }
  return capsules;
}

function sanitizeTranslationMeta(raw: unknown): Module['translationMeta'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const source = raw as { model?: unknown; elapsedMs?: unknown };
  const model = asString(source.model);
  const elapsedMs = Number(source.elapsedMs);
  if (!model && !Number.isFinite(elapsedMs)) return undefined;
  return { model, elapsedMs: Number.isFinite(elapsedMs) ? Math.max(0, Math.round(elapsedMs)) : 0 };
}

/**
 * 规范化一条模块（草稿恢复 / 历史数据）。
 *
 * 关键处理：
 * - **清理孤儿锚点**：引用了不存在胶囊的锚点会被删掉，否则编辑器里会露出 `[[cap:x]]` 字符串；
 * - **状态不会带病恢复**：上次退出时正在翻译的模块回到「待翻译」，
 *   失败原因也不恢复（那是上一次会话的临时信息）；有译文就算「已翻译」；
 * - 胶囊的英文内容原样保留，它只是不显示，不是丢弃。
 */
export function sanitizeModule(raw: unknown, order: number): Module | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Partial<Module>;
  const id = asString(source.id).trim();
  if (!id) return null;

  const capsules = sanitizeCapsules(source.capsules);
  const knownCapsuleIds = new Set(capsules.map((capsule) => capsule.id));
  const sourceText = pruneAnchors(asString(source.sourceText), knownCapsuleIds);
  const translation = asString(source.translation);

  // 上一次会话遗留的「翻译中 / 失败」不应带进新会话：
  // 有译文就算已翻译，否则一律回到待翻译（失败原因与进度都是上一次会话的临时信息）
  const status: ModuleStatus = translation.trim() ? 'done' : 'idle';

  // 输出高度：旧草稿里没有这个字段，回落到默认高度而不是最小值
  const rawHeight = Number(source.outputHeight);
  const outputHeight =
    Number.isFinite(rawHeight) && rawHeight > 0
      ? clamp(rawHeight, MODULE_MIN_HEIGHT, MODULE_MAX_HEIGHT)
      : MODULE_DEFAULT_HEIGHT;

  return {
    id,
    order,
    colorId: normalizeModuleColor(source.colorId),
    sourceText,
    capsules,
    translation,
    outputHeight,
    status,
    translationMeta: sanitizeTranslationMeta(source.translationMeta),
  };
}

/**
 * 规范化整个模块列表。
 *
 * 只做「保住已有内容」的事：数量上限夹到 8、id 唯一、序号重排、孤儿锚点清理。
 * **不做补齐**：列表为空就返回空，由调用方决定是回落到默认模块还是当作没有草稿
 * （「至少 1 个模块」是 Store 的不变量，不在这里悄悄塞一个空模块造成误会）。
 */
export function sanitizeModules(rawList: unknown): Module[] {
  const list = Array.isArray(rawList) ? rawList : [];

  const seenIds = new Set<string>();
  const modules: Module[] = [];
  for (const item of list) {
    if (modules.length >= MODULE_MAX_COUNT) break;
    let module = sanitizeModule(item, modules.length + 1);
    if (!module) continue;
    if (seenIds.has(module.id)) module = { ...module, id: createId('mod') };
    seenIds.add(module.id);
    modules.push(module);
  }

  return modules.map((module, index) =>
    module.order === index + 1 ? module : { ...module, order: index + 1 },
  );
}
