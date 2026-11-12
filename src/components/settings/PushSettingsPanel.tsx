import { useEffect, useState } from 'react';
import { PUSH_PORT_MAX, PUSH_PORT_MIN } from '../../constants/limits';
import type { PushSettings } from '../../types/settings';
import { clampPort, isValidPort } from '../../utils/pushSettings';
import { ToggleSwitch } from '../common/ToggleSwitch';

export interface PushSettingsPanelProps {
  enabled: boolean;
  port: number;
  /** 只传改动的字段；持久化由外层负责 */
  onChange: (patch: Partial<PushSettings>) => void;
}

/**
 * 「推送服务」Tab（D80）—— 纯展示组件（接 props，可用夹具断言）。
 *
 * 三段：开关行 → 端口行 → 使用说明。**开关关闭时端口输入框置灰禁用**（用户明确要求）。
 *
 * 端口输入的两个细节：
 * 1. 输入过程中**不强行夹取**（否则打到一半的「8」会被改成 1024，根本没法输入）：
 *    - 已经落在 1024–65535 里的值**立刻写回**（键入「9000」到第四位就生效）；
 *    - 越界或空值先留在草稿里，等**失焦 / 回车**时夹到最近的合法值并写回；
 * 2. `type="number"` + `min` / `max` 只是给系统选择器用的提示，真正的约束在 `clampPort`。
 */
export function PushSettingsPanel({ enabled, port, onChange }: PushSettingsPanelProps) {
  // 输入框里显示的是"正在输入的值"，与 Store 里的合法值分开，避免打字被夹取打断
  const [draft, setDraft] = useState(String(port));

  useEffect(() => {
    setDraft(String(port));
  }, [port]);

  /** 失焦 / 回车：把草稿夹到合法区间并写回 */
  function commitDraft(): void {
    const next = clampPort(Number(draft));
    setDraft(String(next));
    if (next !== port) onChange({ port: next });
  }

  /** 输入中：合法值立刻生效，越界值先留着等失焦再夹（这样才打得进去） */
  function handleDraftChange(raw: string): void {
    setDraft(raw);
    const value = Number(raw);
    if (raw.trim() !== '' && isValidPort(value) && Math.round(value) !== port) {
      onChange({ port: Math.round(value) });
    }
  }

  return (
    <div className="pf-push">
      <div className="pf-push__row">
        <div className="pf-push__label">
          <span className="pf-push__title">开启 WebSocket 推送</span>
        </div>
        <ToggleSwitch
          checked={enabled}
          label="开启 WebSocket 推送"
          onChange={(next) => onChange({ enabled: next })}
        />
      </div>

      <div className="pf-push__row">
        <div className="pf-push__label">
          <span className="pf-push__title">通信端口</span>
          <span className="pf-push__desc">ComfyUI 插件将通过此端口接收实时推流。</span>
        </div>
        <input
          type="number"
          className="pf-push__input"
          aria-label="通信端口"
          title={`端口范围 ${PUSH_PORT_MIN}–${PUSH_PORT_MAX}`}
          min={PUSH_PORT_MIN}
          max={PUSH_PORT_MAX}
          step={1}
          value={draft}
          disabled={!enabled}
          onChange={(event) => handleDraftChange(event.target.value)}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitDraft();
            if (event.key === 'Escape') setDraft(String(port));
          }}
        />
      </div>

      {enabled && draft !== '' && !isValidPort(Number(draft)) ? (
        <p className="pf-push__error">
          端口需在 {PUSH_PORT_MIN}–{PUSH_PORT_MAX} 之间，失焦或回车后会自动夹到最近的合法值。
        </p>
      ) : null}

      <div className="pf-push__hint">
        <span className="pf-push__hint-title">使用说明：</span>
        <br />
        1. 保持此开关开启，并启动 ComfyUI。
        <br />
        2. 在 ComfyUI 中添加「SunYan Sync」节点。
        <br />
        3. 在此处输入中文拼装时，ComfyUI 节点的文本会自动实时同步。
      </div>
    </div>
  );
}
