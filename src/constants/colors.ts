/**
 * 颜色注册表 —— 全应用唯一的颜色真源。
 *
 * 设计约束（来自需求确认）：
 * - 颜色以「数据表」形式维护，ColorId 故意定义为 string 而不是字面量联合类型，
 *   增删颜色不需要改动任何类型、组件或 Store。
 * - 彩色一律用**渐变**（筛选色块、预设色点、胶囊小圆点、模块色条都用同一套渐变）。
 * - 不开放用户自定义颜色（需求 4）：颜色只来自这张表。
 *
 * 增删颜色的唯一改动点：编辑下面的 COLORS 数组（order 决定界面顺序）。
 * 已发布的 id 不可再修改，因为历史数据（预设、模块）以 id 落盘；
 * 读到未知 id 时由 utils/color.ts 的 normalize* 函数安全降级。
 *
 * **2026 轮（D47）：颜色与模块一一对应，共 8 种。**
 * 之前是「9 种彩色 + 1 种白」，白色语义是「无属性 / 自由色」，只能给预设。
 * 用户实测后发现：筛选条有 10 块、模块上限也是 10，看起来是「一一对应」，
 * 但第 10 块其实是白、第 10 个模块只能轮转复用第 1 个颜色 —— 自由色顶替了
 * 最后一个位置，这个设计意义不大。因此**整体剔除自由色**，并删掉与其它色
 * 差异最小的薄荷（原 id `gray`，它与绿/青相邻），得到 8 个两两差异明显的渐变：
 * 红 橙 黄 绿 青 蓝 紫 粉。模块上限同步收到 8，第 9 个模块被拦下。
 * 被删的两个 id（`gray` / `white`）不再进注册表；历史数据由 normalize* 统一落到红。
 *
 * **2026 轮（D62）：新增「画师库」专属色 `artist`。**
 * 它不是模块色、也不是预设归属色 —— `usage: 'artist'`，因此**不进** MODULE_COLORS /
 * PRESET_COLORS 两个池子，模块与筛选仍严格一一对应。它只出现在预设库色块行里的
 * `@` 方块上，用来切换「画师库」视图。**D77 起改为复杂渐变**（薄荷绿 → 天蓝）。
 *
 * **2026 轮（D75 + D77）：8 色 → 10 色，模块上限同步 8 → 10（仍是一一对应）。**
 * 用户实机体验后判断「8 个模块没有想象中那么多」，要求扩到 10 个。
 * D75 先给的是「棕 / 灰」，用户看后要求「亮色、浅色系，不要深色」，D77 换成
 * **薄荷 `mint` / 丁香 `lilac`**（起点都很浅）。id 每次都新造，**不复用** D47 删掉的
 * `gray` / `white` —— 那两个 id 已被历史数据用过，复用会让老数据"突然换色"。
 * 色块行是 **12 块**（10 色 + `@` + `S`）；初始宽度在 D77 定为 **276px**（一行 8 块 ⇒ 8+4）。
 *
 * **2026 轮（D85）：颜色池 10 → 9，并新增「词典库」专属色 `dictionary`。**
 * 用户要求预设库筛选条在一行里放下「9 个颜色块 + 词典 `D` + 画师 `@` + 快照 `S`」＝ **仍然 12 块**，
 * 因此 D77 定的 276px（8+4）/ 211px（6+6）几何一个字都不用改。
 * 腾位置的办法是砍掉**颜色池的最后一个色块**丁香 `lilac`；模块上限同步 10 → 9
 * （「颜色与模块一一对应」这条不变）。历史数据里 `lilac` 的预设/模块由 normalize* 统一落到红，
 * 与 D47 删 `gray` / `white` 是同一套口径。
 */

/** 颜色标识。刻意使用 string：颜色种类由用户反馈驱动，随时可能变化。 */
export type ColorId = string;

export interface ColorDef {
  /** 稳定标识，会写入持久化数据，发布后不可更改 */
  id: ColorId;
  /** 界面显示名（中文，界面唯一可见文案） */
  label: string;
  /** 主色：渐变起点；也用于描边 / 淡色底等需要单个色值的地方 */
  hex: string;
  /** 渐变终点（两档渐变的第二种写法，会自动压暗尾色） */
  hexTo?: string;
  /**
   * 直接给出**完整可写进 `background` 的 CSS**（多档 / 带角度的复杂渐变）。
   * 给了它就忽略 `hex` / `hexTo` —— D77 的「画师 / 快照」两块用的就是这种写法：
   * `linear-gradient(180deg, #2af598 0%, #009efd 100%)`。
   */
  gradient?: string;
  /** 可被谁使用：模块配色 / 预设归属 / 两者 / 画师库专用 / 快照库专用 / 词典库专用 */
  usage: 'module' | 'preset' | 'both' | 'artist' | 'snapshot' | 'dictionary';
  /** 视觉样式：渐变 或 纯色 */
  variant: 'gradient' | 'plain';
  /** 展示与自动分配顺序 */
  order: number;
}

