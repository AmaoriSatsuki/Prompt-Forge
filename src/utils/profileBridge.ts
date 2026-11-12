import type { ProviderProfile } from '../types/settings';

/**
 * 前端配置结构 → Rust 侧认识的形状。
 *
 * **两边现在是同一种形状**（`id / label / brand`），因此这里只是原样拷贝一份，
 * 不再做任何「拉平」。
 *
 * 历史教训（真发生过，造成启动后显示「缺密钥」）：
 * 这里曾经把结构拉平成旧的 `kind / baseUrl / model / timeoutMs / temperature`，
 * 而 Rust 的 `ProviderProfile` 当时也是那个旧形状 —— 于是**每次 `save_config` 落盘，
 * 前端的 `category` / `llm` / `professional` 都被 serde 丢弃**，
 * 重载后 `category` 兜底成语言模型，百度凭据（存在 `<id>:baidu`）被当成语言模型密钥
 * （`<id>`）去查，界面显示「缺密钥」，而凭据其实一直都在（连接测试能通过）。
 *
 * 因此：**这个函数的形状必须与 Rust `models.rs` 的 `ProviderProfile` 保持一致**，
 * 任何一侧改字段，另一侧必须同步改（Rust 侧有 round-trip 断言钉住关键字段）。
 */
export type RustProviderProfile = ProviderProfile;

export function toRustProfile(profile: ProviderProfile): RustProviderProfile {
  return {
    id: profile.id,
    label: profile.label,
    brand: profile.brand,
  };
}
