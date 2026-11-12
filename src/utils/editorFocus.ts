/**
 * 编辑器的聚焦入口登记处。
 *
 * 为什么需要它：切换模块的快捷键（Ctrl/Alt + ↑↓）按下后，焦点必须交回中文输入框，
 * 否则用户连按几次之后就没法直接打字了。而编辑器实例在组件里，
 * 快捷键处理器在 Hook 里 —— 用一个极小的登记表把两者接起来，
 * 比把 DOM 查询散落在业务代码里可靠（页面上只有一个编辑器，但不要靠猜选择器）。
 */

type FocusHandler = () => void;

let focusHandler: FocusHandler | null = null;

/** 编辑器挂载时登记自己的聚焦方式；卸载时传 null 撤销 */
export function registerEditorFocus(handler: FocusHandler | null): void {
  focusHandler = handler;
}

/** 把焦点交回中文输入框（并顺手把光标放到末尾） */
export function focusSourceEditor(): void {
  focusHandler?.();
}
