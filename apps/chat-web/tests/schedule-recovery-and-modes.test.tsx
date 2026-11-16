/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ScheduleSection } from '../src/pages/History/ScheduleSection';
import { ScheduleRunRecovery } from '../src/pages/Cockpit/ScheduleRunRecovery';
import { apiClient } from '../src/services/api-client';
import * as useSchedulesHook from '../src/hooks/use-schedules';
import type { ScheduleRunView, ScheduleView } from '@wap/tool-schemas';
import type { ChatMessage, User } from '../src/types';

describe('FLOW-06 Web: Schedule approval modes, timezone, next run, and recovery', () => {
  const user: User = { id: 'u-1', email: 'user@example.test', name: 'Tester', role: 'member' };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders "Mỗi lượt cần bạn duyệt" badge on confirmed plan schedule in ScheduleMoment and ScheduleSection', async () => {
    vi.spyOn(useSchedulesHook, 'useSchedulesEnabled').mockReturnValue(true);
    vi.spyOn(apiClient, 'getSchedules').mockResolvedValue({
      schedules: [
        {
          id: 'sched-plan-1',
          convId: 'conv-plan-1',
          name: 'Tạo ticket từ email và nhắc việc',
          request: 'Mỗi sáng kiểm tra email và tạo ticket Trello',
          recurrence: { type: 'daily', time: '08:30' },
          services: ['trello', 'slack'],
          status: 'active',
          pauseReason: null,
          version: 1,
          nextRuns: ['2026-11-05T01:30:00.000Z'],
          kind: 'plan',
          lastRun: null,
        },
      ],
    });

    render(<ScheduleSection user={user} navigate={vi.fn()} />);

    expect(await screen.findByText('Tạo ticket từ email và nhắc việc')).toBeInTheDocument();
    expect(screen.getByText('Mỗi lượt cần bạn duyệt')).toBeInTheDocument();
    expect(screen.getByText(/giờ Việt Nam/)).toBeInTheDocument();
    expect(screen.getByText(/lần chạy tới/)).toBeInTheDocument();
  });

  it('renders "Tự gửi" badge and "Gửi định kỳ theo phạm vi đã xác nhận" on auto-digest schedules in ScheduleSection', async () => {
    vi.spyOn(useSchedulesHook, 'useSchedulesEnabled').mockReturnValue(true);
    vi.spyOn(apiClient, 'getSchedules').mockResolvedValue({
      schedules: [
        {
          id: 'sched-digest-1',
          convId: 'conv-digest-1',
          name: 'Bản tin GitHub mỗi sáng',
          request: 'Gửi bản tin GitHub repo acme/ati vào Slack',
          recurrence: { type: 'daily', time: '08:00' },
          services: ['github', 'slack'],
          status: 'active',
          pauseReason: null,
          version: 1,
          nextRuns: ['2026-11-05T01:00:00.000Z'],
          kind: 'github_digest',
          lastRun: null,
        },
      ],
    });

    render(<ScheduleSection user={user} navigate={vi.fn()} />);

    expect(await screen.findByText('Bản tin GitHub mỗi sáng')).toBeInTheDocument();
    expect(screen.getByText('Tự gửi')).toBeInTheDocument();
    expect(screen.getByText(/Gửi định kỳ theo phạm vi đã xác nhận/)).toBeInTheDocument();
  });

  it('displays alert for needs_attention run and prevents replan in ScheduleRunRecovery', async () => {
    vi.spyOn(useSchedulesHook, 'useSchedulesEnabled').mockReturnValue(true);
    vi.spyOn(apiClient, 'getSchedules').mockResolvedValue({
      schedules: [
        {
          id: 'sched-attn-1',
          convId: 'conv-attn-1',
          name: 'Lịch họp hàng tuần',
          request: 'Gửi lịch họp hàng tuần lên Slack',
          recurrence: { type: 'daily', time: '09:00' },
          services: ['calendar', 'slack'],
          status: 'active',
          pauseReason: null,
          version: 1,
          nextRuns: ['2026-11-05T02:00:00.000Z'],
          kind: 'plan',
          lastRun: {
            id: 'run-attn-1',
            scheduleId: 'sched-attn-1',
            dueAt: '2026-11-04T02:00:00.000Z',
            createdAt: '2026-11-04T02:00:05.000Z',
            trigger: 'scheduled',
            state: 'needs_attention',
            convId: 'conv-attn-run',
            planId: null,
            planStatus: null,
            missedCount: 0,
            error: 'Chưa xác định bản tin lịch đã gửi hay chưa. Hãy kiểm tra kênh nhận trước khi gửi thêm; lượt này không tự gửi lại.',
          },
        },
      ],
    });

    vi.spyOn(apiClient, 'getScheduleRuns').mockResolvedValue({
      runs: [
        {
          id: 'run-attn-1',
          scheduleId: 'sched-attn-1',
          dueAt: '2026-11-04T02:00:00.000Z',
          createdAt: '2026-11-04T02:00:05.000Z',
          trigger: 'scheduled',
          state: 'needs_attention',
          convId: 'conv-attn-run',
          planId: null,
          planStatus: null,
          missedCount: 0,
          error: 'Chưa xác định bản tin lịch đã gửi hay chưa. Hãy kiểm tra kênh nhận trước khi gửi thêm; lượt này không tự gửi lại.',
        },
      ],
    });

    render(<ScheduleSection user={user} navigate={vi.fn()} />);

    expect(await screen.findByText('Lịch họp hàng tuần')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/Lượt chạy cần bạn xem:/);
    expect(screen.getByRole('alert')).toHaveTextContent(/Chưa xác định bản tin lịch đã gửi hay chưa/);

    // Now test ScheduleRunRecovery: should NOT show replan button
    const runMsg: ChatMessage = {
      id: 'msg-run-attn',
      role: 'system',
      content: 'Lượt chạy cần bạn xem',
      metadata: {
        type: 'schedule_run',
        scheduleId: 'sched-attn-1',
        runId: 'run-attn-1',
      },
    };

    render(<ScheduleRunRecovery message={runMsg} navigate={vi.fn()} />);
    expect(await screen.findByRole('status')).toHaveTextContent(/Chưa xác định bản tin lịch đã gửi hay chưa/);
    expect(screen.queryByRole('button', { name: 'Lập lại kế hoạch' })).toBeNull();
  });

  it.each([
    ['completed', 'calendar_digest', true, 'Chưa xác định bản tin lịch đã gửi hay chưa'],
    ['completed', 'github_digest', true, 'Chưa xác định bản tin GitHub đã gửi hay chưa'],
    ['completed', 'github_digest', false, 'Chưa xác định bản tin GitHub đã gửi hay chưa'],
    ['active', 'plan', false, 'Chưa xác định bản tin lịch đã gửi hay chưa'],
  ] as const)('sets recovery availability for %s %s with eligibility %s', async (status, kind, eligible, error) => {
    const run: ScheduleRunView = {
      id: 'run-1', scheduleId: 'schedule-1', dueAt: '2026-11-04T02:00:00.000Z',
      createdAt: '2026-11-04T02:00:00.000Z', trigger: 'scheduled', state: 'needs_attention',
      convId: 'conv-run-1', planId: null, planStatus: null, missedCount: 0, error,
      deliveryStartedAt: '2026-11-04T02:00:01.000Z', canRetryDelivery: eligible,
    };
    const schedule: ScheduleView = {
      id: run.scheduleId, convId: 'conv-schedule-1', name: 'Bản tin một lần', request: 'Gửi bản tin',
      recurrence: { type: 'once', date: '2026-11-04', time: '09:00' },
      services: [kind === 'calendar_digest' ? 'mycalendar' : 'github', 'slack'],
      status, pauseReason: null, version: 1, nextRuns: [], kind, lastRun: run,
    };
    vi.spyOn(useSchedulesHook, 'useSchedulesEnabled').mockReturnValue(true);
    vi.spyOn(apiClient, 'getSchedules').mockResolvedValue({ schedules: [schedule] });
    vi.spyOn(apiClient, 'getScheduleRuns').mockResolvedValue({ runs: [run] });
    const resolve = vi.spyOn(apiClient, 'resolveScheduleRunDelivery').mockResolvedValue({
      run: { ...run, deliveryResolution: 'retried_new_run', deliveryFollowupRunId: 'follow-up-1' },
      followUpRun: { ...run, id: 'follow-up-1', trigger: 'manual', state: 'planning' },
      schedule,
    });
    const message: ChatMessage = {
      id: 'msg-run-1', role: 'system', content: 'Lượt chạy cần bạn xem',
      metadata: { type: 'schedule_run', scheduleId: run.scheduleId, runId: run.id },
    };

    for (const page of [
      <ScheduleSection user={user} navigate={vi.fn()} />,
      <ScheduleRunRecovery message={message} navigate={vi.fn()} />,
    ]) {
      const mounted = render(page);
      const confirm = await screen.findByTestId('checkbox-confirm-duplicate-risk');
      const retry = screen.getByTestId('btn-resolve-retry-new-run');
      expect(retry).toBeDisabled();
      if (eligible) {
        expect(confirm).toBeEnabled();
        fireEvent.click(confirm);
        fireEvent.click(retry);
        expect(await screen.findByTestId('delivery-resolution-badge')).toBeInTheDocument();
        expect(resolve).toHaveBeenLastCalledWith(run.id, { resolution: 'retry_new_run', confirmDuplicateRisk: true });
      } else {
        expect(confirm).toBeDisabled();
        expect(screen.getByTestId('btn-resolve-mark-sent')).toBeEnabled();
        expect(resolve).not.toHaveBeenCalled();
      }
      mounted.unmount();
    }
  });

  it('displays notice for awaiting_approval run in ScheduleSection', async () => {
    vi.spyOn(useSchedulesHook, 'useSchedulesEnabled').mockReturnValue(true);
    vi.spyOn(apiClient, 'getSchedules').mockResolvedValue({
      schedules: [
        {
          id: 'sched-wait-1',
          convId: 'conv-wait-1',
          name: 'Báo cáo Sprint Jira',
          request: 'Tổng hợp tiến độ Sprint Jira',
          recurrence: { type: 'daily', time: '17:00' },
          services: ['jira', 'slack'],
          status: 'active',
          pauseReason: null,
          version: 1,
          nextRuns: ['2026-11-05T10:00:00.000Z'],
          kind: 'plan',
          lastRun: {
            id: 'run-wait-1',
            scheduleId: 'sched-wait-1',
            dueAt: '2026-11-04T10:00:00.000Z',
            createdAt: '2026-11-04T10:00:05.000Z',
            trigger: 'scheduled',
            state: 'awaiting_approval',
            convId: 'conv-wait-run',
            planId: 'plan-123',
            planStatus: 'awaiting_approval',
            missedCount: 0,
            error: null,
          },
        },
      ],
    });

    render(<ScheduleSection user={user} navigate={vi.fn()} />);

    expect(await screen.findByText('Báo cáo Sprint Jira')).toBeInTheDocument();
    expect(screen.getByText('Lượt chạy chờ duyệt:')).toBeInTheDocument();
    expect(screen.getByText(/Kế hoạch đã sẵn sàng, cần bạn xem và xác nhận trước khi gửi/)).toBeInTheDocument();
  });

  it('recognizes NOTION_DELIVERY_UNKNOWN in ScheduleRunRecovery and hides replan button', async () => {
    vi.spyOn(useSchedulesHook, 'useSchedulesEnabled').mockReturnValue(true);
    vi.spyOn(apiClient, 'getScheduleRuns').mockResolvedValue({
      runs: [
        {
          id: 'run-notion-unknown-1',
          scheduleId: 'sched-notion-1',
          dueAt: '2026-11-04T02:00:00.000Z',
          createdAt: '2026-11-04T02:00:05.000Z',
          trigger: 'scheduled',
          state: 'needs_attention',
          convId: 'conv-notion-run',
          planId: null,
          planStatus: null,
          missedCount: 0,
          deliveryStartedAt: '2026-11-04T02:00:08.000Z',
          error:
            'NOTION_DELIVERY_UNKNOWN: Chưa xác định bản tin Notion đã gửi hay chưa. Hãy kiểm tra kênh nhận trước khi gửi thêm; lượt này không tự gửi lại.',
        },
      ],
    });

    const runMsg: ChatMessage = {
      id: 'msg-run-notion-attn',
      role: 'system',
      content: 'Lượt chạy cần bạn xem',
      metadata: {
        type: 'schedule_run',
        scheduleId: 'sched-notion-1',
        runId: 'run-notion-unknown-1',
      },
    };

    render(<ScheduleRunRecovery message={runMsg} navigate={vi.fn()} />);
    expect(await screen.findByRole('status')).toHaveTextContent(/Chưa xác định bản tin Notion đã gửi hay chưa/);
    expect(screen.queryByRole('button', { name: 'Lập lại kế hoạch' })).toBeNull();
    expect(screen.getByTestId('sheets-delivery-recovery-panel')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Xác nhận đã nhận báo cáo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tạo lượt gửi bù mới' })).toBeInTheDocument();
  });
});
