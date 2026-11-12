import { useEffect, useState } from 'react';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useUiStore } from '../../store/useUiStore';
import { Button } from '../common/Button';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { ProfileEditor } from './ProfileEditor';
import { ProviderProfileList } from './ProviderProfileList';
import { TranslationCacheSection } from './TranslationCacheSection';

/**
 * 设置弹窗：左边多套配置，右边当前选中那一套的全部字段。
 *
 * 需求确认：配置支持多套（每套有独立密钥），并且至少保留一套。
 */
export function SettingsDialog() {
  const open = useUiStore((state) => state.settingsOpen);
  const closeSettings = useUiStore((state) => state.closeSettings);
  const pushToast = useUiStore((state) => state.pushToast);

  const profiles = useSettingsStore((state) => state.profiles);
  const activeProfileId = useSettingsStore((state) => state.activeProfileId);
  const keyStatus = useSettingsStore((state) => state.keyStatus);
  const loadError = useSettingsStore((state) => state.loadError);
  const testReports = useSettingsStore((state) => state.testReports);
  const testingProfileId = useSettingsStore((state) => state.testingProfileId);
  const addProfile = useSettingsStore((state) => state.addProfile);
  const duplicateProfile = useSettingsStore((state) => state.duplicateProfile);
  const removeProfile = useSettingsStore((state) => state.removeProfile);
  const setActiveProfile = useSettingsStore((state) => state.setActiveProfile);

  const [selectedId, setSelectedId] = useState(activeProfileId);
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);

  useEscapeKey(closeSettings);

  useEffect(() => {
    if (open) setSelectedId(activeProfileId);
  }, [open, activeProfileId]);

  if (!open) return null;

  const selected = profiles.find((profile) => profile.id === selectedId) ?? profiles[0];
  const isActive = selected ? selected.id === activeProfileId : false;
  const pendingRemove = profiles.find((profile) => profile.id === pendingRemoveId) ?? null;

  return (
    <div className="pf-modal" role="dialog" aria-modal="true" aria-label="设置">
      <div className="pf-modal__backdrop" onClick={closeSettings} />
      <div className="pf-modal__panel pf-modal__panel--wide">
        <h3 className="pf-modal__title">设置 · 翻译服务</h3>

        {loadError ? <p className="pf-preset__error">{loadError}</p> : null}

        <div className="pf-settings">
          <ProviderProfileList
            profiles={profiles}
            activeProfileId={activeProfileId}
            selectedId={selected?.id ?? ''}
            keyStatus={keyStatus}
            onSelect={setSelectedId}
            onAdd={() => setSelectedId(addProfile().id)}
          />

          {selected ? (
            <ProfileEditor
              profile={selected}
              report={testReports[selected.id] ?? null}
              testing={testingProfileId === selected.id}
              actions={
                <>
                  <Button
                    compact
                    variant={isActive ? 'ghost' : 'primary'}
                    disabled={isActive}
                    onClick={() => {
                      setActiveProfile(selected.id);
                      pushToast(`已切换到「${selected.label}」`, 'ok');
                    }}
                  >
                    {isActive ? '当前使用中' : '设为当前'}
                  </Button>
                  <Button
                    compact
                    onClick={() => {
                      const copy = duplicateProfile(selected.id);
                      if (copy) setSelectedId(copy.id);
                    }}
                  >
                    复制
                  </Button>
                  <Button
                    compact
                    variant="danger"
                    disabled={profiles.length <= 1}
                    title={profiles.length <= 1 ? '至少保留一套配置' : '删除这套配置'}
                    onClick={() => setPendingRemoveId(selected.id)}
                  >
                    删除
                  </Button>
                </>
              }
            />
          ) : null}
        </div>

        <footer className="pf-modal__footer">
          <Button onClick={closeSettings}>关闭</Button>
        </footer>

        {/* 翻译缓存：条数、占用、开关与清空 */}
        <TranslationCacheSection />
      </div>

      {pendingRemove ? (
        <ConfirmDialog
          title="删除配置"
          text={`确定要删除「${pendingRemove.label}」吗？它的密钥也会一并从系统凭据库清除。`}
          confirmLabel="删除"
          onConfirm={() => {
            removeProfile(pendingRemove.id);
            setPendingRemoveId(null);
            pushToast('配置已删除', 'ok');
          }}
          onCancel={() => setPendingRemoveId(null)}
        />
      ) : null}
    </div>
  );
}
