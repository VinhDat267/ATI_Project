import { buildRuntime, type PlannerResult, type TrustedTool } from "@wap/dsl";
import { AiPlannerAdapter, type ModelCallEvidence } from "../planner.js";
import type { StructuredModelClient } from "../ports.js";
import type { RetrievalResult, ToolRetriever } from "../retrieval.js";
import type {
  LiveEvaluationCell,
  LiveExposure,
  LiveJournalEvent,
  LiveModelCallSummary,
  LiveProfileConfig,
  LiveRubric,
  LiveTrialOutcome,
  LiveTrialScheduleItem,
  LiveTrialStatus,
} from "./contracts.js";
import { assertNoGoldCanaryInPayload, type ParsedLiveCase } from "./dataset.js";
import { scoreLiveCandidate } from "./scorer.js";
import type { ProviderCallLedger } from "../providers/registry.js";
import { ProviderAccountingError } from "../providers/accounting.js";
import { createLiveJournal, type LiveJournal } from "./journal.js";

export interface LiveEvaluationSession {
  readonly model: StructuredModelClient;
  readonly retriever: ToolRetriever;
  readonly assertCurrent?: () => Promise<void>;
}

export interface LiveEvaluationSessionContext {
  readonly campaignId: string;
  readonly runId: string;
  readonly profileId: string;
  readonly trialId: string;
  readonly variant?: LiveEvaluationCell["variant"];
}

export interface LiveEvaluationRunnerOptions {
  readonly trials: readonly LiveTrialScheduleItem[];
  readonly cases: ReadonlyMap<string, ParsedLiveCase>;
  readonly profiles: ReadonlyMap<string, LiveProfileConfig>;
  readonly registry: readonly TrustedTool[];
  readonly rubric?: LiveRubric;
  readonly ledger: ProviderCallLedger;
  readonly campaignId?: string;
  readonly runId?: string;
  readonly getSession: (
    context: LiveEvaluationSessionContext,
  ) => Promise<LiveEvaluationSession>;
  readonly journalWriter?: (event: LiveJournalEvent) => Promise<void>;
  readonly signal?: AbortSignal;
  readonly canary?: string;
  readonly now?: () => number;
}

export interface LiveEvaluationRunResult {
  readonly verdict:
    "LIVE_EVALUATION_PASS" | "LIVE_EVALUATION_FAIL" | "LIVE_EVALUATION_PARTIAL";
  readonly plannedCount: number;
  readonly completedCount: number;
  readonly failedCount: number;
  readonly cancelledCount: number;
  readonly notStartedCount: number;
  readonly outcomes: readonly LiveTrialOutcome[];
  readonly haltReason?: string;
}

export function createFileJournalWriter(filePath: string): ((
  event: LiveJournalEvent,
) => Promise<void>) & {
  close: () => Promise<void>;
  replay: LiveJournal["replay"];
} {
  const journalPromise = createLiveJournal(filePath);
  const writer = (async (event: LiveJournalEvent): Promise<void> => {
    await (await journalPromise).append(event);
  }) as ((event: LiveJournalEvent) => Promise<void>) & {
    close: () => Promise<void>;
    replay: LiveJournal["replay"];
  };
  writer.close = async () => (await journalPromise).close();
  writer.replay = async () => (await journalPromise).replay();
  return writer;
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 500);
}

