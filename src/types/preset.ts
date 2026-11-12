import type { ColorId } from '../constants/colors';

/**
 * 预设：胶囊的模板。
 * 属性来自需求 5：id、命名、英文内容、权重、归属颜色。
 * 界面只显示 label 与颜色、权重；english 只在「编辑预设」弹窗内可见。
 */
export interface Preset {
  id: string;
  /** 用户命名的中文名 */
  label: string;
  /** 英文内容 */
  english: string;
  /** 权重：默认 100，最低 0，无上限 */
  weight: number;
  /** 归属颜色（可为「通用」） */
  colorId: ColorId;
  createdAt: number;
  updatedAt: number;
  /**
   * 所在分组的名字（D111）：**只在预设库用**，缺省 = 未分组。
   *
   * 归属是「归纳」而非「标记」：一条预设最多属于一个组，换组就是改这一个字段。
   * 组本身不存成员列表（那是派生值），只由 `preset-folders.json` 承载它的可见色与展开状态。
   */
  folder?: string;
  /**
   * 这条属于哪个**库文件**（D87）：`tags.json`、`dictionaries/<文件夹>/tags.json` …
   *
   * **只在内存里**：加载时由 `withSourceFile()` 打上，写盘前由 `toDisk()` 去掉。
   * 它的用处是「改一条只重写那一个文件」，以及「删词典 = 删文件夹，派生数据自然消失」——
   * 因此磁盘上不需要任何来源字段（D86 那套 `sourceDictionaryId` 已在 D87 移除）。
   */
  sourceFile?: string;
}

/** 新建 / 编辑预设时的草稿 */
export interface PresetDraft {
  label: string;
  english: string;
  weight: number;
  colorId: ColorId;
}

/**
 * 预设分组（D111 / D112）——「组」的**轻实体**，只承载成员列表推不出来的两件事：
 *
 * - `name`：组名（与 `Preset.folder` 同名字符串，同名即同一组，没有额外 id）；
 * - `colorId`：组的颜色 —— **创建时取那颗被拖进来的胶囊的颜色，之后固定不可改**。
 *   组只出现在「总列表」或「它自己那个色块」的筛选下，因此组里只可能有同色胶囊；
 * - `expanded`：折叠砖还是展开卡（记住状态，免得每次重新双击）。
 *
 * 保存位置是数据根目录的 `preset-folders.json`：**文件缺失 = 完全无损降级**
 * （组名仍从成员派生、颜色也由成员推出、一律折叠）。
 */
export interface PresetFolder {
  name: string;
  colorId: ColorId;
  expanded: boolean;
}
