import type pg from 'pg';
import {
  MYSLACK_CORE_READ_TOOLS,
  slackPolicyRefToEpoch,
  validateSlackBinding,
  validateSlackPolicyReference,
  validateSlackToolExecutionArgs,
  type SlackBinding,
  type SlackPolicyReference,
  type SlackToolDefinition,
} from '@wap/tool-schemas';
import {
  PersonalSlackReadAdapter,
  StepError,
  type PersonalSlackReadAdapterConfig,
  type SlackAuthorizeReadInput,
  type SlackPolicyHookDecision,
  type SlackReadPurpose,
} from '@wap/tool-adapters';
import type { SlackConnectionRepo } from '../../db/repositories/slack-connection-repo.js';
import type { SlackPolicyService } from './policy-service.js';
import type { SlackTokenManager } from './token-manager.js';
import type { CheckBarriersQuery, SlackInvalidationService } from './slack-invalidation-service.js';
import { acquireSlackInvalidationLocks, slackInvalidationLockKeys } from './slack-invalidation-service.js';

/**
 * Fixed, caller-safe error codes for the private Slack read wrapper. The message is the
 * code itself: provider text, credentials, cursors, payloads, causes and details never
 * leave this module.
 */
export type SlackPrivateReadErrorCode =
  | 'SLACK_READ_DISABLED'
  | 'SLACK_READ_INVALID_REQUEST'
  | 'SLACK_READ_INVALID_CONFIG'
  | 'SLACK_READ_IDENTITY_MISMATCH'
  | 'SLACK_READ_POLICY_DENIED'
  | 'SLACK_READ_BARRIERED'
  | 'SLACK_READ_EPOCH_CHANGED'
  | 'SLACK_READ_TOKEN_UNAVAILABLE'
  | 'SLACK_READ_AUTHORIZATION_FAILED'
  | 'SLACK_READ_NOT_FOUND'
  | 'SLACK_READ_RATE_LIMITED'
  | 'SLACK_READ_PROVIDER_ERROR'
  | 'SLACK_READ_PROVENANCE_INVALID'
  | 'SLACK_READ_ABORTED'
  | 'SLACK_READ_DEADLINE_EXCEEDED'
  | 'SLACK_READ_INTERNAL';

export class SlackPrivateReadError extends Error {
  readonly code: SlackPrivateReadErrorCode;

  constructor(code: SlackPrivateReadErrorCode) {
    super(code);
    this.name = 'SlackPrivateReadError';
    this.code = code;
  }
}

export interface SlackReadAdapterLike {
  execute(toolName: string, args: Record<string, any>, context?: any): Promise<any>;
}

export interface SlackPrivateReadWrapperDeps {
  policyService: Pick<SlackPolicyService, 'resolveSlackModelPolicy'>;
  tokenManager: Pick<SlackTokenManager, 'getAccessToken'>;
  invalidationService: Pick<SlackInvalidationService, 'checkBarriers'>;
  ownerGate: Pick<SlackConnectionRepo, 'withOwner'>;
  runtimeConfig?: { env?: Record<string, string | undefined> };
  apiBaseUrl?: string;
  fetchFn?: typeof fetch;
  requestTimeoutMs?: number;
  deadlineMs?: number;
  createAdapter?: (
    config: PersonalSlackReadAdapterConfig
  ) => SlackReadAdapterLike | Promise<SlackReadAdapterLike>;
}

export interface SlackPrivateReadRequest {
  callerAtiUserId: string;
  binding: SlackBinding;
  tool: string;
  params: Record<string, unknown>;
  purpose: SlackReadPurpose;
  signal?: AbortSignal;
}

export interface SlackPrivateReadResult {
  tool: string;
  data: unknown;
  policyReference: SlackPolicyReference;
}

const READ_PURPOSES = new Set<string>(['manual_lookup', 'triage', 'planning', 'digest']);
const REQUEST_KEYS = new Set<string>([
  'callerAtiUserId',
  'binding',
  'tool',
  'params',
  'purpose',
  'signal',
]);
const DEFAULT_API_BASE_URL = 'https://slack.com/api';
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_DEADLINE_MS = 15_000;
const MAX_TIMER_MS = 2_147_483_647;
const MAX_ID_LENGTH = 128;
const MAX_TOKEN_LENGTH = 4096;
const SLACK_TS_REGEX = /^\d{10}\.\d{6}$/;
const DIGEST_REGEX = /^[0-9a-f]{64}$/;

type JsonObject = Record<string, unknown>;

type BarrierResourceType = 'conversation' | 'message' | 'user';

interface BarrierResource {
  type: BarrierResourceType;
  id: string;
  revision?: string;
}

interface RequestFacts {
  channelId?: string;
  resources: BarrierResource[];
}

