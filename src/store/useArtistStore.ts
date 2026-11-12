import { loadLibrary } from '../api/presets';
import { ROOT_LIBRARY_FILE } from '../utils/presetFiles';
import { createPresetLibrary } from './presetLibrary';

/**
 * 画师库（D62；D87 起是**多文件**）。
 *
 * - 形状与 `usePresetStore` **完全一致**（同一份工厂），所以列表/编辑/右键/拖拽全部复用；
 * - 落盘位置：数据根目录的 `artists.json`（手工新增 / 历史遗留）
 *   + 每部词典文件夹里的 `artists.json`（导入时派生）；
 * - **按需加载**：只有用户点了 `@` 色块（进入画师库视图）才会读盘，
 *   几万条画师数据不会在启动时被解析，更不会渲染进 DOM。
 */
export const useArtistStore = createPresetLibrary({
  load: () => loadLibrary('artists'),
  label: '画师库',
  rootFile: ROOT_LIBRARY_FILE.artists,
});
