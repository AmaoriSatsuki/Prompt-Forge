//! 全库导入导出（D115 / D116）。
//!
//! 为什么整条链路都在 Rust：
//! 词典与画师 / Tag 是十万级条目（用户实测一部词典 17 万条），把它们塞进 JSON IPC
//! 会让 WebView 先把几十 MB 拼成一个字符串再解析一遍。这里改成
//! **Rust 直接读文件 → 合并 → 写回文件**，前端只拿几百字节的概况与账目。
//!
//! 三件套同身份（用户口径）：词典名同时是文件夹名，画师库 / Tag 库在词典文件夹里的那份
//! 就长在这个文件夹里，因此重命名 / 覆盖以「一部词典」为单位整体搬动。
//!
//! 合并规则本身是纯函数（`merge.rs`，带单测）；本文件只做磁盘编排。

pub mod merge;

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager};

use crate::dictionaries;
use crate::error::AppError;
use crate::models::{
    BundleDictionary, BundleExportReport, BundleImportReport, BundleIncluded, BundleMergeStats,
    BundleSummary, DictionaryItem, LibraryBundle, LibraryFile, Preset, Snapshot,
};
use crate::storage;
use merge::{DictionaryPlan, DuplicatePolicy};

pub const BUNDLE_APP: &str = "prompt-forge";
pub const BUNDLE_KIND: &str = "library-bundle";
pub const BUNDLE_VERSION: u32 = 1;

const PRESETS_FILE: &str = "presets.json";
const PRESET_FOLDERS_FILE: &str = "preset-folders.json";
const SNAPSHOTS_FILE: &str = "snapshots.json";
const ARTISTS_FILE: &str = "artists.json";
const TAGS_FILE: &str = "tags.json";
const TRANSLATION_FILE: &str = "translation.json";

fn now_ts() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

fn app_base(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map_err(|error| AppError::new("IO", "无法定位应用数据目录").with_detail(error.to_string()))
}

/* ---------- 导出 ---------- */

/// 导出所选库到一个 JSON 文件（D115）。
///
/// `included.presets` 连带分组信息（用户口径：组信息包含在预设库里）；
/// `included.dictionaries` 连带词典文件夹里的画师 / Tag —— 三部曲是一个整体。
pub fn export(
    app: &AppHandle,
    path: &Path,
    included: BundleIncluded,
) -> Result<BundleExportReport, AppError> {
    if !included.presets
        && !included.artists
        && !included.tags
        && !included.dictionaries
        && !included.snapshots
    {
        return Err(AppError::new("IO", "请至少勾选一个库"));
    }
    if path.as_os_str().is_empty() {
        return Err(AppError::new("IO", "导出位置为空"));
    }
    let mut target = path.to_path_buf();
    if target.extension().is_none() {
        target.set_extension("json");
    }

    let base = app_base(app)?;
    let mut bundle = LibraryBundle {
        app: BUNDLE_APP.to_string(),
        kind: BUNDLE_KIND.to_string(),
        version: BUNDLE_VERSION,
        exported_at: now_ts(),
        included,
        ..Default::default()
    };

    if included.presets {
        bundle.presets = storage::read_presets(&base.join(PRESETS_FILE))?;
        bundle.preset_folders = storage::read_preset_folders(&base.join(PRESET_FOLDERS_FILE))?;
    }
    if included.artists {
        bundle.artists = vec![LibraryFile {
            file: ARTISTS_FILE.to_string(),
            items: library_export_items(app, &base, ARTISTS_FILE, !included.dictionaries)?,
        }];
    }
    if included.tags {
        bundle.tags = vec![LibraryFile {
            file: TAGS_FILE.to_string(),
            items: library_export_items(app, &base, TAGS_FILE, !included.dictionaries)?,
        }];
    }
    if included.snapshots {
        bundle.snapshots =
            storage::read_json::<Vec<Snapshot>>(&base.join(SNAPSHOTS_FILE))?.unwrap_or_default();
    }
    if included.dictionaries {
        let dir = dictionaries::dictionaries_dir(app)?;
        for item in dictionaries::index_snapshot(app)? {
            let folder = item.file.split_once('/').map(|(folder, _)| folder.to_string());
            let (artists, tags) = match folder {
                Some(folder) => (
                    storage::read_presets(&dir.join(&folder).join(ARTISTS_FILE))?,
                    storage::read_presets(&dir.join(&folder).join(TAGS_FILE))?,
                ),
                None => (Vec::new(), Vec::new()),
            };
            let entries = dictionaries::entries_of_item(app, &item).unwrap_or_default();
            bundle.dictionaries.push(BundleDictionary {
                display_name: merge::dictionary_display_name(&item),
                format: item.format.clone(),
                enabled: item.enabled,
                entries,
                artists,
                tags,
            });
        }
    }

    let bytes = storage::write_json_stream(&target, &bundle)?;
    Ok(BundleExportReport {
        path: target.to_string_lossy().to_string(),
        bytes: bytes as i64,
        presets: bundle.presets.len() as i64,
        preset_folders: bundle.preset_folders.len() as i64,
        artists: bundle.artists.iter().map(|file| file.items.len()).sum::<usize>() as i64,
        tags: bundle.tags.iter().map(|file| file.items.len()).sum::<usize>() as i64,
        dictionaries: bundle.dictionaries.len() as i64,
        snapshots: bundle.snapshots.len() as i64,
    })
}

