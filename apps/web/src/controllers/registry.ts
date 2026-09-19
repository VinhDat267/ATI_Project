import type { Transport } from "../core/contracts.js";
import type { SessionController } from "../core/session.js";
import {
  createCreateRunController,
  type CreateRunController,
} from "./create-run.js";
import {
  createRunCommandController,
  type RunCommandController,
} from "./run-commands.js";
import {
  createRunSyncController,
  type RunSyncController,
} from "./run-sync.js";
import {
  createTraceController,
  type TraceController,
} from "./trace.js";

export interface ControllerRegistry {
  getRunSync(runId: string): RunSyncController;
  getRunCommands(runId: string): RunCommandController;
  getCreateRun(): CreateRunController;
  getTrace(runId: string): TraceController;
  clear(): void;
}

export function createControllerRegistry(
  transport: Transport,
  session: SessionController,
): ControllerRegistry {
  const runSyncs = new Map<string, RunSyncController>();
  const runCommands = new Map<string, RunCommandController>();
  const traces = new Map<string, TraceController>();
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
    getRunCommands(runId: string) {
      let controller = runCommands.get(runId);
      if (!controller) {
        controller = createRunCommandController(transport, session, runId);
        runCommands.set(runId, controller);
      }
      return controller;
    },
    getCreateRun() {
      return createRun;
    },
    getTrace(runId: string) {
      let controller = traces.get(runId);
      if (!controller) {
        controller = createTraceController(transport, session, runId);
        traces.set(runId, controller);
      }
      return controller;
    },
    clear() {
      createRun.teardown();
      for (const controller of runCommands.values()) {
        controller.reset();
      }
      runCommands.clear();
      for (const controller of traces.values()) {
        controller.reset();
      }
      traces.clear();
      for (const controller of runSyncs.values()) {
        controller.stop();
      }
      runSyncs.clear();
    },
  };
}

