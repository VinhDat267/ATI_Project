/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CalendarDigestConfig, ScheduleRunView, ScheduleView } from '@wap/tool-schemas';
import { ScheduleMoment } from '../src/pages/Cockpit/ScheduleMoment';
import { ScheduleRunRecovery } from '../src/pages/Cockpit/ScheduleRunRecovery';
import { ScheduleSection } from '../src/pages/History/ScheduleSection';
import { PersonalMyCalendar } from '../src/pages/Settings/PersonalMyCalendar';
import { MyCalendarCallbackView } from '../src/views/MyCalendarCallbackView';
import { apiClient } from '../src/services/api-client';
import { authStorage } from '../src/services/auth-storage';
import { runLabel } from '../src/services/schedule-text';
import { SchedulesCapabilityContext } from '../src/hooks/use-schedules';
import { useChatStore } from '../src/store/chat-store';
import type { ChatMessage, ServiceInfo, User } from '../src/types';

const member: User = { id: 'member-1', email: 'user@example.test', name: 'Thành viên', role: 'member' };
const CONV_ID = '11111111-2222-4333-8444-555555555555';

const sampleDigestConfig: CalendarDigestConfig = {
  version: 1,
  source: 'mycalendar',
  credentialId: 'cred-cal-1',
  email: 'user@gmail.com',
  calendars: [{ id: 'user@gmail.com', summary: 'Lịch chính', primary: true }],
  destination: { service: 'slack', channelId: 'C0123456789', channelName: 'daily-briefing' },
  windowHours: 24,
  includeSummary: true,
};

const baseSchedule: ScheduleView = {
  id: 'sched-digest-1',
  convId: CONV_ID,
  version: 1,
  name: 'Bản tin Lịch sáng',
  request: 'Mỗi sáng 7h30 kiểm tra lịch họp hôm nay và gửi vào Slack #daily-briefing',
  recurrence: { type: 'daily', time: '07:30' },
  services: ['mycalendar', 'slack'],
  status: 'active',
  pauseReason: null,
  nextRuns: ['2026-10-26T00:30:00Z'],
  lastRun: null,
  kind: 'calendar_digest',
  digestConfig: sampleDigestConfig,
};

beforeEach(() => {
  window.history.replaceState({}, '', '/');
  localStorage.clear();
  authStorage.setStoredTokens({ accessToken: 'access-1', refreshToken: 'refresh-1', user: member });
  useChatStore.getState().setConversationId(CONV_ID);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  useChatStore.getState().reset();
});

