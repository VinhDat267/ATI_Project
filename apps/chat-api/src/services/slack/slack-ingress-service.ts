import { createHash } from 'node:crypto';
import type {
  SlackEventReceiptRepo,
  SlackEventReceiptRow,
  SlackLifecycleDescriptor,
  SlackLifecycleIntentPayload,
  SlackLifecycleIntentRow,
} from '../../db/repositories/slack-event-receipt-repo.js';
import {
  SlackEventIdConflictError,
  SlackOwnerLockBusyError,
  SlackStaleBindingError,
  SlackStagingTimeoutError,
} from '../../db/repositories/slack-event-receipt-repo.js';
import { compareSlackRevisions } from './slack-invalidation-service.js';
import { verifySlackSignature } from './slack-signature.js';

export interface SlackIngressRuntimeConfig {
  signingSecret: string;
  appId: string;
  automationEnabled: boolean;
}

/** Bounded, non-authoritative wakeup. Its failure can never change the committed ACK. */
export interface SlackQueueIntentHook {
  onEventReceived(receipt: SlackEventReceiptRow): Promise<void> | void;
}

/** Bounded, non-authoritative wakeup for 03B/04B probe and purge consumers. */
export interface SlackLifecyclePurgeHook {
  onLifecycleStaged(intent: { id: string; teamId: string; payload: SlackLifecycleIntentPayload }): Promise<void> | void;
}

export interface SlackIngressRequest {
  signatureHeader?: string | undefined;
  timestampHeader?: string | undefined;
  rawBody: Buffer;
  nowMs?: number;
}

export interface SlackIngressResponse {
  status: 200 | 400 | 401 | 409 | 503;
  body: Record<string, unknown>;
}

