/**
 * 文档熵哨兵 + 闭合性断言（npm run verify:docs）
 *
 * 目标（见 BluePrint/CONVENTIONS.md §13 / §14）：
 *   1. 闭合——BluePrint/ 顶层只允许白名单内的文档，体系外长不出野生文档
 *   2. 只减不增——体积 / 行长 / 条数有硬上限，红的就按判据删内容，不许上调上限
 *   3. 交接合格——HANDOFF 必须带开场白与六项断点，CONVENTIONS 必须带交接协议
 *
 * 判据：只看「失败 0 项」，不看退出码。
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const BP = path.join(ROOT, 'BluePrint');
const ARCHIVE = path.join(BP, 'archive');
const KB = 1024;

// 公开仓库只发 README + 源码 + LICENSE；BluePrint/ 是作者本地私有文档（.gitignore 挡着）。
// 公开副本里缺这个目录时整层跳过，否则贡献者跑 npm run verify 会在最后一层误报红。
if (!fs.existsSync(BP)) {
  console.log('榫言 · 文档哨兵：本副本未包含 BluePrint/（私有文档），跳过。');
  process.exit(0);
}

/** 白名单：BluePrint/ 顶层只许这 9 份 */
const ALLOWED = [
  'ARCHITECTURE.md',
  'CONVENTIONS.md',
  'DECISIONS.md',
  'HANDOFF.md',
  'PITFALLS.md',
  'PROTOCOL.md',
  'RELEASE.md',
  'VERIFICATION.md',
  'VISION.md',
];

/** 必读四件套 */
const MUST_READ = ['CONVENTIONS.md', 'VISION.md', 'ARCHITECTURE.md', 'HANDOFF.md'];

/** 硬上限：只许下调，上调必须在 CONVENTIONS 里写明理由 */
const LIMITS = {
  fileKB: 30,
  lineChars: 400,
  mustReadKB: 40,
  pitfalls: 52,
  headerLines: 12, // 职责头必须出现在前 12 行内
  injectKB: 2, // 注入层（AGENTS.md）—— 每轮都重发，是唯一乘了轮数的成本
};

/** 交接六项（HANDOFF §〇.3 必须齐全） */
const HANDOFF_FIELDS = ['当前任务', '改到哪一步', '未完成', '待用户拍板', '下一个动作', '验证状态'];

let passed = 0;
const failures = [];
const check = (name, ok, detail) => {
  if (ok) {
    passed += 1;
    console.log(`  [通过] ${name}`);
  } else {
    failures.push(`${name}${detail ? ' —— ' + detail : ''}`);
    console.log(`  [失败] ${name}${detail ? ' —— ' + detail : ''}`);
  }
};
const section = (t) => console.log(`\n【${t}】`);
const read = (abs) => fs.readFileSync(abs, 'utf8');
const sizeKB = (abs) => fs.statSync(abs).size / KB;

const topFiles = fs.existsSync(BP)
  ? fs.readdirSync(BP, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name)
  : [];

console.log('榫言 · 文档哨兵（npm run verify:docs）');

section('一、闭合性：BluePrint/ 顶层只许白名单内的文档');
check(`顶层文档 ${topFiles.length} 份`, topFiles.length > 0, '一份都没找到');
const wild = topFiles.filter((n) => !ALLOWED.includes(n));
check('没有体系外的野生文档', wild.length === 0, wild.join('、') + '（要加槽位请先改 CONVENTIONS §13 与本源白名单）');
const absent = ALLOWED.filter((n) => !topFiles.includes(n));
check('9 个槽位齐全', absent.length === 0, absent.join('、') + ' 缺失');
check('docs/ 目录已清除', !fs.existsSync(path.join(ROOT, 'docs')), 'docs/ 仍存在（内容应全部并入 BluePrint/）');

section('二、单文件体积上限');
for (const n of topFiles) {
  const kb = sizeKB(path.join(BP, n));
  check(`${n} ≤ ${LIMITS.fileKB}KB`, kb <= LIMITS.fileKB, `${kb.toFixed(1)}KB`);
}

section('三、单行长度上限（防巨型表格行）');
for (const n of topFiles) {
  const lines = read(path.join(BP, n)).split('\n');
  const long = lines.map((l, i) => ({ n: i + 1, len: l.length })).filter((x) => x.len > LIMITS.lineChars);
  check(`${n} 无超过 ${LIMITS.lineChars} 字符的行`, long.length === 0, long.length ? `${long.length} 行超限，首个在第 ${long[0].n} 行（${long[0].len} 字符）` : '');
}

