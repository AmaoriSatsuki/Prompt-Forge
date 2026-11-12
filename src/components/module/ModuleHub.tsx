import { useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  DOUBLE_TAP_MAX_DELAY_MS,
  DOUBLE_TAP_MAX_DISTANCE_PX,
} from '../../constants/limits';
import { startDragGesture } from '../../drag/dragGestures';
import { useCopyTranslation } from '../../hooks/useCopyTranslation';
import type { Module } from '../../types/module';
import { isDoubleTap } from '../../utils/dnd';

interface ModuleHubProps {
  module: Module;
}

/**
 * 模块枢（ModuleHub）：模块右侧居中的那枚控件，是「模块级操作」的枢轴，也是胶囊生成器。
 *
 * 四种结局（需求 9）：
 * - 双击       → 复制该模块的纯英文成品（胶囊已换成术语英文）
 * - 拖到预设库 → 弹出保存对话框，把该模块固化成一条预设
 * - 拖回自身   → 清空该模块
 * - 拖到其他处 → 取消
 *
 * 全部走 Pointer Events：WebView2 对 HTML5 原生拖拽支持很差（按住就是禁止符号）。
 * 双击复制也不再依赖 `dblclick` 事件——`pointerdown` 上会 `preventDefault`，
 * 而在部分环境下那会连兼容鼠标事件一起吞掉，所以自己按「时间 + 距离」判定双击。
 *
 * 外观：外框是空心圆角方块（边框取这一排的颜色），中心另有一枚小实心方块，
 * 两者之间留空隙，看起来是「有填充的枢轴」而不是一个空框。
 */
export function ModuleHub({ module }: ModuleHubProps) {
  const copyTranslation = useCopyTranslation();
  const lastTapRef = useRef<{ x: number; y: number; at: number } | null>(null);

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    const point = { x: event.clientX, y: event.clientY };
    const now = Date.now();

    if (
      isDoubleTap(
        lastTapRef.current,
        point,
        now,
        DOUBLE_TAP_MAX_DELAY_MS,
        DOUBLE_TAP_MAX_DISTANCE_PX,
      )
    ) {
      lastTapRef.current = null;
      void copyTranslation(module);
    } else {
      lastTapRef.current = { ...point, at: now };
    }

    startDragGesture(
      {
        kind: 'module',
        moduleId: module.id,
        label: `模块 ${module.order}`,
        colorId: module.colorId,
      },
      event,
    );
  }

  return (
    <button
      type="button"
      className="pf-hub"
      title="双击复制，拖到预设库保存，拖回清空文字（胶囊保留）"
      aria-label={`模块 ${module.order} 的模块枢：双击复制，拖到预设库保存，拖回清空文字，胶囊保留`}
      onPointerDown={handlePointerDown}
      onDragStart={(event) => event.preventDefault()}
    >
      <span className="pf-hub__square" aria-hidden="true">
        <span className="pf-hub__core" />
      </span>
    </button>
  );
}
