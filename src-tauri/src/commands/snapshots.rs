use tauri::AppHandle;

use crate::commands::app_data_file;
use crate::error::AppError;
use crate::models::Snapshot;
use crate::storage;

/// 快照库（D67）：独立文件，与 presets.json / artists.json 平级。
const SNAPSHOTS_FILE: &str = "snapshots.json";

#[tauri::command]
pub fn load_snapshots(app: AppHandle) -> Result<Vec<Snapshot>, AppError> {
    let path = app_data_file(&app, SNAPSHOTS_FILE)?;
    Ok(storage::read_json::<Vec<Snapshot>>(&path)?.unwrap_or_default())
}

#[tauri::command]
pub fn save_snapshots(app: AppHandle, snapshots: Vec<Snapshot>) -> Result<(), AppError> {
    let path = app_data_file(&app, SNAPSHOTS_FILE)?;
    storage::write_json(&path, &snapshots)
}
