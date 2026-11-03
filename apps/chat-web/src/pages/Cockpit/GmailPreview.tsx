import type { PlanStep } from '../../types';
import { formatArgValue } from '../../components/PlanStepItem';

const fieldNames: Record<string, string> = {
  threadId: 'Luồng thư', threadIds: 'Các luồng thư', addLabelIds: 'Thêm nhãn', removeLabelIds: 'Bỏ nhãn', name: 'Tên nhãn',
  subject: 'Tiêu đề', body: 'Nội dung', note: 'Lời nhắn',
};

/** Threads and labels show the names from resourceLabels; a bare ID is marked as having none. */
function argumentValue(key: string, value: unknown, labels?: Record<string, string>) {
  const missing = key === 'threadId' || key === 'threadIds' ? 'tiêu đề' : key === 'addLabelIds' || key === 'removeLabelIds' ? 'tên' : null;
  if (!missing) return formatArgValue(value).text;
  const items = Array.isArray(value) ? value : [value];
  return <div className="flex flex-wrap gap-1.5 mt-1">{items.map((item, index) => <div key={index} className="px-2.5 py-1 rounded-lg bg-white border border-[#E7E7E2] text-[#111827] font-medium">{typeof item === 'string'
    ? labels?.[item] ?? `${item} · chưa có ${missing} trong dữ liệu`
    : formatArgValue(item).text}</div>)}</div>;
}

function Arguments({ step, labels, except = [] }: { step: PlanStep; labels?: Record<string, string>; except?: string[] }) {
  return <dl className="v3-space-y-3">{Object.entries(step.args).filter(([key]) => !except.includes(key)).map(([key, value]) => {
    const isFramedField = key === 'body' || key === 'note' || key === 'subject';
    return <div key={key} className="v3-space-y-1">
      <dt className="font-semibold text-xs uppercase tracking-wider text-[#6B7280]">{fieldNames[key] ?? key}</dt>
      <dd className={isFramedField ? 'whitespace-pre-wrap break-words min-w-0 p-3 rounded-lg bg-white border border-[#E7E7E2] text-[#111827]' : 'whitespace-pre-wrap break-words min-w-0'}>{argumentValue(key, value, labels)}</dd>
    </div>;
  })}</dl>;
}

export function GmailPreview({ step, labels }: { step: PlanStep; labels?: Record<string, string> }) {
  const isMail = ['gmail.send_message', 'gmail.reply', 'gmail.forward', 'gmail.create_draft'].includes(step.tool);
  if (!isMail) return <div data-testid="gmail-preview-card" className="p-4 rounded-xl bg-[#F8F8F6] border border-[#E7E7E2] text-xs sm:text-sm v3-space-y-4 min-w-0">
    {step.tool === 'gmail.trash_thread' && <p className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900">Luồng thư này sẽ được chuyển vào Thùng rác của Gmail.</p>}
    <Arguments step={step} labels={labels} />
  </div>;
  let fromThread = false;
  const recipients = ['to', 'cc', 'bcc'].map(group => {
    const value = step.args[group];
    const list = Array.isArray(value) ? value : value == null ? [] : [value];
    return <div key={group} className="v3-space-y-1"><dt className="font-semibold text-xs uppercase tracking-wider text-[#6B7280]">{group === 'to' ? 'Tới' : group === 'cc' ? 'Cc' : 'Bcc'}</dt><dd className="flex flex-wrap gap-1.5">{list.length ? list.map((email, index) => {
      const label = typeof email === 'string' ? labels?.[`recipient:${email.trim().toLowerCase()}`] : undefined;
      if (label?.startsWith('thread:')) fromThread = true;
      const badgeClass = label === 'user'
        ? 'px-1.5 py-0.5 rounded text-[11px] font-medium bg-emerald-50 text-emerald-800 border border-emerald-200'
        : label?.startsWith('service:')
          ? 'px-1.5 py-0.5 rounded text-[11px] font-medium bg-blue-50 text-blue-800 border border-blue-200'
          : 'px-1.5 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-900 border border-amber-200';
      return <div key={index} className="inline-flex flex-wrap items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-[#E7E7E2] break-words"><span className="font-medium text-[#111827]">{formatArgValue(email).text}</span>{' · '}<span className={badgeClass}>{label === 'user' ? 'bạn đã gõ' : label?.startsWith('thread:') ? `lấy từ luồng thư '${label.slice(7)}'` : label?.startsWith('service:') ? `lấy từ ${label.slice(8)}` : 'chưa có nhãn nguồn; hãy kiểm lại'}</span></div>;
    }) : <span className="text-brand-muted">Không có</span>}</dd></div>;
  });
  return <div data-testid="gmail-preview-card" className="p-4 rounded-xl bg-[#F8F8F6] border border-[#E7E7E2] text-xs sm:text-sm v3-space-y-4 min-w-0">
    <dl className="v3-space-y-3">{recipients}</dl>
    {fromThread && ['gmail.send_message', 'gmail.forward'].includes(step.tool) && <p role="alert" className="p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-900">Người nhận lấy từ tiêu đề luồng thư có thể bị giả mạo. Hãy kiểm tra từng địa chỉ trước khi duyệt gửi.</p>}
    <Arguments step={step} labels={labels} except={['to', 'cc', 'bcc']} />
  </div>;
}
