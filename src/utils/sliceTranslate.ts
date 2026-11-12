import {
  MAX_QUERY_BYTES,
  MAX_REQUEST_CHARS,
  SLICE_JOIN_SEPARATOR,
  SLICE_OUTPUT_SEPARATOR,
} from '../constants/limits';
import { squeezeSpaces } from './placeholder';
import { normalizePromptBody, toPromptSeparators } from './promptPunctuation';
import { splitTopLevel } from './topLevelSplit';

/**
 * 切片翻译执行层（V3 第二层）。
 *
 * 职责边界：**只做「一段纯中文 → 拼接好的英文」这件事**。
 * - 不持有状态、不读 Store、不碰 UI、不发网络请求（翻译动作由调用方以 `translate` 注入）；
 * - **胶囊在这一层完全不可见**：调度层必须先把锚点摘掉，只把纯中文传进来
 *   （胶囊英文的拼接发生在调度层，见 `utils/moduleText.ts` 的复制链路）。
 *
 * 标点口径（用户 2026）：句读类标点一律先变成英文逗号再切分（见
 * `utils/promptPunctuation.ts`），因此接口拿到的片段里没有中文句读；
 * 接口自己带回来的句读由 `normalizePromptBody` 在**回包时**再收一次。
 *
 * 因为翻译函数是注入的，这一层可以在 Node 里用假翻译器完整断言（含分批与回退），
 * 不需要密钥、不需要网络。
 */

/** 一次翻译请求的返回形状（与 Rust 侧 TranslateResult 一致，只取用得到的字段） */
export interface SliceTranslateResult {
  text: string;
}

/** 注入的翻译能力：给一段文本，回一段译文 */
export type SliceTranslateFn = (text: string) => Promise<SliceTranslateResult>;

export interface SliceTranslateOptions {
  /** 单次请求上限（UTF-8 字节），默认取常量 */
  maxQueryBytes?: number;
  /**
   * 本地词典解析器（D50）：给定切片，命中返回英文，未命中返回 null。
   *
   * 命中的片段**不参与分批、不发请求**，原样进入最终译文（不改大小写、不做标点清洗）；
   * 未命中的片段照旧走「分批 → 按行取回 → 行数不符逐段回退」的老路。
   * 传 null/不传 = 没有词典（行为与以前完全一致）。
   */
  resolveSegment?: (segment: string) => string | null;
}

export interface SliceTranslateOutcome {
  /** 最终译文：按原顺序用「, 」拼接，末尾不加逗号 */
  text: string;
  /** 切出来的片段（已去空格、跳过空片段、标点已归一到英文逗号） */
  segments: string[];
  /** 实际发起的请求批次（便于断言分批与回退） */
  batches: string[];
  /** 是否因为「返回行数与输入行数不一致」而回退成逐片段翻译 */
  fellBackToPerSegment: boolean;
  /** 有多少片段是由本地词典直接命中的（未发请求） */
  dictionaryHits: number;
}

// ---------------------------------------------------------------------------
// 步骤 1：中文标点 → 英文逗号（句读一律当分隔符）
// ---------------------------------------------------------------------------

// 映射表在 utils/promptPunctuation.ts —— 那里同时被词典键使用，
// 保证「切出来的片段」与「词条里的中文」用同一套归一化。

/** 换行统一成 LF，便于同一套逻辑处理 CRLF */
function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/**
 * 把一段中文切成片段。
 *
 * 切片的本质是**符号替换**：先把句读类标点归一到英文逗号（`utils/promptPunctuation.ts`），
 * 再按逗号/换行切开、去掉首尾空格、跳过空片段。
 *
 * 括号（`（）【】` 等）是语法，不转逗号：`权重【1.2,0】` 里的逗号属于内容。
 * 引号不再是保护符（它们已经是逗号了）。
 *
 * 切分本身走**全仓库唯一**的实现 `utils/topLevelSplit.ts`。
 */
export function splitSlices(text: string): string[] {
  const converted = normalizeNewlines(toPromptSeparators(text));
  const pieces = splitTopLevel(converted, { splitNewlines: true });

  return pieces.map((part) => part.trim()).filter((part) => part.length > 0);
}

// ---------------------------------------------------------------------------
// 步骤 4：按 UTF-8 字节分批
// ---------------------------------------------------------------------------

const utf8Encoder = new TextEncoder();

/** 一段文本的 UTF-8 字节数（与 Rust 的 `String::len()` 同口径） */
export function utf8ByteLength(text: string): number {
  return utf8Encoder.encode(text).length;
}

/**
 * 把片段分批。规则尽量简单：**一批最多 1000 字**（`maxChars`），
 * 塞不下就开新批。`maxBytes`（接口的 6000 字节）只是保险丝，正常永远不会被触发。
 *
 * 单片段本身就超限时，它仍然**单独成批**发出去 —— 这样 Rust 侧会给出
 * 「这一段太长了（N 字节…）请拆分成多个模块」的中文提示，比前端静默截断更好懂。
 */
export function packSlices(
  segments: readonly string[],
  maxBytes: number = MAX_QUERY_BYTES,
  maxChars: number = MAX_REQUEST_CHARS,
): string[][] {
  const batches: string[][] = [];
  const separatorBytes = utf8ByteLength(SLICE_JOIN_SEPARATOR);
  let current: string[] = [];
  let currentBytes = 0;
  let currentChars = 0;

  for (const segment of segments) {
    const segmentBytes = utf8ByteLength(segment);
    const joinBytes = current.length > 0 ? separatorBytes : 0;
    const overChars = currentChars + segment.length > maxChars;
    const overBytes = currentBytes + joinBytes + segmentBytes > maxBytes;
    if (current.length > 0 && (overChars || overBytes)) {
      batches.push(current);
      current = [];
      currentBytes = 0;
      currentChars = 0;
    }
    currentBytes += (current.length > 0 ? separatorBytes : 0) + segmentBytes;
    currentChars += segment.length;
    current.push(segment);
  }

  if (current.length > 0) batches.push(current);
  return batches;
}

