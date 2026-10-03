/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { AccountApproval } from "../../src/views/AccountApproval";
import AccountSettingsView from "../../src/views/AccountSettingsView";
import { apiClient } from "../../src/services/api-client";
const pending = {
  id: "pending",
  name: "Linh",
  email: "linh@example.test",
  emailVerified: true,
  createdAt: "2026-10-03",
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});
describe("account approval", () => {
  it("requires confirmation and waits for real API success before clearing a pending account", async () => {
    const list = vi
      .spyOn(apiClient, "getPendingUsers")
      .mockResolvedValue({
        users: [
          pending,
          { ...pending, id: "unverified", name: "Nam", emailVerified: false },
        ],
        total: 2,
        page: 1,
      });
    let complete!: (value: { user: typeof pending }) => void;
    const approve = vi.spyOn(apiClient, "approveUser").mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    render(<AccountApproval />);
    const buttons = await screen.findAllByRole("button", { name: "Duyệt" });
    expect(buttons[1]).toBeDisabled();
    fireEvent.click(buttons[0]);
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "dịch vụ nhóm đã kết nối",
    );
    expect(approve).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Duyệt tài khoản" }));
    expect(screen.getByRole("button", { name: "Đang duyệt…" })).toBeDisabled();
    expect(approve).toHaveBeenCalledExactlyOnceWith("pending");
    list.mockResolvedValue({ users: [], total: 0, page: 1 });
    await act(async () => complete({ user: pending }));
    expect(
      await screen.findByText("Mọi thứ đã được xem xét."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("ignores stale search results and handles a request error with retry", async () => {
    let finishOld!: (value: any) => void;
    const list = vi
      .spyOn(apiClient, "getPendingUsers")
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = resolve;
          }),
      )
      .mockResolvedValue({ users: [], total: 0, page: 1 });
    render(<AccountApproval />);
    await waitFor(() => expect(list).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "khác" },
    });
    expect(
      await screen.findByText("Chưa tìm thấy tài khoản."),
    ).toBeInTheDocument();
    await act(async () => finishOld({ users: [pending], total: 1, page: 1 }));
    expect(screen.queryByText(pending.email)).toBeNull();
    list.mockRejectedValueOnce(new Error("Không tải được danh sách"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Không tải được danh sách",
    );
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(
      await screen.findByText("Mọi thứ đã được xem xét."),
    ).toBeInTheDocument();
  });
  it("does not expose admin UI to members even through a direct URL", () => {
    window.history.replaceState({}, "", "/?view=settings&section=approvals");
    render(
      <AccountSettingsView
        user={{
          id: "member",
          email: "member@example.test",
          name: "Member",
          isAdmin: false,
        }}
        currentConversationId={null}
        onOpenConversation={() => {}}
        onConversationRemoved={() => {}}
        onServices={() => {}}
        onLogout={() => {}}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /Duyệt tài khoản/ }),
    ).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Thông tin của bạn." }),
    ).toBeInTheDocument();
  });
});
