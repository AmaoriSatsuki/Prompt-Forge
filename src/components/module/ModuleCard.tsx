import { memo, useEffect, useLayoutEffect, useRef } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import {
  MODULE_MAX_HEIGHT,
  MODULE_MIN_HEIGHT,
} from '../../constants/limits';
import { resolveColorGradient, resolveColorHex } from '../../utils/color';
import { clamp } from '../../utils/clamp';
import { useModuleStore } from '../../store/useModuleStore';
import { useUiStore } from '../../store/useUiStore';
import type { Module } from '../../types/module';
import { isDangerHover, isInsertHover, isSnapshotModuleDanger } from '../../utils/dnd';
import { orderCapsulesBySource } from '../../utils/placeholder';
import { scrollRowIntoView } from '../../utils/scrollIntoView';
import { CapsuleLabelRow } from './CapsuleLabelRow';
import { ModuleHub } from './ModuleHub';

interface ModuleCardProps {
  module: Module;
}

/**
 * 这一排**需要**写到 Store 的新高度；`null` 表示不需要改动（短路，避免白重渲染）。
 *
 * 与 `useModuleStore.setOutputHeight` 的口径**必须一致**（四舍五入 + 夹在
 * [MODULE_MIN_HEIGHT, MODULE_MAX_HEIGHT]）——否则会出现「算了半天、写进去还是同一个值」
 * 或者「每次都以为变了」的来回抖动。抽成纯函数也便于在 Node 里直接断言。
 */
export function requiredOutputHeight(
  currentHeight: number,
  neededHeight: number,
): number | null {
  const rounded = clamp(Math.round(neededHeight), MODULE_MIN_HEIGHT, MODULE_MAX_HEIGHT);
  // 需求 5：只增不减 —— 需要的比当前矮就什么都不做（用户拖过的高度是下限）
  if (rounded <= currentHeight) return null;
  return rounded;
}

/**
 * 未翻译时的占位文案。
 *
 * 用户 2026 轮：**去掉「尚未翻译」**，要一个干净的模块 ——
 * 空排本来就没有内容可看，再写一句「尚未翻译」只是噪声。
 * 但「翻译中……」保留：那是**进行中的进度提示**，不是空态文案，
 * 去掉了用户就不知道请求还在跑（尤其是百度 1 QPS 那几秒）。
 */
function placeholderText(module: Module): string {
  if (module.status === 'translating') return '翻译中……';
  return '';
}

/**
 * 一个模块 = 输出列表里的一排。
 *
 * 只读显示英文译文 + 胶囊中文名（中文源内容在下方输入框里），并在这一排上承载：
 * - 左侧颜色条 + 序号：一眼分清是哪一排（需求 5、需求 8）
 * - 右侧居中的模块枢：双击复制英文；拖到预设库存预设；拖回自身清空（需求 9）
 * - 底部细拖拽条：单独调整这一排的高度，下限 56px
 * - 拖拽落点：预设拖到它上面时整排高亮，**颜色取该预设的归属色**（需求 3、6）
 */