export async function runLiveEvaluation(
  options: LiveEvaluationRunnerOptions,
): Promise<LiveEvaluationRunResult> {
  const now = options.now ?? (() => Date.now());
  const emitJournal = options.journalWriter ?? (async () => {});

  // 1. Emit all planned trials to journal
  for (const trial of options.trials) {
    await emitJournal({
      event: "trial_scheduled",
      timestamp: new Date(now()).toISOString(),
      trialId: trial.trialId,
      payload: {
        profileId: trial.profileId,
        caseId: trial.caseId,
        variant: trial.cell.variant,
        topK: trial.cell.topK,
        repetition: trial.repetition,
      },
    });
  }

  const outcomes: LiveTrialOutcome[] = [];
  let haltReason: string | undefined;

  for (let index = 0; index < options.trials.length; index++) {
    const trial = options.trials[index]!;

    // Check cancellation signal before starting trial
    if (options.signal?.aborted || haltReason) {
      const reason =
        haltReason ??
        (options.signal?.reason instanceof Error
          ? options.signal.reason.message
          : "Trial cancelled by abort signal");

      await emitJournal({
        event: "trial_not_started",
        timestamp: new Date(now()).toISOString(),
        trialId: trial.trialId,
        payload: { reason },
      });

      outcomes.push({
        trialId: trial.trialId,
        profileId: trial.profileId,
        caseId: trial.caseId,
        exposure: options.cases.get(trial.caseId)?.exposure ?? "dev",
        cell: trial.cell,
        repetition: trial.repetition,
        status: "not_started",
        modelCalls: [],
        score: null,
        latency: { totalMs: 0 },
        error: reason,
      });
      continue;
    }

    const parsedCase = options.cases.get(trial.caseId);
    if (!parsedCase) {
      const err = `Case "${trial.caseId}" not found in dataset`;
      await emitJournal({
        event: "trial_failed",
        timestamp: new Date(now()).toISOString(),
        trialId: trial.trialId,
        payload: { error: err },
      });
      outcomes.push({
        trialId: trial.trialId,
        profileId: trial.profileId,
        caseId: trial.caseId,
        exposure: "dev",
        cell: trial.cell,
        repetition: trial.repetition,
        status: "failed",
        modelCalls: [],
        score: null,
        latency: { totalMs: 0 },
        error: err,
      });
      continue;
    }

    const profile = options.profiles.get(trial.profileId);
    if (!profile) {
      const err = `Profile "${trial.profileId}" not found in profiles`;
      await emitJournal({
        event: "trial_failed",
        timestamp: new Date(now()).toISOString(),
        trialId: trial.trialId,
        payload: { error: err },
      });
      outcomes.push({
        trialId: trial.trialId,
        profileId: trial.profileId,
        caseId: trial.caseId,
        exposure: parsedCase.exposure,
        cell: trial.cell,
        repetition: trial.repetition,
        status: "failed",
        modelCalls: [],
        score: null,
        latency: { totalMs: 0 },
        error: err,
      });
      continue;
    }

    // Emit trial started
    await emitJournal({
      event: "trial_started",
      timestamp: new Date(now()).toISOString(),
      trialId: trial.trialId,
      payload: {
        profileId: trial.profileId,
        caseId: trial.caseId,
        cell: trial.cell,
        repetition: trial.repetition,
      },
    });

    const trialStartMs = now();
    const modelCalls: LiveModelCallSummary[] = [];
    let candidate: PlannerResult | null = null;
    let trialError: string | null = null;
    let trialStatus: LiveTrialStatus = "completed";
    let coldSetupMs: number | undefined;
    const retrievalState: { result: RetrievalResult | null } = { result: null };
    const capturedEvidences: ModelCallEvidence[] = [];

    try {
      // Canary leakage guard
      if (options.canary) {
        assertNoGoldCanaryInPayload(parsedCase.input, options.canary);
      }

      const coldStart = now();
      const session = await options.getSession({
        campaignId: options.campaignId ?? "live-evaluation",
        runId: options.runId ?? trial.trialId,
        profileId: trial.profileId,
        trialId: trial.trialId,
        variant: trial.cell.variant,
      });
      coldSetupMs = Math.max(0, now() - coldStart);

      const observingRetriever: ToolRetriever = {
        async retrieve(request) {
          const res = await session.retriever.retrieve(request);
          retrievalState.result = res;
          return res;
        },
      };

      const planner = new AiPlannerAdapter({
        retriever: observingRetriever,
        assertCurrent: session.assertCurrent,
        model: session.model,
        variant: trial.cell.variant,
        topK: trial.cell.topK,
        maxPlanningCalls: (profile.limits?.maxPlanningCalls ?? 3) as 3,
        deadlineMs: profile.limits?.trialDeadlineMs ?? 30_000,
        validatePlan: () => [],
        onModelCall: (evidence) => {
          capturedEvidences.push(evidence);
        },
      });

      const timeZone = parsedCase.input.runtime.time_zone ?? "Asia/Ho_Chi_Minh";
      const runtimeContext = buildRuntime({
        now: parsedCase.input.runtime.now
          ? new Date(parsedCase.input.runtime.now)
          : new Date(trialStartMs),
        runId: parsedCase.input.runtime.run_id ?? trial.trialId,
        userId: parsedCase.input.runtime.user_id ?? "eval-user",
        timeZone,
      });

      candidate = await planner.produce({
        runId: trial.trialId,
        userId: runtimeContext.user_id,
        request: {
          source_prompt: parsedCase.input.prompt,
          inputs: {},
          time_zone: timeZone,
        },
        runtime: runtimeContext,
        signal: options.signal,
      });
    } catch (error) {
      trialError = safeErrorMessage(error);
      if (
        error instanceof ProviderAccountingError &&
        error.code === "BUDGET_EXCEEDED"
      ) {
        trialStatus = "cancelled";
        haltReason = `Budget exceeded: ${error.message}`;
      } else if (
        options.signal?.aborted ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        trialStatus = "cancelled";
        haltReason = "Execution interrupted by abort signal";
      } else {
        trialStatus = "failed";
      }
    } finally {
      // Provider evidence is retained even when planner.produce throws after a
      // provider call has already emitted its failed/cancelled observation.
      for (const evidence of capturedEvidences) {
        modelCalls.push({
          callId: evidence.requestId ?? `${trial.trialId}-${evidence.attempt}`,
          provider: evidence.provider ?? profile.planning.provider,
          model: evidence.model ?? profile.planning.model,
          purpose: "planning",
          status: evidence.status,
          latencyMs: evidence.latencyMs,
          costMicros: null,
          tokens: evidence.usage
            ? {
                inputTokens: evidence.usage.inputTokens,
                outputTokens: evidence.usage.outputTokens,
                totalTokens: evidence.usage.totalTokens,
              }
            : null,
          errorCode: evidence.status === "received" ? null : evidence.status,
        });
      }
    }

    const trialDurationMs = Math.max(0, now() - trialStartMs);

    if (trialStatus === "completed" && candidate) {
      const score = scoreLiveCandidate({
        caseInput: parsedCase.input,
        oracle: parsedCase.oracle,
        rubric: options.rubric,
        registry: options.registry,
        candidate,
      });

      await emitJournal({
        event: "trial_completed",
        timestamp: new Date(now()).toISOString(),
        trialId: trial.trialId,
        payload: {
          status: "completed",
          score,
          modelCalls,
          durationMs: trialDurationMs,
          modelCallsCount: modelCalls.length,
        },
      });

      outcomes.push({
        trialId: trial.trialId,
        profileId: trial.profileId,
        caseId: trial.caseId,
        exposure: parsedCase.exposure,
        cell: trial.cell,
        repetition: trial.repetition,
        status: "completed",
        modelCalls,
        score,
        latency: {
          totalMs: trialDurationMs,
          retrievalMs: retrievalState.result?.latencyMs,
          coldSetupMs,
        },
        error: null,
      });
    } else if (trialStatus === "cancelled") {
      await emitJournal({
        event: "trial_cancelled",
        timestamp: new Date(now()).toISOString(),
        trialId: trial.trialId,
        payload: {
          status: "cancelled",
          reason: trialError,
          modelCalls,
          durationMs: trialDurationMs,
        },
      });

      outcomes.push({
        trialId: trial.trialId,
        profileId: trial.profileId,
        caseId: trial.caseId,
        exposure: parsedCase.exposure,
        cell: trial.cell,
        repetition: trial.repetition,
        status: "cancelled",
        modelCalls,
        score: null,
        latency: { totalMs: trialDurationMs, coldSetupMs },
        error: trialError,
      });
    } else {
      await emitJournal({
        event: "trial_failed",
        timestamp: new Date(now()).toISOString(),
        trialId: trial.trialId,
        payload: {
          status: "failed",
          error: trialError,
          modelCalls,
          durationMs: trialDurationMs,
        },
      });

      outcomes.push({
        trialId: trial.trialId,
        profileId: trial.profileId,
        caseId: trial.caseId,
        exposure: parsedCase.exposure,
        cell: trial.cell,
        repetition: trial.repetition,
        status: "failed",
        modelCalls,
        score: null,
        latency: { totalMs: trialDurationMs, coldSetupMs },
        error: trialError,
      });
    }
  }

  const plannedCount = options.trials.length;
  const completedCount = outcomes.filter(
    (o) => o.status === "completed",
  ).length;
  const failedCount = outcomes.filter((o) => o.status === "failed").length;
  const cancelledCount = outcomes.filter(
    (o) => o.status === "cancelled",
  ).length;
  const notStartedCount = outcomes.filter(
    (o) => o.status === "not_started",
  ).length;

  let verdict: LiveEvaluationRunResult["verdict"];
  if (failedCount > 0 || cancelledCount > 0 || notStartedCount > 0) {
    verdict = "LIVE_EVALUATION_PARTIAL";
  } else {
    // Check if any semantic score failed
    const allPassed = outcomes.every(
      (o) => o.score?.semanticJudgment === "correct",
    );
    verdict = allPassed ? "LIVE_EVALUATION_PASS" : "LIVE_EVALUATION_FAIL";
  }

  return {
    verdict,
    plannedCount,
    completedCount,
    failedCount,
    cancelledCount,
    notStartedCount,
    outcomes,
    ...(haltReason ? { haltReason } : {}),
  };
}
