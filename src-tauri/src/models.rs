use serde::{Deserialize, Serialize};

fn default_weight() -> i64 {
    100
}

fn default_color_id() -> String {
    "common".to_string()
}

fn default_brand() -> String {
    "baidu".to_string()
}

/// 快照里的胶囊（D67）：**完整副本**，不引用预设库 —— 原预设被删也不影响快照还原。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotCapsule {
    #[serde(default)]
    pub id: String,
    /// 只作记录，还原时不回查预设库
    #[serde(default)]
    pub preset_id: String,
    #[serde(default)]
    pub name: String,
    /// 英文内容（与预设一样，界面永不渲染）
    #[serde(default)]
    pub english: String,
    #[serde(default)]
    pub color_id: String,
}

/// 快照里的一个模块：中文源内容（含锚点）+ 该排的用途色 + 胶囊副本。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotModule {
    #[serde(default)]
    pub source_text: String,
    /// 模块色条的颜色（用户 2026 轮：快照要「完全还原」，颜色一并存）
    #[serde(default)]
    pub color_id: String,
    #[serde(default)]
    pub capsules: Vec<SnapshotCapsule>,
}

/// 工作区快照：`scope = module` 时 `modules` 长度严格为 1。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    /// "module" | "global"
    #[serde(default)]
    pub scope: String,
    /// 权重：与预设同一套排序规则（默认 100）
    #[serde(default = "default_weight")]
    pub weight: i64,
    /// 保存时"全文复制"的内容（预览用，界面只在悬停浮层里显示）
    #[serde(default)]
    pub copy_text: String,
    #[serde(default)]
    pub modules: Vec<SnapshotModule>,
    #[serde(default)]
    pub created_at: i64,
}

/// 预设：胶囊的模板。字段名与前端 types/preset.ts 一一对应（camelCase）。
///
/// 所有字段都带 default，因此单条数据缺字段时仍能读入，
/// 由前端 utils/presetSanitize.ts 再做一次规范化（权重下限、未知颜色回落等）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preset {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub english: String,
    /// 权重：默认 100，最低 0，无上限。用 i64 而不是 u32，避免负数导致整份文件被判为损坏。
    #[serde(default = "default_weight")]
    pub weight: i64,
    #[serde(default = "default_color_id")]
    pub color_id: String,
    /// D111：预设分组的名字（只有预设库用；缺省 = 未分组）。
    ///
    /// 存成「名字」而不是「组的 id」：同名即同组，打开 JSON 就看得懂，
    /// 也不需要处理「id 指向一个已经不存在的组」这类孤儿。组的可见色与展开状态
    /// 在 `preset-folders.json` 里（那是成员列表推不出来的部分）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder: Option<String>,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub updated_at: i64,
}

/// 预设分组（D111 / D112）：`preset-folders.json` 里的一条。
///
/// 只存成员列表推不出来的两件事：组名、**组的颜色**（创建时取那颗胶囊的颜色，
/// 之后固定不可改 —— 组只会出现在总列表或它自己那个色块下）、以及折叠/展开状态。
/// 文件缺失 = 无损降级：组名与颜色都还能从成员的 `folder` / `colorId` 推出来。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetFolder {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub color_id: String,
    #[serde(default)]
    pub expanded: bool,
}

/// 一次翻译的结果。字段名与前端 types/settings.ts 的 TranslateResult 一一对应。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslateResult {
    /// 服务返回的英文（前端会在此基础上把术语英文拼到最前面）
    pub text: String,
    /// 展示用的服务名（专业翻译没有「模型」概念，这里放中文服务名，例如「百度翻译」）
    pub model: String,
    pub elapsed_ms: u64,
}

/// 连接测试结果。
///
/// 刻意不用 Err 表示「连不上」：连不上是测试的正常结论之一，
/// 界面需要把结论和原因一起显示出来。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestReport {
    pub ok: bool,
    pub elapsed_ms: u64,
    /// 中文提示，可直接展示
    pub message: String,
}

/// 一套翻译服务配置（需求确认：支持多套）。
///
/// 本版只剩专业翻译接口这一种接入形态，因此形状只有三项：
/// `id / label / brand`。语言模型（OpenAI 兼容）与本地模型两条接入方式已整体剔除，
/// 旧的 `category` / `llm` / `templateId` 字段不再出现——旧配置文件仍能正常读入
/// （serde 忽略未知字段），由前端 `utils/profileSanitize.ts` 把品牌迁移过来。
///
/// **这里没有凭据字段**：凭据存在系统凭据库里，条目名由 profile.id 推出
/// （`<id>:<品牌>`），因此配置文件即使被看到也没有明文。
///
/// 形状必须与前端 `types/settings.ts` 的 `ProviderProfile` **完全一致**。
/// 曾经的教训：这里保留旧的扁平形状（kind / baseUrl / model / …），
/// 于是每次落盘 `serde` 都会把前端的新结构**丢掉**，重载后配置被当成另一种接入方式，
/// 界面显示「缺密钥」，而凭据其实一直都在（连接测试能通过）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderProfile {
    #[serde(default)]
    pub id: String,
    /// 用户命名（中文），界面显示它
    #[serde(default)]
    pub label: String,
    /// 翻译服务 id：baidu（可用）/ tencent（占位）
    #[serde(default = "default_brand")]
    pub brand: String,
}

