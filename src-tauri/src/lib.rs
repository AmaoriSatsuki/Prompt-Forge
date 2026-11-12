/// Prompt Forge 的 Tauri 后端入口。
///
/// 模块划分：
/// - `commands`：暴露给前端的命令（预设持久化、翻译服务配置、缓存、翻译与连接测试、本地词典、推送设置与推流）
/// - `baidu_translate`：百度翻译专用接入（请求签名、凭据、错误码映射）
/// - `dictionaries`：本地词典解析（CSV / JSON / SQLite）、标准化与索引
/// - `push_server`：本机 WebSocket 实时推流服务（D81，给 ComfyUI 的「SunYan Sync」节点）
/// - `storage`：本地 JSON 读写（原子写 + 损坏留档）
/// - `models`：与前端 types 一一对应的数据结构
/// - `error`：统一错误形状
/// - `logging`：启动检查点与 panic 记录（排查「普通启动闪退」这类看不见的崩溃）
mod baidu_translate;
mod bundle;
mod commands;
mod dictionaries;
mod error;
mod logging;
mod models;
mod push_server;
mod storage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 必须在任何可能 panic 的代码之前装好钩子：release profile 是 panic = "abort"，
    // 装了钩子才能在进程被终止前把原因写进 startup.log。
    logging::install_panic_hook();
    logging::log_environment();
    logging::log_line("building tauri app");

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // 推流服务（D81）：启动时按 push-settings.json 决定是否监听、监听哪个端口。
        // 绑定在异步任务里做，端口被占用之类的意外只写日志，绝不拖慢界面起来。
        .setup(|app| {
            push_server::start_from_disk(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::system::get_app_version,
            commands::presets::load_presets,
            commands::presets::save_presets,
            commands::presets::load_preset_folders,
            commands::presets::save_preset_folders,
            commands::presets::load_library,
            commands::presets::save_library,
            commands::snapshots::load_snapshots,
            commands::snapshots::save_snapshots,
            commands::bundle::export_library_bundle,
            commands::bundle::inspect_library_bundle,
            commands::bundle::import_library_bundle,
            commands::reset::reset_libraries,
            commands::reset::reset_provider_config,
            commands::config::load_config,
            commands::config::save_config,
            commands::cache::load_cache,
            commands::cache::save_cache,
            commands::cache::clear_cache,
            commands::push::load_push_settings,
            commands::push::save_push_settings,
            commands::push::broadcast_translation,
            commands::translate::test_connection,
            baidu_translate::baidu_translate,
            baidu_translate::save_baidu_credentials,
            baidu_translate::has_baidu_credentials,
            baidu_translate::delete_baidu_credentials,
            commands::dictionaries::inspect_dictionary_file,
            commands::dictionaries::import_dictionary_file,
            commands::dictionaries::list_dictionaries,
            commands::dictionaries::read_dictionary_entries,
            commands::dictionaries::set_dictionary_enabled,
            commands::dictionaries::reorder_dictionaries,
            commands::dictionaries::delete_dictionary,
            commands::dictionaries::rescan_dictionaries,
            commands::dictionaries::open_dictionaries_folder,
        ]);

    // 从「单行 run(context)」改成「build + run(回调)」的唯一原因：
    // 要在退出前把推流服务收掉（断开 ComfyUI 那边的连接），单行 run 没有这个时机。
    let app = match builder.build(tauri::generate_context!()) {
        Ok(app) => app,
        Err(error) => {
            // 这里原来用 expect：panic 在 release 下变成 0xc0000409，看不到任何原因。
            // 改成先写日志再返回错误码，退出时至少留下可查的证据。
            logging::log_line(&format!("!! tauri build failed: {error}"));
            std::process::exit(1);
        }
    };

    app.run(|handle, event| match event {
        tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
            push_server::shutdown(handle);
        }
        _ => {}
    });

    logging::log_line("tauri event loop exited normally");
}