/* ---------- 读包与概况 ---------- */

/// 导出一个库的条目。
///
/// 勾了词典库时只取**根文件**那份：词典文件夹里的画师 / Tag 由词典包整体携带，
/// 再取一遍会重复（D115）。没勾词典库时把文件夹里的也并进根文件，
/// 否则「画师库 15 万条」会导出成 0 条（用户实测反馈，D117）。
fn library_export_items(
    app: &AppHandle,
    base: &Path,
    file_name: &str,
    include_dictionary_folders: bool,
) -> Result<Vec<Preset>, AppError> {
    let mut items = storage::read_presets(&base.join(file_name))?;
    if !include_dictionary_folders {
        return Ok(items);
    }
    let dir = dictionaries::dictionaries_dir(app)?;
    if let Ok(entries) = fs::read_dir(&dir) {
        let mut folders: Vec<String> = entries
            .flatten()
            .filter(|entry| entry.path().is_dir())
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .collect();
        folders.sort();
        for folder in folders {
            let path = dir.join(&folder).join(file_name);
            if path.is_file() {
                items.extend(storage::read_presets(&path)?);
            }
        }
    }
    Ok(items)
}

/// 读并校验一个包。认不出的文件给中文原因（不是自己的备份 / 版本太新）。
pub fn read_bundle(path: &Path) -> Result<LibraryBundle, AppError> {
    if !path.is_file() {
        return Err(AppError::new("IO", "找不到这个文件（可能已被移动或删除）"));
    }
    let file = fs::File::open(path).map_err(|error| AppError::io("打开文件失败", error))?;
    let reader = std::io::BufReader::new(file);
    let bundle: LibraryBundle = serde_json::from_reader(reader).map_err(|error| {
        AppError::new("IO", "这不是榫言导出的库文件").with_detail(error.to_string())
    })?;
    if bundle.kind != BUNDLE_KIND || bundle.app != BUNDLE_APP {
        return Err(AppError::new("IO", "这不是榫言导出的库文件"));
    }
    if bundle.version > BUNDLE_VERSION {
        return Err(AppError::new(
            "IO",
            "这个备份来自更新版本的榫言，请先升级再导入",
        ));
    }
    Ok(bundle)
}

