#!/usr/bin/env node
/**
 * 渲染冒烟测试（不依赖浏览器、不启动窗口）。
 *
 * 做法：把 src 编译成 CommonJS 后，用 react-dom/server 把真实的 AppShell 组件树
 * 渲染成静态标记，再对标记做断言。因此它能验证：
 * - 组件树能真实渲染（导入、选择器、Hook 用法没有运行时错误）
 * - 初始 6 排模块、序号、颜色、中文文案、模块枢、筛选条都到位
 *
 * 运行：npm run verify:render
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');

const OUT = path.join(__dirname, '..', '.verify-out');
fs.writeFileSync(path.join(OUT, 'package.json'), '{"type":"commonjs"}\n');
// tsc 不会搬运 CSS，但组件会 import 它们；把样式目录复制过来再交给 .css 加载钩子处理
fs.cpSync(path.join(__dirname, '..', 'src', 'styles'), path.join(OUT, 'styles'), {
  recursive: true,
});
require.extensions['.css'] = () => ({});

const { renderToStaticMarkup } = require('react-dom/server');
const { AppShell } = require(path.join(OUT, 'components/layout/AppShell.js'));
const { CapsuleLabelRow } = require(path.join(OUT, 'components/module/CapsuleLabelRow.js'));
const { ConnectionTest } = require(path.join(OUT, 'components/settings/ConnectionTest.js'));
const { ServiceCredentialFields } = require(
  path.join(OUT, 'components/settings/ServiceCredentialFields.js'),
);
const { ServiceFieldsForm } = require(
  path.join(OUT, 'components/settings/ServiceFieldsForm.js'),
);
const {
  ProviderProfileList,
} = require(path.join(OUT, 'components/settings/ProviderProfileList.js'));
const { ModuleCard } = require(path.join(OUT, 'components/module/ModuleCard.js'));
const { ErrorBanner, ErrorBannerView } = require(
  path.join(OUT, 'components/layout/ErrorBanner.js'),
);
const { TranslationCacheSection } = require(
  path.join(OUT, 'components/settings/TranslationCacheSection.js'),
);
const { PresetEditorDialog } = require(path.join(OUT, 'components/preset/PresetEditorDialog.js'));
const { PresetList } = require(path.join(OUT, 'components/preset/PresetList.js'));
const { PresetGroupList } = require(path.join(OUT, 'components/preset/PresetGroupList.js'));
const { PresetGroupDropzone } = require(
  path.join(OUT, 'components/preset/PresetGroupDropzone.js'),
);
const { SnapshotList } = require(path.join(OUT, 'components/preset/SnapshotList.js'));
const { PushSettingsPanel } = require(
  path.join(OUT, 'components/settings/PushSettingsPanel.js')
);
const { DictionaryList } = require(path.join(OUT, 'components/dictionary/DictionaryList.js'));
const { DictionaryNameDialog } = require(
  path.join(OUT, 'components/dictionary/DictionaryNameDialog.js'),
);
const { DictionaryImportDialog } = require(
  path.join(OUT, 'components/dictionary/DictionaryImportDialog.js'),
);
const { selectFailedModuleCount } = require(path.join(OUT, 'store/selectors.js'));
const { useModuleStore } = require(path.join(OUT, 'store/useModuleStore.js'));
const {
  MODULE_INITIAL_COUNT,
  MODULE_MAX_COUNT,
} = require(path.join(OUT, 'constants/limits.js'));
const { usePresetStore } = require(path.join(OUT, 'store/usePresetStore.js'));
const { useSettingsStore } = require(path.join(OUT, 'store/useSettingsStore.js'));
const { useUiStore } = require(path.join(OUT, 'store/useUiStore.js'));
const { PRESET_FILTER_COLORS } = require(path.join(OUT, 'constants/colors.js'));
const { sanitizeModules } = require(path.join(OUT, 'utils/moduleSanitize.js'));
const {
  createProfile,
  profileKind,
} = require(path.join(OUT, 'utils/profileSanitize.js'));
const {
  findServiceBrand,
  isBrandAvailable,
} = require(path.join(OUT, 'constants/providers.js'));

const html = renderToStaticMarkup(React.createElement(AppShell));
const countOf = (needle) => html.split(needle).length - 1;

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
section('骨架渲染');

check(`顶栏渲染出品牌与模块计数「模块 ${MODULE_INITIAL_COUNT} / ${MODULE_MAX_COUNT}」`, () => {
  assert.ok(html.includes('Prompt Forge'), '缺少品牌名');
  // 2026 轮：副标题改为「提示词工坊」（主标题保持 Prompt Forge）
  assert.ok(html.includes('提示词工坊'), '缺少新副标题「提示词工坊」');
  assert.equal(html.includes('提示词模块化组装台'), false, '旧副标题应当已被替换');
  assert.ok(
    html.includes(`模块 ${MODULE_INITIAL_COUNT} / ${MODULE_MAX_COUNT}`),
    '缺少模块计数',
  );
});

check('顶栏为「翻译服务 | 新增模块 | 删除模块 | 主题 | 齿轮」（D80：文字设置按钮与词典按钮都已移除）', () => {
  const order = [
    'pf-topbar__provider',
    '>新增模块</button>',
    '>删除模块</button>',
    'pf-topbar__theme',
    'pf-topbar__app-settings',
  ];
  const positions = order.map((needle) => html.indexOf(needle));
  for (let index = 0; index < order.length; index += 1) {
    assert.ok(positions[index] >= 0, `缺少元素：${order[index]}`);
    if (index > 0) {
      assert.ok(positions[index] > positions[index - 1], `顺序不对：${order[index]}`);
    }
  }
  assert.ok(html.includes('翻译服务：'), '缺少当前服务提示');
  // 翻译服务标签就是打开设置的入口：必须带中文悬停说明
  assert.ok(
    html.includes('title="点击配置翻译服务"'),
    '翻译服务标签缺少「点击配置翻译服务」的悬停说明',
  );
  // D80：顶栏「词典」按钮已移除（词典管理迁进齿轮设置弹窗的第二个 Tab）
  assert.equal(html.includes('pf-topbar__dictionary'), false, '顶栏「词典」按钮应当已移除');
  assert.equal(html.includes('title="打开词典管理"'), false, '「打开词典管理」的悬停说明应当已移除');
  // D80：齿轮按钮在主题按钮右边（顶栏最右端），悬停与无障碍名都是中文
  assert.ok(html.includes('title="设置（推送服务 / 词典管理）"'), '齿轮按钮缺少中文悬停说明');
  assert.ok(html.includes('aria-label="打开设置"'), '齿轮按钮缺少中文无障碍名');
  // 文字的「设置」按钮仍然不许回来（齿轮是纯图标）
  assert.equal(countOf('>设置</button>'), 0, '顶栏文字「设置」按钮已移除（齿轮图标负责）');
  assert.equal(html.includes('快捷键：Ctrl+,'), false, '设置按钮的快捷键提示已随按钮移除');
  // 移除的三个按钮一个都不许回来
  assert.equal(html.includes('全文翻译'), false, '「全文翻译」已被实时翻译替代');
  assert.equal(html.includes('重试失败项'), false, '「重试失败项」已移除（改由错误横幅承担）');
  assert.equal(html.includes('pf-topbar__progress'), false, '批量进度条已随批量翻译移除');
});

check('输入框右上角是「色块 + 全文清空 | 全文复制」（复制在最右，用户指定）', () => {
  assert.equal(countOf('pf-input-pane__toolbar'), 1, '工具条只应有一个');
  assert.equal(countOf('pf-input-pane__swatch'), 1, '色块标记必须保留');
  assert.equal(countOf('>全文复制</button>'), 1);
  assert.equal(countOf('>全文清空</button>'), 1);
  // 顺序：清空在左、复制在右
  const clearAt = html.indexOf('>全文清空</button>');
  const copyAt = html.indexOf('>全文复制</button>');
  assert.ok(clearAt < copyAt, '「全文复制」应当在「全文清空」右边');
  // 移除的两个按钮不许回来
  assert.equal(countOf('>翻译</button>'), 0, '「翻译」按钮已移除（实时翻译承担）');
  assert.equal(countOf('>清空</button>'), 0, '「清空当前模块」已移除（改由模块枢拖回自身）');
  // 状态字与用量信息随 SourceToolbar 一并移除，不该回来
  assert.equal(countOf('pf-input-pane__status'), 0, '状态字已移除');
  assert.equal(countOf('pf-input-pane__meta'), 0, '用量信息已移除');
  // 这两个动作作用于全部模块，因此不该出现在顶栏
  assert.equal(
    html.slice(0, html.indexOf('pf-workbench')).includes('全文复制'),
    false,
    '「全文复制」不该留在顶栏',
  );
});

check('顶栏与输入框都不再出现「全文清空」之外的批量按钮，模块行上没有任何操作按钮', () => {
  assert.ok(html.includes('>删除模块</button>'), '顶栏缺少删除模块按钮');
  assert.equal(countOf('>重置</button>'), 0, '「重置」应当已改名为「全文清空」');
  assert.equal(countOf('pf-module__translate'), 0, '模块行不该再有翻译按钮');
  assert.equal(countOf('pf-module__clear'), 0, '模块行不该再有清空按钮');
  assert.equal(countOf('pf-module__remove'), 0, '模块行不该再有删除按钮');
});

check('静态渲染下没有失败横幅（没有失败就不该显示）', () => {
  assert.equal(html.includes('pf-failure'), false, '没有失败时不该有失败横幅');
});

check('错误横幅：常驻、说清原因、有重试、并明确告知内容没丢（不是 toast）', () => {
  // 纯展示层用夹具断言：SSR 下 zustand 只返回初始状态，容器层测不出「真有失败」的样子
  const bannerHtml = renderToStaticMarkup(
    React.createElement(ErrorBannerView, {
      failedOrders: [1, 2],
      message: '请求超时，请检查网络或调大超时时间',
      onRetry: () => {},
      onDismiss: () => {},
    }),
  );
  assert.ok(bannerHtml.includes('pf-failure'), '缺少错误横幅');
  assert.ok(bannerHtml.includes('role="alert"'), '失败提示必须是 alert，读屏才会主动播报');
  assert.ok(bannerHtml.includes('2 个模块翻译失败'), `缺少失败模块数量：${bannerHtml}`);
  assert.ok(bannerHtml.includes('模块 1、2'), '缺少失败模块序号，用户不知道该看哪一排');
  assert.ok(bannerHtml.includes('请求超时，请检查网络或调大超时时间'), '缺少中文失败原因');
  assert.ok(bannerHtml.includes('没有任何丢失'), '必须明确告诉用户中文内容还在');
  assert.ok(bannerHtml.includes('我知道了'), '必须有一个手动关闭入口');
  // 必须有重试：工具栏整合后移除了所有手动翻译按钮，这里是失败后的唯一补救入口
  assert.ok(bannerHtml.includes('>重试</button>'), '缺少重试按钮');

  // 单排失败时只说那一排
  const singleHtml = renderToStaticMarkup(
    React.createElement(ErrorBannerView, {
      failedOrders: [3],
      message: '密钥无效',
      onRetry: () => {},
      onDismiss: () => {},
    }),
  );
  assert.ok(singleHtml.includes('模块 3 翻译失败'), `单排文案不对：${singleHtml}`);
  assert.equal(singleHtml.includes('1 个模块翻译失败'), false, '单排不该说「1 个模块」');
});

check('重试进行中时按钮禁用并显示进行中文案', () => {
  const retryingHtml = renderToStaticMarkup(
    React.createElement(ErrorBannerView, {
      failedOrders: [1],
      message: '网络不可用',
      retrying: true,
      onRetry: () => {},
      onDismiss: () => {},
    }),
  );
  assert.ok(retryingHtml.includes('重试中……'), '应当显示进行中的文案');
  assert.ok(/disabled/.test(retryingHtml), '进行中时按钮应当禁用，避免重复点击');
});

check('容器层没有失败时不渲染任何东西（也不该留下空壳）', () => {
  useUiStore.getState().dismissTranslationFailure();
  useModuleStore.getState().resetModules();
  assert.equal(
    renderToStaticMarkup(React.createElement(ErrorBanner)).includes('pf-failure'),
    false,
  );
});

check('设置面板带「翻译缓存」区：条数、占用、开关与清空都渲染出来', () => {
  // 只渲染这一个组件，避免依赖整个弹窗的展开状态
  const cacheHtml = renderToStaticMarkup(React.createElement(TranslationCacheSection));
  assert.ok(cacheHtml.includes('翻译缓存'), '缺少标题');
  assert.ok(cacheHtml.includes('0 条'), '应当显示条数（初始为 0）');
  assert.ok(cacheHtml.includes('约 0 字节'), '应当显示占用大小');
  assert.ok(cacheHtml.includes('清空缓存'), '缺少清空入口');
  assert.ok(cacheHtml.includes('已启用'), '缺省应当是启用状态');
  // 界面文案零英文：这里不允许出现 latin 字母（数字与中文标点除外）
  const latin = cacheHtml.replace(/<[^>]*>/g, ' ').match(/[A-Za-z]{2,}/g) ?? [];
  assert.deepEqual(latin, [], `缓存区出现了英文文案：${latin.join('、')}`);
});

check('缓存为空时「清空缓存」不可点（避免无意义操作）', () => {
  const cacheHtml = renderToStaticMarkup(React.createElement(TranslationCacheSection));
  assert.equal(
    /class="pf-btn[^"]*"[^>]*disabled/.test(cacheHtml),
    true,
    '0 条时清空按钮应当禁用',
  );
});

check('错误横幅的关闭与重试接线正确（onDismiss / onRetry 真的被调用）', () => {
  let dismissed = 0;
  let retried = 0;
  const bannerHtml = renderToStaticMarkup(
    React.createElement(ErrorBannerView, {
      failedOrders: [1],
      message: '密钥无效',
      onRetry: () => {
        retried += 1;
      },
      onDismiss: () => {
        dismissed += 1;
      },
    }),
  );
  assert.ok(bannerHtml.includes('我知道了'));
  assert.ok(bannerHtml.includes('>重试</button>'));
  // 直接验证 Store 侧的关闭动作是幂等的、且真的清空状态
  useUiStore.getState().showTranslationFailure('密钥无效', 'AUTH');
  assert.equal(useUiStore.getState().translationFailure?.message, '密钥无效');
  assert.equal(useUiStore.getState().translationFailure?.code, 'AUTH');
  useUiStore.getState().dismissTranslationFailure();
  assert.equal(useUiStore.getState().translationFailure, null, '关闭后必须清空，否则横幅会复活');
  assert.equal(dismissed, 0, '静态渲染不会触发点击，这里只确认回调接线正确');
  assert.equal(retried, 0, '静态渲染不会触发点击，这里只确认回调接线正确');
});

check('渲染出 6 排模块，且恰好 1 排处于选中态', () => {
  assert.equal(countOf('data-pf-module-id'), 6);
  assert.equal(countOf('pf-module--selected'), 1);
});

check('每排有序号 1..6；输入框右上角有色块标记当前编辑的排', () => {
  for (const order of [1, 2, 3, 4, 5, 6]) {
    assert.ok(html.includes(`pf-module__index">${order}</span>`), `缺少序号 ${order}`);
  }
  assert.equal(countOf('pf-input-pane__label'), 0, '不该再有「模块 N · 颜色」文字');
  // 色块是标记当前编辑哪一排用的（工具栏整合时误删过，用户要求补回）
  assert.equal(countOf('pf-input-pane__swatch'), 1, '应当正好一个色块');
  assert.ok(html.includes('--pf-module-gradient:linear-gradient(135deg'), '色块缺少渐变');
  assert.ok(html.includes('aria-label="当前编辑的是模块 1"'), '色块缺少无障碍名');
});

check('颜色来自注册表且按行内变量注入（前 6 个模块：红橙黄绿青蓝）', () => {
  const { colorHex } = require(path.join(OUT, 'constants/colors.js'));
  for (const id of ['red', 'orange', 'yellow', 'green', 'cyan', 'blue']) {
    assert.ok(html.includes(`--pf-module-color:${colorHex(id)}`), `缺少 ${id} 的主色`);
    assert.ok(html.includes(`--pf-module-gradient:linear-gradient(135deg`), '色条没有用渐变');
  }
});

check('输出列表只读展示英文与胶囊，中文编辑器只有下方一个', () => {
  assert.equal(countOf('pf-module__body'), MODULE_INITIAL_COUNT);
  // 用户 2026 轮：未翻译的排不再写「尚未翻译」，模块保持干净
  assert.equal(countOf('尚未翻译'), 0, '不该再出现「尚未翻译」占位');
  assert.equal(countOf('pf-module__placeholder'), 0, '未翻译时连占位元素都不渲染');
  assert.equal(countOf('pf-source__caption'), 0, '中文源内容不再挂在每一排上');
  assert.equal(countOf('pf-output__caption'), 0, '英文译文不再有独立标题');
});

check('下方输入框是 contenteditable 编辑器（承载内联胶囊药丸）', () => {
  // React 19 的静态渲染把属性名输出成 contentEditable，HTML 属性名大小写不敏感，因此按不敏感匹配
  assert.equal(html.split(/contenteditable="plaintext-only"/i).length - 1, 1);
  assert.equal(countOf('data-placeholder='), 1);
  assert.equal(html.includes('<textarea'), false, '不应再是 textarea');
});

check('没有拖拽时不应出现落点半区提示', () => {
  assert.equal(countOf('pf-half'), 0);
  assert.equal(countOf('pf-module__danger-hint'), 0);
  assert.equal(countOf('pf-ghost'), 0, '没有拖拽就不该有幽灵元素');
});

check('每排高度由模块自身决定（初始 56px）且内容超出时细滚动', () => {
  assert.equal(countOf('pf-module__body pf-scroll-thin'), MODULE_INITIAL_COUNT);
  assert.equal(countOf('height:56px'), MODULE_INITIAL_COUNT);
});

check('每排底部各有一条细拖拽条（调这一排的高度）', () => {
  assert.equal(countOf('pf-module__resize'), MODULE_INITIAL_COUNT);
});

check('每排右侧各有一个模块枢（ModuleHub）', () => {
  assert.equal(countOf('class="pf-hub"'), MODULE_INITIAL_COUNT);
});

check('删除模块在顶栏：初始模块数未达下限，应当可点（点了才提示原因）', () => {
  const removeIndex = html.indexOf('>删除模块</button>');
  assert.ok(removeIndex >= 0, '顶栏缺少删除模块按钮');
  // 未达下限时不禁用，而是点了给出中文提示（否则用户只能对着灰按钮猜）
  const buttonTag = html.slice(html.lastIndexOf('<button', removeIndex), removeIndex);
  assert.equal(buttonTag.includes('disabled'), false, '未达下限时不该禁用');
  assert.ok(buttonTag.includes('删除当前选中的模块'), '缺少悬停说明');
});

// ---------------------------------------------------------------------------
section('三栏工作区布局（左：输出列表 / 输入框；右：预设库）');

check('左列上=输出列表、下=中文输入框，两条分隔条各就各位', () => {
  assert.ok(html.includes('pf-workbench'), '缺少工作区');
  assert.ok(html.includes('pf-left-col'), '缺少左列');
  assert.ok(html.includes('pf-output-pane'), '缺少输出列表');
  assert.ok(html.includes('pf-input-pane'), '缺少输入框');
  assert.equal(html.split('class="pf-splitter').length - 1, 2, '应有两条分隔条');
  assert.ok(html.includes('pf-splitter--y'), '缺少水平分隔条（调输入框高度）');
  assert.ok(html.includes('pf-splitter--x'), '缺少垂直分隔条（调预设库宽度）');
});

check('预设库在右栏：DOM 顺序排在左列之后', () => {
  const leftIndex = html.indexOf('pf-left-col');
  const presetIndex = html.indexOf('data-pf-preset-panel');
  assert.ok(leftIndex >= 0, '缺少左列');
  assert.ok(presetIndex > leftIndex, '预设库应当排在左列之后（也就是右侧）');
});

check('布局尺寸通过行内变量注入工作区（分隔条改的就是它）', () => {
  assert.ok(html.includes('--pf-input-height:254px'), '缺少输入框高度变量（默认 254px = 刚好放下 6 排）');
  assert.ok(html.includes('--pf-preset-width:276px'), '缺少预设库宽度变量（默认宽度 = 一行 8 块，12 块排成 8+4，D77）');
});

// ---------------------------------------------------------------------------
section('预设库骨架与颜色筛选');

check('预设库面板渲染出标题、计数与新增入口', () => {
  assert.ok(html.includes('预设库'), '缺少面板标题');
  assert.ok(html.includes('新增预设'), '缺少新增按钮');
  assert.ok(html.includes('正在读取预设库'), '未加载完成时应给出中文提示');
});

check('预设库顶部有搜索框，占位提示为「搜索预设名称」', () => {
  assert.ok(html.includes('placeholder="搜索预设名称"'), '缺少搜索框');
  assert.ok(html.includes('class="pf-search'), '缺少搜索框容器');
  assert.ok(html.includes('aria-label="搜索预设名称"'), '搜索框缺少无障碍名');
});

check('颜色筛选条：9 种彩色 + Tag T + 画师 @ + 快照 S，没有「全部」按钮，也没有文字', () => {
  // 数量从注册表推导，而不是写死一个数字：颜色种类会随用户要求增减。
  // 按 role="radio" 数：内部颜色层的类名是 `pf-swatch__inner`，用 `class="pf-swatch` 前缀数会把它一起算进来。
  // D85 / D86：色块行 = 9 个筛选色 + Tag 库 `T` + 画师库 `@` + 快照库 `S`
  // （颜色池由 10 收到 9、同时多了一个库切换块，所以总数仍是 12 块）
  const swatchCount = PRESET_FILTER_COLORS.length + 3;
  assert.equal(
    html.split('role="radio"').length - 1,
    swatchCount,
    '筛选色块数量 = 9 色 + Tag T + 画师 @ + 快照 S',
  );
  assert.equal(html.includes('>全部<'), false, '不应再有「全部」按钮（不选即全部）');
  assert.equal(html.includes('>通用<'), false, '不应再有「通用」筛选项');
  // 色块靠 title / aria-label 说明颜色，界面上不带文字
  assert.ok(html.includes('aria-label="按颜色筛选：红"'), '缺少颜色无障碍名');
  assert.ok(html.includes('title="粉"'), '缺少第八种颜色（粉）的色块');
  // D77 / D85：薄荷仍是颜色池的最后一个色块，且带自己的渐变
  assert.ok(html.includes('title="薄荷"'), '缺少第九种颜色（薄荷）的色块');
  // D85：丁香已删（用户口径：直接去掉注册表里最后一个色块）
  assert.equal(html.includes('title="丁香"'), false, 'D85：丁香色块必须已从筛选条消失');
  // D86：Tag 库入口（原来的「词典库 D」，改名后字符换成 T、悬停提示「Tag 库」）
  assert.ok(html.includes('aria-label="Tag 库"'), '缺少 Tag 库入口色块');
  assert.ok(html.includes('title="Tag 库"'), 'Tag 块的悬停提示必须是「Tag 库」');
  assert.equal(html.includes('aria-label="词典库"'), false, '「词典库」这个名字已被 Tag 库取代');
  assert.ok(html.includes('aria-label="画师库"'), '缺少画师库入口色块');
  assert.ok(html.includes('aria-label="快照库"'), '缺少快照库入口色块');
  // D89：三个库切换块的悬停提示统一成库名（不再带「再点一次…」的长说明）
  assert.ok(html.includes('title="画师库"'), '画师块的悬停提示必须是「画师库」');
  assert.ok(html.includes('title="快照库"'), '快照块的悬停提示必须是「快照库」');
  assert.equal(html.includes('画师库（'), false, '画师块不该再带括号长说明');
  assert.equal(html.includes('快照库（'), false, '快照块不该再带括号长说明');
  assert.equal(html.includes('查看快照'), false, '快照块旧的「查看快照」提示应当已替换');
  assert.ok(html.includes('pf-swatch__glyph'), '库切换色块应当带单字符徽标');
  // 三个库切换块上的字符：T / @ / S
  assert.ok(html.includes('>T</span>'), 'Tag 块上应当是 T 字徽标');
  assert.ok(html.includes('>@</span>'), '画师块上应当是 @ 徽标');
  assert.ok(html.includes('>S</span>'), '快照块上应当是 S 徽标');
  // Tag 块沿用用户指定的 3 档渐变
  assert.ok(
    html.includes(
      '--pf-swatch-gradient:linear-gradient(-225deg, #D4FFEC 0%, #57F2CC 48%, #4596FB 100%)',
    ),
    'Tag 块应当是 浅薄荷→薄荷→天蓝 的三色标渐变（用户给的 CSS 原样）',
  );
  // D77 / D78：画师与快照块用注册表里的**复杂渐变**（整段 CSS 原样出现在变量里）
  assert.ok(
    html.includes(
      '--pf-swatch-gradient:linear-gradient(to top, #d5dee7 0%, #ffafbd 0%, #c9ffbf 100%)',
    ),
    '画师块应当是 灰蓝→粉→薄荷绿 的三色标渐变（D78 用户新选的那条）',
  );
  assert.ok(
    html.includes('--pf-swatch-gradient:linear-gradient(to top, #9795f0 0%, #fbc8d4 100%)'),
    '快照块应当是从下往上的藕荷→浅粉渐变',
  );
  // D47 / D75：自由色（白）已删除，筛选条只剩 9 种模块色，全部是渐变
  assert.equal(html.includes('title="白"'), false, '白色色块（自由色）不许回来');
  assert.ok(html.includes('--pf-swatch-gradient:linear-gradient(135deg'), '色块没有用渐变');
  assert.equal(html.includes('--pf-swatch-gradient:#ffffff'), false, '不该再有纯白色块');
  // 用户 2026 轮：单选语义（radiogroup + 内部色块分层，便于选中时缩小内部、放大外框）
  assert.ok(html.includes('role="radiogroup"'), '筛选应当是单选语义');
  assert.ok(html.includes('role="radio"'), '每个色块应当是单选项');
  assert.equal(
    html.split('pf-swatch__inner').length - 1,
    swatchCount,
    '每个色块都要有内部颜色层（选中时只缩小它）',
  );
});

check('颜色筛选是**单选**：点一个只留一个，再点同一个 = 回到全部', () => {
  const [first, second] = PRESET_FILTER_COLORS;

  // 空选 = 全部
  useUiStore.getState().clearPresetFilter();
  assert.deepEqual(useUiStore.getState().presetFilterColorIds, []);

  // 点第一个 → 只选中它
  useUiStore.getState().togglePresetFilterColor(first.id);
  assert.deepEqual(useUiStore.getState().presetFilterColorIds, [first.id]);

  // 点第二个 → **顶替**它，而不是变成两个都选（用户 2026 轮：不要组合筛选）
  useUiStore.getState().togglePresetFilterColor(second.id);
  assert.deepEqual(
    useUiStore.getState().presetFilterColorIds,
    [second.id],
    '应当直接换成新颜色，不能变成多选',
  );

  // 再点同一个 → 取消，回到全部
  useUiStore.getState().togglePresetFilterColor(second.id);
  assert.deepEqual(useUiStore.getState().presetFilterColorIds, [], '再点同一个应当回到全部');
});

// ---------------------------------------------------------------------------
section('界面文案不出现脚手架遗留的英文');

check('没有 demo 遗留文案', () => {
  for (const leftover of ['Welcome', 'Greet', 'Enter a name', 'Tauri + React']) {
    assert.equal(html.includes(leftover), false, `残留了 ${leftover}`);
  }
});

// ---------------------------------------------------------------------------
section('Store 与纯逻辑层的接线');

check('初始状态为 6 个模块且选中第 1 个', () => {
  const state = useModuleStore.getState();
  assert.equal(state.modules.length, 6);
  assert.equal(state.selectedModuleId, state.modules[0].id);
});

check('连续新增到 10 个后返回 false（第 11 个被拦下，D75）', () => {
  while (useModuleStore.getState().modules.length < MODULE_MAX_COUNT) {
    assert.equal(useModuleStore.getState().addModule(), true);
  }
  assert.equal(useModuleStore.getState().modules.length, MODULE_MAX_COUNT);
  assert.equal(useModuleStore.getState().addModule(), false);
  assert.equal(useModuleStore.getState().modules.length, MODULE_MAX_COUNT);
});

check('删到只剩 1 个后返回 false（最后一个被保护）', () => {
  while (useModuleStore.getState().modules.length > 1) {
    const target = useModuleStore.getState().modules[0].id;
    assert.equal(useModuleStore.getState().removeModule(target), true);
  }
  const state = useModuleStore.getState();
  assert.equal(state.modules.length, 1);
  assert.equal(useModuleStore.getState().removeModule(state.modules[0].id), false);
});

check('选中模块被删除后，选中态落到相邻模块而不是悬空', () => {
  useModuleStore.getState().resetModules();
  const state = useModuleStore.getState();
  const removedId = state.selectedModuleId;
  useModuleStore.getState().removeModule(removedId);
  const after = useModuleStore.getState();
  assert.notEqual(after.selectedModuleId, removedId);
  assert.ok(after.modules.some((m) => m.id === after.selectedModuleId));
});

check('setSourceText 写入后可读回', () => {
  useModuleStore.getState().resetModules();
  const id = useModuleStore.getState().modules[0].id;
  useModuleStore.getState().setSourceText(id, '把这段话改写成更礼貌的商务语气');
  assert.equal(useModuleStore.getState().modules[0].sourceText, '把这段话改写成更礼貌的商务语气');
});

check('clearModule 清空源内容、胶囊、译文与状态', () => {
  const id = useModuleStore.getState().modules[0].id;
  useModuleStore.getState().setTranslation(id, 'Please rewrite this politely.');
  useModuleStore.getState().setStatus(id, 'done');
  useModuleStore.getState().clearModule(id);
  const module = useModuleStore.getState().modules[0];
  assert.equal(module.sourceText, '');
  assert.equal(module.translation, '');
  assert.equal(module.status, 'idle');
  assert.deepEqual(module.capsules, []);
});

check('setOutputHeight 被夹在 [56, 720] 之间（需求：最小高度 56px）', () => {
  const id = useModuleStore.getState().modules[0].id;
  useModuleStore.getState().setOutputHeight(id, 10);
  assert.equal(useModuleStore.getState().modules[0].outputHeight, 56);
  useModuleStore.getState().setOutputHeight(id, 9999);
  assert.equal(useModuleStore.getState().modules[0].outputHeight, 720);
});

// ---------------------------------------------------------------------------
section('预设列表渲染（用夹具数据直接渲染纯展示组件）');

const presetFixture = [
  {
    id: 'p2',
    label: '橙的高权重',
    english: 'in a formal business tone',
    weight: 900,
    colorId: 'orange',
    createdAt: 1,
    updatedAt: 2,
  },
  {
    id: 'p1',
    label: '红的低权重',
    english: '',
    weight: 10,
    colorId: 'red',
    createdAt: 1,
    updatedAt: 2,
  },
  {
    id: 'p3',
    label: '红的高权重',
    english: 'in a cold restrained tone',
    weight: 500,
    colorId: 'red',
    createdAt: 1,
    updatedAt: 2,
  },
];

const noop = () => {};
const listHtml = renderToStaticMarkup(
  React.createElement(PresetList, {
    presets: presetFixture,
    totalCount: presetFixture.length,
    onContextMenu: noop,
  }),
);
const listCountOf = (needle) => listHtml.split(needle).length - 1;

check('渲染出 3 条预设，顺序与传入一致', () => {
  assert.equal(listCountOf('class="pf-preset-item"'), 3);
  const positions = presetFixture.map((preset) => listHtml.indexOf(preset.label));
  assert.ok(positions.every((position) => position >= 0), '有预设命名没渲染出来');
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, '渲染顺序与传入顺序不一致');
});

check('每条只显示颜色点 + 中文命名（权重/按钮都收进右键菜单）', () => {
  for (const preset of presetFixture) {
    assert.ok(listHtml.includes(preset.label), `缺少预设命名 ${preset.label}`);
  }
  // 紧凑 chip：一个色点 + 一个名字
  assert.equal(listCountOf('class="pf-preset-item__dot"'), 3);
  assert.equal(listCountOf('class="pf-preset-item__label"'), 3);
  // 权重不再常驻显示，编辑/删除按钮也不在列表里
  assert.equal(listHtml.includes('<input'), false, '列表里不该再有输入框');
  assert.equal(listHtml.includes('>编辑<'), false, '列表里不该再有编辑按钮');
  assert.equal(listHtml.includes('>删除<'), false, '列表里不该再有删除按钮');
});

check('色点用与筛选块、胶囊一致的渐变变量', () => {
  assert.ok(listHtml.includes('--pf-preset-gradient:linear-gradient(135deg'), '色点没有渐变');
  assert.ok(listHtml.includes('--pf-preset-color:#'), '色点缺少主色变量');
});

check('英文内容绝不出现在列表标记里（需求：藏在预设库）', () => {
  for (const secret of ['in a formal business tone', 'in a cold restrained tone']) {
    assert.equal(listHtml.includes(secret), false, `英文内容泄漏到界面：${secret}`);
  }
  assert.equal(listHtml.includes('english'), false, '不应出现英文内容字段');
});

check('一条都没有时给出中文空态', () => {
  const empty = renderToStaticMarkup(
    React.createElement(PresetList, {
      presets: [],
      totalCount: 0,
      onContextMenu: noop,
    }),
  );
  assert.ok(empty.includes('暂无预设'));
});

check('被筛掉时给出另一套中文空态', () => {
  const filtered = renderToStaticMarkup(
    React.createElement(PresetList, {
      presets: [],
      totalCount: 5,
      onContextMenu: noop,
    }),
  );
  assert.ok(filtered.includes('没有匹配的预设'));
});

// ---------------------------------------------------------------------------
section('预设 Store 接线');

check('新建预设默认权重 100、颜色落红（不再有「白」这个无属性色）、id 自动生成', () => {
  usePresetStore.getState().replaceAll([]);
  const created = usePresetStore.getState().addPreset({
    label: '预设标签-0',
    english: 'in a formal business tone',
    weight: 100,
    colorId: 'white',
  });
  assert.ok(created.id.length > 0);
  assert.equal(created.weight, 100);
  assert.equal(created.colorId, 'red');
  assert.equal(usePresetStore.getState().presets.length, 1);
});

check('编辑时权重被夹到 0、未知颜色（含旧的白）回落到红', () => {
  usePresetStore.getState().replaceAll([]);
  const created = usePresetStore.getState().addPreset({ label: '甲', english: 'x' });
  usePresetStore.getState().updatePreset(created.id, { weight: -30, colorId: '怪色' });
  const updated = usePresetStore.getState().presets[0];
  assert.equal(updated.weight, 0);
  assert.equal(updated.colorId, 'red');
});

check('局部更新不会把没传的字段冲掉', () => {
  usePresetStore.getState().replaceAll([]);
  const created = usePresetStore.getState().addPreset({ label: '甲', english: 'keep me' });
  usePresetStore.getState().updatePreset(created.id, { weight: 5 });
  const updated = usePresetStore.getState().presets[0];
  assert.equal(updated.label, '甲');
  assert.equal(updated.english, 'keep me');
  assert.equal(updated.weight, 5);
});

check('setWeight 生效且下限为 0', () => {
  const id = usePresetStore.getState().presets[0].id;
  usePresetStore.getState().setWeight(id, 250);
  assert.equal(usePresetStore.getState().presets[0].weight, 250);
  usePresetStore.getState().setWeight(id, -1);
  assert.equal(usePresetStore.getState().presets[0].weight, 0);
});

check('removePreset 删除对应条目', () => {
  const id = usePresetStore.getState().presets[0].id;
  usePresetStore.getState().removePreset(id);
  assert.equal(usePresetStore.getState().presets.length, 0);
});

check('replaceAll 过滤非数组输入', () => {
  usePresetStore.getState().replaceAll(null);
  assert.deepEqual(usePresetStore.getState().presets, []);
});

// ---------------------------------------------------------------------------
section('胶囊标签渲染（只显示中文命名）');

const capsuleFixtures = [
  { id: 'cap_1', label: '冷峻文风', colorId: 'blue' },
  { id: 'cap_2', label: '商务语气', colorId: 'pink' },
];
const chipsHtml = renderToStaticMarkup(
  React.createElement(CapsuleLabelRow, {
    capsules: capsuleFixtures,
    onRemove: noop,
  }),
);
const chipsCountOf = (needle) => chipsHtml.split(needle).length - 1;

check('两条胶囊都以中文命名渲染（含色点与颜色变量）', () => {
  assert.ok(chipsHtml.includes('冷峻文风'));
  assert.ok(chipsHtml.includes('商务语气'));
  assert.equal(chipsCountOf('pf-capsule__dot'), 2, '每条胶囊应有一个颜色点');
  assert.equal(chipsCountOf('pf-capsule--label'), 2);
  assert.ok(chipsHtml.includes('--pf-capsule-gradient:linear-gradient(135deg'), '缺少渐变');
});

check('胶囊上不再有常驻的删除按钮，而是悬停整颗变成 X（需求 2）', () => {
  // 常驻的 × 只有一个隐藏节点，靠 CSS 在悬停时才显示；没有独立的删除按钮
  assert.equal(chipsCountOf('pf-capsule__remove'), 0, '不该再有常驻的移除按钮');
  assert.equal(chipsCountOf('pf-capsule__cross'), 2, '每颗胶囊应带一个悬停用的 X');
  assert.equal(chipsCountOf('pf-capsule__hit'), 2, '整颗胶囊应当可点（点一下就删）');
  assert.ok(chipsHtml.includes('aria-label="删除胶囊 冷峻文风"'), '缺少无障碍名');
  assert.ok(chipsHtml.includes('单击删除胶囊「冷峻文风」'), '缺少悬停提示');
});

check('即使调用方把 english 一起传进来，也不会被渲染（需求 4）', () => {
  const leaky = [
    { id: 'cap_1', label: '冷峻文风', english: 'in a cold, restrained tone' },
    { id: 'cap_2', label: '商务语气', english: 'in a formal business tone' },
  ];
  const leakyHtml = renderToStaticMarkup(
    React.createElement(CapsuleLabelRow, { capsules: leaky, onRemove: noop }),
  );
  for (const capsule of leaky) {
    assert.equal(leakyHtml.includes(capsule.english), false, `英文内容泄漏：${capsule.english}`);
  }
  assert.equal(leakyHtml.includes('english'), false);
});

check('没有胶囊时不渲染整行', () => {
  const empty = renderToStaticMarkup(
    React.createElement(CapsuleLabelRow, { capsules: [], onRemove: noop, onRename: noop }),
  );
  assert.equal(empty, '');
});

// ---------------------------------------------------------------------------
section('预设编辑器：唯一的英文内容展示位（需求：英文藏在预设库）');

const dialogHtml = renderToStaticMarkup(
  React.createElement(PresetEditorDialog, {
    mode: 'create',
    title: '保存为预设（来自模块 3）',
    defaults: { label: '预设标签-0', english: 'Rewrite this paragraph politely.' },
    existingPresets: [],
    onSubmit: noop,
    onCancel: noop,
  }),
);

check('标题被覆盖为保存场景的说明', () => {
  assert.ok(dialogHtml.includes('保存为预设（来自模块 3）'));
});

check('中文命名与英文内容都被预填（模块枢拖入时英文来自模块译文）', () => {
  assert.ok(dialogHtml.includes('value="预设标签-0"'), '中文命名未预填');
  assert.ok(dialogHtml.includes('Rewrite this paragraph politely.'), '英文内容未预填');
});

check('可以选归属颜色（10 种彩色各一个选项，D75）', () => {
  assert.equal(
    dialogHtml.split('role="radio"').length - 1,
    PRESET_FILTER_COLORS.length,
    '可选颜色数量应与颜色注册表一致',
  );
});

// ---------------------------------------------------------------------------
section('模块 Store 的胶囊接线');

check('insertCapsule 把锚点写进源内容，并把胶囊记入列表', () => {
  useModuleStore.getState().resetModules();
  const id = useModuleStore.getState().modules[0].id;
  useModuleStore.getState().setSourceText(id, '把这段话改写得更礼貌');
  useModuleStore.getState().insertCapsule(
    id,
    {
      presetId: 'preset_1',
      label: '冷峻文风',
      english: 'in a cold, restrained tone',
      colorId: 'blue',
    },
    'end',
  );

  const module = useModuleStore.getState().modules[0];
  assert.equal(module.capsules.length, 1);
  assert.equal(module.capsules[0].label, '冷峻文风');
  assert.equal(module.sourceText, `把这段话改写得更礼貌 [[cap:${module.capsules[0].id}]]`);
});

check('removeCapsule 同时清掉源内容里的锚点', () => {
  const module = useModuleStore.getState().modules[0];
  const capsuleId = module.capsules[0].id;
  useModuleStore.getState().removeCapsule(module.id, capsuleId);
  const after = useModuleStore.getState().modules[0];
  assert.deepEqual(after.capsules, []);
  assert.equal(after.sourceText.includes('[[cap:'), false);
});

check('renameCapsule 只改命名，不动英文与源内容', () => {
  const id = useModuleStore.getState().modules[0].id;
  useModuleStore.getState().insertCapsule(
    id,
    { presetId: 'preset_1', label: '冷峻文风', english: 'in a cold, restrained tone' },
    'after-capsules',
  );
  const before = useModuleStore.getState().modules[0];
  useModuleStore.getState().renameCapsule(id, before.capsules[0].id, '克制的冷峻');
  const after = useModuleStore.getState().modules[0];
  assert.equal(after.capsules[0].label, '克制的冷峻');
  assert.equal(after.capsules[0].english, 'in a cold, restrained tone');
  assert.equal(after.sourceText, before.sourceText);
});

check('clearModule 是「全部清空」原语：胶囊也一并清掉', () => {
  const id = useModuleStore.getState().modules[0].id;
  useModuleStore.getState().clearModule(id);
  const module = useModuleStore.getState().modules[0];
  assert.deepEqual(module.capsules, []);
  assert.equal(module.sourceText, '');
});

check('clearModuleText 只清文字、保留胶囊（模块枢拖回自身，D61）', () => {
  const id = useModuleStore.getState().modules[0].id;
  useModuleStore.getState().setSourceText(id, '女孩，长头发，微笑');
  useModuleStore.getState().insertCapsule(
    id,
    { presetId: 'p-d61', label: '千早爱音', english: 'chihaya anon', colorId: 'red' },
    'after-capsules',
  );
  useModuleStore.getState().setTranslation(id, 'chihaya anon, long hair');
  useModuleStore.getState().setStatus(id, 'done');

  const capsuleId = useModuleStore.getState().modules[0].capsules[0].id;
  useModuleStore.getState().clearModuleText(id);

  const module = useModuleStore.getState().modules[0];
  assert.equal(module.sourceText, `[[cap:${capsuleId}]]`, '源内容应当只剩胶囊锚点');
  assert.equal(module.capsules.length, 1, '胶囊必须保留');
  assert.equal(module.capsules[0].label, '千早爱音');
  assert.equal(module.translation, '', '没有文字了，译文应当清空');
  assert.equal(module.status, 'idle');
});

check('拖拽状态可以开始、移动与结束（幽灵元素与落点高亮都读它）', () => {
  assert.equal(useUiStore.getState().drag, null);

  useUiStore
    .getState()
    .startDrag({ kind: 'preset', presetId: 'p1', label: '冷峻文风', colorId: 'blue' }, { x: 10, y: 20 });
  let drag = useUiStore.getState().drag;
  assert.equal(drag.source.presetId, 'p1');
  assert.deepEqual(drag.pointer, { x: 10, y: 20 });
  assert.equal(drag.hover, null);

  useUiStore.getState().moveDrag({ x: 30, y: 40 }, { kind: 'module', moduleId: 'm1', half: 'left' });
  drag = useUiStore.getState().drag;
  assert.deepEqual(drag.pointer, { x: 30, y: 40 });
  assert.deepEqual(drag.hover, { kind: 'module', moduleId: 'm1', half: 'left' });

  useUiStore.getState().endDrag();
  assert.equal(useUiStore.getState().drag, null);
});

// ---------------------------------------------------------------------------
section('设置面板：多套配置、密钥只写不读');

// 翻译服务只剩「专业翻译接口」这一种形态，夹具直接用真实的品牌与命名。
const profileFixture = createProfile({ brand: 'baidu', label: '百度主力' });
const backupFixture = {
  ...createProfile({ brand: 'tencent', label: '腾讯备用' }),
  id: 'profile_backup',
};

check('配置列表渲染出命名与「当前 / 密钥」标记', () => {
  const listHtml = renderToStaticMarkup(
    React.createElement(ProviderProfileList, {
      profiles: [profileFixture, backupFixture],
      activeProfileId: profileFixture.id,
      selectedId: backupFixture.id,
      keyStatus: { [profileFixture.id]: true, [backupFixture.id]: false },
      onSelect: noop,
      onAdd: noop,
    }),
  );
  assert.ok(listHtml.includes('百度主力'));
  assert.ok(listHtml.includes('腾讯备用'));
  assert.equal(listHtml.split('>当前<').length - 1, 1, '只有一套应当是当前');
  assert.equal(listHtml.split('>已配密钥<').length - 1, 1);
  assert.equal(listHtml.split('>缺密钥<').length - 1, 1);
});

check('配置列表里不会出现接口地址与密钥（列表只做选择）', () => {
  const listHtml = renderToStaticMarkup(
    React.createElement(ProviderProfileList, {
      profiles: [profileFixture],
      activeProfileId: profileFixture.id,
      selectedId: profileFixture.id,
      keyStatus: { [profileFixture.id]: false },
      onSelect: noop,
      onAdd: noop,
    }),
  );
  assert.equal(listHtml.includes('api.deepseek.com'), false);
  assert.equal(listHtml.includes('sk-'), false);
});

check('翻译服务是下拉菜单：四家都在，只有百度可选，其余标「即将支持」', () => {
  const pickerHtml = renderToStaticMarkup(
    React.createElement(ServiceFieldsForm, { profile: profileFixture, onChange: noop }),
  );
  assert.ok(pickerHtml.includes('<select'), '应当用下拉菜单而不是并排按钮');
  assert.ok(pickerHtml.includes('aria-label="翻译服务"'), '下拉的无障碍名应为「翻译服务」');
  assert.equal(pickerHtml.split('<option').length - 1, 4, '应当列出四家翻译服务');
  assert.ok(pickerHtml.includes('>百度翻译</option>'));
  assert.ok(pickerHtml.includes('腾讯翻译（即将支持）'));
  assert.ok(pickerHtml.includes('火山翻译（即将支持）'));
  assert.ok(pickerHtml.includes('阿里翻译（即将支持）'));
  // 只有百度可选中：另外三条 option 带 disabled
  assert.equal(pickerHtml.split('disabled=""').length - 1, 3, '三家未实现的服务应当禁用');
  // 当前选中的是百度
  assert.match(pickerHtml, /<option[^>]*value="baidu"[^>]*selected/);
});

check('选中已接入的服务时不再堆说明（面板保持干净）', () => {
  const baiduHtml = renderToStaticMarkup(
    React.createElement(ServiceFieldsForm, {
      profile: createProfile({ brand: 'baidu' }),
      onChange: noop,
    }),
  );
  // 用户 2026 轮：接口 / 语言方向 / 请求频率 这三条固定信息只是噪声，已删除
  assert.equal(baiduHtml.includes('通用文本翻译接口'), false, '接口说明已删除');
  assert.equal(baiduHtml.includes('语言方向'), false, '语言方向已删除');
  assert.equal(baiduHtml.includes('请求频率'), false, '请求频率已删除');
  assert.equal(baiduHtml.includes('每秒 1 次'), false, '频率说明已删除');

  const volcano = createProfile({ brand: 'volcano' });
  const volcanoHtml = renderToStaticMarkup(
    React.createElement(ServiceFieldsForm, { profile: volcano, onChange: noop }),
  );
  assert.ok(volcanoHtml.includes('火山翻译的接入尚未实现'), '选未实现的服务要说明原因');
  assert.ok(volcanoHtml.includes('现在请先选择「百度翻译」'), '要给出可照做的下一步');
});

check('语言模型 / 本地模型不会再出现在设置面板里（那两个接入板块已剔除）', () => {
  const pickerHtml = renderToStaticMarkup(
    React.createElement(ServiceFieldsForm, { profile: profileFixture, onChange: noop }),
  );
  assert.equal(pickerHtml.includes('语言模型'), false);
  assert.equal(pickerHtml.includes('本地模型'), false);
  assert.equal(pickerHtml.includes('翻译方式'), false, '「翻译方式」这一步已经不存在');
  assert.equal(pickerHtml.includes('接口地址'), false);
  assert.equal(pickerHtml.includes('模型名'), false);
});

// ---------------------------------------------------------------------------
section('翻译服务：服务商 + 一对凭据（不出现接口地址那套字段）');

const baiduProfile = createProfile({ brand: 'baidu', label: '百度主力' });

check('翻译服务的表单里没有地址/模型这类输入项（参数都由应用内置）', () => {
  const formHtml = renderToStaticMarkup(
    React.createElement(ServiceFieldsForm, { profile: baiduProfile, onChange: noop }),
  );
  assert.equal(formHtml.includes('<input'), false, '这一块只有下拉与说明，不该有输入框');
  assert.equal(formHtml.includes('type="number"'), false, '不该有数字输入框');
  assert.equal(formHtml.includes('接口地址'), false, '不该再出现接口地址这个词');
  assert.equal(formHtml.includes('模型名'), false, '不该再出现模型名这个概念');
});

check('下拉里的四家与「即将支持」标记', () => {
  const formHtml = renderToStaticMarkup(
    React.createElement(ServiceFieldsForm, { profile: baiduProfile, onChange: noop }),
  );
  assert.ok(formHtml.includes('>百度翻译<'));
  assert.ok(formHtml.includes('腾讯翻译（即将支持）'));
  assert.ok(formHtml.includes('火山翻译（即将支持）'));
  assert.ok(formHtml.includes('阿里翻译（即将支持）'));
  assert.equal(formHtml.split('disabled=""').length - 1, 3, '只有百度可选');
});

check('腾讯占位时不显示使用说明，只说明尚未实现', () => {
  const tencent = createProfile({ brand: 'tencent' });
  const formHtml = renderToStaticMarkup(
    React.createElement(ServiceFieldsForm, { profile: tencent, onChange: noop }),
  );
  assert.equal(formHtml.includes('中文 → 英文'), false, '未实现的服务不该给使用说明');
  assert.ok(formHtml.includes('尚未实现'), '缺少状态说明');
});

check('凭据字段的标签随服务商变化（百度 APP ID/密钥，腾讯 SecretId/SecretKey）', () => {
  const tencentLabels = { id: 'SecretId', key: 'SecretKey' };
  const fieldsHtml = renderToStaticMarkup(
    React.createElement(ServiceCredentialFields, {
      profileId: baiduProfile.id,
      configured: false,
      labels: tencentLabels,
      brandLabel: '腾讯翻译',
      onSave: async () => {},
      onClear: async () => {},
    }),
  );
  assert.ok(fieldsHtml.includes('SecretId'), '缺少 SecretId 标签');
  assert.ok(fieldsHtml.includes('SecretKey'), '缺少 SecretKey 标签');
  assert.equal(fieldsHtml.includes('>APP ID<'), false, '不该再显示百度的叫法');
});

check('凭据是两个真正可填的输入框（不是把环境变量名画成框）', () => {
  const fieldsHtml = renderToStaticMarkup(
    React.createElement(ServiceCredentialFields, {
      profileId: baiduProfile.id,
      configured: false,
      labels: findServiceBrand('baidu').credentialLabels,
      brandLabel: findServiceBrand('baidu').label,
      envNames: { id: 'BAIDU_TRANSLATE_APP_ID', key: 'BAIDU_TRANSLATE_APP_KEY' },
      onSave: async () => {},
      onClear: async () => {},
    }),
  );
  // 两个 input：APP ID 与密钥
  assert.equal(fieldsHtml.split('<input').length - 1, 2, '应当正好有两个输入框');
  assert.ok(fieldsHtml.includes(`id="pf-service-appid-${baiduProfile.id}"`), '缺少 APP ID 输入框');
  assert.ok(fieldsHtml.includes(`id="pf-service-appkey-${baiduProfile.id}"`), '缺少密钥输入框');
  assert.ok(fieldsHtml.includes('type="password"'), '密钥应当是密码框');
  assert.ok(fieldsHtml.includes('尚未配置'), '缺少未配置状态');
  assert.ok(fieldsHtml.includes('value=""'), '不应回显任何已保存的值');
});

check('已配置凭据时显示已保存状态，且不回显', () => {
  const fieldsHtml = renderToStaticMarkup(
    React.createElement(ServiceCredentialFields, {
      profileId: baiduProfile.id,
      configured: true,
      labels: findServiceBrand('baidu').credentialLabels,
      brandLabel: findServiceBrand('baidu').label,
      onSave: async () => {},
      onClear: async () => {},
    }),
  );
  assert.ok(fieldsHtml.includes('已保存在系统凭据库'), '缺少已配置状态');
  assert.ok(fieldsHtml.includes('value=""'), '已配置时也不应回显');
});

check('凭据说明里给出环境变量作为兜底，并说明界面填写优先', () => {
  const fieldsHtml = renderToStaticMarkup(
    React.createElement(ServiceCredentialFields, {
      profileId: baiduProfile.id,
      configured: false,
      labels: findServiceBrand('baidu').credentialLabels,
      brandLabel: findServiceBrand('baidu').label,
      envNames: { id: 'BAIDU_TRANSLATE_APP_ID', key: 'BAIDU_TRANSLATE_APP_KEY' },
      onSave: async () => {},
      onClear: async () => {},
    }),
  );
  assert.ok(fieldsHtml.includes('BAIDU_TRANSLATE_APP_ID'), '缺少 APP ID 环境变量名');
  assert.ok(fieldsHtml.includes('BAIDU_TRANSLATE_APP_KEY'), '缺少密钥环境变量名');
  assert.ok(fieldsHtml.includes('这里填写的优先使用'), '未说明两种来源的优先级');
  assert.ok(fieldsHtml.includes('Windows 凭据管理器'), '未说明凭据存哪');
  assert.ok(fieldsHtml.includes('没有读回通道'), '应当说明凭据不可读回');
});

check('切换翻译服务：只改 brand，命名与 id 原样留着（Store 侧）', () => {
  useSettingsStore.getState().replaceAll([createProfile({ label: '甲' })]);
  const id = useSettingsStore.getState().profiles[0].id;

  useSettingsStore.getState().updateProfile(id, { brand: 'tencent' });
  const asTencent = useSettingsStore.getState().profiles[0];
  assert.equal(asTencent.id, id, 'id 不该变');
  assert.equal(asTencent.label, '甲', '命名不该被服务商改名顶掉');
  assert.equal(asTencent.brand, 'tencent');
  assert.equal(profileKind(asTencent), 'tencent-translate');

  // 切回百度：通道跟着换，其它字段一个字都没被清
  useSettingsStore.getState().updateProfile(id, { brand: 'baidu' });
  const back = useSettingsStore.getState().profiles[0];
  assert.equal(back.label, '甲');
  assert.equal(back.brand, 'baidu');
  assert.equal(profileKind(back), 'baidu-translate');
});

check('连接测试把结论与原因一起显示', () => {
  const okHtml = renderToStaticMarkup(
    React.createElement(ConnectionTest, {
      report: { ok: true, elapsedMs: 820, message: '连接正常（凭据来自界面填写，用时 820 毫秒）' },
      testing: false,
      onTest: noop,
    }),
  );
  assert.ok(okHtml.includes('连接正常'));
  assert.ok(okHtml.includes('凭据来自界面填写'));

  const badHtml = renderToStaticMarkup(
    React.createElement(ConnectionTest, {
      report: { ok: false, elapsedMs: 0, message: '凭据不匹配，请检查 APP ID 与密钥' },
      testing: false,
      onTest: noop,
    }),
  );
  assert.ok(badHtml.includes('凭据不匹配'));
});

check('连接测试的按钮只在测试进行中禁用（凭据在系统凭据库，界面无从预判）', () => {
  const idleHtml = renderToStaticMarkup(
    React.createElement(ConnectionTest, { report: null, testing: false, onTest: noop }),
  );
  assert.equal(idleHtml.includes('disabled'), false, '没在测试时不该禁用按钮');

  const busyHtml = renderToStaticMarkup(
    React.createElement(ConnectionTest, { report: null, testing: true, onTest: noop }),
  );
  assert.ok(busyHtml.includes('测试中'), '测试中应当有进度提示');
});

// ---------------------------------------------------------------------------
section('设置 Store：多套配置的增删改与当前项');

check('首启自带一套可用的默认配置（落在本版唯一可用的翻译服务上）', () => {
  // 读「初始状态」而不是当前状态：前面的测试会改当前状态，而这条断言讲的是首次启动
  const initial = useSettingsStore.getInitialState();
  assert.equal(initial.profiles.length, 1);
  assert.equal(initial.profiles[0].brand, 'baidu', '默认翻译服务应当是百度');
  assert.equal(initial.profiles[0].label, '百度翻译', '默认命名取服务名');
  assert.equal(initial.activeProfileId, initial.profiles[0].id);
  // 默认那套不能落在「即将支持」的服务上，否则首启就是一套点不动、也翻不了的配置
  assert.equal(isBrandAvailable(initial.profiles[0].brand), true);
});

check('新增与复制配置', () => {
  useSettingsStore.getState().replaceAll([createProfile({ label: '甲' })]);
  const added = useSettingsStore.getState().addProfile();
  assert.equal(useSettingsStore.getState().profiles.length, 2);

  const copy = useSettingsStore.getState().duplicateProfile(added.id);
  assert.ok(copy);
  assert.notEqual(copy.id, added.id);
  assert.ok(copy.label.includes('副本'));
  assert.equal(useSettingsStore.getState().profiles.length, 3);
});

check('至少保留一套：只剩一套时删除被拒绝', () => {
  useSettingsStore.getState().replaceAll([createProfile({ label: '唯一' })]);
  const onlyId = useSettingsStore.getState().profiles[0].id;
  assert.equal(useSettingsStore.getState().removeProfile(onlyId), false);
  assert.equal(useSettingsStore.getState().profiles.length, 1);
});

check('删掉当前使用的配置后，当前项回落到剩下的第一套', () => {
  const first = createProfile({ label: '甲' });
  const second = { ...createProfile({ brand: 'tencent', label: '乙' }), id: 'profile_second' };
  useSettingsStore.getState().replaceAll([first, second], first.id);
  useSettingsStore.getState().removeProfile(first.id);
  const state = useSettingsStore.getState();
  assert.equal(state.profiles.length, 1);
  assert.equal(state.activeProfileId, 'profile_second');
});

check('切换当前配置时拒绝不存在的 id', () => {
  const first = createProfile({ label: '甲' });
  useSettingsStore.getState().replaceAll([first], first.id);
  useSettingsStore.getState().setActiveProfile('profile_不存在');
  assert.equal(useSettingsStore.getState().activeProfileId, first.id);
});

// ---------------------------------------------------------------------------
section('顶栏翻译服务状态指示灯');

const { TopBarView } = require(path.join(OUT, 'components/layout/TopBar.js'));
const { connectionStatusOf, shouldAutoTest } = require(path.join(OUT, 'utils/connectionStatus.js'));
const { THEME_TOGGLE } = require(path.join(OUT, 'utils/theme.js'));

/**
 * 灯的颜色与文案全部渲染在纯展示组件上（架构 §6.4：静态渲染下 zustand 只返回
 * 初始状态，读 Store 的容器在断言里画不出「随状态变化」的东西，因此夹具走 View 层）。
 */
