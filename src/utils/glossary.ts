import type { DictionaryEntry, DictionaryItem } from '../types/dictionary';
import { toPromptSeparators, trimJunctionCommas } from './promptPunctuation';

/**
 * 本地词典的匹配逻辑（**纯函数、零 React、零 IO**）。
 *
 * 优先级（用户 2026 轮定死，D50）：
 * 1. 胶囊：锚点在进翻译函数前就被摘掉，胶囊英文根本不参与切片/查词/API；
 * 2. **本地词典**：剥离胶囊后的纯文本切片，按词典优先级从上到下**整段精确匹配**
 *    （忽略首尾空格、剥掉前导 `@`、折叠内部空白）；命中即返回英文，原样保留（不改大小写）；
 * 3. 翻译缓存；
 * 4. 翻译 API。
 *
 * 匹配单位是**切片**（由 `splitSlices` 按中文标点切出来的段），不是分词、也不做子串替换：
 * “千早爱音的粉色长发” 不会命中 “千早爱音”。要命中的话，词典里就放这一整条。
 */

/** 词典匹配结果：`keepAt` 表示原片段带前导 `@`，输出时要保留（用户选择「保留 @ 前缀」） */
export interface GlossaryHit {
  en: string;
  keepAt: boolean;
}

/** 合并后的索引：键是归一化后的中文，值是英文 */
export interface GlossaryIndex {
  map: ReadonlyMap<string, string>;
  size: number;
}

/** 归一化：去首尾空格 → 剥掉前导 `@`（可以多个）→ 折叠内部空白。
 * 只做这三件事，绝不改大小写、绝不动标点：词典是用户的数据，我们只负责对齐。 */
export function normalizeTerm(text: string): string {
  return text
    .trim()
    .replace(/^@+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 容错：把来自磁盘/外部文件的条目清洗成可用列表（丢空、去重保首条）。
 * Rust 侧导入时已经做过一次；这里是读取标准 JSON 后的第二道防线。
 */
export function sanitizeEntries(raw: unknown): DictionaryEntry[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const entries: DictionaryEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Partial<DictionaryEntry>;
    const cn = typeof record.cn === 'string' ? record.cn.trim() : '';
    const en = typeof record.en === 'string' ? record.en.trim() : '';
    if (!cn || !en) continue;
    const key = normalizeTerm(cn);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    entries.push({ cn, en });
  }
  return entries;
}

/**
 * 按**传入顺序**（= 优先级从高到低）合并多个词典：先出现的词典先占位，后来者不覆盖。
 * 停用的词典直接跳过。
 */
export function buildGlossaryIndex(
  dictionaries: readonly {
    enabled: boolean;
    entries: readonly DictionaryEntry[];
  }[],
): GlossaryIndex {
  const map = new Map<string, string>();
  for (const dictionary of dictionaries) {
    if (!dictionary.enabled) continue;
    for (const entry of dictionary.entries) {
      /**
       * 键也走**同一张**句读表：切片在查词典之前已经被归一（`权重（1.2，0）` →
       * `权重(1.2,0)`），词条若保留全角就永远对不上。
       * 只转标点、不动汉字与大小写 —— 词典是用户的数据。
       * 末尾再 trim 一次逗号：`长发。` 的键必须变成 `长发`，否则它永远等不到
       * 一个以逗号结尾的片段（切片会把尾部逗号当分隔符切掉）。
       */
      const key = normalizeTerm(trimJunctionCommas(toPromptSeparators(entry.cn)));
      if (!key || map.has(key)) continue;
      const en = entry.en.trim();
      if (!en) continue;
      map.set(key, en);
    }
  }
  return { map, size: map.size };
}

/** 整段精确匹配（归一化后比对，半角/全角两种键都试）。没命中返回 null。 */
export function resolveGlossaryTerm(index: GlossaryIndex, segment: string): GlossaryHit | null {
  if (index.size === 0) return null;
  const raw = segment.trim();
  if (!raw) return null;

  // 片段本身已经被归一过；这里再试一次「原始/归一后」两种键，兼容手工调用与旧数据
  const keys = [normalizeTerm(raw), normalizeTerm(trimJunctionCommas(toPromptSeparators(raw)))];
  for (const key of keys) {
    if (!key) continue;
    const en = index.map.get(key);
    if (en) return { en, keepAt: raw.startsWith('@') };
  }
  return null;
}

/**
 * 命中后的最终输出：带 `@` 的片段保留前缀（用户 2026 轮选择「保留 @ 前缀」）；
 * 如果词典里的英文本身就以 `@` 开头，就不再重复加。
 */
export function formatGlossaryOutput(hit: GlossaryHit): string {
  if (hit.keepAt && !hit.en.startsWith('@')) return `@${hit.en}`;
  return hit.en;
}

/**
 * 词典指纹：参与**翻译缓存键**（D50）。
 *
 * 为什么必须进键：缓存是「整模块」粒度的，如果键里没有词典状态，
 * 那么「改了词典、命中旧缓存」就会让词典永远不生效。
 * 导入 / 删除 / 排序 / 启停 / 条数变化都会改变指纹 ⇒ 旧缓存自动不命中；
 * 加上 `GLOSSARY_VERSION` 从 v0 升到 v1，升级前的缓存也会一次性作废。
 */
export function glossaryFingerprint(
  items: readonly Pick<
    DictionaryItem,
    'id' | 'order' | 'enabled' | 'entryCount' | 'importedAt'
  >[],
): string {
  const parts = [...items]
    .sort((left, right) => left.order - right.order)
    .map(
      (item) =>
        `${item.id}\u0002${item.order}\u0002${item.enabled ? 1 : 0}\u0002${item.entryCount}\u0002${item.importedAt}`,
    );
  const text = parts.join('\u0003');
  if (!text) return 'empty';
  // FNV-1a 32 位：只为「内容变了就变」，不用于安全用途
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${text.length.toString(36)}-${hash.toString(36)}`;
}
