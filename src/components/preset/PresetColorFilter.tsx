import {
  ARTIST_COLOR_ID,
  DICTIONARY_COLOR_ID,
  PRESET_FILTER_COLORS,
  SNAPSHOT_COLOR_ID,
} from '../../constants/colors';
import { useUiStore } from '../../store/useUiStore';
import { ColorSwatch } from '../common/ColorSwatch';

/**
 * 预设筛选：只按颜色**单选**（用户 2026 轮由多选改为单选）。
 *
 * - **没有「全部」按钮**：一个都不选 = 显示全部；**再点一次当前选中的色块即取消**。
 * - 点另一个颜色时**直接换成它**（不会变成两个都选），因为每次筛选都是跟着
 *   「当前在写哪一排」走的，组合筛选只会让用户多一步取消。
 * - **只有色块，没有文字**：颜色名放在 title 与 aria-label 里（鼠标悬停可见、读屏可读）。
 * - 色块统一走 `ColorSwatch`（唯一出口），与预设编辑弹窗里的「归属颜色」是同一个组件。
 *
 * **D62/D67/D85/D86：色块行 = 9 个筛选色 + 3 个库切换块**（顺序固定）：
 * `红 橙 黄 绿 青 蓝 紫 粉 薄荷` → `T`（Tag 库）→ `@`（画师库）→ `S`（快照库）。
 * 三个库切换块都不是颜色筛选：点它们进对应视图，点任意颜色块则切回预设视图
 * （并照常应用/取消该颜色的筛选）。
 */
export function PresetColorFilter() {
  const selectedColorIds = useUiStore((state) => state.presetFilterColorIds);
  const togglePresetFilterColor = useUiStore((state) => state.togglePresetFilterColor);
  const setPresetFilterColor = useUiStore((state) => state.setPresetFilterColor);
  const libraryView = useUiStore((state) => state.libraryView);
  const setLibraryView = useUiStore((state) => state.setLibraryView);

  return (
    <div className="pf-filter">
      {/* 单选：用 radiogroup 表达，读屏能念出「已选中哪一项」 */}
      <div className="pf-filter__row" role="radiogroup" aria-label="按颜色筛选预设">
        {PRESET_FILTER_COLORS.map((color) => {
          const active = libraryView === 'presets' && selectedColorIds.includes(color.id);
          return (
            <ColorSwatch
              key={color.id}
              colorId={color.id}
              active={active}
              ariaLabel={`按颜色筛选：${color.label}`}
              // 已选中时提示「再点一次显示全部」，把取消路径直接写在悬停提示里
              title={active ? `${color.label}（再点一次显示全部）` : color.label}
              onClick={() => {
                /*
                 * D65：从画师库点颜色 = 「进入该颜色的筛选」，**不能走 toggle**。
                 * 否则上一次残留的同色筛选会被"再点一次取消"的逻辑清掉，
                 * 表现为"点了颜色却回到无筛选的预设库"（用户实测的相邻色块 bug）。
                 */
                setLibraryView('presets');
                if (libraryView === 'presets') {
                  togglePresetFilterColor(color.id);
                } else {
                  setPresetFilterColor(color.id);
                }
              }}
            />
          );
        })}
        {/*
          D85 → D86：Tag 库入口放在**颜色块之后、画师 `@` 之前**（用户书面定的顺序：
          「9 个颜色块 -> 1 个词典块 -> 1 个 @ 画师块 -> 1 个 S 快照块」；
          D86 把「词典库」改名成「Tag 库」，字符也由 `D` 换成 `T`，悬停提示「Tag 库」）。
          它和 `@` / `S` 一样是**库切换**，不是颜色筛选。
        */}
        <ColorSwatch
          colorId={DICTIONARY_COLOR_ID}
          glyph="T"
          active={libraryView === 'tags'}
          ariaLabel="Tag 库"
          title="Tag 库"
          onClick={() => setLibraryView(libraryView === 'tags' ? 'presets' : 'tags')}
        />
        {/*
          D62：画师库入口。
          它不是颜色筛选，而是库切换；点任意颜色块会切回并应用筛选。
        */}
        <ColorSwatch
          colorId={ARTIST_COLOR_ID}
          active={libraryView === 'artists'}
          ariaLabel="画师库"
          /* D89：悬停提示统一成库名（与 `T` 的「Tag 库」一致），不再带「再点一次…」的长说明 */
          title="画师库"
          glyph="@"
          /* D65：再点一次要能切回预设库 —— 之前只进不出 */
          onClick={() => setLibraryView(libraryView === 'artists' ? 'presets' : 'artists')}
        />
        {/* D67：快照库入口；D77 换成注册表里的复杂渐变（色块与拖拽幽灵同源） */}
        <ColorSwatch
          colorId={SNAPSHOT_COLOR_ID}
          glyph="S"
          active={libraryView === 'snapshots'}
          ariaLabel="快照库"
          /* D89：同 `@`，悬停只写库名 */
          title="快照库"
          onClick={() => setLibraryView(libraryView === 'snapshots' ? 'presets' : 'snapshots')}
        />
      </div>
    </div>
  );
}
