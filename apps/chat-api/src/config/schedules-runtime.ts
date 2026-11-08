import type pg from 'pg';
import type { CredentialRepo } from '../db/repositories/credential-repo.js';
import type { RunCalendarDigest } from '../services/schedules/calendar-digest-runner.js';
import { ScheduleService } from '../services/schedules/schedule-service.js';
import { ScheduleRunner, reconcileScheduleRuns, type ExecuteDigestRun, type PlanRun } from '../services/schedules/schedule-runner.js';
import {
  SheetsDigestRunner,
  type SheetsDigestRunnerOptions,
  type SheetsDigestV1CompatPolicy,
  type SheetsDigestV2Mode,
} from '../services/schedules/sheets-digest-runner.js';
import type { RunGithubDigest } from '../services/schedules/github-digest-runner.js';
import type { RunTrelloDigest } from '../services/schedules/trello-digest-runner.js';
import type { RunNotionDigest } from '../services/schedules/notion-digest-runner.js';

export interface ScheduleRuntimeOptions {
  enabled: boolean;
  /** Null when running on memory storage: schedules need PostgreSQL. */
  pool: pg.Pool | null;
  timeZone: string;
  encryptionKey?: string;
  /** Plans one run. Until SCHED-02 connects the planner, every run fails without calling a model. */
  planRun?: PlanRun;
  runDigest?: RunCalendarDigest | RunGithubDigest;
  runGithubDigest?: RunGithubDigest;
  runTrelloDigest?: RunTrelloDigest;
  runNotionDigest?: RunNotionDigest;
  executeDigestRun?: ExecuteDigestRun;
  emit?: (convId: string, event: string, payload: unknown) => unknown;
  now?: () => Date;
  credentialRepo?: CredentialRepo;
  mysheetsEnabled?: boolean;
  sheetsDigestV2Mode?: SheetsDigestV2Mode;
  sheetsDigestV1CompatPolicy?: SheetsDigestV1CompatPolicy;
  sheetsDigestRunner?: SheetsDigestRunner;
  createSheetsDigestAdapter?: SheetsDigestRunnerOptions['createAdapter'];
  summarizeSheetsDigestWithAi?: SheetsDigestRunnerOptions['summarizeWithAi'];
}

const notConnected: PlanRun = async () => { throw new Error('Chưa nối planner'); };

/** The scheduler and its service, or nothing when SCHEDULES_ENABLED is off or PostgreSQL is missing. */
export function createScheduleRuntime(options: ScheduleRuntimeOptions) {
  if (!options.enabled || !options.pool) return undefined;
  const { pool, timeZone } = options;
  // Each needs the other; the arrows resolve after both exist.
  const service: ScheduleService = new ScheduleService({
    pool,
    timeZone,
    runner: { planNow: (runId) => runner.planNow(runId) },
    credentialRepo: options.credentialRepo,
    encryptionKey: options.encryptionKey,
    mysheetsEnabled: options.mysheetsEnabled,
  });
  const sheetsDigestRunner =
    options.sheetsDigestRunner ??
    (options.credentialRepo && options.encryptionKey && options.createSheetsDigestAdapter
      ? new SheetsDigestRunner({
          pool,
          repo: service.repo,
          credentialRepo: options.credentialRepo,
          encryptionKey: options.encryptionKey,
          mysheetsEnabled: options.mysheetsEnabled,
          v2Mode: options.sheetsDigestV2Mode,
          v1CompatPolicy: options.sheetsDigestV1CompatPolicy,
          createAdapter: options.createSheetsDigestAdapter,
          summarizeWithAi: options.summarizeSheetsDigestWithAi,
        })
      : undefined);
  const runner: ScheduleRunner = new ScheduleRunner({
    pool,
    timeZone,
    planRun: options.planRun ?? notConnected,
    runDigest: options.runDigest,
    runGithubDigest: options.runGithubDigest,
    runTrelloDigest: options.runTrelloDigest,
    runNotionDigest: options.runNotionDigest,
    executeDigestRun: options.executeDigestRun,
    emit: options.emit,
    now: options.now,
    recordState: (client, row, now) => service.recordState(client, row, now),
    sheetsDigestRunner,
  });
  return { service, runner, reconcile: () => reconcileScheduleRuns(pool) };
}
