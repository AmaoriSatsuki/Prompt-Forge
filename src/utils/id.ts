let sequence = 0;

/**
 * 生成进程内唯一的短 id。
 * 不使用 crypto.randomUUID：WebView2 下可用但无需依赖；时间戳 + 自增 + 随机后缀足够避免碰撞。
 */
export function createId(prefix: string): string {
  sequence += 1;
  const time = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${time}${sequence.toString(36)}${random}`;
}
