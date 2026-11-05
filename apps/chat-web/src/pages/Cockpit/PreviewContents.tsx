// Source: AppStagePage.tsx PREVIEW.card/issue/rows/message content, with actual plan arguments.
import { toolDefinition } from '../../services/tool-definitions';
import type { PlanStep } from '../../types';
import { operation } from './presentation';
import { GmailPreview } from './GmailPreview';

const names: Record<string, string> = {
  title: 'Tiêu đề',
  name: 'Tên',
  summary: 'Tiêu đề',
  body: 'Nội dung',
  text: 'Nội dung',
  desc: 'Mô tả ngắn',
  description: 'Mô tả',
  range: 'Vùng dữ liệu yêu cầu',
  values: 'Giá trị',
  rows: 'Các dòng',
  repo: 'Kho mã',
  issueNumber: 'Số issue / PR',
  label: 'Nhãn',
  labels: 'Nhãn',
  assignees: 'Người phụ trách',
  state: 'Trạng thái',
  query: 'Từ khóa tìm kiếm',
};

export function formatBusinessArgValue(value: unknown): { text: string; isRef: boolean } {
  if (typeof value === 'string' && value.startsWith('$step_')) {
    const num = value.match(/\d+/)?.[0] ?? '1';
    return { text: `‹danh sách công việc đọc ở bước ${num}›`, isRef: true };
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const { $ref, $template } = value as { $ref?: unknown; $template?: unknown };
    if (typeof $ref === 'string') {
      if ($ref.endsWith('.url') || $ref.endsWith('.html_url')) {
        const [stepId, , ...field] = $ref.split('.');
        return { text: `‹kết quả ${stepId}${field.length ? `: ${field.join('.')}` : ''}›`, isRef: true };
      }
      const num = $ref.match(/step_?(\d+)/i)?.[1] ?? '1';
      return { text: `‹danh sách công việc đọc ở bước ${num}›`, isRef: true };
    }
    if (typeof $template === 'string') {
      const replaced = $template.replace(/\$\{([^}]+)\}/g, (_, path: string) => {
        if (path.endsWith('.url') || path.endsWith('.html_url')) {
          const [stepId, , ...field] = path.split('.');
          return `‹kết quả ${stepId}${field.length ? `: ${field.join('.')}` : ''}›`;
        }
        const num = path.match(/step_?(\d+)/i)?.[1] ?? '1';
        return `‹danh sách công việc đọc ở bước ${num}›`;
      });
      return { text: replaced, isRef: false };
    }
    return { text: JSON.stringify(value), isRef: false };
  }
  if (Array.isArray(value)) {
    return { text: value.map((item) => formatBusinessArgValue(item).text).join(', '), isRef: false };
  }
  return { text: String(value), isRef: false };
}

const text = (value: unknown) => formatBusinessArgValue(value).text;

function OtherArguments({ step, except }: { step: PlanStep; except: string[] }) {
  return (
    <>
      {Object.entries(step.args)
        .filter(
          ([key]) =>
            !except.includes(key) &&
            !toolDefinition(step.tool)?.inputSchema.properties?.[key]?.['x-resource']
        )
        .map(([key, value]) => (
          <div key={key} className="min-w-0">
            <span className="text-[11px] text-[var(--planora-muted)] uppercase font-semibold">
              {names[key] ?? key}:
            </span>
            <div className="text-xs text-[var(--planora-text)] bg-[var(--planora-paper)] p-2.5 rounded-lg border border-[var(--planora-divider)] mt-1 leading-relaxed v3-space-y-1.5 whitespace-pre-wrap break-words break-all min-w-0">
              {text(value)}
            </div>
          </div>
        ))}
    </>
  );
}

