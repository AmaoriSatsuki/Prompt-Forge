#!/usr/bin/env node
/**
 * 中文文案审校（M6 的硬要求：界面零英文泄漏）。
 *
 * 做法：把真实的 AppShell 用 react-dom/client **真正挂载到 jsdom 里**
 * （不是静态渲染），然后切换几种界面状态，把每一种状态下用户能看到的文案
 * ——文本节点 + title / aria-label / placeholder ——全部抓出来逐条检查。
 *
 * 允许出现的拉丁字母只有三类：
 *   - 品牌与厂商名：Prompt Forge / DeepSeek / OpenAI
 *   - 提示词版本号：v1
 *   - 接口地址（placeholder 里的 https://...）
 * 除它们以外，文案里只要还剩一个拉丁字母就算「英文泄漏」并报出具体位置。
 *
 * 顺带把完整文案清单写到 .verify-out/copy-inventory.txt，便于人工通读。
 *
 * 运行：npm run verify:copy
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const OUT = path.join(__dirname, '..', '.verify-out');
fs.writeFileSync(path.join(OUT, 'package.json'), '{"type":"commonjs"}\n');
fs.cpSync(path.join(__dirname, '..', 'src', 'styles'), path.join(OUT, 'styles'), {
  recursive: true,
});
require.extensions['.css'] = () => ({});

// ---------------------------------------------------------------------------
// 把 jsdom 装成 React DOM 需要的全局环境
// ---------------------------------------------------------------------------
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
const { window } = dom;

globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.HTMLInputElement = window.HTMLInputElement;
globalThis.Element = window.Element;
globalThis.Node = window.Node;
globalThis.NodeFilter = window.NodeFilter;
globalThis.Event = window.Event;
globalThis.MouseEvent = window.MouseEvent;
globalThis.KeyboardEvent = window.KeyboardEvent;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.requestAnimationFrame =
  window.requestAnimationFrame?.bind(window) ?? ((callback) => setTimeout(callback, 0));
globalThis.cancelAnimationFrame = window.cancelAnimationFrame?.bind(window) ?? clearTimeout;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(globalThis, 'navigator', {
  value: window.navigator,
  configurable: true,
});

const React = require('react');
const { act } = require('react');
const { createRoot } = require('react-dom/client');

const { AppShell } = require(path.join(OUT, 'components/layout/AppShell.js'));
const { useModuleStore } = require(path.join(OUT, 'store/useModuleStore.js'));
const { usePresetStore } = require(path.join(OUT, 'store/usePresetStore.js'));
const { useSettingsStore } = require(path.join(OUT, 'store/useSettingsStore.js'));
const { useUiStore } = require(path.join(OUT, 'store/useUiStore.js'));
const { useDictionaryStore } = require(path.join(OUT, 'store/useDictionaryStore.js'));
const { useSnapshotStore } = require(path.join(OUT, 'store/useSnapshotStore.js'));
const { DictionaryImportDialog } = require(
  path.join(OUT, 'components/dictionary/DictionaryImportDialog.js'),
);
const {
  createProfile,
} = require(path.join(OUT, 'utils/profileSanitize.js'));

// ---------------------------------------------------------------------------
// 文案收集与判定
// ---------------------------------------------------------------------------
/**
 * 允许出现的拉丁内容 —— 每一条都必须有明确理由，不能为了让测试变绿而随手加：
 *   - Prompt Forge / Windows：品牌与平台名
 *   - BAIDU_TRANSLATE_APP_ID / BAIDU_TRANSLATE_APP_KEY：用户要自己去系统环境变量里创建，
 *     这两个名字必须原样给出才可操作
 *   - APP ID：百度开放平台控制台里就叫这个，用户要照着它去核对，不能改写成中文
 *   - https://...：示例地址（接口地址一类技术字段只能是拉丁）
 * 除这些以外，界面文案里不该再有任何拉丁字母。
 *
 * 语言模型接入（DeepSeek / OpenAI / 模型名示例 / 系统提示词版本号）已整体剔除，
 * 因此这份名单里也不再需要它们 —— 名单变小本身就是「那些概念真的走了」的证据。
 *
 * 另外：翻译服务返回的译文属于「外部内容」，由 data-pf-external 标记的
 * 子树承载，审校器整体跳过 —— 那本来就是英文该出现的地方。
 */
