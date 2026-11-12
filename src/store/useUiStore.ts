import { create } from 'zustand';
import type { ColorId } from '../constants/colors';
import { INPUT_PANE_DEFAULT_HEIGHT, PRESET_PANEL_DEFAULT_WIDTH } from '../constants/limits';
import type { DragSource, DragState, DropHover, Point } from '../types/dnd';
import type { LibraryView } from '../types/library';
import type { AppSettingsTab, ThemeMode } from '../types/settings';
import { createId } from '../utils/id';
import { DEFAULT_THEME } from '../utils/theme';
import { clampLibraryPageSize, loadLibraryPageSize, saveLibraryPageSize } from '../utils/uiSettings';

export type ToastTone = 'info' | 'ok' | 'warn' | 'error';

export interface ToastMessage {
  id: string;
  text: string;
  tone: ToastTone;
}

/**
 * 翻译失败提示（常驻横幅）。
 *
 * 刻意与 toast 分开：toast 会自动消失、同一时刻只显示一条，用来告知「失败了」太弱
 * ——失败是必须被用户看见的事。横幅**不自动消失，只能手动关掉**（需求：确保用户收到）。
 */
export interface TranslationFailure {
  /** 界面唯一的中文原因，直接来自 Rust 的错误映射 */
  message: string;
  /** 错误码，仅用于排查时对照 */
  code?: string;
  /** 产生这条提示的时间，用于 React 的 key 与「新一轮失败」的区分 */
  at: number;
}

export interface UiState {
  /**
   * 正在进行的指针拖拽。null 表示没有拖拽。
   * 幽灵元素、落点高亮、松手动作全部读这一份状态。
   */
  drag: DragState | null;
  /**
   * 预设筛选：**单选**（用户 2026 轮由多选改为单选）。
   *
   * 只有一个元素，或空数组（= 全部）。点一个颜色即「只筛这一种」，
   * **再点同一个颜色 = 取消 = 显示全部**（因此不需要单独的「全部」按钮）。
   *
   * 为什么不再支持组合：实机体验下来，每次筛选都是跟着「当前在写哪一排」走的，
   * 多选只会让用户每次还得回去取消上一个选中，反而增加工作量。
   */
  presetFilterColorIds: ColorId[];
  /**
   * 预设面板当前显示哪个库（D62；D86 把 `dictionary` 改成 `tags`）：
   * - `presets`：普通预设库（点任意颜色块都会回到这里）
   * - `tags`：Tag 库（点色块行里的 `T` 进入）
   * - `artists`：画师库（点 `@` 进入）
   * - `snapshots`：快照库（点 `S` 进入）
   */
  libraryView: LibraryView;
  /** 切换库视图（`T` / `@` / `S` 与任意颜色块都通过它切换） */
  setLibraryView: (view: LibraryView) => void;
  /**
   * **直接**把颜色筛选设成这一种（D65）。
   *
   * 与 `togglePresetFilterColor` 的区别：这里不做「再点一次取消」的判断 ——
   * 从画师库点任何颜色都应当是"进入该颜色的筛选"，
   * 而不是把上次残留的同色筛选又取消掉（用户实测的相邻色块 bug）。
   */
  setPresetFilterColor: (colorId: ColorId) => void;
  /** 当前页码（D66）：切库 / 改搜索 / 改颜色筛选时都会回到第 1 页 */
  libraryPage: number;
  setLibraryPage: (page: number) => void;
  /**
   * 每页条数（D66；D86 起**在设置里可改**）：默认 `LIBRARY_PAGE_SIZE`（100），
   * 由 `utils/uiSettings.ts` 从本地存储读回、改动即写回。
   *
   * 四个库（预设 / Tag / 画师 / 快照）统一读这一个值 —— 用户口径：
   * 「无论是画师库还是预设库还是快照库都统一采用这个值来设定分页」。
   */
  libraryPageSize: number;
  setLibraryPageSize: (size: number) => void;
  /** 预设搜索关键字，空串 = 不筛选（预设 / 画师 / Tag 三个库共用这一份） */
  presetSearchKeyword: string;
  /** 左列下方中文输入框的高度（水平分隔条调整） */
  inputPaneHeight: number;
  /** 右侧预设库宽度（垂直分隔条调整） */
  presetPanelWidth: number;
  /** 当前提示条，同一时刻只显示一条 */
  toast: ToastMessage | null;
  /** 设置弹窗 */
  settingsOpen: boolean;
  /** 齿轮设置弹窗（D80）：左侧 Tab 决定右边显示什么 */
  appSettingsOpen: boolean;
  appSettingsTab: AppSettingsTab;
  /**
   * 「把模块枢拖到预设库」要保存的模块 id。
   * 放在 Store 而不是组件本地状态：拖拽由 dragController 处理，它不在 React 树里。
   */
  savePresetModuleId: string | null;
  /**
   * 预设右键菜单（权重 / 编辑 / 删除）。
   * 同样放在 Store：右键事件与拖拽落在同一片区域，跨事件的界面状态集中在这里更可靠，
   * 也便于直接断言。
   */
  presetMenu: { presetId: string; x: number; y: number } | null;
  /**
   * 分组的右键菜单（D111 / D113）：重命名 / 解散 / 展开收起。
   *
   * 组的身份 = 名字 + 颜色，所以这里同时记 `colorId`（同名不同色是两个组）。
   */
  presetGroupMenu: { name: string; colorId: ColorId; x: number; y: number } | null;
  /**
   * 分组命名框（D111）。`create` 可带一条待移入的预设（拖到「新建分组」上松手），
   * `rename` 带原组名。放在 Store 是因为拖拽执行器不在 React 树里。
   */
  folderPrompt: {
    mode: 'create' | 'rename';
    presetId: string | null;
    /** 重命名时的目标组（名字 + 颜色） */
    from: { name: string; colorId: ColorId } | null;
    initialName: string;
  } | null;
  /** 翻译失败的常驻提示；null 表示当前没有失败提示 */
  translationFailure: TranslationFailure | null;
  /**
   * 界面主题（日/月切换）。
   *
   * 只放**纯数据**：写 DOM 与读写本地存储都在 `hooks/useTheme.ts` 里
   * （与草稿、布局偏好同一套分工：Store 不碰 IO）。
   * 初始值是默认主题；启动时由 Hook 从本地存储恢复，因此这里不读存储也是对的。
   */
  theme: ThemeMode;

