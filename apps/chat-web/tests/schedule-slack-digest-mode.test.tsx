/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { ScheduleMoment } from '../src/pages/Cockpit/ScheduleMoment';
import { ScheduleRunRecovery } from '../src/pages/Cockpit/ScheduleRunRecovery';
import { ScheduleActions } from '../src/pages/Cockpit/ScheduleActions';
import { ScheduleSection } from '../src/pages/History/ScheduleSection';
import { SchedulesCapabilityContext } from '../src/hooks/use-schedules';
import { apiClient } from '../src/services/api-client';
import { useChatStore } from '../src/store/chat-store';
import type { ChatMessage } from '../src/types';
import type { ScheduleView } from '@wap/tool-schemas';

describe('Multi-service Slack auto_digest (slack_digest) UI states', () => {
  const user = { id: 'u1', name: 'An', email: 'an@example.test' };

  beforeEach(() => {
    vi.restoreAllMocks();
    useChatStore.getState().setConversationId('conv-slack-1');
  });

  afterEach(() => {
    cleanup();
    useChatStore.getState().reset();
  });

  it('renders multi-source Slack auto_digest option with locked #channel scope and sends auto_digest + includeAiSummary on confirm', async () => {
    const confirmSpy = vi.spyOn(apiClient, 'confirmSchedule').mockResolvedValue({
      schedule: {
        id: 'sched-slack-1',
        convId: 'conv-slack-1',
        version: 1,
        name: 'Bản tin tổng hợp Slack',
        request: 'Mỗi sáng 8h tổng hợp issue GitHub và lịch họp gửi về Slack #general',
        recurrence: { type: 'daily', time: '08:00' },
        services: ['github', 'mycalendar', 'slack'],
        status: 'active',
        pauseReason: null,
        nextRuns: ['2026-11-18T01:00:00Z'],
        lastRun: null,
        kind: 'slack_digest',
        approvalMode: 'auto_digest',
        digest: {
          destinationService: 'slack',
          channelId: 'C_GENERAL',
          channelName: 'general',
          sources: [
            { service: 'github', label: 'GitHub' },
            { service: 'mycalendar', label: 'Google Calendar' },
          ],
          approvedAt: '2026-11-17T01:00:00Z',
        },
      },
    });

    const message: ChatMessage = {
      id: 'msg-slack-prop-1',
      role: 'assistant',
      content: '',
      metadata: {
        type: 'schedule_proposal',
        proposal: {
          kind: 'schedule',
          action: 'create',
          name: 'Bản tin tổng hợp Slack',
          request: 'Mỗi sáng 8h tổng hợp issue GitHub và lịch họp gửi về Slack #general',
          recurrence: { type: 'daily', time: '08:00' },
          summary: 'Tạo lịch tổng hợp GitHub & Google Calendar lên Slack #general',
        },
        services: ['github', 'mycalendar', 'slack'],
        nextRuns: ['2026-11-18T01:00:00Z'],
        digestCandidate: {
          canAutoDigest: true,
          config: {
            slackCredentialId: 'cred-slack-1',
            channelId: 'C_GENERAL',
            channelName: 'general',
            destination: 'slack',
            sources: [
              { service: 'github', tool: 'github.list_issues', label: 'GitHub Issues' },
              { service: 'mycalendar', tool: 'mycalendar.list_events', label: 'Google Calendar' },
            ],
            recurrence: { type: 'daily', time: '08:00' },
            timeZone: 'Asia/Ho_Chi_Minh',
          },
          configHash: 'hash-slack-multi',
        },
      },
    };

    render(<ScheduleMoment message={message} convId="conv-slack-1" navigate={vi.fn()} onEdit={vi.fn()} />);

    const autoDigestRadio = document.getElementById('schedule-mode-auto-digest') as HTMLInputElement;
    expect(autoDigestRadio).not.toBeNull();
    expect(autoDigestRadio.disabled).toBe(false);
    expect(screen.getByText(/Gửi về Slack:/)).toHaveTextContent('#general');

    fireEvent.click(autoDigestRadio);
    expect(autoDigestRadio.checked).toBe(true);
    const scopeBox = document.getElementById('schedule-auto-digest-scope');
    expect(scopeBox).not.toBeNull();
    expect(scopeBox).toHaveTextContent(/GitHub Issues, Google Calendar/);
    expect(scopeBox).toHaveTextContent(/Slack · #general/);

    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalledWith('conv-slack-1', 'msg-slack-prop-1', 'auto_digest');
    });
    expect(await screen.findByText(/Tự gửi Slack/)).toBeInTheDocument();
  });

  it('disables #schedule-mode-auto-digest cleanly on multi-source Slack write proposals instead of falling back to single-source GitHub', () => {
    const message: ChatMessage = {
      id: 'msg-slack-prop-disabled',
      role: 'assistant',
      content: '',
      metadata: {
        type: 'schedule_proposal',
        proposal: {
          kind: 'schedule',
          action: 'create',
          name: 'Cập nhật tổng hợp',
          request: 'Đóng issue GitHub rồi gửi tổng hợp lên Slack',
          recurrence: { type: 'daily', time: '08:00' },
          summary: 'Lịch có thao tác ghi',
        },
        services: ['github', 'mycalendar', 'slack'],
        nextRuns: ['2026-11-18T01:00:00Z'],
        digestCandidate: {
          canAutoDigest: false,
          disabledReason: 'Yêu cầu có thao tác ghi dữ liệu nên bắt buộc duyệt từng lượt.',
        },
      },
    };

    render(<ScheduleMoment message={message} convId="conv-slack-1" navigate={vi.fn()} onEdit={vi.fn()} />);
    const autoDigestRadio = document.getElementById('schedule-mode-auto-digest') as HTMLInputElement;
    expect(autoDigestRadio).not.toBeNull();
    expect(autoDigestRadio.disabled).toBe(true);
    expect(
      screen.getByText(/Yêu cầu có thao tác ghi dữ liệu nên bắt buộc duyệt từng lượt\./),
    ).toBeInTheDocument();
  });

  it('displays Slack multi-digest badge, history run summary, SLACK_DELIVERY_UNKNOWN recovery controls, and reauthorize button', async () => {
    const slackDigestSchedule: ScheduleView = {
      id: 'sched-slack-digest-1',
      convId: 'conv-slack-1',
      version: 2,
      name: 'Standup Đa Nguồn Slack',
      request: 'Tổng hợp GitHub và Trello gửi vào Slack #general',
      recurrence: { type: 'daily', time: '08:30' },
      services: ['github', 'trello', 'slack'],
      status: 'paused',
      pauseReason: 'Cần cấp quyền lại lịch do kênh Slack thay đổi.',
      nextRuns: [],
      kind: 'slack_digest',
      approvalMode: 'auto_digest',
      digest: {
        destinationService: 'slack',
        channelId: 'C_GENERAL',
        channelName: 'general',
        sources: [
          { service: 'github', label: 'GitHub' },
          { service: 'trello', label: 'Trello' },
        ],
        approvedAt: '2026-11-17T01:00:00Z',
      },
      lastRun: {
        id: 'run-slack-sent-1',
        scheduleId: 'sched-slack-digest-1',
        convId: 'conv-run-slack-1',
        dueAt: '2026-11-17T01:30:00Z',
        trigger: 'scheduled',
        state: 'digest_sent',
        missedCount: 1,
        planId: null,
        planStatus: null,
        error: null,
        createdAt: '2026-11-17T01:30:00Z',
        delivery: {
          destinationService: 'slack',
          channelId: 'C_GENERAL',
          channelName: 'general',
          ts: '1700000100.000100',
          sentAt: '2026-11-17T01:30:05Z',
          sources: [
            { service: 'github', label: 'GitHub', status: 'ok', itemCount: 2 },
            { service: 'trello', label: 'Trello', status: 'ok', itemCount: 4 },
          ],
        },
      },
    };

    const uncertainRun = {
      id: 'run-slack-unknown-1',
      scheduleId: 'sched-slack-digest-1',
      convId: 'conv-slack-1',
      dueAt: '2026-11-17T02:00:00Z',
      trigger: 'scheduled' as const,
      state: 'needs_attention' as const,
      missedCount: 1,
      planId: null,
      planStatus: null,
      error: 'SLACK_DELIVERY_UNKNOWN: Chưa xác định bản tin Slack đã gửi hay chưa.',
      deliveryStartedAt: '2026-11-17T02:00:02Z',
      createdAt: '2026-11-17T02:00:00Z',
    };

    vi.spyOn(apiClient, 'getSchedules').mockResolvedValue({ schedules: [slackDigestSchedule] });
    vi.spyOn(apiClient, 'getScheduleRuns').mockResolvedValue({ runs: [uncertainRun] });

    render(
      <SchedulesCapabilityContext.Provider value={true}>
        <ScheduleSection user={user} navigate={vi.fn()} />
        <ScheduleActions schedule={slackDigestSchedule} navigate={vi.fn()} onChanged={vi.fn()} onConflict={vi.fn()} />
        <ScheduleRunRecovery
          message={{
            id: 'm-run-unknown',
            role: 'user',
            content: 'Báo cáo sáng',
            metadata: { type: 'schedule_run', scheduleId: 'sched-slack-digest-1', runId: 'run-slack-unknown-1' },
          }}
          navigate={vi.fn()}
        />
      </SchedulesCapabilityContext.Provider>,
    );

    expect(await screen.findByText(/Tự gửi Slack · #general/)).toBeInTheDocument();
    expect(screen.getByText(/Slack #general · 2 nguồn/)).toBeInTheDocument();
    expect(screen.getAllByTestId('btn-reauthorize-schedule-preview').length).toBeGreaterThanOrEqual(1);
    expect(await screen.findByTestId('sheets-delivery-recovery-panel')).toBeInTheDocument();
    expect(screen.getByTestId('btn-resolve-mark-sent')).toBeInTheDocument();
  });
});
