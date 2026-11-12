import {
  CAPSULE_WEIGHT_DEFAULT,
  CAPSULE_WEIGHT_MAX,
  CAPSULE_WEIGHT_MIN,
  CAPSULE_WEIGHT_STEP,
} from '../../constants/limits';
import type { CapsulePillVisual } from '../../types/module';
import { formatCapsuleWeight, roundCapsuleWeight } from '../../utils/capsuleWeight';
import { resolveColorGradient, resolveColorHex } from '../../utils/color';
import { FALLBACK_CAPSULE_LABEL } from '../../utils/moduleSanitize';

/**
 * 编辑器药丸的 DOM 构造与就地更新（`sourceDom.ts` 的邻居）。
 *
 * 为什么单独一份：药丸是 contenteditable 里唯一由代码手搓的「原子节点」，
 * 它有自己的几何（名字块 + 权重区）、自己的属性、自己的就地更新通道；
 * 而 `sourceDom.ts` 管的是另一件事 —— 把 DOM 序列化回源内容、判断要不要重建。
 * 两件事的改动理由完全不同，混在一个文件里最容易顺手改坏另一边。
 *
 * D120（`UI.html` 原稿）：权重控件做在**药丸内部** —— 常态不占位，悬停原地展开
 * `− 值 +`；已加权时常态只露数值。权重是纯数字，英文仍然一个字都进不来。
 */

export const CAPSULE_PILL_CLASS = 'pf-capsule pf-capsule--inline';
export const CAPSULE_ID_ATTR = 'data-capsule-id';
/** 归属色也写进 DOM：预设改色时药丸要跟着变，`domMatchesSource` 靠它判断是否需要重建 */
export const CAPSULE_COLOR_ATTR = 'data-capsule-color';
/** 权重也写进 DOM：改权重时药丸右侧那一格要跟着变，同样靠 `domMatchesSource` 判断 */
export const CAPSULE_WEIGHT_ATTR = 'data-capsule-weight';
/** 加减按钮的动作标记（`minus` / `plus`）：事件委托靠它认人 */
export const CAPSULE_WEIGHT_ACTION_ATTR = 'data-capsule-weight-action';
/** 权重数值那一格（双击进手输） */
export const CAPSULE_WEIGHT_VALUE_CLASS = 'pf-capsule__weight-value';
/** 已加权（≠ 1）时挂上，常态就露数值 */
export const CAPSULE_WEIGHTED_CLASS = 'pf-capsule--weighted';
/** 名字那一格（中文名）：序列化与一致性判定都只认它 */
export const CAPSULE_TEXT_CLASS = 'pf-capsule__text';

/** 视图里的权重（缺省按 1 —— JS 调用方可能只给 label + colorId） */
export function weightOfVisual(visual: CapsulePillVisual | undefined): number {
  return roundCapsuleWeight(visual?.weight ?? CAPSULE_WEIGHT_DEFAULT);
}

/** 一颗药丸的权重（DOM 是唯一真源：改权重时先改它，Store 随其后） */
export function readCapsulePillWeight(pill: Element): number {
  return roundCapsuleWeight(Number(pill.getAttribute(CAPSULE_WEIGHT_ATTR)));
}

/**
 * 就地把一颗药丸的权重那一格改掉（**不重排 DOM**）。
 *
 * 为什么不干脆重建整个编辑器：重建会让光标跳到末尾。加减是点出来的，
 * 点完还盯着同一颗药丸，光标却被打到别处就太粗了。外部改动（套快照 / 撤销）
 * 不需要担心这个，那时 `domMatchesSource` 会判定不一致、照常整块重建。
 */
