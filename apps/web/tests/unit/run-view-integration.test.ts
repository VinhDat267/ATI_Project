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

  it("reused registry controller restarts cleanly on route revisit after stop", async () => {
    const session = createSession();
    let resolveFirstDetail!: (d: RunDetail) => void;
    const firstDetailPromise = new Promise<RunDetail>((res) => {
      resolveFirstDetail = res;
    });

    let calls = 0;
    const mockTransport: Partial<Transport> = {
      detail: vi.fn().mockImplementation(() => {
        calls++;
        if (calls === 1) return firstDetailPromise;
        return Promise.resolve(makeDetail("running", 2));
      }),
      events: vi.fn().mockResolvedValue({ events: [], next_seq: 1 }),
    };
    const registry = createControllerRegistry(mockTransport as Transport, session);

    // Initial visit to run view
    const c1 = registry.getRunSync("run-1");
    c1.start();
    expect(c1.getSnapshot().isPolling).toBe(true);
    expect(mockTransport.detail).toHaveBeenCalledTimes(1);

    // User navigates away: effect cleanup calls stop() while request is pending
    c1.stop();
    expect(c1.getSnapshot().isPolling).toBe(false);

    // User navigates back to run view: effect mounts and calls start()
    const cRevisited = registry.getRunSync("run-1");
    expect(cRevisited).toBe(c1);
    cRevisited.start();
    expect(cRevisited.getSnapshot().isPolling).toBe(true);

    // Unwind first pending request
    resolveFirstDetail(makeDetail("running", 1));

    // Next tick must execute for the revisited route
    await vi.waitFor(() => {
      expect(mockTransport.detail).toHaveBeenCalledTimes(2);
    });

    cRevisited.stop();
    registry.clear();
  });
});
