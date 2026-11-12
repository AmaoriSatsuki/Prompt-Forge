import { create } from 'zustand';
import {
  MODULE_INITIAL_COUNT,
  MODULE_MAX_HEIGHT,
  MODULE_MIN_HEIGHT,
} from '../constants/limits';
import type { Capsule, CapsuleSource, Module, ModuleError, ModuleStatus } from '../types/module';
import { clamp } from '../utils/clamp';
import {
  appendModule,
  buildInitialModules,
  dropModule,
  insertCapsuleInto,
  patchModule,
  removeCapsuleFrom,
  renameCapsuleIn,
  setCapsuleWeightIn,
} from '../utils/moduleList';
import type { CapsulePlacement } from '../utils/moduleList';
import { keepOnlyAnchors, pruneOrphanCapsules } from '../utils/placeholder';
import { applySnapshotToModule, applySnapshotToModules } from '../utils/snapshot';
import type { Snapshot } from '../types/snapshot';

export interface ModuleState {
  /** 模块列表，长度恒在 [MODULE_MIN_COUNT, MODULE_MAX_COUNT] 之间 */
  modules: Module[];
  /** 当前编辑目标模块 id（「输入框」指示的就是它） */
  selectedModuleId: string;

  /** 新增模块；达到上限返回 false */
  addModule: () => boolean;
  /** 删除模块并释放其颜色；低于下限返回 false */
  removeModule: (id: string) => boolean;
  selectModule: (id: string) => void;
  /** 按顺序切换选中模块：-1 上一个，1 下一个（首尾环绕） */
  selectAdjacentModule: (delta: -1 | 1) => void;
  setSourceText: (id: string, text: string) => void;
  /** 底部细拖拽条调整这一排的输出高度（下限 MODULE_MIN_HEIGHT） */
  setOutputHeight: (id: string, height: number) => void;
  setTranslation: (id: string, text: string) => void;
  setStatus: (id: string, status: ModuleStatus, error?: ModuleError) => void;
  /** 记录最近一次翻译的模型与耗时 */
  setTranslationMeta: (id: string, meta: Module['translationMeta']) => void;
  /** 把模块枢拖回自身模块：清空源内容、胶囊、译文与状态 */
  clearModule: (id: string) => void;
  /** 把模块枢拖回自身模块：**只清文字、保留胶囊**（D61）；译文与状态一并复位 */
  clearModuleText: (id: string) => void;
  /** 只清译文与状态（源内容被删空时用），不动源内容与胶囊 */
  clearTranslation: (id: string) => void;
  /**
   * 把预设作为胶囊插入模块（需求 10；D79 起排在已有胶囊之后）。
   * source 由调用方从预设库取出，模块 Store 因此不依赖预设 Store。
   */
  insertCapsule: (moduleId: string, source: CapsuleSource, placement: CapsulePlacement) => void;
  /** 移除胶囊并清掉它在源内容里的全部锚点 */
  removeCapsule: (moduleId: string, capsuleId: string) => void;
  /** 修改胶囊的中文命名（只影响该模块里的这一条） */
  renameCapsule: (moduleId: string, capsuleId: string, label: string) => void;
  /**
   * 改某条胶囊的权重（HANDOFF §四.1）：写进 `capsule.english`，预设库不动。
   * 值 = 1 就脱括号；重复调整是替换而不是套娃（`utils/capsuleWeight.ts`）。
   */
  setCapsuleWeight: (moduleId: string, capsuleId: string, weight: number) => void;
  /** 用给定的模块集合整体替换（M5 草稿恢复） */
  hydrate: (modules: Module[], selectedModuleId?: string) => void;
  /** D67：应用全局快照（覆盖所有模块；撤销栈由调用方负责） */
  applySnapshotGlobal: (snapshot: Snapshot) => void;
  /** D67：应用单模块快照到指定模块 */
  applySnapshotModule: (snapshot: Snapshot, moduleId: string) => void;
  /** D67：撤销 —— 把覆盖前的工作区原样塞回 */
  restoreWorkspace: (modules: Module[], selectedModuleId: string) => void;
  /** 「全文清空」：清掉所有模块的内容，但模块本身一个都不少 */
  clearAllModules: () => void;
  /** 回到初始的 4 个空模块（测试夹具与将来的「恢复出厂设置」用） */
  resetModules: () => void;
}