interface ObservationIdentity {
  type: 'conversation' | 'message' | 'members' | 'user' | 'users' | 'permalink';
  channelId?: string;
  messageTs?: string;
  userId?: string;
}

interface ObservationProvenance {
  binding: SlackBinding;
  resourceIdentity: ObservationIdentity;
  observedAt: string;
  acquisitionPolicyReference: SlackPolicyReference;
  nativeRevision?: string;
  observationalDigest: string;
}

function isPlainObject(value: unknown): value is JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isSafeId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= MAX_ID_LENGTH &&
    !/[\s\x00-\x1f\x7f]/.test(value)
  );
}

function sameBinding(a: SlackBinding, b: SlackBinding): boolean {
  return (
    a.atiUserId === b.atiUserId &&
    a.connectionId === b.connectionId &&
    a.workspaceId === b.workspaceId &&
    a.slackUserId === b.slackUserId &&
    a.identityVersion === b.identityVersion
  );
}

function samePolicyReference(a: SlackPolicyReference, b: SlackPolicyReference): boolean {
  return (
    sameBinding(a.binding, b.binding) &&
    a.purpose === b.purpose &&
    a.requestedRetentionDays === b.requestedRetentionDays &&
    a.providerProfileId === b.providerProfileId &&
    a.configFingerprint === b.configFingerprint &&
    a.policyVersion === b.policyVersion &&
    a.consentRevision === b.consentRevision &&
    a.providerRevision === b.providerRevision
  );
}

function messageResourceId(channelId: string, messageTs: string): string {
  return JSON.stringify([channelId, messageTs]);
}

/**
 * Only the native Slack API endpoint or an explicit loopback fixture origin is accepted.
 * Arbitrary external origins can never receive a Slack credential through this wrapper.
 */
function normalizeApiBaseUrl(value: string | undefined): string {
  const raw = value ?? DEFAULT_API_BASE_URL;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new SlackPrivateReadError('SLACK_READ_INVALID_CONFIG');
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SlackPrivateReadError('SLACK_READ_INVALID_CONFIG');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new SlackPrivateReadError('SLACK_READ_INVALID_CONFIG');
  }
  const native = url.protocol === 'https:' && url.hostname === 'slack.com' && url.pathname === '/api';
  if (native) return 'https://slack.com/api';
  if (
    url.protocol === 'http:' &&
    (url.hostname === '127.0.0.1' || url.hostname === 'localhost') &&
    (url.pathname === '/' || url.pathname === '')
  ) {
    return url.origin;
  }
  throw new SlackPrivateReadError('SLACK_READ_INVALID_CONFIG');
}

function assertTimer(value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0 || resolved > MAX_TIMER_MS) {
    throw new SlackPrivateReadError('SLACK_READ_INVALID_CONFIG');
  }
  return resolved;
}

function invalidProvenance(): never {
  throw new SlackPrivateReadError('SLACK_READ_PROVENANCE_INVALID');
}

function readIdentity(value: unknown): ObservationIdentity {
  if (!isPlainObject(value) || typeof value.type !== 'string') invalidProvenance();
  const identity = value as JsonObject;
  const type = identity.type as ObservationIdentity['type'];
  const keys = Object.keys(identity).sort();

  switch (type) {
    case 'conversation':
      // Container provenance for conversations.list/info carries only the type.
      if (keys.join(',') === 'type') return { type };
      if (keys.join(',') !== 'channelId,type' || !isSafeId(identity.channelId)) invalidProvenance();
      return { type, channelId: identity.channelId as string };
    case 'message':
      // A history container carries the channel only; an entity or replies container
      // additionally carries the exact message timestamp.
      if (keys.join(',') === 'channelId,type' && isSafeId(identity.channelId)) {
        return { type, channelId: identity.channelId as string };
      }
      if (
        keys.join(',') !== 'channelId,messageTs,type' ||
        !isSafeId(identity.channelId) ||
        typeof identity.messageTs !== 'string' ||
        !SLACK_TS_REGEX.test(identity.messageTs)
      ) {
        invalidProvenance();
      }
      return { type, channelId: identity.channelId as string, messageTs: identity.messageTs as string };
    case 'user':
      if (keys.join(',') !== 'type,userId' || !isSafeId(identity.userId)) invalidProvenance();
      return { type, userId: identity.userId as string };
    case 'permalink':
      if (
        keys.join(',') !== 'channelId,messageTs,type' ||
        !isSafeId(identity.channelId) ||
        typeof identity.messageTs !== 'string' ||
        !SLACK_TS_REGEX.test(identity.messageTs)
      ) {
        invalidProvenance();
      }
      return { type, channelId: identity.channelId as string, messageTs: identity.messageTs as string };
    case 'members':
      if (keys.join(',') !== 'channelId,type' || !isSafeId(identity.channelId)) invalidProvenance();
      return { type, channelId: identity.channelId as string };
    case 'users':
      if (keys.join(',') !== 'type') invalidProvenance();
      return { type };
    default:
      invalidProvenance();
  }
}

