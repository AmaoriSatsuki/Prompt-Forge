import type { CapsulePillVisual } from '../../types/module';
import { formatCapsuleWeight } from '../../utils/capsuleWeight';
import { FALLBACK_CAPSULE_LABEL } from '../../utils/moduleSanitize';
import { capsuleAnchor, parseSource } from '../../utils/placeholder';
import {
  CAPSULE_COLOR_ATTR,
  CAPSULE_ID_ATTR,
  CAPSULE_TEXT_CLASS,
  CAPSULE_WEIGHT_ATTR,
  createCapsulePill,
  weightOfVisual,
} from './capsulePill';

/** 编辑器里的胶囊视图：id → 中文名 + 归属色 + 权重（Tag 与普通胶囊完全同一种） */
export type CapsuleVisualMap = ReadonlyMap<string, CapsulePillVisual>;

/**
 * 源内容编辑器的 DOM 适配层：**只做 DOM ↔ 源内容字符串的换算与比较**。
 *
 * 为什么单独抽一层：编辑器用 contenteditable，React 不能托管它的子节点
 * （让 React 渲染子节点会打断中文输入法与光标），所以「DOM ↔ 源内容字符串」的转换必须自己写。
 * 这也是整个应用最容易丢数据的地方，因此它被写成纯函数，
 * 由 jsdom 做真实往返断言（scripts/verify-dom.cjs）。
 *
 * 药丸本身怎么长（圆点、名字、权重区、就地改权重）在 `capsulePill.ts`：
 * 那是「造节点」的事，这里是「读节点」的事，改动理由不同，不放在一起。
 */

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

/** 把编辑器 DOM 序列化回源内容字符串（胶囊还原成内部锚点） */
export function serializeSourceDom(
  root: HTMLElement,
  knownCapsuleIds: ReadonlySet<string>,
): string {
  const parts: string[] = [];
  collectText(root, parts, knownCapsuleIds);
  return parts.join('');
}

/**
 * 规范化序列化结果。
 * Chromium 在内容被删空后会留下一个孤立的 &lt;br&gt;，那不是用户内容；
 * 归一成空串后，占位提示才出得来，源内容里也不会残留莫名其妙的换行。
 */
export function normalizeEditorText(text: string): string {
  return text === '\n' ? '' : text;
}

function collectText(parent: Node, parts: string[], knownCapsuleIds: ReadonlySet<string>): void {
  const children = parent.childNodes;
  for (let index = 0; index < children.length; index += 1) {
    const node = children[index];

    if (node.nodeType === TEXT_NODE) {
      parts.push(node.textContent ?? '');
      continue;
    }
    if (node.nodeType !== ELEMENT_NODE) continue;

    const element = node as HTMLElement;
    const capsuleId = element.getAttribute(CAPSULE_ID_ATTR);
    if (capsuleId && knownCapsuleIds.has(capsuleId)) {
      parts.push(capsuleAnchor(capsuleId));
      continue;
    }

    const tag = element.tagName;
    if (tag === 'BR') {
      parts.push('\n');
      continue;
    }
    // Chromium 在 contenteditable 里常用 div / p 表示换行；只补换行，不保留任何格式
    if ((tag === 'DIV' || tag === 'P') && parts.length > 0) {
      parts.push('\n');
    }
    collectText(element, parts, knownCapsuleIds);
  }
}

/**
 * DOM 是否已经与源内容一致。
 *
 * 只比较字符串是不够的：胶囊的中文命名被改过时字符串没变，但药丸上的文字需要更新。
 * 因此这里同时逐个比对药丸的 id 与文字。
 */
export function domMatchesSource(
  root: HTMLElement,
  sourceText: string,
  capsules: CapsuleVisualMap,
): boolean {
  const knownCapsuleIds = new Set(capsules.keys());
  if (serializeSourceDom(root, knownCapsuleIds) !== sourceText) return false;

  const pills = root.querySelectorAll(`[${CAPSULE_ID_ATTR}]`);
  const segments = parseSource(sourceText, knownCapsuleIds);
  let pillIndex = 0;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment.kind !== 'capsule') continue;

    const pill = pills[pillIndex] as HTMLElement | undefined;
    if (!pill) return false;
    if (pill.getAttribute(CAPSULE_ID_ATTR) !== segment.capsuleId) return false;

    const visual = capsules.get(segment.capsuleId);
    // D110：Tag 与普通胶囊一样显示中文名（英文永远不进 DOM）
    const expected = visual?.label ?? FALLBACK_CAPSULE_LABEL;
    // 只比 label 是不够的：预设改了归属色时字符串没变，但药丸的颜色要跟着变
    if (pill.getAttribute(CAPSULE_COLOR_ATTR) !== (visual?.colorId ?? '')) return false;
    // 权重同理：数字变了字符串没变，右侧那一格要跟着变
    if (pill.getAttribute(CAPSULE_WEIGHT_ATTR) !== formatCapsuleWeight(weightOfVisual(visual))) {
      return false;
    }
    const text = pill.querySelector(`.${CAPSULE_TEXT_CLASS}`);
    if ((text?.textContent ?? '') !== expected) return false;
    pillIndex += 1;
  }

  return pillIndex === pills.length;
}

/** 清空并按源内容字符串重建编辑器 DOM */
export function renderSourceInto(
  root: HTMLElement,
  sourceText: string,
  capsules: CapsuleVisualMap,
): void {
  const doc = root.ownerDocument;
  while (root.firstChild) root.removeChild(root.firstChild);

  const knownCapsuleIds = new Set(capsules.keys());
  const segments = parseSource(sourceText, knownCapsuleIds);

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment.kind === 'text') {
      appendTextWithBreaks(root, segment.text, doc);
      continue;
    }
    const visual = capsules.get(segment.capsuleId);
    // D110：词典 Tag 也走药丸 —— 与画师库/预设库拖进来的一模一样，只是归属色是词典色
    root.appendChild(createCapsulePill(doc, segment.capsuleId, visual));
  }
}

function appendTextWithBreaks(root: HTMLElement, text: string, doc: Document): void {
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    if (index > 0) root.appendChild(doc.createElement('br'));
    if (lines[index]) root.appendChild(doc.createTextNode(lines[index]));
  }
}

/**
 * D110：词典 Tag 不再有专属的「纯文本节点」渲染分支。
 *
 * 曾经的 `createTagInline`（D85）把 Tag 画成 `long hair` 这样的纯英文文本，
 * 结果同一颗词条在输出框里是「色点 + 中文名」的药丸、在输入框里却是一串英文字母 ——
 * 用户判定这是漏掉的一块。现在 Tag 与画师库/预设库拖进来的胶囊**完全同构**：
 * 同一个 `createCapsulePill`、同一份 `CapsulePillVisual`、唯一差别是归属色固定为词典色。
 * 它仍然是锚点，因此照样不进翻译请求体；英文仍然只出现在复制/推流载荷里。
 */

/** 把光标放到编辑器末尾（仅在编辑器本来就有焦点时调用） */
export function placeCaretAtEnd(root: HTMLElement): void {
  const doc = root.ownerDocument;
  const selection = doc.getSelection();
  if (!selection) return;
  const range = doc.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}
