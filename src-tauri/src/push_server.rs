//! 实时推流的 WebSocket 服务端（D81）。
//!
//! 目标：榫言本地起一个只监听 `127.0.0.1:<端口>` 的 WebSocket 服务，
//! 工作区的「最终拼接文本」一变就把最新值广播出去，供 ComfyUI 的
//! 「SunYan Sync」节点实时读取。
//!
//! 结构（三层，互不阻塞）：
//! ```text
//! 前端（React）
//!   └─ invoke broadcast_translation(global, modules)  ← 200ms 防抖由前端负责，Rust 不再攒
//!        └─ push() → Hub.broadcast()           ← 记下「最新值」+ 扔进广播通道
//!             └─ 每个客户端的任务              ← 通道 → WebSocket 帧
//! 监督者任务（supervise）
//!   └─ 按 push-settings.json 的目标（开关 / 端口）绑定监听；设置一变就重建
//! ```
//!
//! 几条刻意的设计：
//! - **不阻塞主进程**：绑定与收发全在 tauri 的异步 runtime 上，界面不等任何网络动作；
//! - **没有客户端也照记最新值**：ComfyUI 后连上时立刻收到当前文本，不用等用户再打字；
//! - **只推不收**：这个方向是单向的，客户端发来的文本帧忽略（但 ping 要回）；
//! - **任何网络错误只写日志**：端口被占用、客户端半路断开，都绝不能影响界面；
//! - **退出时主动断开**：应用关闭时收掉客户端连接，ComfyUI 那边不会留下半开的连接。
//!
//! 日志走 `logging::log_line`（那个文件**只允许 ASCII**，见 `logging.rs` 的说明），
//! 因此这里的中文只出现在注释与测试断言里，日志行一律英文缩写。

use std::collections::BTreeMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use tauri::{AppHandle, Manager};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, watch};
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::Message;

use crate::commands::push::PUSH_SETTINGS_FILE;
use crate::logging;
use crate::models::{PushSettings, PUSH_PORT_MAX, PUSH_PORT_MIN};

/// WebSocket 帧里的消息类型。这是**对 ComfyUI 节点的协议字段**，
/// 不是界面文案，因此保持英文小写下划线（与节点那边约定的字符串一致）。
const MESSAGE_TYPE_TRANSLATION: &str = "translation_update";

/// 广播通道容量：只在某个客户端自己处理不过来时才有意义 —— 落后就丢旧帧，
/// 绝不因为一个慢客户端把推流堵住。
const BROADCAST_CAPACITY: usize = 16;

/// 监听套接字出错后的退避时间（例如句柄耗尽）：歇一下再 accept，不空转烧 CPU。
const ACCEPT_RETRY_DELAY: Duration = Duration::from_millis(500);

/// 只监听本机回环地址：推流内容是用户的工作文本，不对外网开放。
const BIND_ADDRESS: &str = "127.0.0.1";

// ---------------------------------------------------------------------------
// 协议帧
// ---------------------------------------------------------------------------

/// 推流帧（D81 / D90）：
/// `{"type":"translation_update","global":"…","modules":{"1":"…","2":"","3":"…"}}`。
///
/// `global` 是整段拼接文本（与「全文复制」同源，单行），`modules` 是**按行位置**切开的
/// 每一排文本（键 `"1"`..`"9"`，空排是空串）。ComfyUI 那边的节点可以选「全局」或「模块 N」，
/// 选中模块时只取那一块去编码，从而让多个 CLIP 各自吃到互不混杂的提示词。
///
/// 两者都用借用：整个帧在 `frame_of` 里一次性序列化完，不复制大字符串。
#[derive(Debug, Serialize)]
struct TranslationUpdate<'a> {
    #[serde(rename = "type")]
    kind: &'static str,
    global: &'a str,
    modules: &'a BTreeMap<String, String>,
}

