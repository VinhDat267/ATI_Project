import { test, expect, type Page } from '@playwright/test';
import pg from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { hashPassword } from '../../../chat-api/src/db/repositories/user-repo.js';

async function loginUser(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hôm nay bạn muốn nhờ việc gì?');
}

test('TELEGRAM-E2E-1: /guide 1-click showcase, TELEGRAM_PAIRING_PENDING auto-focus verification, #telegram-scope filter & counter, and multi-source auto_digest schedule + /history', async ({
  page,
}, testInfo) => {
  const externalRequests: string[] = [];

  await page.route(/api\.telegram\.org|t\.me/, (route) => {
    externalRequests.push(route.request().url());
    return route.abort('blockedbyclient');
  });

  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const memberId = randomUUID();
  const memberEmail = `telegram-member-${memberId}@example.test`;
  const memberPassword = 'Member@12345678';
  try {
    await db.query(
      "INSERT INTO users(id, email, password, name, status, role, email_verified) VALUES($1, $2, $3, 'Telegram Member', 'active', 'member', true)",
      [memberId, memberEmail, hashPassword(memberPassword)],
    );
  } finally {
    await db.end();
  }

  await loginUser(page, memberEmail, memberPassword);

  // 1. Verify /guide?service=telegram displays 1-click pairing CTA and OAuth showcase card
  await page.goto('/guide?service=telegram');
  await expect(page.getByText('Cách kết nối:', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /Kết nối Telegram 1-Click →/i })).toBeVisible();
  await expect(page.getByText('Telegram cá nhân & Nhóm')).toBeVisible();

  // 2. Setup mocked Telegram 1-click pairing endpoints (1st call: 409 TELEGRAM_PAIRING_PENDING, 2nd call on window focus: 200 connected/needs_scope)
  const candidateChats = [
    {
      chatId: '777001',
      title: 'Telegram của tôi (An)',
      type: 'private' as const,
      username: 'an_telegram',
      member: true,
    },
    {
      chatId: '-100999888',
      title: 'Đội Sản Phẩm',
      type: 'supergroup' as const,
      member: true,
    },
    {
      chatId: '-1001234567890',
      title: 'Nhóm Vận Hành ATI',
      type: 'supergroup' as const,
      username: 'ati_ops_group',
      member: true,
    },
  ];

  let telegramState: {
    status: 'not_connected' | 'needs_scope' | 'connected';
    botUsername: string;
    username?: string;
    chats: typeof candidateChats;
    selectedChats: typeof candidateChats;
  } = {
    status: 'not_connected',
    botUsername: 'ati_assistant_bot',
    username: undefined,
    chats: [],
    selectedChats: [],
  };

  await page.route('**/api/connections/telegram', async (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: telegramState });
    }
    return route.continue();
  });

  await page.route('**/api/connections/telegram/start', async (route) => {
    return route.fulfill({
      json: {
        state: 'fake-tg-state-123',
        botUsername: 'ati_assistant_bot',
        deepLinkUrl: 'https://t.me/ati_assistant_bot?start=ati_fake-tg-state-123',
        groupDeepLinkUrl: 'https://t.me/ati_assistant_bot?startgroup=ati_fake-tg-state-123',
      },
    });
  });

  let callbackAttempt = 0;
  await page.route('**/api/connections/telegram/callback', async (route) => {
    callbackAttempt += 1;
    if (callbackAttempt === 1) {
      return route.fulfill({
        status: 409,
        json: {
          error: 'TELEGRAM_PAIRING_PENDING',
          botUsername: 'ati_assistant_bot',
          deepLinkUrl: 'https://t.me/ati_assistant_bot?start=ati_fake-tg-state-123',
          message: 'Chưa nhận được lệnh /start từ Telegram. Hãy bấm Start trong ứng dụng Telegram.',
        },
      });
    }
    telegramState = {
      status: 'needs_scope',
      botUsername: 'ati_assistant_bot',
      username: 'an_telegram',
      chats: candidateChats,
      selectedChats: [],
    };
    return route.fulfill({
      json: {
        status: 'needs_scope',
        telegramUserId: '777001',
        username: 'an_telegram',
        displayName: 'An',
        chats: telegramState.chats,
        selectedChats: [],
      },
    });
  });

  await page.route('**/api/connections/telegram/scope', async (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON();
      const pickedIds = new Set<string>(body?.chatIds ?? []);
      telegramState = {
        ...telegramState,
        status: 'connected',
        selectedChats: candidateChats.filter((c) => pickedIds.has(c.chatId)),
      };
      return route.fulfill({
        json: {
          status: 'connected',
          selectedChats: telegramState.selectedChats,
        },
      });
    }
    return route.continue();
  });

  await page.goto('/settings#telegram');
  const telegramRow = page.locator('#service-row-telegram');
  await expect(telegramRow).toBeVisible();

  const connectBtn = page.locator('#telegram-connect');
  await expect(connectBtn).toBeVisible();
  await connectBtn.click();

  // Verify TELEGRAM_PAIRING_PENDING screen on /connections/telegram/callback
  await expect(page.getByText('@ati_assistant_bot')).toBeVisible();
  await expect(page.locator('#telegram-open-bot')).toBeVisible();
  await expect(page.locator('#telegram-verify-pairing')).toBeVisible();
  await expect(page.getByText(/hệ thống sẽ tự động nhận diện khi bạn quay lại trang này/i)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('telegram-pairing-pending.png'), fullPage: true });

  // Simulate user returning from Telegram app to browser tab -> auto-verifies pairing
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
  });

  await page.waitForURL(/.*\/settings.*#telegram/);
  await expect(telegramRow).toContainText('Chưa chọn chat');

  // 3. Verify #telegram-scope counter badge, #telegram-chat-filter search, and chat type labels
  const scopeSection = page.locator('#telegram-scope');
  await expect(scopeSection).toBeVisible();
  await expect(scopeSection.getByText('Đã chọn 0 / 10')).toBeVisible();
  await expect(scopeSection.getByText('Chat cá nhân', { exact: true })).toBeVisible();
  await expect(scopeSection.getByText('@ati_ops_group', { exact: true })).toBeVisible();
  await expect(scopeSection.getByText('Nhóm Telegram', { exact: true }).first()).toBeVisible();

  const filterInput = page.locator('#telegram-chat-filter');
  await expect(filterInput).toBeVisible();
  await filterInput.fill('Vận Hành');
  await expect(scopeSection.getByRole('checkbox', { name: /Nhóm Vận Hành ATI/i })).toBeVisible();
  await expect(scopeSection.getByRole('checkbox', { name: /Đội Sản Phẩm/i })).toHaveCount(0);

  await scopeSection.getByRole('checkbox', { name: /Nhóm Vận Hành ATI/i }).check();
  await filterInput.fill('');
  await scopeSection.getByRole('checkbox', { name: /Telegram của tôi \(An\)/i }).check();
  await expect(scopeSection.getByText('Đã chọn 2 / 10')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('telegram-scope-selector.png'), fullPage: true });

  await page.locator('#telegram-save-scope').click();
  await expect(telegramRow).toContainText('Nhóm Vận Hành ATI');
  await expect(telegramRow.getByRole('link', { name: /\+ Thêm bot vào nhóm mới/i })).toBeVisible();

  // 4. Verify ScheduleMoment #schedule-auto-digest-scope and /history ScheduleSection RunLink
  const convId = '11111111-2222-4333-8444-555555555555';
  await page.route('**/api/health', async (route) => {
    return route.fulfill({
      json: { runtimeMode: 'sandbox', schedulesEnabled: true },
    });
  });
  await page.route(`**/api/conversations/${convId}`, async (route) => {
    return route.fulfill({
      json: {
        conversation: { id: convId, title: 'Báo cáo Telegram', createdAt: new Date().toISOString() },
        messages: [
          {
            id: 'msg-user-1',
            role: 'user',
            content: 'Mỗi sáng 8h tổng hợp GitHub và Lịch họp gửi vào Nhóm Vận Hành ATI trên Telegram',
          },
          {
            id: 'msg-prop-1',
            role: 'assistant',
            content: '',
            metadata: {
              type: 'schedule_proposal',
              proposal: {
                kind: 'schedule',
                action: 'create',
                name: 'Báo cáo sáng Nhóm Vận Hành ATI',
                request: 'Mỗi sáng 8h tổng hợp GitHub và Lịch họp gửi vào Nhóm Vận Hành ATI trên Telegram',
                recurrence: { type: 'daily', time: '08:00' },
                summary: 'Tạo lịch Báo cáo sáng Nhóm Vận Hành ATI',
              },
              services: ['github', 'mycalendar', 'telegram'],
              nextRuns: ['2026-11-03T01:00:00Z'],
              digestCandidate: {
                canAutoDigest: true,
                config: {
                  credentialId: 'cred-tg-1',
                  telegramUserId: '777001',
                  username: 'an_telegram',
                  chatId: '-1001234567890',
                  chatTitle: 'Nhóm Vận Hành ATI',
                  sources: [
                    { service: 'github', tool: 'github.list_issues', label: 'GitHub Issues đang mở' },
                    { service: 'mycalendar', tool: 'mycalendar.list_events', label: 'Lịch họp hôm nay' },
                  ],
                  recurrence: { type: 'daily', time: '08:00' },
                  timeZone: 'Asia/Ho_Chi_Minh',
                },
                configHash: 'hash-123',
              },
            },
          },
        ],
      },
    });
  });
  await page.route(`**/api/conversations/${convId}/plans/active`, async (route) => {
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });
  await page.route(`**/api/conversations/${convId}/executions/latest`, async (route) => {
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });

  const sampleDigestRun = {
    id: 'run-tg-1',
    dueAt: '2026-11-02T01:00:00Z',
    status: 'digest_sent',
    convId,
    planId: null,
    error: null,
    delivery: {
      chatId: '-1001234567890',
      chatTitle: 'Nhóm Vận Hành ATI',
      sources: [
        { service: 'github', label: 'GitHub Issues đang mở' },
        { service: 'mycalendar', label: 'Lịch họp hôm nay' },
      ],
    },
  };

  const confirmedSchedule = {
    id: 'sched-tg-1',
    convId,
    version: 1,
    name: 'Báo cáo sáng Nhóm Vận Hành ATI',
    request: 'Mỗi sáng 8h tổng hợp GitHub và Lịch họp gửi vào Nhóm Vận Hành ATI trên Telegram',
    recurrence: { type: 'daily', time: '08:00' },
    services: ['github', 'mycalendar', 'telegram'],
    status: 'active',
    pauseReason: null,
    nextRuns: ['2026-11-03T01:00:00Z'],
    lastRun: sampleDigestRun,
    kind: 'telegram_digest',
    approvalMode: 'auto_digest',
    digest: {
      chatId: '-1001234567890',
      chatTitle: 'Nhóm Vận Hành ATI',
      sources: [
        { service: 'github', label: 'GitHub Issues đang mở' },
        { service: 'mycalendar', label: 'Lịch họp hôm nay' },
      ],
      approvedAt: new Date().toISOString(),
    },
  };

  let confirmedMode: string | undefined;
  await page.route(`**/api/conversations/${convId}/schedule-proposals/msg-prop-1/confirm`, async (route) => {
    const body = route.request().postDataJSON();
    confirmedMode = body?.approvalMode;
    return route.fulfill({
      json: {
        schedule: confirmedSchedule,
      },
    });
  });

  await page.goto(`/c/${convId}`);
  const autoDigestRadio = page.locator('#schedule-mode-auto-digest');
  await expect(autoDigestRadio).toBeVisible();
  await expect(autoDigestRadio).toBeEnabled();
  await autoDigestRadio.check();

  const scopeBox = page.locator('#schedule-auto-digest-scope');
  await expect(scopeBox).toBeVisible();
  await expect(scopeBox.getByText(/Nguồn dữ liệu: GitHub Issues đang mở, Lịch họp hôm nay/)).toBeVisible();
  await expect(scopeBox.getByText(/Nơi nhận: Telegram · Nhóm Vận Hành ATI/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('telegram-digest-proposal.png'), fullPage: true });

  await page.getByRole('button', { name: 'Xác nhận' }).click();
  await expect(page.getByText(/Tự gửi Telegram · Nhóm Vận Hành ATI/)).toBeVisible();
  expect(confirmedMode).toBe('auto_digest');

  // Verify /history renders "Tự gửi Telegram · Nhóm Vận Hành ATI" and "(Telegram: Nhóm Vận Hành ATI · 2 nguồn)"
  await page.route('**/api/schedules', async (route) => {
    return route.fulfill({ json: { schedules: [confirmedSchedule] } });
  });
  await page.route('**/api/schedules/sched-tg-1/runs*', async (route) => {
    return route.fulfill({
      json: {
        runs: [sampleDigestRun],
      },
    });
  });

  await page.goto('/history');
  const scheduleRegion = page.getByRole('region', { name: 'Lịch chạy' });
  await expect(scheduleRegion).toBeVisible();
  await expect(scheduleRegion.getByText('Tự gửi Telegram · Nhóm Vận Hành ATI')).toBeVisible();
  await scheduleRegion.getByRole('button', { name: 'Xem 10 lượt gần nhất' }).click();
  await expect(scheduleRegion.getByText('(Telegram: Nhóm Vận Hành ATI · 2 nguồn)').first()).toBeVisible();

  expect(externalRequests).toEqual([]);
});

