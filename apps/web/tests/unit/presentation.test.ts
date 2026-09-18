import { describe, expect, it } from "vitest";
import { RunStatusSchema } from "@wap/dsl/browser";
import {
  attentionCount,
  filterRuns,
  formatDateTime,
  formatRemaining,
  historyGroupOf,
  normalizeSearch,
  runPresentation,
  shortId,
} from "../../src/core/presentation.js";
import { createFixtureScenario } from "../../src/core/fixtures.js";

describe("runPresentation", () => {
  it("covers all 14 statuses with Vietnamese labels", () => {
    for (const status of RunStatusSchema.options) {
      expect(runPresentation(status).label.length).toBeGreaterThan(0);
    }
    expect(runPresentation("awaiting_approval")).toMatchObject({
      label: "Chờ duyệt",
      tone: "action",
      icon: "hand",
      canCancel: true,
      needsAttention: true,
    });
    expect(runPresentation("reconciliation_required")).toMatchObject({
      label: "Cần đối chiếu",
      tone: "unknown",
      terminal: true,
      canCancel: false,
    });
    expect(
      RunStatusSchema.options.filter((s) => runPresentation(s).terminal),
    ).toHaveLength(8);
  });

  it("groups history into five filters", () => {
    expect(historyGroupOf("needs_input")).toBe("unfinished");
    expect(historyGroupOf("replanning")).toBe("active");
    expect(historyGroupOf("awaiting_approval")).toBe("attention");
    expect(historyGroupOf("succeeded")).toBe("succeeded");
  });
});

describe("search", () => {
  it("ignores case and Vietnamese marks", () => {
    expect(normalizeSearch("Báo cáo TUẦN Đội")).toBe("bao cao tuan doi");
    const run = createFixtureScenario("succeeded");
    const withPrompt = { ...run, source_prompt: "Chép báo cáo tuần" };
    expect(filterRuns([withPrompt], "all", "BAO CAO")).toHaveLength(1);
    expect(filterRuns([withPrompt], "all", run.run_id.slice(0, 4))).toHaveLength(
      1,
    );
    expect(filterRuns([withPrompt], "attention", "")).toHaveLength(0);
    expect(
      attentionCount([run, createFixtureScenario("awaiting_approval")]),
    ).toBe(1);
  });
});

describe("formatting", () => {
  it("formats remaining time and flags the last two minutes", () => {
    expect(formatRemaining(521_000)).toEqual({
      text: "08:41",
      spoken: "8 phút 41 giây",
      urgent: false,
      expired: false,
    });
    expect(formatRemaining(108_000).urgent).toBe(true);
    expect(formatRemaining(-1).expired).toBe(true);
  });

  it("formats server times in the run time zone", () => {
    expect(
      formatDateTime("2026-09-17T07:22:00.000Z", "Asia/Ho_Chi_Minh"),
    ).toBe("14:22, 17/09/2026");
    expect(shortId("7c1e2a90-4b7d-4e2a-9f1c-2d8e6a0b5c13")).toBe("7c1e2a90");
  });
});
