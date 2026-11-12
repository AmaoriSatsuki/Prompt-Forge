#!/usr/bin/env node
/**
 * 交互断言：把真实应用挂载进 jsdom，然后**真的往输入框里打字**。
 *
 * 为什么需要这一层：静态渲染只能证明「输入框渲染出来了」，证明不了
 * 「打进去的字会进到 Store 里」。React 的受控输入一旦 value/onChange 接错，
 * 界面上就是「框在、但填不进去」——只有真的派发 input 事件才测得出来。
 *
 * 打字用的是原生 value setter + 派发 input 事件：直接改 `input.value` 会被
 * React 的值追踪器忽略，测出来是假阴性。
 *
 * 运行：npm run verify:interaction
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

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
const { window } = dom;

globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.HTMLInputElement = window.HTMLInputElement;
globalThis.HTMLTextAreaElement = window.HTMLTextAreaElement;
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
const {
  MODULE_SOURCE_MAX_LENGTH,
  MODULE_DEFAULT_HEIGHT,
  INPUT_PANE_DEFAULT_HEIGHT,
  LIBRARY_PAGE_SIZE,
  PRESET_PANEL_DEFAULT_WIDTH,
  PRESET_PANEL_DEFAULT_ROW_CAPACITY,
  PRESET_PANEL_MIN_WIDTH,
  PRESET_SWATCH_SIZE,
  PRESET_SWATCH_GAP,
  PRESET_FILTER_PADDING,
} = require(path.join(OUT, 'constants/limits.js'));
const { PRESET_FILTER_COLORS } = require(path.join(OUT, 'constants/colors.js'));
const { useModuleStore } = require(path.join(OUT, 'store/useModuleStore.js'));
const { usePresetStore } = require(path.join(OUT, 'store/usePresetStore.js'));
const { usePresetFolderStore } = require(path.join(OUT, 'store/usePresetFolderStore.js'));
const { useArtistStore } = require(path.join(OUT, 'store/useArtistStore.js'));
const { useTagStore } = require(path.join(OUT, 'store/useTagStore.js'));
const { useSnapshotStore } = require(path.join(OUT, 'store/useSnapshotStore.js'));
const { useSettingsStore } = require(path.join(OUT, 'store/useSettingsStore.js'));
const { useUiStore } = require(path.join(OUT, 'store/useUiStore.js'));
const { useDictionaryStore } = require(path.join(OUT, 'store/useDictionaryStore.js'));
const { usePushStore } = require(path.join(OUT, 'store/usePushStore.js'));
const dictApi = require(path.join(OUT, 'api/dictionaries.js'));
const { createProfile } = require(path.join(OUT, 'utils/profileSanitize.js'));

let passed = 0;
const failures = [];

/**
 * 断言执行器。
 *
 * 需要等微任务刷完的用例（例如写剪贴板是异步的）可以传 async 函数，
 * 并用 `await check(...)` 调用；同步用例照旧直接 `check(...)`。
 */
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  [通过] ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`  [失败] ${name}`);
    console.log(`         ${error.message}`);
    if (error?.stack) console.log(`         ${error.stack.split('\n')[1]?.trim() ?? ''}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

const container = document.getElementById('root');

/** 按字段标签找到它下面唯一的输入控件 */
function controlByLabel(labelText) {
  const fields = Array.from(container.querySelectorAll('.pf-field'));
  for (const field of fields) {
    const label = field.querySelector('.pf-field__label');
    if (label && label.textContent.includes(labelText)) {
      const control = field.querySelector('input, textarea, select');
      if (control) return control;
    }
  }
  return null;
}

function buttonByText(text, root = container) {
  return Array.from(root.querySelectorAll('button')).find(
    (button) => button.textContent.trim() === text,
  );
}

/** 真的「打字」：绕过 React 的值追踪器，再派发 input 事件 */
function typeInto(element, text) {
  const proto =
    element.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : element.tagName === 'SELECT'
        ? null
        : window.HTMLInputElement.prototype;
  if (proto) {
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(element, text);
  } else {
    element.value = text;
  }
  element.dispatchEvent(new window.Event('input', { bubbles: true }));
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function main() {
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(AppShell));
  });
  await flush();

  // -------------------------------------------------------------------------
  section('设置面板：每个输入框都要真的能填进去');

  await act(async () => {
    useSettingsStore.getState().replaceAll([createProfile({ label: '甲' })]);
    useUiStore.getState().openSettings();
  });
  await flush();

  check('「配置命名」打字后写回 Store', () => {
    const input = controlByLabel('配置命名');
    assert.ok(input, '找不到「配置命名」输入框');
    act(() => {
      typeInto(input, '甲改过了');
    });
    assert.equal(input.value, '甲改过了', 'DOM 里的值没变');
    assert.equal(useSettingsStore.getState().profiles[0].label, '甲改过了', 'Store 没收到');
  });

  check('「密钥」输入框可以打字（每次按键都进本地状态）', () => {
    // 凭据是一对值：APP ID 在前、密钥在后（密码框）
    const input = container.querySelector('.pf-cred__row input[type="password"]');
    assert.ok(input, '找不到密钥输入框');
    act(() => {
      typeInto(input, 'sk-abc');
    });
    assert.equal(input.value, 'sk-abc', '第一段没进去');
    act(() => {
      typeInto(input, 'sk-abcdef');
    });
    assert.equal(input.value, 'sk-abcdef', '继续输入没生效');
  });

  check('密钥不会因为打字而回显到别处（Store 里没有明文）', () => {
    const raw = JSON.stringify(useSettingsStore.getState().profiles);
    assert.equal(raw.includes('sk-abcdef'), false, '明文密钥进了配置 Store');
  });

  check('连续打字不会被重置（模拟逐字输入）', () => {
    const input = controlByLabel('配置命名');
    assert.ok(input);
    act(() => {
      typeInto(input, '逐');
    });
    act(() => {
      typeInto(input, '逐字');
    });
    act(() => {
      typeInto(input, '逐字输');
    });
    assert.equal(input.value, '逐字输', '逐字输入过程中被重置了');
    assert.equal(useSettingsStore.getState().profiles[0].label, '逐字输');
  });

  // -------------------------------------------------------------------------
  section('翻译服务配置：该能用的按钮要能用');

  await act(async () => {
    useSettingsStore
      .getState()
      .replaceAll([createProfile({ brand: 'baidu', label: '百度主力' })]);
  });
  await flush();

  check('界面里不再有接口地址 / 模型名这些字段（语言模型接入已剔除）', () => {
    assert.equal(controlByLabel('接口地址'), null, '不该再有接口地址输入框');
    assert.equal(controlByLabel('模型名'), null, '不该再有模型名输入框');
    assert.equal(controlByLabel('翻译方式'), null, '「翻译方式」这一步已经不存在');
  });

  check('百度凭据的两个框（APP ID / 密钥）都能真的填进去', () => {
    const rows = container.querySelectorAll('.pf-cred__row input');
    assert.equal(rows.length, 2, '应当有 APP ID 与密钥两个输入框');

    const [appIdInput, appKeyInput] = rows;
    assert.equal(appKeyInput.type, 'password', '密钥框应当是密码框');

    act(() => {
      typeInto(appIdInput, '2015063000000001');
    });
    assert.equal(appIdInput.value, '2015063000000001', 'APP ID 没填进去');

    act(() => {
      typeInto(appKeyInput, '12345678');
    });
    assert.equal(appKeyInput.value, '12345678', '密钥没填进去');
  });

  check('百度凭据逐字输入不会被重置', () => {
    const appIdInput = container.querySelectorAll('.pf-cred__row input')[0];
    assert.ok(appIdInput);
    act(() => {
      typeInto(appIdInput, '2');
    });
    act(() => {
      typeInto(appIdInput, '20');
    });
    act(() => {
      typeInto(appIdInput, '201');
    });
    assert.equal(appIdInput.value, '201', '逐字输入过程中被重置了');
  });

  check('「测试连接」不应被禁用（凭据在系统凭据库，界面无从预判）', () => {
    const button = buttonByText('测试连接');
    assert.ok(button, '找不到「测试连接」按钮');
    assert.equal(
      button.disabled,
      false,
      '已经没有「接口地址 / 模型名填全才可点」这种前置条件，按钮应当始终可点',
    );
  });

  /*
   * 「测试连接」被挤变形的回归。
   *
   * jsdom 里所有尺寸都是 0，量不出真实宽度，因此这条断言盯的是**造成挤压的 CSS 约定**：
   * 按钮必须不参与 flex 收缩、文字不换行；而同一行里那段长度可变的结论文字要能换行，
   * 否则 flex 就会反过来把按钮压窄（实测就是这个现象）。
   */
  /*
   * 主题的 CSS 契约（jsdom 不算 CSS 层叠，因此这里盯的是「两套令牌都存在且只覆盖颜色」）：
   * 亮色主题必须是 `[data-theme='light']` 覆盖块，且颜色确实被覆盖；
   * 尺寸 / 字体等与主题无关的令牌不该在里面重复定义。
   */
  check('亮色主题：存在 [data-theme] 覆盖块，颜色被覆盖、尺寸不重复定义', () => {
    const tokens = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'styles', 'tokens.css'),
      'utf8',
    );
    const lightBlock = tokens.match(/:root\[data-theme='light'\]\s*\{[^}]*\}/)?.[0] ?? '';
    assert.ok(lightBlock, '缺少亮色主题的令牌覆盖块');
    for (const token of ['--pf-bg:', '--pf-bg-raised:', '--pf-text:', '--pf-border:']) {
      assert.ok(lightBlock.includes(token), `亮色主题缺少 ${token}`);
    }
    assert.equal(
      lightBlock.includes('--pf-topbar-height'),
      false,
      '尺寸令牌与主题无关，不该在亮色块里重复定义',
    );
    // 「未配置」的圆点在亮色下必须换色，否则白点看不见
    assert.ok(lightBlock.includes('--pf-status-unconfigured'), '亮色下未配置圆点没有换色');
    // 深色的绿 / 红两种状态保持用户指定原色
    assert.ok(tokens.includes('--pf-status-ok: #2ecc71'), '绿灯色值应为用户指定的 #2ecc71');
    assert.ok(tokens.includes('--pf-status-error: #e74c3c'), '红灯色值应为用户指定的 #e74c3c');
  });

  check('切换主题只改 data-theme：组件不得硬编码主题色', () => {
    const themeUtil = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'utils', 'theme.ts'),
      'utf8',
    );
    assert.ok(themeUtil.includes('setAttribute(THEME_ATTRIBUTE'), '没有把主题写到 DOM 属性上');
    assert.ok(
      themeUtil.includes("THEME_ATTRIBUTE = 'data-theme'"),
      'DOM 属性名应为 data-theme',
    );
  });

  /*
   * 输入框右上角色块的尺寸约定：用户要求「稍大的长方形」。
   * jsdom 量不出真实尺寸，因此断言 CSS 里的宽高比仍然明显宽大于高、且比原来的 14×14 更大。
   */
  check('输入框右上角色块是稍大的长方形（宽明显大于高，且比原来大）', () => {
    const layoutCss = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'styles', 'layout.css'),
      'utf8',
    );
    const rule = layoutCss.match(/\.pf-input-pane__swatch\s*\{[^}]*\}/)?.[0] ?? '';
    assert.ok(rule, '找不到色块规则');
    const width = Number(rule.match(/width:\s*(\d+(?:\.\d+)?)px/)?.[1] ?? 0);
    const height = Number(rule.match(/height:\s*(\d+(?:\.\d+)?)px/)?.[1] ?? 0);
    assert.ok(width > 14, `宽度应当比原来的 14px 更大，实际 ${width}`);
    assert.ok(height > 0, '高度没写');
    assert.ok(width > height, `应当是长方形（宽 > 高），实际 ${width}×${height}`);
    assert.ok(height <= 16, `高度不宜超过工具条视觉平衡，实际 ${height}`);
  });

  /*
   * 预设库宽度的三档口径（D48；D77 定稿）：初始宽度按「一行 8 块」（12 块 ⇒ 8+4）、
   * 最低宽度刚好 6+6 两排、上限是窗口宽度的 70%（那是运行期相对值，由 utils/panelWidth.ts 的断言守着）。
   * jsdom 量不出真实换行，因此这条盯的是**CSS 几何与宽度常量的一致性**：
   * 谁改了色块尺寸 / 间距 / 内边距而没同步常量，这里就会失败。
   */
  check('预设库宽度与色块几何一致：276px 一行 8 块（12 块 ⇒ 8+4）、211px 6+6', () => {
    const layoutCss = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'styles', 'layout.css'),
      'utf8',
    );
    const tokensCss = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'styles', 'tokens.css'),
      'utf8',
    );
    const swatchRule = layoutCss.match(/\.pf-swatch\s*\{[^}]*\}/)?.[0] ?? '';
    const rowRule = layoutCss.match(/\.pf-filter__row\s*\{[^}]*\}/)?.[0] ?? '';
    const filterRule = layoutCss.match(/\.pf-filter\s*\{[^}]*\}/)?.[0] ?? '';

    const swatchSize = Number(swatchRule.match(/width:\s*(\d+)px/)?.[1] ?? 0);
    const gap = Number(rowRule.match(/gap:\s*(\d+)px/)?.[1] ?? 0);
    const paddingToken = Number(tokensCss.match(/--pf-gap:\s*(\d+)px/)?.[1] ?? 0);

    assert.equal(swatchSize, PRESET_SWATCH_SIZE, '色块尺寸常量与 .pf-swatch 不一致');
    assert.equal(gap, PRESET_SWATCH_GAP, '间距常量与 .pf-filter__row 不一致');
    assert.equal(paddingToken, PRESET_FILTER_PADDING, '内边距常量与 --pf-gap 不一致');
    assert.match(filterRule, /padding:\s*0\s+var\(--pf-gap\)/, '筛选区应当用 --pf-gap 做左右内边距');

    // 面板左边框 1px：可用内宽 = 面板宽 - 1 - 2×内边距
    const perRow = (panelWidth) =>
      Math.floor((panelWidth - 1 - paddingToken * 2 + gap) / (swatchSize + gap));

    // 色块行 = 10 个筛选色 + 画师库 @ + 快照库 S（D62 / D67 / D77）
    const swatchCount = PRESET_FILTER_COLORS.length + 2;

    assert.equal(
      perRow(PRESET_PANEL_DEFAULT_WIDTH),
      PRESET_PANEL_DEFAULT_ROW_CAPACITY,
      '初始宽度必须刚好一行 8 块（D77 用户口径：第一排 8 个、第二排 4 个）',
    );
    assert.equal(
      Math.ceil(swatchCount / perRow(PRESET_PANEL_DEFAULT_WIDTH)),
      2,
      '初始宽度下 12 块应当排成 8+4 两排',
    );
    assert.equal(perRow(PRESET_PANEL_MIN_WIDTH), 6, '最低宽度必须刚好一行 6 块');
    assert.equal(
      Math.ceil(swatchCount / perRow(PRESET_PANEL_MIN_WIDTH)),
      2,
      '最低宽度下 12 块应当排成 6+6 两排（两排都满）',
    );
  });

  /*
   * 「主题按钮里的图标不见了」的回归（用户 2026 轮实测报障）。
   *
   * 真事故：图标是内联 SVG，带 `width="18" height="18"` 属性；而 `.pf-topbar__theme`
   * 是**定宽 28px** 的 flex 容器，HTML 属性只是「呈现提示」、会被 flex 收缩覆盖，
   * CSS 里却只写了 `display: block` 没写宽度 —— 真实浏览器量到 `svg = 2 × 18`，
   * 即被压成描边宽度，界面上只剩太阳图标中心那个圆，看起来就是「没有图标、只有一个小点」。
   *
   * jsdom 里所有尺寸都是 0，量不出真实渲染，因此这条断言盯的是**那条防塌陷的 CSS 契约**：
   * 图标必须在 CSS 里显式声明尺寸，并且不参与 flex 收缩。
   */
  check('主题按钮的图标在 CSS 里显式声明尺寸且不参与 flex 收缩（防「图标被压成 2px」）', () => {
    const layoutCss = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'styles', 'layout.css'),
      'utf8',
    );
    const rule = layoutCss.match(/\.pf-topbar__theme\s+svg\s*\{[^}]*\}/)?.[0] ?? '';
    assert.ok(rule, '找不到 .pf-topbar__theme svg 规则');
    // 尺寸必须写在 CSS 里：只靠 SVG 的 width/height 属性会被 flex 收缩覆盖
    assert.match(rule, /width:\s*18px/, '图标宽度必须显式写在 CSS 里（只靠 SVG 属性会被压塌）');
    assert.match(rule, /height:\s*18px/, '图标高度必须显式写在 CSS 里');
    // 双保险：作为 flex 项不收缩
    assert.match(rule, /flex:\s*0\s+0\s+auto/, '图标不能参与 flex 收缩');
  });

  /*
   * 「测试连接」被挤变形的回归。
   *
   * jsdom 里所有尺寸都是 0，量不出真实宽度，因此这条断言盯的是**造成挤压的 CSS 约定**：
   * 按钮必须不参与 flex 收缩、文字不换行；而同一行里那段长度可变的结论文字要能换行，
   * 否则 flex 就会反过来把按钮压窄（实测就是这个现象）。
   */
  check('按钮文字不会被挤变形：按钮不收缩、不换行，结论文字允许换行', () => {
    const commonCss = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'styles', 'common.css'),
      'utf8',
    );
    const btnRule = commonCss.match(/\.pf-btn\s*\{[^}]*\}/)?.[0] ?? '';
    assert.ok(btnRule, '找不到 .pf-btn 规则');
    assert.match(btnRule, /white-space:\s*nowrap/, '按钮文字必须不换行');
    assert.match(btnRule, /flex:\s*0\s+0\s+auto/, '按钮必须不参与 flex 收缩（否则会被挤窄）');

    const settingsCss = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'styles', 'settings.css'),
      'utf8',
    );
    const connRule = settingsCss.match(/\.pf-conn\s*\{[^}]*\}/)?.[0] ?? '';
    assert.ok(connRule, '找不到 .pf-conn 规则');
    assert.match(connRule, /flex-wrap:\s*wrap/, '结论文字过长时应当换行，而不是压窄按钮');
  });

  /*
   * 「外框的滚动条去除」（用户 2026 轮实测报障）。
   *
   * 原来弹窗面板 `.pf-modal__panel` 自己有 `overflow-y: auto`，而右侧详情区也是一个滚动容器，
   * 于是出现两条滚动条：外框那条会把标题与关闭按钮一起滚走。
   * jsdom 里量不出滚动条，因此断言盯的是这条 CSS 契约：
   * **外框禁止滚动（overflow: hidden + 列向 flex），滚动只发生在详情区。**
   */
  check('设置弹窗只让内层滚动：外框不出现滚动条', () => {
    const settingsCss = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'styles', 'settings.css'),
      'utf8',
    );
    const wide = settingsCss.match(/\.pf-modal__panel--wide\s*\{[^}]*\}/)?.[0] ?? '';
    assert.ok(wide, '找不到 .pf-modal__panel--wide 规则');
    assert.match(wide, /overflow:\s*hidden/, '外框必须禁止自己滚动');
    assert.match(wide, /display:\s*flex/, '外框要用 flex 分配高度');
    assert.match(wide, /flex-direction:\s*column/, '外框应当按列排布');

    const detail = settingsCss.match(/\.pf-settings__detail\s*\{[^}]*\}/)?.[0] ?? '';
    assert.ok(detail, '找不到 .pf-settings__detail 规则');
    assert.match(detail, /overflow-y:\s*auto/, '滚动只发生在详情区');
    assert.equal(
      /max-height/.test(detail),
      false,
      '详情区高度应由弹窗分配，别再写死 max-height（否则外框还会溢出）',
    );
  });

  // 注意：check 是**同步**的（不 await 回调），因此这里不能用 async 回调 ——
  // 悬空的 Promise 会在后续断言之间继续跑 act()，把后面整片测试的状态搅乱（实测踩到过）。
  check('「测试连接」始终可点：凭据在系统凭据库，界面无从预判', () => {
    act(() => {
      useSettingsStore.getState().replaceAll([createProfile({ label: '甲' })]);
    });
    const button = buttonByText('测试连接');
    assert.ok(button, '找不到「测试连接」按钮');
    assert.equal(button.disabled, false, '没有前置条件，按钮应当始终可点');
  });

  // -------------------------------------------------------------------------
  section('设置面板：先命名、再选翻译服务（真实点击）');

  await act(async () => {
    useSettingsStore.getState().replaceAll([createProfile({ label: '甲' })]);
  });
  await flush();

  check('两步顺序：配置命名 → 翻译服务 → 凭据', () => {
    const detailHtml = container.querySelector('.pf-settings__detail').innerHTML;
    const labelIndex = detailHtml.indexOf('配置命名');
    const serviceIndex = detailHtml.indexOf('翻译服务');
    const credIndex = detailHtml.indexOf('凭据');
    assert.ok(labelIndex >= 0, '缺少「配置命名」');
    assert.ok(serviceIndex > labelIndex, '「翻译服务」必须排在「配置命名」之后');
    assert.ok(credIndex > serviceIndex, '凭据区必须排在「翻译服务」之后');
  });

  check('翻译服务是下拉菜单：四家都在，只有百度可选，其余标「即将支持」', () => {
    const select = container.querySelector('select[aria-label="翻译服务"]');
    assert.ok(select, '找不到「翻译服务」下拉菜单');
    const options = Array.from(select.querySelectorAll('option'));
    assert.equal(options.length, 4, '应当列出四家翻译服务');
    const byValue = (value) => options.find((item) => item.value === value);
    assert.ok(byValue('baidu') && byValue('tencent') && byValue('volcano') && byValue('aliyun'));
    assert.equal(byValue('baidu').disabled, false, '百度必须可选（本版唯一入口）');
    for (const id of ['tencent', 'volcano', 'aliyun']) {
      assert.equal(byValue(id).disabled, true, `${id} 尚未实现，应当禁用`);
      assert.ok(byValue(id).textContent.includes('即将支持'), `${id} 应当标注即将支持`);
    }
    assert.equal(select.value, 'baidu', '默认选中的是百度');
    // 语言模型 / 本地模型这两个接入板块已经彻底不在界面里了
    assert.equal(container.textContent.includes('语言模型'), false);
    assert.equal(container.textContent.includes('本地模型'), false);
    // 凭据是「一对」两个框（百度的叫法）
    assert.equal(container.querySelectorAll('.pf-cred__row input').length, 2);
  });

  check('默认配置落在百度翻译上（首启就能填、能测、能翻）', () => {
    const profile = useSettingsStore.getState().profiles[0];
    assert.equal(profile.brand, 'baidu', '默认翻译服务应当是百度');
    assert.equal(container.querySelectorAll('.pf-cred__row input').length, 2);
  });

  check('在下拉里重新选「百度翻译」不会改掉当前服务', () => {
    const select = container.querySelector('select[aria-label="翻译服务"]');
    assert.ok(select);
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype,
        'value',
      ).set;
      setter.call(select, 'baidu');
      select.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    assert.equal(useSettingsStore.getState().profiles[0].brand, 'baidu');
  });

  // -------------------------------------------------------------------------
  section('预设编辑器：两个输入框都要能填');

  await act(async () => {
    useUiStore.getState().closeSettings();
    usePresetStore.getState().replaceAll([]);
  });
  await flush();

  const addPresetButton = buttonByText('新增预设');
  assert.ok(addPresetButton, '找不到「新增预设」按钮');
  await act(async () => {
    addPresetButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await flush();

  check('预设「中文命名」可以填，并且填的是预填值之外的文字', () => {
    const input = controlByLabel('中文命名');
    assert.ok(input, '找不到中文命名输入框');
    assert.equal(input.value, '胶囊 1', '默认命名没有预填');
    act(() => {
      typeInto(input, '冷峻文风');
    });
    assert.equal(input.value, '冷峻文风');
  });

  check('预设「英文内容」可以填（这是界面上唯一该出现英文的地方）', () => {
    const textarea = controlByLabel('英文内容');
    assert.ok(textarea, '找不到英文内容输入框');
    act(() => {
      typeInto(textarea, 'in a cold, restrained tone');
    });
    assert.equal(textarea.value, 'in a cold, restrained tone');
  });

  await act(async () => {
    buttonByText('取消')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await flush();

  // -------------------------------------------------------------------------
  section('新增预设的默认颜色跟随颜色筛选（D60）');

  await act(async () => {
    useUiStore.getState().clearPresetFilter();
  });
  await flush();

  await act(async () => {
    buttonByText('新增预设')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await flush();

  check('没有筛选时，新增预设的默认归属色是红（第一个模块色）', () => {
    const picker = container.querySelector('.pf-color-picker');
    assert.ok(picker, '找不到归属颜色选择器');
    const checked = [...picker.querySelectorAll('[role="radio"]')]
      .filter((node) => node.getAttribute('aria-checked') === 'true')
      .map((node) => node.getAttribute('aria-label'));
    assert.deepEqual(checked, ['归属颜色：红']);
  });

  await act(async () => {
    buttonByText('取消')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await flush();

  await act(async () => {
    // 单选筛选：只筛「蓝」
    useUiStore.getState().togglePresetFilterColor('blue');
  });
  await flush();

  await act(async () => {
    buttonByText('新增预设')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await flush();

  check('筛选「蓝」时，新增预设的默认归属色跟着变成蓝', () => {
    const picker = container.querySelector('.pf-color-picker');
    assert.ok(picker, '找不到归属颜色选择器');
    const checked = [...picker.querySelectorAll('[role="radio"]')]
      .filter((node) => node.getAttribute('aria-checked') === 'true')
      .map((node) => node.getAttribute('aria-label'));
    assert.deepEqual(checked, ['归属颜色：蓝'], '新建预选的默认色应当跟随当前筛选色');
  });

  check('在筛选状态下新建并保存，预设落库的颜色就是蓝（不是默认红）', () => {
    const label = controlByLabel('中文命名');
    const english = controlByLabel('英文内容');
    assert.ok(label && english, '找不到预设编辑器的输入框');
    act(() => {
      typeInto(label, '蓝色冷调');
      typeInto(english, 'cold blue tone');
    });
  });

  await act(async () => {
    const form = container.querySelector('form.pf-modal__panel');
    assert.ok(form, '找不到预设编辑器表单');
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  });
  await flush();

  check('保存后这条预设的归属色确实是蓝', () => {
    const preset = usePresetStore.getState().presets.find((item) => item.label === '蓝色冷调');
    assert.ok(preset, '预设没有保存成功');
    assert.equal(preset.colorId, 'blue');
  });

  await act(async () => {
    useUiStore.getState().clearPresetFilter();
    usePresetStore.getState().replaceAll([]);
  });
  await flush();

  // -------------------------------------------------------------------------
  section('画师库视图与 DOM 物理隔离（D62）');

  await act(async () => {
    useUiStore.getState().setLibraryView('presets');
    useUiStore.getState().clearPresetFilter();
    useUiStore.getState().setPresetSearchKeyword('');
    usePresetStore.setState({
      presets: [
        {
          id: 'p-fixture',
          label: '冷峻文风',
          english: 'cold tone',
          weight: 100,
          colorId: 'red',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      loaded: true,
      loading: false,
      loadError: null,
      persisted: {},
    });
    useArtistStore.setState({
      presets: [
        {
          id: 'artist:@美嘉',
          label: '@美嘉',
          english: '@mika',
          weight: 100,
          colorId: 'artist',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      loaded: true,
      loading: false,
      loadError: null,
      persisted: {},
    });
  });
  await flush();

  check('预设视图里一条画师 DOM 都不渲染（物理隔离）', () => {
    assert.equal(
      container.querySelectorAll('[data-pf-preset-id^="artist:"]').length,
      0,
      '未进入画师库时不能有画师节点',
    );
    assert.ok(container.querySelector('[data-pf-preset-id="p-fixture"]'), '预设应当渲染');
  });

  await act(async () => {
    container
      .querySelector('.pf-swatch[aria-label="画师库"]')
      ?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await flush();

  check('点 @ 后切换为画师库：只渲染画师，预设条目被卸载', () => {
    const panel = container.querySelector('[data-pf-preset-panel]');
    assert.equal(panel.getAttribute('data-pf-library'), 'artists');
    assert.ok(container.querySelector('[data-pf-preset-id="artist:@美嘉"]'), '画师应当渲染');
    assert.equal(
      container.querySelectorAll('[data-pf-preset-id="p-fixture"]').length,
      0,
      '预设条目必须从 DOM 里消失',
    );
    assert.equal(
      container.querySelector('.pf-swatch[aria-label="画师库"]').getAttribute('aria-checked'),
      'true',
      '画师库色块应当处于选中态',
    );
  });

  // D65：再点一次 @ 要能切回预设库
  await act(async () => {
    container
      .querySelector('.pf-swatch[aria-label="画师库"]')
      ?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await flush();

  check('画师库状态下再点 @ 会切回预设库（D65）', () => {
    assert.equal(useUiStore.getState().libraryView, 'presets');
    assert.equal(
      container.querySelector('[data-pf-preset-panel]').getAttribute('data-pf-library'),
      'presets',
    );
  });

  // D65：从画师库点「上一次已选中的同色」，必须进入该筛选而不是取消它
  await act(async () => {
    useUiStore.getState().setPresetFilterColor('pink');
    useUiStore.getState().setLibraryView('artists');
  });
  await flush();

  await act(async () => {
    container
      .querySelector('[aria-label="按颜色筛选：粉"]')
      ?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await flush();

  check('从画师库点已选中的相邻色块，仍然进入该颜色筛选（D65）', () => {
    assert.equal(useUiStore.getState().libraryView, 'presets');
    assert.deepEqual(useUiStore.getState().presetFilterColorIds, ['pink']);
  });

  // 回到画师库，供后面的「添加为预设」用例使用
  await act(async () => {
    useUiStore.getState().clearPresetFilter();
    useUiStore.getState().setLibraryView('artists');
  });
  await flush();

  // D64：画师右键「添加为预设」
  await act(async () => {
    container
      .querySelector('[data-pf-preset-id="artist:@美嘉"]')
      ?.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true }));
  });
  await flush();

  check('画师右键菜单包含「添加为预设」，删除项文案是「删除画师」', () => {
    const menu = document.querySelector('.pf-menu');
    assert.ok(menu, '右键菜单没有打开');
    assert.ok(menu.textContent.includes('添加为预设'), '缺少「添加为预设」');
    assert.ok(menu.textContent.includes('删除画师'), '画师库的删除项应当是「删除画师」');
  });

  await act(async () => {
    const item = [...document.querySelectorAll('.pf-menu__item')].find(
      (node) => node.textContent === '添加为预设',
    );
    item?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await flush();

  check('「添加为预设」打开编辑器并预填画师名', () => {
    const form = container.querySelector('form.pf-modal__panel');
    assert.ok(form, '没有打开预设编辑器');
    assert.equal(controlByLabel('中文命名').value, '@美嘉');
  });

  await act(async () => {
    container
      .querySelector('form.pf-modal__panel')
      ?.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  });
  await flush();

  check('保存后画师被移入预设库：预设 +1、画师 -1、回到预设视图', () => {
    const presets = usePresetStore.getState().presets;
    const moved = presets.find((preset) => preset.label === '@美嘉');
    assert.ok(moved, '预设库里没有这条');
    assert.equal(moved.colorId, 'red', '默认落到第一个预设色');
    assert.equal(
      useArtistStore.getState().presets.some((a) => a.id === 'artist:@美嘉'),
      false,
      '移动后画师那条必须移除',
    );
    assert.equal(useUiStore.getState().libraryView, 'presets');
  });

  await act(async () => {
    container
      .querySelector('[aria-label="按颜色筛选：红"]')
      ?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await flush();

  check('点任意颜色块切回预设库，并应用该颜色的筛选', () => {
    const panel = container.querySelector('[data-pf-preset-panel]');
    assert.equal(panel.getAttribute('data-pf-library'), 'presets');
    assert.ok(container.querySelector('[data-pf-preset-id="p-fixture"]'), '预设应当回来');
    assert.equal(
      container.querySelectorAll('[data-pf-preset-id^="artist:"]').length,
      0,
      '画师必须卸载',
    );
    assert.deepEqual(useUiStore.getState().presetFilterColorIds, ['red']);
  });

  await act(async () => {
    useUiStore.getState().clearPresetFilter();
    useUiStore.getState().setLibraryView('presets');
    usePresetStore.getState().replaceAll([]);
    useArtistStore.getState().replaceAll([]);
  });
  await flush();

  // -------------------------------------------------------------------------
  section('快照库视图与 DOM 隔离（D67）');

  await act(async () => {
    useSnapshotStore.setState({
      snapshots: [
        {
          id: 'snap-1',
          name: '基座方案',
          scope: 'global',
          weight: 100,
          modules: [{ sourceText: '', colorId: 'red', capsules: [] }],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      loaded: true,
      loading: false,
      loadError: null,
      persisted: {},
    });
    useUiStore.getState().setLibraryView('presets');
  });
  await flush();

  check('预设视图里没有任何快照节点', () => {
    assert.equal(container.querySelectorAll('[data-pf-snapshot-id]').length, 0);
  });

  await act(async () => {
    container
      .querySelector('.pf-swatch[aria-label="快照库"]')
      ?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await flush();

  check('点 S 切到快照库：只渲染快照，预设条目被卸载', () => {
    const panel = container.querySelector('[data-pf-preset-panel]');
    assert.equal(panel.getAttribute('data-pf-library'), 'snapshots');
    assert.ok(container.querySelector('[data-pf-snapshot-id="snap-1"]'));
    assert.equal(container.querySelectorAll('.pf-preset-item').length, 0);
    assert.ok(container.textContent.includes('创建快照'));
  });

  await act(async () => {
    container
      .querySelector('[aria-label="按颜色筛选：红"]')
      ?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await flush();

  check('点颜色块切回预设库，快照节点卸载', () => {
    assert.equal(useUiStore.getState().libraryView, 'presets');
    assert.equal(container.querySelectorAll('[data-pf-snapshot-id]').length, 0);
  });

  // -------------------------------------------------------------------------
  // D67：快照右键菜单（权重 / 改名 / 删除）
  await act(async () => {
    useUiStore.getState().setLibraryView('snapshots');
  });
  await flush();

  await act(async () => {
    container
      .querySelector('[data-pf-snapshot-id="snap-1"]')
      ?.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true }));
  });
  await flush();

  check('快照右键菜单有「重命名 / 删除快照」，点 + 权重 +10', () => {
    const menu = document.querySelector('.pf-menu');
    assert.ok(menu, '右键菜单没有打开');
    assert.ok(menu.textContent.includes('重命名'));
    assert.ok(menu.textContent.includes('删除快照'));
    act(() => {
      menu
        .querySelector('[aria-label^="权重增加"]')
        ?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    assert.equal(useSnapshotStore.getState().snapshots[0].weight, 110);
  });

  await act(async () => {
    container
      .querySelector('[data-pf-snapshot-id="snap-1"]')
      ?.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true }));
  });
  await flush();
  await act(async () => {
    const del = [...container.querySelectorAll('.pf-menu__item')].find(
      (node) => node.textContent === '删除快照',
    );
    del?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await flush();

  check('删除快照要二次确认，确认后列表清空', () => {
    assert.ok(container.textContent.includes('删除快照'), '缺少确认框');
    act(() => {
      const confirm = [...container.querySelectorAll('.pf-modal__footer button')].find(
        (node) => node.textContent === '删除',
      );
      confirm?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    assert.equal(useSnapshotStore.getState().snapshots.length, 0);
  });

  // -------------------------------------------------------------------------
  // D76：快照卡上的「更新」与「复制」（一条快照 = 一个可复用的方案）
  const snapshotClipboard = [];
  Object.defineProperty(window.navigator, 'clipboard', {
    value: {
      writeText: (value) => {
        snapshotClipboard.push(value);
        return Promise.resolve();
      },
    },
    configurable: true,
  });

  await act(async () => {
    useSnapshotStore.setState({
      snapshots: [
        {
          id: 'snap-u1',
          name: '工作日方案',
          scope: 'global',
          weight: 250,
          modules: [{ sourceText: '旧的中文', colorId: 'red', capsules: [] }],
          copyText: 'old english.',
          createdAt: 111,
          updatedAt: 111,
        },
      ],
      loaded: true,
      loading: false,
      loadError: null,
      persisted: {},
    });
    useUiStore.getState().setLibraryView('snapshots');
    const first = useModuleStore.getState().modules[0];
    useModuleStore.getState().setSourceText(first.id, '新的中文');
    useModuleStore.getState().setTranslation(first.id, 'new english');
  });
  await flush();

  const snapItem = () => container.querySelector('[data-pf-snapshot-id="snap-u1"]');
  const snapButton = (label) => snapItem()?.querySelector(`[aria-label="${label}"]`);

  check('快照卡上有「更新 / 复制」两个图标按钮，按钮里没有任何文字（D76）', () => {
    assert.ok(snapItem(), '缺少快照卡片');
    const update = snapButton('更新为当前工作区');
    const copy = snapButton('复制译文');
    assert.ok(update, '缺少「更新」按钮');
    assert.ok(copy, '缺少「复制」按钮');
    assert.equal(snapItem().querySelectorAll('.pf-snap-item__btn svg').length, 2, '两个按钮都应当是图标');
    assert.equal(update.textContent.trim(), '', '图标按钮里不该有文字');
    assert.equal(copy.textContent.trim(), '', '图标按钮里不该有文字');
    // 标签在按钮左方：DOM 顺序必须是 name → tag → actions
    const tag = snapItem().querySelector('.pf-snap-item__tag');
    const actions = snapItem().querySelector('.pf-snap-item__actions');
    assert.equal(
      tag.compareDocumentPosition(actions) & window.Node.DOCUMENT_POSITION_FOLLOWING,
      window.Node.DOCUMENT_POSITION_FOLLOWING,
      '按钮组必须排在标签之后（标签在它们左方）',
    );
  });

  check('按按钮不会把整条快照拖起来（pointerdown 已拦住，D76）', () => {
    const makePointer = (type, x, y) =>
      new window.PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: x,
        clientY: y,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
      });
    act(() => {
      snapButton('更新为当前工作区').dispatchEvent(makePointer('pointerdown', 100, 100));
    });
    act(() => {
      window.dispatchEvent(makePointer('pointermove', 160, 160));
    });
    assert.equal(useUiStore.getState().drag, null, '按「更新」不该进入拖拽');
    act(() => {
      window.dispatchEvent(makePointer('pointerup', 160, 160));
    });
  });

  check('点「更新」先弹警告确认框，取消则快照一点不变（D76）', () => {
    act(() => {
      snapButton('更新为当前工作区').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    assert.ok(container.textContent.includes('更新快照'), '缺少确认框标题');
    assert.ok(container.textContent.includes('无法撤销'), '确认框必须写明覆盖不可撤销');
    act(() => {
      const cancel = [...container.querySelectorAll('.pf-modal__footer button')].find(
        (node) => node.textContent === '取消',
      );
      cancel?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    const snapshot = useSnapshotStore.getState().snapshots[0];
    assert.equal(snapshot.modules[0].sourceText, '旧的中文', '取消后快照内容不该变');
    assert.equal(snapshot.copyText, 'old english.', '取消后 copyText 不该变');
  });

  check('确认后：内容换成当前工作区，名称/权重/创建时间不变（D76）', () => {
    act(() => {
      snapButton('更新为当前工作区').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    act(() => {
      const confirm = [...container.querySelectorAll('.pf-modal__footer button')].find(
        (node) => node.textContent === '覆盖',
      );
      confirm?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    const snapshot = useSnapshotStore.getState().snapshots[0];
    assert.equal(snapshot.id, 'snap-u1', 'id 必须保留（原地更新，不是删了重建）');
    assert.equal(snapshot.modules[0].sourceText, '新的中文', '内容要换成当前工作区');
    assert.equal(snapshot.name, '工作日方案', '名称必须保留');
    assert.equal(snapshot.weight, 250, '权重必须保留');
    assert.equal(snapshot.createdAt, 111, '创建时间必须保留');
    assert.equal(snapshot.updatedAt > 111, true, '更新时间要刷新');
    assert.equal(snapshot.copyText.includes('new english'), true, 'copyText 要跟着换成新的');
    assert.equal(useUiStore.getState().toast?.text, '已更新为当前工作区');
  });

  await check('点「复制」把快照保存的全文写进剪贴板并提示（D76）', async () => {
    snapshotClipboard.length = 0;
    const expected = useSnapshotStore.getState().snapshots[0].copyText;
    await act(async () => {
      snapButton('复制译文').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    await flush();
    assert.deepEqual(snapshotClipboard, [expected], '剪贴板里应当是这条快照的全文');
    assert.equal(useUiStore.getState().toast?.text, '已复制快照译文');
    assert.equal(useUiStore.getState().toast?.tone, 'ok');
  });

  await check('旧快照没有 copyText 时：只提示、不写剪贴板（D76）', async () => {
    snapshotClipboard.length = 0;
    await act(async () => {
      useSnapshotStore.setState((state) => ({
        snapshots: state.snapshots.map((item) => ({ ...item, copyText: '' })),
      }));
    });
    await flush();
    await act(async () => {
      snapButton('复制译文').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    await flush();
    assert.equal(snapshotClipboard.length, 0, '没有译文时不该写剪贴板');
    assert.equal(useUiStore.getState().toast?.tone, 'warn');
  });

  // D68：全局快照的临时判定层
  await act(async () => {
    useSnapshotStore.setState({
      snapshots: [
        {
          id: 'snap-g',
          name: '全局方案',
          scope: 'global',
          weight: 100,
          modules: [{ sourceText: '', colorId: 'red', capsules: [] }],
          createdAt: 1,
          updatedAt: 1,
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

  check('拖全局快照时出现临时判定层，松手后移除（D68）', () => {
    // 本段在拖拽 helper 之前，自己造指针事件（避免 TDZ）
    const makePointer = (type, x, y) =>
      new window.PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: x,
        clientY: y,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
      });
    const item = document.querySelector('[data-pf-snapshot-id="snap-g"]');
    assert.ok(item, '缺少快照条目');

    act(() => {
      item.dispatchEvent(makePointer('pointerdown', 300, 300));
      window.dispatchEvent(makePointer('pointermove', 320, 320));
    });

    const layer = document.querySelector('[data-pf-snapshot-dropzone]');
    assert.ok(layer, '缺少临时判定层');
    assert.equal(layer.getAttribute('data-pf-output-area'), 'true');
    assert.ok(layer.textContent.includes('松手覆盖所有模块'));

    // 判定层返回给 elementFromPoint 时，落点必须是 output（不能被模块抢走）
    document.elementFromPoint = () => layer;
    act(() => {
      window.dispatchEvent(makePointer('pointermove', 330, 330));
    });
    assert.deepEqual(useUiStore.getState().drag.hover, { kind: 'output' });

    act(() => {
      window.dispatchEvent(makePointer('pointerup', 330, 330));
    });
    assert.equal(document.querySelector('[data-pf-snapshot-dropzone]'), null, '松手后判定层必须移除');
    assert.equal(useModuleStore.getState().modules[0].sourceText, '', '全局快照应已覆盖');
  });

  await check('同名不同色是两个组：总列表两块砖都在，筛选后各归各的', async () => {
    await act(async () => {
      usePresetStore.setState({
        presets: [
          {
            id: 'b1',
            label: '蓝甲',
            english: 'b',
            weight: 300,
            colorId: 'blue',
            folder: '作品集',
            createdAt: 1,
            updatedAt: 1,
          },
          {
            id: 'p1',
            label: '粉甲',
            english: 'p',
            weight: 200,
            colorId: 'pink',
            folder: '作品集',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        loaded: true,
        persisted: {},
      });
      usePresetFolderStore.setState({
        folders: [
          { name: '作品集', colorId: 'blue', expanded: false },
          { name: '作品集', colorId: 'pink', expanded: false },
        ],
        loaded: true,
        persisted: '[]',
      });
      useUiStore.setState({
        libraryView: 'presets',
        presetFilterColorIds: [],
        presetSearchKeyword: '',
        libraryPage: 1,
      });
    });
    await flush();

    const tiles = [...container.querySelectorAll('[data-pf-group-name="作品集"]')];
    assert.equal(tiles.length, 2, '同名不同色必须出现两块砖（靠前置色块区分）');
    assert.deepEqual(
      tiles.map((tile) => tile.getAttribute('data-pf-group-color')).sort(),
      ['blue', 'pink'],
    );

    // 切到粉色筛选：只剩粉色那一块，蓝色成员不出现
    await act(async () => {
      useUiStore.setState({ presetFilterColorIds: ['pink'], libraryPage: 1 });
    });
    await flush();
    const pinkTiles = [...container.querySelectorAll('[data-pf-group-name="作品集"]')];
    assert.equal(pinkTiles.length, 1, '筛选后只该剩自己那一色的组');
    assert.equal(pinkTiles[0].getAttribute('data-pf-group-color'), 'pink');
    assert.equal(container.innerHTML.includes('蓝甲'), false, '蓝色成员不该在粉色筛选下出现');
  });

  // 收尾：清掉颜色筛选，免得后面的拖拽用例被过滤掉
  await act(async () => {
    useUiStore.getState().clearPresetFilter();
    useUiStore.getState().setLibraryView('presets');
  });
  await flush();

  section('分页（D66 / D86）：固定条数（默认 100）、翻页与搜索重置');

  await act(async () => {
    // 105 条 + 默认 100 条一页 = 两页（第 2 页正好 5 条），与下面的断言对应
    const many = Array.from({ length: 105 }, (_, index) => ({
      id: `p-${index}`,
      label: `预设${index}`,
      english: 'x',
      weight: 100,
      colorId: 'red',
      createdAt: 1,
      updatedAt: 1,
    }));
    usePresetStore.setState({
      presets: many,
      loaded: true,
      loading: false,
      loadError: null,
      persisted: {},
    });
    useUiStore.getState().setLibraryView('presets');
    useUiStore.getState().setPresetSearchKeyword('');
    useUiStore.getState().setLibraryPage(1);
  });
  await flush();

  check('第 1 页只渲染 100 条（设置里的默认分页阈值），并显示分页条', () => {
    // D86：分页阈值默认 100（原来是写死的 300），四个库统一
    assert.equal(container.querySelectorAll('.pf-preset-item').length, 100);
    assert.ok(container.querySelector('.pf-pager'), '缺少分页条');
    assert.ok(container.querySelector('.pf-pager__info').textContent.includes('1 / 2'));
  });

  await act(async () => {
    const next = [...container.querySelectorAll('.pf-pager button')].find(
      (node) => node.textContent === '下一页',
    );
    next?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await flush();

  check('翻到第 2 页只剩 5 条，页码同步', () => {
    assert.equal(container.querySelectorAll('.pf-preset-item').length, 5);
    assert.ok(container.querySelector('.pf-pager__info').textContent.includes('2 / 2'));
  });

  check('分页条与胶囊列表之间留出空隙（D89，CSS 契约）', () => {
    // 用户实测：最后一行胶囊贴着分页条，看着像被压住/切掉一半。
    // 口径：`.pf-preset-list` 底部 8px + `.pf-pager` 顶部 8px = 合计 16px。
    const css = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'styles', 'preset.css'),
      'utf8',
    );
    const pagerRule = css.match(/\.pf-pager\s*\{[^}]*\}/)?.[0] ?? '';
    assert.ok(
      /margin-top:\s*var\(--pf-gap-sm\)/.test(pagerRule),
      `分页条缺少顶部空隙：${pagerRule}`,
    );
    const listRule = css.match(/\.pf-preset-list\s*\{[^}]*\}/)?.[0] ?? '';
    assert.ok(
      /padding:\s*0\s+0\s+var\(--pf-gap-sm\)/.test(listRule),
      `胶囊列表缺少底部留白：${listRule}`,
    );
    // 8 + 8 = 16px：与 --pf-gap-lg 对齐，肉眼能明确看出是一条间隔
    assert.equal(8 + 8, 16);
  });

  await act(async () => {
    useUiStore.getState().setPresetSearchKeyword('预设1');
  });
  await flush();

  check('搜索会回到第 1 页', () => {
    assert.equal(useUiStore.getState().libraryPage, 1);
  });

  await act(async () => {
    usePresetStore.getState().replaceAll([]);
    useUiStore.getState().setPresetSearchKeyword('');
  });
  await flush();

  // -------------------------------------------------------------------------
  section('模块的中文编辑器：打字要进 Store');

  check('中文源内容可以打字并写回 Store', () => {
    const editor = container.querySelector('.pf-source__input');
    assert.ok(editor, '找不到中文源内容编辑器');

    act(() => {
      editor.textContent = '把这段话改写得更礼貌';
      editor.dispatchEvent(new window.Event('input', { bubbles: true }));
    });

    // 编辑器是 contenteditable，React 不托管它的子节点，值经序列化后进 Store
    assert.ok(
      useModuleStore.getState().modules.some((module) => module.sourceText === '把这段话改写得更礼貌'),
      '内容没有写回 Store',
    );
  });

  check('单模块字数上限：打到上限就硬挡住，超出的部分进不了 Store', () => {
    const editor = container.querySelector('.pf-source__input');
    assert.ok(editor, '找不到中文源内容编辑器');
    const selectedId = useModuleStore.getState().selectedModuleId;
    const overLimit = '女'.repeat(MODULE_SOURCE_MAX_LENGTH + 137);

    act(() => {
      editor.textContent = overLimit;
      editor.dispatchEvent(new window.Event('input', { bubbles: true }));
    });

    const module = useModuleStore.getState().modules.find((item) => item.id === selectedId);
    assert.equal(
      module.sourceText.length,
      MODULE_SOURCE_MAX_LENGTH,
      `超限内容必须被截到 ${MODULE_SOURCE_MAX_LENGTH} 字，实际 ${module.sourceText.length}`,
    );
    // DOM 也要一起改回去 —— 只改 Store 会出现「界面上有 1137 字、Store 里只有 1000 字」
    assert.equal(
      editor.textContent.length,
      MODULE_SOURCE_MAX_LENGTH,
      '编辑器 DOM 必须与 Store 一致（否则下一次输入会把超限内容又写回来）',
    );
    // 必须告诉用户「被挡住了」，否则就是无声吞字
    assert.equal(useUiStore.getState().toast?.tone, 'warn', '截断时必须给一条警告提示');
    assert.ok(
      useUiStore.getState().toast?.text.includes(String(MODULE_SOURCE_MAX_LENGTH)),
      `提示里要说清上限：${useUiStore.getState().toast?.text}`,
    );
  });

  check('没超限时不做任何截断（正常打字路径不受影响）', () => {
    const editor = container.querySelector('.pf-source__input');
    const selectedId = useModuleStore.getState().selectedModuleId;
    const within = '短'.repeat(20);

    act(() => {
      editor.textContent = within;
      editor.dispatchEvent(new window.Event('input', { bubbles: true }));
    });

    const module = useModuleStore.getState().modules.find((item) => item.id === selectedId);
    assert.equal(module.sourceText, within, '没超限的内容必须原样保存');
    assert.equal(editor.textContent, within);
  });

  // -------------------------------------------------------------------------
  section('三栏布局：两条分隔条与单排高度条都要真的能拖');

  /** jsdom 里所有 rect 都是 0，按需伪造一个 */
  function fakeRect({ left = 0, top = 0, width = 400, height = 96 } = {}) {
    return {
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
      toJSON() {
        return {};
      },
    };
  }

  const pointer = (type, x, y) =>
    new (window.PointerEvent ?? window.MouseEvent)(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
    });

  check('水平分隔条上下拖动改变输入框高度', () => {
    const splitter = container.querySelector('.pf-splitter--y');
    assert.ok(splitter, '找不到水平分隔条');

    // measure = 容器底边 - 指针 Y，因此伪造左列底边为 800
    splitter.parentElement.getBoundingClientRect = () => fakeRect({ height: 800 });

    act(() => {
      splitter.dispatchEvent(pointer('pointerdown', 400, 620));
      window.dispatchEvent(pointer('pointermove', 400, 500));
    });
    assert.equal(useUiStore.getState().inputPaneHeight, 300, '拖动没有改变输入框高度');
    assert.equal(
      container.querySelector('.pf-workbench').style.getPropertyValue('--pf-input-height'),
      '300px',
      '行内变量没有跟着更新',
    );

    act(() => {
      window.dispatchEvent(pointer('pointerup', 400, 500));
    });
  });

  check('垂直分隔条左右拖动改变预设库宽度', () => {
    const splitter = container.querySelector('.pf-splitter--x');
    assert.ok(splitter, '找不到垂直分隔条');

    splitter.parentElement.getBoundingClientRect = () => fakeRect({ width: 1400 });

    act(() => {
      splitter.dispatchEvent(pointer('pointerdown', 1000, 400));
      window.dispatchEvent(pointer('pointermove', 1000, 400));
    });
    // measure = 容器右边 - 指针 X - 8（工作区右内边距）
    assert.equal(useUiStore.getState().presetPanelWidth, 392, '拖动没有改变预设库宽度');

    act(() => {
      window.dispatchEvent(pointer('pointerup', 1000, 400));
    });
  });

  check('模块底部细拖拽条单独调整这一排的高度（下限 56）', () => {
    const resize = container.querySelector('.pf-module__resize');
    assert.ok(resize, '找不到模块高度拖拽条');
    const row = resize.parentElement;
    assert.equal(row.dataset.pfModuleId, useModuleStore.getState().modules[0].id);

    row.getBoundingClientRect = () => fakeRect({ height: 96 });
    assert.equal(useModuleStore.getState().modules[0].outputHeight, 56, '初始应当是 56px');

    act(() => {
      resize.dispatchEvent(pointer('pointerdown', 10, 100));
      window.dispatchEvent(pointer('pointermove', 10, 140));
    });
    // 起点高度取自这一排当前的矩形（伪造为 96），往下拖 40
    assert.equal(useModuleStore.getState().modules[0].outputHeight, 136, '高度没有跟着指针');

    // 往上拖到极小 → 夹在 56
    act(() => {
      window.dispatchEvent(pointer('pointermove', 10, 0));
    });
    assert.equal(useModuleStore.getState().modules[0].outputHeight, 56, '没有夹到最小高度');

    act(() => {
      window.dispatchEvent(pointer('pointerup', 10, 0));
    });
  });

  // -------------------------------------------------------------------------
  section('指针拖拽：彻底不用 HTML5 拖拽，落点靠 elementFromPoint');

  const presetFixtures = [
    { id: 'pre_cold', label: '冷峻文风', english: 'in a cold, restrained tone', weight: 100, colorId: 'blue' },
    { id: 'pre_biz', label: '商务正式', english: 'a formal business tone', weight: 100, colorId: 'green' },
  ];

  await act(async () => {
    usePresetStore.setState({ presets: presetFixtures.map((p) => ({ ...p })), loaded: true });
    useModuleStore.getState().clearModule(useModuleStore.getState().modules[0].id);
  });
  await flush();

  /** 拖一次：按在 source 上，移到 (x,y)，再松手 */
  function dragFrom(source, points) {
    act(() => {
      source.dispatchEvent(pointer('pointerdown', 40, 40));
    });
    for (const [x, y] of points) {
      act(() => {
        window.dispatchEvent(pointer('pointermove', x, y));
      });
    }
  }

  function releaseAt(x, y) {
    act(() => {
      window.dispatchEvent(pointer('pointerup', x, y));
    });
  }

  check('移动不足阈值只当点击，不进入拖拽', () => {
    const item = container.querySelector('.pf-preset-item');
    assert.ok(item, '找不到预设条目');

    act(() => {
      item.dispatchEvent(pointer('pointerdown', 100, 100));
      window.dispatchEvent(pointer('pointermove', 102, 101)); // 距离 < 6
    });
    assert.equal(useUiStore.getState().drag, null, '不该进入拖拽');
    assert.equal(document.querySelector('.pf-ghost'), null, '不该出现幽灵元素');

    act(() => {
      window.dispatchEvent(pointer('pointerup', 102, 101));
    });
  });

  check('拖起来后幽灵元素挂在 body 上，并且落点写进 Store', () => {
    const item = container.querySelector('.pf-preset-item');
    const moduleEl = container.querySelector('[data-pf-module-id]');
    moduleEl.getBoundingClientRect = () => fakeRect({ width: 400 });
    document.elementFromPoint = () => moduleEl;

    dragFrom(item, [[120, 120]]);

    const ghost = document.querySelector('.pf-ghost');
    assert.ok(ghost, '拖拽中应出现幽灵元素');
    assert.equal(ghost.parentElement, document.body, '幽灵元素必须挂在 body 上（避免被祖先裁掉）');
    assert.ok(ghost.textContent.includes('冷峻文风'), '幽灵元素应显示拖的是什么');
    assert.equal(document.body.style.cursor, 'grabbing', '光标应提示可放置');

    const drag = useUiStore.getState().drag;
    assert.ok(drag, '拖拽状态没写进 Store');
    assert.equal(drag.source.kind, 'preset');
    // 需求 6：落点里不再有左右半区
    assert.deepEqual(drag.hover, { kind: 'module', moduleId: moduleEl.dataset.pfModuleId });

    // 松手动作在下一个断言里检查，这里先不松手
  });

  check('悬停模块时整排高亮，高亮色取该预设的归属色（需求 3）', () => {
    const row = container.querySelector('[data-pf-module-id]');
    assert.ok(row.className.includes('pf-module--drop'), '整排应当高亮');
    assert.ok(row.className.includes('pf-module--danger') === false, '拖预设不该是危险态');

    const hint = container.querySelector('.pf-module__drop-hint');
    assert.ok(hint, '缺少落点提示');
    assert.ok(hint.textContent.includes('松手插入到胶囊末尾'), '提示文案应为「松手插入到胶囊末尾」');

    // 行内变量里应当带着被拖预设的颜色（blue），而不是模块自己的红色
    // React 序列化 style 时会在冒号后加空格，比较前先去掉空白
    const style = (row.getAttribute('style') ?? '').replace(/\s+/g, '');
    assert.ok(style.includes('--pf-drop-color:#74c0fc'), `高亮色不是预设的蓝色：${style}`);

    // 需求 6：不该再出现左右半区分区
    assert.equal(container.querySelector('.pf-half'), null, '不该再有半区高亮');
    assert.equal(container.querySelector('.pf-half--left'), null);

    releaseAt(120, 120);
  });

  check('预设落到模块 → 胶囊插入（D79：排在已有胶囊之后，仍在文字之前）', () => {
    const module = useModuleStore.getState().modules[0];
    assert.equal(module.capsules.length, 1, '应当插入了一个胶囊');
    assert.equal(module.capsules[0].label, '冷峻文风');
    assert.equal(module.capsules[0].english, 'in a cold, restrained tone', '英文内容要快照进胶囊');
    assert.equal(module.capsules[0].colorId, 'blue', '胶囊要继承预设的归属色（需求 3）');
    assert.ok(module.sourceText.startsWith('[[cap:'), '锚点仍然在内容的开头区域');
    assert.equal(useUiStore.getState().drag, null, '松手后拖拽状态要清干净');
    assert.equal(document.body.style.cursor, '', '光标要恢复');
    assert.equal(document.querySelector('.pf-ghost'), null, '幽灵元素要移除');
  });

  check('再拖一条预设进来：排在**第一条之后**（先拖入的在前），且不多出空格', () => {
    const item = container.querySelectorAll('.pf-preset-item')[1];
    const moduleEl = container.querySelector('[data-pf-module-id]');
    document.elementFromPoint = () => moduleEl;

    dragFrom(item, [[320, 120]]);
    releaseAt(320, 120);

    const module = useModuleStore.getState().modules[0];
    assert.equal(module.capsules.length, 2);
    assert.equal(module.capsules[1].label, '商务正式');
    assert.equal(module.capsules[1].colorId, 'green', '第二条胶囊继承它的预设色');
    // D79：两次拖入的锚点紧挨着，按拖入顺序排列 —— 先 A 后 B
    assert.equal(
      module.sourceText.startsWith(
        `[[cap:${module.capsules[0].id}]][[cap:${module.capsules[1].id}]]`,
      ),
      true,
      '先拖入的胶囊应当在前，两颗锚点之间不该有空格',
    );
    assert.equal(/\s{2,}/.test(module.sourceText), false, '源内容里不该出现连续空格');
  });

  check('落到不可放置的地方 → 动作取消，内容不变', () => {
    const before = useModuleStore.getState().modules[0].sourceText;
    const item = container.querySelector('.pf-preset-item');

    document.elementFromPoint = () => null; // 空白处
    dragFrom(item, [[500, 500]]);
    assert.equal(useUiStore.getState().drag.hover, null);
    assert.equal(document.body.style.cursor, 'no-drop', '不可放置时用禁止光标');
    releaseAt(500, 500);

    assert.equal(useModuleStore.getState().modules[0].sourceText, before, '内容不该变');
    assert.equal(useModuleStore.getState().modules[0].capsules.length, 2);
  });

  check('拖拽中按 Esc 取消', () => {
    const item = container.querySelector('.pf-preset-item');
    const moduleEl = container.querySelector('[data-pf-module-id]');
    document.elementFromPoint = () => moduleEl;

    dragFrom(item, [[120, 120]]);
    assert.ok(useUiStore.getState().drag, '应当处于拖拽中');

    act(() => {
      window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    assert.equal(useUiStore.getState().drag, null, 'Esc 应当取消拖拽');
    assert.equal(document.querySelector('.pf-ghost'), null);
  });

  check('模块枢拖到预设库 → 打开「保存为预设」对话框', () => {
    const handle = container.querySelector('.pf-hub');
    const panel = container.querySelector('[data-pf-preset-panel]');
    assert.ok(handle && panel);

    document.elementFromPoint = () => panel;
    dragFrom(handle, [[600, 300]]);
    assert.deepEqual(useUiStore.getState().drag.hover, { kind: 'preset-panel' });
    assert.ok(container.querySelector('.pf-preset__drop'), '预设库应亮起磨砂落点提示');
    assert.ok(
      container.querySelector('.pf-preset__drop').textContent.includes('松手保存为预设'),
      '缺少中文提示',
    );
    releaseAt(600, 300);

    assert.equal(
      useUiStore.getState().savePresetModuleId,
      useModuleStore.getState().modules[0].id,
      '没有打开保存对话框',
    );

    act(() => {
      useUiStore.getState().closeSavePresetDialog();
    });
  });

  check('模块枢拖回自身 → 只清文字、保留胶囊（D61）', () => {
    const moduleId = useModuleStore.getState().modules[0].id;
    // 夹具：一排里既有手打文字、也有一个胶囊，还有译文
    act(() => {
      useModuleStore.getState().setSourceText(moduleId, '女孩，长头发，微笑');
      useModuleStore.getState().insertCapsule(
        moduleId,
        { presetId: 'p-d61', label: '千早爱音', english: 'chihaya anon', colorId: 'red' },
        'after-capsules',
      );
      useModuleStore.getState().setTranslation(moduleId, 'chihaya anon, long hair');
      useModuleStore.getState().setStatus(moduleId, 'done');
    });
    const capsuleId = useModuleStore.getState().modules[0].capsules[0].id;

    const handle = container.querySelector('.pf-hub');
    const moduleEl = container.querySelector('[data-pf-module-id]');

    document.elementFromPoint = () => moduleEl;
    dragFrom(handle, [[120, 120]]);

    assert.equal(container.querySelector('.pf-module--danger') !== null, true, '应出现危险色高亮');
    assert.ok(
      container.querySelector('.pf-module__danger-hint').textContent.includes('松手清空文字'),
      '落点提示必须说明只清文字',
    );
    releaseAt(120, 120);

    const module = useModuleStore.getState().modules.find((item) => item.id === moduleId);
    assert.equal(module.sourceText, `[[cap:${capsuleId}]]`, '源内容应当只剩胶囊锚点');
    assert.equal(module.capsules.length, 1, '胶囊必须保留');
    assert.equal(module.translation, '', '没有文字了，译文应被清空');
  });

  check('模块枢拖到别的模块 → 取消，两排都不受影响', () => {
    const modules = useModuleStore.getState().modules;
    useModuleStore.getState().setSourceText(modules[1].id, '第二排的内容');

    const handle = container.querySelectorAll('.pf-hub')[0];
    const otherRow = container.querySelectorAll('[data-pf-module-id]')[1];
    document.elementFromPoint = () => otherRow;

    dragFrom(handle, [[120, 120]]);
    releaseAt(120, 120);

    assert.equal(useModuleStore.getState().modules[1].sourceText, '第二排的内容', '不该清空别的排');
  });

  check('CSS 里幽灵元素是 9999 层且不吃指针事件', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles', 'layout.css'), 'utf8');
    const ghostRule = css.slice(css.indexOf('.pf-ghost {'), css.indexOf('.pf-ghost__dot'));
    assert.ok(ghostRule.includes('z-index: 9999'), '幽灵元素层级不够');
    assert.ok(
      ghostRule.includes('pointer-events: none'),
      '幽灵元素必须不吃指针事件，否则 elementFromPoint 永远命中它自己',
    );
    const presetRule = css.slice(css.indexOf('.pf-preset__drop {'), css.indexOf('.pf-preset__drop-hint'));
    assert.ok(presetRule.includes('backdrop-filter: blur(8px)'), '落点提示缺少磨砂效果');
  });

  check('模块枢双击复制（不再依赖 dblclick 事件）', async () => {
    act(() => {
      // 夹具自洽：有译文就得有源内容
      useModuleStore.getState().setSourceText(useModuleStore.getState().modules[0].id, '礼貌语气');
      useModuleStore.getState().setTranslation(useModuleStore.getState().modules[0].id, 'polite tone');
    });

    const handle = container.querySelector('.pf-hub');
    act(() => {
      handle.dispatchEvent(pointer('pointerdown', 100, 100));
      window.dispatchEvent(pointer('pointerup', 100, 100));
      handle.dispatchEvent(pointer('pointerdown', 101, 101));
      window.dispatchEvent(pointer('pointerup', 101, 101));
    });

    // 复制是异步的（剪贴板 API 返回 Promise），提示条要等一个微任务
    await flush();

    const toast = useUiStore.getState().toast;
    assert.ok(toast, '双击后应当给出提示（复制成功或复制失败的说明）');
  });

  // -------------------------------------------------------------------------
  section('预设搜索：输入即过滤');

  check('搜索框占位提示是「搜索预设名称」', () => {
    const input = container.querySelector('.pf-search__input');
    assert.ok(input, '找不到搜索框');
    assert.equal(input.placeholder, '搜索预设名称');
  });

  check('按中文命名过滤，输入即生效', () => {
    const input = container.querySelector('.pf-search__input');
    act(() => {
      typeInto(input, '冷');
    });
    const items = container.querySelectorAll('.pf-preset-item');
    assert.equal(items.length, 1, `应当只剩 1 条，实际 ${items.length} 条`);
    assert.ok(items[0].textContent.includes('冷峻文风'));
  });

  check('英文内容也算命中（附加匹配项，不额外提示）', () => {
    const input = container.querySelector('.pf-search__input');
    act(() => {
      typeInto(input, 'business');
    });
    const items = container.querySelectorAll('.pf-preset-item');
    assert.equal(items.length, 1);
    assert.ok(items[0].textContent.includes('商务正式'));
  });

  check('大小写不敏感', () => {
    const input = container.querySelector('.pf-search__input');
    act(() => {
      typeInto(input, 'COLD');
    });
    assert.equal(container.querySelectorAll('.pf-preset-item').length, 1);
  });

  check('清空关键字后全部回来', () => {
    const input = container.querySelector('.pf-search__input');
    act(() => {
      typeInto(input, '');
    });
    assert.equal(container.querySelectorAll('.pf-preset-item').length, presetFixtures.length);
  });

  check('命中不到时列表为空，不报错', () => {
    const input = container.querySelector('.pf-search__input');
    act(() => {
      typeInto(input, '这条不可能命中');
    });
    assert.equal(container.querySelectorAll('.pf-preset-item').length, 0);
    act(() => {
      typeInto(input, '');
    });
  });

  // -------------------------------------------------------------------------
  section('快捷键：Ctrl/Alt + ↑↓ 切换选中模块');

  function pressArrow(key, options = {}) {
    const event = new window.KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      ...options,
    });
    act(() => {
      window.dispatchEvent(event);
    });
    return event;
  }

  check('Ctrl+↓ 切到下一排，且 preventDefault 掉了浏览器默认行为', () => {
    const modules = useModuleStore.getState().modules;
    useModuleStore.getState().selectModule(modules[0].id);

    const event = pressArrow('ArrowDown', { ctrlKey: true });
    assert.equal(
      useModuleStore.getState().selectedModuleId,
      modules[1].id,
      '没有切到下一排',
    );
    assert.equal(event.defaultPrevented, true, '必须 preventDefault（阻止滚动与候选翻页）');
  });

  check('Ctrl+↑ 切回上一排', () => {
    const modules = useModuleStore.getState().modules;
    pressArrow('ArrowUp', { ctrlKey: true });
    assert.equal(useModuleStore.getState().selectedModuleId, modules[0].id);
  });

  check('Alt+↑ / Alt+↓ 同样生效（备用键）', () => {
    const modules = useModuleStore.getState().modules;
    pressArrow('ArrowDown', { altKey: true });
    assert.equal(useModuleStore.getState().selectedModuleId, modules[1].id, 'Alt+↓ 没生效');
    pressArrow('ArrowUp', { altKey: true });
    assert.equal(useModuleStore.getState().selectedModuleId, modules[0].id, 'Alt+↑ 没生效');
  });

  check('首尾环绕：在最后一排按下一排回到第一排', () => {
    const modules = useModuleStore.getState().modules;
    useModuleStore.getState().selectModule(modules[modules.length - 1].id);
    pressArrow('ArrowDown', { ctrlKey: true });
    assert.equal(useModuleStore.getState().selectedModuleId, modules[0].id, '没有环绕');
  });

  check('输入框聚焦时快捷键仍然生效，并且切换后焦点仍在输入框', () => {
    const modules = useModuleStore.getState().modules;
    const editor = container.querySelector('.pf-source__input');
    assert.ok(editor, '找不到输入框');

    useModuleStore.getState().selectModule(modules[0].id);
    act(() => {
      editor.focus();
    });
    assert.equal(document.activeElement, editor, '前置条件：输入框先获得焦点');

    pressArrow('ArrowDown', { ctrlKey: true });
    assert.equal(useModuleStore.getState().selectedModuleId, modules[1].id, '聚焦时没生效');
    assert.equal(document.activeElement, editor, '切换后焦点应仍在输入框');
  });

  check('不带修饰键的 ↑↓ 不切换模块（留给输入法翻页与光标移动）', () => {
    const modules = useModuleStore.getState().modules;
    useModuleStore.getState().selectModule(modules[0].id);
    const event = pressArrow('ArrowDown');
    assert.equal(useModuleStore.getState().selectedModuleId, modules[0].id);
    assert.equal(event.defaultPrevented, false, '不该拦下普通的方向键');
  });

  // -------------------------------------------------------------------------
  section('预设右键菜单：权重 / 编辑内容 / 删除预设');

  // 注意：菜单的渲染发生在 store 更新之后的**异步** flush 里
  // （实测：同步后 0 个、await flush() 之后 1 个），
  // 因此每个断言之前都必须先 await flush()，否则会误判成「菜单没弹出来」。
  async function openMenuOnFirstPreset() {
    const item = container.querySelector('.pf-preset-item');
    assert.ok(item, '找不到预设条目');
    act(() => {
      item.dispatchEvent(
        new window.MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 120,
          clientY: 120,
        }),
      );
    });
    await flush();
    return document.querySelector('.pf-menu');
  }

  let menuNode = await openMenuOnFirstPreset();

  check('右键弹出菜单，含权重、编辑内容、删除预设，且挂在 body 上', () => {
    assert.ok(menuNode, '没有打开菜单');
    assert.equal(menuNode.parentElement, document.body, '菜单要挂到 body，否则会被列表裁掉');
    assert.ok(menuNode.textContent.includes('权重'), '缺少权重');
    assert.ok(menuNode.textContent.includes('编辑内容'), '缺少编辑内容');
    assert.ok(menuNode.textContent.includes('删除预设'), '缺少删除预设');
  });

  const weightBefore = usePresetStore.getState().presets[0].weight;
  act(() => {
    document
      .querySelectorAll('.pf-menu__step')[1]
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await flush();

  check('菜单里的「+」把权重加 10，菜单上的数字跟着变', () => {
    assert.equal(usePresetStore.getState().presets[0].weight, weightBefore + 10, '权重没加上');
    assert.ok(
      (document.querySelector('.pf-menu')?.textContent ?? '').includes(String(weightBefore + 10)),
      '菜单上的权重数字没有跟着更新',
    );
  });

  act(() => {
    document
      .querySelectorAll('.pf-menu__step')[0]
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await flush();

  check('菜单里的「−」把权重减 10', () => {
    assert.equal(usePresetStore.getState().presets[0].weight, weightBefore);
  });

  act(() => {
    window.dispatchEvent(pointer('pointerdown', 900, 900));
  });
  await flush();

  check('点菜单外面关闭菜单', () => {
    assert.equal(document.querySelector('.pf-menu'), null, '菜单没有关闭');
  });

  menuNode = await openMenuOnFirstPreset();
  assert.ok(menuNode, '菜单没打开，后续断言无法继续');
  const editButton = Array.from(menuNode.querySelectorAll('.pf-menu__item')).find((button) =>
    button.textContent.includes('编辑内容'),
  );
  act(() => {
    editButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await flush();

  check('菜单点「编辑内容」打开预设编辑弹窗', () => {
    assert.equal(document.querySelector('.pf-menu'), null, '点了菜单项后菜单应当关闭');
    const dialog = container.querySelector('.pf-modal');
    assert.ok(dialog, '没有打开编辑弹窗');
    assert.ok(dialog.textContent.includes('编辑预设'), '打开的应当是本条预设的编辑弹窗');
  });

  act(() => {
    buttonByText('取消')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await flush();

  const presetCountBefore = usePresetStore.getState().presets.length;
  menuNode = await openMenuOnFirstPreset();
  assert.ok(menuNode, '菜单没打开，后续断言无法继续');
  const deleteButton = Array.from(menuNode.querySelectorAll('.pf-menu__item')).find((button) =>
    button.textContent.includes('删除预设'),
  );
  act(() => {
    deleteButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await flush();

  check('菜单点「删除预设」先弹二次确认，此时还没删', () => {
    assert.ok(container.textContent.includes('确定要删除'), '缺少二次确认');
    assert.equal(
      usePresetStore.getState().presets.length,
      presetCountBefore,
      '还没确认就不该删',
    );
  });

  // 二次确认里的「删除」要从弹窗里找：左侧工具条上也有一个同名的「删除」按钮
  const confirmDialog = container.querySelector('.pf-modal');
  const confirmButton = Array.from(confirmDialog.querySelectorAll('button')).find(
    (button) => button.textContent.trim() === '删除',
  );
  act(() => {
    confirmButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await flush();

  check('确认后才真的删掉这一条', () => {
    assert.equal(usePresetStore.getState().presets.length, presetCountBefore - 1);
  });

  await act(async () => {
    usePresetStore.setState({ presets: presetFixtures.map((p) => ({ ...p })) });
  });
  await flush();

  // -------------------------------------------------------------------------
  section('拖模块枢存预设：归属色默认继承模块颜色（需求 3）');

  const saveModuleId = useModuleStore.getState().modules[0].id;
  const saveModuleColor = useModuleStore.getState().modules[0].colorId;
  await act(async () => {
    // 夹具自洽：有译文就得有源内容，否则实时翻译会按「空内容」清掉译文
    useModuleStore.getState().setSourceText(saveModuleId, '礼貌语气');
    useModuleStore.getState().setTranslation(saveModuleId, 'polite tone');
    useUiStore.getState().openSavePresetDialog(saveModuleId);
  });
  await flush();

  check('保存对话框预填的颜色是当前模块的颜色', () => {
    const checked = container.querySelector('[role="radio"][aria-checked="true"]');
    assert.ok(checked, '找不到被选中的归属颜色');
    const { colorHex } = require(path.join(OUT, 'constants/colors.js'));
    const style = (checked.getAttribute('style') ?? '').replace(/\s+/g, '');
    assert.ok(
      style.includes(colorHex(saveModuleColor)),
      `预填颜色不是模块色 ${saveModuleColor}：${style}`,
    );
  });

  /** 关掉再打开，让对话框按新的模块内容重新挂载（名字是挂载时的预填值） */
  const reopenSaveDialogFor = async (sourceText) => {
    await act(async () => {
      useUiStore.getState().closeSavePresetDialog();
    });
    await flush();
    await act(async () => {
      useModuleStore.getState().setSourceText(saveModuleId, sourceText);
      useUiStore.getState().openSavePresetDialog(saveModuleId);
    });
    await flush();
    return controlByLabel('中文命名');
  };

  await check('模块枢存预设：名字自动取输入框里的中文（长句截到 10 个字）', async () => {
    const input = await reopenSaveDialogFor('千早爱音来自MyGO是一个非常可爱的女孩');
    assert.equal(input.value, '千早爱音来自MyGO', input.value);
  });

  await check('模块枢存预设：遇到逗号只取前一段', async () => {
    const input = await reopenSaveDialogFor('千早爱音，来自MyGO');
    assert.equal(input.value, '千早爱音', input.value);
    const englishComma = await reopenSaveDialogFor('千早爱音, 来自MyGO');
    assert.equal(englishComma.value, '千早爱音', englishComma.value);
  });

  await check('模块枢存预设：只有胶囊、没有中文时回落默认名「胶囊 N」', async () => {
    await act(async () => {
      useUiStore.getState().closeSavePresetDialog();
    });
    await flush();
    await act(async () => {
      useModuleStore.getState().clearModule(saveModuleId);
      useModuleStore.getState().insertCapsule(
        saveModuleId,
        { presetId: 'p-d84', label: '千早爱音', english: 'chihaya anon', colorId: 'red' },
        'after-capsules',
      );
      useUiStore.getState().openSavePresetDialog(saveModuleId);
    });
    await flush();
    const { nextPresetLabel } = require(path.join(OUT, 'utils/presetLabel.js'));
    const expected = nextPresetLabel(usePresetStore.getState().presets);
    assert.equal(controlByLabel('中文命名').value, expected, `应当回落成 ${expected}`);
  });

  await act(async () => {
    useUiStore.getState().closeSavePresetDialog();
  });

  // -------------------------------------------------------------------------
  section('输出模块：展示看中文名，复制才是英文（需求 1、2）');

  const displayModuleId = useModuleStore.getState().modules[0].id;
  await act(async () => {
    useModuleStore.getState().clearModule(displayModuleId);
    // 夹具必须自洽：有译文就必须有源内容，否则实时翻译会按「空内容」把译文清掉
    useModuleStore.getState().setSourceText(displayModuleId, '千早爱音 长头发，粉头发，微笑');
    useModuleStore.getState().setTranslation(displayModuleId, 'Long hair, pink hair, smiling');
    useModuleStore.getState().insertCapsule(
      displayModuleId,
      {
        presetId: 'pre_cold',
        label: '千早爱音',
        english: 'Chihaya Anon',
        colorId: 'pink',
      },
      'after-capsules',
    );
  });
  await flush();

  check('模块行显示「胶囊中文名 + 译文」，绝不展开术语英文', () => {
    const row = container.querySelector(`[data-pf-module-id="${displayModuleId}"]`);
    assert.ok(row, '找不到那一排');
    assert.ok(row.textContent.includes('千早爱音'), '缺少胶囊中文名');
    assert.ok(row.textContent.includes('Long hair, pink hair, smiling'), '缺少译文');
    assert.equal(row.textContent.includes('Chihaya'), false, '术语英文不该出现在展示里');
  });

  check('复制内容才是「术语英文, 译文」（唯一出口 plainEnglishOf）', () => {
    const { plainEnglishOf } = require(path.join(OUT, 'utils/moduleText.js'));
    const module = useModuleStore.getState().modules.find((item) => item.id === displayModuleId);
    assert.equal(plainEnglishOf(module), 'Chihaya Anon, Long hair, pink hair, smiling');
  });

  check('胶囊上没有常驻删除按钮，而是悬停整颗变 X', () => {
    const chip = container.querySelector(
      `[data-pf-module-id="${displayModuleId}"] .pf-capsule`,
    );
    assert.ok(chip, '找不到胶囊');
    assert.equal(chip.querySelectorAll('.pf-capsule__remove').length, 0);
    assert.ok(chip.querySelector('.pf-capsule__cross'), '缺少悬停用的 X');
    assert.ok(chip.querySelector('.pf-capsule__hit'), '整颗胶囊应当可点');
  });

  check('CSS 里悬停只做「变红换字」，绝不用 display 改动布局', () => {
    const css = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'styles', 'module.css'),
      'utf8',
    );
    assert.ok(css.includes('.pf-capsule--label:hover .pf-capsule__content'), '缺少隐藏内容');
    assert.ok(css.includes('.pf-capsule--label:hover .pf-capsule__cross'), '缺少显示 X');
    // 关键：色点与名字不能再用 display:none 退出布局 —— 那会让胶囊瞬间变窄，
    // 后面几颗胶囊被推来推去，正是用户点名要修掉的「频繁变形」。
    // 悬停段落里只允许 visibility 与配色，不允许任何 display 声明。
    const hoverBlocks = css.match(/\.pf-capsule--label:hover[^{]*\{[^}]*\}/g) ?? [];
    assert.ok(hoverBlocks.length >= 2, `悬停规则看起来不完整：${hoverBlocks.length} 条`);
    for (const block of hoverBlocks) {
      const display = block.match(/display:\s*([a-z-]+)/);
      assert.equal(display, null, `悬停规则里不允许出现 display：${block}`);
    }
    // 至少有一条悬停规则用 visibility 把内容换成 X（而不是靠 display 切换）
    assert.ok(
      hoverBlocks.some((block) => block.includes('visibility:')),
      '悬停必须用 visibility 切换内容与 X',
    );
  });

  check('X 与内容叠在同一个网格单元里：悬停时胶囊长度不变', () => {
    const css = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'styles', 'module.css'),
      'utf8',
    );
    // 同一格叠加（grid-area 相同）是「X 不参与宽度计算」的实现手段
    assert.ok(
      css.includes('.pf-capsule__content,\n.pf-capsule__cross {'),
      '内容层与 X 层必须写在同一条规则里（同一格叠加）',
    );
    assert.ok(
      css.includes('grid-area: 1 / 1'),
      'X 与内容必须共用同一网格单元（grid-area: 1 / 1）',
    );
    assert.ok(
      /\.pf-capsule--label\s+\.pf-capsule__hit\s*\{[^}]*display:\s*grid/.test(css),
      '可点区域必须改成 grid 才能让两者叠加',
    );

    // 结构上：X 与内容层同级，都在可点按钮里
    const chip = container.querySelector(
      `[data-pf-module-id="${displayModuleId}"] .pf-capsule--label .pf-capsule__hit`,
    );
    assert.ok(chip, '找不到胶囊的可点区域');
    const content = chip.querySelector('.pf-capsule__content');
    const cross = chip.querySelector('.pf-capsule__cross');
    assert.ok(content, '缺少内容层（色点 + 中文名）');
    assert.ok(cross, '缺少 X 层');
    assert.equal(content.parentElement, cross.parentElement, '两层必须是同级的兄弟');
  });

  check('输出框的胶囊没有右键菜单：编辑只在预设库，这里只有移除', () => {
    // 源码层面：胶囊标签行既不挂 onContextMenu，也没有改名入口
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'components', 'module', 'CapsuleLabelRow.tsx'),
      'utf8',
    );
    assert.equal(source.includes('onContextMenu'), false, '输出框的胶囊不该有右键菜单');
    assert.equal(source.includes('renameCapsule'), false, '改名入口不属于输出框');
    assert.equal(source.includes('onRemove'), true, '移除胶囊必须保留');

    // 渲染层面：胶囊上没有右键菜单按钮/菜单项
    const chip = container.querySelector(
      `[data-pf-module-id="${displayModuleId}"] .pf-capsule--label`,
    );
    if (chip) {
      assert.equal(chip.querySelectorAll('button').length, 1, '一颗胶囊只应有一个可点区域（移除）');
    }
  });

  check('点一下胶囊即从源内容里移除', () => {
    const chip = container.querySelector(
      `[data-pf-module-id="${displayModuleId}"] .pf-capsule__hit`,
    );
    assert.ok(chip, '找不到胶囊的可点区域');
    act(() => {
      chip.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });

    const module = useModuleStore.getState().modules.find((item) => item.id === displayModuleId);
    assert.equal(module.capsules.length, 0, '胶囊应当被移除');
    assert.equal(module.sourceText.includes('[[cap:'), false, '源内容里的锚点也要清掉');
  });

  // -------------------------------------------------------------------------
  section('模块枢 ModuleHub（需求 6）');

  check('每排右侧都是模块枢：外框 + 中心小方块，旧类名已不存在', () => {
    const hubs = container.querySelectorAll('.pf-hub');
    // 与当前排数一致（初始模块数改动时这条不会误报）
    assert.equal(hubs.length, useModuleStore.getState().modules.length, '每排都应有一个模块枢');
    assert.ok(hubs[0].querySelector('.pf-hub__square'), '缺少外框');
    assert.ok(hubs[0].querySelector('.pf-hub__core'), '缺少中心的小方块');
    assert.equal(container.querySelectorAll('.pf-handle').length, 0, '不该再有 pf-handle');
  });

  check('悬停提示是「双击复制，拖到预设库保存，拖回清空文字（胶囊保留）」', () => {
    const hub = container.querySelector('.pf-hub');
    assert.equal(hub.getAttribute('title'), '双击复制，拖到预设库保存，拖回清空文字（胶囊保留）');
    assert.ok(hub.getAttribute('aria-label').includes('模块枢'));
  });

  check('模块枢外框在任何行高下都是正方形（四道尺寸写死 + aspect-ratio）', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles', 'module.css'), 'utf8');
    const squareRule = css.match(/\.pf-hub__square\s*\{[^}]*\}/)?.[0] ?? '';
    assert.ok(squareRule, '找不到 .pf-hub__square 规则');
    for (const prop of ['width', 'height', 'min-width', 'max-width', 'min-height', 'max-height']) {
      assert.ok(
        squareRule.includes(`${prop}: var(--pf-hub-size)`),
        `外框缺少 ${prop}：被拉伸/压缩的路径没堵死`,
      );
    }
    assert.ok(squareRule.includes('aspect-ratio: 1'), '外框缺少 aspect-ratio 兜底');
    // 写成 `1 / 1` 会让 vite 的 lightningcss 压缩器报 Delim('*') 而构建失败，必须用单值写法
    assert.equal(
      squareRule.includes('aspect-ratio: 1 /'),
      false,
      'aspect-ratio 必须写单值 `1`（`1 / 1` 会导致构建失败）',
    );
    assert.ok(squareRule.includes('flex: 0 0 auto'), '外框作为 flex 子项必须不可伸缩');

    // 中心小实心方块同理
    const coreRule = css.match(/\.pf-hub__core\s*\{[^}]*\}/)?.[0] ?? '';
    assert.ok(coreRule.includes('aspect-ratio: 1'), '中心方块缺少 aspect-ratio');
    assert.ok(
      coreRule.includes('width: calc(var(--pf-hub-size) / 2.6)') &&
        coreRule.includes('height: calc(var(--pf-hub-size) / 2.6)'),
      '中心方块的宽高必须同比例（否则会变长方）',
    );

    // 任何行高下都不该被父级拉伸：父级是 stretch，外框必须自己破开
    assert.ok(
      /\.pf-hub__square\s*\{[^}]*flex:\s*0 0 auto/.test(squareRule),
      '外框缺少不可伸缩声明',
    );
  });

  check('模块枢与模块右边界之间留出呼吸空间（外层给宽度 + 右外边距）', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles', 'module.css'), 'utf8');
    const hubRule = css.match(/^\.pf-hub\s*\{[^}]*\}/m)?.[0] ?? '';
    assert.ok(hubRule, '找不到 .pf-hub 规则');
    const basis = Number(hubRule.match(/flex:\s*0 0 (\d+)px/)?.[1] ?? 0);
    const marginRight = Number(hubRule.match(/margin:\s*0 (\d+)px 0 0/)?.[1] ?? 0);
    assert.ok(basis >= 32, `模块枢太窄（${basis}px），外框两侧没有空隙`);
    assert.ok(marginRight >= 6, `与右边界只隔 ${marginRight}px，仍然贴边`);
    // 外框靠居中留白：可用空隙 = 宽度 - 外框尺寸，两侧各一半
    assert.ok(basis - 16 >= 12, `外框两侧总空隙只有 ${basis - 16}px`);
    assert.ok(hubRule.includes('align-self: center'), '模块枢应当垂直居中（不随行高拉伸）');
    // 整条区域仍可拖：36px 宽 × 内容高，功能不受影响
    assert.ok(hubRule.includes('cursor: grab'), '模块枢必须仍然显示为可拖拽');
  });

  // -------------------------------------------------------------------------
  section('顶栏：全文复制');

  {
    const modules = useModuleStore.getState().modules;
    // 第 1 排：有胶囊英文 + 译文；第 2 排：有个空模块隔着；第 3 排：只有译文
    act(() => {
      useModuleStore.getState().insertCapsule(
        modules[0].id,
        {
          label: '千早爱音',
          presetId: 'p_copy',
          english: 'Chihaya Anon',
          colorId: 'pink',
        },
        'after-capsules',
      );
      // 夹具自洽：有译文就必须有源内容（否则实时翻译会按空内容把译文清掉）；
      // 而且源内容里的锚点必须保留 —— 否则复制时拼不出术语英文
      const withAnchor = useModuleStore.getState().modules[0].sourceText;
      useModuleStore.getState().setSourceText(modules[0].id, `${withAnchor} 长头发，粉头发`);
      useModuleStore.getState().setTranslation(modules[0].id, 'long hair, pink hair');
      useModuleStore.getState().setSourceText(modules[2].id, '微笑');
      useModuleStore.getState().setTranslation(modules[2].id, 'smiling');
    });
  }
  await flush();

  const { composeFullCopyText } = require(path.join(OUT, 'utils/moduleText.js'));

  /** 假的剪贴板写入记录：全文复制与模块枢复制都往里写 */
  const clipboardWrites = [];

  await check('全文复制的载荷：按排顺序、逗号加换行、末尾不加标点、空排跳过', () => {
    const text = composeFullCopyText(useModuleStore.getState().modules);
    // 第 1 排有胶囊英文 + 译文，第 2 排为空被跳过，第 3 排只有译文
    assert.equal(text, 'Chihaya Anon, long hair, pink hair, \nsmiling');
    assert.equal(text.includes(', ,'), false, '不该拼出「, ,」这种噪声');
    assert.equal(text.split('\n').length, 2, '两个有内容的排应当正好两行');
    assert.equal(text.includes('\n\n'), false, '空排被跳过，不该留下空行');
    assert.equal(text.endsWith('.'), false, 'D95：末尾不再加英文句号');
  });

  await check('点「全文复制」会把上面的载荷写进剪贴板并提示「已复制全文」', async () => {
    // jsdom 没有剪贴板实现：装一个假的，同时证明走的是 navigator.clipboard 这条真实路径
    Object.defineProperty(window.navigator, 'clipboard', {
      value: {
        writeText: (value) => {
          clipboardWrites.push(value);
          return Promise.resolve();
        },
      },
      configurable: true,
    });

    await act(async () => {
      buttonByText('全文复制').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    // 写剪贴板是异步的：提示在微任务里落地，必须等它刷完再断言
    await flush();

    assert.deepEqual(
      clipboardWrites,
      ['Chihaya Anon, long hair, pink hair, \nsmiling'],
      '写进剪贴板的内容不对（逗号加换行、末尾不加标点）',
    );
    assert.equal(useUiStore.getState().toast?.text, '已复制全文', '缺少「已复制全文」提示');
    assert.equal(useUiStore.getState().toast?.tone, 'ok');
  });

  check('所有模块都为空时：提示「没有可复制的内容」，且不写剪贴板', () => {
    clipboardWrites.length = 0;

    act(() => {
      useModuleStore.getState().clearAllModules();
    });
    act(() => {
      buttonByText('全文复制').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });

    assert.equal(clipboardWrites.length, 0, '全空时绝不能写剪贴板（否则会留下上次的旧内容）');
    assert.equal(useUiStore.getState().toast?.text, '没有可复制的内容');
    assert.equal(useUiStore.getState().toast?.tone, 'warn');
  });

  // -------------------------------------------------------------------------
  section('顶栏：全文清空 与 删除模块（需求 5）');

  await act(async () => {
    useModuleStore.getState().resetModules();
  });
  await flush();

  {
    const modules = useModuleStore.getState().modules;
    act(() => {
      useModuleStore.getState().setSourceText(modules[0].id, '第一排的中文');
      useModuleStore.getState().setTranslation(modules[0].id, 'english one');
      useModuleStore.getState().setSourceText(modules[1].id, '第二排的中文');
    });
  }
  await flush();

  const moduleCountBefore = useModuleStore.getState().modules.length;

  act(() => {
    buttonByText('全文清空').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await flush();

  check('点「全文清空」先弹二次确认，此时还没清', () => {
    assert.ok(container.textContent.includes('确定要清空所有模块'), '缺少二次确认');
    assert.equal(useModuleStore.getState().modules[0].sourceText, '第一排的中文', '还没确认就不该清');
  });

  {
    const dialog = container.querySelector('.pf-modal');
    const confirm = Array.from(dialog.querySelectorAll('button')).find(
      (button) => button.textContent.trim() === '清空',
    );
    act(() => {
      confirm.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
  }
  await flush();

  check('确认后所有模块内容清空，但模块数量与序号不变', () => {
    const modules = useModuleStore.getState().modules;
    assert.equal(modules.length, moduleCountBefore, '模块数量不该变');
    assert.deepEqual(
      modules.map((module) => module.order),
      Array.from({ length: moduleCountBefore }, (_, index) => index + 1),
      '序号不该变',
    );
    for (const module of modules) {
      assert.equal(module.sourceText, '', '中文内容应清空');
      assert.equal(module.translation, '', '译文应清空');
      assert.equal(module.capsules.length, 0, '胶囊应清空');
      assert.equal(module.status, 'idle');
    }
  });

  const removeTargetId = useModuleStore.getState().modules[2].id;
  act(() => {
    useModuleStore.getState().selectModule(removeTargetId);
  });
  await flush();

  act(() => {
    buttonByText('删除模块').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await flush();

  check('点「删除模块」先弹二次确认，此时还没删', () => {
    assert.ok(container.textContent.includes('确定要删除模块'), '缺少二次确认');
    assert.equal(useModuleStore.getState().modules.length, moduleCountBefore);
  });

  {
    const dialog = container.querySelector('.pf-modal');
    const confirm = Array.from(dialog.querySelectorAll('button')).find(
      (button) => button.textContent.trim() === '删除',
    );
    act(() => {
      confirm.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
  }
  await flush();

  check('确认后删掉当前选中的那一排，序号重排', () => {
    const modules = useModuleStore.getState().modules;
    assert.equal(modules.length, moduleCountBefore - 1);
    assert.equal(
      modules.some((module) => module.id === removeTargetId),
      false,
      '删掉的应当是选中的那一排',
    );
    assert.deepEqual(
      modules.map((module) => module.order),
      Array.from({ length: moduleCountBefore - 1 }, (_, index) => index + 1),
      '序号应重排',
    );
  });

  await act(async () => {
    const only = useModuleStore.getState().modules[0];
    useModuleStore.getState().hydrate([{ ...only }]);
  });
  await flush();

  act(() => {
    buttonByText('删除模块').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await flush();

  check('只剩 1 个模块时：不弹确认框，直接提示无法删除（需求 5.6）', () => {
    assert.equal(container.querySelector('.pf-modal'), null, '不该弹确认框');
    assert.equal(useModuleStore.getState().modules.length, 1, '不该删掉最后一个');
    assert.ok(
      (useUiStore.getState().toast?.text ?? '').includes('至少保留 1 个模块'),
      '应当给出中文提示',
    );
  });

  // -------------------------------------------------------------------------
  section('切换模块时自动滚进可视区域（需求 3）');

  await act(async () => {
    useModuleStore.getState().resetModules();
  });
  await flush();

  {
    const rows = Array.from(container.querySelectorAll('[data-pf-module-id]'));
    assert.equal(rows.length, 6, '应当是 6 排（初始模块数）');
    const pane = rows[0].parentElement;
    const scrollCalls = [];
    pane.scrollTo = (options) => {
      scrollCalls.push(options);
    };
    pane.getBoundingClientRect = () => fakeRect({ top: 0, height: 400 });
    // 前面的用例也会触发滚动（jsdom 里 rect 全是 0），这里把基线拉回 0
    pane.scrollTop = 0;
    // 所有排都排在可视区域内
    rows.forEach((row, index) => {
      row.getBoundingClientRect = () => fakeRect({ top: 20 + index * 60, height: 56 });
    });

    act(() => {
      useModuleStore.getState().selectModule(rows[1].dataset.pfModuleId);
    });
    await flush();

    check('目标已经在可视区域内：不触发滚动（避免抖动）', () => {
      assert.equal(scrollCalls.length, 0, `不该滚动，实际滚了 ${scrollCalls.length} 次`);
    });

    // 把第 3 排挪到容器下方之外，再切到它
    rows[2].getBoundingClientRect = () => fakeRect({ top: 500, height: 56 });
    act(() => {
      useModuleStore.getState().selectModule(rows[2].dataset.pfModuleId);
    });
    await flush();

    check('目标在可视区域外：平滑滚动到与下边对齐', () => {
      assert.equal(scrollCalls.length, 1, '应当触发一次滚动');
      assert.equal(scrollCalls[0].behavior, 'smooth', '必须平滑滚动，不能瞬间跳');
      // nextScrollTop = scrollTop(0) + (556 - 400) + 8
      assert.equal(scrollCalls[0].top, 164);
    });
  }

  // -------------------------------------------------------------------------
  section('词典管理：打开、启停、拖拽排序、删除（D49）');

  // 本层只验证界面接线：把 Rust 命令换成内存桩，不碰磁盘
  const dictCalls = { reorder: [], enabled: [], deleted: [] };
  dictApi.setDictionaryEnabled = async (id, enabled) => {
    dictCalls.enabled.push({ id, enabled });
  };
  dictApi.reorderDictionaries = async (ids) => {
    dictCalls.reorder.push(ids);
  };
  dictApi.deleteDictionary = async (id, deleteFile) => {
    dictCalls.deleted.push({ id, deleteFile });
  };
  dictApi.readDictionaryEntries = async () => [];

  const fixtureItems = () => [
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
      label: '画风词典',
      file: 'b.json',
      order: 1,
      enabled: true,
      entryCount: 7,
      format: 'json',
      importedAt: 2,
    },
    {
      id: 'c.json',
      displayName: '场景词典',
      label: '场景词典',
      file: 'c.json',
      order: 2,
      enabled: true,
      entryCount: 3,
      format: 'sqlite',
      importedAt: 3,
    },
  ];

  await act(async () => {
    useDictionaryStore.setState({ items: fixtureItems(), error: null });
    useUiStore.getState().closeSettings();
    // D80：词典管理迁进「齿轮设置」弹窗 → 先点齿轮，再切到「词典管理」Tab
    container
      .querySelector('.pf-topbar__app-settings')
      ?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
  });
  await flush();
  await act(async () => {
    buttonByText('词典管理').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
  });
  await flush();

  await check('齿轮 → 切到「词典管理」Tab：列出全部词典', () => {
    assert.ok(container.textContent.includes('词典管理'), '词典 Tab 没打开');
    assert.equal(container.querySelectorAll('[data-dict-row]').length, 3, '应当列出 3 部词典');
  });

  // 启停：先点，再断言（不在 check 内部开 act，避免与外面的 act 重叠）
  const dictionarySwitches = container.querySelectorAll('[role="switch"]');
  await act(async () => {
    dictionarySwitches[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
  });
  await flush();

  await check('启用开关：点击后写回 Store 并调用 Rust 命令', () => {
    assert.equal(dictionarySwitches.length, 3, '每部词典一个开关');
    assert.deepEqual(dictCalls.enabled.at(-1), { id: 'b.json', enabled: false });
    assert.equal(useDictionaryStore.getState().items[1].enabled, false);
  });

  // 拖拽：先伪造行高，再派发指针事件
  const dictionaryRows = () => Array.from(container.querySelectorAll('[data-dict-row]'));
  dictionaryRows().forEach((row, index) => {
    row.getBoundingClientRect = () => fakeRect({ top: index * 50, height: 50 });
  });
  const dragHandle = dictionaryRows()[0].querySelector('.pf-dict__handle');
  await act(async () => {
    dragHandle.dispatchEvent(pointer('pointerdown', 0, 10));
  });
  await flush();
  await act(async () => {
    window.dispatchEvent(pointer('pointermove', 0, 140));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await flush();
  const showsInsertLine = Boolean(container.querySelector('.pf-dict__row--insert-after'));
  await act(async () => {
    window.dispatchEvent(pointer('pointerup', 0, 140));
    await Promise.resolve();
  });
  await flush();

  await check('拖拽排序：把第 1 部拖到第 3 位，顺序与命令都跟着变', () => {
    assert.ok(showsInsertLine, '拖到末尾时应当出现「插入指示线」');
    assert.deepEqual(
      useDictionaryStore.getState().items.map((item) => item.id),
      ['b.json', 'c.json', 'a.json'],
      '拖到第 3 位后应当变成 b、c、a',
    );
    assert.deepEqual(dictCalls.reorder.at(-1), ['b.json', 'c.json', 'a.json']);
  });

  // 删除：点行内「删除」→ 确认框 → 再点确认
  const dictionaryFirstRow = container.querySelector('[data-dict-row]');
  const dictionaryDeleteButton = Array.from(dictionaryFirstRow.querySelectorAll('button')).find(
    (button) => button.textContent.trim() === '删除',
  );
  await act(async () => {
    dictionaryDeleteButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
  });
  await flush();
  const confirmShown = container.textContent.includes('确定要删除「画风词典」');
  const dictionaryConfirmPanel = container.querySelector('.pf-modal__panel--narrow');
  const confirmDelete = dictionaryConfirmPanel
    ? Array.from(dictionaryConfirmPanel.querySelectorAll('button')).find(
        (button) => button.textContent.trim() === '删除',
      )
    : null;
  await act(async () => {
    confirmDelete?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
  });
  await flush();

  await check('删除：先二次确认，确认后才删（并带上「删磁盘文件」）', () => {
    assert.ok(confirmShown, '缺少二次确认');
    assert.ok(confirmDelete, '找不到确认框');
    assert.deepEqual(dictCalls.deleted.at(-1), { id: 'b.json', deleteFile: true });
    assert.equal(useDictionaryStore.getState().items.length, 2, '删除后应当只剩 2 部');
  });

  // -------------------------------------------------------------------------
  section('齿轮设置弹窗：Tab 导航 / 推送开关 / 端口夹取（D80）');

  const pushApi = require(path.join(OUT, 'api/push.js'));
  const pushSaves = [];
  pushApi.savePushSettingsToDisk = async (settings) => {
    pushSaves.push(settings);
  };
  pushApi.loadPushSettingsFromDisk = async () => ({ enabled: true, port: 8713 });

  await act(async () => {
    useUiStore.getState().closeAppSettings();
    useUiStore.getState().setAppSettingsTab('push');
    usePushStore.setState({
      enabled: true,
      port: 8713,
      loaded: true,
      loadError: null,
      persistedSnapshot: '',
    });
    await Promise.resolve();
  });
  await flush();

  await act(async () => {
    container
      .querySelector('.pf-topbar__app-settings')
      ?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
  });
  await flush();

  await check('点齿轮打开设置弹窗：左侧五个 Tab，默认停在「推送服务」', () => {
    const tabs = [...container.querySelectorAll('[role="tab"]')].map((node) => node.textContent);
    // D86：新增第三个 Tab「列表分页」；D115：新增第四个「导入导出」；D117：新增第五个「初始化」
    assert.deepEqual(
      tabs,
      ['推送服务', '词典管理', '列表分页', '导入导出', '初始化'],
      'Tab 个数与顺序固定',
    );
    assert.equal(useUiStore.getState().appSettingsOpen, true, '弹窗应当是打开状态');
    assert.equal(useUiStore.getState().appSettingsTab, 'push', '默认停在推送服务');
    assert.ok(container.querySelector('.pf-app-settings__tabs'), '缺少左侧 Tab 栏');
    assert.ok(container.querySelector('.pf-app-settings__content'), '缺少右侧内容区');
  });

  await check('外框不滚动、只有右侧内容区滚（CSS 契约）', () => {
    const css = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'styles', 'app-settings.css'),
      'utf8',
    );
    const panelRule = css.match(/\.pf-modal__panel--app\s*\{[^}]*\}/)?.[0] ?? '';
    const contentRule = css.match(/\.pf-app-settings__content\s*\{[^}]*\}/)?.[0] ?? '';
    assert.match(panelRule, /overflow:\s*hidden/, '弹窗外框必须 overflow:hidden');
    assert.match(panelRule, /grid-template-columns/, '弹窗应当是「左 Tab + 右内容」两栏');
    assert.match(contentRule, /overflow-y:\s*auto/, '只有右侧内容区滚动');
  });

  await check('默认：开关打开、端口 8713、输入框可用', () => {
    const toggle = container.querySelector('.pf-app-settings__content [role="switch"]');
    assert.ok(toggle, '缺少滑动开关');
    assert.equal(toggle.getAttribute('aria-checked'), 'true', '默认应当是开启');
    const input = container.querySelector('[aria-label="通信端口"]');
    assert.ok(input, '缺少端口输入框');
    assert.equal(input.value, '8713', '默认端口应当是 8713');
    assert.equal(input.disabled, false, '开关打开时端口框可编辑');
    assert.equal(input.getAttribute('min'), '1024');
    assert.equal(input.getAttribute('max'), '65535');
  });

  await check('关掉开关：端口输入框置灰禁用；再打开恢复', async () => {
    const toggle = () => container.querySelector('.pf-app-settings__content [role="switch"]');
    await act(async () => {
      toggle().dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    await flush();
    assert.equal(toggle().getAttribute('aria-checked'), 'false', '开关应当关闭');
    assert.equal(usePushStore.getState().enabled, false, 'Store 里应当是关闭');
    assert.equal(
      container.querySelector('[aria-label="通信端口"]').disabled,
      true,
      '关闭后端口框必须禁用（用户要求置灰）',
    );

    await act(async () => {
      toggle().dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    await flush();
    assert.equal(
      container.querySelector('[aria-label="通信端口"]').disabled,
      false,
      '重新打开后端口框恢复可编辑',
    );
  });

  await check('端口：合法值即时生效；越界值回车后被夹到 1024–65535', async () => {
    const input = () => container.querySelector('[aria-label="通信端口"]');
    const typePort = async (value) => {
      await act(async () => {
        // 必须走原生 setter，否则 React 的值追踪器认为值没变、onChange 根本不触发
        typeInto(input(), value);
        await Promise.resolve();
      });
      await flush();
    };
    const pressEnter = async () => {
      await act(async () => {
        input().dispatchEvent(
          new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
        );
        await Promise.resolve();
      });
      await flush();
    };

    // 合法值：键入即写回 Store（不用等失焦）
    await typePort('9000');
    assert.equal(input().value, '9000');
    assert.equal(usePushStore.getState().port, 9000, '合法端口应当立刻生效');

    // 越界：草稿先留着（要能继续输入），回车时夹到边界
    await typePort('80');
    assert.equal(input().value, '80', '输入过程中不该被强行改写');
    await pressEnter();
    assert.equal(input().value, '1024', '低于下限应当夹到 1024');
    assert.equal(usePushStore.getState().port, 1024);

    await typePort('70000');
    await pressEnter();
    assert.equal(input().value, '65535', '高于上限应当夹到 65535');
    assert.equal(usePushStore.getState().port, 65535);

    // 恢复成 9000，供后面的落盘断言使用
    await typePort('9000');
    assert.equal(usePushStore.getState().port, 9000);
  });

  await check('改动会落盘（防抖后调一次保存命令）', async () => {
    pushSaves.length = 0;
    await act(async () => {
      usePushStore.getState().setEnabled(false);
      await Promise.resolve();
    });
    // 落盘防抖是 PERSIST_DEBOUNCE_MS（400ms），等它过去
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 520));
    });
    await flush();
    assert.equal(pushSaves.length > 0, true, '应当调用过保存命令');
    const last = pushSaves.at(-1);
    assert.equal(last.enabled, false, '保存的是关闭状态');
    assert.equal(last.port, 9000, '端口一起保存');
  });

  await check('切到「词典管理」Tab：推送面板卸载，词典面板出现', async () => {
    await act(async () => {
      buttonByText('词典管理').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    await flush();
    assert.equal(useUiStore.getState().appSettingsTab, 'dictionary');
    assert.ok(container.querySelector('[data-dict-row]'), '词典列表应当出现');
    assert.equal(
      container.querySelector('[aria-label="通信端口"]'),
      null,
      '切走后推送面板应当卸载（DOM 物理隔离）',
    );
  });

  await check('Esc 关掉设置弹窗（词典 Tab 里没有子对话框时）', async () => {
    await act(async () => {
      window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await Promise.resolve();
    });
    await flush();
    assert.equal(useUiStore.getState().appSettingsOpen, false, 'Esc 应当关掉设置弹窗');
  });

  /* ----- D115：设置里的第四个 Tab「导入导出」 ----- */

  await check('「导入导出」Tab：五个库默认全选、同名策略默认「重命名」', async () => {
    await act(async () => {
      container
        .querySelector('.pf-topbar__app-settings')
        ?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    await flush();
    await act(async () => {
      buttonByText('导入导出').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    await flush();

    assert.equal(useUiStore.getState().appSettingsTab, 'bundle', '应当切到导入导出');
    // 顺带钉住 `openAppSettings('bundle')`：它是 Tab 白名单的一份拷贝，漏加过一次
    await act(async () => {
      useUiStore.getState().openAppSettings('bundle');
      await Promise.resolve();
    });
    assert.equal(useUiStore.getState().appSettingsTab, 'bundle', 'openAppSettings 必须认这个 Tab');
    const panel = container.querySelector('[data-pf-bundle="true"]');
    assert.ok(panel, '导入导出面板没有渲染');
    const checks = [...panel.querySelectorAll('.pf-bundle__check')];
    assert.equal(checks.length, 5, '五个库都应当有勾选项');
    assert.deepEqual(
      checks.map((node) => node.checked),
      [true, true, true, true, true],
      '默认全选',
    );
    const text = panel.textContent;
    for (const expected of ['预设库', '画师库', 'Tag 库', '词典库', '快照库', '已选 5 个库']) {
      assert.ok(text.includes(expected), `缺少「${expected}」`);
    }
    assert.ok(text.includes('同文件夹的画师'), '必须说明词典与同文件夹画师 / Tag 是一个整体');

    const radios = [...panel.querySelectorAll('.pf-bundle__option')];
    assert.deepEqual(
      radios.map((node) => node.textContent),
      ['重命名', '覆盖'],
      '同名条目只给这两个选择',
    );
    assert.equal(radios[0].getAttribute('aria-checked'), 'true', '默认必须是重命名');
    assert.equal(radios[1].getAttribute('aria-checked'), 'false');
    assert.equal(panel.querySelector('[data-pf-bundle-error]'), null, '默认态不该有报错');
  });

  await check('取消勾选：计数跟着变；一个都不勾时导出按钮禁用', async () => {
    const panel = () => container.querySelector('[data-pf-bundle="true"]');
    const checks = () => [...panel().querySelectorAll('.pf-bundle__check')];

    await act(async () => {
      checks()[0].click();
      await Promise.resolve();
    });
    await flush();
    assert.equal(panel().textContent.includes('已选 4 个库'), true, '取消一个后应当剩下四个');

    await act(async () => {
      for (const node of checks().slice(1)) node.click();
      await Promise.resolve();
    });
    await flush();
    assert.equal(panel().textContent.includes('已选 0 个库'), true);
    const exportButton = [...panel().querySelectorAll('button')].find((node) =>
      node.textContent.includes('选择位置并导出'),
    );
    assert.ok(exportButton, '缺少导出按钮');
    assert.equal(exportButton.disabled, true, '没勾任何库时不能导出');
  });

  await check('覆盖 / 重命名可以点选切换（默认重命名，用户才改成覆盖）', async () => {
    const panel = () => container.querySelector('[data-pf-bundle="true"]');
    const radios = () => [...panel().querySelectorAll('.pf-bundle__option')];
    await act(async () => {
      radios()[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    await flush();
    assert.equal(radios()[1].getAttribute('aria-checked'), 'true', '点「覆盖」后应当选中它');
    assert.equal(radios()[0].getAttribute('aria-checked'), 'false');

    await act(async () => {
      radios()[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    await flush();
    assert.equal(radios()[0].getAttribute('aria-checked'), 'true', '点回「重命名」');
  });

  await check('离开导入导出页：勾选全部复原，弹窗回到推送服务', async () => {
    const panel = () => container.querySelector('[data-pf-bundle="true"]');
    await act(async () => {
      for (const node of [...panel().querySelectorAll('.pf-bundle__check')]) {
        if (!node.checked) node.click();
      }
      await Promise.resolve();
    });
    await flush();
    assert.equal(panel().textContent.includes('已选 5 个库'), true, '勾选应能全部复原');
    await act(async () => {
      useUiStore.getState().setAppSettingsTab('push');
      useUiStore.getState().closeAppSettings();
      await Promise.resolve();
    });
    await flush();
    assert.equal(panel(), null, '关掉弹窗后面板应当卸载');
  });

  /* ----- D117：设置里的第五个 Tab「初始化」 ----- */

  await check('「初始化」Tab：三项按使用频率排列（界面 → 库 → 服务商）', async () => {
    await act(async () => {
      container
        .querySelector('.pf-topbar__app-settings')
        ?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    await flush();
    await act(async () => {
      buttonByText('初始化').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    await flush();

    assert.equal(useUiStore.getState().appSettingsTab, 'reset', '应当切到初始化');
    const panel = container.querySelector('[data-pf-reset="true"]');
    assert.ok(panel, '初始化面板没有渲染');
    const rows = [...panel.querySelectorAll('[data-pf-reset-row]')].map((node) =>
      node.getAttribute('data-pf-reset-row'),
    );
    assert.deepEqual(rows, ['ui', 'libraries', 'provider'], '顺序必须是 界面 → 库 → 服务商');
    const text = panel.textContent;
    for (const expected of [
      '界面初始化',
      '库初始化',
      '服务商初始化',
      '恢复默认',
      '清空五个库',
      '清空服务商',
    ]) {
      assert.ok(text.includes(expected), `缺少「${expected}」`);
    }
  });

  await check('界面初始化：点一下就回默认，且不弹确认框', async () => {
    const beforeTexts = JSON.stringify(
      useModuleStore.getState().modules.map((module) => module.sourceText),
    );
    await act(async () => {
      useUiStore.getState().setTheme('dark');
      useUiStore.getState().setPresetPanelWidth(300);
      useUiStore.getState().setInputPaneHeight(400);
      useUiStore.getState().setLibraryPageSize(500);
      const moduleStore = useModuleStore.getState();
      for (const module of moduleStore.modules) moduleStore.setOutputHeight(module.id, 120);
    });
    await flush();

    const panel = () => container.querySelector('[data-pf-reset="true"]');
    const button = [...panel().querySelectorAll('button')].find(
      (node) => node.textContent === '恢复默认',
    );
    assert.ok(button, '缺少「恢复默认」按钮');
    await act(async () => {
      button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    await flush();

    const ui = useUiStore.getState();
    assert.equal(ui.theme, 'light', '主题应当回到亮色');
    assert.equal(ui.presetPanelWidth, PRESET_PANEL_DEFAULT_WIDTH, '预设库宽度回默认');
    assert.equal(ui.inputPaneHeight, INPUT_PANE_DEFAULT_HEIGHT, '输入框高度回默认');
    assert.equal(ui.libraryPageSize, LIBRARY_PAGE_SIZE, '分页阈值回默认');
    for (const module of useModuleStore.getState().modules) {
      assert.equal(module.outputHeight, MODULE_DEFAULT_HEIGHT, '模块高度应当回默认');
    }
    assert.equal(
      container.querySelector('.pf-modal__panel--narrow'),
      null,
      '界面初始化没有实质损失，不该弹确认框',
    );
    assert.equal(
      JSON.stringify(useModuleStore.getState().modules.map((module) => module.sourceText)),
      beforeTexts,
      '界面初始化不能动工作区里的中文内容',
    );
  });

  await check('库 / 服务商初始化：先弹确认框，取消后什么都不做', async () => {
    const panel = () => container.querySelector('[data-pf-reset="true"]');
    const clickAction = async (label) => {
      const button = [...panel().querySelectorAll('button')].find(
        (node) => node.textContent === label,
      );
      assert.ok(button, `缺少「${label}」按钮`);
      await act(async () => {
        button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        await Promise.resolve();
      });
      await flush();
    };
    const dialog = () => container.querySelector('.pf-modal__panel--narrow');
    const clickCancel = async () => {
      const cancel = [...dialog().querySelectorAll('button')].find(
        (node) => node.textContent === '取消',
      );
      await act(async () => {
        cancel.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        await Promise.resolve();
      });
      await flush();
    };

    const presetCount = usePresetStore.getState().presets.length;
    await clickAction('清空五个库');
    assert.ok(dialog(), '库初始化必须先弹确认框');
    assert.ok(dialog().textContent.includes('清空五个库？'), '确认框标题写清后果');
    assert.ok(dialog().textContent.includes('不能撤销'), '确认框要说明不可撤销');
    await clickCancel();
    assert.equal(dialog(), null, '取消后确认框应当关闭');
    assert.equal(
      usePresetStore.getState().presets.length,
      presetCount,
      '取消后一个预设都不该少',
    );

    await clickAction('清空服务商');
    assert.ok(dialog(), '服务商初始化也要确认');
    assert.ok(dialog().textContent.includes('清空服务商配置？'));
    await clickCancel();

    await act(async () => {
      useUiStore.getState().setAppSettingsTab('push');
      useUiStore.getState().closeAppSettings();
      await Promise.resolve();
    });
    await flush();
  });

  // -------------------------------------------------------------------------
  section('实时推流（D81）：最终文本一变就推、前端 200ms 防抖');

  const broadcastCalls = [];
  pushApi.broadcastTranslation = async (payload) => {
    broadcastCalls.push(payload);
    return { clients: 1, chars: payload.global.length };
  };

  /** 推出去的各帧的 `global`（D90 起载荷是 {global, modules}，断言大多只看 global） */
  const pushedGlobals = () => broadcastCalls.map((payload) => payload.global);

  /** 等过 200ms 防抖（多留 120ms 余量）+ 微任务 */
  const afterDebounce = async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 320));
    });
    await flush();
  };

  const pushModuleId = () => useModuleStore.getState().modules[0].id;

  await check('打开开关后立刻推一次当前文本（不是等用户打字才推）', async () => {
    // 前面的用例把开关关掉了：先关→开，观察挂载时的那次立即推流
    await act(async () => {
      usePushStore.setState({ enabled: false });
      await Promise.resolve();
    });
    await flush();
    broadcastCalls.length = 0;
    await act(async () => {
      usePushStore.setState({ enabled: true, loaded: true, loadError: null });
      await Promise.resolve();
    });
    await flush();
    assert.equal(broadcastCalls.length >= 1, true, '服务刚起来就得有内容（后连上的节点才拿得到）');
  });

  await check('打字改了译文：防抖到点后推一次「全文复制」的内容', async () => {
    broadcastCalls.length = 0;
    await act(async () => {
      useModuleStore.getState().setTranslation(pushModuleId(), 'cha, long hair');
      await Promise.resolve();
    });
    assert.deepEqual(broadcastCalls, [], '200ms 防抖期内不该推');
    await afterDebounce();
    assert.deepEqual(pushedGlobals(), ['cha, long hair'], '推的是最终文本，末尾不加标点');
  });

  await check('连续打字只推最后落定的一次（200ms 防抖合并）', async () => {
    broadcastCalls.length = 0;
    for (const text of ['one', 'one, two', 'one, two, three']) {
      await act(async () => {
        useModuleStore.getState().setTranslation(pushModuleId(), text);
        await Promise.resolve();
      });
    }
    await afterDebounce();
    assert.deepEqual(pushedGlobals(), ['one, two, three'], '三次改动只该推一次');
  });

  await check('D90：载荷按行拆分（global 是整段，modules 是每排一块，恒定 9 个键）', async () => {
    broadcastCalls.length = 0;
    const secondId = useModuleStore.getState().modules[1].id;
    await act(async () => {
      useModuleStore.getState().setTranslation(pushModuleId(), 'first row');
      useModuleStore.getState().setTranslation(secondId, 'second row');
      await Promise.resolve();
    });
    await afterDebounce();
    const payload = broadcastCalls.at(-1);
    assert.equal(payload.global, 'first row, second row', 'global 仍是整段拼接');
    assert.equal(payload.modules['1'], 'first row', '第 1 排只放自己的文本');
    assert.equal(payload.modules['2'], 'second row', '第 2 排只放自己的文本');
    assert.equal(payload.modules['3'], '', '没内容的排是空串');
    assert.equal(Object.keys(payload.modules).length, 9, '恒定 9 个位置键');
    assert.equal(payload.modules['1'].endsWith('.'), false, '单排文本不带整段句号');
  });

  await check('拖入胶囊：动作结束就推，胶囊英文排在最前', async () => {
    broadcastCalls.length = 0;
    await act(async () => {
      useModuleStore
        .getState()
        .insertCapsule(
          pushModuleId(),
          { presetId: 'p1', label: '千早', english: 'Chihaya Anon', colorId: 'pink' },
          'after-capsules',
        );
      await Promise.resolve();
    });
    await afterDebounce();
    assert.equal(broadcastCalls.length, 1, '拖完胶囊只该推一次');
    // 只校验「术语英文在最前面」这条契约：这排只有胶囊、没有中文时，
    // 实时翻译层会把旧译文清掉（见 useRealtimeTranslate 的空内容分支），
    // 因此这里不该钉死整串文本，否则断言会被翻译层的行为带偏。
    assert.equal(broadcastCalls[0].global.indexOf('Chihaya Anon'), 0, '胶囊英文必须排在最前');
  });

  await check('删除胶囊也会推（术语从文本里消失）', async () => {
    broadcastCalls.length = 0;
    const capsuleId = useModuleStore.getState().modules[0].capsules[0].id;
    await act(async () => {
      useModuleStore.getState().removeCapsule(pushModuleId(), capsuleId);
      await Promise.resolve();
    });
    await afterDebounce();
    assert.equal(broadcastCalls.length, 1);
    assert.equal(broadcastCalls[0].global.includes('Chihaya Anon'), false, '胶囊英文应当已经消失');
  });

  await check('纯界面动作（切换选中排）不推：文本没变就不发', async () => {
    broadcastCalls.length = 0;
    await act(async () => {
      useModuleStore.getState().selectAdjacentModule(1);
      await Promise.resolve();
    });
    await afterDebounce();
    assert.deepEqual(broadcastCalls, [], '切换选中排不改变最终文本，不该推流');
  });

  await check('加载全局快照：覆盖后立刻推快照里的内容', async () => {
    broadcastCalls.length = 0;
    const { capsuleAnchor } = require(path.join(OUT, 'utils/placeholder.js'));
    await act(async () => {
      useModuleStore.getState().applySnapshotGlobal({
        id: 'snap-1',
        name: '快照',
        scope: 'global',
        weight: 100,
        copyText: '',
        createdAt: 0,
        modules: [
          {
            sourceText: `${capsuleAnchor('cap_x')} 千早`,
            colorId: 'pink',
            capsules: [
              { id: 'cap_x', presetId: 'p1', name: '千早', english: 'Chihaya Anon', colorId: 'pink' },
            ],
          },
        ],
      });
      await Promise.resolve();
    });
    await afterDebounce();
    assert.deepEqual(pushedGlobals(), ['Chihaya Anon'], '快照里的胶囊英文必须原样推出去');
  });

  await check('一键清空：全空时推空字符串（不是不发）', async () => {
    broadcastCalls.length = 0;
    await act(async () => {
      useModuleStore.getState().clearAllModules();
      await Promise.resolve();
    });
    await afterDebounce();
    assert.deepEqual(pushedGlobals(), ['']);
    // D90：全空时 9 个模块槽位也必须是空串（客户端据此知道「现在没内容」）
    assert.equal(Object.keys(broadcastCalls[0].modules).length, 9, '全空也要带 9 个槽位');
    assert.equal(
      Object.values(broadcastCalls[0].modules).every((text) => text === ''),
      true,
      '全空时每个槽位都必须是空串',
    );
  });

  await check('关掉推送开关：之后任何改动都不再推', async () => {
    await act(async () => {
      usePushStore.setState({ enabled: false });
      await Promise.resolve();
    });
    await flush();
    broadcastCalls.length = 0;
    await act(async () => {
      useModuleStore.getState().setTranslation(pushModuleId(), 'should not reach comfyui');
      await Promise.resolve();
    });
    await afterDebounce();
    assert.deepEqual(broadcastCalls, [], '关掉开关后不该再推（Rust 侧同时断开监听）');
  });

  // -------------------------------------------------------------------------
  section('Tag 库（D86）：T 色块进视图、与画师库同构（胶囊 / 权重 / 添加为预设 / 分页）');

  /** 造 n 条 Tag 条目（与词典导入派生出来的形状一致） */
  const tagFixtures = Array.from({ length: 250 }, (_, index) => ({
    id: `tag:长发${index}`,
    label: `长发${index}`,
    english: `long hair ${index}`,
    weight: 100,
    colorId: 'dictionary',
    createdAt: 1,
    updatedAt: 1,
  }));

  await act(async () => {
    useTagStore.setState({ presets: tagFixtures.map((tag) => ({ ...tag })), loaded: true });
    // 预设库要有内容，才能断言「切回预设库后条目 DOM 回来了」
    usePresetStore.setState({
      presets: [
        { id: 'pre_tag_a', label: '用例预设', english: 'demo preset', weight: 100, colorId: 'red' },
      ],
      loaded: true,
    });
    useUiStore.setState({
      libraryView: 'presets',
      presetSearchKeyword: '',
      // 前面几段可能留下了颜色筛选，这里清掉，否则列表会被筛空
      presetFilterColorIds: [],
      libraryPage: 1,
      libraryPageSize: 100,
    });
    useModuleStore.getState().clearModule(useModuleStore.getState().modules[0].id);
  });
  await flush();

  await check('点 T 色块：切到 Tag 库，按分页列出胶囊，预设 DOM 全部卸载', async () => {
    const tagSwatch = container.querySelector('[title="Tag 库"]');
    assert.ok(tagSwatch, '找不到 Tag 库的 T 色块');
    await act(async () => {
      tagSwatch.click();
    });
    await flush();

    const panel = container.querySelector('[data-pf-preset-panel]');
    assert.ok(panel, '找不到预设面板');
    assert.equal(panel.getAttribute('data-pf-library'), 'tags', '面板没有切到 Tag 库');
    assert.ok(panel.textContent.includes('Tag 库'), '缺少「Tag 库」标题');
    // 与画师库同构：进库就有列表，不需要先输入关键词
    const chips = container.querySelectorAll('[data-pf-preset-id]');
    assert.equal(chips.length, 100, `默认按 100 条分页，实际 ${chips.length} 条`);
    assert.equal(container.querySelectorAll('.pf-preset-item__dot').length >= 100, true, '胶囊应当带色点');
    // 只有 Tag 的 DOM：原来那条预设不该还在
    assert.equal(
      container.querySelectorAll('[data-pf-preset-id="pre_tag_a"]').length,
      0,
      'Tag 视图里不许残留预设条目',
    );
    assert.ok(buttonByText('新增 Tag'), 'Tag 库应当有「新增 Tag」按钮');
    assert.ok(panel.textContent.includes('第 1 / 3 页'), '250 条 ÷ 100 = 3 页');
  });

  await check('分页阈值改成 50：列表立刻变成 50 条（四个库共用同一个值）', async () => {
    // 直接走设置面板那条路径：打开设置 → 列表分页 Tab → 改输入框
    await act(async () => {
      useUiStore.getState().openAppSettings('paging');
    });
    await flush();

    const tab = Array.from(container.querySelectorAll('[role="tab"]')).find(
      (item) => item.textContent.trim() === '列表分页',
    );
    assert.ok(tab, '设置里没有「列表分页」Tab');
    const input = container.querySelector('[data-pf-paging] input[type="number"]');
    assert.ok(input, '分页面板里没有输入框');
    assert.equal(input.value, '100', '默认值应当是 100');

    await act(async () => {
      typeInto(input, '50');
    });
    await flush();
    assert.equal(useUiStore.getState().libraryPageSize, 50, '分页阈值没有生效');

    await act(async () => {
      useUiStore.getState().closeAppSettings();
    });
    await flush();
    assert.equal(
      container.querySelectorAll('[data-pf-preset-id]').length,
      50,
      '改完阈值后 Tag 库应当立刻按 50 条分页',
    );
  });

  await check('右键 Tag：菜单里有权重与「添加为预设」', async () => {
    const chip = container.querySelector('[data-pf-preset-id]');
    await act(async () => {
      chip.dispatchEvent(
        new window.MouseEvent('contextmenu', { bubbles: true, clientX: 300, clientY: 200 }),
      );
    });
    await flush();
    const menu = document.querySelector('.pf-menu');
    assert.ok(
      menu,
      `右键没有弹出菜单（presetMenu=${JSON.stringify(useUiStore.getState().presetMenu)}，chip=${chip?.getAttribute('data-pf-preset-id')}，tags=${useTagStore.getState().presets.length}）`,
    );
    assert.ok(menu.textContent.includes('权重'), 'Tag 菜单里应当有权重');
    assert.ok(menu.textContent.includes('添加为预设'), 'Tag 菜单里应当有「添加为预设」');
  });

  await check('权重 ±10 立刻生效（与预设同一套右键菜单）', async () => {
    const before = useTagStore.getState().presets[0].weight;
    const plus = document.querySelector('[aria-label="权重增加 10"]');
    assert.ok(plus, '菜单里没有「权重增加 10」');
    await act(async () => {
      plus.click();
    });
    await flush();
    assert.equal(useTagStore.getState().presets[0].weight, before + 10, '权重没变');
    // 关掉菜单，免得挡住后面的拖拽
    await act(async () => {
      document.body.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    });
    await flush();
  });

  await check('「添加为预设」：写进预设库、从 Tag 库移除（转换语义）', async () => {
    const chip = container.querySelector('[data-pf-preset-id]');
    const tagId = chip.getAttribute('data-pf-preset-id');
    await act(async () => {
      chip.dispatchEvent(
        new window.MouseEvent('contextmenu', { bubbles: true, clientX: 300, clientY: 200 }),
      );
    });
    await flush();
    const move = Array.from(document.querySelectorAll('.pf-menu button')).find(
      (button) => button.textContent.trim() === '添加为预设',
    );
    assert.ok(move, '菜单里没有「添加为预设」');
    await act(async () => {
      move.click();
    });
    await flush();

    const form = container.querySelector('form.pf-modal__panel');
    assert.ok(form, '没有弹出预设编辑器');
    assert.equal(controlByLabel('中文命名').value, '长发0', '编辑器应当预填 Tag 的中文名');
    assert.equal(controlByLabel('英文内容').value, 'long hair 0', '英文也应当带过去');

    await act(async () => {
      form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush();

    const presets = usePresetStore.getState().presets;
    assert.equal(
      presets.some((preset) => preset.label === '长发0'),
      true,
      '转换后预设库里应当多一条',
    );
    assert.equal(
      useTagStore.getState().presets.some((tag) => tag.id === tagId),
      false,
      '转换后 Tag 库里那条应当被移除（移动语义）',
    );
    assert.equal(useUiStore.getState().libraryView, 'presets', '保存后应当切回预设库');
  });

  await check('把 Tag 胶囊拖到模块：落进输入框的是纯英文 Tag（不是中文药丸）', async () => {
    // 先把视图切回 Tag 库并准备一颗胶囊
    await act(async () => {
      useTagStore.setState({
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
        loaded: true,
      });
      useUiStore.setState({ libraryView: 'tags', presetSearchKeyword: '', libraryPage: 1 });
      useModuleStore.getState().clearModule(useModuleStore.getState().modules[0].id);
    });
    await flush();

    const chip = container.querySelector('[data-pf-preset-id="tag:长发"]');
    const moduleEl = container.querySelector('[data-pf-module-id]');
    assert.ok(chip && moduleEl, '找不到 Tag 胶囊或模块');
    document.elementFromPoint = () => moduleEl;

    dragFrom(chip, [[420, 240]]);
    await flush();
    assert.equal(useUiStore.getState().drag?.source.kind, 'preset', 'Tag 胶囊的拖拽源与预设同一套');
    releaseAt(420, 240);
    await flush();

    const module = useModuleStore.getState().modules[0];
    const capsule = module.capsules[module.capsules.length - 1];
    assert.ok(capsule, '没有插入词条');
    assert.equal(capsule.kind, 'tag', 'Tag 库的条目必须落成 Tag（来源标记），不是普通胶囊');
    assert.equal(capsule.english, 'long hair');
    assert.ok(module.sourceText.includes(`[[cap:${capsule.id}]]`), '源内容里应当写入锚点');
    assert.equal(useUiStore.getState().toast?.text, '已插入词典词条');

    /*
     * D110：输入框里看到的是与预设/画师**同一种药丸**（色点 + 中文名），
     * 不再是 `long hair` 这样的纯英文文本；英文只留在复制/推流载荷里。
     */
    const editor = container.querySelector('.pf-source__input');
    assert.ok(editor, '找不到输入框');
    const pill = editor.querySelector('[data-capsule-id]');
    assert.ok(pill, '输入框里没有 Tag 药丸');
    assert.equal(pill.querySelector('.pf-capsule__text').textContent, '长发', 'Tag 药丸显示中文名');
    assert.equal(pill.className.includes('pf-capsule'), true, 'Tag 必须套药丸样式');
    assert.ok(pill.querySelector('.pf-capsule__dot'), 'Tag 药丸要有色点');
    assert.equal(pill.getAttribute('data-capsule-color'), 'dictionary', '归属色必须是词典色');
    assert.equal(editor.innerHTML.includes('long hair'), false, '英文词条不许进输入框');
  });

  await check('多文件库：加载时跨文件合并、每条带 sourceFile，计数 = 各文件之和（D87）', async () => {
    const presetApi = require(path.join(OUT, 'api/presets.js'));
    const { visiblePresets } = require(path.join(OUT, 'utils/presetFilter.js'));
    const entry = (id, label, english, weight) => ({
      id,
      label,
      english,
      weight,
      colorId: 'dictionary',
      createdAt: 1,
      updatedAt: 1,
    });

    presetApi.loadLibrary = async (kind) =>
      kind === 'tags'
        ? [
            // 数据根目录那份（手工新增 / 历史遗留）
            { file: 'tags.json', items: [entry('tag:本机', '本机', 'local', 100)] },
            // 某部词典文件夹里那份
            {
              file: 'dictionaries/画风词典/tags.json',
              items: [
                entry('tag:长发', '长发', 'long hair', 300),
                entry('tag:短发', '短发', 'short hair', 200),
              ],
            },
          ]
        : [];

    await act(async () => {
      useTagStore.setState({ loaded: false, loading: false, persisted: {} });
      await useTagStore.getState().loadPresets();
    });
    await flush();

    const tags = useTagStore.getState().presets;
    assert.equal(tags.length, 3, '跨文件统计就是各文件相加');
    assert.deepEqual(
      tags.map((tag) => tag.sourceFile),
      ['tags.json', 'dictionaries/画风词典/tags.json', 'dictionaries/画风词典/tags.json'],
      '每条都要记住自己属于哪个文件（只在内存里）',
    );
    // 渲染顺序仍是「权重降序」—— 跨文件与单文件没有区别
    assert.deepEqual(
      visiblePresets(tags, [], '').map((tag) => tag.id),
      ['tag:长发', 'tag:短发', 'tag:本机'],
      '合并后按权重降序，与文件顺序无关',
    );
    // 逐文件快照都记下了（据此判断「内容没变就不写」）
    assert.deepEqual(Object.keys(useTagStore.getState().persisted).sort(), [
      'dictionaries/画风词典/tags.json',
      'tags.json',
    ]);
  });

  await check('改一条只重写它所属的那个文件，且落盘载荷不带 sourceFile（D87）', async () => {
    const presetApi = require(path.join(OUT, 'api/presets.js'));
    const writes = [];
    presetApi.saveLibraryFile = async (kind, file, items) => {
      writes.push({ kind, file, items });
    };

    await act(async () => {
      useTagStore.getState().setWeight('tag:短发', 500);
      // 等落盘防抖（PERSIST_DEBOUNCE_MS = 400）
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    await flush();

    assert.equal(writes.length, 1, `只该写一个文件，实际写了 ${writes.length} 个`);
    assert.equal(writes[0].kind, 'tags');
    assert.equal(writes[0].file, 'dictionaries/画风词典/tags.json', '写的是这条 Tag 所属的文件');
    assert.equal(writes[0].items.length, 2, '只写那个文件里的条目（别的文件一个字节都不碰）');
    assert.equal(
      'sourceFile' in writes[0].items[0],
      false,
      'sourceFile 只用于内存分组，绝不能落盘',
    );
  });

  // -------------------------------------------------------------------------
  section('预设分组（D112）：双击展开、拖入分组、顶部拖建组');

/** 分组断言用的固定现场：一条在蓝色组里、一条蓝色散件、一条粉色散件 */
const folderFixture = async (expanded) => {
  await act(async () => {
    usePresetStore.setState({
      presets: [
        {
          id: 'p1',
          label: '安和昴',
          english: 'anon',
          weight: 300,
          colorId: 'blue',
          folder: '作品集',
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'p2',
          label: '散件',
          english: 'misc',
          weight: 100,
          colorId: 'blue',
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'p3',
          label: '粉色散件',
          english: 'pinkish',
          weight: 90,
          colorId: 'pink',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      loaded: true,
      persisted: {},
    });
    usePresetFolderStore.setState({
      folders: [{ name: '作品集', colorId: 'blue', expanded }],
      loaded: true,
      persisted: '[]',
    });
    useUiStore.setState({
      libraryView: 'presets',
      presetFilterColorIds: [],
      presetSearchKeyword: '',
      libraryPage: 1,
      presetMenu: null,
      presetGroupMenu: null,
      folderPrompt: null,
    });
  });
  await flush();
};

await check('双击组砖 → 展开成卡片；再双击 → 收起（状态写进分组 Store）', async () => {
  await folderFixture(false);

  const tile = container.querySelector('[data-pf-group-name="作品集"]');
  assert.ok(tile, '找不到组砖');
  assert.equal(tile.getAttribute('data-pf-group-expanded'), 'no', '初始应当是折叠砖');
  assert.equal(container.innerHTML.includes('安和昴'), false, '折叠时成员不该在 DOM 里');

  await act(async () => {
    tile.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  });
  await flush();

  assert.equal(usePresetFolderStore.getState().folders[0].expanded, true, '展开状态没写进 Store');
  const card = container.querySelector('[data-pf-group-name="作品集"]');
  assert.equal(card.getAttribute('data-pf-group-expanded'), 'yes', 'DOM 应当换成展开卡片');
  assert.ok(container.innerHTML.includes('安和昴'), '展开后成员要出现');

  await act(async () => {
    card.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  });
  await flush();
  assert.equal(usePresetFolderStore.getState().folders[0].expanded, false, '再双击应当收起');
});

await check('把同色胶囊拖到组砖上 = 移入该组，并提示已移入', async () => {
  await folderFixture(false);

  const item = container.querySelector('[data-pf-preset-id="p2"]');
  const tile = container.querySelector('[data-pf-group-name="作品集"]');
  assert.ok(item && tile, '找不到胶囊或组砖');
  document.elementFromPoint = () => tile;

  dragFrom(item, [[420, 240]]);
  await flush();
  const hover = useUiStore.getState().drag?.hover;
  assert.equal(hover?.kind, 'preset-group', `落点应判成预设分组，实际 ${hover?.kind}`);
  assert.equal(hover?.group, '作品集');
  assert.equal(hover?.color, 'blue', '落点要带上目标组的颜色（组的身份 = 名字 + 颜色）');

  releaseAt(420, 240);
  await flush();
  const moved = usePresetStore.getState().presets.find((preset) => preset.id === 'p2');
  assert.equal(moved.folder, '作品集', '胶囊没被移进组');
  assert.equal(useUiStore.getState().toast?.text, '已移入「作品集」');
});

await check('把异色胶囊拖到组砖上：被拒绝，胶囊留在原地', async () => {
  await folderFixture(false);

  const pink = container.querySelector('[data-pf-preset-id="p3"]');
  const tile = container.querySelector('[data-pf-group-name="作品集"]');
  assert.ok(pink && tile, '找不到粉色胶囊或组砖');
  document.elementFromPoint = () => tile;

  dragFrom(pink, [[420, 240]]);
  await flush();
  releaseAt(420, 240);
  await flush();

  const untouched = usePresetStore.getState().presets.find((preset) => preset.id === 'p3');
  assert.equal(untouched.folder, undefined, '异色胶囊不该被移进组');
  assert.equal(
    useUiStore.getState().toast?.text,
    '「作品集」是蓝色分组，只收纳同色预设',
    '被拒绝要说清原因',
  );
});

await check('拖胶囊到面板顶部：弹命名框，确认后建出**同色**分组并移入', async () => {
  await folderFixture(false);
  await act(async () => {
    usePresetFolderStore.setState({ folders: [], loaded: true, persisted: '[]' });
  });
  await flush();

  const item = container.querySelector('[data-pf-preset-id="p2"]');
  assert.ok(item, '找不到胶囊');
  // 判断区只在拖拽期间存在，因此这里用一个「带空组名标记」的节点模拟它
  const zone = document.createElement('div');
  zone.setAttribute('data-pf-group-name', '');
  document.elementFromPoint = () => zone;

  dragFrom(item, [[420, 240]]);
  await flush();
  assert.equal(useUiStore.getState().drag?.hover?.kind, 'preset-group');
  assert.equal(useUiStore.getState().drag?.hover?.group, '', '空组名 = 落在建组判断区');

  releaseAt(420, 240);
  await flush();

  const prompt = useUiStore.getState().folderPrompt;
  assert.ok(prompt, '松手后应当弹出命名框');
  assert.equal(prompt.mode, 'create');
  assert.equal(prompt.presetId, 'p2', '命名框要记住是哪颗胶囊建的组');

  const input = container.querySelector('input[aria-label="分组名称"]');
  assert.ok(input, '命名框里没有输入框');
  assert.ok(input.value.length > 0, '默认名应当预填');

  const confirm = [...container.querySelectorAll('button')].find(
    (button) => (button.textContent ?? '').trim() === '确定',
  );
  assert.ok(confirm, '命名框里没有「确定」');
  await act(async () => {
    confirm.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await flush();

  const folders = usePresetFolderStore.getState().folders;
  assert.equal(folders.length, 1, '应当建出一个分组');
  assert.equal(folders[0].colorId, 'blue', '组色 = 那颗胶囊的颜色');
  assert.equal(
    usePresetStore.getState().presets.find((preset) => preset.id === 'p2').folder,
    folders[0].name,
    '胶囊应当已经进组',
  );
  assert.equal(useUiStore.getState().folderPrompt, null, '确认后弹窗要关掉');
});

await check('右键组砖：菜单只有展开 / 重命名 / 解散（不再有可见色勾选）', async () => {
  await folderFixture(false);

  const tile = container.querySelector('[data-pf-group-name="作品集"]');
  await act(async () => {
    tile.dispatchEvent(
      new window.MouseEvent('contextmenu', { bubbles: true, clientX: 300, clientY: 200 }),
    );
  });
  await flush();

  assert.equal(useUiStore.getState().presetGroupMenu?.name, '作品集', '右键没打开分组菜单');
  assert.equal(useUiStore.getState().presetGroupMenu?.colorId, 'blue', '菜单要记住是哪一色的组');
  // 菜单是 portal 到 body 的（坑 27）：只能从 document 查
  const menu = document.querySelector('[data-pf-group-menu="作品集"]');
  assert.ok(menu, '没有弹出分组菜单');
  const labels = [...menu.querySelectorAll('button')].map((button) =>
    (button.textContent ?? '').trim(),
  );
  assert.deepEqual(labels, ['展开分组', '重命名分组', '解散分组'], 'D112 之后菜单只剩这三项');
  assert.equal(menu.querySelector('[data-pf-folder-color]'), null, '不该再有可见色勾选格');
});

await check('右键胶囊 →「移出分组」：归属清掉，组空了就自动消失', async () => {
  await folderFixture(true);

  const item = container.querySelector('[data-pf-preset-id="p1"]');
  assert.ok(item, '展开的卡里找不到成员胶囊');
  await act(async () => {
    item.dispatchEvent(
      new window.MouseEvent('contextmenu', { bubbles: true, clientX: 300, clientY: 200 }),
    );
  });
  await flush();

  const menu = document.querySelector('.pf-menu');
  assert.ok(menu, '没有弹出预设菜单');
  const moveOut = [...menu.querySelectorAll('button')].find((button) =>
    (button.textContent ?? '').includes('移出分组'),
  );
  assert.ok(moveOut, '菜单里缺少「移出分组」');

  await act(async () => {
    moveOut.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await flush();

  const moved = usePresetStore.getState().presets.find((preset) => preset.id === 'p1');
  assert.equal(moved.folder, undefined, '移出后不该还留着 folder 字段');
  assert.equal(usePresetStore.getState().presets.length, 3, '移出分组绝不删条目');
  assert.equal(usePresetFolderStore.getState().folders.length, 0, '组空了就该自动消失');
});

await check('右键组砖 → 解散分组：成员回到未分组，条目一条不少', async () => {
  await folderFixture(false);

  const tile = container.querySelector('[data-pf-group-name="作品集"]');
  await act(async () => {
    tile.dispatchEvent(
      new window.MouseEvent('contextmenu', { bubbles: true, clientX: 300, clientY: 200 }),
    );
  });
  await flush();

  const menu = document.querySelector('[data-pf-group-menu="作品集"]');
  assert.ok(menu, '没有弹出分组菜单');
  const dissolve = [...menu.querySelectorAll('button')].find((button) =>
    (button.textContent ?? '').includes('解散分组'),
  );
  assert.ok(dissolve, '菜单里缺少「解散分组」');

  await act(async () => {
    dissolve.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await flush();

  const presets = usePresetStore.getState().presets;
  assert.equal(presets.length, 3, '解散绝不删条目');
  assert.equal(presets.every((preset) => preset.folder === undefined), true, '成员都要回到未分组');
  assert.equal(usePresetFolderStore.getState().folders.length, 0, '组实体也要一起删掉');
});

  await check('展开卡里任意空白处都能右键出一份分组菜单（D114）', async () => {
    await folderFixture(true);

    const card = container.querySelector('[data-pf-group-name="作品集"]');
    assert.ok(card, '找不到展开的分组卡');
    // 拿卡片内部列表当落点：不是组头、也不是胶囊
    const list = card.querySelector('.pf-preset-list');
    assert.ok(list, '展开卡里没有胶囊列表');
    await act(async () => {
      list.dispatchEvent(
        new window.MouseEvent('contextmenu', { bubbles: true, clientX: 320, clientY: 260 }),
      );
    });
    await flush();

    assert.equal(
      useUiStore.getState().presetGroupMenu?.name,
      '作品集',
      '卡片内部空白处右键应当出分组菜单',
    );
    assert.equal(
      useUiStore.getState().presetMenu,
      null,
      '空白处右键不该同时弹出预设菜单',
    );
  });

  await check('右键卡里的胶囊仍然出「预设菜单」，不会两个菜单一起弹（D114）', async () => {
    await folderFixture(true);

    const item = container.querySelector('[data-pf-preset-id="p1"]');
    assert.ok(item, '展开的卡里找不到成员胶囊');
    await act(async () => {
      item.dispatchEvent(
        new window.MouseEvent('contextmenu', { bubbles: true, clientX: 320, clientY: 260 }),
      );
    });
    await flush();

    assert.equal(useUiStore.getState().presetMenu?.presetId, 'p1', '右键胶囊应当出预设菜单');
    assert.equal(useUiStore.getState().presetGroupMenu, null, '不该同时弹出分组菜单');
  });

  /* ----- D119：组的展开状态要像界面尺寸一样被记住 ----- */

  await check('D119：预设还没读完 / 读取失败时，pruneFolders 不许清空组实体', async () => {
    const folderStore = () => usePresetFolderStore.getState();
    const seed = async (presetState) => {
      await act(async () => {
        usePresetFolderStore.setState({
          folders: [{ name: '回归组', colorId: 'red', expanded: true }],
          loaded: true,
          loading: false,
          loadError: null,
          persisted: '[]',
        });
        usePresetStore.setState({
          presets: [],
          loaded: false,
          loading: true,
          loadError: null,
          ...presetState,
        });
        await Promise.resolve();
      });
      await flush();
      await act(async () => {
        folderStore().pruneFolders();
        await Promise.resolve();
      });
      await flush();
    };

    // ① 启动竞态：folders 先读完、presets 还在读 —— 这一瞬间判空会把组连展开状态一起删掉
    await seed({});
    assert.equal(folderStore().folders.length, 1, '预设未加载时不许判空组');
    assert.equal(folderStore().folders[0].expanded, true, '展开状态必须原样还在');

    // ② 读取失败同样不许判空（否则一次磁盘错误就抹掉全部分组）
    await seed({ loaded: true, loading: false, loadError: '预设读取失败：磁盘错误' });
    assert.equal(folderStore().folders.length, 1, '读取失败时也不许清空组');

    // ③ 正常读到、确实没有成员 → 仍然照常清理（D112 的“空组自动消失”不能被这条改坏）
    await act(async () => {
      usePresetStore.setState({
        presets: [],
        loaded: true,
        loading: false,
        loadError: null,
      });
      await Promise.resolve();
    });
    await flush();
    await act(async () => {
      folderStore().pruneFolders();
      await Promise.resolve();
    });
    await flush();
    assert.equal(folderStore().folders.length, 0, '正常判空仍要清掉空组');
  });

  await check('D119：展开状态会落盘，重启后按文件恢复（组实体丢了也能补回来）', async () => {
    const presetApi = require(path.join(OUT, 'api/presets.js'));
    const folderSaves = [];
    presetApi.savePresetFolders = async (folders) => {
      folderSaves.push(JSON.parse(JSON.stringify(folders)));
    };

    const member = {
      id: 'p-remember',
      label: '记得住',
      english: '',
      weight: 100,
      colorId: 'red',
      folder: '作品集',
      createdAt: 1,
      updatedAt: 1,
    };

    // 文件丢过：成员还在、组实体是空的（用户实测遇到的正是这个状态）
    await act(async () => {
      usePresetStore.setState({
        presets: [member],
        loaded: true,
        loading: false,
        loadError: null,
      });
      usePresetFolderStore.setState({
        folders: [],
        loaded: true,
        loading: false,
        loadError: null,
        persisted: '[]',
      });
      await Promise.resolve();
    });
    await flush();

    await act(async () => {
      usePresetFolderStore.getState().toggleFolderExpanded({ name: '作品集', colorId: 'red' });
      await Promise.resolve();
    });
    await flush();
    assert.deepEqual(
      usePresetFolderStore.getState().folders,
      [{ name: '作品集', colorId: 'red', expanded: true }],
      '第一次展开要把组实体补回来，并记住“已展开”',
    );

    // 落盘是 400ms 防抖：等它过去
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 520));
    });
    await flush();
    assert.ok(folderSaves.length > 0, '切换展开后必须落盘');
    assert.deepEqual(
      folderSaves.at(-1),
      [{ name: '作品集', colorId: 'red', expanded: true }],
      '落盘内容要带上 expanded',
    );

    // 模拟重启：内存清空，按磁盘内容重读
    presetApi.loadPresetFolders = async () => folderSaves.at(-1);
    await act(async () => {
      usePresetFolderStore.setState({ folders: [], loaded: false, loading: false });
      await Promise.resolve();
    });
    await flush();
    await act(async () => {
      await usePresetFolderStore.getState().loadFolders();
    });
    await flush();
    assert.deepEqual(
      usePresetFolderStore.getState().folders,
      [{ name: '作品集', colorId: 'red', expanded: true }],
      '重启后展开状态必须还在（随机折叠就是这条没生效）',
    );
  });

  // -------------------------------------------------------------------------
  section('输入框胶囊的内联权重控件（D120 / UI.html 原稿）');

  const weightModuleId = useModuleStore.getState().selectedModuleId;
  const weightModuleBefore = useModuleStore.getState().modules.find(
    (module) => module.id === weightModuleId,
  );
  const weightSourceBefore = weightModuleBefore.sourceText;
  let weightCapsuleId = '';
  let weightPill = null;

  /** 药丸里的动作都是非聚焦 span，用 pointerdown 触发（与真实点击同一条路） */
  const pressWeight = async (pill, action) => {
    const el = pill.querySelector(`[data-capsule-weight-action="${action}"]`);
    assert.ok(el, `药丸里没有 ${action} 按钮`);
    await act(() => {
      el.dispatchEvent(
        new window.MouseEvent('pointerdown', { bubbles: true, cancelable: true }),
      );
    });
    await flush();
  };

  const capsuleOf = () =>
    useModuleStore
      .getState()
      .modules.find((module) => module.id === weightModuleId)
      .capsules.find((capsule) => capsule.id === weightCapsuleId);

  await check('权重控件就在药丸里：默认 1、未加权不带标记', async () => {
    await act(() => {
      useModuleStore.getState().setSourceText(weightModuleId, '女孩，长发');
      useModuleStore.getState().insertCapsule(
        weightModuleId,
        {
          presetId: 'p-weight',
          label: '权重测试',
          english: 'masterpiece, best quality',
          colorId: 'red',
        },
        'after-capsules',
      );
    });
    await flush();

    const editor = container.querySelector('.pf-source__input');
    weightPill = editor.querySelector('[data-capsule-id]');
    assert.ok(weightPill, '药丸没有渲染出来');
    weightCapsuleId = weightPill.getAttribute('data-capsule-id');

    const value = weightPill.querySelector('.pf-capsule__weight-value');
    assert.ok(value, '药丸里应当有权重数值（D120 是内联控件，不是弹层）');
    assert.equal(value.textContent, '1', '默认权重显示 1');
    assert.equal(weightPill.classList.contains('pf-capsule--weighted'), false);
    assert.equal(document.querySelector('.pf-menu--capsule-weight'), null, '不再有悬浮菜单');
  });

  await check('点加号走 0.05 写进胶囊权重字段；english 不动、药丸就地更新、旧输出不变', async () => {
    const presetsBefore = usePresetStore.getState().presets;
    const sourceBefore = useModuleStore
      .getState()
      .modules.find((module) => module.id === weightModuleId).sourceText;

    await pressWeight(weightPill, 'plus');
    assert.equal(capsuleOf().weight, 1.05, '权重 1.05 应当写进数据字段');
    assert.equal(
      capsuleOf().english,
      'masterpiece, best quality',
      'D121：english 保持原始内容，不再被写回括号',
    );
    assert.equal(
      container.querySelector(`[data-capsule-id="${weightCapsuleId}"]`),
      weightPill,
      '药丸节点不该被换掉（换掉就是整块重建、光标会跳）',
    );
    assert.equal(weightPill.querySelector('.pf-capsule__weight-value').textContent, '1.05');
    assert.equal(weightPill.classList.contains('pf-capsule--weighted'), true);
    assert.equal(usePresetStore.getState().presets, presetsBefore, '预设库不能被牵连');

    const moduleNow = useModuleStore
      .getState()
      .modules.find((module) => module.id === weightModuleId);
    assert.equal(moduleNow.sourceText, sourceBefore, '源内容一个字都不能变');
    assert.equal(moduleNow.sourceText.includes('1.05'), false, '权重数字不许漏进源内容');

    await pressWeight(weightPill, 'plus');
    assert.equal(capsuleOf().weight, 1.1, '再加一次是 1.1');

    await pressWeight(weightPill, 'minus');
    await pressWeight(weightPill, 'minus');
    assert.equal(capsuleOf().weight, 1, '退回 1');
    assert.equal(capsuleOf().english, 'masterpiece, best quality', 'english 始终没被改过');
    assert.equal(weightPill.querySelector('.pf-capsule__weight-value').textContent, '1');
    assert.equal(weightPill.classList.contains('pf-capsule--weighted'), false);
  });

  await check('双击数字手输：2.5 生效、认不出的不写库、Esc 放弃、同值不换数组', async () => {
    const pill = weightPill;
    const valueOf = () => pill.querySelector('.pf-capsule__weight-value');
    const inputOf = () => pill.querySelector('.pf-capsule__weight-input');

    const startEditing = async () => {
      await act(() => {
        valueOf().dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
      });
      await flush();
      assert.ok(inputOf(), '双击数字应当就地出现输入框');
    };

    const typeAndPress = (text, key) => {
      const box = inputOf();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(box, text);
      box.dispatchEvent(new window.Event('input', { bubbles: true }));
      if (key) box.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }));
    };

    await startEditing();
    await act(() => typeAndPress('2.5', 'Enter'));
    await flush();
    assert.equal(capsuleOf().weight, 2.5, '2.5 应当生效');
    assert.equal(valueOf().textContent, '2.5');
    assert.equal(inputOf(), null, '提交后回到数字显示');

    // 认不出的输入：不写库、数值保持原样
    await startEditing();
    await act(() => typeAndPress('abc', 'Enter'));
    await flush();
    assert.equal(capsuleOf().weight, 2.5, '无效输入不能改库');
    assert.equal(valueOf().textContent, '2.5');

    // Esc 放弃：连合法值也不写
    await startEditing();
    await act(() => typeAndPress('1.2', 'Escape'));
    await flush();
    assert.equal(capsuleOf().weight, 2.5, 'Esc 应当放弃本次输入');
    assert.equal(inputOf(), null, 'Esc 之后输入框要收掉');

    // 幂等：同值重输不换数组（否则草稿会被无谓写盘）
    const modulesBefore = useModuleStore.getState().modules;
    await startEditing();
    await act(() => typeAndPress('2.5', 'Enter'));
    await flush();
    assert.equal(capsuleOf().weight, 2.5, '同值重输不套娃');
    assert.equal(useModuleStore.getState().modules, modulesBefore, '同值重输不该换掉数组引用');
  });

  await check('悬停展开是 CSS 契约（不改 DOM、不需要状态）：常态收起、悬停铺开、已加权常态露数值', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles', 'module.css'), 'utf8');

    const baseWeight = css.match(/\.pf-capsule__weight\s*\{[^}]*\}/)?.[0] ?? '';
    assert.ok(/display:\s*none/.test(baseWeight), '权重区常态必须不占位（display: none）');
    assert.ok(/border-left:/.test(baseWeight), '权重区与名字之间要有分隔线');

    const weighted = css.match(/\.pf-capsule--weighted\s+\.pf-capsule__weight\s*\{[^}]*\}/)?.[0] ?? '';
    assert.ok(/display:\s*inline-flex/.test(weighted), '已加权时常态就露数值');

    const hoverWeight = css.match(/\.pf-capsule--inline:hover\s+\.pf-capsule__weight\s*\{[^}]*\}/)?.[0] ?? '';
    assert.ok(/display:\s*inline-flex/.test(hoverWeight), '悬停要展开权重区');

    const hoverStep = css.match(/\.pf-capsule--inline:hover\s+\.pf-capsule__weight-step\s*\{[^}]*\}/)?.[0] ?? '';
    assert.ok(/display:\s*inline-block/.test(hoverStep), '悬停才出加减号');

    const hoverName = css.match(/\.pf-capsule--inline:hover\s+\.pf-capsule__name\s*\{[^}]*\}/)?.[0] ?? '';
    assert.ok(/opacity:\s*0\.6/.test(hoverName), '悬停时名字要让位（压到 0.6）');
  });

  // 收尾：摘掉夹具胶囊、源内容复原，免得影响后面的断言
  await act(async () => {
    useModuleStore.getState().removeCapsule(weightModuleId, weightCapsuleId);
    useModuleStore.getState().setSourceText(weightModuleId, weightSourceBefore);
  });
  await flush();

// 收尾：清掉关键词与字典数据，免得影响后面的断言
  await act(async () => {
    useDictionaryStore.setState({ items: [], entriesById: {} });
    useTagStore.setState({ presets: [], loaded: false });
    useUiStore.setState({
      presetSearchKeyword: '',
      libraryView: 'presets',
      libraryPageSize: 100,
    });
  });
  await flush();

  // 等所有游离的异步断言收尾，再打印总计（避免顺序错乱）
  await flush();

  // -------------------------------------------------------------------------
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