export function PreviewContents({
  step,
  destination,
  labels,
}: {
  step: PlanStep;
  destination: string;
  labels?: Record<string, string>;
}) {
  if (step.tool.startsWith('gmail.')) return <GmailPreview step={step} labels={labels} />;
  const style = operation(step.tool).previewStyle;

  if (style === 'card') {
    return (
      <div className="p-4 bg-[var(--planora-canvas)] rounded-xl border border-[var(--planora-divider)] v3-space-y-3 min-w-0 max-w-full">
        {step.args.title != null && (
          <div className="min-w-0">
            <span className="text-[11px] text-[var(--planora-muted)] uppercase font-semibold">Tiêu đề card:</span>
            <div className="text-sm font-bold text-neutral-900 mt-0.5 break-words">{text(step.args.title)}</div>
          </div>
        )}
        <div className="min-w-0">
          <span className="text-[11px] text-[var(--planora-muted)] uppercase font-semibold">Đích:</span>
          <div className="text-xs text-[var(--planora-text)] mt-0.5 break-words">{destination}</div>
        </div>
        {step.args.desc != null && (
          <div className="min-w-0">
            <span className="text-[11px] text-[var(--planora-muted)] uppercase font-semibold">Mô tả ngắn:</span>
            <p className="text-xs text-[var(--planora-text)] bg-[var(--planora-paper)] p-2.5 rounded-lg border border-[var(--planora-divider)] mt-1 leading-relaxed break-words">
              {text(step.args.desc)}
            </p>
          </div>
        )}
        <OtherArguments step={step} except={['title', 'desc']} />
      </div>
    );
  }

  if (style === 'message') {
    return (
      <div className="p-4 bg-[var(--planora-canvas)] rounded-xl border border-[var(--planora-divider)] v3-space-y-2.5 min-w-0 max-w-full">
        <div className="flex items-center justify-between text-xs text-[var(--planora-muted)] min-w-0">
          <span className="break-words">
            {'Đích: '}
            <strong className="text-[var(--planora-text)]">{destination}</strong>
          </span>
        </div>
        {step.args.text != null && (
          <div className="bg-white p-3 rounded-lg border border-neutral-200 text-xs text-neutral-900 leading-relaxed font-sans v3-space-y-1.5 whitespace-pre-wrap break-words break-all min-w-0">
            {text(step.args.text)}
          </div>
        )}
        <OtherArguments step={step} except={['text']} />
      </div>
    );
  }

  if (style === 'rows') {
    const values = step.args.values ?? step.args.rows;
    const rows = Array.isArray(values) ? (values.filter(Array.isArray) as unknown[][]) : [];
    const maxCols = Math.max(1, ...rows.map((r) => r.length));
    const colLetters = Array.from({ length: maxCols }, (_, idx) => String.fromCharCode(65 + (idx % 26)));
    return (
      <div className="v3-space-y-3 min-w-0 max-w-full">
        <div className="text-xs text-[var(--planora-muted)] min-w-0 break-words">
          {'Đích: '}
          <strong className="text-[var(--planora-text)]">{destination}</strong>
        </div>
        {rows.length > 0 && (
          <div
            data-testid="spreadsheet-grid-preview"
            className="border border-emerald-200 rounded-xl overflow-x-auto bg-white shadow-2xs max-w-full"
          >
            <div className="px-3 py-1.5 bg-emerald-50/80 border-b border-emerald-200 text-[11px] font-semibold text-emerald-900 flex items-center justify-between">
              <span>Xem trước dòng bảng tính (Spreadsheet Grid)</span>
              <span className="font-mono text-[10px] text-emerald-700">
                {rows.length} dòng × {maxCols} cột
              </span>
            </div>
            <div className="min-w-full">
              <div
                className="grid border-b border-neutral-200 bg-neutral-50 text-[11px] font-semibold text-neutral-600"
                style={{ gridTemplateColumns: `repeat(${maxCols}, minmax(96px, 1fr))` }}
              >
                {colLetters.map((letter) => (
                  <div key={letter} className="px-2.5 py-1.5 border-r last:border-r-0 border-neutral-200 font-mono">
                    Cột {letter}
                  </div>
                ))}
              </div>
              {rows.map((row, rIdx) => (
                <div
                  key={rIdx}
                  className="grid border-b last:border-b-0 border-neutral-200 text-xs text-neutral-900 bg-white"
                  style={{ gridTemplateColumns: `repeat(${maxCols}, minmax(96px, 1fr))` }}
                >
                  {colLetters.map((letter, cIdx) => (
                    <div
                      key={`${rIdx}-${letter}`}
                      className="px-2.5 py-2 border-r last:border-r-0 border-neutral-100 break-words break-all"
                    >
                      {row[cIdx] !== undefined ? text(row[cIdx]) : ''}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="border border-[var(--planora-divider)] rounded-xl overflow-x-auto max-w-full">
          <table className="w-full text-left text-xs min-w-full">
            <thead className="bg-[var(--planora-surface-inset)] text-[var(--planora-muted)] font-semibold border-b border-[var(--planora-divider)]">
              <tr>
                <th className="p-2.5">Cột</th>
                <th className="p-2.5">Giá trị sẽ ghi</th>
              </tr>
            </thead>
            <tbody className="v3-divide-y divide-[var(--planora-divider)] bg-[var(--planora-paper)]">
              {rows.flatMap((row, rowIndex) =>
                row.map((value, columnIndex) => (
                  <tr key={`${rowIndex}-${columnIndex}`}>
                    <td className="p-2.5 font-medium text-[var(--planora-muted)]">
                      Giá trị {columnIndex + 1}
                      {rows.length > 1 ? ` · nhóm ${rowIndex + 1}` : ''}
                    </td>
                    <td className="p-2.5 text-[var(--planora-text)] break-words break-all">{text(value)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <OtherArguments step={step} except={['values', 'rows']} />
      </div>
    );
  }

  // Catalog fallback & issue/PR preview
  const ghLabels = Array.isArray(step.args.labels)
    ? step.args.labels.filter((l): l is string => typeof l === 'string' && l.trim().length > 0)
    : typeof step.args.label === 'string' && step.args.label.trim().length > 0
      ? [step.args.label.trim()]
      : [];
  const ghAssignees = Array.isArray(step.args.assignees)
    ? step.args.assignees.filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
    : [];
  const ghState =
    step.tool.startsWith('github.') && (step.args.state === 'open' || step.args.state === 'closed')
      ? step.args.state
      : null;
  const badgeExcluded = [
    ...(ghLabels.length > 0 ? ['labels', 'label'] : []),
    ...(ghAssignees.length > 0 ? ['assignees'] : []),
    ...(ghState ? ['state'] : []),
  ];

  return (
    <div className="p-4 bg-[var(--planora-canvas)] rounded-xl border border-[var(--planora-divider)] v3-space-y-3 min-w-0 max-w-full">
      <div className="min-w-0">
        <span className="text-[11px] text-[var(--planora-muted)] uppercase font-semibold">Đích:</span>
        <div className="text-xs font-medium text-[var(--planora-text)] mt-0.5 break-words">{destination}</div>
      </div>
      {Object.entries(step.args)
        .filter(([key]) => ['title', 'name', 'summary'].includes(key))
        .map(([key, value]) => (
          <div key={key} className="min-w-0">
            <span className="text-[11px] text-[var(--planora-muted)] uppercase font-semibold">{names[key]}:</span>
            <div className="text-sm font-bold text-neutral-900 mt-0.5 break-words">{text(value)}</div>
          </div>
        ))}
      {(ghState || ghLabels.length > 0 || ghAssignees.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="github-preview-badges">
          {ghState && (
            <span
              className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                ghState === 'open'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-purple-50 text-purple-700 border-purple-200'
              }`}
            >
              {ghState === 'open' ? 'Đang mở (open)' : 'Đã đóng (closed)'}
            </span>
          )}
          {ghLabels.map((lbl) => (
            <span
              key={`lbl-${lbl}`}
              className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-800 border border-amber-200"
            >
              #{lbl}
            </span>
          ))}
          {ghAssignees.map((assignee) => (
            <span
              key={`asg-${assignee}`}
              className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-200"
            >
              @{assignee.replace(/^@/, '')}
            </span>
          ))}
        </div>
      )}
      <OtherArguments step={step} except={['title', 'name', 'summary', ...badgeExcluded]} />
    </div>
  );
}

