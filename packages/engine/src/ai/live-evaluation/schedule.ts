import type { LiveEvaluationCell, LiveTrialScheduleItem } from "./contracts.js";

/**
 * Deterministic 7-cell matrix required for live AI evaluation:
 * 1. all_tools @ topK=10 (full catalog control)
 * 2. semantic @ topK=3
 * 3. semantic @ topK=5
 * 4. semantic @ topK=10
 * 5. semantic_qe @ topK=3
 * 6. semantic_qe @ topK=5
 * 7. semantic_qe @ topK=10
 */
export const LIVE_EVALUATION_CELLS: readonly LiveEvaluationCell[] = [
  { variant: "all_tools", topK: 10 },
  { variant: "semantic", topK: 3 },
  { variant: "semantic", topK: 5 },
  { variant: "semantic", topK: 10 },
  { variant: "semantic_qe", topK: 3 },
  { variant: "semantic_qe", topK: 5 },
  { variant: "semantic_qe", topK: 10 },
] as const;

export const REPETITIONS_PER_CELL = 3 as const;

/**
 * Generate deterministic schedule of live trials.
 *
 * Requirements:
 * - Grouped into sequential profile blocks: never interleave trials of different profiles.
 * - 7 cells per case × 3 repetitions = 21 trials per case.
 * - Frozen seeded order within each profile block.
 *
 * Scaling:
 * - 1 profile, 6 dev cases = 126 trials
 * - 1 profile, 4 legacy cases = 84 trials
 * - 2 profiles, 6 dev cases = 252 trials
 */
export function scheduleLiveTrials(
  profiles: readonly string[],
  caseIds: readonly string[],
  options?: {
    readonly repetitions?: number;
    readonly cells?: readonly LiveEvaluationCell[];
  },
): readonly LiveTrialScheduleItem[] {
  if (profiles.length === 0) {
    return [];
  }
  if (caseIds.length === 0) {
    return [];
  }

  if (new Set(profiles).size !== profiles.length) {
    throw new Error("schedule contains duplicate profile ids");
  }
  if (new Set(caseIds).size !== caseIds.length) {
    throw new Error("schedule contains duplicate case ids");
  }

  const cells = options?.cells ?? LIVE_EVALUATION_CELLS;
  const repetitions = options?.repetitions ?? REPETITIONS_PER_CELL;

  if (repetitions <= 0 || !Number.isInteger(repetitions)) {
    throw new Error("repetitions must be a positive integer");
  }

  const cellKeys = cells.map((cell) => `${cell.variant}@${cell.topK}`);
  if (new Set(cellKeys).size !== cellKeys.length) {
    throw new Error("schedule contains duplicate cells");
  }

  const trials: LiveTrialScheduleItem[] = [];
  const trialIds = new Set<string>();

  for (const profileId of profiles) {
    for (const caseId of caseIds) {
      for (const cell of cells) {
        if (cell.variant === "all_tools" && cell.topK !== 10) {
          throw new Error("all_tools variant requires topK 10");
        }
        for (let repetition = 1; repetition <= repetitions; repetition++) {
          const trialId = `${profileId}:${caseId}:${cell.variant}:k${cell.topK}:r${repetition}`;
          if (trialIds.has(trialId)) {
            throw new Error(`schedule contains duplicate trial id ${trialId}`);
          }
          trialIds.add(trialId);
          trials.push({
            trialId,
            profileId,
            caseId,
            cell,
            repetition,
          });
        }
      }
    }
  }

  return trials;
}

/**
 * Validates that a list of scheduled trials strictly maintains sequential profile isolation.
 * No two trials from different profiles may be interleaved.
 */
export function assertSequentialProfileIsolation(
  trials: readonly LiveTrialScheduleItem[],
): void {
  const seenProfiles = new Set<string>();
  let currentProfile: string | null = null;

  for (const trial of trials) {
    if (trial.profileId !== currentProfile) {
      if (seenProfiles.has(trial.profileId)) {
        throw new Error(
          `Sequential profile isolation violated: profile "${trial.profileId}" reappeared after another profile. Profiles must execute in strict contiguous blocks.`,
        );
      }
      seenProfiles.add(trial.profileId);
      currentProfile = trial.profileId;
    }
  }
}
