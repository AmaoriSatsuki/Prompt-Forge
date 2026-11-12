//! 百度翻译（通用文本翻译）专用接入。
//!
//! 这条通道与「OpenAI 兼容」那套聊天补全无关（后者已随语言模型接入整体剔除）：
//! 百度是**统计机器翻译**的 REST 接口，既不是 `/chat/completions`，也不需要「提示词」——
//! 它要的是 `q / from / to / appid / salt / sign` 六个查询参数，其中 `sign` 是
//! `MD5(appid + q + salt + 密钥)`。因此单独成模块。
//!
//! 凭据有两种来源，**界面填写的优先**：
//! 1. 界面上填写的 APP ID 与密钥 → 存系统凭据库（每套配置独立）
//! 2. 系统环境变量 `BAIDU_TRANSLATE_APP_ID` / `BAIDU_TRANSLATE_APP_KEY`（兜底）
//!
//! 两种都不进应用配置文件，也不经过前端读回。

use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use reqwest::StatusCode;
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::models::TranslateResult;

/// 百度通用文本翻译接口
const ENDPOINT: &str = "https://fanyi-api.baidu.com/api/trans/vip/translate";

const APP_ID_ENV: &str = "BAIDU_TRANSLATE_APP_ID";
const APP_KEY_ENV: &str = "BAIDU_TRANSLATE_APP_KEY";

/// 系统凭据库里的服务名，用户名用 `<配置 id>:baidu`。
/// 带上品牌后缀是为了将来接第二家服务时，两套凭据不会互相覆盖。
const SERVICE: &str = "prompt-forge";
const CREDENTIAL_SUFFIX: &str = "baidu";

/// 标准版单次请求上限：6000 字节（约 2000 汉字）。超了接口会直接报错，提前挡住更友好。
const MAX_QUERY_BYTES: usize = 6000;

/// 百度翻译响应很快，30 秒足够。
const TIMEOUT_MS: u64 = 30_000;

/// 结果里展示的服务名。百度没有模型概念，用中文名更符合界面约定。
const DISPLAY_NAME: &str = "百度翻译";

// ---------------------------------------------------------------------------
// 签名
// ---------------------------------------------------------------------------

/// `sign = MD5(appid + q + salt + 密钥)`，结果为 32 位小写十六进制。
pub fn sign(app_id: &str, query: &str, salt: &str, app_key: &str) -> String {
    let raw = format!("{app_id}{query}{salt}{app_key}");
    format!("{:x}", md5::compute(raw.as_bytes()))
}

/// salt 用当前毫秒时间戳。同一个 salt 不会被重复使用，满足接口要求。
fn now_salt() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
        .to_string()
}

/// 组装查询参数。顺序与百度文档一致（接口本身不依赖顺序，这样便于对照排查）。
pub fn build_query(
    app_id: &str,
    query: &str,
    from: &str,
    to: &str,
    salt: &str,
    app_key: &str,
) -> Vec<(&'static str, String)> {
    vec![
        ("q", query.to_string()),
        ("from", from.to_string()),
        ("to", to.to_string()),
        ("appid", app_id.to_string()),
        ("salt", salt.to_string()),
        ("sign", sign(app_id, query, salt, app_key)),
    ]
}

// ---------------------------------------------------------------------------
// 凭据
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub struct BaiduCredentials {
    pub app_id: String,
    pub app_key: String,
}

/// 这份凭据是从哪来的。连接测试会把来源显示给用户，便于排查「改了没生效」。
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum CredentialSource {
    /// 界面上填写、存在系统凭据库里的
    Screen,
    /// 系统环境变量
    Env,
}

impl CredentialSource {
    pub fn label(self) -> &'static str {
        match self {
            CredentialSource::Screen => "界面填写",
            CredentialSource::Env => "系统环境变量",
        }
    }
}

/// 存进凭据库的载荷。凭据库一条记录只有一个密码字段，因此这里放一段 JSON。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScreenCredentials {
    #[serde(default)]
    app_id: String,
    #[serde(default)]
    app_key: String,
}

