import type { PlanStep } from '../../types';
import { formatArgValue } from '../../components/PlanStepItem';

export function GmailPreview({ step, labels }: { step: PlanStep; labels?: Record<string, string> }) {
  const isMail = ['gmail.send_message', 'gmail.reply', 'gmail.forward', 'gmail.create_draft'].includes(step.tool);
  if (!isMail) return <dl className="text-xs v3-space-y-3">{Object.entries(step.args).map(([key, value]) => <div key={key}><dt className="font-semibold">{key}</dt><dd className="whitespace-pre-wrap break-words">{formatArgValue(value).text}</dd></div>)}</dl>;
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
    <dl className="v3-space-y-3">{Object.entries(step.args).filter(([key]) => !['to', 'cc', 'bcc'].includes(key)).map(([key, value]) => <div key={key}>
      <dt className="font-semibold">{key === 'body' ? 'Nội dung' : key === 'subject' ? 'Tiêu đề' : key === 'threadId' ? 'Luồng thư' : key}</dt>
      <dd className="whitespace-pre-wrap break-words min-w-0">{key === 'threadId' && typeof value === 'string' && labels?.[value] ? labels[value] : formatArgValue(value).text}</dd>
    </div>)}</dl>
  </div>;
}
