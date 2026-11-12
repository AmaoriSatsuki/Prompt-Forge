import { CAPSULE_WEIGHT_DEFAULT } from '../constants/limits';
import type { Capsule } from '../types/module';
import { composeRowPrompt } from './promptText';

/**
 * 胶囊在「字符串」层面的全部表示与拼接逻辑。
 *
 * 锚点 `[[cap:<capsuleId>]]` 只存在于模块的 sourceText 里，是胶囊在源内容中的位置标记；
 * 它会被渲染成药丸标签（见 components/module/sourceDom.ts），用户永远看不到这串字符。
 *
 * 需求 6 起，翻译不再使用任何占位符机制（胶囊固定在句首，模型不可能把它搬走）：
 *   1. 把源内容切成「胶囊 / 文本」片段；
 *   2. 只把**纯中文部分**送去翻译 —— 术语英文因此完全不进入请求体；
 *   3. 译完后把胶囊的英文按原顺序拼到译文最前面，用逗号连接。
 */

const ANCHOR_PATTERN = /\[\[cap:([A-Za-z0-9_]+)\]\]/g;

export function capsuleAnchor(capsuleId: string): string {
  return `[[cap:${capsuleId}]]`;
}

export type SourceSegment =
  | { kind: 'text'; text: string }
  | { kind: 'capsule'; capsuleId: string };

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 把源内容切成「文本 / 胶囊」片段。
 *
 * id 不在 knownCapsuleIds 里的锚点会被当作普通文本 —— 这样即使有人手工把
 * `[[cap:xxx]]` 当普通文字写进内容，也不会被误吞。
 */
export function parseSource(
  sourceText: string,
  knownCapsuleIds: ReadonlySet<string>,
): SourceSegment[] {
  const segments: SourceSegment[] = [];
  let cursor = 0;

  ANCHOR_PATTERN.lastIndex = 0;
  let match = ANCHOR_PATTERN.exec(sourceText);
  while (match !== null) {
    const capsuleId = match[1];
    if (knownCapsuleIds.has(capsuleId)) {
      if (match.index > cursor) {
        segments.push({ kind: 'text', text: sourceText.slice(cursor, match.index) });
      }
      segments.push({ kind: 'capsule', capsuleId });
      cursor = match.index + match[0].length;
    }
    match = ANCHOR_PATTERN.exec(sourceText);
  }

  if (cursor < sourceText.length) {
    segments.push({ kind: 'text', text: sourceText.slice(cursor) });
  }
  return segments;
}

/** 某个胶囊在源内容里出现了几次 */
export function countCapsuleOccurrences(sourceText: string, capsuleId: string): number {
  const pattern = new RegExp(escapeForRegExp(capsuleAnchor(capsuleId)), 'g');
  return sourceText.match(pattern)?.length ?? 0;
}

/** 移除某个胶囊的全部锚点（删除胶囊时用） */
export function removeCapsuleAnchors(sourceText: string, capsuleId: string): string {
  const pattern = new RegExp(escapeForRegExp(capsuleAnchor(capsuleId)), 'g');
  return sourceText.replace(pattern, '');
}

/** 去掉全部已知锚点，得到纯中文文本 */
export function stripAnchors(sourceText: string, knownCapsuleIds: ReadonlySet<string>): string {
  return parseSource(sourceText, knownCapsuleIds)
    .map((segment) => (segment.kind === 'text' ? segment.text : ''))
    .join('');
}

/**
 * 去掉**所有**锚点形状的标记（不管 id 认不认识）。
 *
 * 只给「会变成给人看的文字」的场景用（例如 D84 的自动胶囊名）：
 * `[[cap:…]]` 是给渲染用的内部标记，无论认不认识都不该出现在名字里。
 * 内容本身仍然走 `stripAnchors` 的口径（未知 id 当普通文字），那条规则不要在这里复用 ——
 * 两条规则的用途不同，混用会让「用户手打了 [[cap:xxx]]」这种行为变得说不清。
 */
export function stripAllAnchors(sourceText: string): string {
  ANCHOR_PATTERN.lastIndex = 0;
  return sourceText.replace(ANCHOR_PATTERN, '');
}

/**
 * 只保留胶囊锚点、丢掉全部文字（D61：模块枢拖回自身 = 清文字、不清胶囊）。
 *
 * 用户口径：手打内容要清的次数远多于胶囊，而胶囊是精挑过的术语，
 * 误删代价高，所以「清空」只清文字，胶囊必须手动点 × 才会消失。
 * 未知 id 的锚点按 `parseSource` 的约定算普通文本，因此也会随文字一起清掉。
 */
export function keepOnlyAnchors(sourceText: string, knownCapsuleIds: ReadonlySet<string>): string {
  return parseSource(sourceText, knownCapsuleIds)
    .map((segment) => (segment.kind === 'capsule' ? capsuleAnchor(segment.capsuleId) : ''))
    .join('');
}

/** 某个胶囊的锚点现在还在源内容里吗 */
export function hasCapsuleAnchor(sourceText: string, capsuleId: string): boolean {
  return countCapsuleOccurrences(sourceText, capsuleId) > 0;
}

