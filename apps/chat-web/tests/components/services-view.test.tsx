import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  within,
  waitFor,
} from "@testing-library/react";
import ServicesView from "../../src/views/ServicesView";
import { apiClient } from "../../src/services/api-client";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const service = {
  id: "github",
  name: "GitHub",
  connected: true,
  allowedScope: ["owner/repo"],
  credentialFields: [
    { key: "token", label: "Personal Access Token", type: "password" as const },
  ],
  scopeLabel: "Repository",
};
describe("API-backed services page", () => {
  it("distinguishes configuration from a successful check", async () => {
    vi.spyOn(apiClient, "getServices").mockResolvedValue({
      services: [service],
    });
    const check = vi
      .spyOn(apiClient, "testConnection")
      .mockResolvedValue({
        success: true,
        message: "Kiểm tra thật trong test",
        latencyMs: 27,
      });
    render(<ServicesView />);
    expect(await screen.findByText("Đã cấu hình")).toBeInTheDocument();
    expect(screen.queryByText("Kiểm tra thành công")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra kết nối" }));
    expect(await screen.findByText("Kiểm tra thành công")).toBeInTheDocument();
    expect(check).toHaveBeenCalledWith("github");
    expect(screen.getByText(/27 ms/)).toBeInTheDocument();
  });
  it("preserves entered values and reports a denied save without claiming success", async () => {
    vi.spyOn(apiClient, "getServices").mockResolvedValue({
      services: [service],
    });
    const save = vi
      .spyOn(apiClient, "saveCredentials")
      .mockRejectedValue(
        Object.assign(new Error("Service administrator required"), {
          status: 403,
        }),
      );
    render(<ServicesView />);
    fireEvent.click(await screen.findByRole("button", { name: "Cấu hình" }));
    const dialog = screen.getByRole("dialog", { name: "Cấu hình GitHub" });
    fireEvent.change(within(dialog).getByLabelText("Personal Access Token"), {
      target: { value: "test-only-token" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Lưu cấu hình" }),
    );
    expect(
      await within(dialog).findByText("Service administrator required"),
    ).toBeInTheDocument();
    expect(save).toHaveBeenCalledWith("github", { token: "test-only-token" }, [
      "owner/repo",
    ]);
    expect(within(dialog).getByLabelText("Personal Access Token")).toHaveValue(
      "test-only-token",
    );
    expect(screen.queryByText(/Đã lưu cấu hình/)).toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("offers a retry for a failed list rather than an invented empty state", async () => {
    const list = vi
      .spyOn(apiClient, "getServices")
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue({ services: [] });
    render(<ServicesView />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/Chưa có dịch vụ nào khả dụng/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tải lại" }));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByText(/Chưa có dịch vụ nào khả dụng/),
    ).toBeInTheDocument();
  });
});
