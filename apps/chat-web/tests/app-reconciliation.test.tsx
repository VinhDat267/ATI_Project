import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { App } from "../src/App";
import { useChatStore } from "../src/store/chat-store";
import { apiClient } from "../src/services/api-client";
import { authStorage } from "../src/services/auth-storage";

vi.mock("../src/hooks/use-sse", () => ({ useSSE: vi.fn() }));
const user = { id: "u1", email: "fixture@example.test", name: "Fixture" };
const plan = {
  id: "p1",
  convId: "c1",
  summary: "Quy trình đã lưu",
  status: "reconciliation_required",
  steps: [
    {
      id: "step_1",
      tool: "trello.create_card",
      description: "Tạo thẻ",
      args: { title: "Task đã tạo" },
    },
    {
      id: "step_2",
      tool: "trello.add_member",
      description: "Gán Minh vào thẻ",
      args: { cardId: { $ref: "step_1.output.id" }, memberId: "minh" },
    },
    {
      id: "step_3",
      tool: "slack.send_message",
      description: "Thông báo Slack",
      args: { text: { $template: "Task: ${step_1.output.url}" } },
    },
  ],
};
const original = {
  plan,
  execution: { status: "reconciliation_required", pausedStepId: "step_2" },
  steps: [
    {
      stepId: "step_1",
      tool: "trello.create_card",
      status: "succeeded",
      output: { id: "saved-card-123", url: "https://trello.com/c/saved" },
      durationMs: 250,
    },
    {
      stepId: "step_2",
      tool: "trello.add_member",
      status: "unknown",
      error: { message: "Interrupted write" },
    },
    { stepId: "step_3", tool: "slack.send_message", status: "pending" },
  ],
  recoveryActions: ["skip", "stop"],
};
let snapshot: any;
let post: (url: string) => Promise<any>;
let request: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  window.history.replaceState({}, "", "/?view=workspace");
  useChatStore.getState().reset();
  useChatStore.getState().setConversations([]);
  authStorage.clearStoredTokens();
  authStorage.setStoredTokens({ accessToken: "fixture-jwt", user });
  snapshot = structuredClone(original);
  post = async (url) => {
    snapshot.execution = {
      status: url.endsWith("/stop") ? "stopped" : "completed",
    };
    snapshot.plan.status = snapshot.execution.status;
    snapshot.recoveryActions = [];
    if (!url.endsWith("/stop")) {
      snapshot.steps[1].status = "skipped";
      snapshot.steps[2].status = "succeeded";
    }
    return snapshot.execution;
  };
  request = vi
    .spyOn(apiClient, "request")
    .mockImplementation(async (url, options = {}) => {
      if (options.method === "POST") return post(url);
      if (url === "/api/auth/me") return { user };
      if (url === "/api/conversations")
        return {
          conversations: [
            { id: "c1", title: "Đối soát đã lưu" },
            { id: "c2", title: "Hội thoại khác" },
          ],
        };
      if (url === "/api/conversations/c1")
        return {
          conversation: { id: "c1" },
          messages: [
            {
              id: "m1",
              role: "user",
              content: "Yêu cầu trước restart",
              created_at: "2026-09-30T01:07:00.000Z",
            },
          ],
        };
      if (url === "/api/conversations/c2")
        return {
          conversation: { id: "c2" },
          messages: [{ id: "m2", role: "user", content: "Hội thoại B" }],
        };
      if (url === "/api/conversations/c1/executions/latest") return snapshot;
      throw Object.assign(new Error("Not found"), { status: 404 });
    });
});
afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/?view=workspace");
  vi.restoreAllMocks();
  authStorage.clearStoredTokens();
});

async function openHistory() {
  render(<App />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Đối soát đã lưu" }),
  );
  return screen.findByRole("region", {
    name: "Cần đối soát trước khi tiếp tục",
  });
}

