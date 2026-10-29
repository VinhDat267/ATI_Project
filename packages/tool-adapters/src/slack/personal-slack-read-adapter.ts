import crypto from 'node:crypto';
import {
  validateSlackBinding,
  validateSlackPolicyReference,
  validateSlackToolExecutionArgs,
  MYSLACK_CORE_READ_TOOLS,
  type SlackBinding,
  type SlackPolicyReference,
} from '@wap/tool-schemas';
import { BaseAdapter, StepError } from '../base-adapter.js';
import { retryAfterMs, waitWithSignal } from '../rate-limiter.js';
import type {
  PersonalSlackReadAdapterConfig,
  SlackAuthorizeReadInput,
  SlackConversationDetail,
  SlackConversationsHistoryResult,
  SlackConversationsInfoResult,
  SlackConversationsListResult,
  SlackConversationsMembersResult,
  SlackConversationsRepliesResult,
  SlackConversationSummary,
  SlackMessageObservation,
  SlackObservationProvenance,
  SlackPermalinkObservation,
  SlackReadPolicyHook,
  SlackReadPurpose,
  SlackResourceIdentity,
  SlackTokenProviderHook,
  SlackUserDetail,
  SlackUsersInfoResult,
  SlackUsersListResult,
  SlackUserSummary,
} from './personal-slack-types.js';

const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2MB
const MAX_PAGE_LIMIT = 100;
const MAX_CURSOR_LENGTH = 2048;
const MAX_ID_LENGTH = 128;
const MAX_TEXT_LENGTH = 64_000;
const MAX_NAME_LENGTH = 1024;
const MAX_URL_LENGTH = 2048;
const MAX_TOKEN_LENGTH = 4096;
const MAX_TIMEOUT_MS = 2_147_483_647;
const MAX_ATTEMPTS = 3; // initial attempt + 2 bounded retries
const SLACK_TS_REGEX = /^\d{10}\.\d{6}$/;
const SAFE_PERMALINK_REGEX =
  /^https:\/\/([a-z0-9_-]+)\.slack\.com\/archives\/([A-Z0-9_]+)\/p(\d{10,20})$/;
const TOKEN_REDACTION_REGEX = /(?:xox[baprs]-[a-zA-Z0-9-]+|Bearer\s+[a-zA-Z0-9._~+/-]+)/gi;

const DEFAULT_PAGE_LIMITS = {
  conversationsList: 50,
  conversationsHistory: 20,
  conversationsReplies: 20,
  conversationsMembers: 100,
  usersList: 50,
} as const;

const WHITELISTED_POLICY_DENIAL_REASONS = new Set<string>([
  'connection_inactive',
  'identity_changed',
  'consent_missing',
  'consent_revoked',
  'policy_changed',
  'policy_epoch_invalidated',
  'provider_unverified',
  'retention_exceeded',
]);

type JsonObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function sanitizeTokens(text: string): string {
  if (!text || typeof text !== 'string') return text;
  return text.replace(TOKEN_REDACTION_REGEX, '[REDACTED]');
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

function computeDigest(payload: unknown): string {
  const json = JSON.stringify(payload);
  return crypto.createHash('sha256').update(json).digest('hex');
}

function protocolError(): StepError {
  return new StepError({
    message: 'Slack API returned a malformed or unexpected response',
    category: 'SERVER_ERROR',
    statusCode: 502,
  });
}

function pageOverrunError(): StepError {
  return new StepError({
    message: 'Slack API returned more observations than the requested page limit',
    category: 'SERVER_ERROR',
    statusCode: 502,
  });
}

function responseTooLargeError(): StepError {
  return new StepError({
    message: 'Slack API response exceeded the 2MB transport limit',
    category: 'SERVER_ERROR',
    statusCode: 502,
  });
}

function validationError(): StepError {
  return new StepError({
    message: 'Slack read arguments failed strict bounds validation',
    category: 'VALIDATION',
    statusCode: 400,
  });
}

function abortError(): StepError {
  return new StepError({
    message: 'Slack read aborted',
    category: 'NETWORK',
  });
}

function networkError(): StepError {
  return new StepError({
    message: 'Slack network request failed',
    category: 'NETWORK',
  });
}

function invalidBaseUrlError(): StepError {
  return new StepError({
    message:
      'apiBaseUrl must be the native Slack API origin (https://slack.com/api) or an explicit loopback fixture',
    category: 'VALIDATION',
    statusCode: 400,
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

async function awaitWithAbort<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return await operation;
  if (signal.aborted) {
    // The operation stays observed so a late rejection cannot become unhandled.
    operation.catch(() => {});
    throw abortError();
  }

  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      action();
    };
    const onAbort = () => finish(() => reject(abortError()));
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error))
    );
    if (signal.aborted) onAbort();
  });
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    if (response.body && typeof response.body.cancel === 'function') {
      await response.body.cancel();
    }
  } catch {
    // Body already errored or consumed; nothing left to release.
  }
}

async function readResponseBodyBounded(
  response: Response,
  signal?: AbortSignal
): Promise<string> {
  const contentLength = response.headers.get('content-length');
  if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
    await cancelResponseBody(response);
    throw responseTooLargeError();
  }

  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      for (;;) {
        const { done, value } = await awaitWithAbort(reader.read(), signal);
        if (done) break;
        throwIfAborted(signal);
        if (value) {
          totalBytes += value.byteLength;
          if (totalBytes > MAX_BODY_BYTES) {
            throw responseTooLargeError();
          }
          chunks.push(value);
        }
      }
    } catch (err) {
      try {
        await reader.cancel();
      } catch {
        // Ignore cancellation failures on an already errored stream.
      }
      if (err instanceof StepError) throw err;
      if (signal?.aborted) throw abortError();
      throw networkError();
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // A racing cancellation may still hold the lock; the stream is discarded.
      }
    }

    const merged = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(merged);
  }

  try {
    const text = await awaitWithAbort(response.text(), signal);
    if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
      throw responseTooLargeError();
    }
    return text;
  } catch (err) {
    await cancelResponseBody(response);
    if (err instanceof StepError) throw err;
    if (signal?.aborted) throw abortError();
    throw networkError();
  }
}

