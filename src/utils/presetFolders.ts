import { PRESET_FILTER_COLORS, findColor } from '../constants/colors';
import type { ColorId } from '../constants/colors';
import type { Preset, PresetFolder } from '../types/preset';
import { normalizePresetColor } from './color';
import { matchPreset } from './presetSearch';
import { sortPresets } from './presetSort';

/**
 * 预设分组（D111 → D112 → D113）的纯逻辑。
 *
 * **口径（用户 2026 轮定稿）**：
 * 1. 组就是一个**收纳箱**：归纳而非标记，`Preset.folder` 是单一归属；
 * 2. **组有且只有一种颜色**，创建时取那颗被拖进来的胶囊的颜色，之后不可改 ——
 *    组只会出现在「总列表」或「它自己那个色块」的筛选下；
 * 3. 组里只可能有同色胶囊（移入异色会被拒绝），因此列表里**永远整组渲染**；
 * 4. **空组不显示、也会被清理**：组里最后一顆胶囊被移走或删除后，组自动消失；
 * 5. **组的身份是「名字 + 颜色」**（D113）：同名不同色是两个组，各在各的色块下 ——
 *    成员归属由「`folder` 名字 + 胶囊自己的颜色」共同决定，所以数据里不需要额外字段；
 * 6. 组不存成员列表（派生值），只在 `preset-folders.json` 里存名字 + 颜色 + 展开状态；
 * 7. 组永远排在散件前面，组间按「组内最高权重」降序 —— 目录在前、散件在后。
 *
 * 因此这一层全是纯函数：分组、可见性、排序、分页、改名/解散都能在 Node 里直接断言。
 */

/** 新建组的默认名 */
export const NEW_FOLDER_LABEL = '新分组';
/** 组名长度上限（面板很窄，太长的名字只会被截断） */
export const MAX_FOLDER_NAME_LENGTH = 20;

/** 组的引用：名字 + 颜色。**这两个字段一起才是组的身份**（D113） */
export interface FolderRef {
  name: string;
  colorId: ColorId;
}

/** 组名归一：去首尾空白、压缩连续空白、截断到上限 */
export function normalizeFolderName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';
  return Array.from(trimmed).slice(0, MAX_FOLDER_NAME_LENGTH).join('');
}

/** 一条预设属于哪个组（归一后；空串 = 未分组） */
export function folderOf(preset: Pick<Preset, 'folder'>): string {
  return normalizeFolderName(preset.folder);
}

/** 两个引用是不是同一个组（同名不同色不算） */
export function sameFolder(a: FolderRef | null | undefined, b: FolderRef | null | undefined): boolean {
  if (!a || !b) return false;
  return a.name === b.name && a.colorId === b.colorId;
}

/** 组的颜色中文名（提示文案里用，例如「蓝色分组只能收纳蓝色预设」） */
export function folderColorLabel(colorId: string): string {
  return findColor(colorId as ColorId)?.label ?? '';
}

function isValidColorId(value: unknown): value is ColorId {
  return (
    typeof value === 'string' &&
    PRESET_FILTER_COLORS.some((color) => (color.id as string) === value)
  );
}

/**
 * 规范化 `preset-folders.json` 的内容：脏数据不许把整个分组功能带崩。
 *
 * 去重键是**「名字 + 颜色」**（D113）：同名不同色是合法的两个组。
 * 兼容第一版（D111 的 `colorIds: []` 白名单）：取数组里的第一个合法色当作组色；
 * 说不出颜色的实体直接丢掉（成员还在，颜色会由成员重新推导，不会丢内容）。
 */
export function sanitizeFolders(raw: unknown): PresetFolder[] {
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const folders: PresetFolder[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const source = item as Partial<PresetFolder> & { colorIds?: unknown };
    const name = normalizeFolderName(source.name);
    if (!name) continue;

    const legacy = Array.isArray(source.colorIds) ? source.colorIds.find(isValidColorId) : undefined;
    const colorId = isValidColorId(source.colorId) ? source.colorId : legacy;
    if (!colorId) continue;

    const key = `${colorId}::${name}`;
    if (seen.has(key)) continue;
    seen.add(key);

    folders.push({
      name,
      colorId,
      // 展开状态：只有明确 true 才算展开，其余一律折叠（缺字段的老文件表现为全折叠）
      expanded: source.expanded === true,
    });
  }
  return folders;
}

/** 数据里出现过的组名（不受 `preset-folders.json` 影响，删掉那个文件也不会丢组） */
export function folderNamesOf(items: readonly Pick<Preset, 'folder'>[]): string[] {
  const names = new Set<string>();
  for (const item of items) {
    const name = folderOf(item);
    if (name) names.add(name);
  }
  return [...names];
}