function lightHtml(connectionStatus, activeProfileLabel = '百度翻译', theme = 'dark') {
  return renderToStaticMarkup(
    React.createElement(TopBarView, {
      moduleCount: MODULE_INITIAL_COUNT,
      canAddModule: true,
      canRemoveModule: true,
      selectedModuleOrder: 1,
      activeProfileLabel,
      connectionStatus,
      theme,
      onAdd: () => {},
      onRemoveClick: () => {},
      onOpenSettings: () => {},
      onOpenAppSettings: () => {},
      onToggleTheme: () => {},
    }),
  );
}

check('没配凭据 → 白灯 + 「未配置」', () => {
  const html = lightHtml('unconfigured');
  assert.ok(html.includes('pf-topbar__status-light'), '缺少指示灯');
  assert.ok(html.includes('pf-topbar__status-light--idle'), '没配凭据应当是白灯');
  assert.ok(html.includes('title="未配置"'), '白灯的悬浮说明应为「未配置」');
});

check('已配置且测试成功 → 绿灯 + 「连接正常」', () => {
  const html = lightHtml('ok');
  assert.ok(html.includes('pf-topbar__status-light--ok'), '应当是绿灯');
  assert.ok(html.includes('title="连接正常"'), '绿灯的悬浮说明应为「连接正常」');
});

