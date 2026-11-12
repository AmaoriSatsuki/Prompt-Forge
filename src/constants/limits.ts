/**
 * 全局数值约束。所有「魔法数字」集中在此，便于按用户反馈调整。
 */

import { PRESET_FILTER_COLORS } from './colors';

/** 模块初始数量（需求 8；用户 2026 轮改为 6） */
export const MODULE_INITIAL_COUNT = 6;

/** 模块数量下限（需求 8） */
export const MODULE_MIN_COUNT = 1;

/**
 * 模块数量上限（需求 8；用户 2026 轮由 8 改为 10，D47 又定为 8，D75 扩回 10）。
 *
 * **D47：颜色与模块一一对应（当时是 8 个）** —— 之前「9 彩 + 1 白」+ 上限 10 会让
 * 第 10 个模块只能轮转复用第 1 色、白块顶替最后一个位置，因此收口成一一对应。
 *
 * **D75：用户实机用了一段时间后判定「8 没有想象中那么多」，要求扩到 10 个模块**，
 * 于是配色同步扩到 10 色（新增棕/灰），两者仍严格相等 —— 一一对应这条不变。
 * 第 11 个模块被拦下（顶栏提示「最多只能有 10 个模块」）。
 *
 * **D85：为了在预设库筛选条里挤进「词典库 D」这个入口，颜色池砍回 9 色
 * （删掉最后一个色块丁香），模块上限同步 10 → 9**，一一对应仍然成立。
 * 第 10 个模块被拦下（顶栏提示「最多只能有 9 个模块」）。
 *
 * 与颜色注册表**仍是两个独立常量**（不自动跟随颜色数量变化，避免「加一种颜色就
 * 悄悄多出一个模块」）；但两者当前必须相等，由 `verify:logic` 的一条断言钉住。
 */
export const MODULE_MAX_COUNT = 9;

/* ---------- 模块行高度（底部细拖拽条调整） ---------- */

/** 单个模块的最小高度（需求：最小高度 56px） */
export const MODULE_MIN_HEIGHT = 56;

/** 新建模块的初始高度（需求 5：初始 56px） */
export const MODULE_DEFAULT_HEIGHT = 56;

/** 单个模块的高度上限（防止一排吃掉整个列表） */
export const MODULE_MAX_HEIGHT = 720;

/* ---------- 单模块中文源内容长度 ---------- */

/**
 * 单个模块的中文源内容上限（**字符数**，不是字节数）。
 *
 * 用户 2026 轮定：**1000 字**。理由——这是模型提示词工具，不是写小说，
 * 200 字都绰绰有余；1000 是「绝对够用、又不想太小」的取值。
 *
 * 与单次**翻译请求**的上限（`MAX_REQUEST_CHARS`）不是一回事：
 * 那是发给引擎的一批切片的大小，比这个小得多。
 *
 * 计数只算**用户看得见的字符**：胶囊锚点 `[[cap:xxx]]` 是内部标记，不占额度。
 */
export const MODULE_SOURCE_MAX_LENGTH = 1000;

/* ---------- 左列：输出列表 / 中文输入框 ---------- */

/**
 * 中文输入框默认高度。
 *
 * 2026 轮：用户要求「刚好让输出列表完整塞下 6 个初始模块」——
 * 按默认窗口 720 反推：
 *   720（窗口）− 48（顶栏）− 16（工作区内边距）− 8（水平分隔条）
 *   − 6×56（6 排模块）− 5×8（模块间距）− 16（输出区内边距）− 2（输出区上下边框）
 *   = 254
 * 这样输出区**恰好**是 6 排、下面不剩空白，也不会出现滚动条。
 * 用户拖过分隔条后以用户值为准（草稿会记住）；窗口尺寸变化时由 flex 自然分配。
 */
export const INPUT_PANE_DEFAULT_HEIGHT = 254;

/** 中文输入框高度下限（再小就没法看内容了） */
export const INPUT_PANE_MIN_HEIGHT = 96;
export const INPUT_PANE_MAX_HEIGHT = 640;

/* ---------- 右列：预设库（宽度三档，见 D48） ---------- */

