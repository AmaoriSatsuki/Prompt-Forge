import { leadingCapsulesEnd } from './placeholder';

/**
 * 源内容字符串层面的插入工具。
 *
 * **空格口径（D79）**：胶囊是一整串「开头区块」，区块内部**不插空格**（药丸之间的间距由 CSS 负责），
 * 区块与后面手打的中文之间**保留一个空格**（术语英文与中文之间读起来才不粘）。
 * 历史上这里是"总在拼接处加一个空格"，于是连续拖三颗胶囊会得到 `[A] [B] [C]`，
 * 界面上多出两处看得见的空隙 —— 用户 2026 轮实测报的"拖进去会产生空格"就是这个。
 */

/** 拖入胶囊：排在**已有胶囊之后**（先拖入的在前），整体仍在译文/中文之前 */
export function insertAfterCapsules(text: string, snippet: string): string {
  if (!snippet) return text;
  if (!text) return snippet;

  const end = leadingCapsulesEnd(text);
  const head = text.slice(0, end);
  // 与文字之间统一收敛成一个空格（原有多个/没有都归一）
  const tail = text.slice(end).replace(/^\s+/, '');

  if (!head) {
    // 开头没有胶囊（用户先打了字）：插到最前面，与文字之间留一个空格
    return tail ? `${snippet} ${tail}` : snippet;
  }
  // 紧跟最后一个锚点，不加空格；后面若还有文字，用**一个**空格隔开
  return tail ? `${head}${snippet} ${tail}` : `${head}${snippet}`;
}

/** 插到整段内容的末尾（保留给"插到末尾"这条路径） */
export function insertAtEnd(text: string, snippet: string): string {
  if (!snippet) return text;
  if (text.length === 0) return snippet;
  return `${text} ${snippet}`;
}
