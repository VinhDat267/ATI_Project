import { createHash, createHmac, randomUUID } from 'node:crypto';
import http from 'node:http';
import { once } from 'node:events';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';
import { createApp } from '../../src/app.js';
import { encryptCredentials } from '@wap/tool-adapters';
import { SlackConnectionRepo } from '../../src/db/repositories/slack-connection-repo.js';
import { SlackTokenManager } from '../../src/services/slack/token-manager.js';
import { SlackOAuthClient } from '../../src/services/slack/oauth-client.js';
import { slackIngressEnv } from '../../src/config/slack-ingress-env.js';
import {
  SlackEventReceiptRepo,
  slackMessageResourceId,
} from '../../src/db/repositories/slack-event-receipt-repo.js';
import { SlackInvalidationService } from '../../src/services/slack/slack-invalidation-service.js';
import {
  SlackIngressService,
  type SlackIngressRuntimeConfig,
} from '../../src/services/slack/slack-ingress-service.js';

const SECRET = 'lifecycle-test-signing-secret';
const APP_ID = 'A04ALIFE';
const TEAM_ID = 'T04ALIFE';
const NOW_SECONDS = 1_730_220_000;
const NOW_MS = NOW_SECONDS * 1000 + 500;
const SOURCE_TS = '1730220000.000100';
const SOURCE_ISO = '2024-10-29T16:40:00.000100Z';

const config: SlackIngressRuntimeConfig = { signingSecret: SECRET, appId: APP_ID, automationEnabled: true };

function sha(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sign(body: unknown) {
  const raw = Buffer.from(JSON.stringify(body), 'utf8');
  const timestampHeader = String(NOW_SECONDS);
  const signatureHeader = `v0=${createHmac('sha256', SECRET)
    .update(`v0:${timestampHeader}:`)
    .update(raw)
    .digest('hex')}`;
  return { raw, timestampHeader, signatureHeader };
}

function eventId(): string {
  return `Ev${randomUUID().replaceAll('-', '')}`;
}

function eventCallback(event: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return {
    token: 'verification-token',
    team_id: TEAM_ID,
    api_app_id: APP_ID,
    type: 'event_callback',
    event_id: eventId(),
    event_time: NOW_SECONDS,
    event_context: 'connect',
    event,
    ...overrides,
  };
}

function tokensRevoked(slackUserIds: string[], overrides: Record<string, unknown> = {}) {
  return eventCallback(
    { type: 'tokens_revoked', tokens: { oauth: slackUserIds }, event_ts: SOURCE_TS },
    overrides
  );
}

function messageDeleted(channel: string, deletedTs: string) {
  return eventCallback({
    type: 'message',
    subtype: 'message_deleted',
    hidden: true,
    channel,
    ts: deletedTs,
    deleted_ts: deletedTs,
    event_ts: SOURCE_TS,
  });
}

function messageChanged(channel: string, messageTs: string, editTs: string, text: string) {
  return eventCallback({
    type: 'message',
    subtype: 'message_changed',
    channel,
    ts: editTs,
    event_ts: SOURCE_TS,
    message: { type: 'message', user: 'U_LIFE', text, ts: messageTs, edited: { user: 'U_LIFE', ts: editTs } },
    previous_message: { type: 'message', user: 'U_LIFE', text: `OLD_${text}`, ts: messageTs },
  });
}

interface SignedResponse {
  status: number;
  body: Record<string, unknown>;
}

function postSigned(url: URL, body: unknown): Promise<SignedResponse> {
  const signed = sign(body);
  return new Promise(resolve => {
    let settled = false;
    let status = 0;
    const chunks: Buffer[] = [];
    const finish = () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString('utf8');
      resolve({ status, body: raw ? JSON.parse(raw) : {} });
    };
    const req = http.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(signed.raw.length),
          'X-Slack-Request-Timestamp': signed.timestampHeader,
          'X-Slack-Signature': signed.signatureHeader,
        },
      },
      res => {
        status = res.statusCode ?? 0;
        res.on('data', chunk => chunks.push(Buffer.from(chunk)));
        res.on('end', finish);
        res.on('close', finish);
      }
    );
    req.on('error', () => {
      if (status === 0) finish();
    });
    req.end(signed.raw);
  });
}

