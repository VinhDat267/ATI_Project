import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { OFFLINE_USER_PROMPT, type ArtifactHashes } from "./contracts.js";

// Fixed source paths, never artifact-supplied paths or dynamic imports.
export const FROZEN_SOURCE_FILES = [
  "apps/api/src/pilot-evaluation/accounting.ts",
  "apps/api/src/pilot-evaluation/contracts.ts",
  "apps/api/src/pilot-evaluation/coordinator.ts",
  "apps/api/src/pilot-evaluation/fake-adapter.ts",
  "apps/api/src/pilot-evaluation/git-evidence.ts",
  "apps/api/src/pilot-evaluation/index.ts",
  "apps/api/src/pilot-evaluation/manifest.ts",
  "apps/api/src/pilot-evaluation/observer.ts",
  "apps/api/src/pilot-evaluation/provision.ts",
  "apps/api/src/pilot-evaluation/report.ts",
  "apps/api/src/pilot-evaluation/schema.ts",
  "apps/api/src/pilot-evaluation/store.ts",
  "packages/engine/src/pilot/planner-context.ts",
] as const;

type SourceDigests = Pick<ArtifactHashes, "code" | "projection" | "prompt" | "schema" | "fakeScript" | "rubric">;

/** Fixed, reviewed source mapping. Fixture/oracle hashes are checked at their separate data boundaries. */
export function sourceArtifactDigests(cwd: string): SourceDigests {
  const read = (relative: string) => readFileSync(path.join(cwd, relative));
  const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
  const codeHash = createHash("sha256");
  for (const relative of FROZEN_SOURCE_FILES) {
    codeHash.update(relative).update("\0").update(read(relative)).update("\0");
  }
  return {
    code: codeHash.digest("hex"),
    projection: sha(read("packages/engine/src/pilot/planner-context.ts")),
    prompt: sha(OFFLINE_USER_PROMPT),
    schema: sha(read("apps/api/src/pilot-evaluation/schema.ts")),
    fakeScript: sha(read("apps/api/src/pilot-evaluation/fake-adapter.ts")),
    rubric: sha(read("apps/api/src/pilot-evaluation/report.ts")),
  };
}

/** Reads actual Git and fixed source bytes. Synthetic tests substitute only this observation. */
export function observeGitEvidence(cwd: string): {
  head: string; clean: boolean; sourceDigests: SourceDigests;
} {
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  return { head: git("rev-parse", "HEAD"), clean: git("status", "--porcelain=v1", "-uall") === "",
    sourceDigests: sourceArtifactDigests(cwd) };
}
