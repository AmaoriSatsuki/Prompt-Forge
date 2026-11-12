import {
  DOUBLE_TAP_MAX_DELAY_MS,
  DOUBLE_TAP_MAX_DISTANCE_PX,
  DRAG_START_THRESHOLD_PX,
} from '../constants/limits';
import { useArtistStore } from '../store/useArtistStore';
import { useSnapshotStore } from '../store/useSnapshotStore';
import { useModuleStore } from '../store/useModuleStore';
import { usePresetFolderStore } from '../store/usePresetFolderStore';
import { usePresetStore } from '../store/usePresetStore';
import { useTagStore } from '../store/useTagStore';
import { useUiStore } from '../store/useUiStore';
import type { DragSource, DropAction, Point } from '../types/dnd';
import { dragCursor, hitTestDocument, isDoubleTap, resolveDropAction, shouldStartDrag } from '../utils/dnd';
import { normalizePresetColor } from '../utils/color';
import { captureWorkspace, SNAPSHOT_UNDO_DEPTH } from '../utils/snapshot';

/**
 * 指针拖拽手势处理。
 *
 * 为什么不用 HTML5 原生拖拽：WebView2 对 `draggable="true"` + dragstart/dragover/drop
 * 支持很差，实测就是「按住出现禁止符号、松手毫无反应」。
 *
 * 现在的做法：
 * 1. 组件在自己的 onPointerDown 里调用 `startDragGesture(source, event)`
 *    —— 这里记录起点、`setPointerCapture`、`preventDefault`；
 * 2. 移动与松手统一在 window 上监听（指针捕获保证事件一定送达），
 *    越过 DRAG_START_THRESHOLD_PX 才真正进入拖拽，避免把点击当成拖拽；
 * 3. 每次移动用 `document.elementFromPoint` 判定落点（幽灵元素必须 pointer-events:none），
 *    把结果写进 Store，界面据此高亮；
 * 4. 松手时由纯函数 `resolveDropAction` 算出动作，这里执行。
 *
 * 放在 React 树之外是有意的：拖拽期间会频繁更新 Store，
 * 走组件内 handler 会让每个模块都跟着重渲染。
 * 注意它与「模块枢」（ModuleHub）是两件事：这里管的是拖拽手势本身。
 */

interface PendingGesture {
  source: DragSource;
  start: Point;
  active: boolean;
}

let pending: PendingGesture | null = null;
let listening = false;

function pointOf(event: PointerEvent): Point {
  return { x: event.clientX, y: event.clientY };
}

function attachListeners() {
  if (listening) return;
  listening = true;
  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', handlePointerUp);
  window.addEventListener('pointercancel', handlePointerCancel);
  window.addEventListener('keydown', handleKeyDown);
}

function detachListeners() {
  if (!listening) return;
  listening = false;
  window.removeEventListener('pointermove', handlePointerMove);
  window.removeEventListener('pointerup', handlePointerUp);
  window.removeEventListener('pointercancel', handlePointerCancel);
  window.removeEventListener('keydown', handleKeyDown);
}

function handlePointerMove(event: PointerEvent) {
  if (!pending) return;
  const point = pointOf(event);
  const ui = useUiStore.getState();

  if (!pending.active) {
    if (!shouldStartDrag(pending.start, point, DRAG_START_THRESHOLD_PX)) return;
    pending.active = true;
    ui.startDrag(pending.source, point);
  }

  const hover = hitTestDocument(point.x, point.y);
  ui.moveDrag(point, hover);
  document.body.style.cursor = dragCursor(resolveDropAction(pending.source, hover));
}

function handlePointerUp() {
  const gesture = pending;
  // 必须在 finishGesture() 之前把落点读出来：它会清空 Store 里的拖拽状态
  const drag = useUiStore.getState().drag;
  finishGesture();
  if (!gesture?.active || !drag) return;

  executeDrop(resolveDropAction(drag.source, drag.hover), drag.source);
}

function handlePointerCancel() {
  finishGesture();
}

function handleKeyDown(event: KeyboardEvent) {
  // 拖拽中按 Esc 取消，符合直觉；不影响其它快捷键
  if (event.key === 'Escape') finishGesture();
}

function finishGesture() {
  pending = null;
  detachListeners();
  document.body.style.cursor = '';
  useUiStore.getState().endDrag();
}

