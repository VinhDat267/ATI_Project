import React from 'react';
import type { ChatMessage, PlanStep, ServiceInfo } from '../../types';
import type { ChatStoreState } from '../../store/chat-store';
import type { RecoveryControls } from '../../pages/Cockpit/RecoveryMoment';
import { RequestMoment, DiscoveryMoment } from '../../pages/Cockpit/RequestMoments';
import { ClarificationMoment } from '../../pages/Cockpit/ClarificationMoment';
import { PlanMoment } from '../../pages/Cockpit/PlanMoment';
import { ExecutionMoment } from '../../pages/Cockpit/ExecutionMoment';
import { ReceiptMoment } from '../../pages/Cockpit/ReceiptMoment';
import { RecoveryMoment } from '../../pages/Cockpit/RecoveryMoment';
import { ScheduleMoment } from '../../pages/Cockpit/ScheduleMoment';
import { ScheduleRunRecovery } from '../../pages/Cockpit/ScheduleRunRecovery';
import { SavedConversation } from '../../pages/Cockpit/SavedConversation';
import { ChatComposer } from '../../pages/Cockpit/ChatComposer';
import { RefusalMoment, ExpandedClarificationMoment, clarificationVariant, AnswerMoment } from '../../pages/Responses/ResponseMoment';
import { SlowPlanningMoment, PlanningErrorMoment, latePlanNotice } from '../../pages/Errors/PlanningErrors';
import { formatDuration } from '../../pages/Cockpit/presentation';
import { resourceDestination } from '../../components/Cockpit';

export interface PlanoraActiveTurnProps {
  moment: number | string;
  state: ChatStoreState;
  runtimeMode: 'sandbox' | 'live' | null;
  schedulesEnabled: boolean;
  personalEnabled: boolean;
  services: ServiceInfo[];
  servicesLoading: boolean;
  servicesError: string | null;
  onRefreshServices?: () => void;
  canConfigure: boolean;
  draft: string;
  onDraft: (text: string) => void;
  onSend: (text: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>, text?: string) => void;
  input: React.RefObject<HTMLTextAreaElement | null>;
  selected: string | null;
  onSelect: (option: string | null) => void;
  onPreview: (step: PlanStep) => void;
  onApprove: () => void;
  onCancel: () => void;
  onEditPlan: () => void;
  recovery: RecoveryControls | null;
  onNewConversation: () => void;
  onSettings: () => void;
  navigate: (path: string) => void;
  servicePrompt: (service: ServiceInfo) => string;
  statusLoadError?: string | null;
  savedRequest?: ChatMessage;
  onOpenConversation?: () => void;
  dismissedWait: string | null;
  waitingKey: string | null;
  editRequest: (text: string) => void;
  networkError?: boolean;
  milliseconds: number;
  editOpen?: boolean;
  onCloseEdit?: () => void;
  drawer?: 'history' | 'conversation' | null;
  onDismissWait?: () => void;
  responseEditing?: boolean;
}

