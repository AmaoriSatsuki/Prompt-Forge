#!/usr/bin/env node
/**
 * 实时翻译调度层（V3 第一层）的集成断言。
 *
 * 与 verify-scheduler.cjs 的分工：
 * - verify-scheduler：缓存与队列的**纯逻辑**（假时钟、假上限）
 * - 本文件：把 `useRealtimeTranslate` 真的挂进 jsdom，用**假 Tauri 通道**跑完整链路 ——
 *   打字 → 防抖 → 摘胶囊 → 查缓存 → 队列 → 第二层翻译 → 写回状态。
 *
 * 因此这里断言的是「接线对不对」，不是算法对不对（算法在 verify-slice）。
 * 不需要网络、不需要密钥：`@tauri-apps/api/core` 被整体替换成假的 invoke。
 *
 * 运行：npm run verify:realtime
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { JSDOM } = require('jsdom');

const OUT = path.join(__dirname, '..', '.verify-out');
fs.writeFileSync(path.join(OUT, 'package.json'), '{"type":"commonjs"}\n');

// ---------------------------------------------------------------------------
// 假 Tauri 通道：在加载任何业务代码之前挂上
// ---------------------------------------------------------------------------

const calls = { cache: [], translate: [], test: [] };
/** 让某次翻译失败（按调用序号，从 1 开始） */
let failOnCall = 0;
/** 让**下一次**翻译失败（不看序号：百度有 1.1 秒节流，按下标注入会错位） */
let failNextRequest = false;
/** 让连接测试失败（用于验证「没凭据不测」与测试失败的措辞） */
let failTestConnection = false;
/** 假译文：把每行包一层 EN(...) */
let translateImpl = (text) =>
  text
    .split('\n')
    .map((line) => `EN(${line})`)
    .join('\n');

/**
 * 让**下一次**翻译请求慢下来（毫秒）。
 *
 * 幽灵译文回归用例需要「请求已经发出、但还没回包」的那个窗口；其余用例保持 0，
 * 以免整层变慢。用完必须在 `finally` 里归零。
 */
let translateDelayMs = 0;

const fakeInvoke = async (command, args) => {
  if (command === 'load_cache') {
    calls.cache.push({ command });
    return [];
  }
  if (command === 'save_cache' || command === 'clear_cache') {
    calls.cache.push({ command, count: args?.entries?.length ?? 0 });
    return null;
  }
  if (command === 'baidu_translate') {
    calls.translate.push({ command, text: args?.text });
    if (failNextRequest) {
      failNextRequest = false;
      throw { code: 'NETWORK', message: '网络不可用' };
    }
    if (failOnCall > 0 && calls.translate.length === failOnCall) {
      throw { code: 'NETWORK', message: '网络不可用' };
    }
    if (translateDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, translateDelayMs));
    }
    return { text: translateImpl(args?.text ?? ''), model: 'fake-model', elapsedMs: 1 };
  }
  // 启动自动测试也会走这个命令（复用同一套测试连接逻辑），这里按「连接正常」应答
  if (command === 'test_connection') {
    calls.test.push({ command, profileId: args?.profile?.id });
    if (failTestConnection) throw { code: 'NETWORK', message: '连接测试失败' };
    return { ok: true, elapsedMs: 1, message: '连接正常' };
  }
  /*
   * 配置加载：这里必须应答「磁盘上没有配置」，让 store 保留本文件设置的夹具。
   * 若让它抛错，`loadConfig` 会走失败分支并把 profiles 换掉（用的是运行时生成的 id），
   * 后续按 id 断言就会全部对不上 —— 这正是「启动自动测试」接进来之后暴露的竞态。
   */
  if (command === 'load_config') return null;
  if (command === 'save_config') return null;
  throw { code: 'UNMOCKED', message: `测试未模拟的命令：${command}` };
};

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === '@tauri-apps/api/core') return { invoke: fakeInvoke };
  return originalLoad.call(this, request, parent, isMain);
};

