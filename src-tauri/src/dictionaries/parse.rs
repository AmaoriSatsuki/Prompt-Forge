//! 外部词典文件的解析层：CSV / JSON / SQLite → 统一的「表」形状。
//!
//! 这一层**只负责读**：把文件读成 `ParsedTable { name, fields, rows }`，
//! 不判断哪一列是中文、不写盘、不碰索引。字段映射与标准化在 `dictionaries/mod.rs`。
//!
//! 三个来源的现实约束（都真会遇到）：
//! - **CSV 常是 GBK**（Excel 另存）：UTF-8 解码失败时必须按 GB18030 兜底，否则字段名直接是乱码；
//! - **CSV 分隔符不一定是逗号**：Excel 中文环境常导出分号/制表符，按首行出现次数猜一次；
//! - **SQLite 要多表**：一个 .db 里可能有好几张表，字段各不相同，因此解析层返回「表列表」，
//!   由界面决定用哪张（用户选择：多表时加「哪个表」下拉）。

use std::fs;
use std::path::Path;

use serde_json::Value;

use crate::error::AppError;

/// 解析出来的一张表。`rows` 的行数由调用方决定（检查用 5 行，导入用全部）。
#[derive(Debug, Clone, PartialEq)]
pub struct ParsedTable {
    pub name: String,
    pub fields: Vec<String>,
    pub rows: Vec<Vec<String>>,
}

/// 文件格式（由扩展名决定，不猜内容）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceFormat {
    Csv,
    Json,
    Sqlite,
}

impl SourceFormat {
    pub fn as_str(self) -> &'static str {
        match self {
            SourceFormat::Csv => "csv",
            SourceFormat::Json => "json",
            SourceFormat::Sqlite => "sqlite",
        }
    }
}

/// 按扩展名判断格式。不认识的一律给中文错误（不尝试「瞎猜内容」）。
pub fn detect_format(path: &Path) -> Result<SourceFormat, AppError> {
    let ext = path
        .extension()
        .map(|value| value.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "csv" | "tsv" | "txt" => Ok(SourceFormat::Csv),
        "json" => Ok(SourceFormat::Json),
        "db" | "sqlite" | "sqlite3" => Ok(SourceFormat::Sqlite),
        _ => Err(AppError::new(
            "DICT_UNSUPPORTED",
            "不支持的文件格式（支持 CSV / JSON / SQLite）",
        )),
    }
}

// ---------------------------------------------------------------------------
// 文本编码
// ---------------------------------------------------------------------------

/// 把文件字节解码成字符串。
///
/// 顺序：UTF-8 BOM → UTF-16 BOM → 严格 UTF-8 → GB18030。
/// 最后一步是必须的：中文 Windows 上 Excel 导出的 CSV 默认就是 GBK，
/// 只用 UTF-8 读会得到一串 `����`，字段名对不上、用户还以为是文件坏了。
pub fn decode_text(bytes: &[u8]) -> String {
    if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8_lossy(rest).into_owned();
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        let (text, _, _) = encoding_rs::UTF_16LE.decode(rest);
        return text.into_owned();
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        let (text, _, _) = encoding_rs::UTF_16BE.decode(rest);
        return text.into_owned();
    }
    match std::str::from_utf8(bytes) {
        Ok(text) => text.to_string(),
        Err(_) => {
            let (text, _, _) = encoding_rs::GB18030.decode(bytes);
            text.into_owned()
        }
    }
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/// 按首行里出现的次数猜分隔符：逗号 / 分号 / 制表符。
/// 猜错也能用：CSV 解析器会按选定分隔符走，剩下的都当内容。
fn detect_delimiter(text: &str) -> u8 {
    let first_line = text.lines().next().unwrap_or("");
    let commas = first_line.matches(',').count();
    let semicolons = first_line.matches(';').count();
    let tabs = first_line.matches('\t').count();
    if tabs > commas && tabs > semicolons {
        b'\t'
    } else if semicolons > commas {
        b';'
    } else {
        b','
    }
}