function validateApiBaseUrl(rawBase?: string): string {
  if (rawBase === undefined || rawBase === null || rawBase === '') {
    return 'https://slack.com/api';
  }
  if (typeof rawBase !== 'string') throw invalidBaseUrlError();

  const trimmed = rawBase.trim().replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw invalidBaseUrlError();
  }

  if (url.username || url.password || url.search || url.hash) {
    throw invalidBaseUrlError();
  }

  if (url.protocol === 'https:') {
    const cleanPath = url.pathname.replace(/\/+$/, '');
    if (url.hostname === 'slack.com' && (cleanPath === '/api' || cleanPath === '')) {
      return 'https://slack.com/api';
    }
    throw invalidBaseUrlError();
  }

  if (url.protocol === 'http:') {
    const cleanPath = url.pathname.replace(/\/+$/, '');
    if (
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost') &&
      (cleanPath === '' || cleanPath === '/')
    ) {
      return trimmed;
    }
  }

  throw invalidBaseUrlError();
}

function readRequiredString(
  source: JsonObject,
  key: string,
  maxLength: number,
  requireNonBlank = true
): string {
  const value = source[key];
  if (typeof value !== 'string') throw protocolError();
  if (value.length === 0 || value.length > maxLength) throw protocolError();
  if (requireNonBlank && value.trim().length === 0) throw protocolError();
  return value;
}

function readRequiredId(source: JsonObject, key: string): string {
  return readRequiredString(source, key, MAX_ID_LENGTH);
}

function readRequiredTimestamp(source: JsonObject, key: string): string {
  const value = source[key];
  if (typeof value !== 'string' || !SLACK_TS_REGEX.test(value)) throw protocolError();
  return value;
}

function readOptionalString(
  source: JsonObject,
  key: string,
  maxLength: number
): string | undefined {
  const value = source[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.length > maxLength) throw protocolError();
  return value;
}

function readOptionalId(source: JsonObject, key: string): string | undefined {
  const value = source[key];
  if (value === undefined || value === null) return undefined;
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_ID_LENGTH ||
    value.trim().length === 0
  ) {
    throw protocolError();
  }
  return value;
}

function readOptionalTimestamp(source: JsonObject, key: string): string | undefined {
  const value = source[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !SLACK_TS_REGEX.test(value)) throw protocolError();
  return value;
}

function readOptionalBoolean(source: JsonObject, key: string): boolean | undefined {
  const value = source[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw protocolError();
  return value;
}

function readOptionalInteger(source: JsonObject, key: string): number | undefined {
  const value = source[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw protocolError();
  return value;
}

function readOptionalCount(source: JsonObject, key: string): number | undefined {
  const value = readOptionalInteger(source, key);
  if (value !== undefined && value < 0) throw protocolError();
  return value;
}

function readProviderArray(data: JsonObject, key: string, limit: number): unknown[] {
  const value = data[key];
  if (!Array.isArray(value)) throw protocolError();
  if (value.length > limit) throw pageOverrunError();
  return value;
}

function readPagination(data: JsonObject): { nextCursor?: string; hasMore: boolean } {
  const metadata = data.response_metadata;
  let nextCursor: string | undefined;
  if (metadata !== undefined && metadata !== null) {
    if (!isPlainObject(metadata)) throw protocolError();
    const cursor = metadata.next_cursor;
    if (cursor !== undefined && cursor !== null) {
      if (typeof cursor !== 'string' || cursor.length > MAX_CURSOR_LENGTH) {
        throw protocolError();
      }
      if (cursor.length > 0) nextCursor = cursor;
    }
  }

  const rawHasMore = data.has_more;
  if (rawHasMore === undefined || rawHasMore === null) {
    return { nextCursor, hasMore: nextCursor !== undefined };
  }
  if (typeof rawHasMore !== 'boolean') throw protocolError();
  return { nextCursor, hasMore: rawHasMore };
}

function readLimitParam(params: JsonObject, defaultLimit: number): number {
  const raw = params.limit;
  if (raw === undefined) return Math.min(defaultLimit, MAX_PAGE_LIMIT);
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 1 || raw > 1000) {
    throw validationError();
  }
  return Math.min(raw, MAX_PAGE_LIMIT);
}

function readCursorParam(params: JsonObject): string | undefined {
  const raw = params.cursor;
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string' || raw.length > MAX_CURSOR_LENGTH) throw validationError();
  return raw;
}

function readChannelParam(params: JsonObject): string {
  const raw = params.channel;
  if (
    typeof raw !== 'string' ||
    raw.length === 0 ||
    raw.length > MAX_ID_LENGTH ||
    raw.trim().length === 0
  ) {
    throw validationError();
  }
  return raw;
}

function readUserParam(params: JsonObject): string {
  const raw = params.user;
  if (
    typeof raw !== 'string' ||
    raw.length === 0 ||
    raw.length > MAX_ID_LENGTH ||
    raw.trim().length === 0
  ) {
    throw validationError();
  }
  return raw;
}

function readTimestampParam(params: JsonObject, key: string): string {
  const raw = params[key];
  if (typeof raw !== 'string' || !SLACK_TS_REGEX.test(raw)) throw validationError();
  return raw;
}

function readOptionalTimestampParam(params: JsonObject, key: string): string | undefined {
  const raw = params[key];
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string' || !SLACK_TS_REGEX.test(raw)) throw validationError();
  return raw;
}

function readOptionalBooleanParam(params: JsonObject, key: string): boolean | undefined {
  const raw = params[key];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'boolean') throw validationError();
  return raw;
}

