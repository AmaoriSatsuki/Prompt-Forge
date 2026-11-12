use tauri::AppHandle;

use crate::commands::app_data_file;
use crate::error::AppError;
use crate::storage;

const CACHE_FILE: &str = "cache.json";

/// 读取翻译缓存。文件缺失或损坏时返回空列表（损坏文件会被改名留档），不阻断启动。
#[tauri::command]
pub fn load_cache(app: AppHandle) -> Result<Vec<serde_json::Value>, AppError> {
    let path = app_data_file(&app, CACHE_FILE)?;
    Ok(storage::read_json::<Vec<serde_json::Value>>(&path)?.unwrap_or_default())
}

/// 原子写回翻译缓存（临时文件 → 改名），与预设库、配置同一套落盘方式。
#[tauri::command]
pub fn save_cache(app: AppHandle, entries: Vec<serde_json::Value>) -> Result<(), AppError> {
    let path = app_data_file(&app, CACHE_FILE)?;
    storage::write_json(&path, &entries)
}

/// 清空翻译缓存文件。文件不存在也算成功（幂等）。
#[tauri::command]
pub fn clear_cache(app: AppHandle) -> Result<(), AppError> {
    let path = app_data_file(&app, CACHE_FILE)?;
    if path.exists() {
        std::fs::remove_file(&path).map_err(|error| {
            AppError::new("IO", "无法删除缓存文件").with_detail(error.to_string())
        })?;
    }
    Ok(())
}
