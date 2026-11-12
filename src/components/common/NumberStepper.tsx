import { PRESET_WEIGHT_STEP } from '../../constants/limits';

interface NumberStepperProps {
  value: number;
  min?: number;
  step?: number;
  /** 无障碍标签，界面不显示 */
  label: string;
  onChange: (value: number) => void;
}

/** 权重步进器：下限由 min 控制，无上限（需求 5） */
export function NumberStepper({
  value,
  min = 0,
  step = PRESET_WEIGHT_STEP,
  label,
  onChange,
}: NumberStepperProps) {
  return (
    <span className="pf-stepper">
      <button
        type="button"
        className="pf-stepper__btn"
        aria-label={`${label}：减少`}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - step))}
      >
        −
      </button>
      <input
        className="pf-stepper__value"
        type="number"
        inputMode="numeric"
        min={min}
        /*
         * D64：输入框的 step 固定为 1，**不跟随加减步长**。
         * 原来写的是 step={10}，浏览器把"不是 10 的倍数"当成非法值，
         * 表单提交时会弹「最接近的有效值为 18900」这类原生报错 —— 画师导入的权重是
         * post_count 原值（如 18812），一提交就炸。加减按钮仍然是 ±10，不受影响。
         */
        step={1}
        value={value}
        aria-label={label}
        onChange={(event) => {
          const raw = event.currentTarget.value;
          if (raw === '') {
            onChange(min);
            return;
          }
          const next = Number(raw);
          if (Number.isFinite(next)) onChange(next);
        }}
      />
      <button
        type="button"
        className="pf-stepper__btn"
        aria-label={`${label}：增加`}
        onClick={() => onChange(value + step)}
      >
        +
      </button>
    </span>
  );
}