/// 字段名去重：重名的列加「（2）」后缀。
/// 不做这一步的话，映射下拉里会出现两个一模一样的选项，用户根本没法区分。
fn dedupe_fields(fields: &mut [String]) {
    let mut seen: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for (index, field) in fields.iter_mut().enumerate() {
        let base = if field.trim().is_empty() {
            format!("第 {} 列", index + 1)
        } else {
            field.trim().to_string()
        };
        let counter = seen.entry(base.clone()).or_insert(0);
        *counter += 1;
        *field = if *counter == 1 {
            base
        } else {
            format!("{base}（{counter}）")
        };
    }
}

/// 读 CSV：首行当表头，其余当数据。`limit` 只限制读入的行数（检查时 5 行）。
pub fn read_csv(path: &Path, limit: Option<usize>) -> Result<ParsedTable, AppError> {
    let bytes = fs::read(path).map_err(|error| AppError::io("读取词典文件失败", error))?;
    let text = decode_text(&bytes);
    let delimiter = detect_delimiter(&text);

    let mut reader = csv::ReaderBuilder::new()
        .has_headers(true)
        .flexible(true)
        .delimiter(delimiter)
        .from_reader(text.as_bytes());

    let mut fields: Vec<String> = reader
        .headers()
        .map_err(|error| {
            AppError::new("DICT_PARSE", "该文件无法解析").with_detail(error.to_string())
        })?
        .iter()
        .map(|value| value.trim().to_string())
        .collect();

    if fields.is_empty() {
        return Err(AppError::new("DICT_PARSE", "该文件没有表头，无法识别字段"));
    }
    dedupe_fields(&mut fields);

    let mut rows: Vec<Vec<String>> = Vec::new();
    for record in reader.records() {
        let record = record.map_err(|error| {
            AppError::new("DICT_PARSE", "该文件无法解析").with_detail(error.to_string())
        })?;
        let row: Vec<String> = (0..fields.len())
            .map(|index| record.get(index).unwrap_or("").trim().to_string())
            .collect();
        rows.push(row);
        if let Some(max) = limit {
            if rows.len() >= max {
                break;
            }
        }
    }

    Ok(ParsedTable {
        name: "CSV".to_string(),
        fields,
        rows,
    })
}

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

