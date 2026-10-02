/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { PartialFailureModal } from "../../src/components/PartialFailureModal";

afterEach(() => {
  cleanup();
});

describe("PartialFailureModal Component", () => {
  const defaultProps = {
    stepId: "step_2",
    tool: "trello.create_card",
    errorMessage: "Card title cannot be empty",
    stepArgs: { name: "Initial Card", listId: "list_123" },
    onRetry: vi.fn(),
    onEditAndRetry: vi.fn(),
    onSkip: vi.fn(),
    onStop: vi.fn(),
  };

  it("renders failure details, tool badge, error message, and data safety guarantee", () => {
    render(<PartialFailureModal {...defaultProps} />);

    expect(screen.getByRole("alertdialog")).toBeDefined();
    expect(
      screen.getByText(/Tạm dừng quy trình tại bước: step_2/i),
    ).toBeDefined();
    expect(screen.getByText("trello.create_card")).toBeDefined();
    expect(screen.getByText(/Card title cannot be empty/i)).toBeDefined();
    expect(
      screen.getByText(
        /Bảo vệ an toàn dữ liệu: Các bước đã hoàn thành được bảo toàn nguyên vẹn/i,
      ),
    ).toBeDefined();

    // Verify step args preview is rendered
    expect(screen.getByTestId("step-args-preview")).toBeDefined();
    expect(screen.getByText(/"Initial Card"/)).toBeDefined();
  });

  it("closes on Escape key press by calling onClose without stopping", () => {
    const onStop = vi.fn();
    const onClose = vi.fn();

    const { unmount } = render(
      <PartialFailureModal
        {...defaultProps}
        onStop={onStop}
        onClose={onClose}
      />,
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onStop).not.toHaveBeenCalled();

    unmount();

    // Missing dismissal callback must never turn Escape into a destructive command
    const onStopOnly = vi.fn();
    render(<PartialFailureModal {...defaultProps} onStop={onStopOnly} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onStopOnly).not.toHaveBeenCalled();
  });

  it("closes on backdrop click but does not close when clicking inside content container", () => {
    const onClose = vi.fn();
    render(<PartialFailureModal {...defaultProps} onClose={onClose} />);

    // Click inside the modal dialog container
    const content = screen.getByText(/Tạm dừng quy trình tại bước/i);
    fireEvent.click(content);
    expect(onClose).not.toHaveBeenCalled();

    // Click the backdrop overlay (outermost dialog wrapper)
    const backdrop = screen.getByRole("alertdialog");
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('triggers onRetry when "Thử lại bước này" is clicked', () => {
    const onRetry = vi.fn();
    render(<PartialFailureModal {...defaultProps} onRetry={onRetry} />);

    const retryBtn = screen.getByRole("button", { name: /Thử lại bước này/i });
    fireEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('triggers onEditAndRetry when "Sửa & tiếp tục" is clicked with default arguments', () => {
    const onEditAndRetry = vi.fn();
    render(
      <PartialFailureModal {...defaultProps} onEditAndRetry={onEditAndRetry} />,
    );

    const editBtn = screen.getByRole("button", { name: /Sửa & tiếp tục/i });
    fireEvent.click(editBtn);
    expect(onEditAndRetry).toHaveBeenCalledWith({
      name: "Initial Card",
      listId: "list_123",
    });
  });

  it("allows user to inspect, edit step arguments JSON, and submits edited arguments", () => {
    const onEditAndRetry = vi.fn();
    render(
      <PartialFailureModal {...defaultProps} onEditAndRetry={onEditAndRetry} />,
    );

    // Toggle edit mode
    const toggleEditBtn = screen.getByRole("button", {
      name: /Chỉnh sửa tham số/i,
    });
    fireEvent.click(toggleEditBtn);

    const textarea = screen.getByRole("textbox", {
      name: /Tham số thực thi/i,
    });
    expect(textarea).toBeDefined();

    // Change arguments in textarea
    fireEvent.change(textarea, {
      target: {
        value: JSON.stringify({ name: "Updated Card", listId: "list_999" }),
      },
    });

    const submitBtn = screen.getByRole("button", { name: /Sửa & tiếp tục/i });
    fireEvent.click(submitBtn);

    expect(onEditAndRetry).toHaveBeenCalledWith({
      name: "Updated Card",
      listId: "list_999",
    });
  });

  it("displays error message and prevents submission when JSON is invalid", () => {
    const onEditAndRetry = vi.fn();
    render(
      <PartialFailureModal {...defaultProps} onEditAndRetry={onEditAndRetry} />,
    );

    // Toggle edit mode
    fireEvent.click(screen.getByRole("button", { name: /Chỉnh sửa tham số/i }));

    const textarea = screen.getByRole("textbox", {
      name: /Tham số thực thi/i,
    });
    fireEvent.change(textarea, { target: { value: "{ invalid json" } });

    const submitBtn = screen.getByRole("button", { name: /Sửa & tiếp tục/i });
    fireEvent.click(submitBtn);

    expect(onEditAndRetry).not.toHaveBeenCalled();
    expect(screen.getByText(/Định dạng JSON không hợp lệ/i)).toBeDefined();
  });

  it('triggers onSkip when "Bỏ qua bước này" is clicked', () => {
    const onSkip = vi.fn();
    render(<PartialFailureModal {...defaultProps} onSkip={onSkip} />);

    const skipBtn = screen.getByRole("button", { name: /Bỏ qua bước này/i });
    fireEvent.click(skipBtn);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it("allows user to inspect and edit prompt before submitting retry", () => {
    const onEditAndRetry = vi.fn();
    render(
      <PartialFailureModal
        {...defaultProps}
        prompt="Initial prompt text"
        onEditAndRetry={onEditAndRetry}
      />,
    );

    // Prompt preview is displayed
    expect(screen.getByTestId("step-prompt-preview")).toBeDefined();
    expect(screen.getByText("Initial prompt text")).toBeDefined();

    // Toggle edit mode
    fireEvent.click(screen.getByRole("button", { name: /Chỉnh sửa tham số/i }));

    const promptTextarea = screen.getByRole("textbox", {
      name: /Yêu cầu \/ Prompt/i,
    });
    expect(promptTextarea).toBeDefined();

    fireEvent.change(promptTextarea, {
      target: { value: "Updated prompt text" },
    });

    const submitBtn = screen.getByRole("button", { name: /Sửa & tiếp tục/i });
    fireEvent.click(submitBtn);

    expect(onEditAndRetry).toHaveBeenCalledWith(
      {
        name: "Initial Card",
        listId: "list_123",
      },
      "Updated prompt text",
    );
  });

  it("safely handles missing or empty stepArgs", () => {
    const onEditAndRetry = vi.fn();
    render(
      <PartialFailureModal
        stepId="step_no_args"
        tool="test.noop"
        errorMessage="Some error"
        onRetry={vi.fn()}
        onEditAndRetry={onEditAndRetry}
        onSkip={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    expect(screen.getByText("(Không có tham số bổ sung)")).toBeDefined();

    const submitBtn = screen.getByRole("button", { name: /Sửa & tiếp tục/i });
    fireEvent.click(submitBtn);
    expect(onEditAndRetry).toHaveBeenCalledWith(undefined);
  });

  it('triggers onStop when "Dừng lại toàn bộ" is clicked', () => {
    const onStop = vi.fn();
    render(<PartialFailureModal {...defaultProps} onStop={onStop} />);

    const stopBtn = screen.getByRole("button", { name: /Dừng lại toàn bộ/i });
    fireEvent.click(stopBtn);
    expect(onStop).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận dừng" }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});
