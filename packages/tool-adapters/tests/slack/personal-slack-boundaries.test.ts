import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SlackBinding, SlackPolicyReference } from '@wap/tool-schemas';
import {
  PersonalSlackReadAdapter,
  type PersonalSlackReadAdapterConfig,
  type SlackAuthorizeReadInput,
  type SlackPolicyHookDecision,
} from '../../src/index.js';
import { StepError } from '../../src/base-adapter.js';
import {
  createPersonalSlackMockServer,
  type PersonalSlackMockServer,
} from '../helpers/personal-slack-mock-server.js';

const bindingA: SlackBinding = {
  atiUserId: 'ati_user_1',
  connectionId: 'conn_slack_1',
  workspaceId: 'T_WORKSPACE_A',
  slackUserId: 'U_ACTOR_A',
  identityVersion: 1,
};

const canonicalRef: SlackPolicyReference = {
  binding: bindingA,
  purpose: 'manual_lookup',
  requestedRetentionDays: 0,
  providerProfileId: 'slack-profile-v1',
  configFingerprint: 'sha256:fingerprint-cfg-1',
  policyVersion: '1',
  consentRevision: '1',
  providerRevision: '1',
};

const OPAQUE = 'fixture_OPAQUE_CREDENTIAL_91c687';

function decision(): SlackPolicyHookDecision {
  return { allowed: true, policyReference: structuredClone(canonicalRef) };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe('PersonalSlackReadAdapter — bounded transport boundaries (SLACK-03C1 r2)', () => {
  let mockServer: PersonalSlackMockServer;

  beforeAll(async () => {
    mockServer = await createPersonalSlackMockServer();
  });

  afterAll(async () => {
    await mockServer.close();
  });

  beforeEach(() => {
    mockServer.reset();
  });

  function createAdapter(overrides: {
    policy?: (input: SlackAuthorizeReadInput) => Promise<SlackPolicyHookDecision>;
    token?: (binding: SlackBinding) => Promise<string>;
    config?: Partial<PersonalSlackReadAdapterConfig>;
    fetcher?: typeof fetch;
  } = {}) {
    return new PersonalSlackReadAdapter({
      tokens: {
        getAccessToken:
          overrides.token ?? (async (binding: SlackBinding) => {
            if (binding.workspaceId === 'T_WORKSPACE_A') return 'xoxp-token-workspace-a';
            return 'xoxp-token-workspace-b';
          }),
      },
      policy: { authorizeRead: overrides.policy ?? (async () => decision()) },
      apiBaseUrl: mockServer.url,
      ...overrides.config,
      ...(overrides.fetcher ? { fetchFn: overrides.fetcher } : {}),
    });
  }

  const usersInfoArgs = { binding: bindingA, user: 'U_ACTOR_A' };
  const listArgs = { binding: bindingA };

  // -------------------------------------------------------------------------
  // 1. AbortSignal reaches every await, including private hooks.
  // -------------------------------------------------------------------------
  describe('abort settlement', () => {
    it('settles on abort while the pre-fetch policy hook is unresolved', async () => {
      const entered = deferred();
      const gate = deferred();
      const controller = new AbortController();
      let requests = 0;

      const adapter = createAdapter({
        policy: async () => {
          entered.resolve();
          await gate.promise;
          return decision();
        },
        fetcher: async () => {
          requests++;
          return new Response(JSON.stringify({ ok: true, user: { id: 'U_ACTOR_A' } }));
        },
        config: { requestTimeoutMs: 5000 },
      });

      let settled = false;
      const pending = adapter
        .execute('myslack.users_info', usersInfoArgs, { signal: controller.signal })
        .then(
          () => { settled = true; },
          () => { settled = true; }
        );

      await entered.promise;
      controller.abort();
      await new Promise<void>((r) => setImmediate(r));
      const settledWhileHookPending = settled;
      gate.resolve();
      await pending;

      expect(settledWhileHookPending).toBe(true);
      expect(requests).toBe(0);
    });

    it('settles on abort while the token hook is unresolved', async () => {
      const entered = deferred();
      const gate = deferred();
      const controller = new AbortController();
      let requests = 0;

      const adapter = createAdapter({
        token: async () => {
          entered.resolve();
          await gate.promise;
          return 'xoxp-token-workspace-a';
        },
        fetcher: async () => {
          requests++;
          return new Response(JSON.stringify({ ok: true, user: { id: 'U_ACTOR_A' } }));
        },
        config: { requestTimeoutMs: 5000 },
      });

      let settled = false;
      const pending = adapter
        .execute('myslack.users_info', usersInfoArgs, { signal: controller.signal })
        .then(
          () => { settled = true; },
          () => { settled = true; }
        );

      await entered.promise;
      controller.abort();
      await new Promise<void>((r) => setImmediate(r));
      const settledWhileHookPending = settled;
      gate.resolve();
      await pending;

      expect(settledWhileHookPending).toBe(true);
      expect(requests).toBe(0);
    });

    it('settles on abort during a delayed HTTP response without waiting for the body', async () => {
      mockServer.setDelayMs(500);
      const controller = new AbortController();
      const adapter = createAdapter({ config: { requestTimeoutMs: 5000 } });

      const pending = adapter.execute('myslack.users_info', usersInfoArgs, {
        signal: controller.signal,
      });
      await mockServer.waitForRequestCount(1);
      controller.abort();

      await expect(pending).rejects.toMatchObject({ category: 'NETWORK' });
      expect(mockServer.getRequestsCount()).toBe(1);
    });

    it('settles on abort while the post-response authorization hook is unresolved', async () => {
      const entered = deferred();
      const gate = deferred();
      const controller = new AbortController();
      let calls = 0;

      const adapter = createAdapter({
        policy: async () => {
          calls++;
          if (calls === 3) {
            entered.resolve();
            await gate.promise;
          }
          return decision();
        },
        fetcher: async () =>
          new Response(JSON.stringify({ ok: true, user: { id: 'U_ACTOR_A' } })),
        config: { requestTimeoutMs: 5000 },
      });

      let settled = false;
      const pending = adapter
        .execute('myslack.users_info', usersInfoArgs, { signal: controller.signal })
        .then(
          () => { settled = true; },
          () => { settled = true; }
        );

      await entered.promise;
      controller.abort();
      await new Promise<void>((r) => setImmediate(r));
      const settledWhileHookPending = settled;
      gate.resolve();
      await pending;

      expect(settledWhileHookPending).toBe(true);
      expect(calls).toBe(3);
    });

    it('settles on abort during the 429 backoff wait', async () => {
      mockServer.setRateLimitRemainingAttempts(1);
      const controller = new AbortController();
      const adapter = createAdapter({ config: { requestTimeoutMs: 5000 } });

      const pending = adapter.execute('myslack.users_info', usersInfoArgs, {
        signal: controller.signal,
      });
      await mockServer.waitForRequestCount(1);
      controller.abort();

      await expect(pending).rejects.toMatchObject({ category: 'NETWORK' });
      expect(mockServer.getRequestsCount()).toBe(1);
    });

    it('settles on abort while the response stream is stalled', async () => {
      const controller = new AbortController();
      const adapter = createAdapter({ config: { requestTimeoutMs: 5000 } });

      const pending = adapter.execute(
        'myslack.conversations_list',
        { binding: bindingA, types: 'simulate_stream_stall' },
        { signal: controller.signal }
      );
      await mockServer.waitForRequestCount(1);
      controller.abort();

      await expect(pending).rejects.toMatchObject({ category: 'NETWORK', statusCode: undefined });
    });

    it('the request deadline also settles a hook that never resolves', async () => {
      const gate = deferred();
      const adapter = createAdapter({
        token: async () => {
          await gate.promise;
          return 'xoxp-token-workspace-a';
        },
        config: { requestTimeoutMs: 100 },
      });

      await expect(
        adapter.execute('myslack.users_info', usersInfoArgs)
      ).rejects.toMatchObject({ category: 'NETWORK' });
    });

    it('rejects non-positive or non-integer request timeouts at construction', () => {
      for (const requestTimeoutMs of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(
          () =>
            new PersonalSlackReadAdapter({
              tokens: { getAccessToken: async () => 'xoxp-token-workspace-a' },
              policy: { authorizeRead: async () => decision() },
              requestTimeoutMs,
            })
        ).toThrow(StepError);
      }

      expect(
        () =>
          new PersonalSlackReadAdapter({
            tokens: { getAccessToken: async () => 'xoxp-token-workspace-a' },
            policy: { authorizeRead: async () => decision() },
            requestTimeoutMs: 1000,
          })
      ).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // 2. Output budgets are always enforced, with no silent data loss.
  // -------------------------------------------------------------------------
  describe('output budget', () => {
    it('sends a bounded default limit and rejects a provider page beyond it', async () => {
      mockServer.setNextResponse(200, {
        ok: true,
        channels: Array.from({ length: 121 }, (_, i) => ({ id: `C${i}` })),
      });
      const adapter = createAdapter();

      await expect(
        adapter.execute('myslack.conversations_list', listArgs)
      ).rejects.toMatchObject({ category: 'SERVER_ERROR' });

      const log = mockServer.getRequestLog();
      expect(log).toHaveLength(1);
      const wireLimit = Number(log[0]!.query.limit);
      expect(wireLimit).toBeGreaterThan(0);
      expect(wireLimit).toBeLessThanOrEqual(100);
    });

    it('rejects overreturn even when the provider claims has_more=false', async () => {
      mockServer.setNextResponse(200, {
        ok: true,
        channels: [{ id: 'C1' }, { id: 'C2' }, { id: 'C3' }],
        has_more: false,
      });
      const adapter = createAdapter();

      await expect(
        adapter.execute('myslack.conversations_list', { binding: bindingA, limit: 1 })
      ).rejects.toMatchObject({ category: 'SERVER_ERROR' });
    });

    it('rejects overreturn instead of dropping observations behind a cursor', async () => {
      mockServer.setNextResponse(200, {
        ok: true,
        channels: [{ id: 'C1' }, { id: 'C2' }, { id: 'C3' }],
        response_metadata: { next_cursor: 'fixture-next' },
      });
      const adapter = createAdapter();

      await expect(
        adapter.execute('myslack.conversations_list', { binding: bindingA, limit: 1 })
      ).rejects.toMatchObject({ category: 'SERVER_ERROR' });
    });

    it.each([
      ['myslack.conversations_list', listArgs, { ok: true, channels: [{ id: 'C1' }] }],
      [
        'myslack.conversations_history',
        { binding: bindingA, channel: 'C_GENERAL_A' },
        { ok: true, messages: [{ ts: '1712345678.000100' }] },
      ],
      [
        'myslack.conversations_replies',
        { binding: bindingA, channel: 'C_GENERAL_A', ts: '1712345678.000100' },
        { ok: true, messages: [{ ts: '1712345678.000100' }] },
      ],
      [
        'myslack.conversations_members',
        { binding: bindingA, channel: 'C_GENERAL_A' },
        { ok: true, members: ['U_ACTOR_A'] },
      ],
      ['myslack.users_list', listArgs, { ok: true, members: [{ id: 'U_ACTOR_A' }] }],
    ] as const)('%s sends a default wire limit within 1..100', async (tool, args, body) => {
      mockServer.setNextResponse(200, body);
      const adapter = createAdapter();

      await expect(adapter.execute(tool, args)).resolves.toMatchObject({ ok: true });
      const log = mockServer.getRequestLog();
      expect(log).toHaveLength(1);
      const wireLimit = Number(log[0]!.query.limit);
      expect(wireLimit).toBeGreaterThanOrEqual(1);
      expect(wireLimit).toBeLessThanOrEqual(100);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Strict typed provider responses for all eight methods.
  // -------------------------------------------------------------------------
  describe('strict provider response shape', () => {
    it.each([
      ['myslack.conversations_list', listArgs, { ok: true, channels: { id: 'C1' } }],
      ['myslack.conversations_info', { binding: bindingA, channel: 'C1' }, { ok: true, channel: 'C1' }],
      ['myslack.conversations_history', { binding: bindingA, channel: 'C1' }, { ok: true, messages: {} }],
      [
        'myslack.conversations_replies',
        { binding: bindingA, channel: 'C1', ts: '1712345678.000100' },
        { ok: true, messages: null },
      ],
      ['myslack.conversations_members', { binding: bindingA, channel: 'C1' }, { ok: true, members: 'U_ACTOR_A' }],
      ['myslack.users_list', listArgs, { ok: true, members: { id: 'U_ACTOR_A' } }],
      ['myslack.users_info', usersInfoArgs, { ok: true, user: 'U_ACTOR_A' }],
      [
        'myslack.chat_getPermalink',
        { binding: bindingA, channel: 'C_GENERAL_A', message_ts: '1712345678.000100' },
        { ok: true, permalink: 12345 },
      ],
    ] as const)('%s fails closed on a malformed mandatory field', async (tool, args, body) => {
      mockServer.setNextResponse(200, body);
      const adapter = createAdapter();

      await expect(adapter.execute(tool, args)).rejects.toMatchObject({
        category: 'SERVER_ERROR',
      });
    });

    it('rejects numeric message timestamps instead of coercing them to strings', async () => {
      mockServer.setNextResponse(200, {
        ok: true,
        messages: [{ ts: 1760000000.000123, text: 'fixture' }],
      });
      const adapter = createAdapter();

      await expect(
        adapter.execute('myslack.conversations_history', { binding: bindingA, channel: 'C_GENERAL_A' })
      ).rejects.toMatchObject({ category: 'SERVER_ERROR' });
    });

    it('rejects a numeric edited timestamp', async () => {
      mockServer.setNextResponse(200, {
        ok: true,
        messages: [{ ts: '1712345678.000100', edited: { ts: 1712345679.0002 } }],
      });
      const adapter = createAdapter();

      await expect(
        adapter.execute('myslack.conversations_history', { binding: bindingA, channel: 'C_GENERAL_A' })
      ).rejects.toMatchObject({ category: 'SERVER_ERROR' });
    });

    it('rejects a non-string next_cursor instead of forwarding provider objects', async () => {
      mockServer.setNextResponse(200, {
        ok: true,
        channels: [{ id: 'C1' }],
        response_metadata: { next_cursor: { payload: OPAQUE } },
      });
      const adapter = createAdapter();

      await expect(
        adapter.execute('myslack.conversations_list', listArgs)
      ).rejects.toMatchObject({ category: 'SERVER_ERROR' });
    });

    it('rejects an oversized next_cursor', async () => {
      mockServer.setNextResponse(200, {
        ok: true,
        channels: [{ id: 'C1' }],
        response_metadata: { next_cursor: 'c'.repeat(3000) },
      });
      const adapter = createAdapter();

      await expect(
        adapter.execute('myslack.conversations_list', listArgs)
      ).rejects.toMatchObject({ category: 'SERVER_ERROR' });
    });

    it('does not truthy-coerce provider booleans', async () => {
      mockServer.setNextResponse(200, {
        ok: true,
        channels: [{ id: 'C1', is_private: 'yes' }],
      });
      const adapter = createAdapter();

      await expect(
        adapter.execute('myslack.conversations_list', listArgs)
      ).rejects.toMatchObject({ category: 'SERVER_ERROR' });
    });

    it('rejects a blank channel identifier in a list item', async () => {
      mockServer.setNextResponse(200, { ok: true, channels: [{ id: '   ' }] });
      const adapter = createAdapter();

      await expect(
        adapter.execute('myslack.conversations_list', listArgs)
      ).rejects.toMatchObject({ category: 'SERVER_ERROR' });
    });

    it('rejects an oversized message text field', async () => {
      mockServer.setNextResponse(200, {
        ok: true,
        messages: [{ ts: '1712345678.000100', text: 'x'.repeat(100_000) }],
      });
      const adapter = createAdapter();

      await expect(
        adapter.execute('myslack.conversations_history', { binding: bindingA, channel: 'C_GENERAL_A' })
      ).rejects.toMatchObject({ category: 'SERVER_ERROR' });
    });

    it('validates the permalink channel and timestamp path against the request', async () => {
      mockServer.setNextResponse(200, {
        ok: true,
        channel: 'C_GENERAL_A',
        permalink: 'https://workspace-a.slack.com/archives/C_GENERAL_A/p1712345678000100',
      });
      const adapter = createAdapter();
      await expect(
        adapter.execute('myslack.chat_getPermalink', {
          binding: bindingA,
          channel: 'C_GENERAL_A',
          message_ts: '1712345678.000200',
        })
      ).rejects.toMatchObject({ category: 'SERVER_ERROR' });

      mockServer.setNextResponse(200, {
        ok: true,
        channel: 'C_OTHER',
        permalink: 'https://workspace-a.slack.com/archives/C_OTHER/p1712345678000100',
      });
      await expect(
        adapter.execute('myslack.chat_getPermalink', {
          binding: bindingA,
          channel: 'C_GENERAL_A',
          message_ts: '1712345678.000100',
        })
      ).rejects.toMatchObject({ category: 'NOT_FOUND' });
    });

    it('rejects unsafe permalink hosts', async () => {
      for (const permalink of [
        'https://workspace-a.slack.com.evil.example/archives/C_GENERAL_A/p1712345678000100',
        'https://evil.example/archives/C_GENERAL_A/p1712345678000100',
        'http://workspace-a.slack.com/archives/C_GENERAL_A/p1712345678000100',
      ]) {
        mockServer.setNextResponse(200, { ok: true, channel: 'C_GENERAL_A', permalink });
        const adapter = createAdapter();
        await expect(
          adapter.execute('myslack.chat_getPermalink', {
            binding: bindingA,
            channel: 'C_GENERAL_A',
            message_ts: '1712345678.000100',
          })
        ).rejects.toMatchObject({ category: 'SERVER_ERROR' });
      }
    });

    it('whitelists provider fields and never forwards unknown objects or prototypes', async () => {
      const hostileItem = JSON.parse(
        '{"id":"C1","name":"general","secret":"xoxp-LEAK","profile":{"email":"p@example.com"},"__proto__":{"polluted":true}}'
      );
      mockServer.setNextResponse(200, { ok: true, channels: [hostileItem] });
      const adapter = createAdapter();

      const result: any = await adapter.execute('myslack.conversations_list', listArgs);
      const channel = result.channels[0];
      expect(channel.id).toBe('C1');
      expect(channel.secret).toBeUndefined();
      expect(channel.profile).toBeUndefined();
      expect(Object.hasOwn(channel, '__proto__')).toBe(false);
      expect(Object.getPrototypeOf(channel)).toBe(Object.prototype);
      expect(({} as any).polluted).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain('xoxp-LEAK');
    });
  });

  // -------------------------------------------------------------------------
  // 4. Fixed sanitized error contracts.
  // -------------------------------------------------------------------------
  describe('error sanitization', () => {
    function expectNoOpaque(error: any) {
      expect(error).toBeDefined();
      const serialized = [error.message, error.cause?.message, JSON.stringify(error.details)].join('|');
      expect(serialized.includes(OPAQUE)).toBe(false);
    }

    it('does not echo an unknown provider error code', async () => {
      mockServer.setNextResponse(200, { ok: false, error: `unknown_${OPAQUE}` });
      const adapter = createAdapter();
      let error: any;
      try {
        await adapter.execute('myslack.users_info', usersInfoArgs);
      } catch (e) {
        error = e;
      }
      expectNoOpaque(error);
    });

    it('does not echo a non-string provider error payload', async () => {
      mockServer.setNextResponse(200, { ok: false, error: { payload: OPAQUE } });
      const adapter = createAdapter();
      let error: any;
      try {
        await adapter.execute('myslack.users_info', usersInfoArgs);
      } catch (e) {
        error = e;
      }
      expectNoOpaque(error);
    });

    it('does not echo an HTTP error payload', async () => {
      mockServer.setNextResponse(500, { ok: false, error: OPAQUE });
      const adapter = createAdapter();
      let error: any;
      try {
        await adapter.execute('myslack.users_info', usersInfoArgs);
      } catch (e) {
        error = e;
      }
      expectNoOpaque(error);
    });

    it('does not echo a raw network error message', async () => {
      const adapter = createAdapter({
        fetcher: async () => {
          throw new Error(`network failure ${OPAQUE}`);
        },
      });
      let error: any;
      try {
        await adapter.execute('myslack.users_info', usersInfoArgs);
      } catch (e) {
        error = e;
      }
      expectNoOpaque(error);
      expect(error.category).toBe('NETWORK');
    });

    it('does not echo a policy hook error', async () => {
      let calls = 0;
      const adapter = createAdapter({
        policy: async () => {
          calls++;
          if (calls === 2) throw new Error(OPAQUE);
          return decision();
        },
        fetcher: async () => new Response(JSON.stringify({ ok: true, user: { id: 'U_ACTOR_A' } })),
      });
      let error: any;
      try {
        await adapter.execute('myslack.users_info', usersInfoArgs);
      } catch (e) {
        error = e;
      }
      expectNoOpaque(error);
      expect(error.category).toBe('AUTH_ERROR');
    });

    it('does not echo caller-supplied URL credentials from the constructor', () => {
      let error: any;
      try {
        new PersonalSlackReadAdapter({
          tokens: { getAccessToken: async () => 'xoxp-token-workspace-a' },
          policy: { authorizeRead: async () => decision() },
          apiBaseUrl: `https://user:${OPAQUE}@slack.com/api`,
        });
      } catch (e) {
        error = e;
      }
      expectNoOpaque(error);
      expect(error).toBeInstanceOf(StepError);
      expect(error.category).toBe('VALIDATION');
    });
  });

  // -------------------------------------------------------------------------
  // 5. Immutable detached binding and policy epoch.
  // -------------------------------------------------------------------------
  describe('immutable binding identities', () => {
    it('does not let the token hook rebind the workspace used for provenance', async () => {
      const adapter = createAdapter({
        token: async (binding: SlackBinding) => {
          try {
            (binding as any).workspaceId = 'T_WORKSPACE_B';
            (binding as any).slackUserId = 'U_ACTOR_B';
          } catch {
            // Frozen hook input is the expected outcome.
          }
          return 'xoxp-token-workspace-a';
        },
      });

      const result: any = await adapter.execute('myslack.users_info', usersInfoArgs);
      expect(result.user.id).toBe('U_ACTOR_A');
      expect(result.provenance.binding).toEqual(bindingA);
      expect(result.provenance.acquisitionPolicyReference.binding).toEqual(bindingA);
    });

    it('does not let the policy hook mutate the binding or the expected epoch', async () => {
      let calls = 0;
      const adapter = createAdapter({
        policy: async (input: SlackAuthorizeReadInput) => {
          calls++;
          try {
            (input.binding as any).workspaceId = 'T_WORKSPACE_B';
            if (input.expectedPolicyReference) {
              (input.expectedPolicyReference as any).consentRevision = '2';
            }
          } catch {
            // Frozen hook input is the expected outcome.
          }
          return decision();
        },
      });

      const result: any = await adapter.execute('myslack.users_info', usersInfoArgs);
      expect(result.provenance.binding).toEqual(bindingA);
      expect(result.provenance.acquisitionPolicyReference.consentRevision).toBe('1');
      expect(calls).toBeGreaterThanOrEqual(3);
    });
  });
});
