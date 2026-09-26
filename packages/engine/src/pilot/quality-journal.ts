import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export interface PilotQualityReservationInput {
  readonly variantId: string;
  readonly mode: 'fixed-catalog';
  readonly dataset: 'public' | 'holdout';
  readonly provider: string;
  readonly model: string;
}

export interface PilotQualityOutcomeInput {
  readonly attemptId: string;
  readonly status: 'succeeded' | 'failed';
  readonly observation?: unknown;
  readonly error?: string;
  readonly failure?: PilotQualityFailureDiagnostics;
  readonly durationMs: number;
}

/** Safe failure metadata only. No provider prose, URL, headers, or credentials. */
export interface PilotQualityFailureDiagnostics {
  readonly localCode: string;
  readonly httpStatus: number | null;
  readonly providerCode: number | string | null;
  readonly providerStatus: string | null;
  readonly retryAfterMs: number | null;
  readonly failureStage?: string;
}

export interface PilotQualityMeasuredGate {
  readonly kind: 'durable';
  readonly campaignId: string;
  readonly freezeHash: string;
  authorizeAndReserve(input: PilotQualityReservationInput): Promise<{ attemptId: string }>;
  recordOutcome(input: PilotQualityOutcomeInput): Promise<void>;
}

export interface PilotQualityJournalOptions {
  readonly directory: string;
  readonly campaignId: string;
  readonly freezeHash: string;
  readonly provider: string;
  readonly model: string;
  readonly maxCalls: number;
  /** Only a campaign attested as unbilled Free Tier may use the zero USD gate. */
  readonly freeTierAttested: true;
  readonly maxCostUsd: 0;
}

export interface PilotQualityAttemptState extends PilotQualityReservationInput {
  readonly attemptId: string;
  readonly status: 'reserved' | 'succeeded' | 'failed';
  readonly usageState: 'unknown' | 'reported';
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly durationMs?: number;
  readonly observationSha256?: string;
  /** Decoded model-port observation after credential-pattern redaction; never raw HTTP wire. */
  readonly observation?: unknown;
  readonly redactionApplied?: boolean;
  readonly unsafeToGrade?: boolean;
  readonly errorSha256?: string;
  readonly failure?: PilotQualityFailureDiagnostics;
}

export interface PilotQualityJournalState {
  readonly campaignId: string;
  readonly freezeHash: string;
  readonly provider: string;
  readonly model: string;
  readonly maxCalls: number;
  readonly usedCalls: number;
  readonly attempts: readonly PilotQualityAttemptState[];
}

export interface PilotQualityJournal extends PilotQualityMeasuredGate {
  readState(): PilotQualityJournalState;
  close(): Promise<void>;
}

type MetaEvent = { type: 'campaign'; campaignId: string; freezeHash: string; provider: string; model: string; maxCalls: number; maxCostUsd: 0; freeTierAttested: true };
type ReservedEvent = { type: 'reserved'; attemptId: string; input: PilotQualityReservationInput };
type OutcomeEvent = { type: 'outcome'; attemptId: string; status: 'succeeded' | 'failed'; durationMs: number; usageState: 'unknown' | 'reported'; inputTokens?: number; outputTokens?: number; observationSha256?: string; observation?: unknown; redactionApplied?: boolean; unsafeToGrade?: boolean; errorSha256?: string; failure?: PilotQualityFailureDiagnostics };
type JournalEvent = MetaEvent | ReservedEvent | OutcomeEvent;
type Envelope = { sequence: number; previousHash: string; event: JournalEvent; hash: string };

