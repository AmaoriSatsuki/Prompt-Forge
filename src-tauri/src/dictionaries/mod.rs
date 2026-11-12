//! 本地词典系统（D49 / D50）。
//!
//! 职责：
//! - 解析外部文件（CSV / JSON / SQLite）→ 统一的标准化 JSON `[{"cn","en"}]`；
//! - 维护 `%APPDATA%\com.promptforge.app\dictionaries\` 里的词典文件与优先级索引；
//! - 给前端提供「检查字段 / 导入 / 列表 / 条目 / 启停 / 排序 / 删除 / 重扫」。
//!
//! 索引放在**应用数据根目录**（`dictionary-index.json`），不放词典文件夹里 ——
//! 这样用户点「打开词典文件夹」看到的只有自己的词典文件，不会多出一个看不懂的文件。
//!
//! 匹配**不在这里做**：条目一次性交给前端建 Map（切片在输入/渲染路径上，逐个走 IPC 不划算），
//! 匹配规则是纯函数 `src/utils/glossary.ts`，可离线断言。

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager};

use crate::error::AppError;
use crate::models::{
    DictionaryEntry, DictionaryEntryGroup, DictionaryImportReport, DictionaryIndex,
    DictionaryInspection, DictionaryItem, DictionaryList, DictionaryTable, LibraryFile, Preset,
};
use crate::storage;

pub mod parse;

const INDEX_FILE: &str = "dictionary-index.json";
const DIR_NAME: &str = "dictionaries";

/// 大词典只提示、不拦截（用户口径：不卡死，只提示可能引起翻译卡顿）
const BIG_FILE_BYTES: u64 = 50 * 1024 * 1024;
const BIG_ENTRY_COUNT: usize = 500_000;

/// 白名单：中文候选键（比较前会去掉空白、下划线、连字符并转小写）
const CN_KEYS: &[&str] = &[
    "cn",
    "chinese",
    "zh",
    "中文",
    "中文名",
    "name_cn",
    "cn_name",
    "translation",
    "中文翻译",
];

/// 白名单：英文候选键（含「提示词」概念：tag / tags / prompt / 提示词 / 标签）
///
/// 2026 轮用户要求把 `name` 也纳入英文候选：社区大词典常见「cn_name / name」两列，
/// 这样就能和 `cn_name` 配成一对、走静默导入，不必再手动选字段。
const EN_KEYS: &[&str] = &[
    "en",
    "english",
    "英文",
    "英文名",
    "name_en",
    "en_name",
    "name",
    "tag",
    "tags",
    "prompt",
    "提示词",
    "标签",
];

/// 画师判定列（D62）：表头命中 `category` 就算有这一列。
/// `find_key` 会去掉空白 / 下划线 / 连字符 / 点并转小写，因此 `Category`、`category` 都能认。
const CATEGORY_KEYS: &[&str] = &["category"];

/// 画师库文件名（与 presets.json 同一个目录、同一套 JSON 形状）。
///
/// D87 起它有两个位置：**应用数据根目录**的 `artists.json`（手工新增 / 历史遗留），
/// 以及每部词典文件夹里的 `artists.json`（导入时派生）。
const ARTISTS_FILE: &str = "artists.json";

/// Tag 库文件名（D86）：与画师库同构 —— 同一套 `Preset` 形状、同一套原子写。
/// 词典导入时把「非画师行」同时写进来，供用户在 Tag 库里挑选、右键转成自己的胶囊。
/// D87 起同样是两个位置（根目录 + 每部词典文件夹）。
const TAGS_FILE: &str = "tags.json";

/// 文件夹形态里的翻译流文件名（D87）：`dictionaries/<文件夹>/translation.json`
const TRANSLATION_FILE: &str = "translation.json";

/// 热度列（D63）：画师只有 10–99 作品的长尾占 83%，全量导入既慢又没意义。
/// 表里存在这一列时，`post_count < ARTIST_MIN_POST_COUNT` 的画师行会被过滤；
/// 这一列不存在时**不做过滤**（保持兼容，不因为缺列就导不进画师）。
const POST_COUNT_KEYS: &[&str] = &["post_count", "postcount", "posts", "count"];

/// 画师热度阈值（D63）：只导入作品数 ≥ 100 的画师（用户 2026 轮口径）
const ARTIST_MIN_POST_COUNT: i64 = 100;

// ---------------------------------------------------------------------------
// 路径
// ---------------------------------------------------------------------------

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map_err(|error| AppError::new("IO", "无法定位应用数据目录").with_detail(error.to_string()))
}

fn index_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    Ok(app_data_dir(app)?.join(INDEX_FILE))
}

/// 词典目录：`%APPDATA%\com.promptforge.app\dictionaries\`
pub fn dictionaries_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = app_data_dir(app)?.join(DIR_NAME);
    fs::create_dir_all(&dir).map_err(|error| AppError::io("创建词典目录失败", error))?;
    Ok(dir)
}

fn now_ts() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// 索引与扫描
// ---------------------------------------------------------------------------

fn read_index(path: &Path) -> Result<Vec<DictionaryItem>, AppError> {
    Ok(storage::read_json::<DictionaryIndex>(path)?
        .map(|index| index.items)
        .unwrap_or_default())
}

fn write_index(path: &Path, items: &[DictionaryItem]) -> Result<(), AppError> {
    storage::write_json(
        path,
        &DictionaryIndex {
            items: items.to_vec(),
        },
    )
}

/// 文件名必须只含文件名本身（不允许斜杠/`..`），且必须以 .json 结尾。
fn is_safe_file_name(name: &str) -> bool {
    !name.is_empty()
        && !name.contains(['/', '\\'])
        && name != "."
        && name != ".."
        && name.to_ascii_lowercase().ends_with(".json")
}

/// 相对路径（D87）：`名字.json`（历史平铺词典）或 `文件夹/名字.json`（一次导入一个文件夹）。
///
/// 只允许**一层**子目录，且每一段都必须过 `is_safe_file_name` —— 这样
/// 「索引里的 file 被手工改成 `../../windows/system32`」也走不出数据目录。
fn is_safe_rel_path(raw: &str) -> bool {
    let parts: Vec<&str> = raw.split('/').collect();
    match parts.len() {
        1 => is_safe_file_name(parts[0]),
        2 => {
            let folder = parts[0];
            !folder.is_empty()
                && folder != "."
                && folder != ".."
                && !folder.contains(['\\', ':'])
                && is_safe_file_name(parts[1])
        }
        _ => false,
    }
}

/// `文件夹/名字.json` → 文件夹；平铺文件返回 None。
fn folder_of_rel(raw: &str) -> Option<&str> {
    raw.split_once('/').map(|(folder, _)| folder)
}

fn file_stem(name: &str) -> String {
    Path::new(name)
        .file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| name.to_string())
}

/// 界面上显示的词典名：优先用户命名，其次文件名词干（旧索引兼容）。
fn display_name_of(item: &DictionaryItem) -> String {
    if !item.display_name.trim().is_empty() {
        item.display_name.clone()
    } else if !item.label.trim().is_empty() {
        item.label.clone()
    } else {
        file_stem(&item.file)
    }
}

