/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ScheduleMoment } from '../src/pages/Cockpit/ScheduleMoment';
import { ScheduleActions } from '../src/pages/Cockpit/ScheduleActions';
import { ScheduleRunRecovery } from '../src/pages/Cockpit/ScheduleRunRecovery';
import { ScheduleSection } from '../src/pages/History/ScheduleSection';
import { apiClient } from '../src/services/api-client';
import * as useSchedulesHook from '../src/hooks/use-schedules';
import { useChatStore } from '../src/store/chat-store';
import type { ChatMessage, User } from '../src/types';
import type {
  ScheduleProposalMetadata,
  ScheduleRunView,
  ScheduleView,
  SheetsDigestCandidate,
} from '@wap/tool-schemas';

describe('Task 7 (PR-7): Sheets Digest V2 Preview, Reauthorization CTA & Manual Delivery Recovery UI', () => {
  const user: User = {
    id: 'user-v2-1',
    email: 'an@example.test',
    name: 'An Nguyễn',
    role: 'member',
  };

  const SOURCE_CRED_UUID = '00000000-1111-4222-8333-444444444444';
  const DEST_CRED_UUID = '99999999-aaaa-4bbb-8ccc-dddddddddddd';

  const v2Candidate: SheetsDigestCandidate = {
    canAutoDigest: true,
    configHash: 'hash-v2-sealed-123',
    config: {
      version: 2,
      workspaceMode: 'organization',
      workspaceId: 'ws-org-1',
      source: {
        service: 'mysheets',
        credentialId: SOURCE_CRED_UUID,
        email: 'owner@personal.example.com',
        spreadsheetId: 'sheet-id-revenue-q4',
        spreadsheetTitle: 'Báo cáo Doanh thu Q4',
        sheetName: 'Tổng hợp',
        range: 'A1:F50',
        tailRows: 20,
      },
      destination: {
        service: 'gmail',
        credentialId: DEST_CRED_UUID,
        senderEmail: 'sender@company.example.com',
        recipientEmail: 'cfo@company.example.com',
      },
      includeAiSummary: true,
    },
    preview: {
      workspaceMode: 'organization',
      workspaceName: 'Acme Corp',
      sourceConnectionLabel: 'Google Sheets cá nhân (MySheets)',
      sourceOwnerLabel: 'owner@personal.example.com',
      spreadsheetTitle: 'Báo cáo Doanh thu Q4',
      spreadsheetId: 'sheet-id-revenue-q4',
      sheetName: 'Tổng hợp',
      requestedRangeLabel: 'A1:F50 (20 dòng cuối)',
      destinationConnectionLabel: 'Gmail cá nhân (sender@company.example.com)',
      destinationTargetLabel: 'Email nhận: cfo@company.example.com',
      crossBoundaryWarning:
        'Cảnh báo liên không gian: Lịch chạy trong Tổ chức "Acme Corp" nhưng đang đọc bảng tính từ Google Sheets cá nhân (owner@personal.example.com).',
    },
  };

  const pausedReauthSchedule: ScheduleView = {
    id: 'sched-sheets-reauth-1',
    convId: 'conv-sheets-reauth-1',
    version: 3,
    name: 'Báo cáo Doanh thu Q4 mỗi sáng',
    request: 'Đọc bảng Báo cáo Doanh thu Q4 tab Tổng hợp và gửi qua Gmail cho cfo@company.example.com',
    recurrence: { type: 'daily', time: '08:00' },
    services: ['mysheets', 'gmail'],
    status: 'paused',
    pauseReason:
      'REAUTH_REQUIRED: Lịch gửi báo cáo Google Sheets tự động thuộc phiên bản cũ (v1). Vui lòng mở lịch và xác nhận lại để tiếp tục chạy tự động.',
    nextRuns: [],
    lastRun: null,
    kind: 'sheets_digest',
    approvalMode: 'auto_digest',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    useChatStore.getState().reset();
    useChatStore.getState().setConversationId('conv-sheets-reauth-1');
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
    useChatStore.getState().reset();
  });

  it('1. renders pauseReason and "Xem trước & Cấp quyền lại" CTA on paused sheets_digest schedule, and triggers reauthorizeSchedulePreview + navigation', async () => {
    vi.spyOn(useSchedulesHook, 'useSchedulesEnabled').mockReturnValue(true);
    vi.spyOn(apiClient, 'getSchedules').mockResolvedValue({
      schedules: [pausedReauthSchedule],
    });

    const reauthMeta: ScheduleProposalMetadata = {
      type: 'schedule_proposal',
      scheduleId: pausedReauthSchedule.id,
      baseVersion: pausedReauthSchedule.version,
      reauthorize: true,
      expiresAt: '2026-11-09T01:15:00.000Z',
      services: ['mysheets', 'gmail'],
      nextRuns: ['2026-11-10T01:00:00.000Z'],
      previous: {
        name: pausedReauthSchedule.name,
        request: pausedReauthSchedule.request,
        recurrence: pausedReauthSchedule.recurrence,
        status: 'paused',
      },
      digestCandidate: v2Candidate,
      proposal: {
        kind: 'schedule',
        action: 'update',
        name: pausedReauthSchedule.name,
        request: pausedReauthSchedule.request,
        recurrence: pausedReauthSchedule.recurrence,
        summary: `Cấp quyền lại lịch "${pausedReauthSchedule.name}" (Google Sheets v2).`,
      },
    };

    const reauthSpy = vi
      .spyOn(apiClient, 'reauthorizeSchedulePreview')
      .mockResolvedValue({
        proposalMessageId: 'msg-reauth-prop-1',
        convId: pausedReauthSchedule.convId,
        scheduleId: pausedReauthSchedule.id,
        baseVersion: pausedReauthSchedule.version,
        expiresAt: '2026-11-09T01:15:00.000Z',
        candidate: v2Candidate,
        metadata: reauthMeta,
      });

    const navigate = vi.fn();
    render(<ScheduleSection user={user} navigate={navigate} />);

    expect(
      await screen.findByText('Báo cáo Doanh thu Q4 mỗi sáng')
    ).toBeInTheDocument();
    expect(
      screen.getByText(/REAUTH_REQUIRED: Lịch gửi báo cáo Google Sheets tự động thuộc phiên bản cũ \(v1\)/)
    ).toBeInTheDocument();

    const reauthBtn = screen.getByTestId('btn-reauthorize-schedule-preview');
    expect(reauthBtn).toHaveTextContent('Xem trước & Cấp quyền lại');

    fireEvent.click(reauthBtn);

    await waitFor(() => {
      expect(reauthSpy).toHaveBeenCalledWith(pausedReauthSchedule.id);
      expect(navigate).toHaveBeenCalledWith(`/c/${pausedReauthSchedule.convId}`);
    });
  });

  it('2. reveals "Xem trước & Cấp quyền lại" CTA when clicking "Chạy tiếp" on a paused sheets_digest schedule fails with 409 REAUTHORIZATION_REQUIRED', async () => {
    const manualPausedSchedule: ScheduleView = {
      ...pausedReauthSchedule,
      pauseReason: 'Bạn đã tạm dừng',
    };

    vi.spyOn(apiClient, 'changeSchedule').mockRejectedValue(
      Object.assign(
        new Error('Lịch gửi báo cáo Google Sheets cần được cấp quyền lại trước khi chạy tiếp.'),
        { status: 409, code: 'REAUTHORIZATION_REQUIRED' }
      )
    );

    const navigate = vi.fn();
    const onConflict = vi.fn(async () => {});
    render(
      <ScheduleActions
        schedule={manualPausedSchedule}
        navigate={navigate}
        onChanged={vi.fn()}
        onConflict={onConflict}
      />
    );

    expect(screen.queryByTestId('btn-reauthorize-schedule-preview')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Chạy tiếp' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /cần được cấp quyền lại trước khi chạy tiếp/
    );
    expect(screen.getByTestId('btn-reauthorize-schedule-preview')).toBeInTheDocument();
  });

  it('3. renders V2 SheetsDigestPreviewInfo in ScheduleMoment (source, owner, Gmail sender, recipient, crossBoundaryWarning) and NEVER leaks credentialId UUIDs', () => {
    const reauthMessage: ChatMessage = {
      id: 'msg-reauth-prop-1',
      role: 'assistant',
      content: 'Cấp quyền lại lịch',
      metadata: {
        type: 'schedule_proposal',
        scheduleId: pausedReauthSchedule.id,
        baseVersion: pausedReauthSchedule.version,
        reauthorize: true,
        expiresAt: '2026-11-09T01:15:00.000Z',
        services: ['mysheets', 'gmail'],
        nextRuns: ['2026-11-10T01:00:00.000Z'],
        previous: {
          name: pausedReauthSchedule.name,
          request: pausedReauthSchedule.request,
          recurrence: pausedReauthSchedule.recurrence,
          status: 'paused',
        },
        digestCandidate: v2Candidate,
        proposal: {
          kind: 'schedule',
          action: 'update',
          name: pausedReauthSchedule.name,
          request: pausedReauthSchedule.request,
          recurrence: pausedReauthSchedule.recurrence,
          summary: `Cấp quyền lại lịch "${pausedReauthSchedule.name}" (Google Sheets v2).`,
        },
      } as any,
    };

    render(
      <ScheduleMoment
        message={reauthMessage}
        convId={pausedReauthSchedule.convId}
        navigate={vi.fn()}
        onEdit={vi.fn()}
      />
    );

    expect(screen.getByTestId('reauthorize-proposal-banner')).toHaveTextContent(
      /Đề xuất cấp quyền lại lịch Google Sheets \(v2\)/
    );

    const previewBox = screen.getByTestId('sheets-digest-v2-preview');
    expect(previewBox).toHaveTextContent('Google Sheets cá nhân (MySheets)');
    expect(previewBox).toHaveTextContent('owner@personal.example.com');
    expect(previewBox).toHaveTextContent('Báo cáo Doanh thu Q4');
    expect(previewBox).toHaveTextContent('Tổng hợp');
    expect(previewBox).toHaveTextContent('A1:F50 (20 dòng cuối)');
    expect(previewBox).toHaveTextContent('Gmail cá nhân (sender@company.example.com)');
    expect(previewBox).toHaveTextContent('Email nhận: cfo@company.example.com');

    const warningBox = screen.getByTestId('sheets-digest-cross-boundary-warning');
    expect(warningBox).toHaveTextContent(
      'Cảnh báo liên không gian: Lịch chạy trong Tổ chức "Acme Corp" nhưng đang đọc bảng tính từ Google Sheets cá nhân (owner@personal.example.com).'
    );

    // Must never display raw credentialId UUIDs anywhere in the rendered DOM
    const fullText = document.body.textContent ?? '';
    expect(fullText).not.toContain(SOURCE_CRED_UUID);
    expect(fullText).not.toContain(DEST_CRED_UUID);
  });

  it('4. confirms reauthorized V2 proposal with auto_digest and handles stale/expired, revoked, and conflict errors with alert feedback', async () => {
    const reauthMessage: ChatMessage = {
      id: 'msg-reauth-prop-2',
      role: 'assistant',
      content: 'Cấp quyền lại lịch',
      metadata: {
        type: 'schedule_proposal',
        scheduleId: pausedReauthSchedule.id,
        baseVersion: pausedReauthSchedule.version,
        reauthorize: true,
        expiresAt: '2026-11-09T01:15:00.000Z',
        services: ['mysheets', 'gmail'],
        nextRuns: ['2026-11-10T01:00:00.000Z'],
        previous: {
          name: pausedReauthSchedule.name,
          request: pausedReauthSchedule.request,
          recurrence: pausedReauthSchedule.recurrence,
          status: 'paused',
        },
        digestCandidate: v2Candidate,
        proposal: {
          kind: 'schedule',
          action: 'update',
          name: pausedReauthSchedule.name,
          request: pausedReauthSchedule.request,
          recurrence: pausedReauthSchedule.recurrence,
          summary: `Cấp quyền lại lịch "${pausedReauthSchedule.name}" (Google Sheets v2).`,
        },
      } as any,
    };

    const confirmSpy = vi.spyOn(apiClient, 'confirmSchedule');
    vi.spyOn(apiClient, 'getConversation').mockResolvedValue({
      conversation: { id: pausedReauthSchedule.convId },
      messages: [reauthMessage],
    } as any);

    const view = render(
      <ScheduleMoment
        message={reauthMessage}
        convId={pausedReauthSchedule.convId}
        navigate={vi.fn()}
        onEdit={vi.fn()}
      />
    );

    // 4a. Stale / expired proposal
    confirmSpy.mockRejectedValueOnce(
      Object.assign(
        new Error('Đề xuất cấp quyền lại đã hết hạn (quá 15 phút). Vui lòng tạo lại bản xem trước.'),
        { status: 409, code: 'STALE_PROPOSAL' }
      )
    );
    fireEvent.click(screen.getByRole('button', { name: /Xác nhận/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Đề xuất cấp quyền lại đã hết hạn/
    );
    expect(confirmSpy).toHaveBeenLastCalledWith(
      pausedReauthSchedule.convId,
      'msg-reauth-prop-2',
      'auto_digest'
    );

    // 4b. Revoked credential / preview changed since preview
    confirmSpy.mockRejectedValueOnce(
      Object.assign(
        new Error('Kết nối Google Sheets hoặc quyền truy cập bảng tính đã thay đổi từ lúc xem trước.'),
        { status: 409, code: 'DIGEST_PREVIEW_CHANGED' }
      )
    );
    fireEvent.click(screen.getByRole('button', { name: /Xác nhận/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Kết nối Google Sheets hoặc quyền truy cập bảng tính đã thay đổi/
    );

    // 4c. Conflict / REAUTHORIZATION_NOT_READY
    confirmSpy.mockRejectedValueOnce(
      Object.assign(
        new Error('Quyền thành viên trong Tổ chức không còn hiệu lực.'),
        { status: 409, code: 'REAUTHORIZATION_NOT_READY' }
      )
    );
    fireEvent.click(screen.getByRole('button', { name: /Xác nhận/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Quyền thành viên trong Tổ chức không còn hiệu lực/
    );

    // 4d. Success confirmation reactivates schedule
    confirmSpy.mockResolvedValueOnce({
      schedule: {
        ...pausedReauthSchedule,
        status: 'active',
        pauseReason: null,
        version: 4,
        nextRuns: ['2026-11-10T01:00:00.000Z'],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /Xác nhận/ }));
    expect(await screen.findByText(/Đang bật/)).toBeInTheDocument();
    view.unmount();
  });

  it('5. renders uncertain delivery recovery in ScheduleSection and ScheduleRunRecovery, blocks replan, requires duplicate-risk checkbox for retry_new_run, and shows resolved audit badge', async () => {
    vi.spyOn(useSchedulesHook, 'useSchedulesEnabled').mockReturnValue(true);

    const uncertainRun: ScheduleRunView = {
      id: 'run-uncertain-1',
      scheduleId: 'sched-sheets-active-1',
      trigger: 'scheduled',
      dueAt: '2026-11-09T01:00:00.000Z',
      createdAt: '2026-11-09T01:00:02.000Z',
      state: 'needs_attention',
      missedCount: 0,
      convId: 'conv-run-uncertain-1',
      planId: null,
      planStatus: null,
      error:
        'SHEETS_DELIVERY_UNKNOWN: Đã bắt đầu gửi báo cáo sang Gmail nhưng mất kết nối trước khi nhận phản hồi. Không tự động gửi lại để tránh gửi trùng.',
      deliveryStartedAt: '2026-11-09T01:00:05.000Z',
      deliveryResolution: null,
      deliveryResolvedAt: null,
      deliveryFollowupRunId: null,
    };

    const activeSheetsSchedule: ScheduleView = {
      ...pausedReauthSchedule,
      id: 'sched-sheets-active-1',
      status: 'active',
      pauseReason: null,
      lastRun: uncertainRun,
    };

    vi.spyOn(apiClient, 'getSchedules').mockResolvedValue({
      schedules: [activeSheetsSchedule],
    });
    vi.spyOn(apiClient, 'getScheduleRuns').mockResolvedValue({
      runs: [uncertainRun],
    });

    const resolveSpy = vi.spyOn(apiClient, 'resolveScheduleRunDelivery');

    // Part A: Test ScheduleSection with retry_new_run (requires duplicate-risk checkbox)
    render(<ScheduleSection user={user} navigate={vi.fn()} />);

    expect(
      await screen.findByText('Báo cáo Doanh thu Q4 mỗi sáng')
    ).toBeInTheDocument();

    // Never offers 1-click "Lập lại kế hoạch"
    expect(screen.queryByRole('button', { name: 'Lập lại kế hoạch' })).toBeNull();

    const recoveryPanel = screen.getByTestId('sheets-delivery-recovery-panel');
    expect(recoveryPanel).toBeInTheDocument();

    const markSentBtn = screen.getByTestId('btn-resolve-mark-sent');
    const retryNewRunBtn = screen.getByTestId('btn-resolve-retry-new-run');
    const dupCheckbox = screen.getByTestId('checkbox-confirm-duplicate-risk') as HTMLInputElement;

    expect(markSentBtn).toBeEnabled();
    expect(dupCheckbox.checked).toBe(false);
    expect(retryNewRunBtn).toBeDisabled();

    // Check the duplicate risk checkbox -> enables retry_new_run button
    fireEvent.click(dupCheckbox);
    expect(dupCheckbox.checked).toBe(true);
    expect(retryNewRunBtn).toBeEnabled();

    const followUpRun: ScheduleRunView = {
      id: 'run-followup-999',
      scheduleId: activeSheetsSchedule.id,
      trigger: 'manual',
      dueAt: '2026-11-09T01:10:00.000Z',
      createdAt: '2026-11-09T01:10:00.000Z',
      state: 'planning',
      missedCount: 0,
      convId: 'conv-run-followup-999',
      planId: null,
      planStatus: null,
      error: null,
    };

    const resolvedRetriedRun: ScheduleRunView = {
      ...uncertainRun,
      deliveryResolution: 'retried_new_run',
      deliveryResolvedAt: '2026-11-09T01:10:00.000Z',
      deliveryFollowupRunId: followUpRun.id,
    };

    resolveSpy.mockResolvedValueOnce({
      run: resolvedRetriedRun,
      followUpRun,
      schedule: {
        ...activeSheetsSchedule,
        lastRun: followUpRun,
      },
    });

    fireEvent.click(retryNewRunBtn);

    await waitFor(() => {
      expect(resolveSpy).toHaveBeenCalledWith(uncertainRun.id, {
        resolution: 'retry_new_run',
        confirmDuplicateRisk: true,
      });
    });

    const badge = await screen.findByTestId('delivery-resolution-badge');
    expect(badge).toHaveTextContent('Đã tạo lượt gửi bù mới');
    expect(badge).toHaveTextContent('Mã lượt chạy bù: run-followup-999');
    expect(screen.queryByTestId('sheets-delivery-recovery-panel')).toBeNull();

    cleanup();

    // Part B: Test ScheduleRunRecovery with mark_sent
    const runMsg: ChatMessage = {
      id: 'msg-run-uncertain-1',
      role: 'user',
      content: activeSheetsSchedule.request,
      metadata: {
        type: 'schedule_run',
        scheduleId: activeSheetsSchedule.id,
        runId: uncertainRun.id,
        name: activeSheetsSchedule.name,
        dueAt: uncertainRun.dueAt,
        trigger: 'scheduled',
      },
    };

    render(<ScheduleRunRecovery message={runMsg} navigate={vi.fn()} />);

    expect(
      await screen.findByTestId('sheets-delivery-recovery-panel')
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lập lại kế hoạch' })).toBeNull();

    const resolvedConfirmedRun: ScheduleRunView = {
      ...uncertainRun,
      state: 'digest_sent',
      error: null,
      deliveryResolution: 'confirmed_sent',
      deliveryResolvedAt: '2026-11-09T01:12:00.000Z',
      delivery: {
        destination: 'gmail',
        targetId: 'cfo@company.example.com',
        targetLabel: 'cfo@company.example.com',
        spreadsheetId: 'sheet-id-revenue-q4',
        spreadsheetTitle: 'Báo cáo Doanh thu Q4',
        sheetName: 'Tổng hợp',
        rowCount: 20,
        summaryMode: 'ai',
        sentAt: '2026-11-09T01:12:00.000Z',
        manualConfirmedAt: '2026-11-09T01:12:00.000Z',
        manualResolution: {
          status: 'confirmed_sent',
          resolvedAt: '2026-11-09T01:12:00.000Z',
          manualConfirmedAt: '2026-11-09T01:12:00.000Z',
          resolvedBy: user.id,
        },
      },
    };

    resolveSpy.mockResolvedValueOnce({
      run: resolvedConfirmedRun,
      followUpRun: null,
      schedule: {
        ...activeSheetsSchedule,
        lastRun: resolvedConfirmedRun,
      },
    });

    fireEvent.click(screen.getByTestId('btn-resolve-mark-sent'));

    await waitFor(() => {
      expect(resolveSpy).toHaveBeenCalledWith(uncertainRun.id, {
        resolution: 'mark_sent',
      });
    });

    const confirmedBadge = await screen.findByTestId('delivery-resolution-badge');
    expect(confirmedBadge).toHaveTextContent('Đã xác nhận thủ công là đã gửi');
    expect(screen.queryByTestId('sheets-delivery-recovery-panel')).toBeNull();
  });

  it('6. negative guard: does NOT render SheetsDeliveryRecoveryControl for needs_attention runs without SHEETS_DELIVERY_UNKNOWN or without deliveryStartedAt', async () => {
    vi.spyOn(useSchedulesHook, 'useSchedulesEnabled').mockReturnValue(true);

    // Case A: non-SHEETS_DELIVERY_UNKNOWN error on a sheets_digest schedule
    const nonUnknownErrorRun: ScheduleRunView = {
      id: 'run-non-unknown-err-1',
      scheduleId: 'sched-sheets-active-neg-1',
      trigger: 'scheduled',
      dueAt: '2026-11-09T01:00:00.000Z',
      createdAt: '2026-11-09T01:00:02.000Z',
      state: 'needs_attention',
      missedCount: 0,
      convId: 'conv-run-non-unknown-1',
      planId: null,
      planStatus: null,
      error: 'GMAIL_RATE_LIMIT: Tạm thời không thể gửi báo cáo.',
      deliveryStartedAt: '2026-11-09T01:00:05.000Z',
      deliveryResolution: null,
      deliveryResolvedAt: null,
      deliveryFollowupRunId: null,
    };

    // Case B: SHEETS_DELIVERY_UNKNOWN error but missing deliveryStartedAt
    const missingDeliveryStartedAtRun: ScheduleRunView = {
      id: 'run-missing-started-at-1',
      scheduleId: 'sched-sheets-active-neg-1',
      trigger: 'scheduled',
      dueAt: '2026-11-09T02:00:00.000Z',
      createdAt: '2026-11-09T02:00:02.000Z',
      state: 'needs_attention',
      missedCount: 0,
      convId: 'conv-run-missing-started-at-1',
      planId: null,
      planStatus: null,
      error:
        'SHEETS_DELIVERY_UNKNOWN: Đã bắt đầu gửi báo cáo sang Gmail nhưng mất kết nối trước khi nhận phản hồi.',
      deliveryStartedAt: null,
      deliveryResolution: null,
      deliveryResolvedAt: null,
      deliveryFollowupRunId: null,
    };

    for (const candidateRun of [nonUnknownErrorRun, missingDeliveryStartedAtRun]) {
      const scheduleWithRun: ScheduleView = {
        ...pausedReauthSchedule,
        id: 'sched-sheets-active-neg-1',
        status: 'active',
        pauseReason: null,
        lastRun: candidateRun,
      };

      vi.spyOn(apiClient, 'getSchedules').mockResolvedValue({
        schedules: [scheduleWithRun],
      });
      vi.spyOn(apiClient, 'getScheduleRuns').mockResolvedValue({
        runs: [candidateRun],
      });

      // 1. Verify ScheduleSection does not render recovery controls
      render(<ScheduleSection user={user} navigate={vi.fn()} />);
      expect(await screen.findByText('Báo cáo Doanh thu Q4 mỗi sáng')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent(candidateRun.error!);
      expect(screen.queryByTestId('sheets-delivery-recovery-panel')).toBeNull();
      expect(screen.queryByTestId('btn-resolve-mark-sent')).toBeNull();
      expect(screen.queryByTestId('btn-resolve-retry-new-run')).toBeNull();
      cleanup();

      // 2. Verify ScheduleRunRecovery does not render recovery controls
      useChatStore.getState().setConversationId(candidateRun.convId!);
      const runMsg: ChatMessage = {
        id: `msg-${candidateRun.id}`,
        role: 'user',
        content: scheduleWithRun.request,
        metadata: {
          type: 'schedule_run',
          scheduleId: scheduleWithRun.id,
          runId: candidateRun.id,
          name: scheduleWithRun.name,
          dueAt: candidateRun.dueAt,
          trigger: 'scheduled',
        },
      };

      render(<ScheduleRunRecovery message={runMsg} navigate={vi.fn()} />);
      expect(await screen.findByRole('status')).toBeInTheDocument();
      expect(screen.queryByTestId('sheets-delivery-recovery-panel')).toBeNull();
      expect(screen.queryByTestId('btn-resolve-mark-sent')).toBeNull();
      expect(screen.queryByTestId('btn-resolve-retry-new-run')).toBeNull();
      cleanup();
    }
  });

  it('7. GAS-02 & GAS-09: supports opt-out of third-party AI summary in ScheduleMoment and blocks retry_new_run on paused schedule in ScheduleSection', async () => {
    vi.spyOn(useSchedulesHook, 'useSchedulesEnabled').mockReturnValue(true);

    // Part A: GAS-02 opt-out of includeAiSummary in ScheduleMoment
    const proposalMsg: ChatMessage = {
      id: 'msg-reauth-ai-optout-1',
      role: 'assistant',
      content: 'Cấp quyền lại lịch',
      metadata: {
        type: 'schedule_proposal',
        scheduleId: pausedReauthSchedule.id,
        baseVersion: pausedReauthSchedule.version,
        reauthorize: true,
        expiresAt: '2026-11-09T01:15:00.000Z',
        services: ['mysheets', 'gmail'],
        nextRuns: ['2026-11-10T01:00:00.000Z'],
        previous: {
          name: pausedReauthSchedule.name,
          request: pausedReauthSchedule.request,
          recurrence: pausedReauthSchedule.recurrence,
          status: 'paused',
        },
        digestCandidate: v2Candidate,
        proposal: {
          kind: 'schedule',
          action: 'update',
          name: pausedReauthSchedule.name,
          request: pausedReauthSchedule.request,
          recurrence: pausedReauthSchedule.recurrence,
          summary: `Cấp quyền lại lịch "${pausedReauthSchedule.name}" (Google Sheets v2).`,
        },
      } as any,
    };

    const confirmSpy = vi.spyOn(apiClient, 'confirmSchedule').mockResolvedValue({
      schedule: {
        ...pausedReauthSchedule,
        status: 'active',
        pauseReason: null,
        version: 4,
      },
    });

    render(
      <ScheduleMoment
        message={proposalMsg}
        convId={pausedReauthSchedule.convId}
        navigate={vi.fn()}
        onEdit={vi.fn()}
      />
    );

    const aiCheckbox = screen.getByTestId('checkbox-sheets-include-ai-summary') as HTMLInputElement;
    expect(aiCheckbox.checked).toBe(true);
    fireEvent.click(aiCheckbox);
    expect(aiCheckbox.checked).toBe(false);
    expect(screen.getByTestId('sheets-digest-v2-preview')).toHaveTextContent(
      /Chỉ thống kê số liệu thuần/
    );

    fireEvent.click(screen.getByRole('button', { name: /Xác nhận/ }));
    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalledWith(
        pausedReauthSchedule.convId,
        'msg-reauth-ai-optout-1',
        { approvalMode: 'auto_digest', includeAiSummary: false }
      );
    });
    cleanup();

    // Part B: GAS-09 paused schedule blocks retry_new_run in ScheduleSection while allowing mark_sent
    const pausedUncertainRun: ScheduleRunView = {
      id: 'run-paused-uncertain-1',
      scheduleId: pausedReauthSchedule.id,
      trigger: 'scheduled',
      dueAt: '2026-11-09T01:00:00.000Z',
      createdAt: '2026-11-09T01:00:02.000Z',
      state: 'needs_attention',
      missedCount: 0,
      convId: 'conv-run-paused-uncertain-1',
      planId: null,
      planStatus: null,
      error:
        'SHEETS_DELIVERY_UNKNOWN: Đã bắt đầu gửi báo cáo sang Gmail nhưng mất kết nối trước khi nhận phản hồi.',
      deliveryStartedAt: '2026-11-09T01:00:05.000Z',
      deliveryResolution: null,
      deliveryResolvedAt: null,
      deliveryFollowupRunId: null,
    };

    vi.spyOn(apiClient, 'getSchedules').mockResolvedValue({
      schedules: [{ ...pausedReauthSchedule, lastRun: pausedUncertainRun }],
    });

    render(<ScheduleSection user={user} navigate={vi.fn()} />);
    expect(await screen.findByText('Báo cáo Doanh thu Q4 mỗi sáng')).toBeInTheDocument();
    expect(screen.getByTestId('paused-schedule-retry-warning')).toHaveTextContent(
      /Lịch đang tạm dừng hoặc đã hủy/
    );
    expect(screen.getByTestId('btn-resolve-retry-new-run')).toBeDisabled();
    expect(screen.getByTestId('checkbox-confirm-duplicate-risk')).toBeDisabled();
    expect(screen.getByTestId('btn-resolve-mark-sent')).toBeEnabled();
  });
});
