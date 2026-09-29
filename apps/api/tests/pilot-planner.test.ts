import { describe, expect, it, vi } from "vitest";
import {
  PilotProposalValidationError, requestAccountedPilotProposal, type PilotAccountedPlanner,
} from "../src/pilot-planner.js";

const input = {
  runId: "11111111-1111-4111-8111-111111111111",
  principalId: "22222222-2222-4222-8222-222222222222",
  sourceKey: "source-test",
  sourceRevision: "a".repeat(64),
  context: {} as Parameters<PilotAccountedPlanner["propose"]>[0]["context"],
};

function fake(proposal: unknown, costMicros: number | null = 2): PilotAccountedPlanner {
  return {
    provider: "google", model: "fake-model", estimatedCostMicros: 5,
    async propose() {
      return { proposal, usage: { inputTokens: 2, outputTokens: 3 }, costMicros };
    },
  };
}

describe("accounted pilot adapter boundary", () => {
  it.each([
    { kind: "plan", tool: "trello.create_card" },
    { kind: "clarification", question: "Please clarify fixture-token" },
    { kind: "refusal", reason: "Cannot proceed fixture-token" },
  ])("separates a %s model proposal from adapter usage", async (proposal) => {
    const result = await requestAccountedPilotProposal(fake(proposal), input, 100);
    expect(result).toEqual({
      proposal, usage: { inputTokens: 2, outputTokens: 3 }, costMicros: 2,
    });
    expect(result).not.toHaveProperty("providerResponse");
  });

  it("rejects model write arguments while preserving trusted cost for settlement", async () => {
    const attempt = requestAccountedPilotProposal(fake({
      kind: "plan", tool: "trello.create_card", args: { boardId: "other" },
    }), input, 100);
    await expect(attempt).rejects.toBeInstanceOf(PilotProposalValidationError);
    await expect(attempt).rejects.toMatchObject({
      costMicros: 2, usage: { inputTokens: 2, outputTokens: 3 },
    });
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 1.5])(
    "rejects invalid adapter cost %s rather than inferring zero", async (cost) => {
      await expect(requestAccountedPilotProposal(fake({
        kind: "plan", tool: "trello.create_card",
      }, cost), input, 100)).rejects.toThrow();
    },
  );

  it("rejects invalid usage even when the proposal is valid", async () => {
    const planner: PilotAccountedPlanner = {
      ...fake({ kind: "plan", tool: "trello.create_card" }),
      async propose() {
        return { proposal: { kind: "plan", tool: "trello.create_card" },
          usage: { inputTokens: -3 }, costMicros: 2 };
      },
    };
    await expect(requestAccountedPilotProposal(planner, input, 100)).rejects.toThrow();
  });

  it("times out an adapter that ignores abort without accepting its late result", async () => {
    vi.useFakeTimers();
    try {
      let complete!: (value: Awaited<ReturnType<PilotAccountedPlanner["propose"]>>) => void;
      const planner: PilotAccountedPlanner = {
        ...fake({ kind: "plan", tool: "trello.create_card" }),
        propose: () => new Promise((resolve) => { complete = resolve; }),
      };
      const pending = requestAccountedPilotProposal(planner, input, 10);
      const assertion = expect(pending).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(10);
      await assertion;
      complete({ proposal: { kind: "plan", tool: "trello.create_card" },
        usage: null, costMicros: null });
      await Promise.resolve();
      await expect(pending).rejects.toThrow("timed out");
    } finally {
      vi.useRealTimers();
    }
  });
});
