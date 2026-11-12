import type { CSSProperties } from 'react';
import { resolveColorGradient, resolveColorHex } from '../../utils/color';
import type { CapsuleView } from '../../types/module';

interface CapsuleLabelRowProps {
  /** 只带中文命名与颜色的视图 —— english 在类型上就取不到，界面不可能泄漏它 */
  capsules: CapsuleView[];
  onRemove: (capsuleId: string) => void;
}

/**
 * 输出模块的胶囊标签：**只显示中文名**，不展开术语英文（需求 1）。
 * 颜色取胶囊自己的归属色（来自预设），与输入框里的药丸、预设库里的色点同一套渐变。
 *
 * 删除交互（需求 2）：没有常驻的 × 号；鼠标悬停时整颗胶囊变成一个大的 X，
 * 单击即从源内容里移除这个胶囊，移开鼠标又恢复成「色点 + 中文名」。
 *
 * 这里**没有右键菜单**：输出框是纯使用区，胶囊的编辑（改名等）一律放在预设库。
 * 而且 X 与「色点 + 名字」叠在同一个网格单元里，悬停时**胶囊长度不变**，
 * 后面那些胶囊不会被推来推去。
 */
export function CapsuleLabelRow({ capsules, onRemove }: CapsuleLabelRowProps) {
  if (capsules.length === 0) return null;

  return (
    <div className="pf-capsules">
      {capsules.map((capsule) => (
        <CapsuleChip key={capsule.id} capsule={capsule} onRemove={onRemove} />
      ))}
    </div>
  );
}

interface CapsuleChipProps {
  capsule: CapsuleView;
  onRemove: (capsuleId: string) => void;
}

function CapsuleChip({ capsule, onRemove }: CapsuleChipProps) {
  const style = {
    '--pf-capsule-color': resolveColorHex(capsule.colorId),
    '--pf-capsule-gradient': resolveColorGradient(capsule.colorId),
  } as CSSProperties;

  return (
    <span className="pf-capsule pf-capsule--label" style={style}>
      <button
        type="button"
        className="pf-capsule__hit"
        title={`单击删除胶囊「${capsule.label}」`}
        aria-label={`删除胶囊 ${capsule.label}`}
        onClick={() => onRemove(capsule.id)}
      >
        {/* 这一层是「色点 + 中文名」，与下面的 X 叠在同一格里 */}
        <span className="pf-capsule__content">
          <span className="pf-capsule__dot" aria-hidden="true" />
          <span className="pf-capsule__name">{capsule.label}</span>
        </span>
        <span className="pf-capsule__cross" aria-hidden="true">
          ×
        </span>
      </button>
    </span>
  );
}
