import type { Preset } from '../../types/preset';
import { EmptyState } from '../common/EmptyState';
import { PresetItem } from './PresetItem';

interface PresetListProps {
  /** 已经筛选并排序好的可见预设 */
  presets: Preset[];
  /** 总数，用于区分「一条都没有」和「被筛掉了」 */
  totalCount: number;
  onContextMenu: (preset: Preset, x: number, y: number) => void;
  /** 空态文案（D62：画师库要显示「画师」而不是「预设」） */
  emptyText?: string;
  emptyHint?: string;
  noMatchText?: string;
}

/** 纯展示组件：不读 Store，因此可以直接用夹具数据断言渲染结果。 */
export function PresetList({
  presets,
  totalCount,
  onContextMenu,
  emptyText = '暂无预设',
  emptyHint = '把模块枢拖到这里，或点上方「新增预设」。',
  noMatchText = '没有匹配的预设',
}: PresetListProps) {
  if (totalCount === 0) {
    return <EmptyState text={emptyText} hint={emptyHint} />;
  }

  if (presets.length === 0) {
    return <EmptyState text={noMatchText} hint="换个关键字，或取消部分颜色筛选。" />;
  }

  return (
    <ul className="pf-preset-list">
      {presets.map((preset) => (
        <PresetItem key={preset.id} preset={preset} onContextMenu={onContextMenu} />
      ))}
    </ul>
  );
}