function readOptionalStringParam(
  params: JsonObject,
  key: string,
  maxLength: number
): string | undefined {
  const raw = params[key];
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string' || raw.length > maxLength) throw validationError();
  return raw;
}

function readTopicOrPurpose(
  value: unknown
): { value?: string; creator?: string; last_set?: number } | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isPlainObject(value)) throw protocolError();
  return {
    value: readOptionalString(value, 'value', MAX_TEXT_LENGTH),
    creator: readOptionalId(value, 'creator'),
    last_set: readOptionalCount(value, 'last_set'),
  };
}

function readConversationSummaryFields(source: JsonObject): Omit<SlackConversationSummary, 'provenance'> {
  return {
    id: readRequiredId(source, 'id'),
    name: readOptionalString(source, 'name', MAX_NAME_LENGTH),
    is_channel: readOptionalBoolean(source, 'is_channel'),
    is_group: readOptionalBoolean(source, 'is_group'),
    is_im: readOptionalBoolean(source, 'is_im'),
    is_mpim: readOptionalBoolean(source, 'is_mpim'),
    is_private: readOptionalBoolean(source, 'is_private'),
    created: readOptionalCount(source, 'created'),
    is_archived: readOptionalBoolean(source, 'is_archived'),
    is_general: readOptionalBoolean(source, 'is_general'),
    unlinked: readOptionalCount(source, 'unlinked'),
    creator: readOptionalId(source, 'creator'),
    name_normalized: readOptionalString(source, 'name_normalized', MAX_NAME_LENGTH),
    is_shared: readOptionalBoolean(source, 'is_shared'),
    is_org_shared: readOptionalBoolean(source, 'is_org_shared'),
    context_team_id: readOptionalId(source, 'context_team_id'),
    updated: readOptionalCount(source, 'updated'),
    num_members: readOptionalCount(source, 'num_members'),
  };
}

function readConversationDetailFields(source: JsonObject): Omit<SlackConversationDetail, 'provenance'> {
  return {
    ...readConversationSummaryFields(source),
    topic: readTopicOrPurpose(source.topic),
    purpose: readTopicOrPurpose(source.purpose),
  };
}

function readMessageFields(
  source: unknown
): Omit<SlackMessageObservation, 'provenance'> {
  if (!isPlainObject(source)) throw protocolError();
  const ts = readRequiredTimestamp(source, 'ts');

  let edited: { user?: string; ts: string } | undefined;
  const rawEdited = source.edited;
  if (rawEdited !== undefined && rawEdited !== null) {
    if (!isPlainObject(rawEdited)) throw protocolError();
    edited = {
      user: readOptionalId(rawEdited, 'user'),
      ts: readRequiredTimestamp(rawEdited, 'ts'),
    };
  }

  return {
    type: 'message',
    user: readOptionalId(source, 'user'),
    text: readOptionalString(source, 'text', MAX_TEXT_LENGTH),
    ts,
    thread_ts: readOptionalTimestamp(source, 'thread_ts'),
    reply_count: readOptionalCount(source, 'reply_count'),
    reply_users_count: readOptionalCount(source, 'reply_users_count'),
    latest_reply: readOptionalTimestamp(source, 'latest_reply'),
    edited,
  };
}

function readUserFields(source: JsonObject): Omit<SlackUserSummary, 'provenance'> {
  return {
    id: readRequiredId(source, 'id'),
    team_id: readOptionalId(source, 'team_id'),
    name: readOptionalString(source, 'name', MAX_NAME_LENGTH),
    deleted: readOptionalBoolean(source, 'deleted'),
    real_name: readOptionalString(source, 'real_name', MAX_NAME_LENGTH),
    tz: readOptionalString(source, 'tz', MAX_NAME_LENGTH),
    tz_label: readOptionalString(source, 'tz_label', MAX_NAME_LENGTH),
    tz_offset: readOptionalInteger(source, 'tz_offset'),
    is_bot: readOptionalBoolean(source, 'is_bot'),
    is_admin: readOptionalBoolean(source, 'is_admin'),
    is_owner: readOptionalBoolean(source, 'is_owner'),
    updated: readOptionalCount(source, 'updated'),
  };
}

function buildProvenance(
  binding: SlackBinding,
  resourceIdentity: SlackResourceIdentity,
  observedAt: string,
  acquisitionPolicyReference: SlackPolicyReference,
  nativeRevision: string | undefined,
  observationalDigest: string
): SlackObservationProvenance {
  return {
    binding,
    resourceIdentity,
    observedAt,
    acquisitionPolicyReference,
    nativeRevision,
    observationalDigest,
  };
}

export class PersonalSlackReadAdapter extends BaseAdapter {
  public readonly service = 'myslack';
  private readonly tokens: SlackTokenProviderHook;
  private readonly policy: SlackReadPolicyHook;
  private readonly apiBase: string;
  private readonly fetchFn: typeof fetch;
  private readonly requestTimeoutMs: number;

