import { useState } from 'react';
import type { CSSProperties } from 'react';
import { resolveColorGradient, resolveColorHex } from '../../utils/color';
import { useCopyAllTranslations } from '../../hooks/useCopyAllTranslations';
import { useModuleStore } from '../../store/useModuleStore';
import { useUiStore } from '../../store/useUiStore';
import { Button } from '../common/Button';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { SourceEditor } from './SourceEditor';

/**
 * 输入框区域：**当前选中模块**的中文源内容编辑器，外加作用于「全部模块」的两个动作。
 *
 * **工具栏整合（用户 2026 轮）之后这里的按钮是**：
 *
 * ```
 * [渐变色块]                        全文清空 | 全文复制
 * ```
 *
 * 顺序（用户 2026 轮）：**清空在左、复制在右** —— 复制是最常用的动作，
 * 放在最右边更顺手（右边缘是鼠标的归位处），破坏性的清空则离手远一点。
 *
 * 色块是**当前正在编辑哪一排**的标记（只给颜色、不给编号与颜色名，与其他位置的色块同一套渐变，
 * 一眼就能对上）。它不属于按钮，因此工具栏整合时被误删过，用户要求补回。
 *
 * 移除的两个按钮（以及去向）：
 * - **清空当前模块**：改由「模块枢拖回自身」完成（无二次确认）；
 * - **翻译**：实时翻译在打字后自动翻，不再需要手动按钮（失败时用错误横幅上的「重试」）。
 */
export function SourceEditorPane() {
  const modules = useModuleStore((state) => state.modules);
  const selectedModuleId = useModuleStore((state) => state.selectedModuleId);
  const clearAllModules = useModuleStore((state) => state.clearAllModules);
  const pushToast = useUiStore((state) => state.pushToast);
  const copyAllTranslations = useCopyAllTranslations();

  const [clearAllPending, setClearAllPending] = useState(false);

  const module = modules.find((item) => item.id === selectedModuleId) ?? modules[0];
  if (!module) return null;

  const swatchStyle = {
    '--pf-module-color': resolveColorHex(module.colorId),
    '--pf-module-gradient': resolveColorGradient(module.colorId),
  } as CSSProperties;

  return (
    <div className="pf-input-pane" aria-label="中文源内容">
      <div className="pf-input-pane__toolbar">
        <span
          className="pf-input-pane__swatch"
          style={swatchStyle}
          role="img"
          aria-label={`当前编辑的是模块 ${module.order}`}
        />
        <span className="pf-input-pane__spacer" />
        <Button
          compact
          title="清空所有模块的内容（模块本身保留）"
          onClick={() => setClearAllPending(true)}
        >
          全文清空
        </Button>
        <Button
          compact
          title="按模块顺序复制所有译文（胶囊换成术语英文）"
          onClick={() => void copyAllTranslations()}
        >
          全文复制
        </Button>
      </div>

      <SourceEditor module={module} />

      {clearAllPending ? (
        <ConfirmDialog
          title="全文清空"
          text="确定要清空所有模块的中文内容、胶囊与译文吗？模块本身会保留，数量不变。此操作不可撤销。"
          confirmLabel="清空"
          onConfirm={() => {
            clearAllModules();
            setClearAllPending(false);
            pushToast('已清空所有模块的内容', 'ok');
          }}
          onCancel={() => setClearAllPending(false)}
        />
      ) : null}
    </div>
  );
}
