use std::time::Instant;

use crate::baidu_translate;
use crate::error::AppError;
use crate::models::{ProviderProfile, TestReport};

/// 协议类型：百度翻译有自己的 REST 接口与签名。
const KIND_BAIDU: &str = "baidu-translate";

/// 连接测试。
///
/// 连不上是测试的正常结论之一，因此用 Ok(TestReport{ok:false}) 而不是 Err 返回，
/// 界面可以把「结论 + 原因」一起显示出来。
///
/// 百度翻译的凭据在系统凭据库或环境变量里，没有「界面凭据是否已填」这一步，
/// 直接真跑一次最短的请求（固定文本「你好」）。
#[tauri::command]
pub async fn test_connection(profile: ProviderProfile) -> Result<TestReport, AppError> {
    // 未实现的服务（腾讯）没有通道可用：直接给中文结论，不要拿百度的凭据去试
    if profile.protocol() != KIND_BAIDU {
        return Ok(TestReport {
            ok: false,
            elapsed_ms: 0,
            message: "这套配置选择的翻译服务尚未支持，请在设置里改成百度翻译".to_string(),
        });
    }

    let started = Instant::now();
    Ok(match baidu_translate::resolve_credentials(&profile.id) {
        Err(error) => TestReport {
            ok: false,
            elapsed_ms: 0,
            message: error.message,
        },
        Ok((_credentials, source)) => {
            // 把凭据来源一并告诉用户：改了没生效时，这一条就能说清用的是哪一份
            match baidu_translate::baidu_translate(
                "你好".to_string(),
                "zh".to_string(),
                "en".to_string(),
                Some(profile.id.clone()),
            )
            .await
            {
                Ok(result) => TestReport {
                    ok: true,
                    elapsed_ms: result.elapsed_ms,
                    message: format!(
                        "连接正常（凭据来自{}，用时 {} 毫秒）",
                        source.label(),
                        result.elapsed_ms
                    ),
                },
                Err(error) => TestReport {
                    ok: false,
                    elapsed_ms: started.elapsed().as_millis() as u64,
                    message: error.message,
                },
            }
        }
    })
}
