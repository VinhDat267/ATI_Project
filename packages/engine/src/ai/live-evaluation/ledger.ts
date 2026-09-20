import { z } from "zod";
import type { ProviderCallLedger } from "../providers/registry.js";
import {
  ProviderAccountingError,
  type ProviderCallRecord,
  type ProviderCallReservation,
  type ProviderCallSettlement,
} from "../providers/accounting.js";
import type { DurableLiveJournalEvent, LiveJournal } from "./journal.js";

const ProviderCallUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().optional(),
    cachedInputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    reasoningTokens: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative().optional(),
  })
  .strict();

const ProviderCallReservationSchema = z
  .object({
    campaignId: z.string().min(1),
    runId: z.string().min(1),
    profileId: z.string().min(1),
    trialId: z.string().min(1),
    provider: z.enum(["openai", "google"]),
    purpose: z.enum([
      "planning",
      "repair",
      "replan",
      "query_expansion",
      "embedding",
    ]),
    model: z.string().min(1),
    requestHash: z.string().min(1),
    outputCap: z.number().int().positive().optional(),
    embeddingPurpose: z.enum(["document", "query"]).optional(),
    estimatedCostMicros: z.number().int().nonnegative(),
  })
  .strict();

const ProviderCallSettlementSchema = z
  .object({
    status: z.enum([
      "succeeded",
      "failed",
      "invalid_output",
      "ambiguous",
      "cancelled",
    ]),
    usage: ProviderCallUsageSchema.nullable(),
    costMicros: z.number().int().nonnegative().nullable(),
    errorCode: z.string().nullable().optional(),
  })
  .strict();

const ProviderCallReservedPayloadSchema = z
  .object({
    callId: z.string().min(1),
    reservation: ProviderCallReservationSchema,
  })
  .strict();

const ProviderCallSettledPayloadSchema = z
  .object({
    callId: z.string().min(1),
    outcome: ProviderCallSettlementSchema,
  })
  .strict();

function cloneRecord(record: ProviderCallRecord): ProviderCallRecord {
  return {
    ...record,
    usage: record.usage ? { ...record.usage } : null,
  };
}

function normalizeSettlement(
  outcome: ProviderCallSettlement,
): ProviderCallSettlement {
  return {
    status: outcome.status,
    usage: outcome.usage ? { ...outcome.usage } : null,
    costMicros: outcome.costMicros,
    errorCode: outcome.errorCode ?? null,
  };
}

function settlementOf(record: ProviderCallRecord): ProviderCallSettlement {
  return {
    status: record.status === "reserved" ? "cancelled" : record.status,
    usage: record.usage,
    costMicros: record.costMicros,
    errorCode: record.errorCode,
  };
}

function sameSettlement(
  left: ProviderCallSettlement,
  right: ProviderCallSettlement,
): boolean {
  return (
    JSON.stringify(normalizeSettlement(left)) ===
    JSON.stringify(normalizeSettlement(right))
  );
}

function eventTimestamp(): string {
  return new Date().toISOString();
}

function requireTrialId(input: ProviderCallReservation): string {
  if (!input.trialId?.trim()) {
    throw new Error("JournaledProviderCallLedger requires reservation.trialId");
  }
  return input.trialId;
}

function applySettlement(
  current: ProviderCallRecord,
  outcome: ProviderCallSettlement,
): ProviderCallRecord {
  const normalized = normalizeSettlement(outcome);
  return {
    ...current,
    status: normalized.status,
    usage: normalized.usage,
    costMicros: normalized.costMicros,
    errorCode: normalized.errorCode ?? null,
    reservationHeld:
      normalized.status === "ambiguous" || normalized.costMicros === null,
  };
}

function nextSequence(records: Iterable<ProviderCallRecord>): number {
  let sequence = 0;
  for (const record of records) {
    const match = /^provider-call-(\d+)$/.exec(record.callId);
    if (match) sequence = Math.max(sequence, Number(match[1]));
  }
  return sequence;
}

export interface JournaledProviderCallLedgerOptions {
  readonly campaignLimitMicros: number;
  readonly journal: LiveJournal;
  readonly initialRecords?: readonly ProviderCallRecord[];
}

/**
 * Durable evaluator ledger. A reservation journal event is fsynced before the
 * record becomes visible, so a crash cannot spend budget without evidence.
 */
export class JournaledProviderCallLedger implements ProviderCallLedger {
  private readonly limitMicros: number;
  private readonly journal: LiveJournal;
  private readonly store = new Map<string, ProviderCallRecord>();
  private sequence: number;
  private failure: unknown;
  private tail: Promise<void> = Promise.resolve();

  constructor(options: JournaledProviderCallLedgerOptions) {
    if (
      !Number.isInteger(options.campaignLimitMicros) ||
      options.campaignLimitMicros <= 0
    ) {
      throw new Error("campaignLimitMicros must be a positive integer");
    }
    this.limitMicros = options.campaignLimitMicros;
    this.journal = options.journal;
    for (const record of options.initialRecords ?? []) {
      if (this.store.has(record.callId)) {
        throw new Error(`Duplicate provider call ${record.callId}`);
      }
      requireTrialId(record);
      this.store.set(record.callId, cloneRecord(record));
    }
    this.sequence = nextSequence(this.store.values());
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.tail.then(async () => {
      if (this.failure !== undefined) throw this.failure;
      try {
        return await operation();
      } catch (error) {
        this.failure = error;
        throw error;
      }
    });
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }

