import { describe, expect, it, vi } from "vitest";
import { runOfflineCampaign } from "../src/pilot-evaluation/coordinator.js";
import { openEvaluationStore } from "../src/pilot-evaluation/provision.js";
import { openReadonlyEvaluationStore } from "../src/pilot-evaluation/report.js";
import { openGraderEvaluationStore } from "../src/pilot-evaluation/index.js";
import { syntheticBundle, withOfflineCampaign } from "./helpers/pilot-evaluation-fixture.js";

vi.mock("../src/pilot-evaluation/git-evidence.js", () => ({
  observeGitEvidence: () => ({ head: "a".repeat(40), clean: true,
    sourceDigests: { code: "a".repeat(64), projection: "b".repeat(64),
      prompt: "c".repeat(64), schema: "d".repeat(64), fakeScript: "1".repeat(64),
      rubric: "2".repeat(64) } }),
}));

describe("separate restricted sealed grader", () => {
  it("appends a regrade only for a frozen rubric and immutable seal, without producer/report grade rights", async () => {
    await withOfflineCampaign(async ({ receipt, admin }) => {
      const grader = await openGraderEvaluationStore(receipt.graderUrl, receipt.identity);
      const producer = await openEvaluationStore(receipt.runtimeUrl, receipt.identity);
      const report = await openReadonlyEvaluationStore(receipt.reportUrl, receipt.identity);
      try {
        const slot = receipt.manifest.slots[0]!.slotId;
        await expect(grader.appendGrade(slot, receipt.manifest.artifacts.rubric,
          'a'.repeat(64), 'pass', 'STRUCTURAL_MATCH')).rejects.toThrow();
        await runOfflineCampaign({ manifest: receipt.manifest, bundle: syntheticBundle(),
          receipt, repoRoot: process.cwd() });
        const seal = (await report.client`SELECT seal_hash FROM pilot_eval.seals WHERE slot_id=${slot}`)[0]?.seal_hash as string;
        await grader.appendGrade(slot, receipt.manifest.artifacts.rubric, seal, 'pass', 'STRUCTURAL_MATCH');
        await grader.appendGrade(slot, receipt.manifest.artifacts.rubric, seal, 'fail', 'STRUCTURAL_MISMATCH');
        const grades = await report.client`SELECT grade,reason FROM pilot_eval.grades WHERE slot_id=${slot} ORDER BY created_at`;
        expect(grades.map((entry) => entry.grade)).toEqual(['pass', 'fail']);
        await expect(grader.appendGrade(slot, 'a'.repeat(64), seal, 'pass', 'STRUCTURAL_MATCH')).rejects.toThrow();
        await expect(grader.appendGrade(slot, receipt.manifest.artifacts.rubric, 'a'.repeat(64),
          'pass', 'STRUCTURAL_MATCH')).rejects.toThrow();
        await expect(grader.client`INSERT INTO pilot_eval.grades(measurement_id,slot_id,rubric_hash,seal_hash,grade,reason)
          VALUES (${receipt.identity.measurementId},${slot},${receipt.manifest.artifacts.rubric},${seal},'pass','free text')`).rejects.toThrow();
        await expect(grader.client`UPDATE pilot_eval.grades SET grade='pass'`).rejects.toThrow();
        await expect(grader.client`INSERT INTO pilot_eval.events(measurement_id,seq,slot_id,event_type,duration_ms,payload,previous_hash,event_hash)
          VALUES (${receipt.identity.measurementId},99,${slot},'slot_intent',0,'{}',${seal},${seal})`).rejects.toThrow();
        await expect(producer.client`INSERT INTO pilot_eval.grades(measurement_id,slot_id,rubric_hash,seal_hash,grade,reason)
          VALUES (${receipt.identity.measurementId},${slot},${receipt.manifest.artifacts.rubric},${seal},'pass','STRUCTURAL_MATCH')`).rejects.toThrow();
        await expect(report.client`INSERT INTO pilot_eval.grades(measurement_id,slot_id,rubric_hash,seal_hash,grade,reason)
          VALUES (${receipt.identity.measurementId},${slot},${receipt.manifest.artifacts.rubric},${seal},'pass','STRUCTURAL_MATCH')`).rejects.toThrow();
        expect((await admin`SELECT count(*)::int AS n FROM pilot_eval.grades`)[0]?.n).toBe(2);
      } finally { await report.close(); await producer.close(); await grader.close(); }
    });
  }, 120_000);
});
