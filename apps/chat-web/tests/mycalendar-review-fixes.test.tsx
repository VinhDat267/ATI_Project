import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MyCalendarCallbackView } from '../src/views/MyCalendarCallbackView';
import { Cockpit } from '../src/components/Cockpit';
import { apiClient } from '../src/services/api-client';
import { authStorage } from '../src/services/auth-storage';
import { mycalendarConnectionNotice } from '../src/services/gmail-connection';
import { useChatStore } from '../src/store/chat-store';
import type { ExecutionSnapshot, ServiceInfo, User } from '../src/types';

const user: User = { id: 'alice', email: 'alice@example.test', name: 'Alice', role: 'member' };
const tokens = { accessToken: 'alice-access', refreshToken: 'alice-refresh', user };
const calendars = [{ id: 'alice@gmail.com', summary: 'Lịch chính', primary: true, accessRole: 'owner' as const }];
const scope = { status: 'connected' as const, email: 'alice@gmail.com', selectedCalendars: calendars, allowedScope: ['alice@gmail.com'] };
const CONVERSATION = '/c/11111111-2222-4333-8444-555555555555';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  window.history.replaceState({}, '', '/connections/mycalendar/callback');
  authStorage.setStoredTokens(tokens);
  useChatStore.getState().reset();
  mycalendarConnectionNotice.take(user.id);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useChatStore.getState().reset();
  authStorage.clearStoredTokens();
  mycalendarConnectionNotice.take(user.id);
});

