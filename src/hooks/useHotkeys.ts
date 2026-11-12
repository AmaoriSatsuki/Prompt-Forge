import { useEffect, useRef } from 'react';

interface HotkeyHandlers {
  /** Ctrl+Enter：重翻当前选中模块（工具栏整合后的手动补救入口） */
  onTranslateSelected: () => void;
  /** Ctrl+Shift+Enter：重试所有翻译失败的排 */
  onTranslateFailed: () => void;
  /** Ctrl+,：打开设置 */
  onOpenSettings: () => void;
  /** Ctrl/Alt + ↑↓：切换选中模块。-1 = 上一个，1 = 下一个 */
  onSelectModule: (delta: -1 | 1) => void;
}

/**
 * 全局快捷键。
 *
 * 处理函数通过 ref 持有，因此调用方可以直接传内联箭头函数而不会反复解绑/绑定监听。
 * 刻意不接管 Esc：Esc 归各弹窗自己处理，全局再拦一次会导致一次按键关两个东西。
 */
export function useHotkeys(handlers: HotkeyHandlers) {
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const withModifier = event.ctrlKey || event.metaKey || event.altKey;

      // Ctrl/Alt + ↑↓：切换当前选中模块。
      // 输入框聚焦时也必须生效，所以这里**不能**按 event.target 过滤。
      // preventDefault 有两个作用：阻止浏览器滚动，以及阻止输入法的候选翻页
      // （候选上下翻页的默认键正是 ↑↓）。
      if (withModifier && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        handlersRef.current.onSelectModule(event.key === 'ArrowUp' ? -1 : 1);
        return;
      }

      if (!event.ctrlKey && !event.metaKey) return;

      if (event.key === 'Enter') {
        event.preventDefault();
        if (event.shiftKey) handlersRef.current.onTranslateFailed();
        else handlersRef.current.onTranslateSelected();
        return;
      }
      if (event.key === ',') {
        event.preventDefault();
        handlersRef.current.onOpenSettings();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
