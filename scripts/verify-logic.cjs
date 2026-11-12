#!/usr/bin/env node
/**
 * 离线逻辑断言（不引入任何测试框架）。
 *
 * 流程：tsc -p tsconfig.verify.json 把 src/utils 与 src/constants 编译成 CommonJS，
 * 然后本脚本对编译产物做断言。因此断言跑的是真实业务代码，而不是复制品。
 *
 * 运行：npm run verify:logic
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, '..', '.verify-out');

// 本工程的 package.json 带 "type": "module"，而 tsc 编译出的是 CommonJS。
// 在加载产物之前放一个作用域标记，让 Node 按 CommonJS 解析 .verify-out 下的 .js。
fs.writeFileSync(path.join(OUT, 'package.json'), '{"type":"commonjs"}\n');

const load = (relative) => require(path.join(OUT, relative));

const {
  MODULE_COLORS,
  PRESET_FILTER_COLORS,
  PRESET_COLORS,
  COLORS,
  DEFAULT_PRESET_COLOR_ID,
} = load('constants/colors.js');
const { colorGradient, colorHex, findColor } = load('constants/colors.js');
const {
  MODULE_INITIAL_COUNT,
  MODULE_MAX_COUNT,
  MODULE_MIN_COUNT,
  MODULE_SOURCE_MAX_LENGTH,
  MODULE_DEFAULT_HEIGHT,
  INPUT_PANE_DEFAULT_HEIGHT,
  PRESET_PANEL_DEFAULT_WIDTH,
  PRESET_PANEL_DEFAULT_ROW_CAPACITY,
  PRESET_PANEL_MIN_WIDTH,
  PRESET_PANEL_SWATCH_COUNT,
  PRESET_SWATCH_SIZE,
  PRESET_SWATCH_GAP,
  PRESET_FILTER_PADDING,
  PRESET_PANEL_MAX_RATIO,
  PRESET_PANEL_STORAGE_MAX_WIDTH,
  DEFAULT_VIEWPORT_WIDTH,
  PUSH_PORT_MIN,
  PUSH_PORT_MAX,
  PUSH_DEFAULT_PORT,
  PUSH_BROADCAST_DEBOUNCE_MS,
  REALTIME_DEBOUNCE_MS,
} = load('constants/limits.js');
const { presetPanelMaxWidth, clampPresetPanelWidth } = load('utils/panelWidth.js');
const { paginate } = load('utils/pagination.js');
const {
  applySnapshotToModules,
  buildSnapshot,
  captureModules,
  updateSnapshotContent,
  visibleSnapshots,
} = load('utils/snapshot.js');
const { allocModuleColor, normalizeModuleColor, normalizePresetColor } = load('utils/color.js');
const {
  appendModule,
  buildInitialModules,
  canAddModule,
  canRemoveModule,
  dropModule,
  patchModule,
  reindexModules,
} = load('utils/moduleList.js');
const { sortPresets } = load('utils/presetSort.js');
const {
  plainEnglishOf,
  hasEnglish,
  composeFullCopyText,
  hasAnyEnglish,
  composeBroadcastText,
  composeBroadcastPayload,
  moduleLineOf,
} = load('utils/moduleText.js');
const { clampWeight } = load('utils/clamp.js');
const {
  nextPresetLabel,
  isPresetLabelTaken,
  capsuleNameFromSource,
  uniquePresetLabel,
  CAPSULE_AUTO_NAME_MAX,
} = load('utils/presetLabel.js');
const { sanitizePreset, sanitizePresets, FALLBACK_PRESET_LABEL } = load('utils/presetSanitize.js');
const { filterPresetsByColor, visiblePresets } = load('utils/presetFilter.js');
const {
  buildTranslatePlan,
  composeCopyText,
  normalizeTranslationBody,
  capsuleAnchor,
  countCapsuleOccurrences,
  pruneAnchors,
  removeCapsuleAnchors,
  restoreTranslation,
  sourceVisibleLength,
  clampSourceText,
  pruneOrphanCapsules,
  keepOnlyAnchors,
  orderCapsulesBySource,
  leadingCapsulesEnd,
} = load('utils/placeholder.js');
const { sanitizeModule, sanitizeModules, FALLBACK_CAPSULE_LABEL } = load('utils/moduleSanitize.js');
const {
  buildDraft,
  clearDraft,
  loadDraft,
  parseDraft,
  sanitizeLayout,
  saveDraft,
  serializeDraft,
  DEFAULT_LAYOUT,
  DRAFT_STORAGE_KEY,
} = load('utils/draft.js');
const { insertAtEnd, insertAfterCapsules } = load('utils/text.js');
const { clampPort, normalizePushSettings, isValidPort } = load('utils/pushSettings.js');
const { resolveDropAction, shouldStartDrag, isDoubleTap, dragCursor, isDangerHover, isInsertHover, isGroupHover, dragSourceColorId } =
  load('utils/dnd.js');
const { searchPresets, matchPreset } = load('utils/presetSearch.js');
const {
  normalizeFolderName,
  sanitizeFolders,
  folderNamesOf,
  knownFolders,
  sameFolder,
  nextFolderName,
  buildLibraryBlocks,
  paginateBlocks,
  renameFolderInItems,
  dissolveFolderInItems,
  folderOf,
  folderAccepts,
  pruneEmptyFolders,
  NEW_FOLDER_LABEL,
  MAX_FOLDER_NAME_LENGTH,
} = load('utils/presetFolders.js');
const { isFullyVisible, nextScrollTop } = load('utils/scrollIntoView.js');
const { MENU_EDGE_MARGIN, placeMenu } = load('utils/menuPlacement.js');
const { splitTopLevel: splitTopLevelShared } = load('utils/topLevelSplit.js');
const {
  assembleRowPrompt,
  composeRowPrompt,
  finishPromptText,
  traceRowPrompt,
} = load('utils/promptText.js');
const { insertCapsuleInto, setCapsuleWeightIn, updateModule } = load('utils/moduleList.js');
const {
  formatCapsuleWeight,
  migrateWeightFromEnglish,
  parseWeightInput,
  parseWeightedSegment,
  renderWeightedEnglish,
  renderWeightedSegment,
  roundCapsuleWeight,
  splitTopLevel,
  stepCapsuleWeight,
} = load('utils/capsuleWeight.js');
const {
  createProfile,
  sanitizeProfile,
  sanitizeProfiles,
  profileKind,
  FALLBACK_PROFILE_LABEL,
} = load('utils/profileSanitize.js');
const profileSanitizeModule = load('utils/profileSanitize.js');
const { toRustProfile } = load('utils/profileBridge.js');
const {
  DEFAULT_THEME,
  THEME_ATTRIBUTE,
  THEME_STORAGE_KEY,
  THEME_TOGGLE,
  applyThemeToDom,
  loadTheme,
  parseTheme,
  saveTheme,
  toggleTheme,
} = load('utils/theme.js');
const { resolveColorHex, resolveColorGradient } = load('utils/color.js');
const {
  connectionStatusOf,
  shouldAutoTest,
  CONNECTION_STATUS_TITLE,
  CONNECTION_STATUS_CLASS,
} = load('utils/connectionStatus.js');
const { buildCacheKey, CACHE_KEY_VERSION } = load('utils/translationCache.js');
const {
  normalizeTerm,
  sanitizeEntries,
  buildGlossaryIndex,
  resolveGlossaryTerm,
  formatGlossaryOutput,
  glossaryFingerprint,
} = load('utils/glossary.js');
const { moveId } = load('utils/reorder.js');
const { clampRange } = load('utils/clamp.js');
const { BAIDU_MIN_INTERVAL_MS, GLOSSARY_VERSION } = load('constants/limits.js');
const {
  CAPSULE_WEIGHT_DEFAULT,
  CAPSULE_WEIGHT_DECIMALS,
  CAPSULE_WEIGHT_MAX,
  CAPSULE_WEIGHT_MIN,
  CAPSULE_WEIGHT_STEP,
} = load('constants/limits.js');
const {
  SERVICE_BRANDS,
  DEFAULT_BRAND_ID,
  findServiceBrand,
  protocolOf,
  isBrandAvailable,
  BAIDU_APP_ID_ENV,
  BAIDU_APP_KEY_ENV,
} = load('constants/providers.js');
const providersRegistry = load('constants/providers.js');

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  [通过] ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`  [失败] ${name}`);
    console.log(`         ${error.message}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

// ---------------------------------------------------------------------------
section('颜色注册表（可增删，不写死）');

check('配色表 = 9 种模块色 + 词典 D + 画师 @ + 快照 S；模块与预设共用同一套（9↔9，D85）', () => {
  assert.equal(COLORS.length, 12, '调色板 = 9 种模块色 + 词典 D + 画师 @ + 快照 S');
  assert.equal(MODULE_COLORS.length, 9);
  assert.equal(PRESET_FILTER_COLORS.length, 9, '三个库切换块不进筛选条，筛选是 9 块');
  assert.deepEqual(
    PRESET_FILTER_COLORS.map((c) => c.id),
    MODULE_COLORS.map((c) => c.id),
    '筛选条必须与模块配色完全一致（不再有只给预设的「自由色」）',
  );
  assert.equal(
    COLORS.some((c) => c.id === 'white' || c.id === 'gray'),
    false,
    '自由色（白）与薄荷已经删除，不许回来',
  );
  const artistColor = findColor('artist');
  assert.ok(artistColor, '画师库专属色必须存在');
  assert.equal(artistColor.usage, 'artist', '画师色不能被模块/预设池子收走');
  // D85：词典块也是「库切换块」，同样不进模块池
  const dictionaryColor = findColor('dictionary');
  assert.ok(dictionaryColor, '词典库专属色必须存在');
  assert.equal(dictionaryColor.usage, 'dictionary', '词典色不能被模块/预设池子收走');
  // 一一对应的硬约束：上限与配色数量相等，否则「第 N 个模块拿不到自己的颜色」的老问题会回来
  assert.equal(MODULE_MAX_COUNT, MODULE_COLORS.length, '模块上限必须与配色数量相等');
});

check('D85：薄荷是颜色池最后一个色块，丁香已整条删除，新增的词典块用用户指定的 3 档渐变', () => {
  const mint = findColor('mint');
  assert.ok(mint, '缺少薄荷（mint）');
  assert.equal(mint.label, '薄荷');
  assert.equal(mint.usage, 'both', '薄荷必须同时是模块色与预设归属色');
  // 用户口径：「亮色、浅色系，不要深色」—— 起点色必须是浅的（#RRGGBB 三通道都偏高）
  const channels = [1, 3, 5].map((index) => parseInt(mint.hex.slice(index, index + 2), 16));
  assert.ok(
    channels.every((value) => value >= 0x9e),
    `${mint.id} 的起点色 ${mint.hex} 不够浅（要求三个通道都 ≥ 0x9e）`,
  );
  // 薄荷现在在颜色池的**末尾**，自动分配时发给第 9 个模块
  assert.deepEqual(MODULE_COLORS.slice(-1).map((c) => c.id), ['mint']);
  // D85：用户要求「直接去除注册表中的最后一个色块」—— 丁香必须整条消失
  assert.equal(findColor('lilac'), undefined, 'D85：丁香（lilac）必须已从注册表删除');
  // 新增的词典块：渐变是用户原文，一个字符都不许改写
  const dictionary = findColor('dictionary');
  assert.ok(dictionary, '缺少词典块（dictionary）');
  assert.equal(
    dictionary.gradient,
    'linear-gradient(-225deg, #D4FFEC 0%, #57F2CC 48%, #4596FB 100%)',
    '词典块的渐变必须与用户给的 CSS 完全一致',
  );
  assert.equal(colorGradient('dictionary'), dictionary.gradient, '取色出口必须原样返回词典渐变');
});

check('D77/D78 复杂渐变：画师与快照块用注册表里的整段 CSS，且不再进模块/预设池', () => {
  const artist = findColor('artist');
  const snapshot = findColor('snapshot');
  // 用户指定的三条色标渐变，必须**原样**写进 background（多档、带角度、连硬分界都不改写）
  assert.equal(artist.gradient, 'linear-gradient(to top, #d5dee7 0%, #ffafbd 0%, #c9ffbf 100%)');
  assert.equal(snapshot.gradient, 'linear-gradient(to top, #9795f0 0%, #fbc8d4 100%)');
  assert.equal(colorGradient('artist'), artist.gradient, '取色出口必须原样返回复杂渐变');
  assert.equal(colorGradient('snapshot'), snapshot.gradient);
  assert.equal(snapshot.usage, 'snapshot');
  // 三个库切换块都不许被当成模块色或归属色
  assert.equal(MODULE_COLORS.some((color) => color.id === 'artist' || color.id === 'snapshot'), false);
  assert.equal(PRESET_COLORS.some((color) => color.id === 'artist' || color.id === 'snapshot'), false);
  assert.equal(
    MODULE_COLORS.some((color) => color.id === 'dictionary'),
    false,
    'D85：词典块不是模块色',
  );
  assert.equal(
    PRESET_COLORS.some((color) => color.id === 'dictionary'),
    false,
    'D85：词典块不是预设归属色',
  );
  // 规范化：快照色不是归属色，落红；画师色是画师条目的合法归属色，放行；
  // D86：词典色是 Tag 库条目的合法归属色（与 T 色块同源），也必须放行
  assert.equal(normalizeModuleColor('artist'), MODULE_COLORS[0].id);
  assert.equal(normalizeModuleColor('snapshot'), MODULE_COLORS[0].id);
  assert.equal(normalizeModuleColor('dictionary'), MODULE_COLORS[0].id);
  assert.equal(normalizePresetColor('snapshot'), 'red');
  assert.equal(normalizePresetColor('dictionary'), 'dictionary', 'Tag 库条目要用词典色');
  assert.equal(normalizePresetColor('artist'), 'artist');
});

check('预设筛选条 = 9 种模块色，没有自由色；新建预设默认落红', () => {
  assert.equal(PRESET_FILTER_COLORS.length, MODULE_COLORS.length);
  assert.equal(PRESET_FILTER_COLORS.some((c) => c.id === 'white'), false);
  assert.equal(DEFAULT_PRESET_COLOR_ID, 'red', '新建预设默认落到第一个颜色（红）');
  assert.ok(findColor(DEFAULT_PRESET_COLOR_ID), '默认色必须在注册表里');
});

check('颜色 id 唯一，顺序稳定（换色只许改色值，绝不许改 id）', () => {
  const ids = COLORS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  /*
   * 这一串 id 是**历史数据的兼容契约**：预设与模块把 id 落盘，
   * 因此换颜色只能改 hex / label，**绝不能改 id 或删掉再新增**。
   * 2026 轮把第 8 位由「棕」换「粉」、第 9 位由「灰」换「薄荷」时，
   * 就是只改色值与显示名、id 原样保留的；本轮删除薄荷与白，剩下 8 个 id 原样不动。
   * D75 扩到 10 色时**新造**了 `brown` / `slate` 两个 id，刻意不复用已删的 `gray`：
   * 老数据里可能还留着 `gray`，复用会让那批预设"突然换色"。
   * D77 又把这两个新色换成 `mint` / `lilac`（用户要亮色系），同样是新造 id。
   * D85 删掉 `lilac`、新增 `dictionary`（词典块）—— 被删的 id **不许**再发出去给别的颜色。
   */
  assert.deepEqual(ids, [
    'red',
    'orange',
    'yellow',
    'green',
    'cyan',
    'blue',
    'purple',
    'pink',
    'mint',
    'dictionary',
    'artist',
    'snapshot',
  ]);

  for (const color of COLORS) {
    // D77：画师 / 快照块给的是整段复杂渐变，不再走 hex + hexTo 两档写法
    if (color.gradient) {
      assert.equal(color.variant, 'gradient', `${color.id} 应当是渐变`);
      assert.ok(color.gradient.startsWith('linear-gradient('), `${color.id} 的渐变必须是合法 CSS`);
      continue;
    }
    assert.equal(color.variant, 'gradient', `${color.id} 应当是渐变`);
    assert.ok(color.hexTo, `${color.id} 缺少渐变终点色`);
  }
});

check('色块行（D85）：9 色 + D + @ + S = 12 块；初始宽度 276px 排成 8+4；最低 211px 排 6+6', () => {
  assert.equal(
    PRESET_PANEL_SWATCH_COUNT,
    12,
    '色块行应当 12 块：9 色 + 词典 D + 画师 @ + 快照 S',
  );
  // D85 的算术：颜色池少了一个、库切换块多了一个，**总数不变**，所以宽度口径一个字都不用改
  assert.equal(
    PRESET_PANEL_SWATCH_COUNT,
    PRESET_FILTER_COLORS.length + 3,
    '色块行 = 筛选色 + 词典 D + 画师 @ + 快照 S',
  );
  assert.equal(PRESET_PANEL_DEFAULT_ROW_CAPACITY, 8, '初始宽度按「一行 8 块」算');
  assert.equal(
    PRESET_PANEL_DEFAULT_WIDTH,
    8 * PRESET_SWATCH_SIZE + 7 * PRESET_SWATCH_GAP + PRESET_FILTER_PADDING * 2 + 2,
    '初始宽度 = 一行 8 块 + 内边距 + 边框 + 余量',
  );
  assert.equal(PRESET_PANEL_DEFAULT_WIDTH, 276, '用户口径：第一排 8 个、第二排 4 个');
  assert.equal(MODULE_COLORS.length, 9, '库切换块不能进模块配色池');
  assert.equal(
    PRESET_FILTER_COLORS.some(
      (color) =>
        color.id === 'artist' || color.id === 'snapshot' || color.id === 'dictionary',
    ),
    false,
    '库切换块不能出现在颜色筛选条里（它们不是筛选）',
  );
  assert.equal(PRESET_COLORS.length, 9, '预设归属色是 9 种彩色');
});

check('快照（D67）：深拷贝 / 覆盖规则 / 按权重排序', () => {
  const modules = [
    { id: 'm1', order: 1, colorId: 'red', sourceText: '甲', capsules: [{ id: 'c1', presetId: 'p1', label: '一', english: 'one', colorId: 'red' }], translation: 'one', outputHeight: 56, status: 'done' },
    { id: 'm2', order: 2, colorId: 'blue', sourceText: '乙', capsules: [], translation: 'two', outputHeight: 56, status: 'done' },
    { id: 'm3', order: 3, colorId: 'green', sourceText: '丙', capsules: [], translation: 'three', outputHeight: 56, status: 'done' },
  ];
  const captured = captureModules(modules);
  assert.equal(captured.length, 3);
  assert.notEqual(captured[0].capsules, modules[0].capsules, '胶囊必须是副本');
  assert.equal(captured[0].capsules[0].english, 'one', '英文要一起存（原预设删了也能还原）');
  assert.equal(captured[0].colorId, 'red', '模块色要一起存');

  // 快照 2 排 → 当前 3 排：多余那排清空、保留壳
  const snapshot = buildSnapshot({ name: '两排', scope: 'global', modules: captured.slice(0, 2) });
  const applied = applySnapshotToModules(modules, snapshot);
  assert.equal(applied.length, 3, '多余模块不能被删');
  assert.equal(applied[2].sourceText, '', '多余模块内容要清空');
  assert.equal(applied[2].colorId, 'green', '壳的颜色保留');
  assert.equal(applied[0].sourceText, '甲');

  // 快照 3 排 → 当前 1 排：补模块（上限 8）
  const one = [modules[0]];
  const big = buildSnapshot({ name: '三排', scope: 'global', modules: captured });
  assert.equal(applySnapshotToModules(one, big).length, 3, '少了要补模块');

  // 排序：权重降序
  const list = [
    { id: 'a', name: '甲', scope: 'global', weight: 100, modules: [], createdAt: 1, updatedAt: 1 },
    { id: 'b', name: '乙', scope: 'global', weight: 300, modules: [], createdAt: 2, updatedAt: 2 },
    { id: 'c', name: '丙', scope: 'module', weight: 200, modules: [], createdAt: 3, updatedAt: 3 },
  ];
  assert.deepEqual(visibleSnapshots(list, '').map((s) => s.id), ['b', 'c', 'a']);
  assert.deepEqual(visibleSnapshots(list, '乙').map((s) => s.id), ['b']);
});

check('快照「更新」（D76）：只换内容，身份/名称/权重/创建时间都不动', () => {
  const base = buildSnapshot({
    name: '基座方案',
    scope: 'global',
    weight: 250,
    modules: [{ sourceText: '旧内容', colorId: 'red', capsules: [] }],
    copyText: 'old text.',
    now: 1000,
  });

  const replaced = captureModules([
    {
      id: 'm1',
      order: 1,
      colorId: 'blue',
      sourceText: '新内容',
      capsules: [],
      translation: 'new',
      outputHeight: 56,
      status: 'done',
    },
  ]);
  const updated = updateSnapshotContent(base, replaced, 'new text.', 2000);

  // 身份不动：否则「更新」就等于删了重建，权重与名字都会丢
  assert.equal(updated.id, base.id, 'id 必须保留');
  assert.equal(updated.name, '基座方案', '名称必须保留（哪怕用户改过名）');
  assert.equal(updated.scope, 'global');
  assert.equal(updated.weight, 250, '权重必须保留');
  assert.equal(updated.createdAt, 1000, '创建时间必须保留');
  // 内容整体替换
  assert.equal(updated.updatedAt, 2000, '更新时间要刷新');
  assert.equal(updated.modules.length, 1);
  assert.equal(updated.modules[0].sourceText, '新内容');
  assert.equal(updated.modules[0].colorId, 'blue', '模块色也要跟着换成当前工作区的');
  assert.equal(updated.copyText, 'new text.', 'copyText 必须一起换掉（复制按钮靠它）');

  // 单模块快照即使传进来整份工作区，也只留 1 个模块（与 buildSnapshot 同一条不变量）
  const single = buildSnapshot({ name: '单排方案', scope: 'module', modules: [], now: 1 });
  const many = captureModules(
    Array.from({ length: 3 }, (_, index) => ({
      id: `m${index}`,
      order: index + 1,
      colorId: 'red',
      sourceText: `第 ${index} 段`,
      capsules: [],
      translation: '',
      outputHeight: 56,
      status: 'idle',
    })),
  );
  assert.equal(updateSnapshotContent(single, many, 'x.', 2).modules.length, 1, '单模块快照只能存 1 个模块');
});

check('分页（D66）：固定条数、非法页码夹取、空列表也算 1 页', () => {
  const items = Array.from({ length: 305 }, (_, index) => index);
  const first = paginate(items, 1, 300);
  assert.equal(first.page, 1);
  assert.equal(first.pageCount, 2);
  assert.equal(first.items.length, 300);
  assert.equal(first.items[0], 0);

  const second = paginate(items, 2, 300);
  assert.equal(second.items.length, 5);
  assert.equal(second.items[0], 300);

  assert.equal(paginate(items, 99, 300).page, 2, '超出末页夹到末页');
  assert.equal(paginate(items, 0, 300).page, 1, '0 页夹到第 1 页');
  assert.equal(paginate(items, Number.NaN, 300).page, 1, 'NaN 夹到第 1 页');
  assert.deepEqual(paginate([], 1, 300), { page: 1, pageCount: 1, items: [] });
  assert.equal(paginate(items, 1, 0).pageCount, 305, '页大小 0 兜底成 1');
});

