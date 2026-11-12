import { useCallback } from 'react';
import { useUiStore } from '../store/useUiStore';
import type { Module } from '../types/module';
import { copyText } from '../utils/clipboard';
import { hasEnglish, plainEnglishOf } from '../utils/moduleText';

/**
 * 复制译文的唯一实现。
 *
 * 模块枢双击、输出区的「复制」按钮都走这里，因此「复制的永远是纯英文」
 * 这条约束只有一个出口（utils/moduleText.ts#plainEnglishOf）。
 */
export function useCopyTranslation() {
  const pushToast = useUiStore((state) => state.pushToast);

  return useCallback(
    async (module: Module): Promise<boolean> => {
      if (!hasEnglish(module)) {
        pushToast('该模块还没有英文译文', 'warn');
        return false;
      }
      const ok = await copyText(plainEnglishOf(module));
      if (!ok) {
        pushToast('复制失败，请重试', 'error');
        return false;
      }
      pushToast('已复制英文译文', 'ok');
      return true;
    },
    [pushToast],
  );
}
