import { useEscapeKey } from '../../hooks/useEscapeKey';
import { Button } from './Button';

interface ConfirmDialogProps {
  title: string;
  text: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  text,
  confirmLabel = '确认',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEscapeKey(onCancel);

  return (
    <div className="pf-modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="pf-modal__backdrop" onClick={onCancel} />
      <div className="pf-modal__panel pf-modal__panel--narrow">
        <h3 className="pf-modal__title">{title}</h3>
        <p className="pf-modal__text">{text}</p>
        <footer className="pf-modal__footer">
          <Button onClick={onCancel}>取消</Button>
          <Button variant="danger" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </footer>
      </div>
    </div>
  );
}
