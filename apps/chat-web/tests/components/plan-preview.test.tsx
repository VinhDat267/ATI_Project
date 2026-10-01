/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PlanPreview } from '../../src/components/PlanPreview';

afterEach(() => {
  cleanup();
});

describe('PlanPreview Component', () => {
  it('renders thinking layer, plan steps, and triggers approve handler', () => {
    const onApprove = vi.fn();
    const plan = {
      kind: 'plan' as const,
      thinking: 'Thinking reasoning here',
      summary: 'Tạo card và gửi Slack',
      steps: [
        {
          id: 's1',
          tool: 'trello.create_card',
          description: 'Tạo card Trello',
          args: { name: 'Card 1' },
          dependsOn: [],
        },
        {
          id: 's2',
          tool: 'slack.send_message',
          description: 'Gửi Slack',
          args: { text: '$step_1.output.url' },
          dependsOn: ['s1'],
        },
      ],
      warnings: ['Lưu ý: Slack channel là public'],
    };

    render(
      <PlanPreview
        plan={plan}
        onApprove={onApprove}
        onEdit={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText('Tạo card và gửi Slack')).toBeDefined();
    expect(screen.getByText(/Lưu ý: Slack channel là public/i)).toBeDefined();

    // Check thinking accordion
    expect(screen.getByText(/Phân tích & lập luận của AI/i)).toBeDefined();

    // Check steps rendered
    expect(screen.getByText('trello.create_card')).toBeDefined();
    expect(screen.getByText('slack.send_message')).toBeDefined();

    const approveBtn = screen.getByRole('button', { name: /duyệt/i });
    fireEvent.click(approveBtn);
    expect(onApprove).toHaveBeenCalled();
  });

  it('triggers onEdit and onCancel handlers and pre-fills input on Sửa qua Chat', () => {
    const onEdit = vi.fn();
    const onCancel = vi.fn();
    const chatInput = document.createElement('input');
    chatInput.id = 'chat-input';
    document.body.appendChild(chatInput);
    const focusSpy = vi.spyOn(chatInput, 'focus');

    const plan = {
      summary: 'Kế hoạch đơn giản',
      steps: [
        { id: 's1', tool: 'trello.create_card', description: 'desc', args: {} },
      ],
    };

    render(
      <PlanPreview
        plan={plan}
        onApprove={vi.fn()}
        onEdit={onEdit}
        onCancel={onCancel}
      />
    );

    const editBtn = screen.getByRole('button', { name: /sửa/i });
    fireEvent.click(editBtn);
    expect(onEdit).toHaveBeenCalled();
    expect(chatInput.value).toBe('Điều chỉnh kế hoạch: ');
    expect(focusSpy).toHaveBeenCalled();

    const cancelBtn = screen.getByRole('button', { name: /hủy/i });
    fireEvent.click(cancelBtn);
    expect(onCancel).toHaveBeenCalled();

    document.body.removeChild(chatInput);
  });

  it('disables approve button and shows loading state when isApproving is true', () => {
    const plan = {
      summary: 'Kế hoạch đang duyệt',
      steps: [{ id: 's1', tool: 'trello.create_card', description: 'desc', args: {} }],
    };

    render(
      <PlanPreview
        plan={plan}
        isApproving={true}
        onApprove={vi.fn()}
      />
    );

    const approveBtn = screen.getByRole('button', { name: /đang kích hoạt/i });
    expect(approveBtn).toBeDisabled();
  });
});
