import { create } from 'zustand';
import { loadSnapshotsFromDisk } from '../api/snapshots';
import { errorMessage } from '../api/tauri';
import type { Snapshot, SnapshotScope } from '../types/snapshot';
import type { SnapshotModule } from '../types/snapshot';
import { buildSnapshot, updateSnapshotContent, type WorkspaceUndoEntry } from '../utils/snapshot';

export interface SnapshotState {
  snapshots: Snapshot[];
  loaded: boolean;
  loading: boolean;
  loadError: string | null;
  persistedSnapshot: string;
  /** 覆盖前的撤销栈（最多 3 层，只在内存里） */
  undoStack: WorkspaceUndoEntry[];

  loadSnapshots: () => Promise<void>;
  /** **强制重读**（D115）：导入库改写 `snapshots.json` 之后要把内存换成磁盘内容 */
  reloadSnapshots: () => Promise<void>;
  /** 新建快照（保存当前工作区） */
  addSnapshot: (
    name: string,
    scope: SnapshotScope,
    modules: SnapshotModule[],
    copyText?: string,
  ) => Snapshot;
  renameSnapshot: (id: string, name: string) => void;
  setWeight: (id: string, weight: number) => void;
  removeSnapshot: (id: string) => void;
  /** D76：用当前工作区的内容原地覆盖这条快照（身份与权重不变） */
  updateSnapshot: (id: string, modules: SnapshotModule[], copyText: string) => void;
  markPersisted: (snapshot: string) => void;

  pushUndo: (entry: WorkspaceUndoEntry, depth: number) => void;
  popUndo: () => WorkspaceUndoEntry | null;
}

export const useSnapshotStore = create<SnapshotState>((set, get) => ({
  snapshots: [],
  loaded: false,
  loading: false,
  loadError: null,
  persistedSnapshot: '',
  undoStack: [],

  loadSnapshots: async () => {
    if (get().loaded || get().loading) return;
    set({ loading: true });
    try {
      const raw = await loadSnapshotsFromDisk();
      const snapshots = raw.map((item) => ({
        ...item,
        weight: Number.isFinite(item.weight) ? Math.max(0, Math.floor(item.weight)) : 100,
        modules: Array.isArray(item.modules) ? item.modules : [],
      }));
      set({
        snapshots,
        loaded: true,
        loading: false,
        loadError: null,
        persistedSnapshot: JSON.stringify(snapshots),
      });
    } catch (error) {
      set({
        loaded: true,
        loading: false,
        loadError: `快照读取失败：${errorMessage(error)}`,
      });
    }
  },

  reloadSnapshots: async () => {
    set({ loaded: false, loading: false });
    await get().loadSnapshots();
  },

  addSnapshot: (name, scope, modules, copyText) => {
    const created = buildSnapshot({ name, scope, modules, copyText });
    set((state) => ({ snapshots: [...state.snapshots, created] }));
    return created;
  },

  renameSnapshot: (id, name) => {
    const trimmed = name.trim().slice(0, 40);
    if (!trimmed) return;
    set((state) => ({
      snapshots: state.snapshots.map((snapshot) =>
        snapshot.id === id ? { ...snapshot, name: trimmed, updatedAt: Date.now() } : snapshot,
      ),
    }));
  },

  setWeight: (id, weight) => {
    set((state) => ({
      snapshots: state.snapshots.map((snapshot) =>
        snapshot.id === id
          ? { ...snapshot, weight: Math.max(0, Math.floor(weight)), updatedAt: Date.now() }
          : snapshot,
      ),
    }));
  },

  removeSnapshot: (id) => {
    set((state) => ({ snapshots: state.snapshots.filter((snapshot) => snapshot.id !== id) }));
  },

  updateSnapshot: (id, modules, copyText) => {
    set((state) => ({
      snapshots: state.snapshots.map((snapshot) =>
        snapshot.id === id ? updateSnapshotContent(snapshot, modules, copyText) : snapshot,
      ),
    }));
  },

  markPersisted: (snapshot) => set({ persistedSnapshot: snapshot }),

  pushUndo: (entry, depth) => {
    set((state) => ({ undoStack: [entry, ...state.undoStack].slice(0, Math.max(1, depth)) }));
  },

  popUndo: () => {
    const [first, ...rest] = get().undoStack;
    if (!first) return null;
    set({ undoStack: rest });
    return first;
  },
}));
