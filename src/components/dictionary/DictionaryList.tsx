import { useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { DRAG_START_THRESHOLD_PX } from '../../constants/limits';
import type { DictionaryItem } from '../../types/dictionary';
import { moveId } from '../../utils/reorder';
import { DictionaryRow } from './DictionaryRow';

interface DictionaryListProps {
  items: DictionaryItem[];
  disabled?: boolean;
  onReorder: (ids: string[]) => void;
  onToggle: (item: DictionaryItem, enabled: boolean) => void;
  onDelete: (item: DictionaryItem) => void;
}

/** 拖到列表上下边缘多少像素内开始自动滚动，以及每帧滚多少 */
const AUTO_SCROLL_EDGE_PX = 28;
const AUTO_SCROLL_STEP_PX = 10;

const DRAGGING_CLASS = 'pf-dict__row--dragging';
const INSERT_BEFORE_CLASS = 'pf-dict__row--insert-before';
const INSERT_AFTER_CLASS = 'pf-dict__row--insert-after';

/**
 * 词典列表：**拖拽排序**（越靠上优先级越高）。
 *
 * WebView2 不支持 HTML5 原生拖拽（架构 §6.1），因此这里是 Pointer Events 手写：
 * 按住把手记起点 → 移动超过 6px 才算拖拽 → 按行中心线算出「插入边界」→ 松手提交。
 *
 * 用户 2026 轮的体验要求都在这一层：
 * - 被拖的那一行**降透明度 + 阴影**；
 * - 目标位置画一条**主题色插入指示线**（上下边界各一种 class，纯 CSS 画线）；
 * - 拖到列表上下边缘时用 `requestAnimationFrame` **连续平滑滚动**长列表。
 *
 * 为什么拖拽视觉**直接改 DOM class**、而不放进 React 状态：
 * 拖动过程中每帧都在变，走 React 会让整棵列表每帧重渲染；直接切 class 更轻，
 * 也不会和「列表数据变化」的渲染互相打架。松手后才提交一次顺序（走 store）。
 *
 * 另外给把手加了上下方向键：不用鼠标也能调整优先级（读屏用户同样可用）。
 */
export function DictionaryList({
  items,
  disabled = false,
  onReorder,
  onToggle,
  onDelete,
}: DictionaryListProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  function rowElements(): HTMLElement[] {
    return Array.from(
      containerRef.current?.querySelectorAll<HTMLElement>(`[data-dict-row]`) ?? [],
    );
  }

  /** 按「插入边界」点亮指示线：slot = 0..n；拖回原位/紧邻位置时不画 */
  function paint(slot: number, from: number): void {
    const elements = rowElements();
    const showLine = slot !== from && slot !== from + 1;
    elements.forEach((element, index) => {
      element.classList.toggle(DRAGGING_CLASS, index === from);
      element.classList.toggle(INSERT_BEFORE_CLASS, showLine && slot === index);
      element.classList.toggle(
        INSERT_AFTER_CLASS,
        showLine && slot === elements.length && index === elements.length - 1,
      );
    });
  }

  function clearPaint(): void {
    for (const element of rowElements()) {
      element.classList.remove(DRAGGING_CLASS, INSERT_BEFORE_CLASS, INSERT_AFTER_CLASS);
    }
  }

  /** 指针落在哪两行之间：返回 0..n 的边界序号 */
  function computeSlot(clientY: number): number {
    const elements = rowElements();
    for (let index = 0; index < elements.length; index += 1) {
      const rect = elements[index].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return index;
    }
    return elements.length;
  }

  /** 把「边界序号」换算成最终下标（向下拖要减 1，因为自己被拿走了） */
  function targetIndex(from: number, slot: number, count: number): number {
    const raw = slot > from ? slot - 1 : slot;
    return Math.min(Math.max(raw, 0), Math.max(0, count - 1));
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>, index: number) {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    const snapshot = items;
    const startY = event.clientY;
    let latestSlot = index;
    let latestY = startY;
    let started = false;
    let frame = 0;

    const update = (clientY: number) => {
      latestSlot = computeSlot(clientY);
      paint(latestSlot, index);
    };

    // 边缘自动滚动：拖动期间每帧检查一次，滚动后重新算插入位置
    const tick = () => {
      const container = containerRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        // jsdom 里高度是 0：不做自动滚动，避免影响断言
        if (rect.height > 0) {
          if (latestY < rect.top + AUTO_SCROLL_EDGE_PX) {
            container.scrollTop -= AUTO_SCROLL_STEP_PX;
          } else if (latestY > rect.bottom - AUTO_SCROLL_EDGE_PX) {
            container.scrollTop += AUTO_SCROLL_STEP_PX;
          }
          update(latestY);
        }
      }
      frame = window.requestAnimationFrame(tick);
    };

    const handleMove = (moveEvent: PointerEvent) => {
      latestY = moveEvent.clientY;
      if (!started) {
        if (Math.abs(latestY - startY) < DRAG_START_THRESHOLD_PX) return;
        started = true;
        document.body.style.cursor = 'grabbing';
        frame = window.requestAnimationFrame(tick);
      }
      update(latestY);
    };

    const finish = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      if (frame) window.cancelAnimationFrame(frame);
      document.body.style.cursor = '';
      clearPaint();
      if (!started) return;
      const target = targetIndex(index, latestSlot, snapshot.length);
      if (target !== index) {
        onReorder(moveId(snapshot.map((item) => item.id), index, target));
      }
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const target = event.key === 'ArrowUp' ? index - 1 : index + 1;
    if (target < 0 || target >= items.length) return;
    onReorder(moveId(items.map((item) => item.id), index, target));
  }

  return (
    <div className="pf-dict__list pf-scroll-thin" ref={containerRef}>
      {items.map((item, index) => (
        <DictionaryRow
          key={item.id}
          item={item}
          index={index}
          disabled={disabled}
          onPointerDown={handlePointerDown}
          onKeyDown={handleKeyDown}
          onToggle={onToggle}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
