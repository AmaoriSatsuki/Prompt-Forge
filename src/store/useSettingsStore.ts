import { create } from 'zustand';
import { loadConfigFromDisk } from '../api/config';
import {
  deleteBaiduCredentials,
  hasBaiduCredentials,
  saveBaiduCredentials,
} from '../api/secrets';
import { errorMessage } from '../api/tauri';
import { testConnection as testConnectionApi } from '../api/translate';
import type { AppConfig, ConnectionStatus, ProviderProfile, TestReport } from '../types/settings';
import { shouldAutoTest } from '../utils/connectionStatus';
import { createId } from '../utils/id';
import { createProfile, sanitizeProfiles } from '../utils/profileSanitize';

/**
 * 查询某套配置的凭据是否已填。
 *
 * 本版只剩专业翻译接口：每家翻译服务都用「一对凭据」（百度是 APP ID + 密钥）。
 * 目前只有百度实现了凭据通道，未实现的服务（腾讯）一律按「未配置」处理 ——
 * 它本来也点不开，界面不会给人「填了就能用」的错觉。
 */
async function probeCredentials(profile: ProviderProfile | undefined): Promise<boolean> {
  if (!profile) return false;
  if (profile.brand !== 'baidu') return false;
  return hasBaiduCredentials(profile.id);
}

/** 更新配置时的补丁：只有名字与翻译服务两项 */
export type ProfilePatch = Partial<Pick<ProviderProfile, 'label' | 'brand'>>;

/** 只保留仍然存在的配置的指示灯结论（整体替换配置时用） */
function pruneStatusTo(
  status: Record<string, ConnectionStatus>,
  profiles: readonly ProviderProfile[],
): Record<string, ConnectionStatus> {
  const kept: Record<string, ConnectionStatus> = {};
  for (const profile of profiles) {
    if (status[profile.id] !== undefined) kept[profile.id] = status[profile.id];
  }
  return kept;
}

/**
 * 凭据刚保存成功之后：如果这套配置正是当前生效的，顺手在后台测一次。
 *
 * 用户确认过这个时机（问题 1 选「要」）：否则刚填完密钥指示灯还是白的，
 * 得再点一次「测试连接」才变色，体感像没生效。
 */
function autoTestAfterConfigure(
  get: () => SettingsState,
  id: string,
): void {
  const { activeProfileId, keyStatus, connectionStatus, testConnection } = get();
  if (activeProfileId !== id) return;
  if (connectionStatus[id] === 'ok') return;
  if (keyStatus[id] !== true) return;
  void testConnection(id);
}

export interface SettingsState {
  profiles: ProviderProfile[];
  activeProfileId: string;
  loaded: boolean;
  loadError: string | null;
  /** 最近一次与磁盘一致的内容快照，避免启动加载后立刻回写 */
  persistedSnapshot: string;
  /** 每套配置的凭据是否已写入系统凭据库（只存布尔，不存密钥） */
  keyStatus: Record<string, boolean>;
  /** 正在测连接的配置 id */
  testingProfileId: string | null;
  /** 每套配置最近一次连接测试的结论 */
  testReports: Record<string, TestReport>;
  /**
   * 顶栏状态指示灯的**最近结论**（按配置 id 存）。
   *
   * 为什么按 id 存而不是只存一个字符串：多套配置各有各的结论，
   * 只存一个的话，切到另一套时会把上一套的绿灯带过去 —— 那是错的。
   * 顶栏显示的始终是「当前生效那套」的值（`connectionStatusOf` 判定）。
   *
   * 为什么与 `testReports` 分开存：`testReports` 是设置面板里的**文案 + 耗时**，
   * 只在用户点「测试连接」时产生；而这里还要承载「翻译请求失败」这个更弱的信号
   * （它没有可展示的结论文案）。两者语义不同，硬凑在一起会让设置面板显示假结论。
   */
  connectionStatus: Record<string, ConnectionStatus>;

