import { useState } from 'react';
import { MODULE_MAX_COUNT } from '../../constants/limits';
import { useTheme } from '../../hooks/useTheme';
import { selectCanAddModule, selectCanRemoveModule } from '../../store/selectors';
import { useModuleStore } from '../../store/useModuleStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useUiStore } from '../../store/useUiStore';
import {
  CONNECTION_STATUS_CLASS,
  CONNECTION_STATUS_TITLE,
  connectionStatusOf,
} from '../../utils/connectionStatus';
import type { ConnectionStatus, ThemeMode } from '../../types/settings';
import { THEME_TOGGLE } from '../../utils/theme';
import { Button } from '../common/Button';
import { ConfirmDialog } from '../common/ConfirmDialog';

/**
 * 主题切换图标：太阳 / 月亮（经典样式，纯 SVG，不引外部图标库）。
 *
 * `currentColor` 描边，因此自动跟随主题与悬停配色，不需要第二套图标。
 * 两个图标都保持 18×18 的同一包围盒，切换时按钮尺寸不变（与 §6.10 同一条要求）。
 */
function ThemeIcon({ mode }: { mode: ThemeMode }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  if (THEME_TOGGLE[mode].icon === 'sun') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <path d="M20 13.4A8.2 8.2 0 1 1 10.6 4a6.7 6.7 0 0 0 9.4 9.4Z" />
    </svg>
  );
}


/**
 * 齿轮图标（D80）：打开"应用设置"弹窗（推送服务 / 词典管理）。
 *
 * 与主题图标同一套画法（18×18、`currentColor` 描边、`aria-hidden`），
 * 因此悬停变色与两套主题都对得上，也不需要第二套图标。
 */
function GearIcon() {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.12a1.7 1.7 0 0 0-1.11-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H2.9a2 2 0 1 1 0-4h.12A1.7 1.7 0 0 0 4.6 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.55V2.9a2 2 0 1 1 4 0v.12a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.55 1h.12a2 2 0 1 1 0 4h-.12a1.7 1.7 0 0 0-1.55 1Z" />
    </svg>
  );
}
export interface TopBarViewProps {
  moduleCount: number;
  canAddModule: boolean;
  canRemoveModule: boolean;
  /** 当前选中模块的序号（未选中时传 null），只用于「删除模块」的悬浮说明 */
  selectedModuleOrder: number | null;
  /** 当前生效配置的显示名；没有配置时传 null */
  activeProfileLabel: string | null;
  /** 状态指示灯的结论（颜色与悬浮说明都由它决定） */
  connectionStatus: ConnectionStatus;
  /** 当前主题：决定切换按钮画太阳还是月亮 */
  theme: ThemeMode;
  onAdd: () => void;
  onRemoveClick: () => void;
  onOpenSettings: () => void;
  /** 打开齿轮设置弹窗（D80：推送服务 / 词典管理两个 Tab） */
  onOpenAppSettings: () => void;
  onToggleTheme: () => void;
}

/**
 * 顶部工具栏（**纯展示组件**：接 props、不读 Store）。
 *
 * 为什么是纯展示：架构 §6.4 —— 静态渲染（`renderToStaticMarkup`）下 zustand 只返回
 * `getInitialState()`，读 Store 的组件在断言里永远只画初始状态，指示灯这种
 * 「随状态变色」的东西就再也测不出来。夹具断言因此必须走这一层。
 *
 * **工具栏整合（用户 2026 轮，覆盖此前所有关于工具栏的讨论）**，
 * 以及**顶栏「设置」按钮移除（用户 2026 轮后追加，见 DECISIONS D30）**：
 *
 * ```
 * 模块 6 / 10 | ● 翻译服务：百度（可点击＝打开翻译服务设置） | 新增模块 | 删除模块 | ☀/🌙 | ⚙
 * ```
 *
 * 「词典」按钮曾是 D49 的入口，**D80 已移除**：词典管理迁进齿轮设置弹窗的第二个 Tab。
 * 已移除的按钮及其去向：
 * - **全文翻译**：实时翻译已替代（打字即翻，不再需要手动触发）；
 * - **全文复制 / 全文清空**：搬到输入框右上角（`SourceEditorPane` 的头部），
 *   因为它们作用于「全部模块的内容」，放在内容区更顺手；
 * - **设置**：打开设置的动作改由「翻译服务：<配置名>」这颗标签承担
 *   （原本它就是打开设置的按钮，只是过去另有一个显式的「设置」按钮）。
 *   `Ctrl+,` 快捷键仍然可用（挂在 `useHotkeys` 上），但不在界面上显示
 *   —— 界面文案只保留用户指定的「点击配置翻译服务」。
 *
 * 「删除模块」保留二次确认，并保留「至少保留 1 个」的保护：
 * 未达下限时按钮可点但只给中文提示，避免用户对着灰按钮猜原因。
 */
