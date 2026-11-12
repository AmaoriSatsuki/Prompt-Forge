import { useEffect, useState } from 'react';
import { useModuleStore } from '../store/useModuleStore';
import { useSnapshotStore } from '../store/useSnapshotStore';
import { useUiStore } from '../store/useUiStore';
import type { Snapshot, SnapshotScope } from '../types/snapshot';
import { copyText } from '../utils/clipboard';
import { composeFullCopyText } from '../utils/moduleText';
import { captureModules } from '../utils/snapshot';

/** 快照右键菜单的落点（坐标来自 pointer 事件） */
export interface SnapshotMenuState {
  id: string;
  x: number;
  y: number;
}

/**
 * 快照库的动作与弹窗状态（原先是 `PresetPanel` 里的五段 state + 六个函数）。
 *
 * 为什么抽出来：快照与预设 / 画师 / Tag 是**两条不同的链**——
 * 快照要抓工作区（`captureModules` + `composeFullCopyText`）、有自己的撤销栈、
 * 自己的五个弹窗。把它们跟「预设增删改」混在同一个组件里，
 * 是这个面板最难读的那一段；也最容易在改预设时误伤快照（例如 D119 的启动竞态）。
 *
 * 面板只负责**渲染**：列表、五个弹窗、右键菜单都读这里给的状态与回调。
 */
export interface SnapshotActions {
  /** 当前库的全部快照（已按权重降序，供列表与菜单现取） */
  snapshots: Snapshot[];
  loaded: boolean;
  loading: boolean;
  loadError: string | null;
  /** 撤销栈还剩几条（「撤销」按钮的 disabled 依据） */
  canUndo: boolean;

  /** 保存快照弹窗 */
  saving: boolean;
  openSave: () => void;
  closeSave: () => void;
  /** D67：按范围抓当前工作区存成快照 */
  create: (name: string, scope: SnapshotScope) => void;

  /** 右键菜单 */
  menu: SnapshotMenuState | null;
  openMenu: (snapshot: Snapshot, x: number, y: number) => void;
  closeMenu: () => void;
  changeWeight: (snapshot: Snapshot, delta: number) => void;
  /** D76：把快照保存时那一次的「全文复制」结果写进剪贴板 */
  copy: (snapshot: Snapshot) => Promise<void>;

  /** 改名 / 删除 / 用当前工作区覆盖 */
  renaming: Snapshot | null;
  openRename: (snapshot: Snapshot) => void;
  closeRename: () => void;
  confirmRename: (name: string) => void;

  deleting: Snapshot | null;
  openDelete: (snapshot: Snapshot) => void;
  closeDelete: () => void;
  confirmDelete: () => void;

  updating: Snapshot | null;
  openUpdate: (snapshot: Snapshot) => void;
  closeUpdate: () => void;
  confirmUpdate: () => void;

  /** D67：撤销上一次快照覆盖 */
  undo: () => void;
}

