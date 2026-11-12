import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import {
  DEFAULT_VIEWPORT_WIDTH,
  INPUT_PANE_MAX_HEIGHT,
  INPUT_PANE_MIN_HEIGHT,
  PRESET_PANEL_MIN_WIDTH,
} from '../../constants/limits';
import { clampPresetPanelWidth, presetPanelMaxWidth } from '../../utils/panelWidth';
import { DragGhost } from '../../drag/DragGhost';
import { useConnectionStatus } from '../../hooks/useConnectionStatus';
import { useHotkeys } from '../../hooks/useHotkeys';
import { useModuleDraft } from '../../hooks/useModuleDraft';
import {
  useArtistPersistence,
  usePresetFolderPersistence,
  usePresetPersistence,
  useTagPersistence,
} from '../../hooks/usePresetPersistence';
import { usePushBroadcast } from '../../hooks/usePushBroadcast';
import { usePushPersistence } from '../../hooks/usePushPersistence';
import { useSnapshotPersistence } from '../../hooks/useSnapshotPersistence';
import { useRealtimeTranslate } from '../../hooks/useRealtimeTranslate';
import { useSettingsPersistence } from '../../hooks/useSettingsPersistence';
import { useTheme } from '../../hooks/useTheme';
import { useTranslate } from '../../hooks/useTranslate';
import { useModuleStore } from '../../store/useModuleStore';
import { useDictionaryStore } from '../../store/useDictionaryStore';
import { usePresetStore } from '../../store/usePresetStore';
import { usePushStore } from '../../store/usePushStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useUiStore } from '../../store/useUiStore';
import { focusSourceEditor } from '../../utils/editorFocus';
import { Toast } from '../common/Toast';
import { ModuleStrip } from '../module/ModuleStrip';
import { SourceEditorPane } from '../module/SourceEditorPane';
import { PresetPanel } from '../preset/PresetPanel';
import { AppSettingsDialog } from '../settings/AppSettingsDialog';
import { SettingsDialog } from '../settings/SettingsDialog';
import { ErrorBanner } from './ErrorBanner';
import { TopBar } from './TopBar';
import { PanelSplitter } from './PanelSplitter';

import '../../styles/layout.css';
import '../../styles/module.css';
import '../../styles/common.css';
import '../../styles/preset.css';
import '../../styles/settings.css';
import '../../styles/dictionary.css';
import '../../styles/app-settings.css';

/**
 * 应用骨架。
 *
 * 工作区布局（左侧上下两栏 + 右侧预设库）：
 * ```
 * ┌ 顶栏 ────────────────────────────────────────────────┐
 * │ ┌ 输出列表（模块只读展示英文 + 胶囊）────────┐ ║ ┌ 预设库 ┐ │
 * │ ├────────── 水平分隔条（调输入框高度）──────┤ ║ │ 搜索   │ │
 * │ │ 中文输入框（当前选中模块）               │ ║ │ 筛选   │ │
 * │ └─────────────────────────────────────────┘ ║ │ 列表   │ │
 * └──────────────────────────────────────────────────────┘
 *        ║ = 垂直分隔条（调预设库宽度）
 * ```
 *
 * 模块初始数据在 useModuleStore 创建时就已就绪；预设库与服务商配置从磁盘读取，
 * 会话草稿（含布局偏好）从本地存储恢复，因此这里有三个加载副作用与各自的落盘 Hook。
 */
