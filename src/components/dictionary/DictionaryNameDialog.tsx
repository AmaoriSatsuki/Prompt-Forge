import { useState } from 'react';
import { ARTIST_MIN_POST_COUNT } from '../../constants/limits';
import { Button } from '../common/Button';

interface DictionaryNameDialogProps {
  /** 默认名：原文件名去后缀 */
  defaultName: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  /** D65：名字 + 画师热度阈值一起交回去 */
  onConfirm: (name: string, minPostCount: number) => void;
}

/**
 * 导入前的「命名 + 画师热度阈值」弹窗（纯展示）。
 *
 * 用户 2026 轮要求：选完文件先命名，再进入解析与字段映射；
 * 名字用于列表辨识，不参与匹配、也不改磁盘文件名（文件名仍基于原文件）。
 *
 * **D65**：这里再加一个可改的「画师热度阈值」（默认 100）——
 * 带 `category`+`post_count` 列的文件里，作品数低于它的画师会被跳过；
 * 没有这两列的文件完全不受影响（照旧只当词典）。
 */
export function DictionaryNameDialog({
  defaultName,
  busy,
  error,
  onCancel,
  onConfirm,
}: DictionaryNameDialogProps) {
  const [name, setName] = useState(defaultName);
  const [minPostCount, setMinPostCount] = useState(ARTIST_MIN_POST_COUNT);
  const trimmed = name.trim();
  const threshold = Number.isFinite(minPostCount) ? Math.max(0, Math.floor(minPostCount)) : ARTIST_MIN_POST_COUNT;

  return (
    <div className="pf-modal pf-dict__naming" role="dialog" aria-modal="true" aria-label="给词典命名">
      <div className="pf-modal__backdrop" onClick={onCancel} />
      <div className="pf-modal__panel pf-modal__panel--narrow">
        <h3 className="pf-modal__title">给词典命名</h3>

        <label className="pf-dict__field pf-dict__field--column">
          <span>请为该词典命名（方便后续辨识）：</span>
          <input
            className="pf-dict__name-input"
            type="text"
            value={name}
            maxLength={60}
            // 选完文件立刻可改名：自动聚焦并全选，直接输入就能覆盖默认名
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && trimmed && !busy) onConfirm(trimmed, threshold);
            }}
            aria-label="词典名称"
          />
        </label>

        <label className="pf-dict__field pf-dict__field--column">
          <span>画师热度阈值（作品数低于它的画师不导入）：</span>
          <input
            className="pf-dict__name-input"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={minPostCount}
            onChange={(event) => {
              const raw = event.currentTarget.value;
              setMinPostCount(raw === '' ? 0 : Number(raw));
            }}
            aria-label="画师热度阈值"
          />
          <span className="pf-dict__hint">
            默认 100：带 category 列的文件里，作品数不足 100 的画师会被跳过（不建条目）。
            填 0 表示不过滤；没有该列的文件不受影响。
          </span>
        </label>

        {error ? <p className="pf-dict__error">{error}</p> : null}

        <footer className="pf-modal__footer">
          <Button onClick={onCancel}>取消</Button>
          <Button
            variant="primary"
            disabled={busy || !trimmed}
            onClick={() => onConfirm(trimmed, threshold)}
          >
            继续
          </Button>
        </footer>
      </div>
    </div>
  );
}
