import { afterEach, describe, expect, it } from "vitest";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLiveCampaign } from "../src/ai/live-evaluation/campaign.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function root(): Promise<string> {
  const value = join(
    tmpdir(),
    `ati-live-campaign-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
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
    const replay = await first.journal.replay();
    expect(replay.events[0]?.event).toBe("run_started");
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

  it("does not destroy an existing run when a duplicate run id is opened", async () => {
    const outputRoot = await root();
    const options = {
      outputRoot,
      campaignId: "campaign-duplicate",
      runId: "run-1",
      profileId: "openai-only",
      phase: "smoke",
      budgetCapMicros: 100,
    } as const;
    const first = await openLiveCampaign(options);
    await first.journal.append({
      event: "trial_started",
      timestamp: new Date().toISOString(),
      trialId: "trial-1",
      payload: { marker: "retain-me" },
    });
    const journalPath = join(first.runDirectory, "journal.jsonl");
    await first.close();
    const before = await readFile(journalPath, "utf8");

    await expect(openLiveCampaign(options)).rejects.toThrow();

    expect(await readFile(journalPath, "utf8")).toBe(before);
  });

  it("blocks a campaign when a previously registered run journal is missing", async () => {
    const outputRoot = await root();
    const first = await openLiveCampaign({
      outputRoot,
      campaignId: "campaign-missing-journal",
      runId: "run-1",
      profileId: "openai-only",
      phase: "smoke",
      budgetCapMicros: 100,
    });
    const runDirectory = first.runDirectory;
    await first.close();
    await rm(join(runDirectory, "journal.jsonl"));

    await expect(
      openLiveCampaign({
        outputRoot,
        campaignId: "campaign-missing-journal",
        runId: "run-2",
        profileId: "openai-only",
        phase: "dev",
        budgetCapMicros: 100,
      }),
    ).rejects.toThrow(/cannot verify prior campaign run|missing/i);
  });

  it("blocks a campaign when a prior journal ends with a truncated event", async () => {
    const outputRoot = await root();
    const first = await openLiveCampaign({
      outputRoot,
      campaignId: "campaign-truncated-journal",
      runId: "run-1",
      profileId: "openai-only",
      phase: "smoke",
      budgetCapMicros: 100,
    });
    const journalPath = join(first.runDirectory, "journal.jsonl");
    await first.close();
    const before = await readFile(journalPath, "utf8");
    const { appendFile } = await import("node:fs/promises");
    await appendFile(journalPath, '{"version":1,"sequence":2', "utf8");

    await expect(
      openLiveCampaign({
        outputRoot,
        campaignId: "campaign-truncated-journal",
        runId: "run-2",
        profileId: "openai-only",
        phase: "dev",
        budgetCapMicros: 100,
      }),
    ).rejects.toThrow(/truncated|incomplete/i);
    expect((await readFile(journalPath, "utf8")).startsWith(before)).toBe(true);
  });
});