export function TopBarView({
  moduleCount,
  canAddModule,
  canRemoveModule,
  selectedModuleOrder,
  activeProfileLabel,
  connectionStatus,
  theme,
  onAdd,
  onRemoveClick,
  onOpenSettings,
  onOpenAppSettings,
  onToggleTheme,
}: TopBarViewProps) {
  return (
    <header className="pf-topbar">
      <div className="pf-topbar__brand">
        <span className="pf-topbar__title">Prompt Forge</span>
        <span className="pf-topbar__subtitle">提示词工坊</span>
      </div>
      <div className="pf-topbar__count">
        模块 {moduleCount} / {MODULE_MAX_COUNT}
      </div>
      {/*
        翻译服务标签 = 打开设置的唯一入口（用户 2026 轮：顶栏「设置」按钮已移除，
        打开设置的动作收拢到这颗标签上）。因此必须带中文悬停说明，
        否则界面上再没有「点哪里能进设置」的可见线索（Ctrl+, 仍可用，但不写在界面上）。
      */}
      <button
        type="button"
        className="pf-topbar__provider"
        title="点击配置翻译服务"
        onClick={onOpenSettings}
      >
        {/* 翻译服务状态指示灯：白色未配置 / 绿色连接正常 / 红色连接异常 */}
        <span
          className={`pf-topbar__status-light pf-topbar__status-light--${
            CONNECTION_STATUS_CLASS[connectionStatus]
          }`}
          title={CONNECTION_STATUS_TITLE[connectionStatus]}
          aria-label={CONNECTION_STATUS_TITLE[connectionStatus]}
          role="img"
        />
        翻译服务：{activeProfileLabel ?? '未配置'}
      </button>
      <div className="pf-topbar__actions">
        <Button disabled={!canAddModule} onClick={onAdd}>
          新增模块
        </Button>
        <Button
          variant="danger"
          disabled={moduleCount === 0}
          title={
            canRemoveModule
              ? selectedModuleOrder === null
                ? '删除当前选中的模块'
                : `删除当前选中的模块 ${selectedModuleOrder}`
              : '至少保留 1 个模块'
          }
          onClick={onRemoveClick}
        >
          删除模块
        </Button>

        {/*
          主题切换：太阳 = 当前深色（点了变亮），月亮 = 当前亮色（点了变暗）。
          文案（title + aria-label）是中文，符合界面文案零英文。
        */}
        <Button
          className="pf-topbar__theme"
          title={THEME_TOGGLE[theme].title}
          aria-label={THEME_TOGGLE[theme].title}
          onClick={onToggleTheme}
        >
          <ThemeIcon mode={theme} />
        </Button>
        {/*
          D80：齿轮设置入口，放在主题按钮**右侧**（顶栏最右端）。
          打开的是新的"应用设置"弹窗（推送服务 / 词典管理两个 Tab），
          与「翻译服务：<配置名>」打开的翻译服务设置是两件事。
        */}
        <Button
          className="pf-topbar__app-settings"
          title="设置（推送服务 / 词典管理）"
          aria-label="打开设置"
          onClick={onOpenAppSettings}
        >
          <GearIcon />
        </Button>
      </div>
    </header>
  );
}

/** 顶栏容器：把 Store / 动作接到纯展示组件上（删除确认的对话框也归这里） */
export function TopBar() {
  const modules = useModuleStore((state) => state.modules);
  const selectedModuleId = useModuleStore((state) => state.selectedModuleId);
  const canAddModule = useModuleStore(selectCanAddModule);
  const canRemoveModule = useModuleStore(selectCanRemoveModule);
  const addModule = useModuleStore((state) => state.addModule);
  const removeModule = useModuleStore((state) => state.removeModule);

  const pushToast = useUiStore((state) => state.pushToast);
  const openSettings = useUiStore((state) => state.openSettings);
  const openAppSettings = useUiStore((state) => state.openAppSettings);

  const profiles = useSettingsStore((state) => state.profiles);
  const activeProfileId = useSettingsStore((state) => state.activeProfileId);
  const keyStatus = useSettingsStore((state) => state.keyStatus);
  const connectionStatus = useSettingsStore((state) => state.connectionStatus);

  const { theme, toggle: toggleTheme } = useTheme();

  const [removePending, setRemovePending] = useState(false);

  const activeProfile =
    profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0];
  const selectedModule =
    modules.find((module) => module.id === selectedModuleId) ?? modules[0];

  // 灯的结论取自「当前生效那套」：切配置时灯跟着换，不会把上一套的绿灯带过来
  const lightStatus = connectionStatusOf(
    activeProfile,
    activeProfile ? keyStatus[activeProfile.id] === true : false,
    activeProfile ? connectionStatus[activeProfile.id] : undefined,
  );

  function handleAdd() {
    if (!addModule()) pushToast(`最多只能有 ${MODULE_MAX_COUNT} 个模块`, 'warn');
  }

  function handleRemoveClick() {
    // 保持可点：这样用户能知道「为什么不能删」，而不是对着一个灰按钮猜
    if (!canRemoveModule) {
      pushToast('至少保留 1 个模块，无法再删除', 'warn');
      return;
    }
    setRemovePending(true);
  }

  return (
    <>
      <TopBarView
        moduleCount={modules.length}
        canAddModule={canAddModule}
        canRemoveModule={canRemoveModule}
        selectedModuleOrder={selectedModule?.order ?? null}
        activeProfileLabel={activeProfile ? activeProfile.label : null}
        connectionStatus={lightStatus}
        theme={theme}
        onAdd={handleAdd}
        onRemoveClick={handleRemoveClick}
        onOpenSettings={openSettings}
        onOpenAppSettings={() => openAppSettings()}
        onToggleTheme={toggleTheme}
      />

      {removePending && selectedModule ? (
        <ConfirmDialog
          title="删除模块"
          text={`确定要删除模块 ${selectedModule.order} 吗？它的中文内容、胶囊与译文都会一起消失。`}
          confirmLabel="删除"
          onConfirm={() => {
            const removed = removeModule(selectedModule.id);
            setRemovePending(false);
            pushToast(removed ? '模块已删除' : '至少保留 1 个模块，无法再删除', removed ? 'ok' : 'warn');
          }}
          onCancel={() => setRemovePending(false)}
        />
      ) : null}
    </>
  );
}
