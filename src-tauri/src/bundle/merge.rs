use std::collections::{HashMap, HashSet};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::{
    BundleDictionary, BundleMergeStats, DictionaryEntry, DictionaryItem, LibraryFile, Preset,
    PresetFolder, Snapshot,
};

/// 索引里没有显示名时的兜底（与前端 `FALLBACK_PRESET_LABEL` 同词）
pub const FALLBACK_LABEL: &str = "未命名预设";

/// 遇到同名条目时的两种操作（D115）。**这是整次导入唯一的选择**：
/// 用户口径「用户只有对重复项的操作空间」——导入只有叠加，没有"替换整库"。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DuplicatePolicy {
    /// 导入的条目改名成 `名·1`、`名·2` …… 原有内容原样保留
    Rename,
    /// 同名条目以导入文件为准；位置 / id / 创建时间仍归原有条目
    Overwrite,
}

impl DuplicatePolicy {
    /// 前端传 `rename` / `overwrite`；认不出的取值一律按「重命名」处理（不破坏数据）
    pub fn parse(raw: &str) -> Self {
        match raw {
            "overwrite" => Self::Overwrite,
            _ => Self::Rename,
        }
    }
}

fn now_ts() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

/// 唯一名：`名`、`名·1`、`名·2` ……（避开 `taken` 里已有的名字）。
///
/// 用中文间隔号 `·` 而不是括号 / 下划线：用户口径「·标点符号和数字排序」，
/// 且 `·` 在词典文件夹名里不需要任何清洗（`sanitize_stem` 不拦它）。
pub fn unique_label(base: &str, taken: &HashSet<String>) -> String {
    let base = base.trim();
    let base = if base.is_empty() { FALLBACK_LABEL } else { base };
    if !taken.contains(base) {
        return base.to_string();
    }
    let mut index: u64 = 1;
    loop {
        let candidate = format!("{base}·{index}");
        if !taken.contains(&candidate) {
            return candidate;
        }
        index += 1;
    }
}

/// 生成一个不与 `taken` 冲突的新 id（同名条目重命名后必须换 id，否则 React key 撞车）
fn fresh_id(prefix: &str, taken: &mut HashSet<String>, sequence: &mut u64) -> String {
    loop {
        *sequence += 1;
        let candidate = format!("{prefix}_imp{}{sequence}", now_millis());
        if taken.insert(candidate.clone()) {
            return candidate;
        }
    }
}

// ---------------------------------------------------------------------------
// 预设库（含分组）
// ---------------------------------------------------------------------------

/// 预设库合并结果。`folders` 已经是「可直接落盘」的最终分组表。
#[derive(Debug, Clone, PartialEq)]
pub struct PresetMerge {
    pub presets: Vec<Preset>,
    pub folders: Vec<PresetFolder>,
    pub preset_stats: BundleMergeStats,
    pub folder_stats: BundleMergeStats,
}

