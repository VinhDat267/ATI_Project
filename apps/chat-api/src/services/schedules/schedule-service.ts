import type pg from 'pg';
import type {
  CalendarDigestCandidate,
  GithubDigestConfig,
  ScheduleApprovalMode,
  ScheduleDigestCandidate,
  ScheduleKind,
  ScheduleProposalMetadata,
  ScheduleResponse,
  ScheduleRunView,
  ScheduleStateMetadata,
  ScheduleView,
  SheetsDigestCandidate,
  TelegramDigestConfig,
  TelegramDigestCandidate,
  TrelloDigestConfig,
  TrelloDigestCandidate,
  NotionDigestConfig,
  NotionDigestCandidate,
} from '@wap/tool-schemas';
import type { CredentialRepo } from '../../db/repositories/credential-repo.js';
import { MessageRepo } from '../../db/repositories/message-repo.js';
import { ScheduleRepo, type Queryable, type ScheduleRow, type ScheduleScope } from '../../db/repositories/schedule-repo.js';
import { isUuid } from '../../db/repositories/uuid.js';
import { calendarDigestCandidateMatches, computeCalendarDigestHash, evaluateCalendarDigestCandidate } from './calendar-digest-candidate.js';
import { runState, runView } from './run-state.js';
import { nextOccurrence } from './next-occurrence.js';
import { captureScheduleArtifact, guardScheduleArtifact, prelockScheduleArtifacts, registerScheduleFields, scheduleRegistry, scheduleSourceContext, tagScheduleContext } from '../slack/slack-schedule-lineage.js';
import { messageOutputSelectors } from '../slack/slack-message-selectors.js';
import type { DerivedSegmentInput } from '../../db/repositories/slack-derived-lineage-repo.js';
import { analyzeSheetsDigestCandidate, computeSheetsDigestHash } from './sheets-digest-candidate.js';
import { canonicalizeDigestConfig, computeDigestConfigHash } from './github-digest-candidate.js';
import { computeTelegramDigestConfigHash } from './telegram-digest-candidate.js';
import { canonicalizeTrelloDigestConfig, computeTrelloDigestConfigHash } from './trello-digest-candidate.js';
import { canonicalizeNotionDigestConfig, computeNotionDigestConfigHash } from './notion-digest-candidate.js';
import { canonicalizeJiraDigestConfig, computeJiraDigestConfigHash, type JiraDigestCandidate, type JiraDigestConfig } from './jira-digest-candidate.js';

export const SCHEDULE_CONFLICTS = {
  STALE_PROPOSAL: 'Đề xuất này đã cũ. Hãy xem đề xuất mới nhất.',
  LIMIT_REACHED: 'Bạn đã có 10 lịch. Hãy hủy bớt một lịch rồi thử lại.',
  CONVERSATION_HAS_SCHEDULE: 'Hội thoại này đã có lịch. Hãy mở hội thoại mới để tạo lịch khác.',
  SCHEDULE_IN_PAST: 'Giờ hẹn đã qua. Hãy nhắn giờ mới.',
  SCHEDULE_CLOSED: 'Lịch đã hủy hoặc đã chạy xong.',
  STALE_VERSION: 'Lịch vừa thay đổi ở nơi khác. Đã tải lại.',
  RUN_IN_PROGRESS: 'Lịch đang lập kế hoạch cho một lượt. Hãy chờ lượt đó xong.',
  RUN_NOT_REPLANNABLE: 'Lượt này không cần lập lại kế hoạch.',
  SCHEDULE_SOURCE_PURGED: 'Nguồn Slack của đề xuất này chưa thể dùng để tạo lịch. Hãy tạo đề xuất mới.',
  DIGEST_NOT_ELIGIBLE: 'Lịch này không đủ điều kiện tự gửi báo cáo. Hãy chọn chế độ chờ duyệt mỗi lượt.',
  AUTO_DIGEST_NOT_ELIGIBLE: 'Lịch này không đủ điều kiện gửi tự động hoặc kết nối Google Calendar/kênh nhận đã thay đổi. Hãy chọn chế độ duyệt thủ công hoặc kiểm tra lại kết nối.',
  AUTO_DIGEST_NOT_ALLOWED: 'Lịch này cần duyệt từng lượt.',
  DIGEST_PREVIEW_CHANGED: 'Kết nối, phạm vi lịch hoặc kênh nhận khác bản xem trước. Hãy yêu cầu đề xuất mới và xác nhận lại.',
} as const;
export type ScheduleConflictCode = keyof typeof SCHEDULE_CONFLICTS;

export class ScheduleConflict extends Error {
  constructor(readonly code: ScheduleConflictCode, customMessage?: string) {
    super(customMessage || SCHEDULE_CONFLICTS[code]);
  }
}
export class ScheduleNotFound extends Error {
  constructor() { super('Không tìm thấy lịch.'); }
}

/** The schedule after a request, and the state message to announce when something changed. */
export interface ScheduleChange {
  schedule: ScheduleView;
  convId: string;
  /** Null when the request changed nothing (a repeated confirmation, pausing a paused schedule). */
  sourceBound?: boolean;
  state: { messageId: string; metadata: ScheduleStateMetadata } | null;
}

type Action = ScheduleResponse['action'];
type Fields = Pick<ScheduleRow, 'name' | 'request' | 'recurrence' | 'services' | 'status' | 'pause_reason' | 'next_run_at'> & {
  kind?: ScheduleKind;
  digest_config?: ScheduleRow['digest_config'];
  digest_config_hash?: string | null;
  digest_approved_at?: Date | string | null;
};

export interface ScheduleServiceOptions {
  pool: pg.Pool;
  timeZone: string;
  /** Plans a run in the background; the scheduler (SCHED-01) or nothing in tests. */
  runner?: { planNow(runId: string): Promise<void> };
  maxSchedules?: number;
  credentialRepo?: CredentialRepo;
  encryptionKey?: string;
  mysheetsEnabled?: boolean;
}

const REPLANNABLE = new Set(['expired', 'planning_failed', 'interrupted', 'missed', 'digest_failed']);
/** Schedules that count toward the limit. */
const OPEN = new Set(['active', 'paused']);

