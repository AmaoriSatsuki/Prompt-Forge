import { useCallback, useEffect } from 'react';
import { clearCacheOnDisk } from '../api/cache';
import { callTranslate, SOURCE_LANG, TARGET_LANG } from '../api/translate';
import {
  BAIDU_MIN_INTERVAL_MS,
  GLOSSARY_VERSION,
  REALTIME_DEBOUNCE_MS,
  SEGMENT_MODE,
  SLICE_OUTPUT_SEPARATOR,
} from '../constants/limits';
import { findServiceBrand } from '../constants/providers';
import { currentProfile, useSettingsStore } from '../store/useSettingsStore';
import { useModuleStore } from '../store/useModuleStore';
import { useUiStore } from '../store/useUiStore';
import type { ProviderProfile } from '../types/settings';
import { engineQueue } from '../utils/engineQueue';
import { profileKind } from '../utils/profileSanitize';
import { buildTranslatePlan, stripAnchors } from '../utils/placeholder';
import { formatGlossaryOutput, resolveGlossaryTerm } from '../utils/glossary';
import { normalizePromptBody } from '../utils/promptPunctuation';
import { sliceTranslate, splitSlices } from '../utils/sliceTranslate';
import { buildCacheKey } from '../utils/translationCache';
import { useDictionaryStore } from '../store/useDictionaryStore';
import { cacheGet, cachePut, cacheStats, initializeCache, cacheClear } from './translationCacheStore';

/**
 * 实时翻译调度层（V3 第一层）。
 *
 * **只做调度**：监听源内容 → 防抖 → 排队 → 查缓存 → 写回状态。
 * 翻译算法在第二层（`utils/sliceTranslate.ts`），限速与串行在 `utils/engineQueue.ts`，
 * 缓存数据在 `utils/translationCache.ts`；本层一个都不重实现。
 *
 * 关键约定：
 * - **胶囊不进翻译函数**：这里先用 `buildTranslatePlan` 摘掉锚点，只把纯中文交给第二层；
 * - **展示译文只含「中文部分翻出来的英文」**：胶囊英文的拼接属于复制链路
 *   （`utils/moduleText.ts`），因此实时翻译写回的就是第二层的返回值本身；
 * - **每模块独立**：一次失败只影响它自己；失败时**保留旧译文**，只改状态；
 * - 手动翻译与实时翻译共用 `translateOne`（同一条引擎队列、同一个缓存），
 *   因此不会出现「实时 + 手动」同时打接口。
 */

/**
 * 已经排队过的源内容快照（模块 → 源内容）。
 *
 * 放模块作用域：多个 Hook 实例必须共享同一份记忆，否则界面重挂载会把
 * 「已经翻过、内容没变」的模块重新翻一遍。
 */
const lastScheduled = new Map<string, string>();

/**
 * 待触发的防抖定时器（模块 → 定时器 id）。
 *
 * 同样放模块作用域：定时器**不能**随 effect 生命周期一起清空 —— 见下方 effect 里的说明。
 */
const pendingTimers = new Map<string, number>();

/** 撤掉某个模块尚未触发的防抖定时器 */
function cancelPending(moduleId: string): void {
  const timer = pendingTimers.get(moduleId);
  if (timer === undefined) return;
  window.clearTimeout(timer);
  pendingTimers.delete(moduleId);
}

/**
 * 有没有「可翻译的中文」——判空口径必须与翻译链路完全一致：
 * 摘掉胶囊锚点后，**按同一套句读规则切出来的片段还有没有**。
 *
 * 因此「只放了胶囊、没有中文」与「只剩标点」（`，` / `。`）都算空：
 * 此时没有东西可翻译，输出框应当清空、状态回到 idle，而不是留着上一版的译文。
 */
function hasTranslatableText(module: {
  sourceText: string;
  capsules: readonly { id: string }[];
}): boolean {
  const knownIds = new Set(module.capsules.map((capsule) => capsule.id));
  return splitSlices(stripAnchors(module.sourceText, knownIds)).length > 0;
}

/**
 * 调度快照：**凡是会影响译文的东西都要进来**。
 *
 * - 源文本：决定送出去的中文；
 * - 胶囊清单（id + 中文名）：换胶囊、改中文名都要重翻一次。
 *
 * 只放这两样是刻意的：译文、状态、高度等都不该触发重翻（否则会自激循环）。
 *
 * **D121**：术语英文与权重都**不进**快照 —— 正文只由纯中文决定，胶囊是独立的
 * 一块（只在复制 / 推流时被 `plainEnglishOf` 现取装配）。因此每点一次加减都
 * 不会重翻，也绝不会出现「复制的英文与界面上不一致」。
 */