export function updateCapsulePillWeight(pill: HTMLElement, weight: number): void {
  const value = roundCapsuleWeight(weight);
  pill.setAttribute(CAPSULE_WEIGHT_ATTR, formatCapsuleWeight(value));
  pill.classList.toggle(CAPSULE_WEIGHTED_CLASS, value !== CAPSULE_WEIGHT_DEFAULT);

  const valueEl = pill.querySelector(`.${CAPSULE_WEIGHT_VALUE_CLASS}`);
  if (valueEl) valueEl.textContent = formatCapsuleWeight(value);

  for (const step of pill.querySelectorAll(`[${CAPSULE_WEIGHT_ACTION_ATTR}]`)) {
    const atMin = value <= CAPSULE_WEIGHT_MIN;
    const atMax = value >= CAPSULE_WEIGHT_MAX;
    const disabled = step.getAttribute(CAPSULE_WEIGHT_ACTION_ATTR) === 'minus' ? atMin : atMax;
    step.setAttribute('aria-disabled', disabled ? 'true' : 'false');
  }
}

/** 权重区：`− 值 +`。加减是非聚焦的 span（不是 button），点了不会把焦点从编辑器抢走 */
function createCapsuleWeightArea(doc: Document, weight: number): HTMLElement {
  const area = doc.createElement('span');
  area.className = 'pf-capsule__weight';

  const step = (action: 'minus' | 'plus', glyph: string, label: string): HTMLElement => {
    const el = doc.createElement('span');
    el.className = 'pf-capsule__weight-step';
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '-1');
    el.setAttribute(CAPSULE_WEIGHT_ACTION_ATTR, action);
    el.setAttribute('aria-label', label);
    el.textContent = glyph;
    return el;
  };

  const value = doc.createElement('span');
  value.className = CAPSULE_WEIGHT_VALUE_CLASS;
  value.setAttribute('role', 'button');
  value.setAttribute('tabindex', '-1');
  value.setAttribute('title', '双击可手动输入权重');
  value.textContent = formatCapsuleWeight(weight);

  area.appendChild(step('minus', '−', `权重减少 ${CAPSULE_WEIGHT_STEP}`));
  area.appendChild(value);
  area.appendChild(step('plus', '+', `权重增加 ${CAPSULE_WEIGHT_STEP}`));
  return area;
}

/**
 * 胶囊药丸：contenteditable=false 让它成为一个原子节点，
 * 光标无法进入内部，退格键一次删掉整个药丸。
 * 只写入 label，绝不写入英文内容。
 *
 * 结构与预设库里的色点完全一致（圆点 + 渐变 + 同名类名），
 * 因此「预设库里是什么样，拖进文本框就是什么样」（需求 3、4）。
 *
 * 药丸内部的文字**不会**被 `serializeSourceDom` 收进源内容（`collectText` 命中锚点后
 * 直接 continue），所以权重数字与加减号不会变成用户的提示词。
 */
export function createCapsulePill(
  doc: Document,
  capsuleId: string,
  visual: CapsulePillVisual | undefined,
): HTMLElement {
  const pill = doc.createElement('span');
  pill.className = CAPSULE_PILL_CLASS;
  pill.setAttribute('contenteditable', 'false');
  pill.setAttribute(CAPSULE_ID_ATTR, capsuleId);
  pill.setAttribute(CAPSULE_COLOR_ATTR, visual?.colorId ?? '');

  const colorId = visual?.colorId ?? '';
  pill.style.setProperty('--pf-capsule-color', resolveColorHex(colorId));
  pill.style.setProperty('--pf-capsule-gradient', resolveColorGradient(colorId));

  const text = visual?.label || FALLBACK_CAPSULE_LABEL;
  pill.setAttribute('title', `${text}（按退格键可移除）`);

  const dot = doc.createElement('span');
  dot.className = 'pf-capsule__dot';
  dot.setAttribute('aria-hidden', 'true');

  const label = doc.createElement('span');
  label.className = CAPSULE_TEXT_CLASS;
  label.textContent = text;

  const name = doc.createElement('span');
  name.className = 'pf-capsule__name';
  name.appendChild(dot);
  name.appendChild(label);

  const weight = weightOfVisual(visual);
  pill.appendChild(name);
  pill.appendChild(createCapsuleWeightArea(doc, weight));
  updateCapsulePillWeight(pill, weight);
  return pill;
}
