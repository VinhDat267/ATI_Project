import type pg from 'pg';
import { decryptCredentials } from '@wap/tool-adapters';
import {
  isSheetsDigestConfigV2,
  type ScheduleKind,
  type ScheduleRecurrence,
  type ScheduleStatus,
  type ScheduleView,
  type SheetsDigestConfig,
  type SheetsDigestConfigV1,
  type SheetsDigestConfigV2,
  type SheetsDigestWorkspaceMode,
} from '@wap/tool-schemas';
import type { ServiceCredentialRow } from '../../db/repositories/credential-repo.js';
import { MessageRepo } from '../../db/repositories/message-repo.js';
import {
  computeSheetsDigestHash,
  computeSheetsDigestV1Hash,
  resolveTrustedScheduleScope,
} from './sheets-digest-candidate.js';

export const REAUTH_REQUIRED_PAUSE_REASON =
  'REAUTH_REQUIRED: Lịch tổng hợp Google Sheets phiên bản cũ (v1) cần xem trước và xác nhận cấp quyền lại theo chuẩn bảo mật v2.';

export const SHEETS_DIGEST_V2_EVIDENCE_BOUNDARY_NOTE =
  'service_credentials has no updated_at column or config-mutation audit log prior to 0033; Class A (v1_pinned_consistency_candidate) establishes consistency eligibility only and does NOT prove config immutability. Default SHEETS_DIGEST_V1_COMPAT_POLICY is strict_pause_all unless operator explicitly sets allow_consistency_candidate after reviewing this inventory.';

export type SheetsDigestMigrationMode = 'inventory' | 'dry-run' | 'apply' | 'rollback';

export type SheetsDigestV1CompatPolicy = 'strict_pause_all' | 'allow_consistency_candidate';

export type SheetsDigestCompatClass =
  | 'v1_pinned_consistency_candidate'
  | 'v1_unpinned_fail_closed'
  | 'v2_ready';

export type SheetsDigestEvidenceBoundary =
  | 'consistency_only_not_config_immutability_proof'
  | 'unpinned_or_inconsistent'
  | 'v2_pinned';

export type SheetsDigestMigrationOutcome =
  | 'upgraded_v2'
  | 'paused_reauth_required'
  | 'already_v2'
  | 'inactive_preserved';

export type SheetsDigestRollbackOutcome =
  | 'restored_previous_state'
  | 'restored_paused_due_to_revocation'
  | 'skipped_user_modified';

export interface SheetsDigestInventorySummaryGroup {
  workspaceMode: SheetsDigestWorkspaceMode;
  status: ScheduleStatus;
  configVersion: number;
  hasSourceCredId: boolean;
  hasDestCredId: boolean;
  compatClass: SheetsDigestCompatClass;
  evidenceBoundary: SheetsDigestEvidenceBoundary;
  count: number;
}

export interface SheetsDigestMigrationItem {
  scheduleId: string;
  userId: string;
  convId: string;
  workspaceMode: SheetsDigestWorkspaceMode;
  workspaceId: string | null;
  status: ScheduleStatus;
  previousStatus: ScheduleStatus;
  newStatus: ScheduleStatus;
  previousVersion: number;
  migratedVersion: number;
  configVersion: number;
  sourceService: string | null;
  destService: string | null;
  hasSourceCredId: boolean;
  hasDestCredId: boolean;
  compatClass: SheetsDigestCompatClass;
  evidenceBoundary: SheetsDigestEvidenceBoundary;
  reasons: string[];
  outcome: SheetsDigestMigrationOutcome;
  reasonCode: string;
  reasonDetail: string;
}

export interface SheetsDigestRollbackItem {
  scheduleId: string;
  userId: string;
  auditOutcome: SheetsDigestMigrationOutcome;
  migratedScheduleVer: number;
  currentScheduleVer: number | null;
  rollbackOutcome: SheetsDigestRollbackOutcome;
  reasons: string[];
}

export interface SheetsDigestMigrationReport {
  mode: SheetsDigestMigrationMode;
  v1CompatPolicy: SheetsDigestV1CompatPolicy;
  evidenceBoundaryNote: string;
  summary: {
    totalSchedules: number;
    countsByClass: Record<SheetsDigestCompatClass, number>;
    countsByOutcome: Record<SheetsDigestMigrationOutcome, number>;
    countsByRollbackOutcome: Record<SheetsDigestRollbackOutcome, number>;
    evidenceBoundaryNote: string;
    groups: SheetsDigestInventorySummaryGroup[];
  };
  items: SheetsDigestMigrationItem[];
  rollbackItems: SheetsDigestRollbackItem[];
}

export interface RunSheetsDigestV2MigrationOptions {
  mode: SheetsDigestMigrationMode;
  encryptionKey?: string;
  v1CompatPolicy?: SheetsDigestV1CompatPolicy;
  classAPolicy?: SheetsDigestV1CompatPolicy;
  confirmProductionApply?: boolean;
  confirmProductionRollback?: boolean;
  scheduleId?: string;
  notifyOwners?: boolean;
}

export interface RawSheetsDigestScheduleRow {
  id: string;
  user_id: string;
  conv_id: string;
  name?: string;
  request?: string;
  services?: string[];
  kind?: ScheduleKind | string;
  workspace_mode: SheetsDigestWorkspaceMode | null;
  workspace_id: string | null;
  status: ScheduleStatus;
  pause_reason?: string | null;
  next_run_at?: Date | string | null;
  version?: number;
  recurrence: ScheduleRecurrence;
  digest_config: any;
  digest_config_hash: string | null;
  digest_approved_at: Date | string | null;
  created_at?: Date | string;
  updated_at?: Date | string;
  user_status: string | null;
}