// jsdom + 全局注入（与 verify-interaction 保持一致）
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
const { window } = dom;
window.__TAURI_INTERNALS__ = {};

globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Element = window.Element;
globalThis.Node = window.Node;
globalThis.Event = window.Event;
globalThis.MouseEvent = window.MouseEvent;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.requestAnimationFrame =
  window.requestAnimationFrame?.bind(window) ?? ((callback) => setTimeout(callback, 0));
globalThis.cancelAnimationFrame = window.cancelAnimationFrame?.bind(window) ?? clearTimeout;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });

const React = require('react');
const { act } = require('react');
const { createRoot } = require('react-dom/client');

const load = (relative) => require(path.join(OUT, relative));

const { useRealtimeTranslate, resetRealtimeSchedule } = load('hooks/useRealtimeTranslate.js');
const { resetCacheForTest } = load('hooks/translationCacheStore.js');
const { useModuleStore } = load('store/useModuleStore.js');
const { useSettingsStore } = load('store/useSettingsStore.js');
const { useUiStore } = load('store/useUiStore.js');
const { createProfile } = load('utils/profileSanitize.js');
const { capsuleAnchor } = load('utils/placeholder.js');
const { REALTIME_DEBOUNCE_MS, BAIDU_MIN_INTERVAL_MS, CACHE_MAX_ENTRIES } = load('constants/limits.js');
const { buildGlossaryIndex } = load('utils/glossary.js');
const { useDictionaryStore } = load('store/useDictionaryStore.js');

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

/**
 * 刷新一轮：把 setTimeout 与微任务都放进 `act` 里跑完。
 *
 * 等待**必须在 act 内**，否则定时器回调里的状态更新会落在 act 之外，
 * React 会刷一屏 `not wrapped in act(...)` 警告（功能不受影响，但会淹没真实错误）。
 */
const flush = (ms = 15) => act(async () => {
  await new Promise((resolve) => setTimeout(resolve, ms));
});

/** 轮询等待条件成立（真实计时器，因此防抖是真的等出来的） */
async function waitFor(predicate, { timeout = 5000, label = '条件' } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await flush();
  }
  throw new Error(`等待超时：${label}`);
}

/** 只有调度层的最小宿主组件：不挂整个 AppShell，避免界面噪声干扰断言 */
function Harness() {
  useRealtimeTranslate();
  return null;
}

