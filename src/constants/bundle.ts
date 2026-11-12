import type { BundleLibraryKey } from '../types/bundle';

/**
 * 「导入导出」页的五个勾选项（D115）。
 *
 * 顺序按用户自己的叫法：预设库、画师库、Tag 库、词典库、快照库。
 * `hint` 只写「这个勾选到底带走什么」，不写操作建议 —— 说明块里已经有了。
 */
export interface BundleLibraryOption {
  key: BundleLibraryKey;
  label: string;
  hint: string;
}

export const BUNDLE_LIBRARY_OPTIONS: readonly BundleLibraryOption[] = [
  {
    key: 'presets',
    label: '预设库',
    hint: '含分组信息（组名、组色、展开状态）',
  },
  {
    key: 'artists',
    label: '画师库',
    hint: '词典文件夹里的画师随词典一起导出',
  },
  {
    key: 'tags',
    label: 'Tag 库',
    hint: '词典文件夹里的 Tag 随词典一起导出',
  },
  {
    key: 'dictionaries',
    label: '词典库',
    hint: '词典与它同文件夹的画师、Tag 一起走',
  },
  {
    key: 'snapshots',
    label: '快照库',
    hint: '全局快照与单模块快照都在内',
  },
];
