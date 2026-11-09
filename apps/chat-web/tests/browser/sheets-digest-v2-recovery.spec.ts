import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createServer, type ViteDevServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const webRoot = resolve(__dirname, '../..');

let viteServer: ViteDevServer | null = null;
let baseUrl = `http://127.0.0.1:${process.env.V3_WEB_PORT || 5174}`;

test.beforeAll(async () => {
  try {
    const probe = await fetch(baseUrl);
    if (probe.ok) return;
  } catch {
    // Server not running on default port; start an embedded Vite server for deterministic test execution
  }
  viteServer = await createServer({
    root: webRoot,
    configFile: resolve(webRoot, 'vite.config.ts'),
    server: {
      host: '127.0.0.1',
      port: 0,
    },
  });
  await viteServer.listen();
  const address = viteServer.httpServer?.address();
  if (address && typeof address === 'object') {
    baseUrl = `http://127.0.0.1:${address.port}`;
  }
});

test.afterAll(async () => {
  if (viteServer) {
    await viteServer.close();
    viteServer = null;
  }
});

test.describe('Sheets Digest V2 Preview, Reauthorization CTA & Manual Delivery Recovery E2E', () => {
  test('Full browser journey: paused v1 schedule -> reauthorize preview (no credential UUID leak, cross-boundary warning) -> confirm -> needs_attention manual recovery (duplicate-risk checkbox, retry_new_run & mark_sent) -> audit badge', async ({
    page,
  }) => {
    const SOURCE_CRED_UUID = '00000000-1111-4222-8333-444444444444';
    const DEST_CRED_UUID = '99999999-aaaa-4bbb-8ccc-dddddddddddd';

    const jwtPayload = Buffer.from(
      JSON.stringify({ type: 'access', sub: 'user-e2e-1', sid: 'session-e2e-1' })
    ).toString('base64');
    const accessToken = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${jwtPayload}.sig`;

    await page.addInitScript(
      ({ token }) => {
        window.localStorage.setItem('wap_access_token', token);
        window.localStorage.setItem('wap_refresh_token', 'fake-refresh-token-e2e');
        window.localStorage.setItem(
          'wap_user',
          JSON.stringify({
            id: 'user-e2e-1',
            email: 'an@example.test',
            name: 'An Nguyễn',
            role: 'member',
            status: 'active',
          })
        );
      },
      { token: accessToken }
    );

    const scheduleConvId = '11111111-2222-4333-8444-555555555555';
    const runConvId1 = '22222222-3333-4444-8555-666666666666';
    const runConvId2 = '33333333-4444-4555-8666-777777777777';

    const v2Candidate = {
      canAutoDigest: true,
      configHash: 'hash-v2-e2e-sealed',
      config: {
        version: 2,
        workspaceMode: 'organization',
        workspaceId: 'ws-org-acme',
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

    const reauthProposalMessage = {
      id: 'msg-reauth-e2e-1',
      role: 'assistant',
      content: 'Cấp quyền lại lịch "Báo cáo Doanh thu Q4 mỗi sáng" (Google Sheets v2).',
      created_at: '2026-11-09T01:00:00.000Z',
      metadata: {
        type: 'schedule_proposal',
        scheduleId: 'sched-sheets-e2e-1',
        baseVersion: 3,
        reauthorize: true,
        expiresAt: '2026-11-09T01:15:00.000Z',
        services: ['mysheets', 'gmail'],
        nextRuns: ['2026-11-10T01:00:00.000Z'],
        previous: {
          name: 'Báo cáo Doanh thu Q4 mỗi sáng',
          request: 'Đọc bảng Báo cáo Doanh thu Q4 tab Tổng hợp và gửi qua Gmail cho cfo@company.example.com',
          recurrence: { type: 'daily', time: '08:00' },
          status: 'paused',
        },
        digestCandidate: v2Candidate,
        proposal: {
          kind: 'schedule',
          action: 'update',
          name: 'Báo cáo Doanh thu Q4 mỗi sáng',
          request: 'Đọc bảng Báo cáo Doanh thu Q4 tab Tổng hợp và gửi qua Gmail cho cfo@company.example.com',
          recurrence: { type: 'daily', time: '08:00' },
          summary: 'Cấp quyền lại lịch "Báo cáo Doanh thu Q4 mỗi sáng" (Google Sheets v2).',
        },
      },
    };

    let currentSchedule: any = {
      id: 'sched-sheets-e2e-1',
      convId: scheduleConvId,
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

    let uncertainRun1: any = {
      id: 'run-uncertain-e2e-1',
      scheduleId: 'sched-sheets-e2e-1',
      trigger: 'scheduled',
      dueAt: '2026-11-09T01:00:00.000Z',
      createdAt: '2026-11-09T01:00:02.000Z',
      state: 'needs_attention',
      missedCount: 0,
      convId: runConvId1,
      planId: null,
      planStatus: null,
      error:
        'SHEETS_DELIVERY_UNKNOWN: Đã bắt đầu gửi báo cáo sang Gmail nhưng mất kết nối trước khi nhận phản hồi. Không tự động gửi lại để tránh gửi trùng.',
      deliveryStartedAt: '2026-11-09T01:00:05.000Z',
      deliveryResolution: null,
      deliveryResolvedAt: null,
      deliveryFollowupRunId: null,
    };

    let uncertainRun2: any = {
      id: 'run-uncertain-e2e-2',
      scheduleId: 'sched-sheets-e2e-1',
      trigger: 'scheduled',
      dueAt: '2026-11-09T02:00:00.000Z',
      createdAt: '2026-11-09T02:00:02.000Z',
      state: 'needs_attention',
      missedCount: 0,
      convId: runConvId2,
      planId: null,
      planStatus: null,
      error:
        'SHEETS_DELIVERY_UNKNOWN: Tín hiệu gửi tới kênh đích bị gián đoạn sau khi bắt đầu gửi. Vui lòng kiểm tra hộp thư trước khi xử lý.',
      deliveryStartedAt: '2026-11-09T02:00:05.000Z',
      deliveryResolution: null,
      deliveryResolvedAt: null,
      deliveryFollowupRunId: null,
    };

    let confirmAttempt = 0;

    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname;
      const method = route.request().method();

      if (path === '/api/health') {
        return route.fulfill({
          status: 200,
          json: {
            runtimeMode: 'sandbox',
            schedulesEnabled: true,
            mysheetsEnabled: true,
            gmailEnabled: true,
          },
        });
      }

      if (path === '/api/auth/me') {
        return route.fulfill({
          status: 200,
          json: {
            user: {
              id: 'user-e2e-1',
              email: 'an@example.test',
              name: 'An Nguyễn',
              role: 'member',
              status: 'active',
            },
          },
        });
      }

      if (path === '/api/workspaces') {
        return route.fulfill({
          status: 200,
          json: {
            personal: { id: 'personal', name: 'Cá nhân', role: 'admin', status: 'active' },
            organizations: [
              { id: 'ws-org-acme', name: 'Acme Corp', role: 'member', status: 'active' },
            ],
          },
        });
      }

      if (path === '/api/services') {
        return route.fulfill({
          status: 200,
          json: { services: [], canConfigure: false, personalOAuth: ['mysheets', 'gmail'] },
        });
      }

      if (path === '/api/schedules/pending-count') {
        return route.fulfill({ status: 200, json: { count: 0 } });
      }

      if (path === '/api/schedules' && method === 'GET') {
        return route.fulfill({ status: 200, json: { schedules: [currentSchedule] } });
      }

      if (path === '/api/schedules/sched-sheets-e2e-1/reauthorize-preview' && method === 'POST') {
        return route.fulfill({
          status: 200,
          json: {
            proposalMessageId: reauthProposalMessage.id,
            convId: scheduleConvId,
            scheduleId: currentSchedule.id,
            baseVersion: currentSchedule.version,
            expiresAt: '2026-11-09T01:15:00.000Z',
            candidate: v2Candidate,
            metadata: reauthProposalMessage.metadata,
          },
        });
      }

      if (
        path === `/api/conversations/${scheduleConvId}/schedule-proposals/${reauthProposalMessage.id}/confirm` &&
        method === 'POST'
      ) {
        confirmAttempt += 1;
        if (confirmAttempt === 1) {
          return route.fulfill({
            status: 409,
            json: {
              error: {
                code: 'DIGEST_PREVIEW_CHANGED',
                message: 'Kết nối Google Sheets vừa được cập nhật, vui lòng kiểm tra lại và xác nhận.',
              },
            },
          });
        }
        currentSchedule = {
          ...currentSchedule,
          status: 'active',
          pauseReason: null,
          version: 4,
          nextRuns: ['2026-11-10T01:00:00.000Z'],
          lastRun: uncertainRun1,
        };
        return route.fulfill({ status: 200, json: { schedule: currentSchedule } });
      }

      if (path === `/api/conversations/${scheduleConvId}` && method === 'GET') {
        return route.fulfill({
          status: 200,
          json: {
            conversation: { id: scheduleConvId, title: 'Báo cáo Doanh thu Q4 mỗi sáng' },
            messages: [
              {
                id: 'msg-user-init',
                role: 'user',
                content: currentSchedule.request,
                created_at: '2026-11-08T01:00:00.000Z',
              },
              reauthProposalMessage,
            ],
          },
        });
      }

      if (path === `/api/conversations/${runConvId2}` && method === 'GET') {
        return route.fulfill({
          status: 200,
          json: {
            conversation: { id: runConvId2, title: 'Lượt chạy Báo cáo Doanh thu Q4' },
            messages: [
              {
                id: 'msg-run-e2e-2',
                role: 'user',
                content: currentSchedule.request,
                created_at: '2026-11-09T02:00:02.000Z',
                metadata: {
                  type: 'schedule_run',
                  scheduleId: currentSchedule.id,
                  runId: uncertainRun2.id,
                  name: currentSchedule.name,
                  dueAt: uncertainRun2.dueAt,
                  trigger: 'scheduled',
                },
              },
            ],
          },
        });
      }

      if (path === '/api/schedules/sched-sheets-e2e-1/runs' && method === 'GET') {
        return route.fulfill({
          status: 200,
          json: { runs: [uncertainRun2, uncertainRun1] },
        });
      }

      if (path === '/api/schedule-runs/run-uncertain-e2e-1/resolve-delivery' && method === 'POST') {
        const body = route.request().postDataJSON();
        const followUpRun = {
          id: 'run-followup-e2e-2',
          scheduleId: currentSchedule.id,
          trigger: 'manual',
          dueAt: '2026-11-09T01:20:00.000Z',
          createdAt: '2026-11-09T01:20:00.000Z',
          state: 'planning',
          missedCount: 0,
          convId: 'conv-followup-e2e-2',
          planId: null,
          planStatus: null,
          error: null,
        };
        uncertainRun1 = {
          ...uncertainRun1,
          deliveryResolution: body.resolution === 'retry_new_run' ? 'retried_new_run' : 'confirmed_sent',
          deliveryResolvedAt: '2026-11-09T01:20:00.000Z',
          deliveryFollowupRunId: followUpRun.id,
        };
        currentSchedule = {
          ...currentSchedule,
          lastRun: followUpRun,
        };
        return route.fulfill({
          status: 200,
          json: {
            run: uncertainRun1,
            followUpRun,
            schedule: currentSchedule,
          },
        });
      }

      if (path === '/api/schedule-runs/run-uncertain-e2e-2/resolve-delivery' && method === 'POST') {
        uncertainRun2 = {
          ...uncertainRun2,
          state: 'digest_sent',
          error: null,
          deliveryResolution: 'confirmed_sent',
          deliveryResolvedAt: '2026-11-09T02:15:00.000Z',
          delivery: {
            destination: 'gmail',
            targetId: 'cfo@company.example.com',
            targetLabel: 'cfo@company.example.com',
            spreadsheetId: 'sheet-id-revenue-q4',
            spreadsheetTitle: 'Báo cáo Doanh thu Q4',
            sheetName: 'Tổng hợp',
            rowCount: 20,
            summaryMode: 'ai',
            sentAt: '2026-11-09T02:15:00.000Z',
            manualConfirmedAt: '2026-11-09T02:15:00.000Z',
            manualResolution: {
              status: 'confirmed_sent',
              resolvedAt: '2026-11-09T02:15:00.000Z',
              manualConfirmedAt: '2026-11-09T02:15:00.000Z',
              resolvedBy: 'user-e2e-1',
            },
          },
        };
        return route.fulfill({
          status: 200,
          json: {
            run: uncertainRun2,
            followUpRun: null,
            schedule: currentSchedule,
          },
        });
      }

      if (path.endsWith('/plans/active') || path.endsWith('/executions/latest')) {
        return route.fulfill({ status: 404, json: { error: 'Not found' } });
      }

      if (path.endsWith('/stream')) {
        return route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
          body: ': connected\n\n',
        });
      }

      return route.fulfill({ status: 200, json: { conversations: [] } });
    });

    await page.setViewportSize({ width: 1440, height: 900 });

    // 1. Open /history and verify paused sheets_digest schedule + "Xem trước & Cấp quyền lại" CTA
    await page.goto(`${baseUrl}/history`);
    await expect(page.getByText('Báo cáo Doanh thu Q4 mỗi sáng')).toBeVisible();
    await expect(
      page.getByText(/REAUTH_REQUIRED: Lịch gửi báo cáo Google Sheets tự động thuộc phiên bản cũ \(v1\)/)
    ).toBeVisible();

    const reauthBtn = page.getByTestId('btn-reauthorize-schedule-preview');
    await expect(reauthBtn).toBeVisible();
    await reauthBtn.click();

    // 2. Navigated to /c/<scheduleConvId> where ScheduleMoment renders V2 Preview & Cross-Boundary Warning
    await expect(page).toHaveURL(new RegExp(`/c/${scheduleConvId}`));
    await expect(page.getByTestId('reauthorize-proposal-banner')).toBeVisible();

    const previewPanel = page.getByTestId('sheets-digest-v2-preview');
    await expect(previewPanel).toBeVisible();
    await expect(previewPanel).toContainText('Google Sheets cá nhân (MySheets)');
    await expect(previewPanel).toContainText('owner@personal.example.com');
    await expect(previewPanel).toContainText('Báo cáo Doanh thu Q4');
    await expect(previewPanel).toContainText('Gmail cá nhân (sender@company.example.com)');
    await expect(previewPanel).toContainText('Email nhận: cfo@company.example.com');

    const warningBox = page.getByTestId('sheets-digest-cross-boundary-warning');
    await expect(warningBox).toBeVisible();
    await expect(warningBox).toContainText('Cảnh báo liên không gian: Lịch chạy trong Tổ chức "Acme Corp"');

    // Verify no raw credentialId UUIDs are leaked in the page text
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain(SOURCE_CRED_UUID);
    expect(bodyText).not.toContain(DEST_CRED_UUID);

    // 3. First confirm attempt returns 409 DIGEST_PREVIEW_CHANGED -> alert shown, then second confirm succeeds
    await page.getByRole('button', { name: 'Xác nhận', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(
      'Kết nối Google Sheets vừa được cập nhật, vui lòng kiểm tra lại và xác nhận.'
    );

    await page.getByRole('button', { name: 'Xác nhận', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Đang bật' })).toBeVisible();

    // 4. Navigate back to /history where uncertainRun1 is in needs_attention (SHEETS_DELIVERY_UNKNOWN)
    await page.goto(`${baseUrl}/history`);
    await expect(page.getByRole('button', { name: 'Lập lại kế hoạch' })).toHaveCount(0);

    const recoveryPanel = page.getByTestId('sheets-delivery-recovery-panel');
    await expect(recoveryPanel).toBeVisible();

    const retryBtn = page.getByTestId('btn-resolve-retry-new-run');
    const dupCheckbox = page.getByTestId('checkbox-confirm-duplicate-risk');
    await expect(retryBtn).toBeDisabled();

    await dupCheckbox.check();
    await expect(retryBtn).toBeEnabled();
    await retryBtn.click();

    // Verify resolved badge with follow-up run ID
    const resolvedBadge1 = page.getByTestId('delivery-resolution-badge');
    await expect(resolvedBadge1).toBeVisible();
    await expect(resolvedBadge1).toContainText('Đã tạo lượt gửi bù mới');
    await expect(resolvedBadge1).toContainText('Mã lượt chạy bù: run-followup-e2e-2');

    // 5. Navigate to /c/<runConvId2> to test ScheduleRunRecovery mark_sent flow
    await page.goto(`${baseUrl}/c/${runConvId2}`);
    await expect(page.getByRole('button', { name: 'Lập lại kế hoạch' })).toHaveCount(0);
    const cockpitRecoveryPanel = page.getByTestId('sheets-delivery-recovery-panel');
    await expect(cockpitRecoveryPanel).toBeVisible();

    await page.getByTestId('btn-resolve-mark-sent').click();
    const resolvedBadge2 = page.getByTestId('delivery-resolution-badge');
    await expect(resolvedBadge2).toBeVisible();
    await expect(resolvedBadge2).toContainText('Đã xác nhận thủ công là đã gửi');
  });
});
