import { DICTIONARY_COLOR_ID } from '../constants/colors';
import { MODULE_DEFAULT_HEIGHT, MODULE_MAX_COUNT } from '../constants/limits';
import type { Capsule, Module } from '../types/module';
import type { Snapshot, SnapshotModule, SnapshotScope } from '../types/snapshot';
import { migrateWeightFromEnglish, roundCapsuleWeight } from './capsuleWeight';
import { normalizeModuleColor, normalizePresetColor } from './color';
import { createId } from './id';

/** 撤销栈深度（用户 2026 轮：3 层就够） */
export const SNAPSHOT_UNDO_DEPTH = 3;
/** 快照名长度上限 */
export const SNAPSHOT_NAME_MAX = 40;

/** 撤销条目：覆盖前的**完整**工作区（含译文与状态），撤销时原样塞回 */
export interface WorkspaceUndoEntry {
  id: string;
  at: number;
  label: string;
  modules: Module[];
  selectedModuleId: string;
}

/** 把当前模块深拷贝成快照模块（胶囊取完整副本，颜色与权重一起存） */
export function captureModules(modules: readonly Module[]): SnapshotModule[] {
  return modules.map((module) => ({
    sourceText: module.sourceText,
    colorId: module.colorId,
    capsules: module.capsules.map((capsule) => ({
      id: capsule.id,
      presetId: capsule.presetId,
      name: capsule.label,
      english: capsule.english,
      colorId: capsule.colorId,
      // D121：权重是数据字段，跟着胶囊一起存，还原时才不用反解析英文
      ...(capsule.weight !== undefined ? { weight: capsule.weight } : {}),
      // D85：词典 Tag 的标记要一起存，否则还原后它会变成中文名药丸
      ...(capsule.kind === 'tag' ? { kind: 'tag' as const } : {}),
    })),
  }));
}

/** 深拷贝整个工作区（撤销用） */
export function captureWorkspace(
  modules: readonly Module[],
  selectedModuleId: string,
  label: string,
): WorkspaceUndoEntry {
  return {
    id: createId('undo'),
    at: Date.now(),
    label,
    selectedModuleId,
    modules: modules.map((module) => ({
      ...module,
      capsules: module.capsules.map((capsule) => ({ ...capsule })),
      error: module.error ? { ...module.error } : undefined,
      translationMeta: module.translationMeta ? { ...module.translationMeta } : undefined,
    })),
  };
}

function toCapsules(module: SnapshotModule): Capsule[] {
  return module.capsules.map((capsule) => {
    const isTag = capsule.kind === 'tag';
    /**
     * D121：旧快照可能把权重写在 english 里（D120 时代），也可能已经有 weight 字段。
     * 两种都要能还原：优先用字段，没有字段才从 english 迁移一次（和草稿走同一条路子）。
     * 字段判定与草稿侧统一：必须是有限数字；迁移只认 D120 的规范形状。
     */
    const hasWeightField = typeof capsule.weight === 'number' && Number.isFinite(capsule.weight);
    const migrated = hasWeightField ? null : migrateWeightFromEnglish(capsule.english);
    const weight = hasWeightField ? capsule.weight : migrated?.weight;
    return {
      id: capsule.id,
      presetId: capsule.presetId,
      label: capsule.name,
      english: migrated ? migrated.english : capsule.english,
      // 词典 Tag 的归属色是词典色（它不在预设色池里，normalizePresetColor 会落红）
      colorId: isTag ? DICTIONARY_COLOR_ID : normalizePresetColor(capsule.colorId),
      ...(weight != null ? { weight: roundCapsuleWeight(weight) } : {}),
      ...(isTag ? { kind: 'tag' as const } : {}),
    };
  });
}

/**
 * 全局快照落到当前工作区（纯函数，便于断言）。
 *
 * 规则（用户 2026 轮拍板）：
 * - 快照模块**多于**当前 → 补模块（上限 8）；
 * - 快照模块**少于**当前 → 多出来的模块**清空内容但保留**（颜色/序号不变）；
 * - 每排颜色按快照还原；内容没变的排保留原译文，避免无谓重翻。
 */
