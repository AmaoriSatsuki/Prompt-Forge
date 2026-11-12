#!/usr/bin/env node
/**
 * 切片翻译执行层（V3 第二层）的单元断言。
 *
 * 这一层是纯函数：翻译动作由调用方注入，因此这里用**假翻译器**就能完整验证
 * 标点转换、切片、分批、行数不一致回退、后处理与拼接 —— 不需要网络、不需要密钥。
 *
 * 假翻译器的约定：把收到的每一行包一层 `EN(…)` 并原样返回，行数与输入一致；
 * 需要模拟「行数不一致」或「超限」时，用专门的假翻译器。
 *
 * 运行：npm run verify:slice
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, '..', '.verify-out');
fs.writeFileSync(path.join(OUT, 'package.json'), '{"type":"commonjs"}\n');

const load = (relative) => require(path.join(OUT, relative));

const {
  splitSlices,
  utf8ByteLength,
  packSlices,
  splitTranslatedLines,
  squeezeSpaces,
  polishSlice,
  sliceTranslate,
  sliceTranslateText,
} = load('utils/sliceTranslate.js');
const { toPromptSeparators, normalizePromptBody, trimJunctionCommas } = load(
  'utils/promptPunctuation.js',
);

const { MAX_QUERY_BYTES, MAX_REQUEST_CHARS, SLICE_JOIN_SEPARATOR } = load('constants/limits.js');
const { MODULE_SOURCE_MAX_LENGTH } = load('constants/limits.js');

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

async function checkAsync(name, fn) {
  try {
    await fn();
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

/** 假翻译器：每行包一层 EN(...)，行数与输入一致 */
function echoTranslator(log) {
  return async (text) => {
    if (log) log.push(text);
    const lines = text.split('\n').map((line) => `EN(${line})`);
    return { text: lines.join('\n') };
  };
}

// ---------------------------------------------------------------------------
section('步骤 1：中文标点 → 英文逗号（句读一律当分隔符）');

check('句读类中文标点逐一对上（不再是"对应转换"，统一变逗号）', () => {
  assert.equal(toPromptSeparators('，'), ',');
  assert.equal(toPromptSeparators('。'), ',');
  assert.equal(toPromptSeparators('、'), ',');
  assert.equal(toPromptSeparators('；'), ',');
  assert.equal(toPromptSeparators('：'), ',');
  assert.equal(toPromptSeparators('！'), ',');
  assert.equal(toPromptSeparators('？'), ',');
  assert.equal(toPromptSeparators('…'), ',');
  assert.equal(toPromptSeparators('—'), ',');
});

check('括号是语法：全角括号转半角，不转逗号', () => {
  assert.equal(toPromptSeparators('（）'), '()');
  assert.equal(toPromptSeparators('【】'), '[]');
  assert.equal(toPromptSeparators('「」'), ',,');
  assert.equal(toPromptSeparators('《》'), ',,');
});

check('@ # _ - * { } < > 原样保留（术语内容）', () => {
  const kept = '@#_-*{}<>';
  assert.equal(toPromptSeparators(kept), kept);
});

check('中英混合只换标点，不动汉字与英文', () => {
  assert.equal(
    toPromptSeparators('女孩（微笑），@lora_x 权重【1.2】'),
    '女孩(微笑),@lora_x 权重[1.2]',
  );
});

check('英文里的点与撇号：数字/字母之间是内容，句末是句读', () => {
  assert.equal(toPromptSeparators('1.5'), '1.5', '权重的点必须留住');
  assert.equal(toPromptSeparators('v1.5'), 'v1.5');
  assert.equal(toPromptSeparators('artist.name'), 'artist.name');
  assert.equal(toPromptSeparators('smile.'), 'smile,', '句末的点是句读');
  assert.equal(toPromptSeparators("woman's"), "woman's", '英文撇号是术语的一部分');
  assert.equal(toPromptSeparators('woman’s'), "woman's", '弯撇号统一成 ASCII');
  assert.equal(toPromptSeparators("'hello'"), ',hello,', '引号是句读');
});