// ---------------------------------------------------------------------------
// 步骤 5：把返回文本按行取回
// ---------------------------------------------------------------------------

/**
 * 把一次请求的返回文本切成行。
 *
 * 用 `\n` 请求、也按 `\n` 取回：百度会按行返回 `trans_result`，Rust 侧把它们
 * 逐条拼成纯文本。这里同时容忍 `\r\n`，避免 Windows 换行造成行数误判。
 */
export function splitTranslatedLines(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// ---------------------------------------------------------------------------
// 步骤 7：片段后处理
// ---------------------------------------------------------------------------

/**
 * 折叠连续空白并去掉首尾空格（复用 `placeholder.ts` 的同一实现，避免出现两份）。
 * 这里再导出一次，方便本层的使用者与断言只依赖一个模块。
 */
export { squeezeSpaces };

/**
 * 单个片段的后处理：**先归一句读标点，再统一小写**。
 *
 * 小写放在归一之后没有区别（标点不受大小写影响），但顺序写死能避免以后
 * 有人把「小写」插到中间时误伤 `.` / `'` 的上下文判断。
 */
export function polishSlice(translated: string): string {
  return normalizePromptBody(translated).toLowerCase();
}

// ---------------------------------------------------------------------------
// 主流程：切成片段 → 分批请求 → 按序取回 → 后处理 → 拼接
// ---------------------------------------------------------------------------

/**
 * 切片翻译：一段中文 → 拼接好的英文译文。
 *
 * `translate` 由调用方注入（真实场景传 `(text) => callTranslate(profile, text)`），
 * 因此这一层可以完全离线测试。
 *
 * **本地词典（D50）**：`options.resolveSegment` 命中的片段直接产出英文，不参与分批、不发请求；
 * 只有未命中的片段才走「分批 → 按行取回 → 行数不符逐段回退」。命中段原样保留
 * （不做小写），但最终整段仍过一次 `normalizePromptBody`，保证回包里的句读也被收掉。
 */
export async function sliceTranslate(
  chineseText: string,
  translate: SliceTranslateFn,
  options: SliceTranslateOptions = {},
): Promise<SliceTranslateOutcome> {
  const maxQueryBytes = options.maxQueryBytes ?? MAX_QUERY_BYTES;
  const segments = splitSlices(chineseText);

  const outcome: SliceTranslateOutcome = {
    text: '',
    segments,
    batches: [],
    fellBackToPerSegment: false,
    dictionaryHits: 0,
  };
  if (segments.length === 0) return outcome;

  // 步骤 1：先过本地词典 —— 命中即定稿，未命中才需要翻译
  const resolved: (string | null)[] = segments.map((segment) => {
    const hit = options.resolveSegment?.(segment) ?? null;
    const trimmed = hit === null ? '' : hit.trim();
    return trimmed ? trimmed : null;
  });
  outcome.dictionaryHits = resolved.reduce((total, value) => (value === null ? total : total + 1), 0);

  // 未命中的片段才需要翻译；记下它们在原数组里的下标，回填时不能错位
  const pendingIndexes = segments
    .map((_, index) => index)
    .filter((index) => resolved[index] === null);
  const pendingSegments = pendingIndexes.map((index) => segments[index]);
  const translated: (string | null)[] = segments.map(() => null);

  // 步骤 2：只把未命中的片段分批发出去
  if (pendingSegments.length > 0) {
    const batches = packSlices(pendingSegments, maxQueryBytes);
    let cursor = 0;

    for (const batch of batches) {
      const requestText = batch.join(SLICE_JOIN_SEPARATOR);
      outcome.batches.push(requestText);

      const result = await translate(requestText);
      let lines = splitTranslatedLines(result.text);

      if (lines.length !== batch.length) {
        // 行数不一致 → 回退逐片段翻译，保证「一片段一译文」的对应关系不丢
        outcome.fellBackToPerSegment = true;
        lines = [];
        for (const segment of batch) {
          outcome.batches.push(segment);
          const single = await translate(segment);
          lines.push(splitTranslatedLines(single.text).join(' '));
        }
      }

      for (let index = 0; index < batch.length; index += 1) {
        const line = lines[index];
        // 按「原片段下标」回填：命中段留在原位，译文不能整体前移
        if (line !== undefined) translated[pendingIndexes[cursor]] = line;
        cursor += 1;
      }
    }
  }

  // 步骤 3：按原顺序合并 —— 命中段保留原大小写，API 段做后处理
  const finalLines: string[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    const hit = resolved[index];
    if (hit !== null) {
      finalLines.push(hit);
      continue;
    }
    const line = translated[index];
    if (line) finalLines.push(polishSlice(line));
  }

  /*
   * 成品正文再收一次：接口可能自己加句号/感叹号，词典英文里也可能带句读。
   * 这一步同时保证「正文块」的契约：首尾没有逗号、没有连续逗号、没有句读标点。
   */
  outcome.text = normalizePromptBody(
    finalLines.filter((line) => line.length > 0).join(SLICE_OUTPUT_SEPARATOR),
  );
  return outcome;
}

/** 只要译文文本的便捷包装 */
export async function sliceTranslateText(
  chineseText: string,
  translate: SliceTranslateFn,
  options: SliceTranslateOptions = {},
): Promise<string> {
  return (await sliceTranslate(chineseText, translate, options)).text;
}
