#!/usr/bin/env node
/**
 * 项目体检：找出源码层面的臃肿与残留（只读、不改动任何文件）。
 *
 * 用途：回答「有没有可以清理的累赘」。检查三类问题：
 * 1. **孤儿文件**：没有任何其它文件 import 它；
 * 2. **从未被引用的导出符号**（粗筛，可能出现假阳性，例如只被自身的桶文件 re-export）；
 * 3. **规模概览**：各目录行数，便于发现异常膨胀的文件。
 *
 * 运行：node scripts/audit-project.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', 'target', '.git', 'dist']);

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, acc);
    } else {
      acc.push(full);
    }
  }
  return acc;
}

const SOURCE_DIR = path.join(ROOT, 'src');
// 只统计产品代码（不含断言代码 .cjs 与类型声明 .d.ts），否则规模数字会误导
const sourceFiles = walk(SOURCE_DIR).filter(
  (file) => /\.(ts|tsx)$/.test(file) && !/\.d\.ts$/.test(file),
);
// 判定「是否被引用」时必须**连断言代码一起看**（scripts/*.cjs），
// 否则「只被断言使用的符号」会被误报为未引用 —— 这是本脚本第一版的真实缺陷。
const referenceFiles = [
  ...sourceFiles,
  ...walk(path.join(ROOT, 'scripts')).filter((file) => /\.cjs$/.test(file)),
];
const contents = new Map(sourceFiles.map((file) => [file, fs.readFileSync(file, 'utf8')]));
const referenceContents = new Map(
  referenceFiles.map((file) => [file, fs.readFileSync(file, 'utf8')]),
);
const rel = (file) => path.relative(ROOT, file).replace(/\\/g, '/');

console.log('=== 规模概览 ===');
let totalLines = 0;
const perDir = new Map();
for (const [file, text] of contents) {
  const lines = text.split('\n').length;
  totalLines += lines;
  const dir = rel(file).split('/').slice(0, 2).join('/');
  perDir.set(dir, (perDir.get(dir) ?? 0) + lines);
}
console.log(`  src 文件数 ${sourceFiles.length}，总行数 ${totalLines}`);
const rows = [...contents].map(([file, text]) => [rel(file), text.split('\n').length]);
rows.sort((a, b) => b[1] - a[1]);
console.log('  最大的 6 个文件：');
for (const [file, lines] of rows.slice(0, 6)) console.log(`    ${String(lines).padStart(5)}  ${file}`);

console.log('\n=== 孤儿文件（产品代码与断言代码都没有 import 它） ===');
const orphans = [];
for (const [file] of contents) {
  const base = path.basename(file).replace(/\.(ts|tsx)$/, '');
  if (['main', 'App'].includes(base)) continue;
  let imported = false;
  for (const [other, text] of referenceContents) {
    if (other === file) continue;
    if (new RegExp(`['"][^'"]*${base}['"/]`).test(text)) {
      imported = true;
      break;
    }
  }
  if (!imported) orphans.push(rel(file));
}
console.log(orphans.length ? orphans.map((f) => `  ${f}`).join('\n') : '  无');

console.log('\n=== 导出后全项目（含断言）只出现一次，即只有定义处 ===');
const unused = [];
for (const [file, text] of contents) {
  const names = [
    ...text.matchAll(/export (?:async )?function ([A-Za-z0-9_]+)/g),
    ...text.matchAll(/export const ([A-Za-z0-9_]+)/g),
  ].map((m) => m[1]);
  for (const name of names) {
    const re = new RegExp(`\\b${name}\\b`, 'g');
    let count = 0;
    for (const [, other] of referenceContents) count += (other.match(re) ?? []).length;
    if (count <= 1) unused.push(`${name}  (${rel(file)})`);
  }
}
console.log(unused.length ? unused.map((x) => `  ${x}`).join('\n') : '  无');
console.log('\n说明：判定「被引用」时已把 scripts/*.cjs（断言代码）算进去；');
console.log('      仍可能有假阳性（桶文件 re-export、只在定义文件内部使用），删前请人工核对。');
