import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFakeGoogleGmail, type FakeGoogleGmail } from '../../../../scripts/fake-google-gmail.mjs';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { GmailOAuthClient } from '../../src/services/gmail/oauth-client.js';
import { GmailTokenManager } from '../../src/services/gmail/token-manager.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';
import { encryptCredentials } from '@wap/tool-adapters';
import { AdapterFactory } from '../../src/services/adapter-factory.js';

describe('GmailTokenManager with the fake Google token endpoint and PostgreSQL', () => {
  let google: FakeGoogleGmail, db: Awaited<ReturnType<typeof createMigratedSchema>>, credentials: CredentialRepo, client: GmailOAuthClient;
  let now: number, reconnects: string[], owner: { id: string }, credentialId: string, refreshToken: string;
  const manager = (extra: Partial<ConstructorParameters<typeof GmailTokenManager>[0]> = {}) => new GmailTokenManager({
    client, credentials, clock: () => now, onReconnectRequired: (userId) => reconnects.push(userId), ...extra });
  const status = async () => (await credentials.getPersonalConnectionStatus('gmail', owner.id))?.status;

  beforeAll(async () => {
    google = await startFakeGoogleGmail();
    db = await createMigratedSchema('gmail_tokens');
    credentials = new CredentialRepo(db.pool);
    client = new GmailOAuthClient({ clientId: 'gmail-test.apps.googleusercontent.com', clientSecret: 'fake-gmail-secret',
      redirectUri: 'http://127.0.0.1:5174/connections/gmail/callback', ...google.endpoints });
  });
  beforeEach(async () => {
    Object.assign(google.settings, { refresh: 'ok', refreshDelayMs: 0, accessTokenTtlSeconds: 3600 });
    google.stats.refreshes = 0;
    now = Date.now(); reconnects = [];
    owner = await db.person();
    refreshToken = google.mintRefreshToken();
    credentialId = (await credentials.saveCredentials('gmail', 'v1:encrypted', owner.id)).id;
  });
  afterAll(async () => { await google?.close(); await db?.close(); });

  it('shares one refresh between concurrent callers of the same person', async () => {
    google.settings.refreshDelayMs = 100;
    const tokens = manager().forConnection(owner.id, credentialId, refreshToken);
    const [a, b] = await Promise.all([tokens.getAccessToken(), tokens.getAccessToken()]);
    expect(a).toBe(b);
    expect(google.stats.refreshes).toBe(1);
  });

  it('reuses the token until less than 60 s remain, and refreshes on forceRefresh', async () => {
    const tokens = manager().forConnection(owner.id, credentialId, refreshToken);
    const first = await tokens.getAccessToken();
    expect(await tokens.getAccessToken()).toBe(first);
    now += 3600_000 - 61_000;
    expect(await tokens.getAccessToken()).toBe(first);
    now += 2_000;
    const second = await tokens.getAccessToken();
    expect(second).not.toBe(first);
    expect(google.stats.refreshes).toBe(2);
    expect(await tokens.getAccessToken({ forceRefresh: true })).not.toBe(second);
    expect(google.stats.refreshes).toBe(3);
  });

  it("lets one caller give up without cancelling the shared refresh another caller waits on", async () => {
    google.settings.refreshDelayMs = 200;
    const tokens = manager().forConnection(owner.id, credentialId, refreshToken);
    const caller = new AbortController();
    const abandoned = tokens.getAccessToken({ signal: caller.signal });
    const patient = tokens.getAccessToken();
    setTimeout(() => caller.abort(), 20);
    await expect(abandoned).rejects.toMatchObject({ category: 'NETWORK' });
    await expect(patient).resolves.toMatch(/^ya29\.fake-/);
    expect(google.stats.refreshes).toBe(1);
  });

  it('marks only this credential reconnect_required on invalid_grant and reports AUTH_ERROR', async () => {
    google.settings.refresh = 'invalid_grant';
    const error = await manager().forConnection(owner.id, credentialId, refreshToken).getAccessToken().catch((e) => e);
    expect(error).toMatchObject({ category: 'AUTH_ERROR' });
    expect(String(error.message)).not.toContain(refreshToken);
    expect(await status()).toBe('reconnect_required');
    expect(reconnects).toEqual([owner.id]);
  });

  it('reports a 5xx refresh as SERVER_ERROR and leaves the connection active', async () => {
    google.settings.refresh = 'server_error';
    const error = await manager().forConnection(owner.id, credentialId, refreshToken).getAccessToken().catch((e) => e);
    expect(error).toMatchObject({ category: 'SERVER_ERROR' });
    expect(String(error.message)).not.toContain(refreshToken);
    expect(await status()).toBe('active');
    expect(reconnects).toEqual([]);
  });

  it('gives a hanging refresh its own deadline: NETWORK, connection still active', async () => {
    google.settings.refresh = 'hang';
    const started = Date.now();
    const error = await manager({ refreshTimeoutMs: 150 }).forConnection(owner.id, credentialId, refreshToken).getAccessToken().catch((e) => e);
    expect(error).toMatchObject({ category: 'NETWORK' });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(await status()).toBe('active');
  });

  it('invalidates a retained provider on clear(), while a newly issued provider can refresh', async () => {
    const tokens = manager();
    const provider = tokens.forConnection(owner.id, credentialId, refreshToken);
    const first = await provider.getAccessToken();
    tokens.clear(owner.id);
    await expect(provider.getAccessToken()).rejects.toMatchObject({ category: 'AUTH_ERROR' });
    expect(await tokens.forConnection(owner.id, credentialId, refreshToken).getAccessToken()).not.toBe(first);
    expect(google.stats.refreshes).toBe(2);
  });

  it('rejects a late HTTP refresh after clear()', async () => {
    google.settings.refreshDelayMs = 150;
    const tokens = manager();
    const provider = tokens.forConnection(owner.id, credentialId, refreshToken);
    const pending = provider.getAccessToken().catch(e => e);
    await expect.poll(() => google.stats.refreshes).toBe(1);
    tokens.clear(owner.id);
    expect(await pending).toMatchObject({ category: 'AUTH_ERROR' });
    await expect(provider.getAccessToken()).rejects.toMatchObject({ category: 'AUTH_ERROR' });
    expect(google.stats.refreshes).toBe(1);
  });

  const key = 'a'.repeat(32);
  const liveId = '111111111111-mail.apps.googleusercontent.com';
  async function bind(origin: string | undefined) {
    const saved = await credentials.saveCredentials('gmail', encryptCredentials({ refreshToken, ...(origin ? { oauthClientId: origin } : {}) }, key), owner.id);
    credentialId = saved.id;
    return manager({ clientId: liveId, encryptionKey: key });
  }

  it.each([undefined, '222222222222-old.apps.googleusercontent.com'])('blocks legacy or changed origin %s before native HTTP refresh', async (origin) => {
    const tokens = await bind(origin);
    await expect(tokens.forConnection(owner.id, credentialId, refreshToken).getAccessToken()).rejects.toMatchObject({ category: 'AUTH_ERROR' });
    expect(google.stats.refreshes).toBe(0);
    expect(await status()).toBe('reconnect_required');
  });

  it('blocks cached tokens and freshly constructed providers after an external SQL delete', async () => {
    const tokens = await bind(liveId);
    const provider = tokens.forConnection(owner.id, credentialId, refreshToken);
    await provider.getAccessToken();
    await db.pool.query('DELETE FROM service_credentials WHERE id=$1', [credentialId]);
    await expect(provider.getAccessToken()).rejects.toMatchObject({ category: 'AUTH_ERROR' });
    await expect(tokens.forConnection(owner.id, credentialId, refreshToken).getAccessToken()).rejects.toMatchObject({ category: 'AUTH_ERROR' });
    expect(google.stats.refreshes).toBe(1);
  });

  it('does not return a late HTTP result after the credential was deleted in PostgreSQL', async () => {
    const tokens = await bind(liveId);
    google.settings.refreshDelayMs = 150;
    const pending = tokens.forConnection(owner.id, credentialId, refreshToken).getAccessToken().catch(e => e);
    await expect.poll(() => google.stats.refreshes).toBe(1);
    await db.pool.query('DELETE FROM service_credentials WHERE id=$1', [credentialId]);
    expect(await pending).toMatchObject({ category: 'AUTH_ERROR' });
  });

  it.each(['clearPersonal', 'clearCache'] as const)('%s for Gmail preserves a peer Calendar provider and its pending HTTP refresh', async (method) => {
    const mail = manager();
    const calendar = manager({ service: 'mycalendar', client: new GmailOAuthClient({ clientId: 'mycalendar-test.apps.googleusercontent.com',
      clientSecret: 'fake-mycalendar-secret', redirectUri: 'http://127.0.0.1:5174/connections/mycalendar/callback', ...google.endpoints }) });
    const factory = new AdapterFactory({ credentialRepo: credentials, encryptionKey: key, gmailTokens: mail, mycalendarTokens: calendar });
    const mailProvider = mail.forConnection(owner.id, credentialId, refreshToken);
    await mailProvider.getAccessToken();
    const peerRow = await credentials.saveCredentials('mycalendar', 'fixture', owner.id);
    const peerToken = google.mintRefreshToken(undefined, undefined, 'mycalendar-test.apps.googleusercontent.com');
    const peer = calendar.forConnection(owner.id, peerRow.id, peerToken);
    google.settings.refreshDelayMs = 150;
    const before = google.stats.refreshes;
    const pending = peer.getAccessToken().catch(e => e);
    await expect.poll(() => google.stats.refreshes).toBe(before + 1);
    if (method === 'clearPersonal') factory.clearPersonal(owner.id, 'gmail');
    else factory.clearCache('gmail', null, owner.id);
    expect(await pending).toMatch(/^ya29\.fake-/);
    await expect(peer.getAccessToken()).resolves.toMatch(/^ya29\.fake-/);
    await expect(mailProvider.getAccessToken()).rejects.toMatchObject({ category: 'AUTH_ERROR' });
    expect((await credentials.getPersonalConnectionStatus('mycalendar', owner.id))?.status).toBe('active');
  });

  it('does not invalidate a new connection when an old HTTP invalid_grant arrives after replacement', async () => {
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const arrived = new Promise<void>(resolve => { entered = resolve; });
    google.settings.refresh = 'invalid_grant';
    const delayedClient = new GmailOAuthClient({ clientId: 'gmail-test.apps.googleusercontent.com', clientSecret: 'fake-gmail-secret',
      redirectUri: 'http://127.0.0.1:5174/connections/gmail/callback', ...google.endpoints }, async (input, init) => {
      const response = await fetch(input, init);
      entered(); await gate; return response;
    });
    const tokens = manager({ client: delayedClient });
    const old = tokens.forConnection(owner.id, credentialId, refreshToken).getAccessToken().catch(e => e);
    try {
      await arrived;
      const fresh = await credentials.saveCredentials('gmail', 'v1:new', owner.id);
      release();
      expect(await old).toMatchObject({ category: 'AUTH_ERROR' });
      expect((await credentials.getPersonalConnectionStatus('gmail', owner.id))?.id).toBe(fresh.id);
      expect(await status()).toBe('active');
      expect(reconnects).toEqual([]);
    } finally { release(); await old; }
  });

  it('honors cancellation while a cached-token origin read is queued for a PostgreSQL connection', async () => {
    const tokens = await bind(liveId);
    const provider = tokens.forConnection(owner.id, credentialId, refreshToken);
    await provider.getAccessToken();
    const held = await Promise.all(Array.from({ length: 12 }, () => db.pool.connect()));
    const caller = new AbortController();
    const pending = provider.getAccessToken({ signal: caller.signal }).catch(e => e);
    try {
      await expect.poll(() => db.pool.waitingCount).toBe(1);
      caller.abort();
      const outcome = await Promise.race([pending, new Promise(resolve => setTimeout(() => resolve('still waiting for DB'), 150))]);
      expect(outcome).toMatchObject({ category: 'NETWORK' });
    } finally { held.forEach(client => client.release()); }
    expect(await pending).toMatchObject({ category: 'NETWORK' });
    expect(google.stats.refreshes).toBe(1);
  });

  it('never hands one credential the token cached for another', async () => {
    const tokens = manager();
    const first = await tokens.forConnection(owner.id, credentialId, refreshToken).getAccessToken();
    const other = await tokens.forConnection(owner.id, 'another-credential', google.mintRefreshToken()).getAccessToken();
    expect(other).not.toBe(first);
  });
});