check('渐变字符串可直接写进 background，未知 id 有兜底值', () => {
  assert.ok(colorGradient('red').startsWith('linear-gradient('));
  assert.ok(colorGradient('red').includes(colorHex('red')));
  assert.ok(colorGradient('pink').startsWith('linear-gradient('), '粉也应当是渐变');
  // 未知 id（含历史数据里的 white / gray）也要给出可用的兜底值
  assert.ok(colorGradient('不存在').startsWith('#'));
});

check('预设库宽度三档：初始 276px 装一行 8 块（12 块 = 8+4）、最低 211px（6+6）、最大窗口 70%', () => {
  // 几何口径与 layout.css 一致（26px 块 + 6px 间距 + 12px×2 内边距 + 1px 边框），由 verify:interaction 守着
  assert.equal(PRESET_PANEL_DEFAULT_WIDTH, 276, '初始宽度 = 8×26 + 7×6 + 24 + 1 + 1');
  assert.equal(PRESET_PANEL_MIN_WIDTH, 211, '最低宽度 = 6 块一行（186 内宽 + 24 内边距 + 1 边框）');
  assert.equal(PRESET_PANEL_MAX_RATIO, 0.7);
  assert.equal(presetPanelMaxWidth(1360), 952, '1360 宽的窗口最多 70% = 952');
  assert.equal(
    presetPanelMaxWidth(0),
    Math.round(DEFAULT_VIEWPORT_WIDTH * 0.7),
    '没有窗口宽度时用兜底视口算 70%',
  );
  assert.equal(clampPresetPanelWidth(9999, 1360), 952, '超宽应当被夹到 70%');
  assert.equal(clampPresetPanelWidth(100, 1360), PRESET_PANEL_MIN_WIDTH, '过窄应当被夹到下限');
  assert.equal(clampPresetPanelWidth(Number.NaN, 1360), PRESET_PANEL_DEFAULT_WIDTH);
});

// ---------------------------------------------------------------------------
section('模块配色自动分配与释放（需求 8）');

check('初始 6 个模块拿到前 6 个配色：红橙黄绿青蓝', () => {
  const modules = buildInitialModules(MODULE_INITIAL_COUNT);
  assert.equal(modules.length, 6);
  assert.equal(MODULE_INITIAL_COUNT, 6);
  assert.deepEqual(
    modules.map((m) => m.colorId),
    ['red', 'orange', 'yellow', 'green', 'cyan', 'blue'],
  );
});

check('初始模块序号为 1..6', () => {
  const modules = buildInitialModules(6);
  assert.deepEqual(
    modules.map((m) => m.order),
    [1, 2, 3, 4, 5, 6],
  );
});

check('颜色分配确定：同一集合重复分配结果一致', () => {
  const first = buildInitialModules(4).map((m) => m.colorId);
  const second = buildInitialModules(4).map((m) => m.colorId);
  assert.deepEqual(first, second);
});

check('删除中间一个模块后，新模块复用被释放的颜色', () => {
  const modules = buildInitialModules(4); // 红 橙 黄 绿
  const afterDrop = dropModule(modules, modules[1].id, modules[0].id); // 删掉「橙」
  assert.ok(afterDrop);
  const appended = appendModule(afterDrop.modules);
  assert.ok(appended);
  assert.equal(appended.created.colorId, 'orange');
});

check('删除后序号重排为 1..n', () => {
  const modules = buildInitialModules(4);
  const afterDrop = dropModule(modules, modules[1].id, modules[0].id);
  assert.ok(afterDrop);
  assert.deepEqual(
    afterDrop.modules.map((m) => m.order),
    [1, 2, 3],
  );
});

check('删掉当前选中模块时，选中项落到相邻模块', () => {
  const modules = buildInitialModules(4);
  const afterDrop = dropModule(modules, modules[0].id, modules[0].id);
  assert.ok(afterDrop);
  assert.equal(afterDrop.selectedModuleId, modules[1].id);
});

check('颜色种类不足时轮转复用且不抛错', () => {
  const allUsed = MODULE_COLORS.map((c) => c.id);
  const color = allocModuleColor(allUsed);
  assert.equal(MODULE_COLORS.some((c) => c.id === color), true);
});

// ---------------------------------------------------------------------------
section('模块数量约束：初始 6 / 上限 9 / 下限 1（D85）');

check('上限 9：第 10 个模块被拦下（appendModule 返回 null）', () => {
  assert.equal(MODULE_MAX_COUNT, 9);
  let modules = buildInitialModules(MODULE_INITIAL_COUNT);
  while (modules.length < MODULE_MAX_COUNT) {
    const result = appendModule(modules);
    assert.ok(result, `第 ${modules.length + 1} 个模块应当允许创建`);
    modules = result.modules;
  }
  assert.equal(modules.length, MODULE_MAX_COUNT);
  assert.equal(canAddModule(modules), false);
  assert.equal(appendModule(modules), null);
});

/*
 * 9 个模块 ↔ 9 种颜色（D85，D75 的 10↔10 又收了一档）：正常使用下**每个模块都有自己的颜色、互不重复**。
 * 轮转复用只作为防御路径保留（万一将来颜色比上限少），因此这里不再覆盖它，
 * 改为直接钉住「去重后正好 9 种」这条用户可见的口径。
 */
check('每个模块都能拿到合法彩色，且 9 个模块颜色互不重复', () => {
  let modules = buildInitialModules(MODULE_INITIAL_COUNT);
  while (modules.length < MODULE_MAX_COUNT) {
    modules = appendModule(modules).modules;
  }
  const used = modules.map((m) => m.colorId);
  const legal = new Set(MODULE_COLORS.map((color) => color.id));
  assert.equal(used.includes('white'), false, '自由色已删除，不该出现在模块上');
  assert.equal(
    used.every((id) => legal.has(id)),
    true,
    '每个模块的颜色都必须是注册表里的彩色',
  );
  assert.equal(new Set(used).size, MODULE_COLORS.length, '9 个模块应当拿到 9 种不同颜色');
  assert.equal(MODULE_MAX_COUNT, MODULE_COLORS.length, '上限与配色数量必须相等（9↔9）');
});

check('下限 1：最后一个模块无法删除（dropModule 返回 null）', () => {
  let modules = buildInitialModules(MODULE_INITIAL_COUNT);
  while (modules.length > MODULE_MIN_COUNT) {
    const result = dropModule(modules, modules[0].id, modules[0].id);
    assert.ok(result);
    modules = result.modules;
  }
  assert.equal(modules.length, MODULE_MIN_COUNT);
  assert.equal(canRemoveModule(modules), false);
  assert.equal(dropModule(modules, modules[0].id, modules[0].id), null);
});

check('删除不存在的模块返回 null', () => {
  const modules = buildInitialModules(MODULE_INITIAL_COUNT);
  assert.equal(dropModule(modules, 'mod_不存在', modules[0].id), null);
});

// ---------------------------------------------------------------------------
section('打补丁：无变化时保持原引用（避免无意义重渲染）');

check('相同值打补丁返回原数组引用', () => {
  const modules = buildInitialModules(2);
  const next = patchModule(modules, modules[0].id, { sourceText: '' });
  assert.equal(next, modules);
});

check('不同值打补丁返回新数组且只改目标模块', () => {
  const modules = buildInitialModules(2);
  const next = patchModule(modules, modules[0].id, { sourceText: '中文内容' });
  assert.notEqual(next, modules);
  assert.equal(next[0].sourceText, '中文内容');
  assert.equal(next[1], modules[1]);
});

check('reindexModules 对已正确序号返回原引用', () => {
  const modules = buildInitialModules(3);
  assert.equal(reindexModules(modules), modules);
});

// ---------------------------------------------------------------------------
section('容错：历史数据里的非法颜色 id');

check('模块色规范化：通用不是合法模块色', () => {
  const normalized = normalizeModuleColor('common');
  assert.notEqual(normalized, 'common');
  assert.equal(
    MODULE_COLORS.some((c) => c.id === normalized),
    true,
  );
});

check('模块色规范化：未知 id 回落到第一个模块配色', () => {
  assert.equal(normalizeModuleColor('不存在的颜色'), MODULE_COLORS[0].id);
  assert.equal(normalizeModuleColor(undefined), MODULE_COLORS[0].id);
});

check('预设色规范化：未知 id（含历史的白 / 薄荷）统一回落到红', () => {
  assert.equal(normalizePresetColor('不存在的颜色'), 'red');
  assert.equal(normalizePresetColor(undefined), 'red');
  assert.equal(normalizePresetColor('white'), 'red', '旧数据里的自由色统一落到红（用户确认）');
  assert.equal(normalizePresetColor('gray'), 'red', '已删除的薄荷也统一落到红');
});

// ---------------------------------------------------------------------------
section('预设排序：权重降序 → 名称升序 → id 兜底（需求 6）');

check('权重降序优先于名称', () => {
  const list = [
    { id: 'a', label: '苹果', weight: 100 },
    { id: 'b', label: '低权重', weight: 0 },
    { id: 'c', label: '高权重', weight: 500 },
  ];
  assert.deepEqual(
    sortPresets(list).map((p) => p.label),
    ['高权重', '苹果', '低权重'],
  );
});

check('权重相同按名称升序（中文按拼音，数字按数值）', () => {
  const list = [
    { id: 'p2', label: '预设标签-2', weight: 100 },
    { id: 'apple', label: '苹果', weight: 100 },
    { id: 'p10', label: '预设标签-10', weight: 100 },
    { id: 'zebra', label: '斑马', weight: 100 },
  ];
  assert.deepEqual(
    sortPresets(list).map((p) => p.label),
    ['斑马', '苹果', '预设标签-2', '预设标签-10'],
  );
});

check('名称与权重都相同按 id 升序兜底', () => {
  const list = [
    { id: 'z', label: '同名', weight: 100 },
    { id: 'a', label: '同名', weight: 100 },
  ];
  assert.deepEqual(
    sortPresets(list).map((p) => p.id),
    ['a', 'z'],
  );
});

check('排序不修改入参', () => {
  const list = [
    { id: 'a', label: '苹果', weight: 1 },
    { id: 'b', label: '斑马', weight: 9 },
  ];
  const snapshot = list.map((p) => p.id);
  sortPresets(list);
  assert.deepEqual(
    list.map((p) => p.id),
    snapshot,
  );
});

// ---------------------------------------------------------------------------
section('展示与复制分离：界面看中文名，剪贴板才是英文（需求 1）');

check('没有胶囊时，复制内容就是译文本身（末尾句读被收掉）', () => {
  assert.equal(
    plainEnglishOf({ translation: 'Please rewrite this.', sourceText: '请改写', capsules: [] }),
    'Please rewrite this',
  );
});

check('有胶囊时，复制内容把术语英文拼在译文前面', () => {
  const module = {
    translation: 'Long hair, pink hair, smiling',
    sourceText: `${capsuleAnchor('cap_a')} 长头发，粉头发，微笑`,
    capsules: [
      {
        id: 'cap_a',
        label: '千早爱音',
        presetId: 'p1',
        english: 'Chihaya Anon',
        colorId: 'pink',
      },
    ],
  };
  assert.equal(
    plainEnglishOf(module),
    'Chihaya Anon, Long hair, pink hair, smiling',
    '复制出去的应当是可直接使用的英文',
  );
  // 展示用的译文里绝不能出现术语英文
  assert.equal(normalizeTranslationBody(module.translation).includes('Chihaya'), false);
});

check('多个胶囊重复出现时，复制内容按源内容顺序展开', () => {
  const capsules = [
    { id: 'cap_a', label: '甲', presetId: 'p1', english: 'Alpha', colorId: 'red' },
    { id: 'cap_b', label: '乙', presetId: 'p2', english: 'Beta', colorId: 'blue' },
  ];
  const module = {
    translation: 'body',
    sourceText: `${capsuleAnchor('cap_b')} ${capsuleAnchor('cap_a')} ${capsuleAnchor('cap_b')} 正文`,
    capsules,
  };
  assert.equal(plainEnglishOf(module), 'Beta, Alpha, Beta, body');
});

check('无译文也没胶囊时 hasEnglish 为假（界面据此提示而不复制）', () => {
  assert.equal(hasEnglish({ translation: '', sourceText: '', capsules: [] }), false);
  assert.equal(hasEnglish({ translation: '   ', sourceText: '   ', capsules: [] }), false);
  assert.equal(hasEnglish({ translation: 'Hello', sourceText: '', capsules: [] }), true);
});

check('只有胶囊、还没翻译时也算有可复制内容', () => {
  const module = {
    translation: '',
    sourceText: capsuleAnchor('cap_a'),
    capsules: [{ id: 'cap_a', label: '千早爱音', presetId: 'p1', english: 'Chihaya Anon', colorId: 'pink' }],
  };
  assert.equal(hasEnglish(module), true);
  assert.equal(plainEnglishOf(module), 'Chihaya Anon');
});

// ---------------------------------------------------------------------------
section('全文复制：按模块顺序拼接（需求：全文复制按钮）');

/** 造一个「胶囊英文 + 译文」的模块夹具 */
function copyModuleFixture({ english, translation, order = 0 }) {
  const capsuleId = `cap_${order}`;
  const capsules = english
    ? [{ id: capsuleId, label: `术语${order}`, presetId: `p${order}`, english, colorId: 'red' }]
    : [];
  return {
    translation,
    sourceText: english ? `${capsuleAnchor(capsuleId)} 中文${order}` : `中文${order}`,
    capsules,
  };
}

check('按从上到下顺序拼接：先英文逗号、再换行；末尾不加标点（D95）', () => {
  const text = composeFullCopyText([
    copyModuleFixture({ english: 'Alpha', translation: 'first body', order: 1 }),
    copyModuleFixture({ english: 'Beta', translation: 'second body', order: 2 }),
    copyModuleFixture({ english: 'Gamma', translation: 'third body', order: 3 }),
  ]);
  assert.equal(text, 'Alpha, first body, \nBeta, second body, \nGamma, third body');
  // 模块之间是「逗号 + 换行」，不是单纯换行
  assert.equal(text.split(', \n').length - 1, 2, '两个接缝处都应当是「逗号 + 换行」');
  assert.equal(text.split('\n').length, 3, '三个模块应当正好三行');
  assert.equal(text.endsWith('.'), false, '末尾不许再有英文句号（D95）');
  assert.equal(text.includes(', ,'), false);
});

check('只有一个模块时：不出现分隔符，末尾也没有句号', () => {
  const text = composeFullCopyText([
    copyModuleFixture({ english: 'Chihaya Anon', translation: 'long hair', order: 1 }),
  ]);
  assert.equal(text, 'Chihaya Anon, long hair');
  assert.equal(text.includes('\n'), false, '只有一个模块时不该有换行');
});

check('每排内部是「胶囊英文, 中文译文」，整体不带尾随标点', () => {
  const text = composeFullCopyText([
    copyModuleFixture({ english: 'Chihaya Anon', translation: 'long hair, pink hair', order: 1 }),
  ]);
  assert.equal(text, 'Chihaya Anon, long hair, pink hair');
});

check('中文为空时该行只保留胶囊英文（不留尾随逗号）', () => {
  const text = composeFullCopyText([
    copyModuleFixture({ english: 'Alpha', translation: '', order: 1 }),
    copyModuleFixture({ english: 'Beta', translation: 'body', order: 2 }),
  ]);
  assert.equal(text, 'Alpha, \nBeta, body');
  assert.equal(text.includes(', ,'), false);
});

check('空模块被跳过，不产生空行', () => {
  const empty = copyModuleFixture({ english: '', translation: '', order: 9 });
  const text = composeFullCopyText([
    empty,
    copyModuleFixture({ english: 'Alpha', translation: 'first', order: 1 }),
    empty,
    copyModuleFixture({ english: '', translation: 'orphan body', order: 3 }),
    copyModuleFixture({ english: 'Beta', translation: 'second', order: 2 }),
  ]);
  assert.equal(text, 'Alpha, first, \norphan body, \nBeta, second');
  assert.equal(text.includes(', ,'), false);
  // 关键：两个空模块被跳过，所以只有 3 行，没有空行、也没有首尾换行
  assert.equal(text.split('\n').length, 3, '不该产生空行');
  assert.equal(text.includes('\n\n'), false, '不该出现连续换行（空行）');
  assert.equal(text.startsWith(','), false, '开头不该是逗号');
  assert.equal(/\n,/.test(text), false, '换行之后不该紧跟逗号（逗号在换行之前）');
});

check('全是空模块时结果为空串（也不该凭空多出一个句号）', () => {
  const empties = [
    copyModuleFixture({ english: '', translation: '', order: 1 }),
    copyModuleFixture({ english: '', translation: '   ', order: 2 }),
  ];
  assert.equal(composeFullCopyText(empties), '');
  assert.equal(hasAnyEnglish(empties), false);
  assert.equal(hasAnyEnglish([]), false);
  assert.equal(
    hasAnyEnglish([copyModuleFixture({ english: 'Alpha', translation: '', order: 1 })]),
    true,
  );
});

check('每段都去掉了首尾空白，不会拼出「 , 」这种噪声', () => {
  const text = composeFullCopyText([
    copyModuleFixture({ english: '  Alpha  ', translation: '  body one  ', order: 1 }),
    copyModuleFixture({ english: 'Beta', translation: '   ', order: 2 }),
  ]);
  assert.equal(text, 'Alpha, body one, \nBeta');
  assert.equal(text.startsWith(' '), false);
  assert.equal(text.split('\n').length, 2);
});

// ---------------------------------------------------------------------------
section('孤儿胶囊回收：在编辑器里删掉药丸，胶囊条目必须同步消失（用户实测 bug）');

check('锚点没了，胶囊条目就被回收', () => {
  const capsules = [
    { id: 'cap_a', label: '甲' },
    { id: 'cap_b', label: '乙' },
  ];
  const sourceWithBoth = `${capsuleAnchor('cap_a')} 中文 ${capsuleAnchor('cap_b')}`;
  assert.deepEqual(pruneOrphanCapsules(sourceWithBoth, capsules), capsules, '都在时不动');

  // 用 Backspace 删掉第一个药丸：锚点消失
  const onlyB = `中文 ${capsuleAnchor('cap_b')}`;
  assert.deepEqual(
    pruneOrphanCapsules(onlyB, capsules).map((capsule) => capsule.id),
    ['cap_b'],
    'cap_a 的锚点没了，条目必须被回收',
  );

  // 全删空：两个都回收
  assert.deepEqual(pruneOrphanCapsules('只剩中文', capsules), []);
});

check('没有变化时返回原引用（避免无意义重渲染）', () => {
  const capsules = [{ id: 'cap_a', label: '甲' }];
  const source = `${capsuleAnchor('cap_a')} 中文`;
  assert.equal(pruneOrphanCapsules(source, capsules), capsules);
});

check('未知锚点（用户手打的普通文字）不会被误判成胶囊', () => {
  const capsules = [{ id: 'cap_a', label: '甲' }];
  const source = `${capsuleAnchor('cap_a')} 中文 [[cap:手打的]] 结尾`;
  assert.deepEqual(pruneOrphanCapsules(source, capsules), capsules);
});

check('只保留胶囊的原语：清文字不清胶囊（D61，模块枢拖回自身）', () => {
  const known = new Set(['cap_a', 'cap_b']);
  const source = `女孩，${capsuleAnchor('cap_a')}长头发，${capsuleAnchor('cap_b')}微笑`;
  assert.equal(
    keepOnlyAnchors(source, known),
    `${capsuleAnchor('cap_a')}${capsuleAnchor('cap_b')}`,
    '应当只剩两个锚点：文字与标点都清掉',
  );

  assert.equal(keepOnlyAnchors('只有中文，没有胶囊', known), '', '没有胶囊时清成空字符串');

  assert.equal(
    keepOnlyAnchors(`中文 [[cap:手打的]] 结尾`, known),
    '',
    '未知锚点按普通文字处理，随文字一起清掉',
  );
});

check('胶囊顺序：先拖入的在前（D79），显示顺序与源内容一致', () => {
  const capsules = [
    { id: 'cap_a', label: '甲' },
    { id: 'cap_b', label: '乙' },
  ];
  // D79 之后实际拖入是"排在已有胶囊之后"，源内容里锚点顺序就是拖入顺序 A→B
  const source = `${capsuleAnchor('cap_a')}${capsuleAnchor('cap_b')}`;
  assert.deepEqual(
    orderCapsulesBySource(source, capsules).map((capsule) => capsule.id),
    ['cap_a', 'cap_b'],
    '显示顺序必须跟源内容一致，不能按"加入先后"',
  );
  // 旧草稿里可能残留「后拖入的锚点在前」的内容，显示顺序仍以源内容为准
  const legacy = `${capsuleAnchor('cap_b')}${capsuleAnchor('cap_a')}`;
  assert.deepEqual(
    orderCapsulesBySource(legacy, capsules).map((capsule) => capsule.id),
    ['cap_b', 'cap_a'],
    '源内容顺序优先（兼容旧草稿）',
  );
  // 源内容里找不到的胶囊兜底追加，绝不丢
  assert.deepEqual(
    orderCapsulesBySource(capsuleAnchor('cap_a'), capsules).map((capsule) => capsule.id),
    ['cap_a', 'cap_b'],
  );
});

check('回收之后复制结果不再带上已删胶囊的术语英文', () => {
  const capsules = [
    { id: 'cap_a', label: '千早爱音', presetId: 'p1', english: 'Chihaya Anon', colorId: 'pink' },
  ];
  const sourceText = `中文 ${capsuleAnchor('cap_a')}`;
  const module = { translation: 'long hair', sourceText, capsules };
  assert.equal(plainEnglishOf(module), 'Chihaya Anon, long hair');

  // 用户在编辑器里删掉了药丸 → 锚点消失
  const pruned = {
    ...module,
    sourceText: '中文',
    capsules: pruneOrphanCapsules('中文', capsules),
  };
  assert.equal(
    plainEnglishOf(pruned),
    'long hair',
    '已删胶囊的术语英文不该再出现在复制结果里',
  );
});

// ---------------------------------------------------------------------------
section('缓存键：正文只由纯中文决定（胶囊是独立块）');

check('胶囊英文不参与正文缓存键（换术语不重翻正文）', () => {
  const base = {
    sourceText: '女孩',
    sourceLang: 'zh',
    targetLang: 'en',
    engine: 'baidu-translate',
    glossaryVersion: 'v0',
    segmentMode: 'slice-1000-punct',
  };
  const key = buildCacheKey(base);
  assert.equal(key.includes('Alpha'), false, '正文键里不该出现术语英文');
  assert.equal(
    buildCacheKey({ ...base, capsuleEnglish: ['Alpha'] }),
    buildCacheKey({ ...base, capsuleEnglish: ['Beta'] }),
    '正文缓存不依赖胶囊（多传的旧字段也不参与）',
  );
});

check('缓存键带版本号（改键结构后旧条目自动作废）', () => {
  const key = buildCacheKey({
    sourceText: 'x',
    sourceLang: 'zh',
    targetLang: 'en',
    engine: 'e',
    glossaryVersion: 'v0',
    segmentMode: 'slice-1000',
  });
  assert.ok(key.includes(CACHE_KEY_VERSION), `缓存键应当包含版本号 ${CACHE_KEY_VERSION}`);
});

