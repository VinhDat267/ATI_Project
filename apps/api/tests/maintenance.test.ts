import { describe, expect, it } from "vitest";
import {
  createExpiryMaintenance,
  type MaintenanceErrorCode,
} from "../src/maintenance.js";

const waitFor = async (predicate: () => boolean) => {
  const deadline = Date.now() + 1_000;
  while (!predicate() && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 1));
  expect(predicate()).toBe(true);
};

describe("expiry maintenance", () => {
  it("runs approval expiry and bounded trace cleanup as one non-overlapping tick", async () => {
    let expireCalls = 0;
    let cleanupCalls = 0;
    let inFlight = 0;
    let maxInFlight = 0;
    let releaseExpire!: () => void;
    let releaseCleanup!: () => void;
    const expireGate = new Promise<void>((resolve) => {
      releaseExpire = resolve;
    });
    const cleanupGate = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    const engine = {
      async expireApprovals() {
        expireCalls++;
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await expireGate;
        inFlight--;
      },
      async cleanupExpiredTraceSnapshots(limit: number) {
        expect(limit).toBe(7);
        cleanupCalls++;
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await cleanupGate;
        inFlight--;
      },
    };
    const maintenance = createExpiryMaintenance({
      engine: engine as never,
      intervalMs: 5,
      traceSnapshotBatchSize: 7,
    });
    maintenance.start();
    await waitFor(() => expireCalls === 1);
    maintenance.wake();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(expireCalls).toBe(1);
    expect(cleanupCalls).toBe(0);

    releaseExpire();
    await waitFor(() => cleanupCalls === 1);
    maintenance.wake();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(expireCalls).toBe(1);
    expect(cleanupCalls).toBe(1);
    releaseCleanup();
    await maintenance.stop();
    expect(maxInFlight).toBe(1);
  });

  it("reports safe error codes and continues to the other maintenance task", async () => {
    const errors: MaintenanceErrorCode[] = [];
    let cleanupCalls = 0;
    const engine = {
      async expireApprovals() {
        throw new Error("database password must not escape diagnostics");
      },
      async cleanupExpiredTraceSnapshots() {
        cleanupCalls++;
        throw new Error("private database failure");
      },
    };
    const maintenance = createExpiryMaintenance({
      engine: engine as never,
      intervalMs: 5,
      onError: (code) => errors.push(code),
    });
    maintenance.start();
    await waitFor(() => cleanupCalls === 1);
    await maintenance.stop();
    expect(errors).toEqual([
      "APPROVAL_EXPIRY_FAILED",
      "TRACE_SNAPSHOT_CLEANUP_FAILED",
    ]);
  });

  it("stops future ticks and waits for the active tick", async () => {
    let expireCalls = 0;
    let cleanupCalls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const engine = {
      async expireApprovals() {
        expireCalls++;
        await gate;
      },
      async cleanupExpiredTraceSnapshots() {
        cleanupCalls++;
      },
    };
    const maintenance = createExpiryMaintenance({
      engine: engine as never,
      intervalMs: 5,
    });
    maintenance.start();
    await waitFor(() => expireCalls === 1);
    const stopping = maintenance.stop();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(expireCalls).toBe(1);
    expect(cleanupCalls).toBe(0);
    release();
    await stopping;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(expireCalls).toBe(1);
    expect(cleanupCalls).toBe(1);
  });
});