/// JSON 单元格转字符串：字符串原样、数字/布尔转字面量、null 变空、嵌套结构保留成 JSON 文本。
fn json_cell(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Number(number) => number.to_string(),
        Value::Bool(flag) => flag.to_string(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

/// JSON → 表。支持三种现实里常见的形状：
/// 1. 对象数组 `[{"cn":"…","en":"…"}]`（最常见，键的并集做字段）
/// 2. 二维数组 `[["中文","英文"], ["千早爱音","chihaya anon"]]`（首行当表头）
/// 3. 扁平映射 `{"千早爱音":"chihaya anon"}`（字段名固定为 cn / en）
///
/// 另外容忍一层包装 `{ "entries": [...] }`（很多导出工具会这么包）。
fn json_to_table(value: Value, limit: Option<usize>) -> Result<ParsedTable, AppError> {
    match value {
        Value::Object(map) => {
            if let Some(Value::Array(items)) = map.get("entries") {
                return json_to_table(Value::Array(items.clone()), limit);
            }
            if map.is_empty() {
                return Err(AppError::new("DICT_PARSE", "该词典是空的"));
            }
            // 扁平映射：所有值都是标量 → 键当中文、值当英文
            if map
                .values()
                .all(|item| !item.is_object() && !item.is_array())
            {
                let mut rows: Vec<Vec<String>> = Vec::new();
                for (key, value) in &map {
                    rows.push(vec![key.clone(), json_cell(value)]);
                    if let Some(max) = limit {
                        if rows.len() >= max {
                            break;
                        }
                    }
                }
                return Ok(ParsedTable {
                    name: "JSON".to_string(),
                    fields: vec!["cn".to_string(), "en".to_string()],
                    rows,
                });
            }
            Err(AppError::new(
                "DICT_PARSE",
                "无法识别该 JSON 结构（支持对象数组、二维数组或键值映射）",
            ))
        }
        Value::Array(items) => {
            if items.is_empty() {
                return Err(AppError::new("DICT_PARSE", "该词典是空的"));
            }
            if items.iter().all(|item| item.is_object()) {
                // 字段 = 所有对象键的并集，按首次出现顺序，保证下拉顺序稳定
                let mut fields: Vec<String> = Vec::new();
                for item in &items {
                    if let Value::Object(map) = item {
                        for key in map.keys() {
                            if !fields.iter().any(|existing| existing == key) {
                                fields.push(key.clone());
                            }
                        }
                    }
                }
                let mut rows: Vec<Vec<String>> = Vec::new();
                for item in &items {
                    let map = item.as_object().unwrap();
                    let row: Vec<String> = fields
                        .iter()
                        .map(|field| map.get(field).map(json_cell).unwrap_or_default())
                        .collect();
                    rows.push(row);
                    if let Some(max) = limit {
                        if rows.len() >= max {
                            break;
                        }
                    }
                }
                return Ok(ParsedTable {
                    name: "JSON".to_string(),
                    fields,
                    rows,
                });
            }
            if items.iter().all(|item| item.is_array()) {
                let mut iter = items.iter();
                let first = iter.next().unwrap();
                let mut fields: Vec<String> = first
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|cell| json_cell(cell).trim().to_string())
                    .collect();
                dedupe_fields(&mut fields);
                let mut rows: Vec<Vec<String>> = Vec::new();
                for item in iter {
                    let cells: Vec<String> = item
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|cell| json_cell(cell).trim().to_string())
                        .collect();
                    rows.push(cells);
                    if let Some(max) = limit {
                        if rows.len() >= max {
                            break;
                        }
                    }
                }
                return Ok(ParsedTable {
                    name: "JSON".to_string(),
                    fields,
                    rows,
                });
            }
            Err(AppError::new(
                "DICT_PARSE",
                "无法识别该 JSON 结构（支持对象数组、二维数组或键值映射）",
            ))
        }
        _ => Err(AppError::new(
            "DICT_PARSE",
            "无法识别该 JSON 结构（支持对象数组、二维数组或键值映射）",
        )),
    }
}

pub fn read_json(path: &Path, limit: Option<usize>) -> Result<ParsedTable, AppError> {
    let bytes = fs::read(path).map_err(|error| AppError::io("读取词典文件失败", error))?;
    let text = decode_text(&bytes);
    if text.trim().is_empty() {
        return Err(AppError::new("DICT_PARSE", "该词典是空的"));
    }
    let value: Value = serde_json::from_str(&text)
        .map_err(|error| AppError::new("DICT_PARSE", "该文件无法解析").with_detail(error.to_string()))?;
    json_to_table(value, limit)
}

// ---------------------------------------------------------------------------
// SQLite
// ---------------------------------------------------------------------------

fn sqlite_error(error: rusqlite::Error) -> AppError {
    AppError::new("DICT_PARSE", "该文件不是有效的 SQLite 数据库")
        .with_detail(error.to_string())
}

/// 标识符加引号（表名/列名可能含空格或汉字）。
fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

fn open_sqlite(path: &Path) -> Result<rusqlite::Connection, AppError> {
    let connection = rusqlite::Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(sqlite_error)?;
    Ok(connection)
}

/// 文件里所有用户表（排除 sqlite_ 内部表与视图）。
pub fn sqlite_tables(path: &Path) -> Result<Vec<String>, AppError> {
    let connection = open_sqlite(path)?;
    let mut statement = connection
        .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .map_err(sqlite_error)?;
    let names = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(sqlite_error)?
        .collect::<Result<Vec<String>, _>>()
        .map_err(sqlite_error)?;
    Ok(names)
}

