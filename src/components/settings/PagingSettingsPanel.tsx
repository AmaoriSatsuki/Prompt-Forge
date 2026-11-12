import {
  LIBRARY_PAGE_SIZE,
  LIBRARY_PAGE_SIZE_MAX,
  LIBRARY_PAGE_SIZE_MIN,
} from '../../constants/limits';
import { useUiStore } from '../../store/useUiStore';
import { NumberStepper } from '../common/NumberStepper';

/**
 * 列表分页阈值（D86）。
 *
 * 用户口径：「在设置中新增分页功能，在这里可以设置分页阈值，默认值为 100，
 * 无论是画师库还是预设库还是快照库都统一采用这个值来设定分页。」
 *
 * 四条实现约定：
 * 1. **一个值管四个库**（预设 / Tag / 画师 / 快照）—— 不给每个库各配一个，
 *    那样只会让用户每次都要来回改；
 * 2. 改动**立刻生效并记在本地存储**（没有「保存」按钮，与推送设置的手感一致）；
 * 3. 越界值在输入时就夹到 20–1000（步进器 ±10），落盘前再夹一次；
 * 4. 改完把当前页码复位到第 1 页 —— 否则「原来 100 条一页停在第 5 页、改成 1000 之后」
 *    会停在一个空页上。
 */
export function PagingSettingsPanel() {
  const pageSize = useUiStore((state) => state.libraryPageSize);
  const setPageSize = useUiStore((state) => state.setLibraryPageSize);

  return (
    <div className="pf-paging" data-pf-paging="true">
      <div className="pf-paging__row">
        <div className="pf-paging__label">
          <span className="pf-paging__title">每页条数</span>
          <span className="pf-paging__desc">
            预设库、Tag 库、画师库、快照库统一按这个条数分页。
          </span>
        </div>
        <NumberStepper
          value={pageSize}
          min={LIBRARY_PAGE_SIZE_MIN}
          step={10}
          label="每页条数"
          onChange={(next) => setPageSize(next)}
        />
      </div>

      <div className="pf-paging__hint">
        <span className="pf-paging__hint-title">说明：</span>
        <span>
          默认 {LIBRARY_PAGE_SIZE} 条，可调范围 {LIBRARY_PAGE_SIZE_MIN}–
          {LIBRARY_PAGE_SIZE_MAX} 条。改动立刻生效并保存，不需要额外确认；数值越大，一页能看的
          胶囊越多，但一次渲染的也越多。
        </span>
      </div>
    </div>
  );
}
