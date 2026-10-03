/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { SidebarHistory } from "../../src/components/layout/SidebarHistory";
import { apiClient } from "../../src/services/api-client";
import { useChatStore } from "../../src/store/chat-store";
beforeEach(() => {
  useChatStore.getState().reset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("conversation lifecycle controls", () => {
  it("opens options with the keyboard and dismisses them without invoking an action", async () => {
    vi.spyOn(apiClient, "getConversations").mockResolvedValue({
      conversations: [{ id: "one", title: "Sprint hiện tại" }],
    });
    const archive = vi.spyOn(apiClient, "archiveConversation");
    render(<SidebarHistory currentConversationId="one" />);
    const trigger = await screen.findByRole("button", {
      name: "Tùy chọn: Sprint hiện tại",
    });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const first = screen.getByRole("button", { name: "Lưu trữ hội thoại" });
    const last = screen.getByRole("button", { name: "Xóa hội thoại" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: "Escape" });
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByRole("searchbox"));
    expect(
      screen.queryByRole("button", { name: "Lưu trữ hội thoại" }),
    ).toBeNull();
    expect(archive).not.toHaveBeenCalled();
  });
  it("requires confirmation and preserves the conversation if delete fails", async () => {
    vi.spyOn(apiClient, "getConversations").mockResolvedValue({
      conversations: [{ id: "one", title: "Công việc của tôi" }],
    });
    const remove = vi
      .spyOn(apiClient, "deleteConversation")
      .mockRejectedValue(new Error("Không xóa được"));
    render(<SidebarHistory currentConversationId="one" />);
    await screen.findByText("Công việc của tôi");
    fireEvent.click(
      screen.getByRole("button", { name: "Tùy chọn: Công việc của tôi" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Xóa hội thoại" }));
    expect(
      screen.getByRole("dialog", { name: "Xóa hội thoại?" }),
    ).toBeInTheDocument();
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận xóa" }));
    await screen.findByText("Không xóa được");
    expect(screen.getByText("Công việc của tôi")).toBeInTheDocument();
    expect(useChatStore.getState().conversations).toHaveLength(1);
  });
  it("archives only after success, shows archived history and restores from the server", async () => {
    const row = { id: "one", title: "Sprint hiện tại" };
    let archived = false;
    vi.spyOn(apiClient, "getConversations").mockImplementation(
      async (filter) => ({
        conversations:
          filter === "archived"
            ? archived
              ? [{ ...row, archived_at: "2026-10-03" }]
              : []
            : archived
              ? []
              : [row],
      }),
    );
    vi.spyOn(apiClient, "archiveConversation").mockImplementation(async () => {
      archived = true;
      return { conversation: { ...row, archived_at: "2026-10-03" } };
    });
    const restore = vi
      .spyOn(apiClient, "restoreConversation")
      .mockImplementation(async () => {
        archived = false;
        return { conversation: row };
      });
    const removed = vi.fn();
    const { rerender } = render(
      <SidebarHistory
        currentConversationId="one"
        onConversationRemoved={removed}
      />,
    );
    await screen.findByText(row.title);
    expect(screen.getByRole("region", { name: "Gần đây" })).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: `Tùy chọn: ${row.title}` }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Lưu trữ hội thoại" }));
    await waitFor(() => expect(removed).toHaveBeenCalledWith("one"));
    rerender(
      <SidebarHistory
        currentConversationId="one"
        filter="archived"
        onConversationRemoved={removed}
      />,
    );
    await screen.findByText(row.title);
    fireEvent.click(
      screen.getByRole("button", { name: `Tùy chọn: ${row.title}` }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Khôi phục hội thoại" }),
    );
    await waitFor(() => expect(restore).toHaveBeenCalledWith("one"));
    rerender(
      <SidebarHistory
        currentConversationId="one"
        onConversationRemoved={removed}
      />,
    );
    expect(await screen.findByText(row.title)).toBeInTheDocument();
  });
});
