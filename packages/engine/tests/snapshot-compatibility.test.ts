import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { SnapshotSchema, hash } from "../src/snapshot.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));

describe("snapshot v1 compatibility", () => {
  it("parses and preserves the canonical hash of the protected TH-06 preview", () => {
    const observation = JSON.parse(
      readFileSync(
        path.join(root, "docs/engine-evidence/2026-09-13/controller-observations.json"),
        "utf8",
      ),
    );
    const preview = SnapshotSchema.parse(observation.b02.preview);
    expect(hash(preview)).toBe(observation.b02.run.approval.snapshot_hash);
  });
});