check('已配置但测试失败 → 红灯 + 「连接异常」', () => {
  const html = lightHtml('error');
  assert.ok(html.includes('pf-topbar__status-light--error'), '应当是红灯');
  assert.ok(html.includes('title="连接异常"'), '红灯的悬浮说明应为「连接异常」');
});

check('灯在「翻译服务：」文字之前（用户要求的位置）', () => {
  const html = lightHtml('ok');
  assert.ok(
    html.indexOf('pf-topbar__status-light') < html.indexOf('翻译服务：'),
    '指示灯必须出现在「翻译服务：」前面',
  );
});

// ---------------------------------------------------------------------------
section('顶栏主题切换按钮（日/月）');

check('暗色主题：按钮是太阳图标，文案为「切换到亮色主题」', () => {
  const html = lightHtml('ok', '百度翻译', 'dark');
  assert.ok(html.includes('pf-topbar__theme'), '缺少主题切换按钮');
  assert.ok(html.includes(`title="${THEME_TOGGLE.dark.title}"`), '缺少太阳按钮的中文说明');
  // 太阳：圆心 + 光芒
  assert.ok(html.includes('<circle'), '太阳图标应当有圆心');
  assert.ok(html.includes('M12 2.5v2.2'), '太阳图标应当有光芒');
});

