import { useEffect } from 'react';
import { savePushSettingsToDisk } from '../api/push';
import { errorMessage } from '../api/tauri';
import { PERSIST_DEBOUNCE_MS } from '../constants/limits';
import { usePushStore } from '../store/usePushStore';
import { useUiStore } from '../store/useUiStore';
import type { PushSettings } from '../types/settings';

/**
 * 推送设置落盘（D80）。
 *
 * 与预设库/翻译配置同一套做法：Store 只存纯数据，落盘交给 Hook；
 * 内容与上次落盘一致时**不写**，避免「启动加载 → 立刻回写」这种无意义写盘；
 * 读取失败（浏览器预览里没有 Tauri）时不再尝试写盘，免得弹一堆无意义的失败提示。
 */
export function usePushPersistence() {
  const enabled = usePushStore((state) => state.enabled);
  const port = usePushStore((state) => state.port);
  const loaded = usePushStore((state) => state.loaded);
  const loadError = usePushStore((state) => state.loadError);
  const persistedSnapshot = usePushStore((state) => state.persistedSnapshot);
  const markPersisted = usePushStore((state) => state.markPersisted);
  const pushToast = useUiStore((state) => state.pushToast);

  useEffect(() => {
    if (!loaded || loadError) return;
    const settings: PushSettings = { enabled, port };
    const snapshot = JSON.stringify(settings);
    if (snapshot === persistedSnapshot) return;

    const timer = window.setTimeout(() => {
      savePushSettingsToDisk(settings)
        .then(() => markPersisted(snapshot))
        .catch((error) => pushToast(`推送设置保存失败：${errorMessage(error)}`, 'error'));
    }, PERSIST_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [enabled, port, loaded, loadError, persistedSnapshot, markPersisted, pushToast]);
}
