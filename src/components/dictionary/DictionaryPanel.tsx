import { useEffect, useState } from 'react';
import { errorMessage } from '../../api/tauri';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { useArtistStore } from '../../store/useArtistStore';
import { useDictionaryStore } from '../../store/useDictionaryStore';
import { useTagStore } from '../../store/useTagStore';
import { useUiStore } from '../../store/useUiStore';
import type {
  DictionaryImportReport,
  DictionaryInspection,
  DictionaryItem,
} from '../../types/dictionary';
import { Button } from '../common/Button';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { DictionaryImportDialog } from './DictionaryImportDialog';
import { DictionaryList } from './DictionaryList';
import { DictionaryNameDialog } from './DictionaryNameDialog';

/**
 * 词典管理面板（D80：从独立弹窗迁移到「设置 → 词典管理」Tab）。
 *
 * 内容与之前的 `DictionaryDialog` 完全一致，只是**不再自带弹窗外壳** ——
 * 外壳、Tab 与关闭按钮都由 `AppSettingsDialog` 负责，因此这里的根节点是普通 `<div>`。
 *
 * 导入流程：选文件 → **先命名**（默认原文件名去后缀，含画师热度阈值）→ 后端检查字段与样本 →
 * 白名单同时命中中英就**静默导入**，否则打开映射界面让用户选两个字段。
 * 任何解析失败都只显示中文提示，绝不崩溃主程序。
 *
 * Esc 分层：命名框 / 映射框打开时先关它们（返回 `true`），否则返回 `false`
 * 把 Esc 交回外层（由设置弹窗自己关闭）—— 见 `hooks/useEscapeKey`。
 */

/** 列表/提示里显示的名字：优先用户命名，旧数据回落到文件名词干 */
function shownName(item: DictionaryItem): string {
  return item.displayName?.trim() || item.label || item.file;
}

/** 从路径里取「原文件名去后缀」作为默认词典名 */
function suggestDictionaryName(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  const stem = base.replace(/\.[^.]+$/, '');
  return stem.trim() || base;
}

/** 找一张「中英都识别出来了」的表；SQLite 多表时把表名一并带回 */
function findAutoMapping(
  inspection: DictionaryInspection,
): { table: string | null; cnIndex: number; enIndex: number } | null {
  for (const table of inspection.tables) {
    const cn = table.suggestedCnIndex;
    const en = table.suggestedEnIndex;
    if (cn !== null && en !== null && cn !== en) {
      return {
        table: inspection.tables.length > 1 ? table.name : null,
        cnIndex: cn,
        enIndex: en,
      };
    }
  }
  return null;
}

