import { useState } from 'react';
import { Button } from '../common/Button';

interface SnapshotSaveDialogProps {
  /** 当前选中模块的序号，用于「仅此模块」的文案 */
  selectedOrder: number;
  onCancel: () => void;
  onConfirm: (name: string, scope: 'module' | 'global') => void;
}

/**
 * 保存快照（D67）：输入名称 + 选择保存范围。
 *
 * 用户口径：快照要"完全还原"，所以**空模块也照存**，这里不做任何"内容为空"的拦截。
 */
export function SnapshotSaveDialog({ selectedOrder, onCancel, onConfirm }: SnapshotSaveDialogProps) {
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'module' | 'global'>('global');
  const trimmed = name.trim();

  return (
    <div className="pf-modal" role="dialog" aria-modal="true" aria-label="保存快照">
      <div className="pf-modal__backdrop" onClick={onCancel} />
      <div className="pf-modal__panel pf-modal__panel--narrow">
        <h3 className="pf-modal__title">保存为快照</h3>

        <label className="pf-field">
          <span className="pf-field__label">快照名称</span>
          <input
            className="pf-field__input"
            type="text"
            value={name}
            maxLength={40}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && trimmed) onConfirm(trimmed, scope);
            }}
            aria-label="快照名称"
          />
        </label>

        <div className="pf-field">
          <span className="pf-field__label">保存范围</span>
          <div className="pf-filter__row" role="radiogroup" aria-label="保存范围">
            <button
              type="button"
              className={scope === 'global' ? 'pf-chip pf-chip--on' : 'pf-chip'}
              role="radio"
              aria-checked={scope === 'global'}
              onClick={() => setScope('global')}
            >
              保存全部模块
            </button>
            <button
              type="button"
              className={scope === 'module' ? 'pf-chip pf-chip--on' : 'pf-chip'}
              role="radio"
              aria-checked={scope === 'module'}
              onClick={() => setScope('module')}
            >
              仅保存当前模块（第 {selectedOrder} 排）
            </button>
          </div>
        </div>

        <footer className="pf-modal__footer">
          <Button onClick={onCancel}>取消</Button>
          <Button variant="primary" disabled={!trimmed} onClick={() => onConfirm(trimmed, scope)}>
            保存
          </Button>
        </footer>
      </div>
    </div>
  );
}
