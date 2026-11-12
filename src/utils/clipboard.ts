/**
 * 剪贴板写入。
 * WebView2 下优先使用 navigator.clipboard；若因权限或非聚焦状态失败，
 * 回退到隐藏 textarea + execCommand。M4 会再加一条 Rust 侧命令作为最终兜底。
 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 继续走回退方案
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  try {
    const holder = document.createElement('textarea');
    holder.value = text;
    holder.setAttribute('readonly', '');
    holder.style.position = 'fixed';
    holder.style.top = '0';
    holder.style.left = '0';
    holder.style.width = '1px';
    holder.style.height = '1px';
    holder.style.opacity = '0';
    document.body.appendChild(holder);
    holder.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(holder);
    return ok;
  } catch {
    return false;
  }
}
