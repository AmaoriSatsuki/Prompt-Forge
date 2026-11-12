/**
 * 提示词标点的**唯一口径**（正文块 / 词典键 / 将来的胶囊术语块共用）。
 *
 * 用户 2026 口径：成品里**我们造的符号**只有 `, : ( ) \` 和空格；句读类标点
 * 一律先变成英文逗号（再按逗号切分/拼接），括号与英文冒号是语法，原样保留。
 *
 * 两条上下文规则（这两类字符在术语里是内容，不是句读）：
 * 1. `.` 夹在字母/数字之间时保留（`1.5`、`v1.5`、`artist.name`），否则按句号变逗号；
 * 2. `'`（含弯引号 `’`）夹在两个字母之间时保留（`woman's`），否则按引号变逗号。
 *
 * 这里**只管标点**：不 trim、不折叠空白、不加空格 —— 那是 `normalizePromptBody` 的事。
 * 这样「词典键」与「切出来的片段」可以用同一个映射，却各自决定要不要整理空白。
 */

/** 一律转成英文逗号的句读类字符（全角/中文标点 + 英文逗号类 + 引号） */
const TO_COMMA = new Set<string>([
  '，',
  '。',
  '、',
  '；',
  '：',
  '！',
  '？',
  '．',
  '…',
  '—',
  '–',
  '～',
  '〜',
  '·',
  '「',
  '」',
  '『',
  '』',
  '《',
  '》',
  '〈',
  '〉',
  '〔',
  '〕',
  '“',
  '”',
  '‘',
  '＂',
  ',',
  ';',
  '!',
  '?',
  '"',
  '`',
  '~',
]);

/**
 * 括号是语法（权重分组、`【】` 强调），不转逗号；全角括号统一成半角。
 * `「」『』《》〈〉〔〕` 是引号/书名号，不是代码括号，因此归入上面的句读表。
 */
const BRACKET_MAP: Readonly<Record<string, string>> = {
  '（': '(',
  '）': ')',
  '【': '[',
  '】': ']',
  '［': '[',
  '］': ']',
  '｛': '{',
  '｝': '}',
  '＜': '<',
  '＞': '>',
};

function isAsciiLetter(char: string | undefined): boolean {
  if (char === undefined) return false;
  const code = char.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isWordChar(char: string | undefined): boolean {
  if (char === undefined) return false;
  const code = char.charCodeAt(0);
  return isAsciiLetter(char) || (code >= 48 && code <= 57);
}

/**
 * 把句读类标点统一映射成英文逗号（**只映射，不整理空白**）。
 *
 * 这是切片前与词典键共用的一步：两边必须用同一个映射，否则「片段里是 `,`、
 * 词条里是 `，`」这种对不上的情况会再次出现。
 */
export function toPromptSeparators(text: string): string {
  let out = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const bracket = BRACKET_MAP[char];
    if (bracket !== undefined) {
      out += bracket;
      continue;
    }
    if (char === '.') {
      out += isWordChar(text[index - 1]) && isWordChar(text[index + 1]) ? '.' : ',';
      continue;
    }
    if (char === "'" || char === '’' || char === '＇') {
      // 英文撇号是术语的一部分；弯引号 / 全角撇号也统一成 ASCII 撇号
      out += isAsciiLetter(text[index - 1]) && isAsciiLetter(text[index + 1]) ? "'" : ',';
      continue;
    }
    out += TO_COMMA.has(char) ? ',' : char;
  }
  return out;
}

/** 去掉首尾的逗号与空白（词典键用；**不**动中间的逗号与空白） */
export function trimJunctionCommas(text: string): string {
  return text.replace(/^[\s,]+/, '').replace(/[\s,]+$/, '');
}

/**
 * 正文成品的整理：映射 → 折叠空白 → 统一 `, ` → 折叠连续逗号 → 去首尾逗号。
 *
 * 幂等：`normalizePromptBody(normalizePromptBody(x)) === normalizePromptBody(x)`。
 * 它只负责「正文这一块是干净的」；排与排、术语与正文之间的连接仍由接缝负责。
 */
export function normalizePromptBody(text: string): string {
  const spaced = toPromptSeparators(text)
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ');
  return trimJunctionCommas(spaced.replace(/(?:, ){2,}/g, ', ')).trim();
}
