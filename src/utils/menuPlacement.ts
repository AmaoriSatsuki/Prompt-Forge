/** 菜单与视口边缘之间至少留出的距离 */
export const MENU_EDGE_MARGIN = 8;

export interface MenuPlacementInput {
  /** 鼠标 / 锚点坐标（菜单默认贴在它的右下角） */
  anchorX: number;
  anchorY: number;
  /** 菜单的真实宽高（先量后放，不估算） */
  width: number;
  height: number;
  /** 视口宽高（jsdom 里可能是 0，那不报错，退化成贴左上角） */
  viewportWidth: number;
  viewportHeight: number;
}

export interface MenuPlacement {
  left: number;
  top: number;
}

/**
 * 右键菜单的落点（纯函数，`useMenuPosition` 只是它的 DOM 外壳）。
 *
 * 三步，顺序不能换：
 * 1. 默认贴锚点右下；
 * 2. 右侧 / 底部放不下就**翻到锚点左边 / 上方**（先翻后夹，否则夹完会贴边、看不清是翻了还是被压住）；
 * 3. 最后无条件夹进视口 —— 窗口比菜单还小时也不许跑出去。
 *
 * 抽成纯函数是为了能离线断言（jsdom 里量不到布局，坑 3）。
 */
export function placeMenu(input: MenuPlacementInput): MenuPlacement {
  const { anchorX, anchorY, width, height, viewportWidth, viewportHeight } = input;

  let left = anchorX;
  let top = anchorY;
  if (left + width > viewportWidth - MENU_EDGE_MARGIN) left = anchorX - width;
  if (top + height > viewportHeight - MENU_EDGE_MARGIN) top = anchorY - height;

  left = Math.max(MENU_EDGE_MARGIN, Math.min(left, viewportWidth - width - MENU_EDGE_MARGIN));
  top = Math.max(MENU_EDGE_MARGIN, Math.min(top, viewportHeight - height - MENU_EDGE_MARGIN));

  return { left, top };
}