(async () => {
  /*
   * 夹具的 id 必须是确定的（`p_test`）：`createProfile` 不接 id（它不在 CreateProfileOptions 里），
   * 所以先造出来再把 id 覆盖掉 —— 否则 `keyStatus` 与 `connectionStatus` 都会按错的 id 记录，
   * 断言里查 `p_test` 永远查不到（这正是指示灯断言暴露出来的老问题）。
   */
  const baseProfile = createProfile({ label: '测试配置', brand: 'baidu' });
  const fixtureProfile = {
    ...baseProfile,
    id: 'p_test',
  };
  useSettingsStore.setState({
    profiles: [fixtureProfile],
    activeProfileId: 'p_test',
    keyStatus: { p_test: true },
  });
  useModuleStore.getState().resetModules();

  const container = document.getElementById('root');
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(Harness));
  });

  const modules = () => useModuleStore.getState().modules;
  const first = () => modules()[0];

  // -------------------------------------------------------------------------
  section('防抖：打字期间不发请求，停手 500ms 才发');

  await check('连续改动只在停手后发一次请求', async () => {
    calls.translate.length = 0;
    resetRealtimeSchedule();
    resetCacheForTest();

    const id = first().id;
    await act(async () => {
      useModuleStore.getState().setSourceText(id, '女');
    });
    await act(async () => {
      useModuleStore.getState().setSourceText(id, '女孩');
    });
    await act(async () => {
      useModuleStore.getState().setSourceText(id, '女孩，长头发');
    });

    // 防抖窗口内不该有任何请求
    assert.equal(calls.translate.length, 0, '防抖期间不该发请求');

    await waitFor(() => calls.translate.length > 0, { label: '防抖后发出请求' });
    // 再等一小会儿，确认没有第二个请求
    await new Promise((resolve) => setTimeout(resolve, REALTIME_DEBOUNCE_MS + 200));
    assert.equal(calls.translate.length, 1, `应当只发一次，实际 ${calls.translate.length} 次`);
    assert.equal(calls.translate[0].text, '女孩\n长头发');
  });

  await check('翻完写回译文与状态（done）', async () => {
    await waitFor(() => first().status === 'done', { label: '状态变成 done' });
    assert.equal(first().translation, 'en(女孩), en(长头发)');
    assert.equal(modules().length, 6, '只影响第 1 排，其他排不动');
    assert.equal(modules()[1].status, 'idle', '其他模块状态不受影响');
  });

  // -------------------------------------------------------------------------
  section('缓存：同文本不再发请求');

  const requestsAfterFirst = () => calls.translate.length;

  await check('内容没变时不会重复请求', async () => {
    const before = requestsAfterFirst();
    await new Promise((resolve) => setTimeout(resolve, REALTIME_DEBOUNCE_MS + 200));
    assert.equal(requestsAfterFirst(), before, '源内容没变就不该再发请求');
  });

  await check('改成别的内容会再发一次请求', async () => {
    const id = first().id;
    const before = calls.translate.length;

    await act(async () => {
      useModuleStore.getState().setSourceText(id, '短发');
    });
    await waitFor(() => calls.translate.length > before, { label: '新内容发出请求' });
    await waitFor(() => first().status === 'done', { label: '新内容翻完' });
  });

  await check('改回之前翻过的内容：命中缓存，不发请求', async () => {
    const id = first().id;
    const before = calls.translate.length;

    await act(async () => {
      useModuleStore.getState().setSourceText(id, '女孩，长头发');
    });
    await waitFor(() => first().translation === 'en(女孩), en(长头发)', { label: '命中缓存写回' });
    await new Promise((resolve) => setTimeout(resolve, REALTIME_DEBOUNCE_MS + 200));

    assert.equal(calls.translate.length, before, '命中缓存时不该再发请求');
    assert.equal(first().status, 'done', '命中缓存也要把状态推进到 done');
  });

  await check('缓存已落盘（写磁盘被调用过）', async () => {
    await waitFor(
      () => calls.cache.some((entry) => entry.command === 'save_cache'),
      { label: '缓存写盘' },
    );
    const saved = calls.cache.filter((entry) => entry.command === 'save_cache').pop();
    assert.ok(saved.count > 0, '写盘时应当带着条目');
    assert.ok(CACHE_MAX_ENTRIES >= 10000, '上限应当是一万条');
  });

  // -------------------------------------------------------------------------
  section('胶囊：不进请求体，但保留在本地');

  await check('请求体只有纯中文，锚点与术语英文都不出门', async () => {
    const id = first().id;
    calls.translate.length = 0;

    // 换一段没翻过的中文，这样一定会真的发请求
    await act(async () => {
      useModuleStore.getState().setSourceText(id, '微笑的少女');
    });
    await waitFor(() => calls.translate.length > 0, { label: '新内容发出请求' });

    // 再插入一颗胶囊（纯中文部分不变，因此命中缓存不再发请求）
    await act(async () => {
      useModuleStore.getState().insertCapsule(
        id,
        {
          label: '千早爱音',
          presetId: 'p_cap',
          english: 'Chihaya Anon',
          colorId: 'pink',
        },
        'after-capsules',
      );
    });
    await waitFor(() => first().capsules.length === 1, { label: '胶囊插入成功' });
    await new Promise((resolve) => setTimeout(resolve, REALTIME_DEBOUNCE_MS + 200));

    const sent = calls.translate.map((call) => call.text).join('\n');
    assert.equal(sent.includes('[['), false, '锚点绝不能进请求体');
    assert.equal(sent.includes('Chihaya'), false, '术语英文绝不能进请求体');
    assert.equal(sent.includes('微笑的少女'), true, '纯中文必须照常送出');
  });

  await check('插入胶囊不再重翻正文：正文缓存不看术语英文（胶囊是独立块）', async () => {
    /*
     * 纯中文没变 ⇒ 正文缓存键也没变 ⇒ 命中缓存，不重复打接口。
     * 术语英文只在复制 / 推流时由 `plainEnglishOf` 现取装配，因此
     * 「展示是新的、复制还是旧的」不可能发生（那是把胶囊英文塞进正文才会有的问题）。
     */
    const settled = calls.translate.length;
    const translation = first().translation;
    await new Promise((resolve) =>
      setTimeout(resolve, BAIDU_MIN_INTERVAL_MS + REALTIME_DEBOUNCE_MS + 200),
    );
    assert.equal(calls.translate.length, settled, '正文没变，插入胶囊不该重新打接口');
    assert.equal(first().translation, translation, '译文正文保持不变');
    assert.equal(first().capsules.length, 1, '胶囊仍然在模块上');
  });

  await check('稳定之后不再重复请求（缓存命中）', async () => {
    const settled = calls.translate.length;
    // 等一个完整的节流窗口，确认没有第三、第四次请求
    await new Promise((resolve) =>
      setTimeout(resolve, BAIDU_MIN_INTERVAL_MS + REALTIME_DEBOUNCE_MS + 200),
    );
    assert.equal(calls.translate.length, settled, '内容与胶囊都没再变，不该有新请求');
    assert.equal(first().status, 'done', '状态仍然可用');
  });

  await check('展示译文仍只含中文部分（胶囊英文留给复制链路）', async () => {
    await waitFor(() => first().status === 'done', { label: '翻译完成' });
    assert.equal(
      first().translation.includes('Chihaya'),
      false,
      '展示译文里不该出现术语英文',
    );
    assert.equal(first().capsules.length, 1, '胶囊仍然保留在模块上');
  });

  // -------------------------------------------------------------------------
  section('每模块独立 + 失败保留旧译文');

  await check('一个模块失败不影响另一个模块', async () => {
    const [moduleA, moduleB] = modules();
    calls.translate.length = 0;
    failOnCall = 1; // 让接下来第一个请求失败

    await act(async () => {
      useModuleStore.getState().setSourceText(moduleA.id, '会失败的文本');
      useModuleStore.getState().setSourceText(moduleB.id, '会成功的文本');
    });

    // 两排都在等待防抖；A 先失败也不能把 B 的定时器一起清掉
    await waitFor(() => {
      const current = modules();
      return current[0].status === 'error' && current[1].status === 'done';
    }, { label: 'A 失败且 B 成功' });

    assert.ok(modules()[1].translation.length > 0, '成功的那个要有译文');
    failOnCall = 0;
  });

  await check('失败时保留旧译文，不清空', async () => {
    const id = first().id;
    // 先成功翻一次，拿到一个可用译文
    calls.translate.length = 0;
    failOnCall = 0;
    await act(async () => {
      useModuleStore.getState().setSourceText(id, '先成功一段');
    });
    await waitFor(() => first().status === 'done' && first().translation.length > 0, {
      label: '先取得一个成功译文',
    });
    const goodTranslation = first().translation;

    // 再让它失败
    failOnCall = calls.translate.length + 1;
    await act(async () => {
      useModuleStore.getState().setSourceText(id, '再失败一段');
    });
    await waitFor(() => first().status === 'error', { label: '状态变成 error' });

    assert.equal(first().translation, goodTranslation, '失败时必须保留上一版译文');
    assert.ok(first().error?.message, '应当记下中文失败原因');
    failOnCall = 0;
  });

  await check('清空模块不会被实时翻译重新填上内容', async () => {
    const id = first().id;
    calls.translate.length = 0;
    await act(async () => {
      useModuleStore.getState().clearModule(id);
    });
    await new Promise((resolve) => setTimeout(resolve, REALTIME_DEBOUNCE_MS + 200));

    assert.equal(calls.translate.length, 0, '空内容不该触发翻译');
    assert.equal(first().translation, '', '清空后译文仍为空');
    assert.equal(first().status, 'idle');
  });

  // -------------------------------------------------------------------------
  section('空内容：一次删完与逐步删完必须表现一致（用户实测 bug）');

  /** 先让第 1 排有个可用译文，返回它的 id */
  async function prepareTranslatedRow(text) {
    const id = first().id;
    calls.translate.length = 0;
    await act(async () => {
      useModuleStore.getState().setSourceText(id, text);
    });
    await waitFor(() => first().status === 'done' && first().translation.length > 0, {
      label: `第 1 排翻译出「${text}」`,
    });
    return id;
  }

  await check('一次删完（全选删除）：译文立刻清空、状态回到 idle', async () => {
    await prepareTranslatedRow('女孩，长头发');
    assert.ok(first().translation.length > 0, '前置条件：先有译文');

    const before = calls.translate.length;
    await act(async () => {
      useModuleStore.getState().setSourceText(first().id, '');
    });
    await flush();

    assert.equal(first().translation, '', '输出框必须立刻清空');
    assert.equal(first().status, 'idle', '状态必须复位为待翻译');
    assert.equal(first().error, undefined, '错误也要清掉');
    assert.equal(first().translationMeta, undefined, '用量信息不该残留');
    assert.equal(calls.translate.length, before, '清空不该发翻译请求');
  });

  await check('只剩空格：同样清空（判空口径与翻译一致）', async () => {
    await prepareTranslatedRow('微笑的少女');
    const id = first().id;
    const before = calls.translate.length;

    await act(async () => {
      useModuleStore.getState().setSourceText(id, '   ');
    });
    await flush();

    assert.equal(first().translation, '', '纯空格也算空，必须清空译文');
    assert.equal(first().status, 'idle');
    assert.equal(calls.translate.length, before, '不该发请求');
  });

  await check('只剩标点：同样算空内容（判空口径与切片一致）', async () => {
    await prepareTranslatedRow('微笑的少女');
    const id = first().id;
    const before = calls.translate.length;

    await act(async () => {
      useModuleStore.getState().setSourceText(id, '，。！');
    });
    await flush();

    assert.equal(first().translation, '', '只剩标点也算空，必须清空译文（不能留着上一版）');
    assert.equal(first().status, 'idle');
    assert.equal(calls.translate.length, before, '不该发请求');
  });

  await check('逐步删完：与一次删完结果完全一致', async () => {
    // 用全新文本，避免命中前面用例留下的缓存（否则「发了几次请求」不可预测）
    await prepareTranslatedRow('紫眼睛，白围巾，银长发');
    const id = first().id;

    // 真正「逐步删」：每删一次都等它翻完，再删下一次（与用户手感一致）
    for (const partial of ['紫眼睛，白围巾，银长', '紫眼睛，白围巾', '紫眼睛']) {
      await act(async () => {
        useModuleStore.getState().setSourceText(id, partial);
      });
      await waitFor(() => first().status === 'done', { label: `「${partial}」翻完` });
    }
    const afterPartialDeletes = calls.translate.length;

    // 最后一次删成空
    await act(async () => {
      useModuleStore.getState().setSourceText(id, '');
    });
    await flush();

    // 与「一次删完」的期望状态逐项相同
    assert.equal(first().translation, '', '逐步删到空，译文同样必须清空');
    assert.equal(first().status, 'idle', '状态复位为待翻译');
    assert.equal(first().error, undefined);
    assert.equal(first().translationMeta, undefined);
    assert.equal(calls.translate.length, afterPartialDeletes, '清空这一次不该发请求');
  });

  await check('删空时撤销尚未触发的防抖定时器（不会「过一会儿又翻出来」）', async () => {
    const id = first().id;
    calls.translate.length = 0;

    // 先打一段内容让防抖排队，但不等它触发
    await act(async () => {
      useModuleStore.getState().setSourceText(id, '还没等到防抖就删掉');
    });
    // 立刻删空 → 定时器必须被撤销
    await act(async () => {
      useModuleStore.getState().setSourceText(id, '');
    });
    await new Promise((resolve) => setTimeout(resolve, REALTIME_DEBOUNCE_MS + 300));

    assert.equal(calls.translate.length, 0, '被撤销的防抖不该再发请求');
    assert.equal(first().translation, '', '译文保持为空');
    assert.equal(first().status, 'idle', '状态保持 idle');
  });

  await check('只放了胶囊、没有中文：算空内容，清空译文但不删胶囊', async () => {
    const id = first().id;
    calls.translate.length = 0;
    await act(async () => {
      useModuleStore.getState().setSourceText(id, '有中文');
    });
    await waitFor(() => first().status === 'done' && first().translation.length > 0, {
      label: '先翻一次',
    });
    await act(async () => {
      useModuleStore.getState().insertCapsule(
        id,
        {
          label: '千早爱音',
          presetId: 'p_cap2',
          english: 'Chihaya Anon',
          colorId: 'pink',
        },
        'after-capsules',
      );
    });
    // 把中文删掉，只留胶囊锚点
    await act(async () => {
      const anchor = useModuleStore.getState().modules[0].sourceText.match(/\[\[cap:[^\]]+\]\]/)?.[0] ?? '';
      useModuleStore.getState().setSourceText(id, anchor);
    });
    await flush();

    assert.equal(first().translation, '', '只剩胶囊时没有可翻译内容，译文应清空');
    assert.equal(first().status, 'idle');
    assert.equal(first().capsules.length, 1, '胶囊本身必须保留（它是内容，不是垃圾）');
    assert.equal(first().sourceText.includes('[[cap:'), true, '锚点也要保留');
  });

  await check('在途回包不写回已清空的排（幽灵译文）', async () => {
    /*
     * 防抖 500ms 之后还有队列与网络等待。这个窗口里用户可能把内容删空；
     * 旧实现在回包时只按 moduleId 写回，于是「中文已经没了，输出框又冒出
     * 上一段英文」，复制 / 推流 / 快照都会把它带走。这条用例把请求按住
     * 800ms，等它真的在途之后再删空，回来核对状态。
     */
    const id = first().id;
    await act(async () => {
      useModuleStore.getState().clearModule(id);
    });
    calls.translate.length = 0;
    translateDelayMs = 800;
    try {
      await act(async () => {
        useModuleStore.getState().setSourceText(id, '幽灵回包的少女');
      });
      await waitFor(() => calls.translate.length > 0, { label: '请求已发出（在途）' });

      await act(async () => {
        useModuleStore.getState().setSourceText(id, '，。！');
      });
      await flush();
      assert.equal(first().translation, '', '删空后立刻清空');
      assert.equal(first().status, 'idle', '删空后立刻回到 idle');

      // 等过在途请求的回包时间：迟到的结果绝不能写回来
      await flush(translateDelayMs + 300);
      assert.equal(first().translation, '', '在途回包不能把译文写回来');
      assert.equal(first().status, 'idle', '状态不能被迟到的回包改成 done');
      assert.equal(first().error, undefined, '也不该给已经清空的排挂错误');
    } finally {
      translateDelayMs = 0;
    }
  });

  // -------------------------------------------------------------------------
  section('顶栏指示灯：翻译请求成功 / 失败同步更新');

  const lightOf = (id) => useSettingsStore.getState().connectionStatus[id];

  /**
   * 启动接线（`useConnectionStatus`）可能同时跑着一次自动测试。这里等它先落定，
   * 之后本段的结论才只可能来自「翻译请求」这一条路径 —— 否则断言会与它互相干扰。
   */
  await waitFor(
    () => useSettingsStore.getState().testingProfileId === null,
    { label: '启动自动测试落定' },
  );

  await check('真实请求成功 → 绿灯', async () => {
    useSettingsStore.setState({ connectionStatus: {} });
    resetRealtimeSchedule();
    resetCacheForTest();
    calls.translate.length = 0;

    const id = first().id;
    await act(async () => {
      useModuleStore.getState().setSourceText(id, '指示灯转绿');
    });
    await waitFor(() => first().status === 'done', { label: '翻译完成' });

    assert.ok(calls.translate.length > 0, '这一轮必须真的发了请求');
    assert.equal(lightOf('p_test'), 'ok', '请求成功应当点亮绿灯');
  });

  await check('真实请求失败 → 红灯', async () => {
    useSettingsStore.setState({ connectionStatus: {} });
    resetRealtimeSchedule();
    resetCacheForTest();
    calls.translate.length = 0;

    const id = first().id;
    /*
     * 失败注入用「下一次请求必失败」的开关，而不是按调用序号：
     * 百度通道有 1.1 秒节流，序号注入会因为队列里还压着上一个请求而错位（本轮实测）。
     */
    failNextRequest = true;
    await act(async () => {
      useModuleStore.getState().setSourceText(id, '指示灯转红');
    });

    await waitFor(() => first().status === 'error', { label: '翻译失败' });
    const observed = lightOf('p_test');

    assert.equal(observed, 'error', '请求失败应当点亮红灯');
  });

  await check('命中缓存不算证据：不发请求就不动指示灯', async () => {
    failOnCall = 0; // 上一轮故意注入了失败，这里必须收手，否则这一轮的第一个请求会假失败
    failNextRequest = false;
    resetRealtimeSchedule();
    resetCacheForTest();
    calls.translate.length = 0;

    // 先真翻一次，把结果写进缓存
    const id = first().id;
    await act(async () => {
      useModuleStore.getState().setSourceText(id, '命中缓存这一条');
    });
    await waitFor(() => first().status === 'done' && calls.translate.length > 0, {
      label: '第一次真翻译',
    });
    const requestsAfterFirst = calls.translate.length;

    // 换成另一段内容（确保下一次回切时走的是缓存、而不是沿用刚写完的同一份源内容）
    await act(async () => {
      useModuleStore.getState().setSourceText(id, '换个内容');
    });
    await waitFor(
      () => first().status === 'done' && calls.translate.length > requestsAfterFirst,
      { label: '换内容翻完' },
    );

    // 人为置红，再把内容换回第一条 —— 这一轮应当命中缓存
    useSettingsStore.getState().reportConnection('p_test', false);
    resetRealtimeSchedule();
    const before = calls.translate.length;
    await act(async () => {
      useModuleStore.getState().setSourceText(id, '命中缓存这一条');
    });
    await waitFor(() => first().status === 'done' && first().translation.length > 0, {
      label: '缓存命中翻完',
    });

    assert.equal(calls.translate.length, before, '最后这一次应当是缓存命中，没有新增请求');
    assert.equal(lightOf('p_test'), 'error', '没有真发请求就不该改动指示灯');
  });

  // -------------------------------------------------------------------------
  section('本地词典（D50）：优先级高于缓存，全部命中时不发请求');

  /** 直接给 store 喂词典运行时状态（绕过 Rust 命令，只测调度层的接线） */
  function setGlossary(entries, fingerprint) {
    useDictionaryStore.setState({
      glossaryIndex: buildGlossaryIndex([{ enabled: true, entries }]),
      fingerprint,
    });
  }

  await check('词典命中优先于缓存：不发请求，输出词典里的英文（保留大小写）', async () => {
    failNextRequest = false;
    failOnCall = 0;
    resetRealtimeSchedule();
    resetCacheForTest();
    setGlossary([], 'no-dict');
    calls.translate.length = 0;

    const id = first().id;
    // 先用「没有词典」真翻一次：结果进缓存，证明后面不是靠缓存拿到旧值
    await act(async () => {
      useModuleStore.getState().setSourceText(id, '千早爱音');
    });
    await waitFor(() => first().status === 'done' && calls.translate.length > 0, {
      label: '无词典先翻一次',
    });
    assert.equal(first().translation, 'en(千早爱音)');

    setGlossary([{ cn: '千早爱音', en: 'Chihaya Anon' }], 'dict-1');
    resetRealtimeSchedule();
    const before = calls.translate.length;
    // 末尾加空格：快照变了会触发一次，但切片后仍是同一个词
    await act(async () => {
      useModuleStore.getState().setSourceText(id, '千早爱音 ');
    });
    await waitFor(() => first().translation === 'Chihaya Anon', { label: '词典命中写回' });
    assert.equal(calls.translate.length, before, '词典命中不该发请求，也不该走缓存拿旧结果');
    assert.equal(first().status, 'done');
  });

  await check('混合片段：只把未命中的片段发给翻译服务', async () => {
    resetRealtimeSchedule();
    resetCacheForTest();
    setGlossary([{ cn: '千早爱音', en: 'Chihaya Anon' }], 'dict-1');
    calls.translate.length = 0;

    const id = first().id;
    await act(async () => {
      useModuleStore.getState().setSourceText(id, '千早爱音，长发');
    });
    await waitFor(() => first().status === 'done' && calls.translate.length > 0, {
      label: '混合片段翻完',
    });
    assert.deepEqual(calls.translate.map((call) => call.text), ['长发'], '命中段不进请求体');
    assert.equal(first().translation, 'Chihaya Anon, en(长发)');
  });

  await check('词典指纹变化 → 同一段中文不再命中旧缓存', async () => {
    resetRealtimeSchedule();
    resetCacheForTest();
    calls.translate.length = 0;
    const id = first().id;

    setGlossary([], 'fp-a');
    await act(async () => {
      useModuleStore.getState().setSourceText(id, '缓存甲');
    });
    await waitFor(() => first().status === 'done' && calls.translate.length === 1, {
      label: '第一次翻译',
    });

    resetRealtimeSchedule();
    // 同样没有词典，但指纹变了（等价于「导入 / 排序 / 启停发生了」）
    setGlossary([], 'fp-b');
    await act(async () => {
      useModuleStore.getState().setSourceText(id, '缓存乙');
    });
    await waitFor(() => first().status === 'done' && calls.translate.length === 2, {
      label: '第二次翻译',
    });

    resetRealtimeSchedule();
    await act(async () => {
      useModuleStore.getState().setSourceText(id, '缓存甲');
    });
    await waitFor(() => first().status === 'done' && first().translation === 'en(缓存甲)', {
      label: '第三次写回',
    });
    assert.equal(calls.translate.length, 3, '指纹变了，旧缓存必须不命中');
  });

  await check('收手：词典状态清空，避免影响后面的断言', async () => {
    useDictionaryStore.setState({
      glossaryIndex: buildGlossaryIndex([]),
      fingerprint: 'empty',
    });
    assert.equal(useDictionaryStore.getState().glossaryIndex.size, 0);
  });

  // -------------------------------------------------------------------------
  section('收尾');

  await check('没有未处理的异常导致挂载失败（宿主仍可用）', async () => {
    assert.equal(container.innerHTML, '', '宿主组件不渲染任何东西');
    assert.equal(typeof useUiStore.getState().pushToast, 'function', 'UI store 正常');
  });

  await act(async () => {
    root.unmount();
  });

  console.log(`\n通过 ${passed} 项，失败 ${failures.length} 项`);
  if (failures.length > 0) {
    console.log(`失败清单：${failures.join('、')}`);
    process.exit(1);
  }
})();
