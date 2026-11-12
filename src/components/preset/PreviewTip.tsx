import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface PreviewTipProps {
  text: string;
  /** 被悬停条目的下沿（浮层贴在它下方 6px） */
  top: number;
  /** 被悬停条目的左沿与宽度 —— 用来做水平居中 */
  anchorLeft: number;
  anchorWidth: number;
  /**
   * `fill`：宽度 = 条目宽度（快照卡，本身够宽）；
   * `auto`：宽度由内容决定，只受 maxWidth 限制（普通胶囊，避免把英文挤成两三行）。
   */
  mode: 'fill' | 'auto';
  maxWidth: number;
}

/** 浮层与视口边缘至少留出的距离 */
const EDGE = 8;

/**
 * 悬停预览浮层（D74）。
 *
 * - 普通胶囊：宽度由内容撑开（不压缩英文），最大不超过预设面板宽度；
 * - 快照卡：宽度 = 卡片自身宽度（卡片足够宽，不会挤字）；
 * - 两种情况都**水平居中**于被悬停条目，靠近窗口边缘时自动回收到视口内；
 * - 超过 240px 直接截断，底部提示「内容过多请点击编辑查看」（无滚动）。
 */
export function PreviewTip({
  text,
  top,
  anchorLeft,
  anchorWidth,
  mode,
  maxWidth,
}: PreviewTipProps) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [overflow, setOverflow] = useState(false);
  const [shift, setShift] = useState(0);

  // 内容是否超出最大高度
  useEffect(() => {
    const element = bodyRef.current;
    if (!element) return;
    setOverflow(element.scrollHeight > element.clientHeight + 1);
  }, [text, mode]);

  // 换条目时先归零，避免上一条的偏移带过来
  useLayoutEffect(() => {
    setShift(0);
  }, [text, anchorLeft, anchorWidth, mode]);

  // 居中后若越出视口，量一次再夹回来
  useLayoutEffect(() => {
    const element = boxRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    let next = 0;
    if (rect.left < EDGE) next = EDGE - rect.left;
    else if (rect.right > window.innerWidth - EDGE) next = window.innerWidth - EDGE - rect.right;
    if (Math.abs(next - shift) > 0.5) setShift(next);
  }, [shift, text, anchorLeft, anchorWidth, mode, maxWidth]);

  return createPortal(
    <div
      ref={boxRef}
      className="pf-preview"
      style={{
        position: 'fixed',
        // 居中：以条目中心为锚点，再用 shift 夹回视口
        left: anchorLeft + anchorWidth / 2 + shift,
        top,
        transform: 'translateX(-50%)',
        width: mode === 'fill' ? anchorWidth : undefined,
        maxWidth,
      }}
      data-pf-external="true"
    >
      <div ref={bodyRef} className="pf-preview__body">
        {text}
      </div>
      {overflow ? <div className="pf-preview__more">内容过多请点击编辑查看</div> : null}
    </div>,
    document.body,
  );
}