test('TELEGRAM-E2E-2: 2-way Telegram workflow (telegram.read_messages + telegram.send_message) on PlanMoment, PreviewModal, and real Backend Execution to ReceiptMoment', async ({
  page,
}, testInfo) => {
  const externalRequests: string[] = [];
  await page.route(/api\.telegram\.org|t\.me/, (route) => {
    externalRequests.push(route.request().url());
    return route.abort('blockedbyclient');
  });

  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await loginUser(page, process.env.CHAT_ADMIN_EMAIL!, process.env.CHAT_ADMIN_PASSWORD!);
    const adminId = (await db.query('SELECT id FROM users WHERE email = $1', [process.env.CHAT_ADMIN_EMAIL!])).rows[0].id;

    const planConvId = (
      await db.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [adminId])
    ).rows[0].id;
    await db.query(
      "INSERT INTO messages(conv_id, role, content) VALUES($1, 'user', 'Đọc 5 tin nhắn gần nhất trong Nhóm Vận Hành ATI rồi gửi thông báo xác nhận đã tiếp nhận')",
      [planConvId],
    );

    const plan = {
      kind: 'plan',
      summary: 'Đọc tin nhắn và gửi phản hồi vào Nhóm Vận Hành ATI',
      thinking: 'Đọc 5 tin nhắn mới nhất trong Nhóm Vận Hành ATI rồi gửi phản hồi xác nhận.',
      warnings: [],
      connections: {
        telegram: {
          credentialId: 'sandbox-telegram',
          telegramUserId: '100000001',
          username: 'nguyenvana',
          chatIds: ['-1001234567890', '100000001'],
        },
      },
      resourceLabels: {
        '-1001234567890': 'Nhóm Vận Hành ATI',
      },
      steps: [
        {
          id: 'step_1',
          tool: 'telegram.read_messages',
          description: 'Đọc 5 tin nhắn mới nhất trong Nhóm Vận Hành ATI',
          chatId: '-1001234567890',
          args: {
            chatId: '-1001234567890',
            limit: 5,
          },
          dependsOn: [],
        },
        {
          id: 'step_2',
          tool: 'telegram.send_message',
          description: 'Gửi xác nhận đã tiếp nhận sự cố vào Nhóm Vận Hành ATI',
          chatId: '-1001234567890',
          args: {
            chatId: '-1001234567890',
            text: 'Đội kỹ thuật đã đọc báo cáo sự cố 502 và đang xử lý.',
          },
          dependsOn: ['step_1'],
        },
      ],
    };

    const planText = JSON.stringify(plan);
    const planId = (
      await db.query(
        `INSERT INTO plans(conv_id, plan_json, plan_text, plan_hash, resource_labels, status, expires_at)
         VALUES($1, $2::jsonb, $3, $4, $5::jsonb, 'pending', now() + interval '30 minutes') RETURNING id`,
        [
          planConvId,
          planText,
          planText,
          createHash('sha256').update(planText).digest('hex'),
          JSON.stringify(plan.resourceLabels),
        ],
      )
    ).rows[0].id;

    await db.query(
      "INSERT INTO messages(conv_id, role, content, metadata) VALUES($1, 'assistant', $2, $3)",
      [
        planConvId,
        plan.summary,
        {
          type: 'plan',
          planId,
          plan: { ...plan, id: planId, status: 'pending' },
          resourceLabels: plan.resourceLabels,
        },
      ],
    );

    await page.goto(`/c/${planConvId}`);
    const planMoment = page.locator('#moment-4');
    await expect(planMoment).toBeVisible();

    // Verify PlanMoment displays @nguyenvana, operation badges ("Đọc tin nhắn", "Gửi tin"), and friendly destination ("Nhóm Vận Hành ATI")
    await expect(planMoment).toContainText('Tài khoản: @nguyenvana (Telegram của bạn)');
    await expect(planMoment.getByText('Đọc tin nhắn', { exact: true })).toBeVisible();
    await expect(planMoment.getByText('Gửi tin', { exact: true })).toBeVisible();
    await expect(planMoment.getByText('Đích đến: Nhóm Vận Hành ATI')).toHaveCount(2);

    // Open PreviewModal for step_1 (telegram.read_messages)
    await planMoment.locator('#preview-step_1').click();
    const previewModal = page.locator('#preview-modal-content');
    await expect(previewModal).toBeVisible();
    await expect(previewModal).toContainText('Nhóm Vận Hành ATI');
    await expect(previewModal).toContainText('5');
    await page.screenshot({ path: testInfo.outputPath('telegram-preview-read-messages.png'), fullPage: true });
    await page.keyboard.press('Escape');
    await expect(previewModal).toHaveCount(0);

    // Approve plan and execute through real Backend ExecutionService + TELEGRAM_FAKE + PostgreSQL
    await page.getByRole('button', { name: /Duyệt kế hoạch/ }).click();
    await expect
      .poll(async () => (await db.query('SELECT status FROM plans WHERE id = $1', [planId])).rows[0]?.status)
      .toBe('completed');

    // Verify ReceiptMoment (#moment-6)
    await expect(page.getByRole('heading', { level: 1, name: /^Đã xong 2 việc trên 1 công cụ/ })).toBeVisible();
    await expect(page.getByText('✓ Đã đọc tin nhắn', { exact: true })).toBeVisible();
    await expect(page.getByText('✓ Đã gửi tin', { exact: true })).toBeVisible();
    await expect(page.getByText('Minh Lead', { exact: true })).toBeVisible();
    await expect(page.getByText('Cần kiểm tra tiến độ Sprint và cập nhật báo cáo tuần', { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('telegram-receipt-moment.png'), fullPage: true });

    // Verify PostgreSQL execution_steps outputs
    const stepRows = (
      await db.query(
        'SELECT step_id, tool, status, output_json FROM execution_steps WHERE plan_id = $1 ORDER BY step_id',
        [planId],
      )
    ).rows;
    expect(stepRows.map((r) => r.status)).toEqual(['succeeded', 'succeeded']);
    expect(Array.isArray(stepRows[0].output_json.messages)).toBe(true);
    expect(stepRows[0].output_json.messages[0].senderName).toBe('Minh Lead');
    expect(stepRows[1].output_json.chatId).toBe('-1001234567890');

    expect(externalRequests).toEqual([]);
  } finally {
    await db.end();
  }
});
