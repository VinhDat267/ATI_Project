/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MessageItem } from '../../src/components/MessageItem';
import { ChatContainer } from '../../src/components/ChatContainer';
import { useChatStore } from '../../src/store/chat-store';

afterEach(() => {
  cleanup();
  useChatStore.getState().reset();
});

describe('Message Item Component', () => {
  it('renders markdown assistant message correctly', () => {
    render(<MessageItem role="assistant" content="**Bold plan** explanation" />);
    expect(screen.getByText('Bold plan')).toBeDefined();
  });

  it('renders user message bubble on right with timestamp and sending status', () => {
    render(
      <MessageItem
        role="user"
        content="Tạo task mới"
        status="sending"
        timestamp={new Date(new Date().setHours(10, 42, 0, 0)).toISOString()}
      />
    );
    expect(screen.getByText('Tạo task mới')).toBeDefined();
    expect(screen.getByText(/10:42/)).toBeDefined();
  });

  it('renders failed status with retry action for failed user message', () => {
    const onRetry = vi.fn();
    render(
      <MessageItem
        role="user"
        content="Tin nhắn lỗi"
        status="failed"
        onRetry={onRetry}
      />
    );
    expect(screen.getByText('Tin nhắn lỗi')).toBeDefined();
    const retryBtn = screen.getByRole('button', { name: /gửi lại/i });
    fireEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalled();
  });
});

describe('Chat Container Component', () => {
  it('renders messages list and dispatches onSendMessage from input', () => {
    const onSend = vi.fn();
    render(
      <ChatContainer
        messages={[
          { id: '1', role: 'user', content: 'Hello AI' },
          { id: '2', role: 'assistant', content: 'Hello User' },
        ]}
        onSendMessage={onSend}
      />
    );

    expect(screen.getByText('Hello AI')).toBeDefined();
    expect(screen.getByText('Hello User')).toBeDefined();

    const input = screen.getByPlaceholderText(/mô tả công việc/i);
    fireEvent.change(input, { target: { value: 'Task mới' } });
    const sendBtn = screen.getByRole('button', { name: /gửi/i });
    fireEvent.click(sendBtn);
    expect(onSend).toHaveBeenCalledWith('Task mới');
  });

  it('renders GatherProgress when gatherState is provided', () => {
    render(
      <ChatContainer
        messages={[]}
        onSendMessage={vi.fn()}
        gatherState={{
          isGathering: true,
          steps: [{ tool: 'trello.search_boards', status: 'running' }],
          summary: 'Đang kiểm tra Trello',
        }}
      />
    );

    expect(screen.getByText('Khảo sát bối cảnh tích hợp')).toBeDefined();
    expect(screen.getByText('Đang kiểm tra Trello')).toBeDefined();
  });

  it('renders ClarificationCard and calls onSendMessage when option is selected', () => {
    const onSend = vi.fn();
    const onClear = vi.fn();

    render(
      <ChatContainer
        messages={[]}
        onSendMessage={onSend}
        activeClarification={{
          question: 'Bạn muốn tạo card trên board nào?',
          options: ['Frontend', 'Backend'],
        }}
        onClearClarification={onClear}
      />
    );

    expect(screen.getByText('Bạn muốn tạo card trên board nào?')).toBeDefined();
    const optBtn = screen.getByRole('button', { name: 'Frontend' });
    fireEvent.click(optBtn);

    expect(onSend).toHaveBeenCalledWith('Frontend');
    expect(onClear).toHaveBeenCalled();
  });

  it('provides accessible aria-label on input and responds to chat:prefill window event', () => {
    render(<ChatContainer messages={[]} onSendMessage={vi.fn()} />);

    const input = screen.getByRole('textbox', {
      name: 'Mô tả công việc bạn muốn thực hiện',
    }) as HTMLInputElement;
    expect(input).toBeDefined();

    const focusSpy = vi.spyOn(input, 'focus');

    // Dispatch chat:prefill event
    fireEvent(
      window,
      new CustomEvent('chat:prefill', {
        detail: { text: 'Điều chỉnh kế hoạch: ' },
      })
    );

    expect(input.value).toBe('Điều chỉnh kế hoạch: ');
    expect(focusSpy).toHaveBeenCalled();
  });
});
