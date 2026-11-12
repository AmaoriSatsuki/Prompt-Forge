import { useEffect, useRef } from 'react';

/**
 * 弹窗统一用它处理 Esc 关闭（D80 起支持**嵌套**）。
 *
 * 为什么不再"每个弹窗各自挂一个 window 监听"：那样嵌套两层时一次 Esc 会把两层一起关掉
 * （真实存在：翻译服务设置面板上叠着删除确认框时，按 Esc 会连面板一起关）。
 *
 * 现在的语义：
 * - 所有已挂载的处理器排成一个栈（后挂载的 = 更内层 = 在栈顶）；
 * - 按下 Esc 时**从栈顶往下**依次询问，某个处理器返回 `true` 表示"我处理了"，立即停止；
 * - 返回 `void` 视为"处理了并停止" —— 因此普通弹窗仍然是"按 Esc 关掉自己"；
 * - 返回 `false` 表示"这一层没有可关的东西，交回外层"（例如词典 Tab 里没有子对话框时，
 *   Esc 应该关掉整个设置弹窗）。
 *
 * 监听只在栈非空时挂一次，空了就摘掉（避免长期持有 window 监听）。
 */

type EscapeHandler = () => boolean | void;

const stack: EscapeHandler[] = [];
let listening = false;

function handleKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const handled = stack[index]();
    if (handled !== false) return;
  }
}

function attach(): void {
  if (listening) return;
  listening = true;
  window.addEventListener('keydown', handleKeyDown);
}

function detachIfEmpty(): void {
  if (!listening || stack.length > 0) return;
  listening = false;
  window.removeEventListener('keydown', handleKeyDown);
}

export function useEscapeKey(onEscape: EscapeHandler): void {
  // 用 ref 存最新回调：onEscape 往往是内联箭头函数，每次渲染都会变
  const latest = useRef(onEscape);
  latest.current = onEscape;

  useEffect(() => {
    const entry: EscapeHandler = () => latest.current();
    stack.push(entry);
    attach();
    return () => {
      const index = stack.lastIndexOf(entry);
      if (index >= 0) stack.splice(index, 1);
      detachIfEmpty();
    };
  }, []);
}

