import { copyFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("../../../../", import.meta.url)));

// Tests must not depend on a developer's ignored AGENTS.md. The production
// freeze still hashes AGENTS.md from its explicitly supplied root.
export const testPolicy = "# AI evaluator test policy\nOnly deterministic offline fixture inputs are permitted.\n";

export function createAiFreezeTestRoot(): { root: string; close(): void } {
  const root = mkdtempSync(join(tmpdir(), "ati-ai-freeze-test-"));
  try {
    for (const relativePath of [
      "packages/engine/src", "packages/db/src", "packages/dsl/src", "testdata",
    ]) {
      const target = join(root, relativePath);
      mkdirSync(dirname(target), { recursive: true });
      cpSync(join(projectRoot, relativePath), target, { recursive: true });
    }
    for (const relativePath of ["package-lock.json", "docs/BASELINE.md"]) {
      const target = join(root, relativePath);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(projectRoot, relativePath), target);
    }
    writeFileSync(join(root, "AGENTS.md"), testPolicy, { flag: "wx" });
    return { root, close: () => rmSync(root, { recursive: true, force: true }) };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}
