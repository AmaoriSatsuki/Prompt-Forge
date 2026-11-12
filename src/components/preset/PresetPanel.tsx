import { useEffect, useMemo, useRef, useState } from 'react';
import { ARTIST_COLOR_ID, DEFAULT_PRESET_COLOR_ID, DICTIONARY_COLOR_ID } from '../../constants/colors';
import { useLibrarySelection } from '../../hooks/useLibrarySelection';
import { useSnapshotActions } from '../../hooks/useSnapshotActions';
import { useModuleStore } from '../../store/useModuleStore';
import { usePresetFolderStore } from '../../store/usePresetFolderStore';
import { usePresetStore } from '../../store/usePresetStore';
import { useUiStore } from '../../store/useUiStore';
import type { Preset, PresetDraft } from '../../types/preset';
import { clampWeight } from '../../utils/clamp';
import { paginate } from '../../utils/pagination';
import {
  buildLibraryBlocks,
  folderAccepts,
  knownFolders,
  paginateBlocks,
  type FolderRef,
} from '../../utils/presetFolders';
import { normalizePresetColor } from '../../utils/color';
import { visibleSnapshots } from '../../utils/snapshot';
import { capsuleNameFromSource, nextPresetLabel, uniquePresetLabel } from '../../utils/presetLabel';
import { Button } from '../common/Button';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { EmptyState } from '../common/EmptyState';
import { PresetColorFilter } from './PresetColorFilter';
import { PresetContextMenu } from './PresetContextMenu';
import { PresetEditorDialog } from './PresetEditorDialog';
import { PresetFolderNameDialog } from './PresetFolderNameDialog';
import { PresetGroupDropzone } from './PresetGroupDropzone';
import { PresetGroupList } from './PresetGroupList';
import { PresetGroupMenu } from './PresetGroupMenu';
import { PresetList } from './PresetList';
import { PreviewTip } from './PreviewTip';
import { SnapshotList } from './SnapshotList';
import { SnapshotContextMenu } from './SnapshotContextMenu';
import { SnapshotRenameDialog } from './SnapshotRenameDialog';
import { SnapshotSaveDialog } from './SnapshotSaveDialog';
import { PresetSearchBox } from './PresetSearchBox';

/**
 * 预设库面板（在右侧）。
 *
 * 职责：Store 接线、弹窗状态、搜索与颜色筛选，以及作为「模块枢」的落点。
 * 列表本身交给纯展示组件 PresetList（便于用夹具数据断言渲染结果）。
 *
 * **D62 起这里同时承载多个库**（D86 起是四个）：预设 / Tag / 画师 / 快照。
 * - 预设、Tag、画师三者的数据结构**完全一致**（都是 `Preset`），编辑/右键/拖拽/搜索
 *   全部复用，只是换一个 Store 实例；画师与 Tag 只差落盘文件与归属色。
 * - 视图由 `uiStore.libraryView` 决定，**只挂载当前库的列表**（其它库一条 DOM 都不产生）；
 * - 画师库 / Tag 库**按需加载**：第一次点 `@` / `T` 才读盘，几万条不会拖慢启动；
 * - 每个库都按 `libraryPageSize`（设置里的分页阈值，默认 100）分页渲染。
 */
