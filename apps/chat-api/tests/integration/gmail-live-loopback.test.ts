import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGmailToolAdapter, encryptCredentials } from '@wap/tool-adapters';
import { startFakeGoogleGmail, type FakeGoogleGmail } from '../../../../scripts/fake-google-gmail.mjs';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { GmailOAuthClient } from '../../src/services/gmail/oauth-client.js';
import { GmailTokenManager } from '../../src/services/gmail/token-manager.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';

const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const CLIENT_ID = 'gmail-test.apps.googleusercontent.com';

describe('GMAIL-AUDIT-12: Real loopback HTTP GmailAdapter + GmailTokenManager + PostgreSQL', () => {
  let google: FakeGoogleGmail;
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let credentials: CredentialRepo;
  let client: GmailOAuthClient;
  let owner: { id: string };
  let credentialId: string;
  let refreshToken: string;
  let reconnects: string[];

  function makeAdapter(tokenManager: GmailTokenManager) {
    return createGmailToolAdapter({
      baseUrl: google.origin,
      tokens: tokenManager.forConnection(owner.id, credentialId, refreshToken),
    });
  }

  function createManager() {
    return new GmailTokenManager({
      client,
      credentials,
      clientId: CLIENT_ID,
      encryptionKey: KEY,
      service: 'gmail',
      onReconnectRequired: (userId) => reconnects.push(userId),
    });
  }

  function makeMessage(id: string, text: string, idx = 1) {
    return {
      id,
      labelIds: ['INBOX'],
      snippet: text,
      payload: {
        mimeType: 'text/plain',
        headers: [
          { name: 'From', value: `sender${idx}@example.com` },
          { name: 'To', value: 'gmail-owner@example.test' },
          { name: 'Subject', value: 'Họp dự án ATI' },
          { name: 'Date', value: `Wed, 14 Oct 2026 09:0${idx % 10}:00 +0700` },
          { name: 'Message-ID', value: `<${id}@example.com>` },
        ],
        body: { data: Buffer.from(text).toString('base64url') },
      },
    };
  }

  beforeAll(async () => {
    google = await startFakeGoogleGmail({
      settings: { accessTokenPrefix: 'ya29.LOOPBACK-SENTINEL' },
    });
    db = await createMigratedSchema('gmail_live_loopback');
    credentials = new CredentialRepo(db.pool, KEY);
    client = new GmailOAuthClient({
      clientId: CLIENT_ID,
      clientSecret: 'fake-gmail-secret',
      redirectUri: 'http://127.0.0.1:5174/connections/gmail/callback',
      ...google.endpoints,
    });
  });

  afterAll(async () => {
    await google?.close();
    await db?.close();
  });

  beforeEach(async () => {
    Object.assign(google.settings, {
      refresh: 'ok',
      refreshDelayMs: 0,
      accessTokenTtlSeconds: 3600,
      apiResponses: [],
      threads: [
        {
          id: 'thread-7',
          messages: Array.from({ length: 7 }, (_, i) => makeMessage(`m-${i + 1}`, `Nội dung thư ${i + 1}`, i + 1)),
        },
        {
          id: 't1',
          messages: [makeMessage('m-t1', 'Thread 1', 1)],
        },
        {
          id: 't2',
          messages: [makeMessage('m-t2', 'Thread 2', 2)],
        },
        {
          id: 't3',
          messages: [makeMessage('m-t3', 'Thread 3', 3)],
        },
      ],
    });
    google.stats.refreshes = 0;
    google.stats.writes = 0;
    google.stats.apiRequests.length = 0;
    reconnects = [];
    owner = await db.person('Loopback Owner');
    refreshToken = google.mintRefreshToken();
    const row = await credentials.saveCredentials(
      'gmail',
      encryptCredentials(
        {
          refreshToken,
          email: 'gmail-owner@example.test',
          scopes: ['https://www.googleapis.com/auth/gmail.modify'],
          oauthClientId: CLIENT_ID,
          connectedAt: '2026-11-01T00:00:00.000Z',
        },
        KEY,
      ),
      owner.id,
    );
    credentialId = row.id;
  });

  it('refreshes an access token once over loopback HTTP and runs search_threads, get_thread windowing, and list_labels', async () => {
    const adapter = makeAdapter(createManager());

    const searched = await adapter.execute('gmail.search_threads', { query: 'Họp', limit: 5 });
    expect(Array.isArray(searched)).toBe(true);
    expect(searched.some((t: any) => t.id === 'thread-7')).toBe(true);

    const thread = await adapter.execute('gmail.get_thread', { threadId: 'thread-7' });
    expect(thread.id).toBe('thread-7');
    expect(thread.totalMessages).toBe(7);
    expect(thread.omittedMessages).toBe(2);
    expect(thread.messages).toHaveLength(5);
    expect(thread.messages[0]!.messageId).toBe('m-3');
    expect(thread.messages[4]!.messageId).toBe('m-7');

    const labels = await adapter.execute('gmail.list_labels', { query: '' });
    expect(labels.map((l: any) => l.id)).toContain('INBOX');

    // Only one /token refresh occurred across all real loopback HTTP calls
    expect(google.stats.refreshes).toBe(1);
    expect(google.stats.apiRequests.some((r) => r.path === 'threads/thread-7')).toBe(true);
  });

  it('recovers from a single 401 on gmail.send_message by force-refreshing via /token and retrying once', async () => {
    const adapter = makeAdapter(createManager());
    await adapter.execute('gmail.list_labels', { query: '' });
    expect(google.stats.refreshes).toBe(1);

    google.settings.apiResponses = [{ status: 401 }];
    const sent = await adapter.execute('gmail.send_message', {
      to: ['sender1@example.com'],
      subject: 'Xác nhận loopback',
      body: 'Gửi qua HTTP thật.',
    });

    expect(sent).toMatchObject({ id: expect.any(String), threadId: expect.any(String) });
    expect(google.stats.refreshes).toBe(2);
    expect(google.stats.apiRequests.filter((r) => r.path === 'messages/send')).toHaveLength(2);
  });

  it('fails closed with UNKNOWN and never resends t1 when gmail.batch_modify_threads hits 500 on t2', async () => {
    const adapter = makeAdapter(createManager());
    google.settings.apiResponses = [null as any, { status: 500 }];

    const err = await adapter
      .execute('gmail.batch_modify_threads', {
        threadIds: ['t1', 't2', 't3'],
        addLabelIds: ['STARRED'],
      })
      .catch((e) => e);

    expect(err).toMatchObject({
      category: 'UNKNOWN',
      details: {
        requestSent: true,
        completedThreadIds: ['t1'],
        failedThreadId: 't2',
      },
    });
    expect(google.stats.apiRequests.map((r) => r.path)).toEqual([
      'threads/t1/modify',
      'threads/t2/modify',
    ]);
    expect(google.stats.writes).toBe(2);
  });

  it('marks the PostgreSQL credential reconnect_required and rejects with AUTH_ERROR on invalid_grant refresh failure', async () => {
    const adapter = makeAdapter(createManager());
    google.settings.refresh = 'invalid_grant';

    const err = await adapter.execute('gmail.list_labels', { query: '' }).catch((e) => e);
    expect(err).toMatchObject({ category: 'AUTH_ERROR' });
    expect(reconnects).toEqual([owner.id]);

    const row = await credentials.getPersonalConnectionStatus('gmail', owner.id);
    expect(row?.status).toBe('reconnect_required');

    // Subsequent execution fails closed without issuing another /token refresh
    const refreshesAfterInvalidGrant = google.stats.refreshes;
    await expect(adapter.execute('gmail.list_labels', { query: '' })).rejects.toMatchObject({
      category: 'AUTH_ERROR',
    });
    expect(google.stats.refreshes).toBe(refreshesAfterInvalidGrant);
  });
});
