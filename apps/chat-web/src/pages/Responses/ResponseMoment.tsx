// Structure and classes from PROTO-01 ResponsesPage; demo controls are omitted.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ServiceLogo } from '../../components/ServiceLogo';
import { apiClient } from '../../services/api-client';
import { conversationReturnPath, gmailSessionOwner, redirectToGmail } from '../../services/gmail-connection';
import type { ChatMessage, ClarificationState, ServiceInfo } from '../../types';

const secondary = 'px-4 py-2 bg-white hover:bg-neutral-50 text-[#111827] border border-[#E7E7E2] text-xs sm:text-sm font-medium rounded-xl transition-colors';
const primary = 'px-4 py-2 bg-[#FF5701] hover:bg-[#E04D00] text-white text-xs sm:text-sm font-semibold rounded-xl shadow-sm transition-colors';
const labels = { healthy: 'Kết nối tốt', unhealthy: 'Không kết nối được', unchecked: 'Chưa kiểm tra', unconfigured: 'Chưa kết nối' };

export function clarificationVariant(clarification: ClarificationState | null, request: string): 'read-only' | 'destination' | null {
  if (!clarification) return null;
  if (clarification.reason === 'read_only') return 'read-only';
  if (clarification.reason === 'destination') return 'destination';
  // Legacy saved messages predate the structured reason. These hints choose
  // presentation only; every displayed answer remains the planner's.
  const text = `${clarification.question} ${clarification.context ?? ''}`;
  if (/không (?:tìm )?thấy|không tìm được|ngoài phạm vi|chưa (?:được )?cấp phép/i.test(text)) return 'destination';
  if (/^(?:liệt kê|xem|đọc|tìm|cho (?:tôi|mình) xem)(?:\s|$)/i.test(request.trim()) || /chỉ (?:để )?(?:xem|đọc)|làm gì với danh sách/i.test(text)) return 'read-only';
  return null;
}
export function NoWritesNotice() {
  return <div className="mt-4 pt-3 border-t border-[#F3F4F6] flex items-center gap-2 text-xs text-[#6B7280]">
    <svg aria-hidden="true" className="w-4 h-4 text-[#16A34A] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
    <span>Chưa có gì được ghi lên công cụ nào.</span>
  </div>;
}
export function AnswerMoment({ message, request, services }: { message: ChatMessage; request: string; services: ServiceInfo[] }) {
  const [expanded, setExpanded] = useState(false);
  const lookups = message.metadata?.lookups ?? [];
  const directory = message.metadata?.usedDirectory ?? [];
  const serviceName = (id: string) => services.find(service => service.id === id)?.name ?? id;
  const names = [...new Set([...lookups.map(lookup => lookup.tool.split('.')[0]), ...directory])].map(serviceName);
  const source = [lookups.length ? `${lookups.length} lần tra cứu` : '', directory.length ? `Danh mục ${directory.map(serviceName).join(', ')}` : ''].filter(Boolean).join(' · ');
  const safeLink = (link: string) => { try { return new URL(link).protocol === 'https:'; } catch { return false; } };
  return <ResponseCard request={request} title="Câu trả lời" moment="answer">
    <p data-answer-text className="text-sm sm:text-base text-[#111827] leading-relaxed whitespace-pre-wrap break-words">{message.content}</p>
    <p className="text-xs sm:text-sm text-[#6B7280]">{source}{source ? ' · ' : ''}hãy kiểm lại ở {names.join(', ') || 'dịch vụ đã kết nối'}.</p>
    {lookups.length > 0 && <div>
      <button type="button" className={secondary} aria-expanded={expanded} aria-controls="answer-lookups" onClick={() => setExpanded(value => !value)}>Đã tra cứu</button>
      {expanded && <ul id="answer-lookups" className="mt-3 v3-space-y-3 text-xs sm:text-sm break-words">
        {lookups.map((lookup, index) => <li key={index} className="border border-[#E7E7E2] rounded-xl p-3">
          <p className="font-mono">{lookup.tool}</p>{lookup.query !== undefined && <p>{lookup.query}</p>}
          <p>{lookup.resultCount} kết quả</p>
          {lookup.links.filter(safeLink).map(link => <p key={link}><a className="text-[#FF5701] underline break-all" href={link} target="_blank" rel="noopener noreferrer">{link}</a></p>)}
        </li>)}
      </ul>}
    </div>}
  </ResponseCard>;
}
function ResponseCard({ request, title, children, moment }: { request: string; title: string; children: ReactNode; moment: string }) {
  return <section id={`moment-${moment}`} data-moment={moment} aria-label="Cockpit" className="v3-space-y-6">
    <div className="flex items-start justify-end gap-3">
      <div className="max-w-xl bg-white border border-[#E7E7E2] rounded-2xl rounded-tr-sm p-4 sm:p-5 shadow-sm min-w-0">
        <div className="flex items-center justify-between gap-4 mb-1.5 text-xs text-[#6B7280]"><span className="font-semibold text-[#111827]">Bạn</span><span className="text-[11px] text-[#9CA3AF]">Yêu cầu đã gửi</span></div>
        <p id="user-request-bubble-text" className="text-sm sm:text-base font-medium text-[#111827] leading-relaxed break-words">{request}</p>
      </div>
      <div aria-hidden="true" className="w-9 h-9 rounded-full bg-[#111827] text-white flex items-center justify-center text-xs font-bold flex-shrink-0 shadow-sm mt-0.5">B</div>
    </div>
    <div className="flex items-start gap-3">
      <div aria-hidden="true" className="w-9 h-9 rounded-xl bg-[#FF5701] text-white flex items-center justify-center font-display font-bold text-base shadow-sm flex-shrink-0 mt-0.5">A</div>
      <div className="flex-1 bg-white border border-[#E7E7E2] rounded-2xl rounded-tl-sm p-5 sm:p-7 shadow-sm v3-space-y-5 min-w-0">
        <div className="flex items-center justify-between text-xs text-[#6B7280] pb-2 border-b border-[#F3F4F6] gap-2 flex-wrap">
          <div className="flex items-center gap-2"><span className="font-semibold text-[#111827]">ATI</span><span className="text-[#9CA3AF]">·</span><span>Trợ lý điều phối</span></div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#F3F4F6] text-[#4B5563]"><span className="w-1.5 h-1.5 rounded-full bg-[#9CA3AF]" />Chưa lập kế hoạch</span>
        </div>
        <h1 id="response-card-title" tabIndex={-1} className="font-display font-bold text-2xl sm:text-3xl text-[#111827] tracking-tight focus:v3-outline-none focus:ring-2 focus:ring-[#FF5701]/20 rounded-lg break-words">{title}</h1>
        {children}<NoWritesNotice />
      </div>
    </div>
  </section>;
}
/** "A", "A và B", "A, B và C". */
const listOf = (names: string[]) => names.length > 1 ? `${names.slice(0, -1).join(', ')} và ${names[names.length - 1]}` : names[0] ?? '';

