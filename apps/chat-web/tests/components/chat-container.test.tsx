/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { MessageItem } from '../../src/components/MessageItem';
import { ChatContainer } from '../../src/components/ChatContainer';

afterEach(() => {
  cleanup();
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
        timestamp="10:42"
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
});
