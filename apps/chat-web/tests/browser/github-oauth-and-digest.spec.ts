import { test, expect, type Page } from '@playwright/test';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../../../chat-api/src/db/repositories/user-repo.js';

const enabled = process.env.SANDBOX_SCENARIO === 'schedule';

async function loginUser(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hôm nay bạn muốn nhờ việc gì?');
}

test('GITHUB-DIGEST: admin selects team repos, member connects from refusal card, and schedules an auto-digest run end-to-end', async ({ page }) => {
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
    await db.query(
      "INSERT INTO users(id, email, password, name, status, role, email_verified) VALUES($1, $2, $3, 'GitHub Member', 'active', 'member', true)",
      [memberId, memberEmail, hashPassword(memberPassword)]
    );
    refusalConvId = (
      await db.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [memberId])
    ).rows[0].id;
    await db.query(
      "INSERT INTO messages(conv_id, role, content) VALUES($1, 'user', 'Tạo issue trên repo acme/ati')",
      [refusalConvId]
    );
    await db.query(
      "INSERT INTO messages(conv_id, role, content, metadata) VALUES($1, 'assistant', 'Từ chối yêu cầu: Bạn cần kết nối GitHub cá nhân trước khi tạo hoặc tra cứu issue trên GitHub.', $2)",
      [
        refusalConvId,
        {
          type: 'refusal',
          reason: 'Bạn cần kết nối GitHub cá nhân trước khi tạo hoặc tra cứu issue trên GitHub.',
          unavailableServices: [{ id: 'github', name: 'GitHub' }],
        },
      ]
    );

    // 1. Admin logs in and selects two repositories for the team
    await loginUser(page, process.env.CHAT_ADMIN_EMAIL!, process.env.CHAT_ADMIN_PASSWORD!);

    let adminConnectionState = {
      status: 'needs_scope',
      login: 'admin_octo',
      repos: [] as Array<{ repoId: string; fullName: string; name: string; accessible: boolean }>,
    };

    await page.route('**/api/connections/github', async (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ json: adminConnectionState });
      }
      return route.continue();
    });

    await page.route('**/api/connections/github/candidate-repos', async (route) => {
      return route.fulfill({
        json: {
          repos: [
            { repoId: '101', fullName: 'acme/ati', name: 'ati' },
            { repoId: '102', fullName: 'acme/docs', name: 'docs' },
            { repoId: '103', fullName: 'acme/secret', name: 'secret' },
          ],
        },
      });
    });

    await page.route('**/api/connections/github/scope', async (route) => {
      if (route.request().method() === 'PUT') {
        adminConnectionState = {
          status: 'connected',
          login: 'admin_octo',
          repos: [
            { repoId: '101', fullName: 'acme/ati', name: 'ati', accessible: true },
            { repoId: '102', fullName: 'acme/docs', name: 'docs', accessible: true },
          ],
        };
        return route.fulfill({
          json: {
            chosenBy: 'admin',
            repos: [
              { repoId: '101', fullName: 'acme/ati', name: 'ati' },
              { repoId: '102', fullName: 'acme/docs', name: 'docs' },
            ],
          },
        });
      }
      return route.continue();
    });

    await page.goto('/settings#github');
    const adminGithubRow = page.locator('#service-row-github');
    await expect(adminGithubRow).toBeVisible();

    const scopeSection = page.locator('#github-scope');
    await expect(scopeSection).toBeVisible();

    await page.getByRole('checkbox', { name: /acme\/ati/i }).check();
    await page.getByRole('checkbox', { name: /acme\/docs/i }).check();

    const saveScopeBtn = page.locator('#github-save-scope');
    await expect(saveScopeBtn).toBeEnabled();
    await saveScopeBtn.click();
    await expect(page.locator('#github-edit-scope')).toBeVisible();

    // 2. Member logs in, opens the refusal conversation, connects GitHub via fake OAuth, and returns to the same conversation
    await page.evaluate(() => localStorage.clear());
    await loginUser(page, memberEmail, memberPassword);

    let memberConnectionState = {
      status: 'not_connected',
      login: undefined as string | undefined,
      repos: [] as Array<{ repoId: string; fullName: string; name: string; accessible: boolean }>,
    };

    await page.unroute('**/api/connections/github');
    await page.route('**/api/connections/github', async (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ json: memberConnectionState });
      }
      return route.continue();
    });

    const redirectUri = `http://127.0.0.1:${process.env.V3_WEB_PORT || 5174}/connections/github/callback`;
    await page.route('**/api/connections/github/start', async (route) => {
      return route.fulfill({
        json: {
          url: `${redirectUri}?code=fake-member-github-code&state=fake-member-github-state`,
        },
      });
    });

    let callbackCompleted = false;
    await page.route('**/api/connections/github/callback', async (route) => {
      memberConnectionState = {
        status: 'connected',
        login: 'bob_octo',
        repos: [
          { repoId: '101', fullName: 'acme/ati', name: 'ati', accessible: true },
          { repoId: '102', fullName: 'acme/docs', name: 'docs', accessible: true },
        ],
      };
      callbackCompleted = true;
      return route.fulfill({
        json: {
          login: 'bob_octo',
          returnTo: `/c/${refusalConvId}`,
        },
      });
    });

    await page.goto(`/c/${refusalConvId}`);
    const connectFromChatBtn = page.locator('#github-connect');
    await expect(connectFromChatBtn).toBeVisible();
    await connectFromChatBtn.click();

    await expect.poll(() => callbackCompleted).toBe(true);
    await expect(page).toHaveURL(new RegExp(`/c/${refusalConvId}$`));
    await expect(page.getByRole('heading', { name: 'Tôi chưa làm được yêu cầu này' })).toBeVisible();

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

    const confirmAutoBtn = page.getByRole('button', { name: 'Xác nhận và bật tự gửi', exact: true });
    await expect(confirmAutoBtn).toBeVisible();
    await confirmAutoBtn.click();

    await expect(page.getByRole('status').filter({ hasText: 'Đang bật' })).toBeVisible();
    await expect(page.getByText('Tự gửi', { exact: true })).toBeVisible();

    // Run now and verify the digest is sent automatically without waiting for manual approval
    await page.getByRole('button', { name: 'Chạy lượt này ngay' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Đã gửi · 3 mục' })).toBeVisible();
    await expect(page.getByText(/Bản tin GitHub tự động của ATI/)).toBeVisible();

    // Verify in /history that the schedule shows "Tự gửi" and the latest run shows "Đã gửi"
    await page.goto('/history');
    const scheduleRegion = page.getByRole('region', { name: 'Lịch chạy' });
    await expect(scheduleRegion).toBeVisible();
    await expect(scheduleRegion.getByText('Tự gửi')).toBeVisible();

    await scheduleRegion.getByRole('button', { name: 'Xem 10 lượt gần nhất' }).click();
    await expect(scheduleRegion.getByText(/^Đã gửi/)).toBeVisible();

    expect(externalRequests).toEqual([]);
  } finally {
    await db.end();
  }
});