export interface SlackIngressServiceOptions {
  /** Undefined means the Slack app is not configured: every request fails closed. */
  config: SlackIngressRuntimeConfig | undefined;
  repo: SlackEventReceiptRepo;
  queueHook?: SlackQueueIntentHook;
  lifecycleHook?: SlackLifecyclePurgeHook;
  clock?: () => number;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SAFE_EVENT_ID = /^[A-Za-z0-9_-]{1,128}$/;
/** Slack documents event_context as an opaque string; this is only an explicit transport bound. */
const MAX_EVENT_CONTEXT_LENGTH = 1024;
const SLACK_TS = /^(\d{1,10})(?:\.(\d{1,6}))?$/;
const MAX_CHALLENGE_LENGTH = 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeId(value: unknown): string | null {
  return typeof value === 'string' && SAFE_ID.test(value) ? value : null;
}

function strictTimestamp(value: unknown): string | null {
  return typeof value === 'string' && SLACK_TS.test(value) ? value : null;
}

type EventContextResolution = { kind: 'ok'; value: string | null } | { kind: 'malformed' };

/**
 * event_context is opaque per Slack's Events API and apps.event.authorizations.list docs; no
 * charset or ID shape may be assumed. Only an explicit transport bound is applied, and the exact
 * value is preserved (absent stays absent) for 04B. It is never parsed or synthesized.
 */
function resolveEventContext(envelope: Record<string, unknown>): EventContextResolution {
  const raw = envelope.event_context;
  if (raw === undefined || raw === null) return { kind: 'ok', value: null };
  if (typeof raw !== 'string' || raw.length > MAX_EVENT_CONTEXT_LENGTH) return { kind: 'malformed' };
  return { kind: 'ok', value: raw };
}

/** Exact decimal epoch -> canonical UTC ISO with the original six-digit microsecond fraction. */
function canonicalIso(ts: string): string {
  const match = SLACK_TS.exec(ts)!;
  const seconds = Number(match[1]);
  const micros = (match[2] ?? '').padEnd(6, '0');
  const date = new Date(seconds * 1000);
  return `${date.toISOString().slice(0, 19)}.${micros}Z`;
}

type TimestampResolution =
  | { kind: 'ok'; ts: string; iso: string }
  | { kind: 'malformed' }
  | { kind: 'missing' };

/**
 * Resolves the immutable Slack event time. A present-but-malformed event_ts is never rescued by
 * event_time: junk is rejected rather than silently scrubbed. event_time is an immutable Slack
 * epoch too, so it is a legitimate source only when event_ts is absent. Date.now() is never used.
 */
function resolveSourceTimestamp(
  event: Record<string, unknown>,
  envelope: Record<string, unknown>
): TimestampResolution {
  const raw = event.event_ts;
  if (raw !== undefined && raw !== null) {
    const ts = strictTimestamp(raw);
    return ts ? { kind: 'ok', ts, iso: canonicalIso(ts) } : { kind: 'malformed' };
  }
  const eventTime = envelope.event_time;
  if (eventTime !== undefined && eventTime !== null) {
    if (!Number.isSafeInteger(eventTime) || (eventTime as number) < 0 || (eventTime as number) > 9_999_999_999) {
      return { kind: 'malformed' };
    }
    const ts = String(eventTime);
    return { kind: 'ok', ts, iso: canonicalIso(ts) };
  }
  return { kind: 'missing' };
}

type LifecycleClassification =
  | { kind: 'ordinary' }
  | { kind: 'lifecycle'; descriptor: SlackLifecycleDescriptor }
  | { kind: 'malformed' };

/**
 * Lifecycle events are fail-closed: malformed fields produce a 400 and never fall through to
 * automation message processing. Any other event is ordinary content routing metadata.
 */
function classifyLifecycle(event: Record<string, unknown>, eventType: string): LifecycleClassification {
  if (eventType === 'tokens_revoked') {
    const tokens = event.tokens;
    if (!isRecord(tokens) || !Array.isArray(tokens.oauth)) return { kind: 'malformed' };
    const slackUserIds: string[] = [];
    const seen = new Set<string>();
    for (const entry of tokens.oauth) {
      const id = safeId(entry);
      if (!id) return { kind: 'malformed' };
      if (!seen.has(id)) {
        seen.add(id);
        slackUserIds.push(id);
      }
    }
    return { kind: 'lifecycle', descriptor: { intentType: 'token_revocation_validation', slackUserIds } };
  }

  if (eventType === 'app_uninstalled') {
    return { kind: 'lifecycle', descriptor: { intentType: 'app_uninstall_validation' } };
  }

  if (eventType === 'message' && event.subtype === 'message_deleted') {
    const channelId = safeId(event.channel);
    const deletedTs = strictTimestamp(event.deleted_ts);
    if (!channelId || !deletedTs) return { kind: 'malformed' };
    return { kind: 'lifecycle', descriptor: { intentType: 'message_deleted', channelId, deletedTs } };
  }

  if (eventType === 'message' && event.subtype === 'message_changed') {
    const channelId = safeId(event.channel);
    const message = event.message;
    if (!channelId || !isRecord(message)) return { kind: 'malformed' };
    const messageTs = strictTimestamp(message.ts);
    const edited = message.edited;
    if (!messageTs || !isRecord(edited)) return { kind: 'malformed' };
    const editTs = strictTimestamp(edited.ts);
    if (!editTs) return { kind: 'malformed' };
    if (compareSlackRevisions(editTs, messageTs) < 0) return { kind: 'malformed' };
    return {
      kind: 'lifecycle',
      descriptor: { intentType: 'message_changed', channelId, messageTs, editTs },
    };
  }

  return { kind: 'ordinary' };
}

function badRequest(code: string, error: string): SlackIngressResponse {
  return { status: 400, body: { code, error } };
}

export class SlackIngressService {
  private readonly config: SlackIngressRuntimeConfig | undefined;
  private readonly repo: SlackEventReceiptRepo;
  private readonly queueHook: SlackQueueIntentHook | undefined;
  private readonly lifecycleHook: SlackLifecyclePurgeHook | undefined;
  private readonly clock: () => number;

  constructor(options: SlackIngressServiceOptions) {
    if (!options || typeof options !== 'object') throw new TypeError('Slack ingress options are required');
    if (!options.repo) throw new TypeError('Slack ingress repo is required');
    if (options.config) {
      if (typeof options.config.signingSecret !== 'string' || !options.config.signingSecret) {
        throw new TypeError('Slack ingress signing secret is required');
      }
      if (typeof options.config.appId !== 'string' || !SAFE_ID.test(options.config.appId)) {
        throw new TypeError('Slack ingress app id is invalid');
      }
    }
    this.config = options.config;
    this.repo = options.repo;
    this.queueHook = options.queueHook;
    this.lifecycleHook = options.lifecycleHook;
    this.clock = options.clock ?? (() => Date.now());
  }

