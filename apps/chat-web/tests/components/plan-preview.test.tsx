/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { PlanPreview } from "../../src/components/PlanPreview";

afterEach(() => {
  cleanup();
});

describe("PlanPreview Component", () => {
  it("renders thinking layer, plan steps, and triggers approve handler", () => {
    const onApprove = vi.fn();
    const plan = {
      id: "plan-1",
      kind: "plan" as const,
      thinking: "Thinking reasoning here",
      summary: "Tạo card và gửi Slack",
      steps: [
        {
          id: "s1",
          tool: "trello.create_card",
          description: "Tạo card Trello",
          args: { name: "Card 1" },
          dependsOn: [],
        },
        {
          id: "s2",
          tool: "slack.send_message",
          description: "Gửi Slack",
          args: { text: "$step_1.output.url" },
          dependsOn: ["s1"],
        },
      ],
      warnings: ["Lưu ý: Slack channel là public"],
    };

    render(
      <PlanPreview
        plan={plan}
        onApprove={onApprove}
        onEdit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("Tạo card và gửi Slack")).toBeDefined();
    expect(screen.getByText(/Lưu ý: Slack channel là public/i)).toBeDefined();

    // Check thinking accordion
    expect(screen.getByText(/Phân tích & lập luận của AI/i)).toBeDefined();

    // Check steps rendered
    expect(screen.getByText("trello.create_card")).toBeDefined();
    expect(screen.getByText("slack.send_message")).toBeDefined();

    const approveBtn = screen.getByRole("button", { name: /duyệt/i });
    fireEvent.click(approveBtn);
    expect(onApprove).toHaveBeenCalled();
  });

  it("triggers onEdit and onCancel handlers without manipulating composer DOM", () => {
    const onEdit = vi.fn();
    const onCancel = vi.fn();
    const plan = {
      id: "plan-1",
      summary: "Kế hoạch đơn giản",
      steps: [
        { id: "s1", tool: "trello.create_card", description: "desc", args: {} },
      ],
    };

    render(
      <PlanPreview
        plan={plan}
        onApprove={vi.fn()}
        onEdit={onEdit}
        onCancel={onCancel}
      />,
    );

    const editBtn = screen.getByRole("button", { name: /sửa/i });
    fireEvent.click(editBtn);
    expect(onEdit).toHaveBeenCalled();

    const cancelBtn = screen.getByRole("button", { name: /hủy/i });
    fireEvent.click(cancelBtn);
    expect(onCancel).toHaveBeenCalled();
  });

  it("disables approve button and shows loading state when isApproving is true", () => {
    const plan = {
      id: "plan-1",
      summary: "Kế hoạch đang duyệt",
      steps: [
        { id: "s1", tool: "trello.create_card", description: "desc", args: {} },
      ],
    };

    render(<PlanPreview plan={plan} isApproving={true} onApprove={vi.fn()} />);

    const approveBtn = screen.getByRole("button", { name: /đang gửi duyệt/i });
    expect(approveBtn).toBeDisabled();
  });
});
