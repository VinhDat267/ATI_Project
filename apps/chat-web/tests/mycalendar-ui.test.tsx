import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SettingsPage } from '../src/pages/Settings/SettingsPage';
import { RefusalMoment } from '../src/pages/Responses/ResponseMoment';
import { PlanMoment } from '../src/pages/Cockpit/PlanMoment';
import { ReceiptMoment } from '../src/pages/Cockpit/ReceiptMoment';
import { PrivacyPage } from '../src/pages/Privacy/PrivacyPage';
import { MyCalendarCallbackView } from '../src/views/MyCalendarCallbackView';
import { apiClient } from '../src/services/api-client';
import { authStorage } from '../src/services/auth-storage';
import * as connection from '../src/services/gmail-connection';
import type { ActivePlan, ChatMessage, PlanStep, ServiceInfo, User } from '../src/types';

const member: User = { id: 'member-1', email: 'user@example.test', name: 'Thành viên', role: 'member' };
const CONV_ID = '11111111-2222-4333-8444-555555555555';

const mycalendarService = (
  personalStatus: 'not_connected' | 'scope_required' | 'connected' | 'reconnect_required' = 'not_connected',
  extra: Partial<ServiceInfo> = {}
): ServiceInfo => ({
  id: 'mycalendar',
  name: 'Google Calendar của bạn',
  connection: 'personal',
  personalStatus,
  connected: personalStatus === 'connected',
  configured: personalStatus === 'connected',
  email: personalStatus === 'not_connected' ? undefined : 'user@gmail.com',
  connectedAt: personalStatus === 'not_connected' ? undefined : '2026-10-27T02:00:00Z',
  tools: ['mycalendar.list_calendars', 'mycalendar.list_events', 'mycalendar.create_event'],
  selectedCalendars:
    personalStatus === 'connected'
      ? [
          { id: 'user@gmail.com', summary: 'Lịch chính', primary: true, accessRole: 'owner' },
          { id: 'work@group.calendar.google.com', summary: 'Lịch công việc', accessRole: 'writer' },
        ]
      : [],
  ...extra,
});

beforeEach(() => {
  window.history.replaceState({}, '', '/settings');
  localStorage.clear();
  authStorage.setStoredTokens({ accessToken: 'access-1', refreshToken: 'refresh-1', user: member });
  vi.spyOn(connection, 'redirectToMyCalendar').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  authStorage.clearStoredTokens();
});

