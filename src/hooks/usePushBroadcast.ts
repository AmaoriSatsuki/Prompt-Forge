import { useEffect } from 'react';
import { broadcastTranslation } from '../api/push';
import { errorMessage } from '../api/tauri';
import { PUSH_BROADCAST_DEBOUNCE_MS } from '../constants/limits';
import { useModuleStore } from '../store/useModuleStore';
import { usePushStore } from '../store/usePushStore';
import { composeBroadcastPayload } from '../utils/moduleText';

/**
 * 实时推流（D81）：工作区的「最终拼接文本」一变，就把它推给 Rust 端广播出去。
 *
 * 三条关键取舍：
 *
 * 1. **监听的是最终结果，不是某个动作**。
 *    订阅的是模块 Store 本身，而不是「翻译回调」「拖胶囊回调」「套快照回调」——
 *    打字、增删胶囊、全文清空、加载快照、草稿恢复……凡是从 Store 改模块的路径都会走到这里。
 *    「哪些动作算」这个问题因此不需要维护一张清单：只要最终文本变了就推，
 *    没变就不推（切换选中排、拖高度这类纯界面动作自然不会推）。
 *
 * 2. **载荷复用「全文复制」的纯函数**（`composeBroadcastPayload` → `composeBroadcastText`
 *    → `composeFullCopyText`）：`global` 与用户点「全文复制」拿到的**是同一段英文**，
 *    只是把换行压成空格；另外附一份按行位置切开的 `modules`（D90），
 *    供 ComfyUI 那边「一个节点只吃一排」做物理隔离。
 *
 * 3. **200ms 防抖留在前端**。拖胶囊 / 连续打字时文本每帧都在变，
 *    攒到停手后再推一次；Rust 收到就立刻广播，服务端不再攒批。
 *
 * 失败（浏览器预览里没有 Tauri、服务没起来）只打一行 console 告警：
 * 推流是「锦上添花」的能力，绝不能因为推不出去打断用户手头的活。
 */
export function usePushBroadcast() {
  const enabled = usePushStore((state) => state.enabled);

  useEffect(() => {
    // 设置里关掉推送就不再推（Rust 侧同时把监听也关了）
    if (!enabled) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    /**
     * 已经推出去的内容指纹：内容没变就不重复推（避免纯界面动作引起空推）。
     *
     * D90 起载荷是「全局文本 + 9 块模块文本」，去重必须看整帧：
     * 只看 global 会漏掉「某排换了内容、但拼起来字数恰好一样」的极端情况，
     * 因此用 JSON 序列化当指纹（键顺序由我们的构造顺序固定，不会误判为变）。
     */
    let sent: string | null = null;

    const flush = () => {
      const payload = composeBroadcastPayload(useModuleStore.getState().modules);
      const fingerprint = JSON.stringify(payload);
      if (fingerprint === sent) return;
      // 先记账再发：同一次失败不重试（下一次文本变化自然会再推一次）
      sent = fingerprint;
      broadcastTranslation(payload)
        .then((report) => {
          console.info(
            `[推送] WS 推流成功，当前文本长度 ${report.chars}，在线客户端 ${report.clients} 个`,
          );
        })
        .catch((error: unknown) => {
          console.warn(`[推送] 本次推流未送达：${errorMessage(error)}`);
        });
    };

    const schedule = (delay: number) => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        flush();
      }, delay);
    };

    // 任何模块状态变化都重新排期：真正的去重在 flush 里按「最终文本」做
    const unsubscribe = useModuleStore.subscribe(() => schedule(PUSH_BROADCAST_DEBOUNCE_MS));

    // 挂载时立刻推一次（不等防抖）：服务刚起来就得有内容，
    // 这样后连上的 ComfyUI 节点能直接拿到当前文本，不用等用户再敲一个字。
    // 全空时也照推（推空字符串），客户端因此知道「现在没有内容」，而不是「没消息」。
    schedule(0);

    return () => {
      unsubscribe();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [enabled]);
}