export function applySnapshotToModules(
  modules: readonly Module[],
  snapshot: Snapshot,
): Module[] {
  const source = snapshot.modules.slice(0, MODULE_MAX_COUNT);
  const count = Math.min(Math.max(modules.length, source.length), MODULE_MAX_COUNT);
  const next: Module[] = [];

  for (let index = 0; index < count; index += 1) {
    const base = modules[index];
    const snap = source[index];

    if (!snap) {
      // 多余模块：保留壳，清空内容
      next.push({
        ...(base as Module),
        sourceText: '',
        capsules: [],
        translation: '',
        status: 'idle',
        error: undefined,
        translationMeta: undefined,
      });
      continue;
    }

    const capsules = toCapsules(snap);
    const changed = !base || base.sourceText !== snap.sourceText;
    next.push({
      id: base?.id ?? createId('mod'),
      order: index + 1,
      colorId: normalizeModuleColor(snap.colorId),
      sourceText: snap.sourceText,
      capsules,
      translation: changed ? '' : (base?.translation ?? ''),
      outputHeight: base?.outputHeight ?? MODULE_DEFAULT_HEIGHT,
      status: changed ? 'idle' : (base?.status ?? 'idle'),
      error: undefined,
      translationMeta: changed ? undefined : base?.translationMeta,
    });
  }

  return next;
}

/** 单模块快照落到目标模块（`modules[0]`） */
export function applySnapshotToModule(module: Module, snapshot: Snapshot): Module {
  const snap = snapshot.modules[0];
  if (!snap) return module;
  const changed = module.sourceText !== snap.sourceText;
  return {
    ...module,
    colorId: normalizeModuleColor(snap.colorId),
    sourceText: snap.sourceText,
    capsules: toCapsules(snap),
    translation: changed ? '' : module.translation,
    status: changed ? 'idle' : module.status,
    error: undefined,
    translationMeta: changed ? undefined : module.translationMeta,
  };
}

/** 快照列表：按关键字过滤（名字），权重降序、同权重按创建时间新→旧 */
export function visibleSnapshots(snapshots: readonly Snapshot[], keyword: string): Snapshot[] {
  const needle = keyword.trim().toLowerCase();
  const filtered = needle
    ? snapshots.filter((snapshot) => snapshot.name.toLowerCase().includes(needle))
    : [...snapshots];
  return filtered.sort((a, b) => b.weight - a.weight || b.createdAt - a.createdAt);
}

/**
 * 「更新」快照（D76）：用当前工作区的内容**原地覆盖**这条快照。
 *
 * 用户诉求：把快照当"方案"用，改了内容以后只想刷新方案本身，
 * 不想「重新保存一次 + 删掉旧的那条」。
 *
 * 口径（纯函数，便于断言）：
 * - **只换内容，不动身份**：`id` / `name` / `scope` / `weight` / `createdAt` 原样保留，
 *   否则「更新」就退化成"删了重建"，权重与名字都会丢；
 * - `updatedAt` 刷新（排序与"最近改过"都靠它）；
 * - 单模块快照仍然只留 1 个模块（`scope === 'module'` 时截断），
 *   与 `buildSnapshot` 保持同一条不变量；
 * - `copyText` 由调用方传入「全文复制」的结果（保存时算过一次，这里重算一次）。
 */
export function updateSnapshotContent(
  snapshot: Snapshot,
  modules: SnapshotModule[],
  copyText: string,
  now: number = Date.now(),
): Snapshot {
  const next = snapshot.scope === 'module' ? modules.slice(0, 1) : modules.slice(0, MODULE_MAX_COUNT);
  return { ...snapshot, modules: next, copyText, updatedAt: now };
}

/** 新建快照：夹取名字/权重/范围，单模块严格只留 1 个 */
export function buildSnapshot(options: {
  name: string;
  scope: SnapshotScope;
  weight?: number;
  modules: SnapshotModule[];
  copyText?: string;
  now?: number;
}): Snapshot {
  const now = options.now ?? Date.now();
  const modules = options.scope === 'module' ? options.modules.slice(0, 1) : options.modules;
  return {
    id: createId('snap'),
    name: options.name.trim().slice(0, SNAPSHOT_NAME_MAX) || '未命名快照',
    scope: options.scope,
    weight: Number.isFinite(options.weight) ? Math.max(0, Math.floor(options.weight as number)) : 100,
    copyText: options.copyText ?? '',
    modules,
    createdAt: now,
    updatedAt: now,
  };
}
