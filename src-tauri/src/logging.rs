use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

// Runtime diagnostics log.
//
// Why this exists: the packaged exe crashed on startup with Windows event log
// entry `0xc0000409` (fast fail / BEX64) and **no visible reason at all**.
// The release profile sets `panic = "abort"`, and a Rust abort on Windows shows
// up exactly as 0xc0000409, so the cause was invisible.
//
// Two mechanisms:
// 1. startup checkpoints: write down "how far did we get" so a crash without any
//    UI still leaves evidence;
// 2. a panic hook: with `panic = "abort"` the process dies immediately, so the hook
//    must flush **synchronously** (writing a file is safe here).
//
// Log file: `%APPDATA%\com.promptforge.app\startup.log`
//
// IMPORTANT: every message written here is **plain ASCII on purpose**.
// A previous version wrote Chinese text and the file showed up as mojibake in
// editors that decoded it with the local ANSI code page. Diagnostics must be
// readable in Notepad on the broken machine, so keep this file ASCII-only.
const APP_DIR_NAME: &str = "com.promptforge.app";
const LOG_FILE_NAME: &str = "startup.log";

fn app_dir() -> Option<PathBuf> {
    let base = std::env::var_os("APPDATA").or_else(|| std::env::var_os("LOCALAPPDATA"))?;
    Some(PathBuf::from(base).join(APP_DIR_NAME))
}

fn log_path() -> Option<PathBuf> {
    Some(app_dir()?.join(LOG_FILE_NAME))
}

/// Timestamp in milliseconds since the Unix epoch (no external dependency).
fn now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

/// Append one line. Any failure is swallowed: logging must never become a new fault.
pub fn log_line(message: &str) {
    let Some(path) = log_path() else { return };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) else {
        return;
    };
    let _ = writeln!(file, "[{}] {}", now_millis(), message);
    let _ = file.flush();
}

/// Record the runtime environment. When "works as admin, fails as a normal user"
/// is the symptom, "can we write to our own directories" is usually the answer.
pub fn log_environment() {
    let exe = std::env::current_exe()
        .map(|path| path.display().to_string())
        .unwrap_or_else(|_| "(unavailable)".to_string());
    log_line("========== START ==========");
    log_line(&format!("exe={exe}"));
    if let Some(dir) = app_dir() {
        let writable = fs::create_dir_all(&dir).is_ok()
            && OpenOptions::new()
                .create(true)
                .append(true)
                .open(dir.join("probe.tmp"))
                .is_ok();
        log_line(&format!(
            "app_dir={} writable={}",
            dir.display(),
            writable
        ));
    }
    if let Ok(cwd) = std::env::current_dir() {
        log_line(&format!("cwd={}", cwd.display()));
    }
}

/// Install the panic hook so a panic still leaves a readable trace in the log.
pub fn install_panic_hook() {
    std::panic::set_hook(Box::new(|info| {
        let location = info
            .location()
            .map(|loc| format!("{}:{}:{}", loc.file(), loc.line(), loc.column()))
            .unwrap_or_else(|| "(unknown location)".to_string());
        let payload = if let Some(text) = info.payload().downcast_ref::<&str>() {
            (*text).to_string()
        } else if let Some(text) = info.payload().downcast_ref::<String>() {
            text.clone()
        } else {
            "(panic payload not readable)".to_string()
        };
        // Panicking inside a panic hook aborts immediately, so guard it.
        let _ = std::panic::catch_unwind(|| {
            log_line(&format!("!! panic: {payload}"));
            log_line(&format!("!! at {location}"));
        });
    }));
}
