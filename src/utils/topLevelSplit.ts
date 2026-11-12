/**
 * 顶层切分：**全仓库唯一**的「按分隔符切段」实现。
 *
 * 为什么必须只有一个：切分规则一旦有第二份，同一段文本换个入口就会得到不同的段
 * —— 实测过的后果是「词典命中率莫名变低」「按逗号清洗把 `(a, b:1.5)` 拆开」。
 * 现在两个使用者（切片翻译、胶囊权重）都走这里，区别只在**是否把换行当分隔符**。
 *
 * 两条保护（可单独关掉）：
 * 1. **括号**：`()` `[]` `{}` `<>` 内部的分隔符不切（`(a, b:1.5)` 是一段）；
 * 2. **反斜杠转义**：`\,` 不切、`\(` 不进层（画师名 `\(oOo\)` 就是正文）。
 *
 * **引号不再是保护符**（用户 2026 口径）：引号属于句读，进入这里之前已经被
 * `utils/promptPunctuation.ts` 映射成逗号了；而英文撇号（`woman's`）是术语内容，
 * 不能因为「引号奇偶」这种理由把括号保护整体关掉 —— 那会让权重渲染把括号组拆开。
 *
 * 括号**不配平**时（用户随手打了半个括号）退回「见到分隔符就切」：
 * 否则一个没闭合的括号会把后面整段内容吞成一片，比多切几下糟得多。
 */

/** 括号配对表 */
const PAIRS: Readonly<Record<string, string>> = {
  '(': ')',
  '[': ']',
  '{': '}',
  '<': '>',
};

const CLOSERS = new Set(Object.values(PAIRS));
const ESCAPE = '\\';

export interface TopLevelSplitOptions {
  /** 额外的分隔符（逗号始终算分隔符） */
  extraSeparators?: readonly string[];
  /** 是否把换行也当分隔符 */
  splitNewlines?: boolean;
  /** 是否认反斜杠转义（默认认） */
  respectEscapes?: boolean;
}

/** 括号是否配平（只数括号；引号/撇号不参与） */
export function hasBalancedGroups(text: string): boolean {
  const stack: string[] = [];

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === ESCAPE) {
      index += 1;
      continue;
    }
    if (PAIRS[char]) stack.push(PAIRS[char]);
    else if (CLOSERS.has(char)) {
      if (stack.length === 0) return false;
      stack.pop();
    }
  }

  return stack.length === 0;
}

/**
 * 按顶层分隔符切段（保留空白，由调用方决定怎么 trim）。
 *
 * 不设分隔符集时会退化成「只有逗号」—— 这也是权重那边要的口径。
 */
export function splitTopLevel(text: string, options: TopLevelSplitOptions = {}): string[] {
  const {
    extraSeparators = [],
    splitNewlines = false,
    respectEscapes = true,
  } = options;

  const separators = new Set<string>([',', ...extraSeparators]);
  // 括号不配平时放弃保护，退回朴素切分（绝不让半个括号吞掉整段）
  const guarded = hasBalancedGroups(text);

  const pieces: string[] = [];
  let current = '';
  let depth = 0;

  const isSeparator = (char: string): boolean =>
    separators.has(char) || (splitNewlines && char === '\n');

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (guarded && respectEscapes && char === ESCAPE) {
      current += char;
      const next = text[index + 1];
      if (next !== undefined) {
        current += next;
        index += 1;
      }
      continue;
    }
    if (guarded && PAIRS[char]) {
      depth += 1;
      current += char;
      continue;
    }
    if (guarded && CLOSERS.has(char)) {
      depth = Math.max(0, depth - 1);
      current += char;
      continue;
    }
    if (depth === 0 && isSeparator(char)) {
      pieces.push(current);
      current = '';
      continue;
    }
    current += char;
  }

  pieces.push(current);
  return pieces;
}