function sourceSnapshot(module: {
  sourceText: string;
  capsules: readonly { id: string; label: string }[];
}): string {
  const capsulePart = module.capsules
    .map((capsule) => `${capsule.id}\u0002${capsule.label}`)
    .join('\u0003');
  return `${module.sourceText.length}\u0001${module.sourceText}\u0004${capsulePart}`;
}

/**
 * 回包落地前再确认一次：这排要翻的中文还是不是发起时那一段。
 *
 * 防抖之后还有 500ms 到几秒的队列/网络等待；这期间用户可能把内容删空、
 * 改成纯标点、或换成另一段话。结果如果照着 `moduleId` 写回去，就会出现
 * 「中文已经没了，输出框又冒出上一段英文」的幽灵译文 —— 复制 / 推流 / 快照
 * 都会把它当正文带走。因此**内容对不上就整次作废**（成功与失败都作废）。
 */
function isCurrentSource(moduleId: string, chinese: string): boolean {
  const latest = useModuleStore.getState().modules.find((module) => module.id === moduleId);
  if (!latest) return false;
  return buildTranslatePlan(latest.sourceText, latest.capsules).text.trim() === chinese;
}

/** 清掉排队记忆，让某个模块可以被再次触发（失败后重试用） */
export function resetRealtimeSchedule(moduleId?: string): void {
  if (moduleId === undefined) lastScheduled.clear();
  else lastScheduled.delete(moduleId);
}

/** 缓存键里用的引擎名：由翻译服务推导，不落盘（沿用项目约定） */
function engineOf(profile: ProviderProfile): string {
  return profileKind(profile);
}

/** 每个引擎的最小间隔：百度仍是 1 QPS；将来接别的服务时按引擎各自定 */
function minIntervalOf(engine: string): number {
  return engine === 'baidu-translate' ? BAIDU_MIN_INTERVAL_MS : 0;
}

function buildKey(chinese: string, engine: string, glossaryVersion: string): string {
  return buildCacheKey({
    sourceText: chinese,
    sourceLang: SOURCE_LANG,
    targetLang: TARGET_LANG,
    engine,
    // 术语版本 + 词典指纹：词典一变，旧缓存自动不命中（D50）
    glossaryVersion,
    segmentMode: SEGMENT_MODE,
    // 胶囊英文**不参与**：胶囊是独立的装配块，正文只由纯中文决定
  });
}

export interface TranslateOneOptions {
  /** 由调用方（已校验过的配置）传入，避免这里再判一次「配置齐不齐」 */
  profile?: ProviderProfile;
  /** 是否允许命中缓存（默认允许） */
  useCache?: boolean;
}

/**
 * 翻译单个模块 —— **实时与手动共用的唯一入口**。
 *
 * 失败时**不清空旧译文**：用户看到的仍然是上一版可用结果 + 这一排的失败状态。
 */
