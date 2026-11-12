use serde::Serialize;

/// 统一的命令错误形状，前端 api/tauri.ts 会把它还原成 IpcError。
///
/// message 直接就是中文用户文案（整个应用只面向中文用户），
/// detail 存放技术细节，只用于排查，不直接展示给用户。
#[derive(Debug, Serialize)]
pub struct AppError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl AppError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
            detail: None,
        }
    }

    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }

    pub fn io(message: &str, error: std::io::Error) -> Self {
        Self::new("IO", message).with_detail(error.to_string())
    }
}