check('normalizePromptBody：映射 + 折叠空白 + 折叠连续逗号 + 去首尾逗号', () => {
  assert.equal(normalizePromptBody('一句。'), '一句');
  assert.equal(normalizePromptBody('smile! long hair'), 'smile, long hair');
  assert.equal(normalizePromptBody('a,,b'), 'a, b');
  assert.equal(normalizePromptBody(',a，b,'), 'a, b');
  assert.equal(normalizePromptBody('  1.5  '), '1.5');
  assert.equal(normalizePromptBody('(a,b)'), '(a, b)');
  assert.equal(normalizePromptBody(''), '');
});

check('normalizePromptBody 幂等：洗两次与洗一次一字不差', () => {
  for (const sample of ['一句。', 'smile! long hair', '《标题》', 'woman’s face', '1.5']) {
    const once = normalizePromptBody(sample);
    assert.equal(normalizePromptBody(once), once, `不幂等：${JSON.stringify(sample)}`);
  }
});

check('trimJunctionCommas 只去首尾，不动中间（词典键用）', () => {
  assert.equal(trimJunctionCommas('长发,'), '长发');
  assert.equal(trimJunctionCommas(' , 长发 , '), '长发');
  assert.equal(trimJunctionCommas('权重(1.2,0)'), '权重(1.2,0)');
});

// ---------------------------------------------------------------------------
section('步骤 2：按英文逗号切分（去空格、跳空段）');

check('中文逗号切开后分片，并去掉首尾空格', () => {
  assert.deepEqual(splitSlices('女孩， 长头发 ，微笑'), ['女孩', '长头发', '微笑']);
});

check('连续逗号不产生空片段', () => {
  assert.deepEqual(splitSlices('女孩，，长头发'), ['女孩', '长头发']);
  assert.deepEqual(splitSlices('女孩, , 长头发'), ['女孩', '长头发']);
});

check('首尾逗号被跳过', () => {
  assert.deepEqual(splitSlices('，女孩，长头发，'), ['女孩', '长头发']);
});

check('空内容得到空切片列表（空串 / 纯空白 / 全是逗号）', () => {
  assert.deepEqual(splitSlices(''), []);
  assert.deepEqual(splitSlices('   '), []);
  assert.deepEqual(splitSlices('，,，'), []);
});

check('顿号也是句读：不再被当成整段内容', () => {
  assert.deepEqual(splitSlices('，,、'), []);
  assert.deepEqual(splitSlices('甲、乙'), ['甲', '乙'], '顿号 → 逗号 → 分隔');
});

check('括号里的逗号属于内容（括号是语法）；引号不再是保护符（引号是句读）', () => {
  // 英文逗号在括号内 → 整段保留，不被切开
  assert.deepEqual(splitSlices('weight(1.2),@lora_x'), ['weight(1.2)', '@lora_x']);
  assert.deepEqual(splitSlices('权重【1.2,0】，画风'), ['权重[1.2,0]', '画风']);
  // 引号已经是逗号：句子按逗号切开，不再整段保留
  assert.deepEqual(splitSlices('他说"你好,世界"，画风'), ['他说', '你好', '世界', '画风']);
});

check('括号不成对时退回「见到分隔符就切」（不会被落单括号吞掉整段）', () => {
  assert.deepEqual(splitSlices('权重[1.2,画风'), ['权重[1.2', '画风']);
});

check('换行也算分隔符（手工分行的输入逐行处理）', () => {
  assert.deepEqual(splitSlices('女孩\n长头发'), ['女孩', '长头发']);
  assert.deepEqual(splitSlices('女孩\r\n长头发'), ['女孩', '长头发'], '容忍 \\r\\n');
  assert.deepEqual(splitSlices('女孩\n\n长头发'), ['女孩', '长头发'], '空行跳过');
});

// ---------------------------------------------------------------------------
section('步骤 4：按 UTF-8 字节分批');

check('字节数与 UTF-8 实际长度一致（中文 3 字节）', () => {
  assert.equal(utf8ByteLength('abc'), 3);
  assert.equal(utf8ByteLength('女'), 3);
  assert.equal(utf8ByteLength('女a'), 4);
});

