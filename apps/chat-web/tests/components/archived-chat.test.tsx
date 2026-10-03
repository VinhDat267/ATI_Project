import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChatContainer } from "../../src/components/ChatContainer";
afterEach(cleanup);
it("makes archived conversations read-only without claiming processing is active", () => {
  const send = vi.fn();
  render(<ChatContainer messages={[]} onSendMessage={send} readOnly />);
  expect(screen.getByRole("textbox")).toHaveAttribute("readonly");
  expect(screen.getByRole("button", { name: "Gửi" })).toBeDisabled();
  expect(screen.queryByText("Planora đang xử lý yêu cầu…")).toBeNull();
  expect(
    screen.getByText("Khôi phục hội thoại để gửi yêu cầu"),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Không được gửi" },
  });
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
  expect(send).not.toHaveBeenCalled();
});
