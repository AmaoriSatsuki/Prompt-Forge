import {
  CAPSULE_WEIGHT_DECIMALS,
  CAPSULE_WEIGHT_DEFAULT,
  CAPSULE_WEIGHT_MAX,
  CAPSULE_WEIGHT_MIN,
  CAPSULE_WEIGHT_STEP,
} from '../constants/limits';
import { splitTopLevel as sharedSplitTopLevel } from './topLevelSplit';

/**
 * 胶囊权重的**全部数学**：数字收口、逐段渲染 `(tag:1.5)`、旧数据迁移。
 *
 * 这里只做纯字符串/数字变换，不碰 React、不碰 Store —— 因此可被 `verify:logic` 直接断言。
 *
 * 三条口径：
 *
 * 1. **权重是数据字段**（`Capsule.weight`，D121）：`capsule.english` 保持原始内容，
 *    渲染时（装配阶段）才按权重套括号。所以预设自带的 `(x:1.2)` 既不会被误读成胶囊权重，
 *    也不会被覆盖掉 —— D120 时代「原始权重被覆盖后找不回」的代价因此消失。
 * 2. **按顶层逗号拆段**，不识别自然语言：切分只认**括号外、未被转义**的逗号
 *    （`(masterpiece, best quality:1.5)` 里的逗号不拆、画师名的 `\(` 不当括号）。
 * 3. **值 = 1 不套括号**：渲染是无损的（`renderWeightedEnglish` 不改输入），
 *    调回 1 就自然回到原始英文。
 *
 * 旧数据（D120 把权重写进了 english）由 `migrateWeightFromEnglish` 一次性搬进字段。
 */

/** 括号配对表：只认这三种（SD 生态里出现的分组括号） */
const CLOSERS: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

/** 反斜杠转义符：`\(` 是画师名的一部分，不是分组括号 */
const ESCAPE = '\\';

/**
 * 一段英文里可能有多种括号（`(a (b:1.2) c)`），叠在一段里就只按「最外层」算。
 * 深度为 0 才算顶层，因此 `:1.5` 只认最外层括号的尾巴。
 */
export interface WeightedSegment {
  /** 脱掉外层括号与权重之后的原文 */
  body: string;
  /** 括号里的权重；没有括号权重（含裸分组）是 null —— 调用方按默认值 1 处理 */
  weight: number | null;
}

function unit(): number {
  return 10 ** CAPSULE_WEIGHT_DECIMALS;
}

/** 收口：非数字回落默认值，两位小数，夹到 0.1–3.0 */
export function roundCapsuleWeight(value: number): number {
  if (!Number.isFinite(value)) return CAPSULE_WEIGHT_DEFAULT;
  const rounded = Math.round(value * unit()) / unit();
  return Math.min(CAPSULE_WEIGHT_MAX, Math.max(CAPSULE_WEIGHT_MIN, rounded));
}

/** 写进括号里的数字：两位小数以内、不补零（1.5 而不是 1.50） */
export function formatCapsuleWeight(value: number): string {
  return String(roundCapsuleWeight(value));
}

/** − / + 一次：先收口当前值，再走一个步进，再收口（避免 0.30000000000000004） */
export function stepCapsuleWeight(current: number, direction: -1 | 1): number {
  return roundCapsuleWeight(roundCapsuleWeight(current) + direction * CAPSULE_WEIGHT_STEP);
}

/**
 * 按**顶层逗号**拆段。
 *
 * - 括号内的逗号不拆（`(masterpiece, best quality:1.5)` 是一段）；
 * - `\,` 这种被转义的逗号不拆；
 * - 括号不配对时按「深度不低于 0」兜底，绝不吞字符。
 */
/**
 * 按**顶层逗号**拆段（权重这一侧的口径：只有逗号、认反斜杠转义）。
 *
 * 真正的实现是 `utils/topLevelSplit.ts` —— 全仓库唯一的切分器；
 * 这里只是给权重调用方一个带默认值的薄壳（并保持既有断言的名字不变）。
 */
export function splitTopLevel(text: string): string[] {
  return sharedSplitTopLevel(text);
}

/**
 * 这一串是否**整个**被一层括号包住。
 * 只判「首字符是 `(`、末字符是 `)`、并且最后一个括号正好闭合在最外层」——
 * `(a) (b)` 这种两段并列不算包住。
 */
function wrapsWhole(text: string): boolean {
  if (text.length < 3 || text[0] !== '(' || text[text.length - 1] !== ')') return false;

  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === ESCAPE) {
      index += 1;
      continue;
    }
    if (CLOSERS[char]) {
      depth += 1;
      continue;
    }
    if (char !== ')') continue;
    depth -= 1;
    if (depth < 0) return false;
    // 外层括号在结尾之前就闭上了 → 不是「包住整段」
    if (depth === 0 && index !== text.length - 1) return false;
  }

  return depth === 0;
}

