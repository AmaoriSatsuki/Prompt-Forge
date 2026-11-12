import { useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { clampRange } from '../../utils/clamp';

interface PanelSplitterProps {
  /** 'x' = 竖条，左右拖动改宽度；'y' = 横条，上下拖动改高度 */
  axis: 'x' | 'y';
  /** 当前尺寸，仅用作非法值兜底 */
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  /** 根据指针位置与所在容器算出新尺寸（容器 = 分隔条的父元素） */
  measure: (pointer: number, containerRect: DOMRect) => number;
  label: string;
}

/**
 * 可拖拽分隔条。
 *
 * 与拖拽模块一样用 Pointer Events + setPointerCapture：
 * 不用 HTML5 拖拽，也不用只靠 mousemove —— 指针捕获能保证拖出元素范围后仍然收得到事件。
 */
export function PanelSplitter({
  axis,
  value,
  min,
  max,
  onChange,
  measure,
  label,
}: PanelSplitterProps) {
  const draggingRef = useRef(false);

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const element = event.currentTarget;
    const container = element.parentElement;
    if (!container) return;

    event.preventDefault();
    try {
      element.setPointerCapture?.(event.pointerId);
    } catch {
      // 捕获失败时下面的 window 监听仍然能工作
    }
    draggingRef.current = true;
    document.body.style.cursor = axis === 'x' ? 'ew-resize' : 'ns-resize';

    const apply = (clientX: number, clientY: number) => {
      const rect = container.getBoundingClientRect();
      const pointer = axis === 'x' ? clientX : clientY;
      onChange(clampRange(measure(pointer, rect), min, max, value));
    };

    const handleMove = (moveEvent: PointerEvent) => {
      if (!draggingRef.current) return;
      apply(moveEvent.clientX, moveEvent.clientY);
    };
    const handleUp = () => {
      draggingRef.current = false;
      document.body.style.cursor = '';
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
  }

  return (
    <div
      className={`pf-splitter pf-splitter--${axis}`}
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-label={label}
      title={label}
      onPointerDown={handlePointerDown}
    />
  );
}