interface MigrationAuditRow {
  id: string;
  schedule_id: string;
  schedule_conv_id: string | null;
  user_id: string;
  workspace_mode: string | null;
  workspace_id: string | null;
  previous_status: ScheduleStatus;
  previous_pause_reason: string | null;
  previous_next_run_at: Date | null;
  previous_schedule_ver: number;
  migrated_schedule_ver: number;
  previous_config_version: number | null;
  previous_digest_config: any;
  previous_config_hash: string | null;
  outcome: SheetsDigestMigrationOutcome;
  reason_code: string;
  reason_detail: string;
  migrated_at: Date;
  rolled_back_at: Date | null;
  rollback_outcome: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isNonEmptyUuid(val: unknown): val is string {
  return typeof val === 'string' && UUID_RE.test(val.trim());
}

function normalizeEmail(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

function toTimestampMs(val: Date | string | null | undefined): number | null {
  if (!val) return null;
  const ms = val instanceof Date ? val.getTime() : Date.parse(String(val));
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Evaluates Spec §2.6.1 Class A (`v1_pinned_consistency_candidate`) criteria for a `version: 1`
 * `sheets_digest` schedule.
 *
 * IMPORTANT EVIDENCE BOUNDARY:
 * `service_credentials` has no `updated_at` column or config-mutation audit log prior to `0033`.
 * Satisfying all 6 criteria establishes Class A (`consistency_only_not_config_immutability_proof`)
 * and does NOT prove config immutability.
 */
export function evaluateV1IdentityProven(input: {
  schedule: RawSheetsDigestScheduleRow;
  credentialsById: ReadonlyMap<string, ServiceCredentialRow>;
  encryptionKey: string;
}): {
  proven: boolean;
  evidenceBoundary: 'consistency_only_not_config_immutability_proof' | 'unpinned_or_inconsistent';
  reasons: string[];
  senderEmail?: string;
} {
  const { schedule, credentialsById, encryptionKey } = input;
  const reasons: string[] = [];
  const config = schedule.digest_config;
  const wsMode = schedule.workspace_mode ?? 'legacy';
  let resolvedSenderEmail: string | undefined;

  // Criterion 1: workspace_mode IN ('personal', 'legacy') AND workspace_id IS NULL
  if ((wsMode !== 'personal' && wsMode !== 'legacy') || schedule.workspace_id !== null) {
    reasons.push('ORG_V1_UNPINNED_WORKSPACE_SCOPE');
  }

  // Criterion 2: source.service === 'mysheets' with non-empty UUID source.credentialId AND valid source.email
  const source = config?.source;
  const sourceCredId = source?.credentialId;
  const sourceEmail = normalizeEmail(source?.email);

  if (source?.service !== 'mysheets') {
    reasons.push('SOURCE_SERVICE_NOT_MYSHEETS');
  }
  if (!isNonEmptyUuid(sourceCredId)) {
    reasons.push('MISSING_SOURCE_CREDENTIAL_ID');
  }
  if (!sourceEmail || !sourceEmail.includes('@')) {
    reasons.push('MISSING_SOURCE_EMAIL');
  }

  // Criterion 3: destination.service === 'gmail' with non-empty UUID destination.credentialId AND valid recipientEmail
  const dest = config?.destination;
  const destCredId = dest?.credentialId;
  const recipientEmail = normalizeEmail(dest?.recipientEmail);

  if (dest?.service !== 'gmail') {
    reasons.push('DEST_SERVICE_NOT_GMAIL');
  }
  if (!isNonEmptyUuid(destCredId)) {
    reasons.push('MISSING_DEST_CREDENTIAL_ID');
  }
  if (!recipientEmail || !recipientEmail.includes('@')) {
    reasons.push('INVALID_DEST_RECIPIENT_EMAIL');
  }

  const approvedAtMs = toTimestampMs(schedule.digest_approved_at);
  if (approvedAtMs === null) {
    reasons.push('MISSING_DIGEST_APPROVED_AT');
  }

  // Criterion 4: Live source credential row consistency verification
  if (source?.service === 'mysheets' && isNonEmptyUuid(sourceCredId)) {
    const srcRow = credentialsById.get(sourceCredId);
    if (
      !srcRow ||
      srcRow.service !== 'mysheets' ||
      srcRow.user_id !== schedule.user_id ||
      srcRow.workspace_id !== null ||
      srcRow.status !== 'active'
    ) {
      reasons.push('SOURCE_CREDENTIAL_INACTIVE_OR_MISSING');
    } else {
      const createdMs = toTimestampMs(srcRow.created_at);
      if (approvedAtMs !== null && (createdMs === null || createdMs > approvedAtMs)) {
        reasons.push('SOURCE_CREDENTIAL_CREATED_AFTER_APPROVAL');
      }
      const statusChangedMs = toTimestampMs(srcRow.status_changed_at);
      if (approvedAtMs !== null && statusChangedMs !== null && statusChangedMs > approvedAtMs) {
        reasons.push('SOURCE_CREDENTIAL_STATUS_CHANGED_AFTER_APPROVAL');
      }
      try {
        const decSource = decryptCredentials(srcRow.config, encryptionKey);
        const connectedAtMs = toTimestampMs(decSource?.connectedAt);
        if (approvedAtMs !== null && connectedAtMs !== null && connectedAtMs > approvedAtMs) {
          reasons.push('SOURCE_CREDENTIAL_CONNECTED_AFTER_APPROVAL');
        }
        const liveEmail = normalizeEmail(decSource?.email);
        if (!liveEmail || (sourceEmail && liveEmail !== sourceEmail)) {
          reasons.push('SOURCE_EMAIL_MISMATCH');
        }
        const allowedSpreadsheets: string[] = Array.isArray(decSource?.allowedScope?.spreadsheets)
          ? decSource.allowedScope.spreadsheets
          : Array.isArray(decSource?.selectedSpreadsheets)
            ? decSource.selectedSpreadsheets.map((s: any) => String(s?.id ?? ''))
            : [];
        if (
          typeof source?.spreadsheetId !== 'string' ||
          !allowedSpreadsheets.includes(source.spreadsheetId)
        ) {
          reasons.push('SOURCE_SPREADSHEET_OUT_OF_SCOPE');
        }
      } catch {
        reasons.push('SOURCE_CREDENTIAL_DECRYPT_FAILED');
      }
    }
  }

  // Criterion 5: Live destination credential row consistency verification
  if (dest?.service === 'gmail' && isNonEmptyUuid(destCredId)) {
    const destRow = credentialsById.get(destCredId);
    if (
      !destRow ||
      destRow.service !== 'gmail' ||
      destRow.user_id !== schedule.user_id ||
      destRow.workspace_id !== null ||
      destRow.status !== 'active'
    ) {
      reasons.push('DEST_CREDENTIAL_INACTIVE_OR_MISSING');
    } else {
      const createdMs = toTimestampMs(destRow.created_at);
      if (approvedAtMs !== null && (createdMs === null || createdMs > approvedAtMs)) {
        reasons.push('DEST_CREDENTIAL_CREATED_AFTER_APPROVAL');
      }
      const statusChangedMs = toTimestampMs(destRow.status_changed_at);
      if (approvedAtMs !== null && statusChangedMs !== null && statusChangedMs > approvedAtMs) {
        reasons.push('DEST_CREDENTIAL_STATUS_CHANGED_AFTER_APPROVAL');
      }
      try {
        const decDest = decryptCredentials(destRow.config, encryptionKey);
        const connectedAtMs = toTimestampMs(decDest?.connectedAt);
        if (approvedAtMs !== null && connectedAtMs !== null && connectedAtMs > approvedAtMs) {
          reasons.push('DEST_CREDENTIAL_CONNECTED_AFTER_APPROVAL');
        }
        const senderEmail = normalizeEmail(decDest?.email);
        if (!senderEmail || !senderEmail.includes('@')) {
          reasons.push('DEST_SENDER_EMAIL_MISSING');
        } else {
          resolvedSenderEmail = senderEmail;
        }
      } catch {
        reasons.push('DEST_CREDENTIAL_DECRYPT_FAILED');
      }
    }
  }

  // Criterion 6: Active user and matching v1 digest_config_hash
  if (schedule.user_status !== 'active') {
    reasons.push('USER_INACTIVE');
  }
  try {
    if (!config || typeof config !== 'object' || !schedule.digest_config_hash) {
      reasons.push('DIGEST_CONFIG_HASH_MISMATCH');
    } else {
      const expectedV1Hash = computeSheetsDigestV1Hash({
        userId: schedule.user_id,
        recurrence: schedule.recurrence,
        config: config as SheetsDigestConfig,
      });
      if (expectedV1Hash !== schedule.digest_config_hash) {
        reasons.push('DIGEST_CONFIG_HASH_MISMATCH');
      }
    }
  } catch {
    reasons.push('DIGEST_CONFIG_HASH_MISMATCH');
  }

  const proven = reasons.length === 0;
  return {
    proven,
    evidenceBoundary: proven
      ? 'consistency_only_not_config_immutability_proof'
      : 'unpinned_or_inconsistent',
    reasons,
    ...(resolvedSenderEmail ? { senderEmail: resolvedSenderEmail } : {}),
  };
}

function classifyScheduleMigrationItem(input: {
  row: RawSheetsDigestScheduleRow;
  credentialsById: ReadonlyMap<string, ServiceCredentialRow>;
  encryptionKey: string;
  v1CompatPolicy: SheetsDigestV1CompatPolicy;
}): SheetsDigestMigrationItem & { senderEmail?: string } {
  const { row, credentialsById, encryptionKey, v1CompatPolicy } = input;
  const trustedScope = resolveTrustedScheduleScope(row);
  const workspaceMode = trustedScope.workspaceMode;
  const config = row.digest_config ?? {};
  const configVersion = typeof config.version === 'number' ? config.version : 1;
  const sourceService = typeof config?.source?.service === 'string' ? config.source.service : null;
  const destService =
    typeof config?.destination?.service === 'string' ? config.destination.service : null;
  const hasSourceCredId = isNonEmptyUuid(config?.source?.credentialId);
  const hasDestCredId = isNonEmptyUuid(config?.destination?.credentialId);
  const previousVersion = typeof row.version === 'number' ? row.version : 1;

  if (configVersion === 2 && isSheetsDigestConfigV2(config)) {
    return {
      scheduleId: row.id,
      userId: row.user_id,
      convId: row.conv_id,
      workspaceMode,
      workspaceId: trustedScope.workspaceId,
      status: row.status,
      previousStatus: row.status,
      newStatus: row.status,
      previousVersion,
      migratedVersion: previousVersion,
      configVersion: 2,
      sourceService,
      destService,
      hasSourceCredId,
      hasDestCredId,
      compatClass: 'v2_ready',
      evidenceBoundary: 'v2_pinned',
      reasons: [],
      outcome: 'already_v2',
      reasonCode: 'ALREADY_V2',
      reasonDetail: 'Schedule is already on SheetsDigestConfigV2 (version: 2).',
    };
  }

  const evaluation = evaluateV1IdentityProven({
    schedule: row,
    credentialsById,
    encryptionKey,
  });

  const compatClass: SheetsDigestCompatClass = evaluation.proven
    ? 'v1_pinned_consistency_candidate'
    : 'v1_unpinned_fail_closed';
  const evidenceBoundary: SheetsDigestEvidenceBoundary = evaluation.evidenceBoundary;
  const reasons = evaluation.reasons;

  if (row.status !== 'active') {
    return {
      scheduleId: row.id,
      userId: row.user_id,
      convId: row.conv_id,
      workspaceMode,
      workspaceId: trustedScope.workspaceId,
      status: row.status,
      previousStatus: row.status,
      newStatus: row.status,
      previousVersion,
      migratedVersion: previousVersion,
      configVersion,
      sourceService,
      destService,
      hasSourceCredId,
      hasDestCredId,
      compatClass,
      evidenceBoundary,
      reasons,
      outcome: 'inactive_preserved',
      reasonCode: 'INACTIVE_STATUS_PRESERVED',
      reasonDetail: `Preserved non-active schedule status (${row.status}).`,
    };
  }

  if (
    v1CompatPolicy === 'allow_consistency_candidate' &&
    compatClass === 'v1_pinned_consistency_candidate' &&
    evaluation.senderEmail
  ) {
    return {
      scheduleId: row.id,
      userId: row.user_id,
      convId: row.conv_id,
      workspaceMode,
      workspaceId: trustedScope.workspaceId,
      status: row.status,
      previousStatus: row.status,
      newStatus: 'active',
      previousVersion,
      migratedVersion: previousVersion + 1,
      configVersion,
      sourceService,
      destService,
      hasSourceCredId,
      hasDestCredId,
      compatClass,
      evidenceBoundary,
      reasons,
      outcome: 'upgraded_v2',
      reasonCode: 'CLASS_A_CONSISTENCY_UPGRADED',
      reasonDetail:
        'Upgraded Class A (mysheets -> gmail) schedule to v2 under explicit allow_consistency_candidate policy.',
      senderEmail: evaluation.senderEmail,
    };
  }

  const reasonCode =
    compatClass === 'v1_pinned_consistency_candidate'
      ? 'STRICT_PAUSE_ALL_CLASS_A_PAUSED'
      : reasons[0] ?? 'V1_UNPINNED_FAIL_CLOSED';

  const reasonDetail =
    compatClass === 'v1_pinned_consistency_candidate'
      ? 'Paused under default strict_pause_all policy (Class A consistency candidate does not prove config immutability).'
      : `Paused fail-closed Class B v1 schedule: ${reasons.join(', ') || 'V1_UNPINNED_FAIL_CLOSED'}`;

  return {
    scheduleId: row.id,
    userId: row.user_id,
    convId: row.conv_id,
    workspaceMode,
    workspaceId: trustedScope.workspaceId,
    status: row.status,
    previousStatus: row.status,
    newStatus: 'paused',
    previousVersion,
    migratedVersion: previousVersion + 1,
    configVersion,
    sourceService,
    destService,
    hasSourceCredId,
    hasDestCredId,
    compatClass,
    evidenceBoundary,
    reasons,
    outcome: 'paused_reauth_required',
    reasonCode,
    reasonDetail,
  };
}

function buildPauseNotificationText(scheduleName: string | undefined): string {
  const label = scheduleName?.trim() || 'Báo cáo định kỳ Google Sheets';
  return `Lịch "${label}" đã tạm dừng (${REAUTH_REQUIRED_PAUSE_REASON})`;
}

async function upsertAuditRow(
  client: pg.PoolClient,
  input: {
    scheduleId: string;
    userId: string;
    workspaceMode: string | null;
    workspaceId: string | null;
    previousStatus: string;
    previousPauseReason: string | null;
    previousNextRunAt: Date | string | null;
    previousScheduleVer: number;
    migratedScheduleVer: number;
    previousConfigVersion: number | null;
    previousDigestConfig: unknown;
    previousConfigHash: string | null;
    outcome: SheetsDigestMigrationOutcome;
    reasonCode: string;
    reasonDetail: string;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO sheets_digest_v2_migration_audit (
       schedule_id,
       user_id,
       workspace_mode,
       workspace_id,
       previous_status,
       previous_pause_reason,
       previous_next_run_at,
       previous_schedule_ver,
       migrated_schedule_ver,
       previous_config_version,
       previous_digest_config,
       previous_config_hash,
       outcome,
       reason_code,
       reason_detail,
       migrated_at,
       rolled_back_at,
       rollback_outcome
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15, now(), NULL, NULL)
     ON CONFLICT (schedule_id) DO UPDATE SET
       user_id = EXCLUDED.user_id,
       workspace_mode = EXCLUDED.workspace_mode,
       workspace_id = EXCLUDED.workspace_id,
       previous_status = EXCLUDED.previous_status,
       previous_pause_reason = EXCLUDED.previous_pause_reason,
       previous_next_run_at = EXCLUDED.previous_next_run_at,
       previous_schedule_ver = EXCLUDED.previous_schedule_ver,
       migrated_schedule_ver = EXCLUDED.migrated_schedule_ver,
       previous_config_version = EXCLUDED.previous_config_version,
       previous_digest_config = EXCLUDED.previous_digest_config,
       previous_config_hash = EXCLUDED.previous_config_hash,
       outcome = EXCLUDED.outcome,
       reason_code = EXCLUDED.reason_code,
       reason_detail = EXCLUDED.reason_detail,
       migrated_at = now(),
       rolled_back_at = NULL,
       rollback_outcome = NULL`,
    [
      input.scheduleId,
      input.userId,
      input.workspaceMode,
      input.workspaceId,
      input.previousStatus,
      input.previousPauseReason,
      input.previousNextRunAt,
      input.previousScheduleVer,
      input.migratedScheduleVer,
      input.previousConfigVersion,
      JSON.stringify(input.previousDigestConfig ?? {}),
      input.previousConfigHash,
      input.outcome,
      input.reasonCode,
      input.reasonDetail,
    ]
  );
}

export async function runSheetsDigestV2Migration(
  pool: pg.Pool,
  options: RunSheetsDigestV2MigrationOptions
): Promise<SheetsDigestMigrationReport> {
  const mode = options.mode;
  const encryptionKey = options.encryptionKey ?? process.env.CREDENTIALS_ENCRYPTION_KEY ?? '';
  const notifyOwners = options.notifyOwners ?? true;
  const scheduleIdFilter =
    typeof options.scheduleId === 'string' && isNonEmptyUuid(options.scheduleId)
      ? options.scheduleId.trim()
      : null;

  const v1CompatPolicy: SheetsDigestV1CompatPolicy =
    options.v1CompatPolicy ??
    options.classAPolicy ??
    (process.env.SHEETS_DIGEST_V1_COMPAT_POLICY === 'allow_consistency_candidate'
      ? 'allow_consistency_candidate'
      : 'strict_pause_all');

  if (mode === 'apply' && options.confirmProductionApply !== true) {
    const err = new Error(
      'CONFIRM_PRODUCTION_APPLY_REQUIRED: --confirm-production-apply (confirmProductionApply: true) is required before executing --mode=apply.'
    );
    (err as any).code = 'CONFIRM_PRODUCTION_APPLY_REQUIRED';
    throw err;
  }

  if (mode === 'rollback' && options.confirmProductionRollback !== true) {
    const err = new Error(
      'CONFIRM_PRODUCTION_ROLLBACK_REQUIRED: --confirm-production-rollback (confirmProductionRollback: true) is required before executing --mode=rollback.'
    );
    (err as any).code = 'CONFIRM_PRODUCTION_ROLLBACK_REQUIRED';
    throw err;
  }

  const countsByClass: Record<SheetsDigestCompatClass, number> = {
    v1_pinned_consistency_candidate: 0,
    v1_unpinned_fail_closed: 0,
    v2_ready: 0,
  };
  const countsByOutcome: Record<SheetsDigestMigrationOutcome, number> = {
    upgraded_v2: 0,
    paused_reauth_required: 0,
    already_v2: 0,
    inactive_preserved: 0,
  };
  const countsByRollbackOutcome: Record<SheetsDigestRollbackOutcome, number> = {
    restored_previous_state: 0,
    restored_paused_due_to_revocation: 0,
    skipped_user_modified: 0,
  };

  if (mode === 'rollback') {
    const auditRes = await pool.query<MigrationAuditRow>(
      `SELECT a.*, s.conv_id AS schedule_conv_id
       FROM sheets_digest_v2_migration_audit a
       LEFT JOIN schedules s ON s.id = a.schedule_id
       WHERE a.rolled_back_at IS NULL
         AND a.outcome IN ('upgraded_v2', 'paused_reauth_required')
         AND ($1::uuid IS NULL OR a.schedule_id = $1::uuid)
       ORDER BY a.migrated_at ASC, a.id ASC`,
      [scheduleIdFilter]
    );

    const rollbackItems: SheetsDigestRollbackItem[] = [];

    for (const audit of auditRes.rows) {
      if (!audit.schedule_conv_id || !isNonEmptyUuid(audit.schedule_conv_id)) {
        continue;
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout = '5s'");

        // Canonical lock order: 1. conversations FOR UPDATE -> 2. schedules FOR UPDATE
        await client.query('SELECT id FROM conversations WHERE id = $1 FOR UPDATE', [
          audit.schedule_conv_id,
        ]);

        const schedRes = await client.query<
          RawSheetsDigestScheduleRow & {
            version: number;
            pause_reason: string | null;
            next_run_at: Date | null;
          }
        >('SELECT * FROM schedules WHERE id = $1 FOR UPDATE', [audit.schedule_id]);
        const s = schedRes.rows[0];
        if (!s) {
          await client.query('ROLLBACK');
          continue;
        }

        // 1. Optimistic Concurrency (CAS) & Kind Guard: Never clobber user edits/reauthorizations or non-sheets_digest schedules
        if (s.version !== audit.migrated_schedule_ver || s.kind !== 'sheets_digest') {
          await client.query(
            `UPDATE sheets_digest_v2_migration_audit
             SET rolled_back_at = now(),
                 rollback_outcome = 'skipped_user_modified'
             WHERE id = $1`,
            [audit.id]
          );
          await client.query('COMMIT');
          countsByRollbackOutcome.skipped_user_modified++;
          rollbackItems.push({
            scheduleId: s.id,
            userId: s.user_id,
            auditOutcome: audit.outcome,
            migratedScheduleVer: audit.migrated_schedule_ver,
            currentScheduleVer: s.version,
            rollbackOutcome: 'skipped_user_modified',
            reasons:
              s.kind !== 'sheets_digest'
                ? ['SCHEDULE_KIND_CHANGED_AFTER_MIGRATION']
                : ['SCHEDULE_VERSION_MODIFIED_AFTER_MIGRATION'],
          });
          continue;
        }

        // 2. Live Revocation Guard: 3. users FOR SHARE -> 4. workspace_members FOR SHARE -> 5. service_credentials FOR SHARE
        const userRes = await client.query<{ status: string }>(
          'SELECT status FROM users WHERE id = $1 FOR SHARE',
          [s.user_id]
        );
        const liveUserStatus = userRes.rows[0]?.status ?? null;

        let orgMemberActive = true;
        if (s.workspace_mode === 'organization') {
          if (!s.workspace_id || !isNonEmptyUuid(s.workspace_id)) {
            orgMemberActive = false;
          } else {
            const wmRes = await client.query<{ status: string }>(
              'SELECT status FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 FOR SHARE',
              [s.workspace_id, s.user_id]
            );
            orgMemberActive = wmRes.rows[0]?.status === 'active';
          }
        }

        const prevConfig = audit.previous_digest_config;
        const candidateCredIds = [
          prevConfig?.source?.credentialId,
          prevConfig?.destination?.credentialId,
        ]
          .filter(isNonEmptyUuid)
          .sort();
        const uniqueCredIds = [...new Set(candidateCredIds)];

        const txCredentialsById = new Map<string, ServiceCredentialRow>();
        if (uniqueCredIds.length > 0) {
          const credRes = await client.query<ServiceCredentialRow>(
            `SELECT id, service, user_id, workspace_id, config, status, created_at, status_changed_at
             FROM service_credentials
             WHERE id = ANY($1::uuid[])
             ORDER BY id ASC
             FOR SHARE`,
            [uniqueCredIds]
          );
          for (const c of credRes.rows) {
            txCredentialsById.set(c.id, c);
          }
        }

        const prevEval = evaluateV1IdentityProven({
          schedule: {
            ...s,
            status: audit.previous_status,
            digest_config: prevConfig,
            digest_config_hash: audit.previous_config_hash,
            user_status: liveUserStatus,
          },
          credentialsById: txCredentialsById,
          encryptionKey,
        });

        const canRestoreActive =
          audit.previous_status === 'active' &&
          liveUserStatus === 'active' &&
          orgMemberActive &&
          prevEval.proven;

        if (canRestoreActive) {
          const updateRes = await client.query(
            `UPDATE schedules
             SET digest_config = $3::jsonb,
                 digest_config_hash = $4,
                 status = $5,
                 pause_reason = $6,
                 next_run_at = $7,
                 version = version + 1,
                 updated_at = now()
             WHERE id = $1 AND version = $2`,
            [
              s.id,
              audit.migrated_schedule_ver,
              JSON.stringify(prevConfig),
              audit.previous_config_hash,
              audit.previous_status,
              audit.previous_pause_reason,
              audit.previous_next_run_at,
            ]
          );
          if (updateRes.rowCount !== 1) {
            await client.query('ROLLBACK');
            continue;
          }

          await client.query(
            `UPDATE sheets_digest_v2_migration_audit
             SET rolled_back_at = now(),
                 rollback_outcome = 'restored_previous_state'
             WHERE id = $1`,
            [audit.id]
          );
          await client.query('COMMIT');
          countsByRollbackOutcome.restored_previous_state++;
          rollbackItems.push({
            scheduleId: s.id,
            userId: s.user_id,
            auditOutcome: audit.outcome,
            migratedScheduleVer: audit.migrated_schedule_ver,
            currentScheduleVer: s.version + 1,
            rollbackOutcome: 'restored_previous_state',
            reasons: [],
          });
        } else {
          // Restore previous config/hash via CAS, but keep schedule paused (never reactivating revoked/unpinned state)
          const updateRes = await client.query(
            `UPDATE schedules
             SET digest_config = $3::jsonb,
                 digest_config_hash = $4,
                 status = 'paused',
                 pause_reason = COALESCE(pause_reason, $5),
                 next_run_at = NULL,
                 version = version + 1,
                 updated_at = now()
             WHERE id = $1 AND version = $2`,
            [
              s.id,
              audit.migrated_schedule_ver,
              JSON.stringify(prevConfig),
              audit.previous_config_hash,
              REAUTH_REQUIRED_PAUSE_REASON,
            ]
          );
          if (updateRes.rowCount !== 1) {
            await client.query('ROLLBACK');
            continue;
          }

          await client.query(
            `UPDATE sheets_digest_v2_migration_audit
             SET rolled_back_at = now(),
                 rollback_outcome = 'restored_paused_due_to_revocation'
             WHERE id = $1`,
            [audit.id]
          );
          await client.query('COMMIT');
          countsByRollbackOutcome.restored_paused_due_to_revocation++;
          rollbackItems.push({
            scheduleId: s.id,
            userId: s.user_id,
            auditOutcome: audit.outcome,
            migratedScheduleVer: audit.migrated_schedule_ver,
            currentScheduleVer: s.version + 1,
            rollbackOutcome: 'restored_paused_due_to_revocation',
            reasons: prevEval.reasons,
          });
        }
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    }

    return {
      mode,
      v1CompatPolicy,
      evidenceBoundaryNote: SHEETS_DIGEST_V2_EVIDENCE_BOUNDARY_NOTE,
      summary: {
        totalSchedules: rollbackItems.length,
        countsByClass,
        countsByOutcome,
        countsByRollbackOutcome,
        evidenceBoundaryNote: SHEETS_DIGEST_V2_EVIDENCE_BOUNDARY_NOTE,
        groups: [],
      },
      items: [],
      rollbackItems,
    };
  }

  // Modes: 'inventory' | 'dry-run' | 'apply'
  const schedRes = await pool.query<RawSheetsDigestScheduleRow>(
    `SELECT
       s.id,
       s.user_id,
       s.conv_id,
       s.name,
       s.request,
       s.services,
       s.kind,
       s.workspace_mode,
       s.workspace_id,
       s.status,
       s.pause_reason,
       s.next_run_at,
       s.version,
       s.recurrence,
       s.digest_config,
       s.digest_config_hash,
       s.digest_approved_at,
       s.created_at,
       s.updated_at,
       u.status AS user_status
     FROM schedules s
     LEFT JOIN users u ON u.id = s.user_id
     WHERE s.kind = 'sheets_digest'
       AND ($1::uuid IS NULL OR s.id = $1::uuid)
     ORDER BY s.created_at ASC, s.id ASC`,
    [scheduleIdFilter]
  );

  const credRes = await pool.query<ServiceCredentialRow>(
    `SELECT id, service, user_id, workspace_id, config, created_at, status, status_changed_at
     FROM service_credentials`
  );
  const credentialsById = new Map<string, ServiceCredentialRow>();
  for (const row of credRes.rows) {
    credentialsById.set(row.id, row);
  }

  const items: SheetsDigestMigrationItem[] = [];
  const groupMap = new Map<string, SheetsDigestInventorySummaryGroup>();

  if (mode === 'inventory' || mode === 'dry-run') {
    for (const row of schedRes.rows) {
      const classified = classifyScheduleMigrationItem({
        row,
        credentialsById,
        encryptionKey,
        v1CompatPolicy,
      });
      const { senderEmail: _unused, ...item } = classified;
      items.push(item);
      countsByClass[item.compatClass]++;
      countsByOutcome[item.outcome]++;

      const groupKey = [
        item.workspaceMode,
        item.previousStatus,
        String(item.configVersion),
        String(item.hasSourceCredId),
        String(item.hasDestCredId),
        item.compatClass,
        item.evidenceBoundary,
      ].join('|');
      const existingGroup = groupMap.get(groupKey);
      if (existingGroup) {
        existingGroup.count++;
      } else {
        groupMap.set(groupKey, {
          workspaceMode: item.workspaceMode,
          status: item.previousStatus,
          configVersion: item.configVersion,
          hasSourceCredId: item.hasSourceCredId,
          hasDestCredId: item.hasDestCredId,
          compatClass: item.compatClass,
          evidenceBoundary: item.evidenceBoundary,
          count: 1,
        });
      }
    }

    return {
      mode,
      v1CompatPolicy,
      evidenceBoundaryNote: SHEETS_DIGEST_V2_EVIDENCE_BOUNDARY_NOTE,
      summary: {
        totalSchedules: items.length,
        countsByClass,
        countsByOutcome,
        countsByRollbackOutcome,
        evidenceBoundaryNote: SHEETS_DIGEST_V2_EVIDENCE_BOUNDARY_NOTE,
        groups: Array.from(groupMap.values()),
      },
      items,
      rollbackItems: [],
    };
  }

  // mode === 'apply'
  const messageRepo = new MessageRepo(pool);

  for (const candidateRow of schedRes.rows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '5s'");

      // Canonical lock order: 1. conversations FOR UPDATE -> 2. schedules FOR UPDATE -> 3. users FOR SHARE -> 4. workspace_members FOR SHARE -> 5. service_credentials FOR SHARE
      await client.query('SELECT id FROM conversations WHERE id = $1 FOR UPDATE', [
        candidateRow.conv_id,
      ]);

      const lockedSchedRes = await client.query<
        RawSheetsDigestScheduleRow & {
          version: number;
          pause_reason: string | null;
          next_run_at: Date | null;
        }
      >('SELECT * FROM schedules WHERE id = $1 FOR UPDATE', [candidateRow.id]);
      const s = lockedSchedRes.rows[0];
      if (!s || s.kind !== 'sheets_digest') {
        await client.query('ROLLBACK');
        continue;
      }

      const userRes = await client.query<{ status: string }>(
        'SELECT status FROM users WHERE id = $1 FOR SHARE',
        [s.user_id]
      );
      s.user_status = userRes.rows[0]?.status ?? null;

      if (s.workspace_mode === 'organization' && isNonEmptyUuid(s.workspace_id)) {
        await client.query(
          'SELECT status FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 FOR SHARE',
          [s.workspace_id, s.user_id]
        );
      }

      const rawCfg = s.digest_config ?? {};
      const credIdsToLock = [rawCfg?.source?.credentialId, rawCfg?.destination?.credentialId]
        .filter(isNonEmptyUuid)
        .sort();
      const uniqueCredIds = [...new Set(credIdsToLock)];

      const txCredentialsById = new Map<string, ServiceCredentialRow>();
      if (uniqueCredIds.length > 0) {
        const lockedCreds = await client.query<ServiceCredentialRow>(
          `SELECT id, service, user_id, workspace_id, config, created_at, status, status_changed_at
           FROM service_credentials
           WHERE id = ANY($1::uuid[])
           ORDER BY id ASC
           FOR SHARE`,
          [uniqueCredIds]
        );
        for (const c of lockedCreds.rows) {
          txCredentialsById.set(c.id, c);
        }
      }

      const classified = classifyScheduleMigrationItem({
        row: s,
        credentialsById: txCredentialsById,
        encryptionKey,
        v1CompatPolicy,
      });

      if (classified.outcome === 'already_v2' || classified.outcome === 'inactive_preserved') {
        await upsertAuditRow(client, {
          scheduleId: s.id,
          userId: s.user_id,
          workspaceMode: classified.workspaceMode,
          workspaceId: classified.workspaceId,
          previousStatus: s.status,
          previousPauseReason: s.pause_reason ?? null,
          previousNextRunAt: s.next_run_at ?? null,
          previousScheduleVer: s.version,
          migratedScheduleVer: s.version,
          previousConfigVersion: classified.configVersion,
          previousDigestConfig: s.digest_config,
          previousConfigHash: s.digest_config_hash,
          outcome: classified.outcome,
          reasonCode: classified.reasonCode,
          reasonDetail: classified.reasonDetail,
        });
        await client.query('COMMIT');
      } else if (classified.outcome === 'upgraded_v2' && classified.senderEmail) {
        const v1Cfg = s.digest_config as SheetsDigestConfigV1;
        const v2Config: SheetsDigestConfigV2 = {
          version: 2,
          workspaceMode: classified.workspaceMode,
          workspaceId: null,
          source: {
            service: 'mysheets',
            credentialId: v1Cfg.source.credentialId!,
            email: normalizeEmail(v1Cfg.source.email),
            spreadsheetId: v1Cfg.source.spreadsheetId,
            spreadsheetTitle: v1Cfg.source.spreadsheetTitle,
            ...(v1Cfg.source.sheetName ? { sheetName: v1Cfg.source.sheetName } : {}),
            ...(v1Cfg.source.range ? { range: v1Cfg.source.range } : {}),
            tailRows: typeof v1Cfg.source.tailRows === 'number' ? v1Cfg.source.tailRows : 20,
          },
          destination: {
            service: 'gmail',
            credentialId: (v1Cfg.destination as { credentialId?: string }).credentialId!,
            senderEmail: classified.senderEmail,
            recipientEmail: normalizeEmail(
              (v1Cfg.destination as { recipientEmail: string }).recipientEmail
            ),
          },
          includeAiSummary: Boolean(v1Cfg.includeAiSummary),
        };
        const v2Hash = computeSheetsDigestHash({
          userId: s.user_id,
          recurrence: s.recurrence,
          config: v2Config,
        });

        const updateRes = await client.query(
          `UPDATE schedules
           SET digest_config = $2::jsonb,
               digest_config_hash = $3,
               version = version + 1,
               updated_at = now()
           WHERE id = $1 AND version = $4`,
          [s.id, JSON.stringify(v2Config), v2Hash, s.version]
        );
        if (updateRes.rowCount !== 1) {
          await client.query('ROLLBACK');
          continue;
        }

        await upsertAuditRow(client, {
          scheduleId: s.id,
          userId: s.user_id,
          workspaceMode: classified.workspaceMode,
          workspaceId: classified.workspaceId,
          previousStatus: s.status,
          previousPauseReason: s.pause_reason ?? null,
          previousNextRunAt: s.next_run_at ?? null,
          previousScheduleVer: s.version,
          migratedScheduleVer: s.version + 1,
          previousConfigVersion: classified.configVersion,
          previousDigestConfig: s.digest_config,
          previousConfigHash: s.digest_config_hash,
          outcome: 'upgraded_v2',
          reasonCode: classified.reasonCode,
          reasonDetail: classified.reasonDetail,
        });

        await client.query('COMMIT');
      } else {
        // outcome === 'paused_reauth_required'
        const updateRes = await client.query<{ updated_at: Date }>(
          `UPDATE schedules
           SET status = 'paused',
               pause_reason = $2,
               next_run_at = NULL,
               version = version + 1,
               updated_at = now()
           WHERE id = $1 AND version = $3
           RETURNING updated_at`,
          [s.id, REAUTH_REQUIRED_PAUSE_REASON, s.version]
        );
        if (updateRes.rowCount !== 1) {
          await client.query('ROLLBACK');
          continue;
        }

        const migratedVersion = s.version + 1;

        await upsertAuditRow(client, {
          scheduleId: s.id,
          userId: s.user_id,
          workspaceMode: classified.workspaceMode,
          workspaceId: classified.workspaceId,
          previousStatus: s.status,
          previousPauseReason: s.pause_reason ?? null,
          previousNextRunAt: s.next_run_at ?? null,
          previousScheduleVer: s.version,
          migratedScheduleVer: migratedVersion,
          previousConfigVersion: classified.configVersion,
          previousDigestConfig: s.digest_config,
          previousConfigHash: s.digest_config_hash,
          outcome: 'paused_reauth_required',
          reasonCode: classified.reasonCode,
          reasonDetail: classified.reasonDetail,
        });

        if (notifyOwners) {
          const scheduleView: ScheduleView & {
            nextRunAt: null;
            createdAt?: string;
            updatedAt?: string;
          } = {
            id: s.id,
            convId: s.conv_id,
            version: migratedVersion,
            name: s.name ?? 'Báo cáo định kỳ Google Sheets',
            request: s.request ?? '',
            recurrence: s.recurrence,
            services: Array.isArray(s.services) ? s.services : [],
            status: 'paused',
            pauseReason: REAUTH_REQUIRED_PAUSE_REASON,
            nextRunAt: null,
            nextRuns: [],
            lastRun: null,
            kind: 'sheets_digest',
            approvalMode: 'auto_digest',
            digestConfig: s.digest_config ?? null,
            ...(s.created_at ? { createdAt: new Date(s.created_at).toISOString() } : {}),
            ...(updateRes.rows[0]?.updated_at
              ? { updatedAt: new Date(updateRes.rows[0].updated_at).toISOString() }
              : s.updated_at
                ? { updatedAt: new Date(s.updated_at).toISOString() }
                : {}),
          };

          await messageRepo.createMessage(
            s.conv_id,
            'system',
            buildPauseNotificationText(s.name),
            {
              type: 'schedule_state',
              schedule: scheduleView,
              reason: REAUTH_REQUIRED_PAUSE_REASON,
              reasonCode: 'REAUTH_REQUIRED',
              scheduleId: s.id,
              scheduleVersion: migratedVersion,
            },
            client
          );
        }

        await client.query('COMMIT');
      }

      const { senderEmail: _unused, ...item } = classified;
      items.push(item);
      countsByClass[item.compatClass]++;
      countsByOutcome[item.outcome]++;

      const groupKey = [
        item.workspaceMode,
        item.previousStatus,
        String(item.configVersion),
        String(item.hasSourceCredId),
        String(item.hasDestCredId),
        item.compatClass,
        item.evidenceBoundary,
      ].join('|');
      const existingGroup = groupMap.get(groupKey);
      if (existingGroup) {
        existingGroup.count++;
      } else {
        groupMap.set(groupKey, {
          workspaceMode: item.workspaceMode,
          status: item.previousStatus,
          configVersion: item.configVersion,
          hasSourceCredId: item.hasSourceCredId,
          hasDestCredId: item.hasDestCredId,
          compatClass: item.compatClass,
          evidenceBoundary: item.evidenceBoundary,
          count: 1,
        });
      }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  return {
    mode,
    v1CompatPolicy,
    evidenceBoundaryNote: SHEETS_DIGEST_V2_EVIDENCE_BOUNDARY_NOTE,
    summary: {
      totalSchedules: items.length,
      countsByClass,
      countsByOutcome,
      countsByRollbackOutcome,
      evidenceBoundaryNote: SHEETS_DIGEST_V2_EVIDENCE_BOUNDARY_NOTE,
      groups: Array.from(groupMap.values()),
    },
    items,
    rollbackItems: [],
  };
}
