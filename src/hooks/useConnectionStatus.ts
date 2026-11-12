import { useEffect } from 'react';
import { useSettingsStore } from '../store/useSettingsStore';

/**
 * 顶栏状态指示灯的接线层。
 *
 * 只做一件事：应用启动后，若**当前生效的配置**已填好凭据，就在后台跑一次连接测试。
 *
 * 三条刻意如此的设计：
 * 1. **不阻塞启动、不弹任何提示**：结论只反映到那颗圆点上。连接失败在这里是
 *    「正常结论」而不是错误（用户明确要求不弹错误提示）——真正需要用户处理时，
 *    翻译链路自己的常驻横幅会说清楚。
 * 2. **没配凭据直接显示白灯**：`autoTestOnStartup` 内部的 `shouldAutoTest` 会跳过，
 *    因此不会拿一个必然失败的请求去打扰服务商。
 * 3. **不等 `loaded`**：`loadConfig` 的顺序是「读盘 → 刷新凭据状态 → 自动测试」，
 *    本 Hook 挂在 `AppShell` 上时配置可能还没读完（那时 `keyStatus` 里没有凭据，
 *    `shouldAutoTest` 返回 false，自然不会提前发请求）；等配置与凭据状态都就绪后，
 *    依赖变化会让这个 effect 再跑一次，测试在此时才真正发生。
 */
export function useConnectionStatus(): void {
  const loaded = useSettingsStore((state) => state.loaded);
  const activeProfileId = useSettingsStore((state) => state.activeProfileId);
  const keyConfigured = useSettingsStore(
    (state) => state.keyStatus[state.activeProfileId] === true,
  );
  const status = useSettingsStore((state) => state.connectionStatus[state.activeProfileId]);
  const autoTestOnStartup = useSettingsStore((state) => state.autoTestOnStartup);

  useEffect(() => {
    if (!loaded) return;
    if (!keyConfigured) return;
    // 已经有绿灯就不再打接口（不轮询）；红灯则再试一次，修好配置后无需额外操作就能转绿
    if (status === 'ok') return;
    autoTestOnStartup();
  }, [loaded, activeProfileId, keyConfigured, status, autoTestOnStartup]);
}