  loadConfig: () => Promise<void>;
  addProfile: () => ProviderProfile;
  duplicateProfile: (id: string) => ProviderProfile | null;
  updateProfile: (id: string, patch: ProfilePatch) => void;
  removeProfile: (id: string) => boolean;
  setActiveProfile: (id: string) => void;
  /** 用给定的配置集合整体替换（导入配置 / 断言用） */
  replaceAll: (profiles: ProviderProfile[], activeProfileId?: string) => void;
  /**
   * 清空全部配置（D117 服务商初始化）。
   *
   * 与 `replaceAll([])` 的区别：那个对空数组直接 return（防误清空），
   * 而这里是一次**明确的**清空动作，连指示灯结论与凭据探测状态一起复位；
   * 磁盘上的 `config.json` 由 Rust `reset_provider_config` 先写成空的了。
   */
  clearProfiles: () => void;
  refreshKeyStatus: (id: string) => Promise<void>;
  refreshAllKeyStatus: () => Promise<void>;
  /** 百度翻译的凭据是一对值，单独一组动作 */
  setBaiduCredentials: (id: string, appId: string, appKey: string) => Promise<void>;
  clearBaiduCredentials: (id: string) => Promise<void>;
  testConnection: (id: string) => Promise<void>;
  /**
   * 上报一次「这台服务能不能用」的结论，只更新顶栏指示灯。
   *
   * 两个调用方：连接测试（用户点按钮 / 启动与切换时的自动测试）
   * 与真实翻译请求 —— 后者是「缓存未命中、真的发了请求」才报（见 useRealtimeTranslate）。
   */
  reportConnection: (id: string, ok: boolean) => void;
  /** 启动时在后台跑一次自动测试（没配凭据就直接跳过，不弹任何提示） */
  autoTestOnStartup: () => void;
  markPersisted: (snapshot: string) => void;
}

/** 首启就给一套配置（命名已填，凭据由用户自己填） */
const INITIAL_PROFILE = createProfile();

