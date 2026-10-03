/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Workspace } from "../../src/views/Workspace";
import { apiClient } from "../../src/services/api-client";
import { useChatStore } from "../../src/store/chat-store";

const props = () => ({
  user: { id: "user", name: "Linh", email: "linh@example.test" },
  services: false, onServices: vi.fn(), onWorkspace: vi.fn(), onNew: vi.fn(),
  onLanding: vi.fn(), onLogout: vi.fn(), onSelect: vi.fn(), children: <div>Workspace</div>,
});
beforeEach(() => {
  useChatStore.getState().reset();
  vi.spyOn(apiClient, "getConversations").mockResolvedValue({ conversations: [] });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Workspace sidebar utilities", () => {
  it("navigates through working callbacks without resetting conversation contents", async () => {
    useChatStore.getState().setConversationId("existing");
    useChatStore.getState().addMessage({ id: "message", role: "user", content: "Nội dung đang mở" });
    const callbacks = props();
    render(<Workspace {...callbacks} services />);
    await screen.findByText("Chưa có hội thoại nào");
    const navigation = within(screen.getByRole("navigation", { name: "Không gian làm việc" }));
    expect(navigation.getByRole("button", { name: "Dịch vụ" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(navigation.getByRole("button", { name: "Hội thoại" }));
    expect(callbacks.onWorkspace).toHaveBeenCalledOnce();
    fireEvent.click(navigation.getByRole("button", { name: "Dịch vụ" }));
    expect(callbacks.onServices).toHaveBeenCalledOnce();
    expect(useChatStore.getState().conversationId).toBe("existing");
    expect(useChatStore.getState().messages[0].content).toBe("Nội dung đang mở");
  });

  it("keeps search inside the mobile drawer and uses Escape to clear before closing", async () => {
    vi.stubGlobal("innerWidth", 390);
    render(<Workspace {...props()} />);
    await screen.findByText("Chưa có hội thoại nào");
    const opener = screen.getByRole("button", { name: "Mở danh sách hội thoại" });
    fireEvent.click(opener);
    const search = screen.getByRole("searchbox");
    search.focus();
    fireEvent.change(search, { target: { value: "trello" } });
    fireEvent.keyDown(search, { key: "Escape" });
    expect(search).toHaveValue("");
    expect(search).toHaveFocus();
    expect(opener).toHaveAttribute("aria-expanded", "true");
    screen.getByRole("button", { name: "Đăng xuất" }).focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Planora — workspace" })).toHaveFocus();
    fireEvent.keyDown(search, { key: "Escape" });
    expect(opener).toHaveAttribute("aria-expanded", "false");
    expect(opener).toHaveFocus();
  });
});
