import type pg from 'pg';
import { isJiraG2AAllowedTool } from '@wap/tool-schemas';

export const LEGACY_JIRA_PAUSE_REASON = 'legacy_jira_retired';

export interface LegacyJiraScheduleItem {
  id: string;
  userId: string;
  convId: string;
  name: string;
  request: string;
  services: string[];
  status: string;
  pauseReason: string | null;
  version: number;
}

export interface LegacyJiraPendingPlanItem {
  id: string;
  convId: string;
  userId: string;
  status: string;
  tools: string[];
}

export interface ScanPauseLegacyJiraOptions {
  dryRun?: boolean;
  notifyOwners?: boolean;
  expirePendingPlans?: boolean;
}

export interface ScanPauseLegacyJiraResult {
  dryRun: boolean;
  scannedActiveCount: number;
  pausedSchedules: LegacyJiraScheduleItem[];
  alreadyPausedSchedules: LegacyJiraScheduleItem[];
  pendingLegacyPlans: LegacyJiraPendingPlanItem[];
  expiredPlanIds: string[];
  notifiedConversationIds: string[];
}

function extractLegacyJiraTools(planJson: unknown): string[] {
  if (!planJson || typeof planJson !== 'object') return [];
  const rawSteps = Array.isArray((planJson as { steps?: unknown }).steps)
    ? ((planJson as { steps: unknown[] }).steps)
    : [];
  const tools: string[] = [];
  for (const step of rawSteps) {
    if (step && typeof step === 'object' && typeof (step as { tool?: unknown }).tool === 'string') {
      const tool = (step as { tool: string }).tool;
      if (tool.startsWith('jira.') || (tool.startsWith('myjira.') && !isJiraG2AAllowedTool(tool))) {
        tools.push(tool);
      }
    }
  }
  return [...new Set(tools)];
}

export function buildLegacyJiraPausedMessage(scheduleName: string): string {
  return `Lịch "${scheduleName}" đã tạm dừng (${LEGACY_JIRA_PAUSE_REASON}): Kết nối Jira dùng chung đã ngừng hoạt động khi chuyển sang Jira OAuth cá nhân (3LO). Hệ thống không tự động chuyển hoặc chạy lịch cũ bằng tài khoản cá nhân của bạn.`;
}

/**
 * Scans legacy Jira schedules (`'jira' = ANY(services)` or `jira.*` tool references in `request`)
 * and pending legacy `jira.*` plans.
 *
 * When `dryRun` is false (default):
 * - Pauses every active legacy Jira schedule (`status = 'paused'`, `pause_reason = 'legacy_jira_retired'`,
 *   `version = version + 1`, `next_run_at = NULL`) without rewriting `request` or `services` to `myjira`.
 * - Writes an owner notification message into each paused schedule's conversation.
 * - Optionally expires pending legacy `jira.*` plans so they cannot be approved after cutover.
 */
