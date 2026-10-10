import { useEffect, useRef, useState } from 'react';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { useChatStore } from '../store/chat-store';
import type { GatherStep, StepState, PlanStatus } from '../types';
import { authStorage } from '../services/auth-storage';
import { apiClient } from '../services/api-client';
import { refreshExecutionSnapshot } from '../services/execution-snapshot';

const lastEventSeq = new Map<string, { epoch: string; seq: number }>();
const fallbackConversationKey = '__no_conversation__';

export function resetSSEState(): void {
  lastEventSeq.clear();
}

export function handleSSEEvent(
  event: string,
  dataStr: string,
  eventId?: number | string,
  conversationId?: string
): void {
  const store = useChatStore.getState();
  const key = conversationId || store.conversationId || fallbackConversationKey;

  if (eventId !== undefined) {
    const raw = String(eventId);
    const separator = raw.lastIndexOf(':');
    const epoch = separator < 0 ? 'legacy' : raw.slice(0, separator);
    const seq = Number(separator < 0 ? raw : raw.slice(separator + 1));
    if (!epoch || !Number.isSafeInteger(seq) || seq < 0) return;
    const previous = lastEventSeq.get(key);
    if (previous?.epoch === epoch && seq <= previous.seq) return;
    lastEventSeq.set(key, { epoch, seq });
  }

  let data: any = {};
  try {
    data = JSON.parse(dataStr);
  } catch {
    data = { raw: dataStr };
  }

  const source = conversationId ?? store.conversationId;
  const pending = source ? store.planningByConversation[source] : undefined;
  if (data.requestId && pending?.requestId && data.requestId !== pending.requestId) return;
  if (['plan', 'plan_preview', 'clarification', 'refusal', 'error'].includes(event)) store.setIsPlanning(false, source, data.requestId);
  if (event === 'agent_state' && data.state === 'planning') {
    store.setIsPlanning(true, source, data.requestId);
    if (source && typeof data.replyToMessageId === 'string') store.confirmPlanningRequest(source, data.requestId, data.replyToMessageId);
  }
  // A late terminal event still settles its own request, but cannot populate
  // messages/plan state for the conversation the user is now reading.
  if (conversationId && store.conversationId !== conversationId) return;

  if (['exec_start', 'exec_step', 'step_status', 'exec_done'].includes(event) &&
      data.planId && (store.activePlan?.id || store.executionSnapshot?.plan.id) &&
      data.planId !== store.activePlan?.id && data.planId !== store.executionSnapshot?.plan.id) return;
  const savedExecution = data.planId && data.planId === store.executionSnapshot?.plan.id
    ? store.executionSnapshot : null;

  switch (event) {
    case 'agent_state':
      break;

    case 'text_start':
      store.setIsStreaming(true);
      store.setStreamingText('');
      break;

    case 'text_delta':
      if (data.delta) {
        store.appendStreamingText(data.delta);
      }
      break;

    case 'text_end':
    case 'text_done':
      if (store.streamingText) { store.addMessage({ id: `text_${Date.now()}`, role: 'assistant', content: store.streamingText }); store.setStreamingText(''); }
      store.setIsStreaming(false);
      break;

    case 'plan':
    case 'plan_preview': {
      const planObj = data.plan || data;
      const planId = data.planId || planObj.id;
      if (planId && store.executionSnapshot?.plan.id === planId) break;
      store.setActivePlan({
        id: planId,
        summary: planObj.summary,
        thinking: planObj.thinking,
        steps: Array.isArray(planObj.steps) ? planObj.steps : [],
        warnings: planObj.warnings,
        resourceLabels: data.resourceLabels ?? planObj.resourceLabels,
      });
      if (planId && !store.messages.some(message=>message.metadata?.type==='plan' && message.metadata.planId===planId)) store.addMessage({id:`plan-display:${planId}`,role:'assistant',content:`Kế hoạch “${planObj.summary || 'Công việc'}” sẵn sàng`,metadata:{type:'plan',planId,plan:{id:planId,summary:planObj.summary || 'Công việc',steps:Array.isArray(planObj.steps)?planObj.steps:[]}}});
      store.setPlanStatus('preview');
      store.setClarification(null);
      store.setGatherState((prev) =>
        prev ? { ...prev, isGathering: false } : null
      );
      store.setIsStreaming(false);
      break;
    }

    case 'gather_progress': {
      if (Array.isArray(data.steps)) {
        store.setGatherState((prev) => ({
          isGathering: true,
          steps: data.steps.map((s: any) => ({
            tool: s.tool,
            result:
              s.result ?? (typeof s.output === 'string' ? s.output : undefined),
            status:
              s.status === 'started' || s.status === 'running'
                ? 'running'
                : 'completed',
          })),
          summary:
            data.summary ||
            prev?.summary ||
            `${data.steps.length} công cụ đã kiểm tra`,
        }));
      } else if (data.tool) {
        const tool = data.tool;
        const status: 'running' | 'completed' =
          data.status === 'started' || data.status === 'running'
            ? 'running'
            : 'completed';
        const result =
          typeof data.output === 'string'
            ? data.output
            : data.result ||
              (Array.isArray(data.output)
                ? `${data.output.length} kết quả`
                : undefined);

        store.setGatherState((prev) => {
          const currentSteps = prev ? [...prev.steps] : [];
          const idx = currentSteps.findIndex((s) => s.tool === tool);
          const newStep: GatherStep = {
            tool,
            status,
            result: result ?? (idx >= 0 ? currentSteps[idx].result : undefined),
          };
          if (idx >= 0) {
            currentSteps[idx] = newStep;
          } else {
            currentSteps.push(newStep);
          }
          const completedCount = currentSteps.filter(
            (s) => s.status === 'completed'
          ).length;
          const summary =
            data.summary ||
            `${completedCount}/${currentSteps.length} công cụ đã khảo sát`;

          return {
            isGathering: true,
            steps: currentSteps,
            summary,
          };
        });
      } else if (data.summary) {
        store.setGatherState((prev) =>
          prev
            ? { ...prev, summary: data.summary, isGathering: true }
            : { isGathering: true, steps: [], summary: data.summary }
        );
      }
      break;
    }

    case 'clarification': {
      store.setIsStreaming(false);
      // The validator only checks `question`; options/context come from the model unchecked.
      store.setClarification({
        question: typeof data.question === 'string' && data.question.trim() ? data.question : 'Vui lòng làm rõ yêu cầu:',
        options: Array.isArray(data.options) ? data.options.filter((option: unknown): option is string => typeof option === 'string' && option.trim() !== '') : [],
        context: typeof data.context === 'string' && data.context.trim() ? data.context : undefined,
        reason: data.reason === 'read_only' || data.reason === 'destination' ? data.reason : undefined,
      });
      break;
    }

    case 'exec_start':
      if (savedExecution) {
        store.setExecutionSnapshot({ ...savedExecution, plan: { ...savedExecution.plan, status: 'executing' },
          execution: { status: 'executing' }, recoveryActions: ['stop'] });
      } else {
        store.setExecutionSnapshot(null);
        store.setPlanStatus('executing');
      }
      break;

    case 'exec_step':
    case 'step_status':
      if (data.stepId && data.status) {
        if (savedExecution) {
          store.setExecutionSnapshot({ ...savedExecution,
            steps: savedExecution.steps.map(row => row.stepId !== data.stepId ? row : {
              ...row, status: data.status as StepState,
              ...(Object.hasOwn(data, 'output') ? { output: data.output } : {}),
              ...(Object.hasOwn(data, 'error') ? { error: data.error } :
                ['running', 'succeeded'].includes(data.status) ? { error: undefined } : {}),
            }),
          });
        } else {
          store.updateStepStatus(
            data.stepId,
            data.status as StepState,
            typeof data.error === 'object' ? data.error?.message : data.error
          );
        }
      }
      break;

    case 'exec_done': {
      const status = (['completed', 'partial', 'reconciliation_required', 'stopped', 'failed'].includes(data.status) ? data.status : 'completed') as PlanStatus;
      if (savedExecution) {
        store.setExecutionSnapshot({ ...savedExecution, plan: { ...savedExecution.plan, status },
          execution: { status, ...(data.pausedAtStepId ? { pausedStepId: data.pausedAtStepId } : {}) },
          recoveryActions: ['completed', 'stopped', 'failed'].includes(status) ? [] : ['stop'] });
        if (store.activePlan?.id === data.planId) store.setIsStreaming(false);
      } else {
        store.setIsStreaming(false);
        store.setPlanStatus(status);
      }
      break;
    }

    case 'refusal':
      store.setIsStreaming(false);
      store.setClarification(null);
      store.setGatherState((prev) =>
        prev ? { ...prev, isGathering: false } : null
      );
      store.setPlanStatus('rejected');
      store.addMessage({
        id: `refusal_${Date.now()}`,
        role: 'assistant',
        metadata: { type: 'refusal',
          reason: typeof data.reason === 'string' ? data.reason : undefined,
          suggestion: typeof data.suggestion === 'string' ? data.suggestion : undefined,
          unavailableServices: Array.isArray(data.unavailableServices) ? data.unavailableServices.filter((row: any) => row && typeof row.id === 'string' && row.id.trim() && typeof row.name === 'string' && row.name.trim()) : undefined,
          requestId: data.requestId, replyToMessageId: data.replyToMessageId },
        content: `Từ chối yêu cầu: ${data.reason || 'Yêu cầu không được hỗ trợ'}${
          data.suggestion ? `\nGợi ý: ${data.suggestion}` : ''
        }`,
      });
      break;

    case 'error':
      store.setIsStreaming(false);
      store.addMessage({
        id: `err_${Date.now()}`,
        role: 'system',
        metadata: { type: 'planning_error' },
        content: `Lỗi: ${data.message || data.error || 'Có lỗi xảy ra trong quá trình xử lý'}`,
      });
      break;

    case 'message_confirmed':
      if (data.tempId && data.confirmedId) {
        store.confirmMessage(data.tempId, data.confirmedId);
      }
      break;

    case 'message_failed':
      if (data.tempId) {
        store.markMessageFailed(data.tempId);
      }
      break;

    case 'sync':
      if (data.activePlan) {
        store.setActivePlan(data.activePlan);
      }
      if (data.stepStatuses) {
        for (const [sId, st] of Object.entries(data.stepStatuses)) {
          store.updateStepStatus(sId, st as StepState);
        }
      }
      break;

    default:
      break;
  }
}

