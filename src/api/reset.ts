import { callCommand } from './tauri';

/**
 * 初始化（D117）的三个破坏性动作里，需要动磁盘的那两个。
 *
 * 「界面初始化」不在这里：它只改本地存储与 Store（见 `ResetSettingsPanel`），
 * 不碰应用数据目录里的任何文件。
 */

/** 清空五个库（预设 / 画师 / Tag / 词典 / 快照），设置与缓存不动 */
export function resetLibraries(): Promise<void> {
  return callCommand<void>('reset_libraries');
}

/** 清空翻译服务配置，并删除系统凭据库里的密钥（不可恢复） */
export function resetProviderConfig(): Promise<void> {
  return callCommand<void>('reset_provider_config');
}