section('四、必读包体积上限');
const present = MUST_READ.filter((n) => topFiles.includes(n));
check(`必读四件套齐全（${present.length}/4）`, present.length === 4, MUST_READ.filter((n) => !present.includes(n)).join('、'));
const mustReadKB = present.reduce((s, n) => s + sizeKB(path.join(BP, n)), 0);
check(`四件套合计 ≤ ${LIMITS.mustReadKB}KB`, mustReadKB <= LIMITS.mustReadKB, `${mustReadKB.toFixed(1)}KB`);

section('五、每份文档必须带职责头');
for (const n of topFiles) {
  const head = read(path.join(BP, n)).split('\n').slice(0, LIMITS.headerLines).join('\n');
  check(`${n} 有「职责 / 何时读」`, head.includes('> **职责**') && head.includes('> **何时读**'));
}

section('六、PITFALLS 条数棘轮（只减不增）');
const pit = path.join(BP, 'PITFALLS.md');
if (!fs.existsSync(pit)) check('PITFALLS.md 存在', false);
else {
  const count = (read(pit).match(/^\d+\.\s+\*\*/gm) || []).length;
  check(`PITFALLS 条数 ≤ ${LIMITS.pitfalls}`, count <= LIMITS.pitfalls, `当前 ${count} 条`);
}

section('七、文档指针有效性');
const refs = [];
for (const n of topFiles) {
  for (const m of read(path.join(BP, n)).matchAll(/(?:^|[\s(`'"])((?:BluePrint|docs)\/[A-Za-z0-9._\-\/]+\.md)/g)) {
    if (!m[1].includes('xxx') && !m[1].includes('<')) refs.push({ from: n, to: m[1] });
  }
}
const bad = refs.filter((r) => !fs.existsSync(path.join(ROOT, r.to)));
check(`共 ${refs.length} 处指针全部有效`, bad.length === 0, bad.slice(0, 5).map((b) => `${b.from} → ${b.to}`).join('；'));

section('八、决策索引覆盖');
const full = path.join(ARCHIVE, 'DECISIONS-FULL.md');
const idx = path.join(BP, 'DECISIONS.md');
if (!fs.existsSync(full) || !fs.existsSync(idx)) check('决策原文与索引均存在', false, `原文=${fs.existsSync(full)}，索引=${fs.existsSync(idx)}`);
else {
  const grab = (t) => new Set((t.match(/\bD\d{1,3}b?\b/g) || []).map((x) => x));
  const f = grab(read(full));
  const i = grab(read(idx));
  const missing = [...f].filter((d) => !i.has(d));
  check(`索引覆盖原文全部 D 编号（${i.size}/${f.size}）`, missing.length === 0, `缺 ${missing.slice(0, 10).join(' ')}`);
}

section('九、交接契约（CONVENTIONS §14 + HANDOFF §〇）');
const conv = read(path.join(BP, 'CONVENTIONS.md'));
check('CONVENTIONS 有「§14 交接协议」', /##\s*14\.\s*交接协议/.test(conv));
const hand = read(path.join(BP, 'HANDOFF.md'));
check('HANDOFF 有「§〇.1 开场白」', /###\s*〇\.1\s*开场白/.test(hand));
check('HANDOFF 有「§〇.3 断点记录」', /###\s*〇\.3\s*断点记录/.test(hand));
const missField = HANDOFF_FIELDS.filter((f) => !hand.includes(f));
check('断点记录六项齐全', missField.length === 0, `缺 ${missField.join('、')}`);

section('十、注入层体积上限（每轮都进上下文，最贵的一份）');
const inject = path.join(ROOT, '..', 'AGENTS.md');
if (!fs.existsSync(inject)) {
  check('工作区根存在 AGENTS.md', false, '未找到：注入层失效，新窗口拿不到红线');
} else {
  const kb = sizeKB(inject);
  check(`AGENTS.md ≤ ${LIMITS.injectKB}KB`, kb <= LIMITS.injectKB, `${kb.toFixed(2)}KB —— 每轮重发，知识应下沉到 BluePrint/`);
}

const total = passed + failures.length;
console.log(`\n—— 通过 ${passed} 项，失败 ${failures.length} 项（共 ${total} 项） ——`);
if (failures.length) {
  console.log('失败明细：');
  for (const f of failures) console.log(`  · ${f}`);
  console.log('\n处置口径见 BluePrint/CONVENTIONS.md §13 / §14：失效即删、断言接管即删、只减不增。');
  process.exit(1);
}