export async function translateOne(
  moduleId: string,
  options: TranslateOneOptions = {},
): Promise<boolean> {
  const { profile: injectedProfile, useCache = true } = options;
  const store = useModuleStore.getState();
  const module = store.modules.find((item) => item.id === moduleId);
  if (!module) return false;

  const profile = injectedProfile ?? currentProfileFromStore();
  if (!profile) return false;

  // 摘胶囊：纯中文才进请求体（术语英文与锚点都不出去）
  const plan = buildTranslatePlan(module.sourceText, module.capsules);
  const chinese = plan.text.trim();
  if (!chinese) return false;

  const engine = engineOf(profile);

  /*
   * 本地词典（D50，优先级：胶囊 > 词典 > 缓存 > API）。
   *
   * 胶囊在上一步已经被摘掉（锚点与术语英文都不进请求体），因此这里只面对纯中文切片。
   * 整段精确匹配命中 → 直接写回，**不查缓存、不发网络请求**；
   * 只有未命中的片段才继续走缓存与 API。
   */
  const dictionaryState = useDictionaryStore.getState();
  const resolveSegment =
    dictionaryState.glossaryIndex.size > 0
      ? (segment: string): string | null => {
          const hit = resolveGlossaryTerm(dictionaryState.glossaryIndex, segment);
          return hit ? formatGlossaryOutput(hit) : null;
        }
      : undefined;

  if (resolveSegment) {
    const segments = splitSlices(chinese);
    const hits = segments.map((segment) => resolveSegment(segment));
    if (segments.length > 0 && hits.every((hit) => hit !== null)) {
      // 与切片翻译用同一个连接符常量，并过同一套正文收口（词典英文里的句读也收掉）
      store.setTranslation(
        moduleId,
        normalizePromptBody((hits as string[]).join(SLICE_OUTPUT_SEPARATOR)),
      );
      store.setStatus(moduleId, 'done');
      return true;
    }
  }

  // 词典指纹参与缓存键：导入/删除/排序/启停任何一项变了，旧缓存都不再命中
  const glossaryVersion = `${GLOSSARY_VERSION}:${dictionaryState.fingerprint}`;
  const key = buildKey(chinese, engine, glossaryVersion);

  if (useCache) {
    const cached = cacheGet(key);
    if (cached !== null) {
      // 命中：不占队列、不发请求，但状态照旧推进，界面表现与刚翻完一致
      store.setTranslation(moduleId, cached);
      store.setStatus(moduleId, 'done');
      return true;
    }
  }

  store.setStatus(moduleId, 'translating');
  const startedAt = Date.now();
  const pushToast = useUiStore.getState().pushToast;

  return new Promise<boolean>((resolve) => {
    engineQueue(engine, minIntervalOf(engine)).enqueue({
      id: moduleId,
      run: async () => {
        /*
         * 排队期间源内容可能已经被删空/改写：这次请求已经过期，直接收手，
         * 连接口都不打（防抖 timer 之外还有队列与网络两段等待，删空后
         * 队列里的那一次不能继续）。在途中的那一次由回包后的同一校验兜底。
         */
        if (!isCurrentSource(moduleId, chinese)) {
          resolve(false);
          return;
        }
        try {
          const outcome = await sliceTranslate(chinese, (text) => callTranslate(profile, text), {
            resolveSegment,
          });

          /*
           * 先记账再校验：译文本身对「发起时那段中文」是有效的，删空/改写不该
           * 阻止它进缓存（用户改回来时还能命中）。但**不能写回状态** —— 源内容
           * 已经不是那一段时，这次结果属于过去的那一排（幽灵译文）。
           */
          if (outcome.text) cachePut(key, outcome.text);
          if (!isCurrentSource(moduleId, chinese)) {
            resolve(false);
            return;
          }

          const state = useModuleStore.getState();
          if (!outcome.text) {
            // 没有可翻译内容：回到 idle，不算失败
            state.setStatus(moduleId, 'idle');
            resolve(false);
            return;
          }

          state.setTranslation(moduleId, outcome.text);
          state.setTranslationMeta(moduleId, {
            // 只剩专业翻译接口，没有模型名：记录服务商的中文名（界面不展示，供排查用）
            model: findServiceBrand(profile.brand)?.label ?? engine,
            elapsedMs: Date.now() - startedAt,
          });
          state.setStatus(moduleId, 'done');
          // 真发过请求并成功了 → 顶栏指示灯转绿（用户要求 4）
          reportConnectionStatus(profile.id, true);
          resolve(true);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          // 过期请求的失败不该贴到这一排的新内容上（错误横幅、toast、状态都不写）
          if (!isCurrentSource(moduleId, chinese)) {
            resolve(false);
            return;
          }
          // 保留旧译文，只标失败
          useModuleStore.getState().setStatus(moduleId, 'error', { code: 'TRANSLATE', message });
          // 真发过请求并失败了 → 顶栏指示灯转红（用户要求 4）
          reportConnectionStatus(profile.id, false);
          pushToast(`翻译失败：${message}`, 'error');
          resolve(false);
        }
      },
    });
  });
}

/** 当前生效的配置：复用 store 的 `currentProfile`，不重复实现取值口径 */
function currentProfileFromStore(): ProviderProfile | null {
  return currentProfile(useSettingsStore.getState()) ?? null;
}

/**
 * 把一次**真实网络请求**的成败报给顶栏指示灯。
 *
 * 刻意**不在缓存命中时调用**：命中缓存说明这次根本没打接口，
 * 用它去点亮绿灯会在「密钥其实已失效、只是内容恰好命中旧缓存」时给出假绿灯；
 * 反过来它也不该把红灯洗掉。只有真发出去的请求才算证据。
 */
function reportConnectionStatus(profileId: string, ok: boolean): void {
  useSettingsStore.getState().reportConnection(profileId, ok);
}

/** 供设置面板显示：当前缓存条数与占用 */
export function translationCacheSummary(): { entries: number; chars: number; approxBytes: number } {
  return cacheStats();
}

/**
 * 实时翻译的对外动作集合。
 *
 * 工具栏整合后**所有手动翻译按钮都移除了**，翻译完全由实时翻译承担；
 * 因此这里必须提供两个补救入口：
 * - `translateNow`：对某一排立即重翻（失败后的重试、以及 Ctrl+Enter）；
 * - `retryFailed`：把所有失败的排重试一遍（错误横幅上的按钮、Ctrl+Shift+Enter）。
 *
 * 两者都走同一个 `translateOne`，因此与实时翻译共用缓存与队列。
 */