impl ProviderProfile {
    /// 运行时协议：由翻译服务推导，认不出的品牌按百度处理（与前端 `protocolOf` 同口径）
    pub fn protocol(&self) -> String {
        match self.brand.as_str() {
            "tencent" => "tencent-translate".to_string(),
            "volcano" => "volcano-translate".to_string(),
            "aliyun" => "aliyun-translate".to_string(),
            _ => "baidu-translate".to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    #[serde(default)]
    pub profiles: Vec<ProviderProfile>,
    #[serde(default)]
    pub active_profile_id: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            profiles: Vec::new(),
            active_profile_id: String::new(),
        }
    }
}

// ---------------------------------------------------------------------------
// 本地词典（D49）
// ---------------------------------------------------------------------------

/// 标准化后的词典条目：**键名严格是小写 `cn` / `en`**（写入标准 JSON 时原样落盘）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DictionaryEntry {
    #[serde(default)]
    pub cn: String,
    #[serde(default)]
    pub en: String,
}

/// 索引里的一条词典记录。
///
/// `id` 就是文件名（同一目录内唯一），因此手工把文件放进文件夹再「重新扫描」也不会丢启停状态；
/// `label` 是显示名（默认取文件名、去掉扩展名）；`order` 越小优先级越高。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryItem {
    #[serde(default)]
    pub id: String,
    /// 用户命名的显示名（导入时输入；旧索引没有这个字段时回落到 label/文件名）
    #[serde(default)]
    pub display_name: String,
    /// 文件名词干（保留给旧索引与排查用；界面显示 displayName）
    #[serde(default)]
    pub label: String,
    /// 相对 `dictionaries/` 的文件名（只允许文件名，不允许带路径）
    #[serde(default)]
    pub file: String,
    #[serde(default)]
    pub order: i64,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub entry_count: i64,
    /// 来源格式：csv / json / sqlite（手工放进去的标准 JSON 记作 json）
    #[serde(default)]
    pub format: String,
    #[serde(default)]
    pub imported_at: i64,
}

fn default_enabled() -> bool {
    true
}

/// 索引文件形状：`%APPDATA%\com.promptforge.app\dictionary-index.json`
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct DictionaryIndex {
    #[serde(default)]
    pub items: Vec<DictionaryItem>,
}

/// 解析结果里的「表」：CSV / JSON 只有一张，SQLite 可能多张（前端多一个「哪个表」下拉）。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryTable {
    pub name: String,
    pub fields: Vec<String>,
    /// 前 5 行样本（用于映射界面的预览表）
    pub sample_rows: Vec<Vec<String>>,
    /// 白名单智能识别出的中文/英文字段下标（识别不出就是 None）
    pub suggested_cn_index: Option<usize>,
    pub suggested_en_index: Option<usize>,
}

/// 导入前检查：格式、各表字段与样本、智能识别结果。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryInspection {
    pub format: String,
    pub tables: Vec<DictionaryTable>,
}

/// 导入结果（warning 只提示、不阻断，用户口径：大词典可能引起翻译卡顿）
///
/// D62 起：文件里若带 `category` 列且值为 `1`，那些行会被转成**画师条目**写进
/// `artists.json`，不再进普通词典。因此 `item` 可能是 `None`（文件里全是画师行）。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryImportReport {
    pub item: Option<DictionaryItem>,
    pub skipped: i64,
    pub duplicates: i64,
    /// 本次转成画师条目的数量
    pub artist_count: i64,
    /// 画师行里中文或英文为空、被丢掉的数量
    pub artist_skipped: i64,
    /// 画师行里因为 `post_count` 低于阈值被过滤掉的数量（D63）
    pub artist_filtered: i64,
    /// 本次写进 Tag 库（`tags.json`）的条目数（D86）
    pub tag_count: i64,
    pub warnings: Vec<String>,
}

/// 启动时一次性把启用词典的条目交给前端（前端建 Map 做整段匹配，不走 IPC 查词）。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryEntryGroup {
    pub id: String,
    pub entries: Vec<DictionaryEntry>,
}