describe('MyCalendarCallbackView', () => {
  const sampleCalendars = [
    { id: 'user@gmail.com', summary: 'user@gmail.com', primary: true, accessRole: 'owner' as const },
    { id: 'work@group.calendar.google.com', summary: 'Lịch công việc', primary: false, accessRole: 'writer' as const },
    { id: 'team@group.calendar.google.com', summary: 'Lịch nhóm', primary: false, accessRole: 'writer' as const },
  ];

  it('exchanges OAuth code, pre-checks primary calendar, enforces >=1 selection, saves scope and navigates to returnTo', async () => {
    const navigate = vi.fn();
    window.history.replaceState({}, '', `/connections/mycalendar/callback?code=CODE123&state=STATE456`);

    vi.spyOn(apiClient, 'completeMyCalendarConnection').mockResolvedValue({
      status: 'scope_required',
      email: 'user@gmail.com',
      calendars: sampleCalendars,
      selectedCalendars: [],
      returnTo: `/c/${CONV_ID}`,
    });
    vi.spyOn(apiClient, 'saveMyCalendarScope').mockResolvedValue({
      status: 'connected',
      email: 'user@gmail.com',
      selectedCalendars: [sampleCalendars[0]],
      allowedScope: [sampleCalendars[0].id],
    });

    render(
      <MyCalendarCallbackView
        navigate={navigate}
        input={{ code: 'CODE123', state: 'STATE456', returnTo: `/c/${CONV_ID}` }}
      />
    );

    // Strips query before paint
    expect(window.location.search).toBe('');

    // Wait for calendars to load
    await screen.findByRole('group', { name: /Danh sách lịch ghi được/i });
    expect(apiClient.completeMyCalendarConnection).toHaveBeenCalledTimes(1);
    expect(apiClient.completeMyCalendarConnection).toHaveBeenCalledWith('CODE123', 'STATE456');

    // Primary calendar is pre-checked by default
    const primaryCheckbox = screen.getByRole('checkbox', { name: /user@gmail.com/i });
    expect(primaryCheckbox).toBeChecked();

    // Checkboxes for other calendars are unchecked
    const workCheckbox = screen.getByRole('checkbox', { name: /Lịch công việc/i });
    expect(workCheckbox).not.toBeChecked();

    // Save button label includes returning to conversation
    const saveButton = screen.getByRole('button', { name: /Lưu lịch được dùng & quay lại hội thoại/i });
    expect(saveButton).toBeEnabled();

    // If user unchecks the only checked calendar, button is disabled and helper message appears
    fireEvent.click(primaryCheckbox);
    expect(primaryCheckbox).not.toBeChecked();
    expect(saveButton).toBeDisabled();
    expect(screen.getByText(/Vui lòng chọn ít nhất 1 lịch để tiếp tục/i)).toBeTruthy();

    // Check work calendar
    fireEvent.click(workCheckbox);
    expect(workCheckbox).toBeChecked();
    expect(saveButton).toBeEnabled();

    // Save scope
    fireEvent.click(saveButton);
    await waitFor(() => {
      expect(apiClient.saveMyCalendarScope).toHaveBeenCalledWith([sampleCalendars[1].id]);
    });
    expect(navigate).toHaveBeenCalledWith(`/c/${CONV_ID}`, true);
  });

  it('strictly validates returnTo and falls back to /settings#mycalendar on open redirect attempt (Review Focus #5)', async () => {
    const navigate = vi.fn();
    vi.spyOn(apiClient, 'completeMyCalendarConnection').mockResolvedValue({
      status: 'scope_required',
      email: 'user@gmail.com',
      calendars: sampleCalendars,
      selectedCalendars: [],
      returnTo: '//evil.example/c/hack',
    });
    vi.spyOn(apiClient, 'saveMyCalendarScope').mockResolvedValue({
      status: 'connected',
      email: 'user@gmail.com',
      selectedCalendars: [sampleCalendars[0]],
      allowedScope: [sampleCalendars[0].id],
    });

    render(
      <MyCalendarCallbackView
        navigate={navigate}
        input={{ code: 'CODE123', state: 'STATE456', returnTo: '//evil.example/c/hack' }}
      />
    );

    const saveButton = await screen.findByRole('button', { name: /Lưu lịch được dùng/i });
    // Label should NOT say "& quay lại hội thoại" because returnTo is invalid
    expect(saveButton.textContent).not.toContain('quay lại hội thoại');

    fireEvent.click(saveButton);
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('/settings#mycalendar', true);
    });
  });

  it('in ?mode=select mode: calls listMyCalendarCalendars without completeMyCalendarConnection and saves scope', async () => {
    const navigate = vi.fn();
    vi.spyOn(apiClient, 'completeMyCalendarConnection');
    vi.spyOn(apiClient, 'listMyCalendarCalendars').mockResolvedValue({
      email: 'user@gmail.com',
      calendars: sampleCalendars,
      selectedCalendarIds: [sampleCalendars[1].id],
    });
    vi.spyOn(apiClient, 'saveMyCalendarScope').mockResolvedValue({
      status: 'connected',
      email: 'user@gmail.com',
      selectedCalendars: [sampleCalendars[1]],
      allowedScope: [sampleCalendars[1].id],
    });

    render(
      <MyCalendarCallbackView
        navigate={navigate}
        input={{ mode: 'select', returnTo: `/c/${CONV_ID}` }}
      />
    );

    await screen.findByText('Lịch công việc');
    expect(apiClient.completeMyCalendarConnection).not.toHaveBeenCalled();
    expect(apiClient.listMyCalendarCalendars).toHaveBeenCalledTimes(1);

    // Pre-checked from selectedCalendarIds
    expect(screen.getByRole('checkbox', { name: /Lịch công việc/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /user@gmail.com/i })).not.toBeChecked();

    const saveButton = screen.getByRole('button', { name: /Lưu lịch được dùng & quay lại hội thoại/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(apiClient.saveMyCalendarScope).toHaveBeenCalledWith([sampleCalendars[1].id]);
      expect(navigate).toHaveBeenCalledWith(`/c/${CONV_ID}`, true);
    });
  });

  it('provides secondary button to return to settings leaving connection in scope_required', async () => {
    const navigate = vi.fn();
    vi.spyOn(apiClient, 'listMyCalendarCalendars').mockResolvedValue({
      email: 'user@gmail.com',
      calendars: sampleCalendars,
      selectedCalendarIds: [],
    });

    render(<MyCalendarCallbackView navigate={navigate} input={{ mode: 'select' }} />);
    await screen.findByRole('group', { name: /Danh sách lịch ghi được/i });

    const laterButton = screen.getByRole('button', { name: /Để sau/i });
    fireEvent.click(laterButton);

    expect(navigate).toHaveBeenCalledWith('/settings#mycalendar', true);
  });
});

