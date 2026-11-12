#!/usr/bin/env node
/**
 * 第一层（调度层）纯逻辑部件的单元断言：翻译缓存 + 每引擎串行队列。
 *
 * 两者都是纯逻辑，因此可以完全离线断言：队列用**假时钟**验证限速间隔，
 * 缓存用**小上限**验证 LRU 淘汰，都不需要真的 sleep 或联网。
 *
 * 运行：npm run verify:scheduler
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, '..', '.verify-out');
fs.writeFileSync(path.join(OUT, 'package.json'), '{"type":"commonjs"}\n');

const load = (relative) => require(path.join(OUT, relative));

const { buildCacheKey, TranslationCache } = load('utils/translationCache.js');
const { EngineQueue, MIN_REQUEST_INTERVAL_MS, engineQueue, resetEngineQueues } = load(
  'utils/engineQueue.js',
);
const { BAIDU_MIN_INTERVAL_MS } = load('constants/limits.js');

let passed = 0;
const failures = [];

async function check(name, fn) {
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

const baseKey = {
  sourceText: '女孩，长头发',
  sourceLang: 'zh',
  targetLang: 'en',
  engine: 'baidu-translate',
  glossaryVersion: 'g0',
  segmentMode: 'slice-1000',
};

(async () => {
  // -------------------------------------------------------------------------
  section('缓存键：六个维度任一变化都必须视为不同条目');

  await check('同样的输入得到同样的键（可复用）', async () => {
    assert.equal(buildCacheKey({ ...baseKey }), buildCacheKey({ ...baseKey }));
  });

  await check('会话维度各自都能区分开条目', async () => {
    const original = buildCacheKey({ ...baseKey });
    const variations = {
      sourceText: '女孩，短发',
      sourceLang: 'ja',
      targetLang: 'zh',
      engine: 'tencent-translate',
      glossaryVersion: 'g1',
      segmentMode: 'slice-500',
    };
    for (const [field, value] of Object.entries(variations)) {
      const changed = buildCacheKey({ ...baseKey, [field]: value });
      assert.notEqual(changed, original, `${field} 变化时键必须不同`);
    }
  });

  await check('拼接不会产生歧义（长度参与定界）', async () => {
    const a = buildCacheKey({ ...baseKey, sourceText: 'ab', engine: 'c' });
    const b = buildCacheKey({ ...baseKey, sourceText: 'a', engine: 'bc' });
    assert.notEqual(a, b, '「ab + c」与「a + bc」不能撞成同一个键');
  });

  // -------------------------------------------------------------------------
  section('缓存：命中、写入、统计');

  await check('写入后能命中，且返回值一致', async () => {
    const cache = new TranslationCache({ maxEntries: 10 });
    const key = buildCacheKey({ ...baseKey });
    assert.equal(cache.get(key), null, '没写过不该命中');
    cache.put(key, 'long hair');
    assert.equal(cache.get(key), 'long hair');
  });

  await check('空译文不写入（避免把失败结果缓存成空）', async () => {
    const cache = new TranslationCache({ maxEntries: 10 });
    const key = buildCacheKey({ ...baseKey });
    cache.put(key, '');
    assert.equal(cache.get(key), null);
    assert.equal(cache.stats().entries, 0);
  });

  await check('统计给出条数、字符数与估算占用', async () => {
    const cache = new TranslationCache({ maxEntries: 10 });
    cache.put('k1', 'abcd');
    cache.put('k2', 'ef');
    const stats = cache.stats();
    assert.equal(stats.entries, 2);
    assert.equal(stats.chars, 6);
    assert.ok(stats.approxBytes > 6, `估算占用应当大于纯字符数，实际 ${stats.approxBytes}`);
  });

  await check('关闭缓存后既不命中也不写入', async () => {
    const cache = new TranslationCache({ maxEntries: 10 });
    const key = buildCacheKey({ ...baseKey });
    cache.put(key, 'long hair');
    cache.setEnabled(false);
    assert.equal(cache.get(key), null, '关闭后不该命中');
    cache.put('k2', 'x');
    cache.setEnabled(true);
    assert.equal(cache.get('k2'), null, '关闭期间的写入不该生效');
    assert.equal(cache.get(key), 'long hair', '重新打开后原有条目仍在');
  });

  await check('命中率计数用于观察效果', async () => {
    const cache = new TranslationCache({ maxEntries: 10 });
    cache.put('k', 'v');
    cache.get('k');
    cache.get('k');
    cache.get('missing');
    const { hits, misses } = cache.hitRate();
    assert.equal(hits, 2);
    assert.equal(misses, 1);
  });

  // -------------------------------------------------------------------------
  section('缓存：上限与 LRU 淘汰');

  await check('超过条数上限时淘汰最久未用的那条', async () => {
    const cache = new TranslationCache({ maxEntries: 3 });
    cache.put('a', '1');
    cache.put('b', '2');
    cache.put('c', '3');
    // 命中 a，使 b 成为最久未用
    assert.equal(cache.get('a'), '1');
    cache.put('d', '4');

    assert.equal(cache.stats().entries, 3, '条数应当被限制在 3');
    assert.equal(cache.get('b'), null, '最久未用的 b 应当被淘汰');
    assert.equal(cache.get('a'), '1', '刚用过的 a 必须还在');
    assert.equal(cache.get('c'), '3');
    assert.equal(cache.get('d'), '4');
  });

  await check('字符数上限也会触发淘汰', async () => {
    const cache = new TranslationCache({ maxEntries: 1000, maxChars: 10 });
    cache.put('a', '甲'.repeat(6));
    cache.put('b', '乙'.repeat(6)); // 累计 12 > 10 → 淘汰最旧的 a
    assert.equal(cache.get('a'), null, '超出字符上限时应淘汰最旧条目');
    assert.equal(cache.get('b'), '乙'.repeat(6));
    assert.ok(cache.stats().chars <= 10);
  });

  await check('清空返回清掉的条数', async () => {
    const cache = new TranslationCache({ maxEntries: 10 });
    cache.put('a', '1');
    cache.put('b', '2');
    assert.equal(cache.clear(), 2);
    assert.equal(cache.stats().entries, 0);
  });

  // -------------------------------------------------------------------------
  section('缓存：落盘形状与容错恢复');

  await check('导出记录可原样恢复', async () => {
    const cache = new TranslationCache({ maxEntries: 10 });
    cache.put('a', 'one');
    cache.put('b', 'two');
    const records = cache.toRecords();

    const restored = new TranslationCache({ maxEntries: 10 });
    restored.loadRecords(records);
    assert.equal(restored.stats().entries, 2);
    assert.equal(restored.get('a'), 'one');
    assert.equal(restored.get('b'), 'two');
  });

  await check('脏数据逐条丢弃，不报废整份缓存', async () => {
    const cache = new TranslationCache({ maxEntries: 10 });
    cache.loadRecords([
      { key: 'good', value: 'ok', usedAt: 1 },
      null,
      'not-an-object',
      { key: '', value: 'empty key' },
      { key: 'no-value' },
      { key: 'bad-time', value: 'still usable', usedAt: 'yesterday' },
      42,
    ]);
    assert.equal(cache.get('good'), 'ok', '正常条目必须保留');
    assert.equal(cache.get('bad-time'), 'still usable', '时间戳坏了但内容可用，应当救回来');
    assert.equal(cache.stats().entries, 2, `只应保留 2 条，实际 ${cache.stats().entries}`);
  });

  await check('恢复时也受上限约束（旧文件过大不会顶满内存）', async () => {
    const cache = new TranslationCache({ maxEntries: 2 });
    cache.loadRecords([
      { key: 'a', value: '1', usedAt: 1 },
      { key: 'b', value: '2', usedAt: 2 },
      { key: 'c', value: '3', usedAt: 3 },
    ]);
    assert.equal(cache.stats().entries, 2);
    assert.equal(cache.get('a'), null, '最旧的应当被淘汰');
  });

  // -------------------------------------------------------------------------
  section('队列：串行、限速、去重');

  /** 假时钟：sleep 直接把虚拟时间往前推，因此断言不花真实时间 */
  function fakeClock() {
    let current = 0;
    return {
      now: () => current,
      sleep: async (ms) => {
        current += ms;
      },
      advance: (ms) => {
        current += ms;
      },
      get current() {
        return current;
      },
    };
  }

  await check('全局下限就是 100ms（用户要求）', async () => {
    assert.equal(MIN_REQUEST_INTERVAL_MS, 100);
  });

  await check('顺序执行：一次只跑一个，绝不并发', async () => {
    const clock = fakeClock();
    const queue = new EngineQueue({ minIntervalMs: 0, now: clock.now, sleep: clock.sleep });
    const order = [];
    let concurrent = 0;
    let maxConcurrent = 0;

    const make = (id) => ({
      id,
      run: async () => {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        order.push(`start-${id}`);
        await clock.sleep(5);
        order.push(`end-${id}`);
        concurrent -= 1;
      },
    });

    queue.enqueue(make('a'));
    queue.enqueue(make('b'));
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(maxConcurrent, 1, '同时只能有一个请求在跑');
    assert.deepEqual(order, ['start-a', 'end-a', 'start-b', 'end-b']);
  });

  await check('两次请求之间至少间隔 100ms（即使引擎下限为 0）', async () => {
    const clock = fakeClock();
    const queue = new EngineQueue({ minIntervalMs: 0, now: clock.now, sleep: clock.sleep });
    const startedAt = [];

    for (const id of ['a', 'b', 'c']) {
      queue.enqueue({
        id,
        run: async () => {
          startedAt.push(clock.current);
        },
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(startedAt.length, 3);
    assert.equal(startedAt[0], 0, '第一个请求应当立即发出');
    for (let index = 1; index < startedAt.length; index += 1) {
      const gap = startedAt[index] - startedAt[index - 1];
      assert.ok(gap >= MIN_REQUEST_INTERVAL_MS, `第 ${index + 1} 个请求间隔只有 ${gap}ms`);
    }
  });

  await check('引擎下限更大时取它（百度仍是 1 QPS 的 1100ms）', async () => {
    const clock = fakeClock();
    const queue = new EngineQueue({
      minIntervalMs: BAIDU_MIN_INTERVAL_MS,
      now: clock.now,
      sleep: clock.sleep,
    });
    const startedAt = [];
    for (const id of ['a', 'b']) {
      queue.enqueue({
        id,
        run: async () => {
          startedAt.push(clock.current);
        },
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(startedAt[1] - startedAt[0], BAIDU_MIN_INTERVAL_MS);
    assert.ok(BAIDU_MIN_INTERVAL_MS > MIN_REQUEST_INTERVAL_MS, '百度下限必须大于全局下限');
  });

  await check('同 id 重复入队只保留最新一次（实时翻译不必翻中间态）', async () => {
    const clock = fakeClock();
    const queue = new EngineQueue({ minIntervalMs: 0, now: clock.now, sleep: clock.sleep });
    const ran = [];

    queue.enqueue({
      id: 'module-1',
      run: async () => {
        ran.push('first');
        // 第一个还在跑的时候，用户又敲了字
        queue.enqueue({
          id: 'module-1',
          run: async () => {
            ran.push('second');
          },
        });
        queue.enqueue({
          id: 'module-1',
          run: async () => {
            ran.push('third');
          },
        });
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.deepEqual(ran, ['first', 'third'], '中间态应当被后来的入队覆盖');
  });

  await check('单个任务抛错不会中断队列', async () => {
    const clock = fakeClock();
    const queue = new EngineQueue({ minIntervalMs: 0, now: clock.now, sleep: clock.sleep });
    const ran = [];

    queue.enqueue({
      id: 'bad',
      run: async () => {
        ran.push('bad');
        throw new Error('模拟失败');
      },
    });
    queue.enqueue({
      id: 'good',
      run: async () => {
        ran.push('good');
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.deepEqual(ran, ['bad', 'good'], '后面的任务必须照常执行');
  });

  await check('可以取消待办任务，也可以查看排队情况', async () => {
    const clock = fakeClock();
    const queue = new EngineQueue({ minIntervalMs: 0, now: clock.now, sleep: clock.sleep });
    queue.enqueue({
      id: 'busy',
      run: async () => {
        await clock.sleep(50);
      },
    });
    queue.enqueue({ id: 'waiting-1', run: async () => {} });
    queue.enqueue({ id: 'waiting-2', run: async () => {} });

    assert.deepEqual(queue.pendingIds(), ['waiting-1', 'waiting-2']);
    assert.equal(queue.cancel('waiting-1'), true);
    assert.deepEqual(queue.pendingIds(), ['waiting-2']);
    assert.equal(queue.cancel('不存在'), false);

    queue.clear();
    assert.deepEqual(queue.pendingIds(), []);
    await new Promise((resolve) => setTimeout(resolve, 5));
  });

  await check('同一引擎共享一条队列，不同引擎互不影响', async () => {
    resetEngineQueues();
    const baidu = engineQueue('baidu-translate', BAIDU_MIN_INTERVAL_MS);
    const again = engineQueue('baidu-translate', BAIDU_MIN_INTERVAL_MS);
    const tencent = engineQueue('tencent-translate', 0);

    assert.equal(baidu, again, '同一引擎必须拿到同一条队列');
    assert.notEqual(baidu, tencent, '不同引擎必须各自一条队列');
    resetEngineQueues();
  });

  // -------------------------------------------------------------------------
  console.log(`\n通过 ${passed} 项，失败 ${failures.length} 项`);
  if (failures.length > 0) {
    console.log(`失败清单：${failures.join('、')}`);
    process.exit(1);
  }
})();
