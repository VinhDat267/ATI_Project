import type pg from 'pg';
import { ScheduleService } from '../services/schedules/schedule-service.js';
import { ScheduleRunner, reconcileScheduleRuns, type PlanRun } from '../services/schedules/schedule-runner.js';

export interface ScheduleRuntimeOptions {
  enabled: boolean;
  /** Null when running on memory storage: schedules need PostgreSQL. */
  pool: pg.Pool | null;
  timeZone: string;
  /** Plans one run. Until SCHED-02 connects the planner, every run fails without calling a model. */
  planRun?: PlanRun;
  emit?: (convId: string, event: string, payload: unknown) => unknown;
  now?: () => Date;
}

const notConnected: PlanRun = async () => { throw new Error('Chưa nối planner'); };

/** The scheduler and its service, or nothing when SCHEDULES_ENABLED is off or PostgreSQL is missing. */
export function createScheduleRuntime(options: ScheduleRuntimeOptions) {
  if (!options.enabled || !options.pool) return undefined;
  const { pool, timeZone } = options;
  // Each needs the other; the arrows resolve after both exist.
  const service: ScheduleService = new ScheduleService({ pool, timeZone, runner: { planNow: (runId) => runner.planNow(runId) } });
  const runner: ScheduleRunner = new ScheduleRunner({
    pool, timeZone, planRun: options.planRun ?? notConnected, emit: options.emit, now: options.now,
    recordState: (client, row, now) => service.recordState(client, row, now),
  });
  return { service, runner, reconcile: () => reconcileScheduleRuns(pool) };
}
