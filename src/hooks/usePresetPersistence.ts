import { useEffect } from 'react';
import {
  saveLibraryFile,
  savePresetFolders,
  savePresetsToDisk,
  type LibraryKind,
} from '../api/presets';
import { errorMessage } from '../api/tauri';
import { PERSIST_DEBOUNCE_MS } from '../constants/limits';
import { useArtistStore } from '../store/useArtistStore';
import { usePresetFolderStore } from '../store/usePresetFolderStore';
import { usePresetStore } from '../store/usePresetStore';
import { useTagStore } from '../store/useTagStore';
import { useUiStore } from '../store/useUiStore';
import type { Preset } from '../types/preset';
import { groupByFile, snapshotOf } from '../utils/presetFiles';

/**
 * 预设库 / 画师库 / Tag 库落盘（D62 起共用，D87 起**按文件**写）。
 *
 * 之所以做成 Hook 而不是塞进 Store：
 * - Store 保持纯数据与纯逻辑，可以在 Node 里被断言
 * - 只有真正渲染出来的界面才会触发磁盘写入
 *
 * 行为（D87）：把内存里的条目按 `sourceFile` 分组，**只重写内容变了的那些文件**；
 * 内容与上次落盘一致时一个字节都不写（避免启动加载后立刻回写）；
 * **读取失败时不写** —— 否则一次读错误就会把磁盘上的数据覆盖成空数组。
 */
function useLibraryPersist(options: {
  items: Preset[];
  loaded: boolean;
  loadError: string | null;
  persisted: Record<string, string>;
  markPersisted: (file: string, snapshot: string) => void;
  /** 写一个文件；预设库只有一个文件，`file` 恒为 presets.json */
  save: (file: string, items: readonly Preset[]) => Promise<void>;
  label: string;
  rootFile: string;
}) {
  const {
    items,
    loaded,
    loadError,
    persisted,
    markPersisted,
    save,
    label,
    rootFile,
  } = options;
  const pushToast = useUiStore((state) => state.pushToast);

  useEffect(() => {
    if (!loaded || loadError) return;

    // 只挑出「内容与上次落盘不同」的文件（改一条 = 只写那一个文件）
    const groups = groupByFile(items, rootFile);
    const pending: Array<{ file: string; snapshot: string; items: Preset[] }> = [];
    for (const [file, group] of groups) {
      const snapshot = snapshotOf(group);
      if (snapshot === persisted[file]) continue;
      // 写盘前去掉只在内存里用的 sourceFile（`snapshotOf` 也是同一口径）
      const payload = group.map(({ sourceFile: _sourceFile, ...rest }) => rest);
      pending.push({ file, snapshot, items: payload });
    }
    if (pending.length === 0) return;

    const timer = window.setTimeout(() => {
      for (const { file, snapshot, items: payload } of pending) {
        save(file, payload)
          .then(() => markPersisted(file, snapshot))
          .catch((error) => pushToast(`${label}保存失败：${errorMessage(error)}`, 'error'));
      }
    }, PERSIST_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
    // persisted 进依赖：某个文件落盘成功后要重新比对剩下的文件
  }, [items, loaded, loadError, persisted, markPersisted, save, label, rootFile, pushToast]);
}

/** 三个库的写盘函数**定义在模块作用域**：引用稳定，避免每次渲染都重置防抖计时器 */
const savePresetFile = async (_file: string, items: readonly Preset[]): Promise<void> =>
  savePresetsToDisk(items);

const saveArtistFile = (file: string, items: readonly Preset[]): Promise<void> =>
  saveLibraryFile('artists' satisfies LibraryKind, file, items);

const saveTagFile = (file: string, items: readonly Preset[]): Promise<void> =>
  saveLibraryFile('tags' satisfies LibraryKind, file, items);

export function usePresetPersistence() {
  useLibraryPersist({
    items: usePresetStore((state) => state.presets),
    loaded: usePresetStore((state) => state.loaded),
    loadError: usePresetStore((state) => state.loadError),
    persisted: usePresetStore((state) => state.persisted),
    markPersisted: usePresetStore((state) => state.markPersisted),
    save: savePresetFile,
    label: '预设',
    rootFile: 'presets.json',
  });
}

/**
 * 预设分组元数据落盘（D111）。
 *
 * 单独一个文件 `preset-folders.json`：**内容没变就不写**（与库文件同一口径），
 * 读取失败时也不写 —— 否则一次读错误就把勾选与展开状态清空。
 * 注意它只保存「组名 + 可见色 + 展开状态」，成员关系在 `presets.json` 的 `folder` 字段里。
 */
export function usePresetFolderPersistence() {
  const folders = usePresetFolderStore((state) => state.folders);
  const loaded = usePresetFolderStore((state) => state.loaded);
  const loadError = usePresetFolderStore((state) => state.loadError);
  const persisted = usePresetFolderStore((state) => state.persisted);
  const markPersisted = usePresetFolderStore((state) => state.markPersisted);
  const pushToast = useUiStore((state) => state.pushToast);

  useEffect(() => {
    if (!loaded || loadError) return;

    const snapshot = JSON.stringify(folders);
    if (snapshot === persisted) return;

    const timer = window.setTimeout(() => {
      savePresetFolders(folders)
        .then(() => markPersisted(snapshot))
        .catch((error) => pushToast(`分组配置保存失败：${errorMessage(error)}`, 'error'));
    }, PERSIST_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [folders, loaded, loadError, persisted, markPersisted, pushToast]);
}

/** 画师库只在被打开过之后才 loaded，因此没进过 `@` 视图时这里什么都不会写 */
export function useArtistPersistence() {
  useLibraryPersist({
    items: useArtistStore((state) => state.presets),
    loaded: useArtistStore((state) => state.loaded),
    loadError: useArtistStore((state) => state.loadError),
    persisted: useArtistStore((state) => state.persisted),
    markPersisted: useArtistStore((state) => state.markPersisted),
    save: saveArtistFile,
    label: '画师库',
    rootFile: 'artists.json',
  });
}

/**
 * Tag 库（D86 / D87）：与画师库同一套落盘逻辑。
 *
 * 同样只在进过 `T` 视图之后才 loaded —— 没打开过就不会把磁盘上的文件覆盖成空。
 */
export function useTagPersistence() {
  useLibraryPersist({
    items: useTagStore((state) => state.presets),
    loaded: useTagStore((state) => state.loaded),
    loadError: useTagStore((state) => state.loadError),
    persisted: useTagStore((state) => state.persisted),
    markPersisted: useTagStore((state) => state.markPersisted),
    save: saveTagFile,
    label: 'Tag 库',
    rootFile: 'tags.json',
  });
}