/*
 * 预设库宽度的三档口径（D48；D77 定稿）：
 * ①**初始宽度**：刚好把色块行的**前 8 块**排成一行 —— 12 块时就是 **8 + 4 两排**
 *    （用户 2026 轮实测后：「初始宽度有一点太宽了……改成第一排装 8 个，第二排 4 个」）；
 * ②**最低宽度**：刚好把 12 块排成 **6+6 两排（两排都满）**，且顶部
 *    「标题 / 计数 / 撤销 / 创建快照」仍排得开（这比纯色块算术更宽，是真正的下限约束）；
 * ③**最大宽度**：窗口宽度的 **70%**（预设库可能有海量胶囊，挑选时值得更宽）。
 *
 * 几何口径必须与 `styles/layout.css` 保持一致，由 `verify:interaction` 的 CSS 契约断言守着：
 * `.pf-swatch` 26×26、`.pf-filter__row` 间距 6px、`.pf-filter` 左右内边距 12px、面板左边框 1px。
 */
export const PRESET_SWATCH_SIZE = 26;
export const PRESET_SWATCH_GAP = 6;
export const PRESET_FILTER_PADDING = 12;
export const PRESET_PANEL_BORDER = 1;

/**
 * 色块行里的方块数量：**9 个筛选色 + 1 个词典库 `D`（D85）+ 1 个画师库 `@`（D62）
 * + 1 个快照库 `S`（D67）＝ 12 块**。
 *
 * D85 的算术很关键：颜色池从 10 减到 9、同时新增词典块，色块总数**仍是 12**，
 * 所以 D77 定的「276px 排 8+4 / 211px 排 6+6」一条都不用改（筛选条仍然不换行）。
 */
export const PRESET_PANEL_SWATCH_COUNT = PRESET_FILTER_COLORS.length + 3;

/**
 * 初始宽度要「一行装下几块」：**8 块**。
 *
 * D77 用户实测口径：「第一排装 8 个，第二排 4 个」——
 * 12 块在 276px 下正好是 8 + 4，比 D75 的 404px（一行 12 块）窄一档，看起来不那么空。
 * 这个数**不随颜色数量变**：以后再加颜色，初始宽度不再跟着变宽，只是第二排多几块。
 */
export const PRESET_PANEL_DEFAULT_ROW_CAPACITY = 8;

/** 初始宽度留的余量：正好 250px 才放得下，留 1px 免得分像素抖动导致换行 */
export const PRESET_PANEL_FIT_SLACK = 1;

/**
 * 预设库初始宽度 = 一行 8 块（8×26 + 7×6）+ 左右内边距 24 + 面板边框 1 + 1px 余量 = **276px**。
 * 12 块因此排成 **8 + 4**。
 */
export const PRESET_PANEL_DEFAULT_WIDTH =
  PRESET_PANEL_DEFAULT_ROW_CAPACITY * PRESET_SWATCH_SIZE +
  (PRESET_PANEL_DEFAULT_ROW_CAPACITY - 1) * PRESET_SWATCH_GAP +
  PRESET_FILTER_PADDING * 2 +
  PRESET_PANEL_BORDER +
  PRESET_PANEL_FIT_SLACK;

/**
 * 预设库最低宽度 211px：内宽 186px ⇒ 一行 6 块（7 块需要 218，放不下）
 * ⇒ 12 块正好 **6+6 两排**（沿用 D70 的口径：最小状态两排都要排满，不能出现 6+5 的空缺；
 * 这 186px 也刚好够快照库顶部「标题 + 计数 + 撤销 + 创建快照」排开）。
 *
 * 为什么不是更窄的 4+4+4（约 147px）：那样顶栏四个元素会被压变形 —— D70 已经用
 * 实测否掉过 180px 以下的取值，186px 是「两排都满」与「顶栏不被压」的交集。
 */
export const PRESET_PANEL_MIN_WIDTH = 211;

/** 预设库最大宽度占窗口宽度的比例（用户 2026 轮：可以占据界面的 70%） */
export const PRESET_PANEL_MAX_RATIO = 0.7;

/**
 * 列表分页的**默认阈值**（D86）：现在四个库（预设 / Tag / 画师 / 快照）统一用它。
 *
 * 沿革：D62 起是画师库的渲染上限，D66 改成两个库共用的分页大小（300）。
 * 用户 2026 轮：「在设置中新增分页功能，在这里可以设置分页阈值，**默认值为 100**，
 * 无论是画师库还是预设库还是快照库都统一采用这个值来设定分页」——
 * 因此它现在只是**默认值**，真实生效值在 `uiStore.libraryPageSize`（设置里可改、记在本地存储）。
 *
 * 保留列表自身的滚动条，只把"一次渲染多少条"固定住：
 * 全量渲染几万条会卡死 WebView2，而翻页是纯计算、可断言、不受窗口尺寸影响。
 */
