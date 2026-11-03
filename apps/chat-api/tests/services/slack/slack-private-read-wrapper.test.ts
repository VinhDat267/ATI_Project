import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { SlackPolicyService } from '../../../src/services/slack/policy-service.js';
import { SlackConnectionRepo } from '../../../src/db/repositories/slack-connection-repo.js';
import { SlackInvalidationService } from '../../../src/services/slack/slack-invalidation-service.js';
import { decryptCredentials, PersonalSlackReadAdapter } from '@wap/tool-adapters';
import {
  SlackPrivateReadError,
  SlackPrivateReadWrapper,
  type SlackPrivateReadRequest,
} from '../../../src/services/slack/slack-private-read-wrapper.js';
import {
  createSlackReadEnvironment,
  sleep,
  TEST_ENV,
  TEST_KEY,
  waitFor,
  type SeededUser,
  type SlackReadEnvironment,
} from '../../helpers/slack-private-read-fixture.js';

const CANONICAL_REF_KEYS = [
  'binding',
  'configFingerprint',
  'consentRevision',
  'policyVersion',
  'providerProfileId',
  'providerRevision',
  'purpose',
  'requestedRetentionDays',
] as const;

const BINDING_KEYS = ['atiUserId', 'connectionId', 'identityVersion', 'slackUserId', 'workspaceId'] as const;

let env: SlackReadEnvironment;
let alice: SeededUser;

const request = (
  seed: SeededUser,
  overrides: Record<string, unknown> = {}
): SlackPrivateReadRequest => ({
  callerAtiUserId: seed.person.id,
  binding: seed.binding,
  tool: 'myslack.conversations_info',
  params: { channel: 'C_GENERAL' },
  purpose: 'manual_lookup',
  ...overrides,
});

async function capture(promise: Promise<unknown>): Promise<Error & { code?: string }> {
  try {
    await promise;
  } catch (error) {
    return error as Error & { code?: string };
  }
  throw new Error('expected the invocation to reject');
}

function expectNoSecrets(error: Error, secrets: readonly string[]): void {
  const rendered = `${error.message} ${String((error as { cause?: unknown }).cause ?? '')} ${JSON.stringify(
    (error as { details?: unknown }).details ?? null
  )}`;
  for (const secret of secrets) expect(rendered).not.toContain(secret);
}

beforeAll(async () => {
  env = await createSlackReadEnvironment('slack_read_wrapper');
  alice = await env.addUser({
    name: 'alice',
    workspaceId: 'T_WS_READ',
    actorId: 'U_ALICE_SLACK',
    accessToken: 'xoxp-alice-secret',
  });
}, 60_000);

afterEach(() => {
  env.fixture.clearHandlers();
  env.fixture.reset();
});

afterAll(async () => {
  await env.close();
});