const ALLOWED_LATIN = [
  /Prompt Forge/g,
  /Windows/g,
  /BAIDU_TRANSLATE_APP_ID/g,
  /BAIDU_TRANSLATE_APP_KEY/g,
  /APP ID/g,
  /*
   * 词典弹窗的格式说明是**用户 2026 轮指定的原文**：
   * 「支持导入的格式：CSV / JSON / SQLite (.db, .sqlite)」。
   * 文件扩展名与格式名改成中文会让人对不上磁盘上的文件，因此原样保留。
   */
  /CSV/g,
  /JSON/g,
  /SQLite/g,
  /\.db/g,
  /\.sqlite/g,
  /*
   * D80：推送服务的用户指定原文里有三个专有名词，改写成中文就对不上
   * 用户在 ComfyUI 那边看到的界面了（与 CSV / JSON 同一条理由）：
   * - WebSocket：协议名（开关标题「开启 WebSocket 推送」）
   * - ComfyUI：对接的那套软件的名字
   * - SunYan Sync：ComfyUI 里的节点名
   */
  /WebSocket/g,
  /ComfyUI/g,
  /SunYan Sync/g,
  /*
   * D86：用户把「词典库」改名为「**Tag 库**」，`Tag` 是需求原文里的叫法
   * （「改名为Tag库，是搭配了单独json文件的Tag库」），与上面几个专有名词同一条理由，
   * 不译成「标签」——否则界面上的库名与用户口中的名字对不上。
   */
  /Tag/g,
];
const URL_PATTERN = /https?:\/\/\S+/g;
const COPY_ATTRIBUTES = ['title', 'aria-label', 'placeholder'];
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE']);
const EXTERNAL_ATTR = 'data-pf-external';
/*
 * UI 单字符徽标（D67：「快照库」的 S 方块）。
 * 需求写明块内是白色加粗字母 S；单字母不属于"英文文案"，也不是外部内容，
 * 因此给这类纯装饰字符单独一个标记，审校器跳过它的文本。
 */
const UI_GLYPH_ATTR = 'data-pf-ui-glyph';

function isExternal(element) {
  return Boolean(element?.closest?.(`[${EXTERNAL_ATTR}="true"]`));
}

function describe(element) {
  if (!element || element.nodeType !== 1) return '(未知节点)';
  const tag = element.tagName.toLowerCase();
  const className = (element.getAttribute('class') ?? '').split(' ').filter(Boolean)[0];
  return className ? `${tag}.${className}` : tag;
}

function collectCopy(root) {
  const entries = [];

  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        const text = (child.textContent ?? '').trim();
        if (text) entries.push({ where: describe(child.parentElement), text });
        continue;
      }
      if (child.nodeType !== 1) continue;
      if (SKIP_TAGS.has(child.tagName)) continue;
      if (child.getAttribute(EXTERNAL_ATTR) === 'true') continue;
      if (child.getAttribute(UI_GLYPH_ATTR) === 'true') continue;
      walk(child);
    }
  };
  walk(root);

  for (const element of root.querySelectorAll('*')) {
    if (isExternal(element)) continue;
    for (const name of COPY_ATTRIBUTES) {
      const value = element.getAttribute(name);
      if (value && value.trim()) {
        entries.push({ where: `${describe(element)}[${name}]`, text: value.trim() });
      }
    }
  }

  return entries;
}

