import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { DictionaryItem } from '../../types/dictionary';
import { Button } from '../common/Button';

interface DictionaryRowProps {
  item: DictionaryItem;
  index: number;
  disabled: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, index: number) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => void;
  onToggle: (item: DictionaryItem, enabled: boolean) => void;
  onDelete: (item: DictionaryItem) => void;
}

/** 拖拽把手：六个点（内联 SVG，尺寸写在 CSS 里，避免被 flex 压塌，见 §6.11） */
function GripIcon() {
  return (
    <svg viewBox="0 0 10 16" aria-hidden="true">
      {[3, 8, 13].map((cy) =>
        [3, 7].map((cx) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.3" />),
      )}
    </svg>
  );
}

/**
 * 一条词典（纯展示）。
 *
 * 启用开关用 `role="switch"`：读屏会念出「开关，已开启/已关闭」，
 * 而不是一个没有语义的方块。
 */
export function DictionaryRow({
  item,
  index,
  disabled,
  onPointerDown,
  onKeyDown,
  onToggle,
  onDelete,
}: DictionaryRowProps) {
  const displayName = item.displayName?.trim() || item.label || item.file;
  const className = ['pf-dict__row', item.enabled ? '' : 'pf-dict__row--off']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={className} data-dict-row="true" data-dict-id={item.id}>
      <button
        type="button"
        className="pf-dict__handle"
        aria-label={`调整「${displayName}」的优先级（拖动，或按上下方向键）`}
        title="拖动调整优先级，越靠上优先级越高"
        disabled={disabled}
        onPointerDown={(event) => onPointerDown(event, index)}
        onKeyDown={(event) => onKeyDown(event, index)}
      >
        <GripIcon />
      </button>

      <div className="pf-dict__meta">
        {/* 词典名来自用户命名或文件名，属于外部内容：审校跳过 */}
        <span className="pf-dict__label" data-pf-external="true">
          {displayName}
        </span>
        <span className="pf-dict__count">{item.entryCount} 条</span>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={item.enabled}
        aria-label={item.enabled ? `禁用「${displayName}」` : `启用「${displayName}」`}
        title={item.enabled ? '点击禁用这部词典' : '点击启用这部词典'}
        className={item.enabled ? 'pf-dict__switch pf-dict__switch--on' : 'pf-dict__switch'}
        disabled={disabled}
        onClick={() => onToggle(item, !item.enabled)}
      >
        <span className="pf-dict__knob" aria-hidden="true" />
      </button>

      <Button compact variant="danger" disabled={disabled} onClick={() => onDelete(item)}>
        删除
      </Button>
    </div>
  );
}
