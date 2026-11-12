import { callCommand } from './tauri';

/**
 * 翻译服务的凭据通道。
 *
 * 只有「写入 / 查询是否存在 / 删除」三个方向，**没有任何读取接口**：
 * 明文凭据永远不会回到前端，翻译时由 Rust 侧直接从系统凭据库取。
 * 条目名固定为 service = "prompt-forge"、user = `<配置 id>:baidu`。
 *
 * 百度翻译的凭据是「APP ID + 密钥」一对，因此这里三个通道各带两个值或只带 id。
 */
export function saveBaiduCredentials(
  profileId: string,
  appId: string,
  appKey: string,
): Promise<void> {
  return callCommand<void>('save_baidu_credentials', { profileId, appId, appKey });
}

export function hasBaiduCredentials(profileId: string): Promise<boolean> {
  return callCommand<boolean>('has_baidu_credentials', { profileId });
}

export function deleteBaiduCredentials(profileId: string): Promise<void> {
  return callCommand<void>('delete_baidu_credentials', { profileId });
}
