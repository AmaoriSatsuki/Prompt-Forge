import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import type { Preset } from '../../types/preset';
import { resolveColorGradient, resolveColorHex } from '../../utils/color';
import { sameFolder, type FolderRef, type LibraryBlock } from '../../utils/presetFolders';
import { EmptyState } from '../common/EmptyState';
import { PresetItem } from './PresetItem';

interface PresetGroupListProps {
  /** 已经分好组、排好序、分好页的块 */
  blocks: LibraryBlock[];
  /** 库里一共多少条（用来区分「一条都没有」与「被筛掉了」） */
  totalCount: number;
  /** 当前拖拽悬停在哪个组上（null = 没悬停） */
  hoverFolder: FolderRef | null;
  onContextMenu: (preset: Preset, x: number, y: number) => void;
  onGroupContextMenu: (folder: FolderRef, x: number, y: number) => void;
  onToggleGroup: (folder: FolderRef) => void;
  emptyText: string;
  emptyHint: string;
  noMatchText: string;
}

/**
 * 预设库的分组视图（D111 → D113）。
 *
 * 形态（与用户逐条敲定）：
 * - **折叠** = 一颗与胶囊同高的圆角砖（8px 圆角、1px 描边），砖与胶囊共用同一行流；
 * - **展开** = 占满一整行的圆角卡，卡里就是正常的胶囊网格；
 *   两者用同一个 `flex-wrap` 容器：卡是 `flex-basis: 100%`，砖是自适应宽度 ——
 *   「砖混排 / 卡独占一行」由 CSS 完成，不需要两套渲染分支；
 * - 砖全部排在散件**前面**（各自按权重降序），目录在前、散件在后。
 *
 * **D113 的两处变化**：
 * - 组名前加一颗**圆角正方形色块**（与胶囊小圆点同源取色）—— 因为组名允许重名，
 *   主界面必须一眼看出这颗砖是哪一色的；
 * - 组的身份是「名字 + 颜色」，所以所有回调都收 `FolderRef` 而不是裸名字。
 *
 * 展开/收起只走双击（组不是拖拽源，因此双击没有手势冲突）；
 * 右键菜单里有「展开 / 收起」兜底，砖的悬停提示也写明「双击展开」。
 */
