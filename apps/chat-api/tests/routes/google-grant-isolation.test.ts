import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { decryptCredentials, encryptCredentials } from '@wap/tool-adapters';
import { startFakeGoogleGmail, type FakeGoogleGmail } from '../../../../scripts/fake-google-gmail.mjs';
import { createApp, type AppOptions } from '../../src/app.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { GmailConnectionRepo } from '../../src/db/repositories/gmail-connection-repo.js';
import { GmailOAuthClient } from '../../src/services/gmail/oauth-client.js';
import { GmailTokenManager } from '../../src/services/gmail/token-manager.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';

const secret = 'google-isolation-test-secret-at-least-32';
const key = 'a'.repeat(32);
const ids = { gmail: '111111111111-mail.apps.googleusercontent.com', mycalendar: '222222222222-calendar.apps.googleusercontent.com', mysheets: '333333333333-sheets.apps.googleusercontent.com' };
type Service = keyof typeof ids;
type Person = Awaited<ReturnType<Awaited<ReturnType<typeof createMigratedSchema>>['person']>>;
let google: FakeGoogleGmail, db: Awaited<ReturnType<typeof createMigratedSchema>>, credentials: CredentialRepo;
const oauth = (service: Service) => ({ clientId: ids[service], clientSecret: 'fake-gmail-secret',
  redirectUri: `http://127.0.0.1:5174/connections/${service}/callback`, ...google.endpoints });
const bearer = (who: Person) => `Bearer ${generateAccessToken(who, secret, who.sid).accessToken}`;
const build = (service: Service, fetchFn?: typeof fetch, extra: Partial<AppOptions> = {}) => createApp({ jwtSecret: secret, runtimeMode: 'live',
  userRepo: db.users, credentialRepo: credentials, encryptionKey: key,
  [service]: { enabled: true, repo: new GmailConnectionRepo(db.pool, service), oauth: oauth(service), fetchFn,
    revokeTimeoutMs: 2000, driveApiBaseUrl: google.origin, picker: { apiKey: 'fixture', appId: '333333333333' } }, ...extra });
async function save(service: Service, owner: Person, origin: string | undefined, refreshToken?: string) {
  const token = refreshToken ?? google.mintRefreshToken('owner@example.test', undefined, ids[service]);
  const row = await credentials.saveCredentials(service, encryptCredentials({ refreshToken: token, email: 'owner@example.test',
    ...(origin ? { oauthClientId: origin } : {}), selectedCalendars: [{ id: 'primary' }], selectedSpreadsheets: [{ id: 'sheet' }], connectedAt: new Date().toISOString() }, key), owner.id);
  return { row, token };
}
beforeAll(async () => {
  google = await startFakeGoogleGmail({ clientIds: Object.values(ids), clientProjects: Object.fromEntries(Object.entries(ids).map(([service, id]) => [id, service])),
    redirectUris: Object.keys(ids).map(s => `http://127.0.0.1:5174/connections/${s}/callback`) });
  db = await createMigratedSchema('google_isolation'); credentials = new CredentialRepo(db.pool);
});
afterAll(async () => { await google?.close(); await db?.close(); });