/// 把来源文件名清洗成可以安全落盘的词干：
/// 去掉 Windows 不允许的字符、首尾空白与点号；清洗后为空就用「词典」。
///
/// D115 起 `bundle` 规划词典文件夹名时也用它 —— 三部曲（翻译 / 画师 / Tag）
/// 的文件夹名必须与「重命名」规则同一套清洗，否则显示名与文件夹名会分叉。
pub(crate) fn sanitize_stem(raw: &str) -> String {
    let mut cleaned: String = raw
        .chars()
        .filter(|ch| !matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') && !ch.is_control())
        .collect();
    cleaned = cleaned.trim().trim_matches('.').trim().to_string();
    if cleaned.is_empty() {
        "词典".to_string()
    } else {
        cleaned
    }
}

/// 文件夹名冲突时依次尝试 `名 (2)`、`名 (3)` ……（D87：一次导入一个文件夹）
fn unique_folder_name(dir: &Path, stem: &str) -> String {
    if !dir.join(stem).exists() {
        return stem.to_string();
    }
    let mut index = 2;
    loop {
        let candidate = format!("{stem} ({index})");
        if !dir.join(&candidate).exists() {
            return candidate;
        }
        index += 1;
    }
}

fn parse_standard_entries(raw: &str) -> Result<Vec<DictionaryEntry>, AppError> {
    let list: Vec<DictionaryEntry> = serde_json::from_str(raw).map_err(|error| {
        AppError::new("DICT_PARSE", "该词典文件无法解析").with_detail(error.to_string())
    })?;
    Ok(list
        .into_iter()
        .filter(|entry| !entry.cn.trim().is_empty() && !entry.en.trim().is_empty())
        .collect())
}

fn read_standard_entries(path: &Path) -> Result<Vec<DictionaryEntry>, AppError> {
    let raw = fs::read_to_string(path).map_err(|error| AppError::io("读取词典文件失败", error))?;
    if raw.trim().is_empty() {
        return Ok(Vec::new());
    }
    parse_standard_entries(&raw)
}

/// 纯函数：把索引与实际目录对齐。
///
/// - 文件（或文件夹里的翻译文件）被手动删除 → 从索引剔除，并返回它的显示名（前端提示「已移除」）；
/// - 目录里多出未登记的 `*.json`（用户自己复制进来的标准词典）→ 自动收录，排在最后、默认启用；
/// - **D87**：目录里多出未登记的**文件夹**（内部有 `translation.json`）→ 同样收录，
///   这类文件夹就是「一次导入 = 一个文件夹」（翻译 / Tag / 画师三份文件都在里面）。
fn sync_items(items: Vec<DictionaryItem>, dir: &Path) -> (Vec<DictionaryItem>, Vec<String>) {
    let mut removed = Vec::new();
    let mut kept: Vec<DictionaryItem> = Vec::new();
    // D87 修复：同一个文件被登记了多次（历史 bug 留下的重复条目）→ 只保留第一条。
    // 用户实测：一次导入出现过两条同名词典，旧索引因此写了重复项，这里顺便自愈。
    let mut seen_files: HashSet<String> = HashSet::new();
    for mut item in items {
        if !seen_files.insert(item.file.clone()) {
            continue;
        }
        if is_safe_rel_path(&item.file) && dir.join(&item.file).is_file() {
            // 旧索引没有 displayName（2026 轮之前）：回落到 label / 文件名词干
            if item.display_name.trim().is_empty() {
                item.display_name = if !item.label.trim().is_empty() {
                    item.label.clone()
                } else {
                    file_stem(&item.file)
                };
            }
            kept.push(item);
        } else {
            removed.push(display_name_of(&item));
        }
    }

    let mut known: HashSet<String> = kept.iter().map(|item| item.file.clone()).collect();
    let mut discovered: Vec<DictionaryItem> = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        let mut found: Vec<(String, String, usize)> = Vec::new(); // (file 相对路径, 显示名词干, 条数)
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if path.is_file() {
                if !name.to_ascii_lowercase().ends_with(".json") || !is_safe_file_name(&name) {
                    continue;
                }
                let entry_count = read_standard_entries(&path)
                    .map(|list| list.len())
                    .unwrap_or(0);
                found.push((name.clone(), file_stem(&name), entry_count));
                continue;
            }
            if !path.is_dir() {
                continue;
            }
            // D87：文件夹形态（一次导入一个文件夹）——必须有 translation.json 才算词典
            let translation = path.join(TRANSLATION_FILE);
            if !translation.is_file() {
                continue;
            }
            let rel = format!("{name}/{TRANSLATION_FILE}");
            let entry_count = read_standard_entries(&translation)
                .map(|list| list.len())
                .unwrap_or(0);
            found.push((rel, name, entry_count));
        }
        for (file, stem, entry_count) in found {
            if known.contains(&file) {
                continue;
            }
            discovered.push(DictionaryItem {
                id: file.clone(),
                display_name: stem.clone(),
                label: stem,
                file: file.clone(),
                order: 0,
                enabled: true,
                entry_count: entry_count as i64,
                format: "json".to_string(),
                imported_at: now_ts(),
            });
            known.insert(file);
        }
    }
    // 排序稳定：先按已有序，再按文件名；新增的接在最后（order 递增）
    discovered.sort_by(|left, right| left.id.cmp(&right.id));
    let mut next_order = kept
        .iter()
        .map(|item| item.order)
        .max()
        .map(|value| value + 1)
        .unwrap_or(0);
    for item in &mut discovered {
        item.order = next_order;
        next_order += 1;
    }
    kept.extend(discovered);
    normalize_orders(&mut kept);
    (kept, removed)
}

/// 把 order 重排成 0..n（列表顺序就是优先级，越靠上越高）。
fn normalize_orders(items: &mut [DictionaryItem]) {
    items.sort_by(|left, right| {
        left.order
            .cmp(&right.order)
            .then_with(|| left.id.cmp(&right.id))
    });
    for (index, item) in items.iter_mut().enumerate() {
        item.order = index as i64;
    }
}

/// 按前端给的 id 顺序重排；索引里不存在/未提及的条目按原顺序补在后面。
///
/// 注意：这里**不能**调用 `normalize_orders`（它会按旧 order 重新排序，等于把重排结果撤销），
/// 而是直接按下标写新 order。
fn apply_reorder(items: &mut Vec<DictionaryItem>, ids: &[String]) {
    let mut ordered: Vec<DictionaryItem> = Vec::new();
    for id in ids {
        if let Some(position) = items.iter().position(|item| &item.id == id) {
            ordered.push(items.remove(position));
        }
    }
    ordered.extend(items.drain(..));
    for (index, item) in ordered.iter_mut().enumerate() {
        item.order = index as i64;
    }
    *items = ordered;
}

fn build_warnings(file_bytes: u64, entry_count: usize) -> Vec<String> {
    let mut warnings = Vec::new();
    if file_bytes > BIG_FILE_BYTES {
        warnings.push(format!(
            "该词典文件有 {:.1} MB，加载与翻译时可能引起卡顿",
            file_bytes as f64 / (1024.0 * 1024.0)
        ));
    }
    if entry_count > BIG_ENTRY_COUNT {
        warnings.push(format!(
            "该词典有 {entry_count} 条，翻译时逐段匹配可能引起卡顿"
        ));
    }
    warnings
}

// ---------------------------------------------------------------------------
// 字段智能识别
// ---------------------------------------------------------------------------

fn normalize_key(raw: &str) -> String {
    raw.chars()
        .filter(|ch| !ch.is_whitespace() && !matches!(ch, '_' | '-' | '.'))
        .collect::<String>()
        .to_lowercase()
}

fn find_key(fields: &[String], keys: &[&str]) -> Option<usize> {
    for (index, field) in fields.iter().enumerate() {
        let normalized = normalize_key(field);
        if keys.iter().any(|key| normalize_key(key) == normalized) {
            return Some(index);
        }
    }
    None
}

/// 白名单同时命中中文与英文才算「识别成功」（由调用方据此决定是否弹映射界面）。
fn suggest_fields(fields: &[String]) -> (Option<usize>, Option<usize>) {
    (find_key(fields, CN_KEYS), find_key(fields, EN_KEYS))
}

/// `category` 列的下标（没有就是 None）。
fn category_index(fields: &[String]) -> Option<usize> {
    find_key(fields, CATEGORY_KEYS)
}

/// 热度列的下标（D63）：`post_count` / `postcount` / `posts` / `count` 都认。
fn post_count_index(fields: &[String]) -> Option<usize> {
    find_key(fields, POST_COUNT_KEYS)
}

/// 该行是否属于画师库：`category` 列存在、且值 trim 后**恰好**是 `1`。
///
/// 用整串相等而不是 `contains`，避免 `10`、`1x` 被误判成画师。
fn is_artist_row(row: &[String], category: Option<usize>) -> bool {
    match category {
        Some(index) => row
            .get(index)
            .map(|value| value.trim() == "1")
            .unwrap_or(false),
        None => false,
    }
}

// ---------------------------------------------------------------------------
// 标准化
// ---------------------------------------------------------------------------