// ---------------------------------------------------------------------------
section('本地词典：归一化、优先级与指纹（D50）');

check('术语归一化：去首尾空格、剥前导 @、折叠内部空白，不改大小写', () => {
  assert.equal(normalizeTerm('  千早爱音  '), '千早爱音');
  assert.equal(normalizeTerm('@千早爱音'), '千早爱音');
  assert.equal(normalizeTerm('@@千早爱音'), '千早爱音', '多个 @ 也剥掉');
  assert.equal(normalizeTerm('  @  千早   爱音 '), '千早 爱音', '内部连续空白折叠成一个');
  assert.equal(normalizeTerm('Chihaya  Anon'), 'Chihaya Anon', '绝不改大小写');
  assert.equal(normalizeTerm('   '), '');
});

check('合并索引：先出现的词典优先（列表越靠上优先级越高），停用词典跳过', () => {
  const dictA = {
    enabled: true,
    entries: [
      { cn: '千早爱音', en: 'chihaya anon' },
      { cn: '画风', en: 'art style' },
    ],
  };
  const dictB = {
    enabled: true,
    entries: [
      { cn: '千早爱音', en: 'wrong value' },
      { cn: '教室', en: 'classroom' },
    ],
  };
  const dictC = { enabled: false, entries: [{ cn: '若叶睦', en: 'wakaba mutsumi' }] };
  const index = buildGlossaryIndex([dictA, dictB, dictC]);
  assert.equal(index.size, 3, '停用词典的条目不该进索引');
  assert.equal(resolveGlossaryTerm(index, '千早爱音').en, 'chihaya anon', '先到先得');
  assert.equal(resolveGlossaryTerm(index, '若叶睦'), null, '停用的词典不参与匹配');
  assert.equal(buildGlossaryIndex([]).size, 0);
});

check('整段精确匹配：忽略首尾空格、支持 @，不做子串替换', () => {
  const index = buildGlossaryIndex([
    { enabled: true, entries: [{ cn: '千早爱音', en: 'chihaya anon' }] },
  ]);
  assert.equal(resolveGlossaryTerm(index, ' 千早爱音 ').en, 'chihaya anon');
  const at = resolveGlossaryTerm(index, '@千早爱音');
  assert.equal(at.en, 'chihaya anon');
  assert.equal(at.keepAt, true, '要记住原片段带 @（输出时保留）');
  assert.equal(formatGlossaryOutput(at), '@chihaya anon', '保留 @ 前缀（用户选择）');
  assert.equal(resolveGlossaryTerm(index, '千早爱音的粉色长发'), null, '全词匹配，不做子串替换');
  assert.equal(resolveGlossaryTerm(index, ''), null);
  assert.equal(resolveGlossaryTerm(index, '  '), null);
});

check('多对一：多个中文键可以指向同一个英文，全部保留且都能命中', () => {
  const index = buildGlossaryIndex([
    {
      enabled: true,
      entries: [
        { cn: '千早爱音', en: 'chihaya anon' },
        { cn: '爱音', en: 'chihaya anon' },
        { cn: '千早', en: 'chihaya anon' },
      ],
    },
  ]);
  assert.equal(index.size, 3, '不同的中文键不能被英文相同的去重合并');
  assert.equal(resolveGlossaryTerm(index, '千早爱音').en, 'chihaya anon');
  assert.equal(resolveGlossaryTerm(index, '爱音').en, 'chihaya anon');
  assert.equal(resolveGlossaryTerm(index, '千早').en, 'chihaya anon');
});

check('词典里的英文本身带 @ 时，输出不会重复加 @', () => {
  const index = buildGlossaryIndex([{ enabled: true, entries: [{ cn: '画师', en: '@kantoku' }] }]);
  assert.equal(formatGlossaryOutput(resolveGlossaryTerm(index, '@画师')), '@kantoku');
  // 不带 @ 的片段也不会被硬加前缀
  assert.equal(formatGlossaryOutput(resolveGlossaryTerm(index, '画师')), '@kantoku');
});

check('条目清洗：丢空、去重保首条、未知形状安全忽略', () => {
  const entries = sanitizeEntries([
    { cn: '甲', en: 'a' },
    { cn: ' 甲 ', en: 'b' },
    { cn: '', en: 'x' },
    { cn: '乙', en: '   ' },
    { cn: '丙', en: 'c' },
    null,
    '坏数据',
    { cn: 1, en: 2 },
  ]);
  assert.deepEqual(entries.map((entry) => entry.cn), ['甲', '丙']);
  assert.deepEqual(sanitizeEntries('不是数组'), []);
});

check('词典指纹：同一配置稳定；导入/删除/排序/启停/条数变化都会变；术语版本已升 v1', () => {
  const base = [
    { id: 'a.json', order: 0, enabled: true, entryCount: 10, importedAt: 1 },
    { id: 'b.json', order: 1, enabled: true, entryCount: 20, importedAt: 2 },
  ];
  const first = glossaryFingerprint(base);
  assert.equal(first, glossaryFingerprint([...base]), '同一配置必须稳定');
  assert.notEqual(first, glossaryFingerprint([base[0], { ...base[1], enabled: false }]), '启停要变');
  // 顺序 = 优先级：重排后每条词典的 order 会变，指纹也必须跟着变
  assert.notEqual(
    first,
    glossaryFingerprint([{ ...base[0], order: 1 }, { ...base[1], order: 0 }]),
    '顺序要变',
  );
  assert.notEqual(first, glossaryFingerprint([base[0], { ...base[1], entryCount: 21 }]), '条数要变');
  assert.notEqual(first, glossaryFingerprint([base[0], { ...base[1], importedAt: 3 }]), '重新导入要变');
  assert.equal(glossaryFingerprint([]), 'empty');
  assert.equal(GLOSSARY_VERSION, 'v1', '词典落地后术语版本必须升到 v1（旧缓存作废）');
});

