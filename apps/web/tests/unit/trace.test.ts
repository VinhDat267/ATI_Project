import { describe, expect, it, vi } from "vitest";
import {
  createTraceController,
  type TraceController,
} from "../../src/controllers/trace.js";
import { createControllerRegistry } from "../../src/controllers/registry.js";
import type { TracePage, Transport } from "../../src/core/contracts.js";
import { ClientError } from "../../src/core/errors.js";
import { createSession } from "../../src/core/session.js";

describe("TraceController — Cursor Pagination", () => {
  const attempt1: TracePage["attempts"][number] = {
    attempt_id: "att-1",
    step_id: "step-1",
    attempt_no: 1,
    evidence: "legacy_unknown",
    operation_id: "op-1",
    workflow_version_id: null,
    tool_snapshot: null,
    resolved_args: null,
    result: { text: "done 1" },
    outcome_certainty: null,
    error_class: null,
    error_message: null,
    started_at: "2026-09-19T10:00:00.000Z",
    ended_at: "2026-09-19T10:00:01.000Z",
  };

  const attempt2: TracePage["attempts"][number] = {
    attempt_id: "att-2",
    step_id: "step-2",
    attempt_no: 1,
    evidence: "legacy_unknown",
    operation_id: "op-2",
    workflow_version_id: null,
    tool_snapshot: null,
    resolved_args: null,
    result: { text: "done 2" },
    outcome_certainty: null,
    error_class: null,
    error_message: null,
    started_at: "2026-09-19T10:00:02.000Z",
    ended_at: "2026-09-19T10:00:03.000Z",
  };

  const attempt3: TracePage["attempts"][number] = {
    attempt_id: "att-3",
    step_id: "step-3",
    attempt_no: 1,
    evidence: "legacy_unknown",
    operation_id: "op-3",
    workflow_version_id: null,
    tool_snapshot: null,
    resolved_args: null,
    result: { text: "done 3" },
    outcome_certainty: null,
    error_class: null,
    error_message: null,
    started_at: "2026-09-19T10:00:04.000Z",
    ended_at: "2026-09-19T10:00:05.000Z",
  };

  it("starts in idle state with empty attempts and no cursor", () => {
    const session = createSession();
    const transport: Partial<Transport> = {};
    const controller = createTraceController(transport as Transport, session, "run-1");

    const snapshot = controller.getSnapshot();
    expect(snapshot.attempts).toEqual([]);
    expect(snapshot.nextCursor).toBeNull();
    expect(snapshot.isLoading).toBe(false);
    expect(snapshot.isLoadingMore).toBe(false);
    expect(snapshot.hasMore).toBe(false);
    expect(snapshot.error).toBeNull();
  });

  it("loadInitial loads first page with cursor: null", async () => {
    const session = createSession();
    const page1: TracePage = {
      run_id: "run-1",
      attempts: [attempt1],
      next_cursor: "cursor-page-2",
    };

    const transport: Partial<Transport> = {
      trace: vi.fn().mockResolvedValue(page1),
    };

    const controller = createTraceController(transport as Transport, session, "run-1");
    await controller.loadInitial();

    expect(transport.trace).toHaveBeenCalledWith("run-1", null, expect.any(AbortSignal));
    const snapshot = controller.getSnapshot();
    expect(snapshot.attempts).toEqual([attempt1]);
    expect(snapshot.nextCursor).toBe("cursor-page-2");
    expect(snapshot.hasMore).toBe(true);
    expect(snapshot.isLoading).toBe(false);
    expect(snapshot.error).toBeNull();
  });

  it("loadMore fetches with opaque nextCursor and appends attempts", async () => {
    const session = createSession();
    const page1: TracePage = {
      run_id: "run-1",
      attempts: [attempt1],
      next_cursor: "cursor-page-2",
    };
    const page2: TracePage = {
      run_id: "run-1",
      attempts: [attempt2, attempt3],
      next_cursor: null,
    };

    const transport: Partial<Transport> = {
      trace: vi
        .fn()
        .mockResolvedValueOnce(page1)
        .mockResolvedValueOnce(page2),
    };

    const controller = createTraceController(transport as Transport, session, "run-1");
    await controller.loadInitial();
    expect(controller.getSnapshot().attempts.length).toBe(1);

    await controller.loadMore();

    expect(transport.trace).toHaveBeenLastCalledWith(
      "run-1",
      "cursor-page-2",
      expect.any(AbortSignal),
    );
    const snapshot = controller.getSnapshot();
    expect(snapshot.attempts).toEqual([attempt1, attempt2, attempt3]);
    expect(snapshot.nextCursor).toBeNull();
    expect(snapshot.hasMore).toBe(false);
    expect(snapshot.isLoadingMore).toBe(false);
  });

  it("restarts gracefully from beginning on invalid cursor (400)", async () => {
    const session = createSession();
    const page1: TracePage = {
      run_id: "run-1",
      attempts: [attempt1],
      next_cursor: "stale-cursor",
    };
    const restartedPage: TracePage = {
      run_id: "run-1",
      attempts: [attempt1, attempt2],
      next_cursor: null,
    };

    const transport: Partial<Transport> = {
      trace: vi
        .fn()
        .mockResolvedValueOnce(page1)
        .mockRejectedValueOnce(
          new ClientError({
            message: "Cursor không hợp lệ hoặc đã hết hạn",
            kind: "http",
            status: 400,
          }),
        )
        .mockResolvedValueOnce(restartedPage),
    };

    const controller = createTraceController(transport as Transport, session, "run-1");
    await controller.loadInitial();
    expect(controller.getSnapshot().nextCursor).toBe("stale-cursor");

    // loadMore fails with 400, then restarts with cursor: null
    await controller.loadMore();

    expect(transport.trace).toHaveBeenCalledTimes(3);
    expect(transport.trace).toHaveBeenNthCalledWith(3, "run-1", null, expect.any(AbortSignal));

    const snapshot = controller.getSnapshot();
    expect(snapshot.attempts).toEqual([attempt1, attempt2]);
    expect(snapshot.nextCursor).toBeNull();
    expect(snapshot.hasMore).toBe(false);
    expect(snapshot.error).toBeNull();
  });

  it("generation fence: drops response if generation increments mid-load", async () => {
    const session = createSession();
    let resolveTrace: (value: TracePage) => void;
    const tracePromise = new Promise<TracePage>((res) => {
      resolveTrace = res;
    });

    const transport: Partial<Transport> = {
      trace: vi.fn().mockReturnValue(tracePromise),
    };

    const controller = createTraceController(transport as Transport, session, "run-1");
    const loadPromise = controller.loadInitial();
    expect(controller.getSnapshot().isLoading).toBe(true);

    // Generation advances
    session.clear();

    resolveTrace!({
      run_id: "run-1",
      attempts: [attempt1],
      next_cursor: null,
    });
    await loadPromise;

    // Snapshot remains initial and not updated by late response
    expect(controller.getSnapshot().attempts).toEqual([]);
  });

  it("registry provides single TraceController per runId", () => {
    const session = createSession();
    const transport: Partial<Transport> = {};
    const registry = createControllerRegistry(transport as Transport, session);

    const t1 = registry.getTrace("run-1");
    const t2 = registry.getTrace("run-1");
    const t3 = registry.getTrace("run-2");

    expect(t1).toBe(t2);
    expect(t1).not.toBe(t3);

    registry.clear();
    expect(t1.getSnapshot().attempts).toEqual([]);
  });
});