/// 英文值的清洗（D59）：历史词典常把标签写成 `final_fight` 这种**下划线**形式，
/// 而现在的通行写法是空格分隔，所以**导入时**统一把 `_` 换成空格。
///
/// 细节：
/// - 连续的空白（含制表符、全角空格）折成一个空格，首尾空白去掉 ——
///   否则 `a__b` 会留下两个空格，拼进提示词里很显眼；
/// - **只作用于导入**：已经落盘的词典文件不会被改写（用户口径：「已有的词典不用管」），
///   读取路径 `parse_standard_entries` 一个字符都不动；
/// - 只处理英文一侧：中文键保持原样。
fn normalize_english(raw: &str) -> String {
    raw.replace('_', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// 行 → 标准条目：trim、丢空、按 cn 去重（保留第一条）；英文顺带做下划线→空格（D59）。
///
/// `category` 列存在时，画师行（值为 1）在这里被**静默跳过**，不计入 skipped ——
/// 它们由 `build_artists` 转成画师条目（D62）。
fn normalize_rows(
    table: &parse::ParsedTable,
    cn_index: usize,
    en_index: usize,
    category: Option<usize>,
) -> Result<(Vec<DictionaryEntry>, i64, i64), AppError> {
    if cn_index >= table.fields.len() || en_index >= table.fields.len() {
        return Err(AppError::new("DICT_PARSE", "请选择有效的字段"));
    }
    if cn_index == en_index {
        return Err(AppError::new("DICT_PARSE", "中文与英文不能选择同一个字段"));
    }

    let mut seen: HashSet<String> = HashSet::new();
    let mut entries: Vec<DictionaryEntry> = Vec::new();
    let mut skipped = 0i64;
    let mut duplicates = 0i64;

    for row in &table.rows {
        if is_artist_row(row, category) {
            continue;
        }
        let cn = row.get(cn_index).map(|value| value.trim()).unwrap_or("").to_string();
        let en = normalize_english(row.get(en_index).map(|value| value.as_str()).unwrap_or(""));
        if cn.is_empty() || en.is_empty() {
            skipped += 1;
            continue;
        }
        if !seen.insert(cn.clone()) {
            duplicates += 1;
            continue;
        }
        entries.push(DictionaryEntry { cn, en });
    }

    Ok((entries, skipped, duplicates))
}

// ---------------------------------------------------------------------------
// 画师库（D62）：借用 Preset 形状，但物理隔离写在 artists.json
// ---------------------------------------------------------------------------

/// 画师中文名：下划线→空格（复用 D59 的清洗）、首尾去空白、**开头补 `@`**。
fn normalize_artist_label(raw: &str) -> String {
    let text = normalize_english(raw);
    if text.is_empty() {
        return text;
    }
    if text.starts_with('@') {
        text
    } else {
        format!("@{text}")
    }
}

/// 画师英文：下划线→空格 → 开头补 `@` → 括号转义。
fn normalize_artist_english(raw: &str) -> String {
    let text = normalize_english(raw);
    if text.is_empty() {
        return text;
    }
    let with_at = if text.starts_with('@') {
        text
    } else {
        format!("@{text}")
    };
    escape_artist_parens(&with_at)
}

/// 括号转义，而且**幂等**：先把括号前面已有的反斜杠全部吃掉，再统一补一个。
///
/// 这样 `mika (blue archive)`、`mika \(blue archive\)`、`mika \\(blue)` 反复清洗
/// 都会收敛到同一个结果（`\(`），不会越转义越多。
fn escape_artist_parens(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 4);
    for ch in value.chars() {
        if ch == '(' || ch == ')' {
            while out.ends_with('\\') {
                out.pop();
            }
            out.push('\\');
        }
        out.push(ch);
    }
    out
}

/// 把画师行转成 Preset（id 由 `@label` 派生，重复导入不会翻倍）。
///
/// **D63**：`post_count` 列存在时
/// - 权重直接取 `post_count`（原值）—— 列表本来就按权重降序排，等于按人气排；
/// - 低于 `ARTIST_MIN_POST_COUNT` 的行过滤掉（10–99 作品的画师长尾占 83%，全量进来只会拖慢导入与加载）。
fn build_artists(
    table: &parse::ParsedTable,
    cn_index: usize,
    en_index: usize,
    category: usize,
    post_count_index: Option<usize>,
    min_post_count: i64,
) -> (Vec<Preset>, i64, i64) {
    let now = now_ts();
    let mut seen: HashSet<String> = HashSet::new();
    let mut artists: Vec<Preset> = Vec::new();
    let mut skipped = 0i64;
    let mut filtered = 0i64;

    for row in &table.rows {
        if !is_artist_row(row, Some(category)) {
            continue;
        }
        // 热度：有列才过滤；没有列时保持 weight = 100（与普通预设一致）
        let post_count = post_count_index
            .and_then(|index| row.get(index))
            .and_then(|value| value.trim().parse::<i64>().ok());
        if let Some(count) = post_count {
            // 阈值 0 = 不过滤（D65：用户在导入命名框里可改）
            if min_post_count > 0 && count < min_post_count {
                filtered += 1;
                continue;
            }
        }
        let label = normalize_artist_label(row.get(cn_index).map(|v| v.as_str()).unwrap_or(""));
        let english = normalize_artist_english(row.get(en_index).map(|v| v.as_str()).unwrap_or(""));
        if label.is_empty() || english.is_empty() {
            skipped += 1;
            continue;
        }
        if !seen.insert(label.clone()) {
            continue;
        }
        artists.push(Preset {
            id: format!("artist:{label}"),
            label,
            english,
            weight: post_count.unwrap_or(100).max(0),
            color_id: crate::dictionaries::ARTIST_COLOR_ID.to_string(),
            folder: None,
            created_at: now,
            updated_at: now,
        });
    }

    (artists, skipped, filtered)
}

/// 把词典条目转成 Tag 库条目（D86 / D87）。
///
/// - id 形如 `tag:<中文>`；
/// - `weight`：**有数量列（`count` / `post_count` / `posts`）时取它的值**，否则 100
///   （D88：用户要求「Tag 库导入时自动带出权重，和画师库一样」，这样列表天然按热度排）；
/// - `color_id` 固定为词典色 `dictionary`（与 `T` 色块、拖进输入框的 Tag 同源取色）。
///
/// **D87 起不再需要「来源词典 id」**：每部词典的 Tag 写在它自己的文件夹里，
/// 删词典 = 删文件夹，因此条目本身可以完全是普通 `Preset`（与预设库同一种形状）。
fn build_tags(entries: &[DictionaryEntry], weights: &HashMap<String, i64>) -> Vec<Preset> {
    let now = now_ts();
    entries
        .iter()
        .filter_map(|entry| {
            let cn = entry.cn.trim();
            let en = entry.en.trim();
            if cn.is_empty() || en.is_empty() {
                return None;
            }
            Some(Preset {
                id: format!("tag:{cn}"),
                label: cn.to_string(),
                english: en.to_string(),
                // 与画师库同一套口径：负数夹到 0（历史数据里偶尔有 -1）
                weight: weights.get(cn).copied().unwrap_or(100).max(0),
                color_id: TAG_COLOR_ID.to_string(),
                folder: None,
                created_at: now,
                updated_at: now,
            })
        })
        .collect()
}

/// 从表里抽出「中文 → 数量」映射（D88），给 Tag 权重用。
///
/// 口径**与 `normalize_rows` 完全一致**：跳过画师行、中文或英文为空的行，
/// 同一个中文出现多次时只认第一条（与词典那一侧的「保留第一条」对齐）。
/// 没有数量列时返回空表 —— 于是所有 Tag 的权重都是默认 100。
fn row_weights(
    table: &parse::ParsedTable,
    cn_index: usize,
    en_index: usize,
    category: Option<usize>,
    count_index: Option<usize>,
) -> HashMap<String, i64> {
    let mut weights: HashMap<String, i64> = HashMap::new();
    let Some(count_index) = count_index else {
        return weights;
    };
    for row in &table.rows {
        if is_artist_row(row, category) {
            continue;
        }
        let cn = row.get(cn_index).map(|value| value.trim()).unwrap_or("");
        let en = normalize_english(row.get(en_index).map(|value| value.as_str()).unwrap_or(""));
        if cn.is_empty() || en.is_empty() {
            continue;
        }
        let count = row
            .get(count_index)
            .and_then(|value| value.trim().parse::<i64>().ok())
            .unwrap_or(100);
        // 只认第一条（与词典侧去重口径一致）
        weights.entry(cn.to_string()).or_insert(count);
    }
    weights
}

/// Tag 库的专属色 id（前端 colors.ts 里的 `dictionary`，D85 起叫 Tag 块）
const TAG_COLOR_ID: &str = "dictionary";

/// 画师库的专属色 id（前端 colors.ts 里的 `artist`）。
const ARTIST_COLOR_ID: &str = "artist";

// ---------------------------------------------------------------------------
// 对外的操作（命令层调用）
// ---------------------------------------------------------------------------

pub fn inspect_file(path_str: &str) -> Result<DictionaryInspection, AppError> {
    let path = PathBuf::from(path_str);
    if !path.is_file() {
        return Err(AppError::new("DICT_NOT_FOUND", "找不到该文件（可能已被移动或删除）"));
    }
    let (format, tables) = parse::inspect(&path)?;
    let tables = tables
        .into_iter()
        .map(|table| {
            let (cn, en) = suggest_fields(&table.fields);
            DictionaryTable {
                name: table.name,
                fields: table.fields,
                sample_rows: table.rows,
                suggested_cn_index: cn,
                suggested_en_index: en,
            }
        })
        .collect();
    Ok(DictionaryInspection {
        format: format.as_str().to_string(),
        tables,
    })
}

pub fn import_file(
    dir: &Path,
    index: &Path,
    source: &Path,
    table: Option<&str>,
    cn_index: usize,
    en_index: usize,
    display_name: Option<&str>,
    min_post_count: i64,
) -> Result<DictionaryImportReport, AppError> {
    if !source.is_file() {
        return Err(AppError::new("DICT_NOT_FOUND", "找不到该文件（可能已被移动或删除）"));
    }
    let format = parse::detect_format(source)?;
    let parsed = parse::read_table_all(source, table)?;

    // D62：有 category 列就把「值为 1」的行拨给画师库，其余仍走普通词典
    let category = category_index(&parsed.fields);
    let (entries, skipped, duplicates) = normalize_rows(&parsed, cn_index, en_index, category)?;
    // D63：热度列（post_count / posts / count）—— 有它才按热度过滤并当权重
    let post_count_column = post_count_index(&parsed.fields);
    let (artists, artist_skipped, artist_filtered) = match category {
        Some(column) => build_artists(
            &parsed,
            cn_index,
            en_index,
            column,
            post_count_column,
            min_post_count,
        ),
        None => (Vec::new(), 0, 0),
    };
    let artist_count = artists.len() as i64;
    // D86：同一份「非画师行」既进词典（翻译用），也进 Tag 库（挑词用）
    // D88：Tag 的权重与画师库同一套口径 —— 有数量列就用它的值，没有就 100
    let tags = build_tags(
        &entries,
        &row_weights(&parsed, cn_index, en_index, category, post_count_column),
    );
    let tag_count = tags.len() as i64;

    if entries.is_empty() && artists.is_empty() {
        return Err(AppError::new(
            "DICT_PARSE",
            "没有可导入的行（中文或英文为空）",
        ));
    }

    /*
     * D87：**一次导入 = 一个文件夹**。
     *
     *   dictionaries/<文件夹>/translation.json  翻译流
     *   dictionaries/<文件夹>/tags.json         Tag 库（本次派生）
     *   dictionaries/<文件夹>/artists.json      画师（本次派生）
     *
     * 三份文件各写一次、**不与任何别的词典合并** —— 这正是导入从「二次复杂度」变成
     * 「一次线性写盘」的原因；删除词典时整个文件夹删掉，派生数据自然一起消失，
     * 因此**不需要在每条上记来源字段**。
     *
     * ⚠️ 顺序很重要（踩过的坑）：索引必须在**建文件夹之前**对齐一次。
     * 首版是「先建文件夹、再 sync_items」，于是 sync 的「自动收录未登记文件夹」
     * 把这个刚建好的文件夹当成手工投放的词典收了进去，随后我们又 push 了 `created`
     * —— 一次导入在列表里出现**两条**同名词典（用户实测报的 bug）。
     * 现在：先算文件夹名 → 对齐索引（此时文件夹还不存在）→ 建文件夹写文件 → 登记。
     */
    let raw_stem = display_name
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| file_stem(&source.to_string_lossy()));
    let stem = sanitize_stem(&raw_stem);
    let folder_name = unique_folder_name(dir, &stem);

    // 词典部分可能是 0 条（整个文件都是画师行）：这时**不登记索引**，
    // 免得词典列表里多出一部空词典（但文件夹里的 artists.json 照样进了画师库）。
    let mut index_items = if entries.is_empty() {
        Vec::new()
    } else {
        sync_items(read_index(index)?, dir).0
    };

    let folder = dir.join(&folder_name);
    fs::create_dir_all(&folder).map_err(|error| AppError::io("创建词典文件夹失败", error))?;

    if !entries.is_empty() {
        storage::write_json(&folder.join(TRANSLATION_FILE), &entries)?;
    }
    if !tags.is_empty() {
        storage::write_presets(&folder.join(TAGS_FILE), &tags)?;
    }
    if !artists.is_empty() {
        storage::write_presets(&folder.join(ARTISTS_FILE), &artists)?;
    }

    let file_bytes = source.metadata().map(|meta| meta.len()).unwrap_or(0);
    let warnings = build_warnings(file_bytes, entries.len());

    let item = if entries.is_empty() {
        None
    } else {
        let created = DictionaryItem {
            id: format!("{folder_name}/{TRANSLATION_FILE}"),
            display_name: folder_name.clone(),
            label: folder_name.clone(),
            file: format!("{folder_name}/{TRANSLATION_FILE}"),
            // 新导入的排在最后（order 先给当前最大 +1，再由 normalize_orders 规整）
            order: index_items
                .iter()
                .map(|entry| entry.order)
                .max()
                .map(|value| value + 1)
                .unwrap_or(0),
            enabled: true,
            entry_count: entries.len() as i64,
            format: format.as_str().to_string(),
            imported_at: now_ts(),
        };
        index_items.push(created.clone());
        normalize_orders(&mut index_items);
        write_index(index, &index_items)?;
        Some(created)
    };

    Ok(DictionaryImportReport {
        item,
        skipped,
        duplicates,
        artist_count,
        artist_skipped,
        artist_filtered,
        tag_count,
        warnings,
    })
}