export function useRealtimeTranslate() {
  const modules = useModuleStore((state) => state.modules);
  const pushToast = useUiStore((state) => state.pushToast);

  useEffect(() => {
    void initializeCache(pushToast);
  }, [pushToast]);

  /**
   * 缓存落盘**已经不在这里**（用户 2026 轮排查卡顿后搬走）。
   *
   * 原实现是一个挂在 `modules` 上的 effect：打字每敲一个字都会换一次 `modules` 引用，
   * 于是每次都取消并重设一个 2 秒定时器 —— 纯浪费，而且界面没挂载时就不写盘。
   * 现在由**真正写入缓存的 `cachePut`** 触发防抖落盘（见 `translationCacheStore.scheduleCachePersist`）：
   * 触发源唯一、与 React 渲染彻底解耦，磁盘仍是最多每 2 秒写一次。
   *
   * **实时翻译的调度逻辑在下面那个 effect 里，本轮一个字都没改。**
   */

  useEffect(() => {
    for (const module of modules) {
      // 只有「真正影响译文的东西」变了才处理：
      // 源文本 + 胶囊（中文名与术语英文都算 —— 改了它们，复制出去的英文会变）。
      // 翻译结果写回也会改 modules，这个判断是避免自激循环的关键。
      const snapshot = sourceSnapshot(module);
      if (snapshot === lastScheduled.get(module.id)) continue;
      lastScheduled.set(module.id, snapshot);

      /**
       * **空内容必须显式处理**（用户实测的 bug）。
       *
       * 以前这里只写 `if (!text.trim()) continue;` —— 跳过请求的同时也跳过了
       * 「清译文 / 复位状态 / 撤定时器」，于是**一次删空**时输出框残留上一次的译文
       * （逐步删能对，是因为中途还有非空内容，最后那次清空被跳过了）。
       *
       * 判空口径与翻译一致：只看**去掉胶囊锚点后的纯中文**——
       * 只放了胶囊、没有中文，同样视为「没有可翻译内容」。
       */
      if (!hasTranslatableText(module)) {
        cancelPending(module.id);
        const state = useModuleStore.getState();
        // 幂等：译文本来就是空的、状态本来就是 idle 时不产生任何改动
        if (module.translation || module.status !== 'idle' || module.error) {
          state.clearTranslation(module.id);
        }
        continue;
      }

      // 同一个模块的旧定时器要被替换掉（连打几个字只翻最后一次）
      const existing = pendingTimers.get(module.id);
      if (existing !== undefined) window.clearTimeout(existing);
      pendingTimers.set(
        module.id,
        window.setTimeout(() => {
          pendingTimers.delete(module.id);
          void translateOne(module.id);
        }, REALTIME_DEBOUNCE_MS),
      );
    }

    // 模块被删掉时清掉定时器与记录，避免长期积累
    for (const id of [...lastScheduled.keys()]) {
      if (!modules.some((module) => module.id === id)) {
        lastScheduled.delete(id);
        cancelPending(id);
      }
    }

    /**
     * 注意：这里**只清本模块自己的定时器**（在替换/空内容时已清），不能把整张表清空 ——
     * 否则「A 排翻译完成改了状态 → effect 重跑 → 把 B 排还在等待期的定时器一起清掉」，
     * B 排就永远不会被翻译。这正是实测踩到的坑。
     */
  }, [modules]);

  /** 立即重翻某一排（失败重试 / Ctrl+Enter）：不走防抖，直接入队 */
  const translateNow = useCallback(
    async (moduleId: string): Promise<boolean> => translateOne(moduleId, { useCache: false }),
    [],
  );

  /** 把所有失败的排重试一遍（错误横幅 / Ctrl+Shift+Enter） */
  const retryFailed = useCallback(async (): Promise<number> => {
    const failed = useModuleStore
      .getState()
      .modules.filter((module) => module.status === 'error');
    let succeeded = 0;
    for (const module of failed) {
      // 串行重试：队列本身也是串行的，这里顺序 await 让计数更直观
      const ok = await translateOne(module.id, { useCache: false });
      if (ok) succeeded += 1;
    }
    return succeeded;
  }, []);

  return { translateNow, retryFailed };
}

/**
 * 缓存管理入口（设置面板用）。
 *
 * 清空会**同时**清内存与磁盘：只清内存的话，下次启动又会把旧缓存读回来，
 * 用户会以为「清空没生效」。
 */
export function useCacheAdmin() {
  const pushToast = useUiStore((state) => state.pushToast);

  const clearAll = useCallback(async (): Promise<number> => {
    const removed = cacheClear();
    try {
      await clearCacheOnDisk();
    } catch (error) {
      pushToast(
        `缓存文件删除失败：${error instanceof Error ? error.message : String(error)}`,
        'error',
      );
      return removed;
    }
    pushToast(`已清空翻译缓存（${removed} 条）`, 'ok');
    return removed;
  }, [pushToast]);

  return { clearAll };
}
