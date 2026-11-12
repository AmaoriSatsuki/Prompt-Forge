/**
 * 分页（D66）：预设库 / 画师库共用。
 *
 * 只有「固定条数分页」这一种口径：保留列表自身的滚动条，
 * 每页固定 LIBRARY_PAGE_SIZE 条。**不做「按可视空间容量分页」**——
 * 胶囊是自适应宽度会换行的 chip，一页能放几个只有真实布局算得出来，
 * 而 jsdom 里尺寸全是 0，这种方案在自动化里完全测不到（见 DECISIONS D66）。
 *
 * 纯函数：非法页码（0 / 负数 / NaN / 超出末页）一律夹到合法范围，
 * 因此「删到只剩 3 条但还停在第 5 页」也不会渲染出空白列表。
 */
export interface PageResult<T> {
  /** 夹取之后的实际页码（1 起） */
  page: number;
  /** 总页数，至少 1（空列表也算 1 页） */
  pageCount: number;
  /** 这一页的条目 */
  items: T[];
}

export function paginate<T>(items: readonly T[], page: number, pageSize: number): PageResult<T> {
  const size = Math.max(1, Math.floor(pageSize) || 1);
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const requested = Number.isFinite(page) ? Math.floor(page) : 1;
  const clamped = Math.min(Math.max(requested, 1), pageCount);
  const start = (clamped - 1) * size;
  return { page: clamped, pageCount, items: items.slice(start, start + size) };
}