export function PlanoraActiveTurn(props: PlanoraActiveTurnProps) {
  const {
    moment,
    state,
    runtimeMode,
    schedulesEnabled,
    personalEnabled,
    services,
    servicesLoading,
    servicesError,
    onRefreshServices,
    canConfigure,
    draft,
    onDraft,
    onSend,
    onKeyDown,
    input,
    selected,
    onSelect,
    onPreview,
    onApprove,
    onCancel,
    onEditPlan,
    recovery,
    onNewConversation,
    onSettings,
    navigate,
    servicePrompt,
    statusLoadError,
    savedRequest,
    onOpenConversation,
    dismissedWait,
    waitingKey,
    editRequest,
    networkError,
    onDismissWait,
    milliseconds,
    editOpen,
    onCloseEdit,
    drawer,
  } = props;

  const snapshot = [7, 8, 9].includes(moment as number) || state.activePlan?.id === state.executionSnapshot?.plan.id ||
    (!state.activePlan && !state.isPlanning && state.planStatus === state.executionSnapshot?.execution.status)
    ? state.executionSnapshot : null;
  const plan = snapshot?.plan ?? state.activePlan;

  const executionSteps = (plan?.steps ?? snapshot?.steps.map(step => ({ id: step.stepId, tool: step.tool, description: step.stepId, args: {} })) ?? []).map(step => {
    const saved = snapshot?.steps.find(row => row.stepId === step.id);
    const elapsed = saved?.durationMs ?? (saved?.startedAt ? Math.max(0, (saved.completedAt ? Date.parse(saved.completedAt) : Date.now()) - Date.parse(saved.startedAt)) : null);
    const liveStatus = state.executionSnapshot && !snapshot ? undefined : state.stepStatuses[step.id];
    return {
      id: step.id,
      tool: step.tool,
      description: step.description,
      status: saved?.status ?? liveStatus ?? 'pending',
      output: saved?.output,
      completedAt: saved?.completedAt,
      error: typeof saved?.error === 'string' ? saved.error : saved?.error?.message ?? (liveStatus ? state.stepErrors[step.id] : undefined),
      duration: elapsed != null && Number.isFinite(elapsed) ? formatDuration(elapsed) : undefined,
    };
  });

  const started = snapshot?.steps.flatMap(row => row.startedAt && Number.isFinite(Date.parse(row.startedAt)) ? [Date.parse(row.startedAt)] : []) ?? [];
  const ended = snapshot?.steps.flatMap(row => row.completedAt && Number.isFinite(Date.parse(row.completedAt)) ? [Date.parse(row.completedAt)] : []) ?? [];
  const total = started.length && ended.length ? Math.max(0, Math.max(...ended) - Math.min(...started)) / 1000 : null;

  const request = [...state.messages].reverse().find(message => message.role === 'user')?.content;
  const latestMessage = state.messages.at(-1);
  const runMessage = [...state.messages].reverse().find(message => message.metadata?.type === 'schedule_run');
  const terminalError = ['planning_error', 'schedule_discarded'].includes(latestMessage?.metadata?.type ?? '') ||
    (latestMessage?.role === 'system' && /^(\[Lỗi|Lỗi:)/.test(latestMessage.content)) ? latestMessage : null;

  const variant = clarificationVariant(state.activeClarification, request ?? '');
  const expanded = moment === 3 && variant !== null;
  const slow = moment === 2 && milliseconds > 15_000;
  const planningError = moment === 1 && terminalError?.metadata?.type === 'planning_error' && !props.responseEditing;

  return (
    <div className="planora-active-turn w-full">
      {schedulesEnabled && runMessage && (
        <ScheduleRunRecovery
          key={`${state.conversationId}:${runMessage.id}`}
          message={runMessage}
          navigate={navigate}
        />
      )}

      {moment === 6 && <span role="status" className="sr-only">Quy trình đã hoàn thành.</span>}

      {moment === 'schedule' && latestMessage && state.conversationId ? (
        <ScheduleMoment
          key={state.conversationId}
          message={latestMessage}
          convId={state.conversationId}
          navigate={navigate}
          onEdit={() => {
            const reqText = latestMessage.metadata?.proposal?.request ?? latestMessage.metadata?.schedule?.request ?? '';
            if (reqText) onDraft(reqText);
            input.current?.focus();
          }}
        />
      ) : moment === 'answer' && latestMessage ? (
        <AnswerMoment key={latestMessage.id} message={latestMessage} request={request ?? ''} services={services} />
      ) : moment === 'refusal' && latestMessage ? (
        <RefusalMoment
          message={latestMessage}
          request={request ?? ''}
          services={services}
          canConfigure={canConfigure}
          navigate={navigate}
          onEdit={editRequest}
          connectFromChat={personalEnabled}
          conversationId={state.conversationId}
          onResend={onSend}
          servicesLoading={servicesLoading}
          onRefreshServices={onRefreshServices}
        />
      ) : expanded && state.activeClarification && variant ? (
        <ExpandedClarificationMoment
          clarification={state.activeClarification}
          variant={variant}
          request={request ?? ''}
          services={services}
          canConfigure={canConfigure}
          selected={selected}
          onSelect={onSelect}
          onSend={onSend}
          onEdit={editRequest}
          navigate={navigate}
          planning={state.isPlanning}
        />
      ) : slow ? (
        <SlowPlanningMoment
          request={request}
          seconds={Math.floor(milliseconds / 1000)}
          gather={state.gatherState}
          services={services}
          onDismiss={() => {
            onDismissWait?.();
            onDraft(request ?? '');
          }}
        />
      ) : planningError ? (
        <PlanningErrorMoment
          request={request ?? ''}
          networkError={networkError}
          onRetry={() => onSend(request ?? '')}
          onEdit={() => editRequest(request ?? '')}
        />
      ) : moment === 1 ? (
        <RequestMoment
          feedback={
            dismissedWait === waitingKey && waitingKey ? (
              <p role="status" className="text-sm text-brand-muted">{latePlanNotice}</p>
            ) : terminalError?.metadata?.type !== 'planning_error' && terminalError ? (
              <p role="alert" className="text-danger-text mb-4">{terminalError.content}</p>
            ) : undefined
          }
          resume={
            savedRequest ? (
              <SavedConversation
                messages={state.messages}
                request={savedRequest}
                statusLoadError={statusLoadError}
                onOpenConversation={onOpenConversation ?? (() => {})}
                onResend={text => {
                  onDraft(text);
                  queueMicrotask(() => {
                    input.current?.focus();
                    input.current?.setSelectionRange(text.length, text.length);
                  });
                }}
              />
            ) : undefined
          }
          services={services}
          loading={servicesLoading}
          error={servicesError}
          draft={draft}
          planning={state.isPlanning}
          input={input}
          inputHidden={drawer === 'conversation'}
          onDraft={onDraft}
          onSend={onSend}
          onKeyDown={onKeyDown}
          onSettings={onSettings}
          navigate={navigate}
          servicePrompt={servicePrompt}
        />
      ) : moment === 2 ? (
        <DiscoveryMoment request={request ?? ''} gather={state.gatherState} services={services} />
      ) : moment === 3 && state.activeClarification ? (
        <ClarificationMoment
          request={request}
          question={state.activeClarification.question}
          context={state.activeClarification.context}
          options={state.activeClarification.options}
          selected={selected}
          onSelect={onSelect}
          draft={draft}
          onDraft={onDraft}
          planning={state.isPlanning}
          input={input}
          inputHidden={drawer === 'conversation'}
          onSend={onSend}
          onKeyDown={event => onKeyDown(event, selected ?? draft)}
          onBack={() => {
            onDraft(request ?? '');
            state.setClarification(null);
          }}
        />
      ) : moment === 4 && state.activePlan ? (
        <PlanMoment
          request={request}
          runtimeMode={runtimeMode}
          key={state.activePlan.id}
          plan={state.activePlan}
          services={services}
          destination={resourceDestination}
          onPreview={onPreview}
          onApprove={onApprove}
          onCancel={onCancel}
          onEdit={onEditPlan}
          inlineComposer={
            editOpen && drawer !== 'conversation' ? (
              <ChatComposer
                variant="inline"
                draft={draft}
                planning={state.isPlanning}
                input={input}
                onDraft={onDraft}
                onSend={onSend}
                onKeyDown={onKeyDown}
                onClose={onCloseEdit}
                moment={moment}
              />
            ) : null
          }
        />
      ) : moment === 5 ? (
        <ExecutionMoment
          request={request}
          steps={executionSteps}
          planSteps={plan?.steps ?? []}
          labels={plan?.resourceLabels}
          destination={resourceDestination}
        />
      ) : moment === 6 || moment === 'unsuccessful' ? (
        <ReceiptMoment
          request={request}
          terminalStatus={moment === 'unsuccessful' ? state.planStatus : undefined}
          steps={executionSteps}
          planSteps={plan?.steps ?? []}
          labels={plan?.resourceLabels}
          mycalendarConnection={plan?.connections?.mycalendar}
          mysheetsConnection={plan?.connections?.mysheets}
          trelloConnection={plan?.connections?.trello}
          githubConnection={plan?.connections?.github}
          telegramConnection={plan?.connections?.telegram}
          services={services}
          destination={resourceDestination}
          totalDuration={total === null ? undefined : formatDuration(total * 1000)}
          onNewConversation={onNewConversation}
          onFollowup={text => {
            onDraft(text);
            input.current?.focus();
          }}
          servicePrompt={servicePrompt}
          onSettings={onSettings}
          servicesLoading={servicesLoading}
          servicesError={servicesError}
        />
      ) : [7, 8, 9].includes(moment as number) ? (
        <RecoveryMoment
          request={request}
          key={`${state.conversationId}:${snapshot?.plan.id}:${moment}`}
          moment={moment as 7 | 8 | 9}
          snapshot={snapshot}
          steps={executionSteps}
          services={services}
          controls={recovery}
        />
      ) : (
        <section id={`moment-${String(moment)}`} aria-label="Cockpit" data-moment={String(moment)} className="max-w-3xl mx-auto min-w-0">
          <p className="text-sm uppercase tracking-widest text-[var(--planora-muted)] mb-3">Planora · Điều phối công việc</p>
          <h1 id={`heading-moment-${String(moment)}`} tabIndex={-1} className="text-3xl sm:text-4xl mb-6">
            {moment === 1 ? 'Hôm nay bạn muốn nhờ việc gì?' : 'Cần xử lý trước khi tiếp tục'}
          </h1>
          {terminalError && <p role="alert" className="text-danger-text mb-4">{terminalError.content}</p>}
          {moment === 'refusal' && (
            <div role="status" className="rounded-2xl border border-border bg-warning-tint p-5 whitespace-pre-wrap">
              {state.messages.at(-1)?.content}
              <button type="button" onClick={onSettings} className="block mt-4 underline">Kết nối dịch vụ</button>
            </div>
          )}
          {state.executionSnapshot?.execution.status === 'completed' && state.activePlan?.id !== state.executionSnapshot.plan.id && (
            <details className="mt-5"><summary>Kết quả kế hoạch trước: {state.executionSnapshot.plan.summary}</summary><p role="status">Quy trình đã hoàn thành.</p></details>
          )}
          {state.executionSnapshot?.execution.status === 'stopped' && <p role="status">Quy trình đã dừng.</p>}
          {moment !== 4 && state.activePlan && (
            <details className="mt-5"><summary>Kế hoạch {state.planStatus === 'preview' ? 'đang chờ' : 'đã duyệt'}: <span>{state.activePlan.summary}</span></summary><pre className="whitespace-pre-wrap break-all">{JSON.stringify(state.activePlan, null, 2)}</pre></details>
          )}
          {state.executionLoadError && <p role="alert">Không tải được trạng thái thực thi: {state.executionLoadError}. Hãy mở lại hội thoại.</p>}
        </section>
      )}

      {state.executionSnapshot && state.activePlan && state.activePlan.id !== state.executionSnapshot.plan.id && moment !== 6 && (
        <details className="mt-5 text-xs text-brand-muted">
          <summary>Kế hoạch đang chờ: <span>{state.activePlan?.summary}</span></summary>
          {state.executionSnapshot.execution.status === 'stopped' && <p role="status">Quy trình đã dừng.</p>}
          {state.executionSnapshot.execution.status === 'completed' && <p role="status">Quy trình đã hoàn thành.</p>}
        </details>
      )}
      {[4, 5, 6, 7, 8, 9, 'unsuccessful'].includes(moment as number) && state.executionLoadError && (
        <p role="alert">Không tải được trạng thái thực thi: {state.executionLoadError}. Hãy mở lại hội thoại.</p>
      )}
    </div>
  );
}

export default PlanoraActiveTurn;