export function PresetGroupList({
  blocks,
  totalCount,
  hoverFolder,
  onContextMenu,
  onGroupContextMenu,
  onToggleGroup,
  emptyText,
  emptyHint,
  noMatchText,
}: PresetGroupListProps) {
  if (totalCount === 0) return <EmptyState text={emptyText} hint={emptyHint} />;

  const groups = blocks.filter((block): block is Extract<LibraryBlock, { kind: 'group' }> =>
    block.kind === 'group',
  );
  const ungrouped = blocks.find(
    (block): block is Extract<LibraryBlock, { kind: 'ungrouped' }> => block.kind === 'ungrouped',
  );

  if (groups.length === 0 && (!ungrouped || ungrouped.items.length === 0)) {
    return <EmptyState text={noMatchText} hint="换个关键字，或取消颜色筛选。" />;
  }

  return (
    <div className="pf-blocks">
      {groups.length > 0 ? (
        <div className="pf-blocks__groups">
          {groups.map((block) => {
            const ref: FolderRef = { name: block.name, colorId: block.colorId };
            const hovered = sameFolder(hoverFolder, ref);
            return block.expanded ? (
              <GroupCard
                key={`${block.colorId}::${block.name}`}
                block={block}
                hovered={hovered}
                onContextMenu={onContextMenu}
                onGroupContextMenu={onGroupContextMenu}
                onToggle={() => onToggleGroup(ref)}
              />
            ) : (
              <GroupTile
                key={`${block.colorId}::${block.name}`}
                block={block}
                hovered={hovered}
                onGroupContextMenu={onGroupContextMenu}
                onToggle={() => onToggleGroup(ref)}
              />
            );
          })}
        </div>
      ) : null}

      {ungrouped && ungrouped.items.length > 0 ? (
        <ul className="pf-preset-list pf-preset-list--flat">
          {ungrouped.items.map((preset) => (
            <PresetItem key={preset.id} preset={preset} onContextMenu={onContextMenu} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * 组名前的色块（D113）：**圆角正方形**，与胶囊小圆点同源取色。
 *
 * 用户口径：「为了在主界面区分它们（同名不同色的组），需要在组的前方做出色块显示，
 * 就用圆角正方形，对应胶囊的小圆点」。因此尺寸/描边跟胶囊圆点一致，只是圆角方一些。
 */
function GroupSwatch() {
  return <span className="pf-group__swatch" aria-hidden="true" />;
}

/**
 * 一个组的颜色变量（D114）：色块、**边框**都取这一份，
 * 因此在界面上「边框的颜色 = 色块的颜色」，一眼能对上。
 */
function groupColorStyle(colorId: string): CSSProperties {
  return {
    '--pf-group-color': resolveColorHex(colorId),
    '--pf-group-swatch': resolveColorHex(colorId),
    '--pf-group-swatch-gradient': resolveColorGradient(colorId),
  } as CSSProperties;
}

interface GroupChromeProps {
  block: Extract<LibraryBlock, { kind: 'group' }>;
  hovered: boolean;
  onGroupContextMenu: (folder: FolderRef, x: number, y: number) => void;
  onToggle: () => void;
}

/** 折叠态：一颗与胶囊同高的砖 */
function GroupTile({ block, hovered, onGroupContextMenu, onToggle }: GroupChromeProps) {
  function handleContextMenu(event: ReactMouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    onGroupContextMenu({ name: block.name, colorId: block.colorId }, event.clientX, event.clientY);
  }

  return (
    <button
      type="button"
      className={hovered ? 'pf-group-tile pf-group-tile--drop' : 'pf-group-tile'}
      style={groupColorStyle(block.colorId)}
      data-pf-group-name={block.name}
      data-pf-group-color={block.colorId}
      data-pf-group-expanded="no"
      title={`双击展开「${block.name}」`}
      aria-label={`分组 ${block.name}，双击展开`}
      onDoubleClick={onToggle}
      onContextMenu={handleContextMenu}
    >
      <GroupSwatch />
      <span className="pf-group-tile__name" data-pf-external="true">
        {block.name}
      </span>
      <span className="pf-group-tile__count">{block.items.length}</span>
    </button>
  );
}

/** 展开态：占满一整行的圆角卡（左右内边距为 0，保住一行 8 颗的几何） */
function GroupCard({
  block,
  hovered,
  onContextMenu,
  onGroupContextMenu,
  onToggle,
}: GroupChromeProps & { onContextMenu: (preset: Preset, x: number, y: number) => void }) {
  function handleContextMenu(event: ReactMouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    onGroupContextMenu({ name: block.name, colorId: block.colorId }, event.clientX, event.clientY);
  }

  return (
    <section
      className={hovered ? 'pf-group-card pf-group-card--drop' : 'pf-group-card'}
      style={groupColorStyle(block.colorId)}
      data-pf-group-name={block.name}
      data-pf-group-color={block.colorId}
      data-pf-group-expanded="yes"
      /*
       * D114：**整张卡的任何空白处都能右键**（原来只有顶部那一行能右键，
       * 用户实测觉得"抠"）。卡里胶囊的右键在 `PresetItem` 里已经
       * stopPropagation，所以右键胶囊仍然是「预设菜单」，不会两个菜单一起弹。
       */
      onContextMenu={handleContextMenu}
      onDoubleClick={(event) => {
        /*
         * 只在「不是点里面的胶囊、也不是点收起按钮」时切换：
         * 否则双击一颗胶囊会把整个组收起来（用户会以为胶囊被删了）。
         */
        const target = event.target as HTMLElement;
        if (target.closest('[data-pf-preset-id]') || target.closest('.pf-group-card__toggle')) return;
        onToggle();
      }}
    >
      <header className="pf-group-card__head">
        <button
          type="button"
          className="pf-group-card__toggle"
          aria-label={`收起分组 ${block.name}`}
          title={`收起「${block.name}」`}
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          ▾
        </button>
        <GroupSwatch />
        <span className="pf-group-card__name" data-pf-external="true">
          {block.name}
        </span>
        <span className="pf-group-card__count">{block.items.length}</span>
      </header>

      <ul className="pf-preset-list pf-preset-list--flat">
        {block.items.map((preset) => (
          <PresetItem key={preset.id} preset={preset} onContextMenu={onContextMenu} />
        ))}
      </ul>
    </section>
  );
}
