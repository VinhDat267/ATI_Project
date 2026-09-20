import { describe, expect, it } from "vitest";
import { recoverLiveEvaluationState } from "../src/ai/live-evaluation/recovery.js";
import type { DurableLiveJournalEvent } from "../src/ai/live-evaluation/journal.js";

function event(
  sequence: number,
  eventName: DurableLiveJournalEvent["event"],
  trialId: string,
  payload: Record<string, unknown>,
): DurableLiveJournalEvent {
  return {
    version: 1,
    sequence,
    eventId: `${"00000000-0000-4000-8000-"}${String(sequence).padStart(12, "0")}`,
    event: eventName,
    timestamp: "2026-09-20T00:00:00.000Z",
    trialId,
    payload,
  };
}

describe("ai-live recovery", () => {
  it("marks started trials and reserved calls interrupted without retrying", () => {
    const state = recoverLiveEvaluationState([
      event(1, "trial_scheduled", "trial-1", {
        profileId: "openai-only",
        caseId: "b01",
        variant: "semantic",
        topK: 3,
        repetition: 1,
      }),
      event(2, "trial_started", "trial-1", {}),
      event(3, "provider_call_reserved", "trial-1", {
        callId: "provider-call-1",
        reservation: {
          campaignId: "camp-1",
          runId: "run-1",
          profileId: "openai-only",
          trialId: "trial-1",
          provider: "openai",
          purpose: "planning",
          model: "gpt-5.6-terra",
          requestHash: "request-hash",
          estimatedCostMicros: 100,
        },
      }),
    ]);

    expect(state.outcomes).toHaveLength(1);
    expect(state.outcomes[0]).toMatchObject({
      trialId: "trial-1",
      status: "cancelled",
      error: "interrupted_before_terminal_event",
    });
    expect(state.ledgerRecords[0]).toMatchObject({
      callId: "provider-call-1",
      status: "ambiguous",
      reservationHeld: true,
      errorCode: "RUN_INTERRUPTED",
    });
    expect(state.retryTrialIds).toEqual(["trial-1"]);
  });

  it("replays a terminal outcome exactly when terminal payload is present", () => {
    const state = recoverLiveEvaluationState([
      event(1, "trial_scheduled", "trial-2", {
        profileId: "openai-only",
        caseId: "b01",
        variant: "all_tools",
        topK: 10,
        repetition: 1,
      }),
      event(2, "trial_started", "trial-2", {}),
      event(3, "trial_completed", "trial-2", {
        status: "completed",
        score: null,
        modelCalls: [],
        durationMs: 42,
      }),
    ]);
    expect(state.outcomes[0]).toMatchObject({
      trialId: "trial-2",
      status: "completed",
      latency: { totalMs: 42 },
    });
    expect(state.retryTrialIds).toEqual([]);
  });

  it("preserves the scheduled exposure during interrupted recovery", () => {
    const state = recoverLiveEvaluationState([
      event(1, "trial_scheduled", "legacy-trial", {
        profileId: "openai-only",
        caseId: "b07",
        exposure: "legacy_regression",
        variant: "semantic",
        topK: 3,
        repetition: 1,
      }),
      event(2, "trial_started", "legacy-trial", {}),
    ]);
    expect(state.outcomes[0]?.exposure).toBe("legacy_regression");
  });
});
