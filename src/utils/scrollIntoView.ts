/**
 * 让「当前选中模块」滚进可视区域。
 *
 * 需求：切换模块的快捷键（Ctrl/Alt + ↑↓）与点选都要把目标行滚进视野；
 * **已经在可视区域内就不滚动**（否则每次切换都抖一下）；
 * 滚动要平滑，不能瞬间跳。
 *
 * 这里刻意手算 scrollTop，而不是用 `element.scrollIntoView()`：
 * 后者会连带滚动所有祖先（包括整个页面），在弹窗或嵌套容器里很容易滚错地方。
 */

export interface RectLike {
  top: number;
  bottom: number;
}

/** 目标行是否已经完整在可视区域内（留出一点内边距，避免贴着边缘） */
export function isFullyVisible(container: RectLike, row: RectLike, padding = 8): boolean {
  return row.top >= container.top + padding && row.bottom <= container.bottom - padding;
}

/**
 * 算出滚动后的 scrollTop：
 * - 已经可见 → 原样返回（调用方据此判断「不需要滚动」）
 * - 在上方 → 与容器上边对齐
 * - 在下方 → 与容器下边对齐
 */
export function nextScrollTop(
  container: RectLike,
  row: RectLike,
  scrollTop: number,
  padding = 8,
): number {
  if (isFullyVisible(container, row, padding)) return scrollTop;
  if (row.top < container.top + padding) {
    // 夹到 0：容器尺寸退化（例如元素还没布局、全是 0）时不该算出负数
    return Math.max(0, scrollTop + (row.top - container.top) - padding);
  }
  return scrollTop + (row.bottom - container.bottom) + padding;
}

/** 把某一行平滑地滚进它父容器的可视区域；已经在区域内则什么都不做 */
export function scrollRowIntoView(row: HTMLElement | null, padding = 8): void {
  if (!row) return;
  const container = row.parentElement;
  if (!container) return;

  const containerRect = container.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  const target = nextScrollTop(
    { top: containerRect.top, bottom: containerRect.bottom },
    { top: rowRect.top, bottom: rowRect.bottom },
    container.scrollTop,
    padding,
  );
  if (target === container.scrollTop) return;

  try {
    container.scrollTo({ top: target, behavior: 'smooth' });
  } catch {
    // 环境不支持平滑滚动（或 scrollTo 未实现）时退化成直接定位，不影响功能
    container.scrollTop = target;
  }
}