check('装得下就只发一批', () => {
  assert.deepEqual(packSlices(['a', 'b', 'c'], 100), [['a', 'b', 'c']]);
});

check('装不下就分批，且每批都在上限内', () => {
  const segments = ['甲'.repeat(3), '乙'.repeat(3), '丙'.repeat(3)]; // 各 9 字节
  const batches = packSlices(segments, 20); // 9 + 1 + 9 = 19 ≤ 20；再加就超
  assert.equal(batches.length, 2);
  assert.deepEqual(batches[0], segments.slice(0, 2));
  assert.deepEqual(batches[1], segments.slice(2));
  for (const batch of batches) {
    assert.ok(utf8ByteLength(batch.join(SLICE_JOIN_SEPARATOR)) <= 20);
  }
});

check('单片段本身就超限时仍然单独成批（交给 Rust 报中文提示）', () => {
  const huge = '甲'.repeat(100);
  const batches = packSlices([huge], 10);
  assert.deepEqual(batches, [[huge]]);
});

check(`默认上限就是接口的 ${MAX_QUERY_BYTES} 字节`, () => {
  assert.equal(MAX_QUERY_BYTES, 6000);
  // 正好 6000 字节：一批
  const exactly = '甲'.repeat(2000); // 2000 × 3 = 6000
  assert.equal(utf8ByteLength(exactly), MAX_QUERY_BYTES);
  assert.deepEqual(packSlices([exactly]).length, 1);
});

check('模块输入上限与单次请求上限取同一个数（正常一个模块一次发完）', () => {
  assert.equal(MODULE_SOURCE_MAX_LENGTH, 1000);
  assert.equal(MAX_REQUEST_CHARS, 1000);
  assert.equal(
    MODULE_SOURCE_MAX_LENGTH,
    MAX_REQUEST_CHARS,
    '两个上限必须一致，否则写满的模块会被拆成多次请求',
  );
});

check(`数值上限就是 ${MAX_REQUEST_CHARS} 字（与模块输入上限同一个数）`, () => {
  assert.equal(MAX_REQUEST_CHARS, 1000);

  // 1000 字连续正文：一批（正好是一个写满的模块）
  const body = '甲'.repeat(MAX_REQUEST_CHARS);
  assert.equal(packSlices([body]).length, 1, '1000 字应当一次发完');

  // 1001 字：必须开新批（多出来的那个字自成一批）
  const batches = packSlices([body, '乙']);
  assert.equal(batches.length, 2, '超过 1000 字必须分批');
  assert.deepEqual(batches[0], [body]);
  assert.deepEqual(batches[1], ['乙']);
});

check('保险丝：接口的 6000 字节仍然兜底（正常永远不触发）', () => {
  // 1000 汉字 ≈ 3000 字节，离 6000 很远 —— 正常路径由 1000 字这一道上限决定
  const body = '甲'.repeat(MAX_REQUEST_CHARS);
  assert.ok(utf8ByteLength(body) < MAX_QUERY_BYTES, '1000 汉字应当远低于字节上限');

  // 只有粘进远超 1000 字的 ASCII 时才轮到字节上限（1000 字装得下，6001 字节装不下）
  const ascii = 'a'.repeat(MAX_QUERY_BYTES + 1);
  const batches = packSlices([ascii]);
  assert.equal(batches.length, 1, '单片段超限时单独成批（交给 Rust 报中文提示）');
  assert.equal(packSlices([ascii], MAX_QUERY_BYTES, MAX_QUERY_BYTES + 1).length, 1);
});

check('4 字节字符（生僻字/表情）由字节上限兜住', () => {
  // 2000 个 4 字节字符 = 8000 字节 > 6000，字符没超但字节超了 → 必须分批
  const wide = Array.from({ length: MAX_REQUEST_CHARS }, () => '𠮷');
  assert.equal(utf8ByteLength(wide[0]), 4);
  const batches = packSlices(wide);
  assert.ok(batches.length >= 2, `应当按字节分批，实际 ${batches.length} 批`);
  for (const batch of batches) {
    assert.ok(utf8ByteLength(batch.join(SLICE_JOIN_SEPARATOR)) <= MAX_QUERY_BYTES);
    assert.ok(batch.length <= MAX_REQUEST_CHARS);
  }
});

