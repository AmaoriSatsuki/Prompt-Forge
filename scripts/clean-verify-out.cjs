#!/usr/bin/env node
/**
 * 清理 .verify-out 里的编译产物，再交给 tsc 重新编译。
 *
 * 为什么必须有这一步：tsc 不会删除已经不存在源文件的旧产物。
 * 于是「删掉一个组件」之后，上一次编译留下的 .js 仍在，
 * 断言脚本 require 到的会是那个已经不存在的组件——测试通过，但测的是幽灵。
 * （真发生过一次：删掉 OutputPane 后它的断言照旧"通过"。）
 *
 * 只删目录与顶层 .js，保留放在这里的临时脚本。
 */
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, '..', '.verify-out');

if (!fs.existsSync(OUT)) {
  console.log('.verify-out 不存在，跳过清理');
  process.exit(0);
}

let removed = 0;
for (const entry of fs.readdirSync(OUT, { withFileTypes: true })) {
  const full = path.join(OUT, entry.name);
  if (entry.isDirectory()) {
    fs.rmSync(full, { recursive: true, force: true });
    removed += 1;
  } else if (entry.name.endsWith('.js')) {
    fs.rmSync(full, { force: true });
    removed += 1;
  }
}

console.log(`已清理 .verify-out 里的编译产物：${removed} 项`);
