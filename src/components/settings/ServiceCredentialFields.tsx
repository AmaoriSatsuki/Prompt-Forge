import { useState } from 'react';
import { errorMessage } from '../../api/tauri';
import { useUiStore } from '../../store/useUiStore';
import { Button } from '../common/Button';

interface ServiceCredentialFieldsProps {
  profileId: string;
  configured: boolean;
  /** 各服务商对这两个字段的叫法不同（百度：APP ID / 密钥） */
  labels: { id: string; key: string };
  /** 服务商的中文名，只用于说明与 placeholder */
  brandLabel: string;
  /** 支持环境变量兜底的服务商把两个变量名传进来，界面会把来源优先级说清 */
  envNames?: { id: string; key: string };
  onSave: (appId: string, appKey: string) => Promise<void>;
  onClear: () => Promise<void>;
}

/**
 * 「一对凭据」的输入控件（翻译服务的凭据都是两个值）。
 *
 * 两个真正的输入框（早先版本只把两个环境变量名做成了带边框的说明文字，
 * 看起来像已填好的输入框，实际点不进也打不了字——那是个界面错误，不要退回那种做法）。
 *
 * 只写不读：保存后立刻清空输入框，之后只显示「已配置 / 未配置」。
 */
export function ServiceCredentialFields({
  profileId,
  configured,
  labels,
  brandLabel,
  envNames,
  onSave,
  onClear,
}: ServiceCredentialFieldsProps) {
  const [appId, setAppId] = useState('');
  const [appKey, setAppKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pushToast = useUiStore((state) => state.pushToast);

  const appIdInputId = `pf-service-appid-${profileId}`;
  const appKeyInputId = `pf-service-appkey-${profileId}`;

  /**
   * 凭据的完整说明（存哪、能不能读回、界面与环境变量的优先级）。
   *
   * 用户 2026 轮要求精简面板：这段话原本是一整段常驻小字，占掉三行；
   * 现在收进「凭据」标签的悬停提示，面板上只留一行结论。
   */
  const credentialDetail = envNames
    ? `两项都写进 Windows 凭据管理器，应用不保存明文，也没有读回通道。这里填写的优先使用；没填时才去读系统环境变量 ${envNames.id} 与 ${envNames.key}。`
    : '两项都写进 Windows 凭据管理器，应用不保存明文，也没有读回通道。这里填写的就是最终生效的那一份。';

  async function handleSave() {
    setBusy(true);
    setError('');
    try {
      await onSave(appId, appKey);
      setAppId('');
      setAppKey('');
      pushToast('凭据已保存到系统凭据库', 'ok');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleClear() {
    setBusy(true);
    setError('');
    try {
      await onClear();
      setAppId('');
      setAppKey('');
      pushToast('凭据已清除', 'ok');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pf-field">
      <span className="pf-field__label" title={credentialDetail}>
        凭据
        <span className={configured ? 'pf-key__state pf-key__state--ok' : 'pf-key__state'}>
          {configured ? '已保存在系统凭据库' : '尚未配置'}
        </span>
      </span>

      <div className="pf-cred">
        <label className="pf-cred__row" htmlFor={appIdInputId}>
          <span className="pf-cred__label">{labels.id}</span>
          <input
            id={appIdInputId}
            className="pf-field__input"
            value={appId}
            autoComplete="off"
            spellCheck={false}
            placeholder={configured ? '如需更换，重新填写' : `${brandLabel}开放平台里的 ${labels.id}`}
            onChange={(event) => {
              setAppId(event.currentTarget.value);
              setError('');
            }}
          />
        </label>

        <label className="pf-cred__row" htmlFor={appKeyInputId}>
          <span className="pf-cred__label">{labels.key}</span>
          <input
            id={appKeyInputId}
            className="pf-field__input"
            type="password"
            value={appKey}
            autoComplete="off"
            spellCheck={false}
            placeholder={configured ? '如需更换，粘贴新的' : `同一个应用下的${labels.key}`}
            onChange={(event) => {
              setAppKey(event.currentTarget.value);
              setError('');
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void handleSave();
              }
            }}
          />
        </label>
      </div>

      <div className="pf-key">
        <Button
          compact
          variant="primary"
          disabled={busy || appId.trim().length === 0 || appKey.trim().length === 0}
          onClick={handleSave}
        >
          保存
        </Button>
        <Button compact disabled={busy || !configured} onClick={handleClear}>
          清除
        </Button>
      </div>

      {error ? <p className="pf-field__error">{error}</p> : null}

      <p className="pf-field__hint">
        {envNames
          ? '保存在 Windows 凭据管理器，只写不读；未填写时可用系统环境变量兜底。'
          : '保存在 Windows 凭据管理器，只写不读。'}
      </p>
    </div>
  );
}