check('列表重排 moveId：正常移动、越界夹取、非法起点不动', () => {
  assert.deepEqual(moveId(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a']);
  assert.deepEqual(moveId(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b']);
  assert.deepEqual(moveId(['a', 'b', 'c'], 1, 9), ['a', 'c', 'b'], '越界夹到最后一位');
  assert.deepEqual(moveId(['a', 'b', 'c'], -1, 0), ['a', 'b', 'c'], '非法起点原样返回');
});

// ---------------------------------------------------------------------------
section('预设默认命名：「胶囊 1」起，取未占用的最小编号');

check('空预设库给出「胶囊 1」', () => {
  assert.equal(nextPresetLabel([]), '胶囊 1');
});

check('已有 胶囊 1 时给出「胶囊 2」', () => {
  assert.equal(nextPresetLabel([{ label: '胶囊 1' }]), '胶囊 2');
});

check('取最小未占用编号（1、3 已用时给出 2）', () => {
  assert.equal(nextPresetLabel([{ label: '胶囊 1' }, { label: '胶囊 3' }]), '胶囊 2');
});

check('编号会被回收：只剩 胶囊 4 时给出 1', () => {
  assert.equal(nextPresetLabel([{ label: '胶囊 4' }]), '胶囊 1');
});

check('默认命名不参与重名判定之外的其他逻辑', () => {
  const presets = [{ id: 'a', label: '胶囊 1' }];
  assert.equal(isPresetLabelTaken(presets, '胶囊 1'), true);
  assert.equal(isPresetLabelTaken(presets, '胶囊 1', 'a'), false);
  assert.equal(isPresetLabelTaken(presets, '胶囊 2'), false);
  assert.equal(isPresetLabelTaken([{ id: 'b', label: '  苹果  ' }], '苹果'), true);
});

// ---------------------------------------------------------------------------
section('权重边界：默认 100 / 最低 0 / 无上限（需求 5）');

check('负数被夹到 0', () => {
  assert.equal(clampWeight(-5), 0);
  assert.equal(clampWeight(-0.5), 0);
});

check('0 合法', () => {
  assert.equal(clampWeight(0), 0);
});

check('小数向下取整', () => {
  assert.equal(clampWeight(3.7), 3);
});

check('非法输入回落到默认 100', () => {
  assert.equal(clampWeight(Number.NaN), 100);
  assert.equal(clampWeight(Number.POSITIVE_INFINITY), 100);
});

check('没有上限', () => {
  assert.equal(clampWeight(1_000_000), 1_000_000);
});

// ---------------------------------------------------------------------------
section('脏数据规范化：一条坏数据不能毁掉整个预设库');

check('未知颜色回落到「通用」', () => {
  assert.equal(sanitizePreset({ id: 'p1', label: '甲', colorId: '不存在的颜色' }).colorId, DEFAULT_PRESET_COLOR_ID);
});

check('负权重被夹到 0', () => {
  assert.equal(sanitizePreset({ id: 'p1', label: '甲', weight: -20 }).weight, 0);
});

check('空命名回落到「未命名预设」', () => {
  assert.equal(sanitizePreset({ id: 'p1', label: '   ' }).label, FALLBACK_PRESET_LABEL);
});

check('缺字段被补齐（id / 时间戳自动生成）', () => {
  const preset = sanitizePreset({});
  assert.ok(preset.id.length > 0);
  assert.equal(preset.english, '');
  assert.equal(preset.weight, 100);
  assert.equal(preset.colorId, DEFAULT_PRESET_COLOR_ID);
  assert.ok(Number.isFinite(preset.createdAt));
  assert.ok(Number.isFinite(preset.updatedAt));
});

check('重复 id 会被拆开（避免 React 列表 key 冲突）', () => {
  const list = sanitizePresets([
    { id: 'same', label: '甲' },
    { id: 'same', label: '乙' },
  ]);
  assert.equal(list.length, 2);
  assert.notEqual(list[0].id, list[1].id);
});

check('非数组输入得到空列表', () => {
  assert.deepEqual(sanitizePresets(null), []);
  assert.deepEqual(sanitizePresets({ presets: [] }), []);
  assert.deepEqual(sanitizePresets('[]'), []);
});

check('一整份脏数据都能变成可用预设', () => {
  const list = sanitizePresets([{}, { label: '甲', weight: -1, colorId: '怪色' }]);
  assert.equal(list.length, 2);
  assert.equal(list[0].label, FALLBACK_PRESET_LABEL);
  assert.equal(list[1].weight, 0);
  assert.equal(list[1].colorId, DEFAULT_PRESET_COLOR_ID);
});

// ---------------------------------------------------------------------------
section('预设筛选（仅按颜色多选，空选=全部）与可见列表');

const fixture = [
  { id: 'a', label: '红的低权重', weight: 10, colorId: 'red' },
  { id: 'b', label: '橙的高权重', weight: 900, colorId: 'orange' },
  { id: 'c', label: '红的高权重', weight: 500, colorId: 'red' },
  { id: 'd', label: '通用', weight: 100, colorId: 'common' },
];

check('空筛选返回全部', () => {
  assert.equal(filterPresetsByColor(fixture, []).length, 4);
});

check('单色筛选只留该色', () => {
  assert.deepEqual(
    filterPresetsByColor(fixture, ['red']).map((p) => p.id),
    ['a', 'c'],
  );
});

check('多色筛选取并集', () => {
  assert.deepEqual(
    filterPresetsByColor(fixture, ['red', 'common']).map((p) => p.id),
    ['a', 'c', 'd'],
  );
});

check('筛选结果仍按权重降序排列', () => {
  assert.deepEqual(
    visiblePresets(fixture, []).map((p) => p.id),
    ['b', 'c', 'd', 'a'],
  );
  assert.deepEqual(
    visiblePresets(fixture, ['red']).map((p) => p.id),
    ['c', 'a'],
  );
});

check('筛选与排序都不修改入参', () => {
  const snapshot = fixture.map((p) => p.id);
  visiblePresets(fixture, ['red']);
  assert.deepEqual(
    fixture.map((p) => p.id),
    snapshot,
  );
});

// ---------------------------------------------------------------------------
section('插入规则（D79）：胶囊区内部不留空格、与文字之间留一个空格');

check('空内容插入不带多余空格', () => {
  assert.equal(insertAfterCapsules('', 'X'), 'X');
  assert.equal(insertAtEnd('', 'X'), 'X');
});

check('开头没有胶囊时：插在最前面，与文字之间一个空格', () => {
  assert.equal(insertAfterCapsules('内容', 'X'), 'X 内容');
  assert.equal(insertAtEnd('内容', 'X'), '内容 X');
});

check('已有胶囊时：紧跟最后一颗，不再加空格', () => {
  assert.equal(insertAfterCapsules('[[cap:cap_a]]', '[[cap:cap_b]]'), '[[cap:cap_a]][[cap:cap_b]]');
  // 胶囊区与后面文字之间保留（并收敛成）一个空格
  assert.equal(
    insertAfterCapsules('[[cap:cap_a]]   中文', '[[cap:cap_b]]'),
    '[[cap:cap_a]][[cap:cap_b]] 中文',
  );
});

check('空片段不改变原内容', () => {
  assert.equal(insertAfterCapsules('内容', ''), '内容');
  assert.equal(insertAtEnd('内容', ''), '内容');
});

// ---------------------------------------------------------------------------
section('拖预设落入模块：胶囊插入、快照、移除（需求 9、需求 10）');

const capsuleSource = {
  presetId: 'preset_1',
  label: '冷峻文风',
  english: 'in a cold, restrained tone',
};

check('拖入胶囊：锚点插在开头区域，与手打文字之间一个空格', () => {
  const modules = buildInitialModules(1);
  const id = modules[0].id;
  const withText = updateModule(modules, id, (module) => ({
    ...module,
    sourceText: '把这段话改写得更礼貌',
  }));
  const next = insertCapsuleInto(withText, id, capsuleSource, 'after-capsules');
  const capsule = next[0].capsules[0];
  assert.equal(next[0].sourceText, `${capsuleAnchor(capsule.id)} 把这段话改写得更礼貌`);
});

check('插到末尾这条路径仍然可用（当前界面不走它）', () => {
  const modules = buildInitialModules(1);
  const id = modules[0].id;
  const withText = updateModule(modules, id, (module) => ({
    ...module,
    sourceText: '把这段话改写得更礼貌',
  }));
  const next = insertCapsuleInto(withText, id, capsuleSource, 'end');
  const capsule = next[0].capsules[0];
  assert.equal(next[0].sourceText, `把这段话改写得更礼貌 ${capsuleAnchor(capsule.id)}`);
});

check('空模块落入不带多余空格', () => {
  const modules = buildInitialModules(1);
  const id = modules[0].id;
  const next = insertCapsuleInto(modules, id, capsuleSource, 'after-capsules');
  assert.equal(next[0].sourceText, capsuleAnchor(next[0].capsules[0].id));
});

// ---------------------------------------------------------------------------
section('胶囊插入顺序与空格（D79）');

check('连续拖入三颗：先拖入的在前，锚点之间一个空格都不留', () => {
  let modules = buildInitialModules(1);
  const id = modules[0].id;
  const insert = (label) => {
    modules = insertCapsuleInto(
      modules,
      id,
      { presetId: `p_${label}`, label, english: label, colorId: 'red' },
      'after-capsules',
    );
    const list = modules[0].capsules;
    return list[list.length - 1].id;
  };
  const first = insert('甲');
  const second = insert('乙');
  const third = insert('丙');

  assert.equal(
    modules[0].sourceText,
    `${capsuleAnchor(first)}${capsuleAnchor(second)}${capsuleAnchor(third)}`,
    '锚点顺序 = 拖入顺序，且彼此紧挨',
  );
  assert.equal(/\s/.test(modules[0].sourceText), false, '三颗胶囊之间不该出现任何空格');
  assert.deepEqual(
    orderCapsulesBySource(modules[0].sourceText, modules[0].capsules).map((c) => c.id),
    [first, second, third],
    '输出区显示顺序也必须是 甲、乙、丙',
  );
});

check('先打字再拖：新胶囊排进胶囊区，中文前只留一个空格', () => {
  let modules = buildInitialModules(1);
  const id = modules[0].id;
  modules = updateModule(modules, id, (module) => ({ ...module, sourceText: '长头发，微笑' }));

  modules = insertCapsuleInto(
    modules,
    id,
    { presetId: 'p_a', label: '甲', english: 'a', colorId: 'red' },
    'after-capsules',
  );
  const first = modules[0].capsules[0].id;
  assert.equal(modules[0].sourceText, `${capsuleAnchor(first)} 长头发，微笑`);

  modules = insertCapsuleInto(
    modules,
    id,
    { presetId: 'p_b', label: '乙', english: 'b', colorId: 'red' },
    'after-capsules',
  );
  const second = modules[0].capsules[1].id;
  assert.equal(
    modules[0].sourceText,
    `${capsuleAnchor(first)}${capsuleAnchor(second)} 长头发，微笑`,
    '第二颗紧跟第一颗，中文前仍只一个空格',
  );
  assert.equal(/\s{2,}/.test(modules[0].sourceText), false, '不能出现连续空格');
});

check('leadingCapsulesEnd：只认开头那串锚点，不吞后面的文字', () => {
  const a = capsuleAnchor('cap_a');
  const b = capsuleAnchor('cap_b');
  assert.equal(leadingCapsulesEnd(''), 0);
  assert.equal(leadingCapsulesEnd('中文'), 0, '开头不是锚点就是 0');
  assert.equal(leadingCapsulesEnd(a), a.length);
  assert.equal(leadingCapsulesEnd(a + b), (a + b).length);
  assert.equal(leadingCapsulesEnd(`${a} ${b}`), (a + b).length + 1, '锚点之间的空白算在区块内');
  assert.equal(leadingCapsulesEnd(`${a}中文`), a.length, '锚点后面的文字不算进来');
  assert.equal(leadingCapsulesEnd(`中文${a}`), 0, '文字在前的锚点不算"开头那串"');
});

check('胶囊快照了预设的中文名与英文内容', () => {
  const modules = buildInitialModules(1);
  const next = insertCapsuleInto(modules, modules[0].id, capsuleSource, 'end');
  const capsule = next[0].capsules[0];
  assert.equal(capsule.label, '冷峻文风');
  assert.equal(capsule.english, 'in a cold, restrained tone');
  assert.equal(capsule.presetId, 'preset_1');
  assert.ok(capsule.id.length > 0);
});

check('对不存在的模块操作时保持原数组引用', () => {
  const modules = buildInitialModules(1);
  assert.equal(insertCapsuleInto(modules, 'mod_不存在', capsuleSource, 'end'), modules);
});

check('移除胶囊同时清掉它在源内容里的全部锚点', () => {
  const modules = buildInitialModules(1);
  const id = modules[0].id;
  const once = insertCapsuleInto(modules, id, capsuleSource, 'after-capsules');
  const capsuleId = once[0].capsules[0].id;
  // 手工再插一次同一个锚点，模拟同一胶囊在源内容里出现多次
  const twice = updateModule(once, id, (module) => ({
    ...module,
    sourceText: `${module.sourceText} 以及 ${capsuleAnchor(capsuleId)} 结尾`,
  }));

  assert.equal(countCapsuleOccurrences(twice[0].sourceText, capsuleId), 2);
  assert.equal(removeCapsuleAnchors(twice[0].sourceText, capsuleId).includes('[[cap:'), false);
});

check('对不存在的胶囊做移除时保持原数组引用', () => {
  const modules = buildInitialModules(1);
  const { removeCapsuleFrom } = load('utils/moduleList.js');
  assert.equal(removeCapsuleFrom(modules, modules[0].id, 'cap_不存在'), modules);
});

check('胶囊改名只影响这一条，且拒绝空白名', () => {
  const { renameCapsuleIn } = load('utils/moduleList.js');
  const modules = buildInitialModules(1);
  const id = modules[0].id;
  const inserted = insertCapsuleInto(modules, id, capsuleSource, 'after-capsules');
  const capsuleId = inserted[0].capsules[0].id;

  const renamed = renameCapsuleIn(inserted, id, capsuleId, '  克制的冷峻  ');
  assert.equal(renamed[0].capsules[0].label, '克制的冷峻');
  assert.equal(renamed[0].capsules[0].english, 'in a cold, restrained tone');
  assert.equal(renameCapsuleIn(inserted, id, capsuleId, '   '), inserted);
});

// ---------------------------------------------------------------------------
section('翻译请求与拼接（需求 6：不再用占位符，胶囊英文拼在最前面）');

function planOf(sourceText) {
  return buildTranslatePlan(sourceText, [
    { id: 'cap_1', label: '冷峻文风', presetId: 'p1', english: 'in a cold, restrained tone', colorId: 'blue' },
    { id: 'cap_2', label: '商务语气', presetId: 'p2', english: 'in a formal business tone', colorId: 'green' },
  ]);
}

check('请求体里只有纯中文：胶囊被剔掉，术语英文不进请求', () => {
  const plan = planOf(`${capsuleAnchor('cap_1')} 把这句话改写得更礼貌`);
  assert.equal(plan.text, '把这句话改写得更礼貌');
  assert.equal(plan.text.includes('cold'), false, '术语英文绝不能出现在请求体里');
  assert.deepEqual(plan.capsuleEnglish, ['in a cold, restrained tone']);
});

check('无胶囊时请求体就是原文，胶囊英文为空', () => {
  const plan = planOf('把这段话改写得更礼貌');
  assert.equal(plan.text, '把这段话改写得更礼貌');
  assert.deepEqual(plan.capsuleEnglish, []);
});

check('多个胶囊按原顺序排在译文最前面，用逗号连接', () => {
  const plan = planOf(`${capsuleAnchor('cap_2')} ${capsuleAnchor('cap_1')} 写一句邀请`);
  assert.deepEqual(plan.capsuleEnglish, [
    'in a formal business tone',
    'in a cold, restrained tone',
  ]);
  assert.equal(
    composeCopyText(plan.capsuleEnglish, 'write an invitation'),
    'in a formal business tone, in a cold, restrained tone, write an invitation',
  );
});

check('同一个胶囊出现多次就重复拼接多次', () => {
  const plan = planOf(`${capsuleAnchor('cap_1')} 与 ${capsuleAnchor('cap_1')}`);
  assert.deepEqual(plan.capsuleEnglish, [
    'in a cold, restrained tone',
    'in a cold, restrained tone',
  ]);
});

check('只拖了胶囊、还没写中文时，译文只有胶囊英文', () => {
  const plan = planOf(capsuleAnchor('cap_1'));
  assert.equal(plan.text, '');
  assert.equal(composeCopyText(plan.capsuleEnglish, ''), 'in a cold, restrained tone');
});

check('胶囊在源内容中间也照样排到最前面（需求 6：不再分左右）', () => {
  const plan = planOf(`前面 ${capsuleAnchor('cap_1')} 后面`);
  assert.equal(plan.text, '前面  后面');
  assert.equal(
    composeCopyText(plan.capsuleEnglish, 'before and after'),
    'in a cold, restrained tone, before and after',
  );
});

check('正文收口、胶囊原样；接缝只在原文已带逗号时不重复补', () => {
  const plan = planOf(`${capsuleAnchor('cap_1')} 写一句邀请。`);
  // 口径（用户 2026-11）：胶囊英文**绝对原样** —— 术语自带的句号/波浪号不是句读
  assert.equal(
    composeCopyText(['Chihaya Anon.'], 'Write an invitation.'),
    'Chihaya Anon., Write an invitation',
    '术语自带的句号必须原样保留（不再被收口收掉）',
  );
  assert.equal(
    composeCopyText(['Chihaya Anon,'], 'Write an invitation.'),
    'Chihaya Anon, Write an invitation',
    '术语已经以逗号结尾时只补空白，不会出现 ", , "',
  );
  // 展示层完全不改标点
  assert.equal(normalizeTranslationBody('Write an invitation.'), 'Write an invitation.');
  // 正文末尾仍不补标点
  assert.equal(
    composeCopyText(plan.capsuleEnglish, 'Write an invitation.'),
    'in a cold, restrained tone, Write an invitation',
  );
});

check('术语英文含 $ 时不会被当作替换序列（模板字符串不再是替换手段）', () => {
  const plan = buildTranslatePlan(capsuleAnchor('cap_1'), [
    { id: 'cap_1', label: '价格', presetId: 'p1', english: 'cost of $& per unit', colorId: 'white' },
  ]);
  assert.equal(composeCopyText(plan.capsuleEnglish, ''), 'cost of $& per unit');
});

check('英文内容为空的胶囊不参与拼接，也不留下多余逗号', () => {
  const plan = buildTranslatePlan(`${capsuleAnchor('cap_1')} 写一句邀请`, [
    { id: 'cap_1', label: '空术语', presetId: 'p1', english: '   ', colorId: 'white' },
  ]);
  assert.deepEqual(plan.capsuleEnglish, []);
  assert.equal(composeCopyText(plan.capsuleEnglish, 'Write an invitation'), 'Write an invitation');
});

// ---------------------------------------------------------------------------
section('指针拖拽：阈值、双击、半区判定与落点动作');

const moduleSource = { kind: 'module', moduleId: 'm1', label: '模块 1', colorId: 'red' };
const presetSource = { kind: 'preset', presetId: 'p1', label: '冷峻文风', colorId: 'blue' };

check('移动不足阈值不算拖拽（避免把点击当成拖拽）', () => {
  assert.equal(shouldStartDrag({ x: 100, y: 100 }, { x: 102, y: 101 }, 6), false);
  assert.equal(shouldStartDrag({ x: 100, y: 100 }, { x: 100, y: 100 }, 6), false);
});

check('移动超过阈值即算拖拽（各方向都成立）', () => {
  assert.equal(shouldStartDrag({ x: 100, y: 100 }, { x: 107, y: 100 }, 6), true);
  assert.equal(shouldStartDrag({ x: 100, y: 100 }, { x: 100, y: 107 }, 6), true);
  assert.equal(shouldStartDrag({ x: 100, y: 100 }, { x: 105, y: 105 }, 6), true);
});

check('双击判定：时间与距离都满足才算', () => {
  const first = { x: 100, y: 100, at: 1000 };
  assert.equal(isDoubleTap(first, { x: 100, y: 100 }, 1200, 400, 6), true);
  assert.equal(isDoubleTap(first, { x: 104, y: 103 }, 1200, 400, 6), true);
  // 太慢
  assert.equal(isDoubleTap(first, { x: 100, y: 100 }, 1500, 400, 6), false);
  // 太远
  assert.equal(isDoubleTap(first, { x: 140, y: 100 }, 1200, 400, 6), false);
  // 没有前一次点击
  assert.equal(isDoubleTap(null, { x: 100, y: 100 }, 1200, 400, 6), false);
});

check('模块枢拖到预设库 → 保存为预设（需求 9）', () => {
  assert.deepEqual(resolveDropAction(moduleSource, { kind: 'preset-panel' }), {
    action: 'save-preset',
    moduleId: 'm1',
  });
});

check('模块枢拖回自身 → 清空该模块（需求 9）', () => {
  assert.deepEqual(resolveDropAction(moduleSource, { kind: 'module', moduleId: 'm1' }), {
    action: 'clear-module',
    moduleId: 'm1',
  });
});

check('模块枢拖到别的模块或其他位置 → 取消（需求 9）', () => {
  assert.deepEqual(resolveDropAction(moduleSource, { kind: 'module', moduleId: 'm2' }), {
    action: 'cancel',
  });
  assert.deepEqual(resolveDropAction(moduleSource, null), { action: 'cancel' });
});

check('预设拖到任意模块 → 插入胶囊（D79：排在已有胶囊之后，仍在译文之前）', () => {
  assert.deepEqual(resolveDropAction(presetSource, { kind: 'module', moduleId: 'm3' }), {
    action: 'insert-capsule',
    moduleId: 'm3',
  });
  // 落点里已经没有 half 这个概念了
  assert.equal('half' in { kind: 'module', moduleId: 'm3' }, false);
});

check('预设拖到预设库或空白处 → 取消', () => {
  assert.deepEqual(resolveDropAction(presetSource, { kind: 'preset-panel' }), { action: 'cancel' });
  assert.deepEqual(resolveDropAction(presetSource, null), { action: 'cancel' });
});

check('光标：能放就抓取，不能放就禁止', () => {
  assert.equal(dragCursor({ action: 'cancel' }), 'no-drop');
  assert.equal(dragCursor({ action: 'save-preset', moduleId: 'm1' }), 'grabbing');
  assert.equal(dragCursor({ action: 'clear-module', moduleId: 'm1' }), 'grabbing');
  assert.equal(dragCursor({ action: 'insert-capsule', moduleId: 'm1' }), 'grabbing');
});

check('危险高亮只出现在「模块枢悬停在自己那一排」时', () => {
  const hoverSelf = { kind: 'module', moduleId: 'm1' };
  assert.equal(isDangerHover(moduleSource, hoverSelf, 'm1'), true);
  assert.equal(isDangerHover(moduleSource, hoverSelf, 'm2'), false);
  // 拖的是预设时不是危险态，而是插入态
  assert.equal(isDangerHover(presetSource, hoverSelf, 'm1'), false);
  assert.equal(isInsertHover(presetSource, hoverSelf, 'm1'), true);
  assert.equal(isInsertHover(moduleSource, hoverSelf, 'm1'), false);
  assert.equal(isInsertHover(presetSource, { kind: 'preset-panel' }, 'm1'), false);
});

check('高亮颜色取拖拽源自己的颜色（需求 3：不再是统一的主题蓝）', () => {
  assert.equal(dragSourceColorId(presetSource), 'blue');
  assert.equal(dragSourceColorId(moduleSource), 'red');
});

// ---------------------------------------------------------------------------
section('翻译服务注册表：只接专业翻译接口（语言模型与本地模型已剔除）');

check('四家翻译服务都在列表里，只有百度可用、其余三家「即将支持」', () => {
  assert.deepEqual(
    SERVICE_BRANDS.map((item) => item.id),
    ['baidu', 'tencent', 'volcano', 'aliyun'],
  );
  assert.deepEqual(
    SERVICE_BRANDS.map((item) => item.label),
    ['百度翻译', '腾讯翻译', '火山翻译', '阿里翻译'],
  );
  assert.equal(isBrandAvailable('baidu'), true);
  for (const id of ['tencent', 'volcano', 'aliyun']) {
    assert.equal(isBrandAvailable(id), false, `${id} 尚未实现，应当标即将支持`);
  }
  assert.equal(findServiceBrand('tencent').kind, 'tencent-translate');
  assert.equal(findServiceBrand('volcano').kind, 'volcano-translate');
  assert.equal(findServiceBrand('aliyun').kind, 'aliyun-translate');
  assert.equal(DEFAULT_BRAND_ID, 'baidu');
});

check('语言模型 / 本地模型这两个接入板块**已被彻底剔除**（不是隐藏）', () => {
  // 注册表里不再有「类别」这一层，也没有语言模型的服务商模板与相关推导函数：
  // 整条链路只剩一种接入形态，重新开放需要重写代码（这是用户 2026 轮的明确要求）
  for (const removed of [
    'CATEGORIES',
    'LLM_TEMPLATES',
    'PROFESSIONAL_BRANDS',
    'DEFAULT_CATEGORY',
    'DEFAULT_TEMPLATE_ID',
    'findCategory',
    'findLlmTemplate',
    'credentialKindOf',
    'hasEndpointFields',
    'kindOf',
  ]) {
    assert.equal(removed in providersRegistry, false, `注册表里不该再有 ${removed}`);
  }
  assert.equal(findServiceBrand('llm'), undefined);
  assert.equal(findServiceBrand('local'), undefined);
  // 「按类别判断能不能测」这类函数也一并删掉了（只剩专业翻译，没有类别门槛）
  assert.equal('canTestConnection' in profileSanitizeModule, false);
  assert.equal('profileIssues' in profileSanitizeModule, false);
});

check('凭据形态只剩「一对凭据」：百度 APP ID/密钥，腾讯 SecretId/SecretKey', () => {
  assert.deepEqual(findServiceBrand('baidu').credentialLabels, { id: 'APP ID', key: '密钥' });
  assert.deepEqual(findServiceBrand('tencent').credentialLabels, {
    id: 'SecretId',
    key: 'SecretKey',
  });
  // 火山与阿里将来接入时也各是一对凭据（现在只占位，界面不渲染）
  assert.equal(findServiceBrand('volcano').credentialLabels.id, 'APP ID');
  assert.equal(findServiceBrand('aliyun').credentialLabels.key, 'AccessKey Secret');
  // 百度支持环境变量兜底，前端与 Rust 侧用的是同一组变量名
  assert.equal(BAIDU_APP_ID_ENV, 'BAIDU_TRANSLATE_APP_ID');
  assert.equal(BAIDU_APP_KEY_ENV, 'BAIDU_TRANSLATE_APP_KEY');
});

check('造配置：默认落在百度，命名取翻译服务的名字', () => {
  const profile = createProfile();
  assert.equal(profile.brand, 'baidu');
  assert.equal(profile.label, '百度翻译');
  assert.ok(profile.id.length > 0);
  // 配置里只有三项：id / label / brand —— 不再有类别、字段块与服务商模板
  assert.deepEqual(Object.keys(profile).sort(), ['brand', 'id', 'label']);
});

check('未知品牌回落到百度（脏数据安全降级）', () => {
  assert.equal(createProfile({ brand: '瞎写' }).brand, DEFAULT_BRAND_ID);
  assert.equal(sanitizeProfile({ id: 'a', brand: '瞎写' }).brand, DEFAULT_BRAND_ID);
});

check('运行时协议由翻译服务推导，配置里不存这个字段', () => {
  assert.equal(protocolOf('baidu'), 'baidu-translate');
  assert.equal(protocolOf('tencent'), 'tencent-translate');
  assert.equal(protocolOf('瞎写'), 'baidu-translate');
  assert.equal(protocolOf(''), 'baidu-translate');
  assert.equal(profileKind(createProfile({ brand: 'baidu' })), 'baidu-translate');
  assert.equal(profileKind(createProfile({ brand: 'tencent' })), 'tencent-translate');
  // 磁盘上就算写着 kind 也不认：新结构里根本没有这个字段
  assert.equal('kind' in sanitizeProfile({ id: 'a', kind: '瞎写' }), false);
});

check('配置里不存在任何密钥字段', () => {
  const profile = createProfile();
  assert.deepEqual(
    Object.keys(profile).filter((key) => /key|secret|token/i.test(key)),
    [],
  );
});

// ---------------------------------------------------------------------------
section('旧配置迁移：三条历史形状都要能读进来（不丢名字与凭据）');

check('三层旧结构（category + llm + professional）迁成「翻译服务 + 品牌」', () => {
  const profile = sanitizeProfile({
    id: 'b',
    label: '百度主力',
    category: 'professional',
    professional: { brand: 'baidu' },
    templateId: 'baidu',
  });
  assert.equal(profile.brand, 'baidu');
  assert.equal(profile.label, '百度主力', '用户起的名字必须留着');
  assert.equal(profileKind(profile), 'baidu-translate');
  // 语言模型那一层不再存在
  assert.equal('category' in profile, false);
  assert.equal('llm' in profile, false);
  assert.equal('templateId' in profile, false);
});

check('旧的语言模型配置：名字与 id 保留，服务回落百度（字段随接入方式一起消失）', () => {
  const profile = sanitizeProfile({
    id: 'a',
    label: '老的 DeepSeek 配置',
    category: 'llm',
    templateId: 'deepseek',
    llm: { baseUrl: 'https://x/v1', model: 'm', timeoutMs: 12345, temperature: 0.9 },
  });
  assert.equal(profile.id, 'a');
  assert.equal(profile.label, '老的 DeepSeek 配置');
  assert.equal(profile.brand, 'baidu', '接入方式没了，服务回落本版唯一可用的百度');
  assert.equal('llm' in profile, false, '语言模型字段不该被搬进新结构');
  assert.deepEqual(Object.keys(profile).sort(), ['brand', 'id', 'label']);
});

check('更早的扁平结构：templateId 上写着品牌的那一份也能认', () => {
  assert.equal(
    sanitizeProfile({ id: 'y', templateId: 'baidu' }).brand,
    'baidu',
  );
  assert.equal(
    sanitizeProfile({ id: 'z', templateId: 'tencent' }).brand,
    'tencent',
    '腾讯虽然还没实现，识别出来比静默换成百度更诚实',
  );
});

check('缺字段被补齐（新结构下的兜底）', () => {
  const profile = sanitizeProfile({});
  assert.ok(profile.id.length > 0);
  assert.equal(profile.label, FALLBACK_PROFILE_LABEL);
  assert.equal(profile.brand, DEFAULT_BRAND_ID);
});

check('重复 id 会被拆开，非数组得到空列表', () => {
  const list = sanitizeProfiles([
    { id: 'same', label: '甲' },
    { id: 'same', label: '乙' },
  ]);
  assert.equal(list.length, 2);
  assert.notEqual(list[0].id, list[1].id);
  assert.deepEqual(sanitizeProfiles(null), []);
  assert.deepEqual(sanitizeProfiles({ profiles: [] }), []);
});

check('clampRange 对非法输入回落到 fallback 而不是边界', () => {
  assert.equal(clampRange(Number.NaN, 1, 10, 7), 7);
  assert.equal(clampRange(0, 1, 10, 7), 1);
  assert.equal(clampRange(99, 1, 10, 7), 10);
});

// ---------------------------------------------------------------------------
section('测试连接：只剩专业翻译接口，没有「按类别预判」这回事');

check('不再有按类别判断可点性的函数（凭据在系统凭据库，界面无从预判）', () => {
  assert.equal('canTestConnection' in profileSanitizeModule, false);
  assert.equal('profileIssues' in profileSanitizeModule, false);
  // 配置本体里也没有任何能拿来预判的地址/模型字段
  assert.deepEqual(Object.keys(createProfile()).sort(), ['brand', 'id', 'label']);
});

// ---------------------------------------------------------------------------
section('主题：日/月切换的取值与持久化');

check('主题规范化：认不出来的值一律回落默认深色', () => {
  assert.equal(parseTheme('light'), 'light');
  assert.equal(parseTheme('dark'), 'dark');
  assert.equal(parseTheme(null), DEFAULT_THEME);
  assert.equal(parseTheme('LIGHT'), DEFAULT_THEME, '大小写不匹配也算脏数据');
  assert.equal(parseTheme('蓝色'), DEFAULT_THEME);
  assert.equal(parseTheme(''), DEFAULT_THEME);
  assert.equal(DEFAULT_THEME, 'light', 'D78：全新启动默认进入亮色主题');
});

check('主题切换就是取反，且只有两种', () => {
  assert.equal(toggleTheme('dark'), 'light');
  assert.equal(toggleTheme('light'), 'dark');
});

check('图标语义：暗色显示太阳、亮色显示月亮，文案全是中文', () => {
  assert.equal(THEME_TOGGLE.dark.icon, 'sun');
  assert.equal(THEME_TOGGLE.light.icon, 'moon');
  for (const text of [THEME_TOGGLE.dark.title, THEME_TOGGLE.light.title]) {
    assert.equal(/[A-Za-z]/.test(text), false, `主题按钮文案不该出现英文：${text}`);
  }
});

check('取色与主题无关：全部颜色在两种主题下取值一致（白色反相机制已随自由色删除）', () => {
  /*
   * 历史：注册表曾有「白」，亮色主题下纯白看不见，因此渲染层把它反相成深色（D24）。
   * 2026 轮自由色删除（D47）后，颜色都是渐变、两种主题下都够清楚，
   * 反相开关连同 `INVERTED_COLOR_HEX` 一起删掉 —— 这里钉住「取色不再有任何主题分支」。
   */
  for (const color of COLORS) {
    assert.equal(resolveColorHex(color.id), colorHex(color.id), `${color.id} 的取色不该随主题变化`);
    assert.equal(
      resolveColorGradient(color.id),
      colorGradient(color.id),
      `${color.id} 的渐变不该随主题变化`,
    );
  }
  // 反相机制本身不许回来（它依赖一个已不存在的颜色 id）
  const themeKeys = Object.keys(load('utils/theme.js'));
  assert.deepEqual(themeKeys.filter((key) => /INVERT/i.test(key)), [], '反相相关导出应当已删除');
});

check('主题只改 DOM 上的一个属性（配色全部由 CSS 变量按主题取值）', () => {
  const fake = {
    attrs: {},
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
  };
  applyThemeToDom('light', fake);
  assert.equal(fake.attrs[THEME_ATTRIBUTE], 'light');
  applyThemeToDom('dark', fake);
  assert.equal(fake.attrs[THEME_ATTRIBUTE], 'dark');
  // 没有 DOM 也不能崩（非浏览器环境）
  applyThemeToDom('light', null);
});

check('主题落盘：读写同一个键，写失败只是记不住、不报错', () => {
  const store = new Map();
  const fakeStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, value),
  };
  assert.equal(loadTheme(fakeStorage), DEFAULT_THEME, '第一次启动没有记录');
  assert.equal(saveTheme('light', fakeStorage), true);
  assert.equal(store.get(THEME_STORAGE_KEY), 'light', '键名要与读取时一致');
  assert.equal(loadTheme(fakeStorage), 'light', '重启后应恢复上次选择');

  // 隐私模式 / 配额满：抛异常也要安全降级
  const broken = {
    getItem: () => {
      throw new Error('拒绝访问');
    },
    setItem: () => {
      throw new Error('配额已满');
    },
  };
  assert.equal(loadTheme(broken), DEFAULT_THEME);
  assert.equal(saveTheme('dark', broken), false);

  // 没有存储（非浏览器环境）
  assert.equal(loadTheme(null), DEFAULT_THEME);
  assert.equal(saveTheme('light', null), false);
});

// ---------------------------------------------------------------------------
section('翻译服务状态指示灯（三态判据）');

const baiduProfile = createProfile({ brand: 'baidu', label: '百度配置' });
const tencentProfile = createProfile({ brand: 'tencent', label: '腾讯配置' });

check('没配凭据 → 白灯（无论历史结论是什么）', () => {
  assert.equal(connectionStatusOf(baiduProfile, false, undefined), 'unconfigured');
  assert.equal(connectionStatusOf(baiduProfile, false, 'ok'), 'unconfigured', '白灯压过旧的绿灯');
  assert.equal(connectionStatusOf(baiduProfile, false, 'error'), 'unconfigured');
  assert.equal(connectionStatusOf(tencentProfile, false, 'ok'), 'unconfigured');
});

check('已配置 + 无结论 → 仍是白灯（还没测过不能说「正常」）', () => {
  assert.equal(connectionStatusOf(baiduProfile, true, undefined), 'unconfigured');
  assert.equal(connectionStatusOf(tencentProfile, true, undefined), 'unconfigured');
});

check('已配置 + 测试成功 → 绿灯；失败 → 红灯', () => {
  assert.equal(connectionStatusOf(baiduProfile, true, 'ok'), 'ok');
  assert.equal(connectionStatusOf(baiduProfile, true, 'error'), 'error');
  assert.equal(connectionStatusOf(tencentProfile, true, 'ok'), 'ok');
  assert.equal(connectionStatusOf(tencentProfile, true, 'error'), 'error');
});

check('没有配置（profile 为空）→ 白灯', () => {
  assert.equal(connectionStatusOf(undefined, true, 'ok'), 'unconfigured');
});

check('启动自测：没凭据不测', () => {
  assert.equal(shouldAutoTest(baiduProfile, false, undefined), false);
  assert.equal(shouldAutoTest(tencentProfile, false, undefined), false);
  assert.equal(shouldAutoTest(undefined, true, undefined), false);
});

check('启动自测：没结论或上次失败才测，已有绿灯不重复打接口（不轮询）', () => {
  assert.equal(shouldAutoTest(baiduProfile, true, undefined), true, '首次配置要测');
  assert.equal(shouldAutoTest(baiduProfile, true, 'error'), true, '上次失败要再试');
  assert.equal(shouldAutoTest(baiduProfile, true, 'ok'), false, '已经有绿灯就不再发请求');
});

check('指示灯的三态文案与类名一一对应（界面只出现中文）', () => {
  assert.deepEqual(Object.keys(CONNECTION_STATUS_TITLE).sort(), ['error', 'ok', 'unconfigured']);
  assert.deepEqual(Object.keys(CONNECTION_STATUS_CLASS).sort(), ['error', 'ok', 'unconfigured']);
  assert.equal(CONNECTION_STATUS_TITLE.unconfigured, '未配置');
  assert.equal(CONNECTION_STATUS_TITLE.ok, '连接正常');
  assert.equal(CONNECTION_STATUS_TITLE.error, '连接异常');
  for (const text of Object.values(CONNECTION_STATUS_TITLE)) {
    assert.equal(/[A-Za-z]/.test(text), false, `指示灯文案不该出现英文：${text}`);
  }
});

// ---------------------------------------------------------------------------
section('给 Rust 的适配层：wire 形状与前端结构一致（回归：品牌曾被打平丢掉）');

check('toRustProfile 原样保留新结构，不拉平', () => {
  const profile = createProfile({ brand: 'tencent', label: '甲' });
  assert.deepEqual(toRustProfile(profile), {
    id: profile.id,
    label: '甲',
    brand: 'tencent',
  });
});

check('brand 必须出现在 wire 形状里（否则落盘就被 Rust 丢掉）', () => {
  const wire = toRustProfile(createProfile({ brand: 'baidu' }));
  assert.equal(wire.brand, 'baidu', 'brand 必须传给 Rust');
  // 语言模型时代的拉平字段不该再出现：它们会让 Rust 侧的 serde 丢弃新结构
  assert.equal('kind' in wire, false, '不该再有 kind');
  assert.equal('category' in wire, false, '不该再有 category');
  assert.equal('llm' in wire, false, '不该再有 llm 字段块');
  assert.equal('templateId' in wire, false, '不该再有 templateId');
  assert.equal('baseUrl' in wire, false, '不该再有扁平 baseUrl');
  assert.equal('model' in wire, false, '不该再有扁平 model');
});

check('配置里没有任何地址或模型字段（这一层字段随语言模型接入一起删掉）', () => {
  const wire = toRustProfile(createProfile({ brand: 'baidu', label: '百度主力' }));
  assert.deepEqual(Object.keys(wire).sort(), ['brand', 'id', 'label']);
});

// ---------------------------------------------------------------------------
section('草稿恢复：模块规范化（最容易丢用户内容的一环）');

const draftCapsule = {
  id: 'cap_a',
  label: '冷峻文风',
  presetId: 'preset_1',
  english: 'in a cold, restrained tone',
};

function draftModuleFixture(overrides = {}) {
  return {
    id: 'mod_1',
    order: 1,
    colorId: 'red',
    sourceText: '把这段话改写得更礼貌',
    capsules: [],
    translation: '',
    outputHeight: 200,
    status: 'idle',
    ...overrides,
  };
}

check('pruneAnchors 只留下有对应胶囊的锚点', () => {
  const source = `开头 ${capsuleAnchor('cap_a')} 中间 ${capsuleAnchor('cap_gone')} 结尾`;
  assert.equal(
    pruneAnchors(source, new Set(['cap_a'])),
    `开头 ${capsuleAnchor('cap_a')} 中间  结尾`,
  );
  assert.equal(pruneAnchors(source, new Set()), '开头  中间  结尾');
});

check('非 ASCII 的锚点（正则不认）原样保留，不会被误删', () => {
  // 真实胶囊 id 由 createId 生成，只含 [A-Za-z0-9_]；出现中文 id 说明那是用户手打的普通文字
  const source = `看看 [[cap:根本不存在]] 这段`;
  assert.equal(pruneAnchors(source, new Set()), source);
});

check('孤儿锚点在恢复时被清掉（否则编辑器里会露出一串 [[cap:x]]）', () => {
  const module = sanitizeModule(
    draftModuleFixture({
      sourceText: `开头 ${capsuleAnchor('cap_a')} 与 ${capsuleAnchor('cap_gone')}`,
      capsules: [draftCapsule],
    }),
    1,
  );
  assert.ok(module);
  assert.equal(module.sourceText.includes('cap_gone'), false);
  assert.equal(module.sourceText.includes(capsuleAnchor('cap_a')), true);
});

check('胶囊的英文内容被保留（只是不显示，不是丢弃）', () => {
  const module = sanitizeModule(
    draftModuleFixture({ capsules: [draftCapsule], sourceText: capsuleAnchor('cap_a') }),
    1,
  );
  assert.ok(module);
  assert.equal(module.capsules[0].english, 'in a cold, restrained tone');
  assert.equal(module.capsules[0].label, '冷峻文风');
});

check('上次退出时正在翻译的模块回到「待翻译」', () => {
  assert.equal(sanitizeModule(draftModuleFixture({ status: 'translating' }), 1).status, 'idle');
});

check('上次的失败状态不会带进新会话', () => {
  const module = sanitizeModule(
    draftModuleFixture({ status: 'error', error: { code: 'TIMEOUT', message: '超时' } }),
    1,
  );
  assert.equal(module.status, 'idle');
  assert.equal(module.error, undefined);
});

check('有译文的模块恢复为「已翻译」', () => {
  const module = sanitizeModule(
    draftModuleFixture({ status: 'idle', translation: 'Rewrite it politely.' }),
    1,
  );
  assert.equal(module.status, 'done');
});

check('检查输出高度被夹在 [56, 720]，缺字段回落到默认高度', () => {
  assert.equal(sanitizeModule(draftModuleFixture({ outputHeight: 5 }), 1).outputHeight, 56);
  assert.equal(sanitizeModule(draftModuleFixture({ outputHeight: 5000 }), 1).outputHeight, 720);
  assert.equal(sanitizeModule(draftModuleFixture({ outputHeight: 200 }), 1).outputHeight, 200);
  // 旧草稿里没有这个字段 → 回落到初始高度 56
  const legacy = draftModuleFixture();
  delete legacy.outputHeight;
  assert.equal(sanitizeModule(legacy, 1).outputHeight, 56);
});

check('非法颜色回落到合法模块色', () => {
  assert.notEqual(sanitizeModule(draftModuleFixture({ colorId: '怪色' }), 1).colorId, '怪色');
  assert.notEqual(sanitizeModule(draftModuleFixture({ colorId: 'white' }), 1).colorId, 'white');
});

check('缺 id 的模块被丢弃，非数组得到空列表', () => {
  assert.equal(sanitizeModule({ order: 1 }, 1), null);
  assert.deepEqual(sanitizeModules(null), []);
  assert.deepEqual(sanitizeModules('不是数组'), []);
});

check('模块数量上限夹到 9', () => {
  const many = Array.from({ length: 20 }, (_, index) =>
    draftModuleFixture({ id: `mod_${index}`, sourceText: `第 ${index} 段` }),
  );
  assert.equal(sanitizeModules(many).length, MODULE_MAX_COUNT);
  assert.equal(MODULE_MAX_COUNT, 9);
});

check('序号按位置重排，重复 id 被拆开', () => {
  const list = sanitizeModules([
    draftModuleFixture({ id: 'same', order: 99 }),
    draftModuleFixture({ id: 'same', order: 99 }),
  ]);
  assert.deepEqual(
    list.map((module) => module.order),
    [1, 2],
  );
  assert.notEqual(list[0].id, list[1].id);
});

check('重复胶囊 id 会被去重', () => {
  const module = sanitizeModule(
    draftModuleFixture({ capsules: [draftCapsule, { ...draftCapsule, label: '重复' }] }),
    1,
  );
  assert.equal(module.capsules.length, 1);
});

check('胶囊缺命名时给中文兜底名', () => {
  const module = sanitizeModule(draftModuleFixture({ capsules: [{ id: 'cap_x' }] }), 1);
  assert.equal(module.capsules[0].label, FALLBACK_CAPSULE_LABEL);
});

check('用量信息非法时被丢弃', () => {
  assert.equal(sanitizeModule(draftModuleFixture({ translationMeta: '坏数据' }), 1).translationMeta, undefined);
  const meta = sanitizeModule(
    draftModuleFixture({ translationMeta: { model: 'deepseek-chat', elapsedMs: 1234.6 } }),
    1,
  ).translationMeta;
  assert.deepEqual(meta, { model: 'deepseek-chat', elapsedMs: 1235 });
});

// ---------------------------------------------------------------------------
section('单模块源内容长度：上限 1000 可见字符，锚点不占额度');

check('上限常量就是 1000 字（字符，不是字节）', () => {
  assert.equal(MODULE_SOURCE_MAX_LENGTH, 1000);
});

check('可见字符数只算文本，已知胶囊的锚点不计数', () => {
  const source = `开头${capsuleAnchor('cap_a')}结尾`;
  assert.equal(sourceVisibleLength(source, new Set(['cap_a'])), 4);
  // 未知 id 的锚点按普通文字算：用户看得见它，所以它占额度
  assert.equal(sourceVisibleLength(source, new Set()), source.length);
});

check('没超限时返回 null —— 打字路径绝不能因此重建 DOM', () => {
  const source = '女'.repeat(MODULE_SOURCE_MAX_LENGTH);
  assert.equal(clampSourceText(source, new Set(), MODULE_SOURCE_MAX_LENGTH), null);
  assert.equal(
    clampSourceText(`短${capsuleAnchor('cap_a')}`, new Set(['cap_a']), MODULE_SOURCE_MAX_LENGTH),
    null,
  );
});

check('超限时截到上限，多余部分丢弃', () => {
  const source = '女'.repeat(MODULE_SOURCE_MAX_LENGTH + 120);
  const clamped = clampSourceText(source, new Set(), MODULE_SOURCE_MAX_LENGTH);
  assert.equal(clamped.length, MODULE_SOURCE_MAX_LENGTH);
  assert.equal(sourceVisibleLength(clamped, new Set()), MODULE_SOURCE_MAX_LENGTH);
});

check('截断只砍文字，永不砍锚点（锚点丢了界面上的药丸就会凭空消失）', () => {
  // 锚点排在超限文字之后：文字被截掉，但锚点必须原样接回去，而且不占额度
  const tailAnchor = `女`.repeat(MODULE_SOURCE_MAX_LENGTH) + capsuleAnchor('cap_tail') + '多余';
  const clampedTail = clampSourceText(tailAnchor, new Set(['cap_tail']), MODULE_SOURCE_MAX_LENGTH);
  assert.equal(clampedTail.includes(capsuleAnchor('cap_tail')), true, '锚点必须保留');
  assert.equal(clampedTail.endsWith('多余'), false, '超限的文字必须被砍掉');
  assert.equal(sourceVisibleLength(clampedTail, new Set(['cap_tail'])), MODULE_SOURCE_MAX_LENGTH);
  // 锚点本身不能被切成半截（`[[cap:cap_tail]]` 必须完整出现）
  assert.equal(clampedTail.includes('[['), true);
  assert.equal(clampedTail.indexOf('[['), clampedTail.lastIndexOf('[['));

  // 锚点排在前面：同样原样保留，且它不占用任何额度
  const headAnchor = capsuleAnchor('cap_head') + `女`.repeat(MODULE_SOURCE_MAX_LENGTH + 10);
  const clampedHead = clampSourceText(headAnchor, new Set(['cap_head']), MODULE_SOURCE_MAX_LENGTH);
  assert.equal(
    clampedHead.startsWith(capsuleAnchor('cap_head')),
    true,
    '截断后锚点必须还在最前面',
  );
  assert.equal(sourceVisibleLength(clampedHead, new Set(['cap_head'])), MODULE_SOURCE_MAX_LENGTH);
});

// ---------------------------------------------------------------------------
section('草稿读写（本地存储）');

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
    get size() {
      return map.size;
    },
  };
}