/** 拆出一段：脱外层括号 + 取 `:数字` 尾巴；认不出来就原样当正文 */
export function parseWeightedSegment(text: string): WeightedSegment {
  const trimmed = text.trim();
  if (!trimmed) return { body: '', weight: null };
  if (!wrapsWhole(trimmed)) return { body: trimmed, weight: null };

  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return { body: '', weight: null };

  // 贪婪前缀 + 末尾数字：`a:b:1.5` 取最后一个冒号（b 不是数字时不会误判）
  const matched = /^(.*):\s*([0-9]+(?:\.[0-9]+)?)$/.exec(inner);
  if (!matched) return { body: inner, weight: null };

  const value = Number(matched[2]);
  return { body: matched[1].trim(), weight: Number.isFinite(value) ? value : null };
}

/**
 * 按给定权重**渲染**一段英文：权重 ≠ 1 时包 `(段:权重)`，= 1 时原样返回。
 *
 * 注意与旧实现（`applyWeightToSegment`）的区别：这里**不拆已有的括号**。
 * 权重已经是数据字段（`Capsule.weight`），英文本身是原始内容 ——
 * 预设自带的 `(x:1.2)` 因此不会被我们“继承”成胶囊权重、也不会被覆盖掉。
 */
export function renderWeightedSegment(segment: string, weight: number): string {
  const body = segment.trim();
  if (!body) return '';
  const value = roundCapsuleWeight(weight);
  if (value === CAPSULE_WEIGHT_DEFAULT) return body;
  return `(${body}:${formatCapsuleWeight(value)})`;
}

/**
 * 一整条胶囊英文的渲染：**权重 = 1 时原样返回**；≠ 1 时按顶层逗号逐段套权重，
 * 再用 `, ` 拼回去。
 *
 * 为什么 1 必须原样返回：胶囊英文是用户原文，不归正文的标点表管
 * （`~` / `。` / `"` 这些都可能是术语的一部分，用户实测 `~` 被改成逗号后拍板）。
 * 空串进、空串出（Tag 万一没有英文内容时不会变成 `(:1.5)`）。
 */
export function renderWeightedEnglish(english: string, weight: number): string {
  if (!english) return '';
  if (roundCapsuleWeight(weight) === CAPSULE_WEIGHT_DEFAULT) return english;

  const segments = splitTopLevel(english)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (segments.length === 0) return '';

  return segments.map((segment) => renderWeightedSegment(segment, weight)).join(', ');
}

/**
 * 这个数值是否**本来就是** D120 会写进 english 的形状：0.1–3.0、最多两位小数、不补零。
 *
 * 只有这种值才认作「我们当年写进去的权重」：迁移后重新渲染必须得到**一模一样的字符串**
 * （`(x:1.2)` → weight 1.2 → `(x:1.2)`）。用户手写的 `(x:1.234)` / `(x:9)` / `(x:0)`
 * 不满足这个条件，因此**原样保留**——迁移绝不四舍五入或夹断用户的数据。
 */
function isCanonicalWeight(value: number): boolean {
  return formatCapsuleWeight(value) === String(value);
}

/**
 * 旧数据的迁移入口（D121）：从 english 里把「当年写进去的权重」读出来。
 *
 * D120 时代权重是写进 `capsule.english` 的（`(tag:1.5)`）。改成数据字段后，
 * 读旧草稿 / 旧快照时要把括号剥掉、把数字搬进 `weight`，否则胶囊会同时
 * 「english 带括号」且「weight = 1」，界面上显示 1 而实际是 1.5。
 *
 * 只在**所有段权重一致、且每个值都是 D120 的规范形状**时才认：
 * - 混合权重属于用户手写的内容，不能整体吞掉；
 * - `(x:1.234)` / `(x:9)` 这类值迁进字段会被 round/夹取，等于改写用户英文——不认。
 *
 * 认不出来就原样返回，绝不改写用户的英文。
 */
export function migrateWeightFromEnglish(english: string): {
  english: string;
  weight: number | null;
} {
  const segments = splitTopLevel(english)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (segments.length === 0) return { english: '', weight: null };

  const parsed = segments.map(parseWeightedSegment);
  const weights = parsed.map((item) => item.weight);
  const first = weights[0];
  const uniform =
    first !== null &&
    isCanonicalWeight(first) &&
    weights.every((weight) => weight !== null && Math.abs(weight - first) < 1e-9);

  if (!uniform) return { english: english.trim(), weight: null };

  return {
    english: parsed.map((item) => item.body).join(', '),
    weight: roundCapsuleWeight(first as number),
  };
}

/** 手输框回车时用：字符串 → 收口后的权重；认不出数字就返回 null（调用方保持原值） */
export function parseWeightInput(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  // 只收十进制数字：允许 1、1.5、1.50、.5；`1e5` / `1,5` 一律当无效
  if (!/^[0-9]*\.?[0-9]+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  return roundCapsuleWeight(value);
}
