import { useEffect, useRef } from 'react';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { useChatStore } from '../store/chat-store';
import type { StepState } from '../types';

let lastEventSeq = 0;

export function handleSSEEvent(event: string, dataStr: string, seq?: number): void {
  const store = useChatStore.getState();

  if (seq !== undefined) {
    lastEventSeq = seq;
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

    case 'clarification':
      store.addMessage({
        id: `msg_clarify_${Date.now()}`,
        content: data.question || 'Vui lòng làm rõ yêu cầu:',
        role: 'assistant',
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
        'Last-Event-ID': String(lastEventSeq),
      },
      onmessage(ev) {
        const seq = ev.id ? parseInt(ev.id, 10) : undefined;
        handleSSEEvent(ev.event || 'message', ev.data, seq);
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