fn read_env(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn env_credentials() -> Option<BaiduCredentials> {
    let app_id = read_env(APP_ID_ENV)?;
    let app_key = read_env(APP_KEY_ENV)?;
    Some(BaiduCredentials { app_id, app_key })
}

/// 纯决策：界面填写与环境变量都有时，选界面填写的。
///
/// 抽成纯函数是为了能断言——真正读写凭据库的那部分不适合在测试里跑（会污染用户真实的凭据库）。
pub fn choose_credentials(
    screen: Option<BaiduCredentials>,
    env: Option<BaiduCredentials>,
) -> Result<(BaiduCredentials, CredentialSource), AppError> {
    if let Some(credentials) = screen {
        return Ok((credentials, CredentialSource::Screen));
    }
    if let Some(credentials) = env {
        return Ok((credentials, CredentialSource::Env));
    }
    Err(AppError::new(
        "NO_API_KEY",
        "还没有配置百度翻译的凭据：请在设置里填写 APP ID 与密钥并保存；\
         或者设置系统环境变量 BAIDU_TRANSLATE_APP_ID 与 BAIDU_TRANSLATE_APP_KEY 后重启应用",
    ))
}

fn store_entry(profile_id: &str) -> Result<Option<keyring::Entry>, AppError> {
    let id = profile_id.trim();
    if id.is_empty() {
        return Ok(None);
    }
    keyring::Entry::new(SERVICE, &format!("{id}:{CREDENTIAL_SUFFIX}"))
        .map(Some)
        .map_err(|error| AppError::new("IO", "无法访问系统凭据库").with_detail(error.to_string()))
}

fn screen_credentials(profile_id: &str) -> Result<Option<BaiduCredentials>, AppError> {
    let Some(entry) = store_entry(profile_id)? else {
        return Ok(None);
    };
    match entry.get_password() {
        Ok(raw) => {
            let parsed: ScreenCredentials = serde_json::from_str(&raw).unwrap_or_default();
            let app_id = parsed.app_id.trim().to_string();
            let app_key = parsed.app_key.trim().to_string();
            if app_id.is_empty() || app_key.is_empty() {
                return Ok(None);
            }
            Ok(Some(BaiduCredentials { app_id, app_key }))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(AppError::new("IO", "读取系统凭据失败").with_detail(error.to_string())),
    }
}

/// 解析最终使用的凭据：界面填写优先，环境变量兜底。
pub fn resolve_credentials(
    profile_id: &str,
) -> Result<(BaiduCredentials, CredentialSource), AppError> {
    choose_credentials(screen_credentials(profile_id)?, env_credentials())
}

// ---------------------------------------------------------------------------
// 响应解析与错误映射
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct TranslateResponse {
    #[serde(default)]
    trans_result: Vec<TransItem>,
    #[serde(default)]
    error_code: Option<String>,
    #[serde(default)]
    error_msg: Option<String>,
}

#[derive(Deserialize)]
struct TransItem {
    #[serde(default)]
    dst: String,
}

/// 把百度自己的错误码翻译成我们的错误码 + 中文提示。
///
/// 注意：这些错误是**带着 HTTP 200 返回的**，所以必须解析响应体里的 error_code，
/// 不能只看 HTTP 状态码。
pub fn map_error_code(code: &str, message: &str) -> AppError {
    let detail = if message.trim().is_empty() {
        format!("百度返回错误码 {code}")
    } else {
        format!("百度返回错误码 {code}：{}", message.trim())
    };

    match code {
        "52001" => AppError::new("TIMEOUT", "百度翻译请求超时，请重试").with_detail(detail),
        "52002" => AppError::new("PROVIDER_ERROR", "百度翻译系统错误，请重试").with_detail(detail),
        "52003" => AppError::new(
            "AUTH",
            "百度翻译未授权：APP ID 不正确，或该服务尚未开通",
        )
        .with_detail(detail),
        "54000" => AppError::new("INVALID_INPUT", "百度翻译缺少必填参数").with_detail(detail),
        "54001" => AppError::new(
            "AUTH",
            "百度翻译签名错误：请检查密钥是否与该 APP ID 匹配",
        )
        .with_detail(detail),
        "54003" => AppError::new(
            "RATE_LIMIT",
            "百度翻译访问频率受限：标准版限每秒 1 次，请稍后再试",
        )
        .with_detail(detail),
        "54004" => AppError::new("RATE_LIMIT", "百度翻译账户余额不足").with_detail(detail),
        "54005" => AppError::new("RATE_LIMIT", "长文本请求过于频繁，请稍后再试").with_detail(detail),
        "58000" => AppError::new("AUTH", "百度翻译拒绝了当前客户端 IP").with_detail(detail),
        "58001" => AppError::new(
            "INVALID_INPUT",
            "百度翻译不支持这个语言方向（中文 zh → 英文 en）",
        )
        .with_detail(detail),
        "58002" => AppError::new("PROVIDER_ERROR", "百度翻译服务当前已关闭").with_detail(detail),
        "90107" => AppError::new("AUTH", "百度翻译认证未通过或尚未生效").with_detail(detail),
        other => AppError::new(
            "PROVIDER_ERROR",
            format!("百度翻译返回了未知错误（{other}）"),
        )
        .with_detail(detail),
    }
}

fn map_status_error(status: StatusCode, body: &str) -> AppError {
    match status.as_u16() {
        401 | 403 => AppError::new("AUTH", "百度翻译鉴权失败").with_detail(truncate(body, 300)),
        429 => AppError::new("RATE_LIMIT", "百度翻译访问频率受限").with_detail(truncate(body, 300)),
        other => AppError::new("PROVIDER_ERROR", format!("百度翻译接口返回 HTTP {other}"))
            .with_detail(truncate(body, 300)),
    }
}

fn map_transport_error(error: reqwest::Error) -> AppError {
    if error.is_timeout() {
        return AppError::new("TIMEOUT", "百度翻译请求超时，请检查网络").with_detail(error.to_string());
    }
    if error.is_connect() {
        return AppError::new("NETWORK", "无法连接百度翻译接口，请检查网络")
            .with_detail(error.to_string());
    }
    AppError::new("NETWORK", "网络请求失败").with_detail(error.to_string())
}

fn truncate(value: &str, max_chars: usize) -> String {
    let mut out = String::new();
    for (index, ch) in value.chars().enumerate() {
        if index >= max_chars {
            out.push('…');
            break;
        }
        out.push(ch);
    }
    out
}

/// 解析响应体，取出译文。
///
/// 百度会把文本按行拆开翻译，返回 `trans_result` 数组，每项一个 `dst`；
/// 用换行拼回去即可还原原文的换行结构。
pub fn extract_translation(body: &str) -> Result<String, AppError> {
    let parsed: TranslateResponse = serde_json::from_str(body).map_err(|error| {
        AppError::new("BAD_RESPONSE", "无法解析百度翻译返回的内容")
            .with_detail(format!("{}｜{}", error, truncate(body, 300)))
    })?;

    if let Some(code) = parsed.error_code.as_deref() {
        if !code.trim().is_empty() && code.trim() != "0" {
            return Err(map_error_code(
                code.trim(),
                parsed.error_msg.as_deref().unwrap_or_default(),
            ));
        }
    }

    let text = parsed
        .trans_result
        .into_iter()
        .map(|item| item.dst)
        .collect::<Vec<_>>()
        .join("\n");

    if text.trim().is_empty() {
        return Err(
            AppError::new("BAD_RESPONSE", "百度翻译返回了空译文").with_detail(truncate(body, 300))
        );
    }
    Ok(text)
}

// ---------------------------------------------------------------------------
// 命令
// ---------------------------------------------------------------------------

/// 百度翻译命令。
///
/// `profile_id` 是可选的：传了就按这套配置去凭据库取凭据（优先），
/// 没传就只读环境变量——因此调用方式与最初约定的 `(text, from, to)` 兼容。
#[tauri::command]
pub async fn baidu_translate(
    text: String,
    from: String,
    to: String,
    profile_id: Option<String>,
) -> Result<TranslateResult, AppError> {
    let query = text.trim();
    if query.is_empty() {
        return Err(AppError::new("INVALID_INPUT", "没有可翻译的内容"));
    }
    if query.len() > MAX_QUERY_BYTES {
        return Err(AppError::new(
            "INVALID_INPUT",
            format!(
                "这一段太长了（{} 字节，百度翻译单次上限 {MAX_QUERY_BYTES} 字节），请拆分成多个模块",
                query.len()
            ),
        ));
    }

    let from = if from.trim().is_empty() { "zh".to_string() } else { from.trim().to_string() };
    let to = if to.trim().is_empty() { "en".to_string() } else { to.trim().to_string() };
    let (credentials, _source) = resolve_credentials(profile_id.as_deref().unwrap_or_default())?;

    let salt = now_salt();
    let params = build_query(&credentials.app_id, query, &from, &to, &salt, &credentials.app_key);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(TIMEOUT_MS))
        .build()
        .map_err(|error| {
            AppError::new("NETWORK", "无法创建网络客户端").with_detail(error.to_string())
        })?;

    let started = Instant::now();
    let response = client
        .get(ENDPOINT)
        .query(&params)
        .send()
        .await
        .map_err(map_transport_error)?;

    let status = response.status();
    let body = response.text().await.map_err(|error| {
        AppError::new("NETWORK", "读取百度翻译响应失败").with_detail(error.to_string())
    })?;

    if !status.is_success() {
        return Err(map_status_error(status, &body));
    }

    let translation = extract_translation(&body)?;

    Ok(TranslateResult {
        text: translation,
        model: DISPLAY_NAME.to_string(),
        elapsed_ms: started.elapsed().as_millis() as u64,
    })
}

/// 保存界面上填写的百度翻译凭据（写进系统凭据库，不落磁盘明文）。
#[tauri::command]
pub fn save_baidu_credentials(
    profile_id: String,
    app_id: String,
    app_key: String,
) -> Result<(), AppError> {
    let app_id = app_id.trim();
    let app_key = app_key.trim();
    if app_id.is_empty() {
        return Err(AppError::new("INVALID_INPUT", "请填写 APP ID"));
    }
    if app_key.is_empty() {
        return Err(AppError::new("INVALID_INPUT", "请填写密钥"));
    }
    let Some(entry) = store_entry(&profile_id)? else {
        return Err(AppError::new("INVALID_INPUT", "缺少配置标识"));
    };
    let payload = serde_json::to_string(&ScreenCredentials {
        app_id: app_id.to_string(),
        app_key: app_key.to_string(),
    })
    .map_err(|error| AppError::new("IO", "凭据序列化失败").with_detail(error.to_string()))?;

    entry
        .set_password(&payload)
        .map_err(|error| AppError::new("IO", "写入系统凭据库失败").with_detail(error.to_string()))
}

#[tauri::command]
pub fn has_baidu_credentials(profile_id: String) -> Result<bool, AppError> {
    Ok(screen_credentials(&profile_id)?.is_some())
}

#[tauri::command]
pub fn delete_baidu_credentials(profile_id: String) -> Result<(), AppError> {
    let Some(entry) = store_entry(&profile_id)? else {
        return Ok(());
    };
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(AppError::new("IO", "删除系统凭据失败").with_detail(error.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- MD5 与签名：用公开测试向量钉死，避免「自己写自己验」 ----

    fn md5_hex(input: &str) -> String {
        format!("{:x}", md5::compute(input.as_bytes()))
    }

    #[test]
    fn md5_matches_rfc1321_vectors() {
        assert_eq!(md5_hex(""), "d41d8cd98f00b204e9800998ecf8427e");
        assert_eq!(md5_hex("a"), "0cc175b9c0f1b6a831c399e269772661");
        assert_eq!(md5_hex("abc"), "900150983cd24fb0d6963f7d28e17f72");
        assert_eq!(md5_hex("message digest"), "f96b697d7cb7938d525a2f31aaf161d0");
        assert_eq!(
            md5_hex("abcdefghijklmnopqrstuvwxyz"),
            "c3fcd3d76192e4007dfb496cca67e13b"
        );
    }

    #[test]
    fn sign_is_md5_of_appid_query_salt_key_in_that_order() {
        // 与百度文档给出的拼接顺序一致：appid + q + salt + 密钥
        let expected = md5_hex("2015063000000001apple143566028812345678");
        assert_eq!(sign("2015063000000001", "apple", "1435660288", "12345678"), expected);
    }

    #[test]
    fn sign_matches_baidu_documented_example() {
        // 百度官方文档里的示例，用来钉死拼接顺序（与上一条互为印证）
        assert_eq!(
            sign("2015063000000001", "apple", "1435660288", "12345678"),
            "f89f9594663708c1605f3d736d01d2d4"
        );
    }

    #[test]
    fn sign_is_lowercase_hex_of_32_chars() {
        let value = sign("app", "中文也要能签", "1700000000000", "key");
        assert_eq!(value.len(), 32);
        assert!(value.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    }

    #[test]
    fn sign_changes_when_any_input_changes() {
        let base = sign("app", "q", "1", "key");
        assert_ne!(base, sign("app2", "q", "1", "key"));
        assert_ne!(base, sign("app", "q2", "1", "key"));
        assert_ne!(base, sign("app", "q", "2", "key"));
        assert_ne!(base, sign("app", "q", "1", "key2"));
    }

    // ---- 参数组装 ----

    #[test]
    fn query_carries_all_six_required_parameters() {
        let params = build_query("appid-1", "苹果", "zh", "en", "1700000000000", "secret");
        let names: Vec<&str> = params.iter().map(|(name, _)| *name).collect();
        assert_eq!(names, vec!["q", "from", "to", "appid", "salt", "sign"]);

        let value_of = |key: &str| {
            params
                .iter()
                .find(|(name, _)| *name == key)
                .map(|(_, value)| value.clone())
                .unwrap()
        };
        assert_eq!(value_of("q"), "苹果");
        assert_eq!(value_of("from"), "zh");
        assert_eq!(value_of("to"), "en");
        assert_eq!(value_of("appid"), "appid-1");
        assert_eq!(value_of("salt"), "1700000000000");
        assert_eq!(
            value_of("sign"),
            sign("appid-1", "苹果", "1700000000000", "secret")
        );
    }

    #[test]
    fn salt_is_a_millisecond_timestamp() {
        let salt = now_salt();
        assert!(salt.len() >= 12, "salt 太短，可能不是毫秒时间戳: {salt}");
        assert!(salt.chars().all(|c| c.is_ascii_digit()));
    }

    // ---- 凭据来源的选择 ----

    fn credentials(app_id: &str) -> BaiduCredentials {
        BaiduCredentials {
            app_id: app_id.to_string(),
            app_key: "key".to_string(),
        }
    }

    #[test]
    fn screen_credentials_win_over_environment() {
        // 界面填写是针对这一套配置的显式设置，因此优先
        let (chosen, source) =
            choose_credentials(Some(credentials("screen")), Some(credentials("env"))).unwrap();
        assert_eq!(chosen.app_id, "screen");
        assert_eq!(source, CredentialSource::Screen);
        assert_eq!(source.label(), "界面填写");
    }

    #[test]
    fn environment_is_the_fallback() {
        let (chosen, source) = choose_credentials(None, Some(credentials("env"))).unwrap();
        assert_eq!(chosen.app_id, "env");
        assert_eq!(source, CredentialSource::Env);
        assert_eq!(source.label(), "系统环境变量");
    }

    #[test]
    fn neither_source_available_gives_actionable_chinese_message() {
        let error = choose_credentials(None, None).unwrap_err();
        assert_eq!(error.code, "NO_API_KEY");
        assert!(error.message.contains("APP ID"));
        assert!(error.message.contains(APP_ID_ENV), "提示里应给出环境变量名");
        assert!(error.message.contains("设置里填写"), "提示里应给出界面填写的做法");
    }

    #[test]
    fn stored_payload_round_trips_with_camel_case_fields() {
        let payload = ScreenCredentials {
            app_id: "2015063000000001".into(),
            app_key: "12345678".into(),
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("appId"));
        assert!(json.contains("appKey"));
        let back: ScreenCredentials = serde_json::from_str(&json).unwrap();
        assert_eq!(back.app_id, payload.app_id);
        assert_eq!(back.app_key, payload.app_key);
    }

    #[test]
    fn empty_profile_id_has_no_credential_entry() {
        // 不传配置 id（例如直接调命令）时不去碰凭据库
        assert!(store_entry("").unwrap().is_none());
        assert!(store_entry("   ").unwrap().is_none());
    }

    #[test]
    fn credential_entry_can_be_constructed_for_a_profile() {
        assert!(store_entry("profile_1").unwrap().is_some());
    }

    // ---- 响应解析 ----

    #[test]
    fn parses_single_line_result() {
        let body = r#"{"from":"zh","to":"en","trans_result":[{"src":"苹果","dst":"apple"}]}"#;
        assert_eq!(extract_translation(body).unwrap(), "apple");
    }

    #[test]
    fn joins_multiple_lines_with_newline() {
        let body = r#"{"trans_result":[{"src":"第一行","dst":"line one"},{"src":"第二行","dst":"line two"}]}"#;
        assert_eq!(extract_translation(body).unwrap(), "line one\nline two");
    }

    #[test]
    fn placeholder_survives_when_baidu_returns_it_unchanged() {
        // 百度是统计机器翻译，不保证原样保留占位符；
        // 这里只钉死「它原样返回时我们能正确取到」，还原容错由前端负责。
        let body = r#"{"trans_result":[{"src":"请用[[PF_1]]改写","dst":"Please rewrite it [[PF_1]]"}]}"#;
        assert_eq!(
            extract_translation(body).unwrap(),
            "Please rewrite it [[PF_1]]"
        );
    }

    #[test]
    fn error_code_in_a_200_response_becomes_an_error() {
        let body = r#"{"error_code":"54003","error_msg":"Invalid Access Limit"}"#;
        let error = extract_translation(body).unwrap_err();
        assert_eq!(error.code, "RATE_LIMIT");
        assert!(error.detail.unwrap().contains("54003"));
    }

    #[test]
    fn empty_result_is_reported_as_bad_response() {
        assert_eq!(
            extract_translation(r#"{"trans_result":[]}"#).unwrap_err().code,
            "BAD_RESPONSE"
        );
        assert_eq!(
            extract_translation(r#"{"trans_result":[{"dst":"   "}]}"#)
                .unwrap_err()
                .code,
            "BAD_RESPONSE"
        );
    }

    #[test]
    fn malformed_json_is_reported_as_bad_response() {
        assert_eq!(
            extract_translation("<html>502</html>").unwrap_err().code,
            "BAD_RESPONSE"
        );
    }

    // ---- 错误码映射 ----

    #[test]
    fn documented_error_codes_map_to_our_codes() {
        let cases = [
            ("52001", "TIMEOUT"),
            ("52002", "PROVIDER_ERROR"),
            ("52003", "AUTH"),
            ("54000", "INVALID_INPUT"),
            ("54001", "AUTH"),
            ("54003", "RATE_LIMIT"),
            ("54004", "RATE_LIMIT"),
            ("54005", "RATE_LIMIT"),
            ("58000", "AUTH"),
            ("58001", "INVALID_INPUT"),
            ("58002", "PROVIDER_ERROR"),
            ("90107", "AUTH"),
        ];
        for (baidu_code, ours) in cases {
            let error = map_error_code(baidu_code, "some message");
            assert_eq!(error.code, ours, "错误码 {baidu_code} 映射不对");
            assert!(!error.message.is_empty(), "错误码 {baidu_code} 缺少中文提示");
        }
    }

    #[test]
    fn unknown_error_code_still_produces_a_chinese_message() {
        let error = map_error_code("99999", "");
        assert_eq!(error.code, "PROVIDER_ERROR");
        assert!(error.message.contains("99999"));
        assert!(error.message.chars().any(|c| !c.is_ascii()));
    }

    #[test]
    fn truncate_is_char_safe() {
        assert_eq!(truncate("把这段话改写得更礼貌", 4), "把这段话…");
        assert_eq!(truncate("abc", 10), "abc");
    }
}
