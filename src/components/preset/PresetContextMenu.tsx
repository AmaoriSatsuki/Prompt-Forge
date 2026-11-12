import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { PRESET_WEIGHT_STEP } from '../../constants/limits';
import { useMenuPosition } from '../../hooks/useMenuPosition';
import type { Preset } from '../../types/preset';

interface PresetContextMenuProps {
  preset: Preset;
  x: number;
  y: number;
  onWeightChange: (delta: number) => void;
  onEdit: () => void;
  onDelete: () => void;
  /** D64：画师库专用 —— 把这条画师"添加为预设"（可选颜色后移入预设库） */
  onMoveToPresets?: () => void;
  /** 删除项的文案（画师库里是「删除画师」） */
  deleteLabel?: string;
  /* ---------- D111：分组（只有预设库才传，画师 / Tag 库不传就不渲染这一段） ---------- */
  /** 现有的组名（列表里点哪一个就移入哪一个） */
  folderNames?: string[];
  /** 这条预设当前所在的组名（空串 = 未分组） */
  currentFolder?: string;
  onMoveToFolder?: (folder: string) => void;
  onMoveOutOfFolder?: () => void;
  onClose: () => void;
}

/**
 * 预设的右键菜单（需求 2）：权重调整 / 编辑内容 / 删除预设。
 *
 * 挂在 document.body 上（列表有 overflow: auto，留在列表里会被裁掉）。
 * 关闭时机：点到菜单外面、按 Esc、或者这条预设本身消失了。
 * 只监听 pointerdown —— 右键菜单是在 pointerup 之后弹出的，
 * 若同时监听 pointerup 会被弹出它的那次点击立刻关掉。
 *
 * 定位（先量后放 / 夹进视口）统一在 `hooks/useMenuPosition.ts`，三个菜单共用一份。
 */
export function PresetContextMenu({
  preset,
  x,
  y,
  onWeightChange,
  onEdit,
  onDelete,
  onMoveToPresets,
  deleteLabel = '删除预设',
  folderNames,
  currentFolder = '',
  onMoveToFolder,
  onMoveOutOfFolder,
  onClose,
}: PresetContextMenuProps) {
  /** 先量后放 + 夹进视口：三个右键菜单共用 `useMenuPosition`（`hooks/useMenuPosition.ts`） */
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
      className="pf-menu"
      style={menuStyle}
      role="menu"
      aria-label={`${preset.label} 的操作菜单`}
    >
      <div className="pf-menu__weight">
        <span className="pf-menu__weight-label">权重</span>
        {/*
          加减排**自己是一组**（外层 .pf-menu__weight-controls 居中）：
          原来是「标签—减号—数字（margin-left:auto 推右）—加号」四件平铺在同一行，
          数字被推到最右、加号贴着右边缘，整排看着不居中（用户 2026 轮反馈「不美观」）。
          现在把三个控件收进一个容器整体居中，标签靠左。
        */}
        <span className="pf-menu__weight-controls">
          <button
            type="button"
            className="pf-menu__step"
            aria-label={`权重减少 ${PRESET_WEIGHT_STEP}`}
            onClick={() => onWeightChange(-PRESET_WEIGHT_STEP)}
          >
            −
          </button>
          <span className="pf-menu__weight-value">{preset.weight}</span>
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

      <button type="button" className="pf-menu__item" role="menuitem" onClick={onEdit}>
        编辑内容
      </button>

      {/*
        D111 / D112：分组段。只有预设库会把 `folderNames` 传进来（画师 / Tag 库没有分组）。
        列表直接铺在菜单里而不做二级菜单：组通常不到十来个，少一次悬停就少一次犹豫。
        **只列同色分组** —— 组色固定且只收纳同色胶囊，异色的组点进去也只会被拒绝。
        新建分组不在这里：D112 起建组只有一条路（把胶囊拖到面板顶部）。
      */}
      {folderNames ? (
        <div className="pf-menu__section">
          <span className="pf-menu__section-label">移入分组</span>
          <div className="pf-menu__folders">
            {folderNames.length === 0 ? (
              <span className="pf-menu__hint">没有同色分组；把胶囊拖到面板顶部可以新建</span>
            ) : (
              folderNames.map((name) => (
                <button
                  key={name}
                  type="button"
                  role="menuitem"
                  className={
                    name === currentFolder ? 'pf-menu__folder pf-menu__folder--on' : 'pf-menu__folder'
                  }
                  data-pf-folder-option={name}
                  onClick={() => onMoveToFolder?.(name)}
                >
                  <span className="pf-menu__folder-name" data-pf-external="true">
                    {name}
                  </span>
                  {name === currentFolder ? <span className="pf-menu__folder-tick">✓</span> : null}
                </button>
              ))
            )}
          </div>
          {currentFolder ? (
            <button
              type="button"
              role="menuitem"
              className="pf-menu__item pf-menu__item--compact"
              onClick={() => onMoveOutOfFolder?.()}
            >
              移出分组「{currentFolder}」
            </button>
          ) : null}
        </div>
      ) : null}

      {onMoveToPresets ? (
        <button type="button" className="pf-menu__item" role="menuitem" onClick={onMoveToPresets}>
          添加为预设
        </button>
      ) : null}
      <button
        type="button"
        className="pf-menu__item pf-menu__item--danger"
        role="menuitem"
        onClick={onDelete}
      >
        {deleteLabel}
      </button>
    </div>,
    document.body,
  );
}
