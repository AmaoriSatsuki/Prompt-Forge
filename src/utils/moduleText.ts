import { MODULE_MAX_COUNT } from '../constants/limits';
import type { Module } from '../types/module';
import { renderWeightedEnglish } from './capsuleWeight';
import { buildTranslatePlan } from './placeholder';
import { composeFullPrompt, composeRowPrompt, composeWirePrompt } from './promptText';

/**
 * 复制 / 推流载荷的唯一出口。
 *
 * 三层分工（审计后收口，见 HANDOFF §四.3）：
 * 1. `buildTranslatePlan` 决定**顺序与内容**（胶囊英文按源内容出现顺序、译文只留中文部分的英文）；
 * 2. `renderWeightedEnglish` 把权重渲染成 `(tag:1.5)`（英文本身保持不变）；
 * 3. `utils/promptText.ts` 负责装配、收口与连接 —— 全仓库只有它做这三件事。
 *
 * 因此：展示与复制是**两件事**（展示只有中文译文，复制才有术语英文），
 * 但复制、全文、推流、快照消费的是**同一套工序**，不会再出现两套清洗规则。
 */

/**
 * 这一排的胶囊英文（已按权重渲染），顺序与源内容里出现的一致。
 *
 * **胶囊英文绝对原样**：不归一、不清洗、不替换任何字符（用户实测 `~` 被正文
 * 标点表改成逗号后拍板）。这里只做「按权重包一层括号」，原文一个字都不动；
 * 正文块（`module.translation`）才走 `normalizePromptBody`。
 */
function capsuleEnglishOf(module: Pick<Module, 'sourceText' | 'capsules'>): string[] {
  const plan = buildTranslatePlan(module.sourceText, module.capsules);
  return plan.capsuleEnglish.map((english, index) =>
    renderWeightedEnglish(english, plan.capsuleWeights[index]),
  );
}

/**
 * 这一排的成品英文（复制 / 推流 / 快照共用）。
 *
 * 需求：复制出去的必须是「可以直接用的纯英文」——不带中文、不带序号、不带胶囊标签。
 * 因此所有复制路径都必须经过这里，禁止在组件里直接读 `module.translation`。
 */
export function plainEnglishOf(
  module: Pick<Module, 'translation' | 'sourceText' | 'capsules'>,
): string {
  return composeRowPrompt({
    capsuleEnglish: capsuleEnglishOf(module),
    body: module.translation,
  });
}

/** 有东西可复制吗（只有胶囊、还没翻译时也算有） */
export function hasEnglish(
  module: Pick<Module, 'translation' | 'sourceText' | 'capsules'>,
): boolean {
  return plainEnglishOf(module).trim().length > 0;
}

/**
 * **一排**的复制文本：这一排在「全文复制」里贡献的那一段。
 *
 * 它不再做任何清洗 —— 清洗已经在 `composeRowPrompt` 里做完了。
 * 保留这个名字是因为推流与全文都按它取「一排」，且断言按它说话。
 */
export function moduleLineOf(
  module: Pick<Module, 'translation' | 'sourceText' | 'capsules'>,
): string {
  return plainEnglishOf(module);
}

/**
 * 「全文复制」的载荷：模块**从上到下逐排拼接**。
 *
 * 规则：
 * - 每一排用 `moduleLineOf` 得到成品；什么内容都没有的排**直接跳过**，不会产生空行；
 * - 排与排之间是**先英文逗号、再换行**（`, \n`）；
 * - **末尾不做任何处理**（用户 2026 拍板：尊重最后一个模块，不补也不删）；
 * - 中间几排结尾多余的逗号会被去掉（否则会拼出 `, , `），句号等一律保留。
 *
 * 注意这条口径同时管着：全文复制、实时推流的 `global`、快照的 `copyText`、
 * 以及 ComfyUI 那边「榫言全局」的剩余整段。
 */
export function composeFullCopyText(
  modules: readonly Pick<Module, 'translation' | 'sourceText' | 'capsules'>[],
): string {
  return composeFullPrompt(modules.map((module) => moduleLineOf(module)));
}

/** 全文有没有可复制的内容（全空时「全文复制」只提示、不写剪贴板） */
export function hasAnyEnglish(
  modules: readonly Pick<Module, 'translation' | 'sourceText' | 'capsules'>[],
): boolean {
  return composeFullCopyText(modules).length > 0;
}

/**
 * 实时推流（D81）的载荷：**就是「全文复制」的内容，压成一行**。
 *
 * 唯一差别是换行：`composeFullCopyText` 用 `, \n` 连排（复制出去是分行的），
 * 而 ComfyUI 节点里显示多行很难看，所以把换行收成 `, `。
 * 全空时返回空字符串（调用方照样推一条空帧，这是明确需求）。
 */
export function composeBroadcastText(
  modules: readonly Pick<Module, 'translation' | 'sourceText' | 'capsules'>[],
): string {
  return composeWirePrompt(modules.map((module) => moduleLineOf(module)));
}

/**
 * 一帧推流的载荷（D90：按模块分离推流）。
 *
 * 为什么要有它：整段 `global` 喂给一个 CLIP，多人场景下特征会互相污染
 * （串色 / 串衣服）。把**每一排的英文单独拎出来**，ComfyUI 那边就能一个节点只吃一块。
 *
 * 三条口径：
 * - `global` 与 D81 完全一致（`composeBroadcastText`，单行）；
 * - `modules[n]` 是**第 n 排**的文本（`moduleLineOf`），与「模块 n」下拉项一一对应；
 * - **恒定 `MODULE_MAX_COUNT`（9）个键**，没有内容 / 模块不存在都是空串
 *   —— 这样插件端「模块不存在」与「模块为空」走同一条错误路径，不必区分。
 *
 * 键用**行位置**（`"1"`..`"9"`，即数组下标 +1），**不是** `module.id`：
 * id 由 `createId('mod')` 随机生成，重载草稿 / 套快照就会换，ComfyUI 里存好的选择会指到别的排；
 * 行位置就是用户眼睛看到的「第几排」，也因此要求用户不要改排的顺序。
 */
export interface BroadcastPayload {
  /** 所有模块拼接后的完整文本（单行） */
  global: string;
  /** 按行位置切开的文本：`"1"`..`"9"`，空排是 `""` */
  modules: Record<string, string>;
}

export function composeBroadcastPayload(
  modules: readonly Pick<Module, 'translation' | 'sourceText' | 'capsules'>[],
): BroadcastPayload {
  const byLine: Record<string, string> = {};

  for (let index = 0; index < MODULE_MAX_COUNT; index += 1) {
    const module = modules[index];
    // 模块数量可增删（1–9），键恒定补齐：没有这一排就是空串
    byLine[String(index + 1)] = module ? moduleLineOf(module) : '';
  }

  return { global: composeBroadcastText(modules), modules: byLine };
}
