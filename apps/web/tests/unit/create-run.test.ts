import { describe, expect, it, vi } from "vitest";
import {
  createCreateRunController,
} from "../../src/controllers/create-run.js";
import { createControllerRegistry } from "../../src/controllers/registry.js";
import type { CreateInput, RunAccepted, Transport } from "../../src/core/contracts.js";
import { ClientError } from "../../src/core/errors.js";
import { createSession } from "../../src/core/session.js";

describe("CreateRunController — Persistent Uncertainty Lifecycle", () => {
  const sampleInput: CreateInput = {
    source_prompt: "Chuyển thẻ c1 sang bảng báo cáo",
    inputs: {},
    time_zone: "Asia/Ho_Chi_Minh",
  };

  const sampleAccepted: RunAccepted = {
    run_id: "run-new-123",
    status: "planning",
  };

  it("starts in idle status with null prompt and runId", () => {
    const session = createSession();
    const transport: Partial<Transport> = {};
    const controller = createCreateRunController(transport as Transport, session);

    const snapshot = controller.getSnapshot();
    expect(snapshot.status).toBe("idle");
    expect(snapshot.submittedPrompt).toBeNull();
    expect(snapshot.createdRunId).toBeNull();
    expect(snapshot.error).toBeNull();
    expect(snapshot.lostAt).toBeNull();
  });

  it("transitions to submitting while in-flight and accepted on success", async () => {
    const session = createSession();
    let resolveCreate: (value: RunAccepted) => void;
    const createPromise = new Promise<RunAccepted>((res) => {
      resolveCreate = res;
    });

    const transport: Partial<Transport> = {
      create: vi.fn().mockReturnValue(createPromise),
    };

    const controller = createCreateRunController(transport as Transport, session);

    const submitPromise = controller.submit(sampleInput);

    // Submitting state:
    expect(controller.getSnapshot().status).toBe("submitting");
    expect(controller.getSnapshot().submittedPrompt).toBe(sampleInput.source_prompt);

    // Cannot submit concurrently while submitting
    const concurrent = await controller.submit(sampleInput);
    expect(concurrent).toBeNull();

    // Resolve create request
    resolveCreate!(sampleAccepted);
    const result = await submitPromise;

    expect(result).toEqual(sampleAccepted);
    const endSnapshot = controller.getSnapshot();
    expect(endSnapshot.status).toBe("accepted");
    expect(endSnapshot.createdRunId).toBe("run-new-123");
    expect(endSnapshot.error).toBeNull();
  });

  it("transitions to confirming when write fails with uncertain/network error", async () => {
    const session = createSession();
    const transport: Partial<Transport> = {
      create: vi.fn().mockRejectedValue(
        new ClientError({
          message: "Mất kết nối tới máy chủ",
          kind: "network",
          uncertain: true,
        }),
      ),
    };

    const controller = createCreateRunController(transport as Transport, session);
    const result = await controller.submit(sampleInput);

    expect(result).toBeNull();
    const snapshot = controller.getSnapshot();
    expect(snapshot.status).toBe("confirming");
    expect(snapshot.submittedPrompt).toBe(sampleInput.source_prompt);
    expect(snapshot.createdRunId).toBeNull();
    expect(snapshot.lostAt).not.toBeNull();
    expect(snapshot.error?.kind).toBe("network");
    expect(snapshot.error?.uncertain).toBe(true);
  });

  it("transitions to error (not confirming) when server definitively rejects with 400", async () => {
    const session = createSession();
    const transport: Partial<Transport> = {
      create: vi.fn().mockRejectedValue(
        new ClientError({
          message: "Yêu cầu không hợp lệ",
          kind: "http",
          status: 400,
          uncertain: false,
        }),
      ),
    };

    const controller = createCreateRunController(transport as Transport, session);
    const result = await controller.submit(sampleInput);

    expect(result).toBeNull();
    const snapshot = controller.getSnapshot();
    expect(snapshot.status).toBe("error");
    expect(snapshot.error?.status).toBe(400);
    expect(snapshot.error?.uncertain).toBe(false);
  });

  it("locks in confirming state; direct submit with same or different body returns null without transport call", async () => {
    const session = createSession();
    const createFn = vi.fn().mockRejectedValueOnce(
      new ClientError({
        message: "Timeout khi chờ phản hồi",
        kind: "network",
        uncertain: true,
      }),
    );
    const transport: Partial<Transport> = {
      create: createFn,
    };

    const controller = createCreateRunController(transport as Transport, session);
    await controller.submit(sampleInput);
    expect(controller.getSnapshot().status).toBe("confirming");
    expect(createFn).toHaveBeenCalledTimes(1);

    // Subsequent submit with identical body is blocked at controller level
    const resSame = await controller.submit(sampleInput);
    expect(resSame).toBeNull();
    expect(createFn).toHaveBeenCalledTimes(1);

    // Subsequent submit with different body is also blocked at controller level
    const resDiff = await controller.submit({
      source_prompt: "Yêu cầu hoàn toàn mới khác",
      inputs: {},
      time_zone: "UTC",
    });
    expect(resDiff).toBeNull();
    expect(createFn).toHaveBeenCalledTimes(1);

    // Snapshot retains original prompt and lostAt
    const snapshot = controller.getSnapshot();
    expect(snapshot.status).toBe("confirming");
    expect(snapshot.submittedPrompt).toBe(sampleInput.source_prompt);
    expect(snapshot.lostAt).not.toBeNull();
  });

  it("reset() is a no-op when status is confirming or submitting; preserves prompt, lostAt, error, and fence", async () => {
    const session = createSession();
    const transport: Partial<Transport> = {
      create: vi.fn().mockRejectedValue(
        new ClientError({
          message: "Timeout",
          kind: "network",
          uncertain: true,
        }),
      ),
    };

    const controller = createCreateRunController(transport as Transport, session);
    await controller.submit(sampleInput);
    const confirmingSnapshot = controller.getSnapshot();
    expect(confirmingSnapshot.status).toBe("confirming");

    // reset() while confirming should do nothing
    controller.reset();
    const afterResetSnapshot = controller.getSnapshot();
    expect(afterResetSnapshot.status).toBe("confirming");
    expect(afterResetSnapshot.submittedPrompt).toBe(sampleInput.source_prompt);
    expect(afterResetSnapshot.lostAt).toBe(confirmingSnapshot.lostAt);
    expect(afterResetSnapshot.error).toBe(confirmingSnapshot.error);

    // reset() on error or idle resets as expected
    const errSession = createSession();
    const errTransport: Partial<Transport> = {
      create: vi.fn().mockRejectedValue(
        new ClientError({
          message: "Bad request",
          kind: "http",
          status: 400,
          uncertain: false,
        }),
      ),
    };
    const errController = createCreateRunController(errTransport as Transport, errSession);
    await errController.submit(sampleInput);
    expect(errController.getSnapshot().status).toBe("error");
    errController.reset();
    expect(errController.getSnapshot().status).toBe("idle");
    expect(errController.getSnapshot().submittedPrompt).toBeNull();
  });

  it("teardown() aborts in-flight request, transitions submitting to confirming, and drops late response", async () => {
    const session = createSession();
    let resolveCreate: (value: RunAccepted) => void;
    const createPromise = new Promise<RunAccepted>((res) => {
      resolveCreate = res;
    });

    const transport: Partial<Transport> = {
      create: vi.fn().mockReturnValue(createPromise),
    };

    const controller = createCreateRunController(transport as Transport, session);
    const submitPromise = controller.submit(sampleInput);
    expect(controller.getSnapshot().status).toBe("submitting");

    // Route changes or teardown occurs while request is in-flight
    controller.teardown();

    // Since in-flight write was interrupted, it conservatively transitions to confirming
    const tornDownSnapshot = controller.getSnapshot();
    expect(tornDownSnapshot.status).toBe("confirming");
    expect(tornDownSnapshot.submittedPrompt).toBe(sampleInput.source_prompt);
    expect(tornDownSnapshot.error?.uncertain).toBe(true);

    // Late server response arrives
    resolveCreate!(sampleAccepted);
    const result = await submitPromise;
    expect(result).toBeNull();

    // Controller status is NOT overwritten to accepted
    expect(controller.getSnapshot().status).toBe("confirming");
  });

  it("teardown() preserves confirming state and existing listeners", async () => {
    const session = createSession();
    const transport: Partial<Transport> = {
      create: vi.fn().mockRejectedValue(
        new ClientError({
          message: "Mất mạng",
          kind: "network",
          uncertain: true,
        }),
      ),
    };

    const controller = createCreateRunController(transport as Transport, session);
    await controller.submit(sampleInput);
    expect(controller.getSnapshot().status).toBe("confirming");

    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);

    // Teardown while confirming must preserve confirming status
    controller.teardown();
    expect(controller.getSnapshot().status).toBe("confirming");

    unsubscribe();
  });

  it("generation fence: drops late response if session generation increments or logs out", async () => {
    const session = createSession();
    let resolveCreate: (value: RunAccepted) => void;
    const createPromise = new Promise<RunAccepted>((res) => {
      resolveCreate = res;
    });

    const transport: Partial<Transport> = {
      create: vi.fn().mockReturnValue(createPromise),
    };

    const controller = createCreateRunController(transport as Transport, session);
    const submitPromise = controller.submit(sampleInput);
    expect(controller.getSnapshot().status).toBe("submitting");

    // Session logs out or changes generation mid-request
    session.clear();

    // Late response returns
    resolveCreate!(sampleAccepted);
    const result = await submitPromise;

    expect(result).toBeNull();
    // Status was not transitioned to accepted on the expired controller
    expect(controller.getSnapshot().status).not.toBe("accepted");
  });

  it("registry maintains persistent CreateRunController across view navigations", () => {
    const session = createSession();
    const transport: Partial<Transport> = {};
    const registry = createControllerRegistry(transport as Transport, session);

    const c1 = registry.getCreateRun();
    const c2 = registry.getCreateRun();
    expect(c1).toBe(c2);

    registry.clear();
    // clear() calls teardown(), which leaves idle state as idle
    expect(c1.getSnapshot().status).toBe("idle");
  });
});
