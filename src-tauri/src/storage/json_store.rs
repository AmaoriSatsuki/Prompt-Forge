use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::error::AppError;
use crate::models::{Preset, PresetFolder};

// ---------------------------------------------------------------------------
// 通用 JSON 读写（预设库与配置共用同一套原子写与损坏留档逻辑）
// ---------------------------------------------------------------------------

/// 读取一个 JSON 文件。
///
/// 返回 Ok(None) 的三种情况，都属于「正常但没内容」，不算错误：
/// - 文件不存在（首次启动）
/// - 文件为空或只有空白
/// - 文件无法解析（此时会把原文件改名成 `*.corrupt-<时间戳>.json` 留档）
///
/// 这样即使 JSON 被手工改坏，应用也能正常启动，且用户的数据仍在磁盘上。
pub fn read_json<T: DeserializeOwned>(path: &Path) -> Result<Option<T>, AppError> {
    if !path.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(path).map_err(|error| AppError::io("读取文件失败", error))?;
    if raw.trim().is_empty() {
        return Ok(None);
    }

    match serde_json::from_str::<T>(&raw) {
        Ok(value) => Ok(Some(value)),
        Err(_) => {
            backup_corrupt_file(path)?;
            Ok(None)
        }
    }
}

/// 写入一个 JSON 文件：先写同目录下的临时文件，再原子替换目标文件。
/// 中途断电 / 崩溃时，磁盘上要么是旧内容，要么是新内容，不会出现半截 JSON。
pub fn write_json<T: Serialize + ?Sized>(path: &Path, value: &T) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| AppError::io("创建目录失败", error))?;
    }

    let json = serde_json::to_string_pretty(value)
        .map_err(|error| AppError::new("IO", "序列化失败").with_detail(error.to_string()))?;

    let temp_path = temp_path_for(path);
    fs::write(&temp_path, json).map_err(|error| AppError::io("写入临时文件失败", error))?;

    // Windows 上 std::fs::rename 使用 MOVEFILE_REPLACE_EXISTING，可以直接覆盖目标文件
    fs::rename(&temp_path, path).map_err(|error| {
        let _ = fs::remove_file(&temp_path);
        AppError::io("替换文件失败", error)
    })?;

    Ok(())
}

fn temp_path_for(path: &Path) -> PathBuf {
    path.with_extension("json.tmp")
}

/// 写入一个大 JSON 文件（D115：全库导出，可能几十 MB）。
///
/// 与 `write_json` 同一套原子写（临时文件 + rename），区别是**流式序列化**：
/// 不先拼出一个巨大的 String，避免导出十万级条目时内存翻倍。返回写入的字节数。
pub fn write_json_stream<T: Serialize + ?Sized>(path: &Path, value: &T) -> Result<u64, AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| AppError::io("创建目录失败", error))?;
    }

    let temp_path = temp_path_for(path);
    let file =
        fs::File::create(&temp_path).map_err(|error| AppError::io("写入临时文件失败", error))?;
    let mut writer = std::io::BufWriter::new(file);
    serde_json::to_writer_pretty(&mut writer, value)
        .map_err(|error| AppError::new("IO", "序列化失败").with_detail(error.to_string()))?;
    {
        use std::io::Write;
        writer
            .flush()
            .map_err(|error| AppError::io("写入临时文件失败", error))?;
    }
    drop(writer);

    fs::rename(&temp_path, path).map_err(|error| {
        let _ = fs::remove_file(&temp_path);
        AppError::io("替换文件失败", error)
    })?;

    let bytes = fs::metadata(path)
        .map(|meta| meta.len())
        .map_err(|error| AppError::io("读取文件大小失败", error))?;
    Ok(bytes)
}

/// 把损坏的文件改名留档，返回备份后的路径。
pub fn backup_corrupt_file(path: &Path) -> Result<Option<PathBuf>, AppError> {
    if !path.exists() {
        return Ok(None);
    }
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    let backup = path.with_extension(format!("corrupt-{stamp}.json"));
    fs::rename(path, &backup).map_err(|error| AppError::io("备份损坏的文件失败", error))?;
    Ok(Some(backup))
}

// ---------------------------------------------------------------------------
// 预设库（read_json / write_json 的薄封装）
// ---------------------------------------------------------------------------

