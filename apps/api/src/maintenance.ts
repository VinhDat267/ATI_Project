import type { WorkflowEngine } from "@wap/engine";

export interface MaintenanceControl {
  start(): void;
  wake(): void;
  stop(): Promise<void>;
}

/** Expires pending approvals independently from the planner/execute worker. */
export function createExpiryMaintenance(options: {
  engine: WorkflowEngine;
  intervalMs?: number;
}): MaintenanceControl {
  const intervalMs = options.intervalMs ?? 1_000;
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let stopped = false;
  let active: Promise<void> | undefined;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    active = options.engine
      .expireApprovals()
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
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
