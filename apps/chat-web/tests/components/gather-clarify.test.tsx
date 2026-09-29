/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { ClarificationCard } from '../../src/components/ClarificationCard';
import { GatherProgress } from '../../src/components/GatherProgress';

afterEach(() => {
  cleanup();
});

describe('Clarification Card Component', () => {
  it('renders question and calls onSelectOption on click', () => {
    const onSelect = vi.fn();
    render(
      <ClarificationCard
        question="Chọn board nào?"
        options={['Web Frontend', 'Backend API']}
        onSelectOption={onSelect}
      />
    );

    expect(screen.getByText('Chọn board nào?')).toBeDefined();
    fireEvent.click(screen.getByText('Web Frontend'));
    expect(onSelect).toHaveBeenCalledWith('Web Frontend');
  });

  it('allows text input submission when open-ended', () => {
    const onSubmit = vi.fn();
    render(
      <ClarificationCard
        question="Tên board của bạn là gì?"
        onSubmitText={onSubmit}
      />
    );

    const input = screen.getByPlaceholderText(/nhập câu trả lời/i);
    fireEvent.change(input, { target: { value: 'Design Board' } });
    fireEvent.click(screen.getByRole('button', { name: /gửi/i }));
    expect(onSubmit).toHaveBeenCalledWith('Design Board');
  });
});

describe('Gather Progress Component', () => {
  it('renders summary and toggles detailed tool steps', () => {
    render(
      <GatherProgress
        summary="Tìm thấy 3 boards, 5 members"
        steps={[
          { tool: 'trello.search_boards', result: '3 boards' },
          { tool: 'trello.search_members', result: '5 members' },
        ]}
      />
    );

    expect(screen.getByText(/3 boards, 5 members/i)).toBeDefined();
    const toggleBtn = screen.getByRole('button', { name: /chi tiết/i });
    fireEvent.click(toggleBtn);
    expect(screen.getByText('trello.search_boards')).toBeDefined();
  });
});

