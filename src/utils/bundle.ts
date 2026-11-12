import { BUNDLE_LIBRARY_OPTIONS } from '../constants/bundle';
import type {
  BundleExportReport,
  BundleImportReport,
  BundleIncluded,
  BundleLibraryKey,
  BundleMergeStats,
  BundleSummary,
} from '../types/bundle';

/**
 * 「导入导出」页的纯函数（D115）：默认勾选、计数、概况行、账目文案。
 *
 * 放在 utils 里是为了能被 `verify-logic` 离线断言 ——
 * 真正搬数据的合并逻辑在 Rust（`src-tauri/src/bundle/merge.rs`），那边由 `cargo test` 兜底。
 */

/** 默认全选（用户口径：勾选的形式、默认全选） */
export function allLibrariesSelected(): BundleIncluded {
  return {
    presets: true,
    artists: true,
    tags: true,
    dictionaries: true,
    snapshots: true,
  };
}

export function toggleLibrary(selection: BundleIncluded, key: BundleLibraryKey): BundleIncluded {
  return { ...selection, [key]: !selection[key] };
}

export function selectedLibraryCount(selection: BundleIncluded): number {
  return BUNDLE_LIBRARY_OPTIONS.filter((option) => selection[option.key]).length;
}

/** 概况里的一行：`预设库 · 12 条`，`detail` 是括注里的补充 */
export interface BundleSummaryRow {
  key: BundleLibraryKey;
  label: string;
  count: string;
  detail: string;
}

function optionLabel(key: BundleLibraryKey): string {
  return BUNDLE_LIBRARY_OPTIONS.find((option) => option.key === key)?.label ?? key;
}

/** 只列出文件里**真的带**的库（`included` 为真的才算） */
export function summaryRows(summary: BundleSummary): BundleSummaryRow[] {
  const rows: BundleSummaryRow[] = [];
  if (summary.included.presets) {
    rows.push({
      key: 'presets',
      label: optionLabel('presets'),
      count: `${summary.presetCount} 条`,
      detail: summary.presetFolderCount > 0 ? `分组 ${summary.presetFolderCount} 个` : '',
    });
  }
  if (summary.included.artists) {
    rows.push({
      key: 'artists',
      label: optionLabel('artists'),
      count: `${summary.artistCount} 条`,
      detail: '',
    });
  }
  if (summary.included.tags) {
    rows.push({
      key: 'tags',
      label: optionLabel('tags'),
      count: `${summary.tagCount} 条`,
      detail: '',
    });
  }
  if (summary.included.dictionaries) {
    rows.push({
      key: 'dictionaries',
      label: optionLabel('dictionaries'),
      count: `${summary.dictionaryCount} 部`,
      detail:
        summary.dictionaryEntryCount > 0 ? `译词 ${summary.dictionaryEntryCount} 条` : '',
    });
  }
  if (summary.included.snapshots) {
    rows.push({
      key: 'snapshots',
      label: optionLabel('snapshots'),
      count: `${summary.snapshotCount} 条`,
      detail: '',
    });
  }
  return rows;
}

/** 一个库的账目：`新增 5、覆盖 2、重命名 1`；三项都 0 时是「无变化」 */
export function mergeStatsText(stats: BundleMergeStats): string {
  const parts: string[] = [];
  if (stats.added > 0) parts.push(`新增 ${stats.added}`);
  if (stats.overwritten > 0) parts.push(`覆盖 ${stats.overwritten}`);
  if (stats.renamed > 0) parts.push(`重命名 ${stats.renamed}`);
  return parts.length > 0 ? parts.join('、') : '无变化';
}

export interface BundleReportRow {
  key: string;
  label: string;
  text: string;
}

const REPORT_LABELS: Array<{ key: keyof BundleImportReport; label: string }> = [
  { key: 'presets', label: '预设库' },
  { key: 'folders', label: '分组' },
  { key: 'artists', label: '画师库' },
  { key: 'tags', label: 'Tag 库' },
  { key: 'dictionaries', label: '词典库' },
  { key: 'snapshots', label: '快照库' },
];

/** 导入完成后的账目行：只保留真有变动的库，避免六行「无变化」占屏 */
export function importReportRows(report: BundleImportReport): BundleReportRow[] {
  return REPORT_LABELS.filter(({ key }) => {
    const stats = report[key];
    return stats.added > 0 || stats.overwritten > 0 || stats.renamed > 0;
  }).map(({ key, label }) => ({
    key,
    label,
    text: mergeStatsText(report[key]),
  }));
}

/** 中文单位（界面零英文：不写 KB / MB） */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 千字节';
  const mega = bytes / (1024 * 1024);
  if (mega >= 1) return `${mega.toFixed(1)} 兆字节`;
  return `${Math.max(1, Math.round(bytes / 1024))} 千字节`;
}

/** 导出成功的提示：只写「各类多少条 + 体积」，路径由用户自己选过，不再重复 */
export function exportReportText(report: BundleExportReport): string {
  const parts: string[] = [];
  if (report.presets > 0) parts.push(`预设 ${report.presets} 条`);
  if (report.artists > 0) parts.push(`画师 ${report.artists} 条`);
  if (report.tags > 0) parts.push(`Tag ${report.tags} 条`);
  if (report.dictionaries > 0) parts.push(`词典 ${report.dictionaries} 部`);
  if (report.snapshots > 0) parts.push(`快照 ${report.snapshots} 条`);
  const head = parts.length > 0 ? parts.join('、') : '没有内容';
  return `${head}（${formatFileSize(report.bytes)}）`;
}
