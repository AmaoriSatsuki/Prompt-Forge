import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { resolveColorGradient, resolveColorHex } from '../../utils/color';
import { startDragGesture } from '../../drag/dragGestures';
import type { Preset } from '../../types/preset';

interface PresetItemProps {
  preset: Preset;
  onContextMenu: (preset: Preset, x: number, y: number) => void;
}

/**
 * 单条预设：紧凑 chip —— **只有颜色点 + 中文命名**（需求 2）。
 *
 * 权重、编辑、删除都收进右键菜单，因此列表一眼能扫完；
 * 英文内容依旧不渲染（界面约定：英文只出现在预设编辑弹窗与输出里）。
 *
 * 交互：左键按住可拖到输入框／模块（需求 2、10）；右键打开菜单。
 */
export function PresetItem({ preset, onContextMenu }: PresetItemProps) {
  const style = {
    '--pf-preset-color': resolveColorHex(preset.colorId),
    '--pf-preset-gradient': resolveColorGradient(preset.colorId),
  } as CSSProperties;

  function handlePointerDown(event: ReactPointerEvent<HTMLLIElement>) {
    // 只有左键才是拖拽；右键留给菜单
    if (event.button !== 0) return;
    startDragGesture(
      {
        kind: 'preset',
        presetId: preset.id,
        label: preset.label,
        colorId: preset.colorId,
      },
      event,
    );
  }

  function handleContextMenu(event: ReactMouseEvent<HTMLLIElement>) {
    // 先于外层（展开的分组卡）判掉：右键一颗胶囊要出「预设菜单」，不是「分组菜单」
    event.preventDefault();
    event.stopPropagation();
    onContextMenu(preset, event.clientX, event.clientY);
  }

  return (
    <li
      className="pf-preset-item"
      style={style}
      data-pf-preset-id={preset.id}
      data-preview-kind="preset"
      data-preview-id={preset.id}
      onPointerDown={handlePointerDown}
      onContextMenu={handleContextMenu}
    >
      <span className="pf-preset-item__dot" aria-hidden="true" />
      <span className="pf-preset-item__label">{preset.label}</span>
    </li>
  );
}
