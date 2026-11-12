import { findServiceBrand, SERVICE_BRANDS } from '../../constants/providers';
import type { ProviderProfile } from '../../types/settings';
import type { ProfilePatch } from '../../store/useSettingsStore';

interface ServiceFieldsFormProps {
  profile: ProviderProfile;
  onChange: (patch: ProfilePatch) => void;
}

/**
 * 「翻译服务」这一层：下拉选一家（百度 / 腾讯 / 火山 / 阿里）。
 *
 * 用户 2026 轮定：**不再用并排的分段按钮**，改成下拉菜单 ——
 * 服务商变多之后下拉更省地方，也更容易再加一家。目前只有百度真正可用，
 * 其余三家照常列出但不可选，标注「即将支持」。
 *
 * 用户 2026 轮又要求把这块**精简掉多余信息**：原来还有「接口 / 语言方向 / 请求频率」
 * 三条静态说明，最初是为了和语言模型区分；现在接入方式只剩专业翻译、地址与签名全由应用内置、
 * 语言方向也固定，它们再留在面板上就只是噪声，已整体删除。
 * 选中未实现的服务时仍保留一条状态说明（否则用户不知道为什么填不了凭据）。
 */
export function ServiceFieldsForm({ profile, onChange }: ServiceFieldsFormProps) {
  const brand = findServiceBrand(profile.brand);

  return (
    <>
      <div className="pf-field">
        <span className="pf-field__label">翻译服务</span>
        <div className="pf-select">
          <select
            className="pf-field__input"
            aria-label="翻译服务"
            value={profile.brand}
            onChange={(event) => onChange({ brand: event.currentTarget.value })}
          >
            {SERVICE_BRANDS.map((item) => (
              <option key={item.id} value={item.id} disabled={!item.available}>
                {item.available ? item.label : `${item.label}（即将支持）`}
              </option>
            ))}
          </select>
        </div>
      </div>

      {brand?.available ? null : (
        <div className="pf-field">
          <span className="pf-field__label">状态</span>
          <p className="pf-field__static">
            {brand?.label ?? '这家翻译服务'}的接入尚未实现，先占个位置：等实现之后，
            在同一个位置填上它的凭据即可。现在请先选择「百度翻译」。
          </p>
        </div>
      )}
    </>
  );
}