/**
/**
 * 「开头那串胶囊」的结束下标（D79）。
 *
 * 一处口径：新拖入的胶囊要排在**已有胶囊之后**（先拖入的在前，符合打字顺序），
 * 而它们仍然整体位于译文之前。于是需要知道"开头连着的那几个锚点"结束在哪。
 *
 * 规则：从 0 开始，反复「跳过空白 → 必须紧跟一个锚点」，直到接不上为止；
 * 锚点之间允许有空白（历史数据里可能残留），但**不会**把开头之后的文字算进来。
 * 返回的是**最后一个锚点**的结束位置（一个锚点都没有时返回 0）。
 */
export function leadingCapsulesEnd(sourceText: string): number {
  let cursor = 0;
  let end = 0;
  while (cursor < sourceText.length) {
    // 只允许跳过锚点之间的空白：先看空档，再看紧跟着的是不是锚点
    let next = cursor;
    while (next < sourceText.length && /\s/.test(sourceText[next])) next += 1;
    ANCHOR_PATTERN.lastIndex = next;
    const match = ANCHOR_PATTERN.exec(sourceText);
    if (!match || match.index !== next) break;
    cursor = ANCHOR_PATTERN.lastIndex;
    end = cursor;
  }
  return end;
}

/**
 * 按**源内容里的出现顺序**排列胶囊（D64）。
 *
 * 为什么需要：胶囊数组按"加入的先后"追加，而源内容里的锚点顺序才是用户看到的顺序 ——
 * 两者在历史上曾经相反（当时插入是"插到最前面"，D79 之后改成"排在已有胶囊之后"，
 * 因此正常使用下两者一致；这里保留排序是为了兼容旧草稿与手工编辑过的源内容）。
 */
export function orderCapsulesBySource<T extends { id: string }>(
  sourceText: string,
  capsules: readonly T[],
): T[] {
  const byId = new Map(capsules.map((capsule) => [capsule.id, capsule]));
  const ordered: T[] = [];
  const seen = new Set<string>();
  for (const segment of parseSource(sourceText, new Set(byId.keys()))) {
    if (segment.kind !== 'capsule' || seen.has(segment.capsuleId)) continue;
    seen.add(segment.capsuleId);
    const found = byId.get(segment.capsuleId);
    if (found) ordered.push(found);
  }
  // 兜底：源内容里找不到的胶囊（理论上不会有）按原顺序补在后面，绝不丢
  for (const capsule of capsules) {
    if (!seen.has(capsule.id)) ordered.push(capsule);
  }
  return ordered;
}

/**
 * 回收「源内容里已经没有锚点」的胶囊。
 *
 * 为什么必须有这一步：用户在编辑器里用 Backspace 删掉药丸时，锚点从源内容里消失了，
 * 但**胶囊条目仍留在模块里**（只有点药丸上的 × 才会走 `removeCapsuleFrom`）。
 * 这种孤儿胶囊会造成两处不一致：
 * - 复制时 `plainEnglishOf` 仍按胶囊列表拼术语英文 → 复制出的内容与界面不符；
 * - 而 `sanitizeModule` 在重启/草稿恢复时会把孤儿清掉 → 重启后行为又变了。
 *
 * 因此这里按「与持久化同一口径」在源内容变化时即时回收。
 */
export function pruneOrphanCapsules<T extends { id: string }>(
  sourceText: string,
  capsules: readonly T[],
): T[] {
  const kept = capsules.filter((capsule) => hasCapsuleAnchor(sourceText, capsule.id));
  // 没有变化时返回原引用，避免无意义的重渲染
  return kept.length === capsules.length ? (capsules as T[]) : kept;
}

/**
 * 移除引用了「不存在胶囊」的锚点。
 *
 * 草稿恢复时必须做这一步：如果胶囊丢了但锚点还在，编辑器里就会露出一串
 * `[[cap:xxx]]` 字符——用户既看不懂，也删不干净。
 */
export function pruneAnchors(sourceText: string, knownCapsuleIds: ReadonlySet<string>): string {
  ANCHOR_PATTERN.lastIndex = 0;
  return sourceText.replace(ANCHOR_PATTERN, (match, capsuleId: string) =>
    knownCapsuleIds.has(capsuleId) ? match : '',
  );
}

// ---------------------------------------------------------------------------
// 源内容长度（单模块字数上限）
// ---------------------------------------------------------------------------

/**
 * 源内容的**可见字符数**：已知胶囊的锚点不计数。
 *
 * 用户在界面上看到的是「药丸 + 中文」，锚点那十几个字符从来不可见，
 * 因此它绝不能顶掉用户的书写额度。未知 id 的锚点按普通文本计数 ——
 * 与 `parseSource` 的约定一致（未知锚点当普通文字，用户看得见它）。
 */
export function sourceVisibleLength(
  sourceText: string,
  knownCapsuleIds: ReadonlySet<string>,
): number {
  return parseSource(sourceText, knownCapsuleIds).reduce(
    (total, segment) => (segment.kind === 'text' ? total + segment.text.length : total),
    0,
  );
}

