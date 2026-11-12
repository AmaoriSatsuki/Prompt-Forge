import { useState } from 'react';
import { MAX_FOLDER_NAME_LENGTH } from '../../utils/presetFolders';
import { Button } from '../common/Button';

interface PresetFolderNameDialogProps {
  /** create = 新建（可能带一条待移入的预设）；rename = 重命名 */
  mode: 'create' | 'rename';
  initialName: string;
  onCancel: () => void;
  onConfirm: (name: string) => void;
}

/**
 * 分组命名框（D111）：新建与重命名共用，只需要一个名字输入框。
 *
 * 为什么是弹窗而不是列表内联输入：面板只有 276px 宽，内联输入会把整行胶囊挤走；
 * 而且「起名」是一次性动作，弹窗的确定性（回车即确认、Esc 取消）比内联更顺手。
 */
export function PresetFolderNameDialog({
  mode,
  initialName,
  onCancel,
  onConfirm,
}: PresetFolderNameDialogProps) {
  const [name, setName] = useState(initialName);
  const trimmed = name.trim();
  const title = mode === 'create' ? '新建分组' : '重命名分组';

  return (
    <div className="pf-modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="pf-modal__backdrop" onClick={onCancel} />
      <div className="pf-modal__panel pf-modal__panel--narrow">
        <h3 className="pf-modal__title">{title}</h3>
        <label className="pf-field">
          <span className="pf-field__label">分组名称</span>
          <input
            className="pf-field__input"
            type="text"
            value={name}
            maxLength={MAX_FOLDER_NAME_LENGTH}
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                onCancel();
                return;
              }
              if (event.key === 'Enter' && trimmed) onConfirm(trimmed);
            }}
            aria-label="分组名称"
          />
        </label>
        <footer className="pf-modal__footer">
          <Button onClick={onCancel}>取消</Button>
          <Button variant="primary" disabled={!trimmed} onClick={() => onConfirm(trimmed)}>
            确定
          </Button>
        </footer>
      </div>
    </div>
  );
}
