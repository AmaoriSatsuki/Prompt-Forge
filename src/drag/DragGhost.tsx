import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { resolveColorGradient, resolveColorHex } from '../utils/color';
import { dragSourceColorId } from '../utils/dnd';
import { useUiStore } from '../store/useUiStore';

/**
 * 拖拽时跟随指针的幽灵元素。
 *
 * 两个必须点：
 * - 用 createPortal 挂到 document.body，避免被任何祖先的 overflow / transform 裁掉；
 * - `pointer-events: none`（在 CSS 里），否则 `document.elementFromPoint` 命中的是幽灵自己，
 *   落点判定会永远失败。
 */
export function DragGhost() {
  const drag = useUiStore((state) => state.drag);

  if (!drag || typeof document === 'undefined') return null;

  // D77：快照块也进了颜色注册表（`snapshot`），因此这里不再需要按来源分叉 ——
  // 12 个色块（含画师 @ / 快照 S）与拖拽幽灵一律从同一处取色。
  const colorId = dragSourceColorId(drag.source);
  const ghostColor = resolveColorHex(colorId);
  const ghostGradient = resolveColorGradient(colorId);
  const style = {
    left: `${drag.pointer.x}px`,
    top: `${drag.pointer.y}px`,
    '--pf-ghost-color': ghostColor,
    '--pf-ghost-gradient': ghostGradient,
  } as CSSProperties;

  return createPortal(
    <div className="pf-ghost" style={style} aria-hidden="true">
      <span className="pf-ghost__dot" />
      <span className="pf-ghost__label">{drag.source.label}</span>
    </div>,
    document.body,
  );
}
