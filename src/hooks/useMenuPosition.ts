import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { placeMenu } from '../utils/menuPlacement';

/**
 * 右键菜单的定位（三个菜单共用一份）。
 *
 * 口径（原先在 `PresetContextMenu` / `PresetGroupMenu` 里各抄了一遍）：
 * 1. **先量后放**：拿菜单真实宽高去算，不估算（估算一旦与实际不符就会把菜单推偏、或让底部被裁掉）；
 * 2. 右侧 / 底部放不下就**翻到锚点左边 / 上方**；
 * 3. 最后无条件夹进视口，窗口比菜单还小时也不会跑出去。
 *
 * 落点算法本身是纯函数（`utils/menuPlacement.ts`），这里只负责「量、算、藏一帧」。
 *
 * 为什么用 layout effect：位置必须在**这一帧绘制之前**定好，否则会先看到菜单
 * 在错误位置闪一下再跳过去。
 *
 * jsdom 里所有 rect 都是 0（坑 3）：此时退化成「贴左上角」，不会抛异常。
 */

export interface MenuPosition {
  /** 挂到菜单根节点上 */
  ref: RefObject<HTMLDivElement | null>;
  /** 直接铺给菜单根节点：量之前先藏起来，避免在错误位置闪一帧 */
  style: CSSProperties;
}

export function useMenuPosition(x: number, y: number): MenuPosition {
  const ref = useRef<HTMLDivElement | null>(null);
  /** null = 还没量过（本帧不可见），量完就是最终位置 */
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  /**
   * 刻意**不写依赖数组**：菜单内容会变（权重加一档、分组列表增减），
   * 每次渲染都重新量一次最省心 —— 菜单很小，量一次的代价远小于「定位漂了」。
   * `setPosition` 在位置没变时返回旧引用，因此不会自激重渲染。
   */
  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;

    const rect = menu.getBoundingClientRect();
    const next = placeMenu({
      anchorX: x,
      anchorY: y,
      width: rect.width,
      height: rect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });

    setPosition((previous) =>
      previous && previous.left === next.left && previous.top === next.top ? previous : next,
    );
  });

  return {
    ref,
    style: position
      ? { left: position.left, top: position.top }
      : // 量之前先藏起来；尺寸照常占位，量得准
        { left: x, top: y, visibility: 'hidden' },
  };
}
