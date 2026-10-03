import { useChatStore } from "../store/chat-store";
import { apiClient } from "./api-client";
import { refreshExecutionSnapshot } from "./execution-snapshot";
import { userError } from "./user-error";
let ticket = 0;
export async function openConversation(id: string) {
  const selected = ++ticket;
  const store = useChatStore.getState();
  store.reset();
  store.setConversationId(id);
  const current = () =>
    selected === ticket && useChatStore.getState().conversationId === id;
  try {
    const data = await apiClient.getConversation(id);
    if (!current()) return false;
    store.setConversationArchived(Boolean(data.conversation?.archived_at));
    for (const m of data.messages || []) {
      if (m.metadata?.type === "working_memory" && !m.content) continue;
      store.addMessage({ ...m, timestamp: m.created_at || m.timestamp });
    }
    try {
      const revision = useChatStore.getState().planRevision;
      const plan = await apiClient.getActivePlan(id);
      if (!current()) return false;
      const state = useChatStore.getState();
      const executed =
        plan?.id &&
        (state.executionSnapshot?.plan.id === plan.id ||
          (state.activePlan?.id === plan.id &&
            [
              "executing",
              "partial",
              "reconciliation_required",
              "completed",
              "stopped",
              "failed",
            ].includes(state.planStatus)));
      if (plan && state.planRevision === revision && !executed) {
        store.setActivePlan(plan);
        const status = plan.status;
        store.setPlanStatus(
          !status || status === "pending"
            ? "preview"
            : status === "approved"
              ? "executing"
              : status,
        );
      }
    } catch (e) {
      if (current()) store.setExecutionLoadError(userError(e));
    }
    if (!current()) return false;
    await refreshExecutionSnapshot(id);
    return current();
  } catch (e) {
    if (current())
      store.addMessage({
        id: "load-error-" + Date.now(),
        role: "system",
        content: "Không mở được hội thoại: " + userError(e),
      });
    return false;
  }
}