/** 松手动作的执行者。界面只负责「显示」，这里负责「发生什么」。 */
export function executeDrop(action: DropAction, source: DragSource): void {
  const ui = useUiStore.getState();
  const modules = useModuleStore.getState();

  switch (action.action) {
    case 'save-preset':
      ui.openSavePresetDialog(action.moduleId);
      return;

    case 'clear-module':
      // D61：只清文字、保留胶囊（胶囊要手动点 × 才消失）
      modules.clearModuleText(action.moduleId);
      ui.pushToast('已清空文字，胶囊保留', 'ok');
      return;

    case 'insert-capsule': {
      if (source.kind !== 'preset') return;
      /*
       * 三个库的数据形状一致（D62 / D86）：先找普通预设，再找画师库，最后找 Tag 库。
       *
       * **Tag 库的条目拖进工作区 = `kind: 'tag'` 胶囊**（D85；外观口径由 D110 统一）：
       * 它和画师、预设拖进来的是同一颗「色点 + 中文名」药丸，差别只有两处 ——
       * 归属色固定为词典色、英文标签不做 `@` 处理。锚点机制不变，因此照样不进翻译请求体。
       */
      const tagItem = useTagStore.getState().presets.find((item) => item.id === source.presetId);
      const preset =
        usePresetStore.getState().presets.find((item) => item.id === source.presetId) ??
        useArtistStore.getState().presets.find((item) => item.id === source.presetId);
      if (!preset && !tagItem) {
        ui.pushToast('找不到这条预设，可能已被删除', 'warn');
        return;
      }
      const item = preset ?? tagItem;
      if (!item) return;
      // D79：仍插在中文/译文之前，但排在**已有胶囊之后**（先拖入的在前，符合打字顺序）
      modules.insertCapsule(
        action.moduleId,
        {
          presetId: item.id,
          label: item.label,
          english: item.english,
          colorId: item.colorId,
          // 来自 Tag 库的条目带 kind='tag'（D110 起只标来源与词典色，外观同普通胶囊）
          ...(preset ? {} : { kind: 'tag' as const }),
        },
        'after-capsules',
      );
      // 顺手把这排设为选中：输入框在下方，不选中的话看不到刚插进去的胶囊
      modules.selectModule(action.moduleId);
      ui.pushToast(preset ? '已插入到胶囊之后' : '已插入词典词条', 'ok');
      return;
    }

    case 'move-preset-into-group': {
      const preset = usePresetStore
        .getState()
        .presets.find((item) => item.id === action.presetId);
      if (!preset) {
        ui.pushToast('找不到这条预设，可能已被删除', 'warn');
        return;
      }
      /*
       * D111 / D112：落到面板顶部的「建组判断区」（`group === ''`）时先问名字，
       * 确认后才建组并移入（组的颜色 = 这颗胶囊的颜色）；落到已有的组上则直接移过去，
       * **只接受同色** —— 异色会被拒绝，提示里说明为什么。
       */
      if (!action.group) {
        ui.openFolderPrompt({
          mode: 'create',
          presetId: preset.id,
          initialName: usePresetFolderStore.getState().suggestName(),
        });
        return;
      }
      const result = usePresetFolderStore.getState().assignPreset(preset.id, {
        name: action.group,
        colorId: normalizePresetColor(action.color),
      });
      ui.pushToast(result.ok ? `已移入「${result.name}」` : result.message, result.ok ? 'ok' : 'warn');
      return;
    }

    case 'insert-tag': {      // D85：词典词条落到模块上 → 插入 Tag 胶囊（锚点机制，因此不进翻译请求体）
      if (source.kind !== 'dictionary') return;
      const english = source.english.trim();
      if (!english) {
        ui.pushToast('这条词条没有英文内容，无法插入', 'warn');
        return;
      }
      modules.insertCapsule(
        action.moduleId,
        {
          // 词条不来自预设库，presetId 留空；label 存中文名（悬停提示与标签行都用它）
          presetId: '',
          label: source.label,
          english,
          colorId: source.colorId,
          kind: 'tag',
        },
        'after-capsules',
      );
      modules.selectModule(action.moduleId);
      ui.pushToast('已插入词典词条', 'ok');
      return;
    }

    case 'apply-snapshot-global':
    case 'apply-snapshot-module': {
      const snapshot = useSnapshotStore
        .getState()
        .snapshots.find((item) => item.id === action.snapshotId);
      if (!snapshot) {
        ui.pushToast('找不到这个快照，可能已被删除', 'warn');
        return;
      }
      // 覆盖前先把整个工作区（含译文/状态）压进撤销栈
      const current = useModuleStore.getState();
      useSnapshotStore
        .getState()
        .pushUndo(
          captureWorkspace(current.modules, current.selectedModuleId, snapshot.name),
          SNAPSHOT_UNDO_DEPTH,
        );
      if (action.action === 'apply-snapshot-global') {
        current.applySnapshotGlobal(snapshot);
        ui.pushToast('已覆盖所有模块', 'ok');
      } else {
        current.applySnapshotModule(snapshot, action.moduleId);
        ui.pushToast('已覆盖此模块', 'ok');
      }
      return;
    }

    case 'cancel':
      // 落在不可放置的地方：什么都不做（光标已经是禁止符）
      return;
  }
}

/**
 * 组件在 onPointerDown 里调用它开始一次可能成为拖拽的手势。
 * 记录起点、指针捕获、阻止默认行为（避免选中文字与浏览器自身的拖动）。
 */
export function startDragGesture(source: DragSource, event: React.PointerEvent<HTMLElement>): void {
  const target = event.currentTarget;
  try {
    target.setPointerCapture?.(event.pointerId);
  } catch {
    // 某些环境下捕获会失败，window 监听仍然能收到事件
  }

  event.preventDefault();
  event.stopPropagation();

  pending = {
    source,
    start: { x: event.clientX, y: event.clientY },
    active: false,
  };
  attachListeners();
}

export { isDoubleTap, DOUBLE_TAP_MAX_DELAY_MS, DOUBLE_TAP_MAX_DISTANCE_PX };
