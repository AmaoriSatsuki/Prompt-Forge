use tauri::AppHandle;

use crate::commands::app_data_file;
use crate::error::AppError;
use crate::models::AppConfig;
use crate::storage;

const CONFIG_FILE: &str = "config.json";

/// 读取多套服务商配置。文件缺失或损坏时返回默认空配置，不阻断启动。
#[tauri::command]
pub fn load_config(app: AppHandle) -> Result<AppConfig, AppError> {
    let path = app_data_file(&app, CONFIG_FILE)?;
    Ok(storage::read_json::<AppConfig>(&path)?.unwrap_or_default())
}

#[tauri::command]
pub fn save_config(app: AppHandle, config: AppConfig) -> Result<(), AppError> {
    let path = app_data_file(&app, CONFIG_FILE)?;
    storage::write_json(&path, &config)
}
