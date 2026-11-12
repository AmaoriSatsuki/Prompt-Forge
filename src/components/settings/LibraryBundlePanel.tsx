import { useState } from 'react';
import { exportLibraryBundle, importLibraryBundle, inspectLibraryBundle } from '../../api/bundle';
import { pickLibraryBundleFile, pickLibraryBundleSavePath } from '../../api/fileDialog';
import { errorMessage } from '../../api/tauri';
import { BUNDLE_LIBRARY_OPTIONS } from '../../constants/bundle';
import { PERSIST_DEBOUNCE_MS } from '../../constants/limits';
import { reloadAllLibraries, suspendLibraryPersistence } from '../../hooks/libraryStorage';
import { useUiStore } from '../../store/useUiStore';
import type {
  BundleDuplicatePolicy,
  BundleImportReport,
  BundleIncluded,
  BundleSummary,
} from '../../types/bundle';
import {
  allLibrariesSelected,
  exportReportText,
  importReportRows,
  selectedLibraryCount,
  summaryRows,
  toggleLibrary,
} from '../../utils/bundle';
import { Button } from '../common/Button';

/**
 * 「导入导出」Tab（D115）。
 *
 * 三条用户口径：
 * 1. **导出是勾选式的、默认全选**（预设 / 画师 / Tag / 词典 / 快照，组信息包含在预设库里）；
 * 2. **导入只有叠加**：文件内容并进现有库，原有内容不会消失；
 * 3. 唯一可选的是**遇到同名条目**时「覆盖」还是「重命名」（默认重命名，补 `·1`、`·2`）。
 *
 * 实现上最要小心的不是界面，而是**导入后与防抖落盘的赛跑**：
 * 导入会直接改写磁盘，如果某个库还挂着 400ms 前的待写状态，它会把刚导进来的内容写回旧值。
 * 因此导入前先 `haltPersistence()`（把 loaded 复位，Hook 的清理函数顺手清掉计时器），
 * 导入后 `reloadAllLibraries()` 把内存换成磁盘现状。
 */
