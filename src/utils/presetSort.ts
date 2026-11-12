import type { Preset } from '../types/preset';

type Sortable = Pick<Preset, 'weight' | 'label' | 'id'>;

/**
 * 预设排序（已定案）：
 * 1. 权重降序（需求 6）
 * 2. 权重相同 → 名称升序。中文按拼音、数字按数值比较（Intl.Collator，比 ASCII 码序更符合中文用户直觉）
 * 3. 仍相同 → id 升序兜底，保证排序稳定、不会因引用顺序抖动
 *
 * Collator 的构造有开销，因此在模块作用域只创建一次。
 */
const nameCollator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' });

export function comparePresets(a: Sortable, b: Sortable): number {
  if (a.weight !== b.weight) return b.weight - a.weight;
  const byName = nameCollator.compare(a.label, b.label);
  if (byName !== 0) return byName;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/** 返回排序后的新数组，不修改入参。 */
export function sortPresets<T extends Sortable>(list: readonly T[]): T[] {
  return [...list].sort(comparePresets);
}