/**
 * 9 个彩色：模块与预设**共用同一套**（usage: 'both'），数量与模块上限严格相等。
 * 末尾另外三个是**库切换块**专用（`dictionary` / `artist` / `snapshot`），
 * 不进模块池、也不进筛选条（D85 起词典块也是这一类）。
 *
 * 排序与差异性的讲究（用户 2026 轮换色时定下的相对位置）：
 * - 粉在第 8 位，与第 1 位的红尽量拉开；
 * - 黄紧挨橙、青紧挨绿/蓝，但采用不同明度的渐变，26px 色块上可区分。
 * - **D77（用户反馈）**：原来第 9、10 位是「棕 / 灰」，用户实测后说「不太喜欢，想要亮色、浅色系，
 *   不要深色」，于是换成**薄荷**（`mint`，浅青绿）与**丁香**（`lilac`，浅紫粉）——
 *   两者都是**起点很浅**的渐变，摆在与粉相邻的第 9、10 位也不会和别的颜色混。
 * id 不变、只调色值：第 8 位由「棕」改「粉」、第 9 位由「灰」改「薄荷」时都保留了原 id；
 * 本次删除薄荷与白，保留的 8 个 id 原样不动（历史数据继续可用）；
 * D75 起新造的两个 id（`brown` / `slate` → D77 换成 `mint` / `lilac`）**刻意不复用**已删的 `gray` / `white`。
 * **D85**：`lilac` 整条删掉（用户口径：「直接去除注册表中的最后一个色块」），
 * 剩下 9 个彩色 id 原样不动；`lilac` 这一行**不要**再被复用给别的颜色。
 */
export const COLORS: ColorDef[] = [
  { id: 'red', label: '红', hex: '#ff6b76', hexTo: '#c9184a', usage: 'both', variant: 'gradient', order: 10 },
  { id: 'orange', label: '橙', hex: '#ffa94d', hexTo: '#e8590c', usage: 'both', variant: 'gradient', order: 20 },
  { id: 'yellow', label: '黄', hex: '#ffe066', hexTo: '#d9a441', usage: 'both', variant: 'gradient', order: 30 },
  { id: 'green', label: '绿', hex: '#8ce99a', hexTo: '#12a150', usage: 'both', variant: 'gradient', order: 40 },
  { id: 'cyan', label: '青', hex: '#66d9e8', hexTo: '#0b8793', usage: 'both', variant: 'gradient', order: 50 },
  { id: 'blue', label: '蓝', hex: '#74c0fc', hexTo: '#2f4fd8', usage: 'both', variant: 'gradient', order: 60 },
  { id: 'purple', label: '紫', hex: '#b197fc', hexTo: '#7b2ff7', usage: 'both', variant: 'gradient', order: 70 },
  // 第 8 位：玫瑰粉（与第 1 位的红间隔开）
  { id: 'pink', label: '粉', hex: '#f472b6', hexTo: '#be185d', usage: 'both', variant: 'gradient', order: 80 },
  // 第 9 位（D77）：薄荷 —— 浅青绿，起点很浅，与绿（叶绿）/ 青（天青）在明度上拉开
  // D85：它现在是颜色池的**最后一个**色块（原第 10 位丁香已删）
  { id: 'mint', label: '薄荷', hex: '#9ef2d0', hexTo: '#2bbf95', usage: 'both', variant: 'gradient', order: 90 },
  /*
   * Tag 库专属色（D85 起是「词典库」的色，D86 改名为 Tag 库）：`T` 方块、
   * Tag 胶囊的色点、拖进工作区的 Tag 药丸都用它，**不是**模块色、也不是预设归属色。
   *
   * 用户指定 `linear-gradient(-225deg, #D4FFEC 0%, #57F2CC 48%, #4596FB 100%)`
   * （浅薄荷 → 薄荷 → 天蓝），原样写进 `gradient`，`colorGradient` 一个字符都不改写。
   * id 保持 `dictionary`（已随 tags.json 落盘，永不可改）。
   */
  {
    id: 'dictionary',
    label: '词条',
    hex: '#57f2cc',
    gradient: 'linear-gradient(-225deg, #D4FFEC 0%, #57F2CC 48%, #4596FB 100%)',
    usage: 'dictionary',
    variant: 'gradient',
    order: 105,
  },
  /*
   * 画师库专属色（D62，D77 改为复杂渐变，D78 换用户重新选的一条）：
   * 用户指定的 `linear-gradient(to top, #d5dee7 0%, #ffafbd 0%, #c9ffbf 100%)`
   * （灰蓝 → 粉 → 薄荷绿）。**不是**模块色、也不是预设归属色，
   * 只给 `@` 方块（以及画师胶囊的色点）用。
   *
   * 注意这条 CSS 里**前两个色标都在 0%**：底部是灰蓝到粉的硬分界，再向上渐变到薄荷绿。
   * 这是用户原文，原样保留（`colorGradient` 不做任何改写）。
   */
  {
    id: 'artist',
    label: '画师',
    hex: '#ffafbd',
    gradient: 'linear-gradient(to top, #d5dee7 0%, #ffafbd 0%, #c9ffbf 100%)',
    usage: 'artist',
    variant: 'gradient',
    order: 110,
  },
  /*
   * 快照库专属色（D67 起是纯靛蓝 #4F46E5，D77 改为复杂渐变）：
   * 用户指定的 `linear-gradient(to top, #9795f0 0%, #fbc8d4 100%)`（藕荷 → 浅粉）。
   * 进注册表是为了让色块、拖拽幽灵**从同一处取色**（此前 #4F46E5 在组件里写了两遍）。
   */
  {
    id: 'snapshot',
    label: '快照',
    hex: '#9795f0',
    gradient: 'linear-gradient(to top, #9795f0 0%, #fbc8d4 100%)',
    usage: 'snapshot',
    variant: 'gradient',
    order: 120,
  },
];

