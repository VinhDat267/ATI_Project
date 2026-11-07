// Structure/classes ported from PROTO-01 ErrorsPage; progress is supplied by the server.
import { getServiceDefinition } from '@wap/tool-schemas';
import { toolDefinition } from '../../services/tool-definitions';
import type { GatherState, ServiceInfo } from '../../types';
import { RequestEcho, useScheduledOrigin } from '../Cockpit/RequestEcho';
const primary = 'w-full sm:w-auto px-4 py-2.5 rounded-xl bg-[#C84300] hover:bg-[#A83800] text-white text-xs font-semibold shadow-sm transition-colors flex items-center justify-center gap-1.5';
const secondary = 'w-full sm:w-auto px-4 py-2.5 rounded-xl bg-white hover:bg-neutral-50 text-[#111827] text-xs font-medium border border-[#E5E5E0] transition-colors';
export const latePlanNotice = 'Nếu kế hoạch đến sau, nó vẫn nằm trong hội thoại và chưa chạy cho tới khi bạn duyệt.';
function ErrorIcon({ slow = false }: { slow?: boolean }) {
  return <svg aria-hidden="true" className={`w-5 h-5${slow ? ' animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={slow ? 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' : 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z'} /></svg>;
}
function PlanningSafetyNotice({ slow = false }: { slow?: boolean }) {
  return <div className={slow ? 'p-3 bg-[#F8F8F6] border border-[#EAEAE4] rounded-xl text-xs text-[#4B5563] flex items-center gap-2' : 'p-3.5 bg-emerald-50 rounded-xl border border-emerald-200 flex items-center gap-2'}>
    <svg aria-hidden="true" className="w-4 h-4 text-emerald-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
    <p className={slow ? '' : 'text-xs text-emerald-900 leading-relaxed'}><strong>Chưa có gì được ghi lên công cụ nào.</strong>{slow && ' Hệ thống chỉ mới đang ở bước đọc thông tin để lên kế hoạch.'}</p>
  </div>;
}
export function SlowPlanningMoment({ request, seconds, gather, services, onDismiss }: { request?: string; seconds: number; gather: GatherState | null; services: ServiceInfo[]; onDismiss: () => void }) {
  return <section id="view-timeout" data-moment="2" aria-label="Cockpit" className="w-full max-w-3xl mx-auto">
    <div className="bg-white rounded-2xl border border-[#E5E5E0] shadow-sm overflow-hidden">
      <div className="px-5 sm:px-6 py-3 bg-[#F8F8F6] border-b border-[#EAEAE4] flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 font-semibold text-[#B43E00]">
          <ErrorIcon slow />
          <span>Đang lập kế hoạch</span>
        </span>
        <span className="font-mono text-[#B43E00] font-semibold">Thời gian chờ: <span id="timer-seconds-display">{seconds}</span>s</span>
      </div>
      <div className="p-5 sm:p-6 v3-space-y-5">
        <div className="v3-space-y-1 min-w-0">
          <RequestEcho request={request} />
          <h1 tabIndex={-1} className="font-sans font-semibold text-xl sm:text-2xl tracking-tight text-[#111827]">Planora đang suy nghĩ lâu hơn thường lệ</h1>
          <p className="text-sm text-[#4B5563] leading-relaxed">Planora chưa lập xong kế hoạch. Tiến trình bên dưới là thông tin máy chủ đã gửi.</p>
        </div>
        <div className="p-4 bg-[#F8F8F6] rounded-xl border border-[#EAEAE4] v3-space-y-3">
          <p className="text-xs font-semibold text-[#111827]">Tiến trình tra cứu hiện tại:</p>
          {gather?.summary && <p className="text-xs text-[#4B5563] break-words">{gather.summary}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            {gather?.steps.map((step, index) => {
              const id = toolDefinition(step.tool)?.service ?? step.tool.split('.')[0];
              return <div key={`${step.tool}:${index}`} className={`p-2.5 rounded-lg ${step.status === 'running' ? 'bg-[#FFF6EE] border-[#F7D7BE]' : 'bg-white border-[#E5E5E0]'} border flex items-center justify-between gap-2 flex-wrap`}>
                <span className="break-words text-[#111827] font-medium">{services.find(row => row.id === id)?.name ?? getServiceDefinition(id)?.name ?? id}{step.result && <span className="block mt-1 font-normal text-[#4B5563]">{step.result}</span>}</span>
                <span className={`${step.status === 'completed' ? 'text-emerald-700' : 'text-[#B43E00]'} font-semibold`}>{step.status === 'completed' ? '✓ Đã tra cứu' : 'Đang chờ phản hồi…'}</span>
              </div>;
            })}
            {!gather?.steps.length && <p className="text-[#6B7280]">Chưa có tiến trình tra cứu được gửi từ máy chủ.</p>}
          </div>
        </div>
        <PlanningSafetyNotice slow />
      </div>
      <div className="px-5 sm:px-6 py-4 bg-[#F8F8F6] border-t border-[#EAEAE4] v3-space-y-2"><div className="flex flex-col sm:flex-row items-center gap-3"><button type="button" onClick={onDismiss} className={secondary}>Thôi chờ, giữ lại câu yêu cầu</button></div><p className="text-xs text-[#6B7280]">{latePlanNotice}</p></div>
    </div>
  </section>;
}
export function PlanningErrorMoment({ request, networkError = false, onRetry, onEdit }: { request: string; networkError?: boolean; onRetry: () => void; onEdit: () => void }) {
  const origin = useScheduledOrigin();
  const label = networkError ? 'Mất kết nối' : 'Sự cố máy chủ';
  const title = networkError ? 'Mất kết nối máy chủ' : 'Sự cố máy chủ';
  return <section id="view-server" data-moment="1" aria-label="Cockpit" className="w-full max-w-3xl mx-auto">
    <div className="bg-white rounded-2xl border border-[#E5E5E0] shadow-sm overflow-hidden">
      <div className="px-5 sm:px-6 py-3 bg-red-50/70 border-b border-red-200/80 flex items-center gap-2 text-xs font-semibold text-red-800">
        <ErrorIcon />
        <span>{label}</span>
      </div>
      <div className="p-5 sm:p-6 v3-space-y-5">
        <div className="v3-space-y-1 min-w-0"><h1 tabIndex={-1} className="font-sans font-semibold text-xl sm:text-2xl tracking-tight text-[#111827]">{title}</h1><p role="alert" className="text-sm text-[#4B5563] leading-relaxed">{networkError ? 'Không thể kết nối máy chủ. Hãy kiểm tra mạng và thử lại.' : 'Không thể lập kế hoạch lúc này. Hãy thử lại.'}</p></div>
        <PlanningSafetyNotice />
        {origin ? <RequestEcho request={request} /> : request && <div className="v3-space-y-1.5"><div className="flex items-center justify-between text-xs font-medium text-[#6B7280]"><span>Câu yêu cầu của bạn:</span></div><div id="failed-prompt-text" className="p-3 bg-[#F8F8F6] rounded-xl border border-[#E5E5E0] text-xs font-mono text-[#111827] break-words whitespace-pre-wrap">{request}</div></div>}
      </div>
      {!origin && <div className="px-5 sm:px-6 py-4 bg-[#F8F8F6] border-t border-[#EAEAE4] flex flex-col sm:flex-row items-center gap-2.5">{request && <button type="button" onClick={onRetry} className={primary}>Thử lại</button>}<button type="button" onClick={onEdit} className={secondary}>Sửa yêu cầu</button></div>}
    </div>
  </section>;
}
export function OfflineBanner({ busy, onRetry }: { busy: boolean; onRetry: () => void }) {
  return <aside id="network-offline-banner" role="status" className="w-full bg-amber-800 text-white px-4 py-2 text-xs sm:text-sm font-medium transition-all z-50">
    <div className="max-w-4xl mx-auto flex items-center justify-between gap-3"><div className="flex items-center gap-2 min-w-0">
      <svg aria-hidden="true" className="w-4 h-4 animate-pulse flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 4.243a9 9 0 01-12.728 0m0 0l2.829-2.829m-2.829 2.829L3 21M8.464 15.536a5 5 0 010-7.072m0 0l2.829 2.829" /></svg>
      <span>Mất kết nối. Hãy kiểm tra mạng và thử lại.</span></div><button type="button" disabled={busy} onClick={onRetry} className="underline hover:text-amber-100 flex-shrink-0 text-xs">{busy ? 'Đang kiểm tra…' : 'Thử lại'}</button>
    </div>
  </aside>;
}
