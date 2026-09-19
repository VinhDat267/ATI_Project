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
});