/// 导入前展示的概况：文件里有哪些库、各多少条（D115）。
pub fn inspect(path: &Path) -> Result<BundleSummary, AppError> {
    let bundle = read_bundle(path)?;
    // 用户口径（D117）：界面上「画师库 / Tag 库」显示的是**整个库**的条数，
    // 包含词典文件夹里的那些 —— 否则库里明明有 15 万画师，概览里却是 0。
    let artist_count = bundle.artists.iter().map(|file| file.items.len()).sum::<usize>() as i64
        + bundle
            .dictionaries
            .iter()
            .map(|dictionary| dictionary.artists.len())
            .sum::<usize>() as i64;
    let tag_count = bundle.tags.iter().map(|file| file.items.len()).sum::<usize>() as i64
        + bundle
            .dictionaries
            .iter()
            .map(|dictionary| dictionary.tags.len())
            .sum::<usize>() as i64;
    let dictionary_entry_count = bundle
        .dictionaries
        .iter()
        .map(|dictionary| dictionary.entries.len())
        .sum::<usize>() as i64;
    Ok(BundleSummary {
        app: bundle.app.clone(),
        version: bundle.version,
        exported_at: bundle.exported_at,
        included: bundle.included,
        preset_count: bundle.presets.len() as i64,
        preset_folder_count: bundle.preset_folders.len() as i64,
        artist_count,
        tag_count,
        dictionary_count: bundle.dictionaries.len() as i64,
        dictionary_entry_count,
        dictionary_names: bundle
            .dictionaries
            .iter()
            .map(|dictionary| dictionary.display_name.clone())
            .collect(),
        snapshot_count: bundle.snapshots.len() as i64,
    })
}

/* ---------- 导入 ---------- */

/// 叠加导入（D115）：把包里的内容并进现有库，同名条目按 `policy` 处理。
///
/// 顺序很重要：**先写词典（三件套）**，再合并画师 / Tag 的根文件条目 ——
/// 后者要按「磁盘现在长什么样」判重，词典刚写进去的文件夹也必须算在内。
pub fn import(
    app: &AppHandle,
    path: &Path,
    policy: DuplicatePolicy,
) -> Result<BundleImportReport, AppError> {
    let bundle = read_bundle(path)?;
    let base = app_base(app)?;
    let mut report = BundleImportReport {
        presets: BundleMergeStats::default(),
        folders: BundleMergeStats::default(),
        artists: BundleMergeStats::default(),
        tags: BundleMergeStats::default(),
        dictionaries: BundleMergeStats::default(),
        snapshots: BundleMergeStats::default(),
    };

    if bundle.included.presets {
        let existing = storage::read_presets(&base.join(PRESETS_FILE))?;
        let existing_folders = storage::read_preset_folders(&base.join(PRESET_FOLDERS_FILE))?;
        let merged = merge::merge_presets(
            existing,
            existing_folders,
            bundle.presets.clone(),
            &bundle.preset_folders,
            policy,
        );
        storage::write_presets(&base.join(PRESETS_FILE), &merged.presets)?;
        storage::write_preset_folders(&base.join(PRESET_FOLDERS_FILE), &merged.folders)?;
        report.presets = merged.preset_stats;
        report.folders = merged.folder_stats;
    }

    if bundle.included.snapshots {
        let existing = storage::read_json::<Vec<Snapshot>>(&base.join(SNAPSHOTS_FILE))?
            .unwrap_or_default();
        let (merged, stats) = merge::merge_snapshots(existing, bundle.snapshots.clone(), policy);
        storage::write_json(&base.join(SNAPSHOTS_FILE), &merged)?;
        report.snapshots = stats;
    }

    if bundle.included.dictionaries {
        report.dictionaries = apply_dictionaries(app, &bundle.dictionaries, policy)?;
    }

    if bundle.included.artists {
        report.artists =
            merge_root_library(app, "artists", ARTISTS_FILE, &bundle.artists, policy)?;
    }
    if bundle.included.tags {
        report.tags = merge_root_library(app, "tags", TAGS_FILE, &bundle.tags, policy)?;
    }

    Ok(report)
}

