fn main() {
    /*
     * 图标依赖（D56）。
     *
     * tauri-build 会把 `bundle.icon` 里的 `icon.ico` 写进 resource.rc、再编成 resource.lib 链进 exe，
     * **但 build script 默认不会因为「图标文件变了」而重跑**：换完图标直接 build，cargo 认为
     * 构建脚本是新鲜的，链接的仍是上一次的 resource.lib —— 现象是「exe 一切正常，
     * 只有任务栏/资源管理器/开始菜单还是旧图标」，几乎无法与缓存问题联系起来（本轮真踩）。
     * 因此这里显式声明对图标目录的依赖，让换图标必然触发资源重建。
     */
    println!("cargo:rerun-if-changed=icons");

    /*
     * 应用清单注入：**当前停用**。
     *
     * 背景（本轮排查结论）：
     * - 目标机器上，注入清单的版本**连 main() 都进不到**（没有任何日志）就 0xc0000409 崩溃；
     *   同一台机器上同一个 exe，我这边拉起来能进 main()，说明差异与清单/加载器有关。
     * - 停用清单后（本文件下面那行被注释掉的状态），应用能进 main() 并写出启动日志。
     *
     * 因此这里暂时保持停用，先把"应用能启动"这条底线恢复；UAC 提示的处理另见
     * docs/ARCHITECTURE.md §6.8.1 与 §6.9.1（清单不是唯一手段，但它是白灯/黄灯的取舍点）。
     * 若将来要重新启用：把下面三行取消注释，并用 `npm run verify:packaging` 验证，
     * 同时在**真实机器**上确认能正常启动（源码正确 ≠ 产物能启动，这条已经踩过两次）。
     */
    // let windows =
    //     tauri_build::WindowsAttributes::new().app_manifest(include_str!("manifest.xml"));
    // tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
    //     .expect("构建脚本失败：无法写入 Windows 资源 / 应用清单");

    tauri_build::try_build(tauri_build::Attributes::new())
        .expect("构建脚本失败：无法写入 Windows 资源");
}
