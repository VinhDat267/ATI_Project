/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ScheduleRunView, ScheduleView, CalendarDigestConfig } from '@wap/tool-schemas';
import { ScheduleMoment } from '../src/pages/Cockpit/ScheduleMoment';
import { ScheduleActions, primaryScheduleButton, scheduleButton } from '../src/pages/Cockpit/ScheduleActions';
import { ScheduleRunRecovery } from '../src/pages/Cockpit/ScheduleRunRecovery';
import { ScheduleSection } from '../src/pages/History/ScheduleSection';
import { apiClient } from '../src/services/api-client';
import { useChatStore } from '../src/store/chat-store';
import { SchedulesCapabilityContext } from '../src/hooks/use-schedules';
import type { ChatMessage, User } from '../src/types';


describe('PL-11 Planora Schedules & Auto-Digest UI - Business-First UX v2.0', () => {
  const user: User = {
    id: 'u-planora-pl11',
    name: 'Planora User',
    email: 'user@planora.test',
    role: 'member',
    status: 'active',
  };

  const CONV_ID = 'c-pl11-1234';

  const sampleDigestConfig: CalendarDigestConfig = {
    version: 1,
    source: 'mycalendar',
    credentialId: 'cred-cal-1',
    email: 'user@planora.test',
    calendars: [{ id: 'user@planora.test', summary: 'Lịch công việc', primary: true }],
    destination: { service: 'slack', channelId: 'C_DEV', channelName: 'dev' },
    windowHours: 24,
    includeSummary: true,
  };

  const sampleSchedule: ScheduleView = {
    id: 's-pl11',
    convId: CONV_ID,
    version: 1,
    name: 'Bản tin sáng',
    request: 'Mỗi sáng 08:00 kiểm tra lịch họp và gửi vào Slack #dev',
    recurrence: { type: 'daily', time: '08:00' },
    services: ['mycalendar', 'slack'],
    status: 'active',
    pauseReason: null,
    nextRuns: ['2026-11-08T01:00:00Z'],
    lastRun: null,
    kind: 'calendar_digest',
    digestConfig: sampleDigestConfig,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    useChatStore.getState().setConversationId(CONV_ID);
  });

  afterEach(() => {
    cleanup();
    useChatStore.getState().reset();
    vi.unstubAllGlobals();
  });

  describe('1. Planora CSS Tokens, Zero Legacy Orange & Zero ATI Text', () => {
    it('ScheduleMoment uses Planora CSS variables, no #FF5701, no raw ATI, and font-serif heading', () => {
      const message: ChatMessage = {
        id: 'msg-moment-1',
        role: 'assistant',
        content: '',
        metadata: {
          type: 'schedule_proposal',
          proposal: {
            kind: 'schedule',
            action: 'create',
            name: sampleSchedule.name,
            request: sampleSchedule.request,
            recurrence: sampleSchedule.recurrence,
            summary: 'Tạo lịch bản tin sáng',
          },
          services: ['mycalendar', 'slack'],
          nextRuns: sampleSchedule.nextRuns,
          digestCandidate: {
            eligible: true,
            config: sampleDigestConfig,
          },
        },
      };

      const { container } = render(
        <ScheduleMoment message={message} convId={CONV_ID} navigate={vi.fn()} onEdit={vi.fn()} />
      );

      // Verify zero legacy orange and prototype tokens in rendered HTML
      expect(container.innerHTML).not.toContain('#FF5701');
      expect(container.innerHTML).not.toContain('#E04C00');
      expect(container.innerHTML).not.toContain('#111827');
      expect(container.innerHTML).not.toContain('#E7E7E2');

      // Verify Planora tokens are used
      expect(container.innerHTML).toContain('var(--planora-paper)');
      expect(container.innerHTML).toContain('var(--planora-divider)');
      expect(container.innerHTML).toContain('var(--planora-primary)');
      expect(container.innerHTML).toContain('var(--planora-text)');

      // Verify WorkflowFlowCanvas renders PlanoraWorkflowSteps with no prototype colors
      expect(screen.getByTestId('workflow-flow-canvas')).toBeInTheDocument();
      expect(screen.getByTestId('workflow-node-mycalendar')).toBeInTheDocument();
      expect(screen.getByTestId('workflow-node-slack')).toBeInTheDocument();
      expect(container.innerHTML).not.toContain('#F8F8F6');

      // Verify all SVGs have aria-hidden="true"
      const svgs = container.querySelectorAll('svg');
      expect(svgs.length).toBeGreaterThan(0);
      svgs.forEach((svg) => {
        expect(svg).toHaveAttribute('aria-hidden', 'true');
      });

      // Verify heading has font-serif
      const heading = screen.getByRole('heading', { level: 1 });
      expect(heading.className).toContain('font-serif');
      expect(heading.className).toContain('var(--planora-text)');

      // Verify zero "ATI" brand in user-visible text (uses Planora instead)
      expect(screen.queryByText(/ATI · Lịch chạy workflow/i)).toBeNull();
      expect(screen.getByText(/Planora · Lịch chạy workflow/i)).toBeInTheDocument();
      expect(screen.getByText(/Tới giờ, Planora lập kế hoạch mới và chờ bạn duyệt/i)).toBeInTheDocument();
    });

    it('ScheduleMoment with GitHub candidate uses Planora tokens, radio accent, zero #FF5701 and zero #111827', () => {
      const message: ChatMessage = {
        id: 'msg-gh-1',
        role: 'assistant',
        content: '',
        metadata: {
          type: 'schedule_proposal',
          proposal: {
            kind: 'schedule',
            action: 'create',
            name: 'Bản tin GitHub',
            request: 'Mỗi sáng 8h gửi bản tin GitHub vào Slack',
            recurrence: { type: 'daily', time: '08:00' },
            summary: 'Lịch GitHub',
          },
          services: ['github', 'slack'],
          nextRuns: ['2026-11-08T01:00:00Z'],
          digestCandidate: {
            canAutoDigest: true,
            config: {
              credentialId: 'c1',
              githubUserId: 'gh1',
              login: 'octocat',
              repos: ['planora/core'],
              channelId: 'C1',
              channelName: 'team',
              staleDays: 3,
            },
          },
        },
      };

      const { container } = render(
        <ScheduleMoment message={message} convId={CONV_ID} navigate={vi.fn()} onEdit={vi.fn()} />
      );

      // Verify GitHub options do not use #FF5701 or #111827
      const manualRadio = document.getElementById('schedule-mode-manual') as HTMLInputElement;
      const autoRadio = document.getElementById('schedule-mode-auto-digest') as HTMLInputElement;
      expect(manualRadio.className).toContain('accent-[var(--planora-primary)]');
      expect(autoRadio.className).toContain('accent-[var(--planora-primary)]');
      expect(manualRadio.className).not.toContain('#FF5701');
      expect(autoRadio.className).not.toContain('#FF5701');

      // Zero legacy orange in container
      expect(container.innerHTML).not.toContain('#FF5701');
      expect(container.innerHTML).not.toContain('#E04C00');
    });

    it('ScheduleMoment with Telegram candidate uses Planora tokens, zero #FF5701, and zero raw ATI', () => {
      const message: ChatMessage = {
        id: 'msg-tg-1',
        role: 'assistant',
        content: '',
        metadata: {
          type: 'schedule_proposal',
          proposal: {
            kind: 'schedule',
            action: 'create',
            name: 'Bản tin Telegram',
            request: 'Mỗi sáng gửi bản tin qua Telegram',
            recurrence: { type: 'daily', time: '08:00' },
            summary: 'Lịch Telegram',
          },
          services: ['calendar', 'telegram'],
          nextRuns: ['2026-11-08T01:00:00Z'],
          digestCandidate: {
            canAutoDigest: true,
            config: {
              credentialId: 'cred-tg-1',
              telegramUserId: '12345',
              username: 'planora_user',
              chatId: '12345',
              chatTitle: 'Kênh thông báo',
              sources: [{ service: 'calendar', tool: 'calendar.list_events', label: 'Lịch' }],
              recurrence: { type: 'daily', time: '08:00' },
              timeZone: 'Asia/Ho_Chi_Minh',
            },
          },
        },
      };

      const { container } = render(
        <ScheduleMoment message={message} convId={CONV_ID} navigate={vi.fn()} onEdit={vi.fn()} />
      );

      expect(container.innerHTML).not.toContain('#FF5701');
      expect(container.innerHTML).not.toContain('#E04C00');
      expect(container.innerHTML).not.toContain('ATI');
      expect(screen.getByText(/Gửi về Telegram:/)).toBeInTheDocument();
      expect(screen.getByText(/Kênh thông báo/)).toBeInTheDocument();
    });

    it('ScheduleActions uses Planora primary and secondary button tokens, and CancelDialog uses font-serif and Planora card tokens', () => {
      render(
        <ScheduleActions schedule={sampleSchedule} navigate={vi.fn()} onChanged={vi.fn()} onConflict={vi.fn()} />
      );

      // Verify action buttons use Planora tokens
      const buttons = screen.getAllByRole('button');
      buttons.forEach(btn => {
        expect(btn.className).not.toContain('#FF5701');
        expect(btn.className).not.toContain('#111827');
        expect(btn.className).toContain('var(--planora-paper)');
        expect(btn.className).toContain('var(--planora-divider)');
      });

      // Open cancel dialog
      const cancelBtn = screen.getByRole('button', { name: 'Hủy lịch' });
      fireEvent.click(cancelBtn);

      const dialog = screen.getByRole('alertdialog');
      expect(dialog).toBeInTheDocument();
      expect(dialog.className).toContain('var(--planora-paper)');
      expect(dialog.className).toContain('var(--planora-divider)');

      const dialogTitle = screen.getByRole('heading', { level: 2 });
      expect(dialogTitle.className).toContain('font-serif');

      const confirmCancelBtn = screen.getByRole('button', { name: 'Xác nhận hủy lịch' });
      expect(confirmCancelBtn.className).toContain('var(--planora-primary)');
      expect(confirmCancelBtn.className).toContain('var(--planora-on-primary)');
      expect(confirmCancelBtn.className).not.toContain('#FF5701');
    });

    it('ScheduleSection and ScheduleEmptyState contain zero legacy orange and zero ATI in copy', async () => {
      vi.spyOn(apiClient, 'getSchedules').mockResolvedValue({ schedules: [] });

      render(
        <SchedulesCapabilityContext.Provider value={true}>
          <ScheduleSection user={user} navigate={vi.fn()} />
        </SchedulesCapabilityContext.Provider>
      );

      const sectionHeading = await screen.findByRole('heading', { level: 2, name: 'Lịch chạy' });
      expect(sectionHeading.className).toContain('font-serif');
      expect(sectionHeading.className).toContain('var(--planora-text)');

      // Empty state checks
      const emptyHeading = screen.getByRole('heading', { level: 3, name: 'Chưa có lịch chạy nào' });
      expect(emptyHeading.className).toContain('font-serif');
      expect(emptyHeading.className).toContain('var(--planora-text)');

      // Check text mentions Planora instead of ATI
      expect(screen.getByText(/Khi Planora đưa ra đề xuất lịch chạy/i)).toBeInTheDocument();
      expect(screen.queryByText(/Khi ATI đưa ra đề xuất/i)).toBeNull();

      // CTA button uses Planora primary
      const cta = screen.getByRole('link', { name: 'Mở Không gian làm việc' });
      expect(cta.className).toContain('var(--planora-primary)');
      expect(cta.className).toContain('var(--planora-on-primary)');
      expect(cta.className).not.toContain('#111827');
      expect(cta.className).not.toContain('#FF5701');
    });

    it('ScheduleSection with active schedule renders real PlanoraWorkflowSteps with zero prototype colors and 100% aria-hidden SVGs', async () => {
      vi.spyOn(apiClient, 'getSchedules').mockResolvedValue({ schedules: [sampleSchedule] });

      const { container } = render(
        <SchedulesCapabilityContext.Provider value={true}>
          <ScheduleSection user={user} navigate={vi.fn()} />
        </SchedulesCapabilityContext.Provider>
      );

      await screen.findByRole('heading', { level: 2, name: 'Lịch chạy' });
      expect(screen.getByText('Bản tin sáng')).toBeInTheDocument();

      // Verify PlanoraWorkflowSteps rendered for sampleSchedule (services: ['mycalendar', 'slack'])
      expect(screen.getByTestId('workflow-flow-canvas')).toBeInTheDocument();
      expect(screen.getByTestId('workflow-node-mycalendar')).toBeInTheDocument();
      expect(screen.getByTestId('workflow-node-slack')).toBeInTheDocument();

      // Zero legacy prototype colors
      expect(container.innerHTML).not.toContain('#FF5701');
      expect(container.innerHTML).not.toContain('#E04C00');
      expect(container.innerHTML).not.toContain('#111827');
      expect(container.innerHTML).not.toContain('#E7E7E2');
      expect(container.innerHTML).not.toContain('#F8F8F6');

      // 100% of SVGs have aria-hidden="true"
      const svgs = container.querySelectorAll('svg');
      expect(svgs.length).toBeGreaterThan(0);
      svgs.forEach((svg) => {
        expect(svg).toHaveAttribute('aria-hidden', 'true');
      });
    });
  });

  describe('2. A11y & 100% SVG aria-hidden="true" Audit', () => {
    it('100% of SVGs in ScheduleSection, ScheduleEmptyState, and ScheduleRunRecovery have aria-hidden="true"', async () => {
      // 1. ScheduleSection empty state SVG
      vi.spyOn(apiClient, 'getSchedules').mockResolvedValue({ schedules: [] });
      const { container: sectionContainer, unmount: unmountSection } = render(
        <SchedulesCapabilityContext.Provider value={true}>
          <ScheduleSection user={user} navigate={vi.fn()} />
        </SchedulesCapabilityContext.Provider>
      );
      await screen.findByRole('heading', { level: 2, name: 'Lịch chạy' });
      const sectionSvgs = sectionContainer.querySelectorAll('svg');
      expect(sectionSvgs.length).toBeGreaterThan(0);
      sectionSvgs.forEach(svg => {
        expect(svg).toHaveAttribute('aria-hidden', 'true');
      });
      unmountSection();

      // 2. ScheduleRunRecovery in digest_sent, needs_attention, digest_failed, discarded states
      const testRecoveryState = async (state: ScheduleRunView['state'], extraRunProps: Partial<ScheduleRunView> = {}) => {
        const runId = `run-${state}`;
        const mockRun: ScheduleRunView = {
          id: runId,
          scheduleId: sampleSchedule.id,
          convId: CONV_ID,
          dueAt: '2026-11-08T01:00:00Z',
          trigger: 'scheduled',
          state,
          missedCount: 0,
          planId: null,
          planStatus: null,
          error: state === 'needs_attention' ? 'Chưa xác định bản tin lịch đã gửi hay chưa.' : null,
          createdAt: '2026-11-08T01:00:05Z',
          ...extraRunProps,
        };
        vi.spyOn(apiClient, 'getScheduleRuns').mockResolvedValue({ runs: [mockRun] });

        const { container, unmount } = render(
          <ScheduleRunRecovery
            message={{
              id: `msg-${runId}`,
              role: 'user',
              content: 'Bản tin sáng',
              metadata: { type: 'schedule_run', scheduleId: sampleSchedule.id, runId },
            }}
            navigate={vi.fn()}
          />
        );

        await waitFor(() => {
          const svgs = container.querySelectorAll('svg');
          expect(svgs.length).toBeGreaterThan(0);
          svgs.forEach(svg => {
            expect(svg).toHaveAttribute('aria-hidden', 'true');
          });
        });
        unmount();
      };

      await testRecoveryState('digest_sent');
      await testRecoveryState('needs_attention');
      await testRecoveryState('digest_failed');
      await testRecoveryState('discarded');
    });
  });

  describe('3. Business-First UX: Approval Modes & Natural Descriptions', () => {
    it('presents clear natural language schedule recurrence and next runs', () => {
      const message: ChatMessage = {
        id: 'msg-prop-natural',
        role: 'assistant',
        content: '',
        metadata: {
          type: 'schedule_proposal',
          proposal: {
            kind: 'schedule',
            action: 'create',
            name: 'Báo cáo hàng tuần',
            request: 'Thứ Hai hàng tuần lúc 09:00 tổng hợp tiến độ gửi Slack #general',
            recurrence: { type: 'weekly', days: [1], time: '09:00' },
            summary: 'Tạo lịch báo cáo thứ Hai',
          },
          services: ['calendar', 'slack'],
          nextRuns: ['2026-11-09T02:00:00Z'],
        },
      };

      render(<ScheduleMoment message={message} convId={CONV_ID} navigate={vi.fn()} onEdit={vi.fn()} />);

      // Natural language recurrence description
      expect(screen.getByText('Thứ Hai, 09:00, giờ Việt Nam')).toBeInTheDocument();
      // Request explanation
      expect(screen.getByText('Thứ Hai hàng tuần lúc 09:00 tổng hợp tiến độ gửi Slack #general')).toBeInTheDocument();
      // Next run
      expect(screen.getByText('Lần chạy tới:')).toBeInTheDocument();
    });

    it('enforces eligibility contract: only allows auto_digest when eligible and hides/disables it with reason otherwise', () => {
      const ineligibleMessage: ChatMessage = {
        id: 'msg-ineligible',
        role: 'assistant',
        content: '',
        metadata: {
          type: 'schedule_proposal',
          proposal: {
            kind: 'schedule',
            action: 'create',
            name: 'Tạo ticket Jira tự động',
            request: 'Mỗi 8h tạo ticket Jira từ issue',
            recurrence: { type: 'daily', time: '08:00' },
            summary: 'Lịch thao tác ghi',
          },
          services: ['jira'],
          nextRuns: ['2026-11-08T01:00:00Z'],
          digestCandidate: {
            eligible: false,
            reason: 'Yêu cầu có thao tác ghi dữ liệu nên cần duyệt từng lượt chạy.',
          },
        },
      };

      render(<ScheduleMoment message={ineligibleMessage} convId={CONV_ID} navigate={vi.fn()} onEdit={vi.fn()} />);

      // Auto digest radio is not available
      expect(document.querySelector('#schedule-mode-auto-digest')).toBeNull();
      // Clear explanation is displayed
      expect(screen.getByText('Yêu cầu có thao tác ghi dữ liệu nên cần duyệt từng lượt chạy.')).toBeInTheDocument();
    });

    it('F2: Calendar candidate toggles dynamic description according to approvalMode', () => {
      const message: ChatMessage = {
        id: 'msg-cal-mode',
        role: 'assistant',
        content: '',
        metadata: {
          type: 'schedule_proposal',
          proposal: {
            kind: 'schedule',
            action: 'create',
            name: sampleSchedule.name,
            request: sampleSchedule.request,
            recurrence: sampleSchedule.recurrence,
            summary: 'Tạo lịch bản tin sáng',
          },
          services: ['mycalendar', 'slack'],
          nextRuns: sampleSchedule.nextRuns,
          digestCandidate: {
            eligible: true,
            config: sampleDigestConfig,
          },
        },
      };

      render(<ScheduleMoment message={message} convId={CONV_ID} navigate={vi.fn()} onEdit={vi.fn()} />);

      // Initially manual mode
      expect(
        screen.getByText('Tới giờ, Planora lập kế hoạch mới và chờ bạn duyệt. Chưa có gì được ghi lên công cụ nào.')
      ).toBeInTheDocument();

      // Switch to auto_digest
      const autoRadio = screen.getByLabelText(/Tự gửi bản tin Lịch theo phạm vi đã khóa/i);
      fireEvent.click(autoRadio);
      expect(
        screen.getByText('Tới giờ, Planora tự động gửi bản tin theo kế hoạch đã duyệt.')
      ).toBeInTheDocument();
      expect(
        screen.queryByText('Tới giờ, Planora lập kế hoạch mới và chờ bạn duyệt. Chưa có gì được ghi lên công cụ nào.')
      ).toBeNull();

      // Switch back to manual
      const manualRadio = screen.getByLabelText(/Lập kế hoạch & chờ duyệt từng lượt/i);
      fireEvent.click(manualRadio);
      expect(
        screen.getByText('Tới giờ, Planora lập kế hoạch mới và chờ bạn duyệt. Chưa có gì được ghi lên công cụ nào.')
      ).toBeInTheDocument();
      expect(
        screen.queryByText('Tới giờ, Planora tự động gửi bản tin theo kế hoạch đã duyệt.')
      ).toBeNull();
    });

    it('F2: Sheets/Generic candidate provides ids schedule-mode-manual and schedule-mode-auto-digest', () => {
      const message: ChatMessage = {
        id: 'msg-sheets-candidate',
        role: 'assistant',
        content: '',
        metadata: {
          type: 'schedule_proposal',
          proposal: {
            kind: 'schedule',
            action: 'create',
            name: 'Báo cáo doanh thu',
            request: 'Mỗi tuần đọc Google Sheets gửi Slack',
            recurrence: { type: 'weekly', days: [1], time: '09:00' },
            summary: 'Lịch Sheets',
          },
          services: ['sheets', 'slack'],
          nextRuns: ['2026-11-09T02:00:00Z'],
          digestCandidate: {
            canAutoDigest: true,
            config: {
              version: 1,
              source: {
                service: 'mysheets',
                spreadsheetId: 'sheet-123',
                spreadsheetTitle: 'Doanh thu Q4',
                sheetName: 'TongHop',
                tailRows: 10,
              },
              destination: {
                service: 'slack',
                channelId: 'C_SALES',
                channelLabel: '#sales-report',
              },
              includeAiSummary: true,
            },
          },
        },
      };

      render(<ScheduleMoment message={message} convId={CONV_ID} navigate={vi.fn()} onEdit={vi.fn()} />);

      const manualRadio = document.getElementById('schedule-mode-manual') as HTMLInputElement;
      const autoRadio = document.getElementById('schedule-mode-auto-digest') as HTMLInputElement;

      expect(manualRadio).toBeInTheDocument();
      expect(autoRadio).toBeInTheDocument();
      expect(manualRadio.checked).toBe(true);
      expect(autoRadio.checked).toBe(false);

      fireEvent.click(autoRadio);
      expect(autoRadio.checked).toBe(true);
      expect(manualRadio.checked).toBe(false);

      fireEvent.click(manualRadio);
      expect(manualRadio.checked).toBe(true);
      expect(autoRadio.checked).toBe(false);
    });
  });

  describe('4. Lifecycle & Delivery Unknown Guard', () => {
    it('prevents replan/auto-resend when state is needs_attention (delivery_unknown)', async () => {
      const unknownRun: ScheduleRunView = {
        id: 'run-delivery-unknown',
        scheduleId: sampleSchedule.id,
        convId: CONV_ID,
        dueAt: '2026-11-08T01:00:00Z',
        trigger: 'scheduled',
        state: 'needs_attention',
        missedCount: 0,
        planId: null,
        planStatus: null,
        error: 'Chưa xác định bản tin lịch đã gửi hay chưa. Hãy kiểm tra kênh nhận trước khi gửi thêm; lượt này không tự gửi lại.',
        createdAt: '2026-11-08T01:00:05Z',
      };

      vi.spyOn(apiClient, 'getScheduleRuns').mockResolvedValue({ runs: [unknownRun] });

      render(
        <ScheduleRunRecovery
          message={{
            id: 'msg-run-unknown',
            role: 'user',
            content: 'Bản tin sáng',
            metadata: { type: 'schedule_run', scheduleId: sampleSchedule.id, runId: unknownRun.id },
          }}
          navigate={vi.fn()}
        />
      );

      // Status text and safety warning are displayed
      expect(await screen.findByText(/Chưa xác định bản tin lịch đã gửi hay chưa/)).toBeInTheDocument();
      expect(
        screen.getByText(
          /Tình trạng gửi bản tin chưa được xác nhận\. Vui lòng kiểm tra kênh hoặc nhóm đích trước khi thao tác tiếp; hệ thống không tự động gửi lại hoặc lập lại kế hoạch cho lượt này\./
        )
      ).toBeInTheDocument();

      // ABSOLUTE GUARD: No replan or resend button should exist
      expect(screen.queryByRole('button', { name: /lập lại kế hoạch|gửi lại/i })).toBeNull();
    });

    it('displays pause reason and details clearly when schedule is paused', async () => {
      const pausedSchedule: ScheduleView = {
        ...sampleSchedule,
        status: 'paused',
        pauseReason: 'Mất quyền kết nối Slack; cần kết nối lại tài khoản.',
      };

      vi.spyOn(apiClient, 'getSchedules').mockResolvedValue({ schedules: [pausedSchedule] });

      render(
        <SchedulesCapabilityContext.Provider value={true}>
          <ScheduleSection user={user} navigate={vi.fn()} />
        </SchedulesCapabilityContext.Provider>
      );

      expect(await screen.findByText('Lịch đang tạm dừng:')).toBeInTheDocument();
      expect(screen.getByText('Mất quyền kết nối Slack; cần kết nối lại tài khoản.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Chạy tiếp' })).toBeInTheDocument();
    });
  });

  describe('5. Mutation Testing & Strict Contract Verification', () => {
    it('M1: Button tokens strictly reject prototype orange (#FF5701) and dark class overrides (#111827)', () => {
      expect(primaryScheduleButton).not.toContain('#FF5701');
      expect(primaryScheduleButton).not.toContain('#E04C00');
      expect(primaryScheduleButton).toContain('var(--planora-primary)');
      expect(primaryScheduleButton).toContain('var(--planora-on-primary)');

      expect(scheduleButton).not.toContain('#111827');
      expect(scheduleButton).not.toContain('#E7E7E2');
      expect(scheduleButton).toContain('var(--planora-paper)');
      expect(scheduleButton).toContain('var(--planora-divider)');
    });

    it('M2: All SVG icons in ScheduleSection empty state and ScheduleRunRecovery fail if aria-hidden is removed', async () => {
      vi.spyOn(apiClient, 'getSchedules').mockResolvedValue({ schedules: [] });
      const { container: emptyContainer, unmount: unmountEmpty } = render(
        <SchedulesCapabilityContext.Provider value={true}>
          <ScheduleSection user={user} navigate={vi.fn()} />
        </SchedulesCapabilityContext.Provider>
      );
      await screen.findByRole('heading', { level: 2, name: 'Lịch chạy' });
      const emptySvgs = emptyContainer.querySelectorAll('svg');
      expect(emptySvgs.length).toBeGreaterThan(0);
      emptySvgs.forEach(svg => {
        expect(svg.getAttribute('aria-hidden')).toBe('true');
      });
      unmountEmpty();

      const runSent: ScheduleRunView = {
        id: 'r-sent-m2',
        scheduleId: sampleSchedule.id,
        convId: CONV_ID,
        dueAt: '2026-11-08T01:00:00Z',
        trigger: 'scheduled',
        state: 'digest_sent',
        missedCount: 0,
        planId: null,
        planStatus: null,
        error: null,
        createdAt: '2026-11-08T01:00:05Z',
      };
      vi.spyOn(apiClient, 'getScheduleRuns').mockResolvedValue({ runs: [runSent] });

      const { container: recoveryContainer } = render(
        <ScheduleRunRecovery
          message={{
            id: 'msg-run-sent',
            role: 'user',
            content: 'Bản tin',
            metadata: { type: 'schedule_run', scheduleId: sampleSchedule.id, runId: runSent.id },
          }}
          navigate={vi.fn()}
        />
      );
      await waitFor(() => {
        const recSvgs = recoveryContainer.querySelectorAll('svg');
        expect(recSvgs.length).toBeGreaterThan(0);
        recSvgs.forEach(svg => {
          expect(svg.getAttribute('aria-hidden')).toBe('true');
        });
      });
    });

    it('M3: Invariant guard: needs_attention state never exposes replan or run-again button', async () => {
      const run: ScheduleRunView = {
        id: 'r-needs-attention',
        scheduleId: sampleSchedule.id,
        convId: CONV_ID,
        dueAt: '2026-11-08T01:00:00Z',
        trigger: 'scheduled',
        state: 'needs_attention',
        missedCount: 0,
        planId: null,
        planStatus: null,
        error: 'Chưa xác định bản tin lịch đã gửi hay chưa.',
        createdAt: '2026-11-08T01:00:05Z',
      };
      vi.spyOn(apiClient, 'getScheduleRuns').mockResolvedValue({ runs: [run] });

      render(
        <ScheduleRunRecovery
          message={{
            id: 'msg-rec',
            role: 'user',
            content: 'Bản tin',
            metadata: { type: 'schedule_run', scheduleId: sampleSchedule.id, runId: run.id },
          }}
          navigate={vi.fn()}
        />
      );

      await screen.findByText(/Chưa xác định/);
      expect(screen.queryByRole('button')).toBeNull();
    });
  });
});