pub fn read_presets(path: &Path) -> Result<Vec<Preset>, AppError> {
    Ok(read_json::<Vec<Preset>>(path)?.unwrap_or_default())
}

pub fn write_presets(path: &Path, presets: &[Preset]) -> Result<(), AppError> {
    write_json(path, presets)
}

/// 预设分组元数据（D111）：文件缺失 / 损坏都返回空数组（无损降级，不算错误）。
pub fn read_preset_folders(path: &Path) -> Result<Vec<PresetFolder>, AppError> {
    Ok(read_json::<Vec<PresetFolder>>(path)?.unwrap_or_default())
}

pub fn write_preset_folders(path: &Path, folders: &[PresetFolder]) -> Result<(), AppError> {
    write_json(path, folders)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::AppConfig;

    fn sample(id: &str) -> Preset {
        Preset {
            id: id.to_string(),
            label: "预设标签-0".to_string(),
            english: "in a formal business tone".to_string(),
            weight: 100,
            color_id: "common".to_string(),
            folder: None,
            created_at: 1_700_000_000,
            updated_at: 1_700_000_100,
        }
    }

    /// 测试用临时目录放在 target/ 下：既随 cargo clean 一起清掉，
    /// 也不依赖环境的 TEMP 设置（不同执行权限下 TEMP 可能不可写）。
    fn temp_dir(name: &str) -> PathBuf {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("test-tmp")
            .join(format!("{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("创建测试目录失败");
        dir
    }

    #[test]
    fn missing_file_returns_empty_list() {
        let dir = temp_dir("missing");
        let path = dir.join("presets.json");
        assert_eq!(read_presets(&path).unwrap(), Vec::new());
    }

    #[test]
    fn empty_file_returns_empty_list() {
        let dir = temp_dir("empty");
        let path = dir.join("presets.json");
        fs::write(&path, "   \n").unwrap();
        assert_eq!(read_presets(&path).unwrap(), Vec::new());
    }

    #[test]
    fn write_then_read_round_trips() {
        let dir = temp_dir("roundtrip");
        let path = dir.join("presets.json");
        let presets = vec![sample("p1"), sample("p2")];

        write_presets(&path, &presets).unwrap();
        assert_eq!(read_presets(&path).unwrap(), presets);
    }

    #[test]
    fn write_creates_missing_parent_directory() {
        let dir = temp_dir("nested");
        let path = dir.join("a").join("b").join("presets.json");
        write_presets(&path, &[sample("p1")]).unwrap();
        assert!(path.exists());
    }

    #[test]
    fn overwrite_leaves_no_temp_file() {
        let dir = temp_dir("overwrite");
        let path = dir.join("presets.json");
        write_presets(&path, &[sample("p1")]).unwrap();
        write_presets(&path, &[sample("p1"), sample("p2")]).unwrap();

        assert_eq!(read_presets(&path).unwrap().len(), 2);
        assert!(!temp_path_for(&path).exists(), "临时文件应当已被改名消耗掉");
    }

    #[test]
    fn corrupted_file_is_backed_up_and_reads_as_empty() {
        let dir = temp_dir("corrupt");
        let path = dir.join("presets.json");
        fs::write(&path, "{ 这不是合法 JSON").unwrap();

        assert_eq!(read_presets(&path).unwrap(), Vec::new());
        assert!(!path.exists(), "损坏的文件应当被改名留档");

        let backups: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_name().to_string_lossy().contains("corrupt-"))
            .collect();
        assert_eq!(backups.len(), 1, "应当留下恰好一个备份文件");
    }

    #[test]
    fn non_array_content_is_treated_as_corrupted() {
        let dir = temp_dir("notarray");
        let path = dir.join("presets.json");
        fs::write(&path, "{\"presets\": []}").unwrap();

        assert_eq!(read_presets(&path).unwrap(), Vec::new());
        assert!(!path.exists());
    }

    #[test]
    fn entries_with_missing_fields_fall_back_to_defaults() {
        let dir = temp_dir("partial");
        let path = dir.join("presets.json");
        fs::write(&path, "[{\"id\":\"p1\",\"label\":\"预设标签-0\"}]").unwrap();

        let presets = read_presets(&path).unwrap();
        assert_eq!(presets.len(), 1);
        assert_eq!(presets[0].english, "");
        assert_eq!(presets[0].weight, 100);
        assert_eq!(presets[0].color_id, "common");
    }

    #[test]
    fn negative_weight_still_parses_so_frontend_can_clamp_it() {
        let dir = temp_dir("negative");
        let path = dir.join("presets.json");
        fs::write(&path, "[{\"id\":\"p1\",\"label\":\"负权重\",\"weight\":-5}]").unwrap();

        let presets = read_presets(&path).unwrap();
        assert_eq!(presets.len(), 1);
        assert_eq!(presets[0].weight, -5);
    }

    #[test]
    fn backup_helper_is_noop_for_missing_file() {
        let dir = temp_dir("nobackup");
        assert_eq!(backup_corrupt_file(&dir.join("nope.json")).unwrap(), None);
    }

    // ---- 预设分组（D111 / D112）：缺文件即无损降级 ----

    fn folder_of(name: &str, color: &str, expanded: bool) -> PresetFolder {
        PresetFolder {
            name: name.to_string(),
            color_id: color.to_string(),
            expanded,
        }
    }

    #[test]
    fn missing_preset_folders_file_reads_as_empty() {
        let dir = temp_dir("folders-missing");
        assert_eq!(read_preset_folders(&dir.join("preset-folders.json")).unwrap(), Vec::new());
    }

    #[test]
    fn preset_folders_round_trip() {
        let dir = temp_dir("folders-roundtrip");
        let path = dir.join("preset-folders.json");
        let folders = vec![folder_of("作品集", "blue", true), folder_of("角色", "red", false)];

        write_preset_folders(&path, &folders).unwrap();
        assert_eq!(read_preset_folders(&path).unwrap(), folders);
    }

    #[test]
    fn preset_folder_without_fields_falls_back_to_defaults() {
        let dir = temp_dir("folders-partial");
        let path = dir.join("preset-folders.json");
        fs::write(&path, "[{\"name\":\"作品集\"}]").unwrap();

        let folders = read_preset_folders(&path).unwrap();
        assert_eq!(folders.len(), 1);
        assert_eq!(folders[0].color_id, "");
        assert!(!folders[0].expanded, "缺 expanded 字段应当按折叠处理");
    }

    #[test]
    fn preset_folder_field_is_omitted_when_absent() {
        let dir = temp_dir("folders-omit");
        let path = dir.join("presets.json");
        write_presets(&path, &[sample("p1")]).unwrap();
        let raw = fs::read_to_string(&path).unwrap();
        assert!(!raw.contains("folder"), "未分组的预设不该把 folder 写进文件");
    }

    // ---- 配置（与预设库共用同一套读写）----

    #[test]
    fn missing_config_reads_as_none() {
        let dir = temp_dir("cfg-missing");
        assert_eq!(read_json::<AppConfig>(&dir.join("config.json")).unwrap(), None);
    }

    #[test]
    fn config_round_trips() {
        let dir = temp_dir("cfg-roundtrip");
        let path = dir.join("config.json");
        let config = AppConfig {
            profiles: vec![crate::models::ProviderProfile {
                id: "p1".into(),
                label: "百度主力".into(),
                brand: "baidu".into(),
            }],
            active_profile_id: "p1".into(),
        };

        write_json(&path, &config).unwrap();
        assert_eq!(read_json::<AppConfig>(&path).unwrap(), Some(config));
    }

    #[test]
    fn corrupted_config_is_backed_up_and_reads_as_none() {
        let dir = temp_dir("cfg-corrupt");
        let path = dir.join("config.json");
        fs::write(&path, "not json at all").unwrap();

        assert_eq!(read_json::<AppConfig>(&path).unwrap(), None);
        assert!(!path.exists());
    }

    #[test]
    fn config_file_never_contains_a_key_field() {
        let dir = temp_dir("cfg-nokey");
        let path = dir.join("config.json");
        write_json(&path, &AppConfig::default()).unwrap();
        let raw = fs::read_to_string(&path).unwrap();
        assert!(!raw.to_lowercase().contains("apikey"));
        assert!(!raw.to_lowercase().contains("api_key"));
    }
}
