import {
  DEFAULT_PRESET_COLOR_ID,
  FALLBACK_COLOR_ID,
  MODULE_COLORS,
  colorGradient,
  colorHex,
  findColor,
} from '../constants/colors';
import type { ColorId } from '../constants/colors';

/**
 * 主题感知的取色出口。
 *
 * 为什么还留着这一层（而不是让组件直接调 `constants/colors.ts`）：
 * 这是**所有画归属色的地方唯一的取值入口**（模块色条、输入框工具条色块、预设色点、
 * 胶囊圆点、拖拽幽灵、筛选色块）。将来若某种颜色需要在某个主题下改画法，
 * 只改这里即可，不必逐个组件排查。
 *
 * 历史：2026 轮之前注册表里有「白」（语义是无属性、只能给预设），亮色主题下
 * 纯白看不见，因此这里在亮色下把它反相成深色（D24）。**本轮自由色已整体剔除（D47）**，
 * 8 种颜色都是渐变、在两种主题下都够清楚，反相逻辑随之删除 —— 数据与渲染取值
 * 不再有任何主题差异，`resolveColorHex` 与 `colorHex` 当前完全一致。
 */
export function resolveColorHex(id: ColorId | null | undefined): string {
  return colorHex(id);
}

/** 同 `resolveColorHex`，但返回可直接写进 `background` 的 CSS 值（渐变或纯色） */
export function resolveColorGradient(id: ColorId | null | undefined): string {
  return colorGradient(id);
}

/**
 * 模块配色自动分配（需求 8：颜色自动分配，删除后释放）。
 *
 * 策略：取 MODULE_COLORS 中「最小未占用 order」的颜色。
 * - 只依赖当前在用颜色集合，因此删除模块后其颜色天然回到可用池（无需显式回收）。
 * - 确定性：同样的模块集合永远得到同样的颜色，避免重启后配色跳变。
 * - 现在颜色数量与模块上限相等（都是 8），正常使用**永远走不到**轮转分支；
 *   保留它只是防御「将来颜色比模块少」的脏数据，绝不抛错。
 */
export function allocModuleColor(usedColorIds: Iterable<ColorId>): ColorId {
  const used = new Set<ColorId>(usedColorIds);
  const free = MODULE_COLORS.find((color) => !used.has(color.id));
  if (free) return free.id;
  if (MODULE_COLORS.length === 0) return FALLBACK_COLOR_ID;
  return MODULE_COLORS[used.size % MODULE_COLORS.length].id;
}

/** 容错：把任意（可能来自历史数据的）模块色 id 规范化为合法值。 */
export function normalizeModuleColor(id: ColorId | null | undefined): ColorId {
  const found = findColor(id);
  // 显式 allowlist（与 constants/colors.ts 的池子口径一致）：
  // 只认 usage 里含 module 的颜色，`artist` / `snapshot` 这两个「库切换块」专用色不许当模块色。
  if (found && MODULE_COLORS.some((color) => color.id === found.id)) return found.id;
  return MODULE_COLORS[0]?.id ?? FALLBACK_COLOR_ID;
}

/**
 * 容错：把任意预设色 id 规范化为合法值。
 *
 * D47 之后没有「无属性」色，未知值（含历史数据里的 `white` / `gray` / `lilac`）统一落到
 * 第一个颜色「红」—— 用户 2026 轮确认：被删颜色的预设**全部统一落到红**。
 * 画师条目合法地使用 `artist` 色（D62 / D77），因此它必须放行；
 * **Tag 库条目用 `dictionary` 色**（D86，与筛选条上的 `T` 块、拖进输入框的 Tag 同源），
 * 也必须放行 —— 否则 Tag 在 Tag 库里会变成红色胶囊。
 * 快照库的 `snapshot` 色不是归属色，落红。
 */
export function normalizePresetColor(id: ColorId | null | undefined): ColorId {
  const found = findColor(id);
  if (
    found &&
    (found.usage === 'preset' ||
      found.usage === 'both' ||
      found.usage === 'artist' ||
      found.usage === 'dictionary')
  ) {
    return found.id;
  }
  return DEFAULT_PRESET_COLOR_ID;
}