  async reserve(input: ProviderCallReservation): Promise<string> {
    const trialId = requireTrialId(input);
    if (
      !Number.isFinite(input.estimatedCostMicros) ||
      input.estimatedCostMicros < 0
    ) {
      throw new Error("estimatedCostMicros must be non-negative");
    }
    return this.enqueue(async () => {
      const committed = [...this.store.values()].reduce(
        (sum, record) =>
          sum +
          (record.costMicros ??
            (record.reservationHeld ? record.estimatedCostMicros : 0)),
        0,
      );
      if (committed + input.estimatedCostMicros > this.limitMicros) {
        throw new ProviderAccountingError(
          "BUDGET_EXCEEDED",
          `provider call reservation exceeds campaign cap of ${this.limitMicros} micros`,
        );
      }

      const callId = `provider-call-${++this.sequence}`;
      const reservation = { ...input, trialId };
      await this.journal.append({
        event: "provider_call_reserved",
        timestamp: eventTimestamp(),
        trialId,
        payload: { callId, reservation },
      });
      this.store.set(callId, {
        ...reservation,
        callId,
        status: "reserved",
        usage: null,
        costMicros: null,
        errorCode: null,
        reservationHeld: true,
      });
      return callId;
    });
  }

  async settle(callId: string, outcome: ProviderCallSettlement): Promise<void> {
    return this.enqueue(async () => {
      const current = this.store.get(callId);
      if (!current) {
        throw new ProviderAccountingError(
          "CALL_NOT_FOUND",
          `unknown provider call ${callId}`,
        );
      }
      const normalized = normalizeSettlement(outcome);
      if (current.status !== "reserved") {
        if (sameSettlement(settlementOf(current), normalized)) return;
        throw new ProviderAccountingError(
          "CALL_ALREADY_SETTLED",
          `provider call ${callId} is already settled`,
        );
      }
      await this.journal.append({
        event: "provider_call_settled",
        timestamp: eventTimestamp(),
        trialId: current.trialId!,
        payload: { callId, outcome: normalized },
      });
      this.store.set(callId, applySettlement(current, normalized));
      const committed = [...this.store.values()].reduce(
        (sum, record) =>
          sum +
          (record.costMicros ??
            (record.reservationHeld ? record.estimatedCostMicros : 0)),
        0,
      );
      if (committed > this.limitMicros) {
        const overrunError = new ProviderAccountingError(
          "BUDGET_OVERRUN",
          `provider call settlement caused campaign spend of ${committed} micros to exceed cap of ${this.limitMicros} micros`,
        );
        this.failure = overrunError;
        throw overrunError;
      }
    });
  }

  records(): ProviderCallRecord[] {
    return [...this.store.values()].map(cloneRecord);
  }
}

/** Rebuilds the call ledger from validated durable journal events. */
export function restoreProviderCallRecords(
  events: readonly DurableLiveJournalEvent[],
): ProviderCallRecord[] {
  const records = new Map<string, ProviderCallRecord>();
  for (const event of events) {
    if (event.event === "provider_call_reserved") {
      const parsed = ProviderCallReservedPayloadSchema.safeParse(event.payload);
      if (!parsed.success) {
        throw new Error(
          `Invalid provider_call_reserved payload: ${parsed.error.message}`,
        );
      }
      if (parsed.data.reservation.trialId !== event.trialId) {
        throw new Error(
          `Provider call ${parsed.data.callId} trial scope mismatch`,
        );
      }
      if (records.has(parsed.data.callId)) {
        throw new Error(
          `Duplicate provider call reservation ${parsed.data.callId}`,
        );
      }
      records.set(parsed.data.callId, {
        ...parsed.data.reservation,
        callId: parsed.data.callId,
        status: "reserved",
        usage: null,
        costMicros: null,
        errorCode: null,
        reservationHeld: true,
      });
    } else if (event.event === "provider_call_settled") {
      const parsed = ProviderCallSettledPayloadSchema.safeParse(event.payload);
      if (!parsed.success) {
        throw new Error(
          `Invalid provider_call_settled payload: ${parsed.error.message}`,
        );
      }
      const current = records.get(parsed.data.callId);
      if (!current) {
        throw new Error(
          `Settlement precedes reservation for ${parsed.data.callId}`,
        );
      }
      if (current.trialId !== event.trialId) {
        throw new Error(
          `Provider call ${parsed.data.callId} trial scope mismatch`,
        );
      }
      if (current.status !== "reserved") {
        throw new Error(`Duplicate settlement for ${parsed.data.callId}`);
      }
      records.set(
        parsed.data.callId,
        applySettlement(current, parsed.data.outcome),
      );
    }
  }
  return [...records.values()].map(cloneRecord);
}
