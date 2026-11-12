import type { ColorId } from '../constants/colors';
import {
  MODULE_DEFAULT_HEIGHT,
  MODULE_MAX_COUNT,
  MODULE_MIN_COUNT,
} from '../constants/limits';
import { CAPSULE_WEIGHT_DEFAULT } from '../constants/limits';
import type { Capsule, CapsuleSource, Module } from '../types/module';
import { roundCapsuleWeight } from './capsuleWeight';
import { clamp } from './clamp';
import { allocModuleColor } from './color';
import { createId } from './id';
import { capsuleAnchor, removeCapsuleAnchors } from './placeholder';
import { insertAfterCapsules, insertAtEnd } from './text';

/**
 * 模块列表的纯函数逻辑层。
 *
 * 这一层不依赖 React、不依赖 Zustand，因此「初始 4 个 / 上限 8 / 下限 1 / 颜色自动分配与释放」
 * 这些需求约束可以被离线断言直接验证（见 scripts/verify-logic.cjs）。
 * Store 只是它的薄封装。
 */

export function createModule(usedColorIds: Iterable<ColorId>, order: number): Module {
  return {
    id: createId('mod'),
    order,
    colorId: allocModuleColor(usedColorIds),
    sourceText: '',
    capsules: [],
    translation: '',
    outputHeight: MODULE_DEFAULT_HEIGHT,
    status: 'idle',
  };
}

/** 按需求创建初始模块；数量会被夹在 [下限, 上限] 之间 */
export function buildInitialModules(count: number): Module[] {
  const total = clamp(count, MODULE_MIN_COUNT, MODULE_MAX_COUNT);
  const modules: Module[] = [];
  for (let index = 0; index < total; index += 1) {
    modules.push(createModule(modules.map((m) => m.colorId), index + 1));
  }
  return modules;
}

/**
 * 序号始终等于行位置，删除后自动补位。
 * 序号已全部正确时返回原数组引用，避免删除以外的路径产生无意义的新引用。
 */
export function reindexModules(modules: Module[]): Module[] {
  const needsReindex = modules.some((module, index) => module.order !== index + 1);
  if (!needsReindex) return modules;
  return modules.map((module, index) =>
    module.order === index + 1 ? module : { ...module, order: index + 1 },
  );
}

export function canAddModule(modules: readonly Module[]): boolean {
  return modules.length < MODULE_MAX_COUNT;
}

export function canRemoveModule(modules: readonly Module[]): boolean {
  return modules.length > MODULE_MIN_COUNT;
}

/**
 * 追加一个模块。达到上限时返回 null（调用方据此给中文提示）。
 * 颜色无需显式回收：分配只依赖当前在用颜色集合，被删模块的颜色自然回到可用池。
 */
export function appendModule(
  modules: readonly Module[],
): { modules: Module[]; created: Module } | null {
  if (!canAddModule(modules)) return null;
  const created = createModule(
    modules.map((m) => m.colorId),
    modules.length + 1,
  );
  return { modules: [...modules, created], created };
}

/** 删除模块并修正选中项。低于下限或 id 不存在时返回 null。 */
export function dropModule(
  modules: readonly Module[],
  id: string,
  selectedModuleId: string,
): { modules: Module[]; selectedModuleId: string } | null {
  if (!canRemoveModule(modules)) return null;
  const index = modules.findIndex((m) => m.id === id);
  if (index < 0) return null;

  const rest = reindexModules(modules.filter((m) => m.id !== id));
  const nextSelectedId =
    selectedModuleId === id ? rest[Math.min(index, rest.length - 1)].id : selectedModuleId;
  return { modules: rest, selectedModuleId: nextSelectedId };
}

/**
 * 用更新函数替换某个模块。
 * 更新函数返回原对象时视为未变化，保持数组引用 —— 上层据此避免无意义的重渲染。
 */
export function updateModule(
  modules: readonly Module[],
  id: string,
  updater: (module: Module) => Module,
): Module[] {
  let changed = false;
  const next = modules.map((module) => {
    if (module.id !== id) return module;
    const updated = updater(module);
    if (updated === module) return module;
    changed = true;
    return updated;
  });
  return changed ? next : (modules as Module[]);
}

/** 字段级打补丁（内部走 updateModule） */
export function patchModule(
  modules: readonly Module[],
  id: string,
  patch: Partial<Module>,
): Module[] {
  return updateModule(modules, id, (module) => {
    const keys = Object.keys(patch) as (keyof Module)[];
    const same = keys.every((key) => module[key] === patch[key]);
    return same ? module : { ...module, ...patch };
  });
}

