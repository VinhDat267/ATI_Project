/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MYCALENDAR_SCOPE } from '../../../packages/tool-schemas/src/mycalendar';
import { MYSHEETS_SCOPE } from '../../../packages/tool-schemas/src/mysheets';
import type { ScheduleRunView, ScheduleView } from '@wap/tool-schemas';
import { RecoveryMoment } from '../src/pages/Cockpit/RecoveryMoment';
import { ScheduleRunRecovery } from '../src/pages/Cockpit/ScheduleRunRecovery';
import { ScheduleSection } from '../src/pages/History/ScheduleSection';
import { PrivacyPage } from '../src/pages/Privacy/PrivacyPage';
import { apiClient } from '../src/services/api-client';
import * as useSchedulesHook from '../src/hooks/use-schedules';
import { useChatStore } from '../src/store/chat-store';
import type { ChatMessage, ExecutionSnapshot, ServiceInfo } from '../src/types';

describe('XSVC-INTEGRATION-V2 Task D: Combined ScheduleRunRecovery, Sheets Append Uncertainty & PrivacyPage Contracts', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useChatStore.getState().reset();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
    useChatStore.getState().reset();
  });

  it('1. enforces paused-schedule retry restrictions inside Cockpit ScheduleRunRecovery for both SHEETS_DELIVERY_UNKNOWN and TRELLO_DELIVERY_UNKNOWN while still allowing mark_sent', async () => {
    vi.spyOn(useSchedulesHook, 'useSchedulesEnabled').mockReturnValue(true);

    const pausedCases: Array<{
      label: string;
      schedule: ScheduleView;
      run: ScheduleRunView;
    }> = [
      {
        label: 'paused sheets_digest run with SHEETS_DELIVERY_UNKNOWN',
        schedule: {
          id: 'sched-paused-sheets-1',
          convId: 'conv-sched-sheets-1',
          version: 3,
          name: 'Báo cáo Sheets Q4',
          request: 'Đọc bảng Q4 gửi Gmail',
          recurrence: { type: 'daily', time: '08:00' },
          services: ['mysheets', 'gmail'],
          status: 'paused',
          pauseReason: 'REAUTH_REQUIRED: Lịch cần xác nhận lại v2.',
          nextRuns: [],
          lastRun: null,
          kind: 'sheets_digest',
          approvalMode: 'auto_digest',
        },
        run: {
          id: 'run-paused-sheets-1',
          scheduleId: 'sched-paused-sheets-1',
          trigger: 'scheduled',
          dueAt: '2026-11-10T01:00:00.000Z',
          createdAt: '2026-11-10T01:00:02.000Z',
          state: 'needs_attention',
          missedCount: 0,
          convId: 'conv-run-paused-sheets-1',
          planId: null,
          planStatus: null,
          error: 'SHEETS_DELIVERY_UNKNOWN: Mất kết nối khi gửi báo cáo Sheets sang Gmail.',
          deliveryStartedAt: '2026-11-10T01:00:05.000Z',
          deliveryResolution: null,
          deliveryResolvedAt: null,
          deliveryFollowupRunId: null,
        },
      },
      {
        label: 'paused trello_digest run with TRELLO_DELIVERY_UNKNOWN',
        schedule: {
          id: 'sched-paused-trello-1',
          convId: 'conv-sched-trello-1',
          version: 2,
          name: 'Báo cáo Trello sáng',
          request: 'Tổng hợp bảng Sprint gửi Telegram',
          recurrence: { type: 'daily', time: '08:30' },
          services: ['trello', 'telegram'],
          status: 'paused',
          pauseReason: 'Không rõ trạng thái gửi của lượt tự gửi trước; cần kiểm tra kênh đích.',
          nextRuns: [],
          lastRun: null,
          kind: 'trello_digest',
          approvalMode: 'auto_digest',
        },
        run: {
          id: 'run-paused-trello-1',
          scheduleId: 'sched-paused-trello-1',
          trigger: 'scheduled',
          dueAt: '2026-11-10T01:30:00.000Z',
          createdAt: '2026-11-10T01:30:02.000Z',
          state: 'needs_attention',
          missedCount: 0,
          convId: 'conv-run-paused-trello-1',
          planId: null,
          planStatus: null,
          error: 'TRELLO_DELIVERY_UNKNOWN: Mất kết nối sau khi gửi báo cáo Trello sang Telegram.',
          deliveryStartedAt: '2026-11-10T01:30:05.000Z',
          deliveryResolution: null,
          deliveryResolvedAt: null,
          deliveryFollowupRunId: null,
        },
      },
    ];

    for (const { schedule, run } of pausedCases) {
      useChatStore.getState().setConversationId(run.convId!);
      vi.spyOn(apiClient, 'getSchedules').mockResolvedValue({ schedules: [schedule] });
      vi.spyOn(apiClient, 'getScheduleRuns').mockResolvedValue({ runs: [run] });
      const resolveSpy = vi.spyOn(apiClient, 'resolveScheduleRunDelivery').mockResolvedValue({
        run: {
          ...run,
          state: 'digest_sent',
          error: null,
          deliveryResolution: 'confirmed_sent',
          deliveryResolvedAt: '2026-11-10T01:40:00.000Z',
        },
        followUpRun: null,
        schedule,
      });

      const runMsg: ChatMessage = {
        id: `msg-${run.id}`,
        role: 'user',
        content: schedule.request,
        metadata: {
          type: 'schedule_run',
          scheduleId: schedule.id,
          runId: run.id,
          name: schedule.name,
          dueAt: run.dueAt,
          trigger: 'scheduled',
        },
      };

      render(<ScheduleRunRecovery message={runMsg} navigate={vi.fn()} />);

      expect(await screen.findByTestId('sheets-delivery-recovery-panel')).toBeInTheDocument();
      expect(screen.getByTestId('paused-schedule-retry-warning')).toHaveTextContent(
        /Lịch đang tạm dừng hoặc đã hủy/
      );

      const dupCheckbox = screen.getByTestId('checkbox-confirm-duplicate-risk') as HTMLInputElement;
      const retryBtn = screen.getByTestId('btn-resolve-retry-new-run');
      const markSentBtn = screen.getByTestId('btn-resolve-mark-sent');

      expect(dupCheckbox).toBeDisabled();
      expect(retryBtn).toBeDisabled();
      expect(markSentBtn).toBeEnabled();
      expect(screen.queryByRole('button', { name: 'Lập lại kế hoạch' })).toBeNull();

      // Clicking disabled retry must never dispatch retry_new_run
      fireEvent.click(dupCheckbox);
      fireEvent.click(retryBtn);
      expect(resolveSpy).not.toHaveBeenCalled();

      // Manual mark_sent remains available to confirm delivery without re-sending
      fireEvent.click(markSentBtn);
      await waitFor(() => {
        expect(resolveSpy).toHaveBeenCalledWith(run.id, { resolution: 'mark_sent' });
      });
      expect(await screen.findByTestId('delivery-resolution-badge')).toHaveAttribute(
        'data-resolution',
        'confirmed_sent'
      );

      cleanup();
      vi.restoreAllMocks();
      vi.spyOn(useSchedulesHook, 'useSchedulesEnabled').mockReturnValue(true);
    }
  });

  it('2. prevents unsafe replay and duplicate-risk bypass on Sheets append uncertainty (ScheduleRunRecovery & RecoveryMoment)', async () => {
    vi.spyOn(useSchedulesHook, 'useSchedulesEnabled').mockReturnValue(true);

    // Part A: ScheduleRunRecovery must never offer delivery duplicate-risk retry or replan when
    // Sheets append lease outcome is unknown or deliveryStartedAt is already set on an interrupted run
    const appendUncertainRun: ScheduleRunView = {
      id: 'run-append-unknown-1',
      scheduleId: 'sched-append-1',
      trigger: 'scheduled',
      dueAt: '2026-11-10T02:00:00.000Z',
      createdAt: '2026-11-10T02:00:01.000Z',
      state: 'interrupted',
      missedCount: 0,
      convId: 'conv-append-unknown-1',
      planId: 'plan-append-1',
      planStatus: 'reconciliation_required',
      error:
        'SHEETS_APPEND_UNKNOWN_OUTCOME_UNRECONCILED: Không thể ghi thêm khi phiên ghi trước chưa đối soát kết quả.',
      deliveryStartedAt: '2026-11-10T02:00:04.000Z',
      deliveryResolution: null,
      deliveryResolvedAt: null,
      deliveryFollowupRunId: null,
    };

    useChatStore.getState().setConversationId('conv-append-unknown-1');
    vi.spyOn(apiClient, 'getSchedules').mockResolvedValue({
      schedules: [
        {
          id: 'sched-append-1',
          convId: 'conv-sched-append-1',
          version: 1,
          name: 'Lịch ghi bảng tính',
          request: 'Ghi dòng tổng hợp vào Sheets',
          recurrence: { type: 'daily', time: '09:00' },
          services: ['mysheets'],
          status: 'active',
          pauseReason: null,
          nextRuns: [],
          lastRun: appendUncertainRun,
          kind: 'plan',
        },
      ],
    });
    vi.spyOn(apiClient, 'getScheduleRuns').mockResolvedValue({ runs: [appendUncertainRun] });

    render(
      <ScheduleRunRecovery
        message={{
          id: 'msg-append-unknown-1',
          role: 'user',
          content: 'Ghi dòng tổng hợp vào Sheets',
          metadata: {
            type: 'schedule_run',
            scheduleId: 'sched-append-1',
            runId: 'run-append-unknown-1',
          },
        }}
        navigate={vi.fn()}
      />
    );

    await waitFor(() => expect(apiClient.getScheduleRuns).toHaveBeenCalled());
    expect(screen.queryByTestId('sheets-delivery-recovery-panel')).toBeNull();
    expect(screen.queryByTestId('checkbox-confirm-duplicate-risk')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Lập lại kế hoạch' })).toBeNull();

    cleanup();

    // Part B: RecoveryMoment (Moment 8) for mysheets.append_rows in 'unknown' state
    // never offers Retry or Continue even if recoveryActions array is permissive; only manual check + Skip or Stop
    const services: ServiceInfo[] = [
      {
        id: 'mysheets',
        name: 'Google Sheets của bạn',
        connection: 'personal',
        connected: true,
        configured: true,
      },
    ];
    const snapshot: ExecutionSnapshot = {
      plan: {
        id: 'plan-sheets-unknown-1',
        convId: 'conv-sheets-unknown-1',
        summary: 'Ghi dòng KPI vào Google Sheets',
        status: 'reconciliation_required',
        connections: {
          mysheets: { credentialId: 'cred-ms-1', email: 'owner@example.test' } as any,
        },
        steps: [
          {
            id: 'step_append',
            tool: 'mysheets.append_rows',
            description: 'Thêm dòng KPI tuần',
            args: { spreadsheetId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms', sheet: 'KPI' },
          },
        ],
      },
      execution: { status: 'reconciliation_required', pausedStepId: 'step_append' },
      steps: [
        {
          stepId: 'step_append',
          tool: 'mysheets.append_rows',
          status: 'unknown',
          error: { message: 'Mất kết nối sau khi gửi lệnh ghi dòng.' },
        },
      ],
      recoveryActions: ['retry', 'continue', 'skip', 'stop'],
    };

    const onSkip = vi.fn();
    const onStop = vi.fn();
    render(
      <RecoveryMoment
        request="Thêm dòng KPI tuần"
        moment={8}
        snapshot={snapshot}
        steps={[
          {
            id: 'step_append',
            tool: 'mysheets.append_rows',
            description: 'Thêm dòng KPI tuần',
            status: 'unknown',
            error: 'Mất kết nối sau khi gửi lệnh ghi dòng.',
          },
        ]}
        services={services}
        controls={{
          busy: false,
          error: null,
          onRetry: vi.fn(),
          onContinue: vi.fn(),
          onSkip,
          onStop,
          onEdit: vi.fn(),
        }}
      />
    );

    expect(
      screen.getByRole('heading', { name: /Chưa rõ kết quả trên Google Sheets của bạn/i })
    ).toBeInTheDocument();
    const sheetLink = screen.getByRole('link', { name: 'Mở Google Sheets' });
    expect(sheetLink).toHaveAttribute(
      'href',
      'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit'
    );
    expect(screen.queryByRole('button', { name: /Thử lại/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Làm tiếp các việc còn lại' })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Đã thấy kết quả → Bỏ qua bước này và làm tiếp' })
    ).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Dừng kế hoạch' })).toBeEnabled();
  });

  it('3. resets duplicate-risk consent on Trello <-> Sheets run switch, enforces risk acknowledgement != authorization on 409 REAUTHORIZATION_REQUIRED, and blocks stale poll overwrite after resolution', async () => {
    vi.spyOn(useSchedulesHook, 'useSchedulesEnabled').mockReturnValue(true);

    const trelloRunA: ScheduleRunView = {
      id: 'run-trello-active-a',
      scheduleId: 'sched-trello-active',
      trigger: 'scheduled',
      dueAt: '2026-11-10T03:00:00.000Z',
      createdAt: '2026-11-10T03:00:02.000Z',
      state: 'needs_attention',
      missedCount: 0,
      convId: 'conv-run-active',
      planId: null,
      planStatus: null,
      error: 'TRELLO_DELIVERY_UNKNOWN: Chưa xác nhận được phản hồi gửi Telegram.',
      deliveryStartedAt: '2026-11-10T03:00:05.000Z',
      deliveryResolution: null,
      deliveryResolvedAt: null,
      deliveryFollowupRunId: null,
    };

    const sheetsRunB: ScheduleRunView = {
      id: 'run-sheets-active-b',
      scheduleId: 'sched-sheets-active',
      trigger: 'scheduled',
      dueAt: '2026-11-10T04:00:00.000Z',
      createdAt: '2026-11-10T04:00:02.000Z',
      state: 'needs_attention',
      missedCount: 0,
      convId: 'conv-run-active',
      planId: null,
      planStatus: null,
      error: 'SHEETS_DELIVERY_UNKNOWN: Chưa xác nhận được phản hồi gửi Slack.',
      deliveryStartedAt: '2026-11-10T04:00:05.000Z',
      deliveryResolution: null,
      deliveryResolvedAt: null,
      deliveryFollowupRunId: null,
    };

    useChatStore.getState().setConversationId('conv-run-active');
    const getSchedulesSpy = vi.spyOn(apiClient, 'getSchedules').mockResolvedValue({
      schedules: [
        {
          id: 'sched-trello-active',
          convId: 'conv-s1',
          version: 1,
          name: 'Trello Digest',
          request: 'Trello -> Telegram',
          recurrence: { type: 'daily', time: '08:00' },
          services: ['trello', 'telegram'],
          status: 'active',
          pauseReason: null,
          nextRuns: [],
          lastRun: trelloRunA,
          kind: 'trello_digest',
        },
        {
          id: 'sched-sheets-active',
          convId: 'conv-s2',
          version: 2,
          name: 'Sheets Digest',
          request: 'Sheets -> Slack',
          recurrence: { type: 'daily', time: '09:00' },
          services: ['mysheets', 'slack'],
          status: 'active',
          pauseReason: null,
          nextRuns: [],
          lastRun: sheetsRunB,
          kind: 'sheets_digest',
        },
      ],
    });
    const getRunsSpy = vi.spyOn(apiClient, 'getScheduleRuns').mockImplementation(async (schedId) => ({
      runs: schedId === 'sched-trello-active' ? [trelloRunA] : [sheetsRunB],
    }));

    const resolveSpy = vi.spyOn(apiClient, 'resolveScheduleRunDelivery');

    const view = render(
      <ScheduleRunRecovery
        message={{
          id: 'msg-run-a',
          role: 'user',
          content: 'Trello -> Telegram',
          metadata: {
            type: 'schedule_run',
            scheduleId: 'sched-trello-active',
            runId: 'run-trello-active-a',
          },
        }}
        navigate={vi.fn()}
      />
    );

    expect(await screen.findByTestId('sheets-delivery-recovery-panel')).toBeInTheDocument();
    const checkboxA = screen.getByTestId('checkbox-confirm-duplicate-risk') as HTMLInputElement;
    const retryBtnA = screen.getByTestId('btn-resolve-retry-new-run');
    expect(checkboxA.checked).toBe(false);
    expect(retryBtnA).toBeDisabled();

    // Checking duplicate-risk acknowledges duplicate risk only — never dispatches or grants server auth
    fireEvent.click(checkboxA);
    expect(checkboxA.checked).toBe(true);
    expect(resolveSpy).not.toHaveBeenCalled();

    // Server rejects retry_new_run with 409 REAUTHORIZATION_REQUIRED when pinned credential was revoked
    resolveSpy.mockRejectedValueOnce(
      Object.assign(new Error('REAUTHORIZATION_REQUIRED: Quyền kết nối đã thay đổi, cần xác nhận lại lịch.'), {
        status: 409,
        code: 'REAUTHORIZATION_REQUIRED',
      })
    );
    fireEvent.click(retryBtnA);
    expect(await screen.findByRole('alert')).toHaveTextContent(/REAUTHORIZATION_REQUIRED/);
    expect(screen.queryByTestId('delivery-resolution-badge')).toBeNull();

    // Switch ScheduleRunRecovery to Sheets run B: consent must reset to false and alert must clear
    view.rerender(
      <ScheduleRunRecovery
        message={{
          id: 'msg-run-b',
          role: 'user',
          content: 'Sheets -> Slack',
          metadata: {
            type: 'schedule_run',
            scheduleId: 'sched-sheets-active',
            runId: 'run-sheets-active-b',
          },
        }}
        navigate={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(getRunsSpy).toHaveBeenCalledWith('sched-sheets-active', 50);
    });
    const checkboxB = screen.getByTestId('checkbox-confirm-duplicate-risk') as HTMLInputElement;
    const retryBtnB = screen.getByTestId('btn-resolve-retry-new-run');
    expect(checkboxB.checked).toBe(false);
    expect(retryBtnB).toBeDisabled();
    expect(screen.queryByText(/REAUTHORIZATION_REQUIRED/)).toBeNull();

    // Acknowledge duplicate risk on Run B and verify exact run identity + double-click lock
    fireEvent.click(checkboxB);
    let finishResolveB!: (res: any) => void;
    resolveSpy.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishResolveB = resolve;
        })
    );

    fireEvent.click(retryBtnB);
    fireEvent.click(retryBtnB);
    expect(resolveSpy).toHaveBeenCalledTimes(2);
    expect(resolveSpy).toHaveBeenLastCalledWith('run-sheets-active-b', {
      resolution: 'retry_new_run',
      confirmDuplicateRisk: true,
    });

    const resolvedRunB: ScheduleRunView = {
      ...sheetsRunB,
      deliveryResolution: 'retried_new_run',
      deliveryResolvedAt: '2026-11-10T04:10:00.000Z',
      deliveryFollowupRunId: 'run-sheets-followup-c',
    };
    await act(async () => {
      finishResolveB({
        run: resolvedRunB,
        followUpRun: {
          ...sheetsRunB,
          id: 'run-sheets-followup-c',
          trigger: 'manual',
          state: 'planning',
          error: null,
        },
        schedule: {
          id: 'sched-sheets-active',
          convId: 'conv-s2',
          version: 2,
          name: 'Sheets Digest',
          request: 'Sheets -> Slack',
          recurrence: { type: 'daily', time: '09:00' },
          services: ['mysheets', 'slack'],
          status: 'active',
          pauseReason: null,
          nextRuns: [],
          lastRun: resolvedRunB,
          kind: 'sheets_digest',
        },
      });
    });

    const badge = await screen.findByTestId('delivery-resolution-badge');
    expect(badge).toHaveAttribute('data-resolution', 'retried_new_run');
    expect(badge).toHaveAttribute('data-followup-run-id', 'run-sheets-followup-c');

    // Stale background refresh returning unresolved sheetsRunB must NOT reopen recovery controls
    getRunsSpy.mockResolvedValueOnce({ runs: [sheetsRunB] });
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(screen.getByTestId('delivery-resolution-badge')).toHaveAttribute(
      'data-resolution',
      'retried_new_run'
    );
    expect(screen.queryByTestId('sheets-delivery-recovery-panel')).toBeNull();
    expect(getSchedulesSpy).toHaveBeenCalled();
  });

  it('4. retains runtime-aligned Sheets AI-summary opt-out and Calendar OAuth scope/revocation disclosures on combined PrivacyPage', async () => {
    expect(MYSHEETS_SCOPE).toBe('https://www.googleapis.com/auth/drive.file');
    expect(MYCALENDAR_SCOPE.split(/\s+/)).toEqual(
      expect.arrayContaining([
        'https://www.googleapis.com/auth/calendar.readonly',
        'https://www.googleapis.com/auth/calendar.events',
      ])
    );

    vi.spyOn(apiClient, 'getRuntime').mockResolvedValue({
      runtimeMode: 'sandbox',
      gmailEnabled: true,
      mycalendarEnabled: true,
      mysheetsEnabled: true,
    });

    render(<PrivacyPage navigate={vi.fn()} />);
    await waitFor(() => expect(apiClient.getRuntime).toHaveBeenCalled());

    const sheetsRegion = await screen.findByRole('region', {
      name: /Bảng tính Google Sheets của bạn/i,
    });
    const calendarRegion = await screen.findByRole('region', {
      name: /Dữ liệu Google Calendar của bạn/i,
    });

    expect(sheetsRegion).toHaveTextContent('drive.file');
    expect(sheetsRegion).toHaveTextContent('ENABLE_MYSHEETS_DRIVE_WRITE_TOOLS=false');
    expect(sheetsRegion).toHaveTextContent('includeAiSummary = true');
    expect(sheetsRegion).toHaveTextContent('includeAiSummary = false');
    expect(sheetsRegion).toHaveTextContent('9router');

    expect(calendarRegion).toHaveTextContent('calendar.readonly');
    expect(calendarRegion).toHaveTextContent('calendar.events');
    expect(calendarRegion).not.toHaveTextContent('calendar.calendarlist.readonly');
    expect(calendarRegion.textContent ?? '').not.toMatch(/sẽ bị thu hồi hoàn toàn/i);
    expect(calendarRegion).toHaveTextContent(/xoá token cùng phạm vi lịch đã lưu/i);
    expect(calendarRegion).toHaveTextContent(/Google Account/);
  });

  it('5. enforces ScheduleSection History recovery parity (paused retry restrictions, exact run identity, consent reset on schedule/run update) and cancelled-schedule replan suppression', async () => {
    vi.spyOn(useSchedulesHook, 'useSchedulesEnabled').mockReturnValue(true);

    const cancelledRun: ScheduleRunView = {
      id: 'run-cancelled-plan-1',
      scheduleId: 'sched-cancelled-1',
      trigger: 'scheduled',
      dueAt: '2026-11-10T05:00:00.000Z',
      createdAt: '2026-11-10T05:00:01.000Z',
      state: 'planning_failed',
      missedCount: 0,
      convId: 'conv-cancelled-1',
      planId: null,
      planStatus: null,
      error: 'Không lập được kế hoạch.',
      deliveryStartedAt: null,
      deliveryResolution: null,
      deliveryResolvedAt: null,
      deliveryFollowupRunId: null,
    };

    useChatStore.getState().setConversationId('conv-cancelled-1');
    vi.spyOn(apiClient, 'getSchedules').mockResolvedValueOnce({
      schedules: [
        {
          id: 'sched-cancelled-1',
          convId: 'conv-cancelled-root',
          version: 2,
          name: 'Lịch đã hủy',
          request: 'Gửi lịch họp',
          recurrence: { type: 'daily', time: '08:00' },
          services: ['calendar', 'slack'],
          status: 'cancelled',
          pauseReason: null,
          nextRuns: [],
          lastRun: cancelledRun,
          kind: 'plan',
        },
      ],
    });
    vi.spyOn(apiClient, 'getScheduleRuns').mockResolvedValueOnce({ runs: [cancelledRun] });

    render(
      <ScheduleRunRecovery
        message={{
          id: 'msg-cancelled-1',
          role: 'user',
          content: 'Gửi lịch họp',
          metadata: {
            type: 'schedule_run',
            scheduleId: 'sched-cancelled-1',
            runId: 'run-cancelled-plan-1',
          },
        }}
        navigate={vi.fn()}
      />
    );

    await waitFor(() => expect(apiClient.getScheduleRuns).toHaveBeenCalledWith('sched-cancelled-1', 50));
    expect(screen.queryByRole('button', { name: 'Lập lại kế hoạch' })).toBeNull();
    cleanup();

    const pausedTrelloRun: ScheduleRunView = {
      id: 'run-hist-trello-paused',
      scheduleId: 'sched-hist-1',
      trigger: 'scheduled',
      dueAt: '2026-11-10T06:00:00.000Z',
      createdAt: '2026-11-10T06:00:02.000Z',
      state: 'needs_attention',
      missedCount: 0,
      convId: 'conv-hist-1',
      planId: null,
      planStatus: null,
      error: 'TRELLO_DELIVERY_UNKNOWN: Không rõ kết quả gửi Telegram.',
      deliveryStartedAt: '2026-11-10T06:00:05.000Z',
      deliveryResolution: null,
      deliveryResolvedAt: null,
      deliveryFollowupRunId: null,
    };

    vi.spyOn(apiClient, 'getSchedules').mockResolvedValue({
      schedules: [
        {
          id: 'sched-hist-1',
          convId: 'conv-hist-root',
          version: 1,
          name: 'Trello Digest History',
          request: 'Tổng hợp Trello gửi Telegram',
          recurrence: { type: 'daily', time: '08:00' },
          services: ['trello', 'telegram'],
          status: 'paused',
          pauseReason: 'Tạm dừng chờ kiểm tra kênh đích.',
          nextRuns: [],
          lastRun: pausedTrelloRun,
          kind: 'trello_digest',
        },
      ],
    });

    render(
      <ScheduleSection
        user={{ id: 'u-1', email: 'owner@example.test', displayName: 'Owner', role: 'admin' } as any}
        navigate={vi.fn()}
      />
    );

    expect(await screen.findByTestId('sheets-delivery-recovery-panel')).toBeInTheDocument();
    expect(screen.getByTestId('paused-schedule-retry-warning')).toBeInTheDocument();
    expect(screen.getByTestId('checkbox-confirm-duplicate-risk')).toBeDisabled();
    expect(screen.getByTestId('btn-resolve-retry-new-run')).toBeDisabled();
    expect(screen.getByTestId('btn-resolve-mark-sent')).toBeEnabled();
  });
});
