import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFakeGoogleGmail, type FakeGoogleGmail } from '../../../../scripts/fake-google-gmail.mjs';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { GmailOAuthClient } from '../../src/services/gmail/oauth-client.js';
import { GmailTokenManager } from '../../src/services/gmail/token-manager.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';

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

  it('forgets cached tokens of a person on clear()', async () => {
    const tokens = manager();
    const provider = tokens.forConnection(owner.id, credentialId, refreshToken);
    const first = await provider.getAccessToken();
    tokens.clear(owner.id);
    expect(await provider.getAccessToken()).not.toBe(first);
    expect(google.stats.refreshes).toBe(2);
  });

  it('never hands one credential the token cached for another', async () => {
    const tokens = manager();
    const first = await tokens.forConnection(owner.id, credentialId, refreshToken).getAccessToken();
    const other = await tokens.forConnection(owner.id, 'another-credential', google.mintRefreshToken()).getAccessToken();
    expect(other).not.toBe(first);
  });
});
