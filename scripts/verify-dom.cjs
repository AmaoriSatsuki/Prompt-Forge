#!/usr/bin/env node
/**
 * DOM 层断言（jsdom）。
 *
 * 为什么需要这一层：源内容编辑器用 contenteditable，React 不能托管它的子节点，
 * 因此「DOM ↔ 源内容字符串」的转换完全由我们自己写 —— 这是整个应用最容易丢数据的地方。
 * 这里用真实 DOM 做往返断言：渲染 → 序列化必须一字不差，外来格式必须被丢弃，
 * 胶囊的英文内容必须进不了 DOM。
 *
 * 运行：npm run verify:dom
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

const {
  CAPSULE_ID_ATTR,
  CAPSULE_COLOR_ATTR,
  CAPSULE_WEIGHT_ACTION_ATTR,
  CAPSULE_WEIGHT_ATTR,
  CAPSULE_WEIGHT_VALUE_CLASS,
  CAPSULE_WEIGHTED_CLASS,
  createCapsulePill,
  readCapsulePillWeight,
  updateCapsulePillWeight,
} = require(path.join(OUT, 'components/module/capsulePill.js'));
const {
  domMatchesSource,
  normalizeEditorText,
  placeCaretAtEnd,
  renderSourceInto,
  serializeSourceDom,
} = require(path.join(OUT, 'components/module/sourceDom.js'));
const {
  buildTranslatePlan,
  composeCopyText,
  normalizeTranslationBody,
  capsuleAnchor,
  countCapsuleOccurrences,
  parseSource,
  removeCapsuleAnchors,
  restoreTranslation,
  stripAnchors,
} = require(path.join(OUT, 'utils/placeholder.js'));
const { insertAtEnd, insertAfterCapsules } = require(path.join(OUT, 'utils/text.js'));

const dom = new JSDOM('<!doctype html><html><body><div id="editor"></div></body></html>');
const { document } = dom.window;
const editor = document.getElementById('editor');

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

function reset() {
  while (editor.firstChild) editor.removeChild(editor.firstChild);
}

const CAPSULES = [
  { id: 'cap_1', label: '冷峻文风', presetId: 'p1', english: 'in a cold, restrained tone', colorId: 'blue' },
  { id: 'cap_2', label: '商务语气', presetId: 'p2', english: 'in a formal business tone', colorId: 'pink' },
];
// 编辑器要的是「中文名 + 归属色」这一份视图，不是整条胶囊
const labels = new Map(
  CAPSULES.map((capsule) => [capsule.id, { label: capsule.label, colorId: capsule.colorId }]),
);
const known = new Set(labels.keys());

// ---------------------------------------------------------------------------
section('渲染 → 序列化 往返（丢了任何字符都是数据丢失）');

check('纯中文文本往返一致', () => {
  reset();
  renderSourceInto(editor, '把这段话改写得更礼貌', labels);
  assert.equal(serializeSourceDom(editor, known), '把这段话改写得更礼貌');
});

check('换行与空行往返一致', () => {
  reset();
  renderSourceInto(editor, '第一行\n第二行\n\n第三行', labels);
  assert.equal(serializeSourceDom(editor, known), '第一行\n第二行\n\n第三行');
});

check('带胶囊的源内容往返一致', () => {
  reset();
  const source = `请用 ${capsuleAnchor('cap_1')} 把这段话改写得更礼貌，末尾补一句 ${capsuleAnchor('cap_2')}`;
  renderSourceInto(editor, source, labels);
  assert.equal(serializeSourceDom(editor, known), source);
});

check('同一个胶囊出现多次也能原样还原', () => {
  reset();
  const source = `${capsuleAnchor('cap_1')} 开头，中间，${capsuleAnchor('cap_1')} 结尾`;
  renderSourceInto(editor, source, labels);
  assert.equal(serializeSourceDom(editor, known), source);
  assert.equal(countCapsuleOccurrences(source, 'cap_1'), 2);
});

check('空内容往返为空串', () => {
  reset();
  renderSourceInto(editor, '', labels);
  assert.equal(serializeSourceDom(editor, known), '');
});

// ---------------------------------------------------------------------------
section('药丸节点：只带中文命名，英文内容进不了 DOM（需求 4）');

check('药丸带 data-capsule-id，且是 contenteditable=false 的原子节点', () => {
  reset();
  renderSourceInto(editor, capsuleAnchor('cap_1'), labels);
  const pills = editor.querySelectorAll(`[${CAPSULE_ID_ATTR}]`);
  assert.equal(pills.length, 1);
  assert.equal(pills[0].getAttribute(CAPSULE_ID_ATTR), 'cap_1');
  assert.equal(pills[0].getAttribute('contenteditable'), 'false');
  assert.equal(pills[0].classList.contains('pf-capsule'), true);
  assert.equal(pills[0].classList.contains('pf-capsule--inline'), true);
});

check('药丸上显示的是中文命名', () => {
  reset();
  renderSourceInto(editor, capsuleAnchor('cap_1'), labels);
  const pill = editor.querySelector(`[${CAPSULE_ID_ATTR}]`);
  assert.equal(pill.querySelector('.pf-capsule__text').textContent, '冷峻文风');
});

check('英文内容绝不出现在编辑器 DOM 里', () => {
  reset();
  renderSourceInto(editor, `请用 ${capsuleAnchor('cap_1')} 改写`, labels);
  const html = editor.innerHTML;
  assert.ok(html.includes('冷峻文风'), '应当显示中文命名');
  for (const secret of CAPSULES.map((capsule) => capsule.english)) {
    assert.equal(html.includes(secret), false, `英文内容泄漏到编辑器：${secret}`);
  }
});

check('命名缺失时给药丸一个中文兜底名，而不是空白', () => {
  const pill = createCapsulePill(document, 'cap_x', '');
  assert.equal(pill.querySelector('.pf-capsule__text').textContent, '未命名胶囊');
});

// ---------------------------------------------------------------------------
section('药丸内联权重控件（D120 / UI.html 原稿）');

check('药丸 = 名字块 + 权重区；不加权时数值是 1、不挂 weighted 类', () => {
  const pill = createCapsulePill(document, 'cap_1', { label: '冷峻文风', colorId: 'blue' });
  const name = pill.querySelector('.pf-capsule__name');
  assert.ok(name, '缺名字块（圆点与中文名要包在一层里，悬停才好让位）');
  assert.equal(name.querySelector('.pf-capsule__dot') !== null, true, '名字块里要有圆点');
  assert.equal(name.querySelector('.pf-capsule__text').textContent, '冷峻文风');

  const area = pill.querySelector('.pf-capsule__weight');
  assert.ok(area, '缺权重区');
  assert.equal(area.querySelector(`.${CAPSULE_WEIGHT_VALUE_CLASS}`).textContent, '1');
  assert.equal(area.querySelectorAll(`[${CAPSULE_WEIGHT_ACTION_ATTR}]`).length, 2, '加减各一个');
  assert.equal(pill.getAttribute(CAPSULE_WEIGHT_ATTR), '1');
  assert.equal(pill.classList.contains(CAPSULE_WEIGHTED_CLASS), false, '权重 1 不该挂 weighted 类');
});

check('加权药丸：常态挂 weighted 类、数值直接是权重', () => {
  const pill = createCapsulePill(document, 'cap_1', { label: '冷峻文风', colorId: 'blue', weight: 1.5 });
  assert.equal(pill.getAttribute(CAPSULE_WEIGHT_ATTR), '1.5');
  assert.equal(pill.classList.contains(CAPSULE_WEIGHTED_CLASS), true);
  assert.equal(pill.querySelector(`.${CAPSULE_WEIGHT_VALUE_CLASS}`).textContent, '1.5');
  assert.equal(readCapsulePillWeight(pill), 1.5);
});

check('就地改权重：只动数值那一格，不换药丸节点（光标因此不会跳）', () => {
  const pill = createCapsulePill(document, 'cap_1', { label: '冷峻文风', colorId: 'blue' });
  const nameBefore = pill.querySelector('.pf-capsule__name');
  updateCapsulePillWeight(pill, 1.05);
  assert.equal(pill.getAttribute(CAPSULE_WEIGHT_ATTR), '1.05');
  assert.equal(pill.classList.contains(CAPSULE_WEIGHTED_CLASS), true);
  assert.equal(pill.querySelector(`.${CAPSULE_WEIGHT_VALUE_CLASS}`).textContent, '1.05');
  assert.equal(pill.querySelector('.pf-capsule__name'), nameBefore, '名字块不该被替换');
  updateCapsulePillWeight(pill, 1);
  assert.equal(pill.getAttribute(CAPSULE_WEIGHT_ATTR), '1');
  assert.equal(pill.classList.contains(CAPSULE_WEIGHTED_CLASS), false, '回到 1 要摘掉 weighted 类');
});

check('到边界时加减号变不可用（aria-disabled），点了不写库', () => {
  const pill = createCapsulePill(document, 'cap_1', { label: '冷峻文风', colorId: 'blue' });
  const minus = pill.querySelector(`[${CAPSULE_WEIGHT_ACTION_ATTR}="minus"]`);
  const plus = pill.querySelector(`[${CAPSULE_WEIGHT_ACTION_ATTR}="plus"]`);
  assert.equal(minus.getAttribute('aria-disabled'), 'false', '默认 1 时两边都能按');
  assert.equal(plus.getAttribute('aria-disabled'), 'false');

  updateCapsulePillWeight(pill, 0.1);
  assert.equal(minus.getAttribute('aria-disabled'), 'true', '下限（0.1）时减号应当不可用');
  assert.equal(plus.getAttribute('aria-disabled'), 'false');

  updateCapsulePillWeight(pill, 3);
  assert.equal(plus.getAttribute('aria-disabled'), 'true', '上限（3）时加号应当不可用');
  assert.equal(minus.getAttribute('aria-disabled'), 'false');
});

check('加减与非焦点控件：tabindex=-1（点了不会把焦点从编辑器抢走）', () => {
  const pill = createCapsulePill(document, 'cap_1', { label: '冷峻文风', colorId: 'blue' });
  for (const el of pill.querySelectorAll(`[${CAPSULE_WEIGHT_ACTION_ATTR}], .${CAPSULE_WEIGHT_VALUE_CLASS}`)) {
    assert.equal(el.getAttribute('tabindex'), '-1');
    assert.equal(el.getAttribute('role'), 'button');
  }
});

check('权重控件绝不进序列化：药丸里加多少字，源内容还是那个锚点', () => {
  reset();
  renderSourceInto(editor, `${capsuleAnchor('cap_1')} 请改写`, labels);
  const pill = editor.querySelector(`[${CAPSULE_ID_ATTR}]`);
  updateCapsulePillWeight(pill, 1.25);
  // 连手输框一起塞进去，模拟「正在手输」的那一帧
  const input = document.createElement('input');
  input.className = 'pf-capsule__weight-input';
  input.value = '9.99';
  pill.appendChild(input);

  assert.equal(serializeSourceDom(editor, known), `${capsuleAnchor('cap_1')} 请改写`);
  assert.equal(domMatchesSource(editor, `${capsuleAnchor('cap_1')} 请改写`, labels), false, '权重变了就该判不一致');
  assert.equal(
    domMatchesSource(editor, `${capsuleAnchor('cap_1')} 请改写`, new Map(labels).set('cap_1', { label: '冷峻文风', colorId: 'blue', weight: 1.25 })),
    true,
    '权重对上之后应当一致（不必重建）',
  );
});

// ---------------------------------------------------------------------------
section('外来内容与浏览器怪癖');

check('粘贴带来的加粗 / 内联样式会被丢弃，只留纯文本', () => {
  reset();
  editor.innerHTML = '<b>加粗</b><span style="color:red">彩色</span>';
  assert.equal(serializeSourceDom(editor, known), '加粗彩色');
});

check('Chromium 的 div 分行能被正确序列化', () => {
  reset();
  editor.innerHTML = '<div>第一行</div><div>第二行</div>';
  assert.equal(serializeSourceDom(editor, known), '第一行\n第二行');
});

check('单个包裹 div 不会多出前导换行', () => {
  reset();
  editor.innerHTML = '<div>只有一行</div>';
  assert.equal(serializeSourceDom(editor, known), '只有一行');
});

check('孤立 br（内容被删空的残留）被归一成空串', () => {
  reset();
  editor.appendChild(document.createElement('br'));
  assert.equal(serializeSourceDom(editor, known), '\n');
  assert.equal(normalizeEditorText(serializeSourceDom(editor, known)), '');
});

check('未知胶囊 id 的锚点保持为普通文本，不会被误吞', () => {
  reset();
  renderSourceInto(editor, '看看 [[cap:根本不存在]] 这段', labels);
  assert.equal(editor.querySelectorAll(`[${CAPSULE_ID_ATTR}]`).length, 0);
  assert.equal(serializeSourceDom(editor, known), '看看 [[cap:根本不存在]] 这段');
});

// ---------------------------------------------------------------------------
section('DOM 与源内容的一致性判定（决定要不要重建 DOM）');

check('一致时判定为一致 —— 打字路径因此不会重建 DOM、不会打断输入法', () => {
  reset();
  renderSourceInto(editor, `请用 ${capsuleAnchor('cap_1')} 改写`, labels);
  assert.equal(domMatchesSource(editor, `请用 ${capsuleAnchor('cap_1')} 改写`, labels), true);
});

check('胶囊改名后判定为不一致 —— 药丸文字需要更新', () => {
  reset();
  const source = `请用 ${capsuleAnchor('cap_1')} 改写`;
  renderSourceInto(editor, source, labels);
  const renamed = new Map([
    ['cap_1', '克制的冷峻文风'],
    ['cap_2', '商务语气'],
  ]);
  assert.equal(domMatchesSource(editor, source, renamed), false);
});

check('拖入新胶囊后判定为不一致', () => {
  reset();
  renderSourceInto(editor, '把这段话改写得更礼貌', labels);
  const withCapsule = insertAtEnd('把这段话改写得更礼貌', capsuleAnchor('cap_1'));
  assert.equal(domMatchesSource(editor, withCapsule, labels), false);
});

check('删掉胶囊后判定为不一致', () => {
  reset();
  const source = insertAtEnd('把这段话改写得更礼貌', capsuleAnchor('cap_1'));
  renderSourceInto(editor, source, labels);
  assert.equal(domMatchesSource(editor, '把这段话改写得更礼貌', labels), false);
});

// ---------------------------------------------------------------------------
section('光标');

check('placeCaretAtEnd 把光标放到内容末尾', () => {
  reset();
  renderSourceInto(editor, '第一行\n第二行', labels);
  placeCaretAtEnd(editor);

  const selection = document.getSelection();
  assert.ok(selection, 'jsdom 未提供 selection');
  assert.equal(selection.rangeCount, 1);

  const caret = selection.getRangeAt(0);
  assert.equal(caret.collapsed, true);

  const tail = document.createRange();
  tail.selectNodeContents(editor);
  tail.setStart(caret.startContainer, caret.startOffset);
  assert.equal(tail.toString(), '', '光标之后不应还有内容');
});

// ---------------------------------------------------------------------------
section('端到端：拖入胶囊 → 生成请求 → 还原英文（需求 4 的关键链路）');

check('请求体里只有纯中文，绝不含术语英文与胶囊锚点（需求 6：不再用占位符）', () => {
  let sourceText = '把这段话改写得更礼貌';
  sourceText = insertAtEnd(sourceText, capsuleAnchor('cap_1'));
  sourceText = insertAfterCapsules(sourceText, capsuleAnchor('cap_2'));

  reset();
  renderSourceInto(editor, sourceText, labels);
  assert.equal(serializeSourceDom(editor, known), sourceText, '编辑器往返不一致');

  const plan = buildTranslatePlan(sourceText, CAPSULES);
  assert.equal(plan.text.trim(), '把这段话改写得更礼貌');
  for (const capsule of CAPSULES) {
    assert.equal(plan.text.includes(capsule.english), false, '术语英文泄漏进请求体');
    assert.equal(plan.text.includes(capsule.label), false, '中文命名不应出现在请求体里');
  }
  assert.equal(plan.text.includes('[[PF_'), false, '不该再有任何占位符');
  assert.equal(plan.text.includes('[[cap:'), false, '锚点不该进请求体');
  // 胶囊英文按原顺序取出来，等着拼到译文最前面
  assert.deepEqual(plan.capsuleEnglish, [
    'in a formal business tone',
    'in a cold, restrained tone',
  ]);
});

check('复制时术语英文按原顺序拼到最前面；展示时只有译文（需求 1）', () => {
  const sourceText = insertAtEnd('把这段话改写得更礼貌', capsuleAnchor('cap_1'));
  const plan = buildTranslatePlan(sourceText, CAPSULES);
  const translated = 'Rewrite this paragraph to be more polite';

  assert.equal(
    composeCopyText(plan.capsuleEnglish, translated),
    'in a cold, restrained tone, Rewrite this paragraph to be more polite',
  );
  // 展示层不拼术语英文
  assert.equal(normalizeTranslationBody(translated), translated);
  assert.equal(normalizeTranslationBody(translated).includes('cold'), false);
});

check('只拖了胶囊还没写中文时：复制只有术语英文，展示为空', () => {
  const plan = buildTranslatePlan(capsuleAnchor('cap_1'), CAPSULES);
  assert.equal(plan.text, '');
  assert.equal(composeCopyText(plan.capsuleEnglish, ''), 'in a cold, restrained tone');
  assert.equal(normalizeTranslationBody(''), '');
});

// ---------------------------------------------------------------------------
section('其余纯文本工具（在真实 DOM 之外也成立）');

check('stripAnchors 去掉胶囊只留中文', () => {
  const source = `请用 ${capsuleAnchor('cap_1')} 改写`;
  assert.equal(stripAnchors(source, known), '请用  改写');
});

check('removeCapsuleAnchors 只清掉指定胶囊', () => {
  const source = `${capsuleAnchor('cap_1')} 与 ${capsuleAnchor('cap_2')}`;
  assert.equal(removeCapsuleAnchors(source, 'cap_1'), ' 与 [[cap:cap_2]]');
});

check('parseSource 对未知 id 不做切分', () => {
  const segments = parseSource('a [[cap:cap_1]] b [[cap:未知]] c', known);
  assert.deepEqual(segments, [
    { kind: 'text', text: 'a ' },
    { kind: 'capsule', capsuleId: 'cap_1' },
    { kind: 'text', text: ' b [[cap:未知]] c' },
  ]);
});

// ---------------------------------------------------------------------------
section('词典 Tag（D85 → D110）：与普通胶囊同一种药丸，只显示中文名');

/**
 * 在原有胶囊视图上多一条词典 Tag。
 * D110 起它与普通胶囊共用**同一份视图**（只有中文名 + 归属色），所以这里不再喂英文。
 */