pub fn import(
    app: &AppHandle,
    source: &Path,
    table: Option<&str>,
    cn_index: usize,
    en_index: usize,
    display_name: Option<&str>,
    min_post_count: Option<i64>,
) -> Result<DictionaryImportReport, AppError> {
    let dir = dictionaries_dir(app)?;
    let index = index_path(app)?;
    import_file(
        &dir,
        &index,
        source,
        table,
        cn_index,
        en_index,
        display_name,
        // 前端没传就用默认阈值（D65：命名弹窗里可改，默认 100）
        min_post_count.unwrap_or(ARTIST_MIN_POST_COUNT),
    )
}

pub fn list(app: &AppHandle) -> Result<DictionaryList, AppError> {
    let dir = dictionaries_dir(app)?;
    let index = index_path(app)?;
    let (items, removed) = sync_items(read_index(&index)?, &dir);
    write_index(&index, &items)?;
    Ok(DictionaryList { items, removed })
}

pub fn entries(app: &AppHandle) -> Result<Vec<DictionaryEntryGroup>, AppError> {
    let dir = dictionaries_dir(app)?;
    let items = list(app)?.items;
    let mut groups = Vec::new();
    for item in items.into_iter().filter(|item| item.enabled) {
        let path = dir.join(&item.file);
        // 单个文件坏了不影响其它词典：直接跳过（列表里仍可删除它）
        if let Ok(list) = read_standard_entries(&path) {
            groups.push(DictionaryEntryGroup {
                id: item.id,
                entries: list,
            });
        }
    }
    Ok(groups)
}

