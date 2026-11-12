import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { SNAPSHOT_COLOR_ID } from '../../constants/colors';
import { startDragGesture } from '../../drag/dragGestures';
import type { Snapshot } from '../../types/snapshot';

interface SnapshotListProps {
  snapshots: Snapshot[];
  onContextMenu?: (snapshot: Snapshot, x: number, y: number) => void;
  /** D76：用当前工作区覆盖这条快照（调用方负责弹警告确认框） */
  onUpdate?: (snapshot: Snapshot) => void;
  /** D76：把这条快照保存时的「全文复制」内容写进剪贴板 */
  onCopy?: (snapshot: Snapshot) => void;
}

/**
 * 快照列表（D67）：只展示名称、范围标签，以及 D76 新增的两个图标按钮。
 * 按住即可拖走（Pointer Events，与预设/画师同一套手势）。
 *
 * **D76：一条快照 = 一个「方案」**。用户实测后提了两点：
 * ① 方案要能一键取用 ⇒ 加「复制译文」（剪贴板里就是保存时那一次「全文复制」的结果）；
 * ② 改了工作区以后想刷新方案，只能"重新保存 + 删掉旧的"，太麻烦 ⇒ 加「更新」（带警告确认）。
 *
 * 排版口径（用户原文）：`【全局】[更新][复制]` —— 标签在**左**、两个按钮在**右**，
 * 整组靠右对齐；按钮用**图标**而不是文字，尽量不占横向空间。
 * 图标是内联 SVG（不是文字字符），因此不受"界面零英文"约束，也不需要 `data-pf-ui-glyph`；
 * 中文说明放在 `title` 与 `aria-label` 里（鼠标可见、读屏可读）。
 */
export function SnapshotList({ snapshots, onContextMenu, onUpdate, onCopy }: SnapshotListProps) {
  return (
    <ul className="pf-snap-list">
      {snapshots.map((snapshot) => (
        <SnapshotItem
          key={snapshot.id}
          snapshot={snapshot}
          onContextMenu={onContextMenu}
          onUpdate={onUpdate}
          onCopy={onCopy}
        />
      ))}
    </ul>
  );
}

function SnapshotItem({
  snapshot,
  onContextMenu,
  onUpdate,
  onCopy,
}: {
  snapshot: Snapshot;
  onContextMenu?: SnapshotListProps['onContextMenu'];
  onUpdate?: SnapshotListProps['onUpdate'];
  onCopy?: SnapshotListProps['onCopy'];
}) {
  function handlePointerDown(event: ReactPointerEvent<HTMLLIElement>) {
    if (event.button !== 0) return;
    startDragGesture(
      {
        kind: 'snapshot',
        snapshotId: snapshot.id,
        scope: snapshot.scope,
        label: snapshot.name,
        // D77：快照也带自己的注册表颜色（复杂渐变），供幽灵元素与拖拽高亮取色
        colorId: SNAPSHOT_COLOR_ID,
      },
      event,
    );
  }

  return (
    <li
      className="pf-snap-item"
      data-pf-snapshot-id={snapshot.id}
      data-preview-kind="snapshot"
      data-preview-id={snapshot.id}
      onPointerDown={handlePointerDown}
      onContextMenu={(event) => {
        if (!onContextMenu) return;
        event.preventDefault();
        onContextMenu(snapshot, event.clientX, event.clientY);
      }}
    >
      <span className="pf-snap-item__name">{snapshot.name}</span>
      <span
        className={
          snapshot.scope === 'global'
            ? 'pf-snap-item__tag'
            : 'pf-snap-item__tag pf-snap-item__tag--single'
        }
      >
        {snapshot.scope === 'global' ? '全局' : '单模块'}
      </span>
      <span className="pf-snap-item__actions" data-preview-off="true">
        <SnapshotActionButton label="更新为当前工作区" onClick={() => onUpdate?.(snapshot)}>
          {/* 循环箭头：把当前工作区写回这条快照 */}
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </SnapshotActionButton>
        <SnapshotActionButton label="复制译文" onClick={() => onCopy?.(snapshot)}>
          {/* 两张纸：复制这条快照保存时的全文 */}
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        </SnapshotActionButton>
      </span>
    </li>
  );
}

/**
 * 卡片上的小图标按钮（D76）。
 *
 * 卡片整体是拖拽热区，所以按钮必须在 `pointerdown` 上**拦住事件** ——
 * 否则按「更新」会先被识别成"开始拖这条快照"，松手时什么都点不到。
 * `data-preview-off` 让悬停预览浮层跳过这一块（否则按钮上方会再压一个浮框，D73 的老问题）。
 */
function SnapshotActionButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="pf-snap-item__btn"
      title={label}
      aria-label={label}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}
