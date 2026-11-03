/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { ScheduleMoment } from '../src/pages/Cockpit/ScheduleMoment';
import { ScheduleSection } from '../src/pages/History/ScheduleSection';
import { apiClient } from '../src/services/api-client';
import * as useSchedulesHook from '../src/hooks/use-schedules';
import type { ChatMessage, User } from '../src/types';

describe('Trello Digest ScheduleMoment & ScheduleSection UI', () => {
  const user: User = { id: 'u-1', email: 'user@example.com', name: 'User', role: 'member' };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders trello_digest proposal without crashing, defaults to #schedule-mode-manual, and confirms auto_digest', async () => {
    const confirmSpy = vi.spyOn(apiClient, 'confirmSchedule').mockResolvedValue({
      schedule: {
        id: 'sched-trello-1',
        convId: 'conv-1',
        name: 'Báo cáo Trello mỗi sáng',
        request: 'Mỗi sáng 8h30 kiểm tra các thẻ quá hạn trên bảng Frontend gửi vào Slack #team',
        recurrence: { type: 'daily', time: '08:30' },
        services: ['trello', 'slack'],
        status: 'active',
        pauseReason: null,
        version: 1,
        nextRuns: ['2026-11-03T01:30:00.000Z'],
        lastRun: null,
        kind: 'trello_digest',
        digest: {
          config: {
            credentialId: 'cred-trello-1',
            trelloMemberId: 'mem-1',
            username: 'minh',
            boards: [{ id: 'b1', name: 'Frontend' }],
            channelId: 'C123',
            channelName: 'team',
            dueSoonHours: 24,
          },
          approvedAt: '2026-11-02T01:30:00.000Z',
        },
      },
    });

    const message: ChatMessage = {
      id: 'msg-trello-prop-1',
      role: 'assistant',
      content: 'Đề xuất lịch chạy Trello',
      metadata: {
        type: 'schedule_proposal',
        proposal: {
          kind: 'schedule',
          action: 'create',
          name: 'Báo cáo Trello mỗi sáng',
          request: 'Mỗi sáng 8h30 kiểm tra các thẻ quá hạn trên bảng Frontend gửi vào Slack #team',
          recurrence: { type: 'daily', time: '08:30' },
          summary: 'Gửi báo cáo Trello mỗi sáng',
        },
        services: ['trello', 'slack'],
        nextRuns: ['2026-11-03T01:30:00.000Z'],
        digestCandidate: {
          canAutoDigest: true,
          config: {
            credentialId: 'cred-trello-1',
            trelloMemberId: 'mem-1',
            username: 'minh',
            boards: [{ id: 'b1', name: 'Frontend' }],
            channelId: 'C123',
            channelName: 'team',
            dueSoonHours: 24,
          },
          configHash: 'hash-trello-123',
        },
      },
    };

    render(<ScheduleMoment message={message} convId="conv-1" navigate={vi.fn()} onEdit={vi.fn()} />);

    const manualRadio = document.getElementById('schedule-mode-manual') as HTMLInputElement;
    const autoRadio = document.getElementById('schedule-mode-auto-digest') as HTMLInputElement;
    expect(manualRadio).toBeTruthy();
    expect(autoRadio).toBeTruthy();
    expect(autoRadio).not.toBeDisabled();

    expect(screen.getByRole('button', { name: 'Xác nhận' })).toBeInTheDocument();

    fireEvent.click(autoRadio);

    expect(screen.getByText(/Bảng Trello: Frontend · Kênh Slack: #team/)).toBeInTheDocument();
    const confirmAutoBtn = screen.getByRole('button', { name: 'Xác nhận và bật tự gửi' });
    fireEvent.click(confirmAutoBtn);

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalledWith('conv-1', 'msg-trello-prop-1', { approvalMode: 'auto_digest' });
    });
  });

  it('disables #schedule-mode-auto-digest and displays disabledReason when trello_digest canAutoDigest is false', () => {
    const message: ChatMessage = {
      id: 'msg-trello-prop-2',
      role: 'assistant',
      content: 'Đề xuất lịch chạy Trello',
      metadata: {
        type: 'schedule_proposal',
        proposal: {
          kind: 'schedule',
          action: 'create',
          name: 'Tạo thẻ Trello định kỳ',
          request: 'Mỗi sáng 8h30 tạo thẻ mới trên bảng Frontend và báo Slack #team',
          recurrence: { type: 'daily', time: '08:30' },
          summary: 'Tạo thẻ mỗi sáng',
        },
        services: ['trello', 'slack'],
        nextRuns: ['2026-11-03T01:30:00.000Z'],
        digestCandidate: {
          canAutoDigest: false,
          disabledReason: 'Chỉ bật được khi lịch chỉ đọc Trello (không tạo/sửa thẻ) và gửi báo cáo vào 1 kênh Slack hoặc Telegram.',
        },
      },
    };

    render(<ScheduleMoment message={message} convId="conv-1" navigate={vi.fn()} onEdit={vi.fn()} />);

    const autoRadio = document.getElementById('schedule-mode-auto-digest') as HTMLInputElement;
    expect(autoRadio).toBeTruthy();
    expect(autoRadio).toBeDisabled();
    expect(
      screen.getByText('Chỉ bật được khi lịch chỉ đọc Trello (không tạo/sửa thẻ) và gửi báo cáo vào 1 kênh Slack hoặc Telegram.')
    ).toBeInTheDocument();
  });

  it('renders "Tự gửi" badge and Trello digest delivery summary in ScheduleSection', async () => {
    vi.spyOn(useSchedulesHook, 'useSchedulesEnabled').mockReturnValue(true);
    vi.spyOn(apiClient, 'getSchedules').mockResolvedValue({
      schedules: [
        {
          id: 'sched-trello-digest-1',
          convId: 'conv-1',
          name: 'Báo cáo Trello sáng',
          request: 'Mỗi sáng 8h30 tổng hợp thẻ quá hạn trên bảng Frontend gửi vào Slack #team',
          recurrence: { type: 'daily', time: '08:30' },
          services: ['trello', 'slack'],
          status: 'active',
          pauseReason: null,
          version: 1,
          nextRuns: ['2026-11-03T01:30:00.000Z'],
          kind: 'trello_digest',
          lastRun: {
            id: 'run-trello-1',
            scheduleId: 'sched-trello-digest-1',
            dueAt: '2026-11-02T01:30:00.000Z',
            createdAt: '2026-11-02T01:30:05.000Z',
            trigger: 'scheduled',
            state: 'digest_sent',
            convId: 'conv-run-1',
            planId: null,
            planStatus: null,
            missedCount: 1,
            error: null,
            delivery: {
              channelId: 'C123',
              channelName: 'team',
              ts: '1700000000.000100',
              counts: { overdueCards: 2, dueSoonCards: 1, unassignedCards: 3 },
            },
          },
        },
      ],
    });

    render(<ScheduleSection user={user} navigate={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Báo cáo Trello sáng')).toBeInTheDocument();
    });

    const badge = screen.getByText('Tự gửi');
    expect(badge).toHaveAttribute('data-schedule-kind', 'trello_digest');
    expect(screen.getByText('Đã gửi · 6 mục')).toBeInTheDocument();
    expect(screen.getByText('(#team)')).toBeInTheDocument();
  });
});
