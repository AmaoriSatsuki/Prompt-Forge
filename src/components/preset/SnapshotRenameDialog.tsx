import { useState } from 'react';
import { Button } from '../common/Button';

interface SnapshotRenameDialogProps {
  initialName: string;
  onCancel: () => void;
  onConfirm: (name: string) => void;
}

/** 快照重命名（D67）：只需要一个名字输入框。 */
export function SnapshotRenameDialog({ initialName, onCancel, onConfirm }: SnapshotRenameDialogProps) {
  const [name, setName] = useState(initialName);
  const trimmed = name.trim();

  return (
    <div className="pf-modal" role="dialog" aria-modal="true" aria-label="重命名快照">
      <div className="pf-modal__backdrop" onClick={onCancel} />
      <div className="pf-modal__panel pf-modal__panel--narrow">
        <h3 className="pf-modal__title">重命名快照</h3>
        <label className="pf-field">
          <span className="pf-field__label">快照名称</span>
          <input
            className="pf-field__input"
            type="text"
            value={name}
            maxLength={40}
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && trimmed) onConfirm(trimmed);
            }}
            aria-label="快照名称"
          />
        </label>
        <footer className="pf-modal__footer">
          <Button onClick={onCancel}>取消</Button>
          <Button variant="primary" disabled={!trimmed} onClick={() => onConfirm(trimmed)}>
            保存
          </Button>
        </footer>
      </div>
    </div>
  );
}
