import { useEffect, useState } from 'react';
import { DRAFT_DEBOUNCE_MS } from '../constants/limits';
import { useModuleStore } from '../store/useModuleStore';
import { useUiStore } from '../store/useUiStore';
import { buildDraft, loadDraft, saveDraft } from '../utils/draft';

/**
 * 会话草稿：启动时恢复，之后防抖保存（模块内容 + 左列布局偏好）。
 *
 * 顺序很关键 —— 先尝试恢复，再开始保存。否则第一帧的「默认 4 个空模块」
 * 会在恢复之前就把草稿覆盖掉，用户丢掉上一次的全部内容。
 */
export function useModuleDraft() {
  const modules = useModuleStore((state) => state.modules);
  const selectedModuleId = useModuleStore((state) => state.selectedModuleId);
  const hydrate = useModuleStore((state) => state.hydrate);

  const inputPaneHeight = useUiStore((state) => state.inputPaneHeight);
  const presetPanelWidth = useUiStore((state) => state.presetPanelWidth);
  const setInputPaneHeight = useUiStore((state) => state.setInputPaneHeight);
  const setPresetPanelWidth = useUiStore((state) => state.setPresetPanelWidth);
  const pushToast = useUiStore((state) => state.pushToast);

  const [ready, setReady] = useState(false);

  useEffect(() => {
    const draft = loadDraft();
    if (draft) {
      hydrate(draft.modules, draft.selectedModuleId);
      setInputPaneHeight(draft.layout.inputPaneHeight);
      setPresetPanelWidth(draft.layout.presetPanelWidth);
      pushToast('已恢复上次的编辑内容', 'info');
    }
    setReady(true);
  }, [hydrate, setInputPaneHeight, setPresetPanelWidth, pushToast]);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => {
      saveDraft(buildDraft(modules, selectedModuleId, { inputPaneHeight, presetPanelWidth }));
    }, DRAFT_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [ready, modules, selectedModuleId, inputPaneHeight, presetPanelWidth]);
}
