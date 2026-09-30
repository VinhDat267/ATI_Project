/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { PlanStepItem } from '../../src/components/PlanStepItem';

afterEach(() => {
  cleanup();
});

describe('PlanStepItem arguments', () => {
  it('shows the text a template will send, with its references readable', () => {
    render(
      <PlanStepItem
        index={2}
        step={{
          id: 'step_3',
          tool: 'slack.send_message',
          description: 'Báo Slack',
          args: {
            channel: 'C0123',
            text: { $template: 'Issue: ${step_1.output.url}\nCard: ${step_2.output.url}' },
          },
        }}
      />
    );

    expect(screen.queryByText(/\[object Object\]/)).toBeNull();
    const text = screen.getByTestId('arg-text').textContent;
    expect(text).toContain('Issue: ‹kết quả step_1: url›');
    expect(text).toContain('Card: ‹kết quả step_2: url›');
  });

  it('shows a reference, a list and a nested value without [object Object]', () => {
    render(
      <PlanStepItem
        index={1}
        step={{
          id: 'step_2',
          tool: 'trello.add_member',
          description: 'Gán',
          args: {
            cardId: { $ref: 'step_1.output.id' },
            idMembers: ['m1', 'm2'],
            extra: { a: 1 },
          },
        }}
      />
    );

    expect(screen.queryByText(/\[object Object\]/)).toBeNull();
    expect(screen.getByTestId('arg-cardId').textContent).toBe('‹kết quả step_1: id›');
    expect(screen.getByTestId('arg-idMembers').textContent).toBe('m1, m2');
    expect(screen.getByTestId('arg-extra').textContent).toBe('{"a":1}');
  });
});