/** 去掉允许的拉丁内容后，如果还剩字母，就是英文泄漏 */
function findLatinLeaks(entries) {
  const leaks = [];
  for (const entry of entries) {
    let rest = entry.text;
    for (const allowed of ALLOWED_LATIN) rest = rest.replace(allowed, ' ');
    rest = rest.replace(URL_PATTERN, ' ');
    if (/[A-Za-z]/.test(rest)) leaks.push(entry);
  }
  return leaks;
}

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
async function main() {
  const container = document.getElementById('root');
  const root = createRoot(container);

  /** 让挂载期间产生的异步状态更新（例如「读取失败」的提示条）也落在 act 里，避免噪声警告 */
  const flush = async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  await act(async () => {
    root.render(React.createElement(AppShell));
  });
  await flush();

  const states = [];
  const snapshot = (name) => {
    states.push({ name, entries: collectCopy(container) });
  };

  await flush();
  snapshot('初始界面');

  await act(async () => {
    useUiStore.getState().openSettings();
  });
  await flush();
  snapshot('设置弹窗');

  await act(async () => {
    useUiStore.getState().closeSettings();
    usePresetStore.getState().replaceAll([
      {
        id: 'preset_1',
        label: '冷峻文风',
        english: 'in a cold, restrained tone',
        weight: 100,
        colorId: 'common',
        createdAt: 1,
        updatedAt: 2,
      },
    ]);
  });
  snapshot('预设库有内容');

  const addPresetButton = Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent.trim() === '新增预设',
  );
  assert.ok(addPresetButton, '界面上找不到「新增预设」按钮，挂载可能失败了');
  await act(async () => {
    addPresetButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  snapshot('预设编辑器弹窗');

  await act(async () => {
    // 关掉预设编辑器（点取消），并造一排「有源内容 + 有译文」的模块用于审校
    const cancelButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent.trim() === '取消',
    );
    cancelButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const firstModuleId = useModuleStore.getState().modules[0].id;
    // 夹具自洽：有译文就必须有源内容，否则实时翻译会按空内容把译文清掉
    useModuleStore.getState().setSourceText(firstModuleId, '把这段话改写得更礼貌');
    useModuleStore.getState().setTranslation(firstModuleId, 'Rewrite this paragraph politely.');
    useModuleStore.getState().setTranslationMeta(firstModuleId, {
      model: 'deepseek-chat',
      elapsedMs: 1200,
    });
    useModuleStore.getState().setStatus(firstModuleId, 'done');
  });
  snapshot('已有译文与用量');

  // 翻译服务只剩一种接入形态：默认那套就是百度，凭据说明里必然出现两个环境变量名
  await act(async () => {
    useSettingsStore
      .getState()
      .replaceAll([createProfile({ brand: 'baidu', label: '百度主力' })], undefined);
  });
  await act(async () => {
    useUiStore.getState().openSettings();
  });
  await flush();
  snapshot('百度翻译配置');

  // 词典管理：列表里放一部词典（名称来自文件名，属于外部内容，审校应跳过）
  await act(async () => {
    useUiStore.getState().closeSettings();
    useDictionaryStore.setState({
      items: [
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
      ],
    });
    useUiStore.getState().openAppSettings('dictionary');
  });
  await flush();
  snapshot('词典管理弹窗');

  /*
   * D76：快照库视图。新增的「更新 / 复制」是两个**纯图标**按钮，
   * 界面上一个文字都不多写 —— 因此这里要审的是它们的 title / aria-label 是否中文。
   */
  await act(async () => {
    useUiStore.getState().closeAppSettings();
    useSnapshotStore.setState({
      snapshots: [
        {
          id: 'snap-copy',
          name: '基座方案',
          scope: 'global',
          weight: 100,
          modules: [{ sourceText: '', colorId: 'red', capsules: [] }],
          copyText: 'a, b, c.',
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      loaded: true,
      loading: false,
      loadError: null,
      persisted: {},
    });
    useUiStore.getState().setLibraryView('snapshots');
  });
  await flush();
  snapshot('快照库');

  // D80：齿轮设置弹窗的「推送服务」Tab（专有名词走白名单，其余必须是中文）
  await act(async () => {
    useUiStore.getState().openAppSettings('push');
  });
  await flush();
  snapshot('齿轮设置 · 推送服务');

  /*
   * 字段映射界面单独挂一份：它的下拉选项与预览表来自用户文件（外部内容），
   * 其余标签必须是中文。用独立宿主渲染，避免影响 AppShell 的状态快照。
   */
  const mappingHost = document.createElement('div');
  document.body.appendChild(mappingHost);
  const mappingRoot = createRoot(mappingHost);
  await act(async () => {
    mappingRoot.render(
      React.createElement(DictionaryImportDialog, {
        inspection: {
          format: 'csv',
          tables: [
            {
              name: 'CSV',
              fields: ['名称', '英文'],
              sampleRows: [['甲', 'a']],
              suggestedCnIndex: 0,
              suggestedEnIndex: 1,
            },
          ],
        },
        busy: false,
        error: null,
        onCancel: () => {},
        onConfirm: () => {},
      }),
    );
  });
  const mappingEntries = collectCopy(mappingHost);
  await act(async () => {
    mappingRoot.unmount();
  });
  mappingHost.remove();

  // 恢复成「百度配置」界面：后面的检查要对着实时 DOM 找凭据输入框
  await act(async () => {
    useUiStore.getState().closeAppSettings();
    useUiStore.getState().openSettings();
    useSettingsStore
      .getState()
      .replaceAll([createProfile({ brand: 'baidu', label: '百度主力' })], undefined);
  });
  await flush();

  // D115：设置弹窗的第四个 Tab「导入导出」（勾选项 + 同名二选一 + 说明，全中文）
  await act(async () => {
    useUiStore.getState().closeSettings();
    useUiStore.getState().openAppSettings('bundle');
  });
  await flush();
  snapshot('齿轮设置 · 导入导出');

  // D117：设置弹窗的第五个 Tab「初始化」（三项清空 + 确认说明，全中文）
  await act(async () => {
    useUiStore.getState().setAppSettingsTab('reset');
  });
  await flush();
  snapshot('齿轮设置 · 初始化');

  // 再把界面复原成「百度配置」：后面的断言仍要对着实时 DOM 找凭据输入框
  await act(async () => {
    useUiStore.getState().closeAppSettings();
    useUiStore.getState().openSettings();
  });
  await flush();

  // -------------------------------------------------------------------------
  section('文案审校：界面不得出现计划外的英文');

  for (const state of states) {
    check(`${state.name}：共 ${state.entries.length} 条文案，无英文泄漏`, () => {
      const leaks = findLatinLeaks(state.entries);
      assert.equal(
        leaks.length,
        0,
        leaks.map((leak) => `${leak.where} → 「${leak.text}」`).join('；'),
      );
    });
  }

  check('词典管理弹窗：格式说明按用户原文，其余按钮与提示都是中文', () => {
    const copy = states[6].entries.map((entry) => entry.text).join(' ');
    for (const expected of [
      '词典管理',
      '支持导入的格式：CSV / JSON / SQLite (.db, .sqlite)',
      '导入新词典',
      '打开词典文件夹',
      '重新扫描',
      '关闭',
      '越靠上优先级越高',
      '不会自动重翻',
    ]) {
      assert.ok(copy.includes(expected), `词典弹窗缺少「${expected}」`);
    }
    assert.ok(copy.includes('角色词典'), '列表里应当显示词典名');
  });

  check('齿轮设置 · 推送服务：开关/端口/使用说明齐备，专有名词之外全中文', () => {
    const copy = states[8].entries.map((entry) => entry.text).join(' ');
    for (const expected of [
      '推送服务',
      '词典管理',
      '开启 WebSocket 推送',
      '通信端口',
      'ComfyUI 插件将通过此端口接收实时推流。',
      '使用说明',
      'SunYan Sync',
    ]) {
      assert.ok(copy.includes(expected), `推送服务缺少「${expected}」`);
    }
    // 关掉开关才置灰；这里是默认态，文案里不该出现报错
    assert.equal(copy.includes('端口需在'), false, '默认端口合法，不该出现范围提示');
  });

  check('齿轮设置 · 导入导出：五个库默认全选、同名只给「重命名 / 覆盖」，说明点明词典三件套', () => {
    const state = states.find((entry) => entry.name === '齿轮设置 · 导入导出');
    assert.ok(state, '缺少「导入导出」页的文案快照');
    const copy = state.entries.map((entry) => entry.text).join(' ');
    for (const expected of [
      '导入导出',
      '导出所选库',
      '预设库',
      '画师库',
      'Tag 库',
      '词典库',
      '快照库',
      '已选 5 个库',
      '选择位置并导出',
      '导入一个库文件',
      '选择文件…',
      '重命名',
      '覆盖',
      '名·1',
      '同文件夹的画师',
    ]) {
      assert.ok(copy.includes(expected), `导入导出页缺少「${expected}」`);
    }
    // 用户口径：导入只有叠加，界面上不该有「替换整库 / 先清空」这类入口
    assert.equal(copy.includes('替换整个库'), false, '不该提供替换整库的入口');
    assert.equal(copy.includes('替换全部'), false, '不该提供替换全部的入口');
    assert.equal(copy.includes('清空原有'), false, '同一次导入不该清空原有内容');
  });

  check('齿轮设置 · 初始化：三项清空按使用频率排列，界面项不需要确认', () => {
    const state = states.find((entry) => entry.name === '齿轮设置 · 初始化');
    assert.ok(state, '缺少「初始化」页的文案快照');
    const copy = state.entries.map((entry) => entry.text).join(' ');
    for (const expected of [
      '初始化',
      '界面初始化',
      '库初始化',
      '服务商初始化',
      '恢复默认',
      '清空五个库',
      '清空服务商',
      '不需要确认',
      '不可撤销',
    ]) {
      assert.ok(copy.includes(expected), `初始化页缺少「${expected}」`);
    }
    // 顺序：界面 → 库 → 服务商（用户要求把最常用的界面项放第一）
    const uiAt = copy.indexOf('界面初始化');
    const libAt = copy.indexOf('库初始化');
    const providerAt = copy.indexOf('服务商初始化');
    assert.ok(uiAt < libAt && libAt < providerAt, '三项顺序必须是 界面 → 库 → 服务商');
  });

  check('快照库：更新 / 复制两个图标按钮的提示是中文（D76）', () => {
    const copy = states[7].entries.map((entry) => entry.text).join(' ');
    for (const expected of [
      '快照库',
      '创建快照',
      '撤销',
      '全局',
      '更新为当前工作区',
      '复制译文',
    ]) {
      assert.ok(copy.includes(expected), `快照库缺少「${expected}」`);
    }
  });

  check('字段映射界面：提示与字段标签是中文，外部字段名/样本不参与审校', () => {
    const leaks = findLatinLeaks(mappingEntries);
    assert.equal(
      leaks.length,
      0,
      leaks.map((leak) => `${leak.where} → 「${leak.text}」`).join('；'),
    );
    const text = mappingEntries.map((entry) => entry.text).join(' ');
    for (const expected of [
      '无法识别该词典键值，请手动配置',
      '哪个字段代表中文？',
      '哪个字段代表英文（提示词）？',
      '导入',
      '取消',
    ]) {
      assert.ok(text.includes(expected), `映射界面缺少「${expected}」`);
    }
  });

  check('审校确实覆盖到了真实界面（防止挂载失败导致空跑）', () => {
    const total = states.reduce((sum, state) => sum + state.entries.length, 0);
    assert.ok(total > 80, `只收集到 ${total} 条文案，界面可能没挂载起来`);
    const initial = states[0].entries.map((entry) => entry.text);
    for (const expected of [
      // 工具栏整合 + 移除「设置」按钮后的最终形态：顶栏「新增模块 / 删除模块」+ 输入框右上角两个
      // D80：顶栏「词典」按钮已移除，改由齿轮设置弹窗承担（齿轮只有图标，没有文字）
      '新增模块',
      '删除模块',
      '提示词工坊',
      '点击配置翻译服务',
      '全文复制',
      '全文清空',
      '预设库',
      '搜索预设名称',
    ]) {
      assert.ok(initial.includes(expected), `初始界面缺少「${expected}」`);
    }
    // 被移除的按钮不许回来
    assert.equal(initial.includes('全文翻译'), false, '「全文翻译」应当已移除');
    // D80：「设置」四个字现在只存在于齿轮的悬停说明 / 无障碍名里，不再是一个文字按钮
    assert.ok(
      initial.includes('设置（推送服务 / 词典管理）'),
      '顶栏齿轮应当带中文悬停说明',
    );
    assert.equal(
      initial.some((text) => text === '设置'),
      false,
      '顶栏不该再有独立的文字「设置」按钮（齿轮负责，文案在悬停说明里）',
    );
    assert.equal(initial.includes('词典'), false, '顶栏「词典」按钮已移除（迁进齿轮设置弹窗）');
    assert.equal(initial.includes('尚未翻译'), false, '未翻译占位已移除（模块保持干净）');
  });

  check('设置弹窗里出现的是中文（含当前配置状态与操作按钮）', () => {
    const settingsCopy = states[1].entries.map((entry) => entry.text).join(' ');
    for (const expected of ['设置 · 翻译服务', '新增配置', '复制', '删除', '关闭', '当前使用中']) {
      assert.ok(settingsCopy.includes(expected), `设置弹窗缺少「${expected}」`);
    }
    // 语言模型时代的「提示词版本 v1」随接入方式一起消失了
    assert.equal(settingsCopy.includes('提示词版本'), false, '不该再有提示词版本一行');
  });

  check('有译文状态下的界面文案都是中文', () => {
    const copy = states[4].entries.map((entry) => entry.text).join(' ');
    assert.ok(copy.includes('模块 6 / 9'), '缺少模块计数');
    // 状态字随输入框工具条一并移除；此时不该再有「待翻译」这类状态文案
    assert.equal(copy.includes('待翻译'), false, '状态字已随 SourceToolbar 移除');
  });

  check('外部内容（模型返回的译文）确实渲染出来了，只是被审校器按标记跳过', () => {
    const container = document.getElementById('root');
    assert.ok(container.textContent.includes('Rewrite this paragraph politely.'), '译文没渲染出来');
    // 模型名原本显示在输入框工具条上，工具栏整合后那里只剩两个按钮 —— 不再断言它可见
    assert.equal(container.querySelectorAll(`[${EXTERNAL_ATTR}="true"]`).length >= 1, true);
    const audited = states[4].entries.map((entry) => entry.text).join(' ');
    assert.equal(audited.includes('Rewrite this paragraph politely.'), false, '外部内容不应进入审校清单');
  });

  check('预设编辑器是唯一出现英文内容的地方，且它属于预设库', () => {
    const editorCopy = states[3].entries;
    const hasEnglishInput = editorCopy.some((entry) => entry.text.includes('英文内容'));
    assert.equal(hasEnglishInput, true, '预设编辑器应当提示「英文内容」字段');
    // 列表本身不出现英文内容（正文断言在 verify:render 里）
    const listCopy = states[2].entries.map((entry) => entry.text).join(' ');
    assert.equal(listCopy.includes('in a cold, restrained tone'), false);
  });

  check('百度翻译配置里给出两个环境变量名与可照做的中文说明', () => {
    const copy = states[5].entries.map((entry) => entry.text).join(' ');
    assert.ok(copy.includes('BAIDU_TRANSLATE_APP_ID'), '缺少 APP ID 环境变量名');
    assert.ok(copy.includes('BAIDU_TRANSLATE_APP_KEY'), '缺少密钥环境变量名');
    assert.ok(copy.includes('这里填写的优先使用'), '缺少凭据来源优先级说明');
    assert.ok(copy.includes('百度翻译'), '缺少百度翻译标题');
  });

  check('百度配置里凭据是可填的两个输入框（原始诉求：这里要能填）', () => {
    const rows = container.querySelectorAll('.pf-cred__row input');
    assert.equal(rows.length, 2, '百度凭据应当是 APP ID 与密钥两个输入框');
    const copy = states[5].entries.map((entry) => entry.text).join(' ');
    assert.ok(copy.includes('APP ID'), '缺少 APP ID 标签');
    assert.ok(copy.includes('尚未配置'), '缺少未配置状态');
  });

  // -------------------------------------------------------------------------
  const inventoryPath = path.join(OUT, 'copy-inventory.txt');
  const lines = [];
  for (const state of states) {
    lines.push(`【${state.name}】共 ${state.entries.length} 条`);
    for (const entry of state.entries) lines.push(`  ${entry.where} → ${entry.text}`);
    lines.push('');
  }
  fs.writeFileSync(inventoryPath, lines.join('\n'), 'utf8');

  section('产出');
  console.log(`  文案清单已写入 ${path.relative(process.cwd(), inventoryPath)}`);
  console.log(`  共审校 ${states.reduce((sum, state) => sum + state.entries.length, 0)} 条文案`);

  console.log(`\n通过 ${passed} 项，失败 ${failures.length} 项`);
  if (failures.length > 0) {
    console.log(`失败清单：${failures.join('、')}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
