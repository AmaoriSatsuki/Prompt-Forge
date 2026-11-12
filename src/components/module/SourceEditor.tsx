import { useCallback, useEffect, useMemo, useRef } from 'react';
import { MODULE_SOURCE_MAX_LENGTH, CAPSULE_WEIGHT_DEFAULT } from '../../constants/limits';
import { useModuleStore } from '../../store/useModuleStore';
import { useUiStore } from '../../store/useUiStore';
import type { Module } from '../../types/module';
import {
  formatCapsuleWeight,
  parseWeightInput,
  stepCapsuleWeight,
} from '../../utils/capsuleWeight';
import { registerEditorFocus } from '../../utils/editorFocus';
import { clampSourceText } from '../../utils/placeholder';
import {
  CAPSULE_ID_ATTR,
  CAPSULE_WEIGHT_ACTION_ATTR,
  CAPSULE_WEIGHT_VALUE_CLASS,
  readCapsulePillWeight,
  updateCapsulePillWeight,
} from './capsulePill';
import {
  domMatchesSource,
  normalizeEditorText,
  placeCaretAtEnd,
  renderSourceInto,
  serializeSourceDom,
} from './sourceDom';

interface SourceEditorProps {
  module: Module;
}

/**
 * 中文源内容编辑器（下方输入框里的那一个）。
 *
 * 需求 2：它是「当前选中模块」的中文源内容编辑器，不是全局输入框 ——
 * 切换选中的模块，这个框里的内容就跟着换成那个模块的源内容。
 * 需求 4：胶囊在这里显示成只带中文命名的药丸，英文内容永远不进入 DOM。
 *
 * 实现要点（contenteditable 的三个坑）：
 * 1. React 不渲染这个 div 的子节点，DOM 完全由 sourceDom.ts 管理，否则会打断中文输入法与光标；
 * 2. 打字路径不重建 DOM —— 只有「DOM 与源内容不一致」时才重建，因此输入法组合期间不会被打断；
 * 3. 每次 input 都立即把 DOM 序列化回 Store，Store 是唯一真源。
 *
 * 高度由外层输入框（分隔条调整）决定，这里只负责填满 + 超出时细滚动。
 */