/**
 * 现存的所有组（名字 + 颜色）：**实体与成员派生的并集**。
 *
 * 派生这一半很重要：`preset-folders.json` 丢了、或者成员先于实体出现时，
 * 组仍然存在（颜色由成员给），不会变成「有成员却没有组」的悬空状态。
 */
export function knownFolders(
  items: readonly Pick<Preset, 'folder' | 'colorId'>[],
  folders: readonly PresetFolder[],
): FolderRef[] {
  const seen = new Set<string>();
  const result: FolderRef[] = [];

  const push = (name: string, colorId: string) => {
    const key = `${colorId}::${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push({ name, colorId: normalizePresetColor(colorId) });
  };

  for (const folder of folders) push(folder.name, folder.colorId);
  for (const item of items) {
    const name = folderOf(item);
    if (name) push(name, item.colorId);
  }
  return result;
}

/** 新建组时的默认名：尽量不撞已有名字（同名不同色现在允许，因此只是「尽量」） */
export function nextFolderName(taken: readonly string[]): string {
  const set = new Set(taken);
  if (!set.has(NEW_FOLDER_LABEL)) return NEW_FOLDER_LABEL;
  let index = 2;
  while (set.has(`${NEW_FOLDER_LABEL} ${index}`)) index += 1;
  return `${NEW_FOLDER_LABEL} ${index}`;
}

/**
 * 这条预设能不能进这个组（D112）：**只认同色**。
 *
 * 组颜色一旦固定就不能改，因此异色胶囊移进来会被拒绝 —— 界面上给一条明确提示，
 * 而不是偷偷把胶囊改色（那会让用户的一颗胶囊凭空换色）。
 */
export function folderAccepts(folderColor: string, presetColor: string): boolean {
  return normalizePresetColor(folderColor) === normalizePresetColor(presetColor);
}

/** 清掉没有成员的组实体：组里最后一顆胶囊被移走 / 删除后，组就该消失 */
export function pruneEmptyFolders(
  folders: readonly PresetFolder[],
  items: readonly Pick<Preset, 'folder' | 'colorId'>[],
): PresetFolder[] {
  return folders.filter((folder) =>
    items.some((item) => {
      const name = folderOf(item);
      return name === folder.name && normalizePresetColor(item.colorId) === normalizePresetColor(folder.colorId);
    }),
  );
}

/** 一个块 = 一组同归组的条目，或者「未分组」那一段 */
export type LibraryBlock =
  | {
      kind: 'group';
      name: string;
      colorId: ColorId;
      /** 当前筛选/搜索之后真正要渲染的成员（已排序） */
      items: Preset[];
      expanded: boolean;
    }
  | { kind: 'ungrouped'; items: Preset[] };

export interface BuildBlocksOptions {
  items: readonly Preset[];
  folders: readonly PresetFolder[];
  /** 当前选中的颜色（单选；空数组 = 全部颜色） */
  filterColorIds: readonly string[];
  keyword?: string;
}

/**
 * 把可见条目编成块：**组块在前（按组内最高权重降序），未分组那段在后**。
 *
 * 两条筛选口径（D113 修过一次事故，务必分清）：
 * - **组**：按**组的颜色**判定 —— 全部颜色一律显示，否则只有自己的颜色命中才显示；
 *   显示时**整组内容一起显示**（组里本来就只可能有同色胶囊）。
 * - **未分组散件**：按**它自己的颜色**逐条判定 —— 这一条漏掉就是「颜色筛选完全失效」
 *   （D112 实现里漏了它，用户实测报「筛查系统直接失效」，这里补回并加了断言）。
 *
 * 搜索时（keyword 非空）忽略折叠状态、只保留有命中的组 —— 「搜得到」优先于「分组」。
 */
export function buildLibraryBlocks({
  items,
  folders,
  filterColorIds,
  keyword = '',
}: BuildBlocksOptions): LibraryBlock[] {
  const searching = keyword.trim().length > 0;
  const filtering = filterColorIds.length > 0;
  const colorVisible = (colorId: string): boolean =>
    !filtering || filterColorIds.includes(normalizePresetColor(colorId));

  const matched = items.filter((item) => (searching ? matchPreset(item, keyword) : true));

  const byKey = new Map<string, Extract<LibraryBlock, { kind: 'group' }>>();
  const ungrouped: Preset[] = [];

  for (const item of matched) {
    const name = folderOf(item);
    if (!name) {
      // 散件：**逐条**按自己的颜色筛
      if (colorVisible(item.colorId)) ungrouped.push(item);
      continue;
    }
    const colorId = normalizePresetColor(item.colorId);
    const key = `${colorId}::${name}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.items.push(item);
      continue;
    }
    byKey.set(key, {
      kind: 'group',
      name,
      colorId,
      items: [item],
      expanded: false,
    });
  }

  const expandedOf = (name: string, colorId: string): boolean => {
    const entity = folders.find(
      (folder) =>
        folder.name === name && normalizePresetColor(folder.colorId) === normalizePresetColor(colorId),
    );
    return entity?.expanded === true;
  };

  const groups: LibraryBlock[] = [];
  for (const block of byKey.values()) {
    if (!colorVisible(block.colorId)) continue;
    block.items = sortPresets(block.items);
    block.expanded = searching ? true : expandedOf(block.name, block.colorId);
    groups.push(block);
  }

  // 组间排序：组内最高权重降序；同权重按名称稳定
  type GroupBlock = Extract<LibraryBlock, { kind: 'group' }>;
  const groupBlocks = groups as GroupBlock[];
  groupBlocks.sort((a: GroupBlock, b: GroupBlock) => {
    const weightOf = (block: GroupBlock): number =>
      block.items.reduce((max, item) => (item.weight > max ? item.weight : max), 0);
    const byWeight = weightOf(b) - weightOf(a);
    if (byWeight !== 0) return byWeight;
    return a.name.localeCompare(b.name, 'zh-Hans-CN');
  });

  const blocks: LibraryBlock[] = [...groupBlocks];
  if (ungrouped.length > 0) blocks.push({ kind: 'ungrouped', items: sortPresets(ungrouped) });
  return blocks;
}

