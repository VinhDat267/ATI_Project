// Structure/classes ported from PROTO-01 ErrorsPage; progress is supplied by the server.
import { getServiceDefinition, getToolDefinition } from '@wap/tool-schemas';
import type { GatherState, ServiceInfo } from '../../types';
const primary = 'w-full sm:w-auto px-4 py-2.5 rounded-xl bg-[#FF5701] hover:bg-[#e04d00] text-white text-xs font-semibold shadow-sm transition-colors flex items-center justify-center gap-1.5';
const secondary = 'w-full sm:w-auto px-4 py-2.5 rounded-xl bg-white hover:bg-neutral-50 text-[#111827] text-xs font-medium border border-[#E7E7E2] transition-colors';
export const latePlanNotice = 'Nếu kế hoạch đến sau, nó vẫn nằm trong hội thoại và chưa chạy cho tới khi bạn duyệt.';
function ErrorIcon({ slow = false }: { slow?: boolean }) {
  return <svg aria-hidden="true" className={`w-6 h-6${slow ? ' animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={slow ? 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' : 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z'} /></svg>;
}
function PlanningSafetyNotice({ slow = false }: { slow?: boolean }) {
  return <div className={slow ? 'p-3 bg-neutral-100 rounded-xl text-xs text-[#6B7280] flex items-center gap-2' : 'p-4 bg-emerald-50 rounded-xl border border-emerald-200 v3-space-y-2'}>
    <svg aria-hidden="true" className="w-4 h-4 text-emerald-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
    <p className={slow ? '' : 'text-xs text-emerald-800 leading-relaxed'}><strong>Chưa có gì được ghi lên công cụ nào.</strong>{slow && ' Hệ thống chỉ mới đang ở bước đọc thông tin để lên kế hoạch.'}</p>
  </div>;
}
export function SlowPlanningMoment({ seconds, gather, services, onDismiss }: { seconds: number; gather: GatherState | null; services: ServiceInfo[]; onDismiss: () => void }) {
  return <section id="view-timeout" data-moment="2" aria-label="Cockpit" className="v3-space-y-6">
    <div className="bg-white rounded-2xl border border-[#E7E7E2] p-6 sm:p-8 shadow-soft max-w-2xl mx-auto v3-space-y-6">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-orange-50 text-[#FF5701] flex items-center justify-center flex-shrink-0 border border-orange-200"><ErrorIcon slow /></div>
        <div className="v3-space-y-1.5 flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap"><span className="px-2 py-0.5 rounded text-[11px] font-bold bg-orange-100 text-orange-800 uppercase tracking-wide">Đang lập kế hoạch</span><span className="text-xs font-mono text-[#FF5701] font-bold">Thời gian chờ: <span id="timer-seconds-display">{seconds}</span>s</span></div>
          <h1 tabIndex={-1} className="font-display font-bold text-xl sm:text-2xl text-[#111827]">ATI đang suy nghĩ lâu hơn thường lệ</h1>
          <p className="text-sm text-[#4B5563] leading-relaxed">ATI chưa lập xong kế hoạch. Tiến trình bên dưới là thông tin máy chủ đã gửi.</p>
        </div>
      </div>
      <div className="p-4 bg-[#F8F8F6] rounded-xl border border-[#E7E7E2] v3-space-y-3">
        <p className="text-xs font-semibold text-[#111827]">Tiến trình tra cứu hiện tại:</p>
        {gather?.summary && <p className="text-xs text-[#4B5563] break-words">{gather.summary}</p>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          {gather?.steps.map((step, index) => {
            const id = getToolDefinition(step.tool)?.service ?? step.tool.split('.')[0];
            return <div key={`${step.tool}:${index}`} className={`p-2.5 rounded-lg ${step.status === 'running' ? 'bg-orange-50 border-orange-200' : 'bg-white border-[#E7E7E2]'} border flex items-center justify-between gap-2 flex-wrap`}>
              <span className="break-words">{services.find(row => row.id === id)?.name ?? getServiceDefinition(id)?.name ?? id}{step.result && <span className="block mt-1">{step.result}</span>}</span>
              <span className={`${step.status === 'completed' ? 'text-emerald-600' : 'text-orange-700'} font-medium`}>{step.status === 'completed' ? '✓ Đã tra cứu' : 'Đang chờ phản hồi…'}</span>
            </div>;
          })}
          {!gather?.steps.length && <p className="text-[#6B7280]">Chưa có tiến trình tra cứu được gửi từ máy chủ.</p>}
        </div>
      </div>
      <PlanningSafetyNotice slow />
      <div className="v3-space-y-2.5 pt-2"><div className="flex flex-col sm:flex-row items-center gap-3"><button type="button" onClick={onDismiss} className={secondary}>Thôi chờ, giữ lại câu yêu cầu</button></div><p className="text-[11px] text-[#6B7280]">{latePlanNotice}</p></div>
    </div>
  </section>;
}
export function PlanningErrorMoment({ request, onRetry, onEdit }: { request: string; onRetry: () => void; onEdit: () => void }) {
  return <section id="view-server" data-moment="1" aria-label="Cockpit" className="v3-space-y-6">
    <div className="bg-white rounded-2xl border border-red-200 p-6 sm:p-8 shadow-soft max-w-2xl mx-auto v3-space-y-6">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-red-50 text-red-600 flex items-center justify-center flex-shrink-0 border border-red-200"><ErrorIcon /></div>
        <div className="v3-space-y-1.5 flex-1 min-w-0"><div className="flex items-center gap-2 flex-wrap"><span className="px-2 py-0.5 rounded text-[11px] font-bold bg-red-100 text-red-800 uppercase tracking-wide">Sự cố máy chủ</span></div><h1 tabIndex={-1} className="font-display font-bold text-xl sm:text-2xl text-[#111827]">Sự cố máy chủ</h1><p role="alert" className="text-sm text-[#4B5563] leading-relaxed">Không thể lập kế hoạch lúc này. Hãy thử lại.</p></div>
      </div>
      <PlanningSafetyNotice />
      {request && <div className="v3-space-y-1.5"><div className="flex items-center justify-between text-xs text-[#6B7280]"><span>Câu yêu cầu của bạn:</span></div><div id="failed-prompt-text" className="p-3 bg-[#F8F8F6] rounded-xl border border-[#E7E7E2] text-xs font-mono text-[#111827] break-words whitespace-pre-wrap">{request}</div></div>}
      <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">{request && <button type="button" onClick={onRetry} className={primary}>Thử lại</button>}<button type="button" onClick={onEdit} className={secondary}>Sửa yêu cầu</button></div>
    </div>
  </section>;
}
export function OfflineBanner({ busy, onRetry }: { busy: boolean; onRetry: () => void }) {
  return <aside id="network-offline-banner" role="status" className="w-full bg-amber-500 text-white px-4 py-2 text-xs sm:text-sm font-medium transition-all z-50">
    <div className="max-w-4xl mx-auto flex items-center justify-between gap-3"><div className="flex items-center gap-2 min-w-0">
      <svg aria-hidden="true" className="w-4 h-4 animate-pulse flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 4.243a9 9 0 01-12.728 0m0 0l2.829-2.829m-2.829 2.829L3 21M8.464 15.536a5 5 0 010-7.072m0 0l2.829 2.829" /></svg>
      <span>Mất kết nối. Hãy kiểm tra mạng và thử lại.</span></div><button type="button" disabled={busy} onClick={onRetry} className="underline hover:text-amber-100 flex-shrink-0 text-xs">{busy ? 'Đang kiểm tra…' : 'Thử lại'}</button>
    </div>
  </aside>;
}
