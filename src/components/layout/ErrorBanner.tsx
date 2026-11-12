import { useState } from 'react';
import { useRealtimeTranslate } from '../../hooks/useRealtimeTranslate';
import { useModuleStore } from '../../store/useModuleStore';
import { useUiStore } from '../../store/useUiStore';
import { Button } from '../common/Button';

/**
 * 翻译错误横幅（常驻，只能手动关掉）。
 *
 * 为什么不用 toast：失败是**必须被用户看见**的事，而 toast 会自己消失、
 * 同一时刻只显示一条，被后面的提示挤掉就等于没提示。
 *
 * **为什么必须有「重试」按钮**：工具栏整合后移除了所有手动翻译按钮，
 * 模块枢只负责复制/保存/清空，翻译完全交给实时翻译。实时翻译失败后
 * **不会自动重试**（同一文本只调度一次，否则会把接口打成死循环），
 * 因此失败后的唯一补救入口就是这个按钮 —— 它重试的是**失败的排**。
 *
 * 分两层是刻意的（架构 §6.4）：`ErrorBannerView` 是纯展示组件，可以拿夹具直接断言；
 * `ErrorBanner` 只负责从 Store 取数据。SSR 下 zustand 只返回初始状态，
 * 把两者混在一起就永远测不出「真有失败时横幅长什么样」。
 */

export interface ErrorBannerViewProps {
  /** 失败模块的序号，按界面顺序 */
  failedOrders: number[];
  /** 中文失败原因 */
  message: string;
  /** 重试失败的排 */
  onRetry: () => void;
  onDismiss: () => void;
  /** 是否正在重试（按钮显示进行中并禁用） */
  retrying?: boolean;
}

/** 纯展示层：只认 props，不读 Store */
export function ErrorBannerView({
  failedOrders,
  message,
  onRetry,
  onDismiss,
  retrying = false,
}: ErrorBannerViewProps) {
  return (
    <div className="pf-failure" role="alert" aria-live="assertive">
      <span className="pf-failure__mark" aria-hidden="true">
        !
      </span>
      <div className="pf-failure__body">
        <p className="pf-failure__title">
          {failedOrders.length > 1
            ? `${failedOrders.length} 个模块翻译失败（模块 ${failedOrders.join('、')}）`
            : `模块 ${failedOrders[0] ?? ''} 翻译失败`}
        </p>
        <p className="pf-failure__reason">{message}</p>
        <p className="pf-failure__hint">
          你写的中文内容没有任何丢失，仍在下方输入框里。修好原因后点「重试」即可。
        </p>
      </div>
      <div className="pf-failure__actions">
        <Button variant="primary" compact disabled={retrying} onClick={onRetry}>
          {retrying ? '重试中……' : '重试'}
        </Button>
        <Button compact onClick={onDismiss} title="关掉这条提示（下次失败会重新出现）">
          我知道了
        </Button>
      </div>
    </div>
  );
}

/**
 * 容器层：失败模块的序号从模块状态派生（`status === 'error'`），不存任何副本，
 * 因此全部重试成功后横幅随失败计数归零自动收起。
 */
export function ErrorBanner() {
  const failure = useUiStore((state) => state.translationFailure);
  const dismiss = useUiStore((state) => state.dismissTranslationFailure);
  const modules = useModuleStore((state) => state.modules);
  const { retryFailed } = useRealtimeTranslate();
  const [retrying, setRetrying] = useState(false);

  const failedOrders = modules
    .filter((module) => module.status === 'error')
    .map((module) => module.order);

  if (!failure || failedOrders.length === 0) return null;

  return (
    <ErrorBannerView
      failedOrders={failedOrders}
      message={failure.message}
      retrying={retrying}
      onRetry={() => {
        setRetrying(true);
        void retryFailed().finally(() => setRetrying(false));
      }}
      onDismiss={dismiss}
    />
  );
}