/// 读一张表：列名来自 PRAGMA table_info，数据按 `SELECT *` 取（可限制行数）。
pub fn read_sqlite_table(
    path: &Path,
    table: &str,
    limit: Option<usize>,
) -> Result<ParsedTable, AppError> {
    let connection = open_sqlite(path)?;

    let mut info = connection
        .prepare(&format!("PRAGMA table_info({})", quote_ident(table)))
        .map_err(sqlite_error)?;
    let mut fields: Vec<String> = info
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(sqlite_error)?
        .collect::<Result<Vec<String>, _>>()
        .map_err(sqlite_error)?;
    if fields.is_empty() {
        return Err(AppError::new("DICT_PARSE", "该表没有可用字段"));
    }
    dedupe_fields(&mut fields);

    let sql = match limit {
        Some(max) => format!("SELECT * FROM {} LIMIT {}", quote_ident(table), max),
        None => format!("SELECT * FROM {}", quote_ident(table)),
    };
    let mut statement = connection.prepare(&sql).map_err(sqlite_error)?;
    let column_count = statement.column_count();
    let mut cursor = statement.query([]).map_err(sqlite_error)?;
    let mut rows: Vec<Vec<String>> = Vec::new();
    while let Some(row) = cursor.next().map_err(sqlite_error)? {
        let mut cells: Vec<String> = Vec::with_capacity(column_count);
        for index in 0..column_count {
            let value = row.get_ref(index).map_err(sqlite_error)?;
            cells.push(sqlite_value_to_string(value));
        }
        rows.push(cells);
    }

    Ok(ParsedTable {
        name: table.to_string(),
        fields,
        rows,
    })
}

fn sqlite_value_to_string(value: rusqlite::types::ValueRef<'_>) -> String {
    use rusqlite::types::ValueRef;
    match value {
        ValueRef::Null => String::new(),
        ValueRef::Integer(number) => number.to_string(),
        ValueRef::Real(number) => number.to_string(),
        ValueRef::Text(bytes) => String::from_utf8_lossy(bytes).into_owned(),
        ValueRef::Blob(bytes) => format!("（{} 字节的二进制）", bytes.len()),
    }
}

// ---------------------------------------------------------------------------
// 统一入口
// ---------------------------------------------------------------------------

/// 检查文件：返回格式与各表（样本 5 行）。SQLite 最多列 10 张表，避免下拉太长。
pub fn inspect(path: &Path) -> Result<(SourceFormat, Vec<ParsedTable>), AppError> {
    let format = detect_format(path)?;
    let tables = match format {
        SourceFormat::Csv => vec![read_csv(path, Some(5))?],
        SourceFormat::Json => vec![read_json(path, Some(5))?],
        SourceFormat::Sqlite => {
            let names = sqlite_tables(path)?;
            if names.is_empty() {
                return Err(AppError::new("DICT_PARSE", "该数据库里没有可用的表"));
            }
            let mut tables = Vec::new();
            for name in names.iter().take(10) {
                // 单张表读失败（例如是 FTS 影子表）不拖垮整体：跳过它
                if let Ok(table) = read_sqlite_table(path, name, Some(5)) {
                    tables.push(table);
                }
            }
            if tables.is_empty() {
                return Err(AppError::new("DICT_PARSE", "该数据库里没有可读的数据表"));
            }
            tables
        }
    };
    Ok((format, tables))
}

/// 导入时读取选中表的全部数据（CSV / JSON 忽略 `table`）。
pub fn read_table_all(path: &Path, table: Option<&str>) -> Result<ParsedTable, AppError> {
    let format = detect_format(path)?;
    match format {
        SourceFormat::Csv => read_csv(path, None),
        SourceFormat::Json => read_json(path, None),
        SourceFormat::Sqlite => {
            let names = sqlite_tables(path)?;
            let name = match table {
                Some(value) if names.iter().any(|item| item == value) => value,
                Some(_) => return Err(AppError::new("DICT_PARSE", "找不到所选的表")),
                None => {
                    if names.len() == 1 {
                        names[0].as_str()
                    } else {
                        return Err(AppError::new("DICT_PARSE", "请先选择要导入的表"));
                    }
                }
            };
            read_sqlite_table(path, name, None)
        }
    }
}
