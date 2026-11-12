import type { ConnectionStatus, ProviderProfile } from '../types/settings';

/**
 * 「可以判断这套配置能不能用吗」——能判断的前提是有配置、且凭据已填。
 *
 * 本版只剩专业翻译接口这一种形态：每家翻译服务都要一对凭据（APP ID + 密钥），
 * 因此不再有「本地模型没有凭据形态、恒为白灯」那种分支。
 */
function isJudgeable(profile: ProviderProfile | undefined, keyConfigured: boolean): boolean {
  if (!profile) return false;
  return keyConfigured;
}

/**
 * 顶栏翻译服务状态指示灯的**判据**（纯函数，可离线断言）。
 *
 * 三种状态的口径（用户 2026 轮指定）：
 * ```
 * 白 #ffffff  未配置   —— 凭据库里没有这套配置的凭据（也包含「还没测过」）
 * 绿 #2ecc71  连接正常 —— 已配置，且最近一次连接测试 / 翻译请求成功
 * 红 #e74c3c  连接异常 —— 已配置，但最近一次连接测试 / 翻译请求失败
 * ```
 *
 * **判据只有一处**：组件不自己拼状态、store 也不自己判，全部走这里。
 * 这样「白灯是什么意思」不会在几个文件里各写一遍而慢慢跑偏。
 *
 * 一条刻意如此的口径：**白灯压过一切**。凭据被清掉时，即使上一次测试是成功的，
 * 也必须回到白灯 —— 「配好了没」是关于**当下**的事实，比历史结论更优先。
 *
 * 注意：「还没测过」与「未配置」在这里**显示上是同一种白灯**，但动作完全相反 ——
 * 前者要自动测一次，后者绝不能测。这个区别在 `shouldAutoTest` 里单独判，
 * 不要试图用本函数的返回值去推导「要不要测」。
 */
export function connectionStatusOf(
  profile: ProviderProfile | undefined,
  keyConfigured: boolean,
  reported: ConnectionStatus | undefined,
): ConnectionStatus {
  if (!isJudgeable(profile, keyConfigured)) return 'unconfigured';
  return reported ?? 'unconfigured';
}

/**
 * 启动时是否需要为这套配置自动跑一次连接测试。
 *
 * 把「要不要发请求」与「灯画成什么颜色」分开判，是因为两者不是同一件事：
 * 1. **没配凭据就不测**：直接显示白灯，否则每次启动都会拿一个必然失败的请求去打扰服务商；
 * 2. **还没结论就测**：一次都没测过时必须测，否则指示灯永远停在白灯；
 * 3. **已经有成功记录就不再重测**：同一次运行内不重复打接口（用户明确要求不轮询），
 *    只在「上次失败」时才再试 —— 用户修好配置后不需要额外操作就能看到转绿。
 */
export function shouldAutoTest(
  profile: ProviderProfile | undefined,
  keyConfigured: boolean,
  reported: ConnectionStatus | undefined,
): boolean {
  if (!isJudgeable(profile, keyConfigured)) return false;
  return reported !== 'ok';
}

/** 灯的中文说明（悬浮提示）；界面文案零英文 */
export const CONNECTION_STATUS_TITLE: Record<ConnectionStatus, string> = {
  unconfigured: '未配置',
  ok: '连接正常',
  error: '连接异常',
};

/** 指示灯类名后缀：CSS 只按这三个状态取色 */
export const CONNECTION_STATUS_CLASS: Record<ConnectionStatus, string> = {
  unconfigured: 'idle',
  ok: 'ok',
  error: 'error',
};
