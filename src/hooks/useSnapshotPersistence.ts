import { useEffect } from 'react';
import { saveSnapshotsToDisk } from '../api/snapshots';
import { errorMessage } from '../api/tauri';
import { PERSIST_DEBOUNCE_MS } from '../constants/limits';
import { useSnapshotStore } from '../store/useSnapshotStore';
import { useUiStore } from '../store/useUiStore';

/**
 * 快照库落盘（D67）：与预设/画师同一套规则 ——
 * 防抖写、内容一致不写、读取失败不写（避免把磁盘数据覆盖成空）。
 */
export function useSnapshotPersistence() {
  const snapshots = useSnapshotStore((state) => state.snapshots);
  const loaded = useSnapshotStore((state) => state.loaded);
  const loadError = useSnapshotStore((state) => state.loadError);
  const persistedSnapshot = useSnapshotStore((state) => state.persistedSnapshot);
  const markPersisted = useSnapshotStore((state) => state.markPersisted);
  const pushToast = useUiStore((state) => state.pushToast);

  useEffect(() => {
    if (!loaded || loadError) return;
    const snapshot = JSON.stringify(snapshots);
    if (snapshot === persistedSnapshot) return;

    const timer = window.setTimeout(() => {
      saveSnapshotsToDisk(snapshots)
        .then(() => markPersisted(snapshot))
        .catch((error) => pushToast(`快照保存失败：${errorMessage(error)}`, 'error'));
    }, PERSIST_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [snapshots, loaded, loadError, persistedSnapshot, markPersisted, pushToast]);
}
