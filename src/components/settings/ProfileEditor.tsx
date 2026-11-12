import type { ReactNode } from 'react';
import {
  BAIDU_APP_ID_ENV,
  BAIDU_APP_KEY_ENV,
  findServiceBrand,
} from '../../constants/providers';
import { useSettingsStore } from '../../store/useSettingsStore';
import type { ProfilePatch } from '../../store/useSettingsStore';
import type { ProviderProfile, TestReport } from '../../types/settings';
import { ConnectionTest } from './ConnectionTest';
import { ServiceCredentialFields } from './ServiceCredentialFields';
import { ServiceFieldsForm } from './ServiceFieldsForm';

interface ProfileEditorProps {
  profile: ProviderProfile;
  report: TestReport | null;
  testing: boolean;
  /** 顶部操作区（设为当前 / 复制 / 删除），由设置弹窗注入 */
  actions?: ReactNode;
}

/**
 * 一套配置的编辑区，按三步排：
 *
 * 1. **配置命名**
 * 2. **翻译服务**（百度 / 腾讯）以及它的接口事实
 * 3. **该服务要用的凭据** → 最后才是「测试连接」
 *
 * 用户 2026 轮把接入方式统一成一种（只接专业翻译接口），因此原来的
 * 「翻译方式（专业翻译 / 语言模型 / 本地模型）」这一步连同 `category` 字段一起删除；
 * 剩下的选择只有「哪一家翻译服务」，它写进 `profile.brand`，协议由品牌推导。
 */
export function ProfileEditor({ profile, report, testing, actions }: ProfileEditorProps) {
  const updateProfile = useSettingsStore((state) => state.updateProfile);
  const keyStatus = useSettingsStore((state) => state.keyStatus);
  const setBaiduCredentials = useSettingsStore((state) => state.setBaiduCredentials);
  const clearBaiduCredentials = useSettingsStore((state) => state.clearBaiduCredentials);
  const testConnection = useSettingsStore((state) => state.testConnection);

  const patch = (next: ProfilePatch) => updateProfile(profile.id, next);
  const configured = keyStatus[profile.id] === true;
  const brand = findServiceBrand(profile.brand);
  // 百度支持环境变量兜底，说明里要把两个变量名给出（别的服务将来各自决定）
  const envNames =
    brand?.id === 'baidu' ? { id: BAIDU_APP_ID_ENV, key: BAIDU_APP_KEY_ENV } : undefined;

  return (
    <div className="pf-settings__detail pf-scroll-thin">
      {actions ? <div className="pf-settings__actions">{actions}</div> : null}

      <label className="pf-field">
        <span className="pf-field__label">配置命名（界面上显示它）</span>
        <input
          className="pf-field__input"
          value={profile.label}
          maxLength={30}
          onChange={(event) => patch({ label: event.currentTarget.value })}
        />
      </label>

      <ServiceFieldsForm profile={profile} onChange={patch} />

      {/* 服务尚未实现时不显示凭据输入：填了也没有通道可用 */}
      {brand?.available ? (
        <ServiceCredentialFields
          profileId={profile.id}
          configured={configured}
          labels={brand.credentialLabels}
          brandLabel={brand.label}
          envNames={envNames}
          onSave={(appId, appKey) => setBaiduCredentials(profile.id, appId, appKey)}
          onClear={() => clearBaiduCredentials(profile.id)}
        />
      ) : null}

      {brand?.available ? (
        <ConnectionTest
          report={report}
          testing={testing}
          onTest={() => void testConnection(profile.id)}
        />
      ) : null}
    </div>
  );
}
