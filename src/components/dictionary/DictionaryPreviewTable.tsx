/**
 * 词典字段映射的「5 行预览表」（纯展示）。
 *
 * 字段名与数据都来自用户文件，属于**外部内容**：整块标 `data-pf-external`，
 * 让界面文案审校整体跳过 —— 否则英文列名会被当成「界面出现英文」。
 */
export function DictionaryPreviewTable({
  fields,
  rows,
}: {
  fields: string[];
  rows: string[][];
}) {
  return (
    <div className="pf-dict__preview" data-pf-external="true">
      <table className="pf-dict__table">
        <thead>
          <tr>
            {fields.map((field, index) => (
              <th key={`${field}-${index}`}>{field}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {fields.map((_, cellIndex) => (
                <td key={cellIndex}>{row[cellIndex] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
