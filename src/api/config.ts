import type { AppConfig } from '../types/settings';
import { callCommand } from './tauri';

/** 读取多套服务商配置（缺失或损坏时 Rust 侧返回默认空配置） */
export function loadConfigFromDisk(): Promise<AppConfig> {
  return callCommand<AppConfig>('load_config');
}

/** 原子写回配置。注意：配置里没有密钥字段，密钥在系统凭据库。 */
export function saveConfigToDisk(config: AppConfig): Promise<void> {
  return callCommand<void>('save_config', { config });
}
