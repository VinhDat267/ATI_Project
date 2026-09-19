import { describe, expect, it } from "vitest";
import { createInitialEventState, ingestEvents, type EventState } from "../../src/core/events.js";
import type { RunEvent } from "@wap/dsl/browser";

describe("ingestEvents", () => {
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
      duration_ms: 60000,
      error_message: null,
      outputs: {},
    },
  });

  it("initial state starts at seq 0 with no events", () => {
    const initial = createInitialEventState();
    expect(initial).toEqual({
      seq: 0,
      events: [],
      finished: false,
      error: null,
    });
  });

  it("ingests strictly contiguous increasing events", () => {
    let state = createInitialEventState();
    const page = {
      events: [makeStatusEvent(1), makeStatusEvent(2), makeStatusEvent(3)],
      next_seq: 4,
    };

    state = ingestEvents(state, page, "run-1");

    expect(state.seq).toBe(3);
    expect(state.events).toHaveLength(3);
    expect(state.error).toBeNull();
    expect(state.finished).toBe(false);
  });

  it("detects sequence gap and halts with protocol error", () => {
    let state = createInitialEventState();
    state = ingestEvents(
      state,
      { events: [makeStatusEvent(1)], next_seq: 2 },
      "run-1",
    );

    // Incoming event has seq 3 instead of expected seq 2
    const gapped = ingestEvents(
      state,
      { events: [makeStatusEvent(3)], next_seq: 4 },
      "run-1",
    );

    expect(gapped.error).toMatch(/gián đoạn chuỗi sự kiện/);
    expect(gapped.seq).toBe(1);
    expect(gapped.events).toHaveLength(1);
  });

  it("idempotently ignores duplicate events with identical payload", () => {
    let state = createInitialEventState();
    state = ingestEvents(
      state,
      { events: [makeStatusEvent(1), makeStatusEvent(2)], next_seq: 3 },
      "run-1",
    );

    // Overlapping fetch containing event 2 again with identical payload
    const deduplicated = ingestEvents(
      state,
      { events: [makeStatusEvent(2), makeStatusEvent(3)], next_seq: 4 },
      "run-1",
    );

    expect(deduplicated.error).toBeNull();
    expect(deduplicated.seq).toBe(3);
    expect(deduplicated.events).toHaveLength(3);
    expect(deduplicated.events.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it("rejects conflicting payloads for an existing sequence number", () => {
    let state = createInitialEventState();
    state = ingestEvents(
      state,
      { events: [makeStatusEvent(1, "planning")], next_seq: 2 },
      "run-1",
    );

    // Same seq 1 but conflicting status "running"
    const conflicting = ingestEvents(
      state,
      { events: [makeStatusEvent(1, "running")], next_seq: 2 },
      "run-1",
    );

    expect(conflicting.error).toMatch(/Xung đột dữ liệu/);
    expect(conflicting.seq).toBe(1);
    const first = conflicting.events[0];
    expect(first?.type).toBe("run.status");
    if (first && first.type === "run.status") {
      expect(first.payload.status).toBe("planning");
    }
  });

  it("marks finished upon ingesting run.finished event", () => {
    let state = createInitialEventState();
    state = ingestEvents(
      state,
      { events: [makeStatusEvent(1), makeFinishedEvent(2)], next_seq: 3 },
      "run-1",
    );

    expect(state.finished).toBe(true);
    expect(state.seq).toBe(2);
    expect(state.error).toBeNull();
  });

  it("rejects events received after run.finished", () => {
    let state = createInitialEventState();
    state = ingestEvents(
      state,
      { events: [makeFinishedEvent(1)], next_seq: 2 },
      "run-1",
    );
    expect(state.finished).toBe(true);

    const postFinished = ingestEvents(
      state,
      { events: [makeStatusEvent(2)], next_seq: 3 },
      "run-1",
    );

    expect(postFinished.error).toMatch(/sau khi run đã kết thúc/);
  });

  it("does not partially commit events when a failure occurs later in the page", () => {
    let state = createInitialEventState();
    state = ingestEvents(
      state,
      { events: [makeStatusEvent(1)], next_seq: 2 },
      "run-1",
    );

    // Page has valid seq 2 but then invalid seq 4 (gap)
    const failedPage = ingestEvents(
      state,
      { events: [makeStatusEvent(2), makeStatusEvent(4)], next_seq: 5 },
      "run-1",
    );

    expect(failedPage.error).not.toBeNull();
    // Rollback: seq remains 1 and events remains length 1
    expect(failedPage.seq).toBe(1);
    expect(failedPage.events).toHaveLength(1);
  });
});
