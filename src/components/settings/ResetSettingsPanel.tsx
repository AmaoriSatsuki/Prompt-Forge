import { useState } from 'react';
import { resetLibraries, resetProviderConfig } from '../../api/reset';
import { errorMessage } from '../../api/tauri';
import {
  INPUT_PANE_DEFAULT_HEIGHT,
  LIBRARY_PAGE_SIZE,
  MODULE_DEFAULT_HEIGHT,
  PRESET_PANEL_DEFAULT_WIDTH,
} from '../../constants/limits';
import { reloadAllLibraries, suspendLibraryPersistence } from '../../hooks/libraryStorage';
import { useModuleStore } from '../../store/useModuleStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useUiStore } from '../../store/useUiStore';
import { Button } from '../common/Button';
import { ConfirmDialog } from '../common/ConfirmDialog';

/**
 * 「初始化」Tab（D117）。
 *
 * 三项都是**清空**，但代价完全不同，所以入场方式也不同（用户口径）：
 * 1. **界面初始化** —— 只是偏好回默认，没有实质损失，**不需要确认**；
 * 2. **库初始化** —— 五个库全删，为「干净地导入备份」服务，必须确认；
 * 3. **服务商 API 初始化** —— 配置 + 系统凭据库里的密钥一起删，必须确认。
 *
 * 顺序按使用频率排（用户明确要求）：界面 → 库 → 服务商。
 */
type ResetKind = 'ui' | 'libraries' | 'provider';

interface ResetRow {
  kind: ResetKind;
  title: string;
  desc: string;
  action: string;
  danger: boolean;
}

const ROWS: ResetRow[] = [
  {
    kind: 'ui',
    title: '界面初始化',
    desc: '主题回到亮色，预设库宽度、输入框高度、分页阈值与各排高度恢复默认；工作区里的中文内容与胶囊不会动。',
    action: '恢复默认',
    danger: false,
  },
  {
    kind: 'libraries',
    title: '库初始化',
    desc: '删除预设（含分组）、画师、Tag、词典与快照的全部数据，词典文件夹整个删掉；翻译服务与推送设置不受影响。',
    action: '清空五个库',
    danger: true,
  },
  {
    kind: 'provider',
    title: '服务商初始化',
    desc: '删除所有翻译服务配置，并删除系统凭据库里的密钥（不可恢复）；系统环境变量里的凭据不在本应用管辖内。',
    action: '清空服务商',
    danger: true,
  },
];

export function ResetSettingsPanel() {
  const pushToast = useUiStore((state) => state.pushToast);
  const [confirming, setConfirming] = useState<'libraries' | 'provider' | null>(null);
  const [busy, setBusy] = useState<ResetKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** 界面初始化：只动偏好，不弹确认 */
  function runUiReset() {
    setError(null);
    const ui = useUiStore.getState();
    ui.setTheme('light');
    ui.setPresetPanelWidth(PRESET_PANEL_DEFAULT_WIDTH);
    ui.setInputPaneHeight(INPUT_PANE_DEFAULT_HEIGHT);
    ui.setLibraryPageSize(LIBRARY_PAGE_SIZE);
    const moduleStore = useModuleStore.getState();
    for (const module of moduleStore.modules) {
      moduleStore.setOutputHeight(module.id, MODULE_DEFAULT_HEIGHT);
    }
    pushToast('界面已恢复默认', 'ok');
  }

  async function runLibraryReset() {
    setBusy('libraries');
    setError(null);
    suspendLibraryPersistence();
    try {
      await resetLibraries();
      await reloadAllLibraries();
      pushToast('五个库已清空', 'ok');
    } catch (cause) {
      setError(`清空失败：${errorMessage(cause)}`);
      // 失败也重读：清空是逐文件删的，界面必须停在磁盘现状
      await reloadAllLibraries();
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  async function runProviderReset() {
    setBusy('provider');
    setError(null);
    try {
      await resetProviderConfig();
      useSettingsStore.getState().clearProfiles();
      pushToast('服务商配置已清空', 'ok');
    } catch (cause) {
      setError(`清空失败：${errorMessage(cause)}`);
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  return (
    <div className="pf-push" data-pf-reset="true">
      {ROWS.map((row) => (
        <div className="pf-push__row" key={row.kind} data-pf-reset-row={row.kind}>
          <div className="pf-push__label">
            <span className="pf-push__title">{row.title}</span>
            <span className="pf-push__desc">{row.desc}</span>
          </div>
          <Button
            variant={row.danger ? 'danger' : 'ghost'}
            onClick={() => {
              if (row.kind === 'ui') {
                runUiReset();
                return;
              }
              setError(null);
              setConfirming(row.kind === 'libraries' ? 'libraries' : 'provider');
            }}
            disabled={busy !== null}
          >
            {busy === row.kind ? '处理中…' : row.action}
          </Button>
        </div>
      ))}

      <div className="pf-push__hint">
        <span className="pf-push__hint-title">说明：</span>
        界面初始化只改外观与布局，不需要确认；库初始化与服务商初始化为删除操作，每次都会先问一次。删除不可撤销，需要保留时请先在「导入导出」里备份。
      </div>

      {error ? (
        <p className="pf-push__error" data-pf-reset-error="true">
          {error}
        </p>
      ) : null}

      {confirming === 'libraries' ? (
        <ConfirmDialog
          title="清空五个库？"
          text="预设（含分组）、画师、Tag、词典、快照会被全部删除，词典文件夹整个删掉，且不能撤销。建议先备份。"
          confirmLabel="清空"
          onConfirm={() => void runLibraryReset()}
          onCancel={() => setConfirming(null)}
        />
      ) : null}

      {confirming === 'provider' ? (
        <ConfirmDialog
          title="清空服务商配置？"
          text="所有翻译服务配置会被删除，系统凭据库里的密钥也会一起删除，且不能撤销。之后需要重新填写凭据。"
          confirmLabel="清空"
          onConfirm={() => void runProviderReset()}
          onCancel={() => setConfirming(null)}
        />
      ) : null}
    </div>
  );
}
