import { useCallback } from 'react';
import { currentProfile, useSettingsStore } from '../store/useSettingsStore';
import { useModuleStore } from '../store/useModuleStore';
import { useUiStore } from '../store/useUiStore';
import type { ProviderProfile } from '../types/settings';
import { translateOne } from './useRealtimeTranslate';

/**
 * 手动翻译入口。
 *
 * 本版只剩专业翻译接口，没有「接口地址 / 模型名 / 密钥是否已填」这类前端能预判的东西，
 * 因此这里只剩两件事：
 * 1. 取出当前生效的配置（一套都没有时给出中文提示并打开设置）；
 * 2. 提供一个**手动重翻当前排**的入口，供快捷键与失败重试使用。
 *
 * 缺凭据不在这里拦：凭据在系统凭据库里，界面无从预判，由 Rust 返回可照做的中文提示。
 *
 * 翻译本身**不再有第二条链路**：所有请求都由 `translateOne`（实时翻译调度层）发出，
 * 共用同一条引擎队列与同一个缓存。
 */
export function useTranslate() {
  const pushToast = useUiStore((state) => state.pushToast);
  const openSettings = useUiStore((state) => state.openSettings);
  const showTranslationFailure = useUiStore((state) => state.showTranslationFailure);
  const dismissTranslationFailure = useUiStore((state) => state.dismissTranslationFailure);

  /** 取出当前生效的配置；一套都没有时提示并打开设置 */
  const resolveProfile = useCallback((): ProviderProfile | null => {
    const settings = useSettingsStore.getState();
    const profile = currentProfile(settings);
    if (!profile) {
      pushToast('请先在设置里添加一套翻译服务配置', 'warn');
      openSettings();
      return null;
    }
    return profile;
  }, [openSettings, pushToast]);

  /**
   * 立刻重翻某一排（快捷键 Ctrl+Enter、以及失败后的单独重试）。
   *
   * 刻意**绕过缓存**（`useCache: false`）：用户主动点重试时，
   * 命中旧缓存会让「重试」看起来毫无反应。
   */
  const translateModule = useCallback(
    async (moduleId: string): Promise<boolean> => {
      const profile = resolveProfile();
      if (!profile) return false;

      const ok = await translateOne(moduleId, { profile, useCache: false });
      if (ok) {
        // 成功了说明问题已解决，失败横幅该收起
        dismissTranslationFailure();
        pushToast('翻译完成', 'ok');
      } else {
        const failed = useModuleStore.getState().modules.find((item) => item.id === moduleId);
        const message = failed?.error?.message ?? '未知原因';
        // toast 只是即时反馈，真正「确保收到」的是常驻横幅
        pushToast(`翻译失败：${message}`, 'error');
        showTranslationFailure(message, failed?.error?.code);
      }
      return ok;
    },
    [resolveProfile, pushToast, showTranslationFailure, dismissTranslationFailure],
  );

  return { translateModule };
}