describe('POST /api/slack/events lifecycle integration (SLACK-04A)', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let invalidation: SlackInvalidationService;
  let repo: SlackEventReceiptRepo;
  let service: SlackIngressService;
  let url: URL;
  let offUrl: URL;
  let unconfiguredUrl: URL;
  const servers: http.Server[] = [];

  async function startApp(ingress: SlackIngressService): Promise<URL> {
    const app = createApp({ jwtSecret: 'lifecycle-test-jwt-secret', slackIngress: { service: ingress } });
    const server = app.listen(0, '127.0.0.1');
    servers.push(server);
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not bind');
    return new URL(`http://127.0.0.1:${address.port}/api/slack/events`);
  }

  async function seedConnection(
    options: {
      workspaceId?: string;
      actorId: string;
      identityVersion?: number;
      config?: string;
    }
  ) {
    const person = await db.person('Thành viên lifecycle');
    const connectionId = randomUUID();
    const workspaceId = options.workspaceId ?? TEAM_ID;
    const identityVersion = options.identityVersion ?? 1;
    const connectionConfig = options.config ?? `ENC_CONFIG_${randomUUID()}`;
    await db.pool.query(
      `INSERT INTO slack_connections (
         id, user_id, app_id, workspace_id, workspace_name, actor_id,
         identity_version, status, config, scopes, connected_at, last_state_order
       ) VALUES ($1, $2, $3, $4, '04A Lifecycle', $5, $6, 'active', $7,
                 ARRAY['channels:history'], now(), '0001')`,
      [connectionId, person.id, APP_ID, workspaceId, options.actorId, identityVersion, connectionConfig]
    );
    return { person, connectionId, workspaceId, actorId: options.actorId, identityVersion, config: connectionConfig };
  }

  beforeAll(async () => {
    db = await createMigratedSchema('slack_events_lifecycle');
    invalidation = new SlackInvalidationService(db.pool);
    repo = new SlackEventReceiptRepo(db.pool, invalidation);
    service = new SlackIngressService({ config, repo, clock: () => NOW_MS });
    url = await startApp(service);
    offUrl = await startApp(
      new SlackIngressService({ config: slackIngressEnv({
        MYSLACK_ENABLED: 'off', MYSLACK_AUTOMATION_ENABLED: 'off',
        SLACK_SIGNING_SECRET: SECRET, MYSLACK_APP_ID: APP_ID,
      }, true), repo, clock: () => NOW_MS })
    );
    unconfiguredUrl = await startApp(new SlackIngressService({ config: undefined, repo, clock: () => NOW_MS }));
  });

  afterAll(async () => {
    for (const server of servers) {
      server.closeAllConnections?.();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
    await db?.close();
  });

  async function receiptsFor(eventIdValue: string) {
    const result = await db.pool.query(
      'SELECT * FROM slack_event_receipts WHERE slack_app_id = $1 AND event_id = $2',
      [APP_ID, eventIdValue]
    );
    return result.rows;
  }

  it('T6.1: tokens_revoked commits one provisional barrier and intent per binding before the 200', async () => {
    const a = await seedConnection({ actorId: 'U_LIFE_A' });
    const b = await seedConnection({ actorId: 'U_LIFE_B' });
    const body = tokensRevoked(['U_LIFE_A', 'U_LIFE_B']);

    const res = await postSigned(url, body);
    expect(res).toEqual({ status: 200, body: { ok: true } });

    const receipts = await receiptsFor(body.event_id);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      status: 'pending_lifecycle',
      team_id: TEAM_ID,
      event_type: 'tokens_revoked',
      source_event_ts: SOURCE_TS,
      event_context: 'connect',
    });
    expect((receipts[0]?.source_event_time as Date).toISOString()).toBe('2024-10-29T16:40:00.000Z');

    const sourceEventKey = `slack:${APP_ID}:${body.event_id}`;
    const barriers = await db.pool.query(
      `SELECT barrier_type, provisional, provisional_action, active, reason, user_id,
              connection_id, identity_version, credential_fingerprint
       FROM slack_invalidation_barriers WHERE source_event_key = $1 ORDER BY connection_id`,
      [sourceEventKey]
    );
    expect(barriers.rowCount).toBe(2);
    for (const row of barriers.rows) {
      expect(row).toMatchObject({
        barrier_type: 'provisional_auth',
        provisional: true,
        provisional_action: 'token_revocation_validation',
        active: true,
        reason: 'token_revoked',
        identity_version: 1,
      });
    }
    const fingerprints = new Map(barriers.rows.map(row => [row.user_id, row.credential_fingerprint]));
    expect(fingerprints.get(a.person.id)).toBe(sha(a.config));
    expect(fingerprints.get(b.person.id)).toBe(sha(b.config));

    const intents = await db.pool.query<{ effect_key: string; intent_type: string; payload_json: any; status: string }>(
      'SELECT effect_key, intent_type, payload_json, status FROM slack_lifecycle_intents WHERE receipt_id = $1 ORDER BY effect_key',
      [receipts[0]?.id]
    );
    expect(intents.rowCount).toBe(2);
    for (const intent of intents.rows) {
      expect(intent.intent_type).toBe('token_revocation_validation');
      expect(intent.status).toBe('pending');
      expect(intent.payload_json.sourceEventTime).toBe(SOURCE_ISO);
      expect(intent.payload_json.credentialFingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(intent.payload_json.binding.identityVersion).toBe(1);
    }

    const connections = await db.pool.query<{ id: string; status: string; config: string; identity_version: number }>(
      'SELECT id, status, config, identity_version FROM slack_connections WHERE id = ANY($1) ORDER BY id',
      [[a.connectionId, b.connectionId]]
    );
    for (const row of connections.rows) {
      expect(row.status).toBe('reconnect_required');
      expect(row.identity_version).toBe(1);
      expect(row.config).toBe(row.id === a.connectionId ? a.config : b.config);
    }

    // Provisional auth barriers carry no destructive purge work; the probe belongs to 04B.
    const purgeIntents = await db.pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM slack_invalidation_intents WHERE source_event_key = $1',
      [sourceEventKey]
    );
    expect(purgeIntents.rows[0]?.n).toBe('0');

    const duplicate = await postSigned(url, body);
    expect(duplicate).toEqual({ status: 200, body: { ok: true } });
    expect(await receiptsFor(body.event_id)).toHaveLength(1);
    const barrierCount = await db.pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM slack_invalidation_barriers WHERE source_event_key = $1',
      [sourceEventKey]
    );
    expect(barrierCount.rows[0]?.n).toBe('2');
    const intentCount = await db.pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM slack_lifecycle_intents WHERE receipt_id = $1',
      [receipts[0]?.id]
    );
    expect(intentCount.rows[0]?.n).toBe('2');
  });

  it('T6.2: the actual owner advisory lock yields a fast 503, then the same event retries to 200', async () => {
    const connection = await seedConnection({ actorId: 'U_LIFE_LOCK' });
    const body = tokensRevoked(['U_LIFE_LOCK']);
    const locker = await db.pool.connect();
    try {
      await locker.query("SELECT pg_advisory_lock(hashtext('ati-slack-owner'), hashtext($1))", [
        connection.person.id,
      ]);
      const started = Date.now();
      const busy = await postSigned(url, body);
      const elapsed = Date.now() - started;
      expect(busy.status).toBe(503);
      expect(busy.body).toEqual({ code: 'OWNER_LOCK_BUSY', error: 'Slack connection is busy; retry later' });
      // Well inside Slack's three-second delivery budget; the lock is a try-lock, not a wait.
      expect(elapsed).toBeLessThan(2000);
      expect(await receiptsFor(body.event_id)).toHaveLength(0);
    } finally {
      await locker.query("SELECT pg_advisory_unlock(hashtext('ati-slack-owner'), hashtext($1))", [
        connection.person.id,
      ]);
      locker.release();
    }

    const retry = await postSigned(url, body);
    expect(retry.status).toBe(200);
    const sourceEventKey = `slack:${APP_ID}:${body.event_id}`;
    const barriers = await db.pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM slack_invalidation_barriers WHERE source_event_key = $1 AND active',
      [sourceEventKey]
    );
    expect(barriers.rows[0]?.n).toBe('1');
  });

  it('coordinates with a real TokenManager refresh over HTTP before capturing the new credential', async () => {
    const key='0123456789abcdef0123456789abcdef';
    const connection=await seedConnection({actorId:'U_REAL_REFRESH',config:encryptCredentials({
      accessToken:'FIXTURE_OLD_ACCESS',refreshToken:'FIXTURE_OLD_REFRESH',expiresAt:Date.now()-1000,
    },key)});
    let entered!:()=>void,finishRefresh!:()=>void;
    const requestEntered=new Promise<void>(resolve=>entered=resolve);
    const refreshGate=new Promise<void>(resolve=>finishRefresh=resolve);
    const provider=http.createServer(async(req,res)=>{
      for await (const chunk of req) { void chunk; }
      entered();await refreshGate;
      res.setHeader('Content-Type','application/json');
      res.end(JSON.stringify({ok:true,token_type:'user',access_token:'FIXTURE_NEW_ACCESS',refresh_token:'FIXTURE_NEW_REFRESH',expires_in:43200}));
    });
    await new Promise<void>(resolve=>provider.listen(0,'127.0.0.1',resolve));
    const address=provider.address();
    if(!address||typeof address==='string')throw new Error('fixture did not bind');
    const oauth=new SlackOAuthClient({appId:APP_ID,clientId:'FIXTURE_CLIENT',clientSecret:'FIXTURE_SECRET',redirectUri:'https://ati.example/connections/myslack/callback',authorizationUrl:'https://slack.com/oauth/v2/authorize',apiBaseUrl:`http://127.0.0.1:${address.port}`});
    const manager=new SlackTokenManager(new SlackConnectionRepo(db.pool,invalidation),oauth,key);
    const refresh=manager.getAccessToken(connection.person.id,connection.connectionId,1);
    refresh.catch(()=>{});
    const body=tokensRevoked([connection.actorId]);
    try {
      await requestEntered;
      expect((await postSigned(url,body)).body.code).toBe('OWNER_LOCK_BUSY');
      expect(await receiptsFor(body.event_id)).toHaveLength(0);
      finishRefresh();
      expect(await refresh).toBe('FIXTURE_NEW_ACCESS');
      expect((await postSigned(url,body)).status).toBe(200);
      const saved=(await db.pool.query('SELECT config,refresh_in_flight FROM slack_connections WHERE id=$1',[connection.connectionId])).rows[0];
      const barrier=(await db.pool.query('SELECT credential_fingerprint FROM slack_invalidation_barriers WHERE source_event_key=$1',[`slack:${APP_ID}:${body.event_id}`])).rows[0];
      expect(saved.refresh_in_flight).toBe(false);
      expect(barrier.credential_fingerprint).toBe(sha(saved.config));
      expect(barrier.credential_fingerprint).not.toBe(sha(connection.config));
    } finally {
      finishRefresh();await refresh.catch(()=>{});
      provider.closeAllConnections();
      await new Promise<void>(resolve=>provider.close(()=>resolve()));
    }
  });

  it('T6.3: automation off drops ordinary content in memory while lifecycle still commits; no config stays fail-closed', async () => {
    const connection = await seedConnection({ actorId: 'U_LIFE_OFF' });
    const sentinel = 'LIFECYCLE_OFF_CONFIDENTIAL_TEXT';
    const ordinary = eventCallback({
      type: 'message',
      channel: 'C_LIFE_OFF',
      user: 'U_LIFE_OFF',
      text: sentinel,
      ts: '1730220000.000100',
      event_ts: '1730220000.000100',
    });
    const dropped = await postSigned(offUrl, ordinary);
    expect(dropped).toEqual({ status: 200, body: { ok: true } });
    expect(await receiptsFor(ordinary.event_id)).toHaveLength(0);

    const revoked = tokensRevoked(['U_LIFE_OFF']);
    const committed = await postSigned(offUrl, revoked);
    expect(committed).toEqual({ status: 200, body: { ok: true } });
    const receipts = await receiptsFor(revoked.event_id);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.status).toBe('pending_lifecycle');
    const barrier = await db.pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM slack_invalidation_barriers WHERE source_event_key = $1 AND active',
      [`slack:${APP_ID}:${revoked.event_id}`]
    );
    expect(barrier.rows[0]?.n).toBe('1');
    const connectionRow = await db.pool.query<{ status: string }>(
      'SELECT status FROM slack_connections WHERE id = $1',
      [connection.connectionId]
    );
    expect(connectionRow.rows[0]?.status).toBe('reconnect_required');

    const leaked = await db.pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM slack_event_receipts WHERE row_to_json(slack_event_receipts)::text LIKE '%' || $1 || '%'`,
      [sentinel]
    );
    expect(leaked.rows[0]?.n).toBe('0');

    const unconfigured = eventCallback({
      type: 'message',
      channel: 'C_LIFE_OFF',
      ts: '1730220000.000100',
      event_ts: '1730220000.000100',
    });
    const refused = await postSigned(unconfiguredUrl, unconfigured);
    expect(refused.status).toBe(503);
    expect(refused.body.code).toBe('CONFIG_MISSING');
    expect(await receiptsFor(unconfigured.event_id)).toHaveLength(0);
  });

  it('T6.4: several ATI users are fenced independently while the same actor id in another workspace stays isolated', async () => {
    const first = await seedConnection({ actorId: 'U_LIFE_MULTI_A' });
    const second = await seedConnection({ actorId: 'U_LIFE_MULTI_B' });
    const otherWorkspace = await seedConnection({ actorId: 'U_LIFE_MULTI_A', workspaceId: 'T04ALIFE_OTHER' });
    const body = tokensRevoked(['U_LIFE_MULTI_A', 'U_LIFE_MULTI_B']);

    const res = await postSigned(url, body);
    expect(res.status).toBe(200);
    const barriers = await db.pool.query<{ connection_id: string; workspace_id: string }>(
      'SELECT connection_id, workspace_id FROM slack_invalidation_barriers WHERE source_event_key = $1',
      [`slack:${APP_ID}:${body.event_id}`]
    );
    expect(new Set(barriers.rows.map(row => row.connection_id))).toEqual(
      new Set([first.connectionId, second.connectionId])
    );
    expect(barriers.rows.every(row => row.workspace_id === TEAM_ID)).toBe(true);

    const untouched = await db.pool.query<{ status: string }>(
      'SELECT status FROM slack_connections WHERE id = $1',
      [otherWorkspace.connectionId]
    );
    expect(untouched.rows[0]?.status).toBe('active');
    const otherBarriers = await db.pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM slack_invalidation_barriers WHERE connection_id = $1',
      [otherWorkspace.connectionId]
    );
    expect(otherBarriers.rows[0]?.n).toBe('0');
  });

  it('T6.5: a delayed revoke fences the captured new generation without erasing its credential', async () => {
    const connection = await seedConnection({
      actorId: 'U_LIFE_REGRANT',
      identityVersion: 3,
      config: 'ENC_REGRANTED_CONFIG_NEW_GENERATION',
    });
    const body = tokensRevoked(['U_LIFE_REGRANT']);

    const res = await postSigned(url, body);
    expect(res.status).toBe(200);

    const sourceEventKey = `slack:${APP_ID}:${body.event_id}`;
    const barrier = await db.pool.query(
      `SELECT barrier_type, provisional, identity_version, credential_fingerprint, reason
       FROM slack_invalidation_barriers WHERE source_event_key = $1`,
      [sourceEventKey]
    );
    expect(barrier.rows[0]).toMatchObject({
      barrier_type: 'provisional_auth',
      provisional: true,
      identity_version: 3,
      credential_fingerprint: sha(connection.config),
      reason: 'token_revoked',
    });

    const intent = await db.pool.query<{ payload_json: any; status: string }>(
      `SELECT i.payload_json, i.status
       FROM slack_lifecycle_intents i
       JOIN slack_event_receipts r ON r.id = i.receipt_id
       WHERE r.event_id = $1`,
      [body.event_id]
    );
    expect(intent.rows[0]?.payload_json.binding).toMatchObject({
      connectionId: connection.connectionId,
      workspaceId: TEAM_ID,
      slackUserId: 'U_LIFE_REGRANT',
      identityVersion: 3,
    });
    expect(intent.rows[0]?.status).toBe('pending');

    const row = await db.pool.query<{ status: string; config: string; identity_version: number }>(
      'SELECT status, config, identity_version FROM slack_connections WHERE id = $1',
      [connection.connectionId]
    );
    expect(row.rows[0]).toEqual({
      status: 'reconnect_required',
      config: connection.config,
      identity_version: 3,
    });
  });

  it('T6.6: edits and deletes are ordered by exact revision; delete wins and other channels stay isolated', async () => {
    const channel = 'C_LIFE_ORDER';
    const otherChannel = 'C_LIFE_OTHER';
    const ts = '1730221000.000300';
    const deleted = messageDeleted(channel, ts);
    expect((await postSigned(url, deleted)).status).toBe(200);

    const lateEdit = messageChanged(channel, ts, '1730290000.000900', 'LATE_EDIT_AFTER_DELETE');
    expect((await postSigned(url, lateEdit)).status).toBe(200);

    const resurrect = await invalidation.checkBarriers({
      workspaceId: TEAM_ID,
      resourceType: 'message',
      resourceId: slackMessageResourceId(channel, ts),
      revision: '1730290000.000900',
    });
    expect(resurrect).toMatchObject({ blocked: true, barrierType: 'resource' });

    const isolation = await invalidation.checkBarriers({
      workspaceId: TEAM_ID,
      resourceType: 'message',
      resourceId: slackMessageResourceId(otherChannel, ts),
      revision: '1730290000.000900',
    });
    expect(isolation.blocked).toBe(false);

    const deleteBarrier = await db.pool.query<{ deleted: boolean; active: boolean }>(
      'SELECT deleted, active FROM slack_invalidation_barriers WHERE source_event_key = $1',
      [`slack:${APP_ID}:${deleted.event_id}`]
    );
    expect(deleteBarrier.rows[0]).toEqual({ deleted: true, active: true });

    const editIntent = await db.pool.query<{ payload_json: any }>(
      `SELECT i.payload_json FROM slack_lifecycle_intents i
       JOIN slack_event_receipts r ON r.id = i.receipt_id WHERE r.event_id = $1`,
      [lateEdit.event_id]
    );
    expect(editIntent.rows[0]?.payload_json).toMatchObject({
      intentType: 'message_changed',
      channelId: channel,
      messageTs: ts,
      editTs: '1730290000.000900',
    });
  });

  it('T6.7: no message content reaches the database, logs or the HTTP response', async () => {
    const sentinel = 'LIFECYCLE_SENTINEL_SECRET_TEXT_04A';
    const body = messageChanged('C_LIFE_SECRET', '1730222000.000400', '1730223000.000500', sentinel);

    const logSpies = [
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
    ];
    let res: SignedResponse;
    try {
      res = await postSigned(url, body);
    } finally {
      logSpies.forEach(spy => spy.mockRestore());
    }
    expect(res!).toEqual({ status: 200, body: { ok: true } });
    expect(JSON.stringify(logSpies.map(spy => spy.mock.calls))).not.toContain(sentinel);

    const tables = [
      'slack_event_receipts',
      'slack_lifecycle_intents',
      'slack_invalidation_barriers',
      'slack_invalidation_intents',
    ];
    for (const table of tables) {
      const found = await db.pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM ${table} WHERE row_to_json(${table})::text LIKE '%' || $1 || '%'`,
        [sentinel]
      );
      expect(found.rows[0]?.n).toBe('0');
      const foundOld = await db.pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM ${table} WHERE row_to_json(${table})::text LIKE '%' || $1 || '%'`,
        [`OLD_${sentinel}`]
      );
      expect(foundOld.rows[0]?.n).toBe('0');
    }
  });

  it('T6.8: replaying an event id with different bytes is a 409 with no second barrier', async () => {
    const connection = await seedConnection({ actorId: 'U_LIFE_CONFLICT' });
    const body = tokensRevoked(['U_LIFE_CONFLICT']);
    expect((await postSigned(url, body)).status).toBe(200);

    const tampered = tokensRevoked(['U_LIFE_CONFLICT'], { event_id: body.event_id, event_time: NOW_SECONDS + 1 });
    const conflict = await postSigned(url, tampered);
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('EVENT_ID_CONFLICT');

    const barriers = await db.pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM slack_invalidation_barriers WHERE source_event_key = $1',
      [`slack:${APP_ID}:${body.event_id}`]
    );
    expect(barriers.rows[0]?.n).toBe('1');
    const connectionRow = await db.pool.query<{ status: string }>(
      'SELECT status FROM slack_connections WHERE id = $1',
      [connection.connectionId]
    );
    expect(connectionRow.rows[0]?.status).toBe('reconnect_required');
  });
});
