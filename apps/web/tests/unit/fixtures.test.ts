import { describe, expect, it } from "vitest";
import {
  RunDetailSchema,
  RunStatusSchema,
  ServerSummaryListSchema,
} from "@wap/dsl/browser";
import {
  createFixtureScenario,
  createFixtureTransport,
} from "../../src/core/fixtures.js";

const statuses = RunStatusSchema.options;

describe("fixture transport", () => {
  it("provides schema-valid synthetic detail for every run status", async () => {
    for (const status of statuses) {
      expect(() =>
        RunDetailSchema.parse(createFixtureScenario(status)),
      ).not.toThrow();
      const transport = createFixtureTransport(status);
      const detail = await transport.detail(
        transport.runId,
        new AbortController().signal,
      );
      expect(() => RunDetailSchema.parse(detail)).not.toThrow();
      expect(detail.status).toBe(status);
    }
  });

  it("uses planner refusal and clarification outcomes without an empty plan", async () => {
    const refused = createFixtureTransport("refused");
    const refusedDetail = await refused.detail(
      refused.runId,
      new AbortController().signal,
    );
    expect(refusedDetail.plan).toBeNull();
    expect(refusedDetail.planner_result?.kind).toBe("refusal");

    const needsInput = createFixtureTransport("needs_input");
    const inputDetail = await needsInput.detail(
      needsInput.runId,
      new AbortController().signal,
    );
    expect(inputDetail.plan).toBeNull();
    expect(inputDetail.planner_result?.kind).toBe("clarification");
  });

  it("returns parsed server summaries and honors AbortSignal", async () => {
    const transport = createFixtureTransport();
    const servers = await transport.servers(new AbortController().signal);
    expect(() => ServerSummaryListSchema.parse(servers)).not.toThrow();
    expect(servers).toHaveLength(2);

    const controller = new AbortController();
    controller.abort();
    await expect(transport.list(controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});