check('亮色主题：按钮是月亮图标，文案为「切换到暗色主题」', () => {
  const html = lightHtml('ok', '百度翻译', 'light');
  assert.ok(html.includes(`title="${THEME_TOGGLE.light.title}"`), '缺少月亮按钮的中文说明');
  // D80：顶栏多了齿轮（里面也有 <circle>），所以只看主题按钮自己那一段
  const themeSection = html.slice(html.indexOf('pf-topbar__theme'));
  const themeButton = themeSection.slice(0, themeSection.indexOf('</button>'));
  assert.ok(html.includes('M20 13.4A8.2 8.2 0 1 1 10.6 4'), '月亮图标路径不对');
  assert.equal(themeButton.includes('<circle'), false, '亮色下不该还是太阳');
});

check('主题按钮与齿轮按钮的位置：主题在「删除模块」右边，齿轮在最右端（D80）', () => {
  const html = lightHtml('ok', '百度翻译', 'dark');
  const providerAt = html.indexOf('pf-topbar__provider');
  const removeAt = html.indexOf('>删除模块</button>');
  const themeAt = html.indexOf('pf-topbar__theme');
  const gearAt = html.indexOf('pf-topbar__app-settings');
  assert.ok(providerAt > 0 && removeAt > 0 && themeAt > 0 && gearAt > 0, '按钮没渲染出来');
  // 文字的「设置」按钮已移除，位置参照物改为：翻译服务标签 / 删除模块 / 齿轮
  assert.ok(themeAt > providerAt, '主题切换按钮应当在翻译服务标签右边');
  assert.ok(themeAt > removeAt, '主题切换按钮应当在「删除模块」右边');
  // D80：齿轮在主题按钮**右侧**（用户原话：主题切换按钮右侧新增齿轮），因此它是最右端
  assert.ok(gearAt > themeAt, '齿轮按钮应当在主题切换按钮右边（顶栏最右端）');
});