export const useSettingsStore = create<SettingsState>((set, get) => ({
  profiles: [INITIAL_PROFILE],
  activeProfileId: INITIAL_PROFILE.id,
  loaded: false,
  loadError: null,
  persistedSnapshot: '',
  keyStatus: {},
  testingProfileId: null,
  testReports: {},
  connectionStatus: {},

  loadConfig: async () => {
    if (get().loaded) return;
    try {
      const config = await loadConfigFromDisk();
      // 磁盘内容可能被手工改过或来自旧版本，统一规范化后再进内存
      const profiles = sanitizeProfiles(config?.profiles);
      if (profiles.length > 0) {
        const activeProfileId = profiles.some((profile) => profile.id === config.activeProfileId)
          ? config.activeProfileId
          : profiles[0].id;
        set({
          profiles,
          activeProfileId,
          loaded: true,
          loadError: null,
          persistedSnapshot: JSON.stringify({ profiles, activeProfileId } satisfies AppConfig),
        });
      } else {
        // 首次启动：保留内置默认配置，persistedSnapshot 留空以便首次改动时落盘
        set({ loaded: true, loadError: null });
      }
      await get().refreshAllKeyStatus();
      // 凭据就绪之后再判「要不要启动自测」——顺序反了会把已配置的配置误判成未配置
      get().autoTestOnStartup();
    } catch (error) {
      set({ loaded: true, loadError: `配置读取失败：${errorMessage(error)}` });
    }
  },

  addProfile: () => {
    const created = createProfile({ label: '新配置' });
    set((state) => ({ profiles: [...state.profiles, created] }));
    return created;
  },

  duplicateProfile: (id) => {
    const source = get().profiles.find((profile) => profile.id === id);
    if (!source) return null;
    const copy: ProviderProfile = { ...source, id: createId('profile'), label: `${source.label} 副本` };
    set((state) => ({ profiles: [...state.profiles, copy] }));
    return copy;
  },

  updateProfile: (id, patch) => {
    set((state) => {
      let changed = false;
      const profiles = state.profiles.map((profile) => {
        if (profile.id !== id) return profile;
        const next: ProviderProfile = {
          ...profile,
          ...(patch.label !== undefined ? { label: patch.label } : {}),
          ...(patch.brand !== undefined ? { brand: patch.brand } : {}),
        };
        const same = next.label === profile.label && next.brand === profile.brand;
        if (same) return profile;
        changed = true;
        return next;
      });
      return changed ? { profiles } : {};
    });
  },

  removeProfile: (id) => {
    const { profiles } = get();
    // 至少保留一套，否则用户会陷入「没有配置可选」的界面
    if (profiles.length <= 1) return false;
    const rest = profiles.filter((profile) => profile.id !== id);
    const activeProfileId =
      get().activeProfileId === id ? rest[0].id : get().activeProfileId;
    set((state) => {
      const keyStatus = { ...state.keyStatus };
      delete keyStatus[id];
      const testReports = { ...state.testReports };
      delete testReports[id];
      const connectionStatus = { ...state.connectionStatus };
      delete connectionStatus[id];
      return { profiles: rest, activeProfileId, keyStatus, testReports, connectionStatus };
    });
    // 顺手清掉系统凭据库里的条目，避免留下孤儿密钥
    void deleteBaiduCredentials(id).catch(() => undefined);
    return true;
  },

  setActiveProfile: (id) => {
    if (!get().profiles.some((profile) => profile.id === id)) return;
    set({ activeProfileId: id });
    /*
     * 切换翻译服务配置 → 重新判断并自动测试（用户要求 2）。
     *
     * 后台跑，不阻塞切换动作；`shouldAutoTest` 保证「没凭据不测」与
     * 「已经有绿灯就不再打接口」，因此反复来回切换不会连环发请求。
     */
    const { profiles, keyStatus, connectionStatus, testConnection } = get();
    const profile = profiles.find((item) => item.id === id);
    if (shouldAutoTest(profile, keyStatus[id] === true, connectionStatus[id])) {
      void testConnection(id);
    }
  },

  replaceAll: (profiles, activeProfileId) => {
    const sanitized = sanitizeProfiles(profiles);
    if (sanitized.length === 0) return;
    // 整体替换后，已经不存在的配置不该在指示灯表里留下孤儿结论
    set((state) => ({
      profiles: sanitized,
      activeProfileId:
        activeProfileId && sanitized.some((profile) => profile.id === activeProfileId)
          ? activeProfileId
          : sanitized[0].id,
      connectionStatus: pruneStatusTo(state.connectionStatus, sanitized),
    }));
  },

  clearProfiles: () =>
    set({
      profiles: [],
      activeProfileId: '',
      connectionStatus: {},
      keyStatus: {},
      testReports: {},
      testingProfileId: null,
    }),

  refreshKeyStatus: async (id) => {
    const profile = get().profiles.find((item) => item.id === id);
    try {
      const configured = await probeCredentials(profile);
      set((state) => ({ keyStatus: { ...state.keyStatus, [id]: configured } }));
    } catch {
      // 非桌面环境（浏览器预览）下拿不到凭据库，按「未配置」处理，不报错
      set((state) => ({ keyStatus: { ...state.keyStatus, [id]: false } }));
    }
  },

  refreshAllKeyStatus: async () => {
    const { profiles, refreshKeyStatus } = get();
    await Promise.all(profiles.map((profile) => refreshKeyStatus(profile.id)));
  },

  setBaiduCredentials: async (id, appId, appKey) => {
    await saveBaiduCredentials(id, appId, appKey);
    set((state) => ({ keyStatus: { ...state.keyStatus, [id]: true } }));
    autoTestAfterConfigure(get, id);
  },

  clearBaiduCredentials: async (id) => {
    // 凭据库的操作成败**不能挡住内存状态的回退**：删除失败时若还认为「已配置」，
    // 界面会继续显示绿灯并继续发请求，而凭据其实已经不在了（实测踩到过）。
    await deleteBaiduCredentials(id).catch(() => undefined);
    set((state) => {
      const testReports = { ...state.testReports };
      delete testReports[id];
      // 凭据没了 → 指示灯回到白灯（历史结论一并丢掉，否则会显示一个假的红/绿灯）
      const connectionStatus = { ...state.connectionStatus };
      delete connectionStatus[id];
      return { keyStatus: { ...state.keyStatus, [id]: false }, testReports, connectionStatus };
    });
  },

  testConnection: async (id) => {
    const profile = get().profiles.find((item) => item.id === id);
    if (!profile) return;
    set({ testingProfileId: id });
    try {
      const report = await testConnectionApi(profile);
      set((state) => ({
        testingProfileId: null,
        testReports: { ...state.testReports, [id]: report },
        // 顶栏指示灯与设置面板的结论同源同一次测试（用户要求 3）
        connectionStatus: { ...state.connectionStatus, [id]: report.ok ? 'ok' : 'error' },
      }));
    } catch (error) {
      set((state) => ({
        testingProfileId: null,
        testReports: {
          ...state.testReports,
          [id]: { ok: false, elapsedMs: 0, message: errorMessage(error) },
        },
        connectionStatus: { ...state.connectionStatus, [id]: 'error' },
      }));
    }
  },

  reportConnection: (id, ok) => {
    set((state) => ({
      connectionStatus: { ...state.connectionStatus, [id]: ok ? 'ok' : 'error' },
    }));
  },

  autoTestOnStartup: () => {
    const { profiles, activeProfileId, keyStatus, connectionStatus, testConnection } = get();
    // 只测「当前生效的一套」：其它配置等切到它时再判，避免启动时连环打接口
    const profile =
      profiles.find((item) => item.id === activeProfileId) ?? profiles[0];
    if (!profile) return;
    if (!shouldAutoTest(profile, keyStatus[profile.id] === true, connectionStatus[profile.id])) {
      return;
    }
    void testConnection(profile.id);
  },

  markPersisted: (snapshot) => set({ persistedSnapshot: snapshot }),
}));

/** 取出当前生效的配置（供翻译链路使用） */
export function currentProfile(state: SettingsState): ProviderProfile | undefined {
  return state.profiles.find((profile) => profile.id === state.activeProfileId) ?? state.profiles[0];
}
