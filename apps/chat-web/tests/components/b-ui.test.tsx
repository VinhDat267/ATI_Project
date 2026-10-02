import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { ChatContainer } from "../../src/components/ChatContainer";
import { PlanPreview } from "../../src/components/PlanPreview";
import { ExecutionProgress } from "../../src/components/ExecutionProgress";
import { PartialFailureModal } from "../../src/components/PartialFailureModal";
import { LoginView } from "../../src/components/LoginView";
import { useChatStore } from "../../src/store/chat-store";
import { handleSSEEvent } from "../../src/hooks/use-sse";

afterEach(() => {
  cleanup();
  useChatStore.getState().reset();
});

describe("approved B interface behavior", () => {
  it("unblocks the composer when gathering asks for clarification", () => {
    useChatStore.getState().setIsStreaming(true);
    useChatStore
      .getState()
      .setGatherState({ isGathering: true, summary: "Đang tìm", steps: [] });
    handleSSEEvent(
      "clarification",
      JSON.stringify({ question: "Bạn muốn dùng kênh nào?" }),
    );
    render(<ChatContainer messages={[]} onSendMessage={vi.fn()} />);
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "Mô tả công việc bạn muốn thực hiện",
      }),
      { target: { value: "Câu trả lời" } },
    );
    expect(
      within(
        screen
          .getByRole("textbox", { name: "Mô tả công việc bạn muốn thực hiện" })
          .closest("form")!,
      ).getByRole("button", { name: "Gửi" }),
    ).toBeEnabled();
    expect(useChatStore.getState().gatherState?.isGathering).toBe(false);
  });
  it("uses a multiline composer and a live conversation landmark", () => {
    const send = vi.fn();
    render(<ChatContainer messages={[]} onSendMessage={send} />);
    const input = screen.getByRole("textbox", {
      name: "Mô tả công việc bạn muốn thực hiện",
    });
    expect(input.tagName).toBe("TEXTAREA");
    expect(screen.getByRole("log")).toHaveAttribute("aria-live", "polite");
    fireEvent.change(input, { target: { value: "Dòng một\nDòng hai" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(send).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(send).toHaveBeenCalledWith("Dòng một\nDòng hai");
  });
  it("does not submit a second message while preparing a plan", () => {
    useChatStore.getState().setIsStreaming(true);
    const send = vi.fn();
    render(<ChatContainer messages={[]} onSendMessage={send} isStreaming />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Không gửi trùng" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("button", { name: "Gửi" })).toBeDisabled();
    expect(send).not.toHaveBeenCalled();
  });
  it("does not submit while committing Vietnamese IME composition", () => {
    const send = vi.fn();
    render(<ChatContainer messages={[]} onSendMessage={send} />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Tiếng Việt" },
    });
    fireEvent.keyDown(screen.getByRole("textbox"), {
      key: "Enter",
      isComposing: true,
      keyCode: 229,
    });
    expect(send).not.toHaveBeenCalled();
  });
  it("blocks approval when the server did not supply a plan id", () => {
    render(
      <PlanPreview
        plan={{ summary: "Chưa có ID", steps: [] }}
        onApprove={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /Duyệt/ })).toBeDisabled();
  });
  it("shows readable result links and rejects unsafe schemes", () => {
    render(
      <ExecutionProgress
        steps={[
          {
            id: "s1",
            tool: "trello.create_card",
            description: "Tạo thẻ",
            status: "succeeded",
            output: JSON.stringify({
              title: "Thẻ thật",
              url: "https://trello.com/c/example",
            }),
          },
          {
            id: "s2",
            tool: "slack.send_message",
            description: "Gửi tin",
            status: "succeeded",
            output: JSON.stringify({ url: "javascript:alert(1)" }),
          },
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: /Xem kết quả/ })).toHaveAttribute(
      "href",
      "https://trello.com/c/example",
    );
    expect(screen.getByRole("link", { name: /Xem kết quả/ })).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
  it("never stops an execution when a recovery dialog is dismissed", () => {
    const stop = vi.fn();
    render(
      <PartialFailureModal
        stepId="s2"
        tool="trello.create_card"
        errorMessage="Lỗi"
        onStop={stop}
        onRetry={vi.fn()}
        onSkip={vi.fn()}
        onEditAndRetry={vi.fn()}
      />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Đóng hộp thoại" }));
    expect(stop).not.toHaveBeenCalled();
  });
  it("does not offer stored/default administrator credentials on the login page", () => {
    render(
      <LoginView
        email=""
        password=""
        setEmail={vi.fn()}
        setPassword={vi.fn()}
        onLogin={vi.fn()}
        authError={null}
        isLoggingIn={false}
      />,
    );
    expect(screen.queryByRole("button", { name: /Điền nhanh/ })).toBeNull();
    expect(screen.getByLabelText("Mật khẩu")).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
  });
});
