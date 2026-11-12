import { PRESETS_FILE, loadPresetsFromDisk } from '../api/presets';
import { createPresetLibrary } from './presetLibrary';

/**
 * 普通预设库（`%APPDATA%\com.promptforge.app\presets.json`）。
 *
 * 实现被抽到 `presetLibrary.ts` 的工厂里，与画师库 / Tag 库共用同一份 CRUD ——
 * 三个库结构一致，只是落盘位置不同（D62 / D86 / D87）：
 * 预设库永远是**一个文件**，画师 / Tag 是**多文件**。
 */
export const usePresetStore = createPresetLibrary({
  load: async () => [{ file: PRESETS_FILE, items: await loadPresetsFromDisk() }],
  label: '预设',
  rootFile: PRESETS_FILE,
});