export const LIBRARY_PAGE_SIZE = 100;

/** 分页阈值的下限：再小就退化成一条一条翻页了 */
export const LIBRARY_PAGE_SIZE_MIN = 20;

/** 分页阈值的上限：再大就等于没分页（几万条的库一次画出来会卡住） */
export const LIBRARY_PAGE_SIZE_MAX = 1000;

/**
 * 画师热度阈值默认值（D65）：导入时带 `post_count` 列的文件里，
 * 作品数低于它的画师会被跳过。用户可在导入前那个「命名」弹窗里改（0 = 不过滤）。
 * 与 Rust 端的默认值保持一致。
 */
export const ARTIST_MIN_POST_COUNT = 100;

/**
 * 落盘值的绝对兜底上限：真正的上限是「窗口宽度的 70%」，但草稿解析发生在
 * 还不知道窗口宽度的时候（纯函数），因此先按这个宽松上限夹一次脏数据，
 * 挂载后再按实际窗口宽度夹一次（见 `utils/panelWidth.ts` 与 `AppShell`）。
 */
export const PRESET_PANEL_STORAGE_MAX_WIDTH = 4000;

/** 窗口宽度的兜底值：非浏览器环境（SSR / 断言）下用它计算 70% 上限 */
export const DEFAULT_VIEWPORT_WIDTH = 1920;

/* ---------- 预设 ---------- */

/** 预设权重默认值（需求 5） */
export const PRESET_WEIGHT_DEFAULT = 100;

/** 预设权重下限（需求 5：最低 0，无上限） */
export const PRESET_WEIGHT_MIN = 0;

/** 预设默认命名的前缀：与序号组成「胶囊 1」「胶囊 2」 */
export const PRESET_LABEL_PREFIX = '胶囊';

/** toast 自动消失时间（ms） */
export const TOAST_DURATION_MS = 2600;

/** 预设落盘的防抖时间（ms）：连续调整权重时只在停手后写一次磁盘 */
export const PERSIST_DEBOUNCE_MS = 400;

/** 会话草稿的防抖时间（ms）：打字频繁，比预设稍长一点 */
export const DRAFT_DEBOUNCE_MS = 700;

/** 权重步进器的步长 */
export const PRESET_WEIGHT_STEP = 10;

/* ---------- 输入框胶囊的权重（D120 / UI.html 原稿：控件做在药丸内部） ---------- */

/** 胶囊权重默认值：等于它就不带括号（不加权 = 原样） */
export const CAPSULE_WEIGHT_DEFAULT = 1;

/** 胶囊权重步进：− / + 一次走 0.05（用户 2026-11 拍板） */
export const CAPSULE_WEIGHT_STEP = 0.05;

/** 胶囊权重下限 / 上限：0.1–3.0（用户 2026-11 拍板） */
export const CAPSULE_WEIGHT_MIN = 0.1;
export const CAPSULE_WEIGHT_MAX = 3;

/** 胶囊权重的小数位：两位，手输与显示都按它收口 */
export const CAPSULE_WEIGHT_DECIMALS = 2;

/* ---------- 指针拖拽 ---------- */

/** 按下后移动超过这个距离才算「开始拖拽」，避免把点击/双击当成拖拽 */
export const DRAG_START_THRESHOLD_PX = 6;

/** 两次点击间隔小于这个时间且位置足够近，算双击 */
export const DOUBLE_TAP_MAX_DELAY_MS = 400;
export const DOUBLE_TAP_MAX_DISTANCE_PX = 6;

/* ---------- 翻译服务 ---------- */

/**
 * 百度翻译标准版限每秒 1 次请求，因此两次请求之间强制留 1.1 秒。
 * 取 1100 而不是 1000 是为了留出网络往返与时钟抖动的余量。
 *
 * 注：语言模型接入（接口地址 / 模型名 / 超时 / 温度）已随接入方式整体剔除，
 * 相关的 `DEFAULT_TIMEOUT_MS` 等常量一并删除，这里只剩专业翻译接口自己的节流。
 */
export const BAIDU_MIN_INTERVAL_MS = 1100;

