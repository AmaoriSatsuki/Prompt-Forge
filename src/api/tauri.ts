/**
 * 前端与 Rust 命令之间唯一的通道。
 *
 * 约定：
 * - 所有 invoke 都必须经过 callCommand，禁止在组件或 Store 里直接 invoke
 * - Rust 侧的错误统一是 { code, message, detail }，这里还原成 IpcError
 * - message 已是中文用户文案；detail 只用于排查
 */

export interface AppErrorPayload {
  code: string;
  message: string;
  detail?: string;
}

export class IpcError extends Error {
  readonly code: string;
  readonly detail?: string;

  constructor(code: string, message: string, detail?: string) {
    super(message);
    this.name = 'IpcError';
    this.code = code;
    this.detail = detail;
  }
}

/** 是否运行在 Tauri 容器内。浏览器里直接 `npm run dev` 时为 false。 */
export function isDesktopRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** 把任意异常转成可直接展示给用户的中文文案 */
export function errorMessage(error: unknown): string {
  if (error instanceof IpcError) return error.message;
  if (error instanceof Error) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return '未知错误';
}

function toIpcError(raw: unknown): IpcError {
  if (raw && typeof raw === 'object' && 'code' in raw && 'message' in raw) {
    const payload = raw as AppErrorPayload;
    return new IpcError(String(payload.code), String(payload.message), payload.detail);
  }
  if (raw instanceof Error) return new IpcError('UNKNOWN', raw.message);
  return new IpcError('UNKNOWN', typeof raw === 'string' ? raw : '未知错误');
}

type InvokeModule = typeof import('@tauri-apps/api/core');
let invokeModule: Promise<InvokeModule> | null = null;

/** 动态加载 Tauri API：非桌面环境（浏览器预览）下永远不会执行到这里 */
function loadInvoke(): Promise<InvokeModule> {
  invokeModule ??= import('@tauri-apps/api/core');
  return invokeModule;
}

export async function callCommand<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isDesktopRuntime()) {
    throw new IpcError('NOT_DESKTOP', '当前不在桌面应用内运行，本地数据不可用');
  }
  const { invoke } = await loadInvoke();
  try {
    return await invoke<T>(command, args);
  } catch (raw) {
    throw toIpcError(raw);
  }
}