/// 合并预设库（D115 的核心语义）。
///
/// 两条容易踩错的口径：
/// 1. **组的身份 = 名字 + 颜色**（D113）。预设上的 `folder` 只有名字，
///    所以「这个名字的组该改叫什么」必须按 **（名字, 这条预设的颜色）** 查表，
///    而不是只按名字 —— 否则同名不同色的两个组会被一起改掉。
/// 2. 覆盖组时只改展开状态，**不碰组色**：组色由建组时那颗胶囊固定（D112）。
pub fn merge_presets(
    mut existing: Vec<Preset>,
    existing_folders: Vec<PresetFolder>,
    incoming: Vec<Preset>,
    incoming_folders: &[PresetFolder],
    policy: DuplicatePolicy,
) -> PresetMerge {
    let mut folders = existing_folders;
    let mut folder_stats = BundleMergeStats::default();
    let mut mapping: HashMap<(String, String), String> = HashMap::new();

    // 只处理「包里真的有成员」的组；空组不该被造出来（D112 空组自动消失）
    let mut candidates: Vec<(String, String)> = Vec::new();
    for preset in &incoming {
        let name = preset.folder.clone().unwrap_or_default().trim().to_string();
        if name.is_empty() {
            continue;
        }
        let key = (name, preset.color_id.trim().to_string());
        if !candidates.contains(&key) {
            candidates.push(key);
        }
    }

    for key in candidates {
        let (name, color) = key.clone();
        let incoming_expanded = incoming_folders
            .iter()
            .find(|folder| folder.name == name && folder.color_id == color)
            .map(|folder| folder.expanded);
        match folders
            .iter()
            .position(|folder| folder.name == name && folder.color_id == color)
        {
            Some(index) => {
                if policy == DuplicatePolicy::Overwrite {
                    if let Some(expanded) = incoming_expanded {
                        folders[index].expanded = expanded;
                    }
                    mapping.insert(key, name);
                    folder_stats.overwritten += 1;
                } else {
                    let taken: HashSet<String> = folders
                        .iter()
                        .filter(|folder| folder.color_id == color)
                        .map(|folder| folder.name.clone())
                        .collect();
                    let renamed = unique_label(&name, &taken);
                    folders.push(PresetFolder {
                        name: renamed.clone(),
                        color_id: color,
                        expanded: incoming_expanded.unwrap_or(false),
                    });
                    mapping.insert(key, renamed);
                    folder_stats.renamed += 1;
                }
            }
            None => {
                folders.push(PresetFolder {
                    name: name.clone(),
                    color_id: color,
                    expanded: incoming_expanded.unwrap_or(false),
                });
                mapping.insert(key, name);
                folder_stats.added += 1;
            }
        }
    }

    let mut label_index: HashMap<String, usize> = HashMap::new();
    for (index, preset) in existing.iter().enumerate() {
        label_index
            .entry(preset.label.trim().to_string())
            .or_insert(index);
    }
    let mut taken_labels: HashSet<String> = label_index.keys().cloned().collect();
    let mut ids: HashSet<String> = existing.iter().map(|preset| preset.id.clone()).collect();
    let mut stats = BundleMergeStats::default();
    let mut sequence: u64 = 0;
    let now = now_ts();

    for mut preset in incoming {
        let raw_label = preset.label.trim().to_string();
        let label = if raw_label.is_empty() {
            FALLBACK_LABEL.to_string()
        } else {
            raw_label
        };
        let folder_name = preset
            .folder
            .as_ref()
            .map(|name| name.trim().to_string())
            .filter(|name| !name.is_empty());
        preset.folder = folder_name.and_then(|name| {
            mapping
                .get(&(name, preset.color_id.trim().to_string()))
                .cloned()
        });
        preset.label = label.clone();

        match label_index.get(&label).copied() {
            Some(index) if policy == DuplicatePolicy::Overwrite => {
                preset.id = existing[index].id.clone();
                preset.created_at = existing[index].created_at;
                preset.updated_at = now;
                existing[index] = preset;
                stats.overwritten += 1;
            }
            Some(_) => {
                let renamed = unique_label(&label, &taken_labels);
                taken_labels.insert(renamed.clone());
                preset.label = renamed.clone();
                preset.id = fresh_id("preset", &mut ids, &mut sequence);
                preset.updated_at = now;
                existing.push(preset);
                label_index.insert(renamed, existing.len() - 1);
                stats.renamed += 1;
            }
            None => {
                let incoming_id = preset.id.trim().to_string();
                if incoming_id.is_empty() || ids.contains(&incoming_id) {
                    preset.id = fresh_id("preset", &mut ids, &mut sequence);
                } else {
                    ids.insert(incoming_id.clone());
                    preset.id = incoming_id;
                }
                taken_labels.insert(label.clone());
                existing.push(preset);
                label_index.insert(label, existing.len() - 1);
                stats.added += 1;
            }
        }
    }

    PresetMerge {
        presets: existing,
        folders,
        preset_stats: stats,
        folder_stats,
    }
}

// ---------------------------------------------------------------------------
// 快照库
// ---------------------------------------------------------------------------

