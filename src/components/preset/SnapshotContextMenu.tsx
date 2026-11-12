import { PRESET_WEIGHT_STEP } from '../../constants/limits';
import { useMenuPosition } from '../../hooks/useMenuPosition';
import type { Snapshot } from '../../types/snapshot';

interface SnapshotContextMenuProps {
  snapshot: Snapshot;
  x: number;
  y: number;
  onWeightChange: (delta: number) => void;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
}

/**
 * 快照的右键菜单（D67）：权重 ±10 / 重命名 / 删除。
 * 与预设菜单同一套观感，但快照没有"英文内容"可编辑，所以只有改名。
 */
export function SnapshotContextMenu({
  snapshot,
  x,
  y,
  onWeightChange,
  onRename,
  onDelete,
  onClose,
}: SnapshotContextMenuProps) {
  /**
   * 定位与预设 / 分组菜单共用 `hooks/useMenuPosition.ts`。
   *
   * 这里原来直接把鼠标坐标写进 `left/top`（还写死 `zIndex: 20`）：靠近屏幕右边或底部时
   * 菜单会被裁掉，且层级比其它菜单低一档。现在三处一口径。
   */
  const { ref: menuRef, style: menuStyle } = useMenuPosition(x, y);

  return (
    <div
      ref={menuRef}
      className="pf-menu"
      style={menuStyle}
      role="menu"
      aria-label={`${snapshot.name} 的操作菜单`}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="pf-menu__weight">
        <span className="pf-menu__weight-label">权重</span>
        <span className="pf-menu__weight-controls">
          <button
            type="button"
            className="pf-menu__step"
            aria-label={`权重减少 ${PRESET_WEIGHT_STEP}`}
            onClick={() => onWeightChange(-PRESET_WEIGHT_STEP)}
          >
            −
          </button>
          <span className="pf-menu__weight-value">{snapshot.weight}</span>
          <button
            type="button"
            className="pf-menu__step"
            aria-label={`权重增加 ${PRESET_WEIGHT_STEP}`}
            onClick={() => onWeightChange(PRESET_WEIGHT_STEP)}
          >
            +
          </button>
        </span>
      </div>

      <button type="button" className="pf-menu__item" role="menuitem" onClick={onRename}>
        重命名
      </button>
      <button
        type="button"
        className="pf-menu__item pf-menu__item--danger"
        role="menuitem"
        onClick={onDelete}
      >
        删除快照
      </button>

      {/* 点空白处关闭：由面板监听 document 的 pointerdown（与预设菜单一致） */}
      <button type="button" hidden aria-hidden="true" onClick={onClose} />
    </div>
  );
}
