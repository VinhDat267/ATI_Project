import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MessageItem } from '../../src/components/MessageItem';
import { useChatStore } from '../../src/store/chat-store';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 1, 15, 0)); useChatStore.getState().reset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('machine-local message time, for new and historical messages', () => {
  it.each(['user', 'assistant', 'system'] as const)('renders HH:mm for %s messages today', role => {
    const date = new Date(2026, 9, 1, 14, 7);
    const { container } = render(<MessageItem role={role} content="Today" timestamp={date.toISOString()} />);
    expect(container.querySelector('time')).toHaveTextContent('14:07');
    expect(container.querySelector('time')).toHaveAttribute('datetime', date.toISOString());
    expect(container.textContent).not.toContain(date.toISOString());
  });
  it.each(['user', 'assistant', 'system'] as const)('adds the local date and HH:mm for prior-day %s history', role => {
    const date = new Date(2026, 8, 30, 23, 58);
    const { container } = render(<MessageItem role={role} content="History" timestamp={date.toISOString()} />);
    expect(container.querySelector('time')).toHaveTextContent('30/09/2026 23:58');
  });
  it('formats an optimistic message with the same component', () => {
    useChatStore.getState().addOptimisticMessage({ id: 'temp', content: 'Vừa gửi' });
    const message = useChatStore.getState().messages[0];
    const { container } = render(<MessageItem {...message} />);
    expect(container.querySelector('time')).toHaveTextContent('15:00');
  });
  it.each(['assistant', 'system'] as const)('timestamps a new %s message from the store', role => {
    useChatStore.getState().reset();
    useChatStore.getState().addMessage({ id: 'new', role, content: 'Fresh response' });
    const { container } = render(<MessageItem {...useChatStore.getState().messages[0]} />);
    expect(container.querySelector('time')).toHaveTextContent('15:00');
  });
  it('does not display an invalid timestamp', () => {
    const { container } = render(<MessageItem role="user" content="Invalid" timestamp="not-a-date" />);
    expect(container.querySelector('time')).toBeNull();
    expect(container.textContent).not.toContain('not-a-date');
  });
});
