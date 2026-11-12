import { canAddModule, canRemoveModule } from '../utils/moduleList';
import type { ModuleState } from './useModuleStore';

/**
 * 选择器约定：
 * 只返回「基本类型」或「引用稳定的对象」，避免 zustand 因每次返回新对象/新数组而反复重渲染。
 * 需要派生数组时，请使用 useShallow 或在组件内 useMemo。
 */

export function selectCanAddModule(state: ModuleState): boolean {
  return canAddModule(state.modules);
}

export function selectCanRemoveModule(state: ModuleState): boolean {
  return canRemoveModule(state.modules);
}

/**
 * 翻译失败的模块数量。
 *
 * 顶栏的「重试失败项」按钮已删除（再点一次「翻译」本身就是重试）；
 * 现在由失败横幅用它决定「还要不要显示」，归零即自动收起。
 */
export function selectFailedModuleCount(state: ModuleState): number {
  return state.modules.filter((module) => module.status === 'error').length;
}