/* ---------- 切片翻译（V3 第二层） ---------- */

/**
 * 单次请求的文本上限（**字节**，UTF-8）。
 *
 * 与 Rust 侧 `baidu_translate.rs` 的 `MAX_QUERY_BYTES` 是同一个口径（都是 UTF-8 字节数）：
 * 超过就分批发送，避免请求被接口直接拒掉。这里在**前端**按同一口径预分批，
 * Rust 那层仍然是最终兜底。
 */
export const MAX_QUERY_BYTES = 6000;

/**
 * 单次**翻译请求**的数值上限：一批切片的总字数（可见字符，不含分隔用的换行）。
 *
 * 用户 2026 轮定：**1000 字**，与「单个模块能写多少字」（`MODULE_SOURCE_MAX_LENGTH`）一致。
 * 理由——改成实时翻译后请求是按模块发的、还有缓存兜着，一次要翻的内容本来就少；
 * 1000 是「绝对够用、又不想太小」的取值。两个上限取同一个数，
 * 于是**正常使用下一个模块恰好一次请求发完**，无需分批。
 *
 * `MAX_QUERY_BYTES = 6000` 是接口的物理边界，仍作**保险丝**保留：
 * 1000 汉字 ≈ 3000 字节，离它很远，正常永不触发。
 */
export const MAX_REQUEST_CHARS = 1000;

/** 切片之间拼成一次请求时使用的分隔符 */
export const SLICE_JOIN_SEPARATOR = '\n';

/** 片段最终拼接回译文时使用的分隔符（末尾不加） */
export const SLICE_OUTPUT_SEPARATOR = ', ';

/* ---------- 实时翻译调度层（V3 第一层） ---------- */

/** 实时翻译的防抖时间：用户停手 500ms 才发请求 */
export const REALTIME_DEBOUNCE_MS = 500;

/** 翻译缓存条数上限，超出按 LRU 淘汰 */
export const CACHE_MAX_ENTRIES = 10_000;

/** 缓存落盘节流：写入频繁，攒一会儿再写一次磁盘 */
export const CACHE_PERSIST_DEBOUNCE_MS = 2_000;

/**
 * 术语表版本：术语表内容变化时必须改这个值，否则旧译文会继续命中缓存。
 *
 * 2026 轮（D50）：本地词典落地，版本从 `v0` 升到 **`v1`** —— 升级前的翻译缓存
 * 全部作废，避免「词典已经变了，界面还是旧译文」。
 *
 * 之后**每次词典内容变化**（导入/删除/排序/启停）不再改这个常量，
 * 而是把 `glossaryFingerprint` 拼进缓存键（见 `utils/glossary.ts` 与 `hooks/useRealtimeTranslate.ts`），
 * 这样常量只表示「缓存键结构」的版本，不用跟着数据走。
 */
export const GLOSSARY_VERSION = 'v1';

/**
 * 分段模式：写进缓存键，分段策略变化时旧译文自动作废。
 *
 * `-punct`（2026）：句读类标点一律先归一到英文逗号再切分（正文块）。
 * 规则变了 ⇒ 旧缓存里可能还留着 `smile!` / `一句.`，必须让它们不命中。
 */
export const SEGMENT_MODE = `slice-${MAX_REQUEST_CHARS}-punct`;

/* ---------- 推送设置（D80） ---------- */

/*
 * 与 ComfyUI 插件通信的端口约束。Rust 侧 `models.rs` 有同名的
 * `PUSH_PORT_MIN` / `PUSH_PORT_MAX` / `PUSH_PORT_DEFAULT`，两边必须一致
 * （前端负责输入框的 limits 与即时夹取，Rust 负责写盘前兜底）。
 */
export const PUSH_PORT_MIN = 1024;
export const PUSH_PORT_MAX = 65535;
export const PUSH_DEFAULT_PORT = 8713;

/**
 * 推流防抖（D81）：拖胶囊、连续打字时文本每个字符都在变，
 * 攒 200ms 只把**最后落定的那一次**推出去，避免把 ComfyUI 节点打满。
 *
 * 这个防抖只在前端做（Rust 收到就立刻广播），因此「推流很勤」这种情况
 * 在 Rust 侧不存在，服务端不需要再加一层攒批。
 */
export const PUSH_BROADCAST_DEBOUNCE_MS = 200;