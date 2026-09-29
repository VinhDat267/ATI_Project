/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PartialFailureModal } from '../../src/components/PartialFailureModal';
import { ExecutionProgress } from '../../src/components/ExecutionProgress';

afterEach(() => {
  cleanup();
});

describe('Partial Failure Modal', () => {
  it('renders recovery buttons on failed step', () => {
    const onRetry = vi.fn();
    const onSkip = vi.fn();
    const onEdit = vi.fn();
    const onStop = vi.fn();

    render(
      <PartialFailureModal
        stepId="step_2"
        tool="trello.add_member"
        errorMessage="Member not found"
        onRetry={onRetry}
        onEditAndRetry={onEdit}
        onSkip={onSkip}
        onStop={onStop}
      />
    );

    expect(screen.getByText(/Member not found/i)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /thử lại/i }));
    expect(onRetry).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /bỏ qua/i }));
    expect(onSkip).toHaveBeenCalled();
  });
});

describe('Execution Progress Component', () => {
  it('renders steps with proper status icons and duration', () => {
    render(
      <ExecutionProgress
        steps={[
          {
            id: 's1',
            tool: 'trello.create_card',
            description: 'Tạo thẻ',
            status: 'succeeded',
            duration: '0.8s',
          },
          {
            id: 's2',
            tool: 'trello.add_member',
            description: 'Gán người',
            status: 'running',
          },
          {
            id: 's3',
            tool: 'slack.send_message',
            description: 'Gửi Slack',
            status: 'pending',
          },
        ]}
      />
    );

    expect(screen.getByText('Tạo thẻ')).toBeDefined();
    expect(screen.getByText(/0.8s/)).toBeDefined();
    expect(screen.getByText('Gán người')).toBeDefined();
    expect(screen.getByText('Gửi Slack')).toBeDefined();
  });
});
