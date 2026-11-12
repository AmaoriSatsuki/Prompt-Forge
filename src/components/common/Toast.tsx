import { useEffect } from 'react';
import { TOAST_DURATION_MS } from '../../constants/limits';
import { useUiStore } from '../../store/useUiStore';

/** 全局提示条：同时只显示一条，自动消失。 */
export function Toast() {
  const toast = useUiStore((state) => state.toast);
  const dismissToast = useUiStore((state) => state.dismissToast);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => dismissToast(toast.id), TOAST_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [toast, dismissToast]);

  if (!toast) return null;

  return (
    <div className={`pf-toast pf-toast--${toast.tone}`} role="status">
      {toast.text}
    </div>
  );
}
