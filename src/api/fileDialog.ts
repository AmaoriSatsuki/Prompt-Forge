import { isDesktopRuntime } from './tauri';

/**
 * 原生「选择文件」对话框（tauri-plugin-dialog）。
 *
 * 为什么用原生对话框而不是 HTML 的 `<input type="file">`：
 * 后者拿到的是 File 对象，要读内容只能把字节数组塞进 JSON IPC ——
 * 几十 MB 的词典会直接把前端卡住；原生对话框给的是**真实路径**，
 * 由 Rust 直接读文件，解析也放在后端的阻塞线程池里。
 *
 * 非桌面运行（浏览器里 `npm run dev`）时返回 null：词典功能只在应用内可用，
 * 调用方据此静默忽略即可，不该弹错误。
 */
export async function pickDictionaryFile(): Promise<string | null> {
  if (!isDesktopRuntime()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open({
    title: '选择要导入的词典文件',
    multiple: false,
    directory: false,
    filters: [
      {
        name: '词典文件',
        extensions: ['csv', 'json', 'db', 'sqlite', 'sqlite3', 'tsv', 'txt'],
      },
    ],
  });
  if (typeof picked === 'string' && picked.trim()) return picked;
  return null;
}

/* ---------- 全库导入导出（D115） ---------- */

/** 本地时间戳：`20261105-2210`，只用于默认文件名 */
function stamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

/** 挑一个库文件来导入；同样只回真实路径，内容交给 Rust 读 */
export async function pickLibraryBundleFile(): Promise<string | null> {
  if (!isDesktopRuntime()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open({
    title: '选择要导入的库文件',
    multiple: false,
    directory: false,
    filters: [{ name: '榫言库文件', extensions: ['json'] }],
  });
  if (typeof picked === 'string' && picked.trim()) return picked;
  return null;
}

/** 「另存为」导出位置；默认名带时间戳，避免连着导出两次互相覆盖 */
export async function pickLibraryBundleSavePath(): Promise<string | null> {
  if (!isDesktopRuntime()) return null;
  const { save } = await import('@tauri-apps/plugin-dialog');
  const path = await save({
    title: '导出库',
    defaultPath: `榫言全库-${stamp()}.json`,
    filters: [{ name: '榫言库文件', extensions: ['json'] }],
  });
  if (typeof path === 'string' && path.trim()) return path;
  return null;
}
