import React, { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import presentation from '../../assets/cockpit-services.json';
import { useChatStore } from '../../store/chat-store';
import { selectMoment } from '../../services/cockpit-moment';
import type { PlanStep, ServiceInfo, User } from '../../types';
import type { RecoveryControls } from '../../pages/Cockpit/RecoveryMoment';
import { apiClient } from '../../services/api-client';
import { usePrototypePage } from '../../prototype/usePrototypePage';
import { meta } from '../../pages/Cockpit/meta';
import { CockpitHeader } from '../../pages/Cockpit/CockpitHeader';
import { ChatComposer } from '../../pages/Cockpit/ChatComposer';
import { ConversationDrawer } from '../../pages/Cockpit/ConversationDrawer';
import { latestSavedRequest } from '../../pages/Cockpit/SavedConversation';
import { HistoryDrawer } from '../../pages/Cockpit/HistoryDrawer';
import { PreviewModal } from '../../pages/Cockpit/PreviewModal';
import { DrawerBackdrop } from '../../pages/Cockpit/DrawerBackdrop';
import { clarificationVariant } from '../../pages/Responses/ResponseMoment';
import { usePlanningWait } from '../../hooks/use-planning-wait';
import responseCss from '../../pages/Responses/page.css?inline';
import errorCss from '../../pages/Errors/page.css?inline';
import { PlanoraConversationFeed } from './PlanoraConversationFeed';
import { PlanoraActiveTurn } from './PlanoraActiveTurn';
import { resourceDestination } from '../../components/Cockpit';

const responseMeta = { ...meta, id: 'responses', css: meta.css + responseCss };
const errorMeta = { ...meta, id: 'errors', css: meta.css + errorCss };

export interface PlanoraChatWorkspaceProps {
  user?: User | null;
  onLogout?: () => void;
  navigate?: (path: string) => void;
  services: ServiceInfo[];
  servicesLoading: boolean;
  servicesError: string | null;
  onRefreshServices?: () => void;
  onSendMessage: (text: string) => void;
  onNewConversation: () => void;
  onSelectConversation: (id: string) => void;
  onSettings: () => void;
  onApprove: () => void;
  onCancel: () => void;
  recovery: RecoveryControls | null;
  networkError?: boolean;
  contentOverride?: ReactNode;
  canConfigureServices?: boolean;
  legacyCockpit?: boolean;
}

const prompts: Record<string, string> = Object.fromEntries(
  Object.entries(presentation.services).map(([id, asset]) => [id, asset.prompt])
);

function servicePrompt(service: ServiceInfo): string {
  return (prompts[service.id] ?? 'Mô tả công việc với {service}').replace('{service}', service.name);
}

export function PlanoraChatWorkspace(props: PlanoraChatWorkspaceProps) {
  const state = useChatStore();
  const [runtimeMode, setRuntimeMode] = useState<'sandbox' | 'live' | null>(null);
  const [schedulesEnabled, setSchedulesEnabled] = useState(false);
  const [personalEnabled, setPersonalEnabled] = useState(false);

  useEffect(() => {
    let current = true;
    Promise.resolve(apiClient.getRuntime?.())
      .then((data) => {
        if (!current) return;
        setSchedulesEnabled(data?.schedulesEnabled === true);
        if (data?.runtimeMode === 'sandbox' || data?.runtimeMode === 'live') {
          setRuntimeMode(data.runtimeMode);
        }
        setPersonalEnabled(
          data?.gmailEnabled === true || data?.mycalendarEnabled === true || data?.mysheetsEnabled === true
        );
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, []);

  const actualMoment = selectMoment(state, state.executionSnapshot);
  const pending = state.planningByConversation[state.conversationId ?? '__draft__'];
  const waitingKey = pending ? `${state.conversationId}:${pending.requestId ?? pending.startedAt}` : null;
  const [dismissedWait, setDismissedWait] = useState<string | null>(null);
  const [editingResponse, setEditingResponse] = useState<string | null>(null);
  const milliseconds = usePlanningWait(pending?.startedAt, state.isPlanning);
  const moment =
    actualMoment === 'schedule' && !schedulesEnabled
      ? 1
      : actualMoment === 2 && waitingKey && dismissedWait === waitingKey
        ? 1
        : actualMoment;

  const [drawer, setDrawer] = useState<'history' | 'conversation' | null>(null);
  const [preview, setPreview] = useState<PlanStep | null>(null);
  const [draft, setDraft] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const stage = useRef<HTMLElement>(null);
  const previousMoment = useRef(moment);
  const editing = useRef(false);

  useEffect(() => {
    setSelected(null);
  }, [state.activeClarification, state.conversationId]);

  useLayoutEffect(() => {
    if (previousMoment.current === moment) return;
    previousMoment.current = moment;
    if (props.legacyCockpit) {
      const scroller = document.scrollingElement ?? document.documentElement;
      scroller.scrollTop = 0;
      document.body.scrollTop = 0;
    }
    if (drawer || preview || document.activeElement?.closest('[role="dialog"], [role="alertdialog"], dialog[open]'))
      return;
    if (editing.current && input.current && input.current.isConnected) input.current.focus({ preventScroll: true });
    else stage.current?.querySelector<HTMLHeadingElement>('h1')?.focus({ preventScroll: true });
  }, [moment, drawer, preview, props.legacyCockpit]);

  const input = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (editOpen && !drawer && input.current) {
      input.current.focus();
      input.current.setSelectionRange(input.current.value.length, input.current.value.length);
    }
  }, [editOpen]);

  useEffect(() => {
    setEditOpen(false);
  }, [state.conversationId, state.activePlan?.id]);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem('ati_prefill_prompt');
      if (stored) {
        sessionStorage.removeItem('ati_prefill_prompt');
        setDraft((current) => current || stored);
        input.current?.focus();
      }
    } catch {
      // ignore storage errors
    }
    const prefill = (event: Event) => {
      const text = (event as CustomEvent<{ text: string }>).detail?.text;
      if (text) {
        setDraft(text);
        input.current?.focus();
      }
    };
    window.addEventListener('chat:prefill', prefill);
    return () => window.removeEventListener('chat:prefill', prefill);
  }, []);

  useEffect(() => {
    setPreview(null);
  }, [state.conversationId, state.activePlan?.id]);

  const send = (text: string) => {
    if (!text.trim() || state.isPlanning) return;
    setEditingResponse(null);
    props.onSendMessage(text.trim());
    setDraft('');
    if (state.activeClarification) state.setClarification(null);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>, text = draft) => {
    const isComposing = Boolean(event.nativeEvent?.isComposing || (event as any).isComposing || event.keyCode === 229);
    if (event.key === 'Enter' && !event.shiftKey && !isComposing) {
      event.preventDefault();
      send(text);
    }
  };

  const navigate =
    props.navigate ??
    ((path: string) => {
      window.location.href = path;
    });

  const editPlan = () => {
    setDraft((current) => current || 'Điều chỉnh kế hoạch: ');
    setEditOpen(true);
    queueMicrotask(() => {
      input.current?.focus();
      input.current?.setSelectionRange(input.current.value.length, input.current.value.length);
    });
  };

  const request = [...state.messages].reverse().find((message) => message.role === 'user')?.content;
  const latestMessage = state.messages.at(-1);
  const terminalError =
    ['planning_error', 'schedule_discarded'].includes(latestMessage?.metadata?.type ?? '') ||
    (latestMessage?.role === 'system' && /^(\[Lỗi|Lỗi:)/.test(latestMessage.content))
      ? latestMessage
      : null;
  const responseKey = `${state.conversationId}:${latestMessage?.id}:${state.activeClarification?.question}`;
  const responseEditing = editingResponse === responseKey;
  const variant = clarificationVariant(state.activeClarification, request ?? '');
  const expanded = moment === 3 && variant !== null;
  const slow = moment === 2 && milliseconds > 15_000;
  const planningError = moment === 1 && terminalError?.metadata?.type === 'planning_error' && !responseEditing;
  const canConfigure = props.canConfigureServices ?? props.user?.role === 'admin';

  const savedRequest =
    moment === 1 &&
    state.conversationId &&
    !state.isPlanning &&
    !state.historyHydrating &&
    !terminalError &&
    !(waitingKey && dismissedWait === waitingKey)
      ? latestSavedRequest(state.messages)
      : undefined;
  const statusLoadError = state.planLoadError ?? state.executionLoadError;

  usePrototypePage(
    planningError || slow
      ? errorMeta
      : moment === 'refusal' || moment === 'answer' || expanded
        ? responseMeta
        : meta
  );

  const editRequest = (text: string) => {
    setDraft(text);
    setSelected(null);
    setDrawer(null);
    setEditingResponse(responseKey);
    queueMicrotask(() => {
      input.current?.focus();
      input.current?.setSelectionRange(text.length, text.length);
    });
  };

  const handleSelectOption = (option: string | null) => {
    setSelected(option);
    if (typeof option === 'string') {
      setDraft(option);
    }
  };

  const activeMessageIds = new Set<string>();
  if (savedRequest) activeMessageIds.add(savedRequest.id);
  if ((moment === 'answer' || moment === 'refusal' || (moment as any) === 3) && latestMessage?.role === 'assistant') {
    activeMessageIds.add(latestMessage.id);
  }
  if (terminalError) activeMessageIds.add(terminalError.id);
  if (moment !== null && moment !== undefined && [3, 4, 5, 6, 7, 8, 9, 'answer', 'refusal', 'unsuccessful'].includes(moment as any)) {
    const activeUser = [...state.messages].reverse().find((m) => m.role === 'user');
    if (activeUser) activeMessageIds.add(activeUser.id);
  }

  const feedMessages = state.messages.filter((m) => !activeMessageIds.has(m.id));

  const composerProps = {
    draft,
    planning: state.isPlanning,
    input,
    onDraft: setDraft,
    onSend: send,
    onKeyDown,
    moment,
  };

  return (
    <>
      <div
        data-cockpit-background
        className="planora-chat-workspace planora-chat-main w-full flex-1 flex flex-col min-w-0 h-full max-h-full overflow-hidden"
        onFocusCapture={(event) => {
          editing.current =
            (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) &&
            !drawer &&
            !preview;
        }}
        onBlurCapture={(event) => {
          if (
            !(event.relatedTarget instanceof HTMLTextAreaElement || event.relatedTarget instanceof HTMLInputElement) &&
            (event.relatedTarget !== null || (event.target as HTMLElement).isConnected)
          )
            editing.current = false;
        }}
      >
        <CockpitHeader
          runtimeMode={runtimeMode}
          historyDialogId="history-drawer"
          chatDialogId="chat-drawer"
          moment={moment}
          messageCount={state.messages.length}
          user={props.user ?? null}
          navigate={navigate}
          onLogout={props.onLogout ?? (() => {})}
          onSettings={props.onSettings}
          historyOpen={drawer === 'history'}
          chatOpen={drawer === 'conversation'}
          onHistory={() => setDrawer('history')}
          onConversation={() => setDrawer('conversation')}
        />

        <main
          ref={stage}
          id="stage-container"
          role="main"
          className="flex-1 w-full min-w-0 flex flex-col min-h-0 overflow-hidden"
        >
          {state.isPlanning && <span role="status" className="sr-only">Đang lập kế hoạch…</span>}

          {props.contentOverride ?? (
            <PlanoraConversationFeed
              messages={feedMessages}
              streamingText={state.streamingText}
              isStreaming={state.isStreaming}
              schedulesEnabled={schedulesEnabled}
              isDrawerOpen={drawer === 'conversation'}
            >
              <PlanoraActiveTurn
                moment={moment}
                state={state}
                runtimeMode={runtimeMode}
                schedulesEnabled={schedulesEnabled}
                personalEnabled={personalEnabled}
                services={props.services}
                servicesLoading={props.servicesLoading}
                servicesError={props.servicesError}
                onRefreshServices={props.onRefreshServices}
                canConfigure={canConfigure}
                draft={draft}
                onDraft={setDraft}
                onSend={send}
                onKeyDown={onKeyDown}
                input={input}
                selected={selected}
                onSelect={handleSelectOption}
                onPreview={setPreview}
                onApprove={props.onApprove}
                onCancel={props.onCancel}
                onEditPlan={editPlan}
                recovery={props.recovery}
                onNewConversation={props.onNewConversation}
                onSettings={props.onSettings}
                navigate={navigate}
                servicePrompt={servicePrompt}
                statusLoadError={statusLoadError}
                savedRequest={savedRequest}
                onOpenConversation={() => setDrawer('conversation')}
                dismissedWait={dismissedWait}
                waitingKey={waitingKey}
                onDismissWait={() => {
                  if (waitingKey) setDismissedWait(waitingKey);
                }}
                editRequest={editRequest}
                networkError={props.networkError}
                milliseconds={milliseconds}
                editOpen={editOpen}
                onCloseEdit={() => {
                  setEditOpen(false);
                  document.getElementById('btn-edit-plan')?.focus();
                }}
                drawer={drawer}
                responseEditing={responseEditing}
              />
            </PlanoraConversationFeed>
          )}
        </main>

        {!props.contentOverride &&
          (![1, 3].includes(moment as number) || expanded || planningError) &&
          !(props.legacyCockpit && moment === 4) &&
          !(moment === 4 && editOpen) &&
          drawer !== 'conversation' && (
            <div className="planora-chat-composer-dock">
              <ChatComposer
                variant={moment === 'refusal' || moment === 'answer' || expanded ? 'response' : 'bottom'}
                {...composerProps}
              />
            </div>
          )}
      </div>

      {drawer && <DrawerBackdrop onClose={() => setDrawer(null)} />}
      {drawer === 'history' && (
        <HistoryDrawer
          conversationId={state.conversationId}
          onClose={() => setDrawer(null)}
          onNewConversation={props.onNewConversation}
          onSelectConversation={props.onSelectConversation}
        />
      )}
      {drawer === 'conversation' && (
        <ConversationDrawer
          messages={state.messages}
          streamingText={state.streamingText}
          isStreaming={state.isStreaming}
          onClose={() => setDrawer(null)}
          composer={<ChatComposer variant="drawer" {...composerProps} />}
        />
      )}
      {preview && (
        <PreviewModal
          sender={state.activePlan?.connections?.gmail?.email}
          step={preview}
          services={props.services}
          labels={state.activePlan?.resourceLabels}
          destination={resourceDestination}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  );
}

export default PlanoraChatWorkspace;
