import { useCallback } from 'react';
import { useModuleStore } from '../store/useModuleStore';
import { useUiStore } from '../store/useUiStore';
import { copyText } from '../utils/clipboard';
import { composeFullCopyText } from '../utils/moduleText';

/**
 * 「全文复制」的唯一实现。
 *
 * 与模块枢双击的复制共用同一条出口链：载荷由 `utils/moduleText.ts` 的
 * `composeFullCopyText` 统一拼装（每排「胶囊英文, 中文译文」，排间 `, `，
 * 空排跳过、首尾不留空格），这里只负责写剪贴板与提示。
 *
 * 全空时**不写剪贴板**：否则用户会把上次剪贴板里的旧内容当成这次复制的结果。
 */
export function useCopyAllTranslations() {
  const pushToast = useUiStore((state) => state.pushToast);

  return useCallback(async (): Promise<boolean> => {
    const text = composeFullCopyText(useModuleStore.getState().modules);
    if (!text) {
      pushToast('没有可复制的内容', 'warn');
      return false;
    }
    const ok = await copyText(text);
    if (!ok) {
      pushToast('复制失败，请重试', 'error');
      return false;
    }
    pushToast('已复制全文', 'ok');
    return true;
  }, [pushToast]);
}
