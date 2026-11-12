#!/usr/bin/env node
/**
 * 颜色扩容回归 · 第 1 步：准备一份「加了一种颜色」的源码副本。
 *
 * 为什么要在副本上做：本测试要证明「往颜色注册表里加一行，其余全部自动跟随」，
 * 唯一可信的做法就是真的加一行再编译。为了绝对不污染工程，src 整个复制到
 * .verify-color-scale/ 下再改，真实源码全程只读。
 *
 * 运行：npm run verify:color-scale（由 npm 串起 准备 → 编译 → 断言 三步）
 */
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');
const scaleRoot = path.join(projectRoot, '.verify-color-scale');
const outRoot = path.join(projectRoot, '.verify-out-scale');
const sourceDir = path.join(projectRoot, 'src');

/** 新增的颜色：与现有 8 色同属模块+预设（usage: both），order 排在最后一种彩色（粉，80）之后 */
const NEW_COLOR_LINE =
  "  { id: 'lime', label: '柠', hex: '#c0eb75', hexTo: '#5c940d', usage: 'both', variant: 'gradient', order: 150 },\n";

function main() {
  fs.rmSync(scaleRoot, { recursive: true, force: true });
  fs.rmSync(outRoot, { recursive: true, force: true });
  fs.mkdirSync(scaleRoot, { recursive: true });

  fs.cpSync(sourceDir, path.join(scaleRoot, 'src'), { recursive: true });

  // ---- 往颜色注册表里加一行（插在最后一个颜色「粉」之后） ----
  const colorsPath = path.join(scaleRoot, 'src', 'constants', 'colors.ts');
  const original = fs.readFileSync(colorsPath, 'utf8');
  const lines = original.split('\n');
  const lastColorIndex = lines.findIndex((line) => line.includes("id: 'pink'"));
  if (lastColorIndex < 0) {
    throw new Error('没找到最后一个颜色（粉）所在的行，颜色注册表的结构可能变了，请更新本脚本');
  }
  lines.splice(lastColorIndex + 1, 0, NEW_COLOR_LINE.trimEnd());
  fs.writeFileSync(colorsPath, lines.join('\n'), 'utf8');

  // ---- 给副本准备编译配置与 CommonJS 作用域标记 ----
  fs.writeFileSync(
    path.join(scaleRoot, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          lib: ['ES2022', 'DOM'],
          module: 'commonjs',
          moduleResolution: 'node10',
          ignoreDeprecations: '6.0',
          outDir: '../.verify-out-scale',
          rootDir: 'src',
          jsx: 'react-jsx',
          strict: true,
          skipLibCheck: true,
          esModuleInterop: true,
          noEmit: false,
          types: [],
        },
        include: ['src'],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  fs.mkdirSync(outRoot, { recursive: true });
  fs.writeFileSync(path.join(outRoot, 'package.json'), '{"type":"commonjs"}\n', 'utf8');
  fs.cpSync(path.join(sourceDir, 'styles'), path.join(outRoot, 'styles'), { recursive: true });

  const addedCount = lines.length - original.split('\n').length;
  console.log(`  已复制 src 到 ${path.relative(projectRoot, scaleRoot)}\\src`);
  console.log(`  已往颜色注册表插入 1 种颜色（柠 #c0eb75），行数变化 ${addedCount}`);
}

main();