/// 把文本包装成协议帧（JSON 序列化负责转义引号 / 反斜杠 / 换行）。
///
/// 帧的构建放在 Rust 侧（而不是前端拼 JSON 字符串）：
/// 前端只交文本，转义这件事就只有一个出口，不会因为某处手拼 JSON 把帧搞坏。
///
/// `modules` 用 `BTreeMap`：序列化出来的键顺序因此**确定**（`"1"`..`"9"` 升序），
/// 断言能钉死整帧字符串，也避免键顺序抖动让前端「内容没变」的去重误判。
pub fn frame_of(global: &str, modules: &BTreeMap<String, String>) -> String {
    serde_json::to_string(&TranslationUpdate {
        kind: MESSAGE_TYPE_TRANSLATION,
        global,
        modules,
    })
    // 只有「结构体里出现无法序列化的东西」才会失败，这里不可能发生；
    // 真发生了也不能 panic（release 是 panic = "abort"），退回一个空帧即可。
    .unwrap_or_else(|_| String::from("{}"))
}

// ---------------------------------------------------------------------------
// 连接登记表
// ---------------------------------------------------------------------------

/// 一个已连接的客户端。
///
/// 保留 `JoinHandle` 是为了「关开关 / 改端口 / 退出应用」时能把连接**真正掐断**，
/// 而不是让它悄悄挂着继续收帧（那会让 ComfyUI 那边以为还连着）。
struct Client {
    peer: SocketAddr,
    task: JoinHandle<()>,
}

/// 服务端的共享状态：广播通道 + 连接登记表 + 最后一条推流。
pub struct Hub {
    updates: broadcast::Sender<String>,
    clients: Mutex<Vec<Client>>,
    /// 最后一次推流的帧。`None` = 还没推过；`Some("")` 不是这个类型的状态，
    /// 因为「空文本」推出去是带 `{"text":""}` 的合法帧。
    latest: Mutex<Option<String>>,
}

impl Hub {
    fn new() -> Self {
        // 先建通道再丢掉初始 receiver：没有客户端时 send 会失败，这是正常情况（见 broadcast）
        let (updates, _receiver) = broadcast::channel(BROADCAST_CAPACITY);
        Self {
            updates,
            clients: Mutex::new(Vec::new()),
            latest: Mutex::new(None),
        }
    }

    /// 在线客户端数量
    fn client_count(&self) -> usize {
        // 锁中毒只可能发生在别的线程 panic 之后；这里退化成 0，不传染
        self.clients
            .lock()
            .map(|clients| clients.len())
            .unwrap_or(0)
    }

    /// 记下最新帧（后连上的客户端立刻补收它）
    fn remember(&self, payload: &str) {
        if let Ok(mut latest) = self.latest.lock() {
            *latest = Some(payload.to_string());
        }
    }

    /// 取最新帧
    fn latest(&self) -> Option<String> {
        self.latest.lock().ok().and_then(|latest| latest.clone())
    }

    /// 为一个刚连上的客户端起任务
    fn spawn_client(self: &Arc<Self>, stream: TcpStream, peer: SocketAddr) {
        let hub = Arc::clone(self);
        let task = tokio::spawn(async move {
            hub.serve_client(stream, peer).await;
            hub.forget(peer);
        });
        if let Ok(mut clients) = self.clients.lock() {
            clients.push(Client { peer, task });
        }
        logging::log_line(&format!(
            "ws client connected {peer} clients={}",
            self.client_count()
        ));
    }

    /// 客户端任务结束时把它从登记表里摘掉
    fn forget(&self, peer: SocketAddr) {
        if let Ok(mut clients) = self.clients.lock() {
            clients.retain(|client| client.peer != peer);
        }
        logging::log_line(&format!(
            "ws client gone {peer} clients={}",
            self.client_count()
        ));
    }

    /// 掐断所有客户端（关开关 / 改端口 / 退出应用）
    fn disconnect_all(&self) {
        let Ok(mut clients) = self.clients.lock() else {
            return;
        };
        let count = clients.len();
        for client in clients.drain(..) {
            // abort 只是让任务停下；真正的 TCP 连接随任务里的 socket 一起关闭
            client.task.abort();
        }
        if count > 0 {
            logging::log_line(&format!("ws clients disconnected count={count}"));
        }
    }

