use tauri::AppHandle;

use crate::commands::app_data_file;
use crate::dictionaries;
use crate::error::AppError;
use crate::models::{LibraryFile, Preset, PresetFolder};
use crate::storage;

const PRESETS_FILE: &str = "presets.json";
/// 分组元数据（D111）：单独一个小文件，删掉它 = 无损降级（组名仍从成员派生）
const PRESET_FOLDERS_FILE: &str = "preset-folders.json";

#[tauri::command]
pub fn load_presets(app: AppHandle) -> Result<Vec<Preset>, AppError> {
    let path = app_data_file(&app, PRESETS_FILE)?;
    storage::read_presets(&path)
}

#[tauri::command]
pub fn save_presets(app: AppHandle, presets: Vec<Preset>) -> Result<(), AppError> {
    let path = app_data_file(&app, PRESETS_FILE)?;
    storage::write_presets(&path, &presets)
}

/// 读取预设分组元数据（D111）：文件缺失或损坏都返回空数组，界面照常工作。
#[tauri::command]
pub fn load_preset_folders(app: AppHandle) -> Result<Vec<PresetFolder>, AppError> {
    let path = app_data_file(&app, PRESET_FOLDERS_FILE)?;
    storage::read_preset_folders(&path)
}

/// 写回预设分组元数据（D111）：组名 + 可见色白名单 + 展开状态。
#[tauri::command]
pub fn save_preset_folders(app: AppHandle, folders: Vec<PresetFolder>) -> Result<(), AppError> {
    let path = app_data_file(&app, PRESET_FOLDERS_FILE)?;
    storage::write_preset_folders(&path, &folders)
}

/*
 * 画师库 / Tag 库（D62 / D86 / D87）：两者数据形状一致，且现在都是**多文件**——
 * 数据根目录一份（手工新增 / 历史遗留）+ 每部词典文件夹一份（导入时派生）。
 *
 * 因此命令收成一个通用的「按库类型读写」，`kind` 取 `artists` / `tags`：
 * - `load_library`：读出所有文件，前端合并后按权重降序分页渲染；
 * - `save_library`：只写回**一个**文件（前端按文件分组写，改一条不重写全量）。
 */

/// 读取一个库的全部文件（D87）
#[tauri::command]
pub fn load_library(app: AppHandle, kind: String) -> Result<Vec<LibraryFile>, AppError> {
    dictionaries::load_library(&app, &kind)
}

/// 写回一个库文件（D87）：`file` 是相对应用数据目录的路径，会做严格校验
#[tauri::command]
pub fn save_library(
    app: AppHandle,
    kind: String,
    file: String,
    items: Vec<Preset>,
) -> Result<(), AppError> {
    dictionaries::save_library(&app, &kind, &file, items)
}
