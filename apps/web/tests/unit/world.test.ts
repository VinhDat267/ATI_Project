import { describe, expect, it } from "vitest";
import {
  ReconciliationSchema,
  RunDetailSchema,
  RunStatusSchema,
  TraceSchema,
} from "@wap/dsl/browser";
import { createWorld, WORLD_IDS } from "../../src/fixtures/world.js";
import { createFixtureTransport } from "../../src/core/fixtures.js";
import { recoveryFor } from "../../src/core/recovery.js";
import { summarizeAction } from "../../src/core/writes.js";

const signal = (): AbortSignal => new AbortController().signal;

describe("fixture world", () => {
  const world = createWorld(new Date("2026-09-18T07:22:00Z"));

  it("parses every run with the real schemas and unique ids", () => {
    for (const run of world.runs) {
      expect(() => RunDetailSchema.parse(run.detail)).not.toThrow();
      expect(() => TraceSchema.parse(run.trace)).not.toThrow();
      if (run.reconciliation) {
        expect(() => ReconciliationSchema.parse(run.reconciliation)).not.toThrow();
      }
      expect(run.detail.last_seq).toBe(run.events.length);
    }
    expect(new Set(world.runs.map((r) => r.detail.run_id)).size).toBe(
      world.runs.length,
    );
    expect(Object.values(WORLD_IDS)).toHaveLength(world.runs.length);
  });

  it("covers the canvas states, newest first", () => {
    const statuses = new Set(world.runs.map((r) => r.detail.status));
    for (const status of [
      "awaiting_approval",
      "reconciliation_required",
      "running",
      "planning",
      "succeeded",
      "failed",
      "expired",
      "needs_input",
      "refused",
      "rejected",
    ] as const) {
      expect(statuses.has(RunStatusSchema.parse(status))).toBe(true);
    }
    const created = world.runs.map((r) => r.detail.created_at ?? "");
    expect([...created].sort().reverse()).toEqual(created);
  });

  it("does not claim #nhom-ati is missing on the failed run", () => {
    const failed = world.runs.find((r) => r.detail.run_id === WORLD_IDS.failed);
    expect(failed?.failure?.message).toContain("#thong-bao-cu");
    expect(JSON.stringify(failed)).not.toContain("#nhom-ati");
  });

  it("asks about the four week-37 rows on the not_observed run", () => {
    const run = world.runs.find((r) => r.detail.run_id === WORLD_IDS.reconcile)!;
    const pending = run.detail.approval!.actions
      .filter((action) => action.tool === "append_sheet_rows")
      .map((action) => summarizeAction(action));
    const plan = recoveryFor(run.detail, {
      receipts: run.reconciliation!.operations.map((op) => op.receipt),
      pendingWrites: pending,
    });
    expect(plan.kind === "question" && plan.prompt).toBe(
      "Trên bảng “Báo cáo tuần” đã có 4 dòng đã gửi chưa?",
    );
  });
});

describe("fixture transport", () => {
  it("serves detail and reconciliation per run and records calls", async () => {
    const transport = createFixtureTransport();
    const detail = await transport.detail(WORLD_IDS.reconcile, signal());
    expect(detail.status).toBe("reconciliation_required");
    const rec = await transport.reconciliation(WORLD_IDS.reconcile, signal());
    expect(rec.operations[0]?.receipt).toBe("not_observed");
    expect(transport.calls.at(-1)).toEqual({
      method: "GET",
      path: `/runs/${WORLD_IDS.reconcile}/reconciliation`,
    });
    await expect(transport.detail("missing", signal())).rejects.toThrow(
      "Synthetic run not found",
    );
  });

  it("approves only the exact pending snapshot", async () => {
    const transport = createFixtureTransport();
    const detail = await transport.detail(WORLD_IDS.approval, signal());
    const approval = detail.approval!;
    await expect(
      transport.decide(
        WORLD_IDS.approval,
        {
          approval_id: approval.id,
          workflow_version_id: approval.workflow_version_id,
          snapshot_hash: "b".repeat(64),
          decision: "approved",
        },
        signal(),
      ),
    ).rejects.toThrow("conflict");
    const decided = await transport.decide(
      WORLD_IDS.approval,
      {
        approval_id: approval.id,
        workflow_version_id: approval.workflow_version_id,
        snapshot_hash: approval.snapshot_hash,
        decision: "approved",
      },
      signal(),
    );
    expect(decided.status).toBe("running");
  });

  it("adds created runs to the top of the list", async () => {
    const transport = createFixtureTransport();
    const accepted = await transport.create(
      { source_prompt: "Gửi tiêu đề thẻ mới vào #nhom-ati" },
      signal(),
    );
    const list = await transport.list(signal());
    expect(list[0]?.run_id).toBe(accepted.run_id);
    expect(list[0]?.source_prompt).toBe("Gửi tiêu đề thẻ mới vào #nhom-ati");
  });

  it("offers the planner suggestion as a fixture hint", () => {
    expect(createFixtureTransport().suggestedPrompt(WORLD_IDS.needsInput)).toMatch(
      /board_a, hạn 20\/09\/2026/,
    );
  });
});
