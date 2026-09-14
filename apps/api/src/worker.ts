import type { Database } from "@wap/db";
import {
  EngineError,
  type WorkflowEngine,
  type PlannerPort,
} from "@wap/engine";

export interface WorkerControl {
  start(): void;
  wake(): void;
  stop(): Promise<void>;
}

/** Single-process prepare dispatcher. PostgreSQL outbox remains the source of truth. */
export function createPrepareWorker(options: {
  db: Database;
  userId: string;
  engine: WorkflowEngine;
  planner?: PlannerPort;
  intervalMs?: number;
}): WorkerControl {
  const intervalMs = options.intervalMs ?? 250;
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let stopped = false;
  let recovering = false;
  let active: Promise<void> | undefined;

  const tick = async () => {
    if (stopped || running || recovering) return;
    running = true;
    active = (async () => {
      const rows = await options.db.client`
        SELECT o.run_id,o.job_kind FROM run_outbox o
        JOIN runs r ON r.id=o.run_id
        WHERE r.user_id=${options.userId}
          AND o.job_kind IN ('prepare','execute') AND o.delivered_at IS NULL
        ORDER BY o.id LIMIT 1
      `;
      if (rows[0]) {
        try {
          if (rows[0].job_kind === "prepare") {
            if (!options.planner)
              throw new EngineError("CONFIG", "Planner is unavailable");
            await options.engine.prepareAccepted(
              rows[0].run_id,
              options.planner,
            );
          } else {
            await options.engine.execute(rows[0].run_id);
          }
        } catch (error) {
          if (error instanceof EngineError && error.code === "BUSY") return;
          await options.db.client.begin(async (tx) => {
            const run = (
              await tx`SELECT status FROM runs WHERE id=${rows[0]!.run_id}`
            )[0];
            if (rows[0]!.job_kind === "prepare") {
              await tx`UPDATE runs SET status='failed',error_message='Preparation worker failed before completion',ended_at=now() WHERE id=${rows[0]!.run_id} AND status IN ('planning','validating','dry_running')`;
            }
            if (
              run &&
              [
                "succeeded",
                "failed",
                "rejected",
                "cancelled",
                "expired",
                "refused",
                "needs_input",
                "reconciliation_required",
              ].includes(run.status)
            )
              await tx`UPDATE run_outbox SET delivered_at=COALESCE(delivered_at,now()) WHERE run_id=${rows[0]!.run_id} AND job_kind=${rows[0]!.job_kind}`;
          });
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
      recovering = true;
      timer = setInterval(() => void tick(), intervalMs);
      void options.engine
        .recoverOrphans()
        .catch(() => undefined)
        .finally(() => {
          recovering = false;
          void tick();
        });
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