describe.each(Object.keys(ids) as Service[])('%s grant origin migration', (service) => {
  it.each([undefined, '444444444444-old.apps.googleusercontent.com'])('removes origin %s locally without revoking a still-needed project grant', async (origin) => {
    const owner = await db.person();
    const { token } = await save(service, owner, origin);
    const before = google.stats.revocations;
    expect((await request(build(service)).delete(`/api/connections/${service}`).set('Authorization', bearer(owner))).status).toBe(200);
    expect(await credentials.getPersonalConnectionStatus(service, owner.id)).toBeNull();
    expect(google.stats.revocations).toBe(before);
    await expect(new GmailOAuthClient(oauth(service)).refresh(token, AbortSignal.timeout(2000))).resolves.toHaveProperty('accessToken');
  });
  it('revokes a bound grant with no possible peer', async () => {
    const owner = await db.person(); const { token } = await save(service, owner, ids[service]);
    expect((await request(build(service)).delete(`/api/connections/${service}`).set('Authorization', bearer(owner))).status).toBe(200);
    expect(google.isRevoked(token)).toBe(true);
  });
  it('revokes a bound grant while a peer on a verified separate fixture project still refreshes', async () => {
    const owner = await db.person(); const { token } = await save(service, owner, ids[service]);
    const peer = service === 'gmail' ? 'mycalendar' : 'gmail'; const peerGrant = await save(peer, owner, ids[peer]);
    expect((await request(build(service)).delete(`/api/connections/${service}`).set('Authorization', bearer(owner))).status).toBe(200);
    expect(google.isRevoked(token)).toBe(true);
    await expect(new GmailOAuthClient(oauth(peer)).refresh(peerGrant.token, AbortSignal.timeout(2000))).resolves.toHaveProperty('accessToken');
  });
  it.each([undefined, ids[service].replace(/-[^.]+/, '-peer')])('preserves unknown or shared-project peer origin %s even with the peer service disabled', async origin => {
    const owner = await db.person(); const { token } = await save(service, owner, ids[service]);
    const peer = service === 'gmail' ? 'mycalendar' : 'gmail';
    const peerGrant = await save(peer, owner, origin);
    const before = google.stats.revocations;
    expect((await request(build(service)).delete(`/api/connections/${service}`).set('Authorization', bearer(owner))).status).toBe(200);
    expect(google.stats.revocations).toBe(before);
    expect(google.isRevoked(token)).toBe(false);
    expect(await credentials.getPersonalConnectionStatus(peer, owner.id)).not.toBeNull();
    await expect(new GmailOAuthClient(oauth(peer)).refresh(peerGrant.token, AbortSignal.timeout(2000))).resolves.toHaveProperty('accessToken');
  });
  it('reports legacy grants as reconnect_required before exposing selected resources', async () => {
    const owner = await db.person(); await save(service, owner, undefined);
    const before = google.stats.refreshes;
    const app = build(service);
    if (service !== 'gmail') {
      const response = await request(app).get(`/api/connections/${service}/${service === 'mycalendar' ? 'calendars' : 'spreadsheets'}`).set('Authorization', bearer(owner));
      expect(response.status).toBe(409);
    }
    const response = await request(app).get('/api/services').set('Authorization', bearer(owner));
    const item = response.body.services.find((s: { id: string }) => s.id === service);
    expect(item.personalStatus).toBe('reconnect_required');
    expect(item.connected).toBe(false);
    expect(google.stats.refreshes).toBe(before);
    expect((await credentials.getPersonalConnectionStatus(service, owner.id))?.status).toBe('reconnect_required');
  });
  it.each([undefined, ids[service].replace(/-[^.]+/, '-peer')])('preserves peer origin %s when email metadata changed on the same Google account', async origin => {
    const owner = await db.person(); const { token } = await save(service, owner, ids[service]);
    const peer = service === 'gmail' ? 'mycalendar' : 'gmail';
    const peerGrant = await save(peer, owner, origin);
    const oldConfig = decryptCredentials(peerGrant.row.config, key);
    await db.pool.query('UPDATE service_credentials SET config=$1 WHERE id=$2', [encryptCredentials({ ...oldConfig, email: 'old-account-name@example.test' }, key), peerGrant.row.id]);
    const before = google.stats.revocations;
    expect((await request(build(service)).delete(`/api/connections/${service}`).set('Authorization', bearer(owner))).status).toBe(200);
    expect(google.stats.revocations).toBe(before);
    expect(google.isRevoked(token)).toBe(false);
    await expect(new GmailOAuthClient(oauth(peer)).refresh(peerGrant.token, AbortSignal.timeout(2000))).resolves.toHaveProperty('accessToken');
  });
  it('records the issuing OAuth client on a fresh callback', async () => {
    const owner = await db.person(); const app = build(service);
    google.settings.grantedScopes = [service === 'gmail' ? 'https://www.googleapis.com/auth/gmail.modify' : service === 'mycalendar' ? 'https://www.googleapis.com/auth/calendar.events' : 'https://www.googleapis.com/auth/drive.file', ...(service === 'mycalendar' ? ['https://www.googleapis.com/auth/calendar.readonly'] : [])];
    const started = await request(app).post(`/api/connections/${service}/start`).set('Authorization', bearer(owner));
    expect(started.status).toBe(200);
    const authorized = await fetch(started.body.url, { redirect: 'manual' });
    const url = new URL(authorized.headers.get('location')!);
    const callback = await request(app).post(`/api/connections/${service}/callback`).set('Authorization', bearer(owner))
      .set('Cookie', (started.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!).send({ code: url.searchParams.get('code'), state: url.searchParams.get('state') });
    expect(callback.status).toBe(200);
    const row = await credentials.getPersonalConnectionStatus(service, owner.id);
    expect(decryptCredentials(row!.config, key).oauthClientId).toBe(ids[service]);
  });
});

it('holds a real PostgreSQL user lock through native HTTP revoke so a new flow starts only afterwards', async () => {
  const owner = await db.person(); await save('gmail', owner, ids.gmail);
  let release!: () => void, entered!: () => void;
  const arrived = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const app = build('gmail', async (input, init) => {
    const response = await fetch(input, init);
    if (String(input) === google.endpoints.revokeUrl) { entered(); await gate; }
    return response;
  });
  const removing = request(app).delete('/api/connections/gmail').set('Authorization', bearer(owner)).then(r => r);
  let starting: Promise<request.Response> | undefined;
  try {
    await arrived;
    starting = request(app).post('/api/connections/gmail/start').set('Authorization', bearer(owner)).then(r => r);
    await expect.poll(async () => (await db.pool.query("SELECT pid FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'INSERT INTO oauth_states(state_hash,%'")).rows.length, { timeout: 1200 }).toBeGreaterThan(0);
  } finally {
    release();
    expect((await removing).status).toBe(200);
    if (starting) expect((await starting).status).toBe(200);
  }
});

it.each(['mycalendar', 'mysheets'] as const)('a %s scope change cancels an old refresh without marking the active grant lost', async service => {
  const owner = await db.person(); const grant = await save(service, owner, ids[service]);
  const tokens = new GmailTokenManager({ client: new GmailOAuthClient(oauth(service)), credentials, service, clientId: ids[service], encryptionKey: key });
  const app = build(service, undefined, service === 'mycalendar' ? { mycalendarTokens: tokens } : { mysheetsTokens: tokens });
  const before = google.stats.refreshes;
  google.settings.refreshDelayMs = 150;
  const pending = (service === 'mycalendar' ? request(app).get('/api/connections/mycalendar/calendars') : request(app).post('/api/connections/mysheets/picker-session'))
    .set('Authorization', bearer(owner)).then(r => r);
  try {
    await expect.poll(() => google.stats.refreshes).toBe(before + 1);
    await new GmailConnectionRepo(db.pool, service).updateConfigIfActive(owner.id, grant.row.id, old => old);
    tokens.clear(owner.id);
    expect((await pending).status).toBe(409);
    expect((await credentials.getPersonalConnectionStatus(service, owner.id))?.status).toBe('active');
  } finally { await pending; google.settings.refreshDelayMs = 0; }
});
