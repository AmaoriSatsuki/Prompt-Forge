import type {
  BundleDuplicatePolicy,
  BundleExportReport,
  BundleImportReport,
  BundleIncluded,
  BundleSummary,
} from '../types/bundle';
import { callCommand } from './tauri';

/**
 * 全库导入导出的唯一 invoke 出口（D115）。
 *
 * 三个命令都只收 / 回**小对象**：条目内容由 Rust 直接读写磁盘文件，
 * 前端拿不到十万级数组（D116）。
 */

/** 导出所选库；`path` 来自原生「另存为」对话框 */
export function exportLibraryBundle(
  path: string,
  included: BundleIncluded,
): Promise<BundleExportReport> {
  return callCommand<BundleExportReport>('export_library_bundle', { path, included });
}

/** 只读地看一个包里有哪些库、各多少条 */
export function inspectLibraryBundle(path: string): Promise<BundleSummary> {
  return callCommand<BundleSummary>('inspect_library_bundle', { path });
}

/** 叠加导入：同名条目按 `policy` 处理（默认 `rename`，补 `·N`） */
export function importLibraryBundle(
  path: string,
  policy: BundleDuplicatePolicy,
): Promise<BundleImportReport> {
  return callCommand<BundleImportReport>('import_library_bundle', { path, policy });
}
