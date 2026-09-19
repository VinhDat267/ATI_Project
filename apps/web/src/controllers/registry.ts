import type { Transport } from "../core/contracts.js";
import type { SessionController } from "../core/session.js";
import {
  createCreateRunController,
  type CreateRunController,
} from "./create-run.js";
import {
  createRunSyncController,
  type RunSyncController,
} from "./run-sync.js";

export interface ControllerRegistry {
  getRunSync(runId: string): RunSyncController;
  getCreateRun(): CreateRunController;
  clear(): void;
}

export function createControllerRegistry(
  transport: Transport,
  session: SessionController,
): ControllerRegistry {
  const runSyncs = new Map<string, RunSyncController>();
  const createRun = createCreateRunController(transport, session);

  return {
    getRunSync(runId: string) {
      let controller = runSyncs.get(runId);
      if (!controller) {
        controller = createRunSyncController(transport, session, runId);
        runSyncs.set(runId, controller);
      }
      return controller;
    },
    getCreateRun() {
      return createRun;
    },
    clear() {
      createRun.reset();
      for (const controller of runSyncs.values()) {
        controller.stop();
      }
      runSyncs.clear();
    },
  };
}