describe("saved execution recovery in the actual App/history flow", () => {
  it("restores a conversation on browser Back within the same workspace view", async () => {
    await openHistory();
    fireEvent.click(screen.getByRole("button", { name: "Hội thoại khác" }));
    await screen.findByText("Hội thoại B");
    window.history.replaceState({}, "", "/?view=workspace&c=c1");
    fireEvent.popState(window);
    await waitFor(() =>
      expect(useChatStore.getState().conversationId).toBe("c1"),
    );
    expect(
      await screen.findByText("Yêu cầu trước restart"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Hội thoại B")).toBeNull();
  });
  it("offers Continue only for safe pending snapshot and posts to its execution", async () => {
    snapshot.execution = { status: "reconciliation_required" };
    snapshot.steps[1].status = "pending";
    snapshot.recoveryActions = ["continue", "stop"];
    const notice = await openHistory();
    expect(within(notice).getByText(/chưa từng được gửi/)).toBeInTheDocument();
    expect(within(notice).queryByText(/tự kiểm tra trên/)).toBeNull();
    const button = within(notice).getByRole("button", {
      name: "Chạy tiếp các bước còn lại",
    });
    let release!: () => void;
    post = async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      snapshot.execution = { status: "completed" };
      snapshot.plan.status = "completed";
      snapshot.steps[1].status = "succeeded";
      snapshot.steps[2].status = "succeeded";
      snapshot.recoveryActions = [];
      return snapshot.execution;
    };
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button);
    expect(
      within(notice).getByRole("button", { name: "Dừng plan" }),
    ).toBeDisabled();
    expect(
      request.mock.calls
        .filter((call: any[]) => call[1]?.method === "POST")
        .map((call: any[]) => call[0]),
    ).toEqual(["/api/executions/p1/continue"]);
    expect(screen.queryByText("Quy trình đã hoàn thành.")).toBeNull();
    await act(async () => {
      release();
    });
    expect(
      await screen.findByText("Quy trình đã hoàn thành."),
    ).toBeInTheDocument();
  });

  it("never offers Continue for UNKNOWN even when server actions are inconsistent", async () => {
    snapshot.recoveryActions = ["continue", "skip", "stop"];
    const notice = await openHistory();
    expect(
      within(notice).queryByRole("button", {
        name: "Chạy tiếp các bước còn lại",
      }),
    ).toBeNull();
    expect(
      within(notice).getByRole("button", {
        name: "Skip step này rồi chạy tiếp",
      }),
    ).toBeEnabled();
  });

  it("keeps safe pending snapshot after Continue returns conflict", async () => {
    snapshot.execution = { status: "reconciliation_required" };
    snapshot.steps[1].status = "pending";
    snapshot.recoveryActions = ["continue", "stop"];
    post = async () => {
      throw new Error("Execution changed");
    };
    const notice = await openHistory();
    fireEvent.click(
      within(notice).getByRole("button", {
        name: "Chạy tiếp các bước còn lại",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Execution changed",
    );
    expect(screen.queryByText("Quy trình đã hoàn thành.")).toBeNull();
    expect(useChatStore.getState().executionSnapshot?.execution.status).toBe(
      "reconciliation_required",
    );
  });

  it("loads UNKNOWN, saved output/args, no retry or approval, and preserves raw history time", async () => {
    const notice = await openHistory();
    expect(within(notice).getByText("trello.add_member")).toBeInTheDocument();
    expect(within(notice).getByText("Gán Minh vào thẻ")).toBeInTheDocument();
    expect(within(notice).getByText(/saved-card-123/)).toBeInTheDocument();
    expect(within(notice).getByText(/kiểm tra.*Trello/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /thử lại|retry|Duyệt kế hoạch/i }),
    ).toBeNull();
    expect(
      within(notice).getByRole("button", {
        name: "Skip step này rồi chạy tiếp",
      }),
    ).toBeEnabled();
    expect(
      within(notice).getByRole("button", { name: "Dừng plan" }),
    ).toBeEnabled();
    expect(useChatStore.getState().messages[0].timestamp).toBe(
      "2026-09-30T01:07:00.000Z",
    );
    expect(screen.getByText("0.25s")).toBeInTheDocument();
  });

  it("skips exactly the paused UNKNOWN through the API and refreshes completion", async () => {
    const notice = await openHistory();
    let finish!: () => void;
    const pending = new Promise((resolve) => {
      finish = () => {
        snapshot = structuredClone(original);
        snapshot.execution = { status: "completed" };
        snapshot.plan.status = "completed";
        snapshot.steps[1].status = "skipped";
        snapshot.steps[2].status = "succeeded";
        snapshot.recoveryActions = [];
        resolve({ status: "completed" });
      };
    });
    post = async () => pending;
    const skip = within(notice).getByRole("button", {
      name: "Skip step này rồi chạy tiếp",
    });
    fireEvent.click(skip);
    fireEvent.click(skip);
    expect(skip).toBeDisabled();
    expect(
      within(notice).getByRole("button", { name: "Dừng plan" }),
    ).toBeDisabled();
    await act(async () => finish());
    expect(
      await screen.findByText("Quy trình đã hoàn thành."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Cần đối soát trước khi tiếp tục" }),
    ).toBeNull();
    const writes = request.mock.calls.filter(
      ([, options]: [string, RequestInit?]) => options?.method === "POST",
    );
    expect(writes).toEqual([
      ["/api/executions/p1/steps/step_2/skip", { method: "POST" }],
    ]);
    expect(useChatStore.getState().stepStatuses).toMatchObject({
      step_1: "succeeded",
      step_2: "skipped",
      step_3: "succeeded",
    });
  });

  it("keeps UNKNOWN and exposes API conflict instead of optimistic success", async () => {
    post = async () => {
      throw Object.assign(new Error("Execution changed; reload required"), {
        status: 409,
      });
    };
    const notice = await openHistory();
    fireEvent.click(
      within(notice).getByRole("button", {
        name: "Skip step này rồi chạy tiếp",
      }),
    );
    expect(await within(notice).findByRole("alert")).toHaveTextContent(
      "Execution changed; reload required",
    );
    expect(useChatStore.getState().stepStatuses.step_2).toBe("unknown");
    expect(screen.queryByText("Quy trình đã hoàn thành.")).toBeNull();
    expect(
      within(notice).getByRole("button", {
        name: "Skip step này rồi chạy tiếp",
      }),
    ).toBeEnabled();
  });

  it("stops using the saved plan ID and retains UNKNOWN evidence without recovery controls", async () => {
    const notice = await openHistory();
    fireEvent.click(within(notice).getByRole("button", { name: "Dừng plan" }));
    expect(
      request.mock.calls.filter((call: any[]) => call[1]?.method === "POST"),
    ).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận dừng" }));
    expect(await screen.findByText("Quy trình đã dừng.")).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith("/api/executions/p1/stop", {
      method: "POST",
    });
    expect(useChatStore.getState().stepStatuses.step_2).toBe("unknown");
    expect(
      screen.queryByRole("button", { name: "Skip step này rồi chạy tiếp" }),
    ).toBeNull();
  });

  it("obeys Stop-only even when saved step evidence contains UNKNOWN", async () => {
    snapshot.plan = {
      id: "p1",
      convId: "c1",
      status: "reconciliation_required",
    };
    snapshot.recoveryActions = ["stop"];
    const notice = await openHistory();
    expect(within(notice).getByText("trello.add_member")).toBeInTheDocument();
    expect(
      within(notice).queryByRole("button", {
        name: "Skip step này rồi chạy tiếp",
      }),
    ).toBeNull();
    expect(
      within(notice).getByRole("button", { name: "Dừng plan" }),
    ).toBeEnabled();
  });

  it("does not let an older conversation response replace the newer selection", async () => {
    let finish!: (value: any) => void;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    const originalRequest = request.getMockImplementation()!;
    request.mockImplementation((url: string, options?: RequestInit) =>
      url === "/api/conversations/c1" ? pending : originalRequest(url, options),
    );
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Đối soát đã lưu" }),
    );
    fireEvent.click(screen.getByText("Hội thoại khác"));
    await screen.findByText("Hội thoại B");
    await act(async () =>
      finish({
        conversation: { id: "c1" },
        messages: [{ id: "late", content: "Late A", role: "user" }],
      }),
    );
    await waitFor(() =>
      expect(useChatStore.getState().conversationId).toBe("c2"),
    );
    expect(screen.queryByText("Late A")).toBeNull();
  });

  it("preserves a newer pending preview and targets the older UNKNOWN execution ID", async () => {
    const originalRequest = request.getMockImplementation()!;
    request.mockImplementation((url: string, options?: RequestInit) =>
      url === "/api/conversations/c1/plans/active"
        ? Promise.resolve({
            id: "new-plan",
            summary: "Kế hoạch tiếp theo",
            steps: [],
          })
        : originalRequest(url, options),
    );
    const notice = await openHistory();
    expect(screen.getByText("Kế hoạch tiếp theo")).toBeInTheDocument();
    fireEvent.click(within(notice).getByRole("button", { name: "Dừng plan" }));
    expect(
      request.mock.calls.filter((call: any[]) => call[1]?.method === "POST"),
    ).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận dừng" }));
    await screen.findByText("Quy trình đã dừng.");
    expect(request).toHaveBeenCalledWith("/api/executions/p1/stop", {
      method: "POST",
    });
    expect(useChatStore.getState().activePlan?.id).toBe("new-plan");
  });

  it("offers only permitted actions for a saved partial failure and disables duplicate requests", async () => {
    snapshot.execution = { status: "partial", pausedStepId: "step_2" };
    snapshot.plan.status = "partial";
    snapshot.steps[1].status = "failed";
    snapshot.recoveryActions = ["stop"];
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Đối soát đã lưu" }),
    );
    const modal = await screen.findByRole("alertdialog");
    expect(
      within(modal).queryByRole("button", {
        name: /Thử lại|Sửa & tiếp tục|Bỏ qua/,
      }),
    ).toBeNull();
    let finish!: () => void;
    post = () =>
      new Promise((resolve) => {
        finish = () => resolve({ status: "stopped" });
      });
    fireEvent.click(
      within(modal).getByRole("button", { name: /Dừng lại toàn bộ/ }),
    );
    expect(
      request.mock.calls.filter((call: any[]) => call[1]?.method === "POST"),
    ).toHaveLength(0);
    fireEvent.click(
      within(modal).getByRole("button", { name: "Xác nhận dừng" }),
    );
    expect(
      within(modal).getByRole("button", { name: /Dừng lại toàn bộ/ }),
    ).toBeDisabled();
    await act(async () => finish());
  });

  it("reconstructs wrapped, whole-output, null and whitespace-template arguments faithfully", async () => {
    const output = { output: { id: "nested-card", optional: null } };
    snapshot.steps[0].output = output;
    snapshot.plan.steps[1].args = {
      wrapper: { $ref: "step_1.output.id" },
      whole: { $ref: "step_1" },
      nullable: { $ref: "step_1.output.optional" },
      text: { $template: "Card ${ step_1.output.id }" },
    };
    const notice = await openHistory();
    expect(JSON.parse(notice.querySelector("pre")!.textContent!)).toEqual({
      wrapper: "nested-card",
      whole: output,
      nullable: null,
      text: "Card nested-card",
    });
  });

  it("describes and retries the saved partial execution even with a newer preview sharing step IDs", async () => {
    snapshot.execution = { status: "partial", pausedStepId: "step_2" };
    snapshot.plan.status = "partial";
    snapshot.steps[1].status = "failed";
    snapshot.recoveryActions = ["retry", "skip", "stop"];
    const originalRequest = request.getMockImplementation()!;
    request.mockImplementation((url: string, options?: RequestInit) =>
      url === "/api/conversations/c1/plans/active"
        ? Promise.resolve({
            id: "new-plan",
            summary: "New pending",
            steps: [
              {
                id: "step_2",
                tool: "slack.send_message",
                description: "NEW operation",
                args: { text: "NEW arguments" },
              },
            ],
          })
        : originalRequest(url, options),
    );
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Đối soát đã lưu" }),
    );
    const modal = await screen.findByRole("alertdialog");
    expect(within(modal).getByText("trello.add_member")).toBeInTheDocument();
    expect(within(modal).getByText("Gán Minh vào thẻ")).toBeInTheDocument();
    expect(within(modal).getByTestId("step-args-preview")).toHaveTextContent(
      "minh",
    );
    expect(within(modal).queryByText("NEW operation")).toBeNull();
    fireEvent.click(
      within(modal).getByRole("button", { name: /Thử lại bước này/ }),
    );
    await screen.findByText("Quy trình đã hoàn thành.");
    expect(request).toHaveBeenCalledWith(
      "/api/executions/p1/steps/step_2/retry",
      { method: "POST" },
    );
    expect(useChatStore.getState().activePlan?.id).toBe("new-plan");
  });

  it("lets a fresh partial UNKNOWN use the same safe reconciliation actions", async () => {
    snapshot.execution.status = "partial";
    snapshot.plan.status = "partial";
    const notice = await openHistory();
    expect(within(notice).getByText("trello.add_member")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Thử lại|retry/i })).toBeNull();
    fireEvent.click(
      within(notice).getByRole("button", {
        name: "Skip step này rồi chạy tiếp",
      }),
    );
    await screen.findByText("Quy trình đã hoàn thành.");
    expect(request).toHaveBeenCalledWith(
      "/api/executions/p1/steps/step_2/skip",
      { method: "POST" },
    );
  });
});
