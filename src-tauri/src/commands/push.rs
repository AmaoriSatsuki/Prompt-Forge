use std::collections::BTreeMap;

use serde::Serialize;
use tauri::AppHandle;

use crate::commands::app_data_file;
use crate::error::AppError;
use crate::models::PushSettings;
use crate::push_server;
use crate::storage;

/// 推送设置（D80）：独立文件，与 presets.json / config.json / snapshots.json 平级。
/// 启动时 `push_server` 也要读它，因此是 crate 内可见。
pub const PUSH_SETTINGS_FILE: &str = "push-settings.json";

/// 读取推送设置。文件缺失或损坏时返回默认值（开启、端口 8713），不阻断启动。
#[tauri::command]
pub fn load_push_settings(app: AppHandle) -> Result<PushSettings, AppError> {
    let path = app_data_file(&app, PUSH_SETTINGS_FILE)?;
    let settings = storage::read_json::<PushSettings>(&path)?.unwrap_or_default();
    Ok(settings.normalized())
}

/// 保存推送设置。写盘前先规范化（端口夹进 1024–65535）。
///
/// D81 起顺带**同步运行中的服务**：关掉开关就断开监听与现有客户端，
/// 改端口就换一个端口重绑 —— 都发生在设置真正落盘之后，避免「界面上改了但服务没动」。
#[tauri::command]
pub fn save_push_settings(app: AppHandle, settings: PushSettings) -> Result<(), AppError> {
    let settings = settings.normalized();
    let path = app_data_file(&app, PUSH_SETTINGS_FILE)?;
    let written = storage::write_json(&path, &settings);
    if written.is_ok() {
        push_server::apply(&app, &settings);
    }
    written
}

/// 一次推流的结果，前端拿它打排查日志（推给了几个客户端、推了多长）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushBroadcastReport {
    /// 收到这次推流的客户端数量（0 = 此刻没有 ComfyUI 连上来，不算失败）
    pub clients: usize,
    /// 这次推出去的 `global` 字符数
    pub chars: usize,
}

/// 推流一次（D81 / D90）。
///
/// 前端交两样东西：
/// - `global`：整段拼接好的文本（与「全文复制」同源）；
/// - `modules`：**按行位置**切开的每一排文本（键 `"1"`..`"9"`，空排是空串），
///   供 ComfyUI 节点选「模块 N」只吃那一块，从而让多个 CLIP 物理隔离。
///
/// 帧的包装（`{"type":"translation_update","global":…,"modules":…}`）在 Rust 侧做，
/// 因此 JSON 转义只有一个出口。
/// 这个命令**不会失败**：没有客户端、服务没起来都不是错误，
/// 推流失败绝不能变成界面上的报错弹窗。
#[tauri::command]
pub fn broadcast_translation(
    app: AppHandle,
    global: String,
    modules: BTreeMap<String, String>,
) -> PushBroadcastReport {
    let (clients, chars) = push_server::push(&app, &global, &modules);
    PushBroadcastReport { clients, chars }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{PUSH_PORT_DEFAULT, PUSH_PORT_MAX, PUSH_PORT_MIN};

    #[test]
    fn default_is_enabled_with_8713() {
        let settings = PushSettings::default();
        assert!(settings.enabled);
        assert_eq!(settings.port, PUSH_PORT_DEFAULT);
        assert_eq!(PUSH_PORT_DEFAULT, 8713);
        assert_eq!(PUSH_PORT_MIN, 1024);
        assert_eq!(PUSH_PORT_MAX, 65535);
    }

    #[test]
    fn missing_fields_fall_back_to_defaults() {
        let parsed: PushSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(parsed, PushSettings::default());
        // 只有开关、没有端口：端口用默认值，而不是 0
        let only_enabled: PushSettings = serde_json::from_str(r#"{"enabled":false}"#).unwrap();
        assert!(!only_enabled.enabled);
        assert_eq!(only_enabled.port, PUSH_PORT_DEFAULT);
    }

    #[test]
    fn port_is_clamped_to_range() {
        // 前端输入框 limits 只能拦住键盘，真正兜底在写盘前
        assert_eq!(PushSettings { enabled: true, port: 80 }.normalized().port, PUSH_PORT_MIN);
        assert_eq!(
            PushSettings { enabled: true, port: 70000 }.normalized().port,
            PUSH_PORT_MAX
        );
        assert_eq!(PushSettings { enabled: true, port: 0 }.normalized().port, PUSH_PORT_MIN);
        assert_eq!(PushSettings { enabled: true, port: 9000 }.normalized().port, 9000);
    }

    #[test]
    fn clamp_keeps_enabled_flag() {
        assert!(!PushSettings { enabled: false, port: 80 }.normalized().enabled);
    }
}
