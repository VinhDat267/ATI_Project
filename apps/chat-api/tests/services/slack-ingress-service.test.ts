import { createHmac, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';
import { SlackEventReceiptRepo } from '../../src/db/repositories/slack-event-receipt-repo.js';
import { SlackInvalidationService } from '../../src/services/slack/slack-invalidation-service.js';
import {
  SlackIngressService,
  type SlackIngressRequest,
  type SlackIngressRuntimeConfig,
  type SlackLifecyclePurgeHook,
  type SlackQueueIntentHook,
} from '../../src/services/slack/slack-ingress-service.js';
import { slackIngressEnv } from '../../src/config/slack-ingress-env.js';

const SECRET = 'ingress-test-signing-secret';
const APP_ID = 'A04ASVC';
const TEAM_ID = 'T04ASVC';
const NOW_MS = 1_730_214_000_500;
const NOW_SECONDS = 1_730_214_000;

function sign(body: unknown, options: { nowMs?: number; secret?: string } = {}): SlackIngressRequest {
  const rawBody = Buffer.from(JSON.stringify(body), 'utf8');
  const nowMs = options.nowMs ?? NOW_MS;
  const timestampHeader = String(Math.floor(nowMs / 1000));
  const signatureHeader = `v0=${createHmac('sha256', options.secret ?? SECRET)
    .update(`v0:${timestampHeader}:`)
    .update(rawBody)
    .digest('hex')}`;
  return { rawBody, timestampHeader, signatureHeader, nowMs };
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

function ordinaryEvent(overrides: Record<string, unknown> = {}) {
  return eventCallback({
    type: 'message',
    channel: 'C04A',
    user: 'U04A',
    text: 'CONFIDENTIAL_TEXT_SHOULD_NEVER_PERSIST',
    ts: '1730214000.000100',
    event_ts: '1730214000.000100',
    ...overrides,
  });
}

function tokensRevoked(slackUserIds: string[], overrides: Record<string, unknown> = {}) {
  return eventCallback(
    { type: 'tokens_revoked', tokens: { oauth: slackUserIds }, event_ts: '1730214000.000100' },
    overrides
  );
}

function messageDeleted(overrides: Record<string, unknown> = {}) {
  return eventCallback({
    type: 'message',
    subtype: 'message_deleted',
    hidden: true,
    channel: 'C04A',
    ts: '1730215000.000200',
    deleted_ts: '1730214000.000100',
    event_ts: '1730215000.000200',
    ...overrides,
  });
}

function messageChanged(overrides: Record<string, unknown> = {}) {
  return eventCallback({
    type: 'message',
    subtype: 'message_changed',
    channel: 'C04A',
    ts: '1730215000.000200',
    event_ts: '1730215000.000200',
    message: {
      type: 'message',
      user: 'U04A',
      text: 'CONFIDENTIAL_EDIT_TEXT',
      ts: '1730214000.000100',
      edited: { user: 'U04A', ts: '1730216000.000300' },
    },
    previous_message: { type: 'message', user: 'U04A', text: 'CONFIDENTIAL_OLD_TEXT', ts: '1730214000.000100' },
    ...overrides,
  });
}

describe('slackIngressEnv (SLACK-04A)', () => {
  it('T3.0: requires MYSLACK_ENABLED=on plus signing secret and app id, and never enables automation while off', () => {
    expect(slackIngressEnv({}, true)).toBeUndefined();
    expect(slackIngressEnv({ MYSLACK_ENABLED: 'off', MYSLACK_AUTOMATION_ENABLED: 'on' }, true)).toBeUndefined();
    expect(() => slackIngressEnv({ MYSLACK_ENABLED: 'maybe' }, true)).toThrow(/MYSLACK_ENABLED/);
    expect(() => slackIngressEnv({ MYSLACK_ENABLED: 'on', MYSLACK_APP_ID: APP_ID }, true)).toThrow(/SLACK_SIGNING_SECRET/);
    expect(() => slackIngressEnv({ MYSLACK_ENABLED: 'on', SLACK_SIGNING_SECRET: SECRET }, true)).toThrow(/MYSLACK_APP_ID/);
    expect(slackIngressEnv({ MYSLACK_ENABLED: 'on', MYSLACK_APP_ID: APP_ID }, false)).toBeUndefined();
    expect(
      slackIngressEnv({ MYSLACK_ENABLED: 'on', SLACK_SIGNING_SECRET: SECRET, MYSLACK_APP_ID: APP_ID }, true)
    ).toEqual({ signingSecret: SECRET, appId: APP_ID, automationEnabled: false });
    expect(
      slackIngressEnv(
        {
          MYSLACK_ENABLED: 'on',
          SLACK_SIGNING_SECRET: SECRET,
          MYSLACK_APP_ID: APP_ID,
          MYSLACK_AUTOMATION_ENABLED: 'on',
        },
        true
      )
    ).toEqual({ signingSecret: SECRET, appId: APP_ID, automationEnabled: true });
    expect(() =>
      slackIngressEnv(
        {
          MYSLACK_ENABLED: 'on',
          SLACK_SIGNING_SECRET: SECRET,
          MYSLACK_APP_ID: APP_ID,
          MYSLACK_AUTOMATION_ENABLED: 'sometimes',
        },
        true
      )
    ).toThrow(/MYSLACK_AUTOMATION_ENABLED/);
  });
});

describe('SlackIngressService on PostgreSQL (SLACK-04A)', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let invalidation: SlackInvalidationService;
  let repo: SlackEventReceiptRepo;

  const baseConfig: SlackIngressRuntimeConfig = {
    signingSecret: SECRET,
    appId: APP_ID,
    automationEnabled: true,
  };

  function service(
    options: {
      config?: SlackIngressRuntimeConfig | undefined;
      queueHook?: SlackQueueIntentHook;
      lifecycleHook?: SlackLifecyclePurgeHook;
    } = {}
  ) {
    return new SlackIngressService({
      config: 'config' in options ? options.config : baseConfig,
      repo,
      ...(options.queueHook ? { queueHook: options.queueHook } : {}),
      ...(options.lifecycleHook ? { lifecycleHook: options.lifecycleHook } : {}),
    });
  }

  beforeAll(async () => {
    db = await createMigratedSchema('slack_ingress_service');
    invalidation = new SlackInvalidationService(db.pool);
    repo = new SlackEventReceiptRepo(db.pool, invalidation);
  });

  afterAll(async () => {
    await db?.close();
  });

  async function seedConnection(
    options: { actorId?: string; workspaceId?: string; status?: 'active' | 'reconnect_required'; config?: string } = {}
  ) {
    const person = await db.person('Ingress Member');
    const connectionId = randomUUID();
    const actorId = options.actorId ?? `U${randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`;
    const config = options.config ?? `ENCRYPTED_CONFIG_${randomUUID()}`;
    await db.pool.query(
      `INSERT INTO slack_connections (
         id, user_id, app_id, workspace_id, workspace_name, actor_id,
         identity_version, status, config, scopes, connected_at, last_state_order
       ) VALUES ($1, $2, $3, $4, 'Ingress Workspace', $5, 1, $6, $7,
                 ARRAY['channels:history'], now(), '0001')`,
      [
        connectionId,
        person.id,
        APP_ID,
        options.workspaceId ?? TEAM_ID,
        actorId,
        options.status ?? 'active',
        config,
      ]
    );
    return { person, connectionId, actorId, config };
  }

  async function receiptCount(eventIdValue: string): Promise<number> {
    const res = await db.pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM slack_event_receipts WHERE slack_app_id = $1 AND event_id = $2',
      [APP_ID, eventIdValue]
    );
    return Number(res.rows[0]?.n ?? '0');
  }

  async function receipt(eventIdValue: string) {
    const res = await db.pool.query(
      'SELECT * FROM slack_event_receipts WHERE slack_app_id = $1 AND event_id = $2',
      [APP_ID, eventIdValue]
    );
    return res.rows[0];
  }

  it('T3.1: answers a standard url_verification challenge without api_app_id and writes nothing', async () => {
    const body = { token: 'verification-token', challenge: 'challenge-04a-xyz', type: 'url_verification' };
    const result = await service().handleRequest(sign(body));
    expect(result).toEqual({ status: 200, body: { challenge: 'challenge-04a-xyz' } });
    const count = await db.pool.query<{ n: string }>('SELECT count(*)::text AS n FROM slack_event_receipts');
    expect(count.rows[0]?.n).toBe('0');
  });

  it('T3.1b: event_context is opaque and preserved exactly within an explicit transport bound', async () => {
    const opaque = `ctx:🔒/tenant?x=1&y=two ${'q'.repeat(900)}`;
    const envelope = eventCallback(
      { type: 'message', channel: 'C04A', ts: '1730214000.000100', event_ts: '1730214000.000100' },
      { event_context: opaque }
    );
    const recorded = await service().handleRequest(sign(envelope));
    expect(recorded.status).toBe(200);
    const row = await db.pool.query<{ event_context: string }>(
      'SELECT event_context FROM slack_event_receipts WHERE event_id = $1',
      [envelope.event_id]
    );
    expect(row.rows[0]?.event_context).toBe(opaque);

    const tooLong = eventCallback(
      { type: 'message', channel: 'C04A', ts: '1730214000.000100', event_ts: '1730214000.000100' },
      { event_context: 'x'.repeat(1025) }
    );
    const rejected = await service().handleRequest(sign(tooLong));
    expect(rejected.status).toBe(400);
    expect(rejected.body.code).toBe('MALFORMED_EVENT');
  });

  it('T3.2: accepts a matching challenge app id and rejects a mismatched one', async () => {
    const matching = { type: 'url_verification', challenge: 'ch-ok', api_app_id: APP_ID };
    expect(await service().handleRequest(sign(matching))).toEqual({ status: 200, body: { challenge: 'ch-ok' } });

    const mismatched = { type: 'url_verification', challenge: 'ch-bad', api_app_id: 'A_OTHER' };
    const result = await service().handleRequest(sign(mismatched));
    expect(result.status).toBe(400);
    expect(result.body.code).toBe('APP_ID_MISMATCH');
    expect(JSON.stringify(result.body)).not.toContain('ch-bad');
  });

  it('T3.3: event_callback requires its own app id and team id, with no authorizations fallback', async () => {
    const svc = service();
    const missingApp = ordinaryEvent();
    delete (missingApp as Record<string, unknown>).api_app_id;
    expect((await svc.handleRequest(sign(missingApp))).body.code).toBe('APP_ID_MISMATCH');

    const wrongApp = eventCallback(
      { type: 'message', channel: 'C04A', ts: '1730214000.000100', event_ts: '1730214000.000100' },
      { api_app_id: 'A_OTHER' }
    );
    expect((await svc.handleRequest(sign(wrongApp))).body.code).toBe('APP_ID_MISMATCH');

    const missingTeam = ordinaryEvent();
    delete (missingTeam as Record<string, unknown>).team_id;
    (missingTeam as Record<string, unknown>).authorizations = [
      { enterprise_id: null, team_id: 'T_FALLBACK', user_id: 'U_FALLBACK', is_bot: false, is_enterprise_install: false },
    ];
    const teamResult = await svc.handleRequest(sign(missingTeam));
    expect(teamResult.status).toBe(400);
    expect(teamResult.body.code).toBe('MISSING_TEAM_ID');
    expect(await receiptCount((missingTeam as Record<string, unknown>).event_id as string)).toBe(0);
    expect(await receiptCount((wrongApp as Record<string, unknown>).event_id as string)).toBe(0);
  });

  it('T3.4: parses event timestamps strictly and discards ordinary events without inventing a time', async () => {
    const svc = service();

    const junk = ordinaryEvent({ event_ts: '1730214000abc' });
    const junkResult = await svc.handleRequest(sign(junk));
    expect(junkResult.status).toBe(200);
    const junkReceipt = await receipt(junk.event_id as string);
    expect(junkReceipt).toMatchObject({
      status: 'discarded',
      discard_reason: 'malformed_timestamp',
      source_event_ts: null,
      source_event_time: null,
    });

    const sevenFractionDigits = ordinaryEvent({ event_ts: '1730214000.1234567' });
    expect((await svc.handleRequest(sign(sevenFractionDigits))).status).toBe(200);
    expect(await receipt(sevenFractionDigits.event_id as string)).toMatchObject({
      status: 'discarded',
      discard_reason: 'malformed_timestamp',
    });

    const noTimestamp = ordinaryEvent();
    delete (noTimestamp as Record<string, unknown>).event_time;
    delete (noTimestamp.event as Record<string, unknown>).event_ts;
    expect((await svc.handleRequest(sign(noTimestamp))).status).toBe(200);
    expect(await receipt(noTimestamp.event_id as string)).toMatchObject({
      status: 'discarded',
      discard_reason: 'malformed_timestamp',
    });

    const numericStringEventTime = ordinaryEvent();
    delete (numericStringEventTime.event as Record<string, unknown>).event_ts;
    (numericStringEventTime as Record<string, unknown>).event_time = '1730214000';
    expect((await svc.handleRequest(sign(numericStringEventTime))).status).toBe(200);
    expect(await receipt(numericStringEventTime.event_id as string)).toMatchObject({
      status: 'discarded',
      discard_reason: 'malformed_timestamp',
    });

    const exact = ordinaryEvent({ event_ts: '1730214000.123456' });
    const exactResult = await svc.handleRequest(sign(exact));
    expect(exactResult.status).toBe(200);
    expect(await receipt(exact.event_id as string)).toMatchObject({
      status: 'pending_fanout',
      source_event_ts: '1730214000.123456',
    });

    const lifecycleJunk = messageDeleted({ event_ts: '1730215000.000200junk' });
    const lifecycleResult = await svc.handleRequest(sign(lifecycleJunk));
    expect(lifecycleResult.status).toBe(400);
    expect(lifecycleResult.body.code).toBe('INVALID_TIMESTAMP');
    expect(await receiptCount(lifecycleJunk.event_id as string)).toBe(0);
  });

  it('T3.5: with automation off ordinary events are dropped in memory while lifecycle still commits', async () => {
    const connection = await seedConnection({ actorId: 'U_AUTOMATION_OFF' });
    let queueCalls = 0;
    const off = service({
      config: { ...baseConfig, automationEnabled: false },
      queueHook: { async onEventReceived() { queueCalls += 1; } },
    });

    const ordinary = ordinaryEvent();
    const ordinaryResult = await off.handleRequest(sign(ordinary));
    expect(ordinaryResult).toEqual({ status: 200, body: { ok: true } });
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(queueCalls).toBe(0);
    expect(await receiptCount(ordinary.event_id as string)).toBe(0);

    const revoked = tokensRevoked(['U_AUTOMATION_OFF']);
    const lifecycleResult = await off.handleRequest(sign(revoked));
    expect(lifecycleResult).toEqual({ status: 200, body: { ok: true } });
    const committed = await receipt(revoked.event_id as string);
    expect(committed).toMatchObject({ status: 'pending_lifecycle' });
    const barrier = await db.pool.query(
      'SELECT 1 FROM slack_invalidation_barriers WHERE source_event_key = $1 AND barrier_type = $2',
      [`slack:${APP_ID}:${revoked.event_id}`, 'provisional_auth']
    );
    expect(barrier.rowCount).toBe(1);
    const connectionRow = await db.pool.query<{ status: string; config: string }>(
      'SELECT status, config FROM slack_connections WHERE id = $1',
      [connection.connectionId]
    );
    expect(connectionRow.rows[0]).toEqual({ status: 'reconnect_required', config: connection.config });
  });

  it('T3.5b: with automation on an ordinary event commits pending_fanout and wakes the queue hook without content', async () => {
    let received: unknown = null;
    let resolveHook: () => void = () => {};
    const hookCalled = new Promise<void>(resolve => { resolveHook = resolve; });
    const svc = service({
      queueHook: {
        async onEventReceived(receiptRow) {
          received = receiptRow;
          resolveHook();
        },
      },
    });

    const body = ordinaryEvent();
    const result = await svc.handleRequest(sign(body));
    expect(result).toEqual({ status: 200, body: { ok: true } });
    await hookCalled;
    const row = await receipt(body.event_id as string);
    expect(row).toMatchObject({
      status: 'pending_fanout',
      event_type: 'message',
      channel_id: 'C04A',
      message_ts: '1730214000.000100',
      event_context: 'connect',
    });
    expect(received).toMatchObject({ id: row.id, status: 'pending_fanout' });
    expect(JSON.stringify(received)).not.toContain('CONFIDENTIAL_TEXT_SHOULD_NEVER_PERSIST');
    const textColumns = await db.pool.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'slack_event_receipts'
         AND column_name IN ('text', 'blocks', 'body', 'raw_body', 'raw_payload')`
    );
    expect(textColumns.rowCount).toBe(0);
  });

  it('T3.6: a held owner lock yields a fast 503 and a retry after release commits', async () => {
    const connection = await seedConnection({ actorId: 'U_INGRESS_LOCK' });
    const svc = service();
    const body = tokensRevoked(['U_INGRESS_LOCK']);

    const holder = await db.pool.connect();
    try {
      await holder.query("SELECT pg_advisory_lock(hashtext('ati-slack-owner'), hashtext($1))", [connection.person.id]);
      const started = Date.now();
      const result = await svc.handleRequest(sign(body));
      const elapsed = Date.now() - started;
      expect(result.status).toBe(503);
      expect(result.body.code).toBe('OWNER_LOCK_BUSY');
      expect(elapsed).toBeLessThan(1000);
      expect(await receiptCount(body.event_id as string)).toBe(0);
    } finally {
      await holder.query("SELECT pg_advisory_unlock(hashtext('ati-slack-owner'), hashtext($1))", [connection.person.id]);
      holder.release();
    }

    const retry = await svc.handleRequest(sign(body));
    expect(retry).toEqual({ status: 200, body: { ok: true } });
    expect(await receipt(body.event_id as string)).toMatchObject({ status: 'pending_lifecycle' });
  });

  it('T3.7: a hung or throwing wakeup hook never delays or fails the committed 200', async () => {
    const hung = service({
      queueHook: { onEventReceived: () => new Promise<void>(() => {}) },
      lifecycleHook: { onLifecycleStaged: () => new Promise<void>(() => {}) },
    });

    const ordinary = ordinaryEvent();
    const started = Date.now();
    const ordinaryResult = await hung.handleRequest(sign(ordinary));
    expect(ordinaryResult.status).toBe(200);
    expect(Date.now() - started).toBeLessThan(1000);

    const connection = await seedConnection({ actorId: 'U_HOOK_HANG' });
    const revoked = tokensRevoked(['U_HOOK_HANG']);
    const lifecycleStarted = Date.now();
    const lifecycleResult = await hung.handleRequest(sign(revoked));
    expect(lifecycleResult.status).toBe(200);
    expect(Date.now() - lifecycleStarted).toBeLessThan(1000);
    const row = await db.pool.query<{ status: string }>('SELECT status FROM slack_connections WHERE id = $1', [connection.connectionId]);
    expect(row.rows[0]?.status).toBe('reconnect_required');

    const throwing = service({
      queueHook: { onEventReceived: async () => { throw new Error('queue down'); } },
      lifecycleHook: { onLifecycleStaged: async () => { throw new Error('purge down'); } },
    });
    expect((await throwing.handleRequest(sign(ordinaryEvent()))).status).toBe(200);
    expect((await throwing.handleRequest(sign(messageDeleted()))).status).toBe(200);
    await new Promise(resolve => setTimeout(resolve, 50));
  });

  it('T3.8: malformed lifecycle fields fail closed and never fall through to ordinary processing', async () => {
    const svc = service();

    const missingDeletedTs = messageDeleted();
    delete (missingDeletedTs.event as Record<string, unknown>).deleted_ts;
    const deletedResult = await svc.handleRequest(sign(missingDeletedTs));
    expect(deletedResult.status).toBe(400);
    expect(deletedResult.body.code).toBe('MALFORMED_EVENT');
    expect(await receiptCount(missingDeletedTs.event_id as string)).toBe(0);

    const unsafeChannel = messageDeleted({ channel: 'bad channel!' });
    expect((await svc.handleRequest(sign(unsafeChannel))).status).toBe(400);
    expect(await receiptCount(unsafeChannel.event_id as string)).toBe(0);

    const missingEdit = messageChanged();
    delete ((missingEdit.event as Record<string, unknown>).message as Record<string, unknown>).edited;
    expect((await svc.handleRequest(sign(missingEdit))).status).toBe(400);
    expect(await receiptCount(missingEdit.event_id as string)).toBe(0);

    const junkEdit = messageChanged();
    (((junkEdit.event as Record<string, unknown>).message as Record<string, unknown>).edited as Record<string, unknown>).ts =
      '1730216000.000300junk';
    expect((await svc.handleRequest(sign(junkEdit))).status).toBe(400);

    const editBeforeMessage = messageChanged();
    (((editBeforeMessage.event as Record<string, unknown>).message as Record<string, unknown>).edited as Record<string, unknown>).ts =
      '1730213000.000300';
    expect((await svc.handleRequest(sign(editBeforeMessage))).status).toBe(400);

    const badTokens = tokensRevoked([]);
    (badTokens.event as Record<string, unknown>).tokens = { oauth: 'not-an-array' };
    expect((await svc.handleRequest(sign(badTokens))).status).toBe(400);
    expect(await receiptCount(badTokens.event_id as string)).toBe(0);

    const badTokenEntry = tokensRevoked([]);
    (badTokenEntry.event as Record<string, unknown>).tokens = { oauth: ['U_OK', 42] };
    expect((await svc.handleRequest(sign(badTokenEntry))).status).toBe(400);

    const missingEvent = eventCallback({});
    delete (missingEvent as Record<string, unknown>).event;
    expect((await svc.handleRequest(sign(missingEvent))).status).toBe(400);

    const missingEventType = eventCallback({ channel: 'C04A' });
    expect((await svc.handleRequest(sign(missingEventType))).status).toBe(400);
  });

  it('T3.9: missing configuration returns CONFIG_MISSING before parsing or touching the database', async () => {
    const svc = service({ config: undefined });
    const body = ordinaryEvent();
    const result = await svc.handleRequest(sign(body));
    expect(result.status).toBe(503);
    expect(result.body.code).toBe('CONFIG_MISSING');
    expect(await receiptCount(body.event_id as string)).toBe(0);
  });

  it('T3.10: invalid signatures and JSON bodies are rejected before any dispatch', async () => {
    const svc = service();
    const body = ordinaryEvent();

    const badSignature = await svc.handleRequest({ ...sign(body), signatureHeader: `v0=${'0'.repeat(64)}` });
    expect(badSignature.status).toBe(401);
    expect(badSignature.body.code).toBe('INVALID_SIGNATURE');
    expect(await receiptCount(body.event_id as string)).toBe(0);

    const stale = await svc.handleRequest({ ...sign(body), nowMs: NOW_MS + 301_000 });
    expect(stale.status).toBe(400);
    expect(stale.body.code).toBe('INVALID_TIMESTAMP');

    const malformed = await svc.handleRequest({
      rawBody: Buffer.from('{not json', 'utf8'),
      timestampHeader: String(NOW_SECONDS),
      signatureHeader: `v0=${createHmac('sha256', SECRET)
        .update(`v0:${NOW_SECONDS}:`)
        .update(Buffer.from('{not json', 'utf8'))
        .digest('hex')}`,
      nowMs: NOW_MS,
    });
    expect(malformed.status).toBe(400);
    expect(malformed.body.code).toBe('INVALID_JSON');
    expect(JSON.stringify(malformed.body)).not.toContain('not json');
  });
});