/// 多文件库的一个文件（D87）：画师 / Tag 现在是「数据根目录一份 + 每部词典文件夹一份」。
///
/// `file` 是**相对应用数据目录**的路径（`tags.json` 或 `dictionaries/<文件夹>/tags.json`）。
/// 前端把它记在**内存**里（不落盘），改权重 / 删条时据此只重写那一个文件 ——
/// 这既是「导入变快」的关键（不再合并、不再重写巨型文件），也是「删词典连带清除」的实现方式。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryFile {
    #[serde(default)]
    pub file: String,
    #[serde(default)]
    pub items: Vec<Preset>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryList {
    pub items: Vec<DictionaryItem>,
    /// 本次扫描发现「文件已被手动删除」而从索引里剔除的显示名
    pub removed: Vec<String>,
}

// ---------------------------------------------------------------------------
// 全库导入导出（D115 / D116）
// ---------------------------------------------------------------------------

/// 导出时勾选了哪些库（D115）。
///
/// 用独立的布尔组而不是「数组非空就算包含」：空库也要能如实说清
/// 「这个选项是打开的、只是里面 0 条」，否则导入预览会骗人。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BundleIncluded {
    #[serde(default)]
    pub presets: bool,
    #[serde(default)]
    pub artists: bool,
    #[serde(default)]
    pub tags: bool,
    #[serde(default)]
    pub dictionaries: bool,
    #[serde(default)]
    pub snapshots: bool,
}

/// 包里的一部词典（D115）：**词典 + 它的画师 + 它的 Tag 是一个整体**。
///
/// 用户口径：词典名同时是词典文件夹名，画师库 / Tag 库对应文件就长在这个文件夹里，
/// 所以重命名 / 覆盖必须以「一部词典」为单位整体搬动，不能只改显示名。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleDictionary {
    #[serde(default)]
    pub display_name: String,
    /// 来源格式（csv / json / sqlite）；只是记录，导入不再解析原文件
    #[serde(default)]
    pub format: String,
    /// 停用的词典导进来还是停用（用户排的优先序与启停状态都属于「原样保留」）
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub entries: Vec<DictionaryEntry>,
    #[serde(default)]
    pub artists: Vec<Preset>,
    #[serde(default)]
    pub tags: Vec<Preset>,
}

/// 一个导出包的完整内容（`<用户选择的位置>.json`，明文可读）。
///
/// 字段名与前端 `types/bundle.ts` 一一对应；所有字段都带 default，
/// 因此手工删掉几个库（或旧版本包）仍能读入，缺的那部分当成空。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LibraryBundle {
    #[serde(default)]
    pub app: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub exported_at: i64,
    #[serde(default)]
    pub included: BundleIncluded,
    #[serde(default)]
    pub presets: Vec<Preset>,
    /// 组信息属于预设库（用户口径：组信息包含在预设库里），不分开关
    #[serde(default)]
    pub preset_folders: Vec<PresetFolder>,
    /// 只装**数据根目录那份** `artists.json`；词典文件夹里的那份跟词典走
    #[serde(default)]
    pub artists: Vec<LibraryFile>,
    #[serde(default)]
    pub tags: Vec<LibraryFile>,
    #[serde(default)]
    pub dictionaries: Vec<BundleDictionary>,
    #[serde(default)]
    pub snapshots: Vec<Snapshot>,
}

/// 包内概况（导入前展示「这个文件里有哪些库、各多少条」）
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleSummary {
    pub app: String,
    pub version: u32,
    pub exported_at: i64,
    pub included: BundleIncluded,
    pub preset_count: i64,
    pub preset_folder_count: i64,
    /// 画师库 / Tag 库的条数 = **全部条目**（根文件 + 各词典文件夹里的那些）
    pub artist_count: i64,
    pub tag_count: i64,
    pub dictionary_count: i64,
    /// 词典译词条数（画师 / Tag 已算进上面两行，这里不重复计数）
    pub dictionary_entry_count: i64,
    pub dictionary_names: Vec<String>,
    pub snapshot_count: i64,
}

/// 一个库的合并账目（导入完成后原样报给用户看）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BundleMergeStats {
    pub added: i64,
    pub overwritten: i64,
    pub renamed: i64,
}

/// 导入结果：逐库报账。总数 = 新增 + 覆盖 + 重命名。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleImportReport {
    pub presets: BundleMergeStats,
    pub folders: BundleMergeStats,
    pub artists: BundleMergeStats,
    pub tags: BundleMergeStats,
    pub dictionaries: BundleMergeStats,
    pub snapshots: BundleMergeStats,
}

/// 导出结果：写到哪儿、写了多少（前端只用来拼一句中文提示）
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleExportReport {
    pub path: String,
    pub bytes: i64,
    pub presets: i64,
    pub preset_folders: i64,
    pub artists: i64,
    pub tags: i64,
    pub dictionaries: i64,
    pub snapshots: i64,
}