/**
 * 按可见字符数截断源内容，**只砍文字，绝不砍胶囊锚点**。
 *
 * 锚点不占额度，所以超限只可能来自文字。额度用完之后：
 * - 后续文字全部丢掉；
 * - 后续锚点仍然原样接回去 —— 锚点被丢掉就意味着界面上那颗药丸凭空消失
 *   （编辑器重建时 `pruneAnchors` 还会把对应的胶囊一并清掉），那是内容丢失，不是截断。
 *
 * 返回 `null` 表示没超限、无需改动 —— 调用方据此避免无谓的 DOM 重建，
 * 否则每次打字都会重建编辑器、打断中文输入法。
 */
export function clampSourceText(
  sourceText: string,
  knownCapsuleIds: ReadonlySet<string>,
  maxLength: number,
): string | null {
  if (sourceVisibleLength(sourceText, knownCapsuleIds) <= maxLength) return null;

  let used = 0;
  const parts: string[] = [];

  for (const segment of parseSource(sourceText, knownCapsuleIds)) {
    if (segment.kind === 'capsule') {
      parts.push(capsuleAnchor(segment.capsuleId));
      continue;
    }
    const remaining = maxLength - used;
    if (remaining <= 0) continue;
    const kept = segment.text.slice(0, remaining);
    parts.push(kept);
    used += kept.length;
  }

  return parts.join('');
}

// ---------------------------------------------------------------------------
// 翻译请求与译文拼接（需求 6：不再使用占位符）
// ---------------------------------------------------------------------------

export interface TranslatePlan {
  /** 实际送往翻译接口的文本：只有纯中文部分 */
  text: string;
  /** 胶囊的英文内容，按它在源内容里出现的顺序（同一胶囊出现多次就重复多次） */
  capsuleEnglish: string[];
  /** 与 `capsuleEnglish` **一一对应**的权重（D121）：装配时逐段套括号用 */
  capsuleWeights: number[];
}

/**
 * 构造翻译请求：把胶囊部分剔掉，只留纯中文。
 *
 * 无论胶囊在源内容里出现在哪，最终译文里它们都排在前面 —— 这是需求 6 定的规则，
 * 用户要调整顺序就自己调整模块顺序。
 *
 * 权重在这里一并带出（与英文同序），装配阶段直接消费，不再回头解析字符串。
 */
export function buildTranslatePlan(
  sourceText: string,
  capsules: readonly Capsule[],
): TranslatePlan {
  const knownIds = new Set(capsules.map((capsule) => capsule.id));
  const byId = new Map(capsules.map((capsule) => [capsule.id, capsule]));

  const texts: string[] = [];
  const capsuleEnglish: string[] = [];
  const capsuleWeights: number[] = [];

  for (const segment of parseSource(sourceText, knownIds)) {
    if (segment.kind === 'text') {
      texts.push(segment.text);
      continue;
    }
    const capsule = byId.get(segment.capsuleId);
    const english = capsule?.english.trim() ?? '';
    if (!english) continue;
    capsuleEnglish.push(english);
    capsuleWeights.push(capsule?.weight ?? CAPSULE_WEIGHT_DEFAULT);
  }

  return { text: texts.join('').trim(), capsuleEnglish, capsuleWeights };
}

/**
 * 只折叠空白与首尾空格，**不动任何标点**。
 *
 * 用途仅限「送出去之前的请求文本」与展示层；**成品提示词**的收口在
 * `utils/promptText.ts` 的 `finishPromptText`（那边还要清全角标点）。
 * 两个用途刻意分开：请求文本要保留中文标点，成品只要英文标点。
 */
export function squeezeSpaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * 展示用的译文：**只有中文部分翻译出来的英文**。
 *
 * 胶囊在展示层就是它自己（中文名 + 颜色），不展开术语英文 ——
 * 否则一排里会同时出现「千早爱音」和「Chihaya Anon」，既重复又难读。
 */
export function normalizeTranslationBody(translated: string): string {
  return squeezeSpaces(translated);
}

/**
 * 复制用的英文：胶囊换成术语英文，按原顺序拼在最前面，与译文用逗号连接（需求 6）。
 *
 * 与展示层彻底分离：界面上看中文名，剪贴板里才是可以直接用的英文。
 * 例：胶囊「千早爱音」(Chihaya Anon) + 译文「Long hair, pink hair, smiling」
 *     → "Chihaya Anon, Long hair, pink hair, smiling"
 *
 * **这里只是薄壳**：真正干活的是 `utils/promptText.ts` 的 `assembleRowPrompt`
 * （装配）与 `finishPromptText`（收口）。保留它是因为断言与旧调用方都按这个签名说话；
 * 权重由调用方先渲染好再传进来（`moduleText.plainEnglishOf` 就是这么做的）。
 */
export function composeCopyText(
  capsuleEnglish: readonly string[],
  translated: string,
): string {
  return composeRowPrompt({ capsuleEnglish, body: translated });
}
