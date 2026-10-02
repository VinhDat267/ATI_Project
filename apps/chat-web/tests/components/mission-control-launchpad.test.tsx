/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { MissionControlLaunchpad } from "../../src/components/MissionControlLaunchpad";
afterEach(cleanup);
describe("Workspace suggestions", () => {
  it("prefills a suggestion without sending a request", () => {
    const send = vi.fn(),
      prefill = vi.fn();
    window.addEventListener("chat:prefill", prefill);
    render(<MissionControlLaunchpad onSendMessage={send} />);
    fireEvent.click(
      screen.getByRole("button", { name: /GitHub → Trello → Slack/ }),
    );
    expect(prefill.mock.calls[0][0].detail.text).toContain("Hãy hỏi tôi");
    expect(send).not.toHaveBeenCalled();
    window.removeEventListener("chat:prefill", prefill);
  });
  it("does not assert unverified connectivity or expose a second composer", () => {
    render(<MissionControlLaunchpad onSendMessage={vi.fn()} />);
    expect(screen.getByText("Bắt đầu bằng một lời nhắn.")).toBeInTheDocument();
    expect(
      screen.queryByText(/Đã kết nối|Bảo vệ dữ liệu tuyệt đối|Google Sheets/),
    ).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });
});