  async handleRequest(input: SlackIngressRequest): Promise<SlackIngressResponse> {
    if (!this.config) {
      return {
        status: 503,
        body: { code: 'CONFIG_MISSING', error: 'Slack signed ingress is not configured' },
      };
    }

    const verification = verifySlackSignature({
      signatureHeader: input.signatureHeader,
      timestampHeader: input.timestampHeader,
      rawBody: input.rawBody,
      signingSecret: this.config.signingSecret,
      nowMs: input.nowMs ?? this.clock(),
    });
    if (!verification.ok) {
      return { status: verification.status, body: { code: verification.code, error: verification.error } };
    }

    let envelope: unknown;
    try {
      envelope = JSON.parse(input.rawBody.toString('utf8'));
    } catch {
      return badRequest('INVALID_JSON', 'Request body is not valid JSON');
    }
    if (!isRecord(envelope)) return badRequest('MALFORMED_EVENT', 'Event envelope must be an object');

    if (envelope.type === 'url_verification') return this.handleChallenge(envelope);
    if (envelope.type !== 'event_callback') {
      return badRequest('UNSUPPORTED_EVENT_TYPE', 'Unsupported Slack event type');
    }
    return this.handleCallback(envelope, input.rawBody);
  }

  private handleChallenge(envelope: Record<string, unknown>): SlackIngressResponse {
    const claimedAppId = envelope.api_app_id;
    if (claimedAppId !== undefined && claimedAppId !== null && claimedAppId !== this.config!.appId) {
      return badRequest('APP_ID_MISMATCH', 'Slack app id does not match this endpoint');
    }
    const challenge = envelope.challenge;
    if (typeof challenge !== 'string' || challenge.length === 0 || challenge.length > MAX_CHALLENGE_LENGTH) {
      return badRequest('MALFORMED_CHALLENGE', 'Challenge value is missing or out of bounds');
    }
    // Slack requires the challenge verbatim. It is never stored or logged.
    return { status: 200, body: { challenge } };
  }

  private async handleCallback(
    envelope: Record<string, unknown>,
    rawBody: Buffer
  ): Promise<SlackIngressResponse> {
    if (envelope.api_app_id !== this.config!.appId) {
      return badRequest('APP_ID_MISMATCH', 'Slack app id does not match this endpoint');
    }
    const teamId = safeId(envelope.team_id);
    if (!teamId) return badRequest('MISSING_TEAM_ID', 'Event callback requires its own team id');

    const eventId =
      typeof envelope.event_id === 'string' && SAFE_EVENT_ID.test(envelope.event_id) ? envelope.event_id : null;
    if (!eventId) return badRequest('MALFORMED_EVENT', 'Event callback requires a bounded event id');

    const event = envelope.event;
    if (!isRecord(event)) return badRequest('MALFORMED_EVENT', 'Event callback requires an event object');
    const eventType = safeId(event.type);
    if (!eventType) return badRequest('MALFORMED_EVENT', 'Event callback requires a bounded event type');

    const eventSubtype = safeId(event.subtype);
    const contextResolution = resolveEventContext(envelope);
    if (contextResolution.kind === 'malformed') {
      return badRequest('MALFORMED_EVENT', 'Event context exceeds the transport bound');
    }
    const eventContext = contextResolution.value;
    const payloadHash = createHash('sha256').update(rawBody).digest('hex');

    const classification = classifyLifecycle(event, eventType);
    if (classification.kind === 'malformed') {
      return badRequest('MALFORMED_EVENT', 'Lifecycle event fields are malformed');
    }

    if (classification.kind === 'lifecycle') {
      const timestamp = resolveSourceTimestamp(event, envelope);
      if (timestamp.kind !== 'ok') {
        // A lifecycle barrier without its immutable event time would let a pre-consent backfill
        // pass the 04B watermark fence. Refuse and let Slack retry instead of ACKing a no-op.
        return badRequest('INVALID_TIMESTAMP', 'Lifecycle event requires an immutable Slack timestamp');
      }
      return this.recordLifecycle({
        appId: this.config!.appId,
        eventId,
        teamId,
        eventType,
        eventSubtype,
        eventContext,
        sourceEventTs: timestamp.ts,
        sourceEventTimeIso: timestamp.iso,
        channelId: this.receiptChannelId(event, eventType),
        messageTs: this.receiptMessageTs(event, eventType, eventSubtype),
        payloadHash,
        lifecycle: classification.descriptor,
      });
    }

    // Ordinary content events are only stored when automation is enabled; otherwise the body is
    // dropped in memory with an ACK. Lifecycle events above ignore this flag by design.
    if (!this.config!.automationEnabled) {
      return { status: 200, body: { ok: true } };
    }

    const timestamp = resolveSourceTimestamp(event, envelope);
    return this.recordOrdinary({
      appId: this.config!.appId,
      eventId,
      teamId,
      eventType,
      eventSubtype,
      eventContext,
      sourceEventTs: timestamp.kind === 'ok' ? timestamp.ts : null,
      sourceEventTimeIso: timestamp.kind === 'ok' ? timestamp.iso : null,
      channelId: this.receiptChannelId(event, eventType),
      messageTs: this.receiptMessageTs(event, eventType, eventSubtype),
      payloadHash,
      discardReason: timestamp.kind === 'ok' ? null : 'malformed_timestamp',
      ...(eventType==='message' && !eventSubtype && safeId(event.user)?{echo:{slackUserId:safeId(event.user)!,
        clientMsgId:typeof event.client_msg_id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(event.client_msg_id)?event.client_msg_id:null}}:{}),
    });
  }

