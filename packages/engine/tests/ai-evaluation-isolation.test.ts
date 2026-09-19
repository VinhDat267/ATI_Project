import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const root = new URL("../../../", import.meta.url);
const evaluatorSources = [
  "packages/engine/src/ai/evaluation/cli.ts",
  "packages/engine/src/ai/evaluation/contracts.ts",
  "packages/engine/src/ai/evaluation/dataset.ts",
  "packages/engine/src/ai/evaluation/offline-fixtures.ts",
  "packages/engine/src/ai/evaluation/report.ts",
  "packages/engine/src/ai/evaluation/runner.ts",
  "packages/engine/src/ai/evaluation/scorer.ts",
] as const;

it("keeps the offline evaluator structurally isolated from network, DB, gateway, and child-process APIs", () => {
  const source = evaluatorSources
    .map((path) => readFileSync(new URL(path, root), "utf8"))
    .join("\n");

  expect(source).not.toMatch(/from ["']node:(?:child_process|http|https|net|tls|dgram)["']/);
  expect(source).not.toMatch(/from ["']@wap\/db["']/);
  expect(source).not.toMatch(/from ["'][^"']*gateway[^"']*["']/i);
  expect(source).not.toMatch(/\bfetch\s*\(|\bWebSocket\b/);
});