describe('feature flag and request validation', () => {
  it('fails closed when the injected runtime config does not carry MYSLACK_ENABLED=on', async () => {
    const original = process.env.MYSLACK_ENABLED;
    process.env.MYSLACK_ENABLED = 'on';
    try {
      const variants: Array<Record<string, string> | undefined> = [
        undefined,
        {},
        { MYSLACK_ENABLED: 'off' },
        { MYSLACK_ENABLED: 'ON' },
        { MYSLACK_ENABLED: 'true' },
        { LLM_PROVIDER: 'gemini' },
      ];
      for (const variant of variants) {
        const runtimeConfig = variant === undefined ? undefined : { env: variant };
        const { wrapper, tokenCalls } = env.buildWrapper({ runtimeConfig });
        const error = await capture(wrapper.executeRead(request(alice)));
        expect(error.code).toBe('SLACK_READ_DISABLED');
        expect(tokenCalls).toHaveLength(0);
      }
    } finally {
      if (original === undefined) delete process.env.MYSLACK_ENABLED;
      else process.env.MYSLACK_ENABLED = original;
    }
    expect(env.fixture.gets).toHaveLength(0);
  });

  it('rejects malformed requests before any policy, token, or transport call', async () => {
    const { wrapper, tokenCalls } = env.buildWrapper();
    const cases: Array<[SlackPrivateReadRequest, string]> = [
      [request(alice, { tool: 'myslack.chat_postMessage', params: { channel: 'C', text: 'x' } }), 'SLACK_READ_INVALID_REQUEST'],
      [request(alice, { tool: 'myslack.conversations_unknown' }), 'SLACK_READ_INVALID_REQUEST'],
      [request(alice, { purpose: 'storage' }), 'SLACK_READ_INVALID_REQUEST'],
      [request(alice, { purpose: 'unknown' }), 'SLACK_READ_INVALID_REQUEST'],
      [request(alice, { params: { channel: '   ' } }), 'SLACK_READ_INVALID_REQUEST'],
      [request(alice, { params: { channel: 'C_GENERAL', unexpected: true } }), 'SLACK_READ_INVALID_REQUEST'],
      [request(alice, { params: { channel: 'C_GENERAL', limit: 0 } }), 'SLACK_READ_INVALID_REQUEST'],
      [request(alice, { params: 'C_GENERAL' }), 'SLACK_READ_INVALID_REQUEST'],
      [request(alice, { binding: { ...alice.binding, identityVersion: 0 } }), 'SLACK_READ_INVALID_REQUEST'],
      [request(alice, { binding: { ...alice.binding, workspaceId: '' } }), 'SLACK_READ_INVALID_REQUEST'],
      [request(alice, { signal: {} as AbortSignal }), 'SLACK_READ_INVALID_REQUEST'],
      [request(alice, { unknownOuter: true }), 'SLACK_READ_INVALID_REQUEST'],
      [{ ...request(alice), callerAtiUserId: '   ' }, 'SLACK_READ_INVALID_REQUEST'],
    ];
    for (const [payload, code] of cases) {
      const error = await capture(wrapper.executeRead(payload));
      expect(error.code).toBe(code);
    }

    const mismatch = await capture(
      wrapper.executeRead(
        request(alice, { callerAtiUserId: '00000000-0000-0000-0000-000000000000' })
      )
    );
    expect(mismatch.code).toBe('SLACK_READ_IDENTITY_MISMATCH');

    expect(tokenCalls).toHaveLength(0);
    expect(env.fixture.gets).toHaveLength(0);
  });

  it('rejects an adapter base URL that is neither native Slack nor an approved loopback origin', () => {
    for (const apiBaseUrl of [
      'https://evil.example/api',
      'http://slack.com/api',
      'https://slack.com/api/other',
      'http://127.0.0.1:8080/api',
      'http://example.test:8080',
    ]) {
      expect(() => env.buildWrapper({ apiBaseUrl })).toThrowError(SlackPrivateReadError);
      try {
        env.buildWrapper({ apiBaseUrl });
      } catch (error) {
        expect((error as SlackPrivateReadError).code).toBe('SLACK_READ_INVALID_CONFIG');
      }
    }
  });
});

