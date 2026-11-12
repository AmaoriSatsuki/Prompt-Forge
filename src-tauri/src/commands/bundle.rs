use std::path::Path;

use tauri::AppHandle;

use crate::bundle::{self, merge::DuplicatePolicy};
use crate::error::AppError;
use crate::models::{BundleExportReport, BundleImportReport, BundleIncluded, BundleSummary};

/// 导出所选库到用户挑的位置（D115）。`path` 是原生「另存为」对话框给的真实路径。
#[tauri::command]
pub fn export_library_bundle(
    app: AppHandle,
    path: String,
    included: BundleIncluded,
) -> Result<BundleExportReport, AppError> {
    bundle::export(&app, Path::new(&path), included)
}

/// 导入前先看包里有什么（哪些库、各多少条）。只读，不改任何磁盘内容。
#[tauri::command]
pub fn inspect_library_bundle(path: String) -> Result<BundleSummary, AppError> {
    bundle::inspect(Path::new(&path))
}

/// 叠加导入（D115）：`policy` 取 `rename`（默认，补 `·N`）或 `overwrite`（同名以文件为准）。
#[tauri::command]
pub fn import_library_bundle(
    app: AppHandle,
    path: String,
    policy: String,
) -> Result<BundleImportReport, AppError> {
    bundle::import(&app, Path::new(&path), DuplicatePolicy::parse(&policy))
}
