import type { ProviderProfile, TestReport, TranslateResult } from '../types/settings';
import { profileKind } from '../utils/profileSanitize';
import { toRustProfile } from '../utils/profileBridge';
import { callCommand } from './tauri';

/**
 * 翻译通道。
 *
 * 配置整份传入（而不是让 Rust 去读磁盘），因此不存在「配置还没落盘就发起翻译」的时序问题。
 * 注意传出去的是 `toRustProfile(profile)`，形状与 Rust 的 `ProviderProfile` 一一对应。
 *
 * **只剩一条通道**：百度通用文本翻译（GET + MD5 签名，凭据在系统凭据库或环境变量）。
 * 语言模型（OpenAI 兼容）与本地模型已在用户 2026 轮要求下整体剔除。
 */

/** V1 固定中文 → 英文 */
export const SOURCE_LANG = 'zh';
export const TARGET_LANG = 'en';

/** 百度通用文本翻译：GET + MD5 签名。凭据优先取该配置在凭据库里的，其次读环境变量。 */
export function baiduTranslate(
  text: string,
  profileId: string,
  from: string = SOURCE_LANG,
  to: string = TARGET_LANG,
): Promise<TranslateResult> {
  return callCommand<TranslateResult>('baidu_translate', { text, from, to, profileId });
}

/**
 * 统一的翻译下发点。
 *
 * 目前只有一条通道，因此这里不做协议分支；但**保留这个出口**：
 * 调用方（实时翻译调度层）不该知道「这家服务商怎么请求」，
 * 将来接腾讯翻译时只在这里加一个分支，调度层一个字都不用改。
 */
export function callTranslate(profile: ProviderProfile, text: string): Promise<TranslateResult> {
  if (profileKind(profile) !== 'baidu-translate') {
    return Promise.reject(
      new Error('这套配置选择的翻译服务尚未支持，请在设置里改成百度翻译'),
    );
  }
  return baiduTranslate(text, profile.id, SOURCE_LANG, TARGET_LANG);
}

export function testConnection(profile: ProviderProfile): Promise<TestReport> {
  return callCommand<TestReport>('test_connection', { profile: toRustProfile(profile) });
}
