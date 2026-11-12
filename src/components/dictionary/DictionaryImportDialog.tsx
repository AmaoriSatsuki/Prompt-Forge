import { useEffect, useState } from 'react';
import type { DictionaryInspection } from '../../types/dictionary';
import { Button } from '../common/Button';
import { DictionaryPreviewTable } from './DictionaryPreviewTable';

interface DictionaryImportDialogProps {
  inspection: DictionaryInspection;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  /** 确认导入：`table` 只对 SQLite 有意义（CSV / JSON 传 null） */
  onConfirm: (table: string | null, cnIndex: number, enIndex: number) => void;
}

/**
 * 手动字段映射（纯展示）。
 *
 * 什么时候出现：后端白名单**没有同时**识别出中文键与英文键时。
 * 用户在这里选「哪个字段代表中文 / 英文」，下面配 5 行数据预览方便对照。
 * SQLite 有多张表时多一个「哪个表」下拉（用户 2026 轮选择）。
 */
export function DictionaryImportDialog({
  inspection,
  busy,
  error,
  onCancel,
  onConfirm,
}: DictionaryImportDialogProps) {
  const tables = inspection.tables;
  const [tableName, setTableName] = useState(tables[0]?.name ?? '');
  const table = tables.find((item) => item.name === tableName) ?? tables[0];

  const fields = table?.fields ?? [];
  const [cnIndex, setCnIndex] = useState(0);
  const [enIndex, setEnIndex] = useState(fields.length > 1 ? 1 : 0);

  // 换表 / 换文件时把两个下拉重置到「智能识别结果」或前两列
  useEffect(() => {
    const suggestedCn = table?.suggestedCnIndex ?? null;
    const suggestedEn = table?.suggestedEnIndex ?? null;
    const nextCn = suggestedCn !== null && suggestedCn < fields.length ? suggestedCn : 0;
    let nextEn = suggestedEn !== null && suggestedEn < fields.length ? suggestedEn : 1;
    if (nextEn === nextCn) nextEn = nextCn === 0 ? 1 : 0;
    setCnIndex(nextCn);
    setEnIndex(Math.min(nextEn, Math.max(0, fields.length - 1)));
  }, [tableName, table, fields.length]);

  const invalid = cnIndex === enIndex;

  return (
    <div className="pf-modal pf-dict__mapping" role="dialog" aria-modal="true" aria-label="词典字段映射">
      <div className="pf-modal__backdrop" onClick={onCancel} />
      <div className="pf-modal__panel">
        <h3 className="pf-modal__title">词典字段映射</h3>
        <p className="pf-modal__text">无法识别该词典键值，请手动配置。</p>

        {tables.length > 1 ? (
          <label className="pf-dict__field">
            <span>哪个表？</span>
            <select
              className="pf-select"
              data-pf-external="true"
              value={tableName}
              onChange={(event) => setTableName(event.target.value)}
            >
              {tables.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="pf-dict__field">
          <span>哪个字段代表中文？</span>
          {/* 下拉选项是外部字段名，整块标 external 让文案审校跳过 */}
          <select
            className="pf-select"
            data-pf-external="true"
            aria-label="哪个字段代表中文"
            value={cnIndex}
            onChange={(event) => setCnIndex(Number(event.target.value))}
          >
            {fields.map((field, index) => (
              <option key={`${field}-${index}`} value={index}>
                {field}
              </option>
            ))}
          </select>
        </label>

        <label className="pf-dict__field">
          <span>哪个字段代表英文（提示词）？</span>
          <select
            className="pf-select"
            data-pf-external="true"
            aria-label="哪个字段代表英文"
            value={enIndex}
            onChange={(event) => setEnIndex(Number(event.target.value))}
          >
            {fields.map((field, index) => (
              <option key={`${field}-${index}`} value={index}>
                {field}
              </option>
            ))}
          </select>
        </label>

        <DictionaryPreviewTable fields={fields} rows={table?.sampleRows ?? []} />

        {invalid ? <p className="pf-dict__error">中文与英文不能选择同一个字段</p> : null}
        {error ? <p className="pf-dict__error">{error}</p> : null}

        <footer className="pf-modal__footer">
          <Button onClick={onCancel}>取消</Button>
          <Button
            variant="primary"
            disabled={busy || invalid || fields.length === 0}
            onClick={() => onConfirm(tables.length > 1 ? tableName : null, cnIndex, enIndex)}
          >
            导入
          </Button>
        </footer>
      </div>
    </div>
  );
}