/// 写一部词典的三件套；条目为空的派生文件直接删掉（覆盖时不能留下旧内容）。
fn write_or_remove(path: &Path, items: &[Preset]) -> Result<(), AppError> {
    if items.is_empty() {
        if path.is_file() {
            fs::remove_file(path).map_err(|error| AppError::io("删除旧文件失败", error))?;
        }
        return Ok(());
    }
    storage::write_presets(path, items)
}

fn apply_dictionaries(
    app: &AppHandle,
    incoming: &[BundleDictionary],
    policy: DuplicatePolicy,
) -> Result<BundleMergeStats, AppError> {
    let index = dictionaries::index_snapshot(app)?;
    let folders = dictionaries::dictionary_folders(app)?;
    let planned = merge::plan_dictionaries(&index, incoming, policy, &folders);
    let dir = dictionaries::dictionaries_dir(app)?;
    let mut items = index.clone();

    for DictionaryPlan {
        display_name,
        folder,
        overwrite,
        order,
        enabled,
        format,
        entries,
        artists,
        tags,
    } in planned.plans
    {
        let folder_path = dir.join(&folder);
        fs::create_dir_all(&folder_path).map_err(|error| AppError::io("创建词典文件夹失败", error))?;
        storage::write_json(&folder_path.join(TRANSLATION_FILE), &entries)?;
        write_or_remove(&folder_path.join(TAGS_FILE), &tags)?;
        write_or_remove(&folder_path.join(ARTISTS_FILE), &artists)?;

        // 历史平铺词典（`名字.json` 直接摆在 dictionaries/ 下）被覆盖时，
        // 旧文件必须删掉：否则下次扫描会把它当成一部「手工放进来的词典」又收一遍。
        if let Some(old) = &overwrite {
            if let Some(flat) = old.file.strip_suffix(&format!("/{TRANSLATION_FILE}")) {
                if !flat.contains('/') {
                    let legacy = dir.join(&old.file);
                    if legacy.is_file() {
                        fs::remove_file(&legacy).map_err(|error| {
                            AppError::io("删除旧的平铺词典文件失败", error)
                        })?;
                    }
                }
            }
        }

        let item = DictionaryItem {
            id: format!("{folder}/{TRANSLATION_FILE}"),
            display_name,
            label: folder.clone(),
            file: format!("{folder}/{TRANSLATION_FILE}"),
            order,
            enabled,
            entry_count: entries.len() as i64,
            format,
            imported_at: now_ts(),
        };
        match overwrite {
            Some(old) => match items.iter().position(|entry| entry.id == old.id) {
                Some(position) => items[position] = item,
                None => items.push(item),
            },
            None => items.push(item),
        }
    }

    dictionaries::write_index_items(app, &items)?;
    Ok(planned.stats)
}

