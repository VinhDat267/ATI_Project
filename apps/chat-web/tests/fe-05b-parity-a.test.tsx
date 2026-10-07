/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { Cockpit } from '../src/components/Cockpit';
import { useChatStore } from '../src/store/chat-store';
import { apiClient } from '../src/services/api-client';
vi.mock('../src/services/api-client', () => ({
  apiClient: {
    getRuntime: vi.fn(async () => ({ runtimeMode: 'sandbox' })),
    getConversations: async () => ({ conversations: [] }),
  },
}));
const services = [
  {
    id: 'github',
    name: 'GitHub',
    configured: true,
    connected: false,
    connectionStatus: 'unchecked' as const,
  },
  {
    id: 'slack',
    name: 'Slack',
    configured: false,
    connected: false,
    connectionStatus: 'unconfigured' as const,
  },
];
const plan = {
  id: 'p1',
  summary: 'Tạo issue',
  steps: [
    {
      id: 's1',
      tool: 'github.create_issue',
      description: 'Tạo issue',
      args: { repo: 'ati/test', title: 'Test' },
    },
  ],
};
function setup(customServices = services) {
  const send = vi.fn(),
    navigate = vi.fn(),
    logout = vi.fn();
  const view = render(
    <Cockpit
      services={customServices}
      servicesLoading={false}
      servicesError={null}
      onSendMessage={send}
      onNewConversation={vi.fn()}
      onSelectConversation={vi.fn()}
      onSettings={vi.fn()}
      onApprove={vi.fn()}
      onCancel={vi.fn()}
      recovery={null}
    />,
  );
  return { ...view, send, navigate, logout };
}
afterEach(() => {
  cleanup();
  useChatStore.getState().reset();
  vi.mocked(apiClient.getRuntime).mockResolvedValue({ runtimeMode: 'sandbox' });
});
it('FE-05b radio arrow keys select without sending and use one tab stop', () => {
  useChatStore.setState({
    activeClarification: {
      question: 'Chọn kho nào?',
      options: ['Kho A', 'Kho B'],
    },
  });
  const { send } = setup();
  const first = screen.getByRole('radio', { name: 'Kho A' }),
    second = screen.getByRole('radio', { name: 'Kho B' });
  first.focus();
  fireEvent.keyDown(first, { key: 'ArrowRight' });
  expect(second).toHaveFocus();
  expect(second).toHaveAttribute('aria-checked', 'true');
  expect(send).not.toHaveBeenCalled();
  expect(
    screen.getAllByRole('radio').filter((radio) => radio.tabIndex === 0),
  ).toHaveLength(1);
});
it.each(['live', 'unavailable'] as const)(
  'FE-05b sandbox strip is absent when runtime is %s',
  async (mode) => {
    if (mode === 'live')
      vi.mocked(apiClient.getRuntime).mockResolvedValue({
        runtimeMode: 'live',
      });
    else
      vi.mocked(apiClient.getRuntime).mockRejectedValue(new Error('Offline'));
    setup();
    await act(async () => {});
    expect(document.querySelector('#test-mode-banner')).toBeNull();
  },
);
it('FE-05b uses the app-stage page metadata, source ids and request card', async () => {
  setup();
  expect(document.documentElement).toHaveAttribute(
    'data-proto-page',
    'app-stage',
  );
  expect(
    screen.getByRole('heading', { name: 'Hôm nay bạn muốn nhờ việc gì?' }),
  ).toHaveAttribute('id', 'heading-moment-1');
  expect(document.querySelector('#stage-container #moment-1')).not.toBeNull();
  expect(document.querySelector('#moment-1')).toHaveClass(
    'stage-section',
    'is-active',
  );
  expect(screen.getAllByRole('textbox')).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Gửi yêu cầu' })).toBeDisabled();
  expect(
    screen.queryByRole('button', { name: 'Cuộc hội thoại mới' }),
  ).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Tạo issue mới trên GitHub' }),
  ).toBeInTheDocument();
  expect(screen.getByText('Chưa kiểm tra')).toBeInTheDocument();
  expect(
    screen.getByRole('link', { name: 'Cẩm nang & Mẫu câu lệnh' }),
  ).toHaveAttribute('href', '/guide');
  cleanup();
  expect(document.documentElement).not.toHaveAttribute('data-proto-page');
});
it('FE-05b renders actual discovery and request within the compact header without estimates', () => {
  useChatStore.setState({
    isPlanning: true,
    messages: [{ id: 'u', role: 'user', content: 'Tạo issue kiểm tra' }],
    gatherState: {
      steps: [
        {
          tool: 'github.search_repositories',
          status: 'completed',
          result: 'ati/test',
        },
      ],
    } as any,
  });
  setup();
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    'Tạo issue kiểm tra',
  );
  expect(document.querySelector('header #top-bar-query')).toHaveAttribute(
    'title',
    'Tạo issue kiểm tra',
  );
  expect(document.querySelector('#discovery-steps-list')).toHaveTextContent(
    'ati/test',
  );
  expect(screen.queryByText(/Thường mất/)).toBeNull();
  expect(screen.getAllByRole('textbox')).toHaveLength(1);
});
it('FE-05b clarification selects a radio without dispatch, confirms once and keeps one textarea', () => {
  useChatStore.setState({
    activeClarification: {
      question: 'Chọn kho nào?',
      options: ['Kho A', 'Kho B'],
    },
  });
  const { send } = setup();
  expect(
    screen.getByRole('heading', { name: 'Chọn kho nào?' }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('radio', { name: 'Kho A' }));
  expect(send).not.toHaveBeenCalled();
  expect(screen.getAllByRole('textbox')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận và tiếp tục' }));
  expect(send).toHaveBeenCalledExactlyOnceWith('Kho A');
});
it('FE-05b free text and Shift Enter retain a single clarification composer', () => {
  useChatStore.setState({
    activeClarification: { question: 'Chọn kho nào?', options: ['Kho A'] },
  });
  const { send } = setup();
  fireEvent.click(
    screen.getByRole('radio', { name: 'Để tôi gõ tên hoặc link khác' }),
  );
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: 'Kho mới\nChi tiết' } });
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
  expect(send).not.toHaveBeenCalled();
  expect(screen.getAllByRole('textbox')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận và tiếp tục' }));
  expect(send).toHaveBeenCalledExactlyOnceWith('Kho mới\nChi tiết');
});
it('FE-05b no configured service replaces suggestions with the required settings guidance', () => {
  setup([]);
  expect(
    screen.getByText('Chưa có dịch vụ nào được kết nối'),
  ).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Kết nối dịch vụ' })).toHaveAttribute(
    'href',
    '/settings',
  );
});
it.each(['Enter', 'Gửi'] as const)(
  'FE-05b clarification drawer submits its edited draft through %s',
  (action) => {
    useChatStore.setState({
      activeClarification: {
        question: 'Chọn kho nào?',
        options: ['Kho A', 'Kho B'],
      },
    });
    const { send } = setup();
    fireEvent.click(screen.getByRole('radio', { name: 'Kho A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xem hội thoại' }));
    const dialog = screen.getByRole('dialog', { name: 'Nhật ký hội thoại' }),
      input = within(dialog).getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Kho C từ nhật ký' } });
    if (action === 'Enter') fireEvent.keyDown(input, { key: 'Enter' });
    else
      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Gửi' }),
      );
    expect(send).toHaveBeenCalledExactlyOnceWith('Kho C từ nhật ký');
  },
);
it('FE-05b moment changes reset the real page scroller and focus the new heading', () => {
  useChatStore.setState({ activePlan: plan, planStatus: 'preview' });
  setup();
  document.documentElement.scrollTop = 300;
  screen.getByRole('button', { name: 'Duyệt kế hoạch' }).focus();
  act(() => useChatStore.setState({ planStatus: 'executing' }));
  expect(document.documentElement.scrollTop).toBe(0);
  expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
});
it('FE-05b moment changes preserve focus inside other recovery dialogs', () => {
  useChatStore.setState({ activePlan: plan, planStatus: 'preview' });
  setup();
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  const button = document.createElement('button');
  dialog.append(button);
  document.body.append(dialog);
  try {
    button.focus();
    act(() => useChatStore.setState({ planStatus: 'executing' }));
    expect(button).toHaveFocus();
  } finally {
    dialog.remove();
  }
});
it('FE-05b a moment change preserves active typing and dialog focus', () => {
  useChatStore.setState({ activePlan: plan, planStatus: 'preview' });
  setup();
  screen.getByRole('textbox').focus();
  act(() => useChatStore.setState({ planStatus: 'executing' }));
  expect(screen.getByRole('textbox')).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Xem hội thoại' }));
  const dialog = screen.getByRole('dialog', { name: 'Nhật ký hội thoại' });
  const close = within(dialog).getByRole('button', {
    name: 'Đóng Nhật ký hội thoại',
  });
  close.focus();
  act(() => useChatStore.setState({ planStatus: 'completed' }));
  expect(close).toHaveFocus();
});