describe('ScheduleMoment — manual vs auto_digest mode selector', () => {
  it('defaults to manual mode, allows selecting auto_digest with locked scope card, and passes approvalMode to confirmSchedule', async () => {
    vi.spyOn(apiClient, 'confirmSchedule').mockResolvedValue({ schedule: baseSchedule });

    const message: ChatMessage = {
      id: 'msg-proposal-1',
      role: 'assistant',
      content: '',
      metadata: {
        type: 'schedule_proposal',
        proposal: {
          kind: 'schedule',
          action: 'create',
          name: baseSchedule.name,
          request: baseSchedule.request,
          recurrence: baseSchedule.recurrence,
          summary: 'Lịch tự động gửi bản tin sáng',
        },
        services: ['mycalendar', 'slack'],
        nextRuns: baseSchedule.nextRuns,
        digestCandidate: {
          eligible: true,
          config: sampleDigestConfig,
        },
      },
    };

    render(<ScheduleMoment message={message} convId={CONV_ID} navigate={vi.fn()} onEdit={vi.fn()} />);

    const manualRadio = document.querySelector<HTMLInputElement>('#schedule-mode-manual');
    const autoDigestRadio = document.querySelector<HTMLInputElement>('#schedule-mode-auto-digest');
    expect(manualRadio).not.toBeNull();
    expect(autoDigestRadio).not.toBeNull();
    expect(manualRadio!.checked).toBe(true);
    expect(autoDigestRadio!.checked).toBe(false);
    expect(document.querySelector('#schedule-auto-digest-scope')).toBeNull();

    fireEvent.click(autoDigestRadio!);
    expect(autoDigestRadio!.checked).toBe(true);

    const scopeBox = document.querySelector('#schedule-auto-digest-scope');
    expect(scopeBox).not.toBeNull();
    expect(scopeBox!.textContent).toContain('Lịch chính');
    expect(scopeBox!.textContent).toContain('#daily-briefing');
    expect(scopeBox!.textContent).toContain('Chỉ đọc');

    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
    await waitFor(() => {
      expect(apiClient.confirmSchedule).toHaveBeenCalledWith(CONV_ID, 'msg-proposal-1', 'auto_digest');
    });
  });

  it('hides auto_digest radio and displays explanation when digestCandidate is ineligible', () => {
    const message: ChatMessage = {
      id: 'msg-proposal-2',
      role: 'assistant',
      content: '',
      metadata: {
        type: 'schedule_proposal',
        proposal: {
          kind: 'schedule',
          action: 'create',
          name: 'Tạo lịch họp định kỳ',
          request: 'Mỗi sáng tạo sự kiện họp nhóm trên Google Calendar',
          recurrence: { type: 'daily', time: '08:00' },
          summary: 'Tạo lịch họp',
        },
        services: ['mycalendar', 'slack'],
        nextRuns: ['2026-10-26T01:00:00Z'],
        digestCandidate: {
          eligible: false,
          reason: 'Yêu cầu có thao tác ghi hoặc sửa lịch nên cần duyệt từng lượt chạy.',
        },
      },
    };

    render(<ScheduleMoment message={message} convId={CONV_ID} navigate={vi.fn()} onEdit={vi.fn()} />);
    expect(document.querySelector('#schedule-mode-auto-digest')).toBeNull();
    expect(screen.getByText(/Yêu cầu có thao tác ghi hoặc sửa lịch/i)).toBeInTheDocument();
  });
});

describe('ScheduleSection, ScheduleRunRecovery & runLabel for digest_sent / digest_failed', () => {
  it('formats digest_sent and digest_failed labels clearly in Vietnamese', () => {
    const sentRun: ScheduleRunView = {
      id: 'run-1',
      scheduleId: 'sched-digest-1',
      convId: CONV_ID,
      trigger: 'scheduled',
      dueAt: '2026-10-26T00:30:00Z',
      state: 'digest_sent',
      planId: null,
      planStatus: null,
      missedCount: 0,
      error: null,
      createdAt: '2026-10-26T00:30:05Z',
      delivery: {
        destinationService: 'slack',
        channelId: 'C0123456789',
        channelName: 'daily-briefing',
        calendarsChecked: 1,
        totalEvents: 3,
        conflictCount: 2,
        summaryIncluded: true,
        sentAt: '2026-10-26T00:30:05Z',
      },
    };
    const failedRun: ScheduleRunView = {
      ...sentRun,
      id: 'run-2',
      state: 'digest_failed',
      delivery: null,
      error: 'Không gửi được bản tin tới Slack.',
    };

    expect(runLabel(sentRun)).toContain('Đã tự gửi bản tin');
    expect(runLabel(sentRun)).toContain('3 sự kiện');
    expect(runLabel(sentRun)).toContain('2 trùng lịch');
    expect(runLabel(failedRun)).toBe('Gửi bản tin thất bại');
  });

  it('renders Tự gửi badge on calendar_digest schedules in ScheduleSection and allows replanning digest_failed runs', async () => {
    const failedRun: ScheduleRunView = {
      id: 'run-failed-1',
      scheduleId: baseSchedule.id,
      convId: CONV_ID,
      trigger: 'scheduled',
      dueAt: '2026-10-26T00:30:00Z',
      state: 'digest_failed',
      planId: null,
      planStatus: null,
      missedCount: 0,
      error: 'Lỗi mạng Slack',
      createdAt: '2026-10-26T00:30:05Z',
    };
    vi.spyOn(apiClient, 'getSchedules').mockResolvedValue({
      schedules: [{ ...baseSchedule, lastRun: failedRun }],
    });
    vi.spyOn(apiClient, 'getScheduleRuns').mockResolvedValue({ runs: [failedRun] });

    render(
      <SchedulesCapabilityContext.Provider value={true}>
        <ScheduleSection user={member} navigate={vi.fn()} />
      </SchedulesCapabilityContext.Provider>,
    );

    const badge = await screen.findByText('Tự gửi');
    expect(badge).toHaveAttribute('data-schedule-kind', 'calendar_digest');
    expect(screen.getByText(/Gửi bản tin thất bại/i)).toBeInTheDocument();

    const runMsg: ChatMessage = {
      id: 'msg-run-1',
      role: 'user',
      content: 'Gửi lịch họp',
      metadata: {
        type: 'schedule_run',
        scheduleId: baseSchedule.id,
        runId: failedRun.id,
        name: baseSchedule.name,
        dueAt: failedRun.dueAt,
      },
    };
    render(<ScheduleRunRecovery message={runMsg} navigate={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'Lập lại kế hoạch' })).toBeInTheDocument();
  });
});

