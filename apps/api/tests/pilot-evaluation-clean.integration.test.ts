import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { freezeManifest } from "../src/pilot-evaluation/manifest.js";
import { sourceArtifactDigests } from "../src/pilot-evaluation/git-evidence.js";
import { runOfflineCampaign } from "../src/pilot-evaluation/coordinator.js";
import { buildOfflineReport, openReadonlyEvaluationStore } from "../src/pilot-evaluation/report.js";
import { syntheticBundle, syntheticManifest, syntheticOracle, withOfflineCampaign } from "./helpers/pilot-evaluation-fixture.js";

// Only this test is a positive UNMOCKED Git gate. Run in detached clean checkout.
describe.skipIf(process.env.PILOT_EVAL_CLEAN_CHECKOUT !== "1")("clean frozen Git provenance", () => {
  it("executes public campaign with real exact HEAD and clean source, then grades read-only", async () => {
    const repoRoot = process.cwd().replace(/[\\/]apps[\\/]api$/, "");
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
    const commit = git("rev-parse", "HEAD");
    expect(git("status", "--porcelain=v1", "-uall")).toBe("");
    const bundle = syntheticBundle();
    const frozen = syntheticManifest(bundle);
    const { manifestHash: _unused, artifacts, ...draft } = frozen;
    const manifest = freezeManifest({ ...draft, gitCommit: commit },
      { ...artifacts, ...sourceArtifactDigests(repoRoot) });
    await withOfflineCampaign(async ({ receipt }) => {
      const result = await runOfflineCampaign({ manifest, bundle, receipt, repoRoot });
      expect(result.state).toBe("completed");
      const readOnly = await openReadonlyEvaluationStore(receipt.reportUrl, receipt.identity);
      try {
        const report = await buildOfflineReport(readOnly, syntheticOracle());
        expect(report.verdict).toBe("OFFLINE_MEASUREMENT_CONTRACT_TESTED");
        expect(report.accounting.calls).toBe(2);
      } finally { await readOnly.close(); }
    }, bundle, manifest);
  }, 120_000);
});
