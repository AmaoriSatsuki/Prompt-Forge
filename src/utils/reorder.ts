/**
 * 列表重排的纯逻辑（拖拽与键盘共用）。
 *
 * 放在 utils 层是为了能离线断言：拖拽本身在 jsdom 里量不出真实尺寸，
 * 但「从第几位移到第几位」这件事完全可以单独验证。
 */
export function moveId(ids: readonly string[], from: number, to: number): string[] {
  const next = [...ids];
  if (from < 0 || from >= next.length) return next;
  const clamped = Math.min(Math.max(to, 0), next.length - 1);
  const [moved] = next.splice(from, 1);
  next.splice(clamped, 0, moved);
  return next;
}
