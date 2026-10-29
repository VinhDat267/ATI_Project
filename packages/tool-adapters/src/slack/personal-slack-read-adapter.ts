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

const TOKEN_REDACTION_REGEX = /(?:xox[baprs]-[a-zA-Z0-9-]+|Bearer\s+[a-zA-Z0-9._~+/-]+)/gi;
const SAFE_PERMALINK_REGEX = /^https:\/\/[a-z0-9_-]+\.slack\.com\/archives\/[A-Z0-9_]+\/p[0-9]+$/;
const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2MB

function sanitizeTokens(text: string): string {
  if (!text || typeof text !== 'string') return text;
  return text.replace(TOKEN_REDACTION_REGEX, '[REDACTED]');
}

function computeDigest(payload: unknown): string {
  const json = JSON.stringify(payload);
  return crypto.createHash('sha256').update(json).digest('hex');
}

function validateApiBaseUrl(rawBase?: string): string {
  if (!rawBase) return 'https://slack.com/api';
  const trimmed = rawBase.trim().replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch (err) {
    throw new StepError({
      message: `Invalid apiBaseUrl: "${rawBase}"`,
      category: 'VALIDATION',
      statusCode: 400,
    });
  }

  if (
    url.protocol === 'https:' &&
    (url.hostname === 'slack.com' || url.hostname.endsWith('.slack.com'))
  ) {
    return trimmed;
  }
  if (
    url.protocol === 'http:' &&
    (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
  ) {
    return trimmed;
  }

  throw new StepError({
    message: `Unsafe or disallowed apiBaseUrl: "${rawBase}". Only native Slack HTTPS or loopback fixture is allowed.`,
    category: 'VALIDATION',
    statusCode: 400,
  });
}

async function readResponseBodyBounded(response: Response, maxBytes = MAX_BODY_BYTES): Promise<string> {
  const contentLength = response.headers.get('content-length');
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new StepError({
      message: `Response body exceeded 2MB limit (Content-Length: ${contentLength})`,
      category: 'SERVER_ERROR',
      statusCode: 502,
    });
  }

  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.byteLength;
          if (totalBytes > maxBytes) {
            throw new StepError({
              message: `Response stream exceeded 2MB limit (${totalBytes} bytes)`,
              category: 'SERVER_ERROR',
              statusCode: 502,
            });
          }
          chunks.push(value);
        }
      }
    } finally {
      reader.releaseLock();
    }
    const merged = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(merged);
  } else {
    const text = await response.text();
    const byteLength = Buffer.byteLength(text, 'utf8');
    if (byteLength > maxBytes) {
      throw new StepError({
        message: `Response body exceeded 2MB limit (${byteLength} bytes)`,
        category: 'SERVER_ERROR',
        statusCode: 502,
      });
    }
    return text;
  }
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

    this.tokens = config.tokens;
    this.policy = config.policy;
    this.apiBase = validateApiBaseUrl(config.apiBaseUrl);
    this.fetchFn = config.fetchFn ?? globalThis.fetch;
    this.requestTimeoutMs = config.requestTimeoutMs ?? 10_000;
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
    const callerSignal: AbortSignal | undefined = context?.signal;
    if (callerSignal?.aborted) {
      throw new StepError({
        message: 'Slack read aborted before start',
        category: 'NETWORK',
        cause: callerSignal.reason,
      });
    }

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
    const cleanBinding = validateSlackBinding(binding);

    // 4. Determine purpose from server context (never storage, never model-decided)
    const rawPurpose = context?.purpose ?? 'manual_lookup';
    if (
      rawPurpose !== 'manual_lookup' &&
      rawPurpose !== 'triage' &&
      rawPurpose !== 'planning' &&
      rawPurpose !== 'digest'
    ) {
      throw new StepError({
        message: `Disallowed SlackReadPurpose: "${String(rawPurpose)}". Purpose must be one of ['manual_lookup', 'triage', 'planning', 'digest'].`,
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
    expectedRef?: SlackPolicyReference
  ): Promise<SlackPolicyReference> {
    const input: SlackAuthorizeReadInput = {
      binding,
      purpose,
      requestedRetentionDays: 0,
      ...(expectedRef ? { expectedPolicyReference: expectedRef } : {}),
    };

    const decision = await this.policy.authorizeRead(input);

    if (!decision || typeof decision !== 'object' || !decision.allowed) {
      const reason = (decision as any)?.reason ?? 'policy_denied';
      throw new StepError({
        message: `Slack read policy authorization denied: ${reason}`,
        category: 'AUTH_ERROR',
        statusCode: 403,
      });
    }

    let validatedRef: SlackPolicyReference;
    try {
      validatedRef = validateSlackPolicyReference(decision.policyReference);
    } catch (valErr: any) {
      throw new StepError({
        message: `Malformed or invalid policy reference returned by read policy hook: ${valErr?.message || String(valErr)}`,
        category: 'AUTH_ERROR',
        statusCode: 403,
        cause: valErr,
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
        message: `Policy reference purpose "${validatedRef.purpose}" does not match requested "${purpose}"`,
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
      // Re-auth comparison: verify all epoch components match exactly
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

    return validatedRef;
  }

  private async requestSlackGet(
    endpoint: string,
    queryParams: Record<string, string | number | boolean | undefined>,
    binding: SlackBinding,
    purpose: SlackReadPurpose,
    parentSignal?: AbortSignal
  ): Promise<{ data: any; policyRef: SlackPolicyReference }> {
    if (parentSignal?.aborted) {
      throw new StepError({
        message: 'Slack read aborted before start',
        category: 'NETWORK',
        cause: parentSignal.reason,
      });
    }

    // Pre-fetch Phase 1 F1 authorization
    const prefetchPolicyRef = await this.verifyPolicy(binding, purpose);

    if (parentSignal?.aborted) {
      throw new StepError({
        message: 'Slack read aborted after policy verification',
        category: 'NETWORK',
        cause: parentSignal.reason,
      });
    }

    // Token acquisition from private backend wrapper
    const token = await this.tokens.getAccessToken(binding);
    if (!token || typeof token !== 'string') {
      throw new StepError({
        message: 'Slack token provider returned invalid or empty token',
        category: 'AUTH_ERROR',
        statusCode: 401,
      });
    }

    if (parentSignal?.aborted) {
      throw new StepError({
        message: 'Slack read aborted after token acquisition',
        category: 'NETWORK',
        cause: parentSignal.reason,
      });
    }

    // Setup combined timeout and caller signal
    const timeoutSignal = AbortSignal.timeout(this.requestTimeoutMs);
    const combinedSignal = parentSignal
      ? AbortSignal.any([parentSignal, timeoutSignal])
      : timeoutSignal;

    // Build URL with query parameters
    const url = new URL(this.apiBase + (endpoint.startsWith('/') ? endpoint : `/${endpoint}`));
    for (const [key, val] of Object.entries(queryParams)) {
      if (val !== undefined && val !== null && val !== '') {
        url.searchParams.set(key, String(val));
      }
    }

    const maxAttempts = 3;
    let attempt = 0;

    for (;;) {
      attempt++;

      if (combinedSignal.aborted) {
        throw new StepError({
          message: 'Slack read aborted before HTTP dispatch',
          category: 'NETWORK',
          cause: combinedSignal.reason,
        });
      }

      // Re-authorize with expectedRef before EACH outbound attempt (initial and retries)
      await this.verifyPolicy(binding, purpose, prefetchPolicyRef);

      if (combinedSignal.aborted) {
        throw new StepError({
          message: 'Slack read aborted after retry authorization',
          category: 'NETWORK',
          cause: combinedSignal.reason,
        });
      }

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
      } catch (fetchErr: any) {
        if (combinedSignal.aborted) {
          throw new StepError({
            message: 'Slack HTTP request aborted',
            category: 'NETWORK',
            cause: combinedSignal.reason,
          });
        }
        throw new StepError({
          message: `Slack network error: ${fetchErr?.message || 'failed to fetch'}`,
          category: 'NETWORK',
          cause: fetchErr,
        });
      }

      // Reject redirects immediately
      if (response.status >= 300 && response.status < 400) {
        throw new StepError({
          message: `Slack API returned unexpected redirect (${response.status}); redirects are rejected for security`,
          category: 'AUTH_ERROR',
          statusCode: response.status,
        });
      }

      // Handle 429 Rate Limiting
      if (response.status === 429) {
        if (attempt >= maxAttempts) {
          throw new StepError({
            message: 'Slack API rate limit exceeded (429) after max retries',
            category: 'RATE_LIMIT',
            statusCode: 429,
            retryable: false,
          });
        }
        const retryHeader = response.headers.get('retry-after');
        const delay = retryAfterMs(retryHeader);
        try {
          await waitWithSignal(delay, combinedSignal);
        } catch (waitErr: any) {
          throw new StepError({
            message: 'Slack rate limit backoff wait aborted',
            category: 'NETWORK',
            cause: waitErr,
          });
        }
        continue;
      }

      // Bounded body read (2MB limit)
      const bodyText = await readResponseBodyBounded(response, MAX_BODY_BYTES);

      let parsed: any;
      try {
        parsed = JSON.parse(bodyText);
      } catch (jsonErr) {
        throw new StepError({
          message: 'Slack API returned malformed non-JSON response',
          category: 'SERVER_ERROR',
          statusCode: response.status,
          cause: jsonErr,
        });
      }

      // Handle provider application errors
      if (!parsed.ok) {
        const slackErr = parsed.error || 'unknown_slack_error';
        this.mapSlackError(slackErr, response.status);
      }

      // Post-fetch Phase 2 F1 Re-Authorization
      try {
        await this.verifyPolicy(binding, purpose, prefetchPolicyRef);
      } catch (postAuthErr) {
        // DROP payload immediately, do not release plaintext
        parsed = null;
        throw postAuthErr;
      }

      return { data: parsed, policyRef: prefetchPolicyRef };
    }
  }

  private mapSlackError(error: string, statusCode: number): never {
    switch (error) {
      case 'invalid_auth':
      case 'not_authed':
      case 'account_inactive':
      case 'token_revoked':
      case 'team_not_found':
        throw new StepError({
          message: `Slack authentication error: ${error}`,
          category: 'AUTH_ERROR',
          statusCode: 401,
        });
      case 'missing_scope':
        throw new StepError({
          message: `Slack authorization scope missing: ${error}`,
          category: 'AUTH_ERROR',
          statusCode: 403,
        });
      case 'channel_not_found':
      case 'not_in_channel':
        throw new StepError({
          message: `Slack channel inaccessible or not found: ${error}`,
          category: 'NOT_FOUND',
          statusCode: 404,
        });
      case 'user_not_found':
        throw new StepError({
          message: `Slack user not found: ${error}`,
          category: 'NOT_FOUND',
          statusCode: 404,
        });
      case 'message_not_found':
      case 'thread_not_found':
        throw new StepError({
          message: `Slack message or thread not found: ${error}`,
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
          message: `Slack API error: ${error}`,
          category: statusCode >= 500 ? 'SERVER_ERROR' : 'UNKNOWN',
          statusCode,
        });
    }
  }

  private sanitizeAndRethrow(err: unknown): never {
    if (err instanceof TypeError) {
      throw err;
    }
    if (err instanceof StepError) {
      const cleanMessage = sanitizeTokens(err.message);
      throw new StepError({
        message: cleanMessage,
        category: err.category,
        statusCode: err.statusCode,
        retryable: err.retryable,
        details: err.details ? JSON.parse(sanitizeTokens(JSON.stringify(err.details))) : undefined,
        cause: err.cause instanceof Error ? new Error(sanitizeTokens(err.cause.message)) : err.cause,
      });
    }
    if (err instanceof Error) {
      throw new StepError({
        message: sanitizeTokens(err.message),
        category: err.name === 'AbortError' ? 'NETWORK' : 'UNKNOWN',
        cause: err,
      });
    }
    throw new StepError({
      message: 'Unknown error during Slack execution',
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
    const { data, policyRef } = await this.requestSlackGet(
      'conversations.list',
      {
        cursor: params.cursor,
        limit: params.limit ? Math.min(Number(params.limit), 100) : 50,
        types: params.types,
        exclude_archived: params.exclude_archived,
      },
      binding,
      purpose,
      signal
    );

    const now = new Date().toISOString();
    const rawChannels = Array.isArray(data.channels) ? data.channels : [];

    const channels: SlackConversationSummary[] = rawChannels.map((c: any) => {
      const cleanSummary: Record<string, unknown> = {
        id: String(c.id),
        name: typeof c.name === 'string' ? c.name : undefined,
        is_channel: typeof c.is_channel === 'boolean' ? c.is_channel : undefined,
        is_group: typeof c.is_group === 'boolean' ? c.is_group : undefined,
        is_im: typeof c.is_im === 'boolean' ? c.is_im : undefined,
        is_mpim: typeof c.is_mpim === 'boolean' ? c.is_mpim : undefined,
        is_private: typeof c.is_private === 'boolean' ? c.is_private : undefined,
        created: typeof c.created === 'number' ? c.created : undefined,
        is_archived: typeof c.is_archived === 'boolean' ? c.is_archived : undefined,
        is_general: typeof c.is_general === 'boolean' ? c.is_general : undefined,
        unlinked: typeof c.unlinked === 'number' ? c.unlinked : undefined,
        creator: typeof c.creator === 'string' ? c.creator : undefined,
        name_normalized: typeof c.name_normalized === 'string' ? c.name_normalized : undefined,
        is_shared: typeof c.is_shared === 'boolean' ? c.is_shared : undefined,
        is_org_shared: typeof c.is_org_shared === 'boolean' ? c.is_org_shared : undefined,
        context_team_id: typeof c.context_team_id === 'string' ? c.context_team_id : undefined,
        updated: typeof c.updated === 'number' ? c.updated : undefined,
        num_members: typeof c.num_members === 'number' ? c.num_members : undefined,
      };

      const identity: SlackResourceIdentity = {
        type: 'conversation',
        channelId: String(c.id),
      };

      const provenance: SlackObservationProvenance = {
        binding,
        resourceIdentity: identity,
        observedAt: now,
        acquisitionPolicyReference: policyRef,
        nativeRevision: undefined, // no native revision for channels
        observationalDigest: computeDigest(cleanSummary),
      };

      return {
        ...cleanSummary,
        id: String(c.id),
        provenance,
      };
    });

    const nextCursor = data.response_metadata?.next_cursor || undefined;
    const hasMore = Boolean(nextCursor);

    const containerIdentity: SlackResourceIdentity = {
      type: 'conversation',
    };

    const containerDigest = computeDigest({ channels: channels.map((ch) => ch.id), nextCursor, hasMore });

    return {
      ok: true,
      channels,
      nextCursor,
      hasMore,
      provenance: {
        binding,
        resourceIdentity: containerIdentity,
        observedAt: now,
        acquisitionPolicyReference: policyRef,
        observationalDigest: containerDigest,
      },
    };
  }

  private async conversationsInfo(
    binding: SlackBinding,
    params: Record<string, any>,
    purpose: SlackReadPurpose,
    signal?: AbortSignal
  ): Promise<SlackConversationsInfoResult> {
    const { data, policyRef } = await this.requestSlackGet(
      'conversations.info',
      {
        channel: params.channel,
        include_locale: params.include_locale,
        include_num_members: params.include_num_members,
      },
      binding,
      purpose,
      signal
    );

    const c = data.channel || {};
    const now = new Date().toISOString();

    const cleanDetail: Record<string, unknown> = {
      id: String(c.id),
      name: typeof c.name === 'string' ? c.name : undefined,
      is_channel: typeof c.is_channel === 'boolean' ? c.is_channel : undefined,
      is_group: typeof c.is_group === 'boolean' ? c.is_group : undefined,
      is_im: typeof c.is_im === 'boolean' ? c.is_im : undefined,
      is_mpim: typeof c.is_mpim === 'boolean' ? c.is_mpim : undefined,
      is_private: typeof c.is_private === 'boolean' ? c.is_private : undefined,
      created: typeof c.created === 'number' ? c.created : undefined,
      is_archived: typeof c.is_archived === 'boolean' ? c.is_archived : undefined,
      is_general: typeof c.is_general === 'boolean' ? c.is_general : undefined,
      creator: typeof c.creator === 'string' ? c.creator : undefined,
      name_normalized: typeof c.name_normalized === 'string' ? c.name_normalized : undefined,
      is_shared: typeof c.is_shared === 'boolean' ? c.is_shared : undefined,
      is_org_shared: typeof c.is_org_shared === 'boolean' ? c.is_org_shared : undefined,
      context_team_id: typeof c.context_team_id === 'string' ? c.context_team_id : undefined,
      updated: typeof c.updated === 'number' ? c.updated : undefined,
      num_members: typeof c.num_members === 'number' ? c.num_members : undefined,
      topic:
        c.topic && typeof c.topic === 'object'
          ? {
              value: typeof c.topic.value === 'string' ? c.topic.value : undefined,
              creator: typeof c.topic.creator === 'string' ? c.topic.creator : undefined,
              last_set: typeof c.topic.last_set === 'number' ? c.topic.last_set : undefined,
            }
          : undefined,
      purpose:
        c.purpose && typeof c.purpose === 'object'
          ? {
              value: typeof c.purpose.value === 'string' ? c.purpose.value : undefined,
              creator: typeof c.purpose.creator === 'string' ? c.purpose.creator : undefined,
              last_set: typeof c.purpose.last_set === 'number' ? c.purpose.last_set : undefined,
            }
          : undefined,
    };

    const identity: SlackResourceIdentity = {
      type: 'conversation',
      channelId: String(c.id),
    };

    const provenance: SlackObservationProvenance = {
      binding,
      resourceIdentity: identity,
      observedAt: now,
      acquisitionPolicyReference: policyRef,
      nativeRevision: undefined,
      observationalDigest: computeDigest(cleanDetail),
    };

    const channel: SlackConversationDetail = {
      ...cleanDetail,
      id: String(c.id),
      provenance,
    };

    return {
      ok: true,
      channel,
      provenance,
    };
  }

  private async conversationsHistory(
    binding: SlackBinding,
    params: Record<string, any>,
    purpose: SlackReadPurpose,
    signal?: AbortSignal
  ): Promise<SlackConversationsHistoryResult> {
    const { data, policyRef } = await this.requestSlackGet(
      'conversations.history',
      {
        channel: params.channel,
        cursor: params.cursor,
        limit: params.limit ? Math.min(Number(params.limit), 100) : 20,
        latest: params.latest,
        oldest: params.oldest,
        inclusive: params.inclusive,
      },
      binding,
      purpose,
      signal
    );

    const now = new Date().toISOString();
    const rawMessages = Array.isArray(data.messages) ? data.messages : [];

    const messages: SlackMessageObservation[] = rawMessages.map((m: any) => {
      const ts = String(m.ts);
      const editedTs = m.edited?.ts ? String(m.edited.ts) : undefined;
      const nativeRevision = editedTs || ts;

      const cleanMsg: Record<string, unknown> = {
        type: 'message',
        user: typeof m.user === 'string' ? m.user : undefined,
        text: typeof m.text === 'string' ? m.text : undefined,
        ts,
        thread_ts: m.thread_ts ? String(m.thread_ts) : undefined,
        reply_count: typeof m.reply_count === 'number' ? m.reply_count : undefined,
        reply_users_count: typeof m.reply_users_count === 'number' ? m.reply_users_count : undefined,
        latest_reply: typeof m.latest_reply === 'string' ? m.latest_reply : undefined,
        edited:
          m.edited && typeof m.edited === 'object'
            ? {
                user: typeof m.edited.user === 'string' ? m.edited.user : undefined,
                ts: editedTs!,
              }
            : undefined,
      };

      const identity: SlackResourceIdentity = {
        type: 'message',
        channelId: String(params.channel),
        messageTs: ts,
      };

      const provenance: SlackObservationProvenance = {
        binding,
        resourceIdentity: identity,
        observedAt: now,
        acquisitionPolicyReference: policyRef,
        nativeRevision,
        observationalDigest: computeDigest(cleanMsg),
      };

      return {
        ...cleanMsg,
        type: 'message',
        ts,
        provenance,
      };
    });

    const nextCursor = data.response_metadata?.next_cursor || undefined;
    const hasMore = Boolean(data.has_more ?? nextCursor);

    const containerIdentity: SlackResourceIdentity = {
      type: 'message',
      channelId: String(params.channel),
    };

    const containerDigest = computeDigest({ messages: messages.map((m) => m.ts), nextCursor, hasMore });

    return {
      ok: true,
      messages,
      nextCursor,
      hasMore,
      provenance: {
        binding,
        resourceIdentity: containerIdentity,
        observedAt: now,
        acquisitionPolicyReference: policyRef,
        observationalDigest: containerDigest,
      },
    };
  }

  private async conversationsReplies(
    binding: SlackBinding,
    params: Record<string, any>,
    purpose: SlackReadPurpose,
    signal?: AbortSignal
  ): Promise<SlackConversationsRepliesResult> {
    const { data, policyRef } = await this.requestSlackGet(
      'conversations.replies',
      {
        channel: params.channel,
        ts: params.ts,
        cursor: params.cursor,
        limit: params.limit ? Math.min(Number(params.limit), 100) : 20,
        latest: params.latest,
        oldest: params.oldest,
        inclusive: params.inclusive,
      },
      binding,
      purpose,
      signal
    );

    const now = new Date().toISOString();
    const rawMessages = Array.isArray(data.messages) ? data.messages : [];

    const messages: SlackMessageObservation[] = rawMessages.map((m: any) => {
      const ts = String(m.ts);
      const editedTs = m.edited?.ts ? String(m.edited.ts) : undefined;
      const nativeRevision = editedTs || ts;

      const cleanMsg: Record<string, unknown> = {
        type: 'message',
        user: typeof m.user === 'string' ? m.user : undefined,
        text: typeof m.text === 'string' ? m.text : undefined,
        ts,
        thread_ts: m.thread_ts ? String(m.thread_ts) : undefined,
        reply_count: typeof m.reply_count === 'number' ? m.reply_count : undefined,
        reply_users_count: typeof m.reply_users_count === 'number' ? m.reply_users_count : undefined,
        latest_reply: typeof m.latest_reply === 'string' ? m.latest_reply : undefined,
        edited:
          m.edited && typeof m.edited === 'object'
            ? {
                user: typeof m.edited.user === 'string' ? m.edited.user : undefined,
                ts: editedTs!,
              }
            : undefined,
      };

      const identity: SlackResourceIdentity = {
        type: 'message',
        channelId: String(params.channel),
        messageTs: ts,
      };

      const provenance: SlackObservationProvenance = {
        binding,
        resourceIdentity: identity,
        observedAt: now,
        acquisitionPolicyReference: policyRef,
        nativeRevision,
        observationalDigest: computeDigest(cleanMsg),
      };

      return {
        ...cleanMsg,
        type: 'message',
        ts,
        provenance,
      };
    });

    const nextCursor = data.response_metadata?.next_cursor || undefined;
    const hasMore = Boolean(data.has_more ?? nextCursor);

    const containerIdentity: SlackResourceIdentity = {
      type: 'message',
      channelId: String(params.channel),
      messageTs: String(params.ts),
    };

    const containerDigest = computeDigest({ messages: messages.map((m) => m.ts), nextCursor, hasMore });

    return {
      ok: true,
      messages,
      nextCursor,
      hasMore,
      provenance: {
        binding,
        resourceIdentity: containerIdentity,
        observedAt: now,
        acquisitionPolicyReference: policyRef,
        observationalDigest: containerDigest,
      },
    };
  }

  private async conversationsMembers(
    binding: SlackBinding,
    params: Record<string, any>,
    purpose: SlackReadPurpose,
    signal?: AbortSignal
  ): Promise<SlackConversationsMembersResult> {
    const { data, policyRef } = await this.requestSlackGet(
      'conversations.members',
      {
        channel: params.channel,
        cursor: params.cursor,
        limit: params.limit ? Math.min(Number(params.limit), 100) : 100,
      },
      binding,
      purpose,
      signal
    );

    const now = new Date().toISOString();
    const rawMembers = Array.isArray(data.members) ? data.members : [];
    const members: string[] = rawMembers.map((m: any) => String(m));

    const nextCursor = data.response_metadata?.next_cursor || undefined;
    const hasMore = Boolean(data.has_more ?? nextCursor);

    const identity: SlackResourceIdentity = {
      type: 'members',
      channelId: String(params.channel),
    };

    const digest = computeDigest({ members, nextCursor, hasMore });

    return {
      ok: true,
      members,
      nextCursor,
      hasMore,
      provenance: {
        binding,
        resourceIdentity: identity,
        observedAt: now,
        acquisitionPolicyReference: policyRef,
        observationalDigest: digest,
      },
    };
  }

  private async usersList(
    binding: SlackBinding,
    params: Record<string, any>,
    purpose: SlackReadPurpose,
    signal?: AbortSignal
  ): Promise<SlackUsersListResult> {
    const { data, policyRef } = await this.requestSlackGet(
      'users.list',
      {
        cursor: params.cursor,
        limit: params.limit ? Math.min(Number(params.limit), 100) : 50,
        include_locale: params.include_locale,
      },
      binding,
      purpose,
      signal
    );

    const now = new Date().toISOString();
    const rawMembers = Array.isArray(data.members) ? data.members : [];

    // Strip profile, email, avatar, credentials! Only keep public metadata
    const members: SlackUserSummary[] = rawMembers.map((u: any) => {
      const cleanUser: Record<string, unknown> = {
        id: String(u.id),
        team_id: typeof u.team_id === 'string' ? u.team_id : undefined,
        name: typeof u.name === 'string' ? u.name : undefined,
        deleted: typeof u.deleted === 'boolean' ? u.deleted : undefined,
        real_name: typeof u.real_name === 'string' ? u.real_name : undefined,
        tz: typeof u.tz === 'string' ? u.tz : undefined,
        tz_label: typeof u.tz_label === 'string' ? u.tz_label : undefined,
        tz_offset: typeof u.tz_offset === 'number' ? u.tz_offset : undefined,
        is_bot: typeof u.is_bot === 'boolean' ? u.is_bot : undefined,
        is_admin: typeof u.is_admin === 'boolean' ? u.is_admin : undefined,
        is_owner: typeof u.is_owner === 'boolean' ? u.is_owner : undefined,
        updated: typeof u.updated === 'number' ? u.updated : undefined,
      };

      const identity: SlackResourceIdentity = {
        type: 'user',
        userId: String(u.id),
      };

      const provenance: SlackObservationProvenance = {
        binding,
        resourceIdentity: identity,
        observedAt: now,
        acquisitionPolicyReference: policyRef,
        nativeRevision: undefined,
        observationalDigest: computeDigest(cleanUser),
      };

      return {
        ...cleanUser,
        id: String(u.id),
        provenance,
      };
    });

    const nextCursor = data.response_metadata?.next_cursor || undefined;
    const hasMore = Boolean(data.has_more ?? nextCursor);

    const containerIdentity: SlackResourceIdentity = {
      type: 'users',
    };

    const containerDigest = computeDigest({ members: members.map((m) => m.id), nextCursor, hasMore });

    return {
      ok: true,
      members,
      nextCursor,
      hasMore,
      provenance: {
        binding,
        resourceIdentity: containerIdentity,
        observedAt: now,
        acquisitionPolicyReference: policyRef,
        observationalDigest: containerDigest,
      },
    };
  }

  private async usersInfo(
    binding: SlackBinding,
    params: Record<string, any>,
    purpose: SlackReadPurpose,
    signal?: AbortSignal
  ): Promise<SlackUsersInfoResult> {
    const { data, policyRef } = await this.requestSlackGet(
      'users.info',
      {
        user: params.user,
        include_locale: params.include_locale,
      },
      binding,
      purpose,
      signal
    );

    const u = data.user || {};
    const now = new Date().toISOString();

    // Whitelist clean fields, strip profile/credentials
    const cleanUser: Record<string, unknown> = {
      id: String(u.id),
      team_id: typeof u.team_id === 'string' ? u.team_id : undefined,
      name: typeof u.name === 'string' ? u.name : undefined,
      deleted: typeof u.deleted === 'boolean' ? u.deleted : undefined,
      real_name: typeof u.real_name === 'string' ? u.real_name : undefined,
      tz: typeof u.tz === 'string' ? u.tz : undefined,
      tz_label: typeof u.tz_label === 'string' ? u.tz_label : undefined,
      tz_offset: typeof u.tz_offset === 'number' ? u.tz_offset : undefined,
      is_bot: typeof u.is_bot === 'boolean' ? u.is_bot : undefined,
      is_admin: typeof u.is_admin === 'boolean' ? u.is_admin : undefined,
      is_owner: typeof u.is_owner === 'boolean' ? u.is_owner : undefined,
      updated: typeof u.updated === 'number' ? u.updated : undefined,
    };

    const identity: SlackResourceIdentity = {
      type: 'user',
      userId: String(u.id),
    };

    const provenance: SlackObservationProvenance = {
      binding,
      resourceIdentity: identity,
      observedAt: now,
      acquisitionPolicyReference: policyRef,
      nativeRevision: undefined,
      observationalDigest: computeDigest(cleanUser),
    };

    const user: SlackUserDetail = {
      ...cleanUser,
      id: String(u.id),
      provenance,
    };

    return {
      ok: true,
      user,
      provenance,
    };
  }

  private async chatGetPermalink(
    binding: SlackBinding,
    params: Record<string, any>,
    purpose: SlackReadPurpose,
    signal?: AbortSignal
  ): Promise<SlackPermalinkObservation> {
    const { data, policyRef } = await this.requestSlackGet(
      'chat.getPermalink',
      {
        channel: params.channel,
        message_ts: params.message_ts,
      },
      binding,
      purpose,
      signal
    );

    const permalink = String(data.permalink || '');
    if (!SAFE_PERMALINK_REGEX.test(permalink)) {
      throw new StepError({
        message: `Slack API returned invalid or unsafe permalink format: "${permalink}"`,
        category: 'SERVER_ERROR',
        statusCode: 502,
      });
    }

    const now = new Date().toISOString();
    const cleanOutput = {
      ok: true as const,
      channel: String(data.channel || params.channel),
      permalink,
    };

    const identity: SlackResourceIdentity = {
      type: 'permalink',
      channelId: cleanOutput.channel,
      messageTs: String(params.message_ts),
    };

    const provenance: SlackObservationProvenance = {
      binding,
      resourceIdentity: identity,
      observedAt: now,
      acquisitionPolicyReference: policyRef,
      nativeRevision: undefined,
      observationalDigest: computeDigest(cleanOutput),
    };

    return {
      ...cleanOutput,
      provenance,
    };
  }
}