export function SourceEditor({ module }: SourceEditorProps) {
  const setSourceText = useModuleStore((state) => state.setSourceText);
  const setCapsuleWeight = useModuleStore((state) => state.setCapsuleWeight);
  const pushToast = useUiStore((state) => state.pushToast);
  const elementRef = useRef<HTMLDivElement | null>(null);

  /**
   * 胶囊权重（D120 / UI.html 原稿）：控件做在**药丸内部**，悬停由 CSS 负责展开，
   * 因此这里既没有菜单、没有定时器，也没有 Portal。
   *
   * 药丸是 contenteditable 里的原子节点，React 不托管它 —— 所以交互只能靠事件委托：
   * - `pointerdown` 命中 `[data-capsule-weight-action]` → 走一个步进；
   * - 双击数值那一格 → 在同一个位置换成输入框（回车提交、Esc/失焦放弃）。
   *
   * 关键约束：药丸内部的文字不会被序列化（`collectText` 命中锚点后直接 continue），
   * 所以这些数字与加减号不会变成用户的提示词。
   */
  const editWeight = useCallback(
    (pill: HTMLElement, weight: number) => {
      const capsuleId = pill.getAttribute(CAPSULE_ID_ATTR);
      if (!capsuleId) return;
      // 先把 DOM 改掉再写 Store：这样 domMatchesSource 判定一致，不会整块重建、光标不跳
      updateCapsulePillWeight(pill, weight);
      setCapsuleWeight(module.id, capsuleId, weight);
    },
    [module.id, setCapsuleWeight],
  );

  const handleWeightPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const actionEl = target.closest(`[${CAPSULE_WEIGHT_ACTION_ATTR}]`);
      if (!actionEl) return;
      const pill = actionEl.closest(`[${CAPSULE_ID_ATTR}]`);
      if (!(pill instanceof HTMLElement)) return;

      const capsuleId = pill.getAttribute(CAPSULE_ID_ATTR);
      const capsule = module.capsules.find((item) => item.id === capsuleId);
      if (!capsule) return;

      // 不 preventDefault 的话，光标会被挪到药丸旁边（点权重不该动光标）
      event.preventDefault();
      if (actionEl.getAttribute('aria-disabled') === 'true') return;

      const direction = actionEl.getAttribute(CAPSULE_WEIGHT_ACTION_ATTR) === 'plus' ? 1 : -1;
      const next = stepCapsuleWeight(readCapsulePillWeight(pill), direction);
      editWeight(pill, next);
    },
    [editWeight, module.capsules],
  );

  /** 双击数值 → 就地换成输入框；回车提交，Esc / 失焦放弃（不静默写库） */
  const handleWeightDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const valueEl = target.closest(`.${CAPSULE_WEIGHT_VALUE_CLASS}`);
      if (!(valueEl instanceof HTMLElement)) return;
      const pill = valueEl.closest(`[${CAPSULE_ID_ATTR}]`);
      if (!(pill instanceof HTMLElement)) return;
      if (pill.querySelector('.pf-capsule__weight-input')) return;

      const doc = valueEl.ownerDocument;
      const input = doc.createElement('input');
      input.className = 'pf-capsule__weight-input';
      input.type = 'text';
      input.setAttribute('inputmode', 'decimal');
      input.setAttribute('aria-label', '手动输入权重');
      input.value = formatCapsuleWeight(readCapsulePillWeight(pill));

      const close = (commit: boolean) => {
        if (!input.isConnected) return;
        const parsed = parseWeightInput(input.value);
        input.remove();
        valueEl.style.removeProperty('display');
        if (commit && parsed !== null && parsed !== readCapsulePillWeight(pill)) {
          editWeight(pill, parsed);
        } else if (commit) {
          updateCapsulePillWeight(pill, readCapsulePillWeight(pill));
        }
      };

      input.addEventListener('keydown', (keyEvent) => {
        if (keyEvent.key === 'Enter') {
          keyEvent.preventDefault();
          close(true);
        } else if (keyEvent.key === 'Escape') {
          keyEvent.preventDefault();
          keyEvent.stopPropagation();
          close(false);
        }
      });
      input.addEventListener('blur', () => close(false));
      // 输入框本身也在药丸里，点它不该触发编辑器的光标逻辑
      input.addEventListener('pointerdown', (pointerEvent) => pointerEvent.stopPropagation());

      valueEl.style.display = 'none';
      valueEl.after(input);
      input.focus();
      input.select();
    },
    [editWeight],
  );

  const labels = useMemo(
    () =>
      new Map(
        module.capsules.map((capsule) => [
          capsule.id,
          /*
           * D110：词典 Tag 与普通胶囊取**完全相同**的这一份视图（中文名 + 归属色 + 权重数字）。
           * 英文一个字都不带进来 —— 「胶囊英文永不进界面」不再有例外。
           */
          {
            label: capsule.label,
            colorId: capsule.colorId,
            // D121：权重是字段，不再从 english 反解析
            weight: capsule.weight ?? CAPSULE_WEIGHT_DEFAULT,
          },
        ]),
      ),
    [module.capsules],
  );

  const knownIds = useMemo(() => new Set(labels.keys()), [labels]);

  const pushToStore = useCallback(() => {
    const element = elementRef.current;
    if (!element) return;
    const raw = normalizeEditorText(serializeSourceDom(element, knownIds));

    /**
     * 单模块字数上限（5000）：只算用户看得见的字符，胶囊锚点不占额度。
     * 超了就把 DOM 与 Store 一起改回截断后的内容 —— 输入因此被硬性挡住，
     * 而不是「先收下再报错」。没超限时 clampSourceText 返回 null，这里完全不碰 DOM，
     * 免得每次打字都重建编辑器、打断中文输入法。
     */
    const clamped = clampSourceText(raw, knownIds, MODULE_SOURCE_MAX_LENGTH);
    if (clamped !== null) {
      renderSourceInto(element, clamped, labels);
      placeCaretAtEnd(element);
      setSourceText(module.id, clamped);
      pushToast(`单个模块最多 ${MODULE_SOURCE_MAX_LENGTH} 字，超出的部分没有输入`, 'warn');
      return;
    }

    setSourceText(module.id, raw);
  }, [knownIds, labels, module.id, setSourceText, pushToast]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    if (domMatchesSource(element, module.sourceText, labels)) return;

    renderSourceInto(element, module.sourceText, labels);
    // 拖入胶囊、清空、切换模块都会走到这里；只有编辑器本来有焦点时才接管光标
    if (element.contains(element.ownerDocument.activeElement)) placeCaretAtEnd(element);
  }, [module.sourceText, labels]);

  /** 切换模块的快捷键按下后要把焦点交回这里（需求 1） */
  useEffect(() => {
    registerEditorFocus(() => {
      const element = elementRef.current;
      if (!element) return;
      element.focus();
      placeCaretAtEnd(element);
    });
    return () => registerEditorFocus(null);
  }, []);

  /** 粘贴一律按纯文本插入，既保留撤销栈，也避免外来样式污染 DOM */
  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      const text = event.clipboardData.getData('text/plain');
      if (!text) return;
      event.preventDefault();
      try {
        if (!event.currentTarget.ownerDocument.execCommand('insertText', false, text)) {
          throw new Error('execCommand 未生效');
        }
      } catch {
        const doc = event.currentTarget.ownerDocument;
        const selection = doc.getSelection();
        if (selection && selection.rangeCount > 0) {
          selection.deleteFromDocument();
          selection.getRangeAt(0).insertNode(doc.createTextNode(text));
          selection.collapseToEnd();
        }
      }
      pushToStore();
    },
    [pushToStore],
  );

  return (
    <div
      ref={elementRef}
      className="pf-source__input pf-scroll-thin"
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      // tabIndex=-1：可以被程序聚焦（切换模块的快捷键要把焦点交回来），但不进 Tab 顺序
      tabIndex={-1}
      aria-label={`模块 ${module.order} 的中文源内容`}
      data-placeholder="输入中文提示词，用逗号分隔，可拖入预设胶囊。例如：女孩，长头发，微笑"
      spellCheck={false}
      onInput={pushToStore}
      onBlur={pushToStore}
      onPaste={handlePaste}
      // D120：药丸内部的加减与双击手输（悬停展开由 CSS 负责，不需要状态）
      onPointerDown={handleWeightPointerDown}
      onDoubleClick={handleWeightDoubleClick}
    />
  );
}
