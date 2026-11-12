import { normalizePromptBody } from './promptPunctuation';

/**
 * 提示词文本的**接缝层**（S4 装配 / S6 成品）。
 *
 * 为什么单独一个模块：在这之前，「按逗号连接」「折叠空白」「转全角标点」散在
 * `placeholder.ts`（composeCopyText）、`moduleText.ts`（moduleLineOf 里还有一次
 * split-再-join）、`sliceTranslate.ts`（polishSlice 里把 squeezeSpaces 调了两次）三处，
 * 谁都能改一笔 —— 于是「展示的文本」和「复制出去的文本」早晚会分叉。
 *
 * 这里的规矩（2026-11 修订）：
 * 1. **正文块归正文块**：译文在切片前/回包后归一（`normalizePromptBody`），到接缝时已是成品；
 * 2. **胶囊块绝对原样**：用户实测 `~` 被正文标点表改成逗号后拍板 —— 胶囊英文一个字符
 *    都不许改（只允许按权重加一层括号）；接缝也**不再**对整行做二次归一；
 * 3. 接缝只做：装配（拼）→ 连接（排/全文/推流）；空段丢弃；只在「上一段已经以逗号
 *    结尾」时不再重复加逗号（但绝不删掉原文里的逗号）；
 * 4. **末尾不补标点**：正文块自己的句读在归一阶段收掉；胶囊以什么结尾就保留什么。
 */
export interface PromptParts {
  capsuleEnglish: readonly string[];
  body: string;
}

/** 结尾是不是「已经是一个逗号」—— 只影响我们要不要补分隔符，绝不改原文 */
function endsWithComma(text: string): boolean {
  return text.endsWith(',') || text.endsWith('，');
}

/**
 * 用给定分隔符连接：空段丢弃。
 *
 * 旧实现会把非末段结尾的逗号类符号剪掉，那等于改写胶囊英文（用户实测 `~` 被
 * 正文标点表改逗号后再次拍板：胶囊必须绝对原样）。现在只在「上一段已经以逗号
 * 结尾」时改用 `afterCommaSeparator`（通常是一个空白/换行），避免拼出 `, ,`；
 * 原文里的逗号、句号、波浪号一个都不删。
 */
function joinPieces(
  pieces: readonly string[],
  separator: string,
  afterCommaSeparator: string,
): string {
  const list = pieces.map((piece) => piece.trim()).filter((piece) => piece.length > 0);
  let out = '';
  for (const piece of list) {
    if (out.length > 0) out += endsWithComma(out) ? afterCommaSeparator : separator;
    out += piece;
  }
  return out;
}

/**
 * S4 装配：胶囊英文在前、译文在后，按 `, ` 连接。
 *
 * 为什么胶囊总在前面：这是需求 6 的既定口径（胶囊就是这一排的主题词），
 * 用户要调顺序就调排的顺序。空段丢弃，因此不会产出 `, ,`。
 *
 * 装配**不洗内容**：只做 trim 与丢空段；句读归一不在这里（正文由调用方先归一，
 * 胶囊永远不归一）。
 */
export function assembleRowPrompt(parts: PromptParts): string {
  return joinPieces([...parts.capsuleEnglish, parts.body], ', ', ' ');
}

/**
 * S5 正文收口：只整理**正文块**（句读→逗号、折叠空白、折叠连续逗号、去首尾逗号）。
 *
 * 胶囊英文不经过这里 —— 这是本轮最关键的边界（`~` 事故）。
 * 用户 2026 口径：正文末尾不留逗号/句读；胶囊保持用户原文。
 */
export function finishPromptText(text: string): string {
  return normalizePromptBody(text);
}

/**
 * S6 一行成品：**先只归正文**，再装配。
 *
 * 胶囊英文与译文是两块：译文过收口，胶囊原样；接缝只负责连接。
 */
export function composeRowPrompt(parts: PromptParts): string {
  return assembleRowPrompt({
    capsuleEnglish: parts.capsuleEnglish,
    body: finishPromptText(parts.body),
  });
}

/**
 * 全文：排与排之间「先逗号、再换行」（`, \n`）。
 * 空排直接跳过，因此不会出现空行；行尾已经带逗号（胶囊原文）时不再补逗号，
 * 只补换行。
 *
 * 入参必须是**已经过 `composeRowPrompt` 的成品行**（`moduleLineOf` 的返回值）；
 * 这里不再做二次归一，否则会把胶囊英文洗掉。
 */
export function composeFullPrompt(rows: readonly string[]): string {
  return joinPieces(rows, ', \n', '\n');
}

/** 推流用：全文压成一行（ComfyUI 节点里显示多行很难看） */
export function composeWirePrompt(rows: readonly string[]): string {
  return joinPieces(rows, ', ', ' ');
}

/** 一处工序的痕迹：给断言与排查用（“每一步都确凿”） */
export interface PromptTraceStep {
  stage: 'assemble' | 'finish';
  output: string;
}

/**
 * 把一行提示词的生成过程逐段吐出来。
 *
 * 这不是调试残渣：断言用它做**逐段快照**（每一步的输入输出都钉死），
 * 以后谁想在某一步“顺手再改一点”，失败信息会直接指出是哪一步变了。
 */
export function traceRowPrompt(parts: PromptParts): PromptTraceStep[] {
  return [
    { stage: 'assemble', output: assembleRowPrompt(parts) },
    { stage: 'finish', output: composeRowPrompt(parts) },
  ];
}
