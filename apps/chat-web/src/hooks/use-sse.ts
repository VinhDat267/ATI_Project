import { useEffect, useRef } from 'react';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { useChatStore } from '../store/chat-store';
import type { StepState } from '../types';

const lastEventSeq = new Map<string, { epoch: string; seq: number }>();
const fallbackConversationKey = '__no_conversation__';

export function resetSSEState(): void {
  lastEventSeq.clear();
}

export function handleSSEEvent(event: string, dataStr: string, eventId?: number | string, conversationId?: string): void {
  const store = useChatStore.getState();
  if (conversationId && store.conversationId !== conversationId) {
    return;
  }
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

  switch (event) {
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
      store.setIsStreaming(false);
      break;

    case 'plan':
    case 'plan_preview': {
      const planObj = data.plan || data;
      const planId = data.planId || planObj.id;
      store.setActivePlan({
        id: planId,
        summary: planObj.summary,
        thinking: planObj.thinking,
        steps: planObj.steps,
        warnings: planObj.warnings,
      });
      store.setIsStreaming(false);
      break;
    }

    case 'exec_step':
    case 'step_status':
      if (data.stepId && data.status) {
        store.updateStepStatus(
          data.stepId,
          data.status as StepState,
          typeof data.error === 'object' ? data.error?.message : data.error
        );
      }
      break;

    case 'exec_done':
      store.setIsStreaming(false);
      break;

    case 'clarification':
      store.setIsStreaming(false);
      store.addMessage({
        id: `msg_clarify_${Date.now()}`,
        content: data.question || 'Vui lòng làm rõ yêu cầu:',
        role: 'assistant',
      });
      break;

    case 'refusal':
      store.setIsStreaming(false);
      store.addMessage({
        id: `refusal_${Date.now()}`,
        role: 'assistant',
        content: `Từ chối yêu cầu: ${data.reason || 'Yêu cầu không được hỗ trợ'}${data.suggestion ? `\nGợi ý: ${data.suggestion}` : ''}`,
      });
      break;

    case 'error':
      store.setIsStreaming(false);
      store.addMessage({
        id: `err_${Date.now()}`,
        role: 'system',
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

export function useSSE(conversationId: string | null, token: string | null) {
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!conversationId || !token) {
      return;
    }

    const ctrl = new AbortController();
    abortControllerRef.current = ctrl;

    const url = `/api/conversations/${conversationId}/stream`;

    fetchEventSource(url, {
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        'Last-Event-ID': (() => {
          const cursor = lastEventSeq.get(conversationId);
          if (!cursor) return '0';
          return cursor.epoch === 'legacy' ? String(cursor.seq) : `${cursor.epoch}:${cursor.seq}`;
        })(),
      },
      onmessage(ev) {
        handleSSEEvent(ev.event || 'message', ev.data, ev.id || undefined, conversationId);
      },
      onerror(err) {
        // Will auto-retry with last-event-id
        console.warn('SSE connection error, auto-retrying:', err);
      },
    });

    return () => {
      ctrl.abort();
    };
  }, [conversationId, token]);
}