  private receiptChannelId(event: Record<string, unknown>, eventType: string): string | null {
    if (eventType !== 'message') return null;
    // Lifecycle message subtypes were already validated; ordinary ones degrade to null metadata.
    return safeId(event.channel);
  }

  private receiptMessageTs(
    event: Record<string, unknown>,
    eventType: string,
    eventSubtype: string | null
  ): string | null {
    if (eventType !== 'message') return null;
    if (eventSubtype === 'message_deleted') return strictTimestamp(event.deleted_ts);
    if (eventSubtype === 'message_changed') {
      return isRecord(event.message) ? strictTimestamp(event.message.ts) : null;
    }
    return strictTimestamp(event.ts);
  }

  private async recordOrdinary(
    input: Parameters<SlackEventReceiptRepo['recordOrdinary']>[0]
  ): Promise<SlackIngressResponse> {
    try {
      const result = await this.repo.recordOrdinary(input);
      if (result.kind === 'recorded') this.wakeQueue(result.receipt);
      return { status: 200, body: { ok: true } };
    } catch (err) {
      return this.mapPersistenceError(err);
    }
  }

  private async recordLifecycle(
    input: Parameters<SlackEventReceiptRepo['recordLifecycle']>[0]
  ): Promise<SlackIngressResponse> {
    try {
      const result = await this.repo.recordLifecycle(input);
      if (result.kind === 'recorded') this.wakeLifecycle(result.intents);
      return { status: 200, body: { ok: true } };
    } catch (err) {
      return this.mapPersistenceError(err);
    }
  }

  private mapPersistenceError(err: unknown): SlackIngressResponse {
    if (err instanceof SlackOwnerLockBusyError) {
      return { status: 503, body: { code: 'OWNER_LOCK_BUSY', error: 'Slack connection is busy; retry later' } };
    }
    if (err instanceof SlackStagingTimeoutError) {
      return { status: 503, body: { code: 'STAGING_TIMEOUT', error: 'Slack event staging timed out; retry later' } };
    }
    if (err instanceof SlackEventIdConflictError) {
      return { status: 409, body: { code: 'EVENT_ID_CONFLICT', error: 'Event id was replayed with a different payload' } };
    }
    if (err instanceof SlackStaleBindingError) {
      return { status: 503, body: { code: 'STALE_BINDING', error: 'Slack connection changed concurrently; retry later' } };
    }
    if (err instanceof TypeError) {
      return badRequest('MALFORMED_EVENT', 'Event fields are malformed');
    }
    return { status: 503, body: { code: 'DATABASE_UNAVAILABLE', error: 'Slack event could not be committed' } };
  }

  /**
   * Fire-and-forget wakeups are scheduled after COMMIT and never awaited. A hung or failing hook
   * cannot delay or change the durable 200, nor surface as an unhandled rejection.
   */
  private wakeQueue(receipt: SlackEventReceiptRow): void {
    const hook = this.queueHook;
    if (!hook) return;
    void Promise.resolve()
      .then(() => hook.onEventReceived(receipt))
      .catch(() => {});
  }

  private wakeLifecycle(intents: SlackLifecycleIntentRow[]): void {
    const hook = this.lifecycleHook;
    if (!hook) return;
    for (const intent of intents) {
      void Promise.resolve()
        .then(() => hook.onLifecycleStaged({ id: intent.id, teamId: intent.team_id, payload: intent.payload }))
        .catch(() => {});
    }
  }
}
