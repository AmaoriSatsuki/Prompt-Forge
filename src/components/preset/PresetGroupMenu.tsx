import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useMenuPosition } from '../../hooks/useMenuPosition';
import type { PresetFolder } from '../../types/preset';

interface PresetGroupMenuProps {
  /** 当前组的元数据（组可能还没实体，用 `{name, colorId, expanded}` 兜底） */
  folder: PresetFolder;
  x: number;
  y: number;
  onToggleExpanded: () => void;
  onRename: () => void;
  onDissolve: () => void;
  onClose: () => void;
}

/**
 * 分组的右键菜单（D111 / D112）：展开 / 收起、重命名、解散。
 *
 * **D112 砍掉了「可见色勾选」**：用户回归「收纳箱」本源，组的颜色由创建时那颗
 * 胶囊固定、不可改，组只会出现在总列表或它自己那个色块下 —— 于是这里没有任何
 * 颜色相关的开关可设，菜单只剩三件与「收纳」直接相关的事。
 *
 * 定位与另外两个右键菜单共用 `hooks/useMenuPosition.ts`。
 */
export function PresetGroupMenu({
  folder,
  x,
  y,
  onToggleExpanded,
  onRename,
  onDissolve,
  onClose,
}: PresetGroupMenuProps) {
  const { ref: menuRef, style: menuStyle } = useMenuPosition(x, y);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const menu = menuRef.current;
      if (menu && event.target instanceof Node && menu.contains(event.target)) return;
      onClose();
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      className="pf-menu pf-menu--group"
      style={menuStyle}
      role="menu"
      aria-label={`分组「${folder.name}」的操作菜单`}
      data-pf-group-menu={folder.name}
    >
      <div className="pf-menu__title" data-pf-external="true">
        {folder.name}
      </div>

      <button type="button" className="pf-menu__item" role="menuitem" onClick={onToggleExpanded}>
        {folder.expanded ? '收起分组' : '展开分组'}
      </button>
      <button type="button" className="pf-menu__item" role="menuitem" onClick={onRename}>
        重命名分组
      </button>
      <button
        type="button"
        className="pf-menu__item pf-menu__item--danger"
        role="menuitem"
        onClick={onDissolve}
      >
        解散分组
      </button>
    </div>,
    document.body,
  );
}
