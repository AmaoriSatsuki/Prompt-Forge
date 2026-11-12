import { useEffect } from 'react';
import { saveConfigToDisk } from '../api/config';
import { errorMessage } from '../api/tauri';
import { PERSIST_DEBOUNCE_MS } from '../constants/limits';
import { useSettingsStore } from '../store/useSettingsStore';
import { useUiStore } from '../store/useUiStore';
import type { AppConfig } from '../types/settings';

/**
 * 服务商配置落盘。
 *
 * 与预设库同一套做法：Store 保持纯数据，落盘交给 Hook；
 * 内容与上次落盘一致时不写，避免「启动加载 → 立刻回写」。
 * 读取失败（例如浏览器预览）时不再尝试写盘，免得弹一堆无意义的失败提示。
 */
export function useSettingsPersistence() {
  const profiles = useSettingsStore((state) => state.profiles);
  const activeProfileId = useSettingsStore((state) => state.activeProfileId);
  const loaded = useSettingsStore((state) => state.loaded);
  const loadError = useSettingsStore((state) => state.loadError);
  const persistedSnapshot = useSettingsStore((state) => state.persistedSnapshot);
  const markPersisted = useSettingsStore((state) => state.markPersisted);
  const pushToast = useUiStore((state) => state.pushToast);

  useEffect(() => {
    if (!loaded || loadError) return;
    const config: AppConfig = { profiles, activeProfileId };
    const snapshot = JSON.stringify(config);
    if (snapshot === persistedSnapshot) return;

    const timer = window.setTimeout(() => {
      saveConfigToDisk(config)
        .then(() => markPersisted(snapshot))
        .catch((error) => pushToast(`配置保存失败：${errorMessage(error)}`, 'error'));
    }, PERSIST_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [profiles, activeProfileId, loaded, loadError, persistedSnapshot, markPersisted, pushToast]);
}