export class ScheduleService {
  readonly repo: ScheduleRepo;
  private messages: MessageRepo;
  private maxSchedules: number;
  private registry;

  constructor(private options: ScheduleServiceOptions) {
    this.repo = new ScheduleRepo(options.pool, options.timeZone);
    this.messages = new MessageRepo(options.pool);
    this.registry = scheduleRegistry(options.pool);
    this.maxSchedules = options.maxSchedules ?? 10;
  }

  private async transaction<T>(work: (client: pg.PoolClient) => Promise<T>, staleCode:'STALE_VERSION'|'STALE_PROPOSAL'='STALE_VERSION'): Promise<T> {
    const client = await this.options.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if(error instanceof Error&&error.message==='SLACK_SCHEDULE_CHANGED')throw new ScheduleConflict(staleCode);
      throw error;
    } finally {
      client.release();
    }
  }

  private next(row: Pick<ScheduleRow, 'recurrence'>, now: Date): Date {
    const next = nextOccurrence(row.recurrence, now, this.options.timeZone);
    if (!next) throw new ScheduleConflict('SCHEDULE_IN_PAST');
    return next;
  }

  /** The fields after `action`, or null when the schedule already is that way. */
  private transition(row: ScheduleRow, action: Action, proposal: ScheduleResponse | null, services: string[] | null, now: Date): Fields | null {
    const closed = row.status === 'cancelled' || row.status === 'completed';
    switch (action) {
      case 'update': {
        if (row.status === 'cancelled') throw new ScheduleConflict('SCHEDULE_CLOSED');
        const fields = { name: proposal!.name!, request: proposal!.request!, recurrence: proposal!.recurrence!, services: services ?? row.services };
        // Changing a one-off schedule that already ran turns it back on.
        const status = row.status === 'paused' ? 'paused' : 'active';
        return { ...fields, status, pause_reason: status === 'paused' ? row.pause_reason : null, next_run_at: status === 'active' ? this.next(fields, now) : null };
      }
      case 'pause':
        if (closed) throw new ScheduleConflict('SCHEDULE_CLOSED');
        return row.status === 'paused' ? null : { ...row, status: 'paused', pause_reason: null, next_run_at: null };
      case 'resume':
        if (closed) throw new ScheduleConflict('SCHEDULE_CLOSED');
        // Times missed while paused are not recorded: the next run counts from now.
        return row.status === 'active' ? null : { ...row, status: 'active', pause_reason: null, next_run_at: this.next(row, now) };
      case 'cancel':
        return row.status === 'cancelled' ? null : { ...row, status: 'cancelled', next_run_at: null };
      case 'create':
        throw new ScheduleConflict('CONVERSATION_HAS_SCHEDULE');
    }
  }

  private async saveFields(
    client: pg.PoolClient,
    id: string,
    fields: Fields,
    proposalId: string | null,
    segments: DerivedSegmentInput[] = [],
    digestUpdate?:
      | { kind: 'plan' }
      | { kind: 'github_digest'; config: GithubDigestConfig; configHash: string; approvedAt: Date }
      | { kind: 'trello_digest'; config: TrelloDigestConfig; configHash: string; approvedAt: Date }
      | { kind: 'notion_digest'; config: NotionDigestConfig; configHash: string; approvedAt: Date }
      | { kind: 'myjira_digest'; config: JiraDigestConfig; configHash: string; approvedAt: Date },
  ): Promise<ScheduleRow> {
    let res: pg.QueryResult<ScheduleRow>;
    if (digestUpdate?.kind === 'plan') {
      res = await client.query(
        `UPDATE schedules SET name=$2, request=$3, recurrence=$4, services=$5, status=$6, pause_reason=$7, next_run_at=$8,
           kind='plan', digest_config=NULL, digest_config_hash=NULL, digest_approved_at=NULL,
           version=version+1, updated_at=now(), last_proposal_id=COALESCE($9, last_proposal_id)
         WHERE id=$1 RETURNING *`,
        [id, fields.name, fields.request, JSON.stringify(fields.recurrence), fields.services, fields.status, fields.pause_reason, fields.next_run_at, proposalId],
      );
    } else if (
      digestUpdate?.kind === 'github_digest' ||
      digestUpdate?.kind === 'trello_digest' ||
      digestUpdate?.kind === 'notion_digest' ||
      digestUpdate?.kind === 'myjira_digest'
    ) {
      res = await client.query(
        `UPDATE schedules SET name=$2, request=$3, recurrence=$4, services=$5, status=$6, pause_reason=$7, next_run_at=$8,
           kind=$10, digest_config=$11, digest_config_hash=$12, digest_approved_at=$13,
           version=version+1, updated_at=now(), last_proposal_id=COALESCE($9, last_proposal_id)
         WHERE id=$1 RETURNING *`,
        [
          id,
          fields.name,
          fields.request,
          JSON.stringify(fields.recurrence),
          fields.services,
          fields.status,
          fields.pause_reason,
          fields.next_run_at,
          proposalId,
          digestUpdate.kind,
          JSON.stringify(digestUpdate.config),
          digestUpdate.configHash,
          digestUpdate.approvedAt,
        ],
      );
    } else if (fields.kind !== undefined) {
      res = await client.query(
        `UPDATE schedules SET name=$2, request=$3, recurrence=$4, services=$5, status=$6, pause_reason=$7, next_run_at=$8,
           version=version+1, updated_at=now(), last_proposal_id=COALESCE($9, last_proposal_id),
           kind=$10, digest_config=$11, digest_config_hash=$12, digest_approved_at=$13
         WHERE id=$1 RETURNING *`,
        [
          id,
          fields.name,
          fields.request,
          JSON.stringify(fields.recurrence),
          fields.services,
          fields.status,
          fields.pause_reason,
          fields.next_run_at,
          proposalId,
          fields.kind,
          fields.digest_config ? JSON.stringify(fields.digest_config) : null,
          fields.digest_config_hash ?? null,
          fields.digest_approved_at ?? null,
        ],
      );
    } else {
      res = await client.query(
        `UPDATE schedules SET name=$2, request=$3, recurrence=$4, services=$5, status=$6, pause_reason=$7, next_run_at=$8,
           version=version+1, updated_at=now(), last_proposal_id=COALESCE($9, last_proposal_id)
         WHERE id=$1 RETURNING *`,
        [id, fields.name, fields.request, JSON.stringify(fields.recurrence), fields.services, fields.status, fields.pause_reason, fields.next_run_at, proposalId],
      );
    }
    const row = res.rows[0]!;
    await registerScheduleFields(client, this.registry, 'schedules', id, row.user_id, segments, ['name', 'request', 'recurrence']);
    return tagScheduleContext(row, segments);
  }

  /** Writes the state message in the same transaction as the change. */
  async recordState(client: Queryable, row: ScheduleRow, now: Date): Promise<ScheduleChange> {
    const schedule = this.repo.view(row, await this.repo.lastRun(row.id, client), now);
    const metadata: ScheduleStateMetadata = { type: 'schedule_state', schedule };
    const context=scheduleSourceContext(row),content=this.repo.stateText(schedule);
    const message = context ? await this.messages.createSlackMessage(row.conv_id,'assistant',content,metadata,{...context,selectors:messageOutputSelectors({content,metadata})},client as pg.PoolClient) : await this.messages.createMessage(row.conv_id,'assistant',content,metadata,client);
    return { schedule, convId: row.conv_id, sourceBound:!!context, state: { messageId: message.id, metadata } };
  }

  private async unchanged(client: Queryable, row: ScheduleRow, now: Date): Promise<ScheduleChange> {
    return { schedule: this.repo.view(row, await this.repo.lastRun(row.id, client), now), convId: row.conv_id, state: null };
  }

  /** The owner row serializes the count across the member's conversations; it comes after the conversation and schedule locks. */
  private async ensureRoom(client: pg.PoolClient, userId: string, scope?: ScheduleScope): Promise<void> {
    await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
    let scopeClause = '';
    const args: unknown[] = [userId];
    if (scope?.workspaceMode === 'organization' && scope.workspaceId) {
      args.push(scope.workspaceId);
      scopeClause = ` AND workspace_mode='organization' AND workspace_id=$${args.length}`;
    } else if (scope?.workspaceMode === 'personal') {
      scopeClause = " AND workspace_mode IN ('personal', 'legacy') AND workspace_id IS NULL";
    } else if (scope?.workspaceMode === 'legacy') {
      scopeClause = ' AND workspace_id IS NULL';
    }
    const open = await client.query(
      `SELECT count(*)::int AS n FROM schedules WHERE user_id=$1 AND status IN ('active', 'paused')${scopeClause}`,
      args
    );
    if (open.rows[0].n >= this.maxSchedules) throw new ScheduleConflict('LIMIT_REACHED');
  }

  async confirmProposal(input: {
    userId: string;
    convId: string;
    messageId: string;
    now: Date;
    scope?: ScheduleScope;
    approvalMode?: ScheduleApprovalMode;
  }): Promise<ScheduleChange> {
    const { userId, convId, messageId, now, scope, approvalMode } = input;
    if (!isUuid(convId) || !isUuid(messageId)) throw new ScheduleNotFound();
    return this.transaction(async (client) => {
      const proposed = await captureScheduleArtifact(client, this.registry, 'messages', messageId);
      const existingId = (await client.query('SELECT id FROM schedules WHERE conv_id=$1', [convId])).rows[0]?.id;
      let saved = existingId ? await captureScheduleArtifact(client, this.registry, 'schedules', existingId) : null;
      if (!proposed || proposed.convId !== convId || proposed.owner !== userId) throw new ScheduleNotFound();
      await prelockScheduleArtifacts(client, this.registry, [proposed, saved]);
      // Capacity is exclusive before any registry authority FOR SHARE. Two
      // workspaces of one ATI owner have disjoint source keys; upgrading two
      // shared user locks later in ensureRoom would deadlock. Preserve global
      // source -> conversation -> schedule -> owner -> artifact ordering.
      const owner = await client.query('SELECT id, user_id, workspace_id, workspace_mode FROM conversations WHERE id=$1 AND user_id=$2 FOR UPDATE', [convId, userId]);
      if (!owner.rows[0]) throw new ScheduleNotFound();
      if (scope?.workspaceMode === 'organization' && owner.rows[0]?.workspace_id !== scope.workspaceId) throw new ScheduleNotFound();
      if (scope?.workspaceMode === 'personal' && owner.rows[0]?.workspace_id) throw new ScheduleNotFound();
      if (saved) await client.query('SELECT id FROM schedules WHERE id=$1 FOR UPDATE', [saved.id]);
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
      const guarded = await guardScheduleArtifact(client, this.registry, proposed, 'planning', 'UPDATE');
      if (!guarded.allowed) throw new ScheduleConflict('SCHEDULE_SOURCE_PURGED');
      const metadata = guarded.row.metadata as ScheduleProposalMetadata;
      if (metadata?.type !== 'schedule_proposal') throw new ScheduleNotFound();
      const rawJiraCandidateConfig = (metadata.digestCandidate as any)?.config;
      const isReadOnlyJiraDigestConfirm =
        approvalMode === 'auto_digest' &&
        (metadata.digestCandidate as any)?.canAutoDigest === true &&
        Boolean(rawJiraCandidateConfig) &&
        Array.isArray(rawJiraCandidateConfig.projects);
      if (
        (metadata.services?.some((s) => s === 'myjira' || s.startsWith('myjira')) ||
          metadata.proposal?.request?.toLowerCase().includes('myjira')) &&
        !isReadOnlyJiraDigestConfirm
      ) {
        throw new ScheduleConflict('DIGEST_NOT_ELIGIBLE', 'Lịch tự động không hỗ trợ Jira cá nhân (myjira).');
      }
      if (scope?.workspaceMode === 'personal' && (metadata.services?.includes('jira') || metadata.proposal?.request?.toLowerCase().includes('jira'))) {
        throw new ScheduleConflict('DIGEST_NOT_ELIGIBLE', 'Dịch vụ Jira chung (jira) không khả dụng ở không gian cá nhân.');
      }
      if (!saved) {
        const arrived = (await client.query('SELECT id FROM schedules WHERE conv_id=$1', [convId])).rows[0];
        if (arrived) {
          saved = await captureScheduleArtifact(client, this.registry, 'schedules', arrived.id);
          if (saved?.segments.some((s) => !proposed.segments.some((p) => JSON.stringify(p) === JSON.stringify(s)))) {
            throw new ScheduleConflict('STALE_PROPOSAL');
          }
        }
      }
      const checked = saved ? await guardScheduleArtifact(client, this.registry, saved, 'planning', 'UPDATE') : null;
      if (checked && !checked.allowed) throw new ScheduleConflict('SCHEDULE_SOURCE_PURGED');
      const existing: ScheduleRow | undefined = checked?.row;
      const segments = [...guarded.segments, ...(checked?.segments ?? [])];
      // Confirming an applied proposal again changes nothing.
      if (existing?.last_proposal_id === messageId) return this.unchanged(client, existing, now);
      const latest = await client.query(
        "SELECT id FROM messages WHERE conv_id=$1 AND metadata->>'type'='schedule_proposal' ORDER BY created_at DESC, id DESC LIMIT 1", [convId]);
      if (latest.rows[0].id !== messageId) throw new ScheduleConflict('STALE_PROPOSAL');

      const proposal = metadata.proposal;
      const wsId = owner.rows[0].workspace_id ?? null;
      const wsMode = owner.rows[0].workspace_mode ?? 'legacy';
      const wantAutoDigest = approvalMode === 'auto_digest';
      const candidateConfig = (metadata.digestCandidate as any)?.config;
      const hasGithubDigestCandidate =
        Boolean(candidateConfig) &&
        Array.isArray(candidateConfig.repos) &&
        typeof candidateConfig.staleDays === 'number';
      const hasTrelloDigestCandidate =
        Boolean(candidateConfig) && Array.isArray(candidateConfig.boards);
      const hasNotionDigestCandidate =
        Boolean(candidateConfig) && Array.isArray(candidateConfig.databases);
      const candidateHasTelegramSources = Boolean(
        candidateConfig && typeof candidateConfig === 'object' && 'sources' in candidateConfig,
      );
      const candidateHasNotionDatabases = Boolean(
        candidateConfig && typeof candidateConfig === 'object' && 'databases' in candidateConfig,
      );
      const isCalendarSchedule =
        existing?.kind === 'calendar_digest' ||
        (!candidateHasTelegramSources &&
          !hasGithubDigestCandidate &&
          !hasTrelloDigestCandidate &&
          !hasNotionDigestCandidate &&
          existing?.kind !== 'telegram_digest' &&
          existing?.kind !== 'github_digest' &&
          existing?.kind !== 'trello_digest' &&
          existing?.kind !== 'notion_digest' &&
          (metadata.services.includes('mycalendar') ||
            (metadata.services.includes('calendar') && !metadata.services.includes('github'))));
      const isSheetsSchedule =
        existing?.kind === 'sheets_digest' ||
        (!candidateHasTelegramSources &&
          !hasGithubDigestCandidate &&
          !hasTrelloDigestCandidate &&
          !hasNotionDigestCandidate &&
          existing?.kind !== 'telegram_digest' &&
          existing?.kind !== 'github_digest' &&
          existing?.kind !== 'trello_digest' &&
          existing?.kind !== 'notion_digest' &&
          existing?.kind !== 'calendar_digest' &&
          (metadata.services.includes('mysheets') || metadata.services.includes('sheets')));
      const isGithubSchedule =
        !isCalendarSchedule &&
        !isSheetsSchedule &&
        (hasGithubDigestCandidate ||
          (existing?.kind === 'github_digest' && !candidateHasTelegramSources) ||
          (!candidateHasTelegramSources &&
            !metadata.services.includes('telegram') &&
            (metadata.services.includes('github') || existing?.kind === 'github_digest')));
      const isTrelloSchedule =
        !isCalendarSchedule &&
        !isSheetsSchedule &&
        !isGithubSchedule &&
        (hasTrelloDigestCandidate ||
          (existing?.kind === 'trello_digest' && !candidateHasTelegramSources) ||
          (!candidateHasTelegramSources &&
            !metadata.services.includes('telegram') &&
            (metadata.services.includes('trello') || existing?.kind === 'trello_digest')));
      const isNotionSchedule =
        !isCalendarSchedule &&
        !isSheetsSchedule &&
        !isGithubSchedule &&
        !isTrelloSchedule &&
        (hasNotionDigestCandidate ||
          candidateHasNotionDatabases ||
          (existing?.kind === 'notion_digest' && !candidateHasTelegramSources) ||
          (!candidateHasTelegramSources &&
            !metadata.services.includes('telegram') &&
            (metadata.services.includes('notion') || existing?.kind === 'notion_digest')));
      const isTelegramSchedule =
        !isCalendarSchedule &&
        !isSheetsSchedule &&
        !isGithubSchedule &&
        !isTrelloSchedule &&
        !isNotionSchedule &&
        (metadata.services.includes('telegram') || existing?.kind === 'telegram_digest');
      let digestFields: {
        kind: 'plan' | 'sheets_digest' | 'calendar_digest' | 'github_digest' | 'telegram_digest' | 'trello_digest' | 'notion_digest';
        digestConfig: unknown | null;
        digestConfigHash: string | null;
        digestApprovedAt: Date | null;
      } = {
        kind: 'plan',
        digestConfig: null,
        digestConfigHash: null,
        digestApprovedAt: null,
      };
      let telegramDigestConfig: TelegramDigestConfig | null = null;
      let telegramDigestHash: string | null = null;

      if (wantAutoDigest && (proposal.action === 'create' || proposal.action === 'update') && !isGithubSchedule && !isTrelloSchedule && !isNotionSchedule && !isReadOnlyJiraDigestConfirm) {
        if (isTelegramSchedule) {
          const candidate = metadata.digestCandidate as TelegramDigestCandidate | undefined;
          if (!candidate || candidate.canAutoDigest !== true || !candidate.config || !candidate.configHash) {
            throw new ScheduleConflict('AUTO_DIGEST_NOT_ALLOWED');
          }
          const computedHash = computeTelegramDigestConfigHash(candidate.config);
          if (computedHash !== candidate.configHash) {
            throw new ScheduleConflict('AUTO_DIGEST_NOT_ALLOWED');
          }
          telegramDigestConfig = candidate.config;
          telegramDigestHash = computedHash;
          digestFields = {
            kind: 'telegram_digest',
            digestConfig: JSON.stringify(telegramDigestConfig),
            digestConfigHash: telegramDigestHash,
            digestApprovedAt: now,
          };
        } else if (isCalendarSchedule) {
          const evaluated = await evaluateCalendarDigestCandidate({
            pool: client,
            encryptionKey: this.options.encryptionKey,
            userId,
            services: metadata.services,
            request: proposal.request!,
          });
          if (!evaluated.candidate.canAutoDigest || !evaluated.config || !evaluated.configHash) {
            throw new ScheduleConflict('AUTO_DIGEST_NOT_ELIGIBLE');
          }
          const candidate = metadata.digestCandidate as CalendarDigestCandidate | undefined;
          if (!calendarDigestCandidateMatches(candidate, evaluated)) {
            throw new ScheduleConflict('DIGEST_PREVIEW_CHANGED');
          }
          digestFields = {
            kind: 'calendar_digest',
            digestConfig: JSON.stringify(candidate.config),
            digestConfigHash: computeCalendarDigestHash(candidate.config),
            digestApprovedAt: now,
          };
        } else {
          const sheetsCandidate = metadata.digestCandidate as SheetsDigestCandidate | undefined;
          if (!sheetsCandidate?.canAutoDigest || !sheetsCandidate.config) {
            throw new ScheduleConflict('DIGEST_NOT_ELIGIBLE');
          }
          if (this.options.credentialRepo && this.options.encryptionKey) {
            const recheck = await analyzeSheetsDigestCandidate({
              userId,
              request: proposal.request!,
              services: metadata.services,
              credentialRepo: this.options.credentialRepo,
              encryptionKey: this.options.encryptionKey,
              mysheetsEnabled: this.options.mysheetsEnabled,
            });
            if (!recheck.canAutoDigest || !recheck.config) {
              throw new ScheduleConflict('DIGEST_NOT_ELIGIBLE');
            }
          }
          const config = sheetsCandidate.config;
          const hash = computeSheetsDigestHash({
            userId,
            recurrence: proposal.recurrence!,
            config,
          });
          digestFields = {
            kind: 'sheets_digest',
            digestConfig: JSON.stringify(config),
            digestConfigHash: hash,
            digestApprovedAt: now,
          };
        }
      }

      if (proposal.action === 'create') {
        if (existing) throw new ScheduleConflict('CONVERSATION_HAS_SCHEDULE');
        if (isGithubSchedule && approvalMode === 'auto_digest') {
          const githubCandidate = metadata.digestCandidate as ScheduleDigestCandidate | undefined;
          if (!githubCandidate?.canAutoDigest || !githubCandidate.config) {
            throw new ScheduleConflict('AUTO_DIGEST_NOT_ALLOWED', githubCandidate?.disabledReason);
          }
          await this.ensureRoom(client, userId, { workspaceMode: wsMode, workspaceId: wsId });
          const next = this.next({ recurrence: proposal.recurrence! }, now);
          const config = canonicalizeDigestConfig(githubCandidate.config);
          const configHash = computeDigestConfigHash({
            config,
            recurrence: proposal.recurrence!,
            userId,
          });
          const created = await client.query(
            `INSERT INTO schedules(
               user_id, conv_id, name, request, recurrence, services, status, next_run_at, last_proposal_id,
               workspace_id, workspace_mode, kind, digest_config, digest_config_hash, digest_approved_at
             )
             VALUES($1, $2, $3, $4, $5, $6, 'active', $7, $8, $9, $10, 'github_digest', $11, $12, $13) RETURNING *`,
            [
              userId,
              convId,
              proposal.name,
              proposal.request,
              JSON.stringify(proposal.recurrence),
              metadata.services,
              next,
              messageId,
              wsId,
              wsMode,
              JSON.stringify(config),
              configHash,
              now,
            ],
          );
          await registerScheduleFields(client, this.registry, 'schedules', created.rows[0].id, userId, segments, ['name', 'request', 'recurrence']);
          return this.recordState(client, tagScheduleContext(created.rows[0], segments), now);
        }
        if (isTrelloSchedule && approvalMode === 'auto_digest') {
          const trelloCandidate = metadata.digestCandidate as TrelloDigestCandidate | undefined;
          if (!trelloCandidate?.canAutoDigest || !trelloCandidate.config) {
            throw new ScheduleConflict('AUTO_DIGEST_NOT_ALLOWED', trelloCandidate?.disabledReason);
          }
          await this.ensureRoom(client, userId, { workspaceMode: wsMode, workspaceId: wsId });
          const next = this.next({ recurrence: proposal.recurrence! }, now);
          const config = canonicalizeTrelloDigestConfig(trelloCandidate.config);
          const configHash = computeTrelloDigestConfigHash({
            config,
            recurrence: proposal.recurrence!,
            userId,
          });
          const created = await client.query(
            `INSERT INTO schedules(
               user_id, conv_id, name, request, recurrence, services, status, next_run_at, last_proposal_id,
               workspace_id, workspace_mode, kind, digest_config, digest_config_hash, digest_approved_at
             )
             VALUES($1, $2, $3, $4, $5, $6, 'active', $7, $8, $9, $10, 'trello_digest', $11, $12, $13) RETURNING *`,
            [
              userId,
              convId,
              proposal.name,
              proposal.request,
              JSON.stringify(proposal.recurrence),
              metadata.services,
              next,
              messageId,
              wsId,
              wsMode,
              JSON.stringify(config),
              configHash,
              now,
            ],
          );
          await registerScheduleFields(client, this.registry, 'schedules', created.rows[0].id, userId, segments, ['name', 'request', 'recurrence']);
          return this.recordState(client, tagScheduleContext(created.rows[0], segments), now);
        }
        if (isNotionSchedule && approvalMode === 'auto_digest') {
          const notionCandidate = metadata.digestCandidate as NotionDigestCandidate | undefined;
          if (!notionCandidate?.canAutoDigest || !notionCandidate.config) {
            throw new ScheduleConflict('AUTO_DIGEST_NOT_ALLOWED', notionCandidate?.disabledReason);
          }
          await this.ensureRoom(client, userId, { workspaceMode: wsMode, workspaceId: wsId });
          const next = this.next({ recurrence: proposal.recurrence! }, now);
          const config = canonicalizeNotionDigestConfig(notionCandidate.config);
          const configHash = computeNotionDigestConfigHash({
            config,
            recurrence: proposal.recurrence!,
            userId,
          });
          const created = await client.query(
            `INSERT INTO schedules(
               user_id, conv_id, name, request, recurrence, services, status, next_run_at, last_proposal_id,
               workspace_id, workspace_mode, kind, digest_config, digest_config_hash, digest_approved_at
             )
             VALUES($1, $2, $3, $4, $5, $6, 'active', $7, $8, $9, $10, 'notion_digest', $11, $12, $13) RETURNING *`,
            [
              userId,
              convId,
              proposal.name,
              proposal.request,
              JSON.stringify(proposal.recurrence),
              metadata.services,
              next,
              messageId,
              wsId,
              wsMode,
              JSON.stringify(config),
              configHash,
              now,
            ],
          );
          await registerScheduleFields(client, this.registry, 'schedules', created.rows[0].id, userId, segments, ['name', 'request', 'recurrence']);
          return this.recordState(client, tagScheduleContext(created.rows[0], segments), now);
        }
        if (isReadOnlyJiraDigestConfirm) {
          const jiraCandidate = metadata.digestCandidate as unknown as JiraDigestCandidate;
          if (!jiraCandidate?.canAutoDigest || !jiraCandidate.config) {
            throw new ScheduleConflict('AUTO_DIGEST_NOT_ALLOWED', jiraCandidate?.disabledReason);
          }
          await this.ensureRoom(client, userId, { workspaceMode: wsMode, workspaceId: wsId });
          const next = this.next({ recurrence: proposal.recurrence! }, now);
          const config = canonicalizeJiraDigestConfig(jiraCandidate.config);
          const configHash = computeJiraDigestConfigHash({
            config,
            recurrence: proposal.recurrence!,
            userId,
          });
          const created = await client.query(
            `INSERT INTO schedules(
               user_id, conv_id, name, request, recurrence, services, status, next_run_at, last_proposal_id,
               workspace_id, workspace_mode, kind, digest_config, digest_config_hash, digest_approved_at
             )
             VALUES($1, $2, $3, $4, $5, $6, 'active', $7, $8, $9, $10, 'myjira_digest', $11, $12, $13) RETURNING *`,
            [
              userId,
              convId,
              proposal.name,
              proposal.request,
              JSON.stringify(proposal.recurrence),
              metadata.services,
              next,
              messageId,
              wsId,
              wsMode,
              JSON.stringify(config),
              configHash,
              now,
            ],
          );
          await registerScheduleFields(client, this.registry, 'schedules', created.rows[0].id, userId, segments, ['name', 'request', 'recurrence']);
          return this.recordState(client, tagScheduleContext(created.rows[0], segments), now);
        }
        await this.ensureRoom(client, userId, { workspaceMode: wsMode, workspaceId: wsId });
        const next = this.next({ recurrence: proposal.recurrence! }, now);
        const created = await client.query(
          `INSERT INTO schedules(user_id, conv_id, name, request, recurrence, services, status, next_run_at, last_proposal_id, workspace_id, workspace_mode, kind, digest_config, digest_config_hash, digest_approved_at)
           VALUES($1, $2, $3, $4, $5, $6, 'active', $7, $8, $9, $10, $11, $12::jsonb, $13, $14) RETURNING *`,
          [
            userId,
            convId,
            proposal.name,
            proposal.request,
            JSON.stringify(proposal.recurrence),
            metadata.services,
            next,
            messageId,
            wsId,
            wsMode,
            digestFields.kind,
            digestFields.digestConfig,
            digestFields.digestConfigHash,
            digestFields.digestApprovedAt,
          ],
        );
        await registerScheduleFields(client,this.registry,'schedules',created.rows[0].id,userId,segments,['name','request','recurrence']);
        return this.recordState(client, tagScheduleContext(created.rows[0],segments), now);
      }
      if (!existing || metadata.baseVersion !== existing.version) throw new ScheduleConflict('STALE_PROPOSAL');
      const fields = this.transition(existing, proposal.action, proposal, metadata.services, now);
      if (!fields) {
        await client.query('UPDATE schedules SET last_proposal_id=$2 WHERE id=$1', [existing.id, messageId]);
        return this.unchanged(client, existing, now);
      }
      // Turning a finished schedule back on takes a place again.
      if (!OPEN.has(existing.status) && OPEN.has(fields.status)) await this.ensureRoom(client, userId, { workspaceMode: wsMode, workspaceId: wsId });
      if (proposal.action === 'update' && isTelegramSchedule) {
        if (wantAutoDigest && telegramDigestConfig && telegramDigestHash) {
          fields.kind = 'telegram_digest';
          fields.digest_config = telegramDigestConfig;
          fields.digest_config_hash = telegramDigestHash;
          fields.digest_approved_at = now;
        } else if (approvalMode === 'manual') {
          fields.kind = 'plan';
          fields.digest_config = null;
          fields.digest_config_hash = null;
          fields.digest_approved_at = null;
        } else if (existing.kind === 'telegram_digest' && existing.digest_config) {
          const tgCandidate = metadata.digestCandidate as TelegramDigestCandidate | undefined;
          if (tgCandidate?.canAutoDigest === false) {
            fields.kind = 'plan';
            fields.digest_config = null;
            fields.digest_config_hash = null;
            fields.digest_approved_at = null;
          } else {
            const updatedConfig: TelegramDigestConfig =
              tgCandidate?.canAutoDigest && tgCandidate.config
                ? tgCandidate.config
                : { ...(existing.digest_config as TelegramDigestConfig), recurrence: fields.recurrence };
            fields.kind = 'telegram_digest';
            fields.digest_config = updatedConfig;
            fields.digest_config_hash = computeTelegramDigestConfigHash(updatedConfig);
            fields.digest_approved_at = existing.digest_approved_at ?? now;
          }
        }
        return this.recordState(client, await this.saveFields(client, existing.id, fields, messageId, segments), now);
      }
      if (proposal.action === 'update' && existing.kind === 'calendar_digest' && approvalMode !== 'manual') {
        const evaluated = await evaluateCalendarDigestCandidate({
          pool: client,
          encryptionKey: this.options.encryptionKey,
          userId,
          services: fields.services,
          request: fields.request,
        });
        if (!evaluated.candidate.canAutoDigest || !evaluated.config || !evaluated.configHash) {
          if ((metadata.digestCandidate as CalendarDigestCandidate | undefined)?.canAutoDigest) {
            throw new ScheduleConflict('DIGEST_PREVIEW_CHANGED');
          }
          const downgraded = await client.query(
            `UPDATE schedules SET name=$2, request=$3, recurrence=$4, services=$5, status=$6, pause_reason=$7, next_run_at=$8,
               kind='plan', digest_config=NULL, digest_config_hash=NULL, digest_approved_at=NULL,
               version=version+1, updated_at=now(), last_proposal_id=COALESCE($9, last_proposal_id)
             WHERE id=$1 RETURNING *`,
            [existing.id, fields.name, fields.request, JSON.stringify(fields.recurrence), fields.services, fields.status, fields.pause_reason, fields.next_run_at, messageId],
          );
          await registerScheduleFields(client, this.registry, 'schedules', existing.id, userId, segments, ['name', 'request', 'recurrence']);
          return this.recordState(client, tagScheduleContext(downgraded.rows[0], segments), now);
        }
        const candidate = metadata.digestCandidate as CalendarDigestCandidate | undefined;
        if (!calendarDigestCandidateMatches(candidate, evaluated)) {
          throw new ScheduleConflict('DIGEST_PREVIEW_CHANGED');
        }
        const updatedDigest = await client.query(
          `UPDATE schedules SET name=$2, request=$3, recurrence=$4, services=$5, status=$6, pause_reason=$7, next_run_at=$8,
             digest_config=$10::jsonb, digest_config_hash=$11, digest_approved_at=$12,
             version=version+1, updated_at=now(), last_proposal_id=COALESCE($9, last_proposal_id)
           WHERE id=$1 RETURNING *`,
          [existing.id, fields.name, fields.request, JSON.stringify(fields.recurrence), fields.services, fields.status, fields.pause_reason, fields.next_run_at, messageId, JSON.stringify(candidate.config), computeCalendarDigestHash(candidate.config), now],
        );
        await registerScheduleFields(client, this.registry, 'schedules', existing.id, userId, segments, ['name', 'request', 'recurrence']);
        return this.recordState(client, tagScheduleContext(updatedDigest.rows[0], segments), now);
      }
      if (proposal.action === 'update' && isGithubSchedule) {
        let digestUpdate:
          | { kind: 'plan' }
          | { kind: 'github_digest'; config: GithubDigestConfig; configHash: string; approvedAt: Date }
          | undefined;
        if (approvalMode === 'manual') {
          if (existing.kind === 'github_digest') {
            digestUpdate = { kind: 'plan' };
          }
        } else if (approvalMode === 'auto_digest' || existing.kind === 'github_digest') {
          const githubCandidate = metadata.digestCandidate as ScheduleDigestCandidate | undefined;
          const candidateConfig = githubCandidate?.canAutoDigest && githubCandidate.config
            ? githubCandidate.config
            : existing.kind === 'github_digest' && proposal.request === existing.request
              ? (existing.digest_config as GithubDigestConfig | undefined)
              : undefined;
          if (!candidateConfig) {
            if (approvalMode === 'auto_digest') {
              throw new ScheduleConflict('AUTO_DIGEST_NOT_ALLOWED', githubCandidate?.disabledReason);
            }
            digestUpdate = { kind: 'plan' };
          } else {
            const config = canonicalizeDigestConfig(candidateConfig);
            const configHash = computeDigestConfigHash({
              config,
              recurrence: fields.recurrence,
              userId,
            });
            digestUpdate = {
              kind: 'github_digest',
              config,
              configHash,
              approvedAt: now,
            };
          }
        }
        return this.recordState(client, await this.saveFields(client, existing.id, fields, messageId, segments, digestUpdate), now);
      }
      if (proposal.action === 'update' && isTrelloSchedule) {
        let digestUpdate:
          | { kind: 'plan' }
          | { kind: 'trello_digest'; config: TrelloDigestConfig; configHash: string; approvedAt: Date }
          | undefined;
        if (approvalMode === 'manual') {
          if (existing.kind === 'trello_digest') {
            digestUpdate = { kind: 'plan' };
          }
        } else if (approvalMode === 'auto_digest' || existing.kind === 'trello_digest') {
          const trelloCandidate = metadata.digestCandidate as TrelloDigestCandidate | undefined;
          const candidateConfig = trelloCandidate?.canAutoDigest && trelloCandidate.config
            ? trelloCandidate.config
            : existing.kind === 'trello_digest' && proposal.request === existing.request
              ? (existing.digest_config as TrelloDigestConfig | undefined)
              : undefined;
          if (!candidateConfig) {
            if (approvalMode === 'auto_digest') {
              throw new ScheduleConflict('AUTO_DIGEST_NOT_ALLOWED', trelloCandidate?.disabledReason);
            }
            digestUpdate = { kind: 'plan' };
          } else {
            const config = canonicalizeTrelloDigestConfig(candidateConfig);
            const configHash = computeTrelloDigestConfigHash({
              config,
              recurrence: fields.recurrence,
              userId,
            });
            digestUpdate = {
              kind: 'trello_digest',
              config,
              configHash,
              approvedAt: now,
            };
          }
        }
        return this.recordState(client, await this.saveFields(client, existing.id, fields, messageId, segments, digestUpdate), now);
      }
      if (proposal.action === 'update' && isNotionSchedule) {
        let digestUpdate:
          | { kind: 'plan' }
          | { kind: 'notion_digest'; config: NotionDigestConfig; configHash: string; approvedAt: Date }
          | undefined;
        if (approvalMode === 'manual') {
          if (existing.kind === 'notion_digest') {
            digestUpdate = { kind: 'plan' };
          }
        } else if (approvalMode === 'auto_digest' || existing.kind === 'notion_digest') {
          const notionCandidate = metadata.digestCandidate as NotionDigestCandidate | undefined;
          const candidateConfig = notionCandidate?.canAutoDigest && notionCandidate.config
            ? notionCandidate.config
            : existing.kind === 'notion_digest' && proposal.request === existing.request
              ? (existing.digest_config as NotionDigestConfig | undefined)
              : undefined;
          if (!candidateConfig) {
            if (approvalMode === 'auto_digest') {
              throw new ScheduleConflict('AUTO_DIGEST_NOT_ALLOWED', notionCandidate?.disabledReason);
            }
            digestUpdate = { kind: 'plan' };
          } else {
            const config = canonicalizeNotionDigestConfig(candidateConfig);
            const configHash = computeNotionDigestConfigHash({
              config,
              recurrence: fields.recurrence,
              userId,
            });
            digestUpdate = {
              kind: 'notion_digest',
              config,
              configHash,
              approvedAt: now,
            };
          }
        }
        return this.recordState(client, await this.saveFields(client, existing.id, fields, messageId, segments, digestUpdate), now);
      }
      let savedRow = await this.saveFields(client, existing.id, fields, messageId, segments);
      if (proposal.action === 'update') {
        const updatedDigest = await client.query(
          `UPDATE schedules SET kind=$2, digest_config=$3::jsonb, digest_config_hash=$4, digest_approved_at=$5 WHERE id=$1 RETURNING *`,
          [
            existing.id,
            digestFields.kind,
            digestFields.digestConfig,
            digestFields.digestConfigHash,
            digestFields.digestApprovedAt,
          ],
        );
        savedRow = tagScheduleContext(updatedDigest.rows[0]!, segments);
      }
      return this.recordState(client, savedRow, now);
    }, 'STALE_PROPOSAL');
  }

  private async lockSchedule(client: pg.PoolClient, id: string, owner: string, scope?: ScheduleScope): Promise<ScheduleRow | null> {
    if (!isUuid(id)) return null;
    const state = await captureScheduleArtifact(client, this.registry, 'schedules', id);
    if (!state || state.owner !== owner) return null;
    if (scope) {
      const row = state.row;
      if (scope.workspaceMode === 'personal' && (row.workspace_id != null || !['personal', 'legacy', undefined].includes(row.workspace_mode))) return null;
      if (scope.workspaceMode === 'organization' && scope.workspaceId && (row.workspace_mode !== 'organization' || row.workspace_id !== scope.workspaceId)) return null;
      if (scope.workspaceMode === 'legacy' && row.workspace_id != null) return null;
    }
    await prelockScheduleArtifacts(client, this.registry, [state]);
    const guarded = await guardScheduleArtifact(client, this.registry, state, 'planning', 'UPDATE');
    if (!guarded.allowed) throw new ScheduleConflict('SCHEDULE_SOURCE_PURGED');
    return guarded.row;
  }

  async setStatus(input: { userId: string; scheduleId: string; action: 'pause' | 'resume' | 'cancel'; version: number; now: Date; scope?: ScheduleScope }): Promise<ScheduleChange> {
    return this.transaction(async (client) => {
      const row = await this.lockSchedule(client, input.scheduleId, input.userId, input.scope);
      if (!row) throw new ScheduleNotFound();
      if (row.version !== input.version) throw new ScheduleConflict('STALE_VERSION');
      const fields = this.transition(row, input.action, null, null, input.now);
      if (!fields) return this.unchanged(client, row, input.now);
      return this.recordState(client, await this.saveFields(client, row.id, fields, null, scheduleSourceContext(row)?.segments ?? []), input.now);
    });
  }

  list(userId: string, now: Date, scope?: ScheduleScope) {
    return this.repo.listForUser(userId, now, scope);
  }

  async listRuns(userId: string, scheduleId: string, limit: number, now: Date, scope?: ScheduleScope) {
    if (!await this.repo.ownedSchedule(scheduleId, userId, this.options.pool, false, scope)) throw new ScheduleNotFound();
    return this.repo.listRuns(scheduleId, limit, now);
  }

  pendingCount(userId: string, now: Date, scope?: ScheduleScope) {
    return this.repo.pendingCount(userId, now, scope);
  }

  /** Creates a run that plans now ("Chạy lượt này ngay", "Lập lại kế hoạch") and hands it to the scheduler. */
  async startRun(input: ({ scheduleId: string; trigger: 'manual' } | { runId: string; trigger: 'replan' }) & { userId: string; now: Date; scope?: ScheduleScope }): Promise<ScheduleRunView> {
    const { userId, now, scope } = input;
    const row = await this.transaction(async (client) => {
      let scheduleId: string;
      if (input.trigger === 'replan') {
        const previous = await this.repo.run(input.runId, client);
        if (!previous || !await this.repo.ownedSchedule(previous.schedule_id, userId, client, false, scope)) throw new ScheduleNotFound();
        if (!REPLANNABLE.has(runState(previous, now))) throw new ScheduleConflict('RUN_NOT_REPLANNABLE');
        scheduleId = previous.schedule_id;
      } else {
        scheduleId = input.scheduleId;
      }
      const schedule = await this.lockSchedule(client, scheduleId, userId, scope);
      if (!schedule) throw new ScheduleNotFound();
      // A finished one-off schedule may plan again for a run that needs it, but not start new runs.
      if (schedule.status === 'cancelled' || (input.trigger === 'manual' && schedule.status === 'completed')) throw new ScheduleConflict('SCHEDULE_CLOSED');
      const busy = await client.query("SELECT 1 FROM schedule_runs WHERE schedule_id=$1 AND status='planning'", [schedule.id]);
      if (busy.rowCount) throw new ScheduleConflict('RUN_IN_PROGRESS');
      const created = await client.query(
        `INSERT INTO schedule_runs(schedule_id, schedule_version, trigger, due_at, status) VALUES($1, $2, $3, $4, 'planning') RETURNING *`,
        [schedule.id, schedule.version, input.trigger, now],
      );
      return created.rows[0];
    });
    this.options.runner?.planNow(row.id).catch((error) => console.error('[schedules] planning a run failed:', error instanceof Error ? error.message : error));
    return runView(row, now);
  }
}