export function useSnapshotActions(): SnapshotActions {
  const snapshots = useSnapshotStore((state) => state.snapshots);
  const loaded = useSnapshotStore((state) => state.loaded);
  const loading = useSnapshotStore((state) => state.loading);
  const loadError = useSnapshotStore((state) => state.loadError);
  const loadSnapshots = useSnapshotStore((state) => state.loadSnapshots);
  const addSnapshot = useSnapshotStore((state) => state.addSnapshot);
  const undoStack = useSnapshotStore((state) => state.undoStack);
  const popUndo = useSnapshotStore((state) => state.popUndo);
  const renameSnapshot = useSnapshotStore((state) => state.renameSnapshot);
  const setWeight = useSnapshotStore((state) => state.setWeight);
  const removeSnapshot = useSnapshotStore((state) => state.removeSnapshot);
  const updateSnapshot = useSnapshotStore((state) => state.updateSnapshot);

  const modules = useModuleStore((state) => state.modules);
  const selectedModuleId = useModuleStore((state) => state.selectedModuleId);
  const restoreWorkspace = useModuleStore((state) => state.restoreWorkspace);
  const pushToast = useUiStore((state) => state.pushToast);

  const [saving, setSaving] = useState(false);
  const [menu, setMenu] = useState<SnapshotMenuState | null>(null);
  const [renaming, setRenaming] = useState<Snapshot | null>(null);
  const [deleting, setDeleting] = useState<Snapshot | null>(null);
  const [updating, setUpdating] = useState<Snapshot | null>(null);

  // 懒加载：第一次进快照视图才读盘（已读过则 loadSnapshots 自己短路）
  const isSnapshotView = useUiStore((state) => state.libraryView) === 'snapshots';
  useEffect(() => {
    if (isSnapshotView && !loaded && !loading) void loadSnapshots();
  }, [isSnapshotView, loaded, loading, loadSnapshots]);

  // 点菜单外面关掉（与预设菜单同一口径；菜单自己 stopPropagation 掉内部点击）
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu]);

  /**
   * 快照要抓哪些模块：全局 = 全部模块；单模块 = 当前选中那一排。
   * 「创建快照」与「更新快照」（D76）共用同一条口径，避免两条路径存出不同的东西。
   */
  function chosenModules(scope: SnapshotScope) {
    if (scope === 'global') return modules;
    return modules.filter((module) => module.id === selectedModuleId).slice(0, 1);
  }

  return {
    snapshots,
    loaded,
    loading,
    loadError,
    canUndo: undoStack.length > 0,

    saving,
    openSave: () => setSaving(true),
    closeSave: () => setSaving(false),
    create: (name, scope) => {
      const chosen = chosenModules(scope);
      // D71：把「全文复制」的结果一起存进快照，供悬停预览
      addSnapshot(name, scope, captureModules(chosen), composeFullCopyText(chosen));
      setSaving(false);
      pushToast('快照已保存', 'ok');
    },

    menu,
    openMenu: (snapshot, x, y) => setMenu({ id: snapshot.id, x, y }),
    closeMenu: () => setMenu(null),
    changeWeight: (snapshot, delta) => {
      setWeight(snapshot.id, snapshot.weight + delta);
      setMenu(null);
    },
    copy: async (snapshot) => {
      const text = snapshot.copyText.trim();
      if (!text) {
        // 旧版快照没有 copyText（D71 之前的保存路径没写这个字段）
        pushToast('这条快照没有译文可复制，可用「更新」重新保存', 'warn');
        return;
      }
      const ok = await copyText(text);
      pushToast(ok ? '已复制快照译文' : '复制失败，请重试', ok ? 'ok' : 'error');
    },

    renaming,
    openRename: (snapshot) => {
      setRenaming(snapshot);
      setMenu(null);
    },
    closeRename: () => setRenaming(null),
    confirmRename: (name) => {
      if (!renaming) return;
      renameSnapshot(renaming.id, name);
      setRenaming(null);
      pushToast('已重命名', 'ok');
    },

    deleting,
    openDelete: (snapshot) => {
      setDeleting(snapshot);
      setMenu(null);
    },
    closeDelete: () => setDeleting(null),
    confirmDelete: () => {
      if (!deleting) return;
      removeSnapshot(deleting.id);
      setDeleting(null);
    },

    updating,
    openUpdate: (snapshot) => {
      setUpdating(snapshot);
      setMenu(null);
    },
    closeUpdate: () => setUpdating(null),
    confirmUpdate: () => {
      if (!updating) return;
      const chosen = chosenModules(updating.scope);
      updateSnapshot(updating.id, captureModules(chosen), composeFullCopyText(chosen));
      setUpdating(null);
      pushToast('已更新为当前工作区', 'ok');
    },

    undo: () => {
      const entry = popUndo();
      if (!entry) return;
      restoreWorkspace(entry.modules, entry.selectedModuleId);
      pushToast('已撤销覆盖', 'ok');
    },
  };
}