export function RefusalMoment({ message, request, services, canConfigure, navigate, onEdit, connectFromChat = false, conversationId, onResend, servicesLoading, onRefreshServices }: {
  message: ChatMessage; request: string; services: ServiceInfo[]; canConfigure: boolean;
  navigate: (path: string) => void; onEdit: (text: string) => void;
  /** OAUTH-01, only while GMAIL_ENABLED is on. Off, the screen stays as before: no reading again, no "Gửi lại yêu cầu". */
  connectFromChat?: boolean;
  /** The conversation on screen: connecting Gmail from here comes back to it (OAUTH-01). */
  conversationId?: string | null;
  /** Sends the request again as a new message, once every missing service can be used. */
  onResend?: (text: string) => void;
  servicesLoading?: boolean;
  /** Reads the services again: the list loaded with the page may be older than this refusal. */
  onRefreshServices?: () => void;
}) {
  const refresh = useRef(onRefreshServices);
  refresh.current = onRefreshServices;
  useEffect(() => { if (connectFromChat) refresh.current?.(); }, [message.id, connectFromChat]);
  const metadata = message.metadata;
  const legacy = message.content.replace(/^Từ chối yêu cầu:\s*/, '').split(/\nGợi ý:\s*/);
  const reason = metadata?.reason || legacy[0];
  const suggestion = metadata?.suggestion || legacy.slice(1).join('\n');
  const unavailable = metadata?.unavailableServices ?? [];
  const ids = new Set(unavailable.map(row => row.id));
  const relevant = services.filter(service => ids.has(service.id) || new RegExp(`(^|[^\\p{L}\\p{N}])${service.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}\\p{N}]|$)`, 'iu').test(request));
  const rows = [...relevant, ...unavailable.filter(row => !relevant.some(service => service.id === row.id)).map(row => ({ ...row, connected: false, configured: false, connectionStatus: 'unconfigured' as const }))];
  // What the refusal named may be usable by now: Gmail once this person connected it, a shared service once configured.
  const current = (id: string) => services.find(service => service.id === id);
  const usable = (id: string) => connectFromChat && (id === 'gmail' ? current(id)?.personalStatus === 'connected' : current(id)?.configured === true);
  const reconnect = connectFromChat && current('gmail')?.personalStatus === 'reconnect_required';
  const missing = unavailable.filter(row => !usable(row.id));
  const resend = unavailable.length > 0 && missing.length === 0 && !servicesLoading && onResend;
  const hasGmail = missing.some(row => row.id === 'gmail');
  const shared = missing.filter(row => row.id !== 'gmail');
  const path = shared.length === 1 ? `/settings#${encodeURIComponent(shared[0].id)}` : '/settings';
  const back = conversationId ? conversationReturnPath(`/c/${conversationId}`) : null;
  const [starting, setStarting] = useState(false), [startError, setStartError] = useState('');
  const pending = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const connectGmail = async (returnTo: string) => {
    if (pending.current) return;
    const owns = gmailSessionOwner(); pending.current = true; setStarting(true); setStartError('');
    try {
      const { url } = await apiClient.startGmailConnection({ returnTo });
      if (mounted.current && owns()) redirectToGmail(url);
    } catch { if (mounted.current && owns()) setStartError('Không thể bắt đầu kết nối Gmail. Hãy kiểm tra mạng và thử lại.'); }
    finally { pending.current = false; if (mounted.current) setStarting(false); }
  };
  return <ResponseCard request={request} title={unavailable.length ? 'Tôi chưa làm được yêu cầu này' : 'Việc này tôi chưa làm được'} moment="refusal">
    <div id={`scenario-content-${unavailable.length ? 1 : 2}`} className="scenario-panel v3-space-y-5">
      <div className="p-3.5 sm:p-4 rounded-xl bg-[#F8F8F6] border border-[#E7E7E2] text-sm text-[#111827] font-medium flex items-start gap-3">
        <svg aria-hidden="true" className="w-5 h-5 text-[#FF5701] flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
        <div className="v3-space-y-1 min-w-0"><p className="text-sm font-semibold text-[#111827] whitespace-pre-wrap break-words">{reason}</p>{suggestion && <p className="text-xs sm:text-sm text-[#4B5563] leading-relaxed whitespace-pre-wrap break-words">{suggestion}</p>}</div>
      </div>
      {unavailable.length > 0 && <div>
        <p className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-2">Trạng thái các dịch vụ trong yêu cầu này</p>
        <div id="s1-services-list" aria-label="Trạng thái các dịch vụ trong yêu cầu này" className="v3-space-y-2">
          {rows.map(service => {
            const status = ids.has(service.id) && !usable(service.id) ? 'unconfigured' : service.connectionStatus ?? (service.configured ? 'unchecked' : 'unconfigured');
            const gmailConnected = service.id === 'gmail' && usable('gmail');
            const good = gmailConnected || status === 'healthy';
            return <div key={service.id} className="flex items-center justify-between p-3 rounded-xl bg-white border border-[#E7E7E2] shadow-sm gap-2 flex-wrap">
              <div className="flex items-center gap-3 min-w-0"><div className="w-8 h-8 rounded-lg bg-neutral-50 border border-neutral-100 flex items-center justify-center flex-shrink-0"><ServiceLogo service={service.id} className="w-5 h-5 flex-shrink-0" /></div><span className="text-xs sm:text-sm font-semibold text-[#111827] break-words">{service.name}</span></div>
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium min-w-0 break-all ${good ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-neutral-100 text-neutral-600 border border-neutral-200'}`}><span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${good ? 'bg-emerald-500' : 'bg-neutral-400'}`} /><span>{gmailConnected ? `Đã kết nối${current('gmail')?.email ? ` · ${current('gmail')!.email}` : ''}` : service.id === 'gmail' && reconnect ? 'Cần kết nối lại' : labels[status]}</span></span>
            </div>;
          })}
        </div>
      </div>}
      {resend && <p role="status" className="text-sm text-[#111827] break-words">{listOf(unavailable.map(row => row.name))} đã được kết nối. Bạn có thể gửi lại yêu cầu.</p>}
      {startError && <p role="alert" className="text-sm text-danger-text break-words">{startError}</p>}
      <div className="pt-2 border-t border-[#F3F4F6] flex flex-wrap items-center gap-3" id="s1-action-area">
        {resend && <button type="button" onClick={() => onResend(request)} className={primary}>Gửi lại yêu cầu</button>}
        {/* A plain link keeps opening the settings page in a new tab; a normal click goes straight to Google and back here. */}
        {hasGmail && <a href="/settings#gmail" aria-disabled={starting || undefined} onClick={event => {
          if (connectFromChat && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)) return;
          event.preventDefault();
          if (connectFromChat && back) void connectGmail(back); else navigate('/settings#gmail');
        }} className={`${primary} flex items-center gap-1.5`}>{reconnect ? 'Kết nối lại Gmail' : 'Kết nối Gmail'}<span aria-hidden="true">→</span></a>}
        {shared.length > 0 && (canConfigure ? <a href={path} onClick={event => { event.preventDefault(); navigate(path); }} className={`${primary} flex items-center gap-1.5`}>{shared.length === 1 ? `Kết nối ${shared[0].name}` : 'Kết nối dịch vụ'}<span aria-hidden="true">→</span></a> : <p className="text-xs sm:text-sm text-[#4B5563] leading-relaxed">Chỉ quản trị viên kết nối được dịch vụ mới. Bạn hãy báo quản trị viên của nhóm.</p>)}
        {!unavailable.length && suggestion && <button type="button" onClick={() => onEdit(suggestion)} className={primary}>Thử: {suggestion}</button>}
        <button type="button" onClick={() => onEdit(request)} className={secondary}>Sửa yêu cầu</button>
      </div>
    </div>
  </ResponseCard>;
}
export function ExpandedClarificationMoment({ clarification, variant, request, services, canConfigure, selected, onSelect, onSend, onEdit, navigate, planning }: {
  clarification: ClarificationState; variant: 'read-only' | 'destination'; request: string; services: ServiceInfo[];
  canConfigure: boolean; selected: string | null; onSelect: (value: string) => void; onSend: (value: string) => void;
  onEdit: (value: string) => void; navigate: (path: string) => void; planning: boolean;
}) {
  const mentioned = services.filter(service => `${request} ${clarification.context ?? ''} ${clarification.question}`.toLocaleLowerCase().includes(service.name.toLocaleLowerCase()));
  const path = mentioned.length === 1 ? `/settings#${encodeURIComponent(mentioned[0].id)}` : '/settings';
  return <ResponseCard request={request} title={clarification.question} moment="3">
    <div id={`scenario-content-${variant === 'read-only' ? 3 : 4}`} className="scenario-panel v3-space-y-5">
      {clarification.context && <p className="text-xs sm:text-sm text-[#4B5563] leading-relaxed whitespace-pre-wrap break-words">{clarification.context}</p>}
      <div className="v3-space-y-2" role="radiogroup" aria-label={clarification.question} onKeyDown={event => {
        if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
        const radios = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
        if (!radios.length) return;
        event.preventDefault(); const index = radios.indexOf(event.target as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? radios.length - 1 : (index + (['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1) + radios.length) % radios.length;
        onSelect(clarification.options[next]); radios[next].focus();
      }}>
        {clarification.options.map((option, index) => <button key={`${index}:${option}`} type="button" role="radio" aria-checked={selected === option} tabIndex={selected === option || (!selected && index === 0) ? 0 : -1} onClick={() => onSelect(option)} className={variant === 'destination' ? 'inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-[#FF5701] hover:bg-[#E04D00] text-white text-xs sm:text-sm font-semibold shadow-sm transition-all' : `w-full text-left p-3.5 rounded-xl border ${selected === option ? 'border-[#FF5701]' : 'border-[#E7E7E2]'} hover:border-[#FF5701] hover:bg-[#FF5701]/5 bg-white transition-all flex items-center justify-between group shadow-sm gap-3`}>
          <div className="flex items-center gap-3 min-w-0"><div aria-hidden="true" className={variant === 'destination' ? 'w-5 h-5 bg-white rounded p-0.5 flex items-center justify-center flex-shrink-0' : 'w-8 h-8 rounded-lg bg-neutral-100 flex items-center justify-center flex-shrink-0'}><svg className="w-5 h-5 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M8 10h8m-8 4h5M6 3h9l3 3v15H6z" /></svg></div><span className={variant === 'destination' ? 'break-words' : 'text-xs sm:text-sm font-semibold text-[#111827] group-hover:text-[#FF5701] transition-colors break-words'}>{option}</span></div>
          {variant === 'destination' && selected === option && <span aria-hidden="true" className="text-[11px] font-semibold flex-shrink-0">Đã chọn</span>}
          {variant !== 'destination' && <svg aria-hidden="true" className="w-4 h-4 text-[#9CA3AF] group-hover:text-[#FF5701] transition-colors flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>}
        </button>)}
      </div>
      {variant === 'destination' && <div className="p-3.5 rounded-xl bg-[#F8F8F6] border border-[#E7E7E2] text-xs sm:text-sm text-[#4B5563]" id="s4-role-subline">
        {canConfigure ? <p>Nơi bạn cần chưa có trong danh sách? <a href={path} onClick={event => { event.preventDefault(); navigate(path); }} className="font-medium text-[#FF5701] hover:underline underline-offset-2">Thêm ở Kết nối dịch vụ{mentioned.length === 1 ? ` → ${mentioned[0].name}` : ''} →</a></p> : <p>Nơi bạn cần chưa có trong danh sách? Hãy báo quản trị viên thêm vào.</p>}
      </div>}
      <div className="pt-2 border-t border-[#F3F4F6] flex flex-wrap items-center gap-3">
        {clarification.options.length > 0 && <button type="button" disabled={!selected || planning} onClick={() => selected && onSend(selected)} className={primary}>Xác nhận và tiếp tục</button>}
        <button type="button" onClick={() => onEdit(request)} className={secondary}>Sửa yêu cầu</button>
      </div>
    </div>
  </ResponseCard>;
}
