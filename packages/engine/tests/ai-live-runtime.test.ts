import { describe, expect, it, vi } from "vitest";
import { createLiveEvaluationRuntime } from "../src/ai/live-evaluation/runtime.js";
import type { ProviderCallLedger } from "../src/ai/providers/registry.js";

describe("ai-live runtime lifecycle", () => {
  it("executes probe/index through owned boundaries and closes once", async () => {
    const close = vi.fn(async () => undefined);
    const probe = vi.fn(async () => ({
      calls: [
        {
          role: "planning",
          provider: "openai",
          model: "gpt-5.6-terra",
          requestId: "probe-1",
        },
      ],
    }));
    const index = vi.fn(async () => ({
      index: {
        id: "index-1",
        provenanceHash: "a".repeat(64),
        vectorHash: "b".repeat(64),
        policyHash: "c".repeat(64),
      },
      rowCount: 1,
    }));
    const runtime = createLiveEvaluationRuntime({ probe, index, close });

    await expect(
      runtime.probe({
        campaignId: "camp-1",
        profileId: "openai-only",
        phase: "probe",
      }),
    ).resolves.toMatchObject({ calls: [{ requestId: "probe-1" }] });
    await expect(
      runtime.index({
        campaignId: "camp-1",
        profileId: "openai-only",
        phase: "index",
      }),
    ).resolves.toMatchObject({ rowCount: 1 });
    await runtime.close();
    await runtime.close();
    expect(probe).toHaveBeenCalledTimes(1);
    expect(index).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("rejects work after close so a run cannot use released database/transport state", async () => {
    const runtime = createLiveEvaluationRuntime({
      probe: async () => ({ calls: [] }),
      index: async () => ({
        index: {
          id: "index-1",
          provenanceHash: "a".repeat(64),
          vectorHash: "b".repeat(64),
          policyHash: "c".repeat(64),
        },
        rowCount: 0,
      }),
    });
    await runtime.close();
    await expect(
      runtime.probe({
        campaignId: "camp-1",
        profileId: "openai-only",
        phase: "probe",
      }),
    ).rejects.toThrow(/closed/i);
  });

  it("passes the campaign ledger into the session factory", async () => {
    const ledger: ProviderCallLedger = {
      reserve: vi.fn(async () => "call-1"),
      settle: vi.fn(async () => undefined),
    };
    const createSession = vi.fn(async () => ({
      model: { complete: vi.fn() },
      retriever: { retrieve: vi.fn() },
    }));
    const runtime = createLiveEvaluationRuntime({
      probe: async () => ({
        calls: [
          { role: "planning", provider: "openai", model: "model-1" },
        ],
      }),
      index: async () => ({
        index: {
          id: "index-1",
          provenanceHash: "a".repeat(64),
          vectorHash: "b".repeat(64),
          policyHash: "c".repeat(64),
        },
        rowCount: 1,
      }),
      createSession,
    });

    await runtime.createSession(
      {
        campaignId: "camp-1",
        runId: "run-1",
        profileId: "openai-only",
        trialId: "trial-1",
      },
      ledger,
    );

    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({ trialId: "trial-1" }),
      ledger,
    );
  });
});
