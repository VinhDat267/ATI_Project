import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FixtureBundleSchema, FrozenManifestSchema,
  freezeManifest, assertFrozen, assertCleanProvenance, canonicalHash, parseBoundedJson,
} from "../src/pilot-evaluation/manifest.js";
import type { ManifestDraft, SlotDescriptor } from "../src/pilot-evaluation/contracts.js";

const digest = (letter: string) => letter.repeat(64);
const principals: ManifestDraft["principals"] = [
  { alias: "alpha", id: randomUUID(), maxCalls: 2, limitMicros: 100 },
  { alias: "beta", id: randomUUID(), maxCalls: 2, limitMicros: 100 },
];
const artifacts = {
  code: digest("a"), projection: digest("b"), prompt: digest("c"),
  schema: digest("d"), fixtures: digest("e"), oracle: digest("f"),
  fakeScript: digest("1"), rubric: digest("2"),
};
const slot: SlotDescriptor = {
  slotId: "opaque-1", ordinal: 0, inputHash: digest("3"), language: "en",
  principalAlias: "alpha", declaredEligibility: "eligible", scriptId: "plan",
  fixture: { spreadsheetId: "sheet", tabId: "requests", boardId: "board", listId: "todo", requestId: "REQ-1" },
};
const draft = (): ManifestDraft => ({
  format: "pilot-advisory-offline-v1", measurementId: randomUUID(),
  gitCommit: "a".repeat(40), executionMode: "offline_fake", outputContract: "pilot-advisory-v1",
  catalogMode: "fixed", costEvidence: "SIMULATED_NOT_BILLED",
  schemaVersion: "pilot-eval-1", rubricVersion: "structural-1", fakeScriptVersion: "builtin-1",
  provider: "google", model: "offline-fixture-plan", estimatedCostMicros: 10,
  timeoutMs: 1000, principals, slots: [slot],
});

describe("offline manifest freeze", () => {
  it("rejects provider transports, nonfake modes and non-data or excess bytes", () => {
    expect(() => FrozenManifestSchema.parse({ ...draft(), executionMode: "live" })).toThrow();
    expect(() => FrozenManifestSchema.parse({ ...draft(), endpoint: "https://example.invalid" })).toThrow();
    expect(() => FrozenManifestSchema.parse({ ...draft(), provider: "anthropic" })).toThrow();
    expect(() => FrozenManifestSchema.parse({ ...draft(), estimatedCostMicros: Number.MAX_SAFE_INTEGER + 1 })).toThrow();
    expect(() => parseBoundedJson(Buffer.alloc(1_048_577, 32))).toThrow();
    expect(() => parseBoundedJson(Buffer.from('{"x":1,"x":2}'))).toThrow();
    expect(() => parseBoundedJson(Buffer.from('{"x":1,"fn":42}'), 8)).toThrow();
  });

  it("rejects duplicate principals, slot IDs and ordinals", () => {
    expect(() => freezeManifest({ ...draft(), principals: [principals[0], principals[0]] }, artifacts)).toThrow();
    expect(() => freezeManifest({ ...draft(), slots: [slot, { ...slot, ordinal: 1 }] }, artifacts)).toThrow();
    expect(() => freezeManifest({ ...draft(), slots: [slot, { ...slot, slotId: "different" }] }, artifacts)).toThrow();
    expect(() => freezeManifest({ ...draft(), slots: [{ ...slot, principalAlias: "foreign" }] }, artifacts)).toThrow();
  });

  it("rejects unmatched fixture and script hashes before invocation", () => {
    expect(() => FixtureBundleSchema.parse({ slots: [{ slotId: slot.slotId, inputHash: digest("4"), scriptId: "plan" }] })).not.toThrow();
    const frozen = freezeManifest(draft(), artifacts);
    expect(() => assertFrozen(frozen, { ...artifacts, fakeScript: digest("0") })).toThrow();
    expect(() => assertFrozen({ ...frozen, slots: [{ ...slot, inputHash: digest("4") }] }, artifacts)).toThrow();
  });

  it("requires actual exact Git HEAD and no dirty tracked source", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ati-offline-git-"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
    try {
      git("init", "-q");
      writeFileSync(path.join(root, "source.txt"), "initial\n");
      git("-c", "core.autocrlf=false", "add", "--", "source.txt");
      git("-c", "user.name=ATI Fixture", "-c", "user.email=ati@local.invalid", "commit", "-qm", "fixture");
      const manifest = freezeManifest({ ...draft(), gitCommit: git("rev-parse", "HEAD") }, artifacts);
      expect(() => assertCleanProvenance(manifest, root)).not.toThrow();
      expect(() => assertCleanProvenance({ ...manifest, gitCommit: "a".repeat(40) }, root)).toThrow();
      appendFileSync(path.join(root, "source.txt"), "changed\n");
      expect(() => assertCleanProvenance(manifest, root)).toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("uses canonical object order but preserves array order and every cap/rubric/code digest", () => {
    expect(canonicalHash({ b: 2, a: { z: 1, x: 2 } })).toBe(canonicalHash({ a: { x: 2, z: 1 }, b: 2 }));
    expect(canonicalHash([1, 2])).not.toBe(canonicalHash([2, 1]));
    const frozen = freezeManifest(draft(), artifacts);
    expect(() => assertFrozen(frozen, artifacts)).not.toThrow();
    expect(() => assertFrozen({ ...frozen, timeoutMs: 2000 }, artifacts)).toThrow();
    expect(() => assertFrozen({ ...frozen, rubricVersion: "changed" }, artifacts)).toThrow();
    expect(() => assertFrozen({ ...frozen, gitCommit: "9".repeat(40) }, artifacts)).toThrow();
    expect(() => assertFrozen({ ...frozen, principals: [{ ...principals[0], limitMicros: 101 }, principals[1]] }, artifacts)).toThrow();
  });
});
