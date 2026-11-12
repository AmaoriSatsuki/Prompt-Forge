import { useEscapeKey } from '../../hooks/useEscapeKey';
import { usePushStore } from '../../store/usePushStore';
import { useUiStore } from '../../store/useUiStore';
import type { AppSettingsTab } from '../../types/settings';
import { DictionaryPanel } from '../dictionary/DictionaryPanel';
import { LibraryBundlePanel } from './LibraryBundlePanel';
import { PagingSettingsPanel } from './PagingSettingsPanel';
import { PushSettingsPanel } from './PushSettingsPanel';
import { ResetSettingsPanel } from './ResetSettingsPanel';

/**
 * 齿轮设置弹窗（D80）：左侧 Tab + 右侧内容区。
 *
 * 结构参考用户给的 `UI.html` 原型，但**视觉全部走榫言自己的令牌**
 * （`--pf-bg-*` / `--pf-border*` / `--pf-text*` / `--pf-accent`），
 * 不照搬原型里的颜色值 —— 原型是深灰底蓝点缀，本项目两套主题各有自己的色阶。
 *
 * 三条硬约定：
 * 1. **外框不滚动**：弹窗是 `grid: 160px | 1fr` 且 `overflow: hidden`，只有右侧内容区 `overflow-y: auto`
 *    （与设置面板 D46 的"只允许一层滚动"同一条规矩）。
 * 2. **关闭按钮固定**：✕ 挂在弹窗本体上（不在滚动区里），滚到哪儿都能关。
 * 3. **Esc 分层**：词典 Tab 里的命名/映射框先关（见 `hooks/useEscapeKey` 的栈语义）。
 *
 * Tab（D86）：【推送服务】【词典管理】【列表分页】；D115 追加【导入导出】；D117 追加【初始化】。
 */

const TABS: Array<{ id: AppSettingsTab; label: string }> = [
  { id: 'push', label: '推送服务' },
  { id: 'dictionary', label: '词典管理' },
  { id: 'paging', label: '列表分页' },
  { id: 'bundle', label: '导入导出' },
  { id: 'reset', label: '初始化' },
];

export function AppSettingsDialog() {
  const open = useUiStore((state) => state.appSettingsOpen);
  const tab = useUiStore((state) => state.appSettingsTab);
  const close = useUiStore((state) => state.closeAppSettings);
  const setTab = useUiStore((state) => state.setAppSettingsTab);

  const enabled = usePushStore((state) => state.enabled);
  const port = usePushStore((state) => state.port);
  const setEnabled = usePushStore((state) => state.setEnabled);
  const setPort = usePushStore((state) => state.setPort);

  useEscapeKey(close);

  if (!open) return null;

  const activeLabel = TABS.find((item) => item.id === tab)?.label ?? TABS[0].label;

  return (
    <div className="pf-modal" role="dialog" aria-modal="true" aria-label="设置">
      <div className="pf-modal__backdrop" onClick={close} />
      <div className="pf-modal__panel pf-modal__panel--app">
        <button
          type="button"
          className="pf-app-settings__close"
          title="关闭设置"
          aria-label="关闭设置"
          onClick={close}
        >
          ✕
        </button>

        <nav className="pf-app-settings__tabs" role="tablist" aria-label="设置分类">
          {TABS.map((item) => {
            const active = item.id === tab;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={active ? 'pf-app-settings__tab pf-app-settings__tab--on' : 'pf-app-settings__tab'}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <section
          className="pf-app-settings__content pf-scroll-thin"
          role="tabpanel"
          aria-label={activeLabel}
        >
          <h3 className="pf-app-settings__title">{activeLabel}</h3>
          {tab === 'push' ? (
            <PushSettingsPanel
              enabled={enabled}
              port={port}
              onChange={(patch) => {
                if (patch.enabled !== undefined) setEnabled(patch.enabled);
                if (patch.port !== undefined) setPort(patch.port);
              }}
            />
          ) : tab === 'paging' ? (
            <PagingSettingsPanel />
          ) : tab === 'bundle' ? (
            <LibraryBundlePanel />
          ) : tab === 'reset' ? (
            <ResetSettingsPanel />
          ) : (
            <DictionaryPanel />
          )}
        </section>
      </div>
    </div>
  );
}