const TAG_LABELS = new Map([
  ...labels,
  ['cap_tag', { label: '长发', colorId: 'dictionary' }],
]);
const tagKnown = new Set(TAG_LABELS.keys());
const TAG_ENGLISH = 'long hair';

check('Tag 渲染成药丸：色点 + 中文名，英文词条一个字都不进 DOM', () => {
  reset();
  renderSourceInto(editor, `${capsuleAnchor('cap_tag')} 一个长发女生`, TAG_LABELS);
  const node = editor.querySelector(`[${CAPSULE_ID_ATTR}]`);
  assert.ok(node, '找不到 Tag 节点');
  assert.equal(node.querySelector('.pf-capsule__text').textContent, '长发', 'Tag 要显示中文名（与输出框里的胶囊一致）');
  assert.equal(node.classList.contains('pf-capsule'), true, 'Tag 必须套药丸样式');
  assert.equal(node.classList.contains('pf-capsule--inline'), true, 'Tag 是编辑器里的行内药丸');
  assert.ok(node.querySelector('.pf-capsule__dot'), 'Tag 药丸必须有圆点');
  assert.equal(node.getAttribute('contenteditable'), 'false', 'Tag 是原子节点（退格一次删掉）');
  assert.equal(node.getAttribute(CAPSULE_COLOR_ATTR), 'dictionary', 'Tag 的归属色必须是词典色');
  assert.equal(node.getAttribute('data-pf-external'), null, '中文名不是外部内容，不该标 external');
  assert.equal(editor.innerHTML.includes(TAG_ENGLISH), false, 'Tag 的英文不许进 DOM');
});

