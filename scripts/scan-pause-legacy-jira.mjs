#!/usr/bin/env node
/**
 * Pre-cutover scanner and pauser for legacy `jira.*` schedules and pending plans (Spec §13.4).
 *
 * Usage:
 *   node --import tsx scripts/scan-pause-legacy-jira.mjs --dry-run
 *   node --import tsx scripts/scan-pause-legacy-jira.mjs --apply
 */
import pg from 'pg';
import { scanAndPauseLegacyJiraSchedules } from '../apps/chat-api/src/services/jira-legacy-migration.ts';

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const dryRun = !apply || args.has('--dry-run');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Error: DATABASE_URL is required to scan legacy Jira schedules.');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString });
try {
  const result = await scanAndPauseLegacyJiraSchedules(pool, {
    dryRun,
    notifyOwners: true,
    expirePendingPlans: true,
  });
  console.log(
    JSON.stringify(
      {
        mode: result.dryRun ? 'dry-run' : 'apply',
        scannedActiveCount: result.scannedActiveCount,
        pausedSchedulesCount: result.pausedSchedules.length,
        alreadyPausedCount: result.alreadyPausedSchedules.length,
        pendingLegacyPlansCount: result.pendingLegacyPlans.length,
        expiredPlanIdsCount: result.expiredPlanIds.length,
        notifiedConversationsCount: result.notifiedConversationIds.length,
        pausedScheduleIds: result.pausedSchedules.map((s) => s.id),
        expiredPlanIds: result.expiredPlanIds,
      },
      null,
      2
    )
  );
} finally {
  await pool.end();
}