describe('binding and F1 authorization against real PostgreSQL', () => {
  it('denies every mismatched binding field before the token manager or transport', async () => {
    const { wrapper, tokenCalls } = env.buildWrapper();
    const mutations: Array<Record<string, unknown>> = [
      { workspaceId: 'T_OTHER_WORKSPACE' },
      { connectionId: '00000000-0000-0000-0000-000000000000' },
      { slackUserId: 'U_OTHER_SLACK' },
      { identityVersion: 99 },
    ];
    for (const mutation of mutations) {
      const error = await capture(
        wrapper.executeRead(request(alice, { binding: { ...alice.binding, ...mutation } }))
      );
      expect(error.code).toBe('SLACK_READ_POLICY_DENIED');
    }

    const bob = await env.addUser({
      name: 'bob-foreign',
      workspaceId: 'T_WS_FOREIGN',
      actorId: 'U_BOB_FOREIGN',
    });
    const foreign = await capture(
      wrapper.executeRead(
        request(bob, {
          callerAtiUserId: bob.person.id,
          binding: { ...alice.binding, atiUserId: bob.person.id },
        })
      )
    );
    expect(foreign.code).toBe('SLACK_READ_POLICY_DENIED');
    expect(tokenCalls).toHaveLength(0);
    expect(env.fixture.gets).toHaveLength(0);
  });

  it('denies a disabled user and a connection marked reconnect_required', async () => {
    const { wrapper, tokenCalls } = env.buildWrapper();
    const suspended = await env.addUser({
      name: 'suspended',
      workspaceId: 'T_WS_SUSPENDED',
      actorId: 'U_SUSPENDED',
    });
    await env.db.pool.query("UPDATE users SET status='disabled' WHERE id=$1", [suspended.person.id]);
    try {
      const error = await capture(wrapper.executeRead(request(suspended)));
      expect(error.code).toBe('SLACK_READ_POLICY_DENIED');
    } finally {
      await env.db.pool.query("UPDATE users SET status='active' WHERE id=$1", [suspended.person.id]);
    }

    const stale = await env.addUser({
      name: 'stale',
      workspaceId: 'T_WS_STALE',
      actorId: 'U_STALE',
    });
    await env.db.pool.query(
      "UPDATE slack_connections SET status='reconnect_required', config=NULL WHERE id=$1",
      [stale.binding.connectionId]
    );
    const staleError = await capture(wrapper.executeRead(request(stale)));
    expect(staleError.code).toBe('SLACK_READ_POLICY_DENIED');

    expect(tokenCalls).toHaveLength(0);
    expect(env.fixture.gets).toHaveLength(0);
  });

  it('denies revoked consent and allows only after a real regrant', async () => {
    const seed = await env.addUser({
      name: 'consent',
      workspaceId: 'T_WS_CONSENT',
      actorId: 'U_CONSENT',
    });
    const { wrapper, tokenCalls } = env.buildWrapper();
    const consent = await env.consentRepo.getConsent('T_WS_CONSENT', env.runtimeIdentity.providerId);
    expect(consent).not.toBeNull();

    await env.consentRepo.revokeConsent({
      workspaceId: 'T_WS_CONSENT',
      providerId: env.runtimeIdentity.providerId,
      recordedBy: 'test@example.com',
      reason: 'revocation_test',
      expectedRevision: consent!.revision,
    });
    const denied = await capture(wrapper.executeRead(request(seed)));
    expect(denied.code).toBe('SLACK_READ_POLICY_DENIED');
    expect(tokenCalls).toHaveLength(0);
    expect(env.fixture.gets).toHaveLength(0);

    const revoked = await env.consentRepo.getConsent('T_WS_CONSENT', env.runtimeIdentity.providerId);
    await env.consentRepo.grantConsent({
      workspaceId: 'T_WS_CONSENT',
      providerId: env.runtimeIdentity.providerId,
      policyVersion: 'v1.0.0',
      purposes: ['manual_lookup', 'triage', 'planning', 'digest'],
      retentionDays: 14,
      organizationRepresentative: 'Representative',
      evidenceRef: 'DPA-REGRANT',
      recordedBy: 'test@example.com',
      expectedRevision: revoked!.revision,
    });
    const allowed = await wrapper.executeRead(request(seed));
    expect(allowed.data).toHaveProperty('channel.id', 'C_GENERAL');
    expect(tokenCalls).toHaveLength(1);
    expect(env.fixture.gets).toHaveLength(1);
  });

  it('denies an unverified provider, fingerprint drift, and a missing provider row', async () => {
    const providerId = env.runtimeIdentity.providerId;
    const { wrapper, tokenCalls } = env.buildWrapper();

    const current = await env.consentRepo.getTrustedProvider(providerId);
    expect(current).not.toBeNull();

    const unverified = await env.consentRepo.attestProvider({
      id: providerId,
      name: env.runtimeIdentity.name,
      verified: false,
      noTraining: false,
      maxRetentionDays: 30,
      configurationFingerprint: env.runtimeIdentity.fingerprint,
      expectedRevision: current!.revision,
    });
    const unverifiedError = await capture(wrapper.executeRead(request(alice)));
    expect(unverifiedError.code).toBe('SLACK_READ_POLICY_DENIED');

    const drifted = await env.consentRepo.attestProvider({
      id: providerId,
      name: env.runtimeIdentity.name,
      verified: true,
      noTraining: true,
      maxRetentionDays: 30,
      configurationFingerprint: 'f'.repeat(64),
      evidenceRef: 'EVID-DRIFT',
      verifiedBy: 'security-officer@example.com',
      verifiedAt: new Date(),
      expectedRevision: unverified.revision,
    });
    const driftError = await capture(wrapper.executeRead(request(alice)));
    expect(driftError.code).toBe('SLACK_READ_POLICY_DENIED');

    await env.consentRepo.attestProvider({
      id: providerId,
      name: env.runtimeIdentity.name,
      verified: true,
      noTraining: true,
      maxRetentionDays: 30,
      configurationFingerprint: env.runtimeIdentity.fingerprint,
      evidenceRef: 'EVID-RESTORE',
      verifiedBy: 'security-officer@example.com',
      verifiedAt: new Date(),
      expectedRevision: drifted.revision,
    });

    const otherEnv: Record<string, string> = {
      LLM_PROVIDER: 'openai-compatible',
      LLM_MODEL: 'unregistered-model',
      LLM_BASE_URL: 'http://127.0.0.1:9999',
      RUNTIME_ACCOUNT_ID: 'NO_PROVIDER_ROW',
    };
    const foreignPolicyService = new (await import('../../../src/services/slack/policy-service.js'))
      .SlackPolicyService(env.db.pool, { env: otherEnv });
    const foreign = env.buildWrapper({ policyService: foreignPolicyService });
    const missing = await capture(foreign.wrapper.executeRead(request(alice)));
    expect(missing.code).toBe('SLACK_READ_POLICY_DENIED');

    expect(tokenCalls).toHaveLength(0);
    expect(env.fixture.gets).toHaveLength(0);
  });

  it('denies a stale binding after a real reconnect increments identityVersion', async () => {
    const seed = await env.addUser({
      name: 'reconnect',
      workspaceId: 'T_WS_RECONNECT',
      actorId: 'U_RECONNECT',
    });
    const reconnected = await env.reconnect(seed, { accessToken: 'xoxp-reconnect-new' });
    expect(reconnected.binding.identityVersion).toBe(seed.binding.identityVersion + 1);

    const { wrapper, tokenCalls } = env.buildWrapper();
    const stale = await capture(wrapper.executeRead(request(seed)));
    expect(stale.code).toBe('SLACK_READ_POLICY_DENIED');
    expect(tokenCalls).toHaveLength(0);

    const fresh = await wrapper.executeRead(request(reconnected));
    expect(fresh.data).toHaveProperty('channel.id', 'C_GENERAL');
    expect(tokenCalls).toHaveLength(1);
    expect(env.fixture.gets).toHaveLength(1);
  });
});