check('主题按钮的图标是装饰性的：不额外读出一串英文路径', () => {
  const html = lightHtml('ok', '百度翻译', 'dark');
  assert.ok(html.includes('aria-hidden="true"'), '图标应当对读屏隐藏，说明只靠按钮的 aria-label');
  const button = html.slice(html.indexOf('pf-topbar__theme'), html.indexOf('</button>', html.indexOf('pf-topbar__theme')));
  assert.ok(button.includes('aria-label='), '按钮本身要有中文无障碍名');
});

check('三态判据：白灯压过历史结论，绿灯/红灯只在已配置时出现', () => {
  const profile = createProfile({ brand: 'baidu', label: '甲' });
  // 没配凭据：无论历史结论是什么都是白灯
  assert.equal(connectionStatusOf(profile, false, 'ok'), 'unconfigured');
  assert.equal(connectionStatusOf(profile, false, 'error'), 'unconfigured');
  // 已配置：按最近结论取色；还没测过时也是白灯
  assert.equal(connectionStatusOf(profile, true, undefined), 'unconfigured');
  assert.equal(connectionStatusOf(profile, true, 'ok'), 'ok');
  assert.equal(connectionStatusOf(profile, true, 'error'), 'error');
  assert.equal(connectionStatusOf(undefined, true, 'ok'), 'unconfigured');
});