describe('SettingsPage - mycalendar section', () => {
  function setupServices(service: ServiceInfo) {
    vi.spyOn(apiClient, 'getServices').mockResolvedValue({
      services: [service],
      canConfigure: false,
    });
  }

  it('renders not_connected state with connect button', async () => {
    setupServices(mycalendarService('not_connected'));
    render(<SettingsPage user={member} navigate={() => {}} onLogout={() => {}} />);

    const personal = await screen.findByRole('region', { name: 'Của riêng bạn' });
    expect(within(personal).getByText(/Google Calendar của bạn/i)).toBeTruthy();
    expect(within(personal).getByText('Chưa kết nối')).toBeTruthy();
    expect(within(personal).getByRole('button', { name: /Kết nối Google Calendar/i })).toBeTruthy();
  });

  it('renders scope_required state with email and Choose Calendars button', async () => {
    setupServices(mycalendarService('scope_required'));
    render(<SettingsPage user={member} navigate={() => {}} onLogout={() => {}} />);

    const personal = await screen.findByRole('region', { name: 'Của riêng bạn' });
    expect(within(personal).getByText(/Đã cấp quyền · Chưa chọn lịch/i)).toBeTruthy();
    expect(within(personal).getByText(/user@gmail.com/i)).toBeTruthy();
    expect(within(personal).getByRole('button', { name: /Chọn lịch được dùng/i })).toBeTruthy();
    expect(within(personal).getByRole('button', { name: /Ngắt kết nối/i })).toBeTruthy();
  });

  it('renders connected state with selected calendars, reselect button and disconnect confirmation', async () => {
    setupServices(mycalendarService('connected'));
    vi.spyOn(apiClient, 'disconnectMyCalendar').mockResolvedValue({ success: true });

    render(<SettingsPage user={member} navigate={() => {}} onLogout={() => {}} />);

    const personal = await screen.findByRole('region', { name: 'Của riêng bạn' });
    expect(within(personal).getByText('Đã kết nối')).toBeTruthy();
    expect(within(personal).getByText(/user@gmail.com/i)).toBeTruthy();
    expect(within(personal).getByText('Lịch chính')).toBeTruthy();
    expect(within(personal).getByText('Lịch công việc')).toBeTruthy();
    expect(within(personal).getByRole('button', { name: /Chọn lại lịch được dùng/i })).toBeTruthy();

    const disconnectBtn = within(personal).getByRole('button', { name: 'Ngắt kết nối' });
    fireEvent.click(disconnectBtn);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Ngắt kết nối Google Calendar\?/i)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: /Xác nhận ngắt kết nối/i }));
    await waitFor(() => {
      expect(apiClient.disconnectMyCalendar).toHaveBeenCalledTimes(1);
    });
  });

  it('renders reconnect_required state with reconnect button', async () => {
    setupServices(mycalendarService('reconnect_required'));
    render(<SettingsPage user={member} navigate={() => {}} onLogout={() => {}} />);

    const personal = await screen.findByRole('region', { name: 'Của riêng bạn' });
    expect(within(personal).getByText(/Cần kết nối lại/i)).toBeTruthy();
    expect(within(personal).getByText(/user@gmail.com/i)).toBeTruthy();
    expect(within(personal).getByRole('button', { name: /Kết nối lại Google Calendar/i })).toBeTruthy();
  });
});

describe('Cockpit RefusalMoment', () => {
  const refusalMessage: ChatMessage = {
    id: 'msg-refusal-1',
    role: 'assistant',
    content: 'Từ chối yêu cầu: Google Calendar của bạn chưa được kết nối.',
    metadata: {
      type: 'refusal',
      reason: 'Google Calendar của bạn chưa được kết nối.',
      unavailableServices: [{ id: 'mycalendar', name: 'Google Calendar của bạn' }],
    },
  };

  it('renders Connect button when not_connected and calls startMyCalendarConnection with returnTo', async () => {
    const startSpy = vi.spyOn(apiClient, 'startMyCalendarConnection').mockResolvedValue({ url: 'https://accounts.google.com/auth' });
    const service = mycalendarService('not_connected');

    render(
      <RefusalMoment
        message={refusalMessage}
        request="Lên lịch họp"
        services={[service]}
        canConfigure={false}
        connectFromChat
        conversationId={CONV_ID}
        navigate={() => {}}
        onEdit={() => {}}
      />
    );

    const link = screen.getByRole('link', { name: /Kết nối Google Calendar/i });
    fireEvent.click(link);

    await waitFor(() => {
      expect(startSpy).toHaveBeenCalledWith({ returnTo: `/c/${CONV_ID}` });
    });
  });

  it('renders Choose Calendar button when scope_required and navigates to callback mode=select', async () => {
    const navigate = vi.fn();
    const service = mycalendarService('scope_required');

    render(
      <RefusalMoment
        message={refusalMessage}
        request="Lên lịch họp"
        services={[service]}
        canConfigure={false}
        connectFromChat
        conversationId={CONV_ID}
        navigate={navigate}
        onEdit={() => {}}
      />
    );

    const link = screen.getByRole('link', { name: /Chọn lịch Google Calendar/i });
    fireEvent.click(link);

    expect(navigate).toHaveBeenCalledWith(`/connections/mycalendar/callback?mode=select&returnTo=%2Fc%2F${CONV_ID}`);
  });

  it('renders Resend button when service is connected', () => {
    const onResend = vi.fn();
    const service = mycalendarService('connected');

    render(
      <RefusalMoment
        message={refusalMessage}
        request="Lên lịch họp vào ngày mai"
        services={[service]}
        canConfigure={false}
        connectFromChat
        conversationId={CONV_ID}
        navigate={() => {}}
        onEdit={() => {}}
        onResend={onResend}
      />
    );

    expect(screen.getByText(/Google Calendar của bạn đã được kết nối\. Bạn có thể gửi lại yêu cầu/i)).toBeTruthy();
    const resendBtn = screen.getByRole('button', { name: /Gửi lại yêu cầu/i });
    fireEvent.click(resendBtn);

    expect(onResend).toHaveBeenCalledWith('Lên lịch họp vào ngày mai');
  });
});