pub fn set_enabled(app: &AppHandle, id: &str, enabled: bool) -> Result<(), AppError> {
    let dir = dictionaries_dir(app)?;
    let index = index_path(app)?;
    let (mut items, _removed) = sync_items(read_index(&index)?, &dir);
    let item = items
        .iter_mut()
        .find(|item| item.id == id)
        .ok_or_else(|| AppError::new("DICT_NOT_FOUND", "找不到该词典（可能已被删除）"))?;
    item.enabled = enabled;
    write_index(&index, &items)
}

pub fn reorder(app: &AppHandle, ids: Vec<String>) -> Result<(), AppError> {
    let dir = dictionaries_dir(app)?;
    let index = index_path(app)?;
    let (mut items, _removed) = sync_items(read_index(&index)?, &dir);
    apply_reorder(&mut items, &ids);
    write_index(&index, &items)
}

pub fn delete(app: &AppHandle, id: &str, delete_file: bool) -> Result<(), AppError> {
    let dir = dictionaries_dir(app)?;
    let index = index_path(app)?;
    let mut items = read_index(&index)?;
    let position = items
        .iter()
        .position(|item| item.id == id)
        .ok_or_else(|| AppError::new("DICT_NOT_FOUND", "找不到该词典（可能已被删除）"))?;
    let item = items.remove(position);

    /*
     * 索引**先落盘**，再去删磁盘文件（D87 修补）。
     *
     * 踩过的坑：原来是「先删文件夹、删失败就 `?` 提前返回」——一旦 `remove_dir_all`
     * 中途失败（文件被占用之类），索引不会被写回，于是出现「文件夹已经空了、
     * 列表里还挂着一部 175534 条的词典」这种自相矛盾的状态。
     * 现在顺序反过来：列表状态永远自洽，删不掉的文件只是留在磁盘上（下次还能再删一次）。
     */
    normalize_orders(&mut items);
    write_index(&index, &items)?;

    if delete_file && is_safe_rel_path(&item.file) {
        /*
         * D87：文件夹形态（`<文件夹>/translation.json`）→ **整个文件夹删掉**，
         * 里面的 tags.json / artists.json 随之消失 —— 这就是「三个文件捆绑」的实现方式，
         * 不需要扫描任何库文件，也不需要每条上记来源字段。
         *
         * 历史平铺词典（`<名字>.json`）只删它自己：当年派生的画师 / Tag 已经并进根目录的
         * artists.json / tags.json，无法追溯来源，因此保持原样（见 MANUAL-CHECKLIST 的说明）。
         */
        match folder_of_rel(&item.file) {
            Some(folder) => {
                let path = dir.join(folder);
                if path.is_dir() {
                    fs::remove_dir_all(&path)
                        .map_err(|error| AppError::io("删除词典文件夹失败", error))?;
                }
            }
            None => {
                let path = dir.join(&item.file);
                if path.is_file() {
                    fs::remove_file(&path)
                        .map_err(|error| AppError::io("删除词典文件失败", error))?;
                }
            }
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// 多文件库（D87）：画师 / Tag 现在是「根目录一份 + 每部词典文件夹一份」
// ---------------------------------------------------------------------------

/// 库文件的相对路径（相对**应用数据目录**）：`tags.json` 或 `dictionaries/<文件夹>/tags.json`。
fn is_safe_library_path(raw: &str, file_name: &str) -> bool {
    if raw == file_name {
        return true;
    }
    match raw.strip_prefix(&format!("{DIR_NAME}/")) {
        Some(rest) => is_safe_rel_path(rest)
            && rest.ends_with(&format!("/{file_name}"))
            && folder_of_rel(rest).is_some(),
        None => false,
    }
}

/// 读一个库的全部文件（D87）：根目录那份 + 每部词典文件夹里那份。
///
/// 返回 `[{ file, items }]`，`file` 是**相对应用数据目录**的路径 —— 前端把它记在
/// 内存里（不落盘），改权重 / 删条时据此只重写那一个文件。
pub fn load_library(app: &AppHandle, kind: &str) -> Result<Vec<LibraryFile>, AppError> {
    let file_name = library_file_name(kind)?;
    let base = app_data_dir(app)?;
    let mut files: Vec<LibraryFile> = Vec::new();

    // 根目录那份（手工新增的条目 / 历史遗留）
    let root = base.join(file_name);
    files.push(LibraryFile {
        file: file_name.to_string(),
        items: storage::read_presets(&root)?,
    });

    // 每部词典文件夹里那份
    if let Ok(entries) = fs::read_dir(base.join(DIR_NAME)) {
        let mut folders: Vec<String> = entries
            .flatten()
            .filter(|entry| entry.path().is_dir())
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .collect();
        folders.sort();
        for folder in folders {
            let path = base.join(DIR_NAME).join(&folder).join(file_name);
            if !path.is_file() {
                continue;
            }
            files.push(LibraryFile {
                file: format!("{DIR_NAME}/{folder}/{file_name}"),
                items: storage::read_presets(&path)?,
            });
        }
    }

    Ok(files)
}

/// 写回一个库文件（D87）：只碰这一个文件，别的词典的文件一个字节都不动。
pub fn save_library(
    app: &AppHandle,
    kind: &str,
    file: &str,
    items: Vec<Preset>,
) -> Result<(), AppError> {
    let file_name = library_file_name(kind)?;
    if !is_safe_library_path(file, file_name) {
        return Err(AppError::new("IO", "库文件路径不合法"));
    }
    let base = app_data_dir(app)?;
    let path = base.join(file);
    // 文件夹形态：文件夹必须已经存在（词典被删了就不该再有它的库文件）
    if let Some(folder) = file.strip_prefix(&format!("{DIR_NAME}/")) {
        let folder = folder.split('/').next().unwrap_or("");
        if !base.join(DIR_NAME).join(folder).is_dir() {
            return Ok(());
        }
    }
    storage::write_presets(&path, &items)
}

/// `kind` → 文件名（前端传 `'artists'` / `'tags'`）
fn library_file_name(kind: &str) -> Result<&'static str, AppError> {
    match kind {
        "artists" => Ok(ARTISTS_FILE),
        "tags" => Ok(TAGS_FILE),
        _ => Err(AppError::new("IO", "未知的库类型")),
    }
}

/* ---------- 全库导入导出要用的读写口（D115 / D116） ---------- */

/// 当前索引（不触发 `sync_items`，也不写盘）：导入前的冲突判断用
pub(crate) fn index_snapshot(app: &AppHandle) -> Result<Vec<DictionaryItem>, AppError> {
    read_index(&index_path(app)?)
}

/// 写回整份索引（导入：新增词典登记 / 覆盖词典更新条目数与时间）
pub(crate) fn write_index_items(
    app: &AppHandle,
    items: &[DictionaryItem],
) -> Result<(), AppError> {
    write_index(&index_path(app)?, items)
}

/// 读一部词典的翻译条目（导出用）
pub(crate) fn entries_of_item(
    app: &AppHandle,
    item: &DictionaryItem,
) -> Result<Vec<DictionaryEntry>, AppError> {
    let dir = dictionaries_dir(app)?;
    if !is_safe_rel_path(&item.file) {
        return Err(AppError::new("IO", "词典文件路径不合法"));
    }
    read_standard_entries(&dir.join(&item.file))
}

/// 词典目录下已存在的文件夹名（重命名时要避开它们，否则三件套会写进别人的文件夹）
pub(crate) fn dictionary_folders(app: &AppHandle) -> Result<HashSet<String>, AppError> {
    let dir = dictionaries_dir(app)?;
    let mut names = HashSet::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                names.insert(entry.file_name().to_string_lossy().to_string());
            }
        }
    }
    Ok(names)
}

pub fn rescan(app: &AppHandle) -> Result<DictionaryList, AppError> {
    list(app)
}