/**
 * 给某个模块打补丁；没有变化时返回空对象，避免无意义的重渲染。
 *
 * 补丁可以直接给对象，也可以给一个「按当前模块算补丁」的函数 ——
 * 后者用于需要读旧值的场景（例如改源内容时顺带回收孤儿胶囊）。
 */
function applyPatch(
  state: ModuleState,
  id: string,
  patch: Partial<Module> | ((module: Module) => Partial<Module>),
): Partial<ModuleState> {
  const target = state.modules.find((module) => module.id === id);
  if (!target) return {};
  const resolved = typeof patch === 'function' ? patch(target) : patch;
  const modules = patchModule(state.modules, id, resolved);
  return modules === state.modules ? {} : { modules };
}

/**
 * 初始模块在 Store 创建时就生成（而不是等组件的 useEffect）。
 * 好处：首屏直接就是 4 排模块，不会先闪一下空列表；
 * 也让静态渲染（scripts/verify-render.cjs）能直接验证真实初始状态。
 */
const initialModules = buildInitialModules(MODULE_INITIAL_COUNT);

export const useModuleStore = create<ModuleState>((set, get) => ({
  modules: initialModules,
  selectedModuleId: initialModules[0].id,

  addModule: () => {
    const result = appendModule(get().modules);
    if (!result) return false;
    set({ modules: result.modules, selectedModuleId: result.created.id });
    return true;
  },

  removeModule: (id) => {
    const { modules, selectedModuleId } = get();
    const result = dropModule(modules, id, selectedModuleId);
    if (!result) return false;
    set({ modules: result.modules, selectedModuleId: result.selectedModuleId });
    return true;
  },

  selectModule: (id) => {
    if (get().selectedModuleId === id) return;
    if (!get().modules.some((m) => m.id === id)) return;
    set({ selectedModuleId: id });
  },

  /**
   * 按顺序切换选中模块（Ctrl/Alt + ↑↓）。
   * 首尾环绕：在最后一排按「下一个」回到第一排，符合「循环翻」的直觉。
   */
  selectAdjacentModule: (delta) => {
    const { modules, selectedModuleId } = get();
    if (modules.length === 0) return;
    const currentIndex = modules.findIndex((module) => module.id === selectedModuleId);
    const from = currentIndex < 0 ? 0 : currentIndex;
    const count = modules.length;
    const next = (((from + delta) % count) + count) % count;
    set({ selectedModuleId: modules[next].id });
  },

  /**
   * 改源内容。
   *
   * 顺带**回收孤儿胶囊**：用户在编辑器里用 Backspace 删掉药丸时，锚点消失了，
   * 但胶囊条目会留在模块里。不回收的话，复制仍会带上它的术语英文
   * （而重启后 `sanitizeModule` 又会把它清掉，行为对不上）。
   * 同步做而不是放到调度层：复制是随时可能发生的，不能等防抖。
   */
  setSourceText: (id, text) =>
    set((state) =>
      applyPatch(state, id, (module) => ({
        sourceText: text,
        capsules: pruneOrphanCapsules(text, module.capsules),
      })),
    ),

  setOutputHeight: (id, height) => {
    const next = clamp(Math.round(height), MODULE_MIN_HEIGHT, MODULE_MAX_HEIGHT);
    set((state) => applyPatch(state, id, { outputHeight: next }));
  },

  setTranslation: (id, text) => set((state) => applyPatch(state, id, { translation: text })),

  setStatus: (id, status, error) =>
    set((state) =>
      applyPatch(state, id, { status, error: status === 'error' ? error : undefined }),
    ),

  setTranslationMeta: (id, meta) =>
    set((state) => applyPatch(state, id, { translationMeta: meta })),

  clearModule: (id) =>
    set((state) =>
      applyPatch(state, id, {
        sourceText: '',
        capsules: [] as Capsule[],
        translation: '',
        status: 'idle',
        error: undefined,
        translationMeta: undefined,
      }),
    ),

  /**
   * 模块枢拖回自身（D61）：**只清文字、保留胶囊**。
   *
   * 用户实测：需要清手打内容的次数远多于清胶囊；胶囊是精挑过的术语，误删代价高，
   * 想去掉就点输出区里的 ×。因此这里把源内容收成「只剩锚点」、胶囊原样保留。
   * 没有文字之后译文失去意义，与「内容删空」同口径一并清掉（否则输出区会残留旧译文）。
   */
  clearModuleText: (id) =>
    set((state) =>
      applyPatch(state, id, (module) => {
        const knownIds = new Set(module.capsules.map((capsule) => capsule.id));
        const kept = keepOnlyAnchors(module.sourceText, knownIds);
        return {
          sourceText: kept,
          capsules: pruneOrphanCapsules(kept, module.capsules),
          translation: '',
          status: 'idle',
          error: undefined,
          translationMeta: undefined,
        };
      }),
    ),

  /**
   * 只清译文与状态，**不动源内容**。
   *
   * 用于「源内容被删空」：此时译文已经没有意义，必须跟着清掉并把状态复位，
   * 否则输出框会残留上一次的结果（用户实测到的 bug）。
   */
  clearTranslation: (id) =>
    set((state) =>
      applyPatch(state, id, {
        translation: '',
        status: 'idle',
        error: undefined,
        translationMeta: undefined,
      }),
    ),

  insertCapsule: (moduleId, source, placement) =>
    set((state) => {
      const modules = insertCapsuleInto(state.modules, moduleId, source, placement);
      return modules === state.modules ? {} : { modules };
    }),

  removeCapsule: (moduleId, capsuleId) =>
    set((state) => {
      const modules = removeCapsuleFrom(state.modules, moduleId, capsuleId);
      return modules === state.modules ? {} : { modules };
    }),

  renameCapsule: (moduleId, capsuleId, label) =>
    set((state) => {
      const modules = renameCapsuleIn(state.modules, moduleId, capsuleId, label);
      return modules === state.modules ? {} : { modules };
    }),

  setCapsuleWeight: (moduleId, capsuleId, weight) =>
    set((state) => {
      const modules = setCapsuleWeightIn(state.modules, moduleId, capsuleId, weight);
      return modules === state.modules ? {} : { modules };
    }),

  applySnapshotGlobal: (snapshot) => {
    set((state) => ({
      modules: applySnapshotToModules(state.modules, snapshot),
      selectedModuleId: state.selectedModuleId,
    }));
  },

  applySnapshotModule: (snapshot, moduleId) => {
    set((state) => ({
      modules: state.modules.map((module) =>
        module.id === moduleId ? applySnapshotToModule(module, snapshot) : module,
      ),
    }));
  },

  restoreWorkspace: (modules, selectedModuleId) => {
    set({ modules, selectedModuleId });
  },

  hydrate: (modules, selectedModuleId) => {
    if (modules.length === 0) return;
    set({
      modules,
      selectedModuleId:
        selectedModuleId && modules.some((m) => m.id === selectedModuleId)
          ? selectedModuleId
          : modules[0].id,
    });
  },

  /**
   * 「全文清空」：清掉**所有**模块的内容（中文、胶囊、译文、状态与用量），
   * 但模块本身一个都不少 —— 数量、序号、颜色与各自的高度都保持不变。
   */
  clearAllModules: () =>
    set((state) => ({
      modules: state.modules.map((module) => ({
        ...module,
        sourceText: '',
        capsules: [] as Capsule[],
        translation: '',
        status: 'idle',
        error: undefined,
        translationMeta: undefined,
      })),
    })),

  /** 回到初始的 4 个空模块（测试夹具与将来的「恢复出厂设置」用；界面上的入口是「全文清空」） */
  resetModules: () => {
    const modules = buildInitialModules(MODULE_INITIAL_COUNT);
    set({ modules, selectedModuleId: modules[0].id });
  },
}));