const draftModules = [
  sanitizeModule(
    draftModuleFixture({
      id: 'mod_keep',
      sourceText: `请用 ${capsuleAnchor('cap_a')} 改写`,
      capsules: [draftCapsule],
      translation: 'Rewrite it in a cold, restrained tone.',
    }),
    1,
  ),
];

const DRAFT_LAYOUT = { inputPaneHeight: 200, presetPanelWidth: 360 };

check('序列化 → 解析 往返保住源内容、胶囊、译文与布局', () => {
  const draft = buildDraft(draftModules, 'mod_keep', DRAFT_LAYOUT, 1700000000000);
  const restored = parseDraft(serializeDraft(draft));
  assert.ok(restored);
  assert.equal(restored.modules.length, 1);
  assert.equal(restored.modules[0].sourceText, `请用 ${capsuleAnchor('cap_a')} 改写`);
  assert.equal(restored.modules[0].capsules[0].english, 'in a cold, restrained tone');
  assert.equal(restored.modules[0].translation, 'Rewrite it in a cold, restrained tone.');
  assert.equal(restored.modules[0].status, 'done');
  assert.equal(restored.selectedModuleId, 'mod_keep');
  assert.equal(restored.savedAt, 1700000000000);
  assert.deepEqual(restored.layout, DRAFT_LAYOUT);
});

check('布局偏好被夹到合法区间，旧草稿没有 layout 时用默认值', () => {
  // 预设库宽度在解析草稿时只按宽松上限夹（真正上限是窗口 70%，见 utils/panelWidth.ts）
  assert.deepEqual(sanitizeLayout({ inputPaneHeight: 10, presetPanelWidth: 9999 }), {
    inputPaneHeight: 96,
    presetPanelWidth: PRESET_PANEL_STORAGE_MAX_WIDTH,
  });
  assert.deepEqual(sanitizeLayout(undefined), DEFAULT_LAYOUT);
  assert.deepEqual(sanitizeLayout({ inputPaneHeight: '坏值' }), DEFAULT_LAYOUT);
  assert.equal(DEFAULT_LAYOUT.presetPanelWidth, 276, '默认宽度 = 一行 8 块（12 块排成 8+4，D77）');
});

check('输入框默认高度让输出区刚好放下 6 个初始模块（默认窗口 720）', () => {
  // 几何口径与 layout.css 一致：顶栏 48、工作区内边距 8×2、水平分隔条 8、
  // 模块间距 8、输出区内边距 8×2、输出区上下边框 1×2（jsdom 量不到，只能算）
  const rows =
    MODULE_INITIAL_COUNT * MODULE_DEFAULT_HEIGHT + (MODULE_INITIAL_COUNT - 1) * 8;
  const available = 720 - 48 - 16 - 8 - rows - 16 - 2;
  assert.equal(available, INPUT_PANE_DEFAULT_HEIGHT);
  assert.equal(INPUT_PANE_DEFAULT_HEIGHT, 254, '默认输入框高度应恰好是 254px');
});

check('旧口径草稿逐档迁移：v3 前重置高度、v5 前重置宽度，其余内容不动', () => {
  // 一份 v1（没有 layoutVersion）草稿：宽度与高度都要回到新默认值，模块内容保留
  const legacy = {
    modules: draftModules,
    selectedModuleId: 'mod_keep',
    layout: { inputPaneHeight: 300, presetPanelWidth: 320 },
    savedAt: 1700000000001,
  };
  const restored = parseDraft(JSON.stringify(legacy));
  assert.ok(restored);
  assert.equal(restored.layout.presetPanelWidth, PRESET_PANEL_DEFAULT_WIDTH);
  assert.equal(restored.layout.inputPaneHeight, INPUT_PANE_DEFAULT_HEIGHT, 'v3 之前的草稿要重置输入框高度');
  assert.equal(restored.modules.length, draftModules.length, '模块内容不该被重置');

  // v2 草稿：高度按 v3 重置；宽度按 v5 重置成 276
  const v2 = parseDraft(
    JSON.stringify({
      modules: draftModules,
      selectedModuleId: 'mod_keep',
      layout: { inputPaneHeight: 300, presetPanelWidth: 420 },
      layoutVersion: 2,
      savedAt: 1700000000002,
    }),
  );
  assert.ok(v2);
  assert.equal(v2.layout.presetPanelWidth, PRESET_PANEL_DEFAULT_WIDTH, 'v5 之前的宽度一律重置');
  assert.equal(v2.layout.inputPaneHeight, INPUT_PANE_DEFAULT_HEIGHT, 'v3 之前的草稿仍要重置高度');

  // v3 草稿：高度已经是 254 口径、保留；宽度按 v5 重置
  const v3 = parseDraft(
    JSON.stringify({
      modules: draftModules,
      selectedModuleId: 'mod_keep',
      layout: { inputPaneHeight: 300, presetPanelWidth: 420 },
      layoutVersion: 3,
      savedAt: 1700000000003,
    }),
  );
  assert.ok(v3);
  assert.equal(v3.layout.presetPanelWidth, PRESET_PANEL_DEFAULT_WIDTH, 'v3 存的宽度是旧口径，必须重置');
  assert.equal(v3.layout.inputPaneHeight, 300, 'v3 已定的高度不该再被重置');

  // v4 草稿（上一轮，404px 口径）：宽度要按 v5 的 276px 再重置一次
  const v4 = parseDraft(
    JSON.stringify({
      modules: draftModules,
      selectedModuleId: 'mod_keep',
      layout: { inputPaneHeight: 300, presetPanelWidth: 404 },
      layoutVersion: 4,
      savedAt: 1700000000004,
    }),
  );
  assert.ok(v4);
  assert.equal(v4.layout.presetPanelWidth, 276, 'v4 的 404px 是旧口径，必须按一行 8 块重置');

  // 最新草稿（buildDraft 写 layoutVersion=5）→ 用户拖出来的高度与宽度都原样保留
  const fresh = parseDraft(
    serializeDraft(
      buildDraft(draftModules, 'mod_keep', { inputPaneHeight: 300, presetPanelWidth: 420 }),
    ),
  );
  assert.ok(fresh);
  assert.equal(fresh.layout.presetPanelWidth, 420);
  assert.equal(fresh.layout.inputPaneHeight, 300);
  assert.equal(fresh.layoutVersion, 5, '最新草稿的布局版本必须是 5');
});

check('选中项不在草稿里时回落到第一个模块', () => {
  const draft = buildDraft(draftModules, 'mod_已经不存在', DRAFT_LAYOUT);
  const restored = parseDraft(serializeDraft(draft));
  assert.equal(restored.selectedModuleId, draftModules[0].id);
});

check('坏 JSON / 空值 / 空模块列表都当作没有草稿', () => {
  assert.equal(parseDraft(null), null);
  assert.equal(parseDraft(''), null);
  assert.equal(parseDraft('{ 不是 JSON'), null);
  assert.equal(parseDraft('"字符串"'), null);
  assert.equal(parseDraft('{}'), null);
  assert.equal(parseDraft('{"modules":[]}'), null);
});

check('存 → 取 往返一致，且写在约定的键上', () => {
  const storage = fakeStorage();
  const draft = buildDraft(draftModules, 'mod_keep', DRAFT_LAYOUT);
  assert.equal(saveDraft(draft, storage), true);
  assert.equal(storage.getItem(DRAFT_STORAGE_KEY) !== null, true);

  const loaded = loadDraft(storage);
  assert.ok(loaded);
  assert.equal(loaded.modules[0].sourceText, `请用 ${capsuleAnchor('cap_a')} 改写`);
});

check('清空后读不到草稿', () => {
  const storage = fakeStorage();
  saveDraft(buildDraft(draftModules, 'mod_keep', DRAFT_LAYOUT), storage);
  clearDraft(storage);
  assert.equal(loadDraft(storage), null);
});

check('没有本地存储（浏览器预览 / 隐私模式）时全部安全降级', () => {
  assert.equal(loadDraft(null), null);
  assert.equal(saveDraft(buildDraft(draftModules, 'mod_keep', DRAFT_LAYOUT), null), false);
  clearDraft(null); // 不应抛异常
  const throwing = {
    getItem: () => {
      throw new Error('拒绝访问');
    },
    setItem: () => {
      throw new Error('配额已满');
    },
    removeItem: () => {
      throw new Error('拒绝访问');
    },
  };
  assert.equal(loadDraft(throwing), null);
  assert.equal(saveDraft(buildDraft(draftModules, 'mod_keep', DRAFT_LAYOUT), throwing), false);
  clearDraft(throwing); // 不应抛异常
});

// ---------------------------------------------------------------------------
section('翻译服务：协议区分与请求节流');

check('每家翻译服务有自己的协议，认不出的品牌一律走百度', () => {
  const brand = findServiceBrand('baidu');
  assert.ok(brand, '翻译服务表里没有百度翻译');
  assert.equal(brand.kind, 'baidu-translate');
  assert.equal(findServiceBrand('tencent').kind, 'tencent-translate');
  assert.equal(protocolOf('baidu'), 'baidu-translate');
  assert.equal(protocolOf('tencent'), 'tencent-translate');
  assert.equal(protocolOf('volcano'), 'volcano-translate');
  assert.equal(protocolOf('aliyun'), 'aliyun-translate');
  assert.equal(protocolOf('没这家'), 'baidu-translate', '脏数据按唯一可用的百度处理');
});

check('通道由品牌推导，不信任磁盘上的 kind', () => {
  const baidu = sanitizeProfile({ id: 'p1', brand: 'baidu', kind: 'tencent-translate' });
  assert.equal(profileKind(baidu), 'baidu-translate');
  const tencent = sanitizeProfile({ id: 'p2', brand: 'tencent', kind: 'baidu-translate' });
  assert.equal(profileKind(tencent), 'tencent-translate');
});

check('按百度品牌造配置：走百度通道，命名取品牌名', () => {
  const profile = createProfile({ brand: 'baidu' });
  assert.equal(profileKind(profile), 'baidu-translate');
  assert.equal(profile.brand, 'baidu');
  assert.equal(profile.label, '百度翻译');
});

check('节流间隔大于 1 秒（给往返与时钟抖动留余量）', () => {
  assert.ok(BAIDU_MIN_INTERVAL_MS > 1000, '必须严格大于 1 秒，否则仍可能触发 54003');
});

// ---------------------------------------------------------------------------
section('选中模块自动滚进可视区域（纯计算，需求 3）');

const container400 = { top: 0, bottom: 400 };

check('已经完整可见：返回原 scrollTop（调用方据此判定「不需要滚动」）', () => {
  assert.equal(isFullyVisible(container400, { top: 100, bottom: 156 }), true);
  assert.equal(nextScrollTop(container400, { top: 100, bottom: 156 }, 50), 50);
});

check('贴边不算完整可见（留 8px 内边距，避免看起来被切掉）', () => {
  assert.equal(isFullyVisible(container400, { top: 2, bottom: 58 }), false);
  assert.equal(isFullyVisible(container400, { top: 380, bottom: 436 }), false);
});

check('目标在下方：与容器下边对齐（含内边距）', () => {
  assert.equal(nextScrollTop(container400, { top: 500, bottom: 556 }, 0), 556 - 400 + 8);
});

check('目标在上方：与容器上边对齐（含内边距）', () => {
  assert.equal(nextScrollTop(container400, { top: -120, bottom: -64 }, 300), 300 - 120 - 8);
});

check('滚动量基于当前 scrollTop 增量计算，连续切换不会越滚越偏', () => {
  const first = nextScrollTop(container400, { top: 500, bottom: 556 }, 0);
  // 滚过一次之后，同一行就变成「完整可见」了
  assert.equal(nextScrollTop(container400, { top: 500 - first, bottom: 556 - first }, first), first);
});

// ---------------------------------------------------------------------------
section('推送设置（D80）：端口夹取与磁盘数据兜底');

check('端口上下限与默认值必须与 Rust 侧一致（1024 / 65535 / 8713）', () => {
  assert.equal(PUSH_PORT_MIN, 1024);
  assert.equal(PUSH_PORT_MAX, 65535);
  assert.equal(PUSH_DEFAULT_PORT, 8713);
});

check('clampPort：越界夹到边界、非数字回落默认值', () => {
  assert.equal(clampPort(8713), 8713, '合法值原样返回');
  assert.equal(clampPort(80), PUSH_PORT_MIN, '低于下限夹到 1024');
  assert.equal(clampPort(0), PUSH_PORT_MIN);
  assert.equal(clampPort(-1), PUSH_PORT_MIN);
  assert.equal(clampPort(70000), PUSH_PORT_MAX, '高于上限夹到 65535');
  assert.equal(clampPort(Number.NaN), PUSH_DEFAULT_PORT, 'NaN 回落默认端口');
  assert.equal(clampPort(Number.POSITIVE_INFINITY), PUSH_DEFAULT_PORT, '无穷也回落默认端口');
  assert.equal(clampPort(9000.4), 9000, '小数四舍五入');
});

check('normalizePushSettings：缺字段补默认值，脏端口夹取', () => {
  assert.deepEqual(normalizePushSettings(null), { enabled: true, port: PUSH_DEFAULT_PORT });
  assert.deepEqual(normalizePushSettings({}), { enabled: true, port: PUSH_DEFAULT_PORT });
  assert.deepEqual(normalizePushSettings({ enabled: false }), {
    enabled: false,
    port: PUSH_DEFAULT_PORT,
  });
  assert.deepEqual(normalizePushSettings({ port: 80 }), { enabled: true, port: PUSH_PORT_MIN });
  // 脏类型一律回落默认值（不把 "abc" 当成端口）
  assert.deepEqual(normalizePushSettings({ enabled: 'yes', port: 'abc' }), {
    enabled: true,
    port: PUSH_DEFAULT_PORT,
  });
});

check('isValidPort：只有区间内的整数才算合法（输入框用它决定是否提示）', () => {
  assert.equal(isValidPort(1024), true);
  assert.equal(isValidPort(65535), true);
  assert.equal(isValidPort(1023), false);
  assert.equal(isValidPort(65536), false);
  assert.equal(isValidPort(Number.NaN), false);
});

