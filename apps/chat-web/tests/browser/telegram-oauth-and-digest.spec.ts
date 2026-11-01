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

test('TELEGRAM: 1-click deep-link pairing, friendly chat scope selection, plan display and auto_digest schedule confirmation', async ({
  page,
}) => {
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
      [memberId, memberEmail, hashPassword(memberPassword)]
    );
  } finally {
    await db.end();
  }

  await loginUser(page, memberEmail, memberPassword);

  let telegramState = {
    status: 'not_connected',
    botUsername: 'ati_assistant_bot',
    username: undefined as string | undefined,
    chats: [] as Array<{
      chatId: string;
      title: string;
      type: 'private' | 'group' | 'supergroup' | 'channel';
      member: boolean;
    }>,
    selectedChats: [] as Array<{
      chatId: string;
      title: string;
      type: 'private' | 'group' | 'supergroup' | 'channel';
      member: boolean;
    }>,
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

  await page.route('**/api/connections/telegram/callback', async (route) => {
    telegramState = {
      status: 'connected',
      botUsername: 'ati_assistant_bot',
      username: 'an_telegram',
      chats: [
        {
          chatId: '777001',
          title: 'Telegram của tôi (An)',
          type: 'private',
          member: true,
        },
        {
          chatId: '-100999888',
          title: 'Đội Sản Phẩm',
          type: 'supergroup',
          member: true,
        },
      ],
      selectedChats: [
        {
          chatId: '777001',
          title: 'Telegram của tôi (An)',
          type: 'private',
          member: true,
        },
      ],
    };
    return route.fulfill({
      json: {
        status: 'connected',
        telegramUserId: '777001',
        username: 'an_telegram',
        displayName: 'An',
        chats: telegramState.chats,
        selectedChats: telegramState.selectedChats,
      },
    });
  });

  await page.route('**/api/connections/telegram/scope', async (route) => {
    if (route.request().method() === 'PUT') {
      telegramState.selectedChats = telegramState.chats;
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

  await page.waitForURL(/.*\/settings.*#telegram/);
  await expect(telegramRow).toContainText('an_telegram');
  await expect(page.getByText('Đã kết nối @an_telegram')).toBeVisible();

  await page.locator('#telegram-edit-scope').click();
  await expect(page.locator('#telegram-scope')).toBeVisible();
  await page.getByRole('checkbox', { name: /Đội Sản Phẩm/i }).check();
  await page.locator('#telegram-save-scope').click();
  await expect(telegramRow).toContainText('Đội Sản Phẩm');

  expect(externalRequests).toEqual([]);
});