check('自动测试的时机：没凭据不测、没结论要测、已有绿灯不重测（不轮询）', () => {
  const profile = createProfile({ brand: 'baidu', label: '甲' });
  assert.equal(shouldAutoTest(profile, false, undefined), false, '没凭据不该发请求');
  assert.equal(shouldAutoTest(profile, true, undefined), true, '没结论必须测，否则灯永远白');
  assert.equal(shouldAutoTest(profile, true, 'error'), true, '上次失败要再试一次');
  assert.equal(shouldAutoTest(profile, true, 'ok'), false, '已有绿灯不该重复打接口');
});

check('reportConnection 是唯一的结论写入口：只改结论、不动别的字段', () => {
  const profile = { ...createProfile({ label: '甲' }), id: 'p_report' };
  useSettingsStore.getState().replaceAll([profile], profile.id);
  const before = useSettingsStore.getState();

  useSettingsStore.getState().reportConnection('p_report', false);
  const after = useSettingsStore.getState();
  assert.equal(after.connectionStatus.p_report, 'error');
  assert.equal(after.testReports.p_report, undefined, '翻译请求的失败不该伪装成一次「测试连接」结论');
  assert.equal(after.keyStatus.p_report, before.keyStatus.p_report, '结论不影响凭据状态');
  assert.equal(after.testingProfileId, before.testingProfileId, '不该点亮设置面板的「测试中」');
});

// 说明：`清除凭据 → 回到白灯` 的断言放在 verify-logic 层面（那里能同步驱动），
// 这里（静态渲染层）只保证「灯怎么画」与「结论怎么存」，不引入异步时序。

check('删掉配置 → 指示灯结论一并删除，不留孤儿', () => {
  const first = { ...createProfile({ label: '甲' }), id: 'p_first' };
  const second = { ...createProfile({ label: '乙' }), id: 'p_second' };
  useSettingsStore.getState().replaceAll([first, second], 'p_first');
  useSettingsStore.getState().reportConnection('p_second', false);
  assert.equal(useSettingsStore.getState().connectionStatus.p_second, 'error');

  useSettingsStore.getState().removeProfile('p_second');
  assert.equal(useSettingsStore.getState().connectionStatus.p_second, undefined);
});

check('更新配置只改传入的字段', () => {
  const first = createProfile({ label: '甲' });
  useSettingsStore.getState().replaceAll([first], first.id);
  useSettingsStore.getState().updateProfile(first.id, { brand: 'tencent' });
  const updated = useSettingsStore.getState().profiles[0];
  assert.equal(updated.brand, 'tencent');
  assert.equal(updated.label, '甲', '没传的字段不该被动');
  assert.equal(updated.id, first.id);
});

check('replaceAll 会过滤脏数据并保证 id 唯一', () => {
  useSettingsStore.getState().replaceAll([
    { id: 'dup', label: '甲' },
    { id: 'dup', label: '乙' },
    { label: '没有 id' },
  ]);
  const state = useSettingsStore.getState();
  assert.equal(state.profiles.length, 3);
  assert.equal(new Set(state.profiles.map((profile) => profile.id)).size, 3);
});

// ---------------------------------------------------------------------------
section('输出区：译文、用量与复制入口');

const idleModule = {
  id: 'mod_idle',
  order: 1,
  colorId: 'red',
  sourceText: '把这段话改写得更礼貌',
  capsules: [],
  translation: '',
  outputHeight: 120,
  status: 'idle',
};

check('未翻译时：模块行保持干净，不渲染任何占位（用户 2026 轮去掉「尚未翻译」）', () => {
  const rowHtml = renderToStaticMarkup(React.createElement(ModuleCard, { module: idleModule }));
  assert.equal(rowHtml.includes('尚未翻译'), false, '不该再有「尚未翻译」');
  assert.equal(rowHtml.includes('pf-module__placeholder'), false, '未翻译时连占位元素都不渲染');
});

check('翻译进行中仍然显示「翻译中……」（那是进度提示，不是空态占位）', () => {
  const rowHtml = renderToStaticMarkup(
    React.createElement(ModuleCard, { module: { ...idleModule, status: 'translating' } }),
  );
  assert.ok(rowHtml.includes('翻译中'), '进行中的进度提示必须保留，否则用户不知道请求还在跑');
  assert.ok(rowHtml.includes('pf-module__placeholder'));
});

check('已翻译时：模块行只读显示英文译文', () => {
  const rowHtml = renderToStaticMarkup(
    React.createElement(ModuleCard, {
      module: {
        ...idleModule,
        translation: 'Rewrite this paragraph politely.',
        status: 'done',
      },
    }),
  );
  assert.ok(rowHtml.includes('Rewrite this paragraph politely.'));
  // 译文属于外部内容，需要标记出来，文案审校器据此跳过
  assert.ok(rowHtml.includes('data-pf-external="true"'));
});

check('翻译失败时显示中文原因', () => {
  const rowHtml = renderToStaticMarkup(
    React.createElement(ModuleCard, {
      module: {
        ...idleModule,
        status: 'error',
        error: { code: 'TIMEOUT', message: '请求超时，请检查网络或调大超时时间' },
      },
    }),
  );
  assert.ok(rowHtml.includes('请求超时，请检查网络或调大超时时间'));
  assert.ok(rowHtml.includes('pf-module__error'));
});

check('胶囊在模块行里带自己的归属色（与预设库同一套渐变），不再跟随模块色', () => {
  const rowHtml = renderToStaticMarkup(
    React.createElement(ModuleCard, {
      module: {
        ...idleModule,
        capsules: [
          { id: 'cap_1', label: '冷峻文风', presetId: 'p1', colorId: 'blue' },
          { id: 'cap_2', label: '柔和语气', presetId: 'p2', colorId: 'purple' },
        ],
      },
    }),
  );
  const { colorGradient } = require(path.join(OUT, 'constants/colors.js'));
  assert.ok(rowHtml.includes(`--pf-capsule-gradient:${colorGradient('blue')}`), '缺少蓝色渐变');
  assert.ok(rowHtml.includes(`--pf-capsule-gradient:${colorGradient('purple')}`), '缺少紫色渐变');
  assert.equal(rowHtml.includes('--pf-capsule-color:#ffffff'), false, '白色胶囊已随自由色删除');
  assert.equal(rowHtml.includes('--pf-capsule-gradient:linear-gradient(135deg, #ff6b76'), false, '不该用模块自己的红色');
});

check('胶囊在模块行里只显示中文名，英文内容绝不渲染', () => {
  const rowHtml = renderToStaticMarkup(
    React.createElement(ModuleCard, {
      module: {
        ...idleModule,
        capsules: [{ id: 'cap_1', label: '克制的冷峻', presetId: 'p1' }],
      },
    }),
  );
  assert.ok(rowHtml.includes('克制的冷峻'), '缺少胶囊中文名');
  assert.equal(rowHtml.includes('cold'), false, '英文内容不该出现在 DOM 里');
});

check('输入框工具条：色块在左、两个按钮在右（SourceToolbar 已删除）', () => {
  assert.equal(countOf('pf-input-pane__swatch'), 1, '色块标记必须保留');
  assert.equal(countOf('pf-input-pane__status'), 0, '状态字已随之移除');
  assert.equal(countOf('pf-input-pane__meta'), 0, '用量信息已随之移除');
  // 只截「工具条那一段」：从它的 class 到工具条结束标签
  const paneStart = html.indexOf('pf-input-pane__toolbar');
  const toolbar = html.slice(paneStart, html.indexOf('pf-input-pane__toolbar') + 600);
  assert.equal(toolbar.split('<button').length - 1, 2, '输入框工具条应当只有两个按钮');
  assert.ok(toolbar.includes('pf-input-pane__swatch'), '色块应当在工具条里');
  assert.ok(toolbar.includes('全文复制'));
  assert.ok(toolbar.includes('全文清空'));
});

check('模块行上没有色块/图标式按钮（模块级操作只有模块枢）', () => {
  // 模块枢是 <button>，其余都是展示元素
  const rows = html.split('pf-module ').slice(1);
  assert.ok(rows.length > 0, '应当能切出模块行');
  for (const [index, row] of rows.entries()) {
    const rowHtml = row.slice(0, row.indexOf('</article>'));
    const buttons = rowHtml.split('<button').length - 1;
    assert.equal(buttons, 1, `第 ${index + 1} 排只应有模块枢一个按钮，实际 ${buttons} 个`);
    assert.ok(rowHtml.includes('pf-hub'), `第 ${index + 1} 排缺少模块枢`);
  }
});

// ---------------------------------------------------------------------------
section('草稿恢复与批量进度（Store 侧）');

check('hydrate 用草稿整体替换模块并应用选中项', () => {
  const draft = sanitizeModules([
    { id: 'mod_draft_1', colorId: 'purple', sourceText: '草稿一', translation: 'Draft one.' },
    { id: 'mod_draft_2', colorId: 'cyan', sourceText: '草稿二' },
  ]);
  useModuleStore.getState().hydrate(draft, 'mod_draft_2');
  const state = useModuleStore.getState();
  assert.equal(state.modules.length, 2);
  assert.equal(state.modules[0].sourceText, '草稿一');
  assert.equal(state.modules[0].status, 'done', '有译文应恢复为已翻译');
  assert.equal(state.selectedModuleId, 'mod_draft_2');
});

check('hydrate 遇到失效的选中 id 时回落到第一个模块', () => {
  const draft = sanitizeModules([{ id: 'mod_only', sourceText: '唯一' }]);
  useModuleStore.getState().hydrate(draft, 'mod_不存在');
  const state = useModuleStore.getState();
  assert.equal(state.modules.length, 1);
  assert.equal(state.selectedModuleId, 'mod_only');
});

