import type { ThemeMode } from '../types/settings';

/**
 * 默认主题：**亮色**（D78）。
 *
 * 历史：应用从第一版起是深色观感，因此旧默认一直是 `dark`（"默认值不因为加了切换就变掉"）。
 * 用户 2026 轮验收 D77 后明确要求「初次启动的界面颜色是黑色主题，改成白色主题」——
 * 只改**默认值**，切换与记忆逻辑一概不动：用户手动切过就按记忆走。
 *
 * ⚠️ 默认值与 `:root`（深色）不一致之后，**第一次绘制前必须先把 `data-theme` 写上去**，
 * 否则会闪一帧深色。这件事由 `main.tsx` 在渲染前同步调用 `applyThemeToDom(loadTheme())` 完成。
 */

export const DEFAULT_THEME: ThemeMode = 'light';

/** 主题在本地存储里的键（与草稿一样带版本号，便于将来改结构） */
export const THEME_STORAGE_KEY = 'prompt-forge/theme/v1';

/** 主题在 DOM 上的落点：`document.documentElement` 的 `data-theme` 属性 */
export const THEME_ATTRIBUTE = 'data-theme';

/**
 * 主题 → 界面文案与图标朝向。
 *
 * 图标语义按用户给的「经典太阳/月亮」：**暗色时显示太阳**（点它去亮色），
 * **亮色时显示月亮**（点它回暗色）。`title` 是中文，符合界面文案零英文。
 */
export const THEME_TOGGLE: Record<ThemeMode, { icon: 'sun' | 'moon'; title: string }> = {
  dark: { icon: 'sun', title: '切换到亮色主题' },
  light: { icon: 'moon', title: '切换到暗色主题' },
};

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark';
}

/** 规范化持久化里的值：认不出来的（脏数据 / 旧版本）一律回落默认主题 */
export function parseTheme(raw: string | null): ThemeMode {
  return isThemeMode(raw) ? raw : DEFAULT_THEME;
}

/** 切换：只有两个主题，因此就是取反 */
export function toggleTheme(mode: ThemeMode): ThemeMode {
  return mode === 'dark' ? 'light' : 'dark';
}

/** localStorage 在隐私模式或非浏览器环境下可能直接抛异常，因此统一包一层 */
function safeStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadTheme(storage: Storage | null = safeStorage()): ThemeMode {
  if (!storage) return DEFAULT_THEME;
  try {
    return parseTheme(storage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

export function saveTheme(mode: ThemeMode, storage: Storage | null = safeStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(THEME_STORAGE_KEY, mode);
    return true;
  } catch {
    // 写不进去就只影响「下次启动能不能记住」，不值得打断用户
    return false;
  }
}

/**
 * 把主题写到 DOM 上。
 *
 * 只改 `data-theme` 一个属性：**所有配色都由 CSS 变量按主题取值**（架构 §5.6），
 * 因此换主题不需要任何组件重算样式，也不存在「有一部分界面忘了换色」的漏网之鱼。
 * 同时把 `color-scheme` 交给 CSS（见 tokens.css），让滚动条等原生控件也跟着走。
 */
export function applyThemeToDom(mode: ThemeMode, root?: HTMLElement | null): void {
  const target = root ?? (typeof document === 'undefined' ? null : document.documentElement);
  if (!target) return;
  target.setAttribute(THEME_ATTRIBUTE, mode);
}

/*
 * 历史：本文件曾维护一个「亮色下把白色反相成深色」的开关（`setColorInversionForTheme`
 * / `isColorInvertedForTest` / `INVERTED_COLOR_HEX`）。2026 轮剔除自由色之后（D47）
 * 注册表里不再有白色、8 种颜色都是渐变，两种主题下都够清楚，这套反相机制随之删除。
 * 主题现在只做一件事：把 `data-theme` 写到 `<html>` 上，配色全部交给 CSS 变量。
 */