/// 打开词典文件夹（Windows：资源管理器）。
pub fn open_folder(app: &AppHandle) -> Result<(), AppError> {
    let dir = dictionaries_dir(app)?;
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        Command::new("explorer")
            .arg(&dir)
            .spawn()
            .map_err(|error| AppError::io("打开词典文件夹失败", error))?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// 测试（只测纯函数与解析，避免依赖 AppHandle）
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("test-tmp")
            .join(format!("dict-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("创建测试目录失败");
        dir
    }

    fn table(fields: &[&str], rows: &[&[&str]]) -> parse::ParsedTable {
        parse::ParsedTable {
            name: "t".to_string(),
            fields: fields.iter().map(|value| value.to_string()).collect(),
            rows: rows
                .iter()
                .map(|row| row.iter().map(|value| value.to_string()).collect())
                .collect(),
        }
    }

    #[test]
    fn suggest_fields_matches_whitelist_with_separators() {
        let fields = vec![
            "ID".to_string(),
            "中文名".to_string(),
            "Name_EN".to_string(),
            "备注".to_string(),
        ];
        assert_eq!(suggest_fields(&fields), (Some(1), Some(2)));
    }

    #[test]
    fn suggest_fields_is_none_when_only_one_side_matches() {
        let fields = vec!["cn".to_string(), "说明".to_string()];
        assert_eq!(suggest_fields(&fields), (Some(0), None));
    }

    /// 社区大词典常见「cn_name / name」两列：`name` 已纳入英文候选，因此能一键静默导入。
    #[test]
    fn suggest_fields_treats_name_as_english() {
        let fields = vec!["cn_name".to_string(), "name".to_string()];
        assert_eq!(suggest_fields(&fields), (Some(0), Some(1)));
    }

    #[test]
    fn normalize_rows_trims_skips_empty_and_dedupes_by_cn() {
        let parsed = table(
            &["cn", "en"],
            &[
                &[" 千早爱音 ", " chihaya anon "],
                &["千早爱音", "second value"],
                &["", "空中文"],
                &["空英文", "  "],
                &["长崎素世", "nagasaki soyo"],
            ],
        );
        let (entries, skipped, duplicates) = normalize_rows(&parsed, 0, 1, None).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].cn, "千早爱音");
        assert_eq!(entries[0].en, "chihaya anon");
        assert_eq!(entries[1].cn, "长崎素世");
        assert_eq!(skipped, 2);
        assert_eq!(duplicates, 1);
    }

    #[test]
    fn normalize_rows_rejects_same_field_and_bad_index() {
        let parsed = table(&["cn", "en"], &[&["a", "b"]]);
        assert!(normalize_rows(&parsed, 0, 0, None).is_err());
        assert!(normalize_rows(&parsed, 0, 9, None).is_err());
    }

    /// 多对一：多个**不同**中文键可以指向同一个英文，去重不会把它们合并掉。
    #[test]
    fn normalize_rows_keeps_multi_to_one_mappings() {
        let parsed = table(
            &["cn", "en"],
            &[
                &["千早爱音", "chihaya anon"],
                &["爱音", "chihaya anon"],
                &["千早", "chihaya anon"],
            ],
        );
        let (entries, skipped, duplicates) = normalize_rows(&parsed, 0, 1, None).unwrap();
        assert_eq!(entries.len(), 3, "三个不同中文键都应保留");
        assert!(entries.iter().all(|entry| entry.en == "chihaya anon"));
        assert_eq!(skipped, 0);
        assert_eq!(duplicates, 0, "英文相同不算重复");
    }

    /// 去重只按中文：同一个中文出现多次时保留第一条，并计入 duplicates。
    #[test]
    fn normalize_rows_keeps_first_english_for_duplicate_chinese() {
        let parsed = table(
            &["cn", "en"],
            &[&["千早爱音", "chihaya anon"], &["千早爱音", "第二个英文"]],
        );
        let (entries, _skipped, duplicates) = normalize_rows(&parsed, 0, 1, None).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].en, "chihaya anon", "重复中文保留第一条");
        assert_eq!(duplicates, 1);
    }

    /// D59：历史词典的 `final_fight` 写法，导入时转成空格分隔。
    #[test]
    fn normalize_english_turns_underscores_into_spaces() {
        assert_eq!(normalize_english("final_fight"), "final fight");
        assert_eq!(normalize_english("a__b"), "a b", "连续下划线只留一个空格");
        assert_eq!(normalize_english("  _x_  "), "x", "首尾空白去掉");
        assert_eq!(
            normalize_english("masterpiece, best_quality"),
            "masterpiece, best quality"
        );
        assert_eq!(normalize_english("no-underscore"), "no-underscore", "连字符不动");
        assert_eq!(normalize_english("_"), "", "只有一个下划线等于空");
    }

    /// D59 落到整条导入：英文转空格、只有下划线的行被丢掉，去重口径不变。
    #[test]
    fn normalize_rows_converts_underscores_in_english() {
        let parsed = table(
            &["cn", "en"],
            &[
                &["千早爱音", "chihaya_anon"],
                &["空值", "_"],
                &["长崎素世", "nagasaki_soyo"],
            ],
        );
        let (entries, skipped, duplicates) = normalize_rows(&parsed, 0, 1, None).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].en, "chihaya anon");
        assert_eq!(entries[1].en, "nagasaki soyo");
        assert_eq!(skipped, 1, "英文只有下划线的行视为空行");
        assert_eq!(duplicates, 0);
    }

    #[test]
    fn sanitize_stem_drops_illegal_characters() {
        assert_eq!(sanitize_stem("我的:词典?"), "我的词典");
        assert_eq!(sanitize_stem("  . "), "词典");
    }

    #[test]
    fn unique_folder_name_appends_counter() {
        let dir = temp_dir("unique");
        fs::create_dir_all(dir.join("词典")).unwrap();
        assert_eq!(unique_folder_name(&dir, "词典"), "词典 (2)");
        fs::create_dir_all(dir.join("词典 (2)")).unwrap();
        assert_eq!(unique_folder_name(&dir, "词典"), "词典 (3)");
    }

    #[test]
    fn sync_items_drops_missing_files_and_adopts_new_json() {
        let dir = temp_dir("sync");
        fs::write(dir.join("a.json"), "[{\"cn\":\"甲\",\"en\":\"A\"}]").unwrap();
        fs::write(dir.join("ignored.txt"), "x").unwrap();

        let items = vec![
            DictionaryItem {
                id: "a.json".into(),
                display_name: "a".into(),
                label: "a".into(),
                file: "a.json".into(),
                order: 0,
                enabled: true,
                entry_count: 1,
                format: "json".into(),
                imported_at: 0,
            },
            DictionaryItem {
                id: "gone.json".into(),
                display_name: "gone".into(),
                label: "gone".into(),
                file: "gone.json".into(),
                order: 1,
                enabled: true,
                entry_count: 1,
                format: "json".into(),
                imported_at: 0,
            },
        ];

        let (items, removed) = sync_items(items, &dir);
        assert_eq!(removed, vec!["gone".to_string()]);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "a.json");
        assert_eq!(items[0].order, 0);
    }

    #[test]
    fn sync_items_adopts_untracked_json_and_ignores_other_files() {
        let dir = temp_dir("adopt");
        fs::write(dir.join("a.json"), "[{\"cn\":\"甲\",\"en\":\"A\"}]").unwrap();
        fs::write(dir.join("b.json"), "[]").unwrap();
        fs::write(dir.join("ignored.txt"), "x").unwrap();

        let (items, removed) = sync_items(Vec::new(), &dir);
        assert!(removed.is_empty());
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].id, "a.json");
        assert_eq!(items[1].id, "b.json");
        assert_eq!(items[0].label, "a");
        assert_eq!(items[0].display_name, "a", "手工放进来的词典默认用文件名命名");
        assert_eq!(items[0].entry_count, 1);
        assert!(items.iter().all(|item| item.enabled));
    }

    /// 旧索引没有 displayName：读回时用 label 补齐（界面不会出现空名字）。
    #[test]
    fn sync_items_fills_display_name_from_legacy_label() {
        let dir = temp_dir("legacy-name");
        fs::write(dir.join("a.json"), "[]").unwrap();
        let items = vec![DictionaryItem {
            id: "a.json".into(),
            display_name: String::new(),
            label: "旧名字".into(),
            file: "a.json".into(),
            order: 0,
            enabled: true,
            entry_count: 0,
            format: "json".into(),
            imported_at: 0,
        }];
        let (items, _removed) = sync_items(items, &dir);
        assert_eq!(items[0].display_name, "旧名字");
    }

    #[test]
    fn apply_reorder_puts_requested_ids_first() {
        let mut items = vec![
            DictionaryItem {
                id: "a".into(),
                display_name: "a".into(),
                label: "a".into(),
                file: "a.json".into(),
                order: 0,
                enabled: true,
                entry_count: 0,
                format: "json".into(),
                imported_at: 0,
            },
            DictionaryItem {
                id: "b".into(),
                display_name: "b".into(),
                label: "b".into(),
                file: "b.json".into(),
                order: 1,
                enabled: true,
                entry_count: 0,
                format: "json".into(),
                imported_at: 0,
            },
        ];
        apply_reorder(&mut items, &["b".to_string()]);
        assert_eq!(items[0].id, "b");
        assert_eq!(items[0].order, 0);
        assert_eq!(items[1].id, "a");
    }

    #[test]
    fn big_dictionaries_only_warn() {
        let warnings = build_warnings(60 * 1024 * 1024, 600_000);
        assert_eq!(warnings.len(), 2);
        assert!(warnings[0].contains("MB"));
        assert!(warnings[1].contains("600000"));
        assert!(build_warnings(1024, 10).is_empty());
    }

    // -----------------------------------------------------------------------
    // D62：画师库（category == 1 的行拨进 artists.json）
    // -----------------------------------------------------------------------

    #[test]
    fn category_column_is_detected_case_insensitively() {
        assert_eq!(
            category_index(&["cn".into(), "en".into(), "Category".into()]),
            Some(2)
        );
        assert_eq!(category_index(&["cn".into(), "en".into()]), None);
        assert_eq!(category_index(&["cn".into(), "category_x".into()]), None);
    }

    #[test]
    fn artist_rows_only_when_category_is_exactly_one() {
        let category = Some(2);
        let row = |value: &str| {
            vec![
                "甲".to_string(),
                "A".to_string(),
                value.to_string(),
            ]
        };
        assert!(is_artist_row(&row("1"), category));
        assert!(is_artist_row(&row(" 1 "), category), "两侧空白不影响判定");
        assert!(!is_artist_row(&row("10"), category), "10 不能被当成画师");
        assert!(!is_artist_row(&row("1.0"), category));
        assert!(!is_artist_row(&row("0"), category));
        assert!(!is_artist_row(&row(""), category));
        assert!(!is_artist_row(&row("1"), None), "没有 category 列时一律不是画师");
    }

    #[test]
    fn artist_cleaning_adds_at_and_escapes_parens_idempotently() {
        assert_eq!(normalize_artist_label("blue_archive_mika"), "@blue archive mika");
        assert_eq!(normalize_artist_label("@mika"), "@mika", "已经有 @ 就不重复加");
        assert_eq!(
            normalize_artist_english("mika_(blue_archive)"),
            "@mika \\(blue archive\\)"
        );
        // 幂等：已经转义过的再洗一遍不变；多个反斜杠也会收敛成一个
        assert_eq!(escape_artist_parens("\\(x\\)"), "\\(x\\)");
        assert_eq!(escape_artist_parens("\\\\(x)"), "\\(x\\)");
        assert_eq!(normalize_artist_english("@mika \\(a\\)"), "@mika \\(a\\)");
    }

    #[test]
    fn artist_rows_are_split_out_of_the_dictionary() {
        let parsed = table(
            &["cn", "en", "category"],
            &[
                &["千早爱音", "chihaya_anon", "0"],
                &["美嘉", "mika_(blue_archive)", "1"],
                &["长崎素世", "nagasaki_soyo", "0"],
            ],
        );
        let category = category_index(&["cn".into(), "en".into(), "category".into()]);
        let (entries, skipped, _dup) = normalize_rows(&parsed, 0, 1, category).unwrap();
        assert_eq!(entries.len(), 2, "画师行不能进普通词典");
        assert_eq!(skipped, 0, "画师行不计入「跳过空行」");

        let (artists, artist_skipped, artist_filtered) =
            build_artists(&parsed, 0, 1, category.unwrap(), None, 100);
        assert_eq!(artists.len(), 1);
        assert_eq!(artists[0].label, "@美嘉");
        assert_eq!(artists[0].english, "@mika \\(blue archive\\)");
        assert_eq!(artists[0].color_id, "artist");
        assert_eq!(artists[0].weight, 100);
        assert_eq!(artists[0].id, "artist:@美嘉");
        assert_eq!(artist_skipped, 0);
        assert_eq!(artist_filtered, 0, "没有热度列时不做过滤");
    }

    #[test]
    fn post_count_column_is_detected_by_several_names() {
        assert_eq!(post_count_index(&["cn".into(), "post_count".into()]), Some(1));
        assert_eq!(post_count_index(&["cn".into(), "PostCount".into()]), Some(1));
        assert_eq!(post_count_index(&["cn".into(), "posts".into()]), Some(1));
        assert_eq!(post_count_index(&["cn".into(), "count".into()]), Some(1));
        assert_eq!(post_count_index(&["cn".into(), "en".into()]), None);
    }

    /// D63：有热度列时，低于阈值（100）的画师被过滤，权重直接取 post_count；词典部分不受影响。
    #[test]
    fn artists_below_threshold_are_filtered_and_weight_is_post_count() {
        let parsed = table(
            &["cn", "en", "category", "post_count"],
            &[
                &["甲", "a", "1", "50"],
                &["乙", "b", "1", "100"],
                &["丙", "c", "1", "18812"],
                &["丁", "d", "0", "999"],
            ],
        );
        let category = category_index(&parsed.fields);
        let post_count = post_count_index(&parsed.fields);

        let (artists, skipped, filtered) =
            build_artists(&parsed, 0, 1, category.unwrap(), post_count, 100);
        assert_eq!(artists.len(), 2, "50 作品的那位应当被过滤");
        assert_eq!(filtered, 1);
        assert_eq!(skipped, 0);
        assert_eq!(artists[0].label, "@乙");
        assert_eq!(artists[0].weight, 100, "权重 = post_count 原值");
        assert_eq!(artists[1].label, "@丙");
        assert_eq!(artists[1].weight, 18812);

        // 词典那一侧完全不受热度过滤影响：只有非画师行进词典
        let (entries, _s, _d) = normalize_rows(&parsed, 0, 1, category).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].cn, "丁");
    }

    /// D87：Tag 条目就是普通 `Preset`（不带来源字段 —— 来源由它所在的文件夹表达）。
    #[test]
    fn build_tags_makes_preset_like_entries() {
        let tags = build_tags(
            &[
                DictionaryEntry {
                    cn: " 长发 ".to_string(),
                    en: " long hair ".to_string(),
                },
                // 空的那条要被丢掉（与词典那一侧的清洗口径一致）
                DictionaryEntry {
                    cn: "  ".to_string(),
                    en: "empty".to_string(),
                },
            ],
            &HashMap::new(),
        );
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].id, "tag:长发");
        assert_eq!(tags[0].label, "长发");
        assert_eq!(tags[0].english, "long hair");
        assert_eq!(tags[0].weight, 100, "没有数量列时权重 = 100（与新建预设同一个默认值）");
        assert_eq!(tags[0].color_id, "dictionary", "Tag 用词典色，与 T 色块同源");
    }

    /// D88：Tag 库的权重与画师库同一套口径 —— 有 `count` / `post_count` 列就取它的值。
    #[test]
    fn tags_take_weight_from_count_column() {
        // 有 count 列：权重取数值（负数夹到 0），画师行不参与
        let parsed = table(
            &["cn", "en", "count"],
            &[
                &["长发", "long hair", "18812"],
                &["短发", "short hair", "50"],
                &["负值", "negative", "-5"],
                &["画师", "artist", "1"], // 没有 category 列 → 会被当成普通行，这里只验数值口径
            ],
        );
        let count_index = post_count_index(&parsed.fields);
        let weights = row_weights(&parsed, 0, 1, None, count_index);
        let (entries, _s, _d) = normalize_rows(&parsed, 0, 1, None).unwrap();
        let tags = build_tags(&entries, &weights);
        assert_eq!(tags.len(), 4);
        assert_eq!(tags[0].weight, 18812, "权重 = count 原值（列表因此按热度排）");
        assert_eq!(tags[1].weight, 50);
        assert_eq!(tags[2].weight, 0, "负数夹到 0，与画师库同一口径");
        assert_eq!(tags[3].weight, 1);

        // 没有数量列：全部回落 100
        let plain = table(&["cn", "en"], &[&["长发", "long hair"]]);
        assert!(row_weights(&plain, 0, 1, None, post_count_index(&plain.fields)).is_empty());
        let (plain_entries, _s, _d) = normalize_rows(&plain, 0, 1, None).unwrap();
        assert_eq!(build_tags(&plain_entries, &HashMap::new())[0].weight, 100);

        // 重复中文只认第一条（与词典侧去重口径一致）
        let dup = table(
            &["cn", "en", "count"],
            &[&["长发", "first", "9"], &["长发", "second", "999"]],
        );
        let dup_weights = row_weights(&dup, 0, 1, None, post_count_index(&dup.fields));
        assert_eq!(dup_weights.get("长发"), Some(&9));
    }

    /// D87：索引里的 `file` 允许「一层子目录 + .json」，但不许跑出数据目录。
    #[test]
    fn relative_paths_are_validated() {
        assert!(is_safe_rel_path("画风词典.json"));
        assert!(is_safe_rel_path("画风词典/translation.json"));
        assert!(!is_safe_rel_path("画风词典/tags.json/"));
        assert!(!is_safe_rel_path("../evil.json"));
        assert!(!is_safe_rel_path("a/b/c.json"), "只允许一层子目录");
        assert!(!is_safe_rel_path("/abs.json"));
        assert!(!is_safe_rel_path("画风词典\\translation.json"));
        assert_eq!(folder_of_rel("画风词典/translation.json"), Some("画风词典"));
        assert_eq!(folder_of_rel("画风词典.json"), None);
    }

    /// D87：多文件库的路径校验 —— 只认 `<kind>.json` 与 `dictionaries/<文件夹>/<kind>.json`。
    #[test]
    fn library_paths_are_validated() {
        assert!(is_safe_library_path("tags.json", "tags.json"));
        assert!(is_safe_library_path("dictionaries/画风/tags.json", "tags.json"));
        // 写进别的库、写进别处、目录层次过多，一律拒绝
        assert!(!is_safe_library_path("artists.json", "tags.json"));
        assert!(!is_safe_library_path("dictionaries/画风/artists.json", "tags.json"));
        assert!(!is_safe_library_path("presets.json", "tags.json"));
        assert!(!is_safe_library_path("dictionaries/a/b/tags.json", "tags.json"));
        assert!(!is_safe_library_path("../tags.json", "tags.json"));
    }

    /// D87：文件夹形态的词典能被 `sync_items` 认出来（手工放进去的文件夹也会被收录）。
    #[test]
    fn sync_items_discovers_both_flat_files_and_folders() {
        let dir = temp_dir("sync-shapes");
        // 平铺（历史形态）
        storage::write_json(
            &dir.join("旧词典.json"),
            &[DictionaryEntry {
                cn: "甲".to_string(),
                en: "a".to_string(),
            }],
        )
        .unwrap();
        // 文件夹（D87 形态）
        fs::create_dir_all(dir.join("新词典")).unwrap();
        storage::write_json(
            &dir.join("新词典").join(TRANSLATION_FILE),
            &[
                DictionaryEntry {
                    cn: "乙".to_string(),
                    en: "b".to_string(),
                },
                DictionaryEntry {
                    cn: "丙".to_string(),
                    en: "c".to_string(),
                },
            ],
        )
        .unwrap();

        let (items, removed) = sync_items(Vec::new(), &dir);
        assert_eq!(removed.len(), 0);
        assert_eq!(items.len(), 2, "平铺与文件夹都要被发现");
        assert!(items.iter().any(|item| item.file == "旧词典.json"));
        assert!(items.iter().any(|item| item.file == "新词典/translation.json"));
        // 条数按各自文件统计（跨文件统计就是「各文件相加」）
        let folder_item = items
            .iter()
            .find(|item| item.file == "新词典/translation.json")
            .unwrap();
        assert_eq!(folder_item.entry_count, 2);
    }

    /// D87：索引里指向已消失文件夹的条目会被剔除（删文件夹 = 删词典）。
    #[test]
    fn sync_items_drops_missing_folders() {
        let dir = temp_dir("sync-missing");
        let item = DictionaryItem {
            id: "没有这个/translation.json".to_string(),
            display_name: "没有这个".to_string(),
            label: "没有这个".to_string(),
            file: "没有这个/translation.json".to_string(),
            order: 0,
            enabled: true,
            entry_count: 3,
            format: "json".to_string(),
            imported_at: 1,
        };
        let (items, removed) = sync_items(vec![item], &dir);
        assert_eq!(items.len(), 0);
        assert_eq!(removed, vec!["没有这个".to_string()]);
    }

    /// D87 修复：索引里同一个文件被登记多次时只留一条（历史重复条目自愈）。
    #[test]
    fn sync_items_dedupes_same_file() {
        let dir = temp_dir("sync-dupe");
        fs::create_dir_all(dir.join("词典")).unwrap();
        storage::write_json(
            &dir.join("词典").join(TRANSLATION_FILE),
            &[DictionaryEntry {
                cn: "甲".to_string(),
                en: "a".to_string(),
            }],
        )
        .unwrap();
        let make = |order: i64| DictionaryItem {
            id: "词典/translation.json".to_string(),
            display_name: "词典".to_string(),
            label: "词典".to_string(),
            file: "词典/translation.json".to_string(),
            order,
            enabled: true,
            entry_count: 1,
            format: "json".to_string(),
            imported_at: 1,
        };
        let (items, removed) = sync_items(vec![make(0), make(1)], &dir);
        assert_eq!(items.len(), 1, "同一文件只能有一条登记");
        assert_eq!(items[0].order, 0);
        assert_eq!(removed.len(), 0);
    }

    /// D87：导入 = 新建一个文件夹，里面三份文件（翻译 / Tag / 画师），**不与旧数据合并**。
    #[test]
    fn import_creates_one_folder_with_its_own_library_files() {
        let base = temp_dir("import-folder");
        let dicts = base.join(DIR_NAME);
        fs::create_dir_all(&dicts).unwrap();
        let index = base.join(INDEX_FILE);
        let source = base.join("画风.json");
        storage::write_json(
            &source,
            &[
                DictionaryEntry {
                    cn: "长发".to_string(),
                    en: "long hair".to_string(),
                },
                DictionaryEntry {
                    cn: "短发".to_string(),
                    en: "short hair".to_string(),
                },
            ],
        )
        .unwrap();

        let report = import_file(&dicts, &index, &source, None, 0, 1, Some("画风词典"), 100).unwrap();
        let item = report.item.expect("应当登记一部词典");
        assert_eq!(item.id, "画风词典/translation.json");
        assert_eq!(report.tag_count, 2);
        /*
         * 回归断言（用户实测报的 bug：一次导入出现两条同名词典）：
         * 索引里只能有**一条** —— 不能既被 `sync_items` 自动收录、又被我们登记一次。
         */
        assert_eq!(read_index(&index).unwrap().len(), 1, "一次导入只能登记一部词典");
        assert!(dicts.join("画风词典").join(TRANSLATION_FILE).is_file());
        assert!(dicts.join("画风词典").join(TAGS_FILE).is_file());
        // 翻译侧与 Tag 侧条数一致（同一份「非画师行」）
        let tags = storage::read_presets(&dicts.join("画风词典").join(TAGS_FILE)).unwrap();
        assert_eq!(tags.len(), 2);
        assert_eq!(tags[0].id, "tag:长发");
        assert_eq!(tags[0].color_id, "dictionary");

        // 同一份文件再导入一次：**新建第二个文件夹**，绝不合并进第一个（写入量恒定）
        let again = import_file(&dicts, &index, &source, None, 0, 1, Some("画风词典"), 100).unwrap();
        assert_eq!(again.item.unwrap().id, "画风词典 (2)/translation.json");
        assert_eq!(read_index(&index).unwrap().len(), 2, "两次导入 = 两条词典，不多不少");
        assert_eq!(
            storage::read_presets(&dicts.join("画风词典").join(TAGS_FILE))
                .unwrap()
                .len(),
            2,
            "旧文件夹的内容不能被改写"
        );
    }
}