const SORTED: ColorDef[] = [...COLORS].sort((a, b) => a.order - b.order);

/**
 * 模块可用的配色：9 种彩色（按 order 升序，即自动分配顺序）。
 * 用**显式 allowlist** 而不是 `usage !== 'preset'` —— 否则 `artist` / `dictionary`
 * 会被算进模块池、破坏一一对应。
 */
export const MODULE_COLORS: ColorDef[] = SORTED.filter(
  (c) => c.usage === 'module' || c.usage === 'both',
);

/** 预设可用的归属色：与模块同一套 9 种彩色（不再有「无属性」的白色） */
export const PRESET_COLORS: ColorDef[] = SORTED.filter(
  (c) => c.usage === 'preset' || c.usage === 'both',
);

/** 预设筛选条：与预设归属色一致，9 块 = 9 个模块色（库切换块不在这里，见下面三个 id） */
export const PRESET_FILTER_COLORS: ColorDef[] = PRESET_COLORS;

/** 词典库专属色 id（D85）：`D` 方块、词典胶囊色点、词典 Tag 都用它 */
export const DICTIONARY_COLOR_ID: ColorId = 'dictionary';

/** 画师库专属色 id（D62）：`@` 方块与画师胶囊都用它 */
export const ARTIST_COLOR_ID: ColorId = 'artist';

/** 快照库专属色 id（D67 起是纯靛蓝，D77 改为复杂渐变）：`S` 方块与拖拽幽灵都用它 */
export const SNAPSHOT_COLOR_ID: ColorId = 'snapshot';

/** 新建预设的默认归属色：第一个颜色（红）。历史数据里的白/薄荷/丁香也统一落到它 */
export const DEFAULT_PRESET_COLOR_ID: ColorId = 'red';

/** 极端情况下的兜底色（颜色表为空时使用） */
export const FALLBACK_COLOR_ID: ColorId = SORTED[0]?.id ?? 'red';

const COLOR_BY_ID = new Map<ColorId, ColorDef>(COLORS.map((c) => [c.id, c]));

export function findColor(id: ColorId | null | undefined): ColorDef | undefined {
  if (!id) return undefined;
  return COLOR_BY_ID.get(id);
}

/** 主色（渐变起点 / 纯色值）。用于边框、淡色底等需要 color-mix 的地方。 */
export function colorHex(id: ColorId | null | undefined): string {
  return findColor(id)?.hex ?? '#8b8d98';
}

/**
 * 可直接写进 `background` 的 CSS 值：彩色是渐变（纯色色块直接返回色值）。
 * 筛选色块、预设色点、胶囊小圆点、模块色条都用它，保证“预设库里什么样，拖进去就什么样”。
 *
 * 三种优先级（D77）：
 * ① 注册表里给了 `gradient`（多档 / 带角度的复杂渐变，例如词典、画师与快照块）——**原样返回**，
 *    一个字符都不改写，用户给的就是最终 CSS；
 * ② 有 `hexTo` 的两档渐变 —— 起点 + 被压暗 22% 的尾色（D71 加大首尾对比度）；
 * ③ 纯色 —— 直接返回 `hex`。
 */
export function colorGradient(id: ColorId | null | undefined): string {
  const color = findColor(id);
  if (!color) return '#8b8d98';
  if (color.gradient) return color.gradient;
  if (color.variant === 'plain' || !color.hexTo) return color.hex;
  return `linear-gradient(135deg, ${color.hex}, color-mix(in srgb, ${color.hexTo} 78%, #000))`;
}

export function colorLabel(id: ColorId | null | undefined): string {
  return findColor(id)?.label ?? '未知色';
}
