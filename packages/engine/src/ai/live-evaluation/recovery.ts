import type {
  LiveEvaluationCell,
  LiveModelCallSummary,
  LiveTrialOutcome,
  LiveTrialScheduleItem,
  LiveTrialStatus,
  LiveEvaluationScore,
} from "./contracts.js";
import type { DurableLiveJournalEvent } from "./journal.js";
import { restoreProviderCallRecords } from "./ledger.js";
import type { ProviderCallRecord } from "../providers/accounting.js";

export interface RecoveredLiveEvaluationState {
  readonly plannedTrials: readonly LiveTrialScheduleItem[];
  readonly outcomes: readonly LiveTrialOutcome[];
  readonly ledgerRecords: readonly ProviderCallRecord[];
  readonly retryTrialIds: readonly string[];
}

function recordToModelCall(record: ProviderCallRecord): LiveModelCallSummary {
  return {
    callId: record.callId,
    provider: record.provider,
    model: record.model,
    purpose: record.purpose,
    status: record.status,
    latencyMs: 0,
    costMicros: record.costMicros,
    tokens: record.usage
      ? {
          inputTokens: record.usage.inputTokens,
          outputTokens: record.usage.outputTokens,
          totalTokens: record.usage.totalTokens,
        }
      : null,
    errorCode: record.errorCode,
  };
}

function terminalStatus(
  event: DurableLiveJournalEvent,
): LiveTrialStatus | null {
  switch (event.event) {
    case "trial_completed":
      return "completed";
    case "trial_failed":
      return "failed";
    case "trial_cancelled":
      return "cancelled";
    case "trial_not_started":
      return "not_started";
    default:
      return null;
  }
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function buildOutcome(
  trial: LiveTrialScheduleItem,
  status: LiveTrialStatus,
  payload: Record<string, unknown>,
  modelCalls: readonly LiveModelCallSummary[],
): LiveTrialOutcome {
  return {
    trialId: trial.trialId,
    profileId: trial.profileId,
    caseId: trial.caseId,
    exposure: "dev",
    cell: trial.cell,
    repetition: trial.repetition,
    status,
    modelCalls,
    score: (payload.score as LiveEvaluationScore | null | undefined) ?? null,
    latency: {
      totalMs: numberValue(payload.durationMs, 0),
    },
    error:
      typeof payload.error === "string"
        ? payload.error
        : status === "completed"
          ? null
          : "recovered_terminal_event",
  };
}

/**
 * Reconstructs evaluator state from validated journal events. This function is
 * deliberately pure: it never opens a database, creates provider ports, or
 * retries a request.
 */
export function recoverLiveEvaluationState(
  events: readonly DurableLiveJournalEvent[],
): RecoveredLiveEvaluationState {
  const planned = new Map<string, LiveTrialScheduleItem>();
  const started = new Set<string>();
  const terminal = new Map<string, LiveTrialOutcome>();

  for (const event of events) {
    if (event.event === "trial_scheduled") {
      const payload = event.payload;
      if (planned.has(event.trialId)) {
        throw new Error(`Duplicate scheduled trial ${event.trialId}`);
      }
      const variant = payload.variant;
      const topK = payload.topK;
      if (
        variant !== "all_tools" &&
        variant !== "semantic" &&
        variant !== "semantic_qe"
      ) {
        throw new Error(`Invalid recovered trial variant for ${event.trialId}`);
      }
      if (topK !== 3 && topK !== 5 && topK !== 10) {
        throw new Error(`Invalid recovered trial topK for ${event.trialId}`);
      }
      const trial: LiveTrialScheduleItem = {
        trialId: event.trialId,
        profileId: stringValue(payload.profileId, "unknown-profile"),
        caseId: stringValue(payload.caseId, "unknown-case"),
        cell: { variant, topK } as LiveEvaluationCell,
        repetition:
          typeof payload.repetition === "number" &&
          Number.isInteger(payload.repetition) &&
          payload.repetition > 0
            ? payload.repetition
            : 1,
      };
      planned.set(event.trialId, trial);
    } else if (event.event === "trial_started") {
      if (!planned.has(event.trialId)) {
        throw new Error(`Trial started before schedule ${event.trialId}`);
      }
      if (started.has(event.trialId)) {
        throw new Error(`Duplicate trial start ${event.trialId}`);
      }
      started.add(event.trialId);
    } else {
      const status = terminalStatus(event);
      if (status) {
        const trial = planned.get(event.trialId);
        if (!trial) {
          throw new Error(
            `Trial terminal event before schedule ${event.trialId}`,
          );
        }
        if (terminal.has(event.trialId)) {
          throw new Error(`Duplicate trial terminal event ${event.trialId}`);
        }
        const payloadCalls = Array.isArray(event.payload.modelCalls)
          ? (event.payload.modelCalls as LiveModelCallSummary[])
          : [];
        terminal.set(
          event.trialId,
          buildOutcome(trial, status, event.payload, payloadCalls),
        );
      }
    }
  }

  const ledgerRecords = restoreProviderCallRecords(events).map((record) =>
    record.status === "reserved"
      ? {
          ...record,
          status: "ambiguous" as const,
          errorCode: "RUN_INTERRUPTED",
          reservationHeld: true,
        }
      : record,
  );
  const callsByTrial = new Map<string, LiveModelCallSummary[]>();
  for (const record of ledgerRecords) {
    const calls = callsByTrial.get(record.trialId ?? "") ?? [];
    calls.push(recordToModelCall(record));
    callsByTrial.set(record.trialId ?? "", calls);
  }

  const outcomes: LiveTrialOutcome[] = [];
  const retryTrialIds: string[] = [];
  for (const trial of planned.values()) {
    const calls = callsByTrial.get(trial.trialId) ?? [];
    const recovered = terminal.get(trial.trialId);
    if (recovered) {
      outcomes.push({
        ...recovered,
        modelCalls: calls.length > 0 ? calls : recovered.modelCalls,
      });
      continue;
    }
    const interrupted = started.has(trial.trialId);
    outcomes.push(
      buildOutcome(
        trial,
        interrupted ? "cancelled" : "not_started",
        {
          error: interrupted
            ? "interrupted_before_terminal_event"
            : "not_started_before_recovery",
        },
        calls,
      ),
    );
    if (interrupted || calls.some((call) => call.status === "ambiguous")) {
      retryTrialIds.push(trial.trialId);
    }
  }

  return {
    plannedTrials: [...planned.values()],
    outcomes,
    ledgerRecords,
    retryTrialIds,
  };
}
