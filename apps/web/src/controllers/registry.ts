import type { Transport } from "../core/contracts.js";
import type { SessionController } from "../core/session.js";
import {
  createRunSyncController,
  type RunSyncController,
} from "./run-sync.js";

export interface ControllerRegistry {
  getRunSync(runId: string): RunSyncController;
  clear(): void;
}

export function createControllerRegistry(
  transport: Transport,
  session: SessionController,
): ControllerRegistry {
  const runSyncs = new Map<string, RunSyncController>();

  return {
    getRunSync(runId: string) {
      let controller = runSyncs.get(runId);
      if (!controller) {
        controller = createRunSyncController(transport, session, runId);
        runSyncs.set(runId, controller);
      }
      return controller;
    },
    clear() {
      for (const controller of runSyncs.values()) {
        controller.stop();
      }
      runSyncs.clear();
    },
  };
}
