import { useArtistStore } from '../store/useArtistStore';
import { useDictionaryStore } from '../store/useDictionaryStore';
import { usePresetFolderStore } from '../store/usePresetFolderStore';
import { usePresetStore } from '../store/usePresetStore';
import { useSnapshotStore } from '../store/useSnapshotStore';
import { useTagStore } from '../store/useTagStore';

/**
 * 库文件被**外部改写**之后的内存同步（D115 导入 / D117 库初始化共用）。
 *
 * 为什么不能直接调 `reloadPresets()`：三个库的落盘 Hook 各挂着 400ms 防抖，
 * 磁盘被改写前如果还有一次待写，它会在改写后把旧内容写回去 —— 刚导进来的数据就没了。
 * 所以顺序固定为：
 *   1. `suspendLibraryPersistence()` 把 loaded 复位（Hook 的清理函数顺手取消计时器）；
 *   2. 调命令改写磁盘；
 *   3. `reloadAllLibraries()` 以磁盘为准把五个库（+ 词典索引）全部重读。
 */

/** 让各库的落盘 Hook 停手（loaded=false 会让 effect 提前返回并清掉待写计时器） */
export function suspendLibraryPersistence(): void {
  usePresetStore.setState({ loaded: false, loading: false });
  useArtistStore.setState({ loaded: false, loading: false });
  useTagStore.setState({ loaded: false, loading: false });
  usePresetFolderStore.setState({ loaded: false, loading: false });
  useSnapshotStore.setState({ loaded: false, loading: false });
}

/** 以磁盘为准重读全部库（导入 / 清空之后调用） */
export async function reloadAllLibraries(): Promise<void> {
  await Promise.all([
    usePresetStore.getState().reloadPresets(),
    useArtistStore.getState().reloadPresets(),
    useTagStore.getState().reloadPresets(),
    usePresetFolderStore.getState().reloadFolders(),
    useSnapshotStore.getState().reloadSnapshots(),
    useDictionaryStore.getState().load(),
  ]);
}
