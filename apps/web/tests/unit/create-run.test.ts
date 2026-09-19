import { describe, expect, it, vi } from "vitest";
import {
  createCreateRunController,
  type CreateRunController,
} from "../../src/controllers/create-run.js";
import { createControllerRegistry } from "../../src/controllers/registry.js";
import type { CreateInput, RunAccepted, RunDetail, Transport } from "../../src/core/contracts.js";
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

  const sampleRunDetail: RunDetail = {
    run_id: "run-new-123",
    status: "planning",
    workflow_version_id: null,
    plan: null,
    planner_result: null,
    approval: null,
    time_zone: "Asia/Ho_Chi_Minh",
    runtime: {},
    last_seq: 0,
    source_prompt: "Chuyển thẻ c1 sang bảng báo cáo",
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

  it("reconciles confirming state when matching run appears in run list", async () => {
    const session = createSession();
    const transport: Partial<Transport> = {
      create: vi.fn().mockRejectedValue(
        new ClientError({
          message: "Timeout khi chờ phản hồi",
          kind: "network",
          uncertain: true,
        }),
      ),
      list: vi.fn().mockResolvedValue([sampleRunDetail]),
    };

    const controller = createCreateRunController(transport as Transport, session);
    await controller.submit(sampleInput);
    expect(controller.getSnapshot().status).toBe("confirming");

    // Reconcile directly with list
    const matched = controller.reconcile([sampleRunDetail]);
    expect(matched).toEqual(sampleRunDetail);

    const snapshot = controller.getSnapshot();
    expect(snapshot.status).toBe("accepted");
    expect(snapshot.createdRunId).toBe("run-new-123");
    expect(snapshot.error).toBeNull();
    expect(snapshot.lostAt).toBeNull();
  });

  it("checkReconciliation fetches run list and reconciles automatically", async () => {
    const session = createSession();
    const transport: Partial<Transport> = {
      create: vi.fn().mockRejectedValue(
        new ClientError({
          message: "Timeout",
          kind: "network",
          uncertain: true,
        }),
      ),
      list: vi.fn().mockResolvedValue([sampleRunDetail]),
    };

    const controller = createCreateRunController(transport as Transport, session);
    await controller.submit(sampleInput);
    expect(controller.getSnapshot().status).toBe("confirming");

    const match = await controller.checkReconciliation();
    expect(match).toEqual(sampleRunDetail);
    expect(controller.getSnapshot().status).toBe("accepted");
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
    expect(c1.getSnapshot().status).toBe("idle");
  });
});