describe('eight bounded read methods', () => {
  it.each([
    ['myslack.conversations_list', '/conversations.list', {}, 'channels'],
    ['myslack.conversations_history', '/conversations.history', { channel: 'C_GENERAL' }, 'messages'],
    ['myslack.conversations_replies', '/conversations.replies', { channel: 'C_GENERAL', ts: '1712345678.000200' }, 'messages'],
    ['myslack.conversations_members', '/conversations.members', { channel: 'C_GENERAL' }, 'members'],
    ['myslack.users_list', '/users.list', {}, 'members'],
  ] as const)('accepts a valid empty page from %s with container provenance', async (tool, path, params, field) => {
    env.fixture.setHandler(path, () => ({ body: { ok: true, [field]: [], has_more: false } }));
    const { wrapper } = env.buildWrapper();
    const result = await wrapper.executeRead(request(alice, { tool, params }));
    expect(result.data).toHaveProperty(field, []);
    expect(result.data).toHaveProperty('provenance.binding', alice.binding);
    expect(result.data).toHaveProperty('provenance.acquisitionPolicyReference', result.policyReference);
  });

  it.each([undefined, {}, { blocked: null }, { blocked: 'false' }])(
    'rejects malformed invalidation decisions before token or HTTP dispatch: %j', async decision => {
      const { wrapper, tokenCalls } = env.buildWrapper({ invalidationService: {
        checkBarriers: async () => decision as unknown as { blocked: boolean },
      } });
      const error = await capture(wrapper.executeRead(request(alice)));
      expect(error.code).toBe('SLACK_READ_INTERNAL');
      expect(tokenCalls).toHaveLength(0);
      expect(env.fixture.gets).toHaveLength(0);
    }
  );

  const cases: Array<{
    tool: string;
    params: Record<string, unknown>;
    container: Record<string, unknown>;
    entity?: { path: 'channels' | 'channel' | 'messages' | 'members' | 'user'; identity: Record<string, unknown> };
  }> = [
    {
      tool: 'myslack.conversations_list',
      params: {},
      container: { type: 'conversation' },
      entity: { path: 'channels', identity: { type: 'conversation', channelId: 'C_GENERAL' } },
    },
    {
      tool: 'myslack.conversations_info',
      params: { channel: 'C_GENERAL' },
      container: { type: 'conversation', channelId: 'C_GENERAL' },
      entity: { path: 'channel', identity: { type: 'conversation', channelId: 'C_GENERAL' } },
    },
    {
      tool: 'myslack.conversations_history',
      params: { channel: 'C_GENERAL' },
      container: { type: 'message', channelId: 'C_GENERAL' },
      entity: {
        path: 'messages',
        identity: { type: 'message', channelId: 'C_GENERAL', messageTs: '1712345678.000200' },
      },
    },
    {
      tool: 'myslack.conversations_replies',
      params: { channel: 'C_GENERAL', ts: '1712345678.000200' },
      container: { type: 'message', channelId: 'C_GENERAL', messageTs: '1712345678.000200' },
      entity: {
        path: 'messages',
        identity: { type: 'message', channelId: 'C_GENERAL', messageTs: '1712345678.000200' },
      },
    },
    {
      tool: 'myslack.conversations_members',
      params: { channel: 'C_GENERAL' },
      container: { type: 'members', channelId: 'C_GENERAL' },
    },
    {
      tool: 'myslack.users_list',
      params: {},
      container: { type: 'users' },
      entity: { path: 'members', identity: { type: 'user', userId: 'U_ALICE_SLACK' } },
    },
    {
      tool: 'myslack.users_info',
      params: { user: 'U_ALICE_SLACK' },
      container: { type: 'user', userId: 'U_ALICE_SLACK' },
      entity: { path: 'user', identity: { type: 'user', userId: 'U_ALICE_SLACK' } },
    },
    {
      tool: 'myslack.chat_getPermalink',
      params: { channel: 'C_GENERAL', message_ts: '1712345678.000200' },
      container: { type: 'permalink', channelId: 'C_GENERAL', messageTs: '1712345678.000200' },
    },
  ];

  it('returns canonical eight-field policy references and validated provenance for all eight methods', async () => {
    const { wrapper, tokenCalls } = env.buildWrapper();
    const seenEntities: string[] = [];

    for (const testCase of cases) {
      const result = await wrapper.executeRead(
        request(alice, { tool: testCase.tool, params: testCase.params })
      );
      expect(result.tool).toBe(testCase.tool);
      expect(Object.keys(result.policyReference).sort()).toEqual([...CANONICAL_REF_KEYS]);
      expect(Object.keys(result.policyReference.binding).sort()).toEqual([...BINDING_KEYS]);
      for (const alias of ['providerId', 'configurationFingerprint', 'retentionDays', 'workspaceId']) {
        expect(result.policyReference).not.toHaveProperty(alias);
      }
      expect(result.policyReference.purpose).toBe('manual_lookup');
      expect(result.policyReference.requestedRetentionDays).toBe(0);
      expect(result.policyReference.binding).toEqual(alice.binding);

      const data = result.data as Record<string, any>;
      expect(data.ok).toBe(true);
      expect(data.provenance.binding).toEqual(alice.binding);
      expect(data.provenance.acquisitionPolicyReference).toEqual(result.policyReference);
      expect(data.provenance.resourceIdentity).toEqual(testCase.container);
      expect(data.provenance.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(data.provenance.observationalDigest).toMatch(/^[0-9a-f]{64}$/);

      if (testCase.entity) {
        const rawEntity =
          testCase.entity.path === 'channel' || testCase.entity.path === 'user'
            ? data[testCase.entity.path]
            : data[testCase.entity.path][0];
        expect(rawEntity.provenance.resourceIdentity).toEqual(testCase.entity.identity);
        expect(rawEntity.provenance.binding).toEqual(alice.binding);
        expect(rawEntity.provenance.acquisitionPolicyReference).toEqual(result.policyReference);
        seenEntities.push(JSON.stringify(rawEntity.provenance.resourceIdentity));
      }

      expect(JSON.stringify(result)).not.toContain('xoxp-alice-secret');
      expect(JSON.stringify(result)).not.toContain('xoxp-refresh-alice');
    }

    expect(tokenCalls).toHaveLength(cases.length);
    expect(env.fixture.gets).toHaveLength(cases.length);
    expect(new Set(seenEntities)).toEqual(
      new Set([
        JSON.stringify({ type: 'conversation', channelId: 'C_GENERAL' }),
        JSON.stringify({ type: 'message', channelId: 'C_GENERAL', messageTs: '1712345678.000200' }),
        JSON.stringify({ type: 'user', userId: 'U_ALICE_SLACK' }),
      ])
    );
  });

  it('preserves exact native message revisions without relabeling', async () => {
    env.fixture.setHandler('/conversations.history', () => ({
      body: {
        ok: true,
        messages: [
          { type: 'message', user: 'U_ALICE_SLACK', text: 'original', ts: '1712345678.000200' },
          {
            type: 'message',
            user: 'U_ALICE_SLACK',
            text: 'edited',
            ts: '1712345678.000300',
            edited: { user: 'U_ALICE_SLACK', ts: '1712345678.000400' },
          },
        ],
      },
    }));

    const { wrapper } = env.buildWrapper();
    const history = await wrapper.executeRead(
      request(alice, { tool: 'myslack.conversations_history', params: { channel: 'C_GENERAL' } })
    );
    expect(history.data).toHaveProperty('messages.0.ts', '1712345678.000200');
    expect(history.data).toHaveProperty('messages.0.provenance.nativeRevision', '1712345678.000200');
    expect(history.data).toHaveProperty('messages.1.ts', '1712345678.000300');
    expect(history.data).toHaveProperty('messages.1.provenance.nativeRevision', '1712345678.000400');

    const replies = await wrapper.executeRead(
      request(alice, {
        tool: 'myslack.conversations_replies',
        params: { channel: 'C_GENERAL', ts: '1712345678.000200' },
      })
    );
    expect(replies.data).toHaveProperty('messages.0.ts', '1712345678.000200');
    expect(replies.data).toHaveProperty('messages.1.ts', '1712345678.000300');
    expect(replies.data).toHaveProperty('provenance.resourceIdentity', {
      type: 'message',
      channelId: 'C_GENERAL',
      messageTs: '1712345678.000200',
    });
  });
});

describe('token lifecycle and caller aborts', () => {
  it('uses the rotated token from a real token-manager refresh and never returns it', async () => {
    const seed = await env.addUser({
      name: 'refresh',
      workspaceId: 'T_WS_REFRESH',
      actorId: 'U_REFRESH',
      accessToken: 'xoxp-OLD-SECRET',
      refreshToken: 'REFRESH_OLD',
      expiresAt: Date.now() - 1_000,
    });
    const { wrapper, tokenCalls } = env.buildWrapper();

    const result = await wrapper.executeRead(request(seed));
    expect(result.data).toHaveProperty('channel.id', 'C_GENERAL');
    expect(tokenCalls).toHaveLength(1);
    expect(env.fixture.refreshCalls).toBe(1);

    const gets = env.fixture.gets;
    expect(gets).toHaveLength(1);
    expect(gets[0]!.authorization).toBe('Bearer ROTATED_ACCESS');
    expect(JSON.stringify(result)).not.toContain('ROTATED_ACCESS');
    expect(JSON.stringify(result)).not.toContain('ROTATED_REFRESH');

    const row = await env.db.pool.query('SELECT config FROM slack_connections WHERE id=$1', [
      seed.binding.connectionId,
    ]);
    const config = decryptCredentials(row.rows[0].config, TEST_KEY);
    expect(config.accessToken).toBe('ROTATED_ACCESS');
    expect(config.refreshToken).toBe('ROTATED_REFRESH');
  });

  it('rejects an already-aborted caller without token acquisition or transport', async () => {
    const controller = new AbortController();
    controller.abort();
    const { wrapper, tokenCalls } = env.buildWrapper();
    const error = await capture(wrapper.executeRead(request(alice, { signal: controller.signal })));
    expect(error.code).toBe('SLACK_READ_ABORTED');
    expect(error.message).toBe('SLACK_READ_ABORTED');
    expect(tokenCalls).toHaveLength(0);
    expect(env.fixture.gets).toHaveLength(0);
  });

  it('settles the wrapper deadline even when the adapter factory never resolves in time', async () => {
    const { wrapper, tokenCalls } = env.buildWrapper({
      deadlineMs: 30,
      createAdapter: (config) =>
        new Promise((resolve) => {
          setTimeout(() => resolve(new PersonalSlackReadAdapter(config)), 250);
        }),
    });
    const started = Date.now();
    const error = await capture(wrapper.executeRead(request(alice)));
    expect(error.code).toBe('SLACK_READ_DEADLINE_EXCEEDED');
    expect(Date.now() - started).toBeLessThan(200);

    await sleep(300);
    expect(tokenCalls).toHaveLength(0);
    expect(env.fixture.gets).toHaveLength(0);
  });

  it('aborts a slow policy hook without acquiring a token or dispatching', async () => {
    const controller = new AbortController();
    const { wrapper, tokenCalls } = env.buildWrapper({
      policyService: {
        resolveSlackModelPolicy: async (input) => {
          await sleep(250);
          return env.policyService.resolveSlackModelPolicy(input);
        },
      },
    });
    const pending = wrapper.executeRead(request(alice, { signal: controller.signal }));
    setTimeout(() => controller.abort(), 25);
    const error = await capture(pending);
    expect(error.code).toBe('SLACK_READ_ABORTED');

    await sleep(300);
    expect(tokenCalls).toHaveLength(0);
    expect(env.fixture.gets).toHaveLength(0);
  });

  it('aborts during a real refresh without dispatching and without returning the late credential', async () => {
    const seed = await env.addUser({
      name: 'abort-refresh',
      workspaceId: 'T_WS_ABORT_REFRESH',
      actorId: 'U_ABORT_REFRESH',
      accessToken: 'xoxp-ABORT-OLD',
      refreshToken: 'ABORT_REFRESH_OLD',
      expiresAt: Date.now() - 1_000,
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    env.fixture.setHandler('/oauth.v2.access', async () => {
      await gate;
      return {
        body: {
          ok: true,
          token_type: 'user',
          access_token: 'LATE_REFRESHED_SECRET',
          refresh_token: 'LATE_REFRESHED_REFRESH',
          expires_in: 43200,
        },
      };
    });

    const controller = new AbortController();
    const { wrapper } = env.buildWrapper();
    const pending = wrapper.executeRead(request(seed, { signal: controller.signal }));
    await waitFor(() => env.fixture.refreshCalls >= 1);
    controller.abort();
    const error = await capture(pending);
    expect(error.code).toBe('SLACK_READ_ABORTED');
    expect(error.message).toBe('SLACK_READ_ABORTED');
    expectNoSecrets(error, ['LATE_REFRESHED_SECRET', 'LATE_REFRESHED_REFRESH', 'ABORT_REFRESH_OLD']);

    release();
    const deadline = Date.now() + 2_000;
    let storedToken: string | undefined;
    while (Date.now() < deadline) {
      const row = await env.db.pool.query('SELECT config FROM slack_connections WHERE id=$1', [
        seed.binding.connectionId,
      ]);
      if (row.rows[0]?.config) {
        storedToken = decryptCredentials(row.rows[0].config, TEST_KEY).accessToken;
        if (storedToken === 'LATE_REFRESHED_SECRET') break;
      }
      await sleep(20);
    }
    expect(storedToken).toBe('LATE_REFRESHED_SECRET');
    expect(env.fixture.gets).toHaveLength(0);
  });

  it('rejects after a disconnect that commits while the real refresh holds the owner lock', async () => {
    const seed = await env.addUser({
      name: 'disconnect',
      workspaceId: 'T_WS_DISCONNECT',
      actorId: 'U_DISCONNECT',
      accessToken: 'xoxp-DISCONNECT-OLD',
      refreshToken: 'DISCONNECT_REFRESH_OLD',
      expiresAt: Date.now() - 1_000,
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    env.fixture.setHandler('/oauth.v2.access', async () => {
      await gate;
      return {
        body: {
          ok: true,
          token_type: 'user',
          access_token: 'DISCONNECT_ROTATED_SECRET',
          refresh_token: 'DISCONNECT_ROTATED_REFRESH',
          expires_in: 43200,
        },
      };
    });

    const { wrapper } = env.buildWrapper();
    const pending = wrapper.executeRead(request(seed));
    await waitFor(() => env.fixture.refreshCalls >= 1);

    const disconnectPromise = env.connectionRepo.disconnect(seed.person.id, seed.binding.connectionId);
    await sleep(40);
    release();

    const error = await capture(pending);
    expect(error.code).toBe('SLACK_READ_POLICY_DENIED');
    expectNoSecrets(error, ['DISCONNECT_ROTATED_SECRET', 'DISCONNECT_ROTATED_REFRESH']);
    await disconnectPromise;

    expect(env.fixture.gets).toHaveLength(0);
    const row = await env.db.pool.query('SELECT status, config FROM slack_connections WHERE id=$1', [
      seed.binding.connectionId,
    ]);
    expect(row.rows[0].status).toBe('disconnected');
    expect(row.rows[0].config).toBeNull();
  });
});

describe('provider errors and per-invocation isolation', () => {
  it('maps provider failures to fixed codes without leaking raw tokens or payloads', async () => {
    const { wrapper, tokenCalls } = env.buildWrapper();

    env.fixture.setHandler('/conversations.history', () => ({
      status: 401,
      body: {
        ok: false,
        error: 'invalid_auth',
        access_token: 'xoxp-LEAKED-PROVIDER-TOKEN',
        text: 'LEAKED-PROVIDER-PAYLOAD',
      },
    }));
    const authError = await capture(
      wrapper.executeRead(
        request(alice, { tool: 'myslack.conversations_history', params: { channel: 'C_GENERAL' } })
      )
    );
    expect(authError.code).toBe('SLACK_READ_AUTHORIZATION_FAILED');
    expect(authError.message).toBe('SLACK_READ_AUTHORIZATION_FAILED');
    expectNoSecrets(authError, [
      'xoxp-LEAKED-PROVIDER-TOKEN',
      'LEAKED-PROVIDER-PAYLOAD',
      'xoxp-alice-secret',
    ]);

    env.fixture.setHandler('/conversations.history', () => ({
      status: 404,
      body: { ok: false, error: 'channel_not_found' },
    }));
    const notFound = await capture(
      wrapper.executeRead(
        request(alice, { tool: 'myslack.conversations_history', params: { channel: 'C_GENERAL' } })
      )
    );
    expect(notFound.code).toBe('SLACK_READ_NOT_FOUND');

    env.fixture.setHandler('/conversations.history', () => ({
      status: 429,
      headers: { 'retry-after': '0' },
      body: { ok: false, error: 'ratelimited' },
    }));
    const before = tokenCalls.length;
    const limited = await capture(
      wrapper.executeRead(
        request(alice, { tool: 'myslack.conversations_history', params: { channel: 'C_GENERAL' } })
      )
    );
    expect(limited.code).toBe('SLACK_READ_RATE_LIMITED');
    expect(tokenCalls.length - before).toBe(1);
  });

  it('builds a fresh adapter, policy hook, and token hook for every invocation', async () => {
    const configs: unknown[] = [];
    const { wrapper } = env.buildWrapper({
      createAdapter: (config) => {
        configs.push(config);
        return new PersonalSlackReadAdapter(config);
      },
    });

    await wrapper.executeRead(request(alice, { tool: 'myslack.users_info', params: { user: 'U_ALICE_SLACK' } }));
    await wrapper.executeRead(request(alice, { tool: 'myslack.users_info', params: { user: 'U_BOB' } }));

    expect(configs).toHaveLength(2);
    expect(configs[0]).not.toBe(configs[1]);
    const first = configs[0] as { policy: unknown; tokens: unknown };
    const second = configs[1] as { policy: unknown; tokens: unknown };
    expect(first.policy).not.toBe(second.policy);
    expect(first.tokens).not.toBe(second.tokens);
  });

  it('does not persist raw Slack content or call any model', async () => {
    const before = await env.db.pool.query('SELECT count(*)::int AS n FROM slack_invalidation_intents');
    const { wrapper } = env.buildWrapper();
    await wrapper.executeRead(
      request(alice, { tool: 'myslack.conversations_history', params: { channel: 'C_GENERAL' } })
    );
    const sources = await env.db.pool.query('SELECT count(*)::int AS n FROM slack_sources');
    expect(sources.rows[0].n).toBe(0);
    const after = await env.db.pool.query('SELECT count(*)::int AS n FROM slack_invalidation_intents');
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});

describe('configuration guards', () => {
  it('reuses the held transaction client for real policy and barrier checks with a single-connection pool', async () => {
    const single = new pg.Pool({ ...env.db.pool.options, max: 1, connectionTimeoutMillis: 200 });
    try {
      const { wrapper } = env.buildWrapper({
        policyService: new SlackPolicyService(single, { env: TEST_ENV }),
        ownerGate: new SlackConnectionRepo(single),
        invalidationService: new SlackInvalidationService(single),
      });
      const result = await wrapper.executeRead(request(alice));
      expect(result.data).toHaveProperty('channel.id', 'C_GENERAL');
    } finally { await single.end(); }
  });

  it('keeps the same injected env for the feature flag and policy provider identity', async () => {
    const policyService = new (await import('../../../src/services/slack/policy-service.js')).SlackPolicyService(
      env.db.pool,
      { env: TEST_ENV }
    );
    const { wrapper } = env.buildWrapper({ policyService });
    const result = await wrapper.executeRead(request(alice));
    expect(result.policyReference.providerProfileId).toBe(env.runtimeIdentity.providerId);
    expect(result.policyReference.configFingerprint).toBe(env.runtimeIdentity.fingerprint);
  });
});