describe('Cockpit PlanMoment & ReceiptMoment', () => {
  const plan: ActivePlan = {
    id: 'plan-1',
    summary: 'Tạo lịch họp trên Google Calendar',
    connections: {
      mycalendar: {
        credentialId: 'cred-1',
        email: 'user@gmail.com',
        allowedCalendars: [{ id: 'cal-primary', summary: 'Lịch cá nhân' }],
      },
    },
    resourceLabels: {
      'cal-primary': 'Lịch cá nhân',
    },
    steps: [
      {
        id: 'step-1',
        tool: 'mycalendar.create_event',
        description: 'Tạo sự kiện họp quý 4',
        args: {
          calendarId: 'cal-primary',
          summary: 'Họp quý 4',
          start: '2026-10-30T09:00:00Z',
          end: '2026-10-30T10:00:00Z',
        },
      },
    ],
  };

  it('renders personal account info in PlanMoment', () => {
    const destination = (step: PlanStep, labels?: Record<string, string>) =>
      labels?.[String(step.args.calendarId)] ?? String(step.args.calendarId);

    render(
      <PlanMoment
        plan={plan}
        services={[mycalendarService('connected')]}
        destination={destination}
        onPreview={() => {}}
        onApprove={() => {}}
        onCancel={() => {}}
        onEdit={() => {}}
        inlineComposer={null}
        runtimeMode="sandbox"
      />
    );

    expect(screen.getByText(/Tài khoản: user@gmail\.com \(Google Calendar của bạn\)/i)).toBeTruthy();
    expect(screen.getByText(/Đích đến: Lịch cá nhân/i)).toBeTruthy();
  });

  it('renders safe outcome url on ReceiptMoment', () => {
    const destination = (step: PlanStep, labels?: Record<string, string>) =>
      labels?.[String(step.args.calendarId)] ?? String(step.args.calendarId);

    const executionStep = {
      id: 'step-1',
      tool: 'mycalendar.create_event',
      description: 'Tạo sự kiện họp quý 4',
      status: 'succeeded' as const,
      output: {
        id: 'evt-123',
        title: 'Họp quý 4',
        url: 'https://calendar.google.com/calendar/event?eid=123',
      },
      duration: '0,5 giây',
    };

    render(
      <ReceiptMoment
        request="Tạo lịch họp"
        steps={[executionStep]}
        planSteps={plan.steps}
        labels={plan.resourceLabels}
        services={[mycalendarService('connected')]}
        destination={destination}
        onNewConversation={() => {}}
        onFollowup={() => {}}
        servicePrompt={() => ''}
        onSettings={() => {}}
        servicesLoading={false}
        servicesError={null}
      />
    );

    const link = screen.getByRole('link', { name: /Mở sự kiện trên Google Calendar/i });
    expect(link).toHaveAttribute('href', 'https://calendar.google.com/calendar/event?eid=123');
    expect(link).toHaveAttribute('target', '_blank');
  });
});

describe('PrivacyPage with mycalendarEnabled', () => {
  it('displays Google Calendar privacy section when enabled', async () => {
    vi.spyOn(apiClient, 'getRuntime').mockResolvedValue({
      runtimeMode: 'sandbox',
      gmailEnabled: true,
      mycalendarEnabled: true,
    });

    render(<PrivacyPage navigate={() => {}} />);
    await waitFor(() => expect(apiClient.getRuntime).toHaveBeenCalled());

    expect(await screen.findByRole('region', { name: /Dữ liệu Google Calendar/i })).toBeTruthy();
  });
});
