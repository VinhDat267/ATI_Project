/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { App } from "../src/App";
import { authStorage } from "../src/services/auth-storage";
import { apiClient } from "../src/services/api-client";
import { useChatStore } from "../src/store/chat-store";
vi.mock("../src/hooks/use-sse", () => ({ useSSE: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  authStorage.clearStoredTokens();
  useChatStore.getState().reset();
  window.history.replaceState({}, "", "/");
});
describe("public and workspace navigation", () => {
  it("opens account settings from the sidebar without losing the conversation or draft", async () => {
    const user = { id: "u", name: "Linh", email: "linh@example.test" };
    window.history.replaceState({}, "", "/?view=workspace&c=existing");
    authStorage.setStoredTokens({ accessToken: "fixture-token", user });
    vi.spyOn(apiClient, "getMe").mockResolvedValue({ user });
    vi.spyOn(apiClient, "getConversations").mockResolvedValue({ conversations: [{id:"existing",title:"Công việc hiện tại"}] });
    useChatStore.getState().setConversationId("existing");
    useChatStore.getState().addMessage({ id: "m", role: "user", content: "Nội dung đã lưu" });
    render(<App />);
    const composer = screen.getByRole("textbox", {name:"Mô tả công việc bạn muốn thực hiện"});
    fireEvent.change(composer, {target:{value:"Bản nháp của tôi"}});
    fireEvent.click(await screen.findByRole("button", {name:"Cài đặt tài khoản"}));
    expect(await screen.findByRole("heading", {name:"Thông tin của bạn."})).toBeInTheDocument();
    expect(new URLSearchParams(location.search).get("view")).toBe("settings");
    expect(new URLSearchParams(location.search).get("c")).toBe("existing");
    expect(within(screen.getByRole("main")).getByText(user.email)).toBeInTheDocument();
    expect(useChatStore.getState().messages[0].content).toBe("Nội dung đã lưu");
    fireEvent.click(screen.getByRole("button", {name:"Về hội thoại"}));
    expect(await screen.findByRole("textbox", {name:"Mô tả công việc bạn muốn thực hiện"})).toHaveValue("Bản nháp của tôi");
  });
  it("does not unlock another archived conversation when a previous restore finishes", async () => {
    const user = { id: "u", name: "Linh", email: "linh@example.test" };
    window.history.replaceState({}, "", "/?view=workspace");
    authStorage.setStoredTokens({ accessToken: "fixture-token", user });
    vi.spyOn(apiClient, "getMe").mockResolvedValue({ user });
    vi.spyOn(apiClient, "getConversations").mockResolvedValue({
      conversations: [],
    });
    let finish!: (
      value: Awaited<ReturnType<typeof apiClient.restoreConversation>>,
    ) => void;
    const restore = vi
      .spyOn(apiClient, "restoreConversation")
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    useChatStore.getState().setConversationId("first");
    useChatStore.getState().setConversationArchived(true);
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Khôi phục hội thoại" }),
    );
    expect(restore).toHaveBeenCalledWith("first");
    act(() => {
      useChatStore.getState().setConversationId("second");
      useChatStore.getState().setConversationArchived(true);
    });
    await act(async () => {
      finish({ conversation: { id: "first", archived_at: null } });
    });
    expect(useChatStore.getState().conversationArchived).toBe(true);
    expect(
      screen.getByRole("textbox", {
        name: "Mô tả công việc bạn muốn thực hiện",
      }),
    ).toHaveAttribute("readonly");
  });
  it("keeps root public with a working workspace CTA for a stored session", async () => {
    const user = { id: "u", name: "Linh", email: "linh@example.test" };
    authStorage.setStoredTokens({ accessToken: "fixture-token", user });
    vi.spyOn(apiClient, "getMe").mockResolvedValue({ user });
    vi.spyOn(apiClient, "getConversations").mockResolvedValue({
      conversations: [],
    });
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Mở workspace" }),
    );
    expect(
      await screen.findByRole("button", { name: "Hội thoại mới" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Về giới thiệu" })).toBeNull();
    expect(new URLSearchParams(location.search).get("view")).toBe("workspace");
  });
  it.each(["services", "settings"])("redirects an unauthenticated %s URL and preserves its destination after login", async (view) => {
    window.history.replaceState({}, "", `/?view=${view}${view === "settings" ? "&section=deleted" : ""}`);
    const user = { id: "u", name: "Linh", email: "linh@example.test" };
    vi.spyOn(apiClient, "login").mockResolvedValue({
      accessToken: "fixture-token",
      user,
    });
    vi.spyOn(apiClient, "getConversations").mockResolvedValue({
      conversations: [],
    });
    vi.spyOn(apiClient, "getServices").mockResolvedValue({ services: [] });
    render(<App />);
    await waitFor(() =>
      expect(new URLSearchParams(location.search).get("view")).toBe("login"),
    );
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: user.email },
    });
    fireEvent.change(screen.getByLabelText("Mật khẩu"), {
      target: { value: "fixture-only" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Đăng nhập" }));
    await waitFor(() =>
      expect(new URLSearchParams(location.search).get("view")).toBe(view),
    );
    if (view === "settings") {
      expect(await screen.findByRole("heading", {name:"Hội thoại đã xóa."})).toBeInTheDocument();
      expect(new URLSearchParams(location.search).get("section")).toBe("deleted");
    }
  });
});