export function PresetPanel() {
  /**
   * 三个预设形状的库（预设 / 画师 / Tag）全部由 `useLibrarySelection` 解析：
   * 视图判断、懒加载、`items / loaded / add / update / remove / setWeight` 的
   * 三选一都收在那一处，面板里不再有三份长得一样的绑定。
   */
  const {
    view,
    isArtistView,
    isTagView,
    isSnapshotView,
    items,
    allItems,
    presets,
    addPreset: presetAdd,
    visible,
    keyword,
    filterColorIds,
    loaded,
    loadError,
    addItem,
    updateItem,
    removeItem,
    setItemWeight,
  } = useLibrarySelection();
  const presetLoaded = usePresetStore((state) => state.loaded);

  /** 快照是另一条链（抓工作区、撤销栈、五个弹窗）：状态与动作都在这里 */
  const snapshot = useSnapshotActions();
  const snapshots = snapshot.snapshots;

  const modules = useModuleStore((state) => state.modules);
  const selectedModuleId = useModuleStore((state) => state.selectedModuleId);
  const drag = useUiStore((state) => state.drag);
  const savePresetModuleId = useUiStore((state) => state.savePresetModuleId);
  const closeSavePresetDialog = useUiStore((state) => state.closeSavePresetDialog);
  const pushToast = useUiStore((state) => state.pushToast);
  const setLibraryView = useUiStore((state) => state.setLibraryView);
  const libraryPage = useUiStore((state) => state.libraryPage);
  const libraryPageSize = useUiStore((state) => state.libraryPageSize);
  const setLibraryPage = useUiStore((state) => state.setLibraryPage);

  const [creating, setCreating] = useState(false);
  const [editingPreset, setEditingPreset] = useState<Preset | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Preset | null>(null);
  /** D64：正在「添加为预设」的那条（画师库或 Tag 库的条目） */
  const [movingItem, setMovingItem] = useState<Preset | null>(null);
  /** D71：悬停预览（预设/画师的英文、快照的全文） */
  const [preview, setPreview] = useState<{
    text: string;
    top: number;
    anchorLeft: number;
    anchorWidth: number;
    mode: 'fill' | 'auto';
    maxWidth: number;
  } | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);

  // 右键菜单状态在 Store 里：只记 id，值从当前库现取 —— 调权重后菜单里的数字要跟着变
  const menu = useUiStore((state) => state.presetMenu);
  const openPresetMenu = useUiStore((state) => state.openPresetMenu);
  const closePresetMenu = useUiStore((state) => state.closePresetMenu);

  /* ---------- 预设分组（D111 / D112，只在预设库视图） ---------- */
  const folders = usePresetFolderStore((state) => state.folders);
  const foldersLoaded = usePresetFolderStore((state) => state.loaded);
  const foldersLoading = usePresetFolderStore((state) => state.loading);
  const loadFolders = usePresetFolderStore((state) => state.loadFolders);
  const createFolder = usePresetFolderStore((state) => state.createFolder);
  const renameFolder = usePresetFolderStore((state) => state.renameFolder);
  const dissolveFolder = usePresetFolderStore((state) => state.dissolveFolder);
  const toggleFolderExpanded = usePresetFolderStore((state) => state.toggleFolderExpanded);
  const assignPreset = usePresetFolderStore((state) => state.assignPreset);
  const unassignPreset = usePresetFolderStore((state) => state.unassignPreset);
  const pruneFolders = usePresetFolderStore((state) => state.pruneFolders);
  const groupMenu = useUiStore((state) => state.presetGroupMenu);
  const openGroupMenu = useUiStore((state) => state.openPresetGroupMenu);
  const closeGroupMenu = useUiStore((state) => state.closePresetGroupMenu);
  const folderPrompt = useUiStore((state) => state.folderPrompt);
  const openFolderPrompt = useUiStore((state) => state.openFolderPrompt);
  const closeFolderPrompt = useUiStore((state) => state.closeFolderPrompt);

  // 分组元数据只属于预设库：第一次进预设视图才读盘（读不到就降级为「组名与颜色都由成员派生」）
  useEffect(() => {
    if (!isArtistView && !isTagView && !isSnapshotView && !foldersLoaded && !foldersLoading) {
      void loadFolders();
    }
  }, [isArtistView, isTagView, isSnapshotView, foldersLoaded, foldersLoading, loadFolders]);

  /**
   * D112：空组自动消失 —— 组里最后一颗胶囊被移走 / 删除后，组实体也一起清掉。
   * 放在这里而不是 Store 的订阅里：它必须跟着「渲染时看到的 presets」走，
   * 这样断言里 setState 之后一次 flush 就能观察到结果。
   *
   * D119：**必须两个库都读到之后才能判空组**。启动时 `preset-folders.json`（几字节）
   * 往往比 `presets.json` 先读完，此瞬间判空会把组实体连同展开状态整批删掉并写回 `[]`。
   */
  useEffect(() => {
    if (!foldersLoaded || !presetLoaded) return;
    pruneFolders();
  }, [presets, presetLoaded, foldersLoaded, pruneFolders]);

  // 切换库时把弹窗/菜单都收掉，避免「在预设视图打开的编辑器保存到了画师库」
  useEffect(() => {
    setCreating(false);
    setEditingPreset(null);
    setPendingDelete(null);
    setMovingItem(null);
    snapshot.closeSave();
    snapshot.closeUpdate();
    closePresetMenu();
    closeGroupMenu();
    closeFolderPrompt();
    // 刻意只跟视图与三个关闭动作：把 snapshot 整个对象放进来会让它在每次渲染都重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, closePresetMenu, closeGroupMenu, closeFolderPrompt]);

  const menuPreset =
    menu && !isSnapshotView ? items.find((preset) => preset.id === menu.presetId) ?? null : null;

  /**
   * D111：预设库走**分组块**，画师 / Tag 库保持原来的平铺列表。
   *
   * 分组只属于预设库：画师与 Tag 本来就按「词典文件夹」天然分组，再叠一层只会更乱。
   */
  const presetBlocks = useMemo(
    () => buildLibraryBlocks({ items: presets, folders, filterColorIds, keyword }),
    [presets, folders, filterColorIds, keyword],
  );

  // D66 / D86：四个库统一分页，条数来自设置里的「每页条数」（默认 100），保留列表滚动条
  const pageData = paginate(visible, libraryPage, libraryPageSize);
  // D111：分组视图改用**块级分页** —— 一个组 = 一个块，块永不被页切开
  const blockPage = paginateBlocks(presetBlocks, libraryPage, libraryPageSize);
  const page = isArtistView || isTagView ? pageData : blockPage;
  // D67：快照库用同一套分页参数，但数据形状不同，单独算一份
  const snapshotVisible = useMemo(
    () => visibleSnapshots(snapshots, keyword),
    [snapshots, keyword],
  );
  const snapshotPage = paginate(snapshotVisible, libraryPage, libraryPageSize);

  const savingModule = savePresetModuleId
    ? modules.find((module) => module.id === savePresetModuleId) ?? null
    : null;

  /**
   * 模块枢存成胶囊时的预填命名（D84）。
   *
   * 中文输入框里写的是什么，胶囊就先叫什么（取第一个分句、最多 10 个字），
   * 例如「千早爱音来自MyGO是一个非常可爱的女孩」→「千早爱音来自MyGO」、
   * 「千早爱音，来自MyGO」→「千早爱音」。
   *
   * 没有可用的中文（模块空着、或只放了胶囊）时回落到默认名「胶囊 N」；
   * 撞上已有预设名时追加「 2」「 3」（预设编辑器会校验重名，不去重会直接报错）。
   *
   * 注意：只有**这条路径**会猜名字；在预设库里点「+」新建仍然是默认名。
   */
  const savingModuleLabel = savingModule
    ? (() => {
        const suggestion = capsuleNameFromSource(savingModule.sourceText);
        return suggestion ? uniquePresetLabel(suggestion, presets) : nextPresetLabel(presets);
      })()
    : '';

  // 只有「拖着模块枢悬停在预设库上」才亮起磨砂落点提示；
  // 拖着预设路过这里不算（那种情况要落到模块上才有意义）
  const dropActive = drag?.hover?.kind === 'preset-panel' && drag.source.kind === 'module';

  /**
   * 画师条目的命名/英文一律以 `@` 开头（D62）。
   *
   * 导入路径由 Rust 清洗；这里管的是**手动新增/编辑**的那条路径 ——
   * 否则手建一条画师就叫「胶囊 1」，和导入进来的「@美嘉」长得不一样。
   */
  function withArtistAt(draft: PresetDraft): PresetDraft {
    const withAt = (value: string) => (value.startsWith('@') ? value : `@${value}`);
    return { ...draft, label: withAt(draft.label), english: withAt(draft.english) };
  }

  /**
   * 当前库的中文名词（用于按钮与 toast）。
   *
   * D86：Tag 库的条目就叫「Tag」—— 这是用户在需求里指定的专有叫法，
   * 因此 `Tag` 进了界面文案白名单（见 verify-copy 的 ALLOWED_LATIN）。
   */
  const libraryNoun = isArtistView ? '画师' : isTagView ? 'Tag' : '预设';

  function handleCreate(draft: PresetDraft) {
    addItem(isArtistView ? withArtistAt(draft) : draft);
    setCreating(false);
    pushToast(`${libraryNoun}已创建`, 'ok');
  }

  function handleUpdate(draft: PresetDraft) {
    if (!editingPreset) return;
    updateItem(editingPreset.id, isArtistView ? withArtistAt(draft) : draft);
    /*
     * D112 / D113：组只收纳同色胶囊 —— 用户把归属色改掉之后，原来的组就不再收它
     * （组身份 = 名字 + 颜色）。这里**自动移出**（而不是拒绝改色）：
     * 改色是用户明确要的，组的颜色不能跟着变。
     */
    if (!isArtistView && !isTagView && editingPreset.folder && draft.colorId !== editingPreset.colorId) {
      unassignPreset(editingPreset.id);
      pushToast(`已改色，因此移出了「${editingPreset.folder}」（该分组只收纳同色）`, 'warn');
    }
    setEditingPreset(null);
    pushToast(`${libraryNoun}已更新`, 'ok');
  }

  function handleDelete() {
    if (!pendingDelete) return;
    removeItem(pendingDelete.id);
    setPendingDelete(null);
    pushToast(`${libraryNoun}已删除`, 'ok');
  }

  function handleMenuWeight(delta: number) {
    if (!menuPreset) return;
    setItemWeight(menuPreset.id, clampWeight(menuPreset.weight + delta));
  }

  /* ---------- 分组动作（D111 / D112 / D113） ---------- */

  /** 现存的所有组（名字 + 颜色）：实体 ∪ 成员派生 */
  const groups = knownFolders(presets, folders);

  /**
   * 右键菜单里只列**同色分组** —— 组色固定且只收纳同色胶囊，
   * 异色的组点进去也只会被拒绝，不如不列（D113 允许同名不同色，所以这里按颜色筛）。
   */
  const sameColorFolderNames = menuPreset
    ? groups
        .filter((group) => folderAccepts(group.colorId, menuPreset.colorId))
        .map((group) => group.name)
    : [];

  /**
   * 当前拖拽悬停在哪个组上（名字 + 颜色）。
   * - 落在顶部件「建组判断区」上时 `hover.group === ''`（此时没有组色）；
   * - 只有拖的是「预设」才算 —— 词典词条 / 模块枢落到组上都是取消，不该亮。
   */
  const hoverFolder: FolderRef | null =
    drag && drag.source.kind === 'preset' && drag.hover?.kind === 'preset-group' && drag.hover.group
      ? { name: drag.hover.group, colorId: normalizePresetColor(drag.hover.color) }
      : null;
  const draggingPreset = drag?.source.kind === 'preset';
  const hoverNewGroup = drag?.source.kind === 'preset' && drag.hover?.kind === 'preset-group'
    ? drag.hover.group === ''
    : false;

  function handleMenuMoveIntoFolder(name: string) {
    if (!menuPreset) return;
    const result = assignPreset(menuPreset.id, {
      name,
      colorId: normalizePresetColor(menuPreset.colorId),
    });
    closePresetMenu();
    pushToast(result.ok ? `已移入「${result.name}」` : result.message, result.ok ? 'ok' : 'warn');
  }

  function handleMenuMoveOutOfFolder() {
    if (!menuPreset) return;
    unassignPreset(menuPreset.id);
    closePresetMenu();
    pushToast('已移出分组', 'ok');
  }

  function handleGroupMenuToggleExpanded() {
    if (groupMenu) {
      toggleFolderExpanded({ name: groupMenu.name, colorId: groupMenu.colorId });
    }
    closeGroupMenu();
  }

  function handleGroupMenuRename() {
    if (!groupMenu) return;
    openFolderPrompt({
      mode: 'rename',
      from: { name: groupMenu.name, colorId: groupMenu.colorId },
      initialName: groupMenu.name,
    });
  }

  function handleGroupMenuDissolve() {
    if (!groupMenu) return;
    const name = groupMenu.name;
    dissolveFolder({ name, colorId: groupMenu.colorId });
    closeGroupMenu();
    pushToast(`已解散「${name}」，内容回到未分组`, 'ok');
  }

  function handleMenuEdit() {
    if (!menuPreset) return;
    setEditingPreset(menuPreset);
    closePresetMenu();
  }

  function handleMenuDelete() {
    if (!menuPreset) return;
    setPendingDelete(menuPreset);
    closePresetMenu();
  }

  function handlePreviewOver(event: React.MouseEvent) {
    // D76：卡片上的图标按钮不是"条目内容"，悬停它们不该再弹预览浮层（D73 的「两个浮框」教训）
    if ((event.target as HTMLElement).closest('[data-preview-off]')) {
      setPreview(null);
      return;
    }
    const target = (event.target as HTMLElement).closest('[data-preview-kind]');
    const kind = target?.getAttribute('data-preview-kind');
    const id = target?.getAttribute('data-preview-id') ?? '';
    const preset = kind === 'preset' ? allItems.find((item) => item.id === id) : undefined;
    const snapshot = kind === 'snapshot' ? snapshots.find((item) => item.id === id) : undefined;
    const text = (preset?.english ?? snapshot?.copyText ?? '').trim();
    if (!target || !text) {
      setPreview(null);
      return;
    }
    const rect = target.getBoundingClientRect();
    const panelWidth = panelRef.current?.getBoundingClientRect().width ?? rect.width;
    // D74：快照卡按卡片宽度（够宽），普通胶囊由内容撑开，最多不超过面板宽度
    setPreview({
      text,
      top: rect.bottom + 6,
      anchorLeft: rect.left,
      anchorWidth: rect.width,
      mode: kind === 'snapshot' ? 'fill' : 'auto',
      maxWidth: Math.max(200, panelWidth - 8),
    });
  }

  /**
   * D64 / D86：把画师或 Tag「添加为预设」——
   * 打开预设编辑器（Tag 的英文与中文名原样带过去），选色后移入预设库，原条目随即移除。
   *
   * 这就是用户说的「我就可以扔掉这个词典换一个词典了」那条路径：
   * 转换完之后预设是用户资产，删词典也不会带走它。
   */
  function handleMenuMoveToPresets() {
    if (!menuPreset) return;
    setMovingItem(menuPreset);
    closePresetMenu();
  }

  return (
    <aside
      className={dropActive ? 'pf-preset pf-preset--drop-active' : 'pf-preset'}
      aria-label={isTagView ? 'Tag 库' : isArtistView ? '画师库' : '预设库'}
      data-pf-preset-panel="true"
      data-pf-menu-open={menuPreset ? 'yes' : 'no'}
      data-pf-library={view}
      ref={panelRef}
      onMouseOver={handlePreviewOver}
      onMouseLeave={() => setPreview(null)}
    >
      {/*
        D112：面板顶部件（标题 + 搜索 + 色块行）外面这一层只是给「建组判断区」当地图用。
        它必须 `position: relative`，判断区才能正好盖住这一片（用户圈出来的红框）。
      */}
      <div className="pf-preset__top">
        <header className="pf-preset__head">
        <h2 className="pf-preset__title">
          {isSnapshotView
            ? '快照库'
            : isTagView
              ? 'Tag 库'
              : isArtistView
                ? '画师库'
                : '预设库'}
        </h2>
        <span className="pf-preset__count">
          {isSnapshotView ? snapshots.length : items.length}
        </span>
        {isSnapshotView ? (
          <span className="pf-preset__actions">
            <Button compact onClick={snapshot.undo} disabled={!snapshot.canUndo}>
              撤销
            </Button>
            <Button compact variant="primary" onClick={snapshot.openSave}>
              创建快照
            </Button>
          </span>
        ) : (
          <Button compact variant="primary" onClick={() => setCreating(true)}>
            {isArtistView ? '新增画师' : isTagView ? '新增 Tag' : '新增预设'}
          </Button>
        )}
      </header>

      <PresetSearchBox />
      <PresetColorFilter />

      {/*
        D112：拖一颗胶囊到面板顶部 = 新建分组。
        透明不可见、摸得到（`pointer-events` 默认开着），只在指针真压上来时显形。
      */}
      <PresetGroupDropzone active={draggingPreset} hovered={hoverNewGroup} />
      </div>

      {loadError ? <p className="pf-preset__error">{loadError}</p> : null}

      <div className="pf-preset__list pf-scroll-thin">
        {loaded ? (
          <>
            {isSnapshotView ? (
              snapshotPage.items.length === 0 ? (
                <EmptyState text="还没有快照" hint="点上方「创建快照」保存当前工作区。" />
              ) : (
                <SnapshotList
                  snapshots={snapshotPage.items}
                  onContextMenu={(item, x, y) => snapshot.openMenu(item, x, y)}
                  onUpdate={(item) => snapshot.openUpdate(item)}
                  onCopy={(item) => {
                    void snapshot.copy(item);
                  }}
                />
              )
            ) : isArtistView || isTagView ? (
              <PresetList
                presets={pageData.items}
                totalCount={items.length}
                onContextMenu={(preset, x, y) => openPresetMenu(preset.id, x, y)}
                emptyText={isArtistView ? '还没有画师' : '还没有 Tag'}
                emptyHint={
                  isArtistView
                    ? '导入带 category=1 列的词典，画师会自动进这里。'
                    : '导入词典后，词条会自动进这里；挑中的可以右键「添加为预设」。'
                }
                noMatchText={isArtistView ? '没有匹配的画师' : '没有匹配的 Tag'}
              />
            ) : (
              <PresetGroupList
                blocks={blockPage.blocks}
                totalCount={presets.length}
                hoverFolder={hoverFolder}
                onContextMenu={(preset, x, y) => openPresetMenu(preset.id, x, y)}
                onGroupContextMenu={(folder, x, y) => openGroupMenu(folder.name, folder.colorId, x, y)}
                onToggleGroup={(folder) => toggleFolderExpanded(folder)}
                emptyText="暂无预设"
                emptyHint="把模块枢拖到这里，或点上方「新增预设」。"
                noMatchText="没有匹配的预设"
              />
            )}
            {page.pageCount > 1 ? (
              <nav className="pf-pager" aria-label="分页" data-pf-page={page.page}>
                <Button
                  compact
                  onClick={() => setLibraryPage(page.page - 1)}
                  disabled={page.page <= 1}
                >
                  上一页
                </Button>
                <span className="pf-pager__info">
                  第 {page.page} / {page.pageCount} 页
                </span>
                <Button
                  compact
                  onClick={() => setLibraryPage(page.page + 1)}
                  disabled={page.page >= page.pageCount}
                >
                  下一页
                </Button>
              </nav>
            ) : null}
          </>
        ) : (
          <EmptyState
            text={
              isArtistView ? '正在读取画师库……' : isTagView ? '正在读取 Tag 库……' : '正在读取预设库……'
            }
          />
        )}
      </div>

      {dropActive ? (
        <div className="pf-preset__drop" aria-hidden="true">
          <span className="pf-preset__drop-hint">松手保存为预设</span>
        </div>
      ) : null}

      {creating ? (
        <PresetEditorDialog
          mode="create"
          defaults={{
            label: isArtistView
              ? `@${nextPresetLabel(items).replace('胶囊', '画师')}`
              : isTagView
                ? nextPresetLabel(items).replace('胶囊', '词条')
                : nextPresetLabel(items),
            /*
             * 用户 2026 轮：正处于颜色筛选时，新建预设默认落在「被筛的那一色」上；
             * 画师库固定用画师色（D62），Tag 库固定用词典色（D86，与 `T` 色块同源）。
             */
            colorId: isArtistView
              ? ARTIST_COLOR_ID
              : isTagView
                ? DICTIONARY_COLOR_ID
                : filterColorIds[0],
          }}
          lockedColorId={
            isArtistView ? ARTIST_COLOR_ID : isTagView ? DICTIONARY_COLOR_ID : undefined
          }
          existingPresets={items}
          onSubmit={handleCreate}
          onCancel={() => setCreating(false)}
        />
      ) : null}

      {savingModule ? (
        <PresetEditorDialog
          mode="create"
          title={`保存为预设（来自模块 ${savingModule.order}）`}
          defaults={{
            label: savingModuleLabel,
            english: savingModule.translation,
            // 需求 3：从模块枢拖到预设库保存时，归属色默认继承当前模块的颜色
            colorId: savingModule.colorId,
          }}
          existingPresets={presets}
          onSubmit={(draft) => {
            // 模块枢保存的永远是**普通预设**：写入后切回预设视图，让用户当场看到结果
            presetAdd(draft);
            setCreating(false);
            setLibraryView('presets');
            pushToast('预设已创建', 'ok');
            closeSavePresetDialog();
          }}
          onCancel={closeSavePresetDialog}
        />
      ) : null}

      {editingPreset ? (
        <PresetEditorDialog
          mode="edit"
          preset={editingPreset}
          lockedColorId={
            isArtistView ? ARTIST_COLOR_ID : isTagView ? DICTIONARY_COLOR_ID : undefined
          }
          existingPresets={items}
          onSubmit={handleUpdate}
          onCancel={() => setEditingPreset(null)}
        />
      ) : null}

      {movingItem ? (
        <PresetEditorDialog
          mode="create"
          title={isTagView ? '添加为预设（来自 Tag 库）' : '添加为预设（来自画师库）'}
          defaults={{
            label: movingItem.label,
            english: movingItem.english,
            colorId: DEFAULT_PRESET_COLOR_ID,
          }}
          existingPresets={presets}
          onSubmit={(draft) => {
            presetAdd(draft);
            /*
             * 「移动」语义：进了预设库就把原来那条移除，避免两边各留一份。
             * `removeItem` 按当前视图解析（画师库 → artists.json，Tag 库 → tags.json），
             * 而且**删词典不会再带走它** —— 它已经是用户自己的预设了（D86）。
             */
            removeItem(movingItem.id);
            setMovingItem(null);
            setLibraryView('presets');
            pushToast('已添加为预设', 'ok');
          }}
          onCancel={() => setMovingItem(null)}
        />
      ) : null}

      {preview ? (
        <PreviewTip
          text={preview.text}
          top={preview.top}
          anchorLeft={preview.anchorLeft}
          anchorWidth={preview.anchorWidth}
          mode={preview.mode}
          maxWidth={preview.maxWidth}
        />
      ) : null}

      {snapshot.saving ? (
        <SnapshotSaveDialog
          selectedOrder={modules.find((module) => module.id === selectedModuleId)?.order ?? 1}
          onCancel={snapshot.closeSave}
          onConfirm={snapshot.create}
        />
      ) : null}

      {menuPreset && menu ? (
        <PresetContextMenu
          preset={menuPreset}
          x={menu.x}
          y={menu.y}
          onWeightChange={handleMenuWeight}
          onEdit={handleMenuEdit}
          onDelete={handleMenuDelete}
          onMoveToPresets={isArtistView || isTagView ? handleMenuMoveToPresets : undefined}
          deleteLabel={isArtistView ? '删除画师' : isTagView ? '删除 Tag' : '删除预设'}
          /* D111：分组只有预设库才有 —— 画师库 / Tag 库不传这几个回调，菜单里就不会出现分组段 */
          folderNames={
            isArtistView || isTagView || isSnapshotView ? undefined : sameColorFolderNames
          }
          currentFolder={menuPreset.folder ?? ''}
          onMoveToFolder={handleMenuMoveIntoFolder}
          onMoveOutOfFolder={handleMenuMoveOutOfFolder}
          onClose={closePresetMenu}
        />
      ) : null}

      {/* D111 / D113：分组右键菜单（展开收起 / 重命名 / 解散） */}
      {groupMenu
        ? (() => {
            const folder = folders.find(
              (item) => item.name === groupMenu.name && item.colorId === groupMenu.colorId,
            ) ?? {
              name: groupMenu.name,
              colorId: groupMenu.colorId,
              expanded: false,
            };
            return (
              <PresetGroupMenu
                folder={folder}
                x={groupMenu.x}
                y={groupMenu.y}
                onToggleExpanded={handleGroupMenuToggleExpanded}
                onRename={handleGroupMenuRename}
                onDissolve={handleGroupMenuDissolve}
                onClose={closeGroupMenu}
              />
            );
          })()
        : null}

      {/* D111 / D112：分组命名框（建组 / 重命名共用） */}
      {folderPrompt ? (
        <PresetFolderNameDialog
          mode={folderPrompt.mode}
          initialName={folderPrompt.initialName}
          onCancel={closeFolderPrompt}
          onConfirm={(name) => {
            if (folderPrompt.mode === 'rename' && folderPrompt.from) {
              const renamed = renameFolder(folderPrompt.from, name);
              const failed = renamed === folderPrompt.from.name;
              pushToast(failed ? '分组名称已被占用' : '已重命名分组', failed ? 'warn' : 'ok');
              closeFolderPrompt();
              return;
            }

            /*
             * D112：建组只有这一条路 —— 拖一颗胶囊到面板顶部，所以这里一定带着
             * 那颗胶囊；**组的颜色就取它的颜色**（之后不可改）。
             */
            const preset = presets.find((item) => item.id === folderPrompt.presetId);
            if (!preset) {
              pushToast('找不到这条预设，可能已被删除', 'warn');
              closeFolderPrompt();
              return;
            }
            const result = createFolder(name, preset.colorId, preset.id);
            if (!result.ok) {
              // 撞了异色分组：**不关弹窗**，让用户直接换个名字
              pushToast(result.message, 'warn');
              return;
            }
            pushToast(`已移入「${result.name}」`, 'ok');
            closeFolderPrompt();
          }}
        />
      ) : null}

      {snapshot.menu
        ? (() => {
            const target = snapshot.snapshots.find((item) => item.id === snapshot.menu?.id);
            if (!target) return null;
            return (
              <SnapshotContextMenu
                snapshot={target}
                x={snapshot.menu.x}
                y={snapshot.menu.y}
                onWeightChange={(delta) => snapshot.changeWeight(target, delta)}
                onRename={() => snapshot.openRename(target)}
                onDelete={() => snapshot.openDelete(target)}
                onClose={snapshot.closeMenu}
              />
            );
          })()
        : null}

      {snapshot.renaming ? (
        <SnapshotRenameDialog
          initialName={snapshot.renaming.name}
          onCancel={snapshot.closeRename}
          onConfirm={(name) => snapshot.confirmRename(name)}
        />
      ) : null}

      {snapshot.updating ? (
        <ConfirmDialog
          title="更新快照"
          text={
            snapshot.updating.scope === 'global'
              ? `确定用当前工作区的全部模块覆盖「${snapshot.updating.name}」吗？快照里原来的内容会被替换，且无法撤销。`
              : `确定用当前选中的模块（模块 ${
                  modules.find((module) => module.id === selectedModuleId)?.order ?? 1
                }）覆盖「${snapshot.updating.name}」吗？快照里原来的内容会被替换，且无法撤销。`
          }
          confirmLabel="覆盖"
          onConfirm={snapshot.confirmUpdate}
          onCancel={snapshot.closeUpdate}
        />
      ) : null}

      {snapshot.deleting ? (
        <ConfirmDialog
          title="删除快照"
          text={`确定要删除「${snapshot.deleting.name}」吗？此操作不可撤销。`}
          confirmLabel="删除"
          onConfirm={snapshot.confirmDelete}
          onCancel={snapshot.closeDelete}
        />
      ) : null}

      {pendingDelete ? (
        <ConfirmDialog
          title={isArtistView ? '删除画师' : isTagView ? '删除 Tag' : '删除预设'}
          text={`确定要删除「${pendingDelete.label}」吗？此操作不可撤销。`}
          confirmLabel="删除"
          onConfirm={handleDelete}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}
    </aside>
  );
}