    /// 单个客户端的主循环：握手 → 补发最新值 → 通道帧 → 帧。
    async fn serve_client(&self, stream: TcpStream, peer: SocketAddr) {
        let mut socket = match tokio_tungstenite::accept_async(stream).await {
            Ok(socket) => socket,
            Err(error) => {
                logging::log_line(&format!("!! ws handshake failed {peer}: {error}"));
                return;
            }
        };

        // 先订阅、再补发最新值：
        // 两者之间若恰好又来一次推流，客户端会连收两条，**最后一条才是最新的**，
        // 顺序是对的；反过来（先补发再订阅）就会丢掉那一次推流。
        let mut updates = self.updates.subscribe();
        if let Some(payload) = self.latest() {
            if socket.send(Message::Text(payload.into())).await.is_err() {
                return;
            }
        }

        loop {
            tokio::select! {
                incoming = socket.next() => match incoming {
                    // 对端正常关闭
                    None => return,
                    Some(Err(error)) => {
                        logging::log_line(&format!("!! ws read failed {peer}: {error}"));
                        return;
                    }
                    // 这个方向只推不收：文本帧没有意义（忽略），close 帧要收尾
                    Some(Ok(message)) => {
                        if message.is_close() {
                            return;
                        }
                    }
                },
                update = updates.recv() => match update {
                    Ok(payload) => {
                        if socket.send(Message::Text(payload.into())).await.is_err() {
                            return;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(skipped)) => {
                        // 这个客户端太慢，丢了旧帧：最新一条马上会到，继续即可
                        logging::log_line(&format!("ws client lagged {peer} skipped={skipped}"));
                    }
                    Err(broadcast::error::RecvError::Closed) => return,
                },
            }
        }
    }
}

/// 推流一次，返回（在线客户端数，`global` 字符数）。
///
/// 「没有客户端」不是错误：服务端照样记下最新值，ComfyUI 一连上就能收到它。
pub fn broadcast(
    hub: &Hub,
    global: &str,
    modules: &BTreeMap<String, String>,
) -> (usize, usize) {
    let payload = frame_of(global, modules);
    hub.remember(&payload);
    let receivers = hub.updates.receiver_count();
    // send 失败只说明此刻没有任何订阅者（没有客户端），属于正常情况
    let _ = hub.updates.send(payload);
    let chars = global.chars().count();
    // 日志只允许 ASCII（startup.log 有打包断言守着），因此这里用英文缩写
    logging::log_line(&format!(
        "ws broadcast chars={chars} modules={} receivers={receivers}",
        modules.len()
    ));
    (hub.client_count(), chars)
}

// ---------------------------------------------------------------------------
// 服务目标与监督者
// ---------------------------------------------------------------------------

/// 监督者要满足的目标：开不开、监听哪个端口。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Target {
    enabled: bool,
    port: u16,
}

/// 把设置折算成目标。端口先夹一遍再转 u16：
/// 写盘前已经夹过（`PushSettings::normalized`），但那只是「写盘路径」的保证，
/// 这里再夹一次，`u32 → u16` 的转换就永远不会溢出（70000 不会悄悄变成 4464）。
fn target_of(settings: &PushSettings) -> Target {
    let port = settings.port.clamp(PUSH_PORT_MIN, PUSH_PORT_MAX) as u16;
    Target {
        enabled: settings.enabled,
        port,
    }
}

/// 交给 Tauri 管理的状态。
///
/// `target` 为 `Some` 表示服务在跑；`None` 表示已经关掉（应用正在退出）——
/// 丢掉发送端就等于给监督者一个「结束」信号，不需要额外的布尔开关。
pub struct PushServer {
    hub: Arc<Hub>,
    target: Mutex<Option<watch::Sender<Target>>>,
}

/// 应用启动时按磁盘上的推送设置把服务拉起来（在 `setup` 里调一次）。
pub fn start_from_disk(app: &AppHandle) {
    start(app, &read_settings(app));
}

fn start(app: &AppHandle, settings: &PushSettings) {
    let hub = Arc::new(Hub::new());
    let (target, receiver) = watch::channel(target_of(settings));
    let _ = app.manage(PushServer {
        hub: Arc::clone(&hub),
        target: Mutex::new(Some(target)),
    });
    // 用 tauri 的 runtime 起任务：tauri 的事件循环就是这个 runtime，
    // 因此这里不在任何 runtime 上下文里调用也不会 panic。
    tauri::async_runtime::spawn(supervise(receiver, hub));
    let current = target_of(settings);
    logging::log_line(&format!(
        "ws server starting enabled={} port={}",
        current.enabled, current.port
    ));
}