/** 一个块在分页里占多少「条」（折叠的组只占一颗砖的位置，展开的组按人数算） */
export function blockCost(block: LibraryBlock): number {
  if (block.kind === 'ungrouped') return block.items.length;
  return block.expanded ? block.items.length : 1;
}

export interface BlockPage {
  page: number;
  pageCount: number;
  blocks: LibraryBlock[];
}

/**
 * 块级分页（D111）：**组永不被页切开**，未分组那一段可以切。
 *
 * 为什么区别对待：
 * - 组块一旦被切开，展开的卡会在两页里各出现半张（同一张卡渲染两次），明显是 bug；
 * - 未分组只是「散件流」，切开不影响任何卡片，而且它是默认视图 ——
 *   105 条预设如果不切，块级分页会让它永远只占 1 页（页容量被一整块撑爆），
 *   等于把分页功能废掉。
 *
 * 因此页容量对组是**硬上限**（单块自身超页时独占一页并允许溢出），
 * 对未分组是**软上限**（装到装不下为止，剩下的顺延到下一页）。
 * 与 `paginate()` 同一套夹取口径（非法页码一律夹到合法范围）。
 */
export function paginateBlocks(
  blocks: readonly LibraryBlock[],
  page: number,
  pageSize: number,
): BlockPage {
  const size = Math.max(1, Math.floor(pageSize) || 1);

  const pages: LibraryBlock[][] = [];
  let current: LibraryBlock[] = [];
  let used = 0;

  const flush = () => {
    if (current.length === 0) return;
    pages.push(current);
    current = [];
    used = 0;
  };

  for (const block of blocks) {
    if (block.kind === 'ungrouped') {
      let rest = block.items;
      while (rest.length > 0) {
        if (used >= size) flush();
        const take = rest.slice(0, size - used);
        current.push({ kind: 'ungrouped', items: take });
        used += take.length;
        rest = rest.slice(take.length);
        if (rest.length > 0) flush();
      }
      continue;
    }

    const cost = blockCost(block);
    if (current.length > 0 && used + cost > size) flush();
    current.push(block);
    used += cost;
  }
  flush();

  const pageCount = Math.max(1, pages.length);
  const requested = Number.isFinite(page) ? Math.floor(page) : 1;
  const clamped = Math.min(Math.max(requested, 1), pageCount);
  return { page: clamped, pageCount, blocks: pages[clamped - 1] ?? [] };
}

/**
 * 改名：把「同名同色」的那一批预设挪到新名字（D113：不同色的同名组不受影响）
 */
export function renameFolderInItems(
  items: readonly Preset[],
  from: FolderRef,
  to: string,
): Preset[] {
  const target = normalizeFolderName(to);
  return items.map((item) =>
    folderOf(item) === from.name &&
    normalizePresetColor(item.colorId) === normalizePresetColor(from.colorId)
      ? { ...item, folder: target }
      : item,
  );
}

/** 解散：把「同名同色」的那批预设移回未分组（组本身由调用方删除） */
export function dissolveFolderInItems(items: readonly Preset[], folder: FolderRef): Preset[] {
  return items.map((item) => {
    if (folderOf(item) !== folder.name) return item;
    if (normalizePresetColor(item.colorId) !== normalizePresetColor(folder.colorId)) return item;
    const { folder: _folder, ...rest } = item;
    return rest;
  });
}