describe.each(['oauth', 'select'] as const)('MyCalendar callback lifecycle in StrictMode (%s)', (mode) => {
  function setup() {
    const complete = vi.spyOn(apiClient, 'completeMyCalendarConnection').mockResolvedValue({
      status: 'scope_required', email: 'alice@gmail.com', calendars, selectedCalendars: [], returnTo: CONVERSATION,
    });
    const list = vi.spyOn(apiClient, 'listMyCalendarCalendars').mockResolvedValue({
      email: 'alice@gmail.com', calendars, selectedCalendarIds: [],
    });
    const navigate = vi.fn();
    const input = mode === 'select' ? { mode: 'select' as const, returnTo: CONVERSATION } : { code: 'single-use-code', state: 'oauth-state' };
    const view = render(<StrictMode><MyCalendarCallbackView navigate={navigate} input={input} /></StrictMode>);
    return { ...view, navigate, complete, list };
  }

  it('loads once and saves the selected scope before returning to the conversation', async () => {
    const save = vi.spyOn(apiClient, 'saveMyCalendarScope').mockResolvedValue(scope);
    const { navigate, complete, list } = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Lưu lịch được dùng & quay lại hội thoại' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(CONVERSATION, true));
    expect(save).toHaveBeenCalledExactlyOnceWith(['alice@gmail.com']);
    if (mode === 'oauth') {
      expect(complete).toHaveBeenCalledExactlyOnceWith('single-use-code', 'oauth-state');
      expect(list).not.toHaveBeenCalled();
    } else {
      expect(list).toHaveBeenCalledTimes(1);
      expect(complete).not.toHaveBeenCalled();
    }
  });

  it('does not navigate or publish a connection notice after unmount during a pending scope save', async () => {
    const pending = deferred<Awaited<ReturnType<typeof apiClient.saveMyCalendarScope>>>();
    const save = vi.spyOn(apiClient, 'saveMyCalendarScope').mockReturnValue(pending.promise);
    const { navigate, unmount } = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Lưu lịch được dùng & quay lại hội thoại' }));
    expect(save).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => pending.resolve(scope));
    expect(navigate).not.toHaveBeenCalled();
    expect(mycalendarConnectionNotice.take(user.id)).toBeUndefined();
  });

  it('does not start a scope save after the owning session has been invalidated', async () => {
    const save = vi.spyOn(apiClient, 'saveMyCalendarScope').mockResolvedValue(scope);
    const { navigate } = setup();
    const button = await screen.findByRole('button', { name: 'Lưu lịch được dùng & quay lại hội thoại' });
    act(() => {
      authStorage.clearStoredTokens();
      authStorage.setStoredTokens(tokens);
    });
    fireEvent.click(button);
    expect(save).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('keeps a pending save invalidated even if the original session is restored', async () => {
    const pending = deferred<Awaited<ReturnType<typeof apiClient.saveMyCalendarScope>>>();
    vi.spyOn(apiClient, 'saveMyCalendarScope').mockReturnValue(pending.promise);
    const { navigate } = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Lưu lịch được dùng & quay lại hội thoại' }));
    act(() => {
      authStorage.clearStoredTokens();
      authStorage.setStoredTokens(tokens);
    });
    await act(async () => pending.resolve(scope));
    expect(navigate).not.toHaveBeenCalled();
    expect(mycalendarConnectionNotice.take(user.id)).toBeUndefined();
  });
});

describe('personal Calendar receipt identity', () => {
  const secondaryId = 'secondary@group.calendar.google.com';
  const currentService: ServiceInfo = {
    id: 'mycalendar', name: 'Google Calendar của bạn', connection: 'personal', configured: true,
    connected: true, personalStatus: 'connected', email: 'new.account@gmail.com',
    tools: ['mycalendar.create_event'], selectedCalendars: [{ id: secondaryId, summary: 'Lịch công việc' }],
  };

  async function showReceipt(status: 'completed' | 'stopped', includeApprovedConnection = true) {
    vi.spyOn(apiClient, 'getRuntime').mockResolvedValue({ runtimeMode: 'sandbox', mycalendarEnabled: true });
    const snapshot: ExecutionSnapshot = {
      plan: {
        id: 'approved-plan', convId: 'conversation-1', status, summary: 'Tạo cuộc họp',
        steps: [{ id: 's1', tool: 'mycalendar.create_event', description: 'Tạo cuộc họp', args: { calendarId: secondaryId, summary: 'Cuộc họp' } }],
        resourceLabels: { [secondaryId]: 'Lịch công việc' },
        ...(includeApprovedConnection ? { connections: { mycalendar: { credentialId: 'approved-credential', email: 'approved.owner@gmail.com', allowedCalendars: [secondaryId] } } } : {}),
      },
      execution: { status }, recoveryActions: [],
      steps: [{ stepId: 's1', tool: 'mycalendar.create_event', status: 'succeeded', output: { id: 'event-1', title: 'Cuộc họp', url: 'https://calendar.google.com/calendar/event?eid=event-1' } }],
    };
    useChatStore.setState({ planStatus: status, executionSnapshot: snapshot });
    await act(async () => {
      render(<Cockpit services={[currentService]} servicesLoading={false} servicesError={null}
        onSendMessage={vi.fn()} onNewConversation={vi.fn()} onSelectConversation={vi.fn()}
        onSettings={vi.fn()} onApprove={vi.fn()} onCancel={vi.fn()} recovery={null} />);
    });
  }

  it.each(['completed', 'stopped'] as const)('shows the approved snapshot account for a secondary calendar on a %s receipt', async (status) => {
    await showReceipt(status);
    expect(screen.getByRole('link', { name: 'Mở sự kiện trên Google Calendar' })).toHaveAttribute('href', 'https://calendar.google.com/calendar/event?eid=event-1');
    expect(screen.getByText('Lịch công việc')).toBeInTheDocument();
    expect(screen.getByText('Tài khoản: approved.owner@gmail.com (Google Calendar của bạn)')).toBeInTheDocument();
    expect(screen.queryByText(/new\.account@gmail\.com/)).not.toBeInTheDocument();
    await waitFor(() => expect(apiClient.getRuntime).toHaveBeenCalledTimes(1));
  });

  it('does not substitute the current service account when the approved snapshot has no connection', async () => {
    await showReceipt('completed', false);
    expect(screen.getByRole('link', { name: 'Mở sự kiện trên Google Calendar' })).toBeInTheDocument();
    expect(screen.queryByText(/Tài khoản:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/new\.account@gmail\.com/)).not.toBeInTheDocument();
    await waitFor(() => expect(apiClient.getRuntime).toHaveBeenCalledTimes(1));
  });
});