class StreamAuthError extends Error {}
class StreamClientError extends Error {}

export function useSSE(conversationId: string | null, token: string | null) {
  const [disconnected, setDisconnected] = useState(false);
  const [retry, setRetry] = useState(0);
  const authRetry = useRef({ conversationId, refreshed: false });
  useEffect(() => {
    setDisconnected(false);
    if (!conversationId || !token) { authRetry.current = { conversationId, refreshed: false }; return; }
    if (authRetry.current.conversationId !== conversationId) authRetry.current = { conversationId, refreshed: false };
    // Token storage notifies AuthGate and restarts this effect during refresh.
    // Keep the budget across that restart until a stream has actually opened.
    const budget = authRetry.current;
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const markDisconnected = () => { if (!timer) timer = setTimeout(() => { if (!ctrl.signal.aborted) setDisconnected(true); }, 5000); };
    const connected = () => { if (timer) clearTimeout(timer); timer = undefined; setDisconnected(false); };
    const cursor = lastEventSeq.get(conversationId);
    const lastId = !cursor ? '0' : cursor.epoch === 'legacy' ? String(cursor.seq) : `${cursor.epoch}:${cursor.seq}`;
    fetchEventSource(`/api/conversations/${conversationId}/stream`, {
      signal: ctrl.signal,
      openWhenHidden: true,
      headers: { Authorization: `Bearer ${token}`, 'Last-Event-ID': lastId },
      // fetch-event-source copies headers once. Read current storage for every open
      // and replace the header on the single authenticated retry.
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set('Authorization', `Bearer ${authStorage.getStoredTokens().accessToken || token}`);
        let response = await fetch(input, { ...init, headers });
        if (response.status === 401 && !budget.refreshed) {
          try {
            budget.refreshed = true;
            const tokens = await apiClient.refreshToken();
            if (ctrl.signal.aborted) throw new DOMException('Aborted', 'AbortError');
            headers.set('Authorization', `Bearer ${tokens.accessToken}`);
            response = await fetch(input, { ...init, headers });
          } catch (error) {
            if (ctrl.signal.aborted) throw error;
            if ((error as any)?.status === 401 || (error as any)?.status === 403) {
              authStorage.clearStoredTokens();
              throw new StreamAuthError('Phiên đăng nhập đã hết hạn.');
            }
            budget.refreshed = false;
            throw error;
          }
        }
        return response;
      },
      async onopen(response) {
        // A stream 403 means conversation ownership was denied, not that the
        // authenticated session expired. Only the refresh endpoint's 403 above
        // is an authentication failure; keep credentials for other conversations.
        if (response.status === 401) {
          authStorage.clearStoredTokens();
          throw new StreamAuthError('Phiên đăng nhập đã hết hạn.');
        }
        const contentType = response.headers?.get?.('content-type') || (response.headers as any)?.['content-type'];
        if (response.ok && contentType?.includes('text/event-stream')) {
          budget.refreshed = false;
          connected();
          void refreshExecutionSnapshot(conversationId).catch(() => {});
          return;
        }
        if (response.status >= 400 && response.status < 500) throw new StreamClientError('Không mở được kết nối hội thoại.');
        throw new Error('Kết nối hội thoại tạm thời gián đoạn.');
      },
      onmessage(event) {
        handleSSEEvent(event.event || 'message', event.data, event.id || undefined, conversationId);
        if (event.event === 'exec_done') void refreshExecutionSnapshot(conversationId).catch(() => {});
      },
      onclose() { throw new Error('Kết nối hội thoại đã đóng.'); },
      onerror(error) {
        if (ctrl.signal.aborted || error instanceof StreamAuthError) throw error;
        markDisconnected();
        if (error instanceof StreamClientError) throw error;
        return 1000;
      },
    }).catch(() => { if (!ctrl.signal.aborted) markDisconnected(); });
    return () => { ctrl.abort(); if (timer) clearTimeout(timer); };
  }, [conversationId, token, retry]);
  return { disconnected, reconnect: () => setRetry(value => value + 1) };
}