export function AppShell() {
  const loadPresets = usePresetStore((state) => state.loadPresets);
  const loadConfig = useSettingsStore((state) => state.loadConfig);
  const loadDictionaries = useDictionaryStore((state) => state.load);
  const loadPushSettings = usePushStore((state) => state.load);
  const selectedModuleId = useModuleStore((state) => state.selectedModuleId);
  const selectAdjacentModule = useModuleStore((state) => state.selectAdjacentModule);
  const openSettings = useUiStore((state) => state.openSettings);
  const inputPaneHeight = useUiStore((state) => state.inputPaneHeight);
  const presetPanelWidth = useUiStore((state) => state.presetPanelWidth);
  const setInputPaneHeight = useUiStore((state) => state.setInputPaneHeight);
  const setPresetPanelWidth = useUiStore((state) => state.setPresetPanelWidth);

  const { translateModule } = useTranslate();
  const { retryFailed } = useRealtimeTranslate();

  /**
   * 预设库宽度的上限是**视口相对的**：窗口宽度的 70%（D48）。
   *
   * 因此这里要跟着窗口尺寸走：窗口变小时把已存的宽度夹回来，
   * 否则窄窗口下面板会把左列挤没（左列自身还有 320px 下限）。
   * 非浏览器环境（静态渲染 / 断言）没有 `window`，用兜底宽度算 70%。
   */
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === 'undefined' ? DEFAULT_VIEWPORT_WIDTH : window.innerWidth,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleResize = () => setViewportWidth(window.innerWidth);
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const next = clampPresetPanelWidth(presetPanelWidth, viewportWidth);
    if (next !== presetPanelWidth) setPresetPanelWidth(next);
  }, [presetPanelWidth, viewportWidth, setPresetPanelWidth]);
  useEffect(() => {
    void loadPresets();
  }, [loadPresets]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  // 本地词典：启动读一次列表与启用词典的条目（字典匹配在前端做，见 utils/glossary.ts）
  useEffect(() => {
    void loadDictionaries();
  }, [loadDictionaries]);

  // 推送设置（D80）：开关与端口，启动读一次、改动即落盘
  useEffect(() => {
    void loadPushSettings();
  }, [loadPushSettings]);

  usePresetPersistence();
  // D111：分组元数据单独落盘（`preset-folders.json`），读不到也不影响预设库本身
  usePresetFolderPersistence();
  // 画师库（D62）：只有进过 `@` 视图才会 loaded，没打开过就什么都不会写
  useArtistPersistence();
  // Tag 库（D86）：与画师库同一条规矩，只有进过 `T` 视图才会读盘 / 写盘
  useTagPersistence();
  useSnapshotPersistence();
  useSettingsPersistence();
  usePushPersistence();
  // 实时推流（D81）：最终拼接文本一变就推给 ComfyUI（前端 200ms 防抖，见 hooks/usePushBroadcast）
  usePushBroadcast();
  useModuleDraft();
  // 实时翻译：每个模块监听自身源内容，防抖 500ms 后翻译（详见 hooks/useRealtimeTranslate）
  useRealtimeTranslate();
  // 顶栏状态指示灯：配置与凭据就绪后，在后台为当前配置跑一次连接测试（不阻塞、不提示）
  useConnectionStatus();
  // 主题：启动恢复上次选择 + 变更时写 DOM 与本地存储（在最外层挂一次即可）
  useTheme();

  useHotkeys({
    // 工具栏整合后不再有「翻译」按钮，这两个快捷键就是手动补救入口：
    // Ctrl+Enter 重翻当前排；Ctrl+Shift+Enter 重试所有失败的排。
    onTranslateSelected: () => {
      if (!selectedModuleId) return;
      void translateModule(selectedModuleId);
    },
    onTranslateFailed: () => void retryFailed(),
    onOpenSettings: openSettings,
    onSelectModule: (delta) => {
      selectAdjacentModule(delta);
      // 切换后把焦点交回中文输入框，这样连按几次之后可以直接打字（需求 1）
      focusSourceEditor();
    },
  });

  const workbenchStyle = {
    '--pf-input-height': `${inputPaneHeight}px`,
    '--pf-preset-width': `${presetPanelWidth}px`,
  } as CSSProperties;

  return (
    <div className="pf-shell">
      <TopBar />

      {/* 翻译失败提示：常驻在顶栏下方，必须手动关掉才消失；带「重试」按钮 */}
      <ErrorBanner />

      <div className="pf-workbench" style={workbenchStyle}>
        <div className="pf-left-col">
          <ModuleStrip />
          <PanelSplitter
            axis="y"
            label="上下拖动调整输入框高度"
            value={inputPaneHeight}
            min={INPUT_PANE_MIN_HEIGHT}
            max={INPUT_PANE_MAX_HEIGHT}
            onChange={setInputPaneHeight}
            measure={(pointerY, rect) => rect.bottom - pointerY}
          />
          <SourceEditorPane />
        </div>

        <PanelSplitter
          axis="x"
          label="左右拖动调整预设库宽度"
          value={presetPanelWidth}
          min={PRESET_PANEL_MIN_WIDTH}
          max={presetPanelMaxWidth(viewportWidth)}
          onChange={setPresetPanelWidth}
          // 减去工作区的右内边距，面板宽度才与指针距离一致
          measure={(pointerX, rect) => rect.right - pointerX - 8}
        />

        <PresetPanel />
      </div>

      <Toast />
      <SettingsDialog />
      {/* D80：齿轮设置弹窗（推送服务 / 词典管理） */}
      <AppSettingsDialog />
      <DragGhost />
    </div>
  );
}