/// 合并快照库：冲突只看 `name`（快照没有颜色，也没有分组）。
pub fn merge_snapshots(
    mut existing: Vec<Snapshot>,
    incoming: Vec<Snapshot>,
    policy: DuplicatePolicy,
) -> (Vec<Snapshot>, BundleMergeStats) {
    let mut index_by_name: HashMap<String, usize> = HashMap::new();
    for (index, snapshot) in existing.iter().enumerate() {
        index_by_name
            .entry(snapshot.name.trim().to_string())
            .or_insert(index);
    }
    let mut taken: HashSet<String> = index_by_name.keys().cloned().collect();
    let mut ids: HashSet<String> = existing.iter().map(|snapshot| snapshot.id.clone()).collect();
    let mut stats = BundleMergeStats::default();
    let mut sequence: u64 = 0;

    for mut snapshot in incoming {
        let raw = snapshot.name.trim().to_string();
        let name = if raw.is_empty() { FALLBACK_LABEL.to_string() } else { raw };
        snapshot.name = name.clone();
        match index_by_name.get(&name).copied() {
            Some(index) if policy == DuplicatePolicy::Overwrite => {
                snapshot.id = existing[index].id.clone();
                snapshot.created_at = existing[index].created_at;
                existing[index] = snapshot;
                stats.overwritten += 1;
            }
            Some(_) => {
                let renamed = unique_label(&name, &taken);
                taken.insert(renamed.clone());
                snapshot.name = renamed.clone();
                snapshot.id = fresh_id("snap", &mut ids, &mut sequence);
                existing.push(snapshot);
                index_by_name.insert(renamed, existing.len() - 1);
                stats.renamed += 1;
            }
            None => {
                let incoming_id = snapshot.id.trim().to_string();
                if incoming_id.is_empty() || ids.contains(&incoming_id) {
                    snapshot.id = fresh_id("snap", &mut ids, &mut sequence);
                } else {
                    ids.insert(incoming_id.clone());
                    snapshot.id = incoming_id;
                }
                taken.insert(name.clone());
                existing.push(snapshot);
                index_by_name.insert(name, existing.len() - 1);
                stats.added += 1;
            }
        }
    }

    (existing, stats)
}

// ---------------------------------------------------------------------------
// 画师库 / Tag 库（根文件部分）
// ---------------------------------------------------------------------------

/// 多文件库（画师 / Tag）的合并结果。
///
/// `dirty` 是要写回的文件（相对路径）；没进 `dirty` 的文件一个字节都不动，
/// 十万级词条时这一点很关键 —— 否则导入 10 条也会重写三份大文件。
#[derive(Debug, Clone, PartialEq)]
pub struct LibraryMerge {
    pub files: Vec<LibraryFile>,
    pub stats: BundleMergeStats,
    pub dirty: Vec<String>,
    pub root_file: String,
}

