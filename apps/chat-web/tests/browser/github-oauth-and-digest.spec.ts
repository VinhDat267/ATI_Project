import { test, expect, type Page } from '@playwright/test';
import pg from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { encryptCredentials } from '../../../../packages/tool-adapters/src/crypto.js';
import { hashPassword } from '../../../chat-api/src/db/repositories/user-repo.js';
import { computeDigestConfigHash } from '../../../chat-api/src/services/schedules/github-digest-candidate.js';
import { certifyFixturePlan, fixtureConversation, fixtureMessage } from './persisted-artifacts.fixture.js';

const enabled = process.env.SANDBOX_SCENARIO === 'schedule';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '01234567890123456789012345678901';

async function loginUser(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hôm nay bạn muốn nhờ việc gì?');
}

test('GITHUB-DIGEST: [USER_FLOW_E2E] admin selects team repos, member connects from refusal card, and schedules an auto-digest run end-to-end', async ({ page }, testInfo) => {
  test.skip(!enabled, 'requires schedule sandbox scenario with SCHEDULES_ENABLED=on');

  const externalRequests: string[] = [];
  await page.route(/github\.com|api\.github\.com/, (route) => {
    externalRequests.push(route.request().url());
    return route.abort('blockedbyclient');
  });

  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const memberId = randomUUID();
  const memberEmail = `github-member-${memberId}@example.test`;
  const memberPassword = 'Member@12345678';
  let refusalConvId = '';

  try {
    const adminId = (await db.query('SELECT id FROM users WHERE email = $1', [process.env.CHAT_ADMIN_EMAIL!])).rows[0].id as string;
    await db.query('DELETE FROM github_team_scope');
    await db.query("DELETE FROM service_credentials WHERE service = 'github' AND user_id = $1", [adminId]);
    await db.query(
      "INSERT INTO service_credentials(id, service, user_id, workspace_id, config, status) VALUES($1, 'github', $2, NULL, $3, 'active')",
      [
        randomUUID(),
        adminId,
        encryptCredentials(
          {
            accessToken: 'gho_admin_fixture_token',
            login: 'admin_octo',
            githubUserId: '9001',
            connectedAt: new Date().toISOString(),
          },
          ENCRYPTION_KEY,
        ),
      ],
    );

    await db.query(
      "INSERT INTO users(id, email, password, name, status, role, email_verified) VALUES($1, $2, $3, 'GitHub Member', 'active', 'member', true)",
      [memberId, memberEmail, hashPassword(memberPassword)]
    );
    refusalConvId = await fixtureConversation(db, memberId);
    await fixtureMessage(db, refusalConvId, 'user', 'Tạo issue trên repo acme/ati');
    await fixtureMessage(
      db,
      refusalConvId,
      'assistant',
      'Từ chối yêu cầu: Bạn cần kết nối GitHub cá nhân trước khi tạo hoặc tra cứu issue trên GitHub.',
      {
        type: 'refusal',
        reason: 'Bạn cần kết nối GitHub cá nhân trước khi tạo hoặc tra cứu issue trên GitHub.',
        unavailableServices: [{ id: 'github', name: 'GitHub' }],
      },
    );

    // 1. Admin logs in and selects two repositories (acme/ati and owner/repo) for the team via the real backend /api/connections/github/scope
    await loginUser(page, process.env.CHAT_ADMIN_EMAIL!, process.env.CHAT_ADMIN_PASSWORD!);

    await page.goto('/settings#github');
    const adminGithubRow = page.locator('#service-row-github');
    await expect(adminGithubRow).toBeVisible();

    const scopeSection = page.locator('#github-scope');
    await expect(scopeSection).toBeVisible();

    const scopeCounter = scopeSection.getByTestId('github-scope-counter');
    await expect(scopeCounter).toHaveText('Đã chọn 0/10');
    await expect(scopeSection.getByText('Private')).toHaveCount(2);
    await expect(scopeSection.getByText('Public')).toHaveCount(3);

    const filterInput = scopeSection.getByLabel('Tìm nhanh repository');
    await expect(filterInput).toBeVisible();
    await filterInput.fill('secret');
    await expect(scopeSection.getByRole('checkbox', { name: /acme\/secret/i })).toBeVisible();
    await expect(scopeSection.getByRole('checkbox', { name: /acme\/ati/i })).toHaveCount(0);
    await filterInput.fill('');

    await page.getByRole('checkbox', { name: /acme\/ati/i }).check();
    await page.getByRole('checkbox', { name: /owner\/repo/i }).check();
    await expect(scopeCounter).toHaveText('Đã chọn 2/10');
    await page.screenshot({ path: testInfo.outputPath('github-scope-selector.png'), fullPage: true });

    const saveScopeBtn = page.locator('#github-save-scope');
    await expect(saveScopeBtn).toBeEnabled();
    await saveScopeBtn.click();
    await expect(page.locator('#github-edit-scope')).toBeVisible();

    // 2. Member logs in, opens the refusal conversation, connects GitHub via the real OAuth PKCE callback route, and returns to the same conversation
    await page.evaluate(() => localStorage.clear());
    await loginUser(page, memberEmail, memberPassword);

    await page.goto(`/c/${refusalConvId}`);
    const connectFromChatBtn = page.locator('#github-connect');
    await expect(connectFromChatBtn).toBeVisible();
    const callbackResponsePromise = page.waitForResponse(
      (res) => res.url().includes('/api/connections/github/callback') && res.request().method() === 'POST',
    );
    await connectFromChatBtn.click();
    const callbackResponse = await callbackResponsePromise;
    expect(callbackResponse.status()).toBe(200);

    await expect(page).toHaveURL(new RegExp(`/c/${refusalConvId}$`));
    await expect(page.getByRole('heading', { name: 'Tôi chưa làm được yêu cầu này' })).toBeVisible();

    const memberCredRow = (
      await db.query(
        "SELECT id, status FROM service_credentials WHERE service = 'github' AND user_id = $1 AND workspace_id IS NULL",
        [memberId],
      )
    ).rows[0];
    expect(memberCredRow?.status).toBe('active');
    expect(memberCredRow?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

    // 3. Member creates a new conversation and schedules a GitHub morning digest in auto_digest mode
    await page.goto('/');
    const requestBox = page.getByRole('textbox', { name: 'Mô tả công việc bạn muốn thực hiện' });
    await expect(requestBox).toBeVisible();
    await requestBox.fill('Mỗi sáng 8 giờ, gửi bản tin GitHub repo owner/repo lên Slack #general');
    await requestBox.press('Enter');

    await expect(page.locator('[data-moment="schedule"]')).toBeVisible();
    const autoRadio = page.locator('#schedule-mode-auto-digest');
    await expect(autoRadio).toBeVisible();
    await expect(autoRadio).toBeEnabled();
    await autoRadio.click();

    await expect(page.getByText(/Repo: owner\/repo · Kênh Slack: #general/)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('github-digest-slack-proposal.png'), fullPage: true });

    const confirmAutoBtn = page.getByRole('button', { name: 'Xác nhận và bật tự gửi', exact: true });
    await expect(confirmAutoBtn).toBeVisible();
    await confirmAutoBtn.click();

    await expect(page.getByRole('status').filter({ hasText: 'Đang bật' })).toBeVisible();
    await expect(page.getByText('Tự gửi', { exact: true })).toBeVisible();

    // C1-03: Verify (read-only SELECT, zero post-confirmation SQL mutation) that confirmProposal pinned the real UUID credentialId from the start
    const schedRow = (
      await db.query(
        'SELECT id, recurrence, digest_config, digest_config_hash FROM schedules WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
        [memberId],
      )
    ).rows[0];
    expect(schedRow.digest_config.credentialId).toBe(memberCredRow.id);
    expect(schedRow.digest_config_hash).toBe(
      computeDigestConfigHash({
        config: schedRow.digest_config,
        recurrence: schedRow.recurrence,
        userId: memberId,
      }),
    );

    // Run now and verify the digest is sent automatically without waiting for manual approval
    await page.getByRole('button', { name: 'Chạy lượt này ngay' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Đã gửi · 3 mục' })).toBeVisible();
    await expect(page.getByText(/Bản tin GitHub tự động của Planora/)).toBeVisible();

    // Verify in /history that the schedule shows "Tự gửi" and the latest run shows "Đã gửi" + destination (#general)
    await page.goto('/history');
    const scheduleRegion = page.getByRole('region', { name: 'Lịch chạy' });
    await expect(scheduleRegion).toBeVisible();
    await expect(scheduleRegion.getByText('Tự gửi')).toBeVisible();

    await scheduleRegion.getByRole('button', { name: 'Xem 10 lượt gần nhất' }).click();
    await expect(scheduleRegion.getByText(/^Đã gửi/).first()).toBeVisible();
    await expect(scheduleRegion.getByText('(#general)').first()).toBeVisible();

    expect(externalRequests).toEqual([]);
  } finally {
    await db.end();
  }
});

test('GITHUB-DIGEST: [SEEDED_INTEGRATION] extended GitHub tools plan destination, preview badges, real backend execution, and Telegram digest proposal', async ({ page }, testInfo) => {
  test.skip(!enabled, 'requires schedule sandbox scenario with SCHEDULES_ENABLED=on');

  const externalRequests: string[] = [];
  await page.route(/github\.com|api\.github\.com/, (route) => {
    externalRequests.push(route.request().url());
    return route.abort('blockedbyclient');
  });

  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await loginUser(page, process.env.CHAT_ADMIN_EMAIL!, process.env.CHAT_ADMIN_PASSWORD!);
    const adminId = (await db.query('SELECT id FROM users WHERE email = $1', [process.env.CHAT_ADMIN_EMAIL!])).rows[0].id as string;
    const adminCredId = randomUUID();
    await db.query("DELETE FROM service_credentials WHERE service = 'github' AND user_id = $1", [adminId]);
    await db.query(
      "INSERT INTO service_credentials(id, service, user_id, workspace_id, config, status) VALUES($1, 'github', $2, NULL, $3, 'active')",
      [
        adminCredId,
        adminId,
        encryptCredentials(
          {
            accessToken: 'gho_admin_fixture_token',
            login: 'admin_octo',
            githubUserId: '9001',
            connectedAt: new Date().toISOString(),
          },
          ENCRYPTION_KEY,
        ),
      ],
    );
    await db.query('DELETE FROM github_team_scope');
    await db.query("INSERT INTO github_team_scope(id, chosen_by) VALUES('default', $1)", [adminId]);
    await db.query(
      "INSERT INTO github_team_repos(scope_id, repo_id, full_name, name, position) VALUES('default', '100', 'owner/repo', 'repo', 1)",
    );

    // 1. Seed a conversation with a 4-step GitHub plan exercising create_issue (with assignees), update_issue, get_pull_request, and add_comment
    const planConvId = await fixtureConversation(db, adminId);
    await fixtureMessage(
      db,
      planConvId,
      'user',
      'Tạo issue mới, đóng issue #42, đọc PR #18 và bình luận xác nhận trên owner/repo'
    );

    const plan = {
      kind: 'plan',
      summary: 'Quản lý vòng đời Issue & PR trên GitHub',
      thinking: 'Tạo issue mới kèm người phụ trách, đóng issue #42, đọc thông tin PR #18 và để lại bình luận xác nhận.',
      warnings: [],
      connections: {
        github: {
          credentialId: adminCredId,
          githubUserId: '9001',
          login: 'admin_octo',
          repos: ['owner/repo'],
        },
      },
      resourceLabels: {
        'owner/repo': 'owner/repo',
      },
      steps: [
        {
          id: 'step_1',
          tool: 'github.create_issue',
          description: 'Tạo issue mới kèm người phụ trách',
          args: {
            repo: 'owner/repo',
            title: 'Sửa lỗi OAuth callback',
            body: 'Kiểm tra tham số state khi redirect',
            labels: ['bug', 'security'],
            assignees: ['alice'],
          },
          dependsOn: [],
        },
        {
          id: 'step_2',
          tool: 'github.update_issue',
          description: 'Đóng issue #42 sau khi vá lỗi',
          args: {
            repo: 'owner/repo',
            issueNumber: 42,
            title: 'Đóng issue #42 sau khi vá lỗi',
            state: 'closed',
            labels: ['bug'],
            assignees: ['alice', 'bob'],
          },
          dependsOn: ['step_1'],
        },
        {
          id: 'step_3',
          tool: 'github.get_pull_request',
          description: 'Đọc chi tiết PR #18',
          args: {
            repo: 'owner/repo',
            issueNumber: 18,
          },
          dependsOn: ['step_2'],
        },
        {
          id: 'step_4',
          tool: 'github.add_comment',
          description: 'Bình luận xác nhận vào issue #42',
          args: {
            repo: 'owner/repo',
            issueNumber: 42,
            body: 'Đã xác nhận bản vá trên PR #18.',
          },
          dependsOn: ['step_3'],
        },
      ],
    };

    const planText = JSON.stringify(plan);
    const planId = (
      await db.query(
        `INSERT INTO plans(conv_id, plan_json, plan_text, plan_hash, status, expires_at)
         VALUES($1, $2::jsonb, $3, $4, 'pending', now() + interval '30 minutes') RETURNING id`,
        [planConvId, planText, planText, createHash('sha256').update(planText).digest('hex')]
      )
    ).rows[0].id;
    await certifyFixturePlan(db, planId);

    await fixtureMessage(
      db,
      planConvId,
      'assistant',
      plan.summary,
      {
        type: 'plan',
        planId,
        plan: { ...plan, id: planId, status: 'pending' },
        resourceLabels: plan.resourceLabels,
      },
    );

    await page.goto(`/c/${planConvId}`);
    const planMoment = page.locator('#moment-4');
    await expect(planMoment).toBeVisible();

    // Verify FE-GH-1 & FE-GH-2: operation labels and #N destination formatting
    await expect(planMoment).toContainText('Tài khoản: @admin_octo (GitHub của bạn)');
    await expect(planMoment.getByText('owner/repo · #42').first()).toBeVisible();
    await expect(planMoment.getByText('owner/repo · #18')).toBeVisible();
    await expect(planMoment.getByText(/chưa có tên trong dữ liệu/)).toHaveCount(0);
    await expect(planMoment.getByText('Tạo mới', { exact: true })).toBeVisible();
    await expect(planMoment.getByText('Cập nhật issue', { exact: true })).toBeVisible();
    await expect(planMoment.getByText('Đọc PR', { exact: true })).toBeVisible();
    await expect(planMoment.getByText('Bình luận issue', { exact: true })).toBeVisible();

    // Verify FE-GH-3: open PreviewModal on step_2 (github.update_issue) and check badges
    await planMoment.locator('#preview-step_2').click();
    const previewBadges = page.getByTestId('github-preview-badges');
    await expect(previewBadges).toBeVisible();
    await expect(previewBadges.getByText('Đã đóng (closed)', { exact: true })).toBeVisible();
    await expect(previewBadges.getByText('#bug', { exact: true })).toBeVisible();
    await expect(previewBadges.getByText('@alice', { exact: true })).toBeVisible();
    await expect(previewBadges.getByText('@bob', { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('github-preview-modal-badges.png'), fullPage: true });
    await page.keyboard.press('Escape');
    await expect(previewBadges).toHaveCount(0);

    // Approve plan and execute through real Backend StepRunner + GITHUB_FAKE + PostgreSQL
    await page.getByRole('button', { name: /Duyệt kế hoạch/ }).click();
    await expect.poll(async () => (await db.query('SELECT status FROM plans WHERE id = $1', [planId])).rows[0]?.status).toBe('completed');

    // Verify ReceiptMoment (#moment-6)
    await expect(page.getByRole('heading', { level: 1, name: /^Đã xong 4 việc trên/ })).toBeVisible();
    await expect(page.getByText('✓ Đã tạo issue', { exact: true })).toBeVisible();
    await expect(page.getByText('✓ Đã cập nhật issue', { exact: true })).toBeVisible();
    await expect(page.getByText('✓ Đã đọc PR', { exact: true })).toBeVisible();
    await expect(page.getByText('✓ Đã bình luận', { exact: true })).toBeVisible();
    await expect(page.getByText('PR #18', { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('github-receipt-moment.png'), fullPage: true });

    // Verify PostgreSQL execution_steps outputs
    const stepRows = (
      await db.query('SELECT step_id, tool, status, output_json FROM execution_steps WHERE plan_id = $1 ORDER BY step_id', [planId])
    ).rows;
    expect(stepRows.map((r) => r.status)).toEqual(['succeeded', 'succeeded', 'succeeded', 'succeeded']);
    expect(stepRows[0].output_json.assignees).toEqual(['alice']);
    expect(stepRows[1].output_json.state).toBe('closed');
    expect(stepRows[2].output_json.isPullRequest).toBe(true);
    expect(stepRows[3].output_json.issueNumber).toBe(42);

    // 2. Verify FE-GH-4: github_digest proposal with Telegram destination
    const tgConvId = await fixtureConversation(db, adminId);
    await fixtureMessage(
      db,
      tgConvId,
      'user',
      'Mỗi sáng 8 giờ gửi bản tin GitHub repo owner/repo vào nhóm Telegram Kỹ Thuật ATI'
    );
    await fixtureMessage(
      db,
      tgConvId,
      'assistant',
      'Đề xuất lịch chạy tự động gửi qua Telegram',
      {
        type: 'schedule_proposal',
        services: ['github', 'telegram'],
        nextRuns: ['2026-11-03T01:00:00.000Z'],
        proposal: {
          kind: 'schedule',
          action: 'create',
          name: 'Bản tin GitHub Telegram',
          request: 'Mỗi sáng 8 giờ gửi bản tin GitHub repo owner/repo vào nhóm Telegram Kỹ Thuật ATI',
          recurrence: { type: 'daily', time: '08:00' },
          summary: 'Mỗi sáng 8 giờ, gửi bản tin GitHub vào nhóm Telegram Kỹ Thuật ATI.',
        },
        digestCandidate: {
          canAutoDigest: true,
          config: {
            githubUserId: 'gh-admin-1',
            githubLogin: 'admin_octo',
            repos: ['owner/repo'],
            channelId: '',
            channelName: '',
            telegramChatId: '-100999888',
            telegramChatTitle: 'Nhóm Kỹ Thuật ATI',
            windowHours: 24,
            staleDays: 3,
          },
        },
      },
    );

    await page.goto(`/c/${tgConvId}`);
    await expect(page.locator('[data-moment="schedule"]')).toBeVisible();
    const tgAutoRadio = page.locator('#schedule-mode-auto-digest');
    await expect(tgAutoRadio).toBeVisible();
    await tgAutoRadio.click();
    await expect(
      page.getByText(/Repo: owner\/repo · Telegram: Nhóm Kỹ Thuật ATI · Nội dung: Issue mới, PR chờ review quá 3 ngày/)
    ).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('github-digest-telegram-proposal.png'), fullPage: true });

    expect(externalRequests).toEqual([]);
  } finally {
    await db.end();
  }
});