export async function scanAndPauseLegacyJiraSchedules(
  pool: pg.Pool,
  options: ScanPauseLegacyJiraOptions = {}
): Promise<ScanPauseLegacyJiraResult> {
  const dryRun = options.dryRun ?? false;
  const notifyOwners = options.notifyOwners ?? true;
  const expirePendingPlans = options.expirePendingPlans ?? true;

  const scheduleRows = await pool.query<{
    id: string;
    user_id: string;
    conv_id: string;
    name: string;
    request: string;
    services: string[];
    status: string;
    pause_reason: string | null;
    version: number;
  }>(
    `SELECT id, user_id, conv_id, name, request, services, status, pause_reason, version
     FROM schedules
     WHERE ('jira' = ANY(services) OR 'myjira' = ANY(services) OR request ~* '(?<![a-z0-9_])(my)?jira\\.(create_issue|add_comment|update_issue|transition_issue|assign_issue|list_sites|get_issue|search_projects|search_issues)')
       AND status IN ('active', 'paused')
     ORDER BY created_at ASC, id ASC`
  );

  const activeCandidates = scheduleRows.rows.filter((r) => r.status === 'active');
  const alreadyPausedSchedules: LegacyJiraScheduleItem[] = scheduleRows.rows
    .filter((r) => r.status === 'paused')
    .map((r) => ({
      id: r.id,
      userId: r.user_id,
      convId: r.conv_id,
      name: r.name,
      request: r.request,
      services: r.services,
      status: r.status,
      pauseReason: r.pause_reason,
      version: r.version,
    }));

  const planRows = await pool.query<{
    id: string;
    conv_id: string;
    user_id: string;
    status: string;
    plan_json: unknown;
  }>(
    `SELECT p.id, p.conv_id, c.user_id, p.status, p.plan_json
     FROM plans p
     JOIN conversations c ON c.id = p.conv_id
     WHERE p.status = 'pending'
       AND (p.plan_json::text LIKE '%"jira.%' OR p.plan_json::text LIKE '%"myjira.%')
     ORDER BY p.created_at ASC, p.id ASC`
  );

  const pendingLegacyPlans: LegacyJiraPendingPlanItem[] = planRows.rows
    .map((row) => ({
      id: row.id,
      convId: row.conv_id,
      userId: row.user_id,
      status: row.status,
      tools: extractLegacyJiraTools(row.plan_json),
    }))
    .filter((item) => item.tools.length > 0);

  if (dryRun) {
    return {
      dryRun: true,
      scannedActiveCount: activeCandidates.length,
      pausedSchedules: activeCandidates.map((r) => ({
        id: r.id,
        userId: r.user_id,
        convId: r.conv_id,
        name: r.name,
        request: r.request,
        services: r.services,
        status: r.status,
        pauseReason: r.pause_reason,
        version: r.version,
      })),
      alreadyPausedSchedules,
      pendingLegacyPlans,
      expiredPlanIds: [],
      notifiedConversationIds: [],
    };
  }

  const pausedSchedules: LegacyJiraScheduleItem[] = [];
  const notifiedConversationIds: string[] = [];
  const expiredPlanIds: string[] = [];

  for (const candidate of activeCandidates) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Respect lock hierarchy: conversation first, then schedule row.
      await client.query('SELECT id FROM conversations WHERE id = $1 FOR UPDATE', [candidate.conv_id]);
      const updated = await client.query<{
        id: string;
        user_id: string;
        conv_id: string;
        name: string;
        request: string;
        services: string[];
        status: string;
        pause_reason: string | null;
        version: number;
      }>(
        `UPDATE schedules
         SET status = 'paused',
             pause_reason = $2,
             version = version + 1,
             next_run_at = NULL,
             updated_at = now()
         WHERE id = $1 AND status = 'active'
         RETURNING id, user_id, conv_id, name, request, services, status, pause_reason, version`,
        [candidate.id, LEGACY_JIRA_PAUSE_REASON]
      );

      const row = updated.rows[0];
      if (row) {
        pausedSchedules.push({
          id: row.id,
          userId: row.user_id,
          convId: row.conv_id,
          name: row.name,
          request: row.request,
          services: row.services,
          status: row.status,
          pauseReason: row.pause_reason,
          version: row.version,
        });

        if (notifyOwners) {
          await client.query(
            `INSERT INTO messages (conv_id, role, content, metadata)
             VALUES ($1, 'system', $2, $3::jsonb)`,
            [
              row.conv_id,
              buildLegacyJiraPausedMessage(row.name),
              JSON.stringify({
                type: 'schedule_paused',
                reason: LEGACY_JIRA_PAUSE_REASON,
                scheduleId: row.id,
                scheduleVersion: row.version,
              }),
            ]
          );
          notifiedConversationIds.push(row.conv_id);
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  if (expirePendingPlans && pendingLegacyPlans.length > 0) {
    const ids = pendingLegacyPlans.map((p) => p.id);
    const expRes = await pool.query<{ id: string }>(
      `UPDATE plans
       SET status = 'expired',
           decided_at = now()
       WHERE id = ANY($1::uuid[]) AND status = 'pending'
       RETURNING id`,
      [ids]
    );
    for (const r of expRes.rows) {
      expiredPlanIds.push(r.id);
    }
  }

  return {
    dryRun: false,
    scannedActiveCount: activeCandidates.length,
    pausedSchedules,
    alreadyPausedSchedules,
    pendingLegacyPlans,
    expiredPlanIds,
    notifiedConversationIds,
  };
}
