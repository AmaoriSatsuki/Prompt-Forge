// Prevents additional console window on Windows in release, DO NOT REMOVE!!
//
// 诊断期曾临时改成 console 子系统（好让 panic 显示出来），现已恢复：
// 因为实测结论是「崩溃发生在 native 层，不是 Rust panic」，控制台没有带来额外信息，
// 而它对用户是多余的噪声。崩溃排查改由 startup.log + panic 钩子承担（见 src/logging.rs）。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    prompt_forge_lib::run()
}
