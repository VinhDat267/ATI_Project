import type { RunDetail, TracePage } from "./contracts.js";
import { isTerminal } from "./presentation.js";

export type StepState =
  | "done"
  | "running"
  | "waiting"
  | "awaiting_approval"
  | "unknown"
  | "failed"
  | "not_run";

export interface StepView {
  id: string;
  description: string;
  write: boolean;
  server: string;
  tool: string;
  state: StepState;
  /** Short evidence line, e.g. "đọc · 4 dòng lúc 16:02:41". */
  attemptError: string | null;
  startedAt: string | null;
}

type Attempt = TracePage["attempts"][number];

function lastAttempts(trace: TracePage | undefined): Map<string, Attempt> {
  const byStep = new Map<string, Attempt>();
  for (const attempt of trace?.attempts ?? []) {
    const previous = byStep.get(attempt.step_id);
    if (!previous || attempt.attempt_no >= previous.attempt_no) {
      byStep.set(attempt.step_id, attempt);
    }
  }
  return byStep;
}

/**
 * Per-step state from the plan and trace only. Nothing is inferred from local
 * timers: a step without an attempt is "waiting" while the run is live and
 * "not_run" once the run is terminal.
 */
export function stepViews(run: RunDetail, trace: TracePage | undefined): StepView[] {
  const attempts = lastAttempts(trace);
  const terminal = isTerminal(run.status);
  return (run.plan?.steps ?? []).map((step) => {
    const attempt = attempts.get(step.id);
    let state: StepState;
    if (attempt) {
      if (attempt.outcome_certainty === "unknown") state = "unknown";
      else if (attempt.error_class || attempt.outcome_certainty === "known_not_applied") state = "failed";
      else if (attempt.ended_at === null) state = terminal ? "unknown" : "running";
      else state = "done";
    } else if (run.status === "awaiting_approval" && step.side_effect === "write") {
      state = "awaiting_approval";
    } else {
      state = terminal ? "not_run" : "waiting";
    }
    return {
      id: step.id,
      description: step.description,
      write: step.side_effect === "write",
      server: step.tool.server,
      tool: step.tool.name,
      state,
      attemptError: attempt?.error_message ?? null,
      startedAt: attempt?.started_at ?? null,
    };
  });
}
