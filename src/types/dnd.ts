import type { ColorId } from '../constants/colors';

/**
 * 指针拖拽的类型。V1 的拖拽只有两种来源、两类落点。
 *
 * 需求 6：取消了左右半区判定 —— 预设拖到模块上一律插到中文源内容最前面，
 * 因此落点里不再有「半区」这个概念。
 *
 * 这里刻意不出现任何 HTML5 拖拽（dataTransfer / MIME）的东西：
 * 那条路在 WebView2 下不可用，已整体弃用。
 */

export interface Point {
  x: number;
  y: number;
}

/** 从哪儿拖起来的 */
export type DragSource =
  | { kind: 'module'; moduleId: string; label: string; colorId: ColorId }
  | { kind: 'preset'; presetId: string; label: string; colorId: ColorId }
  /** D67：快照 —— 落在输出区（全局）或某个模块（单模块）上覆盖 */
  | { kind: 'snapshot'; snapshotId: string; scope: 'module' | 'global'; label: string; colorId: ColorId }
  /**
   * D85：词典库的一条词条。
   *
   * 落到模块上时插入的是 `kind='tag'` 的胶囊（D110 起外观与普通胶囊一致，是「色点 + 中文名」药丸）；
   * 与「插入胶囊」仍分成两个动作，因为落点判定与文案不同（只是纯英文标签的来源不同）。
   */
  | { kind: 'dictionary'; label: string; english: string; colorId: ColorId };

/** 指针当前落在哪个可放置区域 */
export type DropHover =
  | { kind: 'preset-panel' }
  /**
   * D111 / D113：落在某个预设分组上（组砖或展开的卡）。
   *
   * `group` 为空串表示落在面板顶部的「建组判断区」上 —— 松手要先问名字，再建组移入。
   * `color` 是**目标组的颜色**（组的身份 = 名字 + 颜色，同名不同色是两个组）。
   */
  | { kind: 'preset-group'; group: string; color: string }
  | { kind: 'module'; moduleId: string }
  /** D67：输出区空白（全局快照唯一合法落点） */
  | { kind: 'output' };

export interface DragState {
  source: DragSource;
  /** 指针在视口里的位置，幽灵元素据此定位 */
  pointer: Point;
  /** 当前悬停区域；null 表示落在不可放置的地方 */
  hover: DropHover | null;
}

/** 松手时要执行的动作。由纯函数 resolveDropAction 算出，界面只负责执行。 */
export type DropAction =
  | { action: 'save-preset'; moduleId: string }
  | { action: 'clear-module'; moduleId: string }
  | { action: 'insert-capsule'; moduleId: string }
  /** D85：词典词条落到模块上 → 插入纯英文 Tag */
  | { action: 'insert-tag'; moduleId: string }
  /**
   * D111 / D113：把一条预设移入某个组（落到组砖 / 展开的卡上）。
   * `group` 为空串 = 落在「建组判断区」上，先问名字再移入；`color` 是目标组的颜色。
   */
  | { action: 'move-preset-into-group'; presetId: string; group: string; color: string }
  | { action: 'apply-snapshot-global'; snapshotId: string }
  | { action: 'apply-snapshot-module'; snapshotId: string; moduleId: string }
  | { action: 'cancel' };
