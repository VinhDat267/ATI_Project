import { useEffect, useRef } from "react";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { useChatStore } from "../store/chat-store";
import type { GatherStep, StepState, PlanStatus } from "../types";
import { refreshExecutionSnapshot } from "../services/execution-snapshot";

const lastEventSeq = new Map<string, { epoch: string; seq: number }>();
const fallbackConversationKey = "__no_conversation__";

export function resetSSEState(): void {
  lastEventSeq.clear();
}

export function handleSSEEvent(
  event: string,
  dataStr: string,
  eventId?: number | string,
  conversationId?: string,
): void {
  const store = useChatStore.getState();
  if (conversationId && store.conversationId !== conversationId) {
    return;
  }
  const key = conversationId || store.conversationId || fallbackConversationKey;

  if (eventId !== undefined) {
    const raw = String(eventId);
    const separator = raw.lastIndexOf(":");
    const epoch = separator < 0 ? "legacy" : raw.slice(0, separator);
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

  if (
    ["exec_start", "exec_step", "step_status", "exec_done"].includes(event) &&
    data.planId &&
    (store.activePlan?.id || store.executionSnapshot?.plan.id) &&
    data.planId !== store.activePlan?.id &&
    data.planId !== store.executionSnapshot?.plan.id
  )
    return;
  const savedExecution =
    data.planId && data.planId === store.executionSnapshot?.plan.id
      ? store.executionSnapshot
      : null;

  switch (event) {
    case "text_start":
      store.setIsStreaming(true);
      store.setStreamingText("");
      break;

    case "text_delta":
      if (data.delta) {
        store.appendStreamingText(data.delta);
      }
      break;

    case "text_end":
    case "text_done":
      store.setIsStreaming(false);
      break;

    case "plan":
    case "plan_preview": {
      const planObj = data.plan || data;
      const planId = data.planId || planObj.id;
      if (planId && store.executionSnapshot?.plan.id === planId) break;
      store.setActivePlan({
        id: planId,
        summary: planObj.summary,
        thinking: planObj.thinking,
        steps: Array.isArray(planObj.steps) ? planObj.steps : [],
        warnings: planObj.warnings,
      });
      store.setPlanStatus("preview");
      store.setClarification(null);
      store.setGatherState((prev) =>
        prev ? { ...prev, isGathering: false } : null,
      );
      store.setIsStreaming(false);
      break;
    }

    case "gather_progress": {
      if (Array.isArray(data.steps)) {
        store.setGatherState((prev) => ({
          isGathering: true,
          steps: data.steps.map((s: any) => ({
            tool: s.tool,
            result:
              s.result ?? (typeof s.output === "string" ? s.output : undefined),
            status:
              s.status === "started" || s.status === "running"
                ? "running"
                : "completed",
          })),
          summary:
            data.summary ||
            prev?.summary ||
            `${data.steps.length} công cụ đã kiểm tra`,
        }));
      } else if (data.tool) {
        const tool = data.tool;
        const status: "running" | "completed" =
          data.status === "started" || data.status === "running"
            ? "running"
            : "completed";
        const result =
          typeof data.output === "string"
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
            (s) => s.status === "completed",
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
            : { isGathering: true, steps: [], summary: data.summary },
        );
      }
      break;
    }

    case "clarification": {
      store.setIsStreaming(false);
      store.setGatherState((prev) =>
        prev ? { ...prev, isGathering: false } : null,
      );
      store.setClarification({
        question: data.question || "Vui lòng làm rõ yêu cầu:",
        options: Array.isArray(data.options) ? data.options : [],
        context: data.context,
      });
      break;
    }

    case "exec_start":
      if (savedExecution) {
        store.setExecutionSnapshot({
          ...savedExecution,
          plan: { ...savedExecution.plan, status: "executing" },
          execution: { status: "executing" },
          recoveryActions: ["stop"],
        });
      } else {
        store.setExecutionSnapshot(null);
        store.setPlanStatus("executing");
      }
      break;

    case "exec_step":
    case "step_status":
      if (data.stepId && data.status) {
        if (savedExecution) {
          store.setExecutionSnapshot({
            ...savedExecution,
            steps: savedExecution.steps.map((row) =>
              row.stepId !== data.stepId
                ? row
                : {
                    ...row,
                    status: data.status as StepState,
                    ...(Object.hasOwn(data, "output")
                      ? { output: data.output }
                      : {}),
                    ...(Object.hasOwn(data, "error")
                      ? { error: data.error }
                      : ["running", "succeeded"].includes(data.status)
                        ? { error: undefined }
                        : {}),
                  },
            ),
          });
        } else {
          store.updateStepStatus(
            data.stepId,
            data.status as StepState,
            typeof data.error === "object" ? data.error?.message : data.error,
          );
        }
      }
      break;

    case "exec_done": {
      const status = (
        [
          "completed",
          "partial",
          "reconciliation_required",
          "stopped",
          "failed",
        ].includes(data.status)
          ? data.status
          : "completed"
      ) as PlanStatus;
      if (savedExecution) {
        store.setExecutionSnapshot({
          ...savedExecution,
          plan: { ...savedExecution.plan, status },
          execution: {
            status,
            ...(data.pausedAtStepId
              ? { pausedStepId: data.pausedAtStepId }
              : {}),
          },
          recoveryActions: ["completed", "stopped", "failed"].includes(status)
            ? []
            : ["stop"],
        });
        if (store.activePlan?.id === data.planId) store.setIsStreaming(false);
      } else {
        store.setIsStreaming(false);
        store.setPlanStatus(status);
      }
      break;
    }

    case "refusal":
      store.setIsStreaming(false);
      store.setClarification(null);
      store.setGatherState((prev) =>
        prev ? { ...prev, isGathering: false } : null,
      );
      store.setPlanStatus("rejected");
      store.addMessage({
        id: `refusal_${Date.now()}`,
        role: "assistant",
        content: `Từ chối yêu cầu: ${data.reason || "Yêu cầu không được hỗ trợ"}${
          data.suggestion ? `\nGợi ý: ${data.suggestion}` : ""
        }`,
      });
      break;

    case "error":
      store.setIsStreaming(false);
      store.setGatherState((prev) =>
        prev ? { ...prev, isGathering: false } : null,
      );
      store.addMessage({
        id: `err_${Date.now()}`,
        role: "system",
        content: `Lỗi: ${data.message || data.error || "Có lỗi xảy ra trong quá trình xử lý"}`,
      });
      break;

    case "message_confirmed":
      if (data.tempId && data.confirmedId) {
        store.confirmMessage(data.tempId, data.confirmedId);
      }
      break;

    case "message_failed":
      if (data.tempId) {
        store.markMessageFailed(data.tempId);
      }
      break;

    case "sync":
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
        "Last-Event-ID": (() => {
          const cursor = lastEventSeq.get(conversationId);
          if (!cursor) return "0";
          return cursor.epoch === "legacy"
            ? String(cursor.seq)
            : `${cursor.epoch}:${cursor.seq}`;
        })(),
      },
      async onopen(res) {
        if (res.status === 401 || res.status === 403) {
          ctrl.abort();
          throw new Error(`SSE auth failed (${res.status})`);
        }
        const contentType =
          res.headers?.get?.("content-type") ||
          (res.headers as any)?.["content-type"];
        if (res.ok && contentType?.includes("text/event-stream")) {
          // Reconnect after an API restart has no guarantee of a replayable cursor.
          void refreshExecutionSnapshot(conversationId).catch(() => {});
          return;
        }
        if (res.status >= 400 && res.status < 500) {
          ctrl.abort();
          throw new Error(`SSE client error (${res.status})`);
        }
        throw new Error(
          `Expected text/event-stream, got ${contentType || "none"} (${res.status})`,
        );
      },
      onmessage(ev) {
        handleSSEEvent(
          ev.event || "message",
          ev.data,
          ev.id || undefined,
          conversationId,
        );
        if (ev.event === "exec_done") {
          void refreshExecutionSnapshot(conversationId).catch(() => {});
        }
      },
      onerror(err) {
        if (
          ctrl.signal.aborted ||
          String(err).includes("SSE auth failed") ||
          String(err).includes("SSE client error") ||
          String(err).includes("getReader") ||
          String(err).includes("Expected text/event-stream")
        ) {
          throw err;
        }
        console.warn("SSE connection error, auto-retrying:", err);
      },
    }).catch((err) => {
      if (ctrl.signal.aborted) return;
      console.warn("SSE stream closed:", err?.message || err);
    });

    return () => {
      ctrl.abort();
    };
  }, [conversationId, token]);
}
