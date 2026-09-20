import { describe, it, expect } from "vitest";
import {
  scheduleLiveTrials,
  assertSequentialProfileIsolation,
  LIVE_EVALUATION_CELLS,
} from "../src/ai/live-evaluation/schedule.js";

describe("ai-live-schedule", () => {
  const devCases = ["b01", "b02", "b03", "b04", "b05", "b06"];
  const legacyCases = ["b07", "b08", "b09", "b10"];

  it("produces exact trial counts conforming to the live evaluation contract", () => {
    // 1 profile on 6 dev cases = 6 × 7 cells × 3 repetitions = 126
    const devTrials = scheduleLiveTrials(["openai-only"], devCases);
    expect(devTrials).toHaveLength(126);

    // 1 profile on 4 legacy regression cases = 4 × 7 cells × 3 repetitions = 84
    const legacyTrials = scheduleLiveTrials(["google-only"], legacyCases);
    expect(legacyTrials).toHaveLength(84);

    // 2 profiles on 6 dev cases = 2 × 6 × 7 × 3 = 252
    const multiProfileTrials = scheduleLiveTrials(
      ["openai-only", "google-only"],
      devCases,
    );
    expect(multiProfileTrials).toHaveLength(252);
  });


  it("produces exact trial counts for smoke phase (9 trials)", () => {
    const smokeCases = ["b01", "b05", "b06"];
    const smokeCells = [
      { variant: "all_tools" as const, topK: 10 as const },
      { variant: "semantic" as const, topK: 10 as const },
      { variant: "semantic_qe" as const, topK: 10 as const },
    ];
    const smokeTrials = scheduleLiveTrials(["openai-only"], smokeCases, {
      cells: smokeCells,
      repetitions: 1,
    });
    expect(smokeTrials).toHaveLength(9);
  });

  it("contains the standard 7 evaluation cells", () => {
    expect(LIVE_EVALUATION_CELLS).toEqual([
      { variant: "all_tools", topK: 10 },
      { variant: "semantic", topK: 3 },
      { variant: "semantic", topK: 5 },
      { variant: "semantic", topK: 10 },
      { variant: "semantic_qe", topK: 3 },
      { variant: "semantic_qe", topK: 5 },
      { variant: "semantic_qe", topK: 10 },
    ]);
  });

  it("strictly groups trials into contiguous sequential profile blocks", () => {
    const trials = scheduleLiveTrials(["openai-only", "google-only"], devCases);

    // First 126 trials must be openai-only
    const firstBlock = trials.slice(0, 126);
    expect(firstBlock.every((t) => t.profileId === "openai-only")).toBe(true);

    // Next 126 trials must be google-only
    const secondBlock = trials.slice(126, 252);
    expect(secondBlock.every((t) => t.profileId === "google-only")).toBe(true);

    // Passes sequential profile isolation assertion
    expect(() => assertSequentialProfileIsolation(trials)).not.toThrow();
  });

  it("detects and rejects interleaved profile blocks", () => {
    const validTrials = scheduleLiveTrials(
      ["openai-only", "google-only"],
      ["b01"],
    );

    // Intentionally interleave: [openai, google, openai]
    const interleaved = [
      validTrials[0]!,
      validTrials.find((t) => t.profileId === "google-only")!,
      validTrials[1]!,
    ];

    expect(() => assertSequentialProfileIsolation(interleaved)).toThrow(
      /Sequential profile isolation violated: profile "openai-only" reappeared/,
    );
  });

  it("generates deterministic and unique trial IDs", () => {
    const trials = scheduleLiveTrials(["profile-a"], ["b01"]);
    expect(trials).toHaveLength(21); // 1 case × 7 cells × 3 repetitions

    const ids = new Set(trials.map((t) => t.trialId));
    expect(ids.size).toBe(21);

    expect(trials[0]?.trialId).toBe("profile-a:b01:all_tools:k10:r1");
    expect(trials[1]?.trialId).toBe("profile-a:b01:all_tools:k10:r2");
    expect(trials[2]?.trialId).toBe("profile-a:b01:all_tools:k10:r3");
    expect(trials[3]?.trialId).toBe("profile-a:b01:semantic:k3:r1");
  });

  it("rejects invalid all_tools configuration if topK is not 10", () => {
    expect(() =>
      scheduleLiveTrials(["p1"], ["b01"], {
        cells: [{ variant: "all_tools", topK: 5 as 10 }],
      }),
    ).toThrow(/all_tools variant requires topK 10/);
  });

  it("returns empty schedule when profiles or cases are empty", () => {
    expect(scheduleLiveTrials([], devCases)).toEqual([]);
    expect(scheduleLiveTrials(["p1"], [])).toEqual([]);
  });

  it("rejects duplicate profiles, cases, cells, and derived trial IDs", () => {
    expect(() => scheduleLiveTrials(["p1", "p1"], ["b01"])).toThrow(
      /duplicate profile/i,
    );
    expect(() => scheduleLiveTrials(["p1"], ["b01", "b01"])).toThrow(
      /duplicate case/i,
    );
    expect(() =>
      scheduleLiveTrials(["p1"], ["b01"], {
        repetitions: 1,
        cells: [
          { variant: "semantic", topK: 3 },
          { variant: "semantic", topK: 3 },
        ],
      }),
    ).toThrow(/duplicate cell|duplicate trial/i);
  });
});