describe('One-click Primary Calendar Quick-Select (#mycalendar-quick-primary)', () => {
  it('allows 1-click primary calendar selection in MyCalendarCallbackView', async () => {
    const navigate = vi.fn();
    vi.spyOn(apiClient, 'completeMyCalendarConnection').mockResolvedValue({
      status: 'scope_required',
      email: 'user@gmail.com',
      calendars: [
        { id: 'user@gmail.com', summary: 'Lịch chính', primary: true, accessRole: 'owner' },
        { id: 'work@group.calendar.google.com', summary: 'Lịch công việc', primary: false, accessRole: 'writer' },
      ],
      selectedCalendars: [],
      returnTo: `/c/${CONV_ID}`,
    });
    const selectPrimarySpy = vi.spyOn(apiClient, 'selectPrimaryMyCalendar').mockResolvedValue({
      status: 'connected',
      email: 'user@gmail.com',
      selectedCalendars: [{ id: 'user@gmail.com', summary: 'Lịch chính', primary: true }],
      allowedScope: ['user@gmail.com'],
    });

    render(
      <MyCalendarCallbackView
        navigate={navigate}
        input={{ code: 'CODE123', state: 'STATE456', returnTo: `/c/${CONV_ID}` }}
      />,
    );

    const quickBtn = await screen.findByRole('button', { name: /Dùng ngay Lịch chính/i });
    expect(quickBtn.id).toBe('mycalendar-quick-primary');
    fireEvent.click(quickBtn);

    await waitFor(() => {
      expect(selectPrimarySpy).toHaveBeenCalledTimes(1);
    });
    expect(navigate).toHaveBeenCalledWith(`/c/${CONV_ID}`, true);
  });

  it('allows 1-click primary calendar selection in PersonalMyCalendar when status is scope_required', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const selectPrimarySpy = vi.spyOn(apiClient, 'selectPrimaryMyCalendar').mockResolvedValue({
      status: 'connected',
      email: 'user@gmail.com',
      selectedCalendars: [{ id: 'user@gmail.com', summary: 'Lịch chính', primary: true }],
      allowedScope: ['user@gmail.com'],
    });

    const service: ServiceInfo = {
      id: 'mycalendar',
      name: 'Google Calendar của bạn',
      connection: 'personal',
      personalStatus: 'scope_required',
      connected: false,
      configured: false,
      email: 'user@gmail.com',
      tools: ['mycalendar.list_calendars', 'mycalendar.list_events', 'mycalendar.create_event'],
    };

    render(<PersonalMyCalendar service={service} refresh={refresh} selected={null} />);

    const quickBtn = screen.getByRole('button', { name: /Dùng ngay Lịch chính/i });
    expect(quickBtn.id).toBe('mycalendar-quick-primary');
    fireEvent.click(quickBtn);

    await waitFor(() => {
      expect(selectPrimarySpy).toHaveBeenCalledTimes(1);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
