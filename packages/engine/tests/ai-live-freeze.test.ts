import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createLiveFreeze,
  assertLiveFrozen,
  computeLiveFingerprints,
} from "../src/ai/live-evaluation/freeze.js";
import type { FrozenLiveEvaluation } from "../src/ai/live-evaluation/contracts.js";

const root = resolve(fileURLToPath(new URL("../../../", import.meta.url)));

describe("ai-live-freeze", () => {
  it("creates a tamper-evident live freeze with all required fingerprints", async () => {
    const freeze = await createLiveFreeze({
      root,
      profileId: "openai-only",
      campaignId: "camp-2026-test",
      createdAt: "2026-09-19T00:00:00.000Z",
    });

    expect(freeze.format).toBe("ati-ai-live-freeze-v1");
    expect(freeze.profileId).toBe("openai-only");
    expect(freeze.campaignId).toBe("camp-2026-test");
    expect(freeze.profile.planning.provider).toBe("openai");
    expect(freeze.profile.embedding.dimensions).toBe(1536);

    expect(freeze.fingerprints.dataset).toMatch(/^[a-f0-9]{64}$/);
    expect(freeze.fingerprints.rubric).toMatch(/^[a-f0-9]{64}$/);
    expect(freeze.fingerprints.evaluator).toMatch(/^[a-f0-9]{64}$/);
    expect(freeze.fingerprints.lockfile).toMatch(/^[a-f0-9]{64}$/);
  });

  it("strictly enforces zero network calls during freeze creation", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => {
      throw new Error("NETWORK_CALL_FORBIDDEN: freeze must be 100% offline");
    };

    try {
      const freeze = await createLiveFreeze({
        root,
        profileId: "google-only",
        campaignId: "camp-offline-verify",
      });
      expect(freeze.profile.planning.provider).toBe("google");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("passes self-verification with identical freeze", async () => {
    const freeze = await createLiveFreeze({
      root,
      profileId: "openai-only",
      campaignId: "camp-verify",
    });

    expect(() => assertLiveFrozen(freeze, freeze)).not.toThrow();
  });

  it("detects tampering when any fingerprint drifts", async () => {
    const freeze = await createLiveFreeze({
      root,
      profileId: "openai-only",
      campaignId: "camp-tamper",
    });

    const tampered: FrozenLiveEvaluation = {
      ...freeze,
      fingerprints: {
        ...freeze.fingerprints,
        rubric: "0".repeat(64), // tampered rubric hash
      },
    };

    expect(() => assertLiveFrozen(freeze, tampered)).toThrow(
      /Freeze fingerprint mismatch on "rubric"/,
    );
  });

  it("detects and rejects model and provider changes", async () => {
    const freeze = await createLiveFreeze({
      root,
      profileId: "openai-only",
      campaignId: "camp-model-drift",
    });

    const modifiedModel: FrozenLiveEvaluation = {
      ...freeze,
      profile: {
        ...freeze.profile,
        planning: {
          ...freeze.profile.planning,
          model: "gpt-4o-mini", // altered model
        },
      },
    };

    expect(() => assertLiveFrozen(freeze, modifiedModel)).toThrow(
      /Freeze planning model mismatch/,
    );
  });

  it("rejects non-human approver in sealed holdout bundle", async () => {
    await expect(
      createLiveFreeze({
        root,
        profileId: "openai-only",
        campaignId: "camp-holdout-invalid",
        sealedHoldoutApproval: {
          format: "ati-ai-live-sealed-holdout-v1",
          approvedBy: "claude-eval-agent", // forbidden agent approver!
          approvedAt: "2026-09-19T00:00:00.000Z",
          exposureHistory: "previously_unseen_fresh_holdout",
          casesHash: "a".repeat(64),
          rubricHash: "b".repeat(64),
          budgetCapMicros: 1_000_000,
        },
      }),
    ).rejects.toThrow(/A coding agent cannot approve its own generated holdout/);
  });

  it("accepts valid human user approver in sealed holdout bundle", async () => {
    const freeze = await createLiveFreeze({
      root,
      profileId: "openai-only",
      campaignId: "camp-holdout-valid",
      sealedHoldoutApproval: {
        format: "ati-ai-live-sealed-holdout-v1",
        approvedBy: "user:vinhdat",
        approvedAt: "2026-09-19T00:00:00.000Z",
        exposureHistory: "previously_unseen_fresh_holdout",
        casesHash: "a".repeat(64),
        rubricHash: "b".repeat(64),
        budgetCapMicros: 500_000,
      },
    });

    expect(freeze.sealedHoldoutApproval?.approvedBy).toBe("user:vinhdat");
  });

  it("rejects unknown profileId", async () => {
    await expect(
      createLiveFreeze({
        root,
        profileId: "non-existent-profile",
        campaignId: "camp-fail",
      }),
    ).rejects.toThrow(/Profile "non-existent-profile" not found in config/);
  });
});
