import type { ProviderProfile } from '../../types/settings';
import { Button } from '../common/Button';

interface ProviderProfileListProps {
  profiles: ProviderProfile[];
  activeProfileId: string;
  selectedId: string;
  keyStatus: Record<string, boolean>;
  onSelect: (id: string) => void;
  onAdd: () => void;
}

/** 多套配置的列表。具体的增删改动作放在右侧详情区，列表保持干净。 */
export function ProviderProfileList({
  profiles,
  activeProfileId,
  selectedId,
  keyStatus,
  onSelect,
  onAdd,
}: ProviderProfileListProps) {
  return (
    <div className="pf-profile-list">
      <div className="pf-profile-list__items pf-scroll-thin">
        {profiles.map((profile) => {
          const active = profile.id === activeProfileId;
          const configured = keyStatus[profile.id] === true;
          return (
            <button
              key={profile.id}
              type="button"
              className={`pf-profile${profile.id === selectedId ? ' pf-profile--selected' : ''}`}
              onClick={() => onSelect(profile.id)}
            >
              <span className="pf-profile__label" title={profile.label}>
                {profile.label}
              </span>
              <span className="pf-profile__badges">
                {active ? <span className="pf-profile__badge pf-profile__badge--active">当前</span> : null}
                <span
                  className={
                    configured
                      ? 'pf-profile__badge pf-profile__badge--ok'
                      : 'pf-profile__badge pf-profile__badge--missing'
                  }
                >
                  {configured ? '已配密钥' : '缺密钥'}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <Button compact onClick={onAdd} className="pf-profile-list__add">
        新增配置
      </Button>
    </div>
  );
}
