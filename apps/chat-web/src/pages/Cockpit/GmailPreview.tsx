import type { PlanStep } from '../../types';
import { formatArgValue } from '../../components/PlanStepItem';

const fieldNames: Record<string, string> = {
  threadId: 'Luồng thư', addLabelIds: 'Thêm nhãn', removeLabelIds: 'Bỏ nhãn', name: 'Tên nhãn',
  subject: 'Tiêu đề', body: 'Nội dung', note: 'Lời nhắn',
};

/** Threads and labels show the names from resourceLabels; a bare ID is marked as having none. */
function argumentValue(key: string, value: unknown, labels?: Record<string, string>) {
  const missing = key === 'threadId' ? 'tiêu đề' : key === 'addLabelIds' || key === 'removeLabelIds' ? 'tên' : null;
  if (!missing) return formatArgValue(value).text;
  const items = Array.isArray(value) ? value : [value];
  return items.map((item, index) => <div key={index}>{typeof item === 'string'
    ? labels?.[item] ?? `${item} · chưa có ${missing} trong dữ liệu`
    : formatArgValue(item).text}</div>);
}

function Arguments({ step, labels, except = [] }: { step: PlanStep; labels?: Record<string, string>; except?: string[] }) {
  return <dl className="v3-space-y-3">{Object.entries(step.args).filter(([key]) => !except.includes(key)).map(([key, value]) => <div key={key}>
    <dt className="font-semibold">{fieldNames[key] ?? key}</dt>
    <dd className="whitespace-pre-wrap break-words min-w-0">{argumentValue(key, value, labels)}</dd>
  </div>)}</dl>;
}

export function GmailPreview({ step, labels }: { step: PlanStep; labels?: Record<string, string> }) {
  const isMail = ['gmail.send_message', 'gmail.reply', 'gmail.forward', 'gmail.create_draft'].includes(step.tool);
  if (!isMail) return <div className="text-xs sm:text-sm v3-space-y-4 min-w-0">
    {step.tool === 'gmail.trash_thread' && <p>Luồng thư này sẽ được chuyển vào Thùng rác của Gmail.</p>}
    <Arguments step={step} labels={labels} />
  </div>;
  let fromThread = false;
  const recipients = ['to', 'cc', 'bcc'].map(group => {
    const value = step.args[group];
    const list = Array.isArray(value) ? value : value == null ? [] : [value];
    return <div key={group} className="v3-space-y-1"><dt className="font-semibold">{group === 'to' ? 'Tới' : group === 'cc' ? 'Cc' : 'Bcc'}</dt><dd>{list.length ? list.map((email, index) => {
      const label = typeof email === 'string' ? labels?.[`recipient:${email.trim().toLowerCase()}`] : undefined;
      if (label?.startsWith('thread:')) fromThread = true;
      return <div key={index} className="break-words"><span>{formatArgValue(email).text}</span>{' · '}<span className="text-brand-muted">{label === 'user' ? 'bạn đã gõ' : label?.startsWith('thread:') ? `lấy từ luồng thư '${label.slice(7)}'` : 'chưa có nhãn nguồn; hãy kiểm lại'}</span></div>;
    }) : <span className="text-brand-muted">Không có</span>}</dd></div>;
  });
  return <div className="text-xs sm:text-sm v3-space-y-4 min-w-0">
    <dl className="v3-space-y-3">{recipients}</dl>
    {fromThread && ['gmail.send_message', 'gmail.forward'].includes(step.tool) && <p role="alert" className="p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-900">Người nhận lấy từ tiêu đề luồng thư có thể bị giả mạo. Hãy kiểm tra từng địa chỉ trước khi duyệt gửi.</p>}
    <Arguments step={step} labels={labels} except={['to', 'cc', 'bcc']} />
  </div>;
}
