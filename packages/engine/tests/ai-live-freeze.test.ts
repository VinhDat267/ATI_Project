import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createLiveFreeze,
  assertLiveFrozen,
  computeLiveFingerprints,
  hashLiveFreeze,
  buildLiveSourceManifest,
  buildLiveExecutionFingerprint,
} from "../src/ai/live-evaluation/freeze.js";
import {
  LiveRubricSchema,
  type FrozenLiveEvaluation,
} from "../src/ai/live-evaluation/contracts.js";

const root = resolve(fileURLToPath(new URL("../../../", import.meta.url)));

describe("ai-live-freeze", () => {
  it("enforces cross-field rubric approval invariants", () => {
    const proposed = {
      format: "ati-ai-live-rubric-v1",
      status: "PROPOSED_EXPLORATORY",
      version: "1.0.0",
      approvedBy: null,
      approvedAt: null,
      cases: {},
    };
    expect(() => LiveRubricSchema.parse(proposed)).not.toThrow();
    expect(() =>
      LiveRubricSchema.parse({
        ...proposed,
        status: "APPROVED_FROZEN",
      }),
    ).toThrow(/approvedBy/);
    expect(() =>
      LiveRubricSchema.parse({
        ...proposed,
        status: "APPROVED_FROZEN",
        approvedBy: "user:reviewer",
      }),
    ).toThrow(/approvedAt/);
    expect(() =>
      LiveRubricSchema.parse({
        ...proposed,
        status: "APPROVED_FROZEN",
        approvedBy: "user:reviewer",
        approvedAt: "2026-09-20T00:00:00.000Z",
      }),
    ).not.toThrow();
    expect(() =>
      LiveRubricSchema.parse({
        ...proposed,
        status: "APPROVED_FROZEN",
        approvedBy: "user:reviewer",
        approvedAt: "2026-09-20T00:00:00.000",
      }),
    ).toThrow(/approvedAt/);
  });
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

  it("compares the complete execution fingerprint, not only selected roles", async () => {
    const execution = {
      roleConfigs: { planning: { provider: "openai", model: "gpt-5.6-terra" } },
      providerCapabilities: { openai: { generationModels: ["gpt-5.6-terra"] } },
      priceCardHash: "1".repeat(64),
      budgetCapMicros: 100_000,
      approvalScopeHash: "2".repeat(64),
      activeIndex: {
        id: "idx-1",
        provenanceHash: "3".repeat(64),
        vectorHash: "4".repeat(64),
        policyHash: "5".repeat(64),
      },
      runtime: {
        nodeVersion: "v24.0.0",
        packageLockHash: "6".repeat(64),
      },
      git: { head: "abcdef1234567", statusDigest: "7".repeat(64) },
      sourceManifest: [
        { path: "packages/engine/src/index.ts", sha256: "8".repeat(64) },
      ],
    };
    const freeze = await createLiveFreeze({
      root,
      profileId: "openai-only",
      campaignId: "camp-execution-fingerprint",
      execution,
    });
    expect(() => assertLiveFrozen(freeze, freeze)).not.toThrow();

    const changedQueryExpansion: FrozenLiveEvaluation = {
      ...freeze,
      profile: {
        ...freeze.profile,
        queryExpansion: {
          ...freeze.profile.queryExpansion,
          maxOutputTokens: freeze.profile.queryExpansion.maxOutputTokens + 1,
        },
      },
    };
    expect(() => assertLiveFrozen(freeze, changedQueryExpansion)).toThrow(
      /Freeze semantic execution mismatch/,
    );

    const changedIndex: FrozenLiveEvaluation = {
      ...freeze,
      execution: {
        ...freeze.execution!,
        activeIndex: {
          ...freeze.execution!.activeIndex,
          vectorHash: "9".repeat(64),
        },
      },
    };
    expect(() => assertLiveFrozen(freeze, changedIndex)).toThrow(
      /Freeze semantic execution mismatch/,
    );
    expect(hashLiveFreeze(changedIndex)).not.toBe(hashLiveFreeze(freeze));
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
    ).rejects.toThrow(
      /A coding agent cannot approve its own generated holdout/,
    );
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
  it("builds a complete execution snapshot and source manifest", async () => {
    const manifest = await buildLiveSourceManifest(root);
    expect(manifest.length).toBeGreaterThan(10);
    expect(manifest[0]).toHaveProperty("path");
    expect(manifest[0]).toHaveProperty("sha256");

    const execution = await buildLiveExecutionFingerprint({
      root,
      profile: {
        id: "openai-only",
        description: "OpenAI only",
        planning: { provider: "openai", model: "gpt-5.6-terra", apiMode: "responses", maxOutputTokens: 4096 },
        queryExpansion: { provider: "openai", model: "gpt-5.6-terra", apiMode: "responses", maxOutputTokens: 1024 },
        embedding: {
          provider: "openai",
          model: "text-embedding-3-small",
          apiMode: "embeddings",
          dimensions: 1536,
          preprocessingVersion: "v1",
          documentTask: "doc",
          queryTask: "query",
          normalize: false,
        },
      },
      campaignId: "test-camp",
      budgetCapMicros: 50_000,
      priceCard: {
        version: "price-v1",
        entries: {
          "openai:responses:planning:gpt-5.6-terra": { inputMicrosPerMillion: 1_000_000, outputMicrosPerMillion: 2_000_000 },
        },
      },
      activeIndex: {
        id: "idx-real",
        provenanceHash: "a".repeat(64),
        vectorHash: "b".repeat(64),
        policyHash: "c".repeat(64),
      },
    });

    expect(execution.priceCardHash).toMatch(/^[a-f0-9]{64}$/);
    expect(execution.budgetCapMicros).toBe(50_000);
    expect(execution.activeIndex.id).toBe("idx-real");
    expect(execution.sourceManifest.length).toBe(manifest.length);
  });

});