  constructor(config: PersonalSlackReadAdapterConfig) {
    super(config);

    if (!config.tokens || typeof config.tokens.getAccessToken !== 'function') {
      throw new StepError({
        message: 'PersonalSlackReadAdapter requires a valid tokens provider hook',
        category: 'VALIDATION',
      });
    }

    if (!config.policy || typeof config.policy.authorizeRead !== 'function') {
      throw new StepError({
        message: 'PersonalSlackReadAdapter requires a valid read policy hook',
        category: 'VALIDATION',
      });
    }

    const configuredTimeout = config.requestTimeoutMs ?? 10_000;
    if (
      typeof configuredTimeout !== 'number' ||
      !Number.isSafeInteger(configuredTimeout) ||
      configuredTimeout <= 0 ||
      configuredTimeout > MAX_TIMEOUT_MS
    ) {
      throw new StepError({
        message:
          'requestTimeoutMs must be a positive safe integer within the supported timer range',
        category: 'VALIDATION',
        statusCode: 400,
      });
    }

    this.tokens = config.tokens;
    this.policy = config.policy;
    this.apiBase = validateApiBaseUrl(config.apiBaseUrl);
    this.fetchFn = config.fetchFn ?? globalThis.fetch;
    this.requestTimeoutMs = configuredTimeout;
  }

  public async execute(
    toolName: string,
    args: Record<string, any>,
    context?: any
  ): Promise<any> {
    try {
      return await this.executeInternal(toolName, args, context);
    } catch (err: unknown) {
      this.sanitizeAndRethrow(err);
    }
  }

  private async executeInternal(
    toolName: string,
    args: Record<string, any>,
    context?: any
  ): Promise<any> {
    const rawSignal = context?.signal;
    if (
      rawSignal !== undefined &&
      rawSignal !== null &&
      (typeof rawSignal !== 'object' ||
        typeof rawSignal.addEventListener !== 'function' ||
        typeof rawSignal.aborted !== 'boolean')
    ) {
      throw validationError();
    }
    const callerSignal: AbortSignal | undefined = rawSignal ?? undefined;
    throwIfAborted(callerSignal);

    // 1. Strict WRITE tool rejection before transport
    if (toolName === 'myslack.chat_postMessage' || toolName.includes('write')) {
      throw new StepError({
        message: `Tool "${toolName}" is a write operation and cannot be dispatched via PersonalSlackReadAdapter`,
        category: 'VALIDATION',
        statusCode: 400,
      });
    }

    // 2. Lookup definition in canonical read tools
    const toolDef = MYSLACK_CORE_READ_TOOLS.find((t) => t.name === toolName);
    if (!toolDef || toolDef.sideEffect !== 'read') {
      throw new StepError({
        message: `Execution of unknown or non-read tool "${toolName}" is not permitted by PersonalSlackReadAdapter`,
        category: 'VALIDATION',
        statusCode: 400,
      });
    }

    // 3. Fail-closed args and binding validation (detached copy)
    const { binding, params } = validateSlackToolExecutionArgs<Record<string, any>>(toolDef, args);
    const cleanBinding = deepFreeze(validateSlackBinding(binding));

    // 4. Determine purpose from server context (never storage, never model-decided)
    const rawPurpose = context?.purpose ?? 'manual_lookup';
    if (
      rawPurpose !== 'manual_lookup' &&
      rawPurpose !== 'triage' &&
      rawPurpose !== 'planning' &&
      rawPurpose !== 'digest'
    ) {
      throw new StepError({
        message:
          "Disallowed SlackReadPurpose. Purpose must be one of ['manual_lookup', 'triage', 'planning', 'digest'].",
        category: 'VALIDATION',
        statusCode: 400,
      });
    }
    const purpose: SlackReadPurpose = rawPurpose;

    // 5. Fixed switch dispatcher for the 8 core read methods
    switch (toolName) {
      case 'myslack.conversations_list':
        return await this.conversationsList(cleanBinding, params, purpose, callerSignal);
      case 'myslack.conversations_info':
        return await this.conversationsInfo(cleanBinding, params, purpose, callerSignal);
      case 'myslack.conversations_history':
        return await this.conversationsHistory(cleanBinding, params, purpose, callerSignal);
      case 'myslack.conversations_replies':
        return await this.conversationsReplies(cleanBinding, params, purpose, callerSignal);
      case 'myslack.conversations_members':
        return await this.conversationsMembers(cleanBinding, params, purpose, callerSignal);
      case 'myslack.users_list':
        return await this.usersList(cleanBinding, params, purpose, callerSignal);
      case 'myslack.users_info':
        return await this.usersInfo(cleanBinding, params, purpose, callerSignal);
      case 'myslack.chat_getPermalink':
        return await this.chatGetPermalink(cleanBinding, params, purpose, callerSignal);
      default:
        throw new StepError({
          message: `Unhandled canonical read method: "${toolName}"`,
          category: 'VALIDATION',
          statusCode: 400,
        });
    }
  }