export function DictionaryPanel() {
  const pushToast = useUiStore((state) => state.pushToast);

  const items = useDictionaryStore((state) => state.items);
  const loading = useDictionaryStore((state) => state.loading);
  const error = useDictionaryStore((state) => state.error);
  const importFromPath = useDictionaryStore((state) => state.importFromPath);
  const inspect = useDictionaryStore((state) => state.inspect);
  const setEnabled = useDictionaryStore((state) => state.setEnabled);
  const reorder = useDictionaryStore((state) => state.reorder);
  const remove = useDictionaryStore((state) => state.remove);
  const rescan = useDictionaryStore((state) => state.rescan);
  const openFolder = useDictionaryStore((state) => state.openFolder);

  const [naming, setNaming] = useState<{ path: string; suggested: string } | null>(null);
  const [pending, setPending] = useState<{
    path: string;
    name: string;
    inspection: DictionaryInspection;
    /** D65：命名框里填的画师热度阈值 */
    minPostCount: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DictionaryItem | null>(null);

  // Esc 逐层退出：命名框 → 映射框 → 不处理（交回外层关掉设置弹窗）
  useEscapeKey(() => {
    if (naming) {
      setNaming(null);
      setLocalError(null);
      return true;
    }
    if (pending) {
      setPending(null);
      setLocalError(null);
      return true;
    }
    return false;
  });

  useEffect(() => {
    setLocalError(null);
  }, []);

  function describeReport(report: DictionaryImportReport): string {
    const parts: string[] = [];
    if (report.item) parts.push(`已导入「${shownName(report.item)}」${report.item.entryCount} 条`);
    // D62：带 category=1 的行会被转成画师条目
    if (report.artistCount > 0) parts.push(`已导入 ${report.artistCount} 位画师`);
    if (report.artistFiltered > 0) {
      parts.push(`过滤 ${report.artistFiltered} 位冷门画师（作品数不足 100）`);
    }
    // D86：同一份「非画师行」还会派生进 Tag 库
    if (report.tagCount > 0) parts.push(`已导入 Tag 库 ${report.tagCount} 条`);
    if (report.skipped > 0) parts.push(`跳过空行 ${report.skipped} 行`);
    if (report.artistSkipped > 0) parts.push(`画师跳过 ${report.artistSkipped} 行`);
    if (report.duplicates > 0) parts.push(`去重 ${report.duplicates} 条`);
    return parts.length > 0 ? parts.join('，') : '没有导入任何条目';
  }

  async function runImport(
    path: string,
    name: string,
    table: string | null,
    cnIndex: number,
    enIndex: number,
    minPostCount: number,
  ): Promise<void> {
    const report = await importFromPath(path, name, table, cnIndex, enIndex, minPostCount);
    pushToast(describeReport(report), 'ok');
    /*
     * D87：画师与 Tag 现在写进**这部词典自己的文件夹**，所以磁盘上多了两个文件。
     * 只有「用户已经打开过那个库」时才需要重读 —— 没打开过的话，下次进库会自然读到新文件，
     * 这里一次盘都不用碰（导入因此更快：不再全量重载几十万条）。
     */
    if (useArtistStore.getState().loaded) {
      void useArtistStore.getState().reloadPresets();
    }
    if (useTagStore.getState().loaded) {
      void useTagStore.getState().reloadPresets();
    }
    setNotice(report.warnings.length > 0 ? report.warnings.join('；') : null);
    setPending(null);
    setLocalError(null);
  }

  async function handleImportClick(): Promise<void> {
    if (busy) return;
    setLocalError(null);
    setNotice(null);
    try {
      // 动态 import：浏览器预览里没有 Tauri，插件不会被加载
      const { pickDictionaryFile } = await import('../../api/fileDialog');
      const path = await pickDictionaryFile();
      if (!path) return;
      // 先命名，再解析（用户 2026 轮：命名前置）
      setNaming({ path, suggested: suggestDictionaryName(path) });
    } catch (error) {
      setLocalError(errorMessage(error));
    }
  }

  async function handleNameConfirm(name: string, minPostCount: number): Promise<void> {
    if (!naming || busy) return;
    const { path } = naming;
    setNaming(null);
    setBusy(true);
    setLocalError(null);
    try {
      const inspection = await inspect(path);
      const auto = findAutoMapping(inspection);
      if (auto) {
        await runImport(path, name, auto.table, auto.cnIndex, auto.enIndex, minPostCount);
      } else {
        setPending({ path, name, inspection, minPostCount });
      }
    } catch (error) {
      setLocalError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleRescan(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setLocalError(null);
    await rescan();
    setBusy(false);
    const current = useDictionaryStore.getState();
    if (current.error) setLocalError(current.error);
    else {
      pushToast(`已重新扫描，共 ${current.items.length} 部词典`, 'ok');
      setNotice(
        current.removed.length > 0 ? `文件已丢失，已从列表移除：${current.removed.join('、')}` : null,
      );
    }
  }

  const shownError = localError ?? error;

  return (
    <div className="pf-dict-panel">
      <p className="pf-dict__hint">支持导入的格式：CSV / JSON / SQLite (.db, .sqlite)</p>

      {shownError ? <p className="pf-preset__error">{shownError}</p> : null}
      {notice ? <p className="pf-dict__notice">{notice}</p> : null}

      <div className="pf-dict__body">
        {items.length > 0 ? (
          <DictionaryList
            items={items}
            disabled={busy}
            onReorder={(ids) => {
              setNotice(null);
              void reorder(ids);
            }}
            onToggle={(item, enabled) => {
              void setEnabled(item.id, enabled);
              pushToast(
                enabled ? `已启用「${shownName(item)}」` : `已禁用「${shownName(item)}」`,
                'ok',
              );
            }}
            onDelete={(item) => setPendingDelete(item)}
          />
        ) : (
          <p className="pf-dict__empty">
            {loading
              ? '正在读取词典……'
              : '还没有导入词典。词典命中时会直接使用词典里的英文，不再请求翻译接口。'}
          </p>
        )}
      </div>

      <p className="pf-dict__hint">
        越靠上优先级越高；同一段中文在多部词典里出现时，用最靠上那一部的英文。
      </p>
      <p className="pf-dict__hint">
        词典改动后，已经翻好的内容不会自动重翻；编辑该排内容后才会用上新词条。
      </p>

      <div className="pf-dict__actions">
        <Button variant="primary" disabled={busy} onClick={() => void handleImportClick()}>
          导入新词典
        </Button>
        <Button disabled={busy} onClick={() => void openFolder()}>
          打开词典文件夹
        </Button>
        <Button disabled={busy} onClick={() => void handleRescan()}>
          重新扫描
        </Button>
      </div>

      {naming ? (
        <DictionaryNameDialog
          defaultName={naming.suggested}
          busy={busy}
          error={localError}
          onCancel={() => {
            setNaming(null);
            setLocalError(null);
          }}
          onConfirm={(name, minPostCount) => void handleNameConfirm(name, minPostCount)}
        />
      ) : null}

      {pending ? (
        <DictionaryImportDialog
          inspection={pending.inspection}
          busy={busy}
          error={localError}
          onCancel={() => {
            setPending(null);
            setLocalError(null);
          }}
          onConfirm={(table, cnIndex, enIndex) => {
            setBusy(true);
            runImport(pending.path, pending.name, table, cnIndex, enIndex, pending.minPostCount)
              .catch((error) => setLocalError(errorMessage(error)))
              .finally(() => setBusy(false));
          }}
        />
      ) : null}

      {pendingDelete ? (
        <ConfirmDialog
          title="删除词典"
          text={`确定要删除「${shownName(pendingDelete)}」吗？磁盘上的词典文件会一起删除，由它导入的 Tag 与画师也会从对应库里消失（已经转成预设的不受影响）。`}
          confirmLabel="删除"
          onConfirm={() => {
            const target = pendingDelete;
            setPendingDelete(null);
            void remove(target.id).then(() => {
              /*
               * D87：词典文件夹被整个删掉了（翻译 / Tag / 画师三份文件都在里面），
               * 因此两个库若已经加载过，必须重读 —— 否则内存里还留着已删除的条目。
               * 没加载过就不用管：下次进库读到的就是删除后的目录。
               */
              if (useArtistStore.getState().loaded) {
                void useArtistStore.getState().reloadPresets();
              }
              if (useTagStore.getState().loaded) {
                void useTagStore.getState().reloadPresets();
              }
              pushToast(`已删除「${shownName(target)}」`, 'ok');
            });
          }}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}
    </div>
  );
}
