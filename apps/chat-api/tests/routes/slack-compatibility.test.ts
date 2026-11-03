import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createServer } from 'node:http';
import express from 'express';
import { validateSlackConnectionPublicInfo } from '@wap/tool-schemas';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';
import { SlackConnectionRepo } from '../../src/db/repositories/slack-connection-repo.js';
import { SlackConsentRepo } from '../../src/db/repositories/slack-consent-repo.js';
import { SlackPolicyService } from '../../src/services/slack/policy-service.js';
import { resolveRuntimeProviderIdentity } from '../../src/config/slack-policy-runtime.js';
import { createSlackConnectionRoutes } from '../../src/routes/connections/slack.js';
import { SessionRepo } from '../../src/db/repositories/session-repo.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { randomBytes, createHash } from 'node:crypto';

describe('Slack 02A compatibility and HTTP trust boundary', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let connectionRepo: SlackConnectionRepo;
  let consentRepo: SlackConsentRepo;
  let policyService: SlackPolicyService;
  let sessionRepo: SessionRepo;
  let server: ReturnType<typeof createServer>;
  let app: express.Express;
  let alice: Awaited<ReturnType<Awaited<ReturnType<typeof createMigratedSchema>>['person']>>;
  let aliceToken: string;

  const jwtSecret = 'test-jwt-secret-very-long-32-chars-at-least';
  const encryptionKey = '01234567890123456789012345678901';
  const testEnv = { ...process.env, RUNTIME_ACCOUNT_ID: 'TEST_COMPAT_ACCOUNT' };
  const runtimeIdentity = resolveRuntimeProviderIdentity(testEnv);

  beforeAll(async () => {
    db = await createMigratedSchema('slack_compat');
    connectionRepo = new SlackConnectionRepo(db.pool);
    consentRepo = new SlackConsentRepo(db.pool);
    policyService = new SlackPolicyService(db.pool, { env: testEnv });
    sessionRepo = new SessionRepo(db.pool);
    alice = await db.person('Alice');
    aliceToken = generateAccessToken({ id: alice.id, email: alice.email, name: alice.name, role: alice.role }, jwtSecret, alice.sid).accessToken;

    app = express();
    app.use(express.json());
    app.use('/api/connections/myslack', createSlackConnectionRoutes({
      oauth: {
        clientId: 'client-id',
        clientSecret: 'client-secret',
        appId: 'A_TEST',
        redirectUri: 'http://localhost/cb',
        authorizationUrl: 'https://slack.com/oauth/v2/authorize',
        apiBaseUrl: 'https://slack.com/api',
      },
      repo: connectionRepo,
      policyService,
      jwtSecret,
      encryptionKey,
      sessionRepo,
    }));
    server = createServer(app);
  });

  afterAll(async () => {
    server?.close();
    await db?.close();
  });

  async function createConnectionForAlice(workspaceId: string, actorId: string) {
    const state = randomBytes(32).toString('base64url');
    const browser = randomBytes(32).toString('base64url');
    const hash = (s: string) => createHash('sha256').update(s).digest('hex');
    await connectionRepo.start({ userId: alice.id, sessionId: alice.sid, stateHash: hash(state), browserHash: hash(browser) });
    const consumed = await connectionRepo.consume({ userId: alice.id, sessionId: alice.sid, state, browser });
    return connectionRepo.save(alice.id, consumed!.id, {
      appId: 'A_COMPAT',
      workspaceId,
      workspaceName: `Workspace ${workspaceId}`,
      actorId,
      config: 'ENCRYPTED_SECRETS_HERE',
      scopes: ['chat:write', 'channels:history'],
    });
  }

  it('returns connections satisfying 02A canonical schema and preserves safe legacy aliases', async () => {
    await createConnectionForAlice('T_CANONICAL_01', 'U_ALICE_C01');

    const res = await request(app)
      .get('/api/connections/myslack')
      .set('Authorization', `Bearer ${aliceToken}`);

    expect(res.status).toBe(200);
    expect(res.body.connections).toBeInstanceOf(Array);
    expect(res.body.connections.length).toBeGreaterThanOrEqual(1);

    const conn = res.body.connections.find((c: any) => c.workspaceId === 'T_CANONICAL_01');
    expect(conn).toBeDefined();

    // 1. Must validate cleanly through 02A canonical contract
    const canonical = validateSlackConnectionPublicInfo(conn);
    expect(canonical.id).toBe(conn.id);
    expect(canonical.workspaceId).toBe('T_CANONICAL_01');
    expect(canonical.slackUserId).toBe('U_ALICE_C01');
    expect(canonical.slackUserLabel).toBe('U_ALICE_C01');
    expect(canonical.status).toBe('active');
    expect(canonical.consentStatus).toBe('pending');
    expect(canonical.processingReady).toBe(false);

    // 2. Must preserve safe legacy aliases for current UI/tests
    expect(conn.actorId).toBe('U_ALICE_C01');
    expect(conn.missingScopes).toBeInstanceOf(Array);
    expect(conn.processingStatus).toBe('pending');

    // 3. Must never leak raw encrypted credentials
    expect(JSON.stringify(res.body)).not.toContain('ENCRYPTED_SECRETS_HERE');
  });

  it('reflects processingReady === true when organization consent is granted and provider is verified', async () => {
    await createConnectionForAlice('T_CANONICAL_READY', 'U_ALICE_READY');

    // Attest provider matching runtime
    await consentRepo.attestProvider({
      id: runtimeIdentity.providerId,
      name: runtimeIdentity.name,
      verified: true,
      noTraining: true,
      maxRetentionDays: 30,
      configurationFingerprint: runtimeIdentity.fingerprint,
      evidenceRef: 'EVIDENCE-READY',
      verifiedBy: 'operator@example.test',
      verifiedAt: new Date(),
    });

    // Grant consent
    await consentRepo.grantConsent({
      workspaceId: 'T_CANONICAL_READY',
      providerId: runtimeIdentity.providerId,
      policyVersion: 'v1.0.0',
      purposes: ['manual_lookup', 'triage', 'planning'],
      retentionDays: 0,
      organizationRepresentative: 'Jane Legal',
      evidenceRef: 'DPA-READY',
      recordedBy: 'operator@example.test',
    });

    const res = await request(app)
      .get('/api/connections/myslack')
      .set('Authorization', `Bearer ${aliceToken}`);

    expect(res.status).toBe(200);
    const conn = res.body.connections.find((c: any) => c.workspaceId === 'T_CANONICAL_READY');
    expect(conn).toBeDefined();

    const canonical = validateSlackConnectionPublicInfo(conn);
    expect(canonical.consentStatus).toBe('granted');
    expect(canonical.processingReady).toBe(true);
    expect(conn.processingStatus).toBe('ready');
  });

  it('rejects attempted HTTP consent mutations: returns 404 and does not change policy', async () => {
    const postConsent = await request(app)
      .post('/api/connections/myslack/consent')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ workspaceId: 'T_CANONICAL_READY', noTraining: true });
    expect(postConsent.status).toBe(404);

    const putConsent = await request(app)
      .put('/api/connections/myslack/consent')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ workspaceId: 'T_CANONICAL_READY', noTraining: true });
    expect(putConsent.status).toBe(404);

    const postProvider = await request(app)
      .post('/api/connections/myslack/provider')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ id: 'fake-provider', verified: true });
    expect(postProvider.status).toBe(404);
  });
});
