import { useEffect, useMemo } from 'react';
import { useArtistStore } from '../store/useArtistStore';
import { usePresetStore } from '../store/usePresetStore';
import { useTagStore } from '../store/useTagStore';
import { useUiStore } from '../store/useUiStore';
import type { LibraryView } from '../types/library';
import type { Preset, PresetDraft } from '../types/preset';
import { visiblePresets } from '../utils/presetFilter';
import type { PresetPatch } from '../store/presetLibrary';
import type { ColorId } from '../constants/colors';

/**
 * 「当前在看哪个库」的唯一解析处。
 *
 * 为什么抽出来：预设 / 画师 / Tag 三个库是同一个 Store 工厂产出的同一形状，
 * 但面板里原来为它们各写了一遍九行绑定 + 一段三元表达式来解 `items / loaded /
 * loadError / add / update / remove / setWeight`。三份同样的三元一旦有一处写错，
 * 症状是「在画师库点删除，删掉了预设」—— 这类错极难在界面上一眼看出来。
 *
 * 快照库形状不同（`Snapshot` 不是 `Preset`），故意**不**在这里，
 * 它有自己的 `useSnapshotActions`。
 */
export interface LibrarySelection {
  view: LibraryView;
  isPresetView: boolean;
  isArtistView: boolean;
  isTagView: boolean;
  isSnapshotView: boolean;
  /** 当前库的条目（快照库视图下是空数组：它走另一条链） */
  items: Preset[];
  /** 三个预设形状库的全集（悬停预览要跨库找条目，不看当前视图） */
  allItems: Preset[];
  /** 预设库自身（分组块、默认命名、重名校验都要它，与当前视图无关） */
  presets: Preset[];
  /** 预设库自己的新增动作：「从模块保存」「画师/Tag 转为预设」永远写预设库，与当前视图无关 */
  addPreset: (draft: PresetDraft) => void;
  /** 当前视图过滤后的条目（画师 / Tag 不做颜色筛选，只按关键字） */
  visible: Preset[];
  /** 两个筛选口径的现状（分组块、新建预设的默认色、快照搜索都要它们） */
  keyword: string;
  filterColorIds: ColorId[];
  loaded: boolean;
  loading: boolean;
  loadError: string | null;
  addItem: (draft: PresetDraft) => void;
  updateItem: (id: string, patch: PresetPatch) => void;
  removeItem: (id: string) => void;
  setItemWeight: (id: string, weight: number) => void;
}

/** 快照库视图下的稳定空数组（见下方注释） */
const NO_ITEMS: Preset[] = [];

export function useLibrarySelection(): LibrarySelection {
  const view = useUiStore((state) => state.libraryView);
  const isArtistView = view === 'artists';
  const isTagView = view === 'tags';
  const isSnapshotView = view === 'snapshots';

  /* ---------- 普通预设库（常驻） ---------- */
  const presets = usePresetStore((state) => state.presets);
  const presetLoaded = usePresetStore((state) => state.loaded);
  const presetLoading = usePresetStore((state) => state.loading);
  const presetLoadError = usePresetStore((state) => state.loadError);
  const presetAdd = usePresetStore((state) => state.addPreset);
  const presetUpdate = usePresetStore((state) => state.updatePreset);
  const presetRemove = usePresetStore((state) => state.removePreset);
  const presetSetWeight = usePresetStore((state) => state.setWeight);

  /* ---------- 画师库（懒加载） ---------- */
  const artists = useArtistStore((state) => state.presets);
  const artistsLoaded = useArtistStore((state) => state.loaded);
  const artistsLoading = useArtistStore((state) => state.loading);
  const artistsLoadError = useArtistStore((state) => state.loadError);
  const loadArtists = useArtistStore((state) => state.loadPresets);
  const artistAdd = useArtistStore((state) => state.addPreset);
  const artistUpdate = useArtistStore((state) => state.updatePreset);
  const artistRemove = useArtistStore((state) => state.removePreset);
  const artistSetWeight = useArtistStore((state) => state.setWeight);

  /* ---------- Tag 库（D86，懒加载；与画师库同一套 Store 工厂） ---------- */
  const tags = useTagStore((state) => state.presets);
  const tagsLoaded = useTagStore((state) => state.loaded);
  const tagsLoading = useTagStore((state) => state.loading);
  const tagsLoadError = useTagStore((state) => state.loadError);
  const loadTags = useTagStore((state) => state.loadPresets);
  const tagAdd = useTagStore((state) => state.addPreset);
  const tagUpdate = useTagStore((state) => state.updatePreset);
  const tagRemove = useTagStore((state) => state.removePreset);
  const tagSetWeight = useTagStore((state) => state.setWeight);

  // 进入画师库视图时才加载（懒加载；已加载过则 loadPresets 自己短路）
  useEffect(() => {
    if (isArtistView && !artistsLoaded && !artistsLoading) void loadArtists();
  }, [isArtistView, artistsLoaded, artistsLoading, loadArtists]);

  // Tag 库同一条规矩（D86）：第一次点 `T` 才读 tags.json
  useEffect(() => {
    if (isTagView && !tagsLoaded && !tagsLoading) void loadTags();
  }, [isTagView, tagsLoaded, tagsLoading, loadTags]);

  const items = isArtistView ? artists : isTagView ? tags : presets;
  const loaded = isArtistView ? artistsLoaded : isTagView ? tagsLoaded : presetLoaded;
  const loading = isArtistView ? artistsLoading : isTagView ? tagsLoading : presetLoading;
  const loadError = isArtistView
    ? artistsLoadError
    : isTagView
      ? tagsLoadError
      : presetLoadError;

  const keyword = useUiStore((state) => state.presetSearchKeyword);
  const filterColorIds = useUiStore((state) => state.presetFilterColorIds);

  // 画师库与 Tag 库都只有一个归属色，因此没有颜色筛选，只按关键字过滤
  const visible = useMemo(() => {
    if (isArtistView) return visiblePresets(artists, [], keyword);
    if (isTagView) return visiblePresets(tags, [], keyword);
    return visiblePresets(presets, filterColorIds, keyword);
  }, [isArtistView, isTagView, artists, tags, presets, filterColorIds, keyword]);

  const allItems = useMemo(
    () => [...presets, ...artists, ...tags],
    [presets, artists, tags],
  );

  // 快照库视图下没有「当前库的预设条目」：它自己一条链，这里给空数组而不是悄悄给错库
  // （用常量而不是 `[]`：每次渲染换新数组会把下游的 useMemo 全部击穿）
  return {
    view,
    isPresetView: !isArtistView && !isTagView && !isSnapshotView,
    isArtistView,
    isTagView,
    isSnapshotView,
    items: isSnapshotView ? NO_ITEMS : items,
    allItems,
    presets,
    addPreset: presetAdd,
    visible,
    keyword,
    filterColorIds,
    loaded,
    loading,
    loadError,
    addItem: isArtistView ? artistAdd : isTagView ? tagAdd : presetAdd,
    updateItem: isArtistView ? artistUpdate : isTagView ? tagUpdate : presetUpdate,
    removeItem: isArtistView ? artistRemove : isTagView ? tagRemove : presetRemove,
    setItemWeight: isArtistView ? artistSetWeight : isTagView ? tagSetWeight : presetSetWeight,
  };
}
