import { create } from 'zustand';
import { loadPushSettingsFromDisk } from '../api/push';
import { errorMessage } from '../api/tauri';
import { PUSH_DEFAULT_PORT } from '../constants/limits';
import type { PushSettings } from '../types/settings';
import { clampPort, normalizePushSettings } from '../utils/pushSettings';

/**
 * 推送设置（D80）的运行时状态。
 *
 * 与其它 Store 一样只放**纯数据**：读写在 `hooks/usePushPersistence.ts`，
 * 磁盘格式在 `utils/pushSettings.ts`（纯函数）。
 *
 * `persistedSnapshot` 用来避免「启动加载 → 立刻回写同一份内容」这种无意义写盘
 * （与 `useSettingsStore` 同一套做法）。
 */
export interface PushState extends PushSettings {
  loaded: boolean;
  loading: boolean;
  loadError: string | null;
  /** 上一次成功落盘的内容（JSON 快照） */
  persistedSnapshot: string;

  load: () => Promise<void>;
  setEnabled: (enabled: boolean) => void;
  setPort: (port: number) => void;
  markPersisted: (snapshot: string) => void;
}

export const usePushStore = create<PushState>((set, get) => ({
  enabled: true,
  port: PUSH_DEFAULT_PORT,
  loaded: false,
  loading: false,
  loadError: null,
  persistedSnapshot: '',

  load: async () => {
    if (get().loaded || get().loading) return;
    set({ loading: true });
    try {
      const raw = await loadPushSettingsFromDisk();
      const settings = normalizePushSettings(raw);
      set({
        ...settings,
        loaded: true,
        loading: false,
        loadError: null,
        persistedSnapshot: JSON.stringify(settings),
      });
    } catch (error) {
      // 读不出来就用默认值继续跑：推送设置丢了不致命，绝不能因此打不开应用
      set({
        loaded: true,
        loading: false,
        loadError: `推送设置读取失败：${errorMessage(error)}`,
      });
    }
  },

  setEnabled: (enabled) => set({ enabled }),

  setPort: (port) => set({ port: clampPort(port) }),

  markPersisted: (snapshot) => set({ persistedSnapshot: snapshot }),
}));
