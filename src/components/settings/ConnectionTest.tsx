import type { TestReport } from '../../types/settings';
import { Button } from '../common/Button';

interface ConnectionTestProps {
  report: TestReport | null;
  testing: boolean;
  onTest: () => void;
}

/**
 * 连接测试：把「结论 + 原因」一起显示出来，而不是只报成功失败。
 *
 * 本版只剩专业翻译接口：凭据在系统凭据库里，界面无从预判有没有配，
 * 因此按钮**始终可点**（缺什么由 Rust 返回的中文提示说明），只在测试进行中禁用。
 *
 * 布局上有一条实测踩到的坑：结论文字长度不定（百度那条会带上凭据来源与耗时），
 * 它和按钮同处一个 flex 行时**绝不能反过来把按钮压窄**——「测试连接」四个字被挤成两行是 bug。
 * 因此按钮由 `.pf-btn` 保证「不收缩 + 不换行、宽度即内容宽度」，
 * 这一行则由 `.pf-conn` 的 `flex-wrap: wrap` 让过长结论换到下一行。
 */
export function ConnectionTest({ report, testing, onTest }: ConnectionTestProps) {
  return (
    <div className="pf-conn">
      <Button variant="primary" disabled={testing} onClick={onTest}>
        {testing ? '测试中……' : '测试连接'}
      </Button>
      {report ? (
        <p className={report.ok ? 'pf-conn__result pf-conn__result--ok' : 'pf-conn__result pf-conn__result--bad'}>
          {report.message}
        </p>
      ) : null}
    </div>
  );
}
