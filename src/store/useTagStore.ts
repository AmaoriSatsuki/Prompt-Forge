import { loadLibrary } from '../api/presets';
import { ROOT_LIBRARY_FILE } from '../utils/presetFiles';
import { createPresetLibrary } from './presetLibrary';

/**
 * Tag 库（`%APPDATA%\com.promptforge.app\tags.json`，D86；D87 起是**多文件**）。
 *
 * 与画师库**完全同构**（同一个 `createPresetLibrary` 工厂、同一份 `Preset` 形状），
 * 因此列表、胶囊样式、搜索、权重右键菜单、拖拽全部复用 —— 差别只有三处：
 * 1. 落盘位置：数据根目录的 `tags.json`（手工新增）+ 每部词典文件夹里的 `tags.json`（导入派生）；
 * 2. 归属色固定 `dictionary`（与筛选条上的 `T` 块、拖进输入框的 Tag 同源）；
 * 3. **删掉一部词典 = 删掉它的文件夹**，这一侧的条目自然一起消失（不需要来源字段）。
 *
 * 和其他库一样**按需加载**：只有点了 `T` 才读文件，几万条 Tag 不拖慢启动。
 */
export const useTagStore = createPresetLibrary({
  load: () => loadLibrary('tags'),
  label: 'Tag 库',
  rootFile: ROOT_LIBRARY_FILE.tags,
});