  startDrag: (source: DragSource, pointer: Point) => void;
  moveDrag: (pointer: Point, hover: DropHover | null) => void;
  endDrag: () => void;
  togglePresetFilterColor: (colorId: ColorId) => void;
  clearPresetFilter: () => void;
  setPresetSearchKeyword: (keyword: string) => void;
  setInputPaneHeight: (height: number) => void;
  setPresetPanelWidth: (width: number) => void;
  pushToast: (text: string, tone?: ToastTone) => void;
  dismissToast: (id: string) => void;
  openSettings: () => void;
  closeSettings: () => void;
  /** 打开齿轮设置弹窗；tab 省略时保持上次的分类 */
  openAppSettings: (tab?: AppSettingsTab) => void;
  closeAppSettings: () => void;
  setAppSettingsTab: (tab: AppSettingsTab) => void;
  openSavePresetDialog: (moduleId: string) => void;
  closeSavePresetDialog: () => void;
  openPresetMenu: (presetId: string, x: number, y: number) => void;
  closePresetMenu: () => void;
  openPresetGroupMenu: (name: string, colorId: ColorId, x: number, y: number) => void;
  closePresetGroupMenu: () => void;
  openFolderPrompt: (prompt: {
    mode: 'create' | 'rename';
    presetId?: string | null;
    from?: { name: string; colorId: ColorId } | null;
    initialName: string;
  }) => void;
  closeFolderPrompt: () => void;
  showTranslationFailure: (message: string, code?: string) => void;
  dismissTranslationFailure: () => void;
  /** 设置主题（由 useTheme 的切换动作调用；启动恢复也走它） */
  setTheme: (mode: ThemeMode) => void;
}