/// 合并一批**根文件**条目到多文件库（D115）。
///
/// 覆盖口径：同名的那一条**无论在哪个文件里**都先被删掉，再把导入的这条写进根文件。
/// 这样「覆盖」在合并视图里真的是唯一一条；重命名则一条都不删，只给后加的补 `·N`。
pub fn merge_library_items(
    mut files: Vec<LibraryFile>,
    root_file: &str,
    incoming: Vec<Preset>,
    policy: DuplicatePolicy,
) -> LibraryMerge {
    if !files.iter().any(|file| file.file == root_file) {
        files.push(LibraryFile {
            file: root_file.to_string(),
            items: Vec::new(),
        });
    }
    let mut dirty: Vec<String> = Vec::new();
    let mark_dirty = |dirty: &mut Vec<String>, file: &str| {
        if !dirty.iter().any(|name| name == file) {
            dirty.push(file.to_string());
        }
    };

    let mut ids: HashSet<String> = files
        .iter()
        .flat_map(|file| file.items.iter().map(|item| item.id.clone()))
        .collect();
    let mut taken: HashSet<String> = files
        .iter()
        .flat_map(|file| file.items.iter().map(|item| item.label.trim().to_string()))
        .collect();
    let mut stats = BundleMergeStats::default();
    let mut sequence: u64 = 0;
    let now = now_ts();

    for mut preset in incoming {
        let raw = preset.label.trim().to_string();
        let label = if raw.is_empty() { FALLBACK_LABEL.to_string() } else { raw };
        preset.label = label.clone();
        let exists = taken.contains(&label);

        if exists && policy == DuplicatePolicy::Overwrite {
            // 从所有文件里删掉同名条目（倒序删除，索引不会错位）
            for file in files.iter_mut() {
                let mut hits: Vec<usize> = file
                    .items
                    .iter()
                    .enumerate()
                    .filter(|(_, item)| item.label.trim() == label)
                    .map(|(index, _)| index)
                    .collect();
                if hits.is_empty() {
                    continue;
                }
                hits.sort_unstable();
                hits.reverse();
                for index in hits {
                    let removed = file.items.remove(index);
                    ids.remove(&removed.id);
                }
                mark_dirty(&mut dirty, &file.file);
            }
            taken.remove(&label);
        }

        let incoming_id = preset.id.trim().to_string();
        if incoming_id.is_empty() || ids.contains(&incoming_id) {
            preset.id = fresh_id("preset", &mut ids, &mut sequence);
        } else {
            ids.insert(incoming_id.clone());
            preset.id = incoming_id;
        }
        preset.updated_at = now;

        let was_duplicate = exists;
        if exists && policy == DuplicatePolicy::Rename {
            let renamed = unique_label(&label, &taken);
            taken.insert(renamed.clone());
            preset.label = renamed;
            stats.renamed += 1;
        } else if was_duplicate {
            taken.insert(preset.label.clone());
            stats.overwritten += 1;
        } else {
            taken.insert(preset.label.clone());
            stats.added += 1;
        }

        let root = files
            .iter_mut()
            .find(|file| file.file == root_file)
            .expect("根文件已在上方补齐");
        root.items.push(preset);
        mark_dirty(&mut dirty, root_file);
    }

    LibraryMerge {
        files,
        stats,
        dirty,
        root_file: root_file.to_string(),
    }
}

// ---------------------------------------------------------------------------
// 词典库（词典 + 它的画师 + 它的 Tag = 一个整体）
// ---------------------------------------------------------------------------

