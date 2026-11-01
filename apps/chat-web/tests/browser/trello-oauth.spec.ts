import { test, expect, type Page } from '@playwright/test';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../../../chat-api/src/db/repositories/user-repo.js';

async function loginUser(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hôm nay bạn muốn nhờ việc gì?');
}

test('TRELLO: admin selects workspace and two boards, member connects via fake OAuth, plan displays board name and username', async ({ page }) => {
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
          { id: 'b1', name: 'Sprint Board', workspaceId: 'ws-1', member: true },
          { id: 'b2', name: 'Bug Tracker', workspaceId: 'ws-1', member: true },
          { id: 'b3', name: 'Backlog', workspaceId: 'ws-1', member: false },
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

  // Admin sees #trello-scope and selects workspace and two boards
  const scopeSection = page.locator('#trello-scope');
  await expect(scopeSection).toBeVisible();

  const sprintCheckbox = page.getByRole('checkbox', { name: /Sprint Board/i });
  const bugCheckbox = page.getByRole('checkbox', { name: /Bug Tracker/i });

  await sprintCheckbox.check();
  await bugCheckbox.check();

  const saveScopeBtn = page.getByRole('button', { name: 'Lưu bảng được dùng', exact: true });
  await expect(saveScopeBtn).toBeEnabled();
  await saveScopeBtn.click();

  // 2. Member logs in and connects via fake OAuth
  await page.evaluate(() => localStorage.clear());
  await loginUser(page, memberEmail, memberPassword);

  let memberConnectionState = {
    status: 'not_connected',
    boards: [] as Array<{ boardId: string; boardName: string; member: boolean }>,
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
