import type { CSSProperties } from 'react';
import type { ColorId } from '../../constants/colors';
import { resolveColorGradient, resolveColorHex } from '../../utils/color';

interface ColorSwatchProps {
  colorId: ColorId;
  /** 是否处于选中态（选中时内部颜色块会缩小、外框放大） */
  active: boolean;
  /** 无障碍名，例如「按颜色筛选：红」 */
  ariaLabel: string;
  /** 悬停提示；不传就用 ariaLabel */
  title?: string;
  /** 色块上的字符（D62：画师库的 `@`；D67：快照库的 `S`）；不传就是纯色块 */
  glyph?: string;
  onClick: () => void;
}

/**
 * 颜色色块（**唯一出口**）。
 *
 * 界面上有三处画同一个东西：预设筛选条、预设编辑弹窗的「归属颜色」、以及（同一套渐变变量的）
 * 预设色点与胶囊小圆点。前两处必须是**同一个组件** —— 这不是洁癖，是刚踩过的坑：
 *
 * **真 bug**：给色块加「选中时内部缩小、外框放大」时，颜色从按钮背景移到了内部一层
 * `.pf-swatch__inner`，但只改了筛选条那一处、漏了预设编辑弹窗，
 * 于是弹窗里的色块**变成了完全透明**（边框还在），用户报「进入内容编辑后色块消失了」。
 *
 * 因此这里把结构收成一处：两处调用方都拿不到「忘记加内部层」的机会。
 * 结构约定：按钮本体＝外框（透明背景 + 描边），`.pf-swatch__inner`＝真正的颜色。
 *
 * **D77：不再接受 `tone` 直传色值** —— 画师 / 快照两块也进了颜色注册表，
 * 于是色块（无论哪种）一律从 `resolveColor*` 取色，「同一个颜色在两处取到不同值」从此不可能发生。
 */
export function ColorSwatch({ colorId, active, ariaLabel, title, glyph, onClick }: ColorSwatchProps) {
  const style = {
    // 与预设色点、胶囊小圆点用的是同一套取值（取色统一走 utils/color.ts，见那里的说明）
    '--pf-swatch-color': resolveColorHex(colorId),
    '--pf-swatch-gradient': resolveColorGradient(colorId),
  } as CSSProperties;

  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      aria-label={ariaLabel}
      title={title ?? ariaLabel}
      className={active ? 'pf-swatch pf-swatch--on' : 'pf-swatch'}
      style={style}
      onClick={onClick}
    >
      {/* 内部颜色层单独一层：选中时只缩小它，外框靠按钮自身的描边与光晕放大 */}
      <span className="pf-swatch__inner" aria-hidden="true" />
      {glyph ? (
        <span className="pf-swatch__glyph" aria-hidden="true" data-pf-ui-glyph="true">
          {glyph}
        </span>
      ) : null}
    </button>
  );
}
