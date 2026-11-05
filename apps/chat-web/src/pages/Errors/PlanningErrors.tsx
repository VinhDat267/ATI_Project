// Structure/classes ported from PROTO-01 ErrorsPage; progress is supplied by the server.
import { getServiceDefinition } from '@wap/tool-schemas';
import { toolDefinition } from '../../services/tool-definitions';
import type { GatherState, ServiceInfo } from '../../types';
import { RequestEcho, useScheduledOrigin } from '../Cockpit/RequestEcho';
const primary = 'w-full sm:w-auto px-4 py-2.5 rounded-xl bg-[var(--planora-primary)] hover:bg-[var(--planora-primary-hover)] text-[var(--planora-on-primary)] text-xs font-semibold shadow-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer';
const secondary = 'w-full sm:w-auto px-4 py-2.5 rounded-xl bg-[var(--planora-paper)] hover:bg-[var(--planora-surface-hover)] text-[var(--planora-text)] text-xs font-medium border border-[var(--planora-divider)] shadow-xs transition-colors cursor-pointer';
export const latePlanNotice = 'Nếu kế hoạch đến sau, nó vẫn nằm trong hội thoại và chưa chạy cho tới khi bạn duyệt.';
function ErrorIcon({ slow = false }: { slow?: boolean }) {
  return <svg aria-hidden="true" className={`w-6 h-6${slow ? ' animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={slow ? 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' : 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z'} /></svg>;
}
function PlanningSafetyNotice({ slow = false }: { slow?: boolean }) {
  return <div className={slow ? 'p-3 bg-[var(--planora-surface-inset)] rounded-xl text-xs text-[var(--planora-muted)] flex items-center gap-2 border border-[var(--planora-divider)]' : 'p-4 bg-[var(--planora-success-bg)] rounded-xl border border-[var(--planora-success-border)] text-[var(--planora-success-text)] v3-space-y-2'}>
    <svg aria-hidden="true" className="w-4 h-4 text-[var(--planora-success-text)] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
    <p className={slow ? '' : 'text-xs text-[var(--planora-success-text)] leading-relaxed'}><strong>Chưa có gì được ghi lên công cụ nào.</strong>{slow && ' Hệ thống chỉ mới đang ở bước đọc thông tin để lên kế hoạch.'}</p>
  </div>;
}
export function SlowPlanningMoment({ request, seconds, gather, services, onDismiss }: { request?: string; seconds: number; gather: GatherState | null; services: ServiceInfo[]; onDismiss: () => void }) {
  return <section id="view-timeout" data-moment="2" aria-label="Cockpit" className="v3-space-y-6">
    <div className="bg-[var(--planora-paper)] rounded-2xl border border-[var(--planora-divider)] p-6 sm:p-8 shadow-xs max-w-2xl mx-auto v3-space-y-6">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-[var(--planora-pending-bg)] text-[var(--planora-pending-text)] flex items-center justify-center flex-shrink-0 border border-[var(--planora-pending-border)]"><ErrorIcon slow /></div>
        <div className="v3-space-y-1.5 flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap"><span className="px-2 py-0.5 rounded text-[11px] font-bold bg-[var(--planora-pending-bg)] text-[var(--planora-pending-text)] uppercase tracking-wide">Đang lập kế hoạch</span><span className="text-xs font-mono text-[var(--planora-pending-text)] font-bold">Thời gian chờ: <span id="timer-seconds-display">{seconds}</span>s</span></div>
          <RequestEcho request={request} />
          <h1 tabIndex={-1} className="font-display font-bold text-xl sm:text-2xl text-[var(--planora-text)]">Planora đang suy nghĩ lâu hơn thường lệ</h1>
          <p className="text-sm text-[var(--planora-muted)] leading-relaxed">Planora chưa lập xong kế hoạch. Tiến trình bên dưới là thông tin máy chủ đã gửi.</p>
        </div>
      </div>
      <div className="p-4 bg-[var(--planora-surface-inset)] rounded-xl border border-[var(--planora-divider)] v3-space-y-3">
        <p className="text-xs font-semibold text-[var(--planora-text)]">Tiến trình tra cứu hiện tại:</p>
        {gather?.summary && <p className="text-xs text-[var(--planora-muted)] break-words">{gather.summary}</p>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          {gather?.steps.map((step, index) => {
            const id = toolDefinition(step.tool)?.service ?? step.tool.split('.')[0];
            return <div key={`${step.tool}:${index}`} className={`p-2.5 rounded-lg ${step.status === 'running' ? 'bg-[var(--planora-pending-bg)]/50 border-[var(--planora-pending-border)]' : 'bg-[var(--planora-paper)] border-[var(--planora-divider)]'} border flex items-center justify-between gap-2 flex-wrap`}>
              <span className="break-words text-[var(--planora-text)]">{services.find(row => row.id === id)?.name ?? getServiceDefinition(id)?.name ?? id}{step.result && <span className="block mt-1 text-[var(--planora-muted)]">{step.result}</span>}</span>
              <span className={`${step.status === 'completed' ? 'text-[var(--planora-success-text)]' : 'text-[var(--planora-pending-text)]'} font-medium`}>{step.status === 'completed' ? '✓ Đã tra cứu' : 'Đang chờ phản hồi…'}</span>
            </div>;
          })}
          {!gather?.steps.length && <p className="text-[var(--planora-muted)]">Chưa có tiến trình tra cứu được gửi từ máy chủ.</p>}
        </div>
      </div>
      <PlanningSafetyNotice slow />
      <div className="v3-space-y-2.5 pt-2"><div className="flex flex-col sm:flex-row items-center gap-3"><button type="button" onClick={onDismiss} className={secondary}>Thôi chờ, giữ lại câu yêu cầu</button></div><p className="text-[11px] text-[var(--planora-muted)]">{latePlanNotice}</p></div>
    </div>
  </section>;
}
export function PlanningErrorMoment({ request, networkError = false, onRetry, onEdit }: { request: string; networkError?: boolean; onRetry: () => void; onEdit: () => void }) {
  const origin = useScheduledOrigin();
  const label = networkError ? 'Mất kết nối' : 'Sự cố máy chủ';
  const title = networkError ? 'Mất kết nối máy chủ' : 'Sự cố máy chủ';
  return <section id="view-server" data-moment="1" aria-label="Cockpit" className="v3-space-y-6">
    <div className="bg-[var(--planora-paper)] rounded-2xl border border-[var(--planora-error-border)] p-6 sm:p-8 shadow-xs max-w-2xl mx-auto v3-space-y-6">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-[var(--planora-error-bg)] text-[var(--planora-error-text)] flex items-center justify-center flex-shrink-0 border border-[var(--planora-error-border)]"><ErrorIcon /></div>
        <div className="v3-space-y-1.5 flex-1 min-w-0"><div className="flex items-center gap-2 flex-wrap"><span className="px-2 py-0.5 rounded text-[11px] font-bold bg-[var(--planora-error-bg)] text-[var(--planora-error-text)] uppercase tracking-wide">{label}</span></div><h1 tabIndex={-1} className="font-display font-bold text-xl sm:text-2xl text-[var(--planora-text)]">{title}</h1><p role="alert" className="text-sm text-[var(--planora-muted)] leading-relaxed">{networkError ? 'Không thể kết nối máy chủ. Hãy kiểm tra mạng và thử lại.' : 'Không thể lập kế hoạch lúc này. Hãy thử lại.'}</p></div>
      </div>
      <PlanningSafetyNotice />
      {origin ? <RequestEcho request={request} /> : request && <div className="v3-space-y-1.5"><div className="flex items-center justify-between text-xs text-[var(--planora-muted)]"><span>Câu yêu cầu của bạn:</span></div><div id="failed-prompt-text" className="p-3 bg-[var(--planora-surface-inset)] rounded-xl border border-[var(--planora-divider)] text-xs sm:text-sm text-[var(--planora-text)] break-words whitespace-pre-wrap">{request}</div></div>}
      {!origin && <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">{request && <button type="button" onClick={onRetry} className={primary}>Thử lại</button>}<button type="button" onClick={onEdit} className={secondary}>Sửa yêu cầu</button></div>}
    </div>
  </section>;
}
export function OfflineBanner({ busy, onRetry }: { busy: boolean; onRetry: () => void }) {
  return <aside id="network-offline-banner" role="status" className="w-full bg-[var(--planora-pending-bg)] text-[var(--planora-pending-text)] border-b border-[var(--planora-pending-border)] px-4 py-2 text-xs sm:text-sm font-medium transition-all z-50 shadow-xs">
    <div className="max-w-4xl mx-auto flex items-center justify-between gap-3"><div className="flex items-center gap-2 min-w-0">
      <svg aria-hidden="true" className="w-4 h-4 animate-pulse flex-shrink-0 text-[var(--planora-pending-text)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 4.243a9 9 0 01-12.728 0m0 0l2.829-2.829m-2.829 2.829L3 21M8.464 15.536a5 5 0 010-7.072m0 0l2.829 2.829" /></svg>
      <span>Mất kết nối. Hãy kiểm tra mạng và thử lại.</span></div><button type="button" disabled={busy} onClick={onRetry} className="underline hover:opacity-80 flex-shrink-0 text-xs font-semibold cursor-pointer text-[var(--planora-pending-text)]">{busy ? 'Đang kiểm tra…' : 'Thử lại'}</button>
    </div>
  </aside>;
}
