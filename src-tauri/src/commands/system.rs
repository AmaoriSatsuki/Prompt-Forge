/// 返回应用版本号，界面只用于展示，不参与业务。
#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
