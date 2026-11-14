/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ScheduleSection } from '../src/pages/History/ScheduleSection';
import {
  ScheduleRunRecovery,
  SheetsDeliveryRecoveryControl,
  isUncertainSheetsDeliveryRun,
} from '../src/pages/Cockpit/ScheduleRunRecovery';
import { apiClient } from '../src/services/api-client';
import * as useSchedulesHook from '../src/hooks/use-schedules';
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

  it('recognizes GITHUB_DELIVERY_UNKNOWN, NOTION_DELIVERY_UNKNOWN, and CALENDAR_DELIVERY_UNKNOWN in isUncertainSheetsDeliveryRun and renders operator recovery controls', async () => {
    const unknownCodes = [
      'GITHUB_DELIVERY_UNKNOWN: Chưa xác định bản tin GitHub đã gửi hay chưa.',
      'NOTION_DELIVERY_UNKNOWN: Chưa xác định bản tin Notion đã gửi hay chưa.',
      'CALENDAR_DELIVERY_UNKNOWN: Chưa xác định bản tin lịch đã gửi hay chưa.',
    ];

    for (const [idx, errorText] of unknownCodes.entries()) {
      const run = {
        id: `run-unknown-${idx}`,
        scheduleId: `sched-unknown-${idx}`,
        dueAt: '2026-11-04T02:00:00.000Z',
        createdAt: '2026-11-04T02:00:05.000Z',
        trigger: 'scheduled' as const,
        state: 'needs_attention' as const,
        convId: `conv-unknown-${idx}`,
        planId: null,
        planStatus: null,
        missedCount: 0,
        deliveryStartedAt: '2026-11-04T02:00:10.000Z',
        error: errorText,
      };
      expect(isUncertainSheetsDeliveryRun(run)).toBe(true);

      const { unmount } = render(
        <SheetsDeliveryRecoveryControl
          run={run}
          scheduleStatus="active"
          onResolved={vi.fn()}
        />
      );
      expect(screen.getByTestId('sheets-delivery-recovery-panel')).toBeInTheDocument();
      expect(screen.getByTestId('btn-resolve-mark-sent')).toBeInTheDocument();
      expect(screen.getByTestId('btn-resolve-retry-new-run')).toBeDisabled();
      unmount();
    }
  });
});