function ModuleCardView({ module }: ModuleCardProps) {
  const selectedModuleId = useModuleStore((state) => state.selectedModuleId);
  const selectModule = useModuleStore((state) => state.selectModule);
  const removeCapsule = useModuleStore((state) => state.removeCapsule);
  const setOutputHeight = useModuleStore((state) => state.setOutputHeight);
  const drag = useUiStore((state) => state.drag);

  const rowRef = useRef<HTMLElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const selected = selectedModuleId === module.id;
  const dropHover = drag ? isInsertHover(drag.source, drag.hover, module.id) : false;
  const dangerHover = drag ? isDangerHover(drag.source, drag.hover, module.id) : false;
  // D67：单模块快照拖到这一排 —— 同样是危险覆盖（会连胶囊一起替换）
  const snapshotDanger = drag ? isSnapshotModuleDanger(drag.source, drag.hover, module.id) : false;
  const dangerLike = dangerHover || snapshotDanger;

  /**
   * 需求 3：被选中的这一排要自动滚进可视区域 ——
   * 快捷键切换（Ctrl/Alt + ↑↓）与点选都靠它；已经在区域内时内部直接返回，不会抖动。
   */
  useEffect(() => {
    if (selected) scrollRowIntoView(rowRef.current);
  }, [selected]);

  /**
   * 需求 5：译文变长时自动把这一排撑到内容所需高度，**只增不减**。
   * 用户手动拖过的高度就是下限——这里只会往上调，永远不会缩回去。
   * jsdom 里所有尺寸都是 0，因此这条逻辑不会在断言里产生假增长。
   *
   * **性能（用户 2026 轮排查卡顿）**：这段读 `offsetHeight` / `scrollHeight` 会强制重排，
   * 而它挂在模块状态变化上（打字会带动 status/译文变化），于是每敲一下都可能让**六排各量一次**。
   * 加一道**纯函数短路**：先把「这一排需要多高」算出来，只有确实**超过当前高度**时才写 Store。
   * 好处是「因为内容没变而白量一次」不会触发状态更新，断开「测量 → 重渲染 → 再测量」的循环；
   * 同时短路**只看高度、不看内容**，所以「只增不减」的语义一个字都没变。
   */
  useLayoutEffect(() => {
    const row = rowRef.current;
    const body = bodyRef.current;
    if (!row || !body) return;
    const chrome = Math.max(0, row.offsetHeight - body.clientHeight);
    const needed = body.scrollHeight + chrome;
    const next = requiredOutputHeight(module.outputHeight, needed);
    if (next === null) return;
    setOutputHeight(module.id, next);
  }, [
    module.id,
    module.outputHeight,
    module.translation,
    module.status,
    module.error,
    module.capsules,
    setOutputHeight,
  ]);

  const style = {
    '--pf-module-color': resolveColorHex(module.colorId),
    '--pf-module-gradient': resolveColorGradient(module.colorId),
    // 拖预设悬停时的高亮色 = 被拖那条预设的归属色（需求 3）
    // D67：快照拖拽没有归属色（危险态覆盖），这里给个兜底
    '--pf-drop-color': resolveColorHex(
      drag && drag.source.kind !== 'snapshot' ? drag.source.colorId : module.colorId,
    ),
    height: `${module.outputHeight}px`,
  } as CSSProperties;

  /** 底部细条：上下拖动改这一排的高度 */
  function handleResizePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const element = event.currentTarget;
    const row = rowRef.current;
    if (!row) return;

    event.preventDefault();
    event.stopPropagation();
    try {
      element.setPointerCapture?.(event.pointerId);
    } catch {
      // 捕获失败也不影响 window 监听
    }

    const startY = event.clientY;
    const startHeight = row.getBoundingClientRect().height || module.outputHeight;
    document.body.style.cursor = 'ns-resize';

    const handleMove = (moveEvent: PointerEvent) => {
      setOutputHeight(module.id, startHeight + (moveEvent.clientY - startY));
    };
    const handleUp = () => {
      document.body.style.cursor = '';
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
  }

  return (
    <article
      ref={rowRef}
      className={[
        'pf-module',
        selected ? 'pf-module--selected' : '',
        dropHover ? 'pf-module--drop' : '',
        dangerLike ? 'pf-module--danger' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={style}
      data-pf-module-id={module.id}
      aria-label={`模块 ${module.order}`}
      onPointerDown={() => selectModule(module.id)}
    >
      <span className="pf-module__color-bar" aria-hidden="true" />
      <span className="pf-module__index">{module.order}</span>

      <div ref={bodyRef} className="pf-module__body pf-scroll-thin">
        <CapsuleLabelRow
          /* D64 / D79：按源内容顺序显示（拖入是排在已有胶囊之后，数组也是按加入先后追加的；
             这里保留排序是为了兼容旧草稿与手工改过的源内容） */
          capsules={orderCapsulesBySource(module.sourceText, module.capsules)}
          onRemove={(capsuleId) => removeCapsule(module.id, capsuleId)}
        />

        {module.status === 'error' && module.error ? (
          <span className="pf-module__error">{module.error.message}</span>
        ) : module.translation ? (
          // 译文本身就是英文，是需求要求出现的英文内容
          <span className="pf-module__text" data-pf-external="true">
            {module.translation}
          </span>
        ) : placeholderText(module) ? (
          // 只有「翻译中……」会走到这里；未翻译时整排保持干净（不渲染任何占位）
          <span className="pf-module__placeholder">{placeholderText(module)}</span>
        ) : null}
      </div>

      <ModuleHub module={module} />

      {dropHover ? (
        <div className="pf-module__drop-hint" aria-hidden="true">
          <span className="pf-half__hint">松手插入到胶囊末尾</span>
        </div>
      ) : null}

      {dangerLike ? (
        <div className="pf-module__danger-hint" aria-hidden="true">
          <span className="pf-half__hint">
            {snapshotDanger ? '松手覆盖此模块' : '松手清空文字（胶囊保留）'}
          </span>
        </div>
      ) : null}

      <div
        className="pf-module__resize"
        role="separator"
        aria-orientation="horizontal"
        aria-label={`调整模块 ${module.order} 的高度`}
        title="拖动调整这一排的高度（最低 56 像素）"
        onPointerDown={handleResizePointerDown}
      />
    </article>
  );
}

// 用 memo 包一层：打字时模块数组会整体换引用，但只有正在编辑的那一排的 module 变了，
// 其余几排 props 不变会被跳过。
export const ModuleCard = memo(ModuleCardView);
