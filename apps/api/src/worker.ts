import type { Database } from "@wap/db";
import type { WorkflowEngine, PlannerPort } from "@wap/engine";

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
  planner: PlannerPort;
  intervalMs?: number;
}): WorkerControl {
  const intervalMs = options.intervalMs ?? 250;
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let stopped = false;
  let active: Promise<void> | undefined;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    active = (async () => {
      const rows = await options.db.client`
        SELECT o.run_id FROM run_outbox o
        JOIN runs r ON r.id=o.run_id
        WHERE r.user_id=${options.userId}
          AND o.job_kind='prepare' AND o.delivered_at IS NULL
        ORDER BY o.id LIMIT 1
      `;
      if (rows[0]) {
        try {
          await options.engine.prepareAccepted(rows[0].run_id, options.planner);
        } catch {
          await options.db.client.begin(async (tx) => {
            await tx`UPDATE runs SET status='failed',error_message='Preparation worker failed before completion',ended_at=now() WHERE id=${rows[0]!.run_id} AND status IN ('planning','validating','dry_running')`;
            await tx`UPDATE run_outbox SET delivered_at=COALESCE(delivered_at,now()) WHERE run_id=${rows[0]!.run_id} AND job_kind='prepare'`;
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
