import { expect, it } from "vitest";
import { stepViews } from "../../src/core/steps.js";
import { createWorld, WORLD_IDS } from "../../src/fixtures/world.js";

const world = createWorld(new Date("2026-09-18T07:22:00Z"));
const find = (id: string) => world.runs.find((r) => r.detail.run_id === id)!;

it("marks the unconfirmed write unknown and later steps not run", () => {
  const run = find(WORLD_IDS.reconcile);
  expect(stepViews(run.detail, run.trace).map((s) => s.state)).toEqual([
    "done",
    "unknown",
    "not_run",
  ]);
});

it("shows writes awaiting approval after the dry-run read", () => {
  const run = find(WORLD_IDS.approval);
  expect(stepViews(run.detail, run.trace).map((s) => s.state)).toEqual([
    "done",
    "awaiting_approval",
    "awaiting_approval",
  ]);
});

it("keeps a live step running and a known failure failed", () => {
  const running = find(WORLD_IDS.running);
  expect(stepViews(running.detail, running.trace).map((s) => s.state)).toEqual(["done", "running"]);
  const failed = find(WORLD_IDS.failed);
  expect(stepViews(failed.detail, failed.trace).map((s) => s.state)).toEqual(["done", "failed"]);
});