/// 把包里的**根文件**条目并进画师库 / Tag 库（词典文件夹里的那些随词典走，不在这里）。
fn merge_root_library(
    app: &AppHandle,
    kind: &str,
    root_file: &str,
    incoming: &[LibraryFile],
    policy: DuplicatePolicy,
) -> Result<BundleMergeStats, AppError> {
    let mut items: Vec<Preset> = Vec::new();
    for file in incoming {
        items.extend(file.items.iter().cloned());
    }
    if items.is_empty() {
        return Ok(BundleMergeStats::default());
    }
    let files = dictionaries::load_library(app, kind)?;
    let outcome = merge::merge_library_items(files, root_file, items, policy);
    for file in &outcome.files {
        if outcome.dirty.iter().any(|dirty| dirty == &file.file) {
            dictionaries::save_library(app, kind, &file.file, file.items.clone())?;
        }
    }
    Ok(outcome.stats)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("test-tmp")
            .join(format!("bundle-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("创建测试目录失败");
        dir
    }

    fn sample_bundle() -> LibraryBundle {
        LibraryBundle {
            app: BUNDLE_APP.to_string(),
            kind: BUNDLE_KIND.to_string(),
            version: BUNDLE_VERSION,
            exported_at: 1,
            included: crate::models::BundleIncluded {
                presets: true,
                artists: true,
                tags: true,
                dictionaries: true,
                snapshots: true,
            },
            presets: vec![Preset {
                id: "p1".to_string(),
                label: "风格".to_string(),
                english: "style".to_string(),
                weight: 100,
                color_id: "red".to_string(),
                folder: Some("作品集".to_string()),
                created_at: 1,
                updated_at: 1,
            }],
            preset_folders: vec![crate::models::PresetFolder {
                name: "作品集".to_string(),
                color_id: "red".to_string(),
                expanded: true,
            }],
            artists: vec![LibraryFile {
                file: ARTISTS_FILE.to_string(),
                items: Vec::new(),
            }],
            tags: Vec::new(),
            dictionaries: vec![BundleDictionary {
                display_name: "词表".to_string(),
                format: "csv".to_string(),
                enabled: true,
                entries: vec![crate::models::DictionaryEntry {
                    cn: "中文".to_string(),
                    en: "en".to_string(),
                }],
                artists: Vec::new(),
                tags: Vec::new(),
            }],
            snapshots: Vec::new(),
        }
    }

    #[test]
    fn bundle_round_trips_through_disk() {
        let dir = temp_dir("roundtrip");
        let path = dir.join("备份.json");
        let bundle = sample_bundle();
        storage::write_json_stream(&path, &bundle).unwrap();

        let loaded = read_bundle(&path).unwrap();
        assert_eq!(loaded, bundle);
        assert!(path.exists());
    }

    #[test]
    fn streaming_write_is_atomic_and_leaves_no_temp_file() {
        let dir = temp_dir("atomic");
        let path = dir.join("备份.json");
        storage::write_json_stream(&path, &sample_bundle()).unwrap();
        let leftovers: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "临时文件应当已被 rename 消耗掉");
    }

    #[test]
    fn foreign_json_is_rejected_with_a_chinese_reason() {
        let dir = temp_dir("foreign");
        let path = dir.join("别的.json");
        fs::write(&path, "{\"hello\":1}").unwrap();
        let error = read_bundle(&path).unwrap_err();
        assert_eq!(error.message, "这不是榫言导出的库文件");
    }

    #[test]
    fn newer_version_is_rejected_instead_of_silently_ignored() {
        let dir = temp_dir("newer");
        let path = dir.join("未来.json");
        let mut bundle = sample_bundle();
        bundle.version = BUNDLE_VERSION + 1;
        storage::write_json_stream(&path, &bundle).unwrap();
        let error = read_bundle(&path).unwrap_err();
        assert!(error.message.contains("更新版本"));
    }

    #[test]
    fn summary_counts_every_library_including_dictionary_children() {
        let dir = temp_dir("summary");
        let path = dir.join("备份.json");
        let mut bundle = sample_bundle();
        bundle.dictionaries[0].artists.push(Preset {
            id: "a1".to_string(),
            label: "画师".to_string(),
            english: "@artist".to_string(),
            weight: 100,
            color_id: "artist".to_string(),
            folder: None,
            created_at: 1,
            updated_at: 1,
        });
        storage::write_json_stream(&path, &bundle).unwrap();

        let summary = inspect(&path).unwrap();
        assert_eq!(summary.preset_count, 1);
        assert_eq!(summary.preset_folder_count, 1);
        assert_eq!(summary.dictionary_count, 1);
        // D117：画师库条数把词典文件夹里的也数进去（概览里不能出现「画师库 0 条」）
        assert_eq!(summary.artist_count, 1);
        assert_eq!(summary.tag_count, 0);
        assert_eq!(summary.dictionary_entry_count, 1);
        assert_eq!(summary.dictionary_names, vec!["词表".to_string()]);
        assert!(summary.included.dictionaries);
    }
}
