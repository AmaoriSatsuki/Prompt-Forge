use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::baidu_translate;
use crate::error::AppError;
use crate::models::AppConfig;
use crate::storage;

/// 库初始化要删的文件（D117）：五个库 + 派生索引。
///
/// **刻意不碰** `config.json` / `push-settings.json` / 翻译缓存：
/// 库初始化的目的是「干净地导入备份」，不是把整套设置也抹掉。
const LIBRARY_FILES: &[&str] = &[
    "presets.json",
    "preset-folders.json",
    "artists.json",
    "tags.json",
    "snapshots.json",
    "dictionary-index.json",
];
const DICTIONARIES_DIR: &str = "dictionaries";
const CONFIG_FILE: &str = "config.json";

fn app_base(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map_err(|error| AppError::new("IO", "无法定位应用数据目录").with_detail(error.to_string()))
}

/// 纯函数：按清单清空五个库（可单测，不依赖 AppHandle）
fn clear_library_files(base: &Path) -> Result<(), AppError> {
    for file in LIBRARY_FILES {
        let path = base.join(file);
        if path.is_file() {
            fs::remove_file(&path).map_err(|error| AppError::io("删除库文件失败", error))?;
        }
    }
    let dictionaries = base.join(DICTIONARIES_DIR);
    if dictionaries.is_dir() {
        fs::remove_dir_all(&dictionaries)
            .map_err(|error| AppError::io("删除词典文件夹失败", error))?;
    }
    Ok(())
}

/// 库初始化（D117）：把五个库清空到「刚装好」的样子，方便干净地导入备份。
#[tauri::command]
pub fn reset_libraries(app: AppHandle) -> Result<(), AppError> {
    clear_library_files(&app_base(&app)?)
}

/// 服务商 API 初始化（D117）：清空配置，并把系统凭据库里的密钥一起删掉。
///
/// 用户口径：「链接丢在计算机里会觉得不舒服」，所以不能只清配置 ——
/// 凭据条目（`<配置 id>:baidu`）也要逐条删掉。环境变量不在本应用管辖范围内。
#[tauri::command]
pub fn reset_provider_config(app: AppHandle) -> Result<(), AppError> {
    let path = app_base(&app)?.join(CONFIG_FILE);
    if let Some(config) = storage::read_json::<AppConfig>(&path)? {
        for profile in config.profiles {
            baidu_translate::delete_baidu_credentials(profile.id)?;
        }
    }
    storage::write_json(&path, &AppConfig::default())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("test-tmp")
            .join(format!("reset-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("创建测试目录失败");
        dir
    }

    #[test]
    fn reset_clears_every_library_file_and_the_dictionaries_folder() {
        let dir = temp_dir("libs");
        for file in LIBRARY_FILES {
            fs::write(dir.join(file), "[]").unwrap();
        }
        fs::create_dir_all(dir.join(DICTIONARIES_DIR).join("画师表")).unwrap();
        fs::write(
            dir.join(DICTIONARIES_DIR).join("画师表").join("translation.json"),
            "[]",
        )
        .unwrap();

        clear_library_files(&dir).unwrap();

        for file in LIBRARY_FILES {
            assert!(!dir.join(file).exists(), "{file} 应当被删掉");
        }
        assert!(!dir.join(DICTIONARIES_DIR).exists(), "词典文件夹应当整个删掉");
    }

    #[test]
    fn reset_keeps_settings_cache_and_push_config() {
        let dir = temp_dir("keep");
        fs::write(dir.join("presets.json"), "[]").unwrap();
        for file in ["config.json", "push-settings.json", "translation-cache.json"] {
            fs::write(dir.join(file), "{}").unwrap();
        }

        clear_library_files(&dir).unwrap();

        for file in ["config.json", "push-settings.json", "translation-cache.json"] {
            assert!(dir.join(file).exists(), "{file} 不属于库，不该被删");
        }
    }

    #[test]
    fn reset_is_safe_on_an_empty_directory() {
        let dir = temp_dir("empty");
        clear_library_files(&dir).unwrap();
        assert!(dir.is_dir(), "空目录上跑一遍不该报错");
    }
}
