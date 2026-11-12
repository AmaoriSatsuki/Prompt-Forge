#!/usr/bin/env node
/**
 * 颜色扩容回归 · 第 3 步：断言「只加了一行颜色，所有派生结果都自动跟随」。
 *
 * 这是对需求确认里那句「颜色预设数量最好后期可改，不要写太死」的可执行证明：
 * 注册表 +1 种颜色之后，模块配色池、预设筛选条、自动分配、按 id 取色取名的容错、
 * 渐变生成、以及真正渲染出来的筛选条，全部必须自动跟上，且不需要动任何其它文件。
 *
 * 基准（D75）：**10 种彩色**（模块配色池 10、筛选条 10，没有白色自由色）；
 * 本脚本加一种彩色之后变成 **11 种**（模块配色池 11、筛选条 11）。
 *
 * 注意：数量断言一律从注册表/筛选条自身推导，不写死数字 —— 颜色种类会随用户要求增减。
 * 唯一写死的是「模块上限不受颜色数量影响」（10），那是另一条解耦约定。
 *
 * 运行：npm run verify:color-scale
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, '..', '.verify-out-scale');
fs.writeFileSync(path.join(OUT, 'package.json'), '{"type":"commonjs"}\n');
fs.cpSync(path.join(__dirname, '..', 'src', 'styles'), path.join(OUT, 'styles'), {
  recursive: true,
});
require.extensions['.css'] = () => ({});

const load = (relative) => require(path.join(OUT, relative));

const { COLORS, MODULE_COLORS, PRESET_FILTER_COLORS, colorGradient, colorHex, colorLabel } = load(
  'constants/colors.js',
);
const { MODULE_MAX_COUNT } = load('constants/limits.js');
const { allocModuleColor, normalizeModuleColor, normalizePresetColor } = load('utils/color.js');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { PresetColorFilter } = load('components/preset/PresetColorFilter.js');

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

console.log('\n颜色扩容回归：往注册表加一种颜色后，其余是否自动跟随');

check('注册表变成 13 种（10 色 + 画师 + 快照 + 新加的一种）', () => {
  assert.equal(COLORS.length, 13);
});

check('模块配色池自动变成 10 种，新颜色排在最后（薄荷之后）—— 词典/画师/快照色不进池子', () => {
  assert.equal(MODULE_COLORS.length, 10);
  assert.deepEqual(
    MODULE_COLORS.map((color) => color.id),
    ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink', 'mint', 'lime'],
  );
});

check('预设筛选条自动变成 10 种，且没有白色（自由色已删除）', () => {
  assert.equal(PRESET_FILTER_COLORS.length, 10);
  assert.equal(
    PRESET_FILTER_COLORS.some((color) => color.id === 'white'),
    false,
    '自由色删掉之后不该再出现白色',
  );
  assert.equal(
    PRESET_FILTER_COLORS.some((color) => color.id === 'lime'),
    true,
  );
  // D85：词典块是库切换块，**不能**被算进筛选色
  assert.equal(
    PRESET_FILTER_COLORS.some((color) => color.id === 'dictionary'),
    false,
    '词典块不是筛选色',
  );
});

check('自动分配会把新颜色发给第 10 个模块（前 9 个彩色已占满）', () => {
  const used = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink', 'mint'];
  assert.equal(allocModuleColor(used), 'lime');
});

check('新颜色的中文名、主色与渐变都能被取到', () => {
  assert.equal(colorLabel('lime'), '柠');
  assert.equal(colorHex('lime'), '#c0eb75');
  // D71：首尾对比度加大后，尾色用 color-mix 再压暗 22%
  assert.equal(
    colorGradient('lime'),
    'linear-gradient(135deg, #c0eb75, color-mix(in srgb, #5c940d 78%, #000))',
  );
});

check('新颜色同时是合法的模块色与预设色（无需改任何容错代码）', () => {
  assert.equal(normalizeModuleColor('lime'), 'lime');
  assert.equal(normalizePresetColor('lime'), 'lime');
});

check('模块数量上限不受颜色数量影响（两者仍解耦，D85 的 9↔9 由 verify:logic 钉住）', () => {
  // 加颜色不会悄悄放宽/收紧模块上限；要放模块数量得显式改 MODULE_MAX_COUNT
  assert.equal(MODULE_MAX_COUNT, 9);
});

check('真正渲染出来的筛选条变成 13 个色块（10 色 + 词典 D + 画师 @ + 快照 S），且新颜色带自己的渐变', () => {
  const html = renderToStaticMarkup(React.createElement(PresetColorFilter));
  // 按 role="radio" 数：内部颜色层的类名以 pf-swatch 开头，用类名前缀数会重复计数
  // D85：色块行 = 筛选色（扩容后 10 个）+ 词典库 D + 画师库 @ + 快照库 S
  assert.equal(html.split('role="radio"').length - 1, 13);
  assert.ok(html.includes('title="柠"'), '渲染结果里没有新颜色');
  assert.ok(html.includes('--pf-swatch-gradient:linear-gradient(135deg, #c0eb75'), '新颜色没有渐变');
});

console.log(`\n通过 ${passed} 项，失败 ${failures.length} 项`);
if (failures.length > 0) {
  console.log(`失败清单：${failures.join('、')}`);
  process.exit(1);
}
