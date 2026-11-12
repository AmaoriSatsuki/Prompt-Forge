import { useUiStore } from '../../store/useUiStore';

/**
 * 预设库 / 画师库 / Tag 库共用的搜索框：输入即过滤，实时生效
 * （按命名搜索，英文内容作为附加匹配项）。
 *
 * D86：Tag 库与画师库一样用**同一个关键词**（`presetSearchKeyword`）——
 * 上一轮（D85）曾给词典库单开过一个字段，改成「库」之后没有理由再分叉：
 * 三个库的过滤口径完全相同，分叉只会让「在哪个库搜的」变成一个要记的事。
 */
export function PresetSearchBox() {
  const keyword = useUiStore((state) => state.presetSearchKeyword);
  const setKeyword = useUiStore((state) => state.setPresetSearchKeyword);

  return (
    <div className="pf-search">
      <input
        className="pf-search__input"
        type="search"
        value={keyword}
        placeholder="搜索预设名称"
        aria-label="搜索预设名称"
        spellCheck={false}
        onChange={(event) => setKeyword(event.currentTarget.value)}
      />
      {keyword ? (
        <button
          type="button"
          className="pf-search__clear"
          aria-label="清空搜索"
          title="清空搜索"
          onClick={() => setKeyword('')}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
