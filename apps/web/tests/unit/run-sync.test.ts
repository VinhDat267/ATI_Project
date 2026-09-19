import { describe, expect, it, vi } from "vitest";
import { createRunSyncController } from "../../src/controllers/run-sync.js";
import { createSession } from "../../src/core/session.js";
import type { Transport, RunDetail, EventPage } from "../../src/core/contracts.js";
import type { RunEvent } from "@wap/dsl/browser";

describe("createRunSyncController", () => {
  const makeDetail = (status = "running", last_seq = 1): RunDetail => ({
    run_id: "run-uuid-1",
    status: status as any,
    workflow_version_id: null,
    plan: null,
    planner_result: null,
    approval: null,
    time_zone: "Asia/Ho_Chi_Minh",
    runtime: {},
    last_seq,
  });

  const makeStatusEvent = (seq: number, status = "running"): RunEvent => ({
    seq,
    created_at: "2026-09-19T10:00:00.000Z",
    type: "run.status",
    payload: {
      status: status as any,
      previous: null,
    },
  });

  const makeFinishedEvent = (seq: number): RunEvent => ({
    seq,
    created_at: "2026-09-19T10:01:00.000Z",
    type: "run.finished",
    payload: {
      status: "succeeded",
      duration_ms: 5000,
      error_message: null,
      outputs: {},
    },
  });

  it("initializes with empty snapshot and begins polling on start", async () => {
    const session = createSession();
    session.setToken("test-token");

    const mockDetail = makeDetail("running", 1);
    const mockEvents: EventPage = {
      events: [makeStatusEvent(1)],
      next_seq: 2,
    };

    const mockTransport: Partial<Transport> = {
      detail: vi.fn().mockResolvedValue(mockDetail),
      events: vi.fn().mockResolvedValue(mockEvents),
    };

    const controller = createRunSyncController(
      mockTransport as Transport,
      session,
      "run-uuid-1",
      { pollIntervalMs: 5000 },
    );

    expect(controller.getSnapshot().isPolling).toBe(false);
    expect(controller.getSnapshot().detail).toBeNull();

    controller.start();
    expect(controller.getSnapshot().isPolling).toBe(true);

    // Allow initial poll promise to resolve
    await vi.waitFor(() => {
      expect(controller.getSnapshot().detail).not.toBeNull();
    });

    const snapshot = controller.getSnapshot();
    expect(snapshot.detail?.run_id).toBe("run-uuid-1");
    expect(snapshot.eventState.seq).toBe(1);
    expect(snapshot.eventState.events).toHaveLength(1);

    controller.stop();
    expect(controller.getSnapshot().isPolling).toBe(false);
  });

  it("drains full 200-event pages immediately without waiting for poll interval", async () => {
    const session = createSession();
    session.setToken("test-token");

    // Generate 200 events for page 1
    const page1Events: RunEvent[] = Array.from({ length: 200 }, (_, i) =>
      makeStatusEvent(i + 1),
    );
    const page1: EventPage = { events: page1Events, next_seq: 201 };

    // Page 2 has 1 event
    const page2: EventPage = {
      events: [makeStatusEvent(201)],
      next_seq: 202,
    };

    let eventsCallCount = 0;
    const mockTransport: Partial<Transport> = {
      detail: vi.fn().mockResolvedValue(makeDetail("running", 201)),
      events: vi.fn().mockImplementation((_id, since) => {
        eventsCallCount++;
        if (since === 0) return Promise.resolve(page1);
        if (since === 200) return Promise.resolve(page2);
        return Promise.resolve({ events: [], next_seq: 202 });
      }),
    };

    const controller = createRunSyncController(
      mockTransport as Transport,
      session,
      "run-uuid-1",
      { pollIntervalMs: 60000 }, // Long timer so drainage must be immediate
    );

    controller.start();

    await vi.waitFor(() => {
      expect(controller.getSnapshot().eventState.seq).toBe(201);
    });

    expect(eventsCallCount).toBeGreaterThanOrEqual(2);
    expect(controller.getSnapshot().eventState.events).toHaveLength(201);

    controller.stop();
  });

  it("stops polling when run.finished event is ingested", async () => {
    const session = createSession();
    session.setToken("test-token");

    const terminalDetail = makeDetail("succeeded", 2);
    const terminalEvents: EventPage = {
      events: [makeStatusEvent(1), makeFinishedEvent(2)],
      next_seq: 3,
    };

    const mockTransport: Partial<Transport> = {
      detail: vi.fn().mockResolvedValue(terminalDetail),
      events: vi.fn().mockResolvedValue(terminalEvents),
    };

    const controller = createRunSyncController(
      mockTransport as Transport,
      session,
      "run-uuid-1",
      { pollIntervalMs: 100 },
    );

    controller.start();

    await vi.waitFor(() => {
      expect(controller.getSnapshot().eventState.finished).toBe(true);
    });

    expect(controller.getSnapshot().isPolling).toBe(false);
  });

  it("restarts polling cleanly when start() is called while previous tick is still pending", async () => {
    const session = createSession();
    session.setToken("test-token");

    let resolveDetail1!: (val: RunDetail) => void;
    let resolveEvents1!: (val: EventPage) => void;
    const detailPromise1 = new Promise<RunDetail>((res) => {
      resolveDetail1 = res;
    });
    const eventsPromise1 = new Promise<EventPage>((res) => {
      resolveEvents1 = res;
    });

    let callCount = 0;
    const mockTransport: Partial<Transport> = {
      detail: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return detailPromise1;
        return Promise.resolve(makeDetail("running", 1));
      }),
      events: vi.fn().mockImplementation(() => {
        if (callCount === 1) return eventsPromise1;
        return Promise.resolve({ events: [makeStatusEvent(1)], next_seq: 2 });
      }),
    };

    const controller = createRunSyncController(
      mockTransport as Transport,
      session,
      "run-uuid-1",
      { pollIntervalMs: 5000 },
    );

    // 1. First start initiates tick 1
    controller.start();
    expect(controller.getSnapshot().isPolling).toBe(true);
    expect(mockTransport.detail).toHaveBeenCalledTimes(1);

    // 2. Stop while tick 1 is in-flight
    controller.stop();
    expect(controller.getSnapshot().isPolling).toBe(false);

    // 3. Start again while tick 1 has NOT settled yet (race condition)
    controller.start();
    expect(controller.getSnapshot().isPolling).toBe(true);

    // 4. Now resolve the aborted tick 1's promises
    resolveDetail1(makeDetail("running", 1));
    resolveEvents1({ events: [makeStatusEvent(1)], next_seq: 2 });

    // Tick 2 must be triggered after tick 1 finishes unwinding!
    await vi.waitFor(() => {
      expect(mockTransport.detail).toHaveBeenCalledTimes(2);
    });

    await vi.waitFor(() => {
      const snap = controller.getSnapshot();
      expect(snap.eventState.seq).toBe(1);
      expect(snap.isPolling).toBe(true);
    });

    controller.stop();
  });

  it("does not resurrect polling if stop() is called after start() while tick was in flight", async () => {
    const session = createSession();
    session.setToken("test-token");

    let resolveDetail1!: (val: RunDetail) => void;
    const detailPromise1 = new Promise<RunDetail>((res) => {
      resolveDetail1 = res;
    });

    const mockTransport: Partial<Transport> = {
      detail: vi.fn().mockReturnValue(detailPromise1),
      events: vi.fn().mockReturnValue(new Promise(() => {})),
    };

    const controller = createRunSyncController(
      mockTransport as Transport,
      session,
      "run-uuid-1",
      { pollIntervalMs: 5000 },
    );

    controller.start();
    controller.stop();
    controller.start();
    controller.stop(); // final state must be stopped!

    resolveDetail1(makeDetail("running", 1));

    // Wait short time to ensure no new tick fires
    await new Promise((r) => setTimeout(r, 50));
    expect(controller.getSnapshot().isPolling).toBe(false);
    expect(mockTransport.detail).toHaveBeenCalledTimes(1);
  });

  it("coalesces multiple refresh() calls while tick is in flight into a single next tick", async () => {
    const session = createSession();
    session.setToken("test-token");

    let resolveDetail1!: (val: RunDetail) => void;
    let resolveEvents1!: (val: EventPage) => void;
    const detailPromise1 = new Promise<RunDetail>((res) => {
      resolveDetail1 = res;
    });
    const eventsPromise1 = new Promise<EventPage>((res) => {
      resolveEvents1 = res;
    });

    let callCount = 0;
    const mockTransport: Partial<Transport> = {
      detail: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return detailPromise1;
        return Promise.resolve(makeDetail("running", 1));
      }),
      events: vi.fn().mockImplementation(() => {
        if (callCount === 1) return eventsPromise1;
        return Promise.resolve({ events: [makeStatusEvent(1)], next_seq: 2 });
      }),
    };

    const controller = createRunSyncController(
      mockTransport as Transport,
      session,
      "run-uuid-1",
      { pollIntervalMs: 60000 },
    );

    controller.start();
    expect(mockTransport.detail).toHaveBeenCalledTimes(1);

    // Call refresh multiple times while tick 1 is in-flight
    void controller.refresh();
    void controller.refresh();
    void controller.refresh();

    // Still only 1 call dispatched so far
    expect(mockTransport.detail).toHaveBeenCalledTimes(1);

    // Resolve tick 1
    resolveDetail1(makeDetail("running", 0));
    resolveEvents1({ events: [], next_seq: 0 });

    // Tick 2 should be dispatched exactly once
    await vi.waitFor(() => {
      expect(mockTransport.detail).toHaveBeenCalledTimes(2);
    });

    // Wait short time to ensure no third tick was queued
    await new Promise((r) => setTimeout(r, 50));
    expect(mockTransport.detail).toHaveBeenCalledTimes(2);

    controller.stop();
  });

  it("awaits both detail and events settling when one fails fast", async () => {
    const session = createSession();
    session.setToken("test-token");

    let resolveEvents1!: (val: EventPage) => void;
    const eventsPromise1 = new Promise<EventPage>((res) => {
      resolveEvents1 = res;
    });

    let isTick1EventsStillPending = true;
    const mockTransport: Partial<Transport> = {
      // detail rejects immediately
      detail: vi.fn().mockRejectedValueOnce(new Error("Detail network error")),
      // events is still running
      events: vi.fn().mockImplementationOnce(() => {
        return eventsPromise1.finally(() => {
          isTick1EventsStillPending = false;
        });
      }),
    };

    const controller = createRunSyncController(
      mockTransport as Transport,
      session,
      "run-uuid-1",
      { pollIntervalMs: 60000 },
    );

    controller.start();

    // Even though detail failed immediately, the controller should NOT have released the tick owner
    // until events settles!
    await new Promise((r) => setTimeout(r, 50));
    expect(isTick1EventsStillPending).toBe(true);

    // If we call refresh now while events is still pending:
    void controller.refresh();
    // detail should NOT have been called a second time yet
    expect(mockTransport.detail).toHaveBeenCalledTimes(1);

    // Now settle events
    resolveEvents1({ events: [], next_seq: 0 });

    // Once settled, the next tick can proceed
    await vi.waitFor(() => {
      expect(isTick1EventsStillPending).toBe(false);
    });

    controller.stop();
  });
});
