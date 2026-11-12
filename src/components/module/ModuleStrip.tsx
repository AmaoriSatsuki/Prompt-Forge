import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useModuleStore } from '../../store/useModuleStore';
import { useUiStore } from '../../store/useUiStore';
import { ModuleCard } from './ModuleCard';

/**
 * 输出框：模块竖向排列，每个模块只读显示英文译文 + 胶囊中文名。
 * 中文源内容不在这里，而在下方那个「当前选中模块」的输入框里。
 *
 * **D68：全局快照的落点是一层临时透明判定层**。
 * 直接拿输出框当落点时，模块 DOM 盖在上面 —— 只有拖到模块缝隙里才算命中，
 * 而且模块高度不一，高亮会随着指针在"模块/缝隙"之间来回跳、一直闪。
 * 现在拖全局快照时，按输出框**当前**尺寸（用户可能拖过分隔条）临时盖一层等大的层：
 * 判定稳定、不闪，松手立刻移除。
 */
export function ModuleStrip() {
  const modules = useModuleStore((state) => state.modules);
  const drag = useUiStore((state) => state.drag);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const [dropRect, setDropRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  const globalSnapshotDrag = drag?.source.kind === 'snapshot' && drag.source.scope === 'global';

  useLayoutEffect(() => {
    if (!globalSnapshotDrag) {
      setDropRect(null);
      return;
    }
    const element = paneRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    setDropRect({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
  }, [globalSnapshotDrag]);

  return (
    <>
      <div
        ref={paneRef}
        className="pf-output-pane pf-scroll-thin"
        aria-label="模块输出列表"
        data-pf-output-area="true"
      >
        {modules.map((module) => (
          <ModuleCard key={module.id} module={module} />
        ))}
      </div>

      {dropRect
        ? createPortal(
            <div
              className="pf-output-droplayer"
              data-pf-output-area="true"
              data-pf-snapshot-dropzone="true"
              style={{
                position: 'fixed',
                left: `${dropRect.left}px`,
                top: `${dropRect.top}px`,
                width: `${dropRect.width}px`,
                height: `${dropRect.height}px`,
              }}
            >
              <span className="pf-output-droplayer__hint">松手覆盖所有模块</span>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
