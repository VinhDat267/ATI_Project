import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { App } from "../src/App";
import { apiClient } from "../src/services/api-client";
import { authStorage } from "../src/services/auth-storage";
import { useChatStore } from "../src/store/chat-store";
import { handleSSEEvent, resetSSEState } from "../src/hooks/use-sse";
import type { ActivePlan, ExecutionSnapshot } from "../src/types";

// Exercise the actual useSSE onopen callback, with only the transport/API boundary controlled.
vi.mock("@microsoft/fetch-event-source", () => ({
  fetchEventSource: vi.fn(async () => {}),
}));
const saved: ExecutionSnapshot = {
  plan: {
    id: "old",
    convId: "c1",
    summary: "Old execution",
    status: "reconciliation_required",
    steps: [],
  },
  execution: { status: "reconciliation_required" },
  steps: [],
  recoveryActions: ["stop"],
};
let finishPreview: (plan: ActivePlan) => void;
beforeEach(() => {
  window.history.replaceState({}, "", "/?view=workspace");
  useChatStore.getState().reset();
  useChatStore.getState().setConversations([]);
  resetSSEState();
  const user = { id: "u1", email: "fixture@example.test", name: "Fixture" };
  authStorage.setStoredTokens({ accessToken: "fixture-token", user });
  vi.spyOn(apiClient, "getMe").mockResolvedValue({ user });
  vi.spyOn(apiClient, "getConversations").mockResolvedValue({
    conversations: [{ id: "c1", title: "History" }],
  });
  vi.spyOn(apiClient, "getConversation").mockResolvedValue({
    conversation: { id: "c1" },
    messages: [{ id: "m1", role: "user", content: "Saved message" }],
  });
  vi.spyOn(apiClient, "getActivePlan").mockImplementation(
    () =>
      new Promise((resolve) => {
        finishPreview = resolve;
      }),
  );
  vi.spyOn(apiClient, "getLatestExecutionSnapshot").mockResolvedValue(saved);
});
afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/?view=workspace");
  vi.restoreAllMocks();
  vi.clearAllMocks();
  authStorage.clearStoredTokens();
});
async function selectHistory() {
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "History" }));
  await waitFor(() => expect(fetchEventSource).toHaveBeenCalled());
  await waitFor(() => expect(apiClient.getActivePlan).toHaveBeenCalled());
  return vi.mocked(fetchEventSource).mock.calls.at(-1)![1];
}
async function connect(options: Awaited<ReturnType<typeof selectHistory>>) {
  await act(async () => {
    await options.onopen!(
      new Response("", { headers: { "content-type": "text/event-stream" } }),
    );
  });
  await waitFor(() =>
    expect(useChatStore.getState().executionSnapshot?.plan.id).toBe("old"),
  );
}
describe("history pending plan alongside SSE snapshot connection", () => {
  it("keeps the pending preview when SSE snapshot finishes first", async () => {
    const options = await selectHistory();
    await connect(options);
    await act(async () =>
      finishPreview({ id: "new", summary: "New pending", steps: [] }),
    );
    await waitFor(() =>
      expect(useChatStore.getState().activePlan?.id).toBe("new"),
    );
    expect(screen.getByText("New pending")).toBeInTheDocument();
    expect(useChatStore.getState().executionSnapshot?.plan.id).toBe("old");
  });
  it("keeps the pending preview when its GET finishes before SSE snapshot", async () => {
    const options = await selectHistory();
    await act(async () =>
      finishPreview({ id: "new", summary: "New pending", steps: [] }),
    );
    await connect(options);
    expect(useChatStore.getState().activePlan?.id).toBe("new");
    expect(useChatStore.getState().planStatus).toBe("preview");
  });
  it("still rejects a pending GET overtaken by a newer SSE preview", async () => {
    await selectHistory();
    act(() =>
      handleSSEEvent(
        "plan_preview",
        JSON.stringify({ planId: "newest", summary: "Newest", steps: [] }),
        undefined,
        "c1",
      ),
    );
    await act(async () =>
      finishPreview({ id: "stale-preview", summary: "Stale", steps: [] }),
    );
    expect(useChatStore.getState().activePlan?.id).toBe("newest");
    expect(screen.queryByText("Stale")).toBeNull();
  });
  it("does not restore pending approval for the same already executed snapshot", async () => {
    const options = await selectHistory();
    await connect(options);
    let finishRead!: (value: ExecutionSnapshot | null) => void;
    vi.mocked(apiClient.getLatestExecutionSnapshot).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        }),
    );
    await act(async () =>
      finishPreview({
        id: "old",
        summary: "Stale pending",
        status: "pending",
        steps: [],
      }),
    );
    expect(useChatStore.getState().planStatus).toBe("reconciliation_required");
    expect(screen.queryByRole("button", { name: /Duyệt kế hoạch/ })).toBeNull();
    await act(async () => finishRead(saved));
  });
  it("does not restore pending approval after SSE has started that execution", async () => {
    const options = await selectHistory();
    await connect(options);
    act(() =>
      handleSSEEvent(
        "exec_start",
        JSON.stringify({ planId: "old" }),
        undefined,
        "c1",
      ),
    );
    let finishRead!: (value: ExecutionSnapshot | null) => void;
    vi.mocked(apiClient.getLatestExecutionSnapshot).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        }),
    );
    await act(async () =>
      finishPreview({
        id: "old",
        summary: "Stale pending",
        status: "pending",
        steps: [],
      }),
    );
    expect(useChatStore.getState().planStatus).toBe("executing");
    expect(screen.queryByRole("button", { name: /Duyệt kế hoạch/ })).toBeNull();
    await act(async () =>
      finishRead({ ...saved, execution: { status: "executing" } }),
    );
  });
});