const SHA256 = /^[a-f0-9]{64}$/;
const ZERO_HASH = '0'.repeat(64);
const SAFE_LOCAL_CODES = new Set([
  'PROVIDER_HTTP_ERROR', 'PROVIDER_RESPONSE_INVALID', 'PROVIDER_MODEL_MISMATCH',
  'PROVIDER_SAFETY_BLOCK', 'PROVIDER_TIMEOUT', 'PROVIDER_NETWORK_ERROR',
  'PROVIDER_VECTOR_INVALID', 'PROVIDER_CONFIG_MISSING_SECRET', 'PRICE_BOUND_UNPROVEN',
  'AI_LIVE_NOT_READY', 'AI_CALL_UNAUTHORIZED', 'AI_PROVIDER_CALLS_DISABLED',
]);
const SAFE_PROVIDER_CODES = new Set([
  'service_unavailable', 'rate_limit_exceeded', 'too_many_requests', 'resource_exhausted',
  'quota_exceeded', 'invalid_request', 'permission_denied', 'unauthorized',
  'model_not_found', 'internal_error',
]);
const SAFE_PROVIDER_STATUSES = new Set([
  'UNAVAILABLE', 'RESOURCE_EXHAUSTED', 'INTERNAL', 'DEADLINE_EXCEEDED',
  'PERMISSION_DENIED', 'UNAUTHENTICATED', 'INVALID_ARGUMENT', 'FAILED_PRECONDITION',
  'NOT_FOUND', 'UNKNOWN', 'ABORTED', 'CANCELLED', 'OUT_OF_RANGE',
  'ALREADY_EXISTS', 'DATA_LOSS', 'UNIMPLEMENTED',
]);
const SAFE_FAILURE_STAGES = new Set([
  'http_body_too_large', 'http_content_type', 'http_json_envelope',
  'interaction_incomplete', 'output_missing', 'output_json', 'output_wire',
  'output_wire_branch', 'output_wire_plan_shape', 'output_wire_value', 'output_wire_dsl',
]);

function validFailure(value: unknown): value is PilotQualityFailureDiagnostics {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((field) => !['localCode', 'httpStatus', 'providerCode', 'providerStatus', 'retryAfterMs', 'failureStage'].includes(field)) ||
      typeof record.localCode !== 'string' || !SAFE_LOCAL_CODES.has(record.localCode)) return false;
  if (record.failureStage !== undefined &&
      (record.localCode !== 'PROVIDER_RESPONSE_INVALID' || typeof record.failureStage !== 'string' ||
       !SAFE_FAILURE_STAGES.has(record.failureStage))) return false;
  const status = record.httpStatus;
  const code = record.providerCode;
  const providerStatus = record.providerStatus;
  const retry = record.retryAfterMs;
  return (status === null || (Number.isInteger(status) && Number(status) >= 100 && Number(status) <= 599)) &&
    (code === null || (typeof code === 'number' && Number.isInteger(code) && code >= 100 && code <= 599) ||
      (typeof code === 'string' && SAFE_PROVIDER_CODES.has(code))) &&
    (providerStatus === null || (typeof providerStatus === 'string' && SAFE_PROVIDER_STATUSES.has(providerStatus))) &&
    (retry === null || (Number.isSafeInteger(retry) && Number(retry) >= 0 && Number(retry) <= 3_600_000));
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertLabel(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200 || value.trim() !== value) {
    throw new Error(`QUALITY_JOURNAL_INVALID_${name}`);
  }
}

function assertOptions(options: PilotQualityJournalOptions): void {
  assertLabel(options.campaignId, 'CAMPAIGN');
  assertLabel(options.provider, 'PROVIDER');
  assertLabel(options.model, 'MODEL');
  if (!SHA256.test(options.freezeHash)) throw new Error('QUALITY_JOURNAL_INVALID_FREEZE_HASH');
  if (!Number.isSafeInteger(options.maxCalls) || options.maxCalls < 1) throw new Error('QUALITY_JOURNAL_INVALID_CALL_CAP');
  if (options.maxCostUsd !== 0 || options.freeTierAttested !== true) {
    throw new Error('QUALITY_JOURNAL_ZERO_COST_GATE_REQUIRED');
  }
  assertLabel(options.directory, 'DIRECTORY');
}

function key(input: PilotQualityReservationInput): string {
  return JSON.stringify([input.variantId, input.mode, input.dataset]);
}