  private async verifyPolicy(
    binding: SlackBinding,
    purpose: SlackReadPurpose,
    expectedRef?: SlackPolicyReference,
    signal?: AbortSignal
  ): Promise<SlackPolicyReference> {
    throwIfAborted(signal);

    const clonedExpected = expectedRef ? deepFreeze(structuredClone(expectedRef)) : undefined;
    const input: SlackAuthorizeReadInput = {
      binding: deepFreeze(structuredClone(binding)),
      purpose,
      requestedRetentionDays: 0,
      ...(clonedExpected ? { expectedPolicyReference: clonedExpected } : {}),
    };

    let decision: unknown;
    try {
      decision = await awaitWithAbort(
        Promise.resolve().then(() => this.policy.authorizeRead(input)),
        signal
      );
    } catch {
      throwIfAborted(signal);
      throw new StepError({
        message: 'Slack read policy hook failed during authorization',
        category: 'AUTH_ERROR',
        statusCode: 403,
      });
    }

    throwIfAborted(signal);

    if (!isPlainObject(decision) || decision.allowed !== true) {
      const rawReason = isPlainObject(decision) ? decision.reason : undefined;
      const reason =
        typeof rawReason === 'string' && WHITELISTED_POLICY_DENIAL_REASONS.has(rawReason)
          ? rawReason
          : undefined;
      throw new StepError({
        message: reason
          ? `Slack read policy authorization denied: ${reason}`
          : 'Slack read policy authorization denied',
        category: 'AUTH_ERROR',
        statusCode: 403,
      });
    }

    let validatedRef: SlackPolicyReference;
    try {
      validatedRef = validateSlackPolicyReference(decision.policyReference);
    } catch {
      throw new StepError({
        message: 'Malformed or invalid policy reference returned by read policy hook',
        category: 'AUTH_ERROR',
        statusCode: 403,
      });
    }

    // Exact 5-field binding structural comparison
    if (
      validatedRef.binding.atiUserId !== binding.atiUserId ||
      validatedRef.binding.connectionId !== binding.connectionId ||
      validatedRef.binding.workspaceId !== binding.workspaceId ||
      validatedRef.binding.slackUserId !== binding.slackUserId ||
      validatedRef.binding.identityVersion !== binding.identityVersion
    ) {
      throw new StepError({
        message: 'Policy reference binding does not match requested execution binding',
        category: 'AUTH_ERROR',
        statusCode: 403,
      });
    }

    if (validatedRef.purpose !== purpose) {
      throw new StepError({
        message: 'Policy reference purpose does not match the requested purpose',
        category: 'AUTH_ERROR',
        statusCode: 403,
      });
    }

    if (validatedRef.requestedRetentionDays !== 0) {
      throw new StepError({
        message: 'Slack read adapter must have requestedRetentionDays === 0',
        category: 'AUTH_ERROR',
        statusCode: 403,
      });
    }

    if (expectedRef) {
      // Re-auth comparison against the immutable internal snapshot. A hook cannot
      // mutate the expected reference because it only ever receives frozen clones.
      if (
        validatedRef.providerProfileId !== expectedRef.providerProfileId ||
        validatedRef.configFingerprint !== expectedRef.configFingerprint ||
        validatedRef.policyVersion !== expectedRef.policyVersion ||
        validatedRef.consentRevision !== expectedRef.consentRevision ||
        validatedRef.providerRevision !== expectedRef.providerRevision
      ) {
        throw new StepError({
          message: 'Policy reference epoch mismatch: authorization state changed during read execution',
          category: 'AUTH_ERROR',
          statusCode: 403,
        });
      }
    }

    return deepFreeze(validatedRef);
  }

  private async requestSlackGet(
    endpoint: string,
    queryParams: Record<string, string | number | boolean | undefined>,
    binding: SlackBinding,
    purpose: SlackReadPurpose,
    parentSignal?: AbortSignal
  ): Promise<{ data: JsonObject; policyRef: SlackPolicyReference }> {
    throwIfAborted(parentSignal);

    // The deadline and caller signal cover the entire operation, including hooks,
    // transport, body streaming, backoff waits, and post-response authorization.
    const timeoutSignal = AbortSignal.timeout(this.requestTimeoutMs);
    const combinedSignal = parentSignal
      ? AbortSignal.any([parentSignal, timeoutSignal])
      : timeoutSignal;

    throwIfAborted(combinedSignal);

    // Pre-fetch Phase 1 F1 authorization
    const prefetchPolicyRef = await this.verifyPolicy(binding, purpose, undefined, combinedSignal);
    throwIfAborted(combinedSignal);

    // Token acquisition from the private backend wrapper. The hook receives a
    // detached frozen snapshot: it cannot rebind workspace, actor, or connection.
    let token: string;
    try {
      const tokenBinding = deepFreeze(structuredClone(binding));
      token = await awaitWithAbort(
        Promise.resolve().then(() => this.tokens.getAccessToken(tokenBinding)),
        combinedSignal
      );
    } catch {
      throwIfAborted(combinedSignal);
      throw new StepError({
        message: 'Failed to acquire access token from token provider',
        category: 'AUTH_ERROR',
        statusCode: 401,
      });
    }

    if (
      typeof token !== 'string' ||
      token.length === 0 ||
      token.length > MAX_TOKEN_LENGTH ||
      /[\r\n]/.test(token)
    ) {
      throw new StepError({
        message: 'Slack token provider returned invalid or empty token',
        category: 'AUTH_ERROR',
        statusCode: 401,
      });
    }

    throwIfAborted(combinedSignal);

    const cleanBase = this.apiBase.endsWith('/') ? this.apiBase.slice(0, -1) : this.apiBase;
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
    const url = new URL(`${cleanBase}/${cleanEndpoint}`);
    for (const [key, val] of Object.entries(queryParams)) {
      if (val !== undefined && val !== null && val !== '') {
        url.searchParams.set(key, String(val));
      }
    }

    let attempt = 0;

    for (;;) {
      attempt++;
      throwIfAborted(combinedSignal);

      // Re-authorize with the same immutable initial epoch before every attempt.
      await this.verifyPolicy(binding, purpose, prefetchPolicyRef, combinedSignal);
      throwIfAborted(combinedSignal);

      let response: Response;
      try {
        response = await this.fetchFn(url.toString(), {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
          redirect: 'manual',
          signal: combinedSignal,
        });
      } catch {
        throwIfAborted(combinedSignal);
        throw networkError();
      }

      // Reject redirects immediately and release the unused body.
      if (response.status >= 300 && response.status < 400) {
        await cancelResponseBody(response);
        throw new StepError({
          message: 'Slack API returned an unexpected redirect; redirects are rejected',
          category: 'AUTH_ERROR',
          statusCode: response.status,
        });
      }

      // Handle 429 rate limiting with a bounded, abortable backoff.
      if (response.status === 429) {
        await cancelResponseBody(response);
        if (attempt >= MAX_ATTEMPTS) {
          throw new StepError({
            message: 'Slack API rate limit exceeded after the bounded retry budget',
            category: 'RATE_LIMIT',
            statusCode: 429,
            retryable: false,
          });
        }
        const delay = retryAfterMs(response.headers.get('retry-after'));
        try {
          await waitWithSignal(delay, combinedSignal);
        } catch {
          throw abortError();
        }
        continue;
      }

      const bodyText = await readResponseBodyBounded(response, combinedSignal);
      throwIfAborted(combinedSignal);

      let parsed: unknown;
      try {
        parsed = JSON.parse(bodyText);
      } catch {
        throw new StepError({
          message: 'Slack API returned malformed JSON response',
          category: 'SERVER_ERROR',
          statusCode: 502,
        });
      }

      // Non-2xx HTTP status can never become success through a JSON ok flag.
      if (response.status < 200 || response.status >= 300) {
        const providerCode =
          isPlainObject(parsed) && typeof parsed.error === 'string' ? parsed.error : undefined;
        this.mapSlackError(providerCode, response.status);
      }

      // Strict boolean check on the provider ok flag.
      if (!isPlainObject(parsed) || parsed.ok !== true) {
        const providerCode =
          isPlainObject(parsed) && typeof parsed.error === 'string' ? parsed.error : undefined;
        this.mapSlackError(providerCode, response.status);
      }

      const data = parsed as JsonObject;

      // Post-fetch Phase 2 F1 re-authorization. Drop the payload immediately on
      // any failure so a late authorization cannot release plaintext.
      try {
        await this.verifyPolicy(binding, purpose, prefetchPolicyRef, combinedSignal);
      } catch (postAuthErr) {
        throw postAuthErr;
      }
      throwIfAborted(combinedSignal);

      return { data, policyRef: prefetchPolicyRef };
    }
  }

