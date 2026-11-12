/**
 * 翻译服务的注册表。
 *
 * 只有一层概念，别再拆：
 * 1. **翻译服务（brand）**：接哪一家 —— 百度翻译（可用）/ 腾讯翻译（占位）；
 * 2. **协议（kind）**：运行时真正走哪条通道，由品牌推导，**永不信任磁盘上的值**。
 *
 * > 语言模型（OpenAI 兼容）与本地模型两条接入方式已在用户 2026 轮要求下**整体剔除**：
 * > 本应用只保留专业翻译接口这一种接入形态，界面上统一叫「翻译服务」。
 *
 * 与颜色注册表同样的思路：新增一家只改这里的数组，界面自动跟随。
 *
 * 默认值政策（已与用户确认）：**任何地方都不预填接口地址与模型名**。
 * 专业翻译接口由应用内置，因此这套注册表里连示例地址都不再需要。
 */

/**
 * 运行时协议。
 * - `baidu-translate`：百度通用文本翻译，GET + MD5 签名
 * - `tencent-translate`：腾讯机器翻译（TC3-HMAC-SHA256），**尚未实现**
 * - `volcano-translate`：火山翻译（火山引擎机器翻译），**尚未实现**
 * - `aliyun-translate`：阿里翻译（阿里云机器翻译），**尚未实现**
 */
export type ProviderKind =
  | 'baidu-translate'
  | 'tencent-translate'
  | 'volcano-translate'
  | 'aliyun-translate';

export interface ServiceBrand {
  id: string;
  /** 界面显示名 */
  label: string;
  kind: ProviderKind;
  /** 未实现的服务在界面上禁用并标注「即将支持」 */
  available: boolean;
  /** 凭据两个字段的界面标签（各家叫法不同） */
  credentialLabels: { id: string; key: string };
}

/**
 * 已接入的翻译服务。
 *
 * 本版只开放百度：其余三家（腾讯 / 火山 / 阿里）的接入尚未实现，
 * 下拉里照常列出但不可选，标注「即将支持」——让用户知道以后会有这几家。
 */
export const SERVICE_BRANDS: ServiceBrand[] = [
  {
    id: 'baidu',
    label: '百度翻译',
    kind: 'baidu-translate',
    available: true,
    credentialLabels: { id: 'APP ID', key: '密钥' },
  },
  {
    id: 'tencent',
    label: '腾讯翻译',
    kind: 'tencent-translate',
    available: false,
    credentialLabels: { id: 'SecretId', key: 'SecretKey' },
  },
  {
    id: 'volcano',
    label: '火山翻译',
    kind: 'volcano-translate',
    available: false,
    credentialLabels: { id: 'APP ID', key: '密钥' },
  },
  {
    id: 'aliyun',
    label: '阿里翻译',
    kind: 'aliyun-translate',
    available: false,
    credentialLabels: { id: 'AccessKey ID', key: 'AccessKey Secret' },
  },
];

/** 新配置默认落在百度（本版唯一可用的翻译服务） */
export const DEFAULT_BRAND_ID = 'baidu';

/** 百度翻译的凭据也可以改用环境变量（界面填写的优先） */
export const BAIDU_APP_ID_ENV = 'BAIDU_TRANSLATE_APP_ID';
export const BAIDU_APP_KEY_ENV = 'BAIDU_TRANSLATE_APP_KEY';

export function findServiceBrand(id: string | null | undefined): ServiceBrand | undefined {
  if (!id) return undefined;
  return SERVICE_BRANDS.find((brand) => brand.id === id);
}

/**
 * 运行时协议：翻译服务 → 通道。
 *
 * 认不出的品牌一律按百度处理（脏数据安全降级），与本应用「只有一家可用」的现状一致。
 */
export function protocolOf(brand: string | null | undefined): ProviderKind {
  return findServiceBrand(brand)?.kind ?? 'baidu-translate';
}

/** 这家翻译服务是否已经能真正发请求 */
export function isBrandAvailable(brand: string | null | undefined): boolean {
  return findServiceBrand(brand)?.available === true;
}