const SECRET_VALUE = /AIza[0-9A-Za-z_-]{20,}|\bsk-[0-9A-Za-z_-]{16,}|\bBearer\s+[0-9A-Za-z._~+/-]{8,}|\b(?:api[_-]?key|key|token|secret|password)\s*[:=]\s*[^\s,;"']+/gi;
const SECRET_FIELD = /^(?:x-goog-api-key|api[_-]?key|key|token|secret|password|authorization|private[_-]?key)$/i;

function redactObservation(value: unknown): { value: unknown; applied: boolean } {
  let applied = false;
  const walk = (entry: unknown): unknown => {
    if (typeof entry === 'string') {
      const redacted = entry.replace(SECRET_VALUE, '[REDACTED]');
      if (redacted !== entry) applied = true;
      return redacted;
    }
    if (Array.isArray(entry)) return entry.map(walk);
    if (entry !== null && typeof entry === 'object') {
      return Object.fromEntries(Object.entries(entry as Record<string, unknown>).map(([field, nested]) => {
        if (SECRET_FIELD.test(field)) { applied = true; return [field, '[REDACTED]']; }
        return [field, walk(nested)];
      }));
    }
    return entry;
  };
  return { value: walk(value), applied };
}

function parseJournal(bytes: string, expected: MetaEvent): { events: Envelope[]; attempts: PilotQualityAttemptState[] } {
  if (!bytes.endsWith('\n')) throw new Error('QUALITY_JOURNAL_PARTIAL_RECORD');
  const lines = bytes.slice(0, -1).split('\n');
  const events: Envelope[] = [];
  const attempts = new Map<string, PilotQualityAttemptState>();
  const keys = new Set<string>();
  let prior = ZERO_HASH;
  for (const line of lines) {
    let row: Envelope;
    try { row = JSON.parse(line) as Envelope; } catch { throw new Error('QUALITY_JOURNAL_CORRUPT'); }
    if (!row || row.sequence !== events.length || row.previousHash !== prior || !SHA256.test(row.hash) ||
        row.hash !== sha256(JSON.stringify([row.sequence, row.previousHash, row.event]))) {
      throw new Error('QUALITY_JOURNAL_CORRUPT');
    }
    const event = row.event;
    if (events.length === 0) {
      if (event?.type !== 'campaign' || JSON.stringify(event) !== JSON.stringify(expected)) {
        throw new Error('QUALITY_JOURNAL_CAMPAIGN_MISMATCH');
      }
    } else if (event?.type === 'reserved') {
      const input = event.input;
      if (typeof event.attemptId !== 'string' || !input || typeof input.variantId !== 'string' ||
          input.mode !== 'fixed-catalog' || !['public', 'holdout'].includes(input.dataset) ||
          input.provider !== expected.provider || input.model !== expected.model ||
          attempts.has(event.attemptId) || keys.has(key(input))) throw new Error('QUALITY_JOURNAL_CORRUPT');
      keys.add(key(input));
      attempts.set(event.attemptId, { ...input, attemptId: event.attemptId, status: 'reserved', usageState: 'unknown' });
    } else if (event?.type === 'outcome') {
      const priorAttempt = attempts.get(event.attemptId);
      if (!priorAttempt || priorAttempt.status !== 'reserved' || !['succeeded', 'failed'].includes(event.status) ||
          !Number.isFinite(event.durationMs) || event.durationMs < 0 ||
          !['unknown', 'reported'].includes(event.usageState) ||
          (event.failure !== undefined && (event.status !== 'failed' || !validFailure(event.failure)))) throw new Error('QUALITY_JOURNAL_CORRUPT');
      attempts.set(event.attemptId, { ...priorAttempt, status: event.status, usageState: event.usageState,
        inputTokens: event.inputTokens, outputTokens: event.outputTokens, durationMs: event.durationMs,
        observationSha256: event.observationSha256, observation: event.observation,
        redactionApplied: event.redactionApplied, unsafeToGrade: event.unsafeToGrade,
        errorSha256: event.errorSha256, failure: event.failure });
    } else if (events.length > 0) {
      throw new Error('QUALITY_JOURNAL_CORRUPT');
    }
    events.push(row);
    prior = row.hash;
  }
  if (events.length < 1 || attempts.size > expected.maxCalls) throw new Error('QUALITY_JOURNAL_CORRUPT');
  return { events, attempts: [...attempts.values()] };
}

function envelope(sequence: number, previousHash: string, event: JournalEvent): Envelope {
  return { sequence, previousHash, event, hash: sha256(JSON.stringify([sequence, previousHash, event])) };
}

function usageFrom(observation: unknown): { usageState: 'unknown' | 'reported'; inputTokens?: number; outputTokens?: number } {
  if (!observation || typeof observation !== 'object') return { usageState: 'unknown' };
  const usage = (observation as Record<string, unknown>).usage;
  if (!usage || typeof usage !== 'object') return { usageState: 'unknown' };
  const inputTokens = (usage as Record<string, unknown>).inputTokens;
  const outputTokens = (usage as Record<string, unknown>).outputTokens;
  if (!Number.isSafeInteger(inputTokens) || !Number.isSafeInteger(outputTokens) ||
      (inputTokens as number) < 0 || (outputTokens as number) < 0) return { usageState: 'unknown' };
  return { usageState: 'reported', inputTokens: inputTokens as number, outputTokens: outputTokens as number };
}

/** Exclusive lock is deliberately not auto-reclaimed after a crash: an operator must inspect the journal first. */
export async function openPilotQualityJournal(options: PilotQualityJournalOptions): Promise<PilotQualityJournal> {
  assertOptions(options);
  const directory = resolve(options.directory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const basename = `pilot-quality-${sha256(options.campaignId)}`;
  const path = join(directory, `${basename}.jsonl`);
  const lockPath = join(directory, `${basename}.lock`);
  const lockToken = randomUUID();
  const lock = await open(lockPath, 'wx', 0o600).catch(() => { throw new Error('QUALITY_JOURNAL_LOCKED'); });
  let file: FileHandle | undefined;
  try {
    await lock.writeFile(lockToken);
    await lock.sync();
    const meta: MetaEvent = { type: 'campaign', campaignId: options.campaignId, freezeHash: options.freezeHash,
      provider: options.provider, model: options.model, maxCalls: options.maxCalls, maxCostUsd: 0, freeTierAttested: true };
    let existing: string | null;
    try { existing = await readFile(path, 'utf8'); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      existing = null;
    }
    if (existing === null) {
      file = await open(path, 'wx', 0o600);
      const first = envelope(0, ZERO_HASH, meta);
      await file.writeFile(`${JSON.stringify(first)}\n`);
      await file.sync();
      existing = `${JSON.stringify(first)}\n`;
    } else {
      file = await open(path, 'a');
    }
    let { events, attempts } = parseJournal(existing, meta);
    let closed = false;
    let poisoned = false;
    let queue = Promise.resolve();
    const assertOpen = () => {
      if (closed || poisoned) throw new Error('QUALITY_JOURNAL_UNAVAILABLE');
    };
    const append = async (event: JournalEvent): Promise<void> => {
      assertOpen();
      const next = envelope(events.length, events.at(-1)!.hash, event);
      try {
        await file!.writeFile(`${JSON.stringify(next)}\n`);
        await file!.sync();
      } catch {
        poisoned = true;
        throw new Error('QUALITY_JOURNAL_WRITE_FAILED');
      }
      events.push(next);
    };
    const serialized = <T>(task: () => Promise<T>): Promise<T> => {
      const result = queue.then(task);
      queue = result.then(() => undefined, () => undefined);
      return result;
    };
    return {
      kind: 'durable', campaignId: options.campaignId, freezeHash: options.freezeHash,
      authorizeAndReserve(input) {
        return serialized(async () => {
          assertOpen();
          assertLabel(input.variantId, 'VARIANT');
          if (input.mode !== 'fixed-catalog' || !['public', 'holdout'].includes(input.dataset) ||
              input.provider !== options.provider || input.model !== options.model) {
            throw new Error('QUALITY_JOURNAL_INPUT_MISMATCH');
          }
          if (attempts.some((attempt) => key(attempt) === key(input))) throw new Error('QUALITY_JOURNAL_DUPLICATE');
          if (attempts.length >= options.maxCalls) throw new Error('QUALITY_JOURNAL_CALL_CAP');
          const attemptId = randomUUID();
          await append({ type: 'reserved', attemptId, input });
          attempts = [...attempts, { ...input, attemptId, status: 'reserved', usageState: 'unknown' }];
          return { attemptId };
        });
      },
      recordOutcome(input) {
        return serialized(async () => {
          assertOpen();
          const priorAttempt = attempts.find((attempt) => attempt.attemptId === input.attemptId);
          if (!priorAttempt || priorAttempt.status !== 'reserved') throw new Error('QUALITY_JOURNAL_ATTEMPT_NOT_RESERVED');
          if (!['succeeded', 'failed'].includes(input.status) || !Number.isFinite(input.durationMs) || input.durationMs < 0) {
            throw new Error('QUALITY_JOURNAL_INVALID_OUTCOME');
          }
          if (input.failure !== undefined && (input.status !== 'failed' || !validFailure(input.failure))) {
            throw new Error('QUALITY_JOURNAL_INVALID_FAILURE_DIAGNOSTICS');
          }
          let observationSha256: string | undefined;
          let observation: unknown;
          let redactionApplied = false;
          if (input.observation !== undefined) {
            let serializedObservation: string | undefined;
            try { serializedObservation = JSON.stringify(input.observation); } catch { /* fail closed below */ }
            if (!serializedObservation || serializedObservation.length > 2_000_000) {
              throw new Error('QUALITY_JOURNAL_OBSERVATION_UNSERIALIZABLE');
            }
            observationSha256 = sha256(serializedObservation);
            const redacted = redactObservation(JSON.parse(serializedObservation) as unknown);
            observation = redacted.value;
            redactionApplied = redacted.applied;
          }
          const event: OutcomeEvent = { type: 'outcome', attemptId: input.attemptId, status: input.status,
            durationMs: input.durationMs, ...usageFrom(input.observation),
            ...(observationSha256 ? { observationSha256, observation, redactionApplied, unsafeToGrade: redactionApplied }
              : { unsafeToGrade: true }),
            ...(typeof input.error === 'string' ? { errorSha256: sha256(input.error) } : {}),
            ...(input.failure ? { failure: { ...input.failure } } : {}) };
          await append(event);
          attempts = attempts.map((attempt) => attempt.attemptId === input.attemptId
            ? { ...attempt, status: event.status, durationMs: event.durationMs, usageState: event.usageState,
                inputTokens: event.inputTokens, outputTokens: event.outputTokens,
                observationSha256: event.observationSha256, observation: event.observation,
                redactionApplied: event.redactionApplied, unsafeToGrade: event.unsafeToGrade,
                errorSha256: event.errorSha256, failure: event.failure }
            : attempt);
        });
      },
      readState() {
        return { campaignId: options.campaignId, freezeHash: options.freezeHash, provider: options.provider,
          model: options.model, maxCalls: options.maxCalls, usedCalls: attempts.length,
          attempts: structuredClone(attempts) };
      },
      async close() {
        if (closed) return;
        closed = true;
        await queue;
        await file!.close();
        await lock.close();
        if (await readFile(lockPath, 'utf8') === lockToken) await unlink(lockPath);
      },
    };
  } catch (error) {
    await file?.close().catch(() => undefined);
    await lock.close().catch(() => undefined);
    if (await readFile(lockPath, 'utf8').catch(() => null) === lockToken) await unlink(lockPath).catch(() => undefined);
    throw error;
  }
}
