import { describe, expect, it, vi } from "vitest";
import { createControllerRegistry } from "../../src/controllers/registry.js";
import { createSession } from "../../src/core/session.js";
import type { Transport, RunDetail, EventPage } from "../../src/core/contracts.js";

describe("RunView Controller Integration", () => {
  const makeDetail = (status = "running", last_seq = 1): RunDetail => ({
    run_id: "run-uuid-view",
    status: status as any,
    workflow_version_id: null,
    plan: null,
    planner_result: null,
    approval: null,
    time_zone: "Asia/Ho_Chi_Minh",
    runtime: {},
    last_seq,
  });

  it("controller registry maintains single RunSyncController per runId", () => {
    const session = createSession();
    const mockTransport: Partial<Transport> = {};
    const registry = createControllerRegistry(mockTransport as Transport, session);

    const c1 = registry.getRunSync("run-1");
    const c2 = registry.getRunSync("run-1");
    const c3 = registry.getRunSync("run-2");

    expect(c1).toBe(c2);
    expect(c1).not.toBe(c3);

    registry.clear();
  });

  it("controller registry stops all running sync controllers on clear()", () => {
    const session = createSession();
    const mockTransport: Partial<Transport> = {
      detail: vi.fn().mockResolvedValue(makeDetail()),
      events: vi.fn().mockResolvedValue({ events: [], next_seq: 1 }),
    };
    const registry = createControllerRegistry(mockTransport as Transport, session);

    const c1 = registry.getRunSync("run-1");
    c1.start();
    expect(c1.getSnapshot().isPolling).toBe(true);

    registry.clear();
    expect(c1.getSnapshot().isPolling).toBe(false);
  });
});
