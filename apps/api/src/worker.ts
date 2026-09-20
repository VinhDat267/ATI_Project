import type { Database } from "@wap/db";
import {
  EngineError,
  type WorkflowEngine,
  type PlannerPort,
  type LocalReplanPort,
} from "@wap/engine";

export interface WorkerControl {
  start(): void;
  wake(): void;
  stop(): Promise<void>;
}

/** PostgreSQL owns delivery. Recovery must succeed before any job can start. */
export function createPrepareWorker(options: {
  db: Database;
  userId: string;
  engine: WorkflowEngine;
  planner?: PlannerPort;
  replan?: LocalReplanPort;
  intervalMs?: number;
  shutdownTimeoutMs?: number;
  onError?: (code: string) => void;
}): WorkerControl {
  const interval = options.intervalMs ?? 250;
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? 30_000;
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  let needsRecovery = true;
  let active: Promise<void> | undefined;
  let retryAt = 0;
  let failures = 0;

  async function tick() {
    if (needsRecovery) {
      await options.engine.recoverOrphans();
      needsRecovery = false;
    }
    if (stopped) return;
    const rows = await options.db.client`
      SELECT o.run_id,o.job_kind FROM run_outbox o JOIN runs r ON r.id=o.run_id
      WHERE r.user_id=${options.userId} AND o.job_kind IN ('prepare','execute')
        AND o.delivered_at IS NULL ORDER BY o.id LIMIT 1`;
    if (stopped || !rows[0]) return;
    const job = rows[0];
    try {
      if (job.job_kind === "prepare") {
        if (!options.planner)
          throw new EngineError("CONFIG", "Planner is unavailable");
        await options.engine.prepareAccepted(
          job.run_id,
          options.planner,
          options.replan ? { replan: options.replan } : undefined,
        );
      } else {
        await options.engine.execute(
          job.run_id,
          options.replan ? { replanPort: options.replan } : undefined,
        );
      }
    } catch (error) {
      if (
        error instanceof EngineError &&
        ["BUSY", "LEASE_LOST"].includes(error.code)
      )
        throw error;
      // No writes to lifecycle state outside the engine lease/transaction boundary.
      await options.engine.settleDispatchFailure(job.run_id, job.job_kind);
    }
  }

  function launch() {
    if (stopped || active || Date.now() < retryAt) return;
    active = tick()
      .then(() => {
        failures = 0;
      })
      .catch((error) => {
        needsRecovery = true;
        retryAt =
          Date.now() + Math.min(5000, interval * 2 ** Math.min(failures++, 5));
        const code =
          error instanceof EngineError && error.code === "BUSY"
            ? "BUSY"
            : "WORKER_UNAVAILABLE";
        // Report codes only; DB/transport messages can contain credentials.
        try {
          options.onError?.(code);
        } catch {
          /* Diagnostics cannot crash the dispatcher. */
        }
      })
      .finally(() => {
        active = undefined;
      });
  }

  return {
    start() {
      if (stopped || timer) return;
      timer = setInterval(launch, interval);
      launch();
    },
    wake: launch,
    async stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = undefined;
      const pending = active;
      if (!pending) return;
      if (shutdownTimeoutMs === Number.POSITIVE_INFINITY) {
        await pending;
        return;
      }
      let timeout: NodeJS.Timeout | undefined;
      const result = await Promise.race([
        pending.then(() => "drained" as const),
        new Promise<"timeout">((resolve) => {
          timeout = setTimeout(
            () => resolve("timeout"),
            Math.max(0, shutdownTimeoutMs),
          );
        }),
      ]);
      if (timeout) clearTimeout(timeout);
      if (result === "timeout") {
        try {
          options.onError?.("WORKER_SHUTDOWN_TIMEOUT");
        } catch {
          /* Diagnostics cannot crash shutdown. */
        }
      }
    },
  };
}
