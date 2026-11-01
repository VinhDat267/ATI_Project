/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { ScheduleMoment } from '../src/pages/Cockpit/ScheduleMoment';
import { ScheduleRunRecovery } from '../src/pages/Cockpit/ScheduleRunRecovery';
import { ScheduleSection } from '../src/pages/History/ScheduleSection';
import { SchedulesCapabilityContext } from '../src/hooks/use-schedules';
import { apiClient } from '../src/services/api-client';
import { useChatStore } from '../src/store/chat-store';
import type { ChatMessage } from '../src/types';
import type { ScheduleView } from '@wap/tool-schemas';

describe('Task 9: ScheduleMoment auto_digest mode & ScheduleSection digest states', () => {
  const user = { id: 'u1', name: 'An', email: 'an@example.test' };

  beforeEach(() => {
    vi.restoreAllMocks();
    useChatStore.getState().setConversationId('conv-1');
  });

  afterEach(() => {
    cleanup();
    useChatStore.getState().reset();
  });

  it('renders #schedule-mode-manual and #schedule-mode-auto-digest when canAutoDigest is true, and sends approvalMode on confirm', async () => {
    const confirmSpy = vi.spyOn(apiClient, 'confirmSchedule').mockResolvedValue({
      schedule: {
        id: 'sched-1',
        convId: 'conv-1',
        version: 1,
        name: 'Bản tin sáng',
        request: 'Mỗi sáng 8h tổng hợp lịch họp và GitHub gửi qua Telegram của tôi',
        recurrence: { type: 'daily', time: '08:00' },
        services: ['calendar', 'github', 'telegram'],
        status: 'active',
        pauseReason: null,
        nextRuns: ['2026-11-03T01:00:00Z'],
        lastRun: null,
        kind: 'telegram_digest',
        approvalMode: 'auto_digest',
        digest: {
          chatId: '777001',
          chatTitle: 'Telegram của tôi (An)',
          sources: [
            { service: 'calendar', label: 'Google Calendar' },
            { service: 'github', label: 'GitHub' },
          ],
          approvedAt: '2026-11-02T01:00:00Z',
        },
      },
    });

    const message: ChatMessage = {
      id: 'msg-prop-1',
      role: 'assistant',
      content: '',
      metadata: {
        type: 'schedule_proposal',
        proposal: {
          kind: 'schedule',
          action: 'create',
          name: 'Bản tin sáng',
          request: 'Mỗi sáng 8h tổng hợp lịch họp và GitHub gửi qua Telegram của tôi',
          recurrence: { type: 'daily', time: '08:00' },
          summary: 'Tạo lịch Bản tin sáng',
        },
        services: ['calendar', 'github', 'telegram'],
        nextRuns: ['2026-11-03T01:00:00Z'],
        digestCandidate: {
          canAutoDigest: true,
          config: {
            credentialId: 'cred-1',
            telegramUserId: '777001',
            username: 'an_nguyen',
            chatId: '777001',
            chatTitle: 'Telegram của tôi (An)',
            sources: [
              { service: 'calendar', tool: 'calendar.list_events', label: 'Google Calendar' },
              { service: 'github', tool: 'github.list_issues', label: 'GitHub' },
            ],
            recurrence: { type: 'daily', time: '08:00' },
            timeZone: 'Asia/Ho_Chi_Minh',
          },
          configHash: 'hash123',
        },
      },
    };

    render(<ScheduleMoment message={message} convId="conv-1" navigate={vi.fn()} onEdit={vi.fn()} />);

    const manualRadio = document.getElementById('schedule-mode-manual') as HTMLInputElement;
    const autoDigestRadio = document.getElementById('schedule-mode-auto-digest') as HTMLInputElement;
    expect(manualRadio).not.toBeNull();
    expect(autoDigestRadio).not.toBeNull();
    expect(manualRadio.checked).toBe(true);
    expect(autoDigestRadio.disabled).toBe(false);
    expect(screen.getByText(/Telegram của tôi \(An\)/)).toBeInTheDocument();

    fireEvent.click(autoDigestRadio);
    expect(autoDigestRadio.checked).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalledWith('conv-1', 'msg-prop-1', 'auto_digest');
    });
    expect(await screen.findByText(/Tự gửi Telegram/)).toBeInTheDocument();
  });

  it('disables #schedule-mode-auto-digest and displays disabledReason when canAutoDigest is false', () => {
    const message: ChatMessage = {
      id: 'msg-prop-2',
      role: 'assistant',
      content: '',
      metadata: {
        type: 'schedule_proposal',
        proposal: {
          kind: 'schedule',
          action: 'create',
          name: 'Tạo thẻ sáng',
          request: 'Mỗi sáng tạo thẻ Trello rồi báo Telegram',
          recurrence: { type: 'daily', time: '08:00' },
          summary: 'Tạo lịch',
        },
        services: ['trello', 'telegram'],
        nextRuns: ['2026-11-03T01:00:00Z'],
        digestCandidate: {
          canAutoDigest: false,
          disabledReason: 'Yêu cầu có thao tác ghi dữ liệu lên công cụ làm việc nên bắt buộc chờ bạn duyệt mỗi lượt.',
        },
      },
    };

    render(<ScheduleMoment message={message} convId="conv-1" navigate={vi.fn()} onEdit={vi.fn()} />);

    const autoDigestRadio = document.getElementById('schedule-mode-auto-digest') as HTMLInputElement;
    expect(autoDigestRadio).not.toBeNull();
    expect(autoDigestRadio.disabled).toBe(true);
    expect(
      screen.getByText(/Yêu cầu có thao tác ghi dữ liệu lên công cụ làm việc nên bắt buộc chờ bạn duyệt mỗi lượt\./)
    ).toBeInTheDocument();
  });

  it('displays "Tự gửi Telegram" badge and "Đã gửi" / "Gửi thất bại" in ScheduleSection and ScheduleRunRecovery', async () => {
    const digestSchedule: ScheduleView = {
      id: 'sched-digest-1',
      convId: 'conv-1',
      version: 1,
      name: 'Bản tin sáng',
      request: 'Báo cáo sáng qua Telegram',
      recurrence: { type: 'daily', time: '08:00' },
      services: ['github', 'telegram'],
      status: 'active',
      pauseReason: null,
      nextRuns: ['2026-11-03T01:00:00Z'],
      kind: 'telegram_digest',
      approvalMode: 'auto_digest',
      digest: {
        chatId: '777001',
        chatTitle: 'Telegram của tôi (An)',
        sources: [{ service: 'github', label: 'GitHub' }],
        approvedAt: '2026-11-02T01:00:00Z',
      },
      lastRun: {
        id: 'run-1',
        scheduleId: 'sched-digest-1',
        convId: 'conv-run-1',
        dueAt: '2026-11-02T01:00:00Z',
        trigger: 'scheduled',
        state: 'digest_sent',
        missedCount: 1,
        planId: null,
        planStatus: null,
        error: null,
        createdAt: '2026-11-02T01:00:00Z',
        delivery: {
          chatId: '777001',
          chatTitle: 'Telegram của tôi (An)',
          messageId: 88,
          sentAt: '2026-11-02T01:00:00Z',
          sources: [{ service: 'github', label: 'GitHub', status: 'ok', itemCount: 3 }],
        },
      },
    };

    vi.spyOn(apiClient, 'getSchedules').mockResolvedValue({ schedules: [digestSchedule] });
    vi.spyOn(apiClient, 'getScheduleRuns').mockResolvedValue({
      runs: [
        {
          id: 'run-fail-1',
          scheduleId: 'sched-digest-1',
          convId: 'conv-1',
          dueAt: '2026-11-02T01:00:00Z',
          trigger: 'scheduled',
          state: 'digest_failed',
          missedCount: 1,
          planId: null,
          planStatus: null,
          error: 'Telegram timeout',
          createdAt: '2026-11-02T01:00:00Z',
        },
      ],
    });

    render(
      <SchedulesCapabilityContext.Provider value={true}>
        <ScheduleSection user={user} navigate={vi.fn()} />
        <ScheduleRunRecovery
          message={{
            id: 'm-run',
            role: 'user',
            content: 'Báo cáo sáng',
            metadata: { type: 'schedule_run', scheduleId: 'sched-digest-1', runId: 'run-fail-1' },
          }}
          navigate={vi.fn()}
        />
      </SchedulesCapabilityContext.Provider>
    );

    expect(await screen.findByText(/Tự gửi Telegram · Telegram của tôi \(An\)/)).toBeInTheDocument();
    expect(screen.getByText('Đã gửi')).toBeInTheDocument();
    expect(await screen.findByText('Gửi thất bại')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Lập lại kế hoạch|Chạy lại/i })).toBeInTheDocument();
  });
});