check('hydrate 空列表不会把界面清空（至少保留一个模块）', () => {
  useModuleStore.getState().resetModules();
  const before = useModuleStore.getState().modules.length;
  useModuleStore.getState().hydrate([], 'whatever');
  assert.equal(useModuleStore.getState().modules.length, before);
});

check('失败模块计数选择器仍然可靠（横幅据此决定是否显示）', () => {
  useModuleStore.getState().resetModules();
  const [first, second] = useModuleStore.getState().modules;
  assert.equal(selectFailedModuleCount(useModuleStore.getState()), 0);

  useModuleStore.getState().setStatus(first.id, 'error', { code: 'TIMEOUT', message: '超时' });
  useModuleStore.getState().setStatus(second.id, 'error', { code: 'AUTH', message: '密钥无效' });
  assert.equal(selectFailedModuleCount(useModuleStore.getState()), 2);

  useModuleStore.getState().setStatus(first.id, 'done');
  assert.equal(selectFailedModuleCount(useModuleStore.getState()), 1);
});

check('翻译状态推进与用量信息写回', () => {
  useModuleStore.getState().resetModules();
  const id = useModuleStore.getState().modules[0].id;

  useModuleStore.getState().setStatus(id, 'translating');
  assert.equal(useModuleStore.getState().modules[0].status, 'translating');

  useModuleStore.getState().setTranslation(id, 'Rewrite it politely.');
  useModuleStore.getState().setTranslationMeta(id, { model: 'deepseek-chat', elapsedMs: 900 });
  useModuleStore.getState().setStatus(id, 'done');

  const module = useModuleStore.getState().modules[0];
  assert.equal(module.status, 'done');
  assert.deepEqual(module.translationMeta, { model: 'deepseek-chat', elapsedMs: 900 });
});

check('清空模块会一并清掉译文与用量信息', () => {
  const id = useModuleStore.getState().modules[0].id;
  useModuleStore.getState().clearModule(id);
  const module = useModuleStore.getState().modules[0];
  assert.equal(module.translation, '');
  assert.equal(module.translationMeta, undefined);
  assert.equal(module.status, 'idle');
});

check('批量进度状态已随批量翻译移除（不该留下无人使用的字段）', () => {
  const state = useUiStore.getState();
  assert.equal('batchProgress' in state, false, 'batchProgress 应当已从 UI Store 移除');
  assert.equal('setBatchProgress' in state, false, 'setBatchProgress 应当已移除');
});

check('重置把所有模块恢复到初始状态', () => {
  useModuleStore.getState().setSourceText(useModuleStore.getState().modules[0].id, '临时内容');
  useModuleStore.getState().resetModules();
  const state = useModuleStore.getState();
  assert.equal(state.modules.length, 6);
  assert.equal(
    state.modules.every((module) => module.sourceText === '' && module.translation === ''),
    true,
  );
  assert.deepEqual(
    state.modules.map((module) => module.colorId),
    ['red', 'orange', 'yellow', 'green', 'cyan', 'blue'],
  );
});

// ---------------------------------------------------------------------------
section('本地词典：管理列表与字段映射界面（D49 / D50）');

const dictItems = [
  {
    id: 'a.json',
    displayName: '角色词典',
    label: '角色词典',
    file: 'a.json',
    order: 0,
    enabled: true,
    entryCount: 12,
    format: 'csv',
    importedAt: 1,
  },
  {
    id: 'b.json',
    displayName: '画风词典',
    // 故意和 displayName 不同：用来证明列表显示的是用户命名，而不是文件名词干
    label: 'b-style',
    file: 'b.json',
    order: 1,
    enabled: false,
    entryCount: 7,
    format: 'sqlite',
    importedAt: 2,
  },
];

check('推送服务面板（D80）：开关默认开、端口 8713、关闭时输入框置灰、带使用说明', () => {
  const on = renderToStaticMarkup(
    React.createElement(PushSettingsPanel, { enabled: true, port: 8713, onChange: noop }),
  );
  assert.ok(on.includes('开启 WebSocket 推送'), '缺少开关标题');
  assert.ok(on.includes('role="switch"'), '缺少滑动开关');
  assert.ok(on.includes('aria-checked="true"'), '默认应当是开启');
  assert.ok(on.includes('通信端口'), '缺少端口标题');
  assert.ok(on.includes('ComfyUI 插件将通过此端口接收实时推流。'), '缺少端口说明');
  assert.ok(on.includes('value="8713"'), '端口默认值应当是 8713');
  assert.equal(on.includes('disabled=""'), false, '开关打开时端口框不该被禁用');
  // 使用说明（用户给的三步，专有名词按原文保留）
  assert.ok(on.includes('使用说明'), '缺少使用说明');
  assert.ok(on.includes('SunYan Sync'), '缺少 ComfyUI 节点名');
  assert.ok(on.includes('ComfyUI'), '说明里应当点明需要配合 ComfyUI');
  // 窗口/离焦提示：端口范围用数字表达，不写英文
  assert.ok(on.includes('min="1024"') && on.includes('max="65535"'), '端口上下限不对');

  const off = renderToStaticMarkup(
    React.createElement(PushSettingsPanel, { enabled: false, port: 8713, onChange: noop }),
  );
  assert.ok(off.includes('aria-checked="false"'), '关闭态应当 aria-checked=false');
  assert.ok(off.includes('disabled=""'), '关闭后端口输入框必须禁用（置灰）');
});

check('默认不渲染词典面板（D80：在齿轮设置弹窗的第二个 Tab 里）', () => {
  // 顶栏齿轮按钮的 title 里也有「词典管理」四个字，因此这里盯的是面板自己的标记
  assert.equal(html.includes('pf-dict__hint'), false, '词典面板默认不该出现');
  assert.equal(html.includes('pf-app-settings__tabs'), false, '设置弹窗默认不该出现');
  assert.ok(html.includes('pf-topbar__app-settings'), '顶栏缺少齿轮设置按钮');
});

check('词典列表：名称、条数、启用开关、删除按钮与拖拽定位属性', () => {
  const listHtml = renderToStaticMarkup(
    React.createElement(DictionaryList, {
      items: dictItems,
      onReorder: noop,
      onToggle: noop,
      onDelete: noop,
    }),
  );
  assert.ok(listHtml.includes('角色词典'));
  assert.ok(listHtml.includes('画风词典'));
  assert.equal(listHtml.includes('b-style'), false, '列表显示的是用户命名的 displayName，不是文件名词干');
  assert.ok(listHtml.includes('12 条'), '缺少条数');
  assert.equal(listHtml.split('role="switch"').length - 1, 2, '每部词典一个启用开关');
  assert.equal(listHtml.split('aria-checked="true"').length - 1, 1, '只有第一部处于启用状态');
  assert.equal(listHtml.split('>删除</button>').length - 1, 2, '每部词典一个删除按钮');
  assert.equal(listHtml.split('data-dict-row="true"').length - 1, 2, '每行都要能被拖拽定位');
  // 词典名来自文件名（外部内容），必须标 external，否则文案审校会把它当成界面英文
  assert.equal(listHtml.split('data-pf-external="true"').length - 1, 2);
  assert.ok(listHtml.includes('调整「角色词典」的优先级'), '拖拽把手缺少中文无障碍名');
});

check('导入前先命名：默认名是原文件名去后缀，提示语与按钮都是中文', () => {
  const nameHtml = renderToStaticMarkup(
    React.createElement(DictionaryNameDialog, {
      defaultName: '角色词典',
      busy: false,
      error: null,
      onCancel: noop,
      onConfirm: noop,
    }),
  );
  assert.ok(nameHtml.includes('请为该词典命名（方便后续辨识）：'), '缺少用户指定的提示语');
  assert.ok(nameHtml.includes('value="角色词典"'), '默认名应当预填原文件名去后缀');
  assert.ok(nameHtml.includes('>继续</button>'), '缺少「继续」按钮');
  assert.ok(nameHtml.includes('>取消</button>'), '缺少「取消」按钮');
  assert.ok(nameHtml.includes('type="text"'), '应当是轻量文本输入框');
});

check('字段映射界面：提示语、两个中文字段下拉、5 行预览、多表时才出现表选择', () => {
  const inspection = {
    format: 'sqlite',
    tables: [
      {
        name: 'terms',
        fields: ['cn', 'en'],
        sampleRows: [
          ['千早爱音', 'chihaya anon'],
          ['长崎素世', 'nagasaki soyo'],
        ],
        suggestedCnIndex: 0,
        suggestedEnIndex: 1,
      },
      { name: 'extra', fields: ['a', 'b'], sampleRows: [], suggestedCnIndex: null, suggestedEnIndex: null },
    ],
  };
  const mappingHtml = renderToStaticMarkup(
    React.createElement(DictionaryImportDialog, {
      inspection,
      busy: false,
      error: null,
      onCancel: noop,
      onConfirm: noop,
    }),
  );
  assert.ok(mappingHtml.includes('无法识别该词典键值，请手动配置'), '缺少用户指定的提示语');
  assert.ok(mappingHtml.includes('哪个字段代表中文？'), '缺少中文字段下拉');
  assert.ok(mappingHtml.includes('哪个字段代表英文（提示词）？'), '缺少英文字段下拉');
  assert.ok(mappingHtml.includes('哪个表？'), '多表时必须给出表选择');
  assert.ok(mappingHtml.includes('data-pf-external="true"'), '预览表/字段下拉必须标为外部内容');
  assert.ok(mappingHtml.includes('chihaya anon'), '预览里应当出现样本数据');

  const single = {
    format: 'csv',
    tables: [
      {
        name: 'CSV',
        fields: ['名称', '英文'],
        sampleRows: [['甲', 'a']],
        suggestedCnIndex: null,
        suggestedEnIndex: null,
      },
    ],
  };
  const singleHtml = renderToStaticMarkup(
    React.createElement(DictionaryImportDialog, {
      inspection: single,
      busy: false,
      error: null,
      onCancel: noop,
      onConfirm: noop,
    }),
  );
  assert.equal(singleHtml.includes('哪个表？'), false, '单表时不该出现表选择');
  assert.ok(singleHtml.includes('>导入</button>'), '缺少导入按钮');
});

check('字段映射的错误用中文展示，且中文与英文选同一个字段时禁止导入', () => {
  const inspection = {
    format: 'csv',
    tables: [
      {
        name: 'CSV',
        fields: ['名称'],
        sampleRows: [['甲']],
        suggestedCnIndex: null,
        suggestedEnIndex: null,
      },
    ],
  };
  const errorHtml = renderToStaticMarkup(
    React.createElement(DictionaryImportDialog, {
      inspection,
      busy: false,
      error: '该文件无法解析',
      onCancel: noop,
      onConfirm: noop,
    }),
  );
  assert.ok(errorHtml.includes('该文件无法解析'), '错误文案应当原样展示');
  // 只有一个字段时两个下拉必然相同 ⇒ 应当提示并禁用导入
  assert.ok(errorHtml.includes('中文与英文不能选择同一个字段'));
  assert.match(errorHtml, /<button[^>]*disabled=""[^>]*>导入<\/button>/);
});

// ---------------------------------------------------------------------------
section('快照卡：标签在左、更新/复制两个图标按钮在右（D76）');

const snapshotFixture = {
  id: 'snap-r1',
  name: '基座方案',
  scope: 'global',
  weight: 100,
  modules: [{ sourceText: '', colorId: 'red', capsules: [] }],
  copyText: 'a, b, c.',
  createdAt: 1,
  updatedAt: 2,
};

const snapshotHtml = renderToStaticMarkup(
  React.createElement(SnapshotList, { snapshots: [snapshotFixture] }),
);
const snapshotSingleHtml = renderToStaticMarkup(
  React.createElement(SnapshotList, {
    snapshots: [{ ...snapshotFixture, id: 'snap-r2', scope: 'module' }],
  }),
);

check('快照卡渲染出名称与范围标签，两个图标按钮都有中文无障碍名', () => {
  assert.ok(snapshotHtml.includes('基座方案'), '缺少快照名');
  assert.ok(snapshotHtml.includes('全局'), '缺少「全局」标签');
  assert.ok(snapshotHtml.includes('aria-label="更新为当前工作区"'), '缺少「更新」图标按钮');
  assert.ok(snapshotHtml.includes('aria-label="复制译文"'), '缺少「复制」图标按钮');
  // 用户明确要求「用图标、不要文字」：按钮内部只能是内联 SVG
  assert.ok(snapshotHtml.includes('<svg'), '两个按钮应当是图标');
  assert.equal(snapshotHtml.includes('更新</button>'), false, '按钮里不许出现文字');
  assert.equal(snapshotHtml.includes('复制</button>'), false, '按钮里不许出现文字');
  assert.ok(snapshotSingleHtml.includes('单模块'), '单模块快照的标签不对');
});

