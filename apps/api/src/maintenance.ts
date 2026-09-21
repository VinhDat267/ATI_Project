import type { WorkflowEngine } from "@wap/engine";

export interface MaintenanceControl {
  start(): void;
  wake(): void;
  stop(): Promise<void>;
}

export type MaintenanceErrorCode =
  "APPROVAL_EXPIRY_FAILED" | "TRACE_SNAPSHOT_CLEANUP_FAILED";

/** Expires approvals and bounded trace snapshots independently from dispatch. */
export function createExpiryMaintenance(options: {
  engine: WorkflowEngine;
  engineFactory?: () => Iterable<WorkflowEngine>;
  intervalMs?: number;
  traceSnapshotBatchSize?: number;
  onError?: (code: MaintenanceErrorCode) => void;
}): MaintenanceControl {
  const intervalMs = options.intervalMs ?? 1_000;
  const traceSnapshotBatchSize = options.traceSnapshotBatchSize ?? 100;
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let stopped = false;
  let active: Promise<void> | undefined;
  const report = (code: MaintenanceErrorCode) => {
    try {
      options.onError?.(code);
    } catch {
      // Diagnostics must never break maintenance.
    }
  };
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    active = (async () => {
      const engines = new Set<WorkflowEngine>([
        options.engine,
        ...(options.engineFactory?.() ?? []),
      ]);
      for (const engine of engines) {
        try {
          await engine.expireApprovals();
        } catch {
          report("APPROVAL_EXPIRY_FAILED");
        }
        try {
          await engine.cleanupExpiredTraceSnapshots(traceSnapshotBatchSize);
        } catch {
          report("TRACE_SNAPSHOT_CLEANUP_FAILED");
        }
      }
    })().finally(() => {
      running = false;
      active = undefined;
    });
    await active;
  };
  return {
    start() {
      if (stopped || timer) return;
      timer = setInterval(() => void tick(), intervalMs);
      void tick();
    },
    wake() {
      void tick();
    },
    async stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = undefined;
      await active;
    },
  };
}