check('Tag 与普通胶囊同构：类名、原子性、圆点完全一致（差距只有归属色）', () => {
  reset();
  renderSourceInto(
    editor,
    `${capsuleAnchor('cap_1')}${capsuleAnchor('cap_tag')} 请改写`,
    TAG_LABELS,
  );
  const pill = editor.querySelector(`[${CAPSULE_ID_ATTR}="cap_1"]`);
  const tag = editor.querySelector(`[${CAPSULE_ID_ATTR}="cap_tag"]`);
  assert.ok(pill && tag, '两种胶囊都要渲染出来');
  assert.equal(tag.className, pill.className, 'Tag 与普通胶囊必须是同一个类名组合');
  assert.equal(tag.getAttribute('contenteditable'), pill.getAttribute('contenteditable'));
  assert.equal(tag.querySelectorAll('.pf-capsule__dot').length, 1, 'Tag 只该有一个圆点');
  assert.equal(tag.getAttribute('title'), '长发（按退格键可移除）', '悬停提示与普通药丸同一口径');
});

check('Tag 的锚点 ↔ 药丸往返一致（不会丢数据）', () => {
  reset();
  const source = `${capsuleAnchor('cap_tag')} 一个长发女生`;
  renderSourceInto(editor, source, TAG_LABELS);
  assert.equal(serializeSourceDom(editor, tagKnown), source, '序列化必须还原成锚点');
  assert.equal(domMatchesSource(editor, source, TAG_LABELS), true, 'DOM 应当与源内容一致');
});