  private mapSlackError(error: unknown, statusCode: number): never {
    const code = typeof error === 'string' ? error : '';

    switch (code) {
      case 'invalid_auth':
      case 'not_authed':
      case 'account_inactive':
      case 'token_revoked':
      case 'team_not_found':
        throw new StepError({
          message: 'Slack API authentication failed',
          category: 'AUTH_ERROR',
          statusCode: 401,
        });
      case 'missing_scope':
        throw new StepError({
          message: 'Slack API authorization scope missing',
          category: 'AUTH_ERROR',
          statusCode: 403,
        });
      case 'channel_not_found':
      case 'not_in_channel':
        throw new StepError({
          message: 'Slack channel inaccessible or not found',
          category: 'NOT_FOUND',
          statusCode: 404,
        });
      case 'user_not_found':
        throw new StepError({
          message: 'Slack user not found',
          category: 'NOT_FOUND',
          statusCode: 404,
        });
      case 'message_not_found':
      case 'thread_not_found':
        throw new StepError({
          message: 'Slack message or thread not found',
          category: 'NOT_FOUND',
          statusCode: 404,
        });
      case 'ratelimited':
        throw new StepError({
          message: 'Slack rate limit exceeded',
          category: 'RATE_LIMIT',
          statusCode: 429,
        });
      default:
        throw new StepError({
          message: `Slack API request failed (HTTP ${statusCode})`,
          category: statusCode >= 500 ? 'SERVER_ERROR' : 'UNKNOWN',
          statusCode,
        });
    }
  }

  private sanitizeAndRethrow(err: unknown): never {
    // Argument validation is caller-facing and throws TypeError with only
    // caller-supplied identifiers; all transport/provider/hook errors below are
    // rebuilt with fixed messages, no cause, and no raw details.
    if (err instanceof TypeError) {
      throw err;
    }
    if (err instanceof StepError) {
      throw new StepError({
        message: sanitizeTokens(err.message),
        category: err.category,
        statusCode: err.statusCode,
        retryable: err.retryable,
      });
    }
    throw new StepError({
      message: 'Slack read execution failed',
      category: 'UNKNOWN',
    });
  }

  // --- 8 Core Read Methods Implementation ---

  private async conversationsList(
    binding: SlackBinding,
    params: Record<string, any>,
    purpose: SlackReadPurpose,
    signal?: AbortSignal
  ): Promise<SlackConversationsListResult> {
    const limit = readLimitParam(params, DEFAULT_PAGE_LIMITS.conversationsList);
    const cursor = readCursorParam(params);
    const types = readOptionalStringParam(params, 'types', 256);
    const excludeArchived = readOptionalBooleanParam(params, 'exclude_archived');

    const { data, policyRef } = await this.requestSlackGet(
      'conversations.list',
      {
        cursor,
        limit,
        types,
        exclude_archived: excludeArchived,
      },
      binding,
      purpose,
      signal
    );

    const rawChannels = readProviderArray(data, 'channels', limit);
    const { nextCursor, hasMore } = readPagination(data);
    const now = new Date().toISOString();

    const channels: SlackConversationSummary[] = rawChannels.map((raw) => {
      if (!isPlainObject(raw)) throw protocolError();
      const fields = readConversationSummaryFields(raw);
      const identity: SlackResourceIdentity = {
        type: 'conversation',
        channelId: fields.id,
      };
      const provenance = buildProvenance(
        binding,
        identity,
        now,
        policyRef,
        undefined,
        computeDigest(fields)
      );
      return { ...fields, provenance };
    });

    const containerIdentity: SlackResourceIdentity = { type: 'conversation' };
    const containerDigest = computeDigest({
      channels: channels.map((channel) => channel.id),
      nextCursor,
      hasMore,
    });

    return {
      ok: true,
      channels,
      nextCursor,
      hasMore,
      provenance: buildProvenance(
        binding,
        containerIdentity,
        now,
        policyRef,
        undefined,
        containerDigest
      ),
    };
  }