export function LibraryBundlePanel() {
  const pushToast = useUiStore((state) => state.pushToast);
  const [selection, setSelection] = useState<BundleIncluded>(allLibrariesSelected);
  const [exporting, setExporting] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [bundlePath, setBundlePath] = useState<string | null>(null);
  const [summary, setSummary] = useState<BundleSummary | null>(null);
  const [policy, setPolicy] = useState<BundleDuplicatePolicy>('rename');
  const [report, setReport] = useState<BundleImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedCount = selectedLibraryCount(selection);

  async function handleExport() {
    if (selectedCount === 0 || exporting) return;
    const path = await pickLibraryBundleSavePath();
    if (!path) return;
    setExporting(true);
    setError(null);
    try {
      // 等一拍：让防抖中的落盘先写完，否则「刚改过的条目」可能不在这次导出里
      await new Promise((resolve) => window.setTimeout(resolve, PERSIST_DEBOUNCE_MS));
      const result = await exportLibraryBundle(path, selection);
      pushToast(`已导出：${exportReportText(result)}`, 'ok');
    } catch (cause) {
      setError(`导出失败：${errorMessage(cause)}`);
      pushToast('导出失败', 'error');
    } finally {
      setExporting(false);
    }
  }

  async function handlePickFile() {
    if (inspecting || importing) return;
    const path = await pickLibraryBundleFile();
    if (!path) return;
    setInspecting(true);
    setError(null);
    setSummary(null);
    setBundlePath(null);
    setReport(null);
    try {
      setSummary(await inspectLibraryBundle(path));
      setBundlePath(path);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setInspecting(false);
    }
  }

  async function handleImport() {
    if (!bundlePath || importing) return;
    setImporting(true);
    setError(null);
    setReport(null);
    suspendLibraryPersistence();
    try {
      const result = await importLibraryBundle(bundlePath, policy);
      await reloadAllLibraries();
      setReport(result);
      pushToast('导入完成', 'ok');
    } catch (cause) {
      setError(`导入失败：${errorMessage(cause)}`);
      pushToast('导入失败', 'error');
      // 失败也重读：导入是逐文件写的，界面必须停在磁盘现状而不是半截状态
      await reloadAllLibraries();
    } finally {
      setImporting(false);
    }
  }

  const rows = summary ? summaryRows(summary) : [];
  const reportRows = report ? importReportRows(report) : [];

  return (
    <div className="pf-push" data-pf-bundle="true">
      <div className="pf-push__row">
        <div className="pf-push__label">
          <span className="pf-push__title">导出所选库</span>
          <span className="pf-push__desc">勾选要带走的库，导出成一个 JSON 文件。</span>
        </div>
        <span className="pf-push__desc">已选 {selectedCount} 个库</span>
      </div>

      {BUNDLE_LIBRARY_OPTIONS.map((option) => (
        <label className="pf-bundle__check-row" key={option.key}>
          <input
            type="checkbox"
            className="pf-bundle__check"
            checked={selection[option.key]}
            onChange={() => setSelection((state) => toggleLibrary(state, option.key))}
          />
          <span className="pf-bundle__check-text">
            <span className="pf-push__title">{option.label}</span>
            <span className="pf-push__desc">{option.hint}</span>
          </span>
        </label>
      ))}

      <div className="pf-bundle__actions">
        <Button
          variant="primary"
          onClick={() => void handleExport()}
          disabled={exporting || selectedCount === 0}
        >
          {exporting ? '导出中…' : '选择位置并导出'}
        </Button>
      </div>

      <div className="pf-push__hint">
        <span className="pf-push__hint-title">说明：</span>
        导出的文件是明文 JSON，可以自己打开检查。组信息跟着预设库一起走，不单独占一项；词典与它同文件夹的画师、Tag
        是一个整体，会一起带走。
      </div>

      <div className="pf-push__row">
        <div className="pf-push__label">
          <span className="pf-push__title">导入一个库文件</span>
          <span className="pf-push__desc">先选文件，看清它包含哪些库，再决定同名条目怎么处理。</span>
        </div>
        <Button onClick={() => void handlePickFile()} disabled={inspecting || importing}>
          {inspecting ? '读取中…' : '选择文件…'}
        </Button>
      </div>

      {summary ? (
        <div className="pf-bundle__summary">
          <div className="pf-bundle__summary-title">这个文件包含：</div>
          {rows.map((row) => (
            <div className="pf-bundle__line" key={row.key}>
              <span className="pf-bundle__line-label">{row.label}</span>
              <span className="pf-bundle__line-count">{row.count}</span>
              {row.detail ? <span className="pf-push__desc">{row.detail}</span> : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className="pf-push__row">
        <div className="pf-push__label">
          <span className="pf-push__title">遇到同名条目时</span>
          <span className="pf-push__desc">
            同名指预设名、画师名、Tag 名、快照名、词典名或组名重复。
          </span>
        </div>
        <div className="pf-bundle__choice" role="radiogroup" aria-label="遇到同名条目时">
          <button
            type="button"
            role="radio"
            aria-checked={policy === 'rename'}
            className={
              policy === 'rename' ? 'pf-bundle__option pf-bundle__option--on' : 'pf-bundle__option'
            }
            onClick={() => setPolicy('rename')}
          >
            重命名
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={policy === 'overwrite'}
            className={
              policy === 'overwrite'
                ? 'pf-bundle__option pf-bundle__option--on'
                : 'pf-bundle__option'
            }
            onClick={() => setPolicy('overwrite')}
          >
            覆盖
          </button>
        </div>
      </div>

      <div className="pf-push__hint">
        <span className="pf-push__hint-title">重命名：</span>
        后导入的那条改名成「名·1」，再重复就是「名·2」，原有内容不动；词典与同文件夹的画师、Tag 一起改名。
        <br />
        <span className="pf-push__hint-title">覆盖：</span>
        同名那条以文件内容为准，位置、排序与启停状态仍归原有那条；词典会整部替换，连它文件夹里的画师与 Tag
        一起。
      </div>

      {summary ? (
        <div className="pf-bundle__actions">
          <Button variant="primary" onClick={() => void handleImport()} disabled={importing}>
            {importing ? '导入中…' : '开始导入'}
          </Button>
        </div>
      ) : null}
      {report ? (
        <div className="pf-push__hint" data-pf-bundle-report="true">
          <span className="pf-push__hint-title">导入完成：</span>
          {reportRows.map((row) => (
            <div className="pf-bundle__line" key={row.key}>
              <span className="pf-bundle__line-label">{row.label}</span>
              <span>{row.text}</span>
            </div>
          ))}
          {reportRows.length === 0 ? <span>文件里没有可新增的内容。</span> : null}
        </div>
      ) : null}

      {error ? (
        <p className="pf-push__error" data-pf-bundle-error="true">
          {error}
        </p>
      ) : null}
    </div>
  );
}
