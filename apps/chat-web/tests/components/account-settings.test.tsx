/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import AccountSettingsView from "../../src/views/AccountSettingsView";
import { apiClient } from "../../src/services/api-client";
import { useChatStore } from "../../src/store/chat-store";
import { ViewBoundary } from "../../src/components/ViewBoundary";
const user = { id: "u", name: "Linh", email: "linh@example.test" };
const props = () => ({ user, mode: "sandbox", currentConversationId: null, onOpenConversation: vi.fn(), onConversationRemoved: vi.fn(), onServices: vi.fn(), onLogout: vi.fn() });
afterEach(() => { cleanup(); vi.restoreAllMocks(); useChatStore.getState().reset(); window.history.replaceState({}, "", "/"); });
describe("account settings", () => {
  it("shows an accurate recoverable error if the settings view fails", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const BrokenView = () => { throw new Error("Settings chunk failed"); };
    render(<ViewBoundary label="cài đặt tài khoản"><BrokenView /></ViewBoundary>);
    expect(screen.getByRole("alert")).toHaveTextContent("Không tải được giao diện cài đặt tài khoản.");
    expect(screen.getByRole("button", { name: "Tải lại trang" })).toBeInTheDocument();
  });
  it("shows actual account data and routes working service/logout actions without an unsupported edit form", () => {
    window.history.replaceState({}, "", "/?view=settings&section=untrusted");
    const actions = props();
    render(<AccountSettingsView {...actions} />);
    expect(screen.getByText(user.email)).toBeInTheDocument();
    expect(screen.getByText("Thử nghiệm")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Quản lý dịch vụ/ }));
    expect(actions.onServices).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: /Đăng xuất trên thiết bị này/ }));
    expect(actions.onLogout).toHaveBeenCalledOnce();
  });
  it("loads the URL section and restores deleted conversations only after API success", async () => {
    window.history.replaceState({}, "", "/?view=settings&section=deleted&c=existing");
    const row = { id: "deleted-one", title: "Hội thoại cần khôi phục", deleted_at: "2026-10-03" };
    const list = vi.spyOn(apiClient, "getConversations").mockResolvedValue({ conversations: [row] });
    const restore = vi.spyOn(apiClient, "restoreConversation").mockRejectedValueOnce(new Error("Không khôi phục được"));
    render(<AccountSettingsView {...props()} />);
    expect(await screen.findByRole("button", { name: row.title })).toBeDisabled();
    expect(list).toHaveBeenCalledWith("deleted");
    fireEvent.click(screen.getByRole("button", { name: `Tùy chọn: ${row.title}` }));
    fireEvent.click(screen.getByRole("button", { name: "Khôi phục hội thoại" }));
    expect(await screen.findByText("Không khôi phục được")).toBeInTheDocument();
    expect(useChatStore.getState().conversations.some(c => c.id === row.id)).toBe(false);
    expect(screen.getByRole("button", { name: row.title })).toBeInTheDocument();
    restore.mockResolvedValue({ conversation: { id: row.id, deleted_at: null } });
    list.mockResolvedValue({ conversations: [] });
    fireEvent.click(screen.getByRole("button", { name: "Khôi phục hội thoại" }));
    await waitFor(() => expect(useChatStore.getState().conversations[0]?.id).toBe(row.id));
    expect(useChatStore.getState().conversations[0]?.title).toBe(row.title);
    expect(await screen.findByText("Chưa có hội thoại đã xóa")).toBeInTheDocument();
  });
  it("preserves the conversation URL and responds to section navigation and browser history", async () => {
    window.history.replaceState({}, "", "/?view=settings&c=existing");
    vi.spyOn(apiClient, "getConversations").mockResolvedValue({ conversations: [] });
    render(<AccountSettingsView {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: /Lưu trữ/ }));
    expect(await screen.findByText("Chưa có hội thoại lưu trữ")).toBeInTheDocument();
    expect(new URLSearchParams(location.search).get("c")).toBe("existing");
    expect(new URLSearchParams(location.search).get("section")).toBe("archived");
    act(() => { window.history.replaceState({}, "", "/?view=settings&c=existing&section=account"); window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(screen.getByRole("heading", { name: "Thông tin của bạn." })).toBeInTheDocument();
  });
});
