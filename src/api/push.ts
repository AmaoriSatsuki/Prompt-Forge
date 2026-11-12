import type { PushSettings } from '../types/settings';
import type { BroadcastPayload } from '../utils/moduleText';
import { callCommand } from './tauri';

/**
 * 推送设置（D80）的磁盘读写 + 实时推流（D81）。**唯一 invoke 出口**仍然是 `api/tauri.ts` 的 `callCommand`。
 *
 * 文件名 `push-settings.json`，与 presets/config/cache/snapshots 平级；端口在 Rust 侧写盘前还会再夹一次。
 */

/** 读取推送设置（文件缺失或损坏时返回默认值：开启、端口 8713） */
export function loadPushSettingsFromDisk(): Promise<PushSettings> {
  return callCommand<PushSettings>('load_push_settings');
}

/** 原子写回推送设置（Rust 侧同时把运行中的服务切到新设置） */
export function savePushSettingsToDisk(settings: PushSettings): Promise<void> {
  return callCommand<void>('save_push_settings', { settings });
}

/** 一次推流的结果：推给了几个客户端、推了多长（只用来打排查日志） */
export interface PushBroadcastReport {
  /** 收到这次推流的客户端数量；0 = 此刻没有 ComfyUI 连上来，不算失败 */
  clients: number;
  /** 这次推出去的文本字符数 */
  chars: number;
}

/**
 * 推流一次（D81 / D90）。
 *
 * 交的是 `utils/moduleText.ts` 的 `composeBroadcastPayload()` 结果：
 * `global`（整段拼接文本）+ `modules`（按行位置切开的 9 块）；
 * 包装成 `{"type":"translation_update","global":…,"modules":{…}}` 帧是 Rust 侧的事，
 * 这样 JSON 转义只有一个出口，前端永远不手拼 JSON。
 */
export function broadcastTranslation(payload: BroadcastPayload): Promise<PushBroadcastReport> {
  return callCommand<PushBroadcastReport>('broadcast_translation', {
    global: payload.global,
    modules: payload.modules,
  });
}