/// 设置变了（开关 / 端口）时调一次：只发一个新目标，真正的重建在监督者里做。
pub fn apply(app: &AppHandle, settings: &PushSettings) {
    let Some(server) = app.try_state::<PushServer>() else {
        return;
    };
    let target = target_of(settings);
    let sender = match server.target.lock() {
        Ok(guard) => guard.as_ref().cloned(),
        // 锁中毒：放弃这次更新，服务保持现状（比 panic 好）
        Err(_) => None,
    };
    let Some(sender) = sender else {
        logging::log_line("ws settings change ignored (server shut down)");
        return;
    };
    // send 失败 = 监督者已经退出，没有任何接收端
    if sender.send(target).is_err() {
        logging::log_line("ws settings change not delivered");
    }
    logging::log_line(&format!(
        "ws settings applied enabled={} port={}",
        target.enabled, target.port
    ));
}

/// 读取推送设置；读不到就用默认值（开启、8713）—— 推送设置坏了不该拦住启动。
fn read_settings(app: &AppHandle) -> PushSettings {
    let fallback = PushSettings::default();
    let Ok(path) = crate::commands::app_data_file(app, PUSH_SETTINGS_FILE) else {
        logging::log_line("ws settings path unavailable, using defaults");
        return fallback;
    };
    match crate::storage::read_json::<PushSettings>(&path) {
        Ok(Some(settings)) => settings.normalized(),
        Ok(None) => fallback,
        Err(error) => {
            logging::log_line(&format!("ws settings unreadable, using defaults: {error:?}"));
            fallback
        }
    }
}

/// 应用退出时关掉服务：断开客户端，监督者收尾。
pub fn shutdown(app: &AppHandle) {
    let Some(server) = app.try_state::<PushServer>() else {
        return;
    };
    let sender = match server.target.lock() {
        Ok(mut guard) => guard.take(),
        Err(_) => None,
    };
    // 丢掉发送端 ⇒ 监督者里的 watch 变 Closed ⇒ 它自己退出并掐断连接
    drop(sender);
    server.hub.disconnect_all();
    logging::log_line("ws server shut down");
}

/// 命令层用的推流入口：拿到 Hub 就推，服务没起来就只记字符数。
pub fn push(app: &AppHandle, global: &str, modules: &BTreeMap<String, String>) -> (usize, usize) {
    match app.try_state::<PushServer>() {
        Some(server) => broadcast(&server.hub, global, modules),
        None => {
            logging::log_line("ws push ignored (server not started)");
            (0, global.chars().count())
        }
    }
}

/// 监督者：按目标绑定监听，设置一变就重建。
///
/// 之所以不在「设置变化」的回调里直接绑定，是为了让绑定 / 解绑都发生在同一个任务里，
/// 端口切换不会出现「旧的还没放开、新的已经要绑」的抢占窗口。
async fn supervise(mut target: watch::Receiver<Target>, hub: Arc<Hub>) {
    loop {
        let current = *target.borrow_and_update();

        if current.enabled {
            let address = format!("{BIND_ADDRESS}:{}", current.port);
            match TcpListener::bind(&address).await {
                Ok(listener) => {
                    logging::log_line(&format!("ws listening on {address}"));
                    match accept_loop(listener, &hub, &mut target).await {
                        // 设置变了：回顶部按新目标重新绑定
                        Stop::Changed => continue,
                        // 服务要关了：跳出，统一收尾
                        Stop::Closed => break,
                    }
                }
                Err(error) => {
                    // 端口被占用（例如同时开了两个榫言）/ 无权限：
                    // 记一行日志，然后**等设置变化再试** —— 绝不在这里循环重绑烧 CPU。
                    logging::log_line(&format!("!! ws bind failed {address}: {error}"));
                }
            }
        } else {
            logging::log_line("ws push is off (settings)");
        }

        // 关着 / 绑定失败：等下一次设置变化
        if target.changed().await.is_err() {
            break;
        }
    }

    hub.disconnect_all();
    logging::log_line("ws supervisor exited");
}