/// 一部词典的导入计划（纯数据，真正落盘由 `bundle/mod.rs` 做）。
#[derive(Debug, Clone, PartialEq)]
pub struct DictionaryPlan {
    /// 最终显示名（重命名时已带 `·N`）
    pub display_name: String,
    /// 最终文件夹名（与显示名同源；同一部词典的三份文件都长在这个文件夹里）
    pub folder: String,
    /// 命中的原有词典（覆盖时用它保留 id / 优先序 / 启停状态）
    pub overwrite: Option<DictionaryItem>,
    pub order: i64,
    pub enabled: bool,
    pub format: String,
    pub entries: Vec<DictionaryEntry>,
    pub artists: Vec<Preset>,
    pub tags: Vec<Preset>,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct DictionaryPlanResult {
    pub plans: Vec<DictionaryPlan>,
    pub stats: BundleMergeStats,
    /// 条目为空、连派生内容都没有的包成员：跳过并计数（不造空词典）
    pub skipped: i64,
}

/// 索引里的显示名（与 Rust 侧 `display_name_of` 同口径：显示名 → 词干 → 文件名）
pub fn dictionary_display_name(item: &DictionaryItem) -> String {
    if !item.display_name.trim().is_empty() {
        return item.display_name.trim().to_string();
    }
    if !item.label.trim().is_empty() {
        return item.label.trim().to_string();
    }
    item.file
        .rsplit_once('/')
        .map(|(_, tail)| tail)
        .unwrap_or(&item.file)
        .trim_end_matches(".json")
        .to_string()
}

/// 索引条目的文件夹（历史平铺词典返回 None）
pub fn dictionary_folder(item: &DictionaryItem) -> Option<&str> {
    item.file.split_once('/').map(|(folder, _)| folder)
}

/// 规划词典导入（D115）。
///
/// - 覆盖：命中同名词典 → 沿用它的文件夹、优先序与启停状态，三份文件整体替换；
/// - 重命名：显示名与文件夹名一起补 `·N`（**三件套同身份**，不能只改显示名）；
/// - 新词典：显示名与文件夹各取一个不与现有冲突的名字。
pub fn plan_dictionaries(
    existing: &[DictionaryItem],
    incoming: &[BundleDictionary],
    policy: DuplicatePolicy,
    existing_folders: &HashSet<String>,
) -> DictionaryPlanResult {
    let mut taken_names: HashSet<String> = existing
        .iter()
        .map(dictionary_display_name)
        .filter(|name| !name.trim().is_empty())
        .collect();
    let mut taken_folders: HashSet<String> = existing_folders.clone();
    for item in existing {
        if let Some(folder) = dictionary_folder(item) {
            taken_folders.insert(folder.to_string());
        }
    }
    let next_order = existing
        .iter()
        .map(|item| item.order)
        .max()
        .map(|value| value + 1)
        .unwrap_or(0);

    let mut result = DictionaryPlanResult::default();
    let mut created: i64 = 0;

    for dictionary in incoming {
        if dictionary.entries.is_empty() {
            result.skipped += 1;
            continue;
        }
        let raw_name = dictionary.display_name.trim().to_string();
        let display_name = if raw_name.is_empty() {
            "词典".to_string()
        } else {
            raw_name
        };
        let conflict = existing
            .iter()
            .find(|item| dictionary_display_name(item).trim() == display_name);

        let plan = if let (true, Some(item)) = (policy == DuplicatePolicy::Overwrite, conflict) {
            let folder = dictionary_folder(item)
                .map(|value| value.to_string())
                .unwrap_or_else(|| crate::dictionaries::sanitize_stem(&display_name));
            result.stats.overwritten += 1;
            DictionaryPlan {
                display_name: dictionary_display_name(item),
                folder,
                overwrite: Some(item.clone()),
                order: item.order,
                enabled: item.enabled,
                format: dictionary.format.clone(),
                entries: dictionary.entries.clone(),
                artists: dictionary.artists.clone(),
                tags: dictionary.tags.clone(),
            }
        } else {
            let renamed = unique_label(&display_name, &taken_names);
            taken_names.insert(renamed.clone());
            let base = crate::dictionaries::sanitize_stem(&renamed);
            let folder = unique_label(&base, &taken_folders);
            taken_folders.insert(folder.clone());
            if conflict.is_some() {
                result.stats.renamed += 1;
            } else {
                result.stats.added += 1;
            }
            DictionaryPlan {
                display_name: renamed,
                folder,
                overwrite: None,
                order: next_order + created,
                enabled: dictionary.enabled,
                format: dictionary.format.clone(),
                entries: dictionary.entries.clone(),
                artists: dictionary.artists.clone(),
                tags: dictionary.tags.clone(),
            }
        };
        if plan.overwrite.is_none() {
            created += 1;
        }
        result.plans.push(plan);
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn preset(label: &str, color: &str, folder: Option<&str>) -> Preset {
        Preset {
            id: format!("p-{label}"),
            label: label.to_string(),
            english: "english".to_string(),
            weight: 100,
            color_id: color.to_string(),
            folder: folder.map(|value| value.to_string()),
            created_at: 1,
            updated_at: 1,
        }
    }

    fn snapshot(name: &str) -> Snapshot {
        Snapshot {
            id: format!("s-{name}"),
            name: name.to_string(),
            scope: "global".to_string(),
            weight: 100,
            copy_text: String::new(),
            modules: Vec::new(),
            created_at: 1,
        }
    }

    fn taken(names: &[&str]) -> HashSet<String> {
        names.iter().map(|name| name.to_string()).collect()
    }

    fn dictionary(name: &str, entries: usize) -> BundleDictionary {
        BundleDictionary {
            display_name: name.to_string(),
            format: "json".to_string(),
            enabled: true,
            entries: (0..entries)
                .map(|index| DictionaryEntry {
                    cn: format!("中文{index}"),
                    en: format!("en{index}"),
                })
                .collect(),
            artists: vec![preset(&format!("画师-{name}"), "artist", None)],
            tags: vec![preset(&format!("Tag-{name}"), "dictionary", None)],
        }
    }

    #[test]
    fn unique_label_appends_dot_numbers() {
        assert_eq!(unique_label("作品集", &taken(&[])), "作品集");
        assert_eq!(unique_label("作品集", &taken(&["作品集"])), "作品集·1");
        assert_eq!(
            unique_label("作品集", &taken(&["作品集", "作品集·1", "作品集·2"])),
            "作品集·3"
        );
        assert_eq!(unique_label("   ", &taken(&[])), FALLBACK_LABEL);
    }

    #[test]
    fn rename_policy_keeps_existing_and_suffixes_incoming() {
        let outcome = merge_presets(
            vec![preset("风格", "red", None)],
            Vec::new(),
            vec![preset("风格", "red", None)],
            &[],
            DuplicatePolicy::Rename,
        );
        assert_eq!(outcome.presets.len(), 2);
        assert_eq!(outcome.presets[0].label, "风格");
        assert_eq!(outcome.presets[1].label, "风格·1");
        assert_eq!(outcome.preset_stats.renamed, 1);
        assert_ne!(outcome.presets[0].id, outcome.presets[1].id, "重命名后 id 必须不同");
    }

    #[test]
    fn overwrite_policy_keeps_identity_but_replaces_fields() {
        let outcome = merge_presets(
            vec![preset("风格", "red", None)],
            Vec::new(),
            vec![Preset {
                english: "new english".to_string(),
                weight: 250,
                ..preset("风格", "blue", None)
            }],
            &[],
            DuplicatePolicy::Overwrite,
        );
        assert_eq!(outcome.presets.len(), 1);
        assert_eq!(outcome.presets[0].id, "p-风格", "覆盖保留原 id");
        assert_eq!(outcome.presets[0].created_at, 1, "覆盖保留原创建时间");
        assert_eq!(outcome.presets[0].english, "new english");
        assert_eq!(outcome.presets[0].color_id, "blue");
        assert_eq!(outcome.preset_stats.overwritten, 1);
    }

    #[test]
    fn renamed_folder_rewrites_member_folder_field() {
        let outcome = merge_presets(
            vec![preset("成员", "red", Some("组A"))],
            vec![PresetFolder {
                name: "组A".to_string(),
                color_id: "red".to_string(),
                expanded: false,
            }],
            vec![preset("新人", "red", Some("组A"))],
            &[PresetFolder {
                name: "组A".to_string(),
                color_id: "red".to_string(),
                expanded: true,
            }],
            DuplicatePolicy::Rename,
        );
        assert_eq!(outcome.folders.len(), 2);
        assert_eq!(outcome.folders[1].name, "组A·1");
        let moved = outcome
            .presets
            .iter()
            .find(|item| item.label == "新人")
            .expect("新人应当被导入");
        assert_eq!(moved.folder.as_deref(), Some("组A·1"), "成员必须跟着组名走");
    }

    #[test]
    fn same_name_different_color_is_not_a_folder_conflict() {
        let outcome = merge_presets(
            Vec::new(),
            vec![PresetFolder {
                name: "组A".to_string(),
                color_id: "red".to_string(),
                expanded: false,
            }],
            vec![preset("蓝成员", "blue", Some("组A"))],
            &[PresetFolder {
                name: "组A".to_string(),
                color_id: "blue".to_string(),
                expanded: false,
            }],
            DuplicatePolicy::Rename,
        );
        assert_eq!(outcome.folders.len(), 2, "同名不同色是两个组，不该被改名");
        assert_eq!(outcome.folders[1].name, "组A");
        assert_eq!(outcome.folder_stats.renamed, 0);
    }

    #[test]
    fn duplicate_id_in_bundle_is_regenerated() {
        let outcome = merge_presets(
            vec![preset("旧", "red", None)],
            Vec::new(),
            vec![Preset {
                id: "p-旧".to_string(),
                ..preset("新的", "red", None)
            }],
            &[],
            DuplicatePolicy::Rename,
        );
        assert_eq!(outcome.presets.len(), 2);
        assert_ne!(outcome.presets[0].id, outcome.presets[1].id);
    }

    #[test]
    fn library_overwrite_removes_duplicate_from_any_file() {
        let files = vec![
            LibraryFile {
                file: "artists.json".to_string(),
                items: vec![preset("dairi", "artist", None)],
            },
            LibraryFile {
                file: "dictionaries/画师表/artists.json".to_string(),
                items: vec![preset("别的", "artist", None)],
            },
        ];
        let outcome = merge_library_items(
            files,
            "artists.json",
            vec![preset("别的", "artist", None)],
            DuplicatePolicy::Overwrite,
        );
        let merged: Vec<&Preset> = outcome
            .files
            .iter()
            .flat_map(|file| file.items.iter())
            .collect();
        assert_eq!(merged.len(), 2, "覆盖应当取代同名那条，而不是并存");
        assert_eq!(
            merged.iter().filter(|item| item.label == "别的").count(),
            1
        );
        assert!(outcome
            .dirty
            .iter()
            .any(|file| file == "dictionaries/画师表/artists.json"));
    }

    #[test]
    fn library_rename_keeps_both_and_only_touches_root() {
        let files = vec![LibraryFile {
            file: "tags.json".to_string(),
            items: vec![preset("长发", "dictionary", None)],
        }];
        let outcome = merge_library_items(
            files,
            "tags.json",
            vec![preset("长发", "dictionary", None)],
            DuplicatePolicy::Rename,
        );
        assert_eq!(outcome.files[0].items.len(), 2);
        assert_eq!(outcome.files[0].items[1].label, "长发·1");
        assert_eq!(outcome.stats.renamed, 1);
        assert_eq!(outcome.dirty, vec!["tags.json".to_string()]);
    }

    #[test]
    fn snapshots_follow_the_same_rename_rule() {
        let (merged, stats) = merge_snapshots(
            vec![snapshot("全局")],
            vec![snapshot("全局")],
            DuplicatePolicy::Rename,
        );
        assert_eq!(merged.len(), 2);
        assert_eq!(merged[1].name, "全局·1");
        assert_eq!(stats.renamed, 1);
    }

    #[test]
    fn dictionary_rename_moves_the_whole_trio() {
        let existing = vec![DictionaryItem {
            id: "画师表/translation.json".to_string(),
            display_name: "画师表".to_string(),
            label: "画师表".to_string(),
            file: "画师表/translation.json".to_string(),
            order: 0,
            enabled: true,
            entry_count: 10,
            format: "csv".to_string(),
            imported_at: 1,
        }];
        let result = plan_dictionaries(
            &existing,
            &[dictionary("画师表", 3)],
            DuplicatePolicy::Rename,
            &HashSet::new(),
        );
        assert_eq!(result.plans.len(), 1);
        let plan = &result.plans[0];
        assert_eq!(plan.display_name, "画师表·1");
        assert_eq!(plan.folder, "画师表·1", "文件夹名必须跟着改，否则三件套会错位");
        assert!(plan.overwrite.is_none());
        assert_eq!(result.stats.renamed, 1);
        assert_eq!(plan.artists.len(), 1, "画师跟词典一起搬");
        assert_eq!(plan.tags.len(), 1, "Tag 也跟词典一起搬");
    }

    #[test]
    fn dictionary_overwrite_keeps_order_and_enabled() {
        let existing = vec![DictionaryItem {
            id: "老词典/translation.json".to_string(),
            display_name: "老词典".to_string(),
            label: "老词典".to_string(),
            file: "老词典/translation.json".to_string(),
            order: 7,
            enabled: false,
            entry_count: 10,
            format: "csv".to_string(),
            imported_at: 1,
        }];
        let result = plan_dictionaries(
            &existing,
            &[dictionary("老词典", 2)],
            DuplicatePolicy::Overwrite,
            &HashSet::new(),
        );
        let plan = &result.plans[0];
        assert_eq!(plan.folder, "老词典");
        assert_eq!(plan.order, 7, "覆盖不该打乱用户排好的优先序");
        assert!(!plan.enabled, "覆盖不该偷偷把停用的词典打开");
        assert_eq!(plan.entries.len(), 2);
        assert_eq!(result.stats.overwritten, 1);
    }

    #[test]
    fn empty_dictionary_is_skipped_instead_of_creating_an_empty_shell() {
        let result = plan_dictionaries(
            &[],
            &[dictionary("空的", 0)],
            DuplicatePolicy::Rename,
            &HashSet::new(),
        );
        assert!(result.plans.is_empty());
        assert_eq!(result.skipped, 1);
    }
}
