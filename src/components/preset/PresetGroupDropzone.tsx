interface PresetGroupDropzoneProps {
  /**
   * 是否处于「拖预设」的拖拽中。为 false 时**整块不渲染** ——
   * 它只在拖拽期间存在，平时挡住面板头部反而会碍事。
   */
  active: boolean;
  /** 指针是否正压在它上面（只有这一种情况才可见、才高亮） */
  hovered: boolean;
}

/**
 * 面板顶部的「建组判断区」（D112）。
 *
 * 用户 2026 轮的形状要求（与快照的 `data-pf-snapshot-dropzone` 同一套做法，但表现不同）：
 * - 拖着一颗胶囊移动到**面板顶部**（标题 + 搜索框 + 色块行那片区域）时，
 *   这里会出现一块**临时判断区**，松手就用这颗胶囊建一个新分组并移入；
 * - **初始透明不可见**：摸得到、看不见。快照那次是单区域，所以拖动一开始就整块高亮提示；
 *   这里是多区域可选，先高亮反而会误导，因此只在**指针真的压上来**时才显形；
 * - 显形时给虚线描边 + 一行字，明确「松手建成分组」。
 *
 * 为什么用 `data-pf-group-name=""`：空组名在落点判定里就表示「新建」，
 * 这样 `hitTestDocument` 与 `resolveDropAction` 不需要为它多造一种类型。
 */
export function PresetGroupDropzone({ active, hovered }: PresetGroupDropzoneProps) {
  if (!active) return null;

  return (
    <div
      className={hovered ? 'pf-group-dropzone pf-group-dropzone--over' : 'pf-group-dropzone'}
      data-pf-group-name=""
      data-pf-group-color=""
      data-pf-group-dropzone="true"
      aria-hidden="true"
    >
      {hovered ? <span className="pf-group-dropzone__hint">松手建成分组</span> : null}
    </div>
  );
}
