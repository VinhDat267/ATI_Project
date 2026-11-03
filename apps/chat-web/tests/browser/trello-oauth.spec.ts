import { test, expect, type Page } from '@playwright/test';
import pg from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { hashPassword } from '../../../chat-api/src/db/repositories/user-repo.js';
import { fixtureConversation, fixtureMessage, certifyFixturePlan } from './persisted-artifacts.fixture.js';

async function loginUser(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hôm nay bạn muốn nhờ việc gì?');
}

test('TRELLO: admin selects workspace and two boards, member connects via fake OAuth, plan displays board name and username', async ({ page }, testInfo) => {
  const externalRequests: string[] = [];

  // Strictly block and record any attempt to reach external Atlassian/Trello hosts
  await page.route(/auth\.atlassian\.com|api\.trello\.com/, (route) => {
    externalRequests.push(route.request().url());
    return route.abort('blockedbyclient');
  });

  // Provision a member user in database
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const memberId = randomUUID();
  const memberEmail = `trello-member-${memberId}@example.test`;
  const memberPassword = 'Member@12345678';
  try {
    await db.query(
      "INSERT INTO users(id, email, password, name, status, role, email_verified) VALUES($1, $2, $3, 'Trello Member', 'active', 'member', true)",
      [memberId, memberEmail, hashPassword(memberPassword)]
    );
  } finally {
    await db.end();
  }

  // 1. Admin logs in and selects workspace and two boards
  await loginUser(page, process.env.CHAT_ADMIN_EMAIL!, process.env.CHAT_ADMIN_PASSWORD!);

  let adminConnectionState = {
    status: 'needs_scope',
    username: 'admin_trello',
    boards: [] as Array<{ boardId: string; boardName: string; member: boolean }>,
  };

  await page.route('**/api/connections/trello', async (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: adminConnectionState });
    }
    return route.continue();
  });

  await page.route('**/api/connections/trello/workspaces', async (route) => {
    return route.fulfill({
      json: {
        workspaces: [
          { id: 'ws-1', name: 'Engineering Workspace' },
          { id: 'ws-2', name: 'Design Workspace' },
        ],
      },
    });
  });

  await page.route('**/api/connections/trello/workspaces/*/boards', async (route) => {
    return route.fulfill({
      json: {
        boards: [
          { id: 'b1', name: 'Sprint Board', member: true },
          { id: 'b2', name: 'Bug Tracker', member: true },
          { id: 'b3', name: 'Backlog', member: false },
          { id: 'b4', name: 'Design System', member: true },
          { id: 'b5', name: 'Release Ops', member: true },
        ],
      },
    });
  });

  await page.route('**/api/connections/trello/scope', async (route) => {
    if (route.request().method() === 'PUT') {
      const data = route.request().postDataJSON();
      adminConnectionState = {
        status: 'connected',
        username: 'admin_trello',
        boards: [
          { boardId: 'b1', boardName: 'Sprint Board', member: true },
          { boardId: 'b2', boardName: 'Bug Tracker', member: true },
        ],
      };
      return route.fulfill({
        json: {
          chosenBy: 'admin',
          workspaceId: data.workspaceId,
          workspaceName: 'Engineering Workspace',
          boards: [
            { boardId: 'b1', boardName: 'Sprint Board' },
            { boardId: 'b2', boardName: 'Bug Tracker' },
          ],
        },
      });
    }
    return route.continue();
  });

  await page.goto('/settings#trello');
  const adminTrelloRow = page.locator('#service-row-trello');
  await expect(adminTrelloRow).toBeVisible();

  // Admin sees #trello-scope, scope counter, and quick filter input
  const scopeSection = page.locator('#trello-scope');
  await expect(scopeSection).toBeVisible();

  const scopeCounter = scopeSection.getByTestId('trello-scope-counter');
  await expect(scopeCounter).toHaveText('Đã chọn 0/10');

  const filterInput = scopeSection.getByLabel('Tìm nhanh bảng Trello');
  await expect(filterInput).toBeVisible();
  await filterInput.fill('Release');
  await expect(scopeSection.getByRole('checkbox', { name: /Release Ops/i })).toBeVisible();
  await expect(scopeSection.getByRole('checkbox', { name: /Sprint Board/i })).toHaveCount(0);
  await filterInput.fill('');

  const sprintCheckbox = page.getByRole('checkbox', { name: /Sprint Board/i });
  const bugCheckbox = page.getByRole('checkbox', { name: /Bug Tracker/i });

  await sprintCheckbox.check();
  await bugCheckbox.check();
  await expect(scopeCounter).toHaveText('Đã chọn 2/10');
  await page.screenshot({ path: testInfo.outputPath('trello-scope-selector.png'), fullPage: true });

  const saveScopeBtn = page.getByRole('button', { name: 'Lưu bảng được dùng', exact: true });
  await expect(saveScopeBtn).toBeEnabled();
  await saveScopeBtn.click();
  await expect(page.locator('#trello-edit-scope')).toBeVisible();

  // 2. Member logs in and connects via fake OAuth
  await page.evaluate(() => localStorage.clear());
  await loginUser(page, memberEmail, memberPassword);

  let memberConnectionState: {
    status: string;
    username?: string;
    boards: Array<{ boardId: string; boardName: string; member: boolean }>;
  } = {
    status: 'not_connected',
    boards: [],
  };

  // Override trello connection route for member
  await page.unroute('**/api/connections/trello');
  await page.route('**/api/connections/trello', async (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: memberConnectionState });
    }
    return route.continue();
  });

  const redirectUri = `http://127.0.0.1:${process.env.V3_WEB_PORT || 5174}/connections/trello/callback`;
  await page.route('**/api/connections/trello/start', async (route) => {
    return route.fulfill({
      json: {
        url: `${redirectUri}?code=fake-member-trello-code&state=fake-member-state`,
      },
    });
  });

  await page.route('**/api/connections/trello/callback', async (route) => {
    memberConnectionState = {
      status: 'connected',
      username: 'bob_member_trello',
      boards: [
        { boardId: 'b1', boardName: 'Sprint Board', member: true },
        { boardId: 'b2', boardName: 'Bug Tracker', member: true },
      ],
    };
    return route.fulfill({
      json: {
        username: 'bob_member_trello',
      },
    });
  });

  await page.goto('/settings#trello');
  const memberTrelloRow = page.locator('#service-row-trello');
  await expect(memberTrelloRow).toBeVisible();

  // Member does NOT see admin scope section
  await expect(page.locator('#trello-scope')).toHaveCount(0);

  // Click Connect Trello
  const connectBtn = page.locator('#trello-connect');
  await expect(connectBtn).toBeVisible();
  await connectBtn.click();

  // Redirects to callback then back to /settings#trello
  await page.waitForURL(/.*\/settings.*#trello/);
  await expect(memberTrelloRow).toContainText('bob_member_trello');
  await expect(page.getByText('Đã kết nối @bob_member_trello')).toBeVisible();

  // 3. Member sends request to create a card
  await page.goto('/');
  await page.getByRole('textbox').fill('Tạo thẻ mới trên Trello');

  const planId = 'plan-trello-test-123';
  await page.route('**/api/conversations/*/messages', async (route) => {
    return route.fulfill({
      status: 202,
      json: { messageId: 'msg-1' },
    });
  });

  await page.route('**/api/conversations/*/stream', async (route) => {
    const sseBody = [
      `event: plan\ndata: ${JSON.stringify({
        id: planId,
        summary: 'Tạo thẻ Trello',
        steps: [
          {
            id: 'step_1',
            tool: 'trello.create_card',
            description: 'Tạo thẻ fix bug',
            args: { boardId: 'b1', listId: 'l1', title: 'Fix bug' },
            dependsOn: [],
          },
        ],
        connections: {
          trello: {
            credentialId: 'cred-1',
            memberId: 'm1',
            username: 'bob_member_trello',
            boardIds: ['b1', 'b2'],
          },
        },
        resourceLabels: {
          b1: 'Sprint Board',
          l1: 'Đang làm (board Sprint Board)',
        },
      })}\n\n`,
    ].join('');

    return route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sseBody,
    });
  });

  await page.getByRole('button', { name: 'Gửi yêu cầu', exact: true }).click();

  // Plan approval screen appears (PlanMoment / Moment 4)
  const cockpitSection = page.locator('#moment-4');
  await expect(cockpitSection).toBeVisible();

  // Displays board name from resourceLabels and username from connections.trello.username
  await expect(cockpitSection).toContainText('Sprint Board');
  await expect(cockpitSection).toContainText('bob_member_trello');

  // Verify that absolutely no external requests reached Atlassian or Trello
  expect(externalRequests).toEqual([]);
});

