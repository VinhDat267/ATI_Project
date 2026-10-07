import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { getToolDefinition } from '@wap/tool-schemas';
import presentation from '../assets/cockpit-services.json';
import { useChatStore } from '../store/chat-store';
import { selectMoment } from '../services/cockpit-moment';
import type { PlanStep, ServiceInfo, User } from '../types';
import { ChatContainer } from './ChatContainer';
import { SidebarHistory } from './layout/SidebarHistory';
import { ServiceLogo } from './ServiceLogo';
import { CockpitDialog } from './CockpitDialog';
import { ExecutionProgress } from './ExecutionProgress';
import { ExecutionReceipt } from './ExecutionReceipt';
import { PlanStepItem, formatArgValue } from './PlanStepItem';

import { usePrototypePage } from '../prototype/usePrototypePage';
import { meta } from '../pages/Cockpit/meta';
import { CockpitHeader } from '../pages/Cockpit/CockpitHeader';
import { RequestMoment, DiscoveryMoment } from '../pages/Cockpit/RequestMoments';
import { ClarificationMoment } from '../pages/Cockpit/ClarificationMoment';

interface Props {
  user?: User | null; onLogout?: () => void; navigate?: (path: string) => void;
  services: ServiceInfo[]; servicesLoading: boolean; servicesError: string | null;
  onSendMessage: (text: string) => void; onNewConversation: () => void;
  onSelectConversation: (id: string) => void; onSettings: () => void;
  onApprove: () => void; onCancel: () => void; recovery: ReactNode;
  contentOverride?: ReactNode;
}
const prompts: Record<string,string> = Object.fromEntries(Object.entries(presentation.services).map(([id, asset]) => [id, asset.prompt]));
export function resourceDestination(step: PlanStep, labels: Record<string, string> = {}): string {
  const definition = getToolDefinition(step.tool);
  const resourceNames = presentation.resourceNames as Record<string,string>;
  return Object.entries(step.args).filter(([key]) => definition?.inputSchema.properties?.[key]?.['x-resource']).map(([key, value]) => {
    if ((typeof value === 'string' || typeof value === 'number') && Object.hasOwn(labels, String(value))) return labels[String(value)];
    const reference = value && typeof value === 'object' && '$ref' in value ? String(value.$ref) : typeof value === 'string' && value.startsWith('$step_') ? value : null;
    const number = reference?.match(/step_(\d+)/)?.[1];
    if (number) return `Kết quả của bước ${number}`;
    if (typeof value === 'string' && (value.startsWith('#') || (key === 'repo' && value.includes('/')))) return value;
    const resource = definition?.inputSchema.properties?.[key]?.['x-resource'];
    return `${resourceNames[String(resource)] ?? 'Nơi được chọn'} · chưa có tên trong dữ liệu`;
  }).join(' · ') || 'Trong phạm vi dịch vụ đã thiết lập';
}
function servicePrompt(service: ServiceInfo): string { return (prompts[service.id] ?? 'Mô tả công việc với {service}').replace('{service}',service.name); }
export function Cockpit(props: Props) {
  usePrototypePage(meta);
  const state = useChatStore();
  const moment = selectMoment(state, state.executionSnapshot);
  const [drawer, setDrawer] = useState<'history' | 'conversation' | null>(null);
  const [preview, setPreview] = useState<PlanStep | null>(null);
  const [draft, setDraft] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const stage = useRef<HTMLElement>(null);
  const previousMoment = useRef(moment);
  const editing = useRef(false);
  useEffect(() => { setSelected(null); }, [state.activeClarification, state.conversationId]);
  useLayoutEffect(() => {
    if (previousMoment.current === moment) return;
    previousMoment.current = moment;
    const scroller = document.scrollingElement ?? document.documentElement;
    scroller.scrollTop = 0; document.body.scrollTop = 0;
    if (drawer || preview || document.activeElement?.closest('[role="dialog"], [role="alertdialog"], dialog[open]')) return;
    if (editing.current) input.current?.focus({ preventScroll: true });
    else stage.current?.querySelector<HTMLHeadingElement>('h1')?.focus({ preventScroll: true });
  }, [moment, drawer, preview]);
  const input = useRef<HTMLTextAreaElement>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (moment !== 5) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [moment]);
  useEffect(() => {
    const prefill = (event: Event) => { const text = (event as CustomEvent<{ text: string }>).detail?.text; if (text) { setDraft(text); input.current?.focus(); } };
    window.addEventListener('chat:prefill', prefill); return () => window.removeEventListener('chat:prefill', prefill);
  }, []);
  useEffect(() => { setPreview(null); }, [state.conversationId, state.activePlan?.id]);
  const send = (text: string) => {
    if (!text.trim() || state.isPlanning) return;
    props.onSendMessage(text.trim()); setDraft('');
    if (state.activeClarification) state.setClarification(null);
  };
  const onKeyDown = (event: import('react').KeyboardEvent<HTMLTextAreaElement>, text = draft) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(text); } };
  const navigate = props.navigate ?? ((path: string) => { window.location.href = path; });
  const composer = <form aria-label="Nhập yêu cầu" aria-busy={state.isPlanning} onSubmit={event => { event.preventDefault(); send(draft); }} className="rounded-2xl border border-border bg-surface p-3 shadow-sm">
    <textarea ref={input} rows={moment === 1 && !drawer ? 4 : 2} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={onKeyDown} aria-label={moment === 3 ? 'Nhập câu trả lời làm rõ yêu cầu' : 'Mô tả công việc bạn muốn thực hiện'} placeholder="Mô tả công việc bạn muốn thực hiện..." className="w-full min-w-0 resize-none bg-transparent leading-6 outline-none" />
    <div className="flex items-center justify-between gap-3"><span className="text-sm text-text-secondary">Enter gửi · Shift+Enter xuống dòng</span><button type="submit" disabled={!draft.trim() || state.isPlanning} className="rounded-full bg-primary text-white px-5 py-2 font-semibold">Gửi</button></div>
    {state.isPlanning && <p role="status" className="text-sm text-text-secondary mt-2">Đang lập kế hoạch…</p>}
  </form>;
  // Recovery owns its durable execution. Ordinary progress belongs to the current active plan.
  const snapshot = [7, 8, 9].includes(moment as number) || state.activePlan?.id === state.executionSnapshot?.plan.id ||
    (!state.activePlan && !state.isPlanning && state.planStatus === state.executionSnapshot?.execution.status)
    ? state.executionSnapshot : null;
  const plan = snapshot?.plan ?? state.activePlan;
  const executionSteps = (plan?.steps ?? snapshot?.steps.map(step => ({ id: step.stepId, tool: step.tool, description: step.stepId, args: {} })) ?? []).map(step => {
    const saved = snapshot?.steps.find(row => row.stepId === step.id);
    const elapsed = saved?.durationMs ?? (saved?.startedAt ? Math.max(0, (saved.completedAt ? Date.parse(saved.completedAt) : now) - Date.parse(saved.startedAt)) : null);
    const liveStatus = state.executionSnapshot && !snapshot ? undefined : state.stepStatuses[step.id];
    return { id: step.id, tool: step.tool, description: step.description, status: saved?.status ?? liveStatus ?? 'pending', output: saved?.output, completedAt: saved?.completedAt, error: liveStatus ? state.stepErrors[step.id] : undefined, duration: elapsed != null && Number.isFinite(elapsed) ? `${elapsed / 1000}s` : undefined };
  });
  const started = snapshot?.steps.flatMap(row => row.startedAt && Number.isFinite(Date.parse(row.startedAt)) ? [Date.parse(row.startedAt)] : []) ?? [];
  const ended = snapshot?.steps.flatMap(row => row.completedAt && Number.isFinite(Date.parse(row.completedAt)) ? [Date.parse(row.completedAt)] : []) ?? [];
  const total = started.length && ended.length ? Math.max(0, Math.max(...ended) - Math.min(...started)) / 1000 : null;
  const request = [...state.messages].reverse().find(message => message.role === 'user')?.content;
  const latestMessage = state.messages.at(-1);
  const terminalError = latestMessage?.metadata?.type === 'planning_error' ||
    (latestMessage?.role === 'system' && /^(\[Lỗi|Lỗi:)/.test(latestMessage.content)) ? latestMessage : null;
  const title = moment === 1 ? 'Bạn muốn nhờ ATI việc gì?' : moment === 2 ? 'Đang tìm đúng chỗ' : moment === 3 ? 'ATI cần bạn chọn thêm' : moment === 4 ? 'Kiểm tra trước khi làm' : moment === 5 ? 'ATI đang làm' : moment === 6 ? 'Việc đã xong' : moment === 'refusal' ? 'Chưa thể làm yêu cầu này' : moment === 'unsuccessful' ? 'Yêu cầu đã kết thúc' : 'Cần xử lý trước khi tiếp tục';
  return <>
    <div data-cockpit-background className="contents" onFocusCapture={event => { editing.current = (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) && !drawer && !preview; }} onBlurCapture={event => { if (!(event.relatedTarget instanceof HTMLTextAreaElement || event.relatedTarget instanceof HTMLInputElement) && (event.relatedTarget !== null || (event.target as HTMLElement).isConnected)) editing.current = false; }}>
      <CockpitHeader historyDialogId="history-drawer" chatDialogId="chat-drawer" moment={moment} request={request ?? ''} messageCount={state.messages.length} user={props.user ?? null} navigate={navigate} onLogout={props.onLogout ?? (() => {})} onSettings={props.onSettings} historyOpen={drawer === 'history'} chatOpen={drawer === 'conversation'} onHistory={() => setDrawer('history')} onConversation={() => setDrawer('conversation')} />
      <main ref={stage} id="stage-container" className="flex-1 w-full max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10 flex flex-col justify-center min-w-0">
        {props.contentOverride ?? (moment === 1 ? <RequestMoment feedback={terminalError && <p role="alert" className="text-danger-text mb-4">{terminalError.content}</p>} services={props.services} loading={props.servicesLoading} error={props.servicesError} draft={draft} planning={state.isPlanning} input={input} inputHidden={drawer === 'conversation'} onDraft={setDraft} onSend={send} onKeyDown={onKeyDown} onSettings={props.onSettings} navigate={navigate} servicePrompt={servicePrompt} /> : moment === 2 ? <DiscoveryMoment request={request ?? ''} gather={state.gatherState} services={props.services} /> : moment === 3 && state.activeClarification ? <ClarificationMoment question={state.activeClarification.question} context={state.activeClarification.context} options={state.activeClarification.options} selected={selected} onSelect={setSelected} draft={draft} onDraft={setDraft} planning={state.isPlanning} input={input} inputHidden={drawer === 'conversation'} onSend={send} onKeyDown={event => onKeyDown(event, selected ?? draft)} onBack={() => { setDraft(request ?? ''); state.setClarification(null); }} /> : <section id={`moment-${String(moment)}`} aria-label="Cockpit" data-moment={String(moment)} className="max-w-3xl mx-auto min-w-0">
          <p className="text-sm uppercase tracking-widest text-text-secondary mb-3">ATI · Điều phối công việc</p>
          <h1 id={`heading-moment-${String(moment)}`} tabIndex={-1} className="text-3xl sm:text-4xl mb-6">{title}</h1>
          {terminalError && <p role="alert" className="text-danger-text mb-4">{terminalError.content}</p>}
          {moment === 4 && state.activePlan && <div className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
            <h2 className="text-xl mb-5">{state.activePlan.summary}</h2>
            <ol className="space-y-4">{state.activePlan.steps.map(step => { const definition = getToolDefinition(step.tool); const service = definition?.service ?? step.tool.split('.')[0]; return <li key={step.id} className="rounded-xl border border-border p-4"><div className="flex gap-3"><ServiceLogo service={service} /><div className="min-w-0 flex-1"><p className="font-semibold">{step.description}</p><p className="text-text-secondary break-words">{resourceDestination(step, state.activePlan?.resourceLabels)}</p><div className="flex flex-wrap items-center gap-3 mt-2"><span className="text-sm">{definition?.sideEffect === 'read' ? 'Đọc' : /create|append|send/.test(step.tool) ? 'Tạo mới' : 'Cập nhật'}</span><button id={`preview-${step.id}`} type="button" onClick={() => setPreview(step)} className="text-primary-text underline">Xem trước</button></div></div></div></li>; })}</ol>
            {state.activePlan.warnings?.map((warning, index) => <p key={index} className="mt-4 text-warning-text">{warning}</p>)}
            <details className="mt-5"><summary>Chi tiết kỹ thuật</summary><div className="mt-3">{state.activePlan.steps.map((step, index) => <PlanStepItem key={step.id} step={step} index={index} resourceLabels={state.activePlan?.resourceLabels} isLast={index === state.activePlan!.steps.length - 1} />)}<pre className="whitespace-pre-wrap break-all">{JSON.stringify(state.activePlan, null, 2)}</pre></div></details>
            {!state.activePlan.id && <p role="alert">Kế hoạch thiếu mã định danh hợp lệ. Hãy tải lại hội thoại trước khi duyệt.</p>}
            <div className="flex flex-wrap gap-3 border-t border-border mt-6 pt-4"><button type="button" onClick={props.onApprove} disabled={!state.activePlan.id} className="rounded-full bg-primary text-white px-5 py-3">Duyệt kế hoạch</button><button type="button" onClick={() => { setDraft('Điều chỉnh kế hoạch: '); input.current?.focus(); }} className="rounded-full border border-border px-4 py-3">Sửa qua chat</button><button type="button" onClick={props.onCancel} className="rounded-full px-4 py-3 text-danger-text">Hủy</button></div>
          </div>}
          {[5, 6, 7, 8, 9, 'unsuccessful'].includes(moment) && <>
            {executionSteps.length > 0 && (moment === 6 ? <ExecutionReceipt steps={executionSteps} services={props.services} /> : <ExecutionProgress steps={executionSteps} status={snapshot?.execution.status ?? state.planStatus} title="Tiến trình công việc" />)}
            {moment === 5 && !executionSteps.length && <p role="status">Đang kích hoạt kế hoạch…</p>}
            {moment === 6 && <p role="status" className="text-success-text">Quy trình đã hoàn thành.</p>}
            {moment === 'unsuccessful' && <p role="status">{state.planStatus === 'stopped' ? 'Quy trình đã dừng.' : state.planStatus === 'rejected' ? 'Kế hoạch đã hủy; chưa thực thi.' : 'Quy trình không hoàn thành.'}</p>}
            {total !== null && (moment === 6 || moment === 'unsuccessful') && <p className="mt-4">Thời gian thực thi: {total.toFixed(1)} giây</p>}
            {moment === 6 && <div role="group" aria-label="Gợi ý tiếp theo" className="mt-6 flex flex-wrap gap-3">{[...props.services.filter(service => service.configured).map(service => ({id:service.id,text:servicePrompt(service),settings:false})),{id:'next-request',text:'Mô tả công việc tiếp theo',settings:false},{id:'connect-services',text:'Kết nối thêm dịch vụ',settings:true}].slice(0,2).map(suggestion => <button key={suggestion.id} type="button" onClick={() => { if(suggestion.settings) props.onSettings(); else {props.onNewConversation(); setDraft(suggestion.id==='next-request'?'':suggestion.text); input.current?.focus();} }} className="rounded-xl border border-border px-4 py-3">{suggestion.text}</button>)}</div>}
            {(moment === 6 || moment === 'unsuccessful') && <button type="button" onClick={props.onNewConversation} className="rounded-full bg-primary text-white px-5 py-3 mt-6">Nhờ việc khác</button>}
          </>}
          {moment === 'refusal' && <div role="status" className="rounded-2xl border border-border bg-warning-tint p-5 whitespace-pre-wrap">{state.messages.at(-1)?.content}<button type="button" onClick={props.onSettings} className="block mt-4 underline">Kết nối dịch vụ</button></div>}
          {props.recovery}
          {moment !== 6 && state.executionSnapshot?.execution.status === 'completed' && state.activePlan?.id !== state.executionSnapshot.plan.id && <details className="mt-5"><summary>Kết quả kế hoạch trước: {state.executionSnapshot.plan.summary}</summary><p role="status">Quy trình đã hoàn thành.</p></details>}
          {state.executionSnapshot?.execution.status === 'stopped' && moment !== 'unsuccessful' && <p role="status">Quy trình đã dừng.</p>}
          {moment !== 4 && state.activePlan && <details className="mt-5"><summary>Kế hoạch {state.planStatus === 'preview' ? 'đang chờ' : 'đã duyệt'}: <span>{state.activePlan.summary}</span></summary><pre className="whitespace-pre-wrap break-all">{JSON.stringify(state.activePlan, null, 2)}</pre></details>}
          {state.executionLoadError && <p role="alert">Không tải được trạng thái thực thi: {state.executionLoadError}. Hãy mở lại hội thoại.</p>}
        </section>)}
      </main>
      {!props.contentOverride && moment !== 1 && moment !== 3 && !drawer && <div className="shrink-0 border-t border-border bg-bg-page px-4 sm:px-8 py-3"><div className="max-w-3xl mx-auto">{composer}</div></div>}
    </div>
    {drawer === 'history' && <CockpitDialog id="history-drawer" title="Lịch sử yêu cầu" side="left" returnFocusId="btn-open-history" onClose={() => setDrawer(null)}><div className="p-4 h-full flex flex-col min-h-0"><button type="button" onClick={() => { setDrawer(null); props.onNewConversation(); }} className="rounded-full bg-primary text-white px-4 py-3">Cuộc hội thoại mới</button><SidebarHistory currentConversationId={state.conversationId} onSelectConversation={props.onSelectConversation} onCloseMobileSidebar={() => setDrawer(null)} /></div></CockpitDialog>}
    {drawer === 'conversation' && <CockpitDialog id="chat-drawer" title="Nhật ký hội thoại" side="right" returnFocusId="btn-open-chat" onClose={() => setDrawer(null)}><div className="flex flex-col h-full"><div className="flex-1 min-h-0"><ChatContainer messages={state.messages} streamingText={state.streamingText} isStreaming={state.isStreaming} onSendMessage={props.onSendMessage} logOnly /></div><div className="shrink-0 p-3 border-t border-border">{composer}</div></div></CockpitDialog>}
    {preview && <CockpitDialog title="Xem trước nội dung" returnFocusId={`preview-${preview.id}`} onClose={() => setPreview(null)}><div className="p-5"><h3 className="text-xl mb-4">{preview.description}</h3><p className="mb-4">Đích: {resourceDestination(preview, state.activePlan?.resourceLabels)}</p><dl className="space-y-3">{Object.entries(preview.args).filter(([key]) => !getToolDefinition(preview.tool)?.inputSchema.properties?.[key]?.['x-resource']).map(([key, value]) => <div key={key}><dt className="font-semibold">{({ title:'Tiêu đề', text:'Nội dung', body:'Nội dung', name:'Tên', summary:'Tiêu đề', description:'Mô tả' } as Record<string,string>)[key] ?? key}</dt><dd className="whitespace-pre-wrap break-words">{formatArgValue(value).text}</dd></div>)}</dl></div></CockpitDialog>}
  </>;
}