// ---------------------------------------------------------------------------
section('实时推流（D81）：推流载荷 = 「全文复制」压成一行');

check('载荷必须由「全文复制」推导出来（同一份 Tag 流，只把换行压成空格）', () => {
  const modules = [
    { translation: 'Cha, long hair', sourceText: '千早 长发', capsules: [] },
    { translation: 'smile', sourceText: '笑', capsules: [] },
  ];
  const copy = composeFullCopyText(modules);
  // 全文复制是分行的：`A, \nB`
  assert.equal(copy, 'Cha, long hair, \nsmile');
  assert.ok(copy.includes('\n'), '全文复制本来就带换行');

  const broadcast = composeBroadcastText(modules);
  assert.equal(broadcast, 'Cha, long hair, smile', '推流内容 = 全文复制去掉换行');
  // 独立写法的等价断言：把任意连续空白压成一个空格，结果必须与推流载荷一致
  assert.equal(broadcast, copy.replace(/\s+/g, ' ').trim());
  assert.equal(broadcast.includes('\n'), false, '推流里不允许有换行');
  assert.equal(broadcast.includes('  '), false, '换行两侧的空白要一起收掉，不能留下两个空格');
});

check('单排（没有换行）时载荷与全文复制完全一致，末尾不带标点', () => {
  const single = [{ translation: 'Chihaya Anon, smile', sourceText: '千早 笑', capsules: [] }];
  assert.equal(composeBroadcastText(single), composeFullCopyText(single));
  assert.equal(
    composeBroadcastText(single),
    'Chihaya Anon, smile',
    'D95：末尾的英文句号已经去掉，推流也不带',
  );
});

check('全空时推空字符串（模块全空、只有空模块都算）', () => {
  assert.equal(composeBroadcastText([]), '');
  assert.equal(
    composeBroadcastText([
      { translation: '', sourceText: '', capsules: [] },
      { translation: '   ', sourceText: '  ', capsules: [] },
    ]),
    '',
  );
});

check('推流载荷与「全文复制」同源：空模块被跳过，胶囊英文照旧排在最前', () => {
  const modules = [
    { translation: '', sourceText: '', capsules: [] },
    {
      translation: 'long hair',
      sourceText: `${capsuleAnchor('cap_a')} 长发`,
      capsules: [{ id: 'cap_a', label: '千早', presetId: 'p1', english: 'Chihaya Anon', colorId: 'pink' }],
    },
  ];
  assert.equal(composeFullCopyText(modules), 'Chihaya Anon, long hair');
  assert.equal(composeBroadcastText(modules), 'Chihaya Anon, long hair');
});

check('推流防抖是 200ms，且比实时翻译的 500ms 更急（用户指定）', () => {
  assert.equal(PUSH_BROADCAST_DEBOUNCE_MS, 200);
  assert.ok(
    PUSH_BROADCAST_DEBOUNCE_MS < REALTIME_DEBOUNCE_MS,
    '推流只是把已有文本转手，不该比翻译本身还慢',
  );
});

// ---------------------------------------------------------------------------
section('实时推流（D90）：按模块分离的载荷（global + 每排一块）');

/** 造一排模块的最小形状 */
function rowOf(translation, sourceText = '源', capsules = []) {
  return { translation, sourceText, capsules };
}

check('载荷恒定 9 个位置键（"1".."9"），与工作区实际有几排无关', () => {
  const payload = composeBroadcastPayload([rowOf('only one')]);
  assert.equal(Object.keys(payload.modules).join(','), '1,2,3,4,5,6,7,8,9');
  assert.equal(payload.modules['1'], 'only one');
  // 没有内容 / 没有这个模块，都是空串：插件端因此不必区分「不存在」和「空」
  for (const key of ['2', '3', '4', '5', '6', '7', '8', '9']) {
    assert.equal(payload.modules[key], '', `第 ${key} 个槽位应当是空串`);
  }
  // 超过 9 排也不可能出现（MODULE_MAX_COUNT 是上限，这里只断言不会多出键）
  const empty = composeBroadcastPayload([]);
  assert.equal(Object.keys(empty.modules).length, 9);
  assert.equal(empty.global, '');
});

check('global 与 D81 完全一致（仍是「全文复制」压成一行），老节点行为零变化', () => {
  const modules = [rowOf('Cha, long hair', '千早 长发'), rowOf('smile', '笑')];
  const payload = composeBroadcastPayload(modules);
  assert.equal(payload.global, composeBroadcastText(modules));
  assert.equal(payload.global, 'Cha, long hair, smile');
  assert.equal(payload.global.includes('\n'), false, 'global 里不许有换行');
});

check('切开再拼回去能还原 global：非空模块按序「, 」连接，末尾不加标点', () => {
  const modules = [
    rowOf('long hair', '长发'),
    rowOf('', ''),
    rowOf('short hair', '短发'),
  ];
  const payload = composeBroadcastPayload(modules);
  const rebuilt = Object.values(payload.modules)
    .filter((text) => text)
    .join(', ');
  assert.equal(rebuilt, payload.global);
  // 空排不产生额外逗号（`A, , B` 这种）
  assert.equal(payload.global.includes(',  '), false);
  assert.equal(payload.global.includes(',,'), false);
  // D95：整段与单排都不带末尾句号（切分成独立模块后，句号位置本身就不确定）
  assert.equal(payload.modules['1'], 'long hair');
  assert.equal(payload.modules['1'].endsWith('.'), false);
  assert.equal(payload.global.endsWith('.'), false);
});

check('键是行位置而不是 module.id（id 随机、换草稿就变，选择会指错排）', () => {
  const modules = [
    { ...rowOf('first row'), id: 'mod_random_a' },
    { ...rowOf('second row'), id: 'mod_random_b' },
  ];
  const payload = composeBroadcastPayload(modules);
  assert.equal(payload.modules['1'], 'first row');
  assert.equal(payload.modules['2'], 'second row');
  assert.equal(payload.modules.mod_random_a, undefined, '不能用 module.id 当键');
  assert.equal(payload.modules.mod_random_b, undefined, '不能用 module.id 当键');
});

check('单排文本与「全文复制」里那一段同源（胶囊英文在最前，锚点不外泄）', () => {
  const modules = [
    rowOf('long hair', `${capsuleAnchor('cap_a')} 长发`, [
      { id: 'cap_a', label: '千早', presetId: 'p1', english: 'Chihaya Anon', colorId: 'pink' },
    ]),
  ];
  const payload = composeBroadcastPayload(modules);
  assert.equal(payload.modules['1'], 'Chihaya Anon, long hair');
  assert.equal(payload.modules['1'].includes(capsuleAnchor('cap_a')), false, '锚点不许出现在推流里');
  // 与「全文复制」的出口同一份：moduleLineOf 就是 composeFullCopyText 用的那个
  assert.equal(payload.modules['1'], moduleLineOf(modules[0]));
  assert.equal(payload.global, payload.modules['1']);
});

check('全空工作区：global 空串 + 9 个空槽（照样推一帧，客户端才知道「现在没内容」）', () => {
  const payload = composeBroadcastPayload([rowOf('', ''), rowOf('   ', '  ')]);
  assert.equal(payload.global, '');
  assert.equal(
    Object.values(payload.modules).every((text) => text === ''),
    true,
    '全空时 9 个槽位都必须是空串',
  );
});

check('推流契约与「全文复制」共用同一套工序（不会出现两套规则）', () => {
  /*
   * 口径（用户 2026）：**句读统一收成逗号**，空白折叠；正文里的逗号/句号
   * 都是句读，不再「原样保留」。三条出口必须仍然一模一样（这才是这条断言
   * 真正要守的东西）。
   */
  const messy = rowOf('a , , b , c', '甲 , 乙 , , 丙');
  assert.equal(moduleLineOf(messy), 'a, b, c', '正文的句读被统一收成逗号');
  assert.equal(composeFullCopyText([messy]), 'a, b, c');
  assert.equal(composeBroadcastPayload([messy]).modules['1'], 'a, b, c');
  assert.equal(
    composeBroadcastText([messy]),
    composeFullCopyText([messy]),
    '推流 global 与全文复制必须逐字一致',
  );

  // 我们造成的重复逗号（连接处）仍然会被去掉
  assert.equal(composeCopyText(['a, b'], '甲'), 'a, b, 甲');
});

// ---------------------------------------------------------------------------
section('胶囊自动命名（D84）：模块枢存胶囊时取输入框里的中文');

check('长句只取前 10 个字（用户 2026 轮的例子）', () => {
  assert.equal(CAPSULE_AUTO_NAME_MAX, 10);
  assert.equal(
    capsuleNameFromSource('千早爱音来自MyGO是一个非常可爱的女孩'),
    '千早爱音来自MyGO',
  );
});

check('遇到逗号 / 顿号 / 句号 / 换行只取第一段', () => {
  const none = new Set();
  assert.equal(capsuleNameFromSource('千早爱音，来自MyGO'), '千早爱音');
  assert.equal(capsuleNameFromSource('千早爱音, 来自MyGO'), '千早爱音');
  assert.equal(capsuleNameFromSource('千早爱音、长发、微笑'), '千早爱音');
  assert.equal(capsuleNameFromSource('千早爱音。非常可爱'), '千早爱音');
  assert.equal(capsuleNameFromSource('千早爱音\n来自MyGO'), '千早爱音');
  // 英文句点与冒号**不**当分隔符（更可能出现在正常英文片段里）
  assert.equal(capsuleNameFromSource('v1.5 画风'), 'v1.5 画风');
});

check('胶囊锚点不算字：先剥掉标记再取名', () => {
  const text = `${capsuleAnchor('cap_a')} 千早爱音，来自MyGO`;
  assert.equal(capsuleNameFromSource(text), '千早爱音');
  // 未知 id 的锚点也一起剥掉：名字是给人看的，绝不能出现 [[cap:…]]
  assert.equal(capsuleNameFromSource(capsuleAnchor('cap_x')), '');
  assert.equal(capsuleNameFromSource(`${capsuleAnchor('cap_x')}${capsuleAnchor('cap_y')}`), '');
});

check('没有中文（空 / 只有胶囊 / 只有空白）时返回空串，交回默认名', () => {
  assert.equal(capsuleNameFromSource(''), '');
  assert.equal(capsuleNameFromSource('   '), '');
  assert.equal(capsuleNameFromSource(capsuleAnchor('cap_a')), '');
});

check('9 / 10 / 11 个字符的边界，截断后不留尾随空格', () => {
  assert.equal(capsuleNameFromSource('一二三四五六七八九'), '一二三四五六七八九');
  assert.equal(capsuleNameFromSource('一二三四五六七八九十'), '一二三四五六七八九十');
  assert.equal(capsuleNameFromSource('一二三四五六七八九十一'), '一二三四五六七八九十');
  assert.equal(capsuleNameFromSource('一二三四五六七八九 十'), '一二三四五六七八九');
});

check('自动名撞车时追加序号（否则预设编辑器会直接报重名）', () => {
  const presets = [{ label: '千早爱音' }, { label: '千早爱音 2' }];
  assert.equal(uniquePresetLabel('千早爱音', presets), '千早爱音 3');
  assert.equal(uniquePresetLabel('长头发', presets), '长头发', '没撞车就原样');
  assert.equal(uniquePresetLabel(' 长头发 ', presets), '长头发', '两端空白要去掉');
  assert.equal(uniquePresetLabel('', presets), '');
});

// ---------------------------------------------------------------------------
section('Tag 库（D86）：与画师库同构、来源绑定、分页阈值');

const { DICTIONARY_COLOR_ID: DICTIONARY_COLOR } = load('constants/colors.js');
const {
  LIBRARY_PAGE_SIZE: PAGE_SIZE_DEFAULT,
  LIBRARY_PAGE_SIZE_MIN: PAGE_SIZE_MIN,
  LIBRARY_PAGE_SIZE_MAX: PAGE_SIZE_MAX,
} = load('constants/limits.js');
const {
  clampLibraryPageSize,
  parseLibraryPageSize,
  loadLibraryPageSize,
  saveLibraryPageSize,
  LIBRARY_PAGE_SIZE_STORAGE_KEY,
} = load('utils/uiSettings.js');
const {
  withSourceFile,
  toDisk,
  groupByFile,
  snapshotOf,
  ROOT_LIBRARY_FILE,
  mergeLibraryFiles,
} = load('utils/presetFiles.js');

check('分页阈值默认 100，四个库统一；越界夹到 20–1000', () => {
  assert.equal(PAGE_SIZE_DEFAULT, 100, '用户口径：默认值为 100');
  assert.equal(PAGE_SIZE_MIN, 20);
  assert.equal(PAGE_SIZE_MAX, 1000);
  assert.equal(clampLibraryPageSize(5), 20, '太小夹到下限');
  assert.equal(clampLibraryPageSize(9999), 1000, '太大夹到上限');
  assert.equal(clampLibraryPageSize(50), 50, '区间内原样');
  assert.equal(clampLibraryPageSize(Number.NaN), 100, '非数字回落默认值');
});

check('分页阈值能存能读（localStorage），脏值回落 100', () => {
  // 用内存假 storage 代替 localStorage：Node 里没有 window
  const memory = new Map();
  const storage = {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => memory.set(key, value),
  };
  assert.equal(loadLibraryPageSize(storage), 100, '没存过就是默认值');
  assert.equal(saveLibraryPageSize(250, storage), true);
  assert.equal(memory.get(LIBRARY_PAGE_SIZE_STORAGE_KEY), '250');
  assert.equal(loadLibraryPageSize(storage), 250);
  memory.set(LIBRARY_PAGE_SIZE_STORAGE_KEY, '不是数字');
  assert.equal(loadLibraryPageSize(storage), 100, '脏值回落默认值');
  assert.equal(parseLibraryPageSize(null), 100);
  // 没有 storage（隐私模式 / 非浏览器）时安全降级
  assert.equal(loadLibraryPageSize(null), 100);
  assert.equal(saveLibraryPageSize(300, null), false);
});

check('分页真的按阈值切片（100 条一页，第 2 页从第 101 条开始）', () => {
  const items = Array.from({ length: 250 }, (_, index) => ({ id: `t${index}` }));
  const first = paginate(items, 1, PAGE_SIZE_DEFAULT);
  assert.equal(first.pageCount, 3, '250 条 ÷ 100 = 3 页');
  assert.equal(first.items.length, 100);
  assert.equal(first.items[0].id, 't0');
  const third = paginate(items, 3, PAGE_SIZE_DEFAULT);
  assert.equal(third.items.length, 50, '最后一页是剩下的 50 条');
  assert.equal(third.items[0].id, 't200');
});

check('Tag 条目与预设同构：磁盘上不带来源字段，来源由所属文件表达（D87）', () => {
  const fromDictionary = sanitizePreset({
    id: 'tag:长发',
    label: '长发',
    english: 'long hair',
    weight: 100,
    colorId: DICTIONARY_COLOR,
  });
  assert.equal(fromDictionary.colorId, 'dictionary', 'Tag 用词典色，不能被归一成红');
  assert.equal(fromDictionary.weight, 100, '初始权重 100');
  assert.equal(
    'sourceFile' in fromDictionary,
    false,
    'sourceFile 只在内存里，规范化（= 落盘口径）时不能出现',
  );
  assert.equal(
    'sourceDictionaryId' in fromDictionary,
    false,
    'D86 的来源字段已随 D87 移除（来源由文件名表达）',
  );
});

check('多文件库的内存标记：withSourceFile 打上、toDisk 去掉、分组按文件走（D87）', () => {
  const base = [
    { id: 'tag:长发', label: '长发', english: 'long hair', weight: 100, colorId: 'dictionary', createdAt: 1, updatedAt: 1 },
    { id: 'tag:短发', label: '短发', english: 'short hair', weight: 100, colorId: 'dictionary', createdAt: 1, updatedAt: 1 },
  ];
  const taggedA = withSourceFile(base.slice(0, 1), 'dictionaries/画风/tags.json');
  const taggedB = withSourceFile(base.slice(1), 'tags.json');
  assert.equal(taggedA[0].sourceFile, 'dictionaries/画风/tags.json');
  // 写盘前必须去掉：否则磁盘上会多出一个没人认识的字段
  assert.equal('sourceFile' in toDisk(taggedA)[0], false);

  const groups = groupByFile([...taggedA, ...taggedB], 'tags.json');
  assert.deepEqual([...groups.keys()], ['dictionaries/画风/tags.json', 'tags.json']);
  assert.equal(groups.get('dictionaries/画风/tags.json').length, 1);

  // 没有 sourceFile 的条目（老数据 / 测试夹具）归到 rootFile
  const fallback = groupByFile(base, 'tags.json');
  assert.deepEqual([...fallback.keys()], ['tags.json']);
  assert.equal(fallback.get('tags.json').length, 2);

  // 快照口径与写盘一致（都不含 sourceFile），因此「内容没变就不写」才成立
  assert.equal(snapshotOf(taggedA), JSON.stringify(toDisk(taggedA)));
});

check('拖入 Tag = 纯英文 Tag：锚点进源内容、英文不进翻译请求', () => {
  const modules = [
    {
      id: 'm1',
      order: 1,
      colorId: 'red',
      sourceText: '一个长发女生',
      capsules: [],
      translation: '',
      outputHeight: 56,
      status: 'idle',
    },
  ];
  const inserted = insertCapsuleInto(
    modules,
    'm1',
    {
      presetId: '',
      label: '长发',
      english: 'long hair',
      colorId: DICTIONARY_COLOR,
      kind: 'tag',
    },
    'after-capsules',
  );

  const capsule = inserted[0].capsules[0];
  assert.equal(capsule.kind, 'tag', '词典词条必须是 tag，不是普通胶囊');
  assert.equal(capsule.english, 'long hair');
  assert.equal(capsule.colorId, 'dictionary', '词典 Tag 用词典色');
  assert.equal(capsule.label, '长发', '中文名留着（悬停提示与标签行要用）');

  // 源内容里是一个锚点：因此渲染层能画成纯文本，而翻译层看不见它
  const anchor = capsuleAnchor(capsule.id);
  assert.ok(inserted[0].sourceText.includes(anchor), '源内容里应当写入锚点');
  assert.ok(
    inserted[0].sourceText.indexOf(anchor) < inserted[0].sourceText.indexOf('一个长发女生'),
    'Tag 排在中文之前（与胶囊同一处：已有胶囊/Tag 之后、中文之前）',
  );

  // 核心口径：API 请求体里只有中文，Tag 的英文一个字都不出去
  const plan = buildTranslatePlan(inserted[0].sourceText, inserted[0].capsules);
  assert.equal(plan.text, '一个长发女生', '请求体只能有中文');
  assert.deepEqual(plan.capsuleEnglish, ['long hair'], 'Tag 英文只用于拼接');
  // 复制 / 推流时它照样与胶囊英文一起排在最前面
  assert.equal(
    composeCopyText(plan.capsuleEnglish, 'a girl with long hair'),
    'long hair, a girl with long hair',
  );
});

check('多个 Tag / 胶囊混排：都排在开头区块里，先拖入的在前', () => {
  let modules = [
    {
      id: 'm1',
      order: 1,
      colorId: 'red',
      sourceText: '正文',
      capsules: [],
      translation: '',
      outputHeight: 56,
      status: 'idle',
    },
  ];
  modules = insertCapsuleInto(
    modules,
    'm1',
    { presetId: 'p1', label: '千早爱音', english: 'Chihaya Anon', colorId: 'pink' },
    'after-capsules',
  );
  modules = insertCapsuleInto(
    modules,
    'm1',
    { presetId: '', label: '长发', english: 'long hair', colorId: DICTIONARY_COLOR, kind: 'tag' },
    'after-capsules',
  );
  const plan = buildTranslatePlan(modules[0].sourceText, modules[0].capsules);
  assert.equal(plan.text, '正文', '两个术语都不进请求体');
  assert.deepEqual(plan.capsuleEnglish, ['Chihaya Anon', 'long hair'], '先拖入的在前');
});

check('草稿恢复：Tag 的 kind 与词典色都保住（否则会变回中文药丸）', () => {
  const restored = sanitizeModule(
    {
      id: 'm1',
      sourceText: `${capsuleAnchor('cap_t')} 中文`,
      capsules: [
        {
          id: 'cap_t',
          label: '长发',
          presetId: '',
          english: 'long hair',
          colorId: 'dictionary',
          kind: 'tag',
        },
      ],
    },
    1,
  );
  assert.equal(restored.capsules[0].kind, 'tag');
  assert.equal(restored.capsules[0].colorId, 'dictionary', '词典色不能被归一化成红');
  assert.equal(restored.sourceText, `${capsuleAnchor('cap_t')} 中文`);

  // 普通胶囊保持原样：没有 kind 字段（旧数据的形状一个字都不变）
  const plain = sanitizeModule(
    {
      id: 'm2',
      sourceText: '',
      capsules: [{ id: 'cap_p', label: '甲', presetId: 'p1', english: 'A', colorId: 'red' }],
    },
    1,
  );
  assert.equal(plain.capsules[0].kind, undefined);
  assert.equal(plain.capsules[0].colorId, 'red');
});

check('快照也保留 Tag 标记（还原后不会变成中文药丸）', () => {
  const modules = [
    {
      id: 'm1',
      order: 1,
      colorId: 'red',
      sourceText: `${capsuleAnchor('cap_t')} 中文`,
      capsules: [
        {
          id: 'cap_t',
          label: '长发',
          presetId: '',
          english: 'long hair',
          colorId: 'dictionary',
          kind: 'tag',
        },
      ],
      translation: 'body',
      outputHeight: 56,
      status: 'done',
    },
  ];
  const captured = captureModules(modules);
  assert.equal(captured[0].capsules[0].kind, 'tag', '快照里必须记下 kind');
  const snapshot = buildSnapshot({ name: '含 Tag', scope: 'global', modules: captured });
  const applied = applySnapshotToModules(modules, snapshot);
  assert.equal(applied[0].capsules[0].kind, 'tag', '还原后仍是 Tag');
  assert.equal(applied[0].capsules[0].colorId, 'dictionary', '还原后仍用词典色');
});

check('十万级条目跨文件合并不爆栈（D87：绝不能 push(...items)）', () => {
  /*
   * 用户实测事故：Tag 库读取失败：Maximum call stack size exceeded。
   * 原因是 `presets.push(...items)` —— V8 对「展开成函数参数」有数量上限，
   * 十万级词条时直接抛 RangeError。改成逐个 push 后不再有上限问题。
   * 150000 条刚好越过那个上限，因此这条断言就是那个 bug 的回归守卫。
   */
  const many = Array.from({ length: 150000 }, (_, index) => ({
    id: `tag:词${index}`,
    label: `词${index}`,
    english: `word ${index}`,
    weight: 100,
    colorId: 'dictionary',
    createdAt: 1,
    updatedAt: 1,
  }));
  const { presets, persisted } = mergeLibraryFiles([
    { file: 'tags.json', items: many },
    { file: 'dictionaries/画风词典/tags.json', items: many.slice(0, 3) },
  ]);

  assert.equal(presets.length, 150003, '跨文件统计仍然是各文件相加');
  assert.equal(presets[0].sourceFile, 'tags.json');
  assert.equal(presets[presets.length - 1].sourceFile, 'dictionaries/画风词典/tags.json');
  assert.deepEqual(Object.keys(persisted).sort(), [
    'dictionaries/画风词典/tags.json',
    'tags.json',
  ]);
});