  private async conversationsInfo(
    binding: SlackBinding,
    params: Record<string, any>,
    purpose: SlackReadPurpose,
    signal?: AbortSignal
  ): Promise<SlackConversationsInfoResult> {
    const channelId = readChannelParam(params);
    const includeLocale = readOptionalBooleanParam(params, 'include_locale');
    const includeNumMembers = readOptionalBooleanParam(params, 'include_num_members');

    const { data, policyRef } = await this.requestSlackGet(
      'conversations.info',
      {
        channel: channelId,
        include_locale: includeLocale,
        include_num_members: includeNumMembers,
      },
      binding,
      purpose,
      signal
    );

    if (!isPlainObject(data.channel)) throw protocolError();
    const fields = readConversationDetailFields(data.channel);

    if (fields.id !== channelId) {
      throw new StepError({
        message: 'Provider conversation identity does not match the requested channel',
        category: 'NOT_FOUND',
        statusCode: 404,
      });
    }

    const now = new Date().toISOString();
    const identity: SlackResourceIdentity = {
      type: 'conversation',
      channelId: fields.id,
    };
    const provenance = buildProvenance(
      binding,
      identity,
      now,
      policyRef,
      undefined,
      computeDigest(fields)
    );

    const channel: SlackConversationDetail = { ...fields, provenance };
    return { ok: true, channel, provenance };
  }

  private async conversationsHistory(
    binding: SlackBinding,
    params: Record<string, any>,
    purpose: SlackReadPurpose,
    signal?: AbortSignal
  ): Promise<SlackConversationsHistoryResult> {
    const channelId = readChannelParam(params);
    const limit = readLimitParam(params, DEFAULT_PAGE_LIMITS.conversationsHistory);
    const cursor = readCursorParam(params);
    const latest = readOptionalTimestampParam(params, 'latest');
    const oldest = readOptionalTimestampParam(params, 'oldest');
    const inclusive = readOptionalBooleanParam(params, 'inclusive');

    const { data, policyRef } = await this.requestSlackGet(
      'conversations.history',
      {
        channel: channelId,
        cursor,
        limit,
        latest,
        oldest,
        inclusive,
      },
      binding,
      purpose,
      signal
    );

    const rawMessages = readProviderArray(data, 'messages', limit);
    const { nextCursor, hasMore } = readPagination(data);
    const now = new Date().toISOString();

    const messages: SlackMessageObservation[] = rawMessages.map((raw) => {
      const fields = readMessageFields(raw);
      const identity: SlackResourceIdentity = {
        type: 'message',
        channelId,
        messageTs: fields.ts,
      };
      const nativeRevision = fields.edited?.ts ?? fields.ts;
      const provenance = buildProvenance(
        binding,
        identity,
        now,
        policyRef,
        nativeRevision,
        computeDigest(fields)
      );
      return { ...fields, provenance };
    });

    const containerIdentity: SlackResourceIdentity = {
      type: 'message',
      channelId,
    };
    const containerDigest = computeDigest({
      messages: messages.map((message) => message.ts),
      nextCursor,
      hasMore,
    });

    return {
      ok: true,
      messages,
      nextCursor,
      hasMore,
      provenance: buildProvenance(
        binding,
        containerIdentity,
        now,
        policyRef,
        undefined,
        containerDigest
      ),
    };
  }

  private async conversationsReplies(
    binding: SlackBinding,
    params: Record<string, any>,
    purpose: SlackReadPurpose,
    signal?: AbortSignal
  ): Promise<SlackConversationsRepliesResult> {
    const channelId = readChannelParam(params);
    const threadTs = readTimestampParam(params, 'ts');
    const limit = readLimitParam(params, DEFAULT_PAGE_LIMITS.conversationsReplies);
    const cursor = readCursorParam(params);
    const latest = readOptionalTimestampParam(params, 'latest');
    const oldest = readOptionalTimestampParam(params, 'oldest');
    const inclusive = readOptionalBooleanParam(params, 'inclusive');

    const { data, policyRef } = await this.requestSlackGet(
      'conversations.replies',
      {
        channel: channelId,
        ts: threadTs,
        cursor,
        limit,
        latest,
        oldest,
        inclusive,
      },
      binding,
      purpose,
      signal
    );

    const rawMessages = readProviderArray(data, 'messages', limit);
    const { nextCursor, hasMore } = readPagination(data);
    const now = new Date().toISOString();

    const messages: SlackMessageObservation[] = rawMessages.map((raw) => {
      const fields = readMessageFields(raw);
      const identity: SlackResourceIdentity = {
        type: 'message',
        channelId,
        messageTs: fields.ts,
      };
      const nativeRevision = fields.edited?.ts ?? fields.ts;
      const provenance = buildProvenance(
        binding,
        identity,
        now,
        policyRef,
        nativeRevision,
        computeDigest(fields)
      );
      return { ...fields, provenance };
    });

    const containerIdentity: SlackResourceIdentity = {
      type: 'message',
      channelId,
      messageTs: threadTs,
    };
    const containerDigest = computeDigest({
      messages: messages.map((message) => message.ts),
      nextCursor,
      hasMore,
    });

    return {
      ok: true,
      messages,
      nextCursor,
      hasMore,
      provenance: buildProvenance(
        binding,
        containerIdentity,
        now,
        policyRef,
        undefined,
        containerDigest
      ),
    };
  }

