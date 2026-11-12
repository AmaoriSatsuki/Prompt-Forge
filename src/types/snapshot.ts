import type { ColorId } from '../constants/colors';

/**
 * 工作区快照（D67）。
 *
 * - **深拷贝**：快照里的胶囊是完整副本（name/english/colorId），
 *   不引用预设库；原预设被删掉也照样能还原。
 * - `scope = 'module'` 时 `modules` 长度严格为 1。
 * - 模块色一起存：用户要的是"完全还原"，包括每排的颜色。
 */
export interface SnapshotCapsule {
  id: string;
  /** 仅作记录，还原时不回查预设库 */
  presetId: string;
  /** 中文名（界面唯一可见字段） */
  name: string;
  /** 英文内容（与预设一样，界面永不渲染） */
  english: string;
  /** 权重（D121）：缺省 = 1；旧快照里没有这个字段，读盘时从 english 迁移一次 */
  weight?: number;
  colorId: ColorId;
  /** D85：词典 Tag 的标记必须在还原后仍保留（D110 起它只决定来源与词典色，不改外观） */
  kind?: 'capsule' | 'tag';
}

export interface SnapshotModule {
  /** 中文源内容（含 `[[cap:id]]` 锚点） */
  sourceText: string;
  /** 模块色条颜色 */
  colorId: ColorId;
  capsules: SnapshotCapsule[];
}

export type SnapshotScope = 'module' | 'global';

export interface Snapshot {
  id: string;
  name: string;
  scope: SnapshotScope;
  /** 权重：与预设同一套排序（默认 100） */
  weight: number;
  modules: SnapshotModule[];
  /** 保存时"全文复制"的内容（预览快照时展示） */
  copyText: string;
  createdAt: number;
  updatedAt: number;
}