/// accept 循环为什么停下来。
enum Stop {
    /// 设置变了，要按新目标重建监听
    Changed,
    /// 服务要关了
    Closed,
}

async fn accept_loop(
    listener: TcpListener,
    hub: &Arc<Hub>,
    target: &mut watch::Receiver<Target>,
) -> Stop {
    loop {
        tokio::select! {
            // biased：设置变化优先于接受新连接，改端口时不会再多接一个到旧端口上
            biased;
            changed = target.changed() => {
                return if changed.is_err() { Stop::Closed } else { Stop::Changed };
            }
            accepted = listener.accept() => {
                match accepted {
                    Ok((stream, peer)) => hub.spawn_client(stream, peer),
                    Err(error) => {
                        // 监听套接字本身出问题（例如句柄耗尽）：歇一下继续，不打断服务
                        logging::log_line(&format!("!! ws accept failed: {error}"));
                        tokio::time::sleep(ACCEPT_RETRY_DELAY).await;
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::PUSH_PORT_DEFAULT;

    /// 等待在线客户端数量达到预期（最多 2 秒），避免断言跟调度赛跑。
    async fn wait_for_clients(hub: &Arc<Hub>, expected: usize) {
        for _ in 0..200 {
            if hub.client_count() == expected {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!(
            "客户端没有在预期时间内连上：期望 {expected} 个，实际 {} 个",
            hub.client_count()
        );
    }

    /// 从一个已连上的客户端读下一帧文本（3 秒超时，避免测试挂死）。
    async fn next_text(
        socket: &mut tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<TcpStream>,
        >,
    ) -> String {
        let message = tokio::time::timeout(Duration::from_secs(3), socket.next())
            .await
            .expect("等帧超时")
            .expect("连接已结束")
            .expect("读帧失败");
        match message {
            Message::Text(text) => text.to_string(),
            other => panic!("期望文本帧，收到 {other:?}"),
        }
    }

    /// 造一份按行位置的模块字典（键就是 `"1"`..`"9"` 里的序号）
    fn modules_of(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
            .collect()
    }

    #[test]
    fn frame_is_the_agreed_protocol_json() {
        let modules = modules_of(&[("1", "Chihaya Anon"), ("3", "smile")]);
        assert_eq!(
            frame_of("Chihaya Anon, smile.", &modules),
            r#"{"type":"translation_update","global":"Chihaya Anon, smile.","modules":{"1":"Chihaya Anon","3":"smile"}}"#
        );
        // 空文本也要是一个带 global / modules 字段的合法帧
        // （前端在全空时推空字符串 + 9 个空槽）
        assert_eq!(
            frame_of("", &BTreeMap::new()),
            r#"{"type":"translation_update","global":"","modules":{}}"#
        );
    }

    #[test]
    fn frame_escapes_quotes_and_keeps_chinese() {
        let modules = modules_of(&[("1", r#"a "quoted""#)]);
        let frame = frame_of(r#"a "quoted" \ back"#, &modules);
        assert_eq!(
            frame,
            r#"{"type":"translation_update","global":"a \"quoted\" \\ back","modules":{"1":"a \"quoted\""}}"#
        );
        // 中文原样保留（serde_json 不会转成 \uXXXX）
        assert!(frame_of("中文 tag", &modules_of(&[("2", "中文 tag")])).contains("中文 tag"));
    }

    /// D90：模块字典的键必须是**确定的升序**（`"1"`..`"9"`），空槽也要在场。
    ///
    /// 键顺序抖动会让前端「内容没变就不推」的指纹误判（多推一帧无害，
    /// 但断言就没法钉死整帧，排查时也看不清）。
    #[test]
    fn frame_keeps_module_slots_in_ascending_order() {
        let modules = modules_of(&[("9", "nine"), ("2", ""), ("1", "one")]);
        let frame = frame_of("one, nine.", &modules);
        assert_eq!(
            frame,
            r#"{"type":"translation_update","global":"one, nine.","modules":{"1":"one","2":"","9":"nine"}}"#
        );
        // 空槽（模块存在但没有内容）必须原样出现在帧里，插件端才能区分「空」与「没有这个键」
        assert!(frame.contains(r#""2":"""#), "{frame}");
    }

    #[test]
    fn target_clamps_port_before_narrowing() {
        assert_eq!(
            target_of(&PushSettings { enabled: true, port: 80 }),
            Target { enabled: true, port: PUSH_PORT_MIN as u16 }
        );
        assert_eq!(
            target_of(&PushSettings { enabled: true, port: 70_000 }),
            Target { enabled: true, port: PUSH_PORT_MAX as u16 },
            "越界端口必须夹到 65535，而不是 u32→u16 截断出的 4464"
        );
        assert_eq!(
            target_of(&PushSettings::default()),
            Target { enabled: true, port: PUSH_PORT_DEFAULT as u16 }
        );
        assert!(!target_of(&PushSettings { enabled: false, port: 8713 }).enabled);
    }

    #[test]
    fn hub_starts_empty_and_remembers_latest() {
        let hub = Hub::new();
        assert_eq!(hub.client_count(), 0);
        assert!(hub.latest().is_none(), "还没推过时不该有最新值");

        let modules = modules_of(&[("1", "Cha, long hair")]);
        let (clients, chars) = broadcast(&hub, "Cha, long hair.", &modules);
        assert_eq!(clients, 0, "没人连上也算推过了");
        assert_eq!(chars, 15, "chars 报的是 global 的字符数");
        assert_eq!(hub.latest().unwrap(), frame_of("Cha, long hair.", &modules));

        // 空文本同样要记成最新值（帧还在，只是 global 为空、模块槽为空）
        broadcast(&hub, "", &BTreeMap::new());
        assert_eq!(
            hub.latest().unwrap(),
            r#"{"type":"translation_update","global":"","modules":{}}"#
        );
    }

    /// 端到端：真的开一个监听、真的连一个客户端，验证收得到帧。
    #[tokio::test]
    async fn connected_client_receives_broadcast() {
        let hub = Arc::new(Hub::new());
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (_target, mut receiver) = watch::channel(Target {
            enabled: true,
            port: address.port(),
        });

        let serving = {
            let hub = Arc::clone(&hub);
            tokio::spawn(async move { accept_loop(listener, &hub, &mut receiver).await })
        };

        let (mut socket, _response) =
            tokio_tungstenite::connect_async(format!("ws://{address}"))
                .await
                .expect("客户端握手失败");
        wait_for_clients(&hub, 1).await;

        let modules = modules_of(&[("1", "Chihaya Anon"), ("2", "smile")]);
        broadcast(&hub, "Chihaya Anon, smile.", &modules);
        assert_eq!(
            next_text(&mut socket).await,
            frame_of("Chihaya Anon, smile.", &modules)
        );

        // 再推一次空文本：这条也要送到（全空时推空字符串是明确需求）
        broadcast(&hub, "", &BTreeMap::new());
        assert_eq!(next_text(&mut socket).await, frame_of("", &BTreeMap::new()));

        serving.abort();
    }

    /// 后连上的客户端要立刻收到「最后一次推流」，而不是干等到用户再打字。
    /// D90 起这条更关键：节点切到「模块 N」后连上来，也必须马上拿到那一块。
    #[tokio::test]
    async fn late_client_gets_the_latest_text_immediately() {
        let hub = Arc::new(Hub::new());
        // 先推一次：此刻没有任何客户端
        let modules = modules_of(&[("1", "Cha, long hair"), ("2", "smile")]);
        broadcast(&hub, "Cha, long hair, smile.", &modules);

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (_target, mut receiver) = watch::channel(Target {
            enabled: true,
            port: address.port(),
        });
        let serving = {
            let hub = Arc::clone(&hub);
            tokio::spawn(async move { accept_loop(listener, &hub, &mut receiver).await })
        };

        let (mut socket, _response) = tokio_tungstenite::connect_async(format!("ws://{address}"))
            .await
            .expect("客户端握手失败");

        assert_eq!(
            next_text(&mut socket).await,
            frame_of("Cha, long hair, smile.", &modules),
            "连上就该拿到当前文本（含按模块切开的字典）"
        );

        serving.abort();
    }
}
