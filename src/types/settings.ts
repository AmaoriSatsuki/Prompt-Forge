/**
 * 翻译服务配置与翻译结果的形状。
 *
 * > 本版只有一种接入形态：**专业翻译接口**，界面上统一叫「翻译服务」。
 * > 语言模型（OpenAI 兼容）与本地模型两条接入方式已在用户 2026 轮要求下整体剔除，
 * > 因此这里不再有「类别（category）」、`llm` 字段块与「语言模型服务商（templateId）」。
 */

/**
 * 一套翻译服务配置。
 *
 * 三条已确认的设计：
 * 1. **只有翻译服务与命名**：一套配置 = 一个名字 + 一家翻译服务；
 * 2. **没有 `kind` 字段**：运行时通道由品牌推导（见 `protocolOf`），派生的东西不落盘就不会漂移；
 * 3. **字段里没有密钥**：凭据存在系统凭据库，条目由 `id` 推出，
 *    因此配置文件即使被看到也没有明文。
 */
export interface ProviderProfile {
  id: string;
  /** 配置命名（界面显示它，例如「百度主力」） */
  label: string;
  /** 翻译服务 id：baidu（可用）/ tencent（占位） */
  brand: string;
}

export interface AppConfig {
  profiles: ProviderProfile[];
  activeProfileId: string;
}

/** 连接测试 / 翻译统一返回的用量信息 */
export interface TranslateUsage {
  model: string;
  elapsedMs: number;
}

export interface TranslateResult extends TranslateUsage {
  /** 只有中文部分翻译出来的英文（胶囊英文在复制层才拼上） */
  text: string;
}

export interface TestReport {
  ok: boolean;
  elapsedMs: number;
  /** 中文提示，直接可展示 */
  message: string;
}

/**
 * 顶栏翻译服务状态指示灯的三种状态。
 *
 * - `unconfigured`：当前配置缺少必要凭据（白灯），**不发起任何测试**；
 * - `ok`：已配置，且最近一次连接测试或翻译请求成功（绿灯）；
 * - `error`：已配置，但最近一次连接测试或翻译请求失败（红灯）。
 *
 * 这是**运行时状态**，不落盘（架构 §3.5：派生值不落盘）。
 */
export type ConnectionStatus = 'unconfigured' | 'ok' | 'error';

/**
 * 界面主题（用户 2026 轮新增的日/月切换）。
 *
 * - `dark`：默认的深色主题（应用一直是这个观感）；
 * - `light`：亮色主题，顶栏按钮显示太阳。
 *
 * 主题是**界面偏好**，与翻译服务配置无关，因此不属于 `ProviderProfile`；
 * 它存在本地存储（`utils/theme.ts`），重启后恢复。
 */
export type ThemeMode = 'light' | 'dark';

/* ---------- 应用设置（D80） ---------- */

/**
 * 推送设置：与 ComfyUI 插件通信的开关与端口。
 *
 * 存在磁盘（`%APPDATA%\com.promptforge.app\push-settings.json`），
 * 由 Rust 的 `load_push_settings` / `save_push_settings` 读写；端口在两侧都会夹到 1024–65535。
 */
export interface PushSettings {
  /** 是否开启 WebSocket 推送（默认开启） */
  enabled: boolean;
  /** 通信端口（默认 8713） */
  port: number;
}

/**
 * 齿轮设置弹窗的左侧 Tab（D80；D86 新增「列表分页」；D115 新增「导入导出」）。
 *
 * - `push`：推送服务（开关 + 端口）
 * - `dictionary`：词典管理（导入 / 启停 / 排序 / 删除）
 * - `paging`：列表分页阈值（四个库统一，默认 100）
 * - `bundle`：全库导入导出（五个库勾选导出 + 叠加导入）
 * - `reset`：初始化（界面 / 库 / 服务商 API，D117）
 */
export type AppSettingsTab = 'push' | 'dictionary' | 'paging' | 'bundle' | 'reset';