check('超过上限时按片段边界分批；单个片段自身超限则单独成批', () => {
  // 显式给上限，测试不依赖默认值：4 个 5 字片段、每批最多 12 字 → 2 批
  const many = Array.from({ length: 4 }, () => '甲'.repeat(5));
  const batches = packSlices(many, MAX_QUERY_BYTES, 12);
  assert.equal(batches.length, 2, `应当拆成 2 批，实际 ${batches.length}`);
  for (const batch of batches) {
    assert.ok(batch.join('').length <= 12, `批次超限：${batch.join('')}`);
  }

  // 单个片段自身就超限：**不切开**（切片是语义单位），单独成批发出去，
  // 由 Rust 侧给出「这一段太长了（N 字节…）请拆分成多个模块」的中文提示
  const over = '甲'.repeat(2000) + 'a';
  assert.equal(utf8ByteLength(over), MAX_QUERY_BYTES + 1);
  assert.deepEqual(packSlices([over]), [[over]]);
});

// ---------------------------------------------------------------------------
section('步骤 5/7：按行取回与片段后处理');

check('返回文本按行切分，容忍 \\r\\n、忽略空行', () => {
  assert.deepEqual(splitTranslatedLines('a\r\nb\n\nc'), ['a', 'b', 'c']);
  assert.deepEqual(splitTranslatedLines(''), []);
});

check('折叠连续空白并去首尾空格', () => {
  assert.equal(squeezeSpaces('  a   b  '), 'a b');
});

check('片段后处理：先归一句读，再统一小写', () => {
  assert.equal(polishSlice('  Long   Hair  '), 'long hair');
  assert.equal(polishSlice('Smile!'), 'smile', '接口加的感叹号在这里就被收掉');
  assert.equal(polishSlice('A, B。'), 'a, b');
});

check('英文里的数字点与撇号在后处理里保持原样', () => {
  assert.equal(polishSlice('Weight 1.5'), 'weight 1.5');
  assert.equal(polishSlice("Woman's Face"), "woman's face");
});

// ---------------------------------------------------------------------------
section('主流程：一次请求、按序取回、用「, 」拼接（末尾不加逗号）');

