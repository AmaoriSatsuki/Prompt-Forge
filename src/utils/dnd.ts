import type { ColorId } from '../constants/colors';
import type { DragSource, DropAction, DropHover, Point } from '../types/dnd';

/**
 * 指针拖拽的纯逻辑。
 *
 * 为什么彻底不用 HTML5 原生拖拽：WebView2 对 `draggable="true"` + dragstart/dragover/drop
 * 的支持很差，实测表现为「按住就出现禁止符号、松手什么也不发生」。
 * 现在改为 Pointer Events 手动实现：按下记录起点 → 移动时用 elementFromPoint 判定落点
 * → 松手执行动作。因此这里的函数全是纯的，可以直接断言。
 *
 * 需求 6：取消左右半区判定 —— 预设落到模块上一律插到最前面，
 * 落点判定只需要知道「落在哪个模块上」。
 */

/** 按下后移动超过阈值才算开始拖拽，避免把点击/双击误判成拖拽 */
export function shouldStartDrag(start: Point, current: Point, thresholdPx: number): boolean {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  return Math.hypot(dx, dy) >= thresholdPx;
}

/** 两次点击足够近、足够快，算双击（模块枢的复制就靠它，不再依赖 dblclick 事件） */
export function isDoubleTap(
  previousTap: (Point & { at: number }) | null,
  current: Point,
  now: number,
  maxDelayMs: number,
  maxDistancePx: number,
): boolean {
  if (!previousTap) return false;
  if (now - previousTap.at > maxDelayMs) return false;
  return Math.hypot(current.x - previousTap.x, current.y - previousTap.y) <= maxDistancePx;
}

/**
 * 用 elementFromPoint 判定指针下方的可放置区域。
 *
 * 拖拽期间幽灵元素必须 `pointer-events: none`，否则它自己会被命中，判定永远失败。
 * 也正因为用了指针捕获，pointermove 全部落在被捕获元素上，只能靠坐标去问「下面是谁」。
 */
export function hitTestDocument(x: number, y: number): DropHover | null {
  if (typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') {
    return null;
  }
  const element = document.elementFromPoint(x, y);
  if (!element) return null;

  // D68：全局快照的临时判定层**优先级最高**（它盖在模块上面，松手才移除）
  if (element.closest('[data-pf-snapshot-dropzone]')) {
    return { kind: 'output' };
  }

  /*
   * D111 / D113：分组砖 / 展开卡里的 `data-pf-group-name` 必须**先于**整块预设面板判掉，
   * 否则组永远不会成为落点。空组名表示面板顶部的「建组判断区」；
   * `data-pf-group-color` 带着目标组的颜色（组的身份 = 名字 + 颜色）。
   */
  const groupElement = element.closest<HTMLElement>('[data-pf-group-name]');
  if (groupElement) {
    return {
      kind: 'preset-group',
      group: groupElement.dataset.pfGroupName ?? '',
      color: groupElement.dataset.pfGroupColor ?? '',
    };
  }

  if (element.closest('[data-pf-preset-panel]')) {
    return { kind: 'preset-panel' };
  }

  const moduleElement = element.closest<HTMLElement>('[data-pf-module-id]');
  if (moduleElement) {
    const moduleId = moduleElement.dataset.pfModuleId;
    return moduleId ? { kind: 'module', moduleId } : null;
  }

  // D67：输出区空白 = 全局快照的唯一合法落点（模块行在上面已经先判掉了）
  if (element.closest('[data-pf-output-area]')) {
    return { kind: 'output' };
  }

  return null;
}

/**
 * 松手时到底该做什么。需求的四种结局全部在这里收口，界面只负责执行。
 *
 * - 模块枢拖到预设库 → 保存为预设（需求 9）
 * - 模块枢拖回自身   → 清空该模块（需求 9）
 * - 模块枢拖到别处   → 取消（需求 9）
 * - 预设拖到模块上   → 插入胶囊，排在**已有胶囊之后**（D79：先拖入的在前，整体仍在译文之前）
 * - 预设拖到别处     → 取消
 * - 词典词条拖到模块 → 插入词典 Tag 胶囊（D85 / D110）
 * - 词典词条拖到别处 → 取消
 */