  private async conversationsMembers(
    binding: SlackBinding,
    params: Record<string, any>,
    purpose: SlackReadPurpose,
    signal?: AbortSignal
  ): Promise<SlackConversationsMembersResult> {
    const channelId = readChannelParam(params);
    const limit = readLimitParam(params, DEFAULT_PAGE_LIMITS.conversationsMembers);
    const cursor = readCursorParam(params);

    const { data, policyRef } = await this.requestSlackGet(
      'conversations.members',
      {
        channel: channelId,
        cursor,
        limit,
      },
      binding,
      purpose,
      signal
    );

    const rawMembers = readProviderArray(data, 'members', limit);
    const { nextCursor, hasMore } = readPagination(data);

    const members: string[] = rawMembers.map((raw) => {
      if (
        typeof raw !== 'string' ||
        raw.length === 0 ||
        raw.length > MAX_ID_LENGTH ||
        raw.trim().length === 0
      ) {
        throw protocolError();
      }
      return raw;
    });

    const now = new Date().toISOString();
    const identity: SlackResourceIdentity = {
      type: 'members',
      channelId,
    };
    const digest = computeDigest({ members, nextCursor, hasMore });

    return {
      ok: true,
      members,
      nextCursor,
      hasMore,
      provenance: buildProvenance(binding, identity, now, policyRef, undefined, digest),
    };
  }

  private async usersList(
    binding: SlackBinding,
    params: Record<string, any>,
    purpose: SlackReadPurpose,
    signal?: AbortSignal
  ): Promise<SlackUsersListResult> {
    const limit = readLimitParam(params, DEFAULT_PAGE_LIMITS.usersList);
    const cursor = readCursorParam(params);
    const includeLocale = readOptionalBooleanParam(params, 'include_locale');

    const { data, policyRef } = await this.requestSlackGet(
      'users.list',
      {
        cursor,
        limit,
        include_locale: includeLocale,
      },
      binding,
      purpose,
      signal
    );

    const rawMembers = readProviderArray(data, 'members', limit);
    const { nextCursor, hasMore } = readPagination(data);
    const now = new Date().toISOString();

    const members: SlackUserSummary[] = rawMembers.map((raw) => {
      if (!isPlainObject(raw)) throw protocolError();
      const fields = readUserFields(raw);
      const identity: SlackResourceIdentity = {
        type: 'user',
        userId: fields.id,
      };
      const provenance = buildProvenance(
        binding,
        identity,
        now,
        policyRef,
        undefined,
        computeDigest(fields)
      );
      return { ...fields, provenance };
    });

    const containerIdentity: SlackResourceIdentity = { type: 'users' };
    const containerDigest = computeDigest({
      members: members.map((member) => member.id),
      nextCursor,
      hasMore,
    });

    return {
      ok: true,
      members,
      nextCursor,
      hasMore,
      provenance: buildProvenance(
        binding,
        containerIdentity,
        now,
        policyRef,
        undefined,
        containerDigest
      ),
    };
  }

  private async usersInfo(
    binding: SlackBinding,
    params: Record<string, any>,
    purpose: SlackReadPurpose,
    signal?: AbortSignal
  ): Promise<SlackUsersInfoResult> {
    const userId = readUserParam(params);
    const includeLocale = readOptionalBooleanParam(params, 'include_locale');

    const { data, policyRef } = await this.requestSlackGet(
      'users.info',
      {
        user: userId,
        include_locale: includeLocale,
      },
      binding,
      purpose,
      signal
    );

    if (!isPlainObject(data.user)) throw protocolError();
    const fields = readUserFields(data.user);

    if (fields.id !== userId) {
      throw new StepError({
        message: 'Provider user identity does not match the requested lookup identity',
        category: 'NOT_FOUND',
        statusCode: 404,
      });
    }

    const now = new Date().toISOString();
    const identity: SlackResourceIdentity = {
      type: 'user',
      userId: fields.id,
    };
    const provenance = buildProvenance(
      binding,
      identity,
      now,
      policyRef,
      undefined,
      computeDigest(fields)
    );

    const user: SlackUserDetail = { ...fields, provenance };
    return { ok: true, user, provenance };
  }

  private async chatGetPermalink(
    binding: SlackBinding,
    params: Record<string, any>,
    purpose: SlackReadPurpose,
    signal?: AbortSignal
  ): Promise<SlackPermalinkObservation> {
    const channelId = readChannelParam(params);
    const messageTs = readTimestampParam(params, 'message_ts');

    const { data, policyRef } = await this.requestSlackGet(
      'chat.getPermalink',
      {
        channel: channelId,
        message_ts: messageTs,
      },
      binding,
      purpose,
      signal
    );

    const permalink = data.permalink;
    if (
      typeof permalink !== 'string' ||
      permalink.length === 0 ||
      permalink.length > MAX_URL_LENGTH
    ) {
      throw protocolError();
    }

    const providerChannel = data.channel;
    if (typeof providerChannel !== 'string' || providerChannel.length === 0) {
      throw protocolError();
    }
    if (providerChannel !== channelId) {
      throw new StepError({
        message: 'Provider permalink channel does not match the requested channel',
        category: 'NOT_FOUND',
        statusCode: 404,
      });
    }

    const match = SAFE_PERMALINK_REGEX.exec(permalink);
    if (!match) throw protocolError();
    const pathChannel = match[2];
    const pathDigits = match[3];
    if (
      typeof pathChannel !== 'string' ||
      typeof pathDigits !== 'string' ||
      pathChannel !== channelId ||
      pathDigits !== messageTs.replace('.', '')
    ) {
      throw protocolError();
    }

    const now = new Date().toISOString();
    const cleanOutput = {
      ok: true as const,
      channel: channelId,
      permalink,
    };

    const identity: SlackResourceIdentity = {
      type: 'permalink',
      channelId,
      messageTs,
    };
    const provenance = buildProvenance(
      binding,
      identity,
      now,
      policyRef,
      undefined,
      computeDigest(cleanOutput)
    );

    return {
      ...cleanOutput,
      provenance,
    };
  }
}
