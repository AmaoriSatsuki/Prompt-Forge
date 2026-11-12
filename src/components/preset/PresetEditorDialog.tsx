import { useState } from 'react';
import type { FormEvent } from 'react';
import {
  DEFAULT_PRESET_COLOR_ID,
  PRESET_COLORS,
  type ColorId,
} from '../../constants/colors';
import { PRESET_WEIGHT_DEFAULT } from '../../constants/limits';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import type { Preset, PresetDraft } from '../../types/preset';
import { clampWeight } from '../../utils/clamp';
import { isPresetLabelTaken } from '../../utils/presetLabel';
import { Button } from '../common/Button';
import { ColorSwatch } from '../common/ColorSwatch';
import { NumberStepper } from '../common/NumberStepper';

interface PresetEditorDialogProps {
  mode: 'create' | 'edit';
  /** 编辑时传入被编辑的预设 */
  preset?: Preset;
  /**
   * 新建时的预填值。
   * 命名默认「预设标签-N」；从模块枢拖入时还会把该模块的译文预填到英文内容里。
   */
  defaults?: Partial<PresetDraft>;
  /** 用于重名校验 */
  existingPresets: Preset[];
  /** 覆盖标题，例如「保存为预设」 */
  title?: string;
  /**
   * 颜色锁定（D62）：画师库的条目只有一个固定颜色，
   * 传了这个值就**不显示颜色选择器**，保存时一律用它的颜色。
   */
  lockedColorId?: ColorId;
  onSubmit: (draft: PresetDraft) => void;
  onCancel: () => void;
}

/**
 * 预设编辑器。
 *
 * 这是界面上唯一会显示英文内容的地方 —— 它属于「预设库」，
 * 而需求规定英文内容只藏在预设库与拼接结果中。
 */
export function PresetEditorDialog({
  mode,
  preset,
  defaults,
  existingPresets,
  title,
  lockedColorId,
  onSubmit,
  onCancel,
}: PresetEditorDialogProps) {
  const [label, setLabel] = useState(preset?.label ?? defaults?.label ?? '');
  const [english, setEnglish] = useState(preset?.english ?? defaults?.english ?? '');
  const [weight, setWeight] = useState(
    preset?.weight ?? defaults?.weight ?? PRESET_WEIGHT_DEFAULT,
  );
  const [colorId, setColorId] = useState(
    lockedColorId ?? preset?.colorId ?? defaults?.colorId ?? DEFAULT_PRESET_COLOR_ID,
  );
  const [error, setError] = useState('');

  useEscapeKey(onCancel);

  const heading = title ?? (mode === 'create' ? '新增预设' : '编辑预设');

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedLabel = label.trim();
    if (!trimmedLabel) {
      setError('请填写中文命名');
      return;
    }
    if (isPresetLabelTaken(existingPresets, trimmedLabel, preset?.id)) {
      setError('这个中文命名已经被占用了');
      return;
    }
    const trimmedEnglish = english.trim();
    if (!trimmedEnglish) {
      setError('请填写英文内容，否则胶囊里没有可用的术语');
      return;
    }

    onSubmit({
      label: trimmedLabel,
      english: trimmedEnglish,
      weight: clampWeight(weight),
      colorId,
    });
  }

  return (
    <div className="pf-modal" role="dialog" aria-modal="true" aria-label={heading}>
      <div className="pf-modal__backdrop" onClick={onCancel} />
      <form className="pf-modal__panel" onSubmit={handleSubmit}>
        <h3 className="pf-modal__title">{heading}</h3>

        <label className="pf-field">
          <span className="pf-field__label">中文命名（界面上只显示它）</span>
          <input
            className="pf-field__input"
            value={label}
            autoFocus
            maxLength={40}
            onChange={(event) => {
              setLabel(event.currentTarget.value);
              setError('');
            }}
          />
        </label>

        <label className="pf-field">
          <span className="pf-field__label">英文内容（只在翻译时使用，平时不显示）</span>
          <textarea
            className="pf-field__textarea pf-scroll-thin"
            value={english}
            rows={3}
            spellCheck={false}
            onChange={(event) => {
              setEnglish(event.currentTarget.value);
              setError('');
            }}
          />
        </label>

        <div className="pf-field">
          <span className="pf-field__label">权重（默认 {PRESET_WEIGHT_DEFAULT}，最低 0，无上限）</span>
          <NumberStepper label="权重" value={weight} onChange={setWeight} />
        </div>

        {/* 画师库的条目颜色固定（D62），这里不显示选择器 —— 免得用户以为是可改的 */}
        {lockedColorId ? null : (
          <div className="pf-field">
            <span className="pf-field__label">归属颜色</span>
            <div className="pf-color-picker" role="radiogroup" aria-label="归属颜色">
              {PRESET_COLORS.map((color) => (
                // 与筛选条共用同一个色块组件 —— 之前这里漏了内部颜色层，导致色块整个透明（真 bug）
                <ColorSwatch
                  key={color.id}
                  colorId={color.id}
                  active={colorId === color.id}
                  ariaLabel={`归属颜色：${color.label}`}
                  onClick={() => setColorId(color.id)}
                />
              ))}
            </div>
          </div>
        )}

        {error ? <p className="pf-field__error">{error}</p> : null}

        <footer className="pf-modal__footer">
          <Button onClick={onCancel}>取消</Button>
          <Button variant="primary" type="submit">
            保存
          </Button>
        </footer>
      </form>
    </div>
  );
}