export function resolveDropAction(source: DragSource, hover: DropHover | null): DropAction {
  if (!hover) return { action: 'cancel' };

  // D67：快照只认自己的落点 —— 全局→输出区，单模块→某个模块
  if (source.kind === 'snapshot') {
    if (source.scope === 'global') {
      return hover.kind === 'output'
        ? { action: 'apply-snapshot-global', snapshotId: source.snapshotId }
        : { action: 'cancel' };
    }
    return hover.kind === 'module'
      ? { action: 'apply-snapshot-module', snapshotId: source.snapshotId, moduleId: hover.moduleId }
      : { action: 'cancel' };
  }

  if (hover.kind === 'preset-panel') {
    if (source.kind === 'module') return { action: 'save-preset', moduleId: source.moduleId };
    return { action: 'cancel' };
  }

  /*
   * D111 / D113：落到组砖 / 展开卡上 = 把这条预设移入该组。
   * 只有「预设」能被移入 —— 词典词条与模块枢都不是库里的条目，落到组上一律取消。
   */
  if (hover.kind === 'preset-group') {
    if (source.kind !== 'preset') return { action: 'cancel' };
    return {
      action: 'move-preset-into-group',
      presetId: source.presetId,
      group: hover.group,
      color: hover.color,
    };
  }

  // 走到这里只可能是 module / preset / dictionary（快照在前面已经收口）
  if (hover.kind !== 'module') return { action: 'cancel' };

  if (source.kind === 'preset') {
    return { action: 'insert-capsule', moduleId: hover.moduleId };
  }

  // D85 / D110：词典词条只接受「落到某个模块上」，落下的是词典 Tag 胶囊（外观同普通胶囊）
  if (source.kind === 'dictionary') {
    return { action: 'insert-tag', moduleId: hover.moduleId };
  }

  // 模块枢只有落回它自己的模块才会生效，落到别的模块一律取消
  if (source.moduleId === hover.moduleId) {
    return { action: 'clear-module', moduleId: hover.moduleId };
  }
  return { action: 'cancel' };
}

/** 拖拽期间的光标：能放就抓取，不能放就禁止 */
export function dragCursor(action: DropAction): string {
  return action.action === 'cancel' ? 'no-drop' : 'grabbing';
}

/** 某个模块当前是否应当高亮成「危险色」（模块枢拖回自身） */
export function isDangerHover(
  source: DragSource,
  hover: DropHover | null,
  moduleId: string,
): boolean {
  if (!hover || hover.kind !== 'module') return false;
  if (hover.moduleId !== moduleId) return false;
  return source.kind === 'module' && source.moduleId === hover.moduleId;
}

/** D67：某个模块是否处于「危险覆盖」高亮（单模块快照拖到它上面） */
export function isSnapshotModuleDanger(
  source: DragSource,
  hover: DropHover | null,
  moduleId: string,
): boolean {
  return (
    source.kind === 'snapshot' &&
    source.scope === 'module' &&
    hover?.kind === 'module' &&
    hover.moduleId === moduleId
  );
}

/** 某个分组当前是否应当高亮成「可放置」（拖预设到它上面；同名不同色不算同一个组） */
export function isGroupHover(
  source: DragSource,
  hover: DropHover | null,
  group: string,
  color: string,
): boolean {
  return (
    source.kind === 'preset' &&
    hover !== null &&
    hover.kind === 'preset-group' &&
    hover.group === group &&
    hover.color === color
  );
}

/** 某个模块当前是否应当显示「可放置」高亮（预设 / 词典词条拖到它上面） */
export function isInsertHover(
  source: DragSource,
  hover: DropHover | null,
  moduleId: string,
): boolean {
  return (
    (source.kind === 'preset' || source.kind === 'dictionary') &&
    hover !== null &&
    hover.kind === 'module' &&
    hover.moduleId === moduleId
  );
}

/**
 * 高亮用的颜色：取**拖拽源自己的颜色**（需求 3）。
 * 拖预设时用预设的归属色，拖模块枢时用那一排自己的颜色 —— 不再是统一的主题蓝。
 *
 * D77：快照源也带上 `colorId`（注册表里的 `snapshot` 渐变），不再借画师色当占位。
 */
export function dragSourceColorId(source: DragSource): ColorId {
  return source.colorId;
}