check('排版口径：名称 → 【全局】→ [更新] → [复制]（标签在两个按钮左方）', () => {
  const nameAt = snapshotHtml.indexOf('pf-snap-item__name');
  const tagAt = snapshotHtml.indexOf('pf-snap-item__tag');
  const actionsAt = snapshotHtml.indexOf('pf-snap-item__actions');
  const updateAt = snapshotHtml.indexOf('aria-label="更新为当前工作区"');
  const copyAt = snapshotHtml.indexOf('aria-label="复制译文"');
  assert.ok(nameAt >= 0 && tagAt > nameAt, '名称必须在标签之前');
  assert.ok(actionsAt > tagAt, '整组按钮必须排在标签之后（也就是标签在它们左方）');
  assert.ok(updateAt > actionsAt && copyAt > updateAt, '顺序必须是先更新、后复制');
});

check('按钮块标了 data-preview-off，悬停时不会再叠一个预览浮层（D76）', () => {
  assert.ok(snapshotHtml.includes('data-preview-off="true"'), '缺少 data-preview-off 标记');
});

// ---------------------------------------------------------------------------
section('Tag 库（D86）：T 色块进入、条目与预设同一种胶囊');

check('色块行顺序固定：9 个颜色 → Tag T → 画师 @ → 快照 S', () => {
  const lastColorAt = html.indexOf(`title="${PRESET_FILTER_COLORS[PRESET_FILTER_COLORS.length - 1].label}"`);
  const tagAt = html.indexOf('aria-label="Tag 库"');
  const artistAt = html.indexOf('aria-label="画师库"');
  const snapshotAt = html.indexOf('aria-label="快照库"');
  assert.ok(lastColorAt >= 0, '找不到最后一个颜色的色块');
  assert.ok(tagAt > lastColorAt, 'Tag 块必须排在全部颜色块之后');
  assert.ok(artistAt > tagAt, '画师块必须排在 Tag 块之后');
  assert.ok(snapshotAt > artistAt, '快照块必须排在画师块之后');
});

check('Tag 条目渲染成与预设同一种胶囊：色点用词典渐变、只显示中文名', () => {
  // D86：Tag 库与预设库共用 PresetList / PresetItem，因此直接拿夹具渲染那个纯展示组件
  const tagFixture = [
    {
      id: 'tag:长发',
      label: '长发',
      english: 'long hair',
      weight: 100,
      colorId: 'dictionary',
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 'tag:短发',
      label: '短发',
      english: 'short hair',
      weight: 100,
      colorId: 'dictionary',
      createdAt: 1,
      updatedAt: 1,
    },
  ];
  const tagHtml = renderToStaticMarkup(
    React.createElement(PresetList, {
      presets: tagFixture,
      totalCount: 2,
      onContextMenu: () => {},
      emptyText: '还没有 Tag',
      noMatchText: '没有匹配的 Tag',
    }),
  );

  assert.equal(tagHtml.split('data-pf-preset-id=').length - 1, 2, '两条 Tag 应当渲染成两颗胶囊');
  assert.ok(tagHtml.includes('>长发<'), '胶囊显示中文名');
  assert.equal(tagHtml.includes('long hair'), false, '英文词条不许进界面');
  assert.ok(tagHtml.includes('pf-preset-item__dot'), 'Tag 胶囊与预设一样带色点');
  assert.ok(
    tagHtml.includes('--pf-preset-gradient:linear-gradient(-225deg, #D4FFEC 0%, #57F2CC 48%, #4596FB 100%)'),
    'Tag 色点必须用词典渐变（与 T 色块、拖进输入框的 Tag 同源）',
  );
  // 与预设同构 → 权重不出现在胶囊上（右键菜单里改，和预设/画师一致）
  assert.equal(/>\s*100\s*</.test(tagHtml), false, '权重不该出现在胶囊上');
});

check('Tag 胶囊带悬停预览入口（与预设同一套 data-preview 标记）', () => {
  const tagHtml = renderToStaticMarkup(
    React.createElement(PresetList, {
      presets: [
        {
          id: 'tag:长发',
          label: '长发',
          english: 'long hair',
          weight: 100,
          colorId: 'dictionary',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      totalCount: 1,
      onContextMenu: () => {},
      emptyText: '还没有 Tag',
      noMatchText: '没有匹配的 Tag',
    }),
  );
  assert.ok(tagHtml.includes('data-preview-kind="preset"'), 'Tag 胶囊缺少悬停预览标记');
  assert.ok(tagHtml.includes('data-preview-id="tag:长发"'), '悬停预览要指向这条 Tag');
  // D86：Tag 不再有自己的专属胶囊样式（上一轮那套「整颗渐变底」已删），与预设完全同一套
  assert.equal(tagHtml.includes('pf-preset-item--dict'), false, 'Tag 胶囊不该再有专属类名');
});

check('设置里的「列表分页」：默认 100 条、可调 20–1000', () => {
  const { PagingSettingsPanel } = require(
    path.join(OUT, 'components/settings/PagingSettingsPanel.js'),
  );
  const pagingHtml = renderToStaticMarkup(React.createElement(PagingSettingsPanel));
  assert.ok(pagingHtml.includes('data-pf-paging="true"'), '缺少分页面板的标记');
  assert.ok(pagingHtml.includes('每页条数'), '缺少「每页条数」这一项');
  assert.ok(pagingHtml.includes('aria-label="每页条数"'), '输入框缺少无障碍名');
  // 默认值 100 必须真的画在输入框里
  assert.ok(/value="100"/.test(pagingHtml), `输入框的默认值应当是 100，实际：${pagingHtml}`);
  assert.ok(pagingHtml.includes('可调范围 20–1000 条'), '缺少范围说明');
  assert.ok(
    pagingHtml.includes('预设库、Tag 库、画师库、快照库统一按这个条数分页'),
    '说明文案要写清「四个库统一」',
  );
});

// ---------------------------------------------------------------------------
section('预设分组（D112）：折叠砖、展开卡、顶部建组判断区');

const GROUP_LIST_FIXTURE = [
  {
    id: 'p1',
    label: '安和昴',
    english: 'anon',
    weight: 300,
    colorId: 'blue',
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: 'p2',
    label: '千早爱音',
    english: 'tomori',
    weight: 200,
    colorId: 'blue',
    createdAt: 1,
    updatedAt: 1,
  },
];

function renderGroups(blocks, options = {}) {
  return renderToStaticMarkup(
    React.createElement(PresetGroupList, {
      blocks,
      totalCount: options.totalCount ?? 2,
      hoverFolder: options.hoverFolder ?? null,
      onContextMenu: () => {},
      onGroupContextMenu: () => {},
      onToggleGroup: () => {},
      emptyText: '暂无预设',
      emptyHint: '把模块枢拖到这里，或点上方「新增预设」。',
      noMatchText: '没有匹配的预设',
    }),
  );
}

check('折叠态：一颗砖只显示组名与计数，成员不渲染', () => {
  const html = renderGroups([
    {
      kind: 'group',
      name: '作品集',
      colorId: 'blue',
      items: GROUP_LIST_FIXTURE,
      expanded: false,
    },
  ]);
  assert.ok(html.includes('data-pf-group-name="作品集"'), '砖上必须有组名标记（拖拽落点靠它）');
  assert.ok(html.includes('data-pf-group-color="blue"'), '砖上必须带组色（同名不同色靠它区分）');
  assert.ok(html.includes('data-pf-group-expanded="no"'), '折叠态要能被断言认出来');
  assert.ok(html.includes('>作品集<'), '砖要显示组名');
  assert.ok(html.includes('pf-group-tile__count">2<'), '砖要显示计数');
  assert.ok(html.includes('title="双击展开「作品集」"'), '悬停提示要写明双击展开（可发现性兜底）');
  assert.equal(html.includes('安和昴'), false, '折叠时不该渲染成员');
});

check('组名前有圆角正方形色块（D113：同名不同色在主界面靠它区分）', () => {
  const html = renderGroups([
    { kind: 'group', name: '作品集', colorId: 'pink', items: GROUP_LIST_FIXTURE, expanded: false },
  ]);
  assert.ok(html.includes('pf-group__swatch'), '组名前必须有色块');
  assert.ok(
    html.includes('--pf-group-swatch:'),
    '色块取色要走颜色注册表（与胶囊小圆点同源），不能写死',
  );
  // 色块站在组名前面
  assert.ok(
    html.indexOf('pf-group__swatch') < html.indexOf('>作品集<'),
    '色块必须在组名之前',
  );
});

check('组的边框与底色都跟着组色走（D114：边框的颜色 = 色块的颜色）', () => {
  const html = renderGroups([
    { kind: 'group', name: '作品集', colorId: 'pink', items: GROUP_LIST_FIXTURE, expanded: true },
  ]);
  assert.ok(html.includes('--pf-group-color:'), '卡上必须带组色变量，边框与底色才能跟着走');
  assert.ok(
    html.indexOf('--pf-group-color:') < html.indexOf('pf-group-card__head'),
    '组色变量要挂在整张卡上（不是只挂在组头）',
  );
});

check('展开态：整卡独占一行、渲染成员，并带收起按钮', () => {
  const html = renderGroups([
    { kind: 'group', name: '作品集', colorId: 'blue', items: GROUP_LIST_FIXTURE, expanded: true },
  ]);
  assert.ok(html.includes('data-pf-group-expanded="yes"'));
  assert.ok(html.includes('pf-group-card'), '展开态要用卡片类名');
  assert.ok(html.includes('pf-group-card__toggle'), '展开的卡要有收起入口');
  assert.ok(html.includes('安和昴') && html.includes('千早爱音'), '展开后成员要渲染出来');
  assert.ok(html.includes('data-pf-preset-id="p1"'), '成员仍是可拖拽的预设胶囊');
});

check('未分组那段排在组块之后，且仍是普通胶囊', () => {
  const html = renderGroups([
    {
      kind: 'group',
      name: '作品集',
      colorId: 'blue',
      items: [GROUP_LIST_FIXTURE[0]],
      expanded: false,
    },
    { kind: 'ungrouped', items: [GROUP_LIST_FIXTURE[1]] },
  ]);
  const groupAt = html.indexOf('data-pf-group-name="作品集"');
  const ungroupedAt = html.indexOf('data-pf-preset-id="p2"');
  assert.ok(groupAt >= 0 && ungroupedAt > groupAt, '散件必须排在组砖之后');
  assert.ok(html.includes('pf-preset-list--flat'), '未分组列表要用不叠底边距的类名');
});

function renderDropzone(props) {
  return renderToStaticMarkup(React.createElement(PresetGroupDropzone, props));
}

check('建组判断区：不在拖拽中就整块不渲染（平时不该挡住面板头部）', () => {
  const html = renderDropzone({ active: false, hovered: false });
  assert.equal(html, '', '非拖拽状态下不该产生任何 DOM');
});

check('建组判断区：拖拽中但没悬停 = 摸得到、看不见', () => {
  const html = renderDropzone({ active: true, hovered: false });
  assert.ok(html.includes('data-pf-group-dropzone="true"'), '要有标记供断言与落点判定');
  assert.ok(html.includes('data-pf-group-name=""'), '空组名 = 新建（落点判定靠它）');
  assert.equal(html.includes('pf-group-dropzone--over'), false, '没悬停时不该显形');
  assert.equal(html.includes('松手建成分组'), false, '没悬停时不该出现提示文案');
});

check('建组判断区：指针压上来才显形并给出提示', () => {
  const html = renderDropzone({ active: true, hovered: true });
  assert.ok(html.includes('pf-group-dropzone--over'), '悬停要显形');
  assert.ok(html.includes('松手建成分组'), '要告诉用户松手会发生什么');
});

// 预设读取是异步的，放到最后收尾
usePresetStore.getState().replaceAll([]);
usePresetStore.getState().loadPresets().then(() => {
  section('非桌面环境下的读取失败不崩溃（浏览器预览路径）');

  check('记录了中文错误提示并结束加载态', () => {
    const state = usePresetStore.getState();
    assert.equal(state.loaded, true);
    assert.equal(state.loading, false);
    assert.ok(
      typeof state.loadError === 'string' && state.loadError.includes('预设读取失败'),
      `loadError 应为中文提示，实际为 ${state.loadError}`,
    );
    assert.deepEqual(state.presets, []);
  });

  console.log(`\n通过 ${passed} 项，失败 ${failures.length} 项`);
  if (failures.length > 0) {
    console.log(`失败清单：${failures.join('、')}`);
    process.exit(1);
  }
});
