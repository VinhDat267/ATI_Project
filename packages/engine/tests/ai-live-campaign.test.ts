import { afterEach, describe, expect, it } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLiveCampaign } from "../src/ai/live-evaluation/campaign.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function root(): Promise<string> {
  const value = join(tmpdir(), `ati-live-campaign-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(value, { recursive: true });
  roots.push(value);
  return value;
}

describe("ai-live campaign coordinator", () => {
  it("prevents two owners and preserves the campaign budget across runs", async () => {
    const outputRoot = await root();
    const first = await openLiveCampaign({
      outputRoot,
      campaignId: "campaign-1",
      runId: "run-1",
      profileId: "openai-only",
      phase: "smoke",
      budgetCapMicros: 100,
    });

    await expect(
      openLiveCampaign({
        outputRoot,
        campaignId: "campaign-1",
        runId: "run-2",
        profileId: "openai-only",
        phase: "dev",
        budgetCapMicros: 100,
      }),
    ).rejects.toThrow(/already owned/i);

    await first.ledger.reserve({
      campaignId: "campaign-1",
      runId: "run-1",
      profileId: "openai-only",
      trialId: "trial-1",
      provider: "openai",
      purpose: "planning",
      model: "model-1",
      requestHash: "request-1",
      estimatedCostMicros: 80,
    });
    await first.close();

    const second = await openLiveCampaign({
      outputRoot,
      campaignId: "campaign-1",
      runId: "run-2",
      profileId: "openai-only",
      phase: "dev",
      budgetCapMicros: 100,
    });
    await expect(
      second.ledger.reserve({
        campaignId: "campaign-1",
        runId: "run-2",
        profileId: "openai-only",
        trialId: "trial-2",
        provider: "openai",
        purpose: "planning",
        model: "model-1",
        requestHash: "request-2",
        estimatedCostMicros: 30,
      }),
    ).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
    await second.close();
  });
});
