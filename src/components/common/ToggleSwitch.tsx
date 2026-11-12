interface ToggleSwitchProps {
  /** 当前是否打开 */
  checked: boolean;
  /** 无障碍名（中文，例如「开启 WebSocket 推送」） */
  label: string;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}

/**
 * 滑动开关（D80）。
 *
 * 结构与 iOS 开关一致：一条轨道 + 一颗圆点，打开时圆点滑到右端、轨道点亮。
 * 语义走 `role="switch"` + `aria-checked`（读屏能念出「已打开 / 已关闭」），
 * 文案走 `aria-label` / `title`，因此组件里**没有任何可见文字**（界面文案零英文由调用方保证）。
 *
 * 为什么不用原生 `<input type="checkbox">`：原生控件在 WebView2 里的外观随系统走，
 * 与两套主题对不上；而这里只有轨道与圆点两个元素，尺寸/圆角全用主题变量，
 * 两个主题下都能保持一致（颜色只来自 `--pf-accent` / `--pf-bg-*`）。
 */
export function ToggleSwitch({ checked, label, onChange, disabled }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={checked ? 'pf-toggle pf-toggle--on' : 'pf-toggle'}
      onClick={() => onChange(!checked)}
    >
      <span className="pf-toggle__knob" aria-hidden="true" />
    </button>
  );
}
