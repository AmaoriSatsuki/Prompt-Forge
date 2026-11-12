import type {
  DictionaryEntryGroup,
  DictionaryImportReport,
  DictionaryInspection,
  DictionaryList,
} from '../types/dictionary';
import { callCommand } from './tauri';

/**
 * 本地词典的唯一 invoke 出口（与其他 api/*.ts 同一约定：组件与 Store 里不直接 invoke）。
 */

/** 词典列表：顺带剔除被手动删掉的文件、收录手工放进目录的标准 JSON */
export function listDictionaries(): Promise<DictionaryList> {
  return callCommand<DictionaryList>('list_dictionaries');
}

/** 所有启用词典的条目（启动时读一次，前端建 Map 匹配） */
export function readDictionaryEntries(): Promise<DictionaryEntryGroup[]> {
  return callCommand<DictionaryEntryGroup[]>('read_dictionary_entries');
}

/** 检查一个外部文件：字段、前 5 行样本、白名单识别 */
export function inspectDictionaryFile(path: string): Promise<DictionaryInspection> {
  return callCommand<DictionaryInspection>('inspect_dictionary_file', { path });
}

/** 按字段下标导入并标准化落盘；`displayName` 是导入前用户命名的显示名 */
export function importDictionaryFile(
  path: string,
  displayName: string,
  table: string | null,
  cnIndex: number,
  enIndex: number,
  /** 画师热度阈值（D65）：作品数低于它的画师行会被跳过；0 = 不过滤 */
  minPostCount: number,
): Promise<DictionaryImportReport> {
  return callCommand<DictionaryImportReport>('import_dictionary_file', {
    path,
    displayName,
    table,
    cnIndex,
    enIndex,
    minPostCount,
  });
}

export function setDictionaryEnabled(id: string, enabled: boolean): Promise<void> {
  return callCommand<void>('set_dictionary_enabled', { id, enabled });
}

export function reorderDictionaries(ids: string[]): Promise<void> {
  return callCommand<void>('reorder_dictionaries', { ids });
}

/** 删除词典；`deleteFile` 为真时同时删磁盘文件 */
export function deleteDictionary(id: string, deleteFile = true): Promise<void> {
  return callCommand<void>('delete_dictionary', { id, deleteFile });
}

export function rescanDictionaries(): Promise<DictionaryList> {
  return callCommand<DictionaryList>('rescan_dictionaries');
}

export function openDictionariesFolder(): Promise<void> {
  return callCommand<void>('open_dictionaries_folder');
}
