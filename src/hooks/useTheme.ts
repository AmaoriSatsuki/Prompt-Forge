import { useCallback, useEffect, useState } from 'react';
import { useUiStore } from '../store/useUiStore';
import type { ThemeMode } from '../types/settings';
import { applyThemeToDom, loadTheme, saveTheme, toggleTheme } from '../utils/theme';

/**
 * 主题接线层：**启动时恢复 + 变更时应用与落盘**。
 *
 * 分工（与草稿、布局偏好同一套）：
 * - 纯数据在 `useUiStore.theme`；
 * - 本地存储读写与 DOM 属性在 `utils/theme.ts`（纯函数）；
 * - 时序与副作用在这里。
 *
 * 两条顺序上的讲究：
 * 1. **先应用、再保存**：切换时立刻让 DOM 变色，不必等存储写入；
 * 2. **恢复只做一次**（`ready` 闸门）：否则「恢复成磁盘上的旧值」会和用户刚点的切换打架。
 *
 * 主题对界面的影响只有 `<html data-theme>` 一个属性，没有其它副作用 ——
 * 8 种归属色在两种主题下都够清楚，取色不再随主题变化（见 D47）。
 */
export function useTheme() {
  const theme = useUiStore((state) => state.theme);
  const setTheme = useUiStore((state) => state.setTheme);
  const [ready, setReady] = useState(false);

  // 启动恢复：从本地存储读回上次选择（没有或读不出来就是默认深色）
  useEffect(() => {
    const restored = loadTheme();
    applyThemeToDom(restored);
    setTheme(restored);
    setReady(true);
  }, [setTheme]);

  // 主题变化：应用到 DOM + 落盘
  useEffect(() => {
    if (!ready) return;
    applyThemeToDom(theme);
    saveTheme(theme);
  }, [ready, theme]);

  const toggle = useCallback(() => {
    setTheme(toggleTheme(useUiStore.getState().theme));
  }, [setTheme]);

  return { theme, toggle };
}

/** 供纯展示组件使用的主题切换动作类型 */
export type ThemeToggleHandler = () => void;

export type { ThemeMode };
