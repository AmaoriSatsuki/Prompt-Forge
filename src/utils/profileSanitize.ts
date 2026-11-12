import {
  DEFAULT_BRAND_ID,
  findServiceBrand,
  protocolOf,
} from '../constants/providers';
import type { ProviderKind } from '../constants/providers';
import type { ProviderProfile } from '../types/settings';
import { createId } from './id';

/** 命名缺失时的中文兜底名 */
export const FALLBACK_PROFILE_LABEL = '未命名配置';

/** 运行时协议：由翻译服务推导（配置文件里不存这个字段） */
export function profileKind(profile: ProviderProfile): ProviderKind {
  return protocolOf(profile.brand);
}

export interface CreateProfileOptions {
  /** 翻译服务 id（brand） */
  brand?: string;
  label?: string;
}

/**
 * 造一套新配置。
 *
 * 只有名字与翻译服务两项：接口地址与模型名属于已剔除的语言模型接入，
 * 专业翻译接口由应用内置，用户没有任何需要填的地址。
 * 命名仍然给默认值（取翻译服务的名字）—— 名字不是 API 值，不会过时。
 */
export function createProfile(options: CreateProfileOptions = {}): ProviderProfile {
  const brand = findServiceBrand(options.brand ?? '')?.id ?? DEFAULT_BRAND_ID;

  return {
    id: createId('profile'),
    label: options.label?.trim() || findServiceBrand(brand)?.label || FALLBACK_PROFILE_LABEL,
    brand,
  };
}

/**
 * 旧版本在磁盘上留下的形状（迁移用，只读不写）。
 *
 * 历史上有过三种：
 * 1. 扁平结构：`templateId` + `baseUrl/model/timeoutMs/temperature`；
 * 2. 三层结构：`category` + `llm` 字段块 + `professional: { brand }`；
 * 3. 现在：只有 `id / label / brand`。
 *
 * 迁移原则：**只搬还存在的概念**（翻译服务），不凭空造数据，也不因为
 * 语言模型接入被剔除就把整条配置丢掉——名字与凭据都要留着。
 */
interface LegacyProfileShape {
  id?: unknown;
  label?: unknown;
  brand?: unknown;
  /** 三层结构里的品牌块 */
  professional?: { brand?: unknown };
  /** 更早的扁平结构里，百度/腾讯也写在 templateId 上 */
  templateId?: unknown;
}

/** 从各种历史形状里认出翻译服务；认不出就回落到默认（百度） */
function readBrand(source: LegacyProfileShape): string {
  const candidates = [
    source.brand,
    source.professional?.brand,
    source.templateId,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const brand = findServiceBrand(candidate.trim());
    if (brand) return brand.id;
  }
  return DEFAULT_BRAND_ID;
}

/**
 * 规范化一条来自磁盘（可能被手工改过、或来自旧版本）的配置。
 * 目标：任何输入都能得到一套可用配置，绝不因为一条脏数据让整个设置面板报废。
 */
export function sanitizeProfile(raw: Partial<ProviderProfile> | null | undefined): ProviderProfile {
  const source = (raw ?? {}) as LegacyProfileShape;

  const id =
    typeof source.id === 'string' && source.id.trim() ? source.id.trim() : createId('profile');

  const brand = readBrand(source);

  // 命名：用户填过就用用户的；否则取翻译服务的名字；
  // 一条**什么都没有**的脏数据不该被命名成「百度翻译」——那会让人以为它真配好了，
  // 这种情形用中文兜底名。
  const hasIdentity =
    (typeof source.brand === 'string' && source.brand.trim().length > 0) ||
    (typeof source.professional?.brand === 'string' &&
      source.professional.brand.trim().length > 0) ||
    (typeof source.templateId === 'string' && source.templateId.trim().length > 0);
  const trimmedLabel = typeof source.label === 'string' ? source.label.trim() : '';
  const label =
    trimmedLabel ||
    (hasIdentity
      ? findServiceBrand(brand)?.label ?? FALLBACK_PROFILE_LABEL
      : FALLBACK_PROFILE_LABEL);

  return { id, label, brand };
}

/** 规范化整套配置，并保证 id 唯一 */
export function sanitizeProfiles(rawList: unknown): ProviderProfile[] {
  if (!Array.isArray(rawList)) return [];

  const seenIds = new Set<string>();
  return rawList.map((item) => {
    const profile = sanitizeProfile(item as Partial<ProviderProfile>);
    if (seenIds.has(profile.id)) profile.id = createId('profile');
    seenIds.add(profile.id);
    return profile;
  });
}
