use std::path::Path;

use tauri::AppHandle;

use crate::dictionaries;
use crate::error::AppError;
use crate::models::{
    DictionaryEntryGroup, DictionaryImportReport, DictionaryInspection, DictionaryList,
};

/// 把阻塞的文件解析放到线程池：几万条词典的读取不该卡住界面。
async fn run_blocking<T, F>(work: F) -> Result<T, AppError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, AppError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| AppError::new("IO", "词典操作失败").with_detail(error.to_string()))?
}

/// 检查一个外部词典文件：字段名、前 5 行样本、白名单识别结果。
#[tauri::command]
pub async fn inspect_dictionary_file(path: String) -> Result<DictionaryInspection, AppError> {
    run_blocking(move || dictionaries::inspect_file(&path)).await
}

/// 按字段下标把文件标准化成 `[{cn,en}]` 并落盘，返回条数与警告。
/// `displayName` 是导入前用户命名的显示名（空则用文件名）。
/// `minPostCount` 是画师热度阈值（D65）：作品数低于它的画师行会被跳过；0 = 不过滤。
#[tauri::command]
pub async fn import_dictionary_file(
    app: AppHandle,
    path: String,
    table: Option<String>,
    cn_index: usize,
    en_index: usize,
    display_name: Option<String>,
    min_post_count: Option<i64>,
) -> Result<DictionaryImportReport, AppError> {
    run_blocking(move || {
        dictionaries::import(
            &app,
            Path::new(&path),
            table.as_deref(),
            cn_index,
            en_index,
            display_name.as_deref(),
            min_post_count,
        )
    })
    .await
}

/// 词典列表（顺带剔除被手动删掉的文件、收录手工放进去的 json）。
#[tauri::command]
pub async fn list_dictionaries(app: AppHandle) -> Result<DictionaryList, AppError> {
    run_blocking(move || dictionaries::list(&app)).await
}

/// 所有**启用**词典的条目（前端建 Map 用，启动时读一次）。
#[tauri::command]
pub async fn read_dictionary_entries(app: AppHandle) -> Result<Vec<DictionaryEntryGroup>, AppError> {
    run_blocking(move || dictionaries::entries(&app)).await
}

#[tauri::command]
pub async fn set_dictionary_enabled(
    app: AppHandle,
    id: String,
    enabled: bool,
) -> Result<(), AppError> {
    run_blocking(move || dictionaries::set_enabled(&app, &id, enabled)).await
}

#[tauri::command]
pub async fn reorder_dictionaries(app: AppHandle, ids: Vec<String>) -> Result<(), AppError> {
    run_blocking(move || dictionaries::reorder(&app, ids)).await
}

#[tauri::command]
pub async fn delete_dictionary(
    app: AppHandle,
    id: String,
    delete_file: bool,
) -> Result<(), AppError> {
    run_blocking(move || dictionaries::delete(&app, &id, delete_file)).await
}

#[tauri::command]
pub async fn rescan_dictionaries(app: AppHandle) -> Result<DictionaryList, AppError> {
    run_blocking(move || dictionaries::rescan(&app)).await
}

/// 打开词典目录（%APPDATA%\com.promptforge.app\dictionaries\）。
#[tauri::command]
pub async fn open_dictionaries_folder(app: AppHandle) -> Result<(), AppError> {
    run_blocking(move || dictionaries::open_folder(&app)).await
}
