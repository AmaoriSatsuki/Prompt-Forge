use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::error::AppError;

pub mod bundle;
pub mod cache;
pub mod config;
pub mod dictionaries;
pub mod presets;
pub mod push;
pub mod reset;
pub mod snapshots;
pub mod system;
pub mod translate;

/// 解析应用数据目录下的某个文件路径，例如
/// `%APPDATA%\com.promptforge.app\presets.json`
pub fn app_data_file(app: &AppHandle, file_name: &str) -> Result<PathBuf, AppError> {
    let dir = app.path().app_data_dir().map_err(|error| {
        AppError::new("IO", "无法定位应用数据目录").with_detail(error.to_string())
    })?;
    Ok(dir.join(file_name))
}