/* ---------- 推送设置（D80） ---------- */

/// 通信端口下限：低于 1024 是系统保留端口（普通用户无权绑定）
pub const PUSH_PORT_MIN: u32 = 1024;
/// 通信端口上限
pub const PUSH_PORT_MAX: u32 = 65535;
/// 默认端口：与前端 `PUSH_DEFAULT_PORT` 保持一致
pub const PUSH_PORT_DEFAULT: u32 = 8713;

fn default_push_enabled() -> bool {
    true
}

fn default_push_port() -> u32 {
    PUSH_PORT_DEFAULT
}

/// 推送设置（D80）：与 ComfyUI 插件通信的开关与端口。
/// 单独存 `push-settings.json`（与 presets/config/snapshots 平级）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushSettings {
    /// 是否开启推送（默认开启）
    #[serde(default = "default_push_enabled")]
    pub enabled: bool,
    /// 通信端口（夹在 1024–65535 之间；用 u32 收，越界值在 normalized 里夹回）
    #[serde(default = "default_push_port")]
    pub port: u32,
}

impl Default for PushSettings {
    fn default() -> Self {
        Self {
            enabled: default_push_enabled(),
            port: default_push_port(),
        }
    }
}

impl PushSettings {
    /// 规范化：端口夹进合法区间。
    ///
    /// 越界值一律夹到边界（而不是回落到默认值）—— 用户输入 80 时给他 1024，
    /// 比"悄悄变回 8713"更容易理解，界面上也会立刻显示被夹后的值。
    pub fn normalized(mut self) -> Self {
        self.port = self.port.clamp(PUSH_PORT_MIN, PUSH_PORT_MAX);
        self
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_defaults_are_applied_for_missing_fields() {
        let profile: ProviderProfile =
            serde_json::from_str(r#"{"id":"p1","label":"主力"}"#).unwrap();
        assert_eq!(profile.brand, "baidu", "缺品牌时回落到本版唯一可用的百度");
        assert_eq!(profile.protocol(), "baidu-translate");
    }

    #[test]
    fn profile_round_trips_with_camel_case_names() {
        let profile = ProviderProfile {
            id: "p1".into(),
            label: "百度主力".into(),
            brand: "baidu".into(),
        };
        let json = serde_json::to_string(&profile).unwrap();
        assert!(json.contains("\"brand\""));
        assert_eq!(serde_json::from_str::<ProviderProfile>(&json).unwrap(), profile);
        assert!(!json.contains("key"), "配置里不应出现任何密钥字段");
    }

    /// 回归：`brand` 曾经因为 Rust 侧是旧扁平结构而在每次落盘时被丢弃，
    /// 导致百度配置重载后变成另一种接入方式，界面显示缺密钥（凭据其实还在）。
    #[test]
    fn brand_survives_a_round_trip() {
        let raw = r#"{"id":"p1","label":"百度","brand":"baidu"}"#;
        let parsed: ProviderProfile = serde_json::from_str(raw).unwrap();
        assert_eq!(parsed.protocol(), "baidu-translate");

        let json = serde_json::to_string(&parsed).unwrap();
        let again: ProviderProfile = serde_json::from_str(&json).unwrap();
        assert_eq!(again.brand, "baidu", "brand 必须活过落盘");
        // 旧结构里的字段不再写回磁盘
        assert!(!json.contains("\"category\""));
        assert!(!json.contains("\"llm\""));
        assert!(!json.contains("\"templateId\""));
    }

    /// 旧版本落盘的配置仍要能读进来（迁移由前端负责，Rust 只需不失败）
    #[test]
    fn legacy_profile_still_reads() {
        let raw = r#"{
            "id":"p2","label":"旧配置","category":"professional",
            "professional":{"brand":"baidu"},"templateId":"baidu"
        }"#;
        let parsed: ProviderProfile = serde_json::from_str(raw).unwrap();
        assert_eq!(parsed.id, "p2");
        assert_eq!(parsed.label, "旧配置");
        // 旧结构里没有 brand 字段 ⇒ 走默认值（前端会把它迁移成真实品牌）
        assert_eq!(parsed.brand, "baidu");
    }

    #[test]
    fn unknown_brand_falls_back_to_baidu() {
        let profile: ProviderProfile =
            serde_json::from_str(r#"{"id":"p3","brand":"瞎写"}"#).unwrap();
        assert_eq!(profile.protocol(), "baidu-translate");
    }

    #[test]
    fn config_without_profiles_is_valid() {
        let config: AppConfig = serde_json::from_str("{}").unwrap();
        assert_eq!(config, AppConfig::default());
    }
}
