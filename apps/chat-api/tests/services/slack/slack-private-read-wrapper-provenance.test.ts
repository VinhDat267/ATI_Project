import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PersonalSlackReadAdapter, type PersonalSlackReadAdapterConfig } from '@wap/tool-adapters';
import { slackPolicyRefToEpoch, type SlackBinding } from '@wap/tool-schemas';
import type { SlackPrivateReadRequest } from '../../../src/services/slack/slack-private-read-wrapper.js';
import type { InvalidationEffect } from '../../../src/services/slack/slack-invalidation-service.js';
import {
  createSlackReadEnvironment,
  TEST_ENV,
  type SeededUser,
  type SlackReadEnvironment,
} from '../../helpers/slack-private-read-fixture.js';

let env: SlackReadEnvironment;
let alice: SeededUser;
let bob: SeededUser;

const aliceRead = (overrides: Record<string, unknown> = {}): SlackPrivateReadRequest => ({
  callerAtiUserId: alice.person.id,
  binding: alice.binding,
  tool: 'myslack.conversations_history',
  params: { channel: 'C_GENERAL' },
  purpose: 'manual_lookup',
  ...overrides,
});

const bobRead = (overrides: Record<string, unknown> = {}): SlackPrivateReadRequest => ({
  callerAtiUserId: bob.person.id,
  binding: bob.binding,
  tool: 'myslack.conversations_history',
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

const bindingEffect = (binding: SlackBinding, reason = 'test_binding_barrier'): InvalidationEffect => ({
  effectKey: 'binding',
  barrier: { barrierType: 'binding', binding, reason },
});

const channelEffect = (
  binding: SlackBinding,
  channelId: string,
  reason = 'test_channel_barrier'
): InvalidationEffect => ({
  effectKey: 'channel',
  barrier: { barrierType: 'channel', binding, channelId, reason },
});

const provisionalEffect = (binding: SlackBinding): InvalidationEffect => ({
  effectKey: 'provisional',
  barrier: {
    barrierType: 'provisional_auth',
    binding,
    sourceEventKey: 'slack:test:provisional',
    provisionalAction: 'test_action',
    reason: 'test_provisional_barrier',
  },
});

const epochEffect = (epoch: ReturnType<typeof slackPolicyRefToEpoch>): InvalidationEffect => ({
  effectKey: 'epoch',
  barrier: { barrierType: 'epoch', epoch, reason: 'test_epoch_barrier' },
});

const resourceEffect = (
  workspaceId: string,
  resourceType: 'conversation' | 'message' | 'user',
  resourceId: string,
  extra: { deleted?: boolean; minValidRevision?: string } = {}
): InvalidationEffect => ({
  effectKey: `resource:${resourceType}:${resourceId}:${extra.deleted ? 'deleted' : extra.minValidRevision ?? 'active'}`,
  barrier: {
    barrierType: 'resource',
    workspaceId,
    resourceType,
    resourceId,
    ...extra,
    reason: 'test_resource_barrier',
  },
});

const messageResourceId = (channelId: string, ts: string) => JSON.stringify([channelId, ts]);

/** A real adapter whose returned page is mutated after the provider response. */
function adapterWithMutation(mutate: (data: any) => void) {
  return (config: PersonalSlackReadAdapterConfig) => {
    const real = new PersonalSlackReadAdapter(config);
    return {
      execute: async (toolName: string, args: Record<string, any>, context?: any) => {
        const result = structuredClone(await real.execute(toolName, args, context));
        mutate(result);
        return result;
      },
    };
  };
}

/** A real adapter with a side effect that commits after the provider response. */
function adapterWithPostReadEffect(effect: () => Promise<void>) {
  return (config: PersonalSlackReadAdapterConfig) => {
    const real = new PersonalSlackReadAdapter(config);
    return {
      execute: async (toolName: string, args: Record<string, any>, context?: any) => {
        const result = await real.execute(toolName, args, context);
        await effect();
        return result;
      },
    };
  };
}

beforeAll(async () => {
  env = await createSlackReadEnvironment('slack_read_provenance');
  alice = await env.addUser({
    name: 'iso-alice',
    workspaceId: 'T_WS_ISO_A',
    actorId: 'U_ISO_A',
    accessToken: 'xoxp-iso-alice-secret',
  });
  bob = await env.addUser({
    name: 'iso-bob',
    workspaceId: 'T_WS_ISO_B',
    actorId: 'U_ISO_B',
    accessToken: 'xoxp-iso-bob-secret',
  });
}, 60_000);

afterAll(async () => {
  await env.close();
});

beforeEach(async () => {
  env.fixture.reset();
  env.fixture.clearHandlers();
  await env.clearBarriers();
});

describe('pre-invocation barriers', () => {
  it('blocks binding, provisional, and exact-epoch barriers before token or transport', async () => {
    const { wrapper, tokenCalls } = env.buildWrapper();

    await env.stageBarriers([bindingEffect(alice.binding)]);
    const bindingError = await capture(wrapper.executeRead(aliceRead()));
    expect(bindingError.code).toBe('SLACK_READ_BARRIERED');
    expect(tokenCalls).toHaveLength(0);

    await env.clearBarriers();
    await env.stageBarriers([provisionalEffect(alice.binding)]);
    const provisionalError = await capture(wrapper.executeRead(aliceRead()));
    expect(provisionalError.code).toBe('SLACK_READ_BARRIERED');
    expect(tokenCalls).toHaveLength(0);

    await env.clearBarriers();
    const ref = await env.canonicalRef(alice.binding);
    await env.stageBarriers([epochEffect(slackPolicyRefToEpoch(ref))]);
    const epochError = await capture(wrapper.executeRead(aliceRead()));
    expect(epochError.code).toBe('SLACK_READ_BARRIERED');
    expect(tokenCalls).toHaveLength(0);

    expect(env.fixture.gets).toHaveLength(0);
  });

  it('does not block a different policy epoch', async () => {
    const ref = await env.canonicalRef(alice.binding);
    const otherEpoch = { ...slackPolicyRefToEpoch(ref), consentRevision: '999' };
    await env.stageBarriers([epochEffect(otherEpoch)]);

    const { wrapper, tokenCalls } = env.buildWrapper();
    const allowed = await wrapper.executeRead(aliceRead());
    expect(allowed.data).toHaveProperty('messages.0.ts', '1712345678.000200');
    expect(tokenCalls).toHaveLength(1);
    expect(env.fixture.gets).toHaveLength(1);
  });

  it('blocks request-known channels, conversations, and message resources before token', async () => {
    const { wrapper, tokenCalls } = env.buildWrapper();

    await env.stageBarriers([channelEffect(alice.binding, 'C_PRIVATE')]);
    const channelError = await capture(
      wrapper.executeRead(aliceRead({ tool: 'myslack.conversations_info', params: { channel: 'C_PRIVATE' } }))
    );
    expect(channelError.code).toBe('SLACK_READ_BARRIERED');
    expect(tokenCalls).toHaveLength(0);

    await env.clearBarriers();
    await env.stageBarriers([
      resourceEffect(alice.binding.workspaceId, 'message', messageResourceId('C_GENERAL', '1712345678.000200'), {
        deleted: true,
      }),
    ]);
    const replyError = await capture(
      wrapper.executeRead(
        aliceRead({
          tool: 'myslack.conversations_replies',
          params: { channel: 'C_GENERAL', ts: '1712345678.000200' },
        })
      )
    );
    expect(replyError.code).toBe('SLACK_READ_BARRIERED');
    expect(tokenCalls).toHaveLength(0);

    await env.clearBarriers();
    await env.stageBarriers([
      resourceEffect(alice.binding.workspaceId, 'message', messageResourceId('C_GENERAL', '1712345678.000200'), {
        deleted: true,
      }),
    ]);
    const permalinkError = await capture(
      wrapper.executeRead(
        aliceRead({
          tool: 'myslack.chat_getPermalink',
          params: { channel: 'C_GENERAL', message_ts: '1712345678.000200' },
        })
      )
    );
    expect(permalinkError.code).toBe('SLACK_READ_BARRIERED');
    expect(tokenCalls).toHaveLength(0);

    await env.clearBarriers();
    await env.stageBarriers([
      resourceEffect(alice.binding.workspaceId, 'message', messageResourceId('C_GENERAL', '1712345678.000200'), {
        minValidRevision: '9999999999.000000',
      }),
    ]);
    const staleRoot = await capture(
      wrapper.executeRead(
        aliceRead({
          tool: 'myslack.conversations_replies',
          params: { channel: 'C_GENERAL', ts: '1712345678.000200' },
        })
      )
    );
    expect(staleRoot.code).toBe('SLACK_READ_BARRIERED');
    expect(tokenCalls).toHaveLength(0);
    expect(env.fixture.gets).toHaveLength(0);
  });

  it('uses the exact composite message id, so underscore and timestamp-only decoys do not block', async () => {
    await env.stageBarriers([
      resourceEffect(alice.binding.workspaceId, 'message', 'C_GENERAL_1712345678.000200', { deleted: true }),
      resourceEffect(alice.binding.workspaceId, 'message', '1712345678.000200', { deleted: true }),
    ]);
    const { wrapper, tokenCalls } = env.buildWrapper();
    const result = await wrapper.executeRead(
      aliceRead({
        tool: 'myslack.conversations_replies',
        params: { channel: 'C_GENERAL', ts: '1712345678.000200' },
      })
    );
    expect(result.data).toHaveProperty('messages.0.ts', '1712345678.000200');
    expect(tokenCalls).toHaveLength(1);
    expect(env.fixture.gets).toHaveLength(1);
  });
});

describe('post-response barriers', () => {
  it('blocks a page when a message barrier is staged after the provider response', async () => {
    env.fixture.setHandler('/conversations.history', async () => {
      await env.stageBarriers([
        resourceEffect(alice.binding.workspaceId, 'message', messageResourceId('C_GENERAL', '1712345678.000300'), {
          deleted: true,
        }),
      ]);
      return {
        body: {
          ok: true,
          messages: [
            { type: 'message', user: 'U_ISO_A', text: 'one', ts: '1712345678.000200' },
            { type: 'message', user: 'U_ISO_A', text: 'two', ts: '1712345678.000300' },
          ],
        },
      };
    });

    const { wrapper } = env.buildWrapper();
    const error = await capture(wrapper.executeRead(aliceRead()));
    expect(error.code).toBe('SLACK_READ_BARRIERED');
    expect(env.fixture.gets).toHaveLength(1);
  });

  it('blocks a page when a channel barrier is staged after the provider response', async () => {
    env.fixture.setHandler('/conversations.history', async () => {
      await env.stageBarriers([channelEffect(alice.binding, 'C_GENERAL')]);
      return {
        body: {
          ok: true,
          messages: [{ type: 'message', user: 'U_ISO_A', text: 'one', ts: '1712345678.000200' }],
        },
      };
    });
    const { wrapper } = env.buildWrapper();
    const error = await capture(wrapper.executeRead(aliceRead()));
    expect(error.code).toBe('SLACK_READ_BARRIERED');
  });

  it('blocks members pages when an observed user has a resource barrier, after the fetch', async () => {
    await env.stageBarriers([
      resourceEffect(alice.binding.workspaceId, 'user', 'U_BOB', { deleted: true }),
    ]);
    const { wrapper, tokenCalls } = env.buildWrapper();
    const error = await capture(
      wrapper.executeRead(
        aliceRead({ tool: 'myslack.conversations_members', params: { channel: 'C_GENERAL' } })
      )
    );
    expect(error.code).toBe('SLACK_READ_BARRIERED');
    expect(tokenCalls).toHaveLength(1);
    expect(env.fixture.gets).toHaveLength(1);
  });

  it('blocks users.list pages when any observed user is barriered', async () => {
    await env.stageBarriers([
      resourceEffect(alice.binding.workspaceId, 'user', 'U_BOB', { deleted: true }),
    ]);
    const { wrapper } = env.buildWrapper();
    const error = await capture(
      wrapper.executeRead(aliceRead({ tool: 'myslack.users_list', params: {} }))
    );
    expect(error.code).toBe('SLACK_READ_BARRIERED');
  });
});

describe('tampered provenance', () => {
  const entityMutations: Array<[string, (data: any) => void]> = [
    ['entity binding', (data) => { data.messages[0].provenance.binding.identityVersion += 1; }],
    ['entity workspace', (data) => { data.messages[0].provenance.binding.workspaceId = 'T_FORGED'; }],
    ['entity consent revision', (data) => { data.messages[0].provenance.acquisitionPolicyReference.consentRevision = '999'; }],
    ['entity policy version', (data) => { data.messages[0].provenance.acquisitionPolicyReference.policyVersion = 'v9.9.9'; }],
    ['entity native revision', (data) => { data.messages[0].provenance.nativeRevision = '1712345678.999999'; }],
    ['entity resource identity', (data) => { data.messages[0].provenance.resourceIdentity.messageTs = '1712345678.999999'; }],
    ['entity digest', (data) => { data.messages[0].provenance.observationalDigest = 'not-a-digest'; }],
    ['entity observedAt', (data) => { data.messages[0].provenance.observedAt = 'yesterday'; }],
  ];

  for (const [label, mutate] of entityMutations) {
    it(`rejects a tampered ${label}`, async () => {
      const { wrapper } = env.buildWrapper({ createAdapter: adapterWithMutation(mutate) });
      const error = await capture(wrapper.executeRead(aliceRead()));
      expect(error.code).toBe('SLACK_READ_PROVENANCE_INVALID');
    });
  }

  const containerMutations: Array<[string, (data: any) => void]> = [
    ['container channel', (data) => { data.provenance.resourceIdentity.channelId = 'C_OTHER'; }],
    ['container binding', (data) => { data.provenance.binding.workspaceId = 'T_FORGED'; }],
    ['container reference', (data) => { data.provenance.acquisitionPolicyReference.consentRevision = '999'; }],
    ['container digest', (data) => { data.provenance.observationalDigest = 'abc'; }],
    ['container observedAt', (data) => { data.provenance.observedAt = 'not-a-date'; }],
  ];

  for (const [label, mutate] of containerMutations) {
    it(`rejects a tampered ${label}`, async () => {
      const { wrapper } = env.buildWrapper({ createAdapter: adapterWithMutation(mutate) });
      const error = await capture(wrapper.executeRead(aliceRead()));
      expect(error.code).toBe('SLACK_READ_PROVENANCE_INVALID');
    });
  }

  it('rejects a permalink whose observed channel was relabeled', async () => {
    const { wrapper } = env.buildWrapper({
      createAdapter: adapterWithMutation((data) => {
        data.channel = 'C_OTHER';
      }),
    });
    const error = await capture(
      wrapper.executeRead(
        aliceRead({
          tool: 'myslack.chat_getPermalink',
          params: { channel: 'C_GENERAL', message_ts: '1712345678.000200' },
        })
      )
    );
    expect(error.code).toBe('SLACK_READ_PROVENANCE_INVALID');
  });

  it('rejects a response with no provenance proof at all', async () => {
    const { wrapper, tokenCalls } = env.buildWrapper({
      createAdapter: () => ({
        execute: async () => ({ ok: true, channel: { id: 'C_GENERAL', name: 'general' } }),
      }),
    });
    const error = await capture(
      wrapper.executeRead(aliceRead({ tool: 'myslack.conversations_info', params: { channel: 'C_GENERAL' } }))
    );
    expect(error.code).toBe('SLACK_READ_PROVENANCE_INVALID');
    expect(tokenCalls).toHaveLength(0);
    expect(env.fixture.gets).toHaveLength(0);
  });
});

describe('policy changes between response and validation', () => {
  it('rejects the page when consent is revoked after the provider response', async () => {
    const { wrapper } = env.buildWrapper({
      createAdapter: adapterWithPostReadEffect(async () => {
        const current = await env.consentRepo.getConsent('T_WS_ISO_A', env.runtimeIdentity.providerId);
        await env.consentRepo.revokeConsent({
          workspaceId: 'T_WS_ISO_A',
          providerId: env.runtimeIdentity.providerId,
          recordedBy: 'test@example.com',
          reason: 'late_revocation',
          expectedRevision: current!.revision,
        });
      }),
    });

    try {
      const error = await capture(wrapper.executeRead(aliceRead()));
      expect(error.code).toBe('SLACK_READ_POLICY_DENIED');
    } finally {
      const current = await env.consentRepo.getConsent('T_WS_ISO_A', env.runtimeIdentity.providerId);
      if (current?.status !== 'granted') {
        await env.consentRepo.grantConsent({
          workspaceId: 'T_WS_ISO_A',
          providerId: env.runtimeIdentity.providerId,
          policyVersion: 'v1.0.0',
          purposes: ['manual_lookup', 'triage', 'planning', 'digest'],
          retentionDays: 14,
          organizationRepresentative: 'Representative',
          evidenceRef: 'DPA-RESTORE',
          recordedBy: 'test@example.com',
          expectedRevision: current!.revision,
        });
      }
    }
  });

  it('rejects a fresh-grant relabel of the observation reference', async () => {
    const { wrapper } = env.buildWrapper({
      createAdapter: (config) => {
        const adapter = new PersonalSlackReadAdapter(config);
        return {
          execute: async (toolName: string, args: Record<string, any>, context?: any) => {
            const result = structuredClone(await adapter.execute(toolName, args, context));
            const current = await env.consentRepo.getConsent('T_WS_ISO_A', env.runtimeIdentity.providerId);
            await env.consentRepo.revokeConsent({
              workspaceId: 'T_WS_ISO_A',
              providerId: env.runtimeIdentity.providerId,
              recordedBy: 'test@example.com',
              reason: 'relabel_test',
              expectedRevision: current!.revision,
            });
            const revoked = await env.consentRepo.getConsent('T_WS_ISO_A', env.runtimeIdentity.providerId);
            await env.consentRepo.grantConsent({
              workspaceId: 'T_WS_ISO_A',
              providerId: env.runtimeIdentity.providerId,
              policyVersion: 'v1.0.0',
              purposes: ['manual_lookup', 'triage', 'planning', 'digest'],
              retentionDays: 14,
              organizationRepresentative: 'Representative',
              evidenceRef: 'DPA-RELABEL',
              recordedBy: 'test@example.com',
              expectedRevision: revoked!.revision,
            });
            const fresh = await env.canonicalRef(alice.binding);
            // A fresh grant must not resurrect or relabel the old observation: the
            // provenance now carries the new revision, which cannot match the
            // reference pinned before the read.
            for (const message of result.messages) {
              message.provenance.acquisitionPolicyReference = structuredClone(fresh);
            }
            result.provenance.acquisitionPolicyReference = structuredClone(fresh);
            return result;
          },
        };
      },
    });

    try {
      const error = await capture(wrapper.executeRead(aliceRead()));
      expect(error.code).toBe('SLACK_READ_PROVENANCE_INVALID');
    } finally {
      const current = await env.consentRepo.getConsent('T_WS_ISO_A', env.runtimeIdentity.providerId);
      if (current?.status !== 'granted') {
        await env.consentRepo.grantConsent({
          workspaceId: 'T_WS_ISO_A',
          providerId: env.runtimeIdentity.providerId,
          policyVersion: 'v1.0.0',
          purposes: ['manual_lookup', 'triage', 'planning', 'digest'],
          retentionDays: 14,
          organizationRepresentative: 'Representative',
          evidenceRef: 'DPA-RESTORE',
          recordedBy: 'test@example.com',
          expectedRevision: current!.revision,
        });
      }
    }
  });
});

describe('concurrent workspace isolation and retry reauthorization', () => {
  it('isolates tokens and provenance for two workspaces sharing channel and timestamp ids', async () => {
    env.fixture.setHandler('/conversations.history', (request) => {
      if (request.authorization === 'Bearer xoxp-iso-alice-secret') {
        return {
          body: {
            ok: true,
            messages: [{ type: 'message', user: 'U_ISO_A', text: 'ALICE-PRIVATE', ts: '1712345678.000200' }],
          },
        };
      }
      if (request.authorization === 'Bearer xoxp-iso-bob-secret') {
        return {
          body: {
            ok: true,
            messages: [{ type: 'message', user: 'U_ISO_B', text: 'BOB-PRIVATE', ts: '1712345678.000200' }],
          },
        };
      }
      return { status: 401, body: { ok: false, error: 'invalid_auth' } };
    });

    const { wrapper } = env.buildWrapper();
    const [aliceResult, bobResult] = await Promise.all([
      wrapper.executeRead(aliceRead({ params: { channel: 'C_SHARED' } })),
      wrapper.executeRead(bobRead({ params: { channel: 'C_SHARED' } })),
    ]);

    expect(aliceResult.data).toHaveProperty('messages.0.text', 'ALICE-PRIVATE');
    expect(aliceResult.data).toHaveProperty('messages.0.provenance.binding', alice.binding);
    expect(bobResult.data).toHaveProperty('messages.0.text', 'BOB-PRIVATE');
    expect(bobResult.data).toHaveProperty('messages.0.provenance.binding', bob.binding);

    const authorizations = env.fixture.gets.map((request) => request.authorization);
    expect(authorizations).toContain('Bearer xoxp-iso-alice-secret');
    expect(authorizations).toContain('Bearer xoxp-iso-bob-secret');

    await env.stageBarriers([
      resourceEffect('T_WS_ISO_A', 'message', messageResourceId('C_SHARED', '1712345678.000200'), {
        deleted: true,
      }),
    ]);
    const getsBefore = env.fixture.gets.length;
    const aliceBlocked = await capture(wrapper.executeRead(aliceRead({ params: { channel: 'C_SHARED' } })));
    expect(aliceBlocked.code).toBe('SLACK_READ_BARRIERED');
    expect(env.fixture.gets.length).toBe(getsBefore + 1);

    const bobAllowed = await wrapper.executeRead(bobRead({ params: { channel: 'C_SHARED' } }));
    expect(bobAllowed.data).toHaveProperty('messages.0.text', 'BOB-PRIVATE');
  });

  it('re-authorizes a 429 retry and blocks when a channel barrier lands mid-flight', async () => {
    let calls = 0;
    env.fixture.setHandler('/conversations.history', async () => {
      calls += 1;
      if (calls === 1) {
        await env.stageBarriers([channelEffect(alice.binding, 'C_GENERAL')]);
        return { status: 429, headers: { 'retry-after': '0' }, body: { ok: false, error: 'ratelimited' } };
      }
      return {
        body: {
          ok: true,
          messages: [{ type: 'message', user: 'U_ISO_A', text: 'should-not-return', ts: '1712345678.000200' }],
        },
      };
    });

    const { wrapper, tokenCalls } = env.buildWrapper();
    const error = await capture(wrapper.executeRead(aliceRead()));
    expect(error.code).toBe('SLACK_READ_BARRIERED');
    expect(calls).toBe(1);
    expect(env.fixture.gets).toHaveLength(1);
    expect(tokenCalls).toHaveLength(1);
  });
});

describe('environment guard', () => {
  it('holds the observed-resource lock through final authorization and orders a real concurrent invalidation after the read', async () => {
    const stager = await env.db.pool.connect();
    const pid = (await stager.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    let providerFinished = false;
    let staging: Promise<void> | undefined;
    const { wrapper } = env.buildWrapper({
      createAdapter: adapterWithPostReadEffect(async () => { providerFinished = true; }),
      policyService: { resolveSlackModelPolicy: async input => {
        if (providerFinished && !staging) {
          staging = (async () => {
            await stager.query('BEGIN');
            await stager.query("SET LOCAL lock_timeout='2s'");
            await env.invalidationService.stageInTransaction(stager, {
              sourceEventKey: `read-order:${pid}`,
              effects: [resourceEffect(alice.binding.workspaceId, 'message',
                messageResourceId('C_GENERAL', '1712345678.000200'), { deleted: true })],
            });
            await stager.query('COMMIT');
          })();
          staging.catch(() => {});
          const start = Date.now();
          while (true) {
            const observed = await env.db.pool.query(
              'SELECT wait_event_type, wait_event FROM pg_stat_activity WHERE pid=$1', [pid]);
            if (observed.rows[0]?.wait_event_type === 'Lock' && observed.rows[0]?.wait_event === 'advisory') break;
            if (Date.now() - start > 1_000) throw new Error('stager never waited on the actual observed-resource lock');
            await new Promise(resolve => setTimeout(resolve, 5));
          }
        }
        return env.policyService.resolveSlackModelPolicy(input);
      } },
    });
    try {
      const result = await wrapper.executeRead(aliceRead());
      expect(result.data).toHaveProperty('messages.0.ts', '1712345678.000200');
      await staging;
      expect((await env.invalidationService.checkBarriers({ workspaceId: alice.binding.workspaceId,
        resourceType: 'message', resourceId: messageResourceId('C_GENERAL', '1712345678.000200'),
        revision: '1712345678.000200' })).blocked).toBe(true);
      expect((await capture(wrapper.executeRead(aliceRead()))).code).toBe('SLACK_READ_BARRIERED');
    } finally {
      await staging?.catch(() => {});
      await stager.query('ROLLBACK');
      stager.release();
    }
  });

  it('never returns a message invalidated during an awaited final authorization', async () => {
    let providerFinished = false;
    let staged: Promise<void> | undefined;
    const { wrapper } = env.buildWrapper({
      deadlineMs: 500,
      createAdapter: adapterWithPostReadEffect(async () => { providerFinished = true; }),
      policyService: { resolveSlackModelPolicy: async input => {
        if (providerFinished && !staged) {
          staged = env.stageBarriers([resourceEffect(alice.binding.workspaceId, 'message',
            messageResourceId('C_GENERAL', '1712345678.000200'), { deleted: true })]);
          await staged;
        }
        return env.policyService.resolveSlackModelPolicy(input);
      } },
    });
    try {
      const outcome = await wrapper.executeRead(aliceRead()).then(() => 'STALE_RETURNED',
        (error: { code: string }) => error.code);
      expect(['SLACK_READ_BARRIERED', 'SLACK_READ_DEADLINE_EXCEEDED']).toContain(outcome);
    } finally {
      await staged;
    }
    expect((await env.invalidationService.checkBarriers({ workspaceId: alice.binding.workspaceId,
      resourceType: 'message', resourceId: messageResourceId('C_GENERAL', '1712345678.000200'),
      revision: '1712345678.000200' })).blocked).toBe(true);
  });

  it('keeps policy and feature flag config in the injected runtime object', async () => {
    const { wrapper } = env.buildWrapper({
      runtimeConfig: { env: { ...TEST_ENV, MYSLACK_ENABLED: 'on' } },
    });
    const result = await wrapper.executeRead(aliceRead());
    expect(result.policyReference.providerProfileId).toBe(env.runtimeIdentity.providerId);
  });
});