export const useUiStore = create<UiState>((set) => ({
  drag: null,
  presetFilterColorIds: [],
  libraryView: 'presets',
  libraryPage: 1,
  libraryPageSize: loadLibraryPageSize(),
  presetSearchKeyword: '',
  inputPaneHeight: INPUT_PANE_DEFAULT_HEIGHT,
  presetPanelWidth: PRESET_PANEL_DEFAULT_WIDTH,
  toast: null,
  settingsOpen: false,
  appSettingsOpen: false,
  appSettingsTab: 'push',
  savePresetModuleId: null,
  presetMenu: null,
  presetGroupMenu: null,
  folderPrompt: null,
  translationFailure: null,
  theme: DEFAULT_THEME,

  startDrag: (source, pointer) => set({ drag: { source, pointer, hover: null } }),

  moveDrag: (pointer, hover) =>
    set((state) => (state.drag ? { drag: { ...state.drag, pointer, hover } } : {})),

  endDrag: () => set({ drag: null }),

  setLibraryView: (view) => set({ libraryView: view, libraryPage: 1 }),

  setLibraryPage: (page) => set({ libraryPage: page }),

  setLibraryPageSize: (size) => {
    // 夹到 [LIBRARY_PAGE_SIZE_MIN, LIBRARY_PAGE_SIZE_MAX]（D86，与设置面板的输入框同一套口径）
    const next = clampLibraryPageSize(size);
    // 顺手写回本地存储：改完立刻记住，不必再点「保存」
    saveLibraryPageSize(next);
    set({ libraryPageSize: next, libraryPage: 1 });
  },

  setPresetFilterColor: (colorId) => set({ presetFilterColorIds: [colorId], libraryPage: 1 }),

  togglePresetFilterColor: (colorId) =>
    set((state) => {
      // 单选语义：点已经选中的那一个 = 取消（回到「全部」）；点别的 = 直接换成它
      const alreadyOnly = state.presetFilterColorIds.length === 1 && state.presetFilterColorIds[0] === colorId;
      return { presetFilterColorIds: alreadyOnly ? [] : [colorId], libraryPage: 1 };
    }),

  clearPresetFilter: () => set({ presetFilterColorIds: [], libraryPage: 1 }),

  setPresetSearchKeyword: (keyword) => set({ presetSearchKeyword: keyword, libraryPage: 1 }),

  setInputPaneHeight: (height) => set({ inputPaneHeight: height }),

  setPresetPanelWidth: (width) => set({ presetPanelWidth: width }),

  pushToast: (text, tone = 'info') => set({ toast: { id: createId('toast'), text, tone } }),

  dismissToast: (id) =>
    set((state) => (state.toast && state.toast.id === id ? { toast: null } : {})),

  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openAppSettings: (tab) =>
    set(
      tab === 'push' ||
        tab === 'dictionary' ||
        tab === 'paging' ||
        tab === 'bundle' ||
        tab === 'reset'
        ? { appSettingsOpen: true, appSettingsTab: tab }
        : { appSettingsOpen: true },
    ),
  closeAppSettings: () => set({ appSettingsOpen: false }),
  setAppSettingsTab: (tab) => set({ appSettingsTab: tab }),
  openSavePresetDialog: (moduleId) => set({ savePresetModuleId: moduleId }),
  closeSavePresetDialog: () => set({ savePresetModuleId: null }),
  openPresetMenu: (presetId, x, y) => set({ presetMenu: { presetId, x, y } }),
  closePresetMenu: () => set({ presetMenu: null }),
  openPresetGroupMenu: (name, colorId, x, y) => set({ presetGroupMenu: { name, colorId, x, y } }),
  closePresetGroupMenu: () => set({ presetGroupMenu: null }),
  openFolderPrompt: (prompt) =>
    set({
      folderPrompt: {
        mode: prompt.mode,
        presetId: prompt.presetId ?? null,
        from: prompt.from ?? null,
        initialName: prompt.initialName,
      },
      // 命名框一开，右键菜单就该收起来（否则会浮在弹窗上面）
      presetGroupMenu: null,
      presetMenu: null,
    }),
  closeFolderPrompt: () => set({ folderPrompt: null }),
  showTranslationFailure: (message, code) =>
    set({ translationFailure: { message, code, at: Date.now() } }),

  dismissTranslationFailure: () => set({ translationFailure: null }),

  setTheme: (mode) => set({ theme: mode }),
}));