// ---------------------------------------------------------------------------
section('预设分组（D112）：收纳箱、组色由胶囊固定、块级分页');

function folderPreset(id, label, colorId, weight, folder) {
  return {
    id,
    label,
    english: `en-${id}`,
    weight,
    colorId,
    ...(folder ? { folder } : {}),
    createdAt: 1,
    updatedAt: 1,
  };
}

const GROUP_PRESETS = [
  folderPreset('p1', '安和昴', 'blue', 300, '作品集'),
  folderPreset('p2', '千早爱音', 'blue', 200, '作品集'),
  folderPreset('p3', '长崎素世', 'blue', 100, '作品集'),
  folderPreset('p4', '黑长发', 'pink', 500, '角色'),
  folderPreset('p5', '散件甲', 'blue', 400),
  folderPreset('p6', '散件乙', 'mint', 50),
];
const GROUP_FOLDERS = [
  { name: '作品集', colorId: 'blue', expanded: false },
  { name: '角色', colorId: 'pink', expanded: false },
];

check('组名归一：去空白、压缩空格、按字数截断', () => {
  assert.equal(normalizeFolderName('  作品集  '), '作品集');
  assert.equal(normalizeFolderName('My   GO'), 'My GO');
  assert.equal(normalizeFolderName(''), '');
  assert.equal(normalizeFolderName(undefined), '');
  assert.equal(
    Array.from(normalizeFolderName('一'.repeat(50))).length,
    MAX_FOLDER_NAME_LENGTH,
    '超长组名要截断，否则砖会被撑爆',
  );
  assert.equal(folderOf({ folder: ' 角色 ' }), '角色');
  assert.equal(folderOf({}), '', '缺字段 = 未分组');
});

check('分组元数据规范化：色号必须合法；同名不同色是两个组（D113）', () => {
  const folders = sanitizeFolders([
    { name: '作品集', colorId: 'blue', expanded: true },
    { name: '作品集', colorId: 'blue', expanded: false },
    { name: '作品集', colorId: 'pink' },
    { name: '  角色 ', colorId: '不存在的色' },
    { name: '旧的组', colorIds: ['mint'] },
    { name: '' },
    'not an object',
  ]);
  assert.equal(folders.length, 3, '同名同色去重；同名不同色保留；空名/非法色号丢掉');
  assert.equal(folders[0].name, '作品集');
  assert.equal(folders[0].colorId, 'blue');
  assert.equal(folders[0].expanded, true);
  assert.equal(folders[1].name, '作品集');
  assert.equal(folders[1].colorId, 'pink', '同名不同色必须保留成两个组');
  assert.equal(folders[2].name, '旧的组', '第一版的 colorIds 取第一个合法色当组色');
  assert.equal(folders[2].colorId, 'mint');
  assert.equal(folders[2].expanded, false, '缺 expanded 一律折叠');
  assert.deepEqual(sanitizeFolders('坏数据'), [], '非数组输入返回空');
});

check('组的存在：实体与成员派生并集；同名不同色用名字+颜色一起区分', () => {
  const refs = knownFolders(GROUP_PRESETS, []).map(
    (folder) => `${folder.colorId}::${folder.name}`,
  );
  assert.deepEqual(refs.sort(), ['blue::作品集', 'pink::角色']);

  assert.deepEqual(
    knownFolders([], [{ name: '只剩实体', colorId: 'red', expanded: false }]).map(
      (folder) => folder.name,
    ),
    ['只剩实体'],
  );

  const both = knownFolders(
    [
      folderPreset('a', '安和昴', 'blue', 300, '作品集'),
      folderPreset('b', '安和昴', 'pink', 300, '作品集'),
    ],
    [],
  );
  assert.equal(both.length, 2, '同名不同色是两个组');
  assert.equal(sameFolder(both[0], both[1]), false);
  assert.equal(sameFolder(both[0], { name: '作品集', colorId: 'blue' }), true);
});

check('新建组默认名：不撞已有名字', () => {
  assert.equal(nextFolderName([]), NEW_FOLDER_LABEL);
  assert.equal(nextFolderName([NEW_FOLDER_LABEL]), `${NEW_FOLDER_LABEL} 2`);
  assert.equal(nextFolderName([NEW_FOLDER_LABEL, `${NEW_FOLDER_LABEL} 2`]), `${NEW_FOLDER_LABEL} 3`);
});

check('同名不同色是两个组：各自只在自己的色块下出现，折叠状态也各记各的', () => {
  const items = [
    folderPreset('b1', '蓝甲', 'blue', 300, '作品集'),
    folderPreset('p1', '粉甲', 'pink', 200, '作品集'),
  ];
  const folders = [
    { name: '作品集', colorId: 'blue', expanded: false },
    { name: '作品集', colorId: 'pink', expanded: true },
  ];

  const all = buildLibraryBlocks({ items, folders, filterColorIds: [] });
  assert.equal(
    all.filter((block) => block.kind === 'group').length,
    2,
    '总列表里两块砖都要在（靠前置色块区分）',
  );

  const blue = buildLibraryBlocks({ items, folders, filterColorIds: ['blue'] });
  const blueGroups = blue.filter((block) => block.kind === 'group');
  assert.deepEqual(
    blueGroups.map((block) => [block.name, block.colorId]),
    [['作品集', 'blue']],
  );
  assert.deepEqual(blueGroups[0].items.map((item) => item.label), ['蓝甲']);
  assert.equal(blueGroups[0].expanded, false);

  const pink = buildLibraryBlocks({ items, folders, filterColorIds: ['pink'] });
  const pinkGroups = pink.filter((block) => block.kind === 'group');
  assert.equal(pinkGroups.length, 1);
  assert.equal(pinkGroups[0].expanded, true, '两块砖的折叠状态各自独立');
});

check('颜色筛选对**未分组散件**同样生效（D113 修的重大 BUG：筛查一度完全失效）', () => {
  const items = [
    folderPreset('u1', '蓝散件', 'blue', 300),
    folderPreset('u2', '粉散件', 'pink', 200),
    folderPreset('u3', '绿散件', 'green', 100),
  ];

  const blue = buildLibraryBlocks({ items, folders: [], filterColorIds: ['blue'] });
  assert.equal(blue.length, 1);
  assert.equal(blue[0].kind, 'ungrouped');
  assert.deepEqual(blue[0].items.map((item) => item.label), ['蓝散件'], '别的颜色的散件必须被筛掉');

  const none = buildLibraryBlocks({ items, folders: [], filterColorIds: ['red'] });
  assert.deepEqual(none, [], '一条都不匹配时必须彻底空，不能把整库倒出来');
});

check('只认同色：folderAccepts 拒绝异色胶囊（组色不可改，也不许偷偷给胶囊改色）', () => {
  assert.equal(folderAccepts('blue', 'blue'), true);
  assert.equal(folderAccepts('blue', 'pink'), false);
  assert.equal(folderAccepts('红', 'red'), true, '中文色名不是 id，归一后仍然是默认色，不许误放');
});

check('全部颜色：组块在前（组内最高权重降序），未分组在后，组里整组渲染', () => {
  const blocks = buildLibraryBlocks({
    items: GROUP_PRESETS,
    folders: GROUP_FOLDERS,
    filterColorIds: [],
  });
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0].kind, 'group');
  assert.equal(blocks[0].name, '角色', '组内最高权重 500，排在作品集（300）之前');
  assert.equal(blocks[0].colorId, 'pink');
  assert.equal(blocks[1].name, '作品集');
  assert.equal(blocks[1].colorId, 'blue');
  assert.equal(blocks[1].items.length, 3, '整组渲染');
  assert.equal(blocks[2].kind, 'ungrouped');
  assert.deepEqual(
    blocks[2].items.map((item) => item.label),
    ['散件甲', '散件乙'],
    '散件内部按权重降序',
  );
});

check('颜色筛选：只显示该色的组，且组内内容**整组一起显示**（D112 的核心）', () => {
  const blue = buildLibraryBlocks({
    items: GROUP_PRESETS,
    folders: GROUP_FOLDERS,
    filterColorIds: ['blue'],
  });
  assert.deepEqual(
    blue.filter((block) => block.kind === 'group').map((block) => block.name),
    ['作品集'],
    '粉色分组「角色」不该在蓝色筛选下露面',
  );
  const works = blue.find((block) => block.kind === 'group');
  assert.equal(works.colorId, 'blue');
  assert.deepEqual(
    works.items.map((item) => item.label),
    ['安和昴', '千早爱音', '长崎素世'],
    '组里有什么就显示什么，不会再被颜色筛掉一半',
  );

  const pink = buildLibraryBlocks({
    items: GROUP_PRESETS,
    folders: GROUP_FOLDERS,
    filterColorIds: ['pink'],
  });
  assert.deepEqual(
    pink.filter((block) => block.kind === 'group').map((block) => block.name),
    ['角色'],
  );
});

check('空组不渲染：没有成员的组块不会出现在任何视图（D112 修的就是这个问题）', () => {
  const empty = folderPreset('p1', '安和昴', 'blue', 300);
  const blocks = buildLibraryBlocks({
    items: [empty],
    folders: [{ name: '空壳组', colorId: 'blue', expanded: true }],
    filterColorIds: [],
  });
  assert.equal(
    blocks.filter((block) => block.kind === 'group').length,
    0,
    '没有成员的组不许出现（否则点「新建」会造出一个看不见的幽灵组）',
  );
});

check('pruneEmptyFolders：最后一颗胶囊离开后组实体被清掉，还有成员的不动', () => {
  const pruned = pruneEmptyFolders(GROUP_FOLDERS, GROUP_PRESETS);
  assert.deepEqual(pruned.map((folder) => folder.name), ['作品集', '角色']);

  const after = pruneEmptyFolders(GROUP_FOLDERS, GROUP_PRESETS.filter((item) => item.folder !== '角色'));
  assert.deepEqual(after.map((folder) => folder.name), ['作品集'], '角色组空了就该消失');
});

check('搜索：忽略折叠、只留命中的组，组内只剩命中项', () => {
  const blocks = buildLibraryBlocks({
    items: GROUP_PRESETS,
    folders: GROUP_FOLDERS,
    filterColorIds: [],
    keyword: '素世',
  });
  assert.equal(blocks.length, 1, '没命中的组被藏掉，未分组也没有命中项');
  assert.equal(blocks[0].kind, 'group');
  assert.equal(blocks[0].name, '作品集');
  assert.equal(blocks[0].expanded, true, '搜索时忽略折叠状态，直接摊开');
  assert.deepEqual(blocks[0].items.map((item) => item.label), ['长崎素世']);
});

check('块级分页：组永不被页切开，未分组那一段可以切', () => {
  const many = Array.from({ length: 105 }, (_, index) =>
    folderPreset(`p${index}`, `预设${index}`, 'blue', 100 - index),
  );
  const ungroupedOnly = paginateBlocks(
    buildLibraryBlocks({ items: many, folders: [], filterColorIds: [] }),
    1,
    100,
  );
  assert.equal(ungroupedOnly.pageCount, 2, '105 条散件必须分 2 页（块级分页不能把分页废掉）');
  assert.equal(ungroupedOnly.blocks[0].items.length, 100);
  const second = paginateBlocks(
    buildLibraryBlocks({ items: many, folders: [], filterColorIds: [] }),
    2,
    100,
  );
  assert.equal(second.blocks[0].items.length, 5);

  // 展开的组：整块要么全在这一页、要么全在下一页
  const mixed = [
    folderPreset('g1', 'A1', 'blue', 300, '大组'),
    folderPreset('g2', 'A2', 'blue', 200, '大组'),
    folderPreset('g3', 'A3', 'blue', 100, '大组'),
    folderPreset('u1', '散件', 'blue', 50),
  ];
  const openFolders = [{ name: '大组', colorId: 'blue', expanded: true }];
  const page1 = paginateBlocks(
    buildLibraryBlocks({ items: mixed, folders: openFolders, filterColorIds: [] }),
    1,
    2,
  );
  assert.equal(page1.blocks.length, 1, '展开的组独占这一页（页容量 2 装不下 3 条成员）');
  assert.equal(page1.blocks[0].kind, 'group');
  assert.equal(page1.blocks[0].items.length, 3, '整组渲染，绝不切成两半');
  const page2 = paginateBlocks(
    buildLibraryBlocks({ items: mixed, folders: openFolders, filterColorIds: [] }),
    2,
    2,
  );
  assert.equal(page2.blocks[0].kind, 'ungrouped');
});

check('折叠的组只占一颗砖：页容量按 1 算', () => {
  const items = Array.from({ length: 40 }, (_, index) =>
    folderPreset(`p${index}`, `预设${index}`, 'blue', 100 - index, '大组'),
  );
  const page = paginateBlocks(
    buildLibraryBlocks({ items, folders: [], filterColorIds: [] }),
    1,
    10,
  );
  assert.equal(page.pageCount, 1, '40 条都在一个折叠的组里 = 占 1 颗砖，一页装得下');
});

check('改名与解散：只动「同名同色」那一组，别的组与同名异色组一字不改', () => {
  const items = [
    folderPreset('b1', '蓝甲', 'blue', 300, '作品集'),
    folderPreset('p1', '粉甲', 'pink', 200, '作品集'),
    folderPreset('r1', '红甲', 'red', 100, '角色'),
    folderPreset('u1', '散件', 'blue', 50),
  ];
  const blueRef = { name: '作品集', colorId: 'blue' };

  const renamed = renameFolderInItems(items, blueRef, ' 新作品集 ');
  assert.equal(folderOf(renamed[0]), '新作品集', '改名顺便做归一');
  assert.equal(folderOf(renamed[1]), '作品集', '同名异色组不受影响');
  assert.equal(folderOf(renamed[2]), '角色', '别的组不受影响');
  assert.equal(renamed[3].folder, undefined, '未分组的仍然是未分组');

  const dissolved = dissolveFolderInItems(items, blueRef);
  assert.equal(dissolved[0].folder, undefined, '解散后成员回到未分组');
  assert.equal(folderOf(dissolved[1]), '作品集', '同名异色组不受影响');
  assert.equal(dissolved.length, items.length, '解散绝不删条目');
});

check('拖预设到组砖 = 移入分组（带着目标组的颜色）；词典词条与模块枢落到组上一律取消', () => {
  const preset = { kind: 'preset', presetId: 'p1', label: '甲', colorId: 'blue' };
  assert.deepEqual(
    resolveDropAction(preset, { kind: 'preset-group', group: '作品集', color: 'blue' }),
    { action: 'move-preset-into-group', presetId: 'p1', group: '作品集', color: 'blue' },
  );
  assert.deepEqual(
    resolveDropAction(preset, { kind: 'preset-group', group: '', color: '' }),
    { action: 'move-preset-into-group', presetId: 'p1', group: '', color: '' },
    '空组名 = 落在顶部建组判断区，先问名字再建组移入',
  );
  assert.equal(
    resolveDropAction(
      { kind: 'dictionary', label: '甲', english: 'a', colorId: 'dictionary' },
      { kind: 'preset-group', group: '作品集', color: 'blue' },
    ).action,
    'cancel',
    '词典词条不是库里的条目，不能移入分组',
  );
  assert.equal(
    resolveDropAction(
      { kind: 'module', moduleId: 'm1', label: '模块', colorId: 'red' },
      { kind: 'preset-group', group: '作品集', color: 'blue' },
    ).action,
    'cancel',
  );
  // 高亮只在「拖的是预设 + 悬停的正是这个组」时才亮；同名异色不算同一个组
  const hover = { kind: 'preset-group', group: '作品集', color: 'blue' };
  assert.equal(isGroupHover(preset, hover, '作品集', 'blue'), true);
  assert.equal(isGroupHover(preset, hover, '作品集', 'pink'), false);
  assert.equal(isGroupHover(preset, hover, '角色', 'blue'), false);
});

// ---------------------------------------------------------------------------
section('全库导入导出（D115）：默认全选、概况行与账目文案');

const {
  allLibrariesSelected,
  exportReportText,
  formatFileSize,
  importReportRows,
  mergeStatsText,
  selectedLibraryCount,
  summaryRows,
  toggleLibrary,
} = load('utils/bundle.js');
const { BUNDLE_LIBRARY_OPTIONS } = load('constants/bundle.js');

check('五个库按用户叫法排列，默认全选', () => {
  assert.deepEqual(
    BUNDLE_LIBRARY_OPTIONS.map((option) => option.label),
    ['预设库', '画师库', 'Tag 库', '词典库', '快照库'],
    '顺序与用户的说法一致',
  );
  const selection = allLibrariesSelected();
  assert.deepEqual(selection, {
    presets: true,
    artists: true,
    tags: true,
    dictionaries: true,
    snapshots: true,
  });
  assert.equal(selectedLibraryCount(selection), 5);
  const withoutArtists = toggleLibrary(selection, 'artists');
  assert.equal(withoutArtists.artists, false, '切换只动被点的那一项');
  assert.equal(withoutArtists.presets, true);
  assert.equal(selectedLibraryCount(withoutArtists), 4);
});

check('概况行只列出文件里真的带的库，并给出分组与译词条数', () => {
  const base = {
    app: 'prompt-forge',
    version: 1,
    exportedAt: 1,
    included: {
      presets: true,
      artists: true,
      tags: false,
      dictionaries: true,
      snapshots: true,
    },
    presetCount: 12,
    presetFolderCount: 3,
    artistCount: 40,
    tagCount: 999,
    dictionaryCount: 2,
    dictionaryEntryCount: 175_453,
    dictionaryNames: ['甲', '乙'],
    snapshotCount: 4,
  };
  const rows = summaryRows(base);
  assert.deepEqual(
    rows.map((row) => row.key),
    ['presets', 'artists', 'dictionaries', 'snapshots'],
    '没勾的 Tag 库不该出现在概况里',
  );
  assert.equal(rows[0].count, '12 条');
  assert.equal(rows[0].detail, '分组 3 个');
  assert.equal(rows[1].count, '40 条', '画师库报的是整库条数（含词典内）');
  assert.equal(rows[2].count, '2 部');
  assert.equal(rows[2].detail, '译词 175453 条', '词典行报译词条数，不与画师重复计数');

  // 没有分组 / 没有译词时不写空括注
  const plain = summaryRows({
    ...base,
    presetFolderCount: 0,
    dictionaryEntryCount: 0,
  });
  assert.equal(plain[0].detail, '');
  assert.equal(plain[2].detail, '');
});

check('账目文案：三项为零说「无变化」，否则逐项报数', () => {
  assert.equal(mergeStatsText({ added: 0, overwritten: 0, renamed: 0 }), '无变化');
  assert.equal(mergeStatsText({ added: 5, overwritten: 0, renamed: 0 }), '新增 5');
  assert.equal(
    mergeStatsText({ added: 5, overwritten: 2, renamed: 1 }),
    '新增 5、覆盖 2、重命名 1',
  );

  const report = {
    presets: { added: 1, overwritten: 0, renamed: 2 },
    folders: { added: 0, overwritten: 0, renamed: 0 },
    artists: { added: 0, overwritten: 0, renamed: 0 },
    tags: { added: 3, overwritten: 0, renamed: 0 },
    dictionaries: { added: 0, overwritten: 1, renamed: 0 },
    snapshots: { added: 0, overwritten: 0, renamed: 0 },
  };
  const rows = importReportRows(report);
  assert.deepEqual(
    rows.map((row) => row.label),
    ['预设库', 'Tag 库', '词典库'],
    '没有变动的库不占行',
  );
  assert.equal(rows[0].text, '新增 1、重命名 2');
  assert.deepEqual(importReportRows({ ...report, presets: { added: 0, overwritten: 0, renamed: 0 }, tags: { added: 0, overwritten: 0, renamed: 0 }, dictionaries: { added: 0, overwritten: 0, renamed: 0 } }), []);
});

check('体积与导出提示用中文单位（界面零英文）', () => {
  assert.equal(formatFileSize(0), '0 千字节');
  assert.equal(formatFileSize(2_048), '2 千字节');
  assert.equal(formatFileSize(2 * 1024 * 1024), '2.0 兆字节');
  const text = exportReportText({
    path: 'C:/x/榫言全库.json',
    bytes: 3 * 1024 * 1024,
    presets: 12,
    presetFolders: 3,
    artists: 40,
    tags: 5,
    dictionaries: 2,
    snapshots: 0,
  });
  assert.ok(text.includes('预设 12 条'), '应当报预设条数');
  assert.ok(text.includes('词典 2 部'), '应当报词典部数');
  assert.ok(text.includes('3.0 兆字节'), '应当报中文体积');
  assert.equal(text.includes('MB'), false, '不许出现英文单位');
  assert.equal(text.includes('C:/'), false, '提示里不该回显用户路径');
});

// ---------------------------------------------------------------------------
section('输入框胶囊的悬浮权重（§四.1）：解析 / 套括号 / 幂等 / 按顶层逗号拆');

check('权重口径固定为：默认 1、步进 0.05、范围 0.1–3.0、两位小数', () => {
  assert.equal(CAPSULE_WEIGHT_DEFAULT, 1);
  assert.equal(CAPSULE_WEIGHT_STEP, 0.05);
  assert.equal(CAPSULE_WEIGHT_MIN, 0.1);
  assert.equal(CAPSULE_WEIGHT_MAX, 3);
  assert.equal(CAPSULE_WEIGHT_DECIMALS, 2);
});

check('收口：两位小数、夹到 0.1–3.0、非数字回落 1', () => {
  assert.equal(roundCapsuleWeight(1.234), 1.23);
  assert.equal(roundCapsuleWeight(1.235), 1.24);
  assert.equal(roundCapsuleWeight(0.04), 0.1, '低于下限夹到 0.1');
  assert.equal(roundCapsuleWeight(9), 3, '高于上限夹到 3');
  assert.equal(roundCapsuleWeight(Number.NaN), 1);
  assert.equal(roundCapsuleWeight(Number.POSITIVE_INFINITY), 1);
});

check('格式：两位以内、不补零；步进不会出现 0.30000000000000004', () => {
  assert.equal(formatCapsuleWeight(1.5), '1.5');
  assert.equal(formatCapsuleWeight(1.05), '1.05');
  assert.equal(formatCapsuleWeight(3), '3');
  assert.equal(stepCapsuleWeight(1, 1), 1.05);
  assert.equal(stepCapsuleWeight(1.05, -1), 1, '减回去必须正好是 1');
  assert.equal(stepCapsuleWeight(0.1, -1), 0.1, '下限不再往下走');
  assert.equal(stepCapsuleWeight(3, 1), 3, '上限不再往上走');
});

check('拆段：只认括号外、未被转义的顶层逗号', () => {
  assert.deepEqual(splitTopLevel('masterpiece, best quality'), ['masterpiece', ' best quality']);
  assert.deepEqual(
    splitTopLevel('(masterpiece, best quality:1.5), long hair'),
    ['(masterpiece, best quality:1.5)', ' long hair'],
    '括号内的逗号不拆',
  );
  assert.deepEqual(splitTopLevel('a\\,b, c'), ['a\\,b', ' c'], '转义逗号不拆');
  assert.deepEqual(splitTopLevel(''), ['']);
});

