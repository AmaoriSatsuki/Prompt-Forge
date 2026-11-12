import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { applyThemeToDom, loadTheme } from './utils/theme';
import './styles/global.css';

/*
 * D78：默认主题改成亮色之后，`tokens.css` 里 `:root`（深色）与真实默认值不再一致。
 * 若等 React 挂载后的 effect 再写 `data-theme`，首帧会闪一下深色（用户看起来像"启动闪黑"）。
 * 因此在**第一次绘制之前**、模块求值时就把主题写上去：纯同步、无副作用、不重复定义常量。
 */
applyThemeToDom(loadTheme());

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
