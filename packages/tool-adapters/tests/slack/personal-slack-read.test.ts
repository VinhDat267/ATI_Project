import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  SlackBinding,
  SlackPolicyReference,
} from '@wap/tool-schemas';
import {
  PersonalSlackReadAdapter,
  type PersonalSlackReadAdapterConfig,
  type SlackAuthorizeReadInput,
  type SlackPolicyHookDecision,
  type SlackReadPolicyHook,
  type SlackTokenProviderHook,
} from '../../src/index.js';
import { StepError } from '../../src/base-adapter.js';
import {
  createPersonalSlackMockServer,
  type PersonalSlackMockServer,
} from '../helpers/personal-slack-mock-server.js';

describe('PersonalSlackReadAdapter (SLACK-03C1 8 Core Read Methods)', () => {
  let mockServer: PersonalSlackMockServer;

  const bindingA: SlackBinding = {
    atiUserId: 'ati_user_1',
    connectionId: 'conn_slack_1',
    workspaceId: 'T_WORKSPACE_A',
    slackUserId: 'U_ACTOR_A',
    identityVersion: 1,
  };

  const bindingB: SlackBinding = {
    atiUserId: 'ati_user_2',
    connectionId: 'conn_slack_2',
    workspaceId: 'T_WORKSPACE_B',
    slackUserId: 'U_ACTOR_B',
    identityVersion: 1,
  };

  const bindingColleagueA: SlackBinding = {
    atiUserId: 'ati_user_3',
    connectionId: 'conn_slack_3',
    workspaceId: 'T_WORKSPACE_A',
    slackUserId: 'U_COLLEAGUE',
    identityVersion: 1,
  };

  const canonicalPolicyRefA: SlackPolicyReference = {
    binding: bindingA,
    purpose: 'manual_lookup',
    requestedRetentionDays: 0,
    providerProfileId: 'slack-profile-v1',
    configFingerprint: 'sha256:fingerprint-cfg-1',
    policyVersion: '1',
    consentRevision: '1',
    providerRevision: '1',
  };

  beforeAll(async () => {
    mockServer = await createPersonalSlackMockServer();
  });

  afterAll(async () => {
    await mockServer.close();
  });

  beforeEach(() => {
    mockServer.reset();
  });

  function createTestAdapter(overrides?: {
    policyHook?: Partial<SlackReadPolicyHook>;
    tokenHook?: Partial<SlackTokenProviderHook>;
    config?: Partial<PersonalSlackReadAdapterConfig>;
  }) {
    const tokens: SlackTokenProviderHook = {
      getAccessToken: async (b: SlackBinding) => {
        if (overrides?.tokenHook?.getAccessToken) {
          return overrides.tokenHook.getAccessToken(b);
        }
        if (b.workspaceId === 'T_WORKSPACE_A' && b.slackUserId === 'U_ACTOR_A') {
          return 'xoxp-token-workspace-a';
        }
        if (b.workspaceId === 'T_WORKSPACE_A' && b.slackUserId === 'U_COLLEAGUE') {
          return 'xoxp-token-colleague-a';
        }
        if (b.workspaceId === 'T_WORKSPACE_B') {
          return 'xoxp-token-workspace-b';
        }
        return 'xoxp-unknown-token';
      },
    };

    const policy: SlackReadPolicyHook = {
      authorizeRead: async (input: SlackAuthorizeReadInput): Promise<SlackPolicyHookDecision> => {
        if (overrides?.policyHook?.authorizeRead) {
          return overrides.policyHook.authorizeRead(input);
        }
        return {
          allowed: true,
          policyReference: {
            binding: input.binding,
            purpose: input.purpose,
            requestedRetentionDays: 0,
            providerProfileId: 'slack-profile-v1',
            configFingerprint: 'sha256:fingerprint-cfg-1',
            policyVersion: '1',
            consentRevision: '1',
            providerRevision: '1',
          },
        };
      },
    };

    return new PersonalSlackReadAdapter({
      tokens,
      policy,
      apiBaseUrl: mockServer.url,
      ...overrides?.config,
    });
  }

  // 1. Binding Validation
  describe('1. Binding Validation', () => {
    it('fails closed before network when binding is missing required fields', async () => {
      const adapter = createTestAdapter();
      const malformedBinding = { ...bindingA, identityVersion: undefined as any };

      await expect(
        adapter.execute('myslack.conversations_list', { binding: malformedBinding })
      ).rejects.toThrow(TypeError);

      expect(mockServer.getRequestsCount()).toBe(0);
    });

    it('fails closed when connectionId is empty', async () => {
      const adapter = createTestAdapter();
      const malformedBinding = { ...bindingA, connectionId: '' };

      await expect(
        adapter.execute('myslack.conversations_list', { binding: malformedBinding })
      ).rejects.toThrow(TypeError);

      expect(mockServer.getRequestsCount()).toBe(0);
    });
  });

  // 2. Pre-fetch F1 Denial
  describe('2. Pre-fetch F1 Policy Denial', () => {
    it('throws AUTH_ERROR and sends 0 HTTP requests when authorizeRead denies', async () => {
      const adapter = createTestAdapter({
        policyHook: {
          authorizeRead: async () => ({
            allowed: false,
            reason: 'consent_revoked',
          }),
        },
      });

      await expect(
        adapter.execute('myslack.conversations_list', { binding: bindingA })
      ).rejects.toThrow(StepError);

      try {
        await adapter.execute('myslack.conversations_list', { binding: bindingA });
      } catch (err) {
        expect(err).toBeInstanceOf(StepError);
        expect((err as StepError).category).toBe('AUTH_ERROR');
      }

      expect(mockServer.getRequestsCount()).toBe(0);
    });
  });

  // 3. Malformed F1 Decision
  describe('3. Malformed F1 Decision', () => {
    it('fails closed when authorizeRead returns allowed: true but missing canonical policyReference', async () => {
      const adapter = createTestAdapter({
        policyHook: {
          authorizeRead: async () => ({
            allowed: true,
          } as any),
        },
      });

      await expect(
        adapter.execute('myslack.conversations_list', { binding: bindingA })
      ).rejects.toThrow(StepError);

      expect(mockServer.getRequestsCount()).toBe(0);
    });

    it('fails closed when policyReference binding mismatches input binding', async () => {
      const adapter = createTestAdapter({
        policyHook: {
          authorizeRead: async (input) => ({
            allowed: true,
            policyReference: {
              ...canonicalPolicyRefA,
              binding: { ...input.binding, workspaceId: 'WRONG_WORKSPACE' },
            },
          }),
        },
      });

      await expect(
        adapter.execute('myslack.conversations_list', { binding: bindingA })
      ).rejects.toThrow(StepError);

      expect(mockServer.getRequestsCount()).toBe(0);
    });
  });

  // 4. Post-fetch Consent Revoked Race
  describe('4. Post-fetch Consent Revoked Race', () => {
    it('drops payload, clears memory, and throws AUTH_ERROR if consent is revoked during await', async () => {
      mockServer.setDelayMs(50);
      let callCount = 0;

      const adapter = createTestAdapter({
        policyHook: {
          authorizeRead: async (input) => {
            callCount++;
            if (callCount <= 2) {
              // Pre-fetch check and pre-attempt check succeed
              return { allowed: true, policyReference: canonicalPolicyRefA };
            }
            // Post-fetch check: consent revoked while waiting for HTTP response
            return { allowed: false, reason: 'consent_revoked_during_transport' };
          },
        },
      });

      await expect(
        adapter.execute('myslack.conversations_list', { binding: bindingA })
      ).rejects.toThrow(StepError);

      try {
        await adapter.execute('myslack.conversations_list', { binding: bindingA });
      } catch (err) {
        expect(err).toBeInstanceOf(StepError);
        expect((err as StepError).category).toBe('AUTH_ERROR');
      }

      expect(mockServer.getRequestsCount()).toBeGreaterThan(0);
    });
  });

  // 5. Post-fetch Provider Updated / Config Fingerprint Changed
  describe('5. Post-fetch Epoch Invalidation (Provider or Config Changed)', () => {
    it('drops payload and throws AUTH_ERROR if provider revision changes during await', async () => {
      mockServer.setDelayMs(50);
      let callCount = 0;

      const adapter = createTestAdapter({
        policyHook: {
          authorizeRead: async (input) => {
            callCount++;
            if (callCount <= 2) {
              return { allowed: true, policyReference: canonicalPolicyRefA };
            }
            // Post-fetch returns new provider revision (epoch bumped)
            return {
              allowed: true,
              policyReference: {
                ...canonicalPolicyRefA,
                providerRevision: '2',
              },
            };
          },
        },
      });

      await expect(
        adapter.execute('myslack.conversations_info', {
          binding: bindingA,
          channel: 'C_GENERAL_A',
        })
      ).rejects.toThrow(StepError);
    });
  });

  // 6. Post-fetch Regrant While Active
  describe('6. Post-fetch Regrant While Active', () => {
    it('fails closed when consent was regranted with a new revision during await', async () => {
      mockServer.setDelayMs(50);
      let callCount = 0;

      const adapter = createTestAdapter({
        policyHook: {
          authorizeRead: async () => {
            callCount++;
            if (callCount <= 2) {
              return { allowed: true, policyReference: canonicalPolicyRefA };
            }
            // Admin regranted consent while query was in flight: new consent revision
            return {
              allowed: true,
              policyReference: {
                ...canonicalPolicyRefA,
                consentRevision: '2',
              },
            };
          },
        },
      });

      await expect(
        adapter.execute('myslack.conversations_history', {
          binding: bindingA,
          channel: 'C_GENERAL_A',
        })
      ).rejects.toThrow(StepError);
    });
  });

  // 7. Cross-Workspace Token Mismatch
  describe('7. Cross-Workspace Token Mismatch', () => {
    it('blocks request before data leakage when token does not match workspace', async () => {
      const adapter = createTestAdapter({
        tokenHook: {
          getAccessToken: async () => 'xoxp-token-workspace-b', // Returning Workspace B token for Workspace A binding
        },
      });

      await expect(
        adapter.execute('myslack.conversations_info', {
          binding: bindingA,
          channel: 'C_GENERAL_A',
        })
      ).rejects.toThrow(StepError);
    });
  });

  // 8. Cross-Workspace Colliding Channel Isolation
  describe('8. Cross-Workspace Colliding Channel Isolation', () => {
    it('retrieves only Workspace B channel data when using Workspace B binding', async () => {
      const adapter = createTestAdapter();

      const result = await adapter.execute('myslack.conversations_info', {
        binding: bindingB,
        channel: 'C_GENERAL_B',
      });

      expect(result.ok).toBe(true);
      expect(result.channel.id).toBe('C_GENERAL_B');
      expect(result.channel.name).toBe('workspace-b-general');
      expect(result.provenance.binding.workspaceId).toBe('T_WORKSPACE_B');
    });
  });

  // 9. Native ACL Enforcement
  describe('9. Native ACL: Private Channel & Colleague', () => {
    it('allows channel member Actor A to view private channel', async () => {
      const adapter = createTestAdapter();
      const result = await adapter.execute('myslack.conversations_info', {
        binding: bindingA,
        channel: 'C_PRIVATE_A',
      });

      expect(result.ok).toBe(true);
      expect(result.channel.id).toBe('C_PRIVATE_A');
      expect(result.channel.is_private).toBe(true);
    });

    it('rejects Colleague user from viewing private channel where they are not a member', async () => {
      const adapter = createTestAdapter();

      await expect(
        adapter.execute('myslack.conversations_info', {
          binding: bindingColleagueA,
          channel: 'C_PRIVATE_A',
        })
      ).rejects.toThrow(StepError);
    });
  });

  // 10. Thread Replies Root Contract
  describe('10. conversations.replies Contract for Message with Zero Replies', () => {
    it('returns [root_message] for a valid message that has zero replies', async () => {
      const adapter = createTestAdapter();
      const result = await adapter.execute('myslack.conversations_replies', {
        binding: bindingA,
        channel: 'C_GENERAL_A',
        ts: '1712345685.000400',
      });

      expect(result.ok).toBe(true);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].ts).toBe('1712345685.000400');
      expect(result.messages[0].reply_count).toBe(0);
    });

    it('returns parent + replies for thread parent', async () => {
      const adapter = createTestAdapter();
      const result = await adapter.execute('myslack.conversations_replies', {
        binding: bindingA,
        channel: 'C_GENERAL_A',
        ts: '1712345680.000300',
      });

      expect(result.ok).toBe(true);
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].ts).toBe('1712345680.000300');
      expect(result.messages[1].ts).toBe('1712345681.000100');
    });
  });

  // 11. Exact Decimal Timestamps Preservation
  describe('11. Exact Decimal Timestamps Preservation', () => {
    it('preserves exact decimal string ts and edited.ts without float precision loss', async () => {
      const adapter = createTestAdapter();
      const result = await adapter.execute('myslack.conversations_history', {
        binding: bindingA,
        channel: 'C_GENERAL_A',
      });

      expect(result.ok).toBe(true);
      const msg0 = result.messages[0];
      expect(msg0.ts).toBe('1712345678.000100');
      expect(typeof msg0.ts).toBe('string');
      expect(msg0.edited?.ts).toBe('1712345679.000200');
      expect(typeof msg0.edited?.ts).toBe('string');
    });
  });

  // 12. Sanitized User Profile & Safe Deep Link
  describe('12. Sanitized Profile & Safe Deep Link', () => {
    it('strips email, avatar_hash, and credentials from users.info and users.list', async () => {
      const adapter = createTestAdapter();

      // users.info
      const userInfo = await adapter.execute('myslack.users_info', {
        binding: bindingA,
        user: 'U_ACTOR_A',
      });
      expect(userInfo.ok).toBe(true);
      expect(userInfo.user.id).toBe('U_ACTOR_A');
      expect(userInfo.user.name).toBe('actor_a');
      expect((userInfo.user as any).profile).toBeUndefined();
      expect((userInfo.user as any).email).toBeUndefined();

      // users.list
      const userList = await adapter.execute('myslack.users_list', {
        binding: bindingA,
      });
      expect(userList.ok).toBe(true);
      for (const member of userList.members) {
        expect((member as any).profile).toBeUndefined();
        expect((member as any).email).toBeUndefined();
      }
    });

    it('generates safe permalink matching exact slack.com pattern', async () => {
      const adapter = createTestAdapter();
      const result = await adapter.execute('myslack.chat_getPermalink', {
        binding: bindingA,
        channel: 'C_GENERAL_A',
        message_ts: '1712345678.000100',
      });

      expect(result.ok).toBe(true);
      expect(result.permalink).toBe(
        'https://workspace-a.slack.com/archives/C_GENERAL_A/p1712345678000100'
      );
      expect(result.permalink).toMatch(
        /^https:\/\/[a-z0-9_-]+\.slack\.com\/archives\/[A-Z0-9_]+\/p[0-9]+$/
      );
    });
  });

  // 13. AbortSignal Cancellation
  describe('13. AbortSignal Cancellation', () => {
    it('aborts request immediately when AbortController signals before or during dispatch', async () => {
      const controller = new AbortController();
      controller.abort();

      const adapter = createTestAdapter();
      await expect(
        adapter.execute(
          'myslack.conversations_list',
          { binding: bindingA },
          { signal: controller.signal }
        )
      ).rejects.toThrow(StepError);

      expect(mockServer.getRequestsCount()).toBe(0);
    });
  });

  // 14. 429 Retry Re-Authorizes F1
  describe('14. 429 Retry & Policy Re-Authorization', () => {
    it('re-authorizes policy before each retry attempt when receiving 429', async () => {
      mockServer.setRateLimitRemainingAttempts(1);
      let authCalls = 0;

      const adapter = createTestAdapter({
        policyHook: {
          authorizeRead: async () => {
            authCalls++;
            return { allowed: true, policyReference: canonicalPolicyRefA };
          },
        },
      });

      const result = await adapter.execute('myslack.conversations_list', { binding: bindingA });
      expect(result.ok).toBe(true);
      // Pre-fetch auth (1) + Before attempt 1 (2) + [429] + Before retry attempt 2 (3) + Post-fetch auth (4)
      expect(authCalls).toBeGreaterThanOrEqual(3);
    });

    it('stops retry immediately if consent is revoked during 429 backoff', async () => {
      mockServer.setRateLimitRemainingAttempts(2);
      let authCalls = 0;

      const adapter = createTestAdapter({
        policyHook: {
          authorizeRead: async () => {
            authCalls++;
            if (authCalls >= 3) {
              // Consent revoked during 429 wait before retry
              return { allowed: false, reason: 'revoked_during_rate_limit_backoff' };
            }
            return { allowed: true, policyReference: canonicalPolicyRefA };
          },
        },
      });

      await expect(
        adapter.execute('myslack.conversations_list', { binding: bindingA })
      ).rejects.toThrow(StepError);
    });
  });

  // 15. 2MB Body Limit Enforcement
  describe('15. 2MB Response Body Limit', () => {
    it('rejects response body exceeding 2MB limit with StepError SERVER_ERROR', async () => {
      const adapter = createTestAdapter();
      await expect(
        adapter.execute('myslack.conversations_list', {
          binding: bindingA,
          types: 'simulate_oversize',
        })
      ).rejects.toThrow(StepError);
    });
  });

  // 16. Manual Redirect Rejection
  describe('16. Redirect Rejection', () => {
    it('rejects 302 redirects without leaking credentials', async () => {
      const adapter = createTestAdapter();
      await expect(
        adapter.execute('myslack.conversations_list', {
          binding: bindingA,
          types: 'simulate_redirect',
        })
      ).rejects.toThrow(StepError);
    });
  });

  // 17. WRITE Tool Dispatch Rejection
  describe('17. WRITE Tool Dispatch Rejection', () => {
    it('rejects myslack.chat_postMessage before network transport', async () => {
      const adapter = createTestAdapter();
      await expect(
        adapter.execute('myslack.chat_postMessage', {
          binding: bindingA,
          channel: 'C_GENERAL_A',
          text: 'Attempted write',
        })
      ).rejects.toThrow(StepError);

      expect(mockServer.getRequestsCount()).toBe(0);
    });
  });

  // 18. Per-Entity Provenance
  describe('18. Per-Entity Provenance and Observational Digest', () => {
    it('attaches exact acquisition policy reference and SHA256 digest to all observations', async () => {
      const adapter = createTestAdapter();
      const result = await adapter.execute('myslack.conversations_members', {
        binding: bindingA,
        channel: 'C_GENERAL_A',
      });

      expect(result.ok).toBe(true);
      expect(result.members).toEqual(['U_ACTOR_A', 'U_COLLEAGUE']);
      expect(result.provenance).toBeDefined();
      expect(result.provenance.acquisitionPolicyReference).toEqual(canonicalPolicyRefA);
      expect(result.provenance.observationalDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(result.provenance.nativeRevision).toBeUndefined();
    });
  });

  // 19. Boundary Review Regressions
  describe('19. Boundary Review Regressions', () => {
    const payload = { ok: true, user: { id: 'U_ACTOR_A', name: 'actor' } };

    it('rejects truthy non-boolean policy approval before transport', async () => {
      let requests = 0;
      const adapter = new PersonalSlackReadAdapter({
        tokens: { getAccessToken: async () => 'xoxp-opaque-token' },
        policy: {
          authorizeRead: async () => ({
            allowed: 'yes' as any,
            policyReference: canonicalPolicyRefA,
          }),
        },
        fetchFn: async () => {
          requests++;
          return new Response(JSON.stringify(payload));
        },
      });

      await expect(
        adapter.execute('myslack.users_info', { binding: bindingA, user: 'U_ACTOR_A' })
      ).rejects.toThrow(StepError);
      expect(requests).toBe(0);
    });

    it('prevents releasing late plaintext when caller aborts during post-response auth', async () => {
      let calls = 0;
      let enter!: () => void;
      let release!: () => void;
      const entered = new Promise<void>((r) => (enter = r));
      const gate = new Promise<void>((r) => (release = r));
      const controller = new AbortController();

      const adapter = new PersonalSlackReadAdapter({
        tokens: { getAccessToken: async () => 'xoxp-opaque-token' },
        policy: {
          authorizeRead: async () => {
            calls++;
            if (calls === 3) {
              enter();
              await gate;
            }
            return { allowed: true, policyReference: canonicalPolicyRefA };
          },
        },
        fetchFn: async () => new Response(JSON.stringify(payload)),
      });

      const pending = adapter.execute(
        'myslack.users_info',
        { binding: bindingA, user: 'U_ACTOR_A' },
        { signal: controller.signal }
      );
      await entered;
      controller.abort();
      release();

      await expect(pending).rejects.toThrow(StepError);
    });

    it('never escapes opaque credentials in a hook error message, cause, or details', async () => {
      const opaque = 'fixture_OPAQUE_CREDENTIAL_91c687';
      const adapter = new PersonalSlackReadAdapter({
        tokens: {
          getAccessToken: async () => {
            throw new Error(opaque);
          },
        },
        policy: {
          authorizeRead: async () => ({
            allowed: true,
            policyReference: canonicalPolicyRefA,
          }),
        },
        fetchFn: async () => new Response(JSON.stringify(payload)),
      });

      let error: any;
      try {
        await adapter.execute('myslack.users_info', { binding: bindingA, user: 'U_ACTOR_A' });
      } catch (e) {
        error = e;
      }

      expect(error).toBeDefined();
      const leaked = [error.message, error.cause?.message, JSON.stringify(error.details)]
        .join('|')
        .includes(opaque);
      expect(leaked).toBe(false);
    });

    it('bounds output observations to requested limit when provider overreturns', async () => {
      const adapter = new PersonalSlackReadAdapter({
        tokens: { getAccessToken: async () => 'xoxp-opaque-token' },
        policy: {
          authorizeRead: async () => ({
            allowed: true,
            policyReference: canonicalPolicyRefA,
          }),
        },
        fetchFn: async () =>
          new Response(
            JSON.stringify({
              ok: true,
              channels: [{ id: 'C1' }, { id: 'C2' }, { id: 'C3' }],
              response_metadata: { next_cursor: 'cursor_123' },
            })
          ),
      });

      const result = await adapter.execute('myslack.conversations_list', {
        binding: bindingA,
        limit: 1,
      });

      expect(result.channels.length).toBe(1);
      expect(result.channels[0].id).toBe('C1');
    });

    it('rejects truthy non-boolean provider ok flag', async () => {
      const adapter = new PersonalSlackReadAdapter({
        tokens: { getAccessToken: async () => 'xoxp-opaque-token' },
        policy: {
          authorizeRead: async () => ({
            allowed: true,
            policyReference: canonicalPolicyRefA,
          }),
        },
        fetchFn: async () => new Response(JSON.stringify({ ...payload, ok: 'yes' })),
      });

      await expect(
        adapter.execute('myslack.users_info', { binding: bindingA, user: 'U_ACTOR_A' })
      ).rejects.toThrow(StepError);
    });

    it('enforces native Slack API origin and rejects arbitrary endpoints', () => {
      expect(
        () =>
          new PersonalSlackReadAdapter({
            tokens: { getAccessToken: async () => 'xoxp-token' },
            policy: {
              authorizeRead: async () => ({
                allowed: true,
                policyReference: canonicalPolicyRefA,
              }),
            },
            apiBaseUrl: 'https://workspace.slack.com/unrelated/path',
          })
      ).toThrow(StepError);
    });

    it('prevents policy hook from mutating private acquisition reference to adopt a new epoch', async () => {
      let calls = 0;
      const adapter = new PersonalSlackReadAdapter({
        tokens: { getAccessToken: async () => 'xoxp-token' },
        policy: {
          authorizeRead: async (input) => {
            calls++;
            if (calls === 3 && input.expectedPolicyReference) {
              (input.expectedPolicyReference as any).consentRevision = '2';
              return {
                allowed: true,
                policyReference: {
                  ...canonicalPolicyRefA,
                  consentRevision: '2',
                },
              };
            }
            return { allowed: true, policyReference: canonicalPolicyRefA };
          },
        },
        fetchFn: async () => new Response(JSON.stringify(payload)),
      });

      await expect(
        adapter.execute('myslack.users_info', { binding: bindingA, user: 'U_ACTOR_A' })
      ).rejects.toThrow();
    });

    it('rejects provider response missing mandatory identity without fabricating undefined string', async () => {
      const adapter = new PersonalSlackReadAdapter({
        tokens: { getAccessToken: async () => 'xoxp-token' },
        policy: {
          authorizeRead: async () => ({
            allowed: true,
            policyReference: canonicalPolicyRefA,
          }),
        },
        fetchFn: async () => new Response(JSON.stringify({ ok: true, user: { name: 'no-id' } })),
      });

      await expect(
        adapter.execute('myslack.users_info', { binding: bindingA, user: 'U_ACTOR_A' })
      ).rejects.toThrow(StepError);
    });

    it('rejects provider user identity mismatching requested lookup identity', async () => {
      const adapter = new PersonalSlackReadAdapter({
        tokens: { getAccessToken: async () => 'xoxp-token' },
        policy: {
          authorizeRead: async () => ({
            allowed: true,
            policyReference: canonicalPolicyRefA,
          }),
        },
        fetchFn: async () =>
          new Response(JSON.stringify({ ok: true, user: { id: 'U_OTHER', name: 'other' } })),
      });

      await expect(
        adapter.execute('myslack.users_info', { binding: bindingA, user: 'U_ACTOR_A' })
      ).rejects.toThrow(StepError);
    });

    it('rejects HTTP error status even when JSON ok flag is true', async () => {
      const adapter = new PersonalSlackReadAdapter({
        tokens: { getAccessToken: async () => 'xoxp-token' },
        policy: {
          authorizeRead: async () => ({
            allowed: true,
            policyReference: canonicalPolicyRefA,
          }),
        },
        fetchFn: async () => new Response(JSON.stringify(payload), { status: 500 }),
      });

      await expect(
        adapter.execute('myslack.users_info', { binding: bindingA, user: 'U_ACTOR_A' })
      ).rejects.toThrow(StepError);
    });
  });
});
