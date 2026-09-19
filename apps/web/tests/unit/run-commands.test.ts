import { describe, expect, it, vi } from "vitest";
import {
  createRunCommandController,
  type RunCommandController,
} from "../../src/controllers/run-commands.js";
import { createControllerRegistry } from "../../src/controllers/registry.js";
import type { DecisionInput, RunDetail, Transport } from "../../src/core/contracts.js";
import { ClientError } from "../../src/core/errors.js";
import { createSession } from "../../src/core/session.js";

describe("RunCommandController — Exclusive Locking & Uncertainty Lifecycle", () => {
  const sampleDecisionInput: DecisionInput = {
    approval_id: "a0000000-0000-0000-0000-000000000001",
    workflow_version_id: "b0000000-0000-0000-0000-000000000002",
    snapshot_hash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    decision: "approved",
  };

  const makeDetail = (status = "awaiting_approval", hasApproval = true): RunDetail => ({
    run_id: "run-cmd-1",
    status: status as any,
    workflow_version_id: "b0000000-0000-0000-0000-000000000002",
    plan: null,
    planner_result: null,
    approval: hasApproval
      ? {
          id: "a0000000-0000-0000-0000-000000000001",
          run_id: "run-cmd-1",
          workflow_version_id: "b0000000-0000-0000-0000-000000000002",
          snapshot_hash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          decision: "pending",
          actions: [],
          expires_at: "2026-09-19T12:00:00.000Z",
        }
      : null,
    time_zone: "Asia/Ho_Chi_Minh",
    runtime: {},
    last_seq: 1,
  });

  it("starts in idle state with null action", () => {
    const session = createSession();
    const transport: Partial<Transport> = {};
    const controller = createRunCommandController(transport as Transport, session, "run-cmd-1");

    const snapshot = controller.getSnapshot();
    expect(snapshot.action).toBeNull();
    expect(snapshot.status).toBe("idle");
    expect(snapshot.error).toBeNull();
    expect(snapshot.lostAt).toBeNull();
  });

  it("approving synchronously locks cancel, and vice versa", async () => {
    const session = createSession();
    let resolveDecide: (value: RunDetail) => void;
    const decidePromise = new Promise<RunDetail>((res) => {
      resolveDecide = res;
    });

    const transport: Partial<Transport> = {
      decide: vi.fn().mockReturnValue(decidePromise),
      cancel: vi.fn().mockResolvedValue(undefined),
    };

    const controller = createRunCommandController(transport as Transport, session, "run-cmd-1");

    // Start decide
    const decideCall = controller.decide(sampleDecisionInput);

    expect(controller.getSnapshot().action).toBe("approve");
    expect(controller.getSnapshot().status).toBe("submitting");

    // Concurrent cancel is locked and rejected
    const cancelResult = await controller.cancel();
    expect(cancelResult).toBe(false);
    expect(transport.cancel).not.toHaveBeenCalled();

    // Concurrent decide is also rejected
    const secondDecide = await controller.decide(sampleDecisionInput);
    expect(secondDecide).toBeNull();

    // Resolve original decide
    resolveDecide!(makeDetail("running", false));
    const result = await decideCall;
    expect(result).not.toBeNull();
    expect(controller.getSnapshot().status).toBe("success");
  });

  it("cancelling synchronously locks approval", async () => {
    const session = createSession();
    let resolveCancel: () => void;
    const cancelPromise = new Promise<void>((res) => {
      resolveCancel = res;
    });

    const transport: Partial<Transport> = {
      cancel: vi.fn().mockReturnValue(cancelPromise),
      decide: vi.fn().mockResolvedValue(makeDetail("running", false)),
    };

    const controller = createRunCommandController(transport as Transport, session, "run-cmd-1");

    const cancelCall = controller.cancel();
    expect(controller.getSnapshot().action).toBe("cancel");
    expect(controller.getSnapshot().status).toBe("submitting");

    // Attempting decide while cancelling is blocked
    const decideResult = await controller.decide(sampleDecisionInput);
    expect(decideResult).toBeNull();
    expect(transport.decide).not.toHaveBeenCalled();

    resolveCancel!();
    const result = await cancelCall;
    expect(result).toBe(true);
    expect(controller.getSnapshot().status).toBe("success");
  });

  it("network error / uncertain timeout transitions to confirming with lostAt", async () => {
    const session = createSession();
    const transport: Partial<Transport> = {
      decide: vi.fn().mockRejectedValue(
        new ClientError({
          message: "Mất kết nối",
          kind: "network",
          uncertain: true,
        }),
      ),
    };

    const controller = createRunCommandController(transport as Transport, session, "run-cmd-1");
    const result = await controller.decide(sampleDecisionInput);

    expect(result).toBeNull();
    const snapshot = controller.getSnapshot();
    expect(snapshot.status).toBe("confirming");
    expect(snapshot.action).toBe("approve");
    expect(snapshot.lostAt).not.toBeNull();
    expect(snapshot.error?.kind).toBe("network");
    expect(snapshot.error?.uncertain).toBe(true);

    // Further commands locked while in confirming state
    const tryCancel = await controller.cancel();
    expect(tryCancel).toBe(false);
    const tryDecide = await controller.decide(sampleDecisionInput);
    expect(tryDecide).toBeNull();
  });

  it("reconciles confirming state when run detail reflects completed approval", async () => {
    const session = createSession();
    const transport: Partial<Transport> = {
      decide: vi.fn().mockRejectedValue(
        new ClientError({
          message: "Timeout",
          kind: "network",
          uncertain: true,
        }),
      ),
    };

    const controller = createRunCommandController(transport as Transport, session, "run-cmd-1");
    await controller.decide(sampleDecisionInput);
    expect(controller.getSnapshot().status).toBe("confirming");

    // Run detail arrives showing status is now running and approval is consumed
    controller.reconcileWithDetail(makeDetail("running", false));

    const snapshot = controller.getSnapshot();
    expect(snapshot.status).toBe("idle");
    expect(snapshot.action).toBeNull();
    expect(snapshot.error).toBeNull();
    expect(snapshot.lostAt).toBeNull();
  });

  it("reconciles confirming cancel when run detail reflects cancelled status", async () => {
    const session = createSession();
    const transport: Partial<Transport> = {
      cancel: vi.fn().mockRejectedValue(
        new ClientError({
          message: "Timeout",
          kind: "network",
          uncertain: true,
        }),
      ),
    };

    const controller = createRunCommandController(transport as Transport, session, "run-cmd-1");
    await controller.cancel();
    expect(controller.getSnapshot().status).toBe("confirming");
    expect(controller.getSnapshot().action).toBe("cancel");

    // Run detail shows run was cancelled
    controller.reconcileWithDetail(makeDetail("cancelled", false));

    const snapshot = controller.getSnapshot();
    expect(snapshot.status).toBe("idle");
    expect(snapshot.action).toBeNull();
    expect(snapshot.error).toBeNull();
  });

  it("409 Conflict sets status: 'error' and does not mark uncertain", async () => {
    const session = createSession();
    const transport: Partial<Transport> = {
      decide: vi.fn().mockRejectedValue(
        new ClientError({
          message: "Quyết định đã được xử lý hoặc xung đột",
          kind: "http",
          status: 409,
          uncertain: false,
        }),
      ),
    };

    const controller = createRunCommandController(transport as Transport, session, "run-cmd-1");
    const result = await controller.decide(sampleDecisionInput);

    expect(result).toBeNull();
    const snapshot = controller.getSnapshot();
    expect(snapshot.status).toBe("error");
    expect(snapshot.error?.status).toBe(409);
    expect(snapshot.error?.uncertain).toBe(false);
  });

  it("registry provides shared RunCommandController per runId", () => {
    const session = createSession();
    const transport: Partial<Transport> = {};
    const registry = createControllerRegistry(transport as Transport, session);

    const cmd1 = registry.getRunCommands("run-1");
    const cmd2 = registry.getRunCommands("run-1");
    const cmd3 = registry.getRunCommands("run-2");

    expect(cmd1).toBe(cmd2);
    expect(cmd1).not.toBe(cmd3);

    registry.clear();
    expect(cmd1.getSnapshot().status).toBe("idle");
  });
});
