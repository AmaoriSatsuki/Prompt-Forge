/**
 * 翻译缓存（V3 第一层的纯逻辑部分）。
 *
 * 这是**纯数据 + 纯逻辑**：不读磁盘、不碰 React、不判环境，落盘由 `hooks/useTranslationCache`
 * 通过 Rust 的原子写完成。因此可以在 Node 里直接断言 LRU 淘汰与命中规则。
 *
 * 缓存键（用户指定）：源文本 + 源语言 + 目标语言 + 引擎 + 术语表版本 + 分段模式。
 * 任何一个变化都必须视为不同条目 —— 否则「换了引擎却拿到上一家引擎的译文」，
 * 而且这种错很难被发现。
 *
 * **不包含胶囊英文**（2026 起）：胶囊是独立的一块，只在装配（复制/推流）时起作用；
 * 正文只由「纯中文 + 词典 + 接口」决定。把术语英文塞进键里只会让「换了个胶囊」
 * 白白重翻一次正文。
 */

/** 缓存条目的维度（任何一项不同就是不同条目） */
export interface CacheKeyParts {
  /** 纯中文源文本（不含胶囊锚点） */
  sourceText: string;
  /** 源语言，例如 'zh' */
  sourceLang: string;
  /** 目标语言，例如 'en' */
  targetLang: string;
  /** 引擎标识，例如 'baidu-translate'（本版只有这一条通道） */
  engine: string;
  /** 术语表版本：术语表改动后旧译文不应继续命中 */
  glossaryVersion: string;
  /** 分段模式：例如 'slice-1000'，分段策略变化时旧译文作废 */
  segmentMode: string;
}

export interface CacheEntry {
  key: string;
  /** 译文（已按展示口径处理后） */
  value: string;
  /** 最近一次命中/写入的时间戳（LRU 依据） */
  usedAt: number;
  /** 该条目的字符数，用于统计占用大小 */
  chars: number;
}

/** 单条缓存记录的持久化形状 */
export interface CacheRecord {
  key: string;
  value: string;
  usedAt: number;
}

const SEPARATOR = '\u0001';

/**
 * 组装缓存键。
 *
 * 用不可见分隔符拼接而不是 JSON：JSON 的字段顺序与转义会引入额外差异，
 * 拼接更直接；同时各维度都做了「长度 + 分隔符」的写法，避免
 * 「a + bc」与「ab + c」撞成同一个键。
 *
 * v3（2026）：去掉了「胶囊英文」这一维 —— 正文不依赖它（胶囊是独立块）。
 * 结构变了，旧条目一律作废。
 */
export const CACHE_KEY_VERSION = 'v3';

export function buildCacheKey(parts: CacheKeyParts): string {
  const dimensions = [
    CACHE_KEY_VERSION,
    parts.sourceText,
    parts.sourceLang,
    parts.targetLang,
    parts.engine,
    parts.glossaryVersion,
    parts.segmentMode,
  ];
  return dimensions.map((value) => `${value.length}${SEPARATOR}${value}`).join(SEPARATOR);
}

export interface TranslationCacheOptions {
  /** 条目上限，超出按 LRU 淘汰 */
  maxEntries: number;
  /** 上限内的容量提示（字节）——超过时也会触发淘汰，避免单条巨型译文占满内存 */
  maxChars?: number;
}

export interface CacheStats {
  entries: number;
  chars: number;
  /** 估算占用大小（字节）：按 UTF-8 粗估，中文 3 字节 */
  approxBytes: number;
}

/**
 * 内存翻译缓存：`get` 命中即刷新 LRU，`put` 超限即淘汰最久未用。
 *
 * 刻意做成普通类而不是 zustand store：它要被调度层高频读写，
 * 放进 React 状态会引发无意义的重渲染。
 */
export class TranslationCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly maxEntries: number;
  private readonly maxChars: number;
  /** 缓存开关：关闭时既不写入也不命中（用户在界面上可以关掉） */
  private enabled = true;
  /** 关闭缓存后，本次会话已经记录过的「不再缓存」的源文本 —— 简化处理：直接不写 */
  private hits = 0;
  private misses = 0;

  constructor(options: TranslationCacheOptions) {
    this.maxEntries = Math.max(1, options.maxEntries);
    this.maxChars = options.maxChars ?? Number.MAX_SAFE_INTEGER;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  get(key: string): string | null {
    if (!this.enabled) return null;
    const entry = this.entries.get(key);
    if (!entry) {
      this.misses += 1;
      return null;
    }
    // LRU：命中即刷新时间，并把它挪到 Map 末尾（Map 有序，末尾 = 最新）
    entry.usedAt = Date.now();
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.hits += 1;
    return entry.value;
  }

  put(key: string, value: string): void {
    if (!this.enabled || !value) return;
    this.entries.delete(key);
    this.entries.set(key, { key, value, usedAt: Date.now(), chars: value.length });
    this.evictIfNeeded();
  }

  clear(): number {
    const removed = this.entries.size;
    this.entries.clear();
    this.hits = 0;
    this.misses = 0;
    return removed;
  }

  stats(): CacheStats {
    let chars = 0;
    for (const entry of this.entries.values()) chars += entry.chars;
    return {
      entries: this.entries.size,
      chars,
      // 粗估：CJK 3 字节、其余 1 字节。够界面上显示「占用大小」用，不追求精确。
      approxBytes: this.entries.size * 64 + chars * 3,
    };
  }

  hitRate(): { hits: number; misses: number } {
    return { hits: this.hits, misses: this.misses };
  }

  /** 导出为可落盘的记录：按 LRU 顺序（最旧在前） */
  toRecords(): CacheRecord[] {
    return [...this.entries.values()].map((entry) => ({
      key: entry.key,
      value: entry.value,
      usedAt: entry.usedAt,
    }));
  }

  /**
   * 从磁盘记录恢复。
   *
   * 容错原则（与配置、预设一致）：脏条目**逐条丢弃**，绝不因为一条坏数据报废整份缓存。
   * 恢复后仍然按上限淘汰一次，避免旧文件里条目过多把内存顶满。
   */
  loadRecords(records: readonly unknown[]): void {
    this.entries.clear();
    this.hits = 0;
    this.misses = 0;

    for (const raw of records) {
      if (!raw || typeof raw !== 'object') continue;
      const record = raw as Partial<CacheRecord>;
      if (typeof record.key !== 'string' || !record.key) continue;
      if (typeof record.value !== 'string') continue;
      const usedAt = typeof record.usedAt === 'number' && Number.isFinite(record.usedAt)
        ? record.usedAt
        : 0;
      this.entries.set(record.key, {
        key: record.key,
        value: record.value,
        usedAt,
        chars: record.value.length,
      });
    }

    this.evictIfNeeded();
  }

  /** 超出上限时按 LRU 淘汰：Map 头部就是最久未用的 */
  private evictIfNeeded(): void {
    let chars = 0;
    for (const entry of this.entries.values()) chars += entry.chars;

    while (
      this.entries.size > this.maxEntries ||
      (chars > this.maxChars && this.entries.size > 1)
    ) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      const removed = this.entries.get(oldestKey);
      this.entries.delete(oldestKey);
      chars -= removed?.chars ?? 0;
    }
  }
}
