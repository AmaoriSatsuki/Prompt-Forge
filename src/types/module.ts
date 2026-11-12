import type { ColorId } from '../constants/colors';

/** 模块的翻译状态（界面文案在组件内映射为中文） */
export type ModuleStatus = 'idle' | 'translating' | 'done' | 'error';

/**
 * 胶囊：模块内的一段「术语占位」。
 * 界面上只显示 label（用户命名的中文名）；english 仅参与译文拼接，永不渲染。
 * colorId 是它来源预设的归属色 —— 胶囊在输入框里的样式必须与预设库完全一致，
 * 因此颜色跟着预设走，不跟随模块。
 */
export interface Capsule {
  id: string;
  /** 用户命名的中文名 —— 界面唯一可见字段 */
  label: string;
  /** 来源预设 id */
  presetId: string;
  /** 预设的英文内容。仅用于译文拼接，任何组件都不得渲染此字段。 */
  english: string;
  /**
   * 权重（D121）。缺省 = 1 = 不套括号。
   *
   * 为什么是字段而不是写进 english：英文是**原始内容**，权重是**我们对它的加工**；
   * 混在一起就再也分不清「预设自带的 `(x:1.2)`」和「用户调出来的权重」。
   * 现在渲染发生在装配阶段（`utils/promptText.ts`），english 一个字都不改。
   */
  weight?: number;
  /** 来源预设的归属色 */
  colorId: ColorId;
  /**
   * 这一条来自哪个库（D85 / D110）。
   *
   * - 缺省（旧数据）/ `'capsule'`：预设库、画师库拖进来的胶囊；
   * - `'tag'`：Tag 库（或词典词条）拖进来的胶囊。
   *
   * **只标来源，不改外观**（D110）：两种 kind 在输入框与输出框里都是同一颗
   * 「色点 + 中文名」药丸，唯一差别是 Tag 的归属色固定为词典色。英文无论哪种 kind
   * 都只进复制/推流载荷；锚点机制决定它本来就不进翻译请求。
   */
  kind?: 'capsule' | 'tag';
}

/**
 * 胶囊的界面视图：在类型上抹掉 english，
 * 让「英文内容不外泄」成为编译期约束，而不只是纪律。
 */
export type CapsuleView = Omit<Capsule, 'english'>;

/**
 * 输入框药丸的视图（编辑器 DOM 唯一接受的那一份）。
 *
 * 与 `CapsuleView` 同源：凡是它有的视觉字段都从那里 Pick，
 * 免得以后给胶囊加字段时只改一处、另一处悄悄漏掉。
 * 多出来的 `weight` 不是存储字段 —— 它是从 `capsule.english` 算出来的派生值（D120），
 * 英文本身在类型上仍然进不来。
 */
export type CapsulePillVisual = Pick<CapsuleView, 'label' | 'colorId'> & {
  /** 权重（1 = 不加权） */
  weight: number;
};

/**
 * 新建胶囊时的来源快照。
 * 由组件从预设库取出后传给模块 Store —— 这样模块 Store 不需要依赖预设 Store。
 */
export interface CapsuleSource {
  presetId: string;
  /** 预设的中文命名 */
  label: string;
  /** 预设的英文内容（仅参与译文拼接） */
  english: string;
  /** 预设的归属色（决定胶囊在界面上的样式） */
  colorId: ColorId;
  /** 权重（D121）：拖进来时一并快照，缺省 = 1 */
  weight?: number;
  /** 见 `Capsule.kind`：来自 Tag 库/词典的是 `'tag'`，其余都是普通胶囊（D110 起只标来源，不改外观） */
  kind?: 'capsule' | 'tag';
}

export interface ModuleError {
  /** 与 Rust AppError.code 对齐，如 NO_API_KEY / TIMEOUT */
  code: string;
  /** 已完成中文映射的提示文案 */
  message: string;
}

/** 最近一次翻译的用量信息，展示在输入框工具条上 */
export interface TranslationMeta {
  model: string;
  elapsedMs: number;
}

export interface Module {
  id: string;
  /** 1…8，模块不命名，界面用「序号 + 颜色」区分（需求 5） */
  order: number;
  /** 自动分配的归属颜色 */
  colorId: ColorId;
  /** 中文源内容，胶囊处为 ⟦cap:<capsuleId>⟧ 锚点 */
  sourceText: string;
  capsules: Capsule[];
  /** 纯英文成品（胶囊英文已拼在最前面） */
  translation: string;
  /**
   * 这一排在输出列表里的高度。
   * 初始 56px；用户拖底部细条调过之后它就是「最小值」，
   * 译文变长时自动增高、只增不减。
   */
  outputHeight: number;
  status: ModuleStatus;
  error?: ModuleError;
  /** 最近一次成功的翻译用了哪个模型、花了多久 */
  translationMeta?: TranslationMeta;
}
