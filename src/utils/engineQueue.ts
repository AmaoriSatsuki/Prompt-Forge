/**
 * 每引擎串行请求队列（V3 第一层的纯逻辑部分）。
 *
 * 约束（用户指定）：模块之间用队列控制 QPS，**请求间隔不小于 100ms**；
 * 而各引擎还有各自的下限（百度标准版 1 QPS → 1100ms），因此实际间隔取
 * `max(引擎下限, 100ms)`。**每个引擎一条队列**：将来接第二家服务时互不拖慢，
 * 也不会让其中一家被另一家的限流卡住。
 *
 * 纯逻辑：不读 React、不判环境；时间由 `now()` 注入，因此可以在 Node 里
 * 用假时钟断言间隔，而不必真的 sleep。
 */

/** 全局下限：用户要求模块之间不小于 100ms */
export const MIN_REQUEST_INTERVAL_MS = 100;

export interface QueueItem<T> {
  /** 队列内的任务标识（同一模块重复入队时用它去重/替换） */
  id: string;
  /** 真正执行的动作 */
  run: () => Promise<T>;
}

export interface EngineQueueOptions {
  /** 该引擎自己的最小间隔（例如百度 1100ms） */
  minIntervalMs: number;
  /** 时间源，默认 Date.now（测试可注入假时钟） */
  now?: () => number;
  /** 等待函数，默认 setTimeout（测试可注入） */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * 一台引擎的串行队列。
 *
 * - 串行：一次只跑一个请求，绝不并发打接口；
 * - 限速：两次**实际发起**之间至少间隔 `max(引擎下限, 100ms)`；
 * - 去重：同一 `id` 已在排队时，新的覆盖旧的 —— 实时翻译里用户还在打字，
 *   没必要把中间态的每一次停顿都翻一遍，只翻最后一次。
 */
export class EngineQueue<T> {
  private readonly pending: QueueItem<T>[] = [];
  private readonly minIntervalMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private running = false;
  private lastStartedAt = Number.NEGATIVE_INFINITY;

  constructor(options: EngineQueueOptions) {
    this.minIntervalMs = Math.max(MIN_REQUEST_INTERVAL_MS, options.minIntervalMs);
    this.now = options.now ?? (() => Date.now());
    this.sleep =
      options.sleep ?? ((ms) => new Promise<void>((resolve) => window.setTimeout(resolve, ms)));
  }

  /** 排队一个任务；同 id 的旧任务被替换掉（只保留最新一次） */
  enqueue(item: QueueItem<T>): void {
    const existing = this.pending.findIndex((candidate) => candidate.id === item.id);
    if (existing >= 0) this.pending.splice(existing, 1);
    this.pending.push(item);
    void this.drain();
  }

  /** 丢掉某个 id 的待办任务（例如该模块被删除、或用户关掉了实时翻译） */
  cancel(id: string): boolean {
    const index = this.pending.findIndex((candidate) => candidate.id === id);
    if (index < 0) return false;
    this.pending.splice(index, 1);
    return true;
  }

  /** 清空待办（不影响正在跑的那个） */
  clear(): void {
    this.pending.length = 0;
  }

  pendingIds(): string[] {
    return this.pending.map((item) => item.id);
  }

  isRunning(): boolean {
    return this.running;
  }

  /** 距离下一次可以发请求还差多少毫秒（0 = 现在就可以） */
  waitForSlot(): number {
    const elapsed = this.now() - this.lastStartedAt;
    const remaining = this.minIntervalMs - elapsed;
    return remaining > 0 ? remaining : 0;
  }

  /** 串行执行直到队列清空 */
  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending.length > 0) {
        const gap = this.waitForSlot();
        if (gap > 0) await this.sleep(gap);
        const item = this.pending.shift();
        if (!item) break;
        this.lastStartedAt = this.now();
        try {
          await item.run();
        } catch {
          // 单个任务失败不能打断队列：失败处理由调用方（调度层）负责记录与提示
        }
      }
    } finally {
      this.running = false;
    }
  }
}

/**
 * 引擎 → 队列的登记处。
 *
 * 做成模块级单例（与既有 `useTranslate` 里的节流表同样的理由）：
 * 多个 Hook 实例必须共享同一条队列，否则「单排翻译」与「全文翻译」
 * 会各自以为自己才是限速内的那一个。
 */
const queues = new Map<string, EngineQueue<unknown>>();

export function engineQueue<T>(engine: string, minIntervalMs: number): EngineQueue<T> {
  const existing = queues.get(engine);
  if (existing) return existing as EngineQueue<T>;
  const created = new EngineQueue<T>({ minIntervalMs });
  queues.set(engine, created as EngineQueue<unknown>);
  return created;
}

/** 测试/清理用：丢掉所有队列 */
export function resetEngineQueues(): void {
  queues.clear();
}