test('TRELLO-E2E: extended Trello tools plan, guardrail warnings callout, Kanban preview modal, real backend execution, ReceiptMoment, and trello_digest proposal', async ({ page }, testInfo) => {
  const externalRequests: string[] = [];
  await page.route(/auth\.atlassian\.com|api\.trello\.com/, (route) => {
    externalRequests.push(route.request().url());
    return route.abort('blockedbyclient');
  });

  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await loginUser(page, process.env.CHAT_ADMIN_EMAIL!, process.env.CHAT_ADMIN_PASSWORD!);
    const adminId = (
      await db.query('SELECT id FROM users WHERE email = $1', [process.env.CHAT_ADMIN_EMAIL!])
    ).rows[0].id;

    // 1. Seed a conversation with a 6-step Trello plan exercising create_list, create_card, add_checklist, update_checklist_item, add_comment, and set_card_due_complete + Pre-Execution Guardrail warnings
    const planConvId = await fixtureConversation(db, adminId);
    await fixtureMessage(
      db,
      planConvId,
      'user',
      'Tạo cột QA Review, tạo thẻ Triển khai Trello OAuth, thêm checklist nghiệm thu, tích mục Kiểm tra unit test, bình luận xác nhận và đánh dấu hoàn thành hạn chót',
    );

    const plan = {
      kind: 'plan',
      summary: 'Quản lý trọn vòng đời công việc trên bảng Sprint Board Trello',
      thinking:
        'Tạo cột QA Review mới, tạo thẻ kèm người phụ trách và hạn chót, thêm checklist nghiệm thu, tích hoàn thành mục đầu tiên, bình luận cập nhật và đánh dấu hoàn thành hạn chót.',
      warnings: [
        'Cảnh báo trùng thẻ: Trên bảng đã có thẻ đang mở cùng tên "Triển khai Trello OAuth".',
        'Cảnh báo tải công việc: Thành viên Nguyễn Văn A (@vana) đang phụ trách 5 thẻ mở trên bảng này.',
      ],
      connections: {
        trello: {
          credentialId: 'sandbox-trello',
          memberId: 'sandbox-member',
          username: 'admin_trello',
          boardIds: ['b1', 'b2'],
        },
      },
      resourceLabels: {
        b1: 'Sprint Board',
        l1: 'Đang làm',
        card_1: 'Thẻ OAuth',
        member_minh_dev: 'Nguyễn Văn A (@vana)',
      },
      steps: [
        {
          id: 'step_1',
          tool: 'trello.create_list',
          description: 'Tạo cột QA Review trên bảng Sprint Board',
          boardId: 'b1',
          args: {
            boardId: 'b1',
            name: 'QA Review',
          },
          dependsOn: [],
        },
        {
          id: 'step_2',
          tool: 'trello.create_card',
          description: 'Tạo thẻ Triển khai Trello OAuth và gán Nguyễn Văn A',
          boardId: 'b1',
          args: {
            boardId: 'b1',
            listId: 'l1',
            title: 'Triển khai Trello OAuth',
            desc: 'Hoàn thiện luồng bảo mật OAuth 1.0a',
            due: '2026-12-15T10:00:00.000Z',
            dueComplete: true,
            idMembers: ['member_minh_dev'],
          },
          dependsOn: ['step_1'],
        },
        {
          id: 'step_3',
          tool: 'trello.add_checklist',
          description: 'Thêm Checklist Nghiệm Thu vào thẻ',
          boardId: 'b1',
          args: {
            boardId: 'b1',
            cardId: 'card_1',
            title: 'Checklist Nghiệm Thu',
            items: ['Kiểm tra unit test', 'Kiểm tra giao diện'],
          },
          dependsOn: ['step_2'],
        },
        {
          id: 'step_4',
          tool: 'trello.update_checklist_item',
          description: 'Đánh dấu hoàn thành mục Kiểm tra unit test',
          boardId: 'b1',
          args: {
            boardId: 'b1',
            cardId: 'card_1',
            itemName: 'Kiểm tra unit test',
            state: 'complete',
          },
          dependsOn: ['step_3'],
        },
        {
          id: 'step_5',
          tool: 'trello.add_comment',
          description: 'Bình luận cập nhật tiến độ vào thẻ',
          boardId: 'b1',
          args: {
            boardId: 'b1',
            cardId: 'card_1',
            text: 'Đã hoàn tất kiểm thử unit test và UI/UX.',
          },
          dependsOn: ['step_4'],
        },
        {
          id: 'step_6',
          tool: 'trello.set_card_due_complete',
          description: 'Đánh dấu hoàn thành hạn chót cho thẻ',
          boardId: 'b1',
          args: {
            boardId: 'b1',
            cardId: 'card_1',
            dueComplete: true,
          },
          dependsOn: ['step_5'],
        },
      ],
    };

    const planText = JSON.stringify(plan);
    const planId = (
      await db.query(
        `INSERT INTO plans(conv_id, plan_json, plan_text, plan_hash, status, expires_at, resource_labels)
         VALUES($1, $2::jsonb, $3, $4, 'pending', now() + interval '30 minutes', $5::jsonb) RETURNING id`,
        [
          planConvId,
          planText,
          planText,
          createHash('sha256').update(planText).digest('hex'),
          JSON.stringify(plan.resourceLabels),
        ]
      )
    ).rows[0].id;
    await certifyFixturePlan(db, planId);

    await fixtureMessage(db, planConvId, 'assistant', plan.summary, {
      type: 'plan',
      planId,
      plan: { ...plan, id: planId, status: 'pending' },
      resourceLabels: plan.resourceLabels,
    });

    await page.goto(`/c/${planConvId}`);
    const planMoment = page.locator('#moment-4');
    await expect(planMoment).toBeVisible();

    // Verify Trello account label, board destination, and Vietnamese operation badges
    await expect(planMoment).toContainText('Tài khoản: @admin_trello (Trello của bạn)');
    await expect(planMoment.getByText(/Sprint Board · Đang làm/).first()).toBeVisible();
    await expect(planMoment.getByText(/Sprint Board · Thẻ OAuth/).first()).toBeVisible();
    await expect(planMoment.getByText(/chưa có tên trong dữ liệu/)).toHaveCount(0);
    await expect(planMoment.getByText('Tạo cột mới', { exact: true })).toBeVisible();
    await expect(planMoment.getByText('Tạo mới', { exact: true })).toBeVisible();
    await expect(planMoment.getByText('Thêm checklist', { exact: true })).toBeVisible();
    await expect(planMoment.getByText('Cập nhật mục checklist', { exact: true })).toBeVisible();
    await expect(planMoment.getByText('Bình luận thẻ', { exact: true })).toBeVisible();
    await expect(planMoment.getByText('Đánh dấu hạn chót', { exact: true })).toBeVisible();

    // Verify Pre-Execution Guardrail Warning Callout
    const warningsCallout = planMoment.getByTestId('plan-warnings-callout');
    await expect(warningsCallout).toBeVisible();
    await expect(warningsCallout).toContainText('Lưu ý kiểm tra trước khi thực thi');
    await expect(warningsCallout).toContainText('Cảnh báo trùng thẻ');
    await expect(warningsCallout).toContainText('Cảnh báo tải công việc');

    // Verify Trello quick step pills on PlanMoment
    await expect(planMoment.getByTestId('trello-step-pills').first()).toBeVisible();
    await expect(planMoment).toContainText('👤 1 thành viên');
    await expect(planMoment).toContainText('☑️ 2 mục checklist');
    await expect(planMoment).toContainText('💬 Có bình luận');

    // Open PreviewModal on step_2 (trello.create_card) and verify Kanban Card Preview
    await planMoment.locator('#preview-step_2').click();
    const cardPreview = page.getByTestId('trello-card-preview');
    await expect(cardPreview).toBeVisible();
    await expect(cardPreview).toContainText('Triển khai Trello OAuth');
    await expect(cardPreview).toContainText('👤 Nguyễn Văn A (@vana)');
    await expect(cardPreview).toContainText('✓ Đã hoàn thành hạn');
    await page.screenshot({ path: testInfo.outputPath('trello-preview-modal-card.png'), fullPage: true });
    await page.keyboard.press('Escape');
    await expect(cardPreview).toHaveCount(0);

    // Open PreviewModal on step_3 (trello.add_checklist) and verify "Tên checklist:" with schema-standard args.title
    await planMoment.locator('#preview-step_3').click();
    const addChkPreview = page.getByTestId('trello-card-preview');
    await expect(addChkPreview).toBeVisible();
    await expect(addChkPreview).toContainText('Tên checklist:');
    await expect(addChkPreview).toContainText('Checklist Nghiệm Thu');
    await page.keyboard.press('Escape');
    await expect(addChkPreview).toHaveCount(0);

    // Open PreviewModal on step_4 (trello.update_checklist_item) and verify checklist state badge
    await planMoment.locator('#preview-step_4').click();
    const chkPreview = page.getByTestId('trello-card-preview');
    await expect(chkPreview).toBeVisible();
    await expect(chkPreview).toContainText('Kiểm tra unit test');
    await expect(chkPreview).toContainText('☑ Đã hoàn thành (complete)');
    await page.keyboard.press('Escape');
    await expect(chkPreview).toHaveCount(0);

    // Approve plan and execute through real Backend StepRunner + TRELLO_FAKE + PostgreSQL
    await page.getByRole('button', { name: /Duyệt kế hoạch/ }).click();
    await expect
      .poll(async () => (await db.query('SELECT status FROM plans WHERE id = $1', [planId])).rows[0]?.status)
      .toBe('completed');

    // Verify ReceiptMoment (#moment-6) and TrelloReceiptMetrics
    await expect(page.getByRole('heading', { level: 1, name: /^Đã xong 6 việc trên/ })).toBeVisible();
    await expect(page.getByText('✓ Đã tạo cột', { exact: true })).toBeVisible();
    await expect(page.getByText('✓ Đã tạo thẻ', { exact: true })).toBeVisible();
    await expect(page.getByText('✓ Đã thêm checklist', { exact: true })).toBeVisible();
    await expect(page.getByText('✓ Đã cập nhật checklist', { exact: true })).toBeVisible();
    await expect(page.getByText('✓ Đã bình luận', { exact: true })).toBeVisible();
    await expect(page.getByText('✓ Đã cập nhật hạn chót', { exact: true })).toBeVisible();
    await expect(page.getByText('QA Review', { exact: true })).toBeVisible();
    await expect(page.getByText('Checklist Nghiệm Thu', { exact: true })).toBeVisible();
    await expect(page.getByText('Kiểm tra unit test', { exact: true })).toBeVisible();
    await expect(page.getByTestId('trello-receipt-metrics').first()).toBeVisible();
    await expect(page.getByText('👤 Đã gán 1 thành viên')).toBeVisible();
    await expect(page.getByText('☑️ Đã tạo 2 mục checklist')).toBeVisible();
    await expect(page.getByText('☑ Đã đánh dấu hoàn thành')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('trello-receipt-moment.png'), fullPage: true });

    // Verify PostgreSQL execution_steps outputs
    const stepRows = (
      await db.query(
        'SELECT step_id, tool, status, output_json FROM execution_steps WHERE plan_id = $1 ORDER BY step_id',
        [planId]
      )
    ).rows;
    expect(stepRows.map((r) => r.status)).toEqual([
      'succeeded',
      'succeeded',
      'succeeded',
      'succeeded',
      'succeeded',
      'succeeded',
    ]);
    expect(stepRows[0].output_json.name).toBe('QA Review');
    expect(stepRows[1].output_json.name).toBe('Triển khai Trello OAuth');
    expect(stepRows[2].output_json.name).toBe('Checklist Nghiệm Thu');
    expect(stepRows[3].output_json.state).toBe('complete');
    expect(stepRows[4].output_json.text).toBe('Đã hoàn tất kiểm thử unit test và UI/UX.');
    expect(stepRows[5].output_json.dueComplete).toBe(true);

    // 2. Verify trello_digest proposal with Telegram destination on ScheduleMoment
    if (process.env.SCHEDULES_ENABLED === 'on') {
      const tgConvId = await fixtureConversation(db, adminId);
      await fixtureMessage(
        db,
        tgConvId,
        'user',
        'Mỗi sáng 8 giờ gửi bản tin Trello bảng Sprint Board vào nhóm Telegram Kỹ Thuật ATI',
      );
      await fixtureMessage(
        db,
        tgConvId,
        'assistant',
        'Đề xuất lịch chạy tự động gửi bản tin Trello qua Telegram',
        {
          type: 'schedule_proposal',
          services: ['trello', 'telegram'],
          nextRuns: ['2026-11-03T01:00:00.000Z'],
          proposal: {
            kind: 'schedule',
            action: 'create',
            name: 'Bản tin Trello Telegram',
            request: 'Mỗi sáng 8 giờ gửi bản tin Trello bảng Sprint Board vào nhóm Telegram Kỹ Thuật ATI',
            recurrence: { type: 'daily', time: '08:00' },
            summary: 'Mỗi sáng 8 giờ, gửi bản tin Trello vào nhóm Telegram Kỹ Thuật ATI.',
          },
          digestCandidate: {
            canAutoDigest: true,
            config: {
              credentialId: 'sandbox-trello',
              trelloMemberId: 'sandbox-member',
              username: 'admin_trello',
              boards: [{ id: 'b1', name: 'Sprint Board' }],
              channelId: '',
              channelName: '',
              telegramChatId: '-100999888',
              telegramChatTitle: 'Nhóm Kỹ Thuật ATI',
              dueSoonHours: 24,
            },
            configHash: 'hash-trello-e2e-1',
          },
        },
      );

      await page.goto(`/c/${tgConvId}`);
      await expect(page.locator('[data-moment="schedule"]')).toBeVisible();
      const tgAutoRadio = page.locator('#schedule-mode-auto-digest');
      await expect(tgAutoRadio).toBeVisible();
      await tgAutoRadio.click();
      await expect(
        page.getByText(
          /Bảng Trello: Sprint Board · Telegram: Nhóm Kỹ Thuật ATI · Nội dung: Thẻ quá hạn, sắp đến hạn trong 24 giờ, thẻ chưa gán người/
        )
      ).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('trello-digest-telegram-proposal.png'), fullPage: true });
    }

    expect(externalRequests).toEqual([]);
  } finally {
    await db.end();
  }
});