function readProvenance(
  value: unknown,
  expectedBinding: SlackBinding,
  expectedReference: SlackPolicyReference
): ObservationProvenance {
  if (!isPlainObject(value)) invalidProvenance();

  let binding: SlackBinding;
  let reference: SlackPolicyReference;
  try {
    binding = validateSlackBinding(value.binding);
  } catch {
    invalidProvenance();
  }
  try {
    reference = validateSlackPolicyReference(value.acquisitionPolicyReference);
  } catch {
    invalidProvenance();
  }

  if (!sameBinding(binding, expectedBinding)) invalidProvenance();
  if (!samePolicyReference(reference, expectedReference)) invalidProvenance();

  const observedAt = value.observedAt;
  if (typeof observedAt !== 'string') invalidProvenance();
  const parsed = Date.parse(observedAt);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== observedAt) invalidProvenance();

  const digest = value.observationalDigest;
  if (typeof digest !== 'string' || !DIGEST_REGEX.test(digest)) invalidProvenance();

  const resourceIdentity = readIdentity(value.resourceIdentity);

  let nativeRevision: string | undefined;
  if (value.nativeRevision !== undefined) {
    if (typeof value.nativeRevision !== 'string' || value.nativeRevision.length === 0) invalidProvenance();
    nativeRevision = value.nativeRevision;
  }

  return {
    binding,
    resourceIdentity,
    observedAt,
    acquisitionPolicyReference: reference,
    nativeRevision,
    observationalDigest: digest,
  };
}

function barrierResourcesForIdentity(
  identity: ObservationIdentity,
  provenance: ObservationProvenance
): BarrierResource[] {
  switch (identity.type) {
    case 'conversation':
      return identity.channelId ? [{ type: 'conversation', id: identity.channelId }] : [];
    case 'message':
      if (!identity.channelId || !identity.messageTs) return [];
      return [
        {
          type: 'message',
          id: messageResourceId(identity.channelId, identity.messageTs),
          revision: provenance.nativeRevision ?? identity.messageTs,
        },
      ];
    case 'user':
      return [{ type: 'user', id: identity.userId! }];
    case 'permalink':
      return [
        {
          type: 'message',
          id: messageResourceId(identity.channelId!, identity.messageTs!),
          revision: identity.messageTs!,
        },
      ];
    case 'members':
      return [{ type: 'conversation', id: identity.channelId! }];
    case 'users':
      return [];
  }
}

function adapterErrorCode(error: unknown): SlackPrivateReadErrorCode {
  if (error instanceof StepError) {
    switch (error.category) {
      case 'AUTH_ERROR':
        return 'SLACK_READ_AUTHORIZATION_FAILED';
      case 'NOT_FOUND':
        return 'SLACK_READ_NOT_FOUND';
      case 'VALIDATION':
        return 'SLACK_READ_INVALID_REQUEST';
      case 'RATE_LIMIT':
        return 'SLACK_READ_RATE_LIMITED';
      case 'NETWORK':
      case 'SERVER_ERROR':
      case 'UNKNOWN':
        return 'SLACK_READ_PROVIDER_ERROR';
      default:
        return 'SLACK_READ_PROVIDER_ERROR';
    }
  }
  return 'SLACK_READ_INTERNAL';
}

/**
 * Per-invocation, server-owned executor for the eight bounded personal Slack read methods.
 * Every invocation pins one frozen binding and one canonical policy reference and owns its
 * own adapter and hooks; no callback state is shared between concurrent invocations.
 */
export class SlackPrivateReadWrapper {
  private readonly deps: SlackPrivateReadWrapperDeps;
  private readonly apiBaseUrl: string;
  private readonly requestTimeoutMs: number;
  private readonly deadlineMs: number;

  constructor(deps: SlackPrivateReadWrapperDeps) {
    if (
      !deps ||
      typeof deps.policyService?.resolveSlackModelPolicy !== 'function' ||
      typeof deps.tokenManager?.getAccessToken !== 'function' ||
      typeof deps.invalidationService?.checkBarriers !== 'function' ||
      typeof deps.ownerGate?.withOwner !== 'function'
    ) {
      throw new SlackPrivateReadError('SLACK_READ_INVALID_CONFIG');
    }
    this.deps = deps;
    this.apiBaseUrl = normalizeApiBaseUrl(deps.apiBaseUrl);
    this.requestTimeoutMs = assertTimer(deps.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS);
    this.deadlineMs = assertTimer(deps.deadlineMs, DEFAULT_DEADLINE_MS);
  }

  async executeRead(request: SlackPrivateReadRequest): Promise<SlackPrivateReadResult> {
    try {
      return await this.executeGuarded(request);
    } catch (error) {
      if (error instanceof SlackPrivateReadError) throw error;
      throw new SlackPrivateReadError('SLACK_READ_INTERNAL');
    }
  }