/**
 * 胶囊插入位置（D79）。
 *
 * - `'after-capsules'`：插到**开头那串胶囊之后** —— 先拖入的在前、后拖入的在后（像打字一样），
 *   而它们整体仍然排在译文/中文之前。拖拽走的就是这一条。
 * - `'end'`：插到整段内容的末尾（保留能力，当前界面不用）。
 */
export type CapsulePlacement = 'after-capsules' | 'end';

/**
 * 把一个预设/词典词条作为胶囊插入模块。
 *
 * 胶囊会快照预设的中文命名与英文内容，因此之后修改预设不会影响已经插入的胶囊 ——
 * 这是刻意选择：胶囊一旦进了某段中文内容，就应当是稳定的。
 *
 * D85 / D110：Tag 库、词典词条拖进来的是 `kind: 'tag'` —— 外观与普通胶囊完全一致
 * （色点 + 中文名，只是归属色是词典色），**走的仍是同一条锚点机制**
 * （因此不进翻译请求体，插入位置、清空语义也都继承）。
 */
export function insertCapsuleInto(
  modules: readonly Module[],
  moduleId: string,
  source: CapsuleSource,
  placement: CapsulePlacement,
): Module[] {
  return updateModule(modules, moduleId, (module) => {
    const capsule: Capsule = {
      id: createId('cap'),
      label: source.label,
      presetId: source.presetId,
      english: source.english,
      // 快照预设的归属色：胶囊在输入框里的样式必须与预设库完全一致（需求 3）
      colorId: source.colorId,
      // D121：权重是字段，拖进来时一并快照（缺省 = 1，旧数据形状不变）
      ...(source.weight !== undefined ? { weight: roundCapsuleWeight(source.weight) } : {}),
      // 只有词典 Tag 会带这个字段；普通胶囊保持 undefined，旧数据的形状一个字不变
      ...(source.kind === 'tag' ? { kind: 'tag' as const } : {}),
    };
    const anchor = capsuleAnchor(capsule.id);
    return {
      ...module,
      capsules: [...module.capsules, capsule],
      sourceText:
        placement === 'after-capsules'
          ? insertAfterCapsules(module.sourceText, anchor)
          : insertAtEnd(module.sourceText, anchor),
    };
  });
}

/** 移除胶囊，并清掉它在源内容里的全部锚点 */
export function removeCapsuleFrom(
  modules: readonly Module[],
  moduleId: string,
  capsuleId: string,
): Module[] {
  return updateModule(modules, moduleId, (module) => {
    if (!module.capsules.some((capsule) => capsule.id === capsuleId)) return module;
    return {
      ...module,
      capsules: module.capsules.filter((capsule) => capsule.id !== capsuleId),
      sourceText: removeCapsuleAnchors(module.sourceText, capsuleId),
    };
  });
}

/** 修改某个模块里某条胶囊的中文命名（只影响这一条，不影响预设库） */
export function renameCapsuleIn(
  modules: readonly Module[],
  moduleId: string,
  capsuleId: string,
  label: string,
): Module[] {
  const trimmed = label.trim();
  if (!trimmed) return modules as Module[];
  return updateModule(modules, moduleId, (module) => {
    const target = module.capsules.find((capsule) => capsule.id === capsuleId);
    if (!target || target.label === trimmed) return module;
    return {
      ...module,
      capsules: module.capsules.map((capsule) =>
        capsule.id === capsuleId ? { ...capsule, label: trimmed } : capsule,
      ),
    };
  });
}

/**
 * 改某条胶囊的权重（D121）。
 *
 * 口径：权重是**数据字段**（`Capsule.weight`），不写进 english ——
 * 英文保持原始内容，渲染（`(tag:1.5)`）发生在装配阶段
 * （`utils/promptText.ts` + `renderWeightedEnglish`）。
 *
 * 结果与旧值相同时返回原数组引用，避免无意义的重渲染与草稿写盘。
 */
export function setCapsuleWeightIn(
  modules: readonly Module[],
  moduleId: string,
  capsuleId: string,
  weight: number,
): Module[] {
  const next = roundCapsuleWeight(weight);
  return updateModule(modules, moduleId, (module) => {
    const target = module.capsules.find((capsule) => capsule.id === capsuleId);
    if (!target) return module;
    if ((target.weight ?? CAPSULE_WEIGHT_DEFAULT) === next) return module;
    return {
      ...module,
      capsules: module.capsules.map((capsule) =>
        capsule.id === capsuleId ? { ...capsule, weight: next } : capsule,
      ),
    };
  });
}