check('Tag 改名：DOM 被判定为不一致、需要重建（否则药丸停在旧名字上）', () => {
  reset();
  const source = `${capsuleAnchor('cap_tag')} 一个长发女生`;
  renderSourceInto(editor, source, TAG_LABELS);
  const renamed = new Map(TAG_LABELS);
  renamed.set('cap_tag', { label: '非常长的头发', colorId: 'dictionary' });
  assert.equal(domMatchesSource(editor, source, renamed), false);
  renderSourceInto(editor, source, renamed);
  assert.equal(
    editor.querySelector(`[${CAPSULE_ID_ATTR}]`).querySelector('.pf-capsule__text').textContent,
    '非常长的头发',
  );
});

check('普通胶囊与 Tag 混排：药丸各自显示中文名，两种英文都不进 DOM', () => {
  reset();
  renderSourceInto(
    editor,
    `${capsuleAnchor('cap_1')}${capsuleAnchor('cap_tag')} 请改写`,
    TAG_LABELS,
  );
  const pill = editor.querySelector(`[${CAPSULE_ID_ATTR}="cap_1"]`);
  const tag = editor.querySelector(`[${CAPSULE_ID_ATTR}="cap_tag"]`);
  assert.equal(pill.querySelector('.pf-capsule__text').textContent, '冷峻文风');
  assert.equal(tag.querySelector('.pf-capsule__text').textContent, '长发');
  assert.equal(editor.innerHTML.includes('in a cold, restrained tone'), false, '普通胶囊的英文不许进 DOM');
  assert.equal(editor.innerHTML.includes(TAG_ENGLISH), false, 'Tag 的英文不许进 DOM');
});

// ---------------------------------------------------------------------------
console.log(`\n通过 ${passed} 项，失败 ${failures.length} 项`);
if (failures.length > 0) {
  console.log(`失败清单：${failures.join('、')}`);
  process.exit(1);
}
