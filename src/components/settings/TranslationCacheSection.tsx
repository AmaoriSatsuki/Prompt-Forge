import { useState } from 'react';
import { useCacheAdmin, translationCacheSummary } from '../../hooks/useRealtimeTranslate';
import { useModuleStore } from '../../store/useModuleStore';
import { isCacheEnabled, setCacheEnabled } from '../../hooks/translationCacheStore';
import { Button } from '../common/Button';
import { ConfirmDialog } from '../common/ConfirmDialog';

/**
 * 设置面板里的「翻译缓存」区：条数、占用大小、开关与清空。
 *
 * 条数与占用是**实时读数**（不放进 Store）：缓存由调度层高频读写，
 * 放进 React 状态只会带来无意义的重渲染。这里用 `modules` 作为「有新写入」的信号
 * 触发重渲染 —— 每次翻译成功都会改 modules，因此读数会自动跟上。
 */
export function TranslationCacheSection() {
  const modules = useModuleStore((state) => state.modules);
  const { clearAll } = useCacheAdmin();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  // 用 modules.length 触发一次重渲染，保证读数不是陈旧的
  void modules;

  const stats = translationCacheSummary();
  const enabled = isCacheEnabled();
  const sizeText = formatBytes(stats.approxBytes);

  return (
    <div className="pf-cache">
      <div className="pf-cache__row">
        <span className="pf-cache__label">翻译缓存</span>
        <span className="pf-cache__value">
          {stats.entries} 条 · 约 {sizeText}
        </span>
      </div>
      <p className="pf-cache__hint">
        相同内容不会再重复请求翻译服务。关掉后每次都重新请求。
      </p>
      <div className="pf-cache__actions">
        <Button
          compact
          onClick={() => setCacheEnabled(!enabled)}
          title={enabled ? '关掉后不再使用缓存' : '打开后相同内容直接复用译文'}
        >
          {enabled ? '已启用（点击关闭）' : '已关闭（点击启用）'}
        </Button>
        <Button
          compact
          disabled={busy || stats.entries === 0}
          title={stats.entries === 0 ? '当前没有缓存条目' : '清空内存与磁盘上的全部缓存'}
          onClick={() => setConfirming(true)}
        >
          清空缓存
        </Button>
      </div>

      {confirming ? (
        <ConfirmDialog
          title="清空翻译缓存"
          text={`确定要清空全部 ${stats.entries} 条翻译缓存吗？清空后相同的模块内容需要重新请求翻译服务。`}
          confirmLabel="清空"
          onConfirm={() => {
            setConfirming(false);
            setBusy(true);
            void clearAll().finally(() => setBusy(false));
          }}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </div>
  );
}

/** 占用大小的可读写法：不足 1KB 显示字节，否则显示 KB */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} 字节`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}
