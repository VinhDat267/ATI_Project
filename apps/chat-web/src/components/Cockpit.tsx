import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { getToolDefinition } from '@wap/tool-schemas';
import presentation from '../assets/cockpit-services.json';
import { useChatStore } from '../store/chat-store';
import { selectMoment } from '../services/cockpit-moment';
import type { PlanStep, ServiceInfo, User } from '../types';
import { ExecutionProgress } from './ExecutionProgress';

import { usePrototypePage } from '../prototype/usePrototypePage';
import { meta } from '../pages/Cockpit/meta';
import { CockpitHeader } from '../pages/Cockpit/CockpitHeader';
import { RequestMoment, DiscoveryMoment } from '../pages/Cockpit/RequestMoments';
import { ClarificationMoment } from '../pages/Cockpit/ClarificationMoment';
import { PlanMoment } from '../pages/Cockpit/PlanMoment';
import { ExecutionMoment } from '../pages/Cockpit/ExecutionMoment';
import { ReceiptMoment } from '../pages/Cockpit/ReceiptMoment';
import { ChatComposer } from '../pages/Cockpit/ChatComposer';
import { ConversationDrawer } from '../pages/Cockpit/ConversationDrawer';
import { HistoryDrawer } from '../pages/Cockpit/HistoryDrawer';
import { PreviewModal } from '../pages/Cockpit/PreviewModal';
import { DrawerBackdrop } from '../pages/Cockpit/DrawerBackdrop';
import { formatDuration } from '../pages/Cockpit/presentation';

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
  const [editOpen, setEditOpen] = useState(false);
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
    if (editing.current && input.current) input.current.focus({ preventScroll: true });
    else stage.current?.querySelector<HTMLHeadingElement>('h1')?.focus({ preventScroll: true });
  }, [moment, drawer, preview]);
  const input = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (editOpen && !drawer && input.current) {
      input.current.focus();
      input.current.setSelectionRange(input.current.value.length, input.current.value.length);
    }
  }, [editOpen]);
  useEffect(() => { setEditOpen(false); }, [state.conversationId, state.activePlan?.id]);
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
  const composerProps = {draft,planning:state.isPlanning,input,onDraft:setDraft,onSend:send,onKeyDown};
  const editPlan = () => {
    setDraft(current => current || 'Điều chỉnh kế hoạch: ');
    setEditOpen(true);
  };
  // Recovery owns its durable execution. Ordinary progress belongs to the current active plan.
  const snapshot = [7, 8, 9].includes(moment as number) || state.activePlan?.id === state.executionSnapshot?.plan.id ||
    (!state.activePlan && !state.isPlanning && state.planStatus === state.executionSnapshot?.execution.status)
    ? state.executionSnapshot : null;
  const plan = snapshot?.plan ?? state.activePlan;
  const executionSteps = (plan?.steps ?? snapshot?.steps.map(step => ({ id: step.stepId, tool: step.tool, description: step.stepId, args: {} })) ?? []).map(step => {
    const saved = snapshot?.steps.find(row => row.stepId === step.id);
    const elapsed = saved?.durationMs ?? (saved?.startedAt ? Math.max(0, (saved.completedAt ? Date.parse(saved.completedAt) : Date.now()) - Date.parse(saved.startedAt)) : null);
    const liveStatus = state.executionSnapshot && !snapshot ? undefined : state.stepStatuses[step.id];
    return { id: step.id, tool: step.tool, description: step.description, status: saved?.status ?? liveStatus ?? 'pending', output: saved?.output, completedAt: saved?.completedAt, error: liveStatus ? state.stepErrors[step.id] : undefined, duration: elapsed != null && Number.isFinite(elapsed) ? formatDuration(elapsed) : undefined };
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
      <main ref={stage} id="stage-container" className={`flex-1 w-full ${moment === 6 ? 'max-w-[1120px]' : 'max-w-4xl'} mx-auto px-4 sm:px-6 py-6 sm:py-10 flex flex-col justify-center min-w-0`}>
        {state.isPlanning && <span role="status" className="sr-only">Đang lập kế hoạch…</span>}
        {moment === 6 && <span role="status" className="sr-only">Quy trình đã hoàn thành.</span>}
        {props.contentOverride ?? (moment === 1 ? <RequestMoment feedback={terminalError && <p role="alert" className="text-danger-text mb-4">{terminalError.content}</p>} services={props.services} loading={props.servicesLoading} error={props.servicesError} draft={draft} planning={state.isPlanning} input={input} inputHidden={drawer === 'conversation'} onDraft={setDraft} onSend={send} onKeyDown={onKeyDown} onSettings={props.onSettings} navigate={navigate} servicePrompt={servicePrompt} /> : moment === 2 ? <DiscoveryMoment request={request ?? ''} gather={state.gatherState} services={props.services} /> : moment === 3 && state.activeClarification ? <ClarificationMoment question={state.activeClarification.question} context={state.activeClarification.context} options={state.activeClarification.options} selected={selected} onSelect={setSelected} draft={draft} onDraft={setDraft} planning={state.isPlanning} input={input} inputHidden={drawer === 'conversation'} onSend={send} onKeyDown={event => onKeyDown(event, selected ?? draft)} onBack={() => { setDraft(request ?? ''); state.setClarification(null); }} /> : moment === 4 && state.activePlan ? <PlanMoment key={state.activePlan.id} plan={state.activePlan} services={props.services} destination={resourceDestination} onPreview={setPreview} onApprove={props.onApprove} onCancel={props.onCancel} onEdit={editPlan} inlineComposer={editOpen && drawer !== 'conversation' ? <ChatComposer variant="inline" {...composerProps} onClose={()=>{setEditOpen(false);document.getElementById('btn-edit-plan')?.focus();}}/> : null}/> : moment === 5 ? <ExecutionMoment steps={executionSteps} planSteps={plan?.steps ?? []} labels={plan?.resourceLabels} destination={resourceDestination}/> : moment === 6 ? <ReceiptMoment steps={executionSteps} planSteps={plan?.steps ?? []} labels={plan?.resourceLabels} services={props.services} destination={resourceDestination} totalDuration={total===null ? undefined : formatDuration(total*1000)} onNewConversation={props.onNewConversation} onFollowup={text=>{setDraft(text);input.current?.focus();}} servicePrompt={servicePrompt} onSettings={props.onSettings} servicesLoading={props.servicesLoading} servicesError={props.servicesError}/> : <section id={`moment-${String(moment)}`} aria-label="Cockpit" data-moment={String(moment)} className="max-w-3xl mx-auto min-w-0">
          <p className="text-sm uppercase tracking-widest text-text-secondary mb-3">ATI · Điều phối công việc</p>
          <h1 id={`heading-moment-${String(moment)}`} tabIndex={-1} className="text-3xl sm:text-4xl mb-6">{title}</h1>
          {terminalError && <p role="alert" className="text-danger-text mb-4">{terminalError.content}</p>}
          {[7, 8, 9, 'unsuccessful'].includes(moment) && <>
            {executionSteps.length > 0 && <ExecutionProgress steps={executionSteps} status={snapshot?.execution.status ?? state.planStatus} title="Tiến trình công việc" />}
            {moment === 'unsuccessful' && <p role="status">{state.planStatus === 'stopped' ? 'Quy trình đã dừng.' : state.planStatus === 'rejected' ? 'Kế hoạch đã hủy; chưa thực thi.' : 'Quy trình không hoàn thành.'}</p>}
            {total !== null && moment === 'unsuccessful' && <p className="mt-4">Thời gian thực thi: {formatDuration(total*1000)}</p>}
            {moment === 'unsuccessful' && <button type="button" onClick={props.onNewConversation} className="rounded-full bg-primary text-white px-5 py-3 mt-6">Nhờ việc khác</button>}
          </>}
          {moment === 'refusal' && <div role="status" className="rounded-2xl border border-border bg-warning-tint p-5 whitespace-pre-wrap">{state.messages.at(-1)?.content}<button type="button" onClick={props.onSettings} className="block mt-4 underline">Kết nối dịch vụ</button></div>}
          {state.executionSnapshot?.execution.status === 'completed' && state.activePlan?.id !== state.executionSnapshot.plan.id && <details className="mt-5"><summary>Kết quả kế hoạch trước: {state.executionSnapshot.plan.summary}</summary><p role="status">Quy trình đã hoàn thành.</p></details>}
          {state.executionSnapshot?.execution.status === 'stopped' && moment !== 'unsuccessful' && <p role="status">Quy trình đã dừng.</p>}
          {moment !== 4 && state.activePlan && <details className="mt-5"><summary>Kế hoạch {state.planStatus === 'preview' ? 'đang chờ' : 'đã duyệt'}: <span>{state.activePlan.summary}</span></summary><pre className="whitespace-pre-wrap break-all">{JSON.stringify(state.activePlan, null, 2)}</pre></details>}
          {state.executionLoadError && <p role="alert">Không tải được trạng thái thực thi: {state.executionLoadError}. Hãy mở lại hội thoại.</p>}
        </section>)}
        {props.recovery}
        {[4,5,6].includes(moment as number) && state.executionLoadError && <p role="alert">Không tải được trạng thái thực thi: {state.executionLoadError}. Hãy mở lại hội thoại.</p>}
      </main>
      {!props.contentOverride && ![1,3,4].includes(moment as number) && drawer !== 'conversation' && <ChatComposer variant="bottom" {...composerProps}/>}
    </div>
    {drawer && <DrawerBackdrop onClose={()=>setDrawer(null)}/>}
    {drawer === 'history' && <HistoryDrawer conversationId={state.conversationId} onClose={()=>setDrawer(null)} onNewConversation={props.onNewConversation} onSelectConversation={props.onSelectConversation}/>}
    {drawer === 'conversation' && <ConversationDrawer messages={state.messages} streamingText={state.streamingText} isStreaming={state.isStreaming} onClose={()=>setDrawer(null)} composer={<ChatComposer variant="drawer" {...composerProps}/>}/>}
    {preview && <PreviewModal step={preview} services={props.services} labels={state.activePlan?.resourceLabels} destination={resourceDestination} onClose={()=>setPreview(null)}/>}

  </>;
}