(async () => {
  await checkAsync('基本链路：一次请求装下所有片段，译文按原顺序拼接', async () => {
    const log = [];
    const outcome = await sliceTranslate('女孩，长头发，微笑', echoTranslator(log));

    // 步骤 3：片段用 \n 拼接，一次请求发出去
    assert.deepEqual(log, ['女孩\n长头发\n微笑']);
    assert.deepEqual(outcome.segments, ['女孩', '长头发', '微笑']);
    assert.equal(outcome.batches.length, 1);
    assert.equal(outcome.fellBackToPerSegment, false);
    // 步骤 8：按原顺序用「, 」拼接，末尾不加逗号
    assert.equal(outcome.text, 'en(女孩), en(长头发), en(微笑)');
    assert.equal(outcome.text.endsWith(','), false);
  });

  await checkAsync('中文标点先转换再切分：句号也当分隔（变成逗号）', async () => {
    const log = [];
    const outcome = await sliceTranslate('你好。世界', echoTranslator(log));
    assert.deepEqual(outcome.segments, ['你好', '世界']);
    assert.deepEqual(log, ['你好\n世界']);
    assert.equal(outcome.text, 'en(你好), en(世界)');
  });

  await checkAsync('中英混合 + @引用 + 权重括号：原样参与翻译，不被拆坏', async () => {
    const log = [];
    const outcome = await sliceTranslate('女孩，@lora_x 权重【1.2】，-*{}<> 保留', echoTranslator(log));
    assert.deepEqual(outcome.segments, ['女孩', '@lora_x 权重[1.2]', '-*{}<> 保留']);
    assert.deepEqual(log, ['女孩\n@lora_x 权重[1.2]\n-*{}<> 保留']);
    assert.equal(outcome.text, 'en(女孩), en(@lora_x 权重[1.2]), en(-*{}<> 保留)');
  });

  await checkAsync('发出去的请求体就是「切片用换行连起来」', async () => {
    const log = [];
    await sliceTranslate('女孩，长头发，微笑', echoTranslator(log));
    // 请求体里出现的分隔符只有 \n：切片本质就是符号替换
    assert.equal(log[0], '女孩\n长头发\n微笑');
    assert.equal(log[0].includes(','), false, '请求体里不该留下逗号分隔符');
    assert.equal(log[0].split('\n').length, 3);
  });

  await checkAsync('连续逗号与首尾逗号：不产生空片段，也不产生空译文', async () => {
    const log = [];
    const outcome = await sliceTranslate('，，女孩，，长头发，', echoTranslator(log));
    assert.deepEqual(outcome.segments, ['女孩', '长头发']);
    assert.deepEqual(log, ['女孩\n长头发']);
    // 不能出现「, ,」这种噪声
    assert.equal(outcome.text.includes(', ,'), false);
    assert.equal(outcome.text, 'en(女孩), en(长头发)');
  });

  await checkAsync('空输入：不发请求，返回空串', async () => {
    const log = [];
    const outcome = await sliceTranslate('   ', echoTranslator(log));
    assert.deepEqual(log, []);
    assert.deepEqual(outcome.segments, []);
    assert.equal(outcome.text, '');
    assert.equal(outcome.batches.length, 0);
  });

  await checkAsync('超限分批：装不下就拆成多次请求，译文顺序不乱', async () => {
    const log = [];
    // 每片段 3 字节 + 片段内空格；用极小的上限强制分批
    const text = '甲，乙，丙，丁';
    const outcome = await sliceTranslate(text, echoTranslator(log), { maxQueryBytes: 12 });

    assert.ok(outcome.batches.length > 1, `应当分批，实际 ${outcome.batches.length} 批`);
    assert.equal(log.length, outcome.batches.length, '每次请求都要真的发出去');
    for (const batch of outcome.batches) {
      assert.ok(utf8ByteLength(batch) <= 12, `批次超限：${batch}`);
    }
    // 顺序必须与源内容一致
    assert.equal(outcome.text, 'en(甲), en(乙), en(丙), en(丁)');
    assert.equal(outcome.fellBackToPerSegment, false);
  });

  await checkAsync('行数不一致 → 回退逐片段翻译，且顺序仍然正确', async () => {
    const log = [];
    // 假翻译器故意把两行合成一行返回，触发步骤 6 的回退
    const mergingTranslator = async (text) => {
      log.push(text);
      const lines = text.split('\n');
      if (lines.length > 1) return { text: lines.map((l) => `EN(${l})`).join(' ') };
      return { text: `EN(${text})` };
    };

    const outcome = await sliceTranslate('甲，乙，丙', mergingTranslator);
    assert.equal(outcome.fellBackToPerSegment, true, '应当触发逐片段回退');
    // 第一次是整批，之后逐片段各发一次
    assert.deepEqual(log, ['甲\n乙\n丙', '甲', '乙', '丙']);
    assert.equal(outcome.text, 'en(甲), en(乙), en(丙)');
  });

  await checkAsync('回退时按「批量行数」判断，不因单片段返回多行而误判', async () => {
    // 单片段返回里含换行：回退分支会把该片段的多行折叠成一个片段的结果
    const log = [];
    const multiLineTranslator = async (text) => {
      log.push(text);
      if (text.includes('\n')) return { text: 'X Y' };
      return { text: 'one\ntwo' };
    };
    const outcome = await sliceTranslate('甲，乙', multiLineTranslator);
    assert.equal(outcome.fellBackToPerSegment, true);
    assert.equal(outcome.text, 'one two, one two');
  });

  await checkAsync('接口回包自带句读：成品端再收一次（每行都收）', async () => {
    const translator = async (text) => ({
      text: text
        .split('\n')
        .map(() => 'Smile!')
        .join('\n'),
    });
    const text = await sliceTranslateText('微笑，长发', translator);
    assert.equal(text, 'smile, smile', '感叹号在回包时被收成逗号/去掉');
  });

  await checkAsync('正文成品首尾不带逗号（转换出来的尾部逗号要 trim 掉）', async () => {
    const translator = async (text) => ({
      text: text
        .split('\n')
        .map((line) => `${line}。`)
        .join('\n'),
    });
    const text = await sliceTranslateText('微笑，长发', translator);
    assert.equal(text, '微笑, 长发');
    assert.equal(text.endsWith(','), false);
  });

  await checkAsync('返回值里带上 segments / batches，便于调度层与断言使用', async () => {
    const outcome = await sliceTranslate('女孩，微笑', echoTranslator(), { maxQueryBytes: 6 });
    assert.deepEqual(outcome.segments, ['女孩', '微笑']);
    assert.equal(outcome.batches.length, 2, '上限 6 字节装不下两个 3 字节片段 + 换行');
  });

  // -------------------------------------------------------------------------
  section('本地词典（D50）：命中段不参与请求，顺序与回退只针对未命中段');

  const glossaryOf = (map) => (segment) => map[segment] ?? null;

  await checkAsync('命中的片段不发请求；输出按原顺序合并，且命中值原样保留（不改大小写）', async () => {
    const log = [];
    const outcome = await sliceTranslate('千早爱音，长头发，粉头发', echoTranslator(log), {
      resolveSegment: glossaryOf({ 千早爱音: 'Chihaya Anon', 粉头发: 'Pink Hair' }),
    });
    assert.equal(outcome.dictionaryHits, 2);
    assert.deepEqual(log, ['长头发'], '只把未命中的那段发出去');
    assert.equal(
      outcome.text,
      'Chihaya Anon, en(长头发), Pink Hair',
      '顺序与命中值的大小写都必须保留',
    );
    assert.equal(outcome.fellBackToPerSegment, false);
  });

  await checkAsync('全部命中：一次请求都不发（连批次都是空的）', async () => {
    const log = [];
    const outcome = await sliceTranslate('千早爱音，长头发', echoTranslator(log), {
      resolveSegment: glossaryOf({ 千早爱音: 'Chihaya Anon', 长头发: 'Long Hair' }),
    });
    assert.deepEqual(log, []);
    assert.deepEqual(outcome.batches, []);
    assert.equal(outcome.dictionaryHits, 2);
    assert.equal(outcome.text, 'Chihaya Anon, Long Hair');
  });

  await checkAsync('行数不一致时只对未命中段逐段回退（命中段不进任何请求）', async () => {
    const log = [];
    const merging = async (text) => {
      log.push(text);
      const lines = text.split('\n');
      if (lines.length > 1) return { text: lines.map((line) => `EN(${line})`).join(' ') };
      return { text: `EN(${text})` };
    };
    const outcome = await sliceTranslate('甲，千早爱音，乙，丙', merging, {
      resolveSegment: glossaryOf({ 千早爱音: 'Chihaya Anon' }),
    });
    assert.equal(outcome.fellBackToPerSegment, true);
    assert.deepEqual(log, ['甲\n乙\n丙', '甲', '乙', '丙'], '命中段不该出现在请求里');
    assert.equal(outcome.text, 'en(甲), Chihaya Anon, en(乙), en(丙)');
  });

  await checkAsync('没有词典时行为与以前完全一致（batches 覆盖全部片段）', async () => {
    const log = [];
    const outcome = await sliceTranslate('甲，乙', echoTranslator(log));
    assert.equal(outcome.dictionaryHits, 0);
    assert.deepEqual(log, ['甲\n乙']);
    assert.equal(outcome.text, 'en(甲), en(乙)');
  });

  // -------------------------------------------------------------------------
  console.log(`\n通过 ${passed} 项，失败 ${failures.length} 项`);
  if (failures.length > 0) {
    console.log(`失败清单：${failures.join('、')}`);
    process.exit(1);
  }
})();
