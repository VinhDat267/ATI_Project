/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { ScheduleMoment } from '../src/pages/Cockpit/ScheduleMoment';
import { ScheduleSection } from '../src/pages/History/ScheduleSection';
import { ScheduleRunRecovery } from '../src/pages/Cockpit/ScheduleRunRecovery';
import { apiClient } from '../src/services/api-client';
import * as useSchedulesHook from '../src/hooks/use-schedules';
import type { ChatMessage, User } from '../src/types';

describe('Task 9: ScheduleMoment mode choice & GitHub digest run states', () => {
  const user: User = { id: 'u-1', email: 'user@example.com', name: 'User', role: 'member' };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('defaults to #schedule-mode-manual and allows selecting #schedule-mode-auto-digest when canAutoDigest is true', async () => {
    const confirmSpy = vi.spyOn(apiClient, 'confirmSchedule').mockResolvedValue({
      schedule: {
        id: 'sched-1',
        convId: 'conv-1',
        name: 'Bản tin GitHub sáng',
        request: 'Mỗi sáng 8h gửi bản tin GitHub repo acme/ati vào Slack #team',
        recurrence: { type: 'daily', time: '08:00' },
        services: ['github', 'slack'],
        status: 'active',
        pauseReason: null,
        version: 1,
        nextRuns: ['2026-11-02T01:00:00.000Z'],
        lastRun: null,
        kind: 'github_digest',
        digest: {
          config: {
            credentialId: 'cred-1',
            githubUserId: 'gh-1',
            login: 'octocat',
            repos: ['acme/ati'],
            channelId: 'C123',
            channelName: 'team',
            staleDays: 2,
          },
          approvedAt: '2026-11-01T01:00:00.000Z',
        },
      },
    });

    const message: ChatMessage = {
      id: 'msg-prop-1',
      role: 'assistant',
      content: 'Đề xuất lịch chạy',
      metadata: {
        type: 'schedule_proposal',
        proposal: {
          kind: 'schedule',
          action: 'create',
          name: 'Bản tin GitHub sáng',
          request: 'Mỗi sáng 8h gửi bản tin GitHub repo acme/ati vào Slack #team',
          recurrence: { type: 'daily', time: '08:00' },
          summary: 'Gửi bản tin mỗi sáng',
        },
        services: ['github', 'slack'],
        nextRuns: ['2026-11-02T01:00:00.000Z'],
        digestCandidate: {
          canAutoDigest: true,
          config: {
            credentialId: 'cred-1',
            githubUserId: 'gh-1',
            login: 'octocat',
            repos: ['acme/ati'],
            channelId: 'C123',
            channelName: 'team',
            staleDays: 2,
          },
          configHash: 'hash-123',
        },
      },
    };

    render(<ScheduleMoment message={message} convId="conv-1" navigate={vi.fn()} onEdit={vi.fn()} />);

    const manualRadio = document.getElementById('schedule-mode-manual') as HTMLInputElement | HTMLButtonElement;
    const autoRadio = document.getElementById('schedule-mode-auto-digest') as HTMLInputElement | HTMLButtonElement;
    expect(manualRadio).toBeTruthy();
    expect(autoRadio).toBeTruthy();
    expect(autoRadio).not.toBeDisabled();

    // Default button says "Xác nhận"
    expect(screen.getByRole('button', { name: 'Xác nhận' })).toBeInTheDocument();

    // Click auto_digest mode
    fireEvent.click(autoRadio);

    // Scope lock preview appears and button label changes to "Xác nhận và bật tự gửi"
    expect(screen.getByText(/Repo: acme\/ati · Kênh Slack: #team/)).toBeInTheDocument();
    const confirmAutoBtn = screen.getByRole('button', { name: 'Xác nhận và bật tự gửi' });
    fireEvent.click(confirmAutoBtn);

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalledWith('conv-1', 'msg-prop-1', { approvalMode: 'auto_digest' });
    });
  });

  it('disables #schedule-mode-auto-digest and shows disabledReason when canAutoDigest is false', () => {
    const message: ChatMessage = {
      id: 'msg-prop-2',
      role: 'assistant',
      content: 'Đề xuất lịch chạy',
      metadata: {
        type: 'schedule_proposal',
        proposal: {
          kind: 'schedule',
          action: 'create',
          name: 'Đồng bộ GitHub sang Trello',
          request: 'Mỗi sáng 8h kiểm tra issue mới trên repo acme/ati và tạo thẻ Trello rồi báo Slack #team',
          recurrence: { type: 'daily', time: '08:00' },
          summary: 'Đồng bộ mỗi sáng',
        },
        services: ['github', 'trello', 'slack'],
        nextRuns: ['2026-11-02T01:00:00.000Z'],
        digestCandidate: {
          canAutoDigest: false,
          disabledReason: 'Chỉ bật được khi lịch chỉ đọc GitHub và gửi báo cáo vào 1 kênh Slack đã chọn.',
        },
      },
    };

    render(<ScheduleMoment message={message} convId="conv-1" navigate={vi.fn()} onEdit={vi.fn()} />);

    const autoRadio = document.getElementById('schedule-mode-auto-digest') as HTMLInputElement | HTMLButtonElement;
    expect(autoRadio).toBeTruthy();
    expect(autoRadio).toBeDisabled();
    expect(
      screen.getByText('Chỉ bật được khi lịch chỉ đọc GitHub và gửi báo cáo vào 1 kênh Slack đã chọn.')
    ).toBeInTheDocument();
  });

  it('renders "Tự gửi" badge and digest_sent / digest_failed labels in ScheduleSection and allows replanning digest_failed in ScheduleRunRecovery', async () => {
    vi.spyOn(useSchedulesHook, 'useSchedulesEnabled').mockReturnValue(true);
    vi.spyOn(apiClient, 'getSchedules').mockResolvedValue({
      schedules: [
        {
          id: 'sched-digest-1',
          convId: 'conv-1',
          name: 'Bản tin GitHub sáng',
          request: 'Mỗi sáng 8h gửi bản tin GitHub repo acme/ati vào Slack #team',
          recurrence: { type: 'daily', time: '08:00' },
          services: ['github', 'slack'],
          status: 'active',
          pauseReason: null,
          version: 1,
          nextRuns: ['2026-11-02T01:00:00.000Z'],
          kind: 'github_digest',
          lastRun: {
            id: 'run-sent-1',
            scheduleId: 'sched-digest-1',
            dueAt: '2026-11-01T01:00:00.000Z',
            createdAt: '2026-11-01T01:00:05.000Z',
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
              counts: { newIssues: 2, stalePrs: 1, unassignedIssues: 0 },
            },
          },
        },
      ],
    });
    vi.spyOn(apiClient, 'getScheduleRuns').mockResolvedValue({
      runs: [
        {
          id: 'run-failed-1',
          scheduleId: 'sched-digest-1',
          dueAt: '2026-11-01T01:00:00.000Z',
          createdAt: '2026-11-01T01:00:10.000Z',
          trigger: 'scheduled',
          state: 'digest_failed',
          convId: 'conv-run-failed',
          planId: null,
          planStatus: null,
          missedCount: 1,
          error: 'Slack timeout',
        },
      ],
    });

    render(<ScheduleSection user={user} navigate={vi.fn()} />);

    expect(await screen.findByText('Bản tin GitHub sáng')).toBeInTheDocument();
    expect(screen.getByText('Tự gửi')).toBeInTheDocument();
    expect(screen.getByText(/Đã gửi · 3 mục/)).toBeInTheDocument();

    const runMsg: ChatMessage = {
      id: 'msg-run-failed',
      role: 'system',
      content: 'Lượt chạy lỗi',
      metadata: {
        type: 'schedule_run',
        scheduleId: 'sched-digest-1',
        runId: 'run-failed-1',
      },
    };

    render(<ScheduleRunRecovery message={runMsg} navigate={vi.fn()} />);
    expect(await screen.findByText(/Gửi.*thất bại/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lập lại kế hoạch' })).toBeInTheDocument();
  });
});