  private async executeGuarded(request: SlackPrivateReadRequest): Promise<SlackPrivateReadResult> {
    if (this.deps.runtimeConfig?.env?.MYSLACK_ENABLED !== 'on') {
      throw new SlackPrivateReadError('SLACK_READ_DISABLED');
    }

    const prepared = this.prepare(request);
    const { callerAtiUserId, tool, purpose, params, cleanBinding, toolDef } = prepared;

    if (callerAtiUserId !== cleanBinding.atiUserId) {
      throw new SlackPrivateReadError('SLACK_READ_IDENTITY_MISMATCH');
    }

    const facts = this.deriveRequestFacts(tool, params);
    const callerSignal = prepared.signal;
    const deadlineAt = Date.now() + this.deadlineMs;
    const deadlineSignal = AbortSignal.timeout(this.deadlineMs);
    const combinedSignal = callerSignal
      ? AbortSignal.any([callerSignal, deadlineSignal])
      : deadlineSignal;

    const abortCode = (): SlackPrivateReadError => {
      if (callerSignal?.aborted) return new SlackPrivateReadError('SLACK_READ_ABORTED');
      if (deadlineSignal.aborted) return new SlackPrivateReadError('SLACK_READ_DEADLINE_EXCEEDED');
      return new SlackPrivateReadError('SLACK_READ_ABORTED');
    };
    const throwIfAborted = (): void => {
      if (combinedSignal.aborted) throw abortCode();
    };
    const race = <T>(work: Promise<T>): Promise<T> => {
      if (combinedSignal.aborted) {
        work.catch(() => undefined);
        return Promise.reject(abortCode());
      }
      return new Promise<T>((resolve, reject) => {
        const onAbort = () => reject(abortCode());
        combinedSignal.addEventListener('abort', onAbort, { once: true });
        work.then(
          (value) => {
            combinedSignal.removeEventListener('abort', onAbort);
            resolve(value);
          },
          (error) => {
            combinedSignal.removeEventListener('abort', onAbort);
            reject(error);
          }
        );
      });
    };

    let pinned: SlackPolicyReference | undefined;
    let denial: SlackPrivateReadError | undefined;
    const fail = (code: SlackPrivateReadErrorCode): never => {
      const error = new SlackPrivateReadError(code);
      denial = error;
      throw error;
    };

    const assertNoBarrier = async (query: CheckBarriersQuery, db?: Pick<pg.PoolClient, 'query'>): Promise<void> => {
      const result = await race(
        Promise.resolve().then(() => this.deps.invalidationService.checkBarriers(query, db))
      ).catch((error: unknown) => {
        if (error instanceof SlackPrivateReadError) throw error;
        return fail('SLACK_READ_INTERNAL');
      });
      if (!isPlainObject(result) || typeof result.blocked !== 'boolean') fail('SLACK_READ_INTERNAL');
      if (result.blocked === true) fail('SLACK_READ_BARRIERED');
    };

    const authorize = async (input: SlackAuthorizeReadInput, db?: Pick<pg.PoolClient, 'query'>): Promise<SlackPolicyHookDecision> => {
      throwIfAborted();

      let inputBinding: SlackBinding;
      try {
        inputBinding = validateSlackBinding(input?.binding);
      } catch {
        return fail('SLACK_READ_INVALID_REQUEST');
      }
      if (!sameBinding(inputBinding, cleanBinding)) fail('SLACK_READ_IDENTITY_MISMATCH');
      if (input.purpose !== purpose) fail('SLACK_READ_INVALID_REQUEST');
      if (input.requestedRetentionDays !== 0) fail('SLACK_READ_INVALID_REQUEST');

      if (input.expectedPolicyReference !== undefined) {
        let expected: SlackPolicyReference;
        try {
          expected = validateSlackPolicyReference(input.expectedPolicyReference);
        } catch {
          return fail('SLACK_READ_EPOCH_CHANGED');
        }
        if (!pinned) fail('SLACK_READ_EPOCH_CHANGED');
        if (!samePolicyReference(expected, pinned!)) fail('SLACK_READ_EPOCH_CHANGED');
      } else if (pinned) {
        fail('SLACK_READ_EPOCH_CHANGED');
      }

      const decision = await race(
        Promise.resolve().then(() =>
          this.deps.policyService.resolveSlackModelPolicy({
            binding: inputBinding,
            purpose,
            requestedRetentionDays: 0,
            ...(input.expectedPolicyReference
              ? { expectedPolicyReference: input.expectedPolicyReference }
              : {}),
          }, db)
        )
      ).catch((error: unknown) => {
        if (error instanceof SlackPrivateReadError) throw error;
        return fail('SLACK_READ_INTERNAL');
      });

      throwIfAborted();

      if (!isPlainObject(decision) || decision.allowed !== true) {
        return fail('SLACK_READ_POLICY_DENIED');
      }

      let canonical: SlackPolicyReference;
      try {
        const clean = validateSlackPolicyReference(decision.policyReference);
        canonical = Object.freeze({ ...clean, binding: Object.freeze({ ...clean.binding }) });
      } catch {
        return fail('SLACK_READ_INTERNAL');
      }

      if (
        !sameBinding(canonical.binding, cleanBinding) ||
        canonical.purpose !== purpose ||
        canonical.requestedRetentionDays !== 0
      ) {
        fail('SLACK_READ_POLICY_DENIED');
      }

      if (pinned) {
        if (!samePolicyReference(canonical, pinned)) fail('SLACK_READ_EPOCH_CHANGED');
      } else {
        pinned = canonical;
      }

      await assertNoBarrier({ binding: cleanBinding }, db);
      await assertNoBarrier({ binding: cleanBinding, epoch: slackPolicyRefToEpoch(pinned!) }, db);
      if (facts.channelId) {
        await assertNoBarrier({ binding: cleanBinding, channelId: facts.channelId }, db);
      }
      for (const resource of facts.resources) {
        await assertNoBarrier({
          workspaceId: cleanBinding.workspaceId,
          resourceType: resource.type,
          resourceId: resource.id,
          ...(resource.revision !== undefined ? { revision: resource.revision } : {}),
        }, db);
      }

      return { allowed: true, policyReference: canonical };
    };

    const tokenProvider = {
      getAccessToken: async (hookBinding: SlackBinding): Promise<string> => {
        throwIfAborted();

        let inputBinding: SlackBinding;
        try {
          inputBinding = validateSlackBinding(hookBinding);
        } catch {
          return fail('SLACK_READ_IDENTITY_MISMATCH');
        }
        if (!sameBinding(inputBinding, cleanBinding)) fail('SLACK_READ_IDENTITY_MISMATCH');
        if (!pinned) fail('SLACK_READ_INTERNAL');

        await authorize({
          binding: inputBinding,
          purpose,
          requestedRetentionDays: 0,
          expectedPolicyReference: pinned!,
        });

        const token = await race(
          Promise.resolve().then(() =>
            this.deps.tokenManager.getAccessToken(
              cleanBinding.atiUserId,
              cleanBinding.connectionId,
              cleanBinding.identityVersion
            )
          )
        ).catch((error: unknown) => {
          if (error instanceof SlackPrivateReadError) throw error;
          return fail('SLACK_READ_TOKEN_UNAVAILABLE');
        });

        throwIfAborted();

        if (
          typeof token !== 'string' ||
          token.length === 0 ||
          token.length > MAX_TOKEN_LENGTH ||
          /[\r\n]/.test(token)
        ) {
          fail('SLACK_READ_TOKEN_UNAVAILABLE');
        }

        // Revalidate after the token manager released its owner lock. This short owner
        // gate is never nested around getAccessToken; it only closes the disconnect or
        // regrant window between credential acquisition and credential handoff.
        await race(
          Promise.resolve().then(() =>
            this.deps.ownerGate.withOwner(cleanBinding.atiUserId, async client => {
              await authorize({
                binding: cleanBinding,
                purpose,
                requestedRetentionDays: 0,
                expectedPolicyReference: pinned!,
              }, client);
            })
          )
        );

        throwIfAborted();
        return token;
      },
    };

    const adapterConfig: PersonalSlackReadAdapterConfig = {
      tokens: tokenProvider,
      policy: { authorizeRead: authorize },
      apiBaseUrl: this.apiBaseUrl,
      requestTimeoutMs: this.requestTimeoutMs,
      ...(this.deps.fetchFn ? { fetchFn: this.deps.fetchFn } : {}),
    };

    let adapter: SlackReadAdapterLike;
    try {
      adapter = await race(
        Promise.resolve().then(() =>
          this.deps.createAdapter
            ? this.deps.createAdapter(adapterConfig)
            : new PersonalSlackReadAdapter(adapterConfig)
        )
      );
    } catch (error) {
      if (error instanceof SlackPrivateReadError) throw error;
      throw new SlackPrivateReadError('SLACK_READ_INVALID_CONFIG');
    }
    if (!adapter || typeof adapter.execute !== 'function') {
      throw new SlackPrivateReadError('SLACK_READ_INVALID_CONFIG');
    }

    let data: unknown;
    try {
      data = await race(
        Promise.resolve().then(() =>
          adapter.execute(
            tool,
            { binding: cleanBinding, params },
            { purpose, signal: combinedSignal }
          )
        )
      );
    } catch (error) {
      if (error instanceof SlackPrivateReadError) throw error;
      if (denial) throw denial;
      throw new SlackPrivateReadError(adapterErrorCode(error));
    }

    throwIfAborted();

    // A DTO returned without any authorization/acquisition evidence is an invalid
    // observation, including when a server-owned adapter failed to call its hooks.
    if (!pinned) invalidProvenance();
    const observedQueries = await this.validateResult(tool, params, data, cleanBinding, pinned!, facts, {
      race,
      fail,
      assertNoBarrier,
      throwIfAborted,
    });

    // Linearize the final observation with invalidation and authority changes. The
    // same sorted advisory keys used by source writers/stagers cover EVERY observed
    // resource, including entities not known before the provider response. Owner ->
    // advisory -> authority FOR SHARE matches refresh/ingress/source lock ordering.
    // PolicyService still evaluates the actual current authority while those rows
    // cannot change; a later invalidation commits after this read's snapshot commits.
    await race(this.deps.ownerGate.withOwner(cleanBinding.atiUserId, async client => {
      throwIfAborted();
      await client.query('BEGIN');
      try {
        await client.query("SELECT set_config('statement_timeout', $1, true)", [String(Math.max(1, deadlineAt - Date.now()))]);
        const keys = [
          ...slackInvalidationLockKeys({ barrierType: 'binding', binding: cleanBinding, reason: 'read_snapshot' }),
          ...slackInvalidationLockKeys({ barrierType: 'epoch', epoch: slackPolicyRefToEpoch(pinned!), reason: 'read_snapshot' }),
        ];
        for (const query of observedQueries) {
          if (query.channelId) keys.push(...slackInvalidationLockKeys({
            barrierType: 'channel', binding: cleanBinding, channelId: query.channelId, reason: 'read_snapshot',
          }));
          if (query.resourceType && query.resourceId) keys.push(...slackInvalidationLockKeys({
            barrierType: 'resource', workspaceId: cleanBinding.workspaceId,
            resourceType: query.resourceType, resourceId: query.resourceId, reason: 'read_snapshot',
          }));
        }
        await acquireSlackInvalidationLocks(client, keys);
        throwIfAborted();
        await client.query('SELECT id FROM users WHERE id=$1 FOR SHARE', [cleanBinding.atiUserId]);
        await client.query('SELECT id FROM slack_connections WHERE id=$1 AND user_id=$2 FOR SHARE',
          [cleanBinding.connectionId, cleanBinding.atiUserId]);
        await client.query('SELECT id FROM slack_trusted_providers WHERE id=$1 FOR SHARE', [pinned!.providerProfileId]);
        await client.query('SELECT workspace_id FROM slack_processing_consents WHERE workspace_id=$1 AND provider_id=$2 FOR SHARE',
          [cleanBinding.workspaceId, pinned!.providerProfileId]);
        await authorize({ binding: cleanBinding, purpose, requestedRetentionDays: 0, expectedPolicyReference: pinned! }, client);
        for (const query of observedQueries) await assertNoBarrier(query, client);
        throwIfAborted();
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }));

    throwIfAborted();
    return { tool, data, policyReference: pinned! };
  }

  private prepare(request: SlackPrivateReadRequest): {
    callerAtiUserId: string;
    tool: string;
    purpose: SlackReadPurpose;
    params: Record<string, unknown>;
    cleanBinding: SlackBinding;
    toolDef: SlackToolDefinition;
    signal: AbortSignal | undefined;
  } {
    if (!isPlainObject(request)) throw new SlackPrivateReadError('SLACK_READ_INVALID_REQUEST');
    for (const key of Object.keys(request)) {
      if (!REQUEST_KEYS.has(key)) throw new SlackPrivateReadError('SLACK_READ_INVALID_REQUEST');
    }

    const caller = request.callerAtiUserId;
    if (typeof caller !== 'string' || caller.trim().length === 0) {
      throw new SlackPrivateReadError('SLACK_READ_INVALID_REQUEST');
    }

    let cleanBinding: SlackBinding;
    try {
      cleanBinding = validateSlackBinding(request.binding);
    } catch {
      throw new SlackPrivateReadError('SLACK_READ_INVALID_REQUEST');
    }

    if (typeof request.tool !== 'string' || request.tool.trim().length === 0) {
      throw new SlackPrivateReadError('SLACK_READ_INVALID_REQUEST');
    }
    const tool = request.tool.trim();

    const purpose = request.purpose;
    if (typeof purpose !== 'string' || !READ_PURPOSES.has(purpose)) {
      throw new SlackPrivateReadError('SLACK_READ_INVALID_REQUEST');
    }

    if (!isPlainObject(request.params)) throw new SlackPrivateReadError('SLACK_READ_INVALID_REQUEST');

    const rawSignal = request.signal;
    if (
      rawSignal !== undefined &&
      (rawSignal === null ||
        typeof rawSignal !== 'object' ||
        typeof (rawSignal as AbortSignal).addEventListener !== 'function' ||
        typeof (rawSignal as AbortSignal).aborted !== 'boolean')
    ) {
      throw new SlackPrivateReadError('SLACK_READ_INVALID_REQUEST');
    }

    const toolDef = MYSLACK_CORE_READ_TOOLS.find((definition) => definition.name === tool);
    if (!toolDef || toolDef.sideEffect !== 'read') {
      throw new SlackPrivateReadError('SLACK_READ_INVALID_REQUEST');
    }

    let validation: { binding: SlackBinding; params: Record<string, unknown> };
    try {
      validation = validateSlackToolExecutionArgs<Record<string, unknown>>(toolDef, {
        binding: cleanBinding,
        params: request.params,
      });
    } catch {
      throw new SlackPrivateReadError('SLACK_READ_INVALID_REQUEST');
    }

    return {
      callerAtiUserId: caller.trim(),
      tool,
      purpose: purpose as SlackReadPurpose,
      params: validation.params,
      cleanBinding: Object.freeze({ ...validation.binding }),
      toolDef,
      signal: rawSignal,
    };
  }

  private deriveRequestFacts(tool: string, params: Record<string, unknown>): RequestFacts {
    const requireId = (name: string): string => {
      const value = params[name];
      if (!isSafeId(value)) throw new SlackPrivateReadError('SLACK_READ_INVALID_REQUEST');
      return value;
    };
    const requireMessageTs = (name: string): string => {
      const value = params[name];
      if (typeof value !== 'string' || !SLACK_TS_REGEX.test(value)) {
        throw new SlackPrivateReadError('SLACK_READ_INVALID_REQUEST');
      }
      return value;
    };

    switch (tool) {
      case 'myslack.conversations_list':
      case 'myslack.users_list':
        return { resources: [] };
      case 'myslack.conversations_info':
      case 'myslack.conversations_history':
      case 'myslack.conversations_members': {
        const channelId = requireId('channel');
        return { channelId, resources: [{ type: 'conversation', id: channelId }] };
      }
      case 'myslack.conversations_replies': {
        const channelId = requireId('channel');
        const ts = requireMessageTs('ts');
        return {
          channelId,
          resources: [
            { type: 'conversation', id: channelId },
            { type: 'message', id: messageResourceId(channelId, ts), revision: ts },
          ],
        };
      }
      case 'myslack.users_info': {
        const userId = requireId('user');
        return { resources: [{ type: 'user', id: userId }] };
      }
      case 'myslack.chat_getPermalink': {
        const channelId = requireId('channel');
        const messageTs = requireMessageTs('message_ts');
        return {
          channelId,
          resources: [
            { type: 'conversation', id: channelId },
            { type: 'message', id: messageResourceId(channelId, messageTs), revision: messageTs },
          ],
        };
      }
      default:
        throw new SlackPrivateReadError('SLACK_READ_INVALID_REQUEST');
    }
  }

  private async validateResult(
    tool: string,
    params: Record<string, unknown>,
    data: unknown,
    binding: SlackBinding,
    pinned: SlackPolicyReference,
    facts: RequestFacts,
    guard: {
      race: <T>(work: Promise<T>) => Promise<T>;
      fail: (code: SlackPrivateReadErrorCode) => never;
      assertNoBarrier: (query: CheckBarriersQuery) => Promise<void>;
      throwIfAborted: () => void;
    }
  ): Promise<CheckBarriersQuery[]> {
    guard.throwIfAborted();

    if (!isPlainObject(data) || data.ok !== true) invalidProvenance();

    const container = readProvenance(data.provenance, binding, pinned);
    if (!this.matchesContainerIdentity(tool, params, container.resourceIdentity)) {
      invalidProvenance();
    }

    const observedChannels = new Set<string>();
    const observedResources: BarrierResource[] = [
      ...barrierResourcesForIdentity(container.resourceIdentity, container),
    ];
    if (container.resourceIdentity.channelId) observedChannels.add(container.resourceIdentity.channelId);

    const collectEntity = (value: unknown): ObservationProvenance => {
      if (!isPlainObject(value)) invalidProvenance();
      const provenance = readProvenance(value.provenance, binding, pinned);
      if (provenance.resourceIdentity.channelId) {
        observedChannels.add(provenance.resourceIdentity.channelId);
      }
      observedResources.push(...barrierResourcesForIdentity(provenance.resourceIdentity, provenance));
      return provenance;
    };

    switch (tool) {
      case 'myslack.conversations_list': {
        const channels = data.channels;
        if (!Array.isArray(channels)) invalidProvenance();
        for (const channel of channels) {
          if (!isPlainObject(channel) || !isSafeId(channel.id)) invalidProvenance();
          const provenance = collectEntity(channel);
          if (
            provenance.resourceIdentity.type !== 'conversation' ||
            provenance.resourceIdentity.channelId !== channel.id
          ) {
            invalidProvenance();
          }
        }
        break;
      }
      case 'myslack.conversations_info': {
        if (!isPlainObject(data.channel) || !isSafeId(data.channel.id)) invalidProvenance();
        const provenance = collectEntity(data.channel);
        if (
          provenance.resourceIdentity.type !== 'conversation' ||
          provenance.resourceIdentity.channelId !== data.channel.id ||
          data.channel.id !== params.channel
        ) {
          invalidProvenance();
        }
        break;
      }
      case 'myslack.conversations_history':
      case 'myslack.conversations_replies': {
        const messages = data.messages;
        if (!Array.isArray(messages)) invalidProvenance();
        for (const message of messages) {
          if (!isPlainObject(message) || typeof message.ts !== 'string' || !SLACK_TS_REGEX.test(message.ts)) {
            invalidProvenance();
          }
          const provenance = collectEntity(message);
          const expectedRevision =
            isPlainObject(message.edited) && typeof message.edited.ts === 'string'
              ? message.edited.ts
              : message.ts;
          if (
            provenance.resourceIdentity.type !== 'message' ||
            provenance.resourceIdentity.channelId !== params.channel ||
            provenance.resourceIdentity.messageTs !== message.ts ||
            provenance.nativeRevision !== expectedRevision
          ) {
            invalidProvenance();
          }
        }
        break;
      }
      case 'myslack.conversations_members': {
        const members = data.members;
        if (!Array.isArray(members)) invalidProvenance();
        for (const member of members) {
          if (!isSafeId(member)) invalidProvenance();
          observedResources.push({ type: 'user', id: member });
        }
        break;
      }
      case 'myslack.users_list': {
        const members = data.members;
        if (!Array.isArray(members)) invalidProvenance();
        for (const member of members) {
          if (!isPlainObject(member) || !isSafeId(member.id)) invalidProvenance();
          const provenance = collectEntity(member);
          if (
            provenance.resourceIdentity.type !== 'user' ||
            provenance.resourceIdentity.userId !== member.id
          ) {
            invalidProvenance();
          }
        }
        break;
      }
      case 'myslack.users_info': {
        if (!isPlainObject(data.user) || !isSafeId(data.user.id)) invalidProvenance();
        const provenance = collectEntity(data.user);
        if (
          provenance.resourceIdentity.type !== 'user' ||
          provenance.resourceIdentity.userId !== data.user.id ||
          data.user.id !== params.user
        ) {
          invalidProvenance();
        }
        break;
      }
      case 'myslack.chat_getPermalink': {
        if (
          data.channel !== params.channel ||
          typeof data.permalink !== 'string' ||
          data.permalink.length === 0
        ) {
          invalidProvenance();
        }
        if (
          container.resourceIdentity.type !== 'permalink' ||
          container.resourceIdentity.channelId !== params.channel ||
          container.resourceIdentity.messageTs !== params.message_ts
        ) {
          invalidProvenance();
        }
        break;
      }
      default:
        invalidProvenance();
    }

    const queries: CheckBarriersQuery[] = [];
    for (const channelId of facts.channelId ? [facts.channelId, ...observedChannels] : observedChannels) {
      queries.push({ binding, channelId });
    }

    const seen = new Set<string>();
    for (const resource of [...facts.resources, ...observedResources]) {
      const key = `${resource.type}\u0000${resource.id}\u0000${resource.revision ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queries.push({
        workspaceId: binding.workspaceId,
        resourceType: resource.type,
        resourceId: resource.id,
        ...(resource.revision !== undefined ? { revision: resource.revision } : {}),
      });
    }

    guard.throwIfAborted();
    return queries;
  }

  private matchesContainerIdentity(
    tool: string,
    params: Record<string, unknown>,
    identity: ObservationIdentity
  ): boolean {
    switch (tool) {
      case 'myslack.conversations_list':
        return identity.type === 'conversation' && identity.channelId === undefined;
      case 'myslack.conversations_info':
        return identity.type === 'conversation' && identity.channelId === params.channel;
      case 'myslack.conversations_history':
        return identity.type === 'message' && identity.channelId === params.channel && identity.messageTs === undefined;
      case 'myslack.conversations_replies':
        return (
          identity.type === 'message' &&
          identity.channelId === params.channel &&
          identity.messageTs === params.ts
        );
      case 'myslack.conversations_members':
        return identity.type === 'members' && identity.channelId === params.channel;
      case 'myslack.users_list':
        return identity.type === 'users';
      case 'myslack.users_info':
        return identity.type === 'user' && identity.userId === params.user;
      case 'myslack.chat_getPermalink':
        return (
          identity.type === 'permalink' &&
          identity.channelId === params.channel &&
          identity.messageTs === params.message_ts
        );
      default:
        return false;
    }
  }
}