check('解析：认出 (x:1.2)、裸分组 (x) 与转义括号 \\\\(oOo\\\\)', () => {
  assert.deepEqual(parseWeightedSegment('(long hair:1.5)'), { body: 'long hair', weight: 1.5 });
  assert.deepEqual(parseWeightedSegment('long hair'), { body: 'long hair', weight: null });
  assert.deepEqual(parseWeightedSegment('(long hair)'), { body: 'long hair', weight: null });
  assert.deepEqual(parseWeightedSegment('((a:1.2))'), { body: '(a:1.2)', weight: null }, '只脱最外层');
  assert.deepEqual(
    parseWeightedSegment('(\\(oOo\\):1.5)'),
    { body: '\\(oOo\\)', weight: 1.5 },
    '画师名里的转义括号是正文，不是权重标记',
  );
});

check('渲染：值 = 1 原样返回，画师名照样包得住（不改输入）', () => {
  assert.equal(renderWeightedSegment('long hair', 1), 'long hair');
  assert.equal(renderWeightedSegment('long hair', 1.5), '(long hair:1.5)');
  assert.equal(renderWeightedSegment('\\(oOo\\)', 1.5), '(\\(oOo\\):1.5)');
  assert.equal(renderWeightedSegment('', 1.5), '', '空段不产出 (:1.5)');
});

check('渲染是无损的：同一个 english 反复渲染同一个值，结果不变（不会套娃）', () => {
  const english = 'masterpiece, best quality';
  const once = renderWeightedEnglish(english, 1.5);
  assert.equal(once, '(masterpiece:1.5), (best quality:1.5)');
  assert.equal(renderWeightedEnglish(english, 1.5), once, '渲染不依赖上一次结果');
  assert.equal(renderWeightedEnglish(english, 1), english, '回到 1 就是原始英文');
  assert.equal(
    english,
    'masterpiece, best quality',
    '渲染不许改输入（也就是「不会再写回 english」）',
  );
});

check('预设自带的括号权重不再被我们误读：english 原样保留', () => {
  // 这条是 D121 的核心收益：预设自带的 `(x:1.2)` 是用户的词，不是我们的权重
  assert.equal(
    renderWeightedEnglish('(masterpiece, best quality:1.2)', 1),
    '(masterpiece, best quality:1.2)',
    '权重 = 1 时一个字都不碰',
  );
  assert.equal(
    renderWeightedEnglish('(masterpiece, best quality:1.2)', 1.5),
    '((masterpiece, best quality:1.2):1.5)',
    '再叠一层也是显式的，不会静默覆盖 1.2',
  );
  assert.equal(renderWeightedEnglish('  a ,, b  ', 1.5), '(a:1.5), (b:1.5)', '空段被丢掉');
  assert.equal(renderWeightedEnglish('', 1.5), '', '没有英文的胶囊什么都不产出');
  // 权重 = 1 是「绝对原样」的最硬边界：空白、连续逗号、波浪号都不许动
  assert.equal(renderWeightedEnglish('  a ,, b  ', 1), '  a ,, b  ', '权重 = 1 时原样返回');
  assert.equal(renderWeightedEnglish('a~b', 1), 'a~b', '~ 原样返回');
  assert.equal(renderWeightedEnglish('x。', 1), 'x。', '句号原样返回');
});

check('撇号不拆括号组：weight 1.5 时括号组整组套一层（不再多乘一层）', () => {
  assert.equal(
    renderWeightedEnglish("woman's face, (masterpiece, best quality)", 1.5),
    "(woman's face:1.5), ((masterpiece, best quality):1.5)",
  );
  assert.equal(
    renderWeightedEnglish('woman’s face, (a, b)', 1.5),
    "(woman’s face:1.5), ((a, b):1.5)",
    '弯撇号同样不影响括号保护',
  );
});

check('旧数据迁移：只认 D120 的规范形状，用户手写的值一个都不改写', () => {
  assert.deepEqual(migrateWeightFromEnglish('(long hair:1.5)'), {
    english: 'long hair',
    weight: 1.5,
  });
  assert.deepEqual(migrateWeightFromEnglish('(a:1.5), (b:1.5)'), {
    english: 'a, b',
    weight: 1.5,
  });
  assert.deepEqual(migrateWeightFromEnglish('long hair'), { english: 'long hair', weight: null });
  assert.deepEqual(
    migrateWeightFromEnglish('(a:1.5), b'),
    { english: '(a:1.5), b', weight: null },
    '混合权重是用户手写的内容，不能整体吞掉',
  );
  // D120 只会写出 0.1–3.0、最多两位小数的值；其余的按用户原文保留，绝不 round/夹断
  assert.deepEqual(
    migrateWeightFromEnglish('(x:1.234)'),
    { english: '(x:1.234)', weight: null },
    '三位小数不是我们的形状',
  );
  assert.deepEqual(
    migrateWeightFromEnglish('(x:9)'),
    { english: '(x:9)', weight: null },
    '越界权重是用户的词，不许夹成 3',
  );
  assert.deepEqual(
    migrateWeightFromEnglish('(x:0)'),
    { english: '(x:0)', weight: null },
    '低于下限也不许夹成 0.1',
  );
  assert.deepEqual(migrateWeightFromEnglish(''), { english: '', weight: null });
});

check('手输：只收十进制数字，认不出就返回 null（保持原值）', () => {
  assert.equal(parseWeightInput('1.5'), 1.5);
  assert.equal(parseWeightInput(' 2 '), 2);
  assert.equal(parseWeightInput('.5'), 0.5);
  assert.equal(parseWeightInput('1.505'), 1.51, '第三位小数四舍五入');
  assert.equal(parseWeightInput('0'), 0.1, '夹到下限');
  assert.equal(parseWeightInput('9'), 3, '夹到上限');
  assert.equal(parseWeightInput(''), null);
  assert.equal(parseWeightInput('abc'), null);
  assert.equal(parseWeightInput('1e5'), null);
  assert.equal(parseWeightInput('1,5'), null);
});

check('Store 侧纯函数：只改目标胶囊的 weight 字段，english 一个字不动', () => {
  const modules = buildInitialModules(2);
  const withCapsule = insertCapsuleInto(
    modules,
    modules[0].id,
    { presetId: 'p1', label: '千早爱音', english: 'masterpiece, Chihaya Anon', colorId: 'red' },
    'after-capsules',
  );
  const capsuleId = withCapsule[0].capsules[0].id;

  const weighted = setCapsuleWeightIn(withCapsule, modules[0].id, capsuleId, 1.5);
  assert.equal(weighted[0].capsules[0].weight, 1.5, '权重进字段');
  assert.equal(
    weighted[0].capsules[0].english,
    'masterpiece, Chihaya Anon',
    'D121：english 保持原始内容，不再被写回括号',
  );
  assert.equal(weighted[0].capsules[0].label, '千早爱音', '中文名不动');
  assert.equal(weighted[0].capsules[0].presetId, 'p1', '来源预设 id 不动');
  assert.equal(weighted[0].sourceText, withCapsule[0].sourceText, '源内容（锚点）不动');
  assert.equal(weighted[1], withCapsule[1], '别的模块没被牵连');

  // 同值重调：返回原数组引用（不触发重渲染，也不触发草稿写盘）
  assert.equal(setCapsuleWeightIn(weighted, modules[0].id, capsuleId, 1.5), weighted);

  const restored = setCapsuleWeightIn(weighted, modules[0].id, capsuleId, 1);
  assert.equal(restored[0].capsules[0].weight, 1, '回到 1');
  assert.equal(restored[0].capsules[0].english, 'masterpiece, Chihaya Anon', 'english 始终没变');

  // 不存在的胶囊 / 模块：原样返回
  assert.equal(setCapsuleWeightIn(withCapsule, modules[0].id, 'cap-nope', 1.5), withCapsule);
  assert.equal(setCapsuleWeightIn(withCapsule, 'mod-nope', capsuleId, 1.5), withCapsule);
});

check('随草稿留下：旧草稿里写在 english 的权重，读盘时搬进字段（D121 迁移）', () => {
  const [module] = sanitizeModules([
    {
      id: 'm1',
      colorId: 'red',
      sourceText: '[[cap:c1]]女孩',
      capsules: [
        { id: 'c1', label: '权重', presetId: 'p', english: '(long hair:1.5)', colorId: 'red' },
      ],
    },
  ]);
  assert.equal(module.capsules[0].weight, 1.5, '旧数据要把括号里的权重搬进字段');
  assert.equal(module.capsules[0].english, 'long hair', '括号同时从 english 里剥掉');

  // 已经有字段的（新数据）按字段为准，english 原样
  const [fresh] = sanitizeModules([
    {
      id: 'm2',
      colorId: 'red',
      sourceText: '[[cap:c2]]女孩',
      capsules: [
        {
          id: 'c2',
          label: '权重',
          presetId: 'p',
          english: 'long hair',
          colorId: 'red',
          weight: 1.25,
        },
      ],
    },
  ]);
  assert.equal(fresh.capsules[0].weight, 1.25);
  assert.equal(fresh.capsules[0].english, 'long hair');
});

check('权重在装配阶段生效：english 干净，输出带括号', () => {
  const module = {
    translation: 'a girl, smiling',
    sourceText: '[[cap:c1]]女孩微笑',
    capsules: [
      { id: 'c1', label: '权重', presetId: 'p', english: 'masterpiece, long hair', colorId: 'red', weight: 1.5 },
    ],
  };
  assert.equal(
    plainEnglishOf(module),
    '(masterpiece:1.5), (long hair:1.5), a girl, smiling',
    '复制出口必须带权重',
  );
  assert.equal(moduleLineOf(module), plainEnglishOf(module), '推流的一排与复制同源');
  assert.equal(
    plainEnglishOf({ ...module, capsules: [{ ...module.capsules[0], weight: 1 }] }),
    'masterpiece, long hair, a girl, smiling',
    '权重 = 1 时与原样一致',
  );
});

check('胶囊英文绝对原样：只加权重括号，不归一任何字符（~ 事故回归）', () => {
  const moduleOf = (english, weight) => ({
    translation: 'a girl',
    sourceText: '[[cap:c1]]女孩',
    capsules: [{ id: 'c1', label: '术语', presetId: 'p', english, colorId: 'red', weight }],
  });
  assert.equal(plainEnglishOf(moduleOf('x。', 1.5)), '(x。:1.5), a girl', '句号原样进入权重括号');
  assert.equal(plainEnglishOf(moduleOf('x!', 1.5)), '(x!:1.5), a girl');
  assert.equal(plainEnglishOf(moduleOf('x,', 1.5)), '(x:1.5), a girl', '顶层逗号是权重分段符');
  assert.equal(plainEnglishOf(moduleOf('x,', 1)), 'x, a girl', '权重 = 1 时连逗号都原样保留');
  assert.equal(plainEnglishOf(moduleOf('masterpiece.', 1)), 'masterpiece., a girl');
  assert.equal(plainEnglishOf(moduleOf('"quoted"', 1)), '"quoted", a girl');
  // 用户实测：胶囊里封装的 `~` 被正文标点表改成了逗号 —— 必须原样
  assert.equal(plainEnglishOf(moduleOf('~', 1)), '~, a girl');
  assert.equal(plainEnglishOf(moduleOf('~', 1.5)), '(~:1.5), a girl');
  assert.equal(plainEnglishOf(moduleOf('a~b', 1)), 'a~b, a girl');
  assert.equal(plainEnglishOf(moduleOf('~', 3)), '(~:3), a girl');
});

check('成品：正文块仍清零句读；胶囊块绝对原样', () => {
  const module = {
    translation: 'smile, long hair',
    sourceText: '[[cap:c1]] [[cap:c2]] 女孩',
    capsules: [
      { id: 'c1', label: '第一', presetId: 'p', english: 'masterpiece. (a, b)', colorId: 'red', weight: 1.5 },
      { id: 'c2', label: '第二', presetId: 'p', english: 'woman’s face!', colorId: 'blue' },
    ],
  };
  assert.equal(
    plainEnglishOf(module),
    '(masterpiece. (a, b):1.5), woman’s face!, smile, long hair',
    '胶囊里的句号/感叹号/弯撇号必须原样',
  );
  // 正文块自己仍然干净：句读→逗号、末尾不留标点
  assert.equal(
    plainEnglishOf({ translation: 'smile! long hair?', sourceText: '中文', capsules: [] }),
    'smile, long hair',
  );
});

// ---------------------------------------------------------------------------
section('右键菜单定位（D120 起三处共用一份）：先量后放、翻边、夹视口');

const MENU = { width: 152, height: 120 };
const VIEW = { viewportWidth: 1280, viewportHeight: 720 };

check('放得下就贴锚点右下，一个像素都不动', () => {
  assert.deepEqual(placeMenu({ anchorX: 100, anchorY: 200, ...MENU, ...VIEW }), {
    left: 100,
    top: 200,
  });
});

check('右侧放不下翻到左边、底部放不下翻到上边（先翻后夹）', () => {
  // 1280 - 152 - 8 = 1120，锚点 1200 贴着右边缘
  assert.deepEqual(placeMenu({ anchorX: 1200, anchorY: 200, ...MENU, ...VIEW }), {
    left: 1200 - 152,
    top: 200,
  });
  // 720 - 120 - 8 = 592，锚点 700 贴着底边
  assert.deepEqual(placeMenu({ anchorX: 100, anchorY: 700, ...MENU, ...VIEW }), {
    left: 100,
    top: 700 - 120,
  });
});

check('翻完仍然越界就夹进视口（窗口比菜单还小也不跑出去）', () => {
  const tiny = { viewportWidth: 200, viewportHeight: 150 };
  const placed = placeMenu({ anchorX: 190, anchorY: 140, ...MENU, ...tiny });
  assert.ok(placed.left >= MENU_EDGE_MARGIN, `左边越界：${placed.left}`);
  assert.ok(placed.top >= MENU_EDGE_MARGIN, `上边越界：${placed.top}`);
  assert.ok(placed.left <= tiny.viewportWidth, '不许跑到窗口右边外面');
  assert.ok(placed.top <= tiny.viewportHeight, '不许跑到窗口下边外面');
});

check('jsdom 那种「量不到布局」（宽高与视口全 0）只退化成贴边，不产生 NaN', () => {
  const placed = placeMenu({ anchorX: 0, anchorY: 0, width: 0, height: 0, viewportWidth: 0, viewportHeight: 0 });
  assert.equal(Number.isFinite(placed.left), true);
  assert.equal(Number.isFinite(placed.top), true);
  assert.equal(placed.left, MENU_EDGE_MARGIN);
  assert.equal(placed.top, MENU_EDGE_MARGIN);
});

// ---------------------------------------------------------------------------
section('提示词工序（S4 装配 / S5 收口）：一份实现、逐段可追踪');

check('收口：句读→逗号、折叠空白、去掉首尾逗号/句读', () => {
  assert.equal(finishPromptText('  a   b  '), 'a b');
  assert.equal(finishPromptText('女孩，长发'), '女孩, 长发', '归一时顺手统一成「, 」');
  assert.equal(finishPromptText('一句。'), '一句', '句号不是内容：收口时去掉');
  assert.equal(finishPromptText('a\n\nb'), 'a b', '换行折成空格');
  assert.equal(finishPromptText('a！b'), 'a, b');
  assert.equal(finishPromptText('a,,b'), 'a, b');
});

check('正文末尾不补标点：句读/逗号一律去掉，内容原样（胶囊不在此列）', () => {
  const parts = (body) => ({ capsuleEnglish: [], body });
  assert.equal(composeRowPrompt(parts('girl')), 'girl');
  assert.equal(composeRowPrompt(parts('girl.')), 'girl');
  assert.equal(composeRowPrompt(parts('girl,')), 'girl');
  assert.equal(composeRowPrompt(parts('girl!')), 'girl');
  assert.equal(composeRowPrompt(parts('girl。')), 'girl');
  assert.equal(composeRowPrompt(parts('girl, smiling')), 'girl, smiling');
});

check('收口幂等：洗两次与洗一次一字不差', () => {
  const samples = ['  a   b  ', '女孩，长发。', 'a\n b', '(x:1.5), y', ''];
  for (const sample of samples) {
    const once = finishPromptText(sample);
    assert.equal(finishPromptText(once), once, `不幂等：${JSON.stringify(sample)}`);
  }
});

check('正文块里不会出现句读（全角或半角）——断言级防线', () => {
  const forbidden = /[。！？；：、．…—～·“”‘’「」『』《》〈〉〔〕!?;"]/;
  const samples = ['女孩，长发', '一句。', 'a；b', '甲、乙', 'x（1.2）', 'a!b', 'a"b"'];
  for (const sample of samples) {
    const row = composeRowPrompt({ capsuleEnglish: [], body: sample });
    assert.equal(forbidden.test(row), false, `正文里还有句读：${row}`);
  }
});

check('traceRowPrompt 逐段快照：装配 → 收口，两步各是什么都钉死', () => {
  const trace = traceRowPrompt({
    capsuleEnglish: ['masterpiece'],
    body: '女孩，长发',
  });
  assert.deepEqual(trace.map((step) => step.stage), ['assemble', 'finish']);
  assert.equal(trace[0].output, 'masterpiece, 女孩，长发', '装配阶段不动标点');
  assert.equal(trace[1].output, 'masterpiece, 女孩, 长发', '收口阶段才归一并统一「, 」');
});

check('装配：空段丢弃、原文已带逗号时不重复补、最后一段原样', () => {
  assert.equal(
    assembleRowPrompt({ capsuleEnglish: ['', '  '], body: 'body' }),
    'body',
    '空段不产出逗号',
  );
  assert.equal(
    assembleRowPrompt({ capsuleEnglish: ['a,'], body: 'b' }),
    'a, b',
    '原文已带逗号时只补空白，不删也不重复',
  );
  assert.equal(
    assembleRowPrompt({ capsuleEnglish: ['a.'], body: 'b' }),
    'a., b',
    '句号是内容，不替用户删',
  );
  assert.equal(assembleRowPrompt({ capsuleEnglish: [], body: 'b,' }), 'b,', '末尾不处理');
});

check('顶层切分：一份实现同时满足括号 / 转义 / 不配平三条（引号已不再是保护符）', () => {
  // 括号内不拆
  assert.deepEqual(splitTopLevelShared('(a, b)', {}), ['(a, b)']);
  // 引号是句读：不再保护逗号（它们进入切分器之前已被映射成逗号）
  assert.deepEqual(splitTopLevelShared('"a, b", c', {}), ['"a', ' b"', ' c']);
  // 反斜杠转义不拆
  assert.deepEqual(splitTopLevelShared('a\\, b, c', {}), ['a\\, b', ' c']);
  // 括号不配平时退回「见到分隔符就切」（半个括号不应该吞掉后面整段）
  assert.deepEqual(splitTopLevelShared('(a, b, c', {}), ['(a', ' b', ' c']);
  // 换行只有在显式要求时才当分隔符
  assert.deepEqual(splitTopLevelShared('a\nb', {}), ['a\nb']);
  assert.deepEqual(splitTopLevelShared('a\nb', { splitNewlines: true }), ['a', 'b']);
  // 切片那一侧的额外分隔符（中文逗号）
  assert.deepEqual(splitTopLevelShared('a，b', { extraSeparators: ['，'] }), ['a', 'b']);
});

check('撇号不再让括号保护失效（权重渲染的回归守卫）', () => {
  // 有撇号 + 括号组：括号内逗号必须仍然不拆
  assert.deepEqual(splitTopLevelShared("woman's face, (masterpiece, best quality)", {}), [
    "woman's face",
    ' (masterpiece, best quality)',
  ]);
  // 弯撇号同理
  assert.deepEqual(splitTopLevelShared('woman’s face, (a, b)', {}), ['woman’s face', ' (a, b)']);
});

check('词典命中不受标点全半角影响：两个键都试（修掉「带标点的词条永远不命中」）', () => {
  const index = buildGlossaryIndex([
    {
      enabled: true,
      entries: [
        { cn: '权重（1.2，0）', en: 'weight(1.2,0)' },
        { cn: '冷峻文风', en: 'cold tone' },
      ],
    },
  ]);
  // 切片进词典前已经被转成半角，词典里是全角 —— 现在两边都能对上
  assert.equal(resolveGlossaryTerm(index, '权重(1.2,0)')?.en, 'weight(1.2,0)');
  assert.equal(resolveGlossaryTerm(index, '权重（1.2，0）')?.en, 'weight(1.2,0)');
  assert.equal(resolveGlossaryTerm(index, '冷峻文风')?.en, 'cold tone');
  assert.equal(resolveGlossaryTerm(index, '不存在的词'), null);
});

check('工序唯一主人：源码里不许再出现第二份「切分 / 连接 / 折叠空白」', () => {
  /*
   * 这条断言是给未来的人看的：同一件事只要出现第二份实现，早晚会分叉
   * （实测过「按逗号清洗把 (a, b:1.5) 拆开」「词典命中率莫名变低」）。
   * 名单是**白名单**：只有这些文件可以为这三件事负责，其余一律不许出现。
   */
  const fs = require('node:fs');
  const path = require('node:path');
  const SRC = path.join(__dirname, '..', 'src');

  const allowed = {
    "replace(/\\s+/g, ' ')": ['utils/promptText.ts', 'utils/placeholder.ts', 'utils/glossary.ts', 'utils/presetLabel.ts', 'utils/presetFolders.ts', 'utils/promptPunctuation.ts'],
    "join(', ')": ['utils/promptText.ts', 'utils/capsuleWeight.ts'],
    "split(',')": ['utils/topLevelSplit.ts'],
    'split(",")': ['utils/topLevelSplit.ts'],
  };

  const walk = (dir) => {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(full));
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
    }
    return out;
  };

  const violations = [];
  for (const file of walk(SRC)) {
    const rel = path.relative(SRC, file).replace(/\\/g, '/');
    const text = fs.readFileSync(file, 'utf8');
    for (const [needle, owners] of Object.entries(allowed)) {
      if (!text.includes(needle)) continue;
      if (!owners.includes(rel)) violations.push(`${rel} 里出现了 ${needle}`);
    }
  }

  assert.deepEqual(violations, [], `这些地方在抢工序的活：\n${violations.join('\n')}`);
});

check('两条链路共用同一个切分器：权重与切片的括号内逗号都不拆', () => {
  // 权重侧（只有逗号）
  assert.deepEqual(splitTopLevel('(a, b:1.5), c'), ['(a, b:1.5)', ' c']);
  // 切片侧（另加中文逗号与换行）。注意切片是先转半角再切，所以括号已经是 ASCII
  assert.deepEqual(
    splitTopLevelShared('甲(1.2，0)，乙', { extraSeparators: ['，'], splitNewlines: true }),
    ['甲(1.2，0)', '乙'],
  );
});

// ---------------------------------------------------------------------------
console.log(`\n通过 ${passed} 项，失败 ${failures.length} 项`);
if (failures.length > 0) {
  console.log(`失败清单：${failures.join('、')}`);
  process.exit(1);
}
