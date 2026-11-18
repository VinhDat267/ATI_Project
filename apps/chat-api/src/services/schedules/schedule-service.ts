import type pg from 'pg';
import { decryptCredentials } from '@wap/tool-adapters';
import {
  isSheetsDigestConfigV2,
  normalizeTelegramChatId,
  TELEGRAM_CHAT_ID_PATTERN,
  type CalendarDigestCandidate,
  type CalendarDigestConfig,
  type CalendarDigestDelivery,
  type GithubDigestConfig,
  type GithubDigestDelivery,
  type ScheduleApprovalMode,
  type ScheduleDigestCandidate,
  type ScheduleKind,
  type ScheduleProposalMetadata,
  type ScheduleResponse,
  type ScheduleRunView,
  type ScheduleStateMetadata,
  type ScheduleView,
  type SheetsDigestCandidate,
  type SheetsDigestConfig,
  type SheetsDigestDelivery,
  type SlackDigestCandidate,
  type SlackDigestConfig,
  type TelegramDigestConfig,
  type TelegramDigestCandidate,
  type TrelloDigestConfig,
  type TrelloDigestCandidate,
  type NotionDigestConfig,
  type NotionDigestDelivery,
  type NotionDigestCandidate,
} from '@wap/tool-schemas';
import { isSheetsDigestEmitV2Enabled } from '../../config/schedules-runtime.js';
import type { CredentialRepo } from '../../db/repositories/credential-repo.js';
import { MessageRepo } from '../../db/repositories/message-repo.js';
import { ScheduleRepo, type Queryable, type ScheduleRow, type ScheduleScope } from '../../db/repositories/schedule-repo.js';
import { isUuid } from '../../db/repositories/uuid.js';
import { calendarDigestCandidateMatches, computeCalendarDigestHash, evaluateCalendarDigestCandidate } from './calendar-digest-candidate.js';
import { calendarOrGithubDeliveryUnknownKind, getJiraDeliveryUnknown, getSlackDeliveryUnknown, isNotionDeliveryUnknown, matchesDispatchedDigestConfig, runState, runView } from './run-state.js';
import { nextOccurrence, nextRuns } from './next-occurrence.js';
import { captureScheduleArtifact, guardScheduleArtifact, prelockScheduleArtifacts, registerScheduleFields, scheduleRegistry, scheduleSourceContext, tagScheduleContext } from '../slack/slack-schedule-lineage.js';
import { messageOutputSelectors } from '../slack/slack-message-selectors.js';
import type { DerivedSegmentInput } from '../../db/repositories/slack-derived-lineage-repo.js';
import {
  analyzeSheetsDigestCandidate,
  computeSheetsDigestHash,
  resolveTrustedScheduleScope,
  validateAndCanonicalizeDigestRange,
  verifySheetsDigestCandidateInTx,
  type FetchOrgSheetsMetadataFn,
} from './sheets-digest-candidate.js';
import { canonicalizeDigestConfig, computeDigestConfigHash } from './github-digest-candidate.js';
import {
  approvedTelegramNotionBinding,
  computeTelegramDigestConfigHash,
  evaluateTelegramDigestCandidate,
  telegramNotionSource,
  type TelegramConnectionLookupResult,
} from './telegram-digest-candidate.js';
import {
  computeSlackDigestConfigHash,
  evaluateSlackDigestCandidate,
} from './slack-digest-candidate.js';
import { canonicalizeDigestValue, matchesSlackDigestCredentialOwner, findSlackDigestCredential } from './multi-source-digest-candidate.js';
import {
  isMyCalendarDigestSource,
  loadLiveMyCalendarDigestConnection,
  matchesMyCalendarDigestBinding,
  MYCALENDAR_DIGEST_REAPPROVAL,
  readMyCalendarDigestBinding,
} from './mycalendar-digest-source.js';
import {
  isMySheetsDigestSource,
  loadLiveMySheetsDigestConnection,
  matchesMySheetsDigestBinding,
  MYSHEETS_DIGEST_REAPPROVAL,
  readMySheetsDigestBinding,
} from './mysheets-digest-source.js';
import { canonicalNotionDigestBinding, lockApprovedNotionSource, NOTION_DIGEST_REAPPROVAL, type NotionDigestSourceAuthority } from '../notion/digest-source-authority.js';
import {
  buildConfirmedTrelloDigestDelivery,
  canonicalizeTrelloDigestConfig,
  computeTrelloDigestConfigHash,
  getTrelloDigestPinnedCredentialIds,
} from './trello-digest-candidate.js';
import {
  isValidGmailDigestQuery,
  loadGmailDigestBinding,
  validateTelegramDigestGmailConfig,
} from './gmail-digest-binding.js';
import {
  assertDigestScheduleLiveScopeAndAuth,
  buildPinnedTelegramAdapterContext,
} from './digest-scope-guard.js';
import { approvedSlackNotionBinding, canonicalizeNotionDigestConfig, computeNotionDigestConfigHash } from './notion-digest-candidate.js';
import { canonicalizeJiraDigestConfig, computeJiraDigestConfigHash, type JiraDigestCandidate, type JiraDigestConfig } from './jira-digest-candidate.js';
import type { EvaluateJiraDigestInput } from './jira-digest-candidate.js';
import { buildConfirmedJiraDigestDelivery, isValidJiraDigestConfig } from './jira-digest-runner.js';

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
  DIGEST_V2_DISABLED_SINCE_PREVIEW:
    'Chế độ tự động tổng hợp Google Sheets v2 đã tạm tắt sau khi tạo bản xem trước. Vui lòng tạo lại đề xuất lịch.',
  LEGACY_V1_PROPOSAL_STALE:
    'Đề xuất lịch phiên bản cũ (v1) không đủ thông tin ràng buộc bảo mật. Vui lòng tạo đề xuất mới để xác nhận.',
  REAUTHORIZATION_REQUIRED:
    'Kết nối hoặc phạm vi quyền của lịch đã thay đổi. Vui lòng xem lại bản xem trước và xác nhận cấp quyền lại trước khi bật lịch.',
  REAUTHORIZATION_NOT_READY:
    'Chưa đủ kết nối hoặc quyền truy cập hợp lệ để cấp quyền lại cho lịch này.',
  DELIVERY_ALREADY_RESOLVED:
    'Lượt chạy này đã được xử lý trạng thái gửi trước đó.',
  RUN_NOT_AWAITING_DELIVERY_RESOLUTION:
    'Lượt chạy này không ở trạng thái chờ xác nhận kết quả gửi.',
  SCHEDULE_PAUSED:
    'Lịch đang tạm dừng. Vui lòng tiếp tục (Chạy tiếp) hoặc cấp quyền lại lịch trước khi tạo lượt gửi bù mới.',
  CONFIG_CHANGED_SINCE_RUN:
    'Cấu hình lịch đã thay đổi sau lượt chạy không xác định này. Không thể tự động gửi bù theo cấu hình mới để tránh gửi nhầm đích.',
  MISSING_DISPATCH_SNAPSHOT:
    'Không tìm thấy bản chụp cấu hình tại thời điểm gửi của lượt chạy này sau khi lịch đã thay đổi.',
} as const;
export type ScheduleConflictCode = keyof typeof SCHEDULE_CONFLICTS;

const SCHEDULE_BAD_REQUESTS: Record<string, string> = {
  BAD_REQUEST: 'Yêu cầu xử lý lịch không hợp lệ.',
  INVALID_DELIVERY_RESOLUTION: 'Lựa chọn xử lý trạng thái gửi không hợp lệ.',
  DUPLICATE_RISK_CONFIRMATION_REQUIRED:
    'Vui lòng xác nhận rủi ro gửi trùng trước khi tạo lượt gửi bù.',
};

export class ScheduleConflict extends Error {
  constructor(readonly code: ScheduleConflictCode, customMessage?: string) {
    super(customMessage || SCHEDULE_CONFLICTS[code]);
  }
}
export class ScheduleNotFound extends Error {
  constructor() { super('Không tìm thấy lịch.'); }
}
export class ScheduleBadRequest extends Error {
  readonly code: string;
  constructor(codeOrMessage: string, messageOrCode?: string) {
    if (/^[A-Z][A-Z0-9_]*$/.test(codeOrMessage)) {
      const code = codeOrMessage;
      const message = messageOrCode ?? SCHEDULE_BAD_REQUESTS[code] ?? code;
      super(message);
      this.code = code;
    } else {
      super(codeOrMessage);
      this.code = messageOrCode ?? 'BAD_REQUEST';
    }
  }
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
  jiraConnection?: EvaluateJiraDigestInput['jiraConnection'];
  pool: pg.Pool;
  timeZone: string;
  /** Plans a run in the background; the scheduler (SCHED-01) or nothing in tests. */
  runner?: { planNow(runId: string): Promise<void> };
  maxSchedules?: number;
  verifyNotionSource?: Pick<NotionDigestSourceAuthority, 'withSource'>['withSource'];
  credentialRepo?: CredentialRepo;
  encryptionKey?: string;
  gmailOAuthClientId?: string;
  mycalendarOAuthClientId?: string;
  mysheetsOAuthClientId?: string;
  mysheetsEnabled?: boolean;
  emitV2?: boolean;
  fetchOrgSheetsMetadata?: FetchOrgSheetsMetadataFn;
  getAdapter?: (serviceName: string, context?: any) => Promise<any> | any;
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
    includeAiSummary?: boolean;
  }): Promise<ScheduleChange> {
    const { userId, convId, messageId, now, scope, approvalMode, includeAiSummary } = input;
    if (!isUuid(convId) || !isUuid(messageId)) throw new ScheduleNotFound();
    // Check provider metadata before acquiring scheduler transaction locks.
    const verifyNotionSource = this.options.verifyNotionSource;
    let verifiedNotionSource: string | undefined;
    if (verifyNotionSource && approvalMode === 'auto_digest') {
      const preview = (await this.options.pool.query<{ metadata: ScheduleProposalMetadata }>(
        `SELECT m.metadata FROM messages m JOIN conversations c ON c.id=m.conv_id
          WHERE m.id=$1 AND c.id=$2 AND c.user_id=$3 AND c.workspace_id IS NULL AND c.workspace_mode <> 'organization'
            AND NOT EXISTS (SELECT 1 FROM schedules s WHERE s.conv_id=c.id AND s.last_proposal_id=m.id)`,
        [messageId, convId, userId],
      )).rows[0]?.metadata;
      if (preview?.type === 'schedule_proposal' &&
          (preview.proposal?.action === 'create' || preview.proposal?.action === 'update')) {
        const cfg = (preview.digestCandidate as TelegramDigestCandidate | NotionDigestCandidate | undefined)?.config;
        const binding = cfg && typeof cfg === 'object'
          ? 'sources' in cfg ? approvedTelegramNotionBinding(cfg) : approvedSlackNotionBinding(cfg)
          : undefined;
        if (binding?.ownerId === userId) {
          try {
            await verifyNotionSource(userId, binding, AbortSignal.timeout(10_000), async () => undefined);
            verifiedNotionSource = JSON.stringify(canonicalNotionDigestBinding(binding));
          } catch {
            // The transaction can still recognize a proposal another request already applied.
          }
        }
      }
    }
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
      const usesMyJira =
        metadata.services?.some((service) => service === 'myjira' || service.startsWith('myjira.')) ||
        metadata.proposal?.request?.toLowerCase().includes('myjira') ||
        Array.isArray(rawJiraCandidateConfig?.projects) ||
        (Array.isArray(rawJiraCandidateConfig?.sources) &&
          rawJiraCandidateConfig.sources.some((source: { service?: string } | null) => source?.service === 'myjira'));
      const isReadOnlyJiraDigestConfirm =
        !metadata.reauthorize &&
        approvalMode === 'auto_digest' &&
        (metadata.digestCandidate as any)?.canAutoDigest === true &&
        Boolean(rawJiraCandidateConfig) &&
        Array.isArray(rawJiraCandidateConfig.projects);
      const isReadOnlyTelegramJiraDigestConfirm =
        (approvalMode === 'auto_digest' || (metadata.reauthorize === true && approvalMode === undefined)) &&
        (metadata.digestCandidate as any)?.canAutoDigest === true &&
        Boolean(rawJiraCandidateConfig) &&
        Array.isArray(rawJiraCandidateConfig.sources) &&
        scope?.workspaceMode === 'organization' &&
        Boolean(scope?.workspaceId);
      const isAuthorizedOrgManualMyJiraConfirm =
        !metadata.reauthorize &&
        (!approvalMode || approvalMode === 'manual') &&
        scope?.workspaceMode === 'organization' &&
        Boolean(scope?.workspaceId) &&
        !metadata.services?.includes('jira');
      if (
        usesMyJira &&
        !isReadOnlyJiraDigestConfirm &&
        !isReadOnlyTelegramJiraDigestConfirm &&
        !isAuthorizedOrgManualMyJiraConfirm
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
      if (metadata.reauthorize) {
        if (!existing || metadata.scheduleId !== existing.id) {
          throw new ScheduleConflict('STALE_PROPOSAL');
        }
        if (existing.kind !== 'sheets_digest' && existing.kind !== 'telegram_digest' && existing.kind !== 'slack_digest') {
          throw new ScheduleConflict(
            'REAUTHORIZATION_NOT_READY',
            'Chỉ lịch tổng hợp Google Sheets, Telegram hoặc Slack mới hỗ trợ cấp quyền lại.',
          );
        }
        if (metadata.proposal?.action !== 'update') {
          throw new ScheduleConflict('DIGEST_NOT_ELIGIBLE');
        }
        if (existing.last_proposal_id === messageId) {
          throw new ScheduleConflict('STALE_PROPOSAL', 'Đề xuất cấp quyền lại này đã được sử dụng.');
        }
        if (
          !metadata.expiresAt ||
          Number.isNaN(Date.parse(metadata.expiresAt)) ||
          Date.parse(metadata.expiresAt) < now.getTime()
        ) {
          throw new ScheduleConflict(
            'STALE_PROPOSAL',
            'Đề xuất cấp quyền lại đã hết hạn (quá 15 phút). Vui lòng tạo lại bản xem trước.',
          );
        }
      } else if (
        metadata.expiresAt &&
        !Number.isNaN(Date.parse(metadata.expiresAt)) &&
        Date.parse(metadata.expiresAt) < now.getTime()
      ) {
        throw new ScheduleConflict('STALE_PROPOSAL');
      }
      // Confirming an applied proposal again changes nothing.
      if (existing?.last_proposal_id === messageId) return this.unchanged(client, existing, now);
      const latest = await client.query(
        "SELECT id FROM messages WHERE conv_id=$1 AND metadata->>'type'='schedule_proposal' ORDER BY created_at DESC, id DESC LIMIT 1", [convId]);
      if (latest.rows[0]?.id !== messageId) throw new ScheduleConflict('STALE_PROPOSAL');

      const proposal = metadata.proposal;
      const trustedScope = resolveTrustedScheduleScope(owner.rows[0]);
      const wsId = trustedScope.workspaceId;
      const wsMode = trustedScope.workspaceMode;
      if (wsMode === 'organization' && (!wsId || !isUuid(wsId))) {
        throw new ScheduleConflict('DIGEST_NOT_ELIGIBLE');
      }
      if (wsMode !== 'organization' && wsId !== null) {
        throw new ScheduleConflict('DIGEST_NOT_ELIGIBLE');
      }
      if (metadata.reauthorize && approvalMode === 'manual') {
        throw new ScheduleConflict(
          'DIGEST_NOT_ELIGIBLE',
          'Đề xuất cấp quyền lại chỉ áp dụng cho chế độ tự gửi báo cáo (auto_digest).',
        );
      }
      const effectiveApprovalMode: ScheduleApprovalMode | undefined =
        approvalMode ?? (metadata.reauthorize ? 'auto_digest' : undefined);
      if (
        usesMyJira &&
        (proposal.action === 'create' || proposal.action === 'update') &&
        effectiveApprovalMode !== 'auto_digest'
      ) {
        throw new ScheduleConflict(
          'DIGEST_NOT_ELIGIBLE',
          'Lịch Jira chỉ hỗ trợ tự gửi bản tin đã xác nhận. Hãy chọn kênh Slack hoặc cuộc trò chuyện Telegram cho bản tin.',
        );
      }
      const wantAutoDigest = effectiveApprovalMode === 'auto_digest';
      let persistedServices = metadata.services;
      const candidateConfig = (metadata.digestCandidate as any)?.config;
      const hasGithubDigestCandidate =
        Boolean(candidateConfig) &&
        Array.isArray(candidateConfig.repos) &&
        typeof candidateConfig.staleDays === 'number';
      const hasTrelloDigestCandidate =
        Boolean(candidateConfig) && Array.isArray(candidateConfig.boards);
      const hasNotionDigestCandidate =
        Boolean(candidateConfig) && Array.isArray(candidateConfig.databases);
      const hasMyJiraDigestCandidate =
        Boolean(candidateConfig) && Array.isArray(candidateConfig.projects);
      const candidateHasTelegramSources = Boolean(
        candidateConfig && typeof candidateConfig === 'object' && 'sources' in candidateConfig,
      );
      const candidateIsSlackMultiSource = Boolean(
        candidateConfig &&
        typeof candidateConfig === 'object' &&
        'sources' in candidateConfig &&
        candidateConfig.destination === 'slack',
      );
      const candidateHasNotionDatabases = Boolean(
        candidateConfig && typeof candidateConfig === 'object' && 'databases' in candidateConfig,
      );
      const isCalendarSchedule =
        !metadata.reauthorize &&
        (existing?.kind === 'calendar_digest' ||
          (!candidateHasTelegramSources &&
            !hasGithubDigestCandidate &&
            !hasTrelloDigestCandidate &&
            !hasNotionDigestCandidate &&
            !hasMyJiraDigestCandidate &&
            existing?.kind !== 'telegram_digest' &&
            existing?.kind !== 'slack_digest' &&
            existing?.kind !== 'github_digest' &&
            existing?.kind !== 'trello_digest' &&
            existing?.kind !== 'notion_digest' &&
            existing?.kind !== 'myjira_digest' &&
            existing?.kind !== 'sheets_digest' &&
            (metadata.services.includes('mycalendar') ||
              (metadata.services.includes('calendar') && !metadata.services.includes('github')))));
      const isSheetsSchedule =
        (Boolean(metadata.reauthorize) && existing?.kind === 'sheets_digest') ||
        existing?.kind === 'sheets_digest' ||
        (!candidateHasTelegramSources &&
          !hasGithubDigestCandidate &&
          !hasTrelloDigestCandidate &&
          !hasNotionDigestCandidate &&
          !hasMyJiraDigestCandidate &&
          existing?.kind !== 'telegram_digest' &&
          existing?.kind !== 'slack_digest' &&
          existing?.kind !== 'github_digest' &&
          existing?.kind !== 'trello_digest' &&
          existing?.kind !== 'notion_digest' &&
          existing?.kind !== 'myjira_digest' &&
          existing?.kind !== 'calendar_digest' &&
          (metadata.services.includes('mysheets') || metadata.services.includes('sheets')));
      const isGithubSchedule =
        !metadata.reauthorize &&
        !isCalendarSchedule &&
        !isSheetsSchedule &&
        !candidateIsSlackMultiSource &&
        existing?.kind !== 'slack_digest' &&
        (hasGithubDigestCandidate ||
          (existing?.kind === 'github_digest' && !candidateHasTelegramSources) ||
          (!candidateHasTelegramSources &&
            !metadata.services.includes('telegram') &&
            (metadata.services.includes('github') || existing?.kind === 'github_digest')));
      const isTrelloSchedule =
        !metadata.reauthorize &&
        !isCalendarSchedule &&
        !isSheetsSchedule &&
        !isGithubSchedule &&
        !candidateIsSlackMultiSource &&
        existing?.kind !== 'slack_digest' &&
        (hasTrelloDigestCandidate ||
          (existing?.kind === 'trello_digest' && !candidateHasTelegramSources) ||
          (!candidateHasTelegramSources &&
            !metadata.services.includes('telegram') &&
            (metadata.services.includes('trello') || existing?.kind === 'trello_digest')));
      const isNotionSchedule =
        !metadata.reauthorize &&
        !isCalendarSchedule &&
        !isSheetsSchedule &&
        !isGithubSchedule &&
        !isTrelloSchedule &&
        !candidateIsSlackMultiSource &&
        existing?.kind !== 'slack_digest' &&
        (hasNotionDigestCandidate ||
          candidateHasNotionDatabases ||
          (existing?.kind === 'notion_digest' && !candidateHasTelegramSources) ||
          (!candidateHasTelegramSources &&
            !metadata.services.includes('telegram') &&
            (metadata.services.includes('notion') || existing?.kind === 'notion_digest')));
      const isMyJiraSchedule =
        !metadata.reauthorize &&
        !isCalendarSchedule &&
        !isSheetsSchedule &&
        !isGithubSchedule &&
        !isTrelloSchedule &&
        !isNotionSchedule &&
        !candidateIsSlackMultiSource &&
        existing?.kind !== 'slack_digest' &&
        (hasMyJiraDigestCandidate ||
          (existing?.kind === 'myjira_digest' && !candidateHasTelegramSources) ||
          (!candidateHasTelegramSources &&
            !metadata.services.includes('telegram') &&
            (metadata.services.includes('myjira') || existing?.kind === 'myjira_digest')));
      const isTelegramSchedule =
        (!metadata.reauthorize || existing?.kind === 'telegram_digest') &&
        !isCalendarSchedule &&
        !isSheetsSchedule &&
        !isGithubSchedule &&
        !isTrelloSchedule &&
        !isNotionSchedule &&
        !isMyJiraSchedule &&
        !candidateIsSlackMultiSource &&
        existing?.kind !== 'slack_digest' &&
        (metadata.services.includes('telegram') ||
          existing?.kind === 'telegram_digest' ||
          (candidateHasTelegramSources && !candidateIsSlackMultiSource));
      const isSlackSchedule =
        (!metadata.reauthorize || existing?.kind === 'slack_digest') &&
        !isCalendarSchedule &&
        !isSheetsSchedule &&
        !isGithubSchedule &&
        !isTrelloSchedule &&
        !isNotionSchedule &&
        !isMyJiraSchedule &&
        !isTelegramSchedule &&
        (candidateIsSlackMultiSource || existing?.kind === 'slack_digest');
      let digestFields: {
        kind: 'plan' | 'sheets_digest' | 'calendar_digest' | 'github_digest' | 'telegram_digest' | 'slack_digest' | 'trello_digest' | 'notion_digest' | 'myjira_digest';
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
      let slackDigestConfig: SlackDigestConfig | null = null;
      let slackDigestHash: string | null = null;
      const previousTelegramConfig = existing?.kind === 'telegram_digest'
        ? existing.digest_config as TelegramDigestConfig | null
        : null;
      const previousSlackConfig = existing?.kind === 'slack_digest'
        ? existing.digest_config as SlackDigestConfig | null
        : null;

      if (wantAutoDigest && (proposal.action === 'create' || proposal.action === 'update') && !isGithubSchedule && !isTrelloSchedule && !isNotionSchedule && !isReadOnlyJiraDigestConfirm) {
        if (isTelegramSchedule) {
          const candidate = metadata.digestCandidate as TelegramDigestCandidate | undefined;
          if (!candidate || candidate.canAutoDigest !== true || !candidate.config || !candidate.configHash) {
            throw new ScheduleConflict('AUTO_DIGEST_NOT_ALLOWED', candidate?.disabledReason);
          }
          let candidateHash: string;
          try {
            candidateHash = computeTelegramDigestConfigHash(candidate.config);
          } catch {
            throw new ScheduleConflict('AUTO_DIGEST_NOT_ALLOWED');
          }
          if (candidateHash !== candidate.configHash) {
            throw new ScheduleConflict('AUTO_DIGEST_NOT_ALLOWED');
          }
          const confirmedAiSetting = includeAiSummary ??
            (metadata.reauthorize ? undefined : previousTelegramConfig?.includeAiSummary);
          const effectiveConfig: TelegramDigestConfig =
            confirmedAiSetting === undefined ? candidate.config : { ...candidate.config, includeAiSummary: confirmedAiSetting };
          await this.verifyTelegramDigestGmailConfigInTx(client, userId, effectiveConfig, metadata.services);
          await this.verifyMyCalendarDigestConfigInTx(client, userId, effectiveConfig, metadata.services);
          await this.verifyMySheetsDigestConfigInTx(client, userId, effectiveConfig, metadata.services);
          let computedHash: string;
          try {
            computedHash = computeTelegramDigestConfigHash(effectiveConfig);
          } catch {
            throw new ScheduleConflict('AUTO_DIGEST_NOT_ALLOWED');
          }
          if (telegramNotionSource(effectiveConfig) || metadata.services.includes('notion')) {
            const binding = approvedTelegramNotionBinding(effectiveConfig);
            if (!binding || wsMode === 'organization' ||
                (verifyNotionSource && verifiedNotionSource !== JSON.stringify(canonicalNotionDigestBinding(binding))) ||
                !(await lockApprovedNotionSource(client, userId, binding))) {
              throw new ScheduleConflict('REAUTHORIZATION_REQUIRED', NOTION_DIGEST_REAPPROVAL);
            }
          }
          telegramDigestConfig = effectiveConfig;
          telegramDigestHash = computedHash;
          digestFields = {
            kind: 'telegram_digest',
            digestConfig: JSON.stringify(telegramDigestConfig),
            digestConfigHash: telegramDigestHash,
            digestApprovedAt: now,
          };
        } else if (isSlackSchedule) {
          const candidate = metadata.digestCandidate as SlackDigestCandidate | undefined;
          if (!candidate || candidate.canAutoDigest !== true || !candidate.config || !candidate.configHash) {
            throw new ScheduleConflict('AUTO_DIGEST_NOT_ALLOWED', candidate?.disabledReason);
          }
          if (
            candidate.config.workspaceMode !== wsMode ||
            (candidate.config.workspaceId ?? null) !== wsId
          ) {
            throw new ScheduleConflict('DIGEST_PREVIEW_CHANGED', 'Không gian làm việc không khớp với bản xem trước.');
          }
          let candidateHash: string;
          try {
            candidateHash = computeSlackDigestConfigHash(candidate.config);
          } catch {
            throw new ScheduleConflict('AUTO_DIGEST_NOT_ALLOWED');
          }
          if (candidateHash !== candidate.configHash) {
            throw new ScheduleConflict('AUTO_DIGEST_NOT_ALLOWED');
          }
          const confirmedAiSetting = includeAiSummary ??
            (metadata.reauthorize ? undefined : previousSlackConfig?.includeAiSummary);
          const effectiveConfig: SlackDigestConfig =
            confirmedAiSetting === undefined ? candidate.config : { ...candidate.config, includeAiSummary: confirmedAiSetting };
          await this.verifyTelegramDigestGmailConfigInTx(client, userId, effectiveConfig as unknown as TelegramDigestConfig, metadata.services);
          await this.verifyMyCalendarDigestConfigInTx(client, userId, effectiveConfig, metadata.services);
          await this.verifyMySheetsDigestConfigInTx(client, userId, effectiveConfig, metadata.services);
          await this.verifySlackDigestConfigInTx(client, {
            userId,
            wsMode,
            wsId,
            config: effectiveConfig,
            conflictCode: 'DIGEST_PREVIEW_CHANGED',
          });
          let computedHash: string;
          try {
            computedHash = computeSlackDigestConfigHash(effectiveConfig);
          } catch {
            throw new ScheduleConflict('AUTO_DIGEST_NOT_ALLOWED');
          }
          slackDigestConfig = effectiveConfig;
          slackDigestHash = computedHash;
          digestFields = {
            kind: 'slack_digest',
            digestConfig: JSON.stringify(slackDigestConfig),
            digestConfigHash: slackDigestHash,
            digestApprovedAt: now,
          };
        } else if (isCalendarSchedule) {
          const evaluated = await evaluateCalendarDigestCandidate({
            pool: client,
            encryptionKey: this.options.encryptionKey,
            userId,
            services: metadata.services,
            request: proposal.request!,
            workspaceMode: wsMode,
            workspaceId: wsId,
          });
          if (!evaluated.candidate.canAutoDigest || !evaluated.config || !evaluated.configHash) {
            throw new ScheduleConflict('AUTO_DIGEST_NOT_ELIGIBLE');
          }
          const candidate = metadata.digestCandidate as CalendarDigestCandidate | undefined;
          if (!calendarDigestCandidateMatches(candidate, evaluated)) {
            throw new ScheduleConflict('DIGEST_PREVIEW_CHANGED');
          }
          const effectiveConfig: CalendarDigestConfig =
            typeof includeAiSummary === 'boolean' && candidate?.config
              ? { ...candidate.config, includeSummary: includeAiSummary }
              : candidate!.config!;
          digestFields = {
            kind: 'calendar_digest',
            digestConfig: JSON.stringify(effectiveConfig),
            digestConfigHash: computeCalendarDigestHash(effectiveConfig),
            digestApprovedAt: now,
          };
        } else {
          const sheetsCandidate = metadata.digestCandidate as SheetsDigestCandidate | undefined;
          if (!sheetsCandidate?.canAutoDigest || !sheetsCandidate.config) {
            throw new ScheduleConflict('DIGEST_NOT_ELIGIBLE');
          }
          if (!metadata.reauthorize && !isSheetsDigestEmitV2Enabled(this.options)) {
            throw new ScheduleConflict('DIGEST_V2_DISABLED_SINCE_PREVIEW');
          }
          if (!isSheetsDigestConfigV2(sheetsCandidate.config)) {
            throw new ScheduleConflict('LEGACY_V1_PROPOSAL_STALE');
          }
          const originalCandidateHash = computeSheetsDigestHash({
            userId,
            recurrence: proposal.recurrence!,
            config: sheetsCandidate.config,
          });
          if (sheetsCandidate.configHash && sheetsCandidate.configHash !== originalCandidateHash) {
            throw new ScheduleConflict(
              'DIGEST_PREVIEW_CHANGED',
              'Mã băm xác nhận của cấu hình lịch không khớp với bản xem trước.',
            );
          }
          const effectiveCandidateConfig: SheetsDigestConfig =
            typeof includeAiSummary === 'boolean'
              ? { ...sheetsCandidate.config, includeAiSummary }
              : sheetsCandidate.config;
          const effectiveExpectedHash = computeSheetsDigestHash({
            userId,
            recurrence: proposal.recurrence!,
            config: effectiveCandidateConfig,
          });
          const verified = await verifySheetsDigestCandidateInTx(client, {
            userId,
            recurrence: proposal.recurrence!,
            config: effectiveCandidateConfig,
            expectedHash: effectiveExpectedHash,
            trustedScope,
            encryptionKey: this.options.encryptionKey,
            gmailOAuthClientId: this.options.gmailOAuthClientId,
            mysheetsOAuthClientId: this.options.mysheetsOAuthClientId,
            mysheetsEnabled: this.options.mysheetsEnabled,
          });
          if (!verified.ok) {
            throw new ScheduleConflict('DIGEST_PREVIEW_CHANGED', verified.reason);
          }
          persistedServices = [
            verified.config.source.service,
            verified.config.destination.service,
          ];
          digestFields = {
            kind: 'sheets_digest',
            digestConfig: JSON.stringify(verified.config),
            digestConfigHash: verified.configHash,
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
          const binding = approvedSlackNotionBinding(notionCandidate.config);
          if (!binding || wsMode === 'organization' ||
              (verifyNotionSource && verifiedNotionSource !== JSON.stringify(canonicalNotionDigestBinding(binding))) ||
              !(await lockApprovedNotionSource(client, userId, binding))) {
            throw new ScheduleConflict('REAUTHORIZATION_REQUIRED', NOTION_DIGEST_REAPPROVAL);
          }
          const config = canonicalizeNotionDigestConfig(notionCandidate.config);
          const configHash = computeNotionDigestConfigHash({
            config,
            recurrence: proposal.recurrence!,
            userId,
          });
          if (notionCandidate.configHash !== configHash) {
            throw new ScheduleConflict('REAUTHORIZATION_REQUIRED', NOTION_DIGEST_REAPPROVAL);
          }
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
          if (wsMode !== 'organization' || !wsId || jiraCandidate.config.workspaceId !== wsId) {
            throw new ScheduleConflict('DIGEST_NOT_ELIGIBLE', 'Bản tin Jira chỉ hỗ trợ trong Workspace Tổ chức hợp lệ.');
          }
          await this.assertJiraDigestConfigInTx(client, userId, wsId, jiraCandidate.config);
          await this.ensureRoom(client, userId, { workspaceMode: wsMode, workspaceId: wsId });
          const next = this.next({ recurrence: proposal.recurrence! }, now);
          const effectiveRaw: JiraDigestConfig =
            typeof includeAiSummary === 'boolean'
              ? { ...jiraCandidate.config, includeAiSummary }
              : jiraCandidate.config;
          const config = canonicalizeJiraDigestConfig(effectiveRaw);
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
            persistedServices,
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
      if (proposal.action === 'resume') await this.assertNotionSourceInTx(client, existing);
      if (proposal.action === 'resume' && existing.kind === 'sheets_digest') {
        if (existing.status === 'cancelled' || existing.status === 'completed') {
          throw new ScheduleConflict('SCHEDULE_CLOSED');
        }
        await this.assertSheetsDigestCanResumeInTx(client, existing);
      }
      if (proposal.action === 'resume' && existing.kind === 'telegram_digest') {
        if (existing.status === 'cancelled' || existing.status === 'completed') {
          throw new ScheduleConflict('SCHEDULE_CLOSED');
        }
        await this.assertTelegramDigestCanResumeInTx(client, existing);
      }
      if (proposal.action === 'resume' && existing.kind === 'slack_digest') {
        if (existing.status === 'cancelled' || existing.status === 'completed') {
          throw new ScheduleConflict('SCHEDULE_CLOSED');
        }
        await this.assertSlackDigestCanResumeInTx(client, existing);
      }
      if (proposal.action === 'resume' && existing.kind === 'myjira_digest') {
        if (existing.status === 'cancelled' || existing.status === 'completed') {
          throw new ScheduleConflict('SCHEDULE_CLOSED');
        }
        await this.assertMyJiraDigestCanResumeInTx(client, existing);
      }
      if (proposal.action === 'resume' && existing.kind === 'calendar_digest') {
        if (existing.status === 'cancelled' || existing.status === 'completed') {
          throw new ScheduleConflict('SCHEDULE_CLOSED');
        }
        await this.assertCalendarDigestCanResumeInTx(client, existing);
      }
      const fields = this.transition(existing, proposal.action, proposal, persistedServices, now);
      if (!fields) {
        await client.query('UPDATE schedules SET last_proposal_id=$2 WHERE id=$1', [existing.id, messageId]);
        return this.unchanged(client, existing, now);
      }
      if (metadata.reauthorize) {
        fields.status = 'active';
        fields.pause_reason = null;
        fields.next_run_at = this.next(fields, now);
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
          if (fields.services.includes('mycalendar') && tgCandidate?.canAutoDigest === false) {
            await this.verifyMyCalendarDigestConfigInTx(client, userId, existing.digest_config as TelegramDigestConfig, fields.services, 'REAUTHORIZATION_REQUIRED');
          }
          if (fields.services.includes('mysheets') && tgCandidate?.canAutoDigest === false) {
            await this.verifyMySheetsDigestConfigInTx(client, userId, existing.digest_config as TelegramDigestConfig, fields.services, 'REAUTHORIZATION_REQUIRED');
          }
          const existingGmailValidation = validateTelegramDigestGmailConfig(existing.digest_config);
          const involvesGmail =
            fields.services.includes('gmail') || existingGmailValidation.kind !== 'non_gmail';
          if (tgCandidate?.canAutoDigest === false || (involvesGmail && (!tgCandidate?.canAutoDigest || !tgCandidate.config))) {
            fields.kind = 'plan';
            fields.digest_config = null;
            fields.digest_config_hash = null;
            fields.digest_approved_at = null;
          } else {
            const previousConfig = existing.digest_config as TelegramDigestConfig;
            const previouslyNotion = Boolean(telegramNotionSource(previousConfig));
            const previewNotion = Boolean(telegramNotionSource(tgCandidate?.config));
            if ((previouslyNotion && proposal.request !== existing.request) || (previewNotion && !previouslyNotion)) {
              throw new ScheduleConflict('REAUTHORIZATION_REQUIRED', NOTION_DIGEST_REAPPROVAL);
            }
            const proposedConfig: TelegramDigestConfig =
              !previouslyNotion && tgCandidate?.canAutoDigest && tgCandidate.config
                ? tgCandidate.config
                : { ...previousConfig, recurrence: fields.recurrence };
            const updatedConfig: TelegramDigestConfig =
              previousConfig.includeAiSummary === undefined
                ? proposedConfig
                : { ...proposedConfig, includeAiSummary: previousConfig.includeAiSummary };
            this.assertUnchangedMyCalendarDigestAuthority(previousConfig, updatedConfig);
            await this.verifyMyCalendarDigestConfigInTx(client, userId, updatedConfig, fields.services, 'REAUTHORIZATION_REQUIRED');
            this.assertUnchangedMySheetsDigestAuthority(previousConfig, updatedConfig);
            await this.verifyMySheetsDigestConfigInTx(client, userId, updatedConfig, fields.services, 'REAUTHORIZATION_REQUIRED');
            if (previouslyNotion) {
              const binding = approvedTelegramNotionBinding(updatedConfig);
              if (!binding || wsMode === 'organization' || !(await lockApprovedNotionSource(client, userId, binding))) {
                throw new ScheduleConflict('REAUTHORIZATION_REQUIRED', NOTION_DIGEST_REAPPROVAL);
              }
            }
            if (involvesGmail) {
              await this.verifyTelegramDigestGmailConfigInTx(client, userId, updatedConfig, fields.services);
            }
            fields.kind = 'telegram_digest';
            fields.digest_config = updatedConfig;
            fields.digest_config_hash = computeTelegramDigestConfigHash(updatedConfig);
            fields.digest_approved_at = existing.digest_approved_at ?? now;
          }
        }
        return this.recordState(client, await this.saveFields(client, existing.id, fields, messageId, segments), now);
      }
      if (proposal.action === 'update' && isSlackSchedule) {
        if (wantAutoDigest && slackDigestConfig && slackDigestHash) {
          fields.kind = 'slack_digest';
          fields.digest_config = slackDigestConfig;
          fields.digest_config_hash = slackDigestHash;
          fields.digest_approved_at = now;
        } else if (approvalMode === 'manual') {
          fields.kind = 'plan';
          fields.digest_config = null;
          fields.digest_config_hash = null;
          fields.digest_approved_at = null;
        } else if (existing.kind === 'slack_digest' && existing.digest_config) {
          const slackCandidate = metadata.digestCandidate as SlackDigestCandidate | undefined;
          if (fields.services.includes('mycalendar') && slackCandidate?.canAutoDigest === false) {
            await this.verifyMyCalendarDigestConfigInTx(client, userId, existing.digest_config as SlackDigestConfig, fields.services, 'REAUTHORIZATION_REQUIRED');
          }
          if (fields.services.includes('mysheets') && slackCandidate?.canAutoDigest === false) {
            await this.verifyMySheetsDigestConfigInTx(client, userId, existing.digest_config as SlackDigestConfig, fields.services, 'REAUTHORIZATION_REQUIRED');
          }
          const existingGmailValidation = validateTelegramDigestGmailConfig(existing.digest_config);
          const involvesGmail =
            fields.services.includes('gmail') || existingGmailValidation.kind !== 'non_gmail';
          if (slackCandidate?.canAutoDigest === false || (involvesGmail && (!slackCandidate?.canAutoDigest || !slackCandidate.config))) {
            fields.kind = 'plan';
            fields.digest_config = null;
            fields.digest_config_hash = null;
            fields.digest_approved_at = null;
          } else {
            const previousConfig = existing.digest_config as SlackDigestConfig;
            let proposedConfig: SlackDigestConfig;
            if (slackCandidate?.canAutoDigest) {
              if (!slackCandidate.config || !slackCandidate.configHash) {
                throw new ScheduleConflict('AUTO_DIGEST_NOT_ALLOWED');
              }
              let candHash: string;
              try {
                candHash = computeSlackDigestConfigHash(slackCandidate.config);
              } catch {
                throw new ScheduleConflict('AUTO_DIGEST_NOT_ALLOWED');
              }
              if (candHash !== slackCandidate.configHash) {
                throw new ScheduleConflict('AUTO_DIGEST_NOT_ALLOWED');
              }
              proposedConfig = slackCandidate.config;
            } else {
              proposedConfig = { ...previousConfig, recurrence: fields.recurrence };
            }
            const updatedConfig: SlackDigestConfig =
              previousConfig.includeAiSummary === undefined
                ? proposedConfig
                : { ...proposedConfig, includeAiSummary: previousConfig.includeAiSummary };
            this.assertUnchangedMyCalendarDigestAuthority(previousConfig, updatedConfig);
            await this.verifyMyCalendarDigestConfigInTx(client, userId, updatedConfig, fields.services, 'REAUTHORIZATION_REQUIRED');
            this.assertUnchangedMySheetsDigestAuthority(previousConfig, updatedConfig);
            await this.verifyMySheetsDigestConfigInTx(client, userId, updatedConfig, fields.services, 'REAUTHORIZATION_REQUIRED');
            await this.verifySlackDigestConfigInTx(client, {
              userId,
              wsMode,
              wsId,
              config: updatedConfig,
              conflictCode: 'DIGEST_PREVIEW_CHANGED',
            });
            if (involvesGmail) {
              await this.verifyTelegramDigestGmailConfigInTx(client, userId, updatedConfig as unknown as TelegramDigestConfig, fields.services);
            }
            fields.kind = 'slack_digest';
            fields.digest_config = updatedConfig;
            fields.digest_config_hash = computeSlackDigestConfigHash(updatedConfig);
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
          workspaceMode: wsMode,
          workspaceId: wsId,
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
        const prevCalendarConfig = existing.digest_config as CalendarDigestConfig | null;
        const resolvedIncludeSummary =
          typeof includeAiSummary === 'boolean'
            ? includeAiSummary
            : typeof prevCalendarConfig?.includeSummary === 'boolean'
              ? prevCalendarConfig.includeSummary
              : candidate!.config!.includeSummary;
        const effectiveConfig: CalendarDigestConfig = {
          ...candidate!.config!,
          includeSummary: resolvedIncludeSummary,
        };
        const updatedDigest = await client.query(
          `UPDATE schedules SET name=$2, request=$3, recurrence=$4, services=$5, status=$6, pause_reason=$7, next_run_at=$8,
             digest_config=$10::jsonb, digest_config_hash=$11, digest_approved_at=$12,
             version=version+1, updated_at=now(), last_proposal_id=COALESCE($9, last_proposal_id)
           WHERE id=$1 RETURNING *`,
          [existing.id, fields.name, fields.request, JSON.stringify(fields.recurrence), fields.services, fields.status, fields.pause_reason, fields.next_run_at, messageId, JSON.stringify(effectiveConfig), computeCalendarDigestHash(effectiveConfig), now],
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
          const candidateConfig = approvalMode === 'auto_digest'
            ? notionCandidate?.canAutoDigest ? notionCandidate.config : undefined
            : existing.kind === 'notion_digest' && proposal.request === existing.request
              ? (existing.digest_config as NotionDigestConfig | undefined)
              : undefined;
          if (!candidateConfig) {
            if (approvalMode === 'auto_digest') {
              throw new ScheduleConflict('AUTO_DIGEST_NOT_ALLOWED', notionCandidate?.disabledReason);
            }
            digestUpdate = { kind: 'plan' };
          } else {
            const binding = approvedSlackNotionBinding(candidateConfig);
            if (!binding || wsMode === 'organization' ||
                (approvalMode === 'auto_digest' && verifyNotionSource &&
                  verifiedNotionSource !== JSON.stringify(canonicalNotionDigestBinding(binding))) ||
                !(await lockApprovedNotionSource(client, userId, binding))) {
              throw new ScheduleConflict('REAUTHORIZATION_REQUIRED', NOTION_DIGEST_REAPPROVAL);
            }
            const config = canonicalizeNotionDigestConfig(candidateConfig);
            const configHash = computeNotionDigestConfigHash({
              config,
              recurrence: fields.recurrence,
              userId,
            });
            if (approvalMode === 'auto_digest' && notionCandidate?.configHash !== configHash) {
              throw new ScheduleConflict('REAUTHORIZATION_REQUIRED', NOTION_DIGEST_REAPPROVAL);
            }
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
      if (proposal.action === 'update' && isMyJiraSchedule) {
        let digestUpdate:
          | { kind: 'plan' }
          | { kind: 'myjira_digest'; config: JiraDigestConfig; configHash: string; approvedAt: Date }
          | undefined;
        if (approvalMode === 'manual') {
          if (existing.kind === 'myjira_digest') {
            digestUpdate = { kind: 'plan' };
          }
        } else if (approvalMode === 'auto_digest' || existing.kind === 'myjira_digest') {
          const jiraCandidate = metadata.digestCandidate as JiraDigestCandidate | undefined;
          const candidateConfig = jiraCandidate?.canAutoDigest && jiraCandidate.config
            ? jiraCandidate.config
            : existing.kind === 'myjira_digest' && proposal.request === existing.request
              ? (existing.digest_config as JiraDigestConfig | undefined)
              : undefined;
          if (!candidateConfig) {
            if (approvalMode === 'auto_digest') {
              throw new ScheduleConflict('AUTO_DIGEST_NOT_ALLOWED', jiraCandidate?.disabledReason);
            }
            digestUpdate = { kind: 'plan' };
          } else {
            if (wsMode !== 'organization' || !wsId || candidateConfig.workspaceId !== wsId) {
              throw new ScheduleConflict('DIGEST_NOT_ELIGIBLE', 'Bản tin Jira chỉ hỗ trợ trong Workspace Tổ chức hợp lệ.');
            }
            const previousConfig = existing.kind === 'myjira_digest' && isValidJiraDigestConfig(existing.digest_config)
              ? existing.digest_config
              : null;
            const confirmedAiSummary = includeAiSummary ??
              (previousConfig ? previousConfig.includeAiSummary === true : candidateConfig.includeAiSummary);
            const nextRawConfig: JiraDigestConfig = { ...candidateConfig, includeAiSummary: confirmedAiSummary };
            await this.assertJiraDigestConfigInTx(client, userId, wsId, nextRawConfig);
            const config = canonicalizeJiraDigestConfig(nextRawConfig);
            const configHash = computeJiraDigestConfigHash({
              config,
              recurrence: fields.recurrence,
              userId,
            });
            digestUpdate = {
              kind: 'myjira_digest',
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
        if (metadata.reauthorize && digestFields.kind !== 'sheets_digest') {
          throw new ScheduleConflict(
            'REAUTHORIZATION_NOT_READY',
            'Chỉ lịch tổng hợp Google Sheets (sheets_digest) mới hỗ trợ cấp quyền lại v2.',
          );
        }
        const updatedDigest = await client.query(
          `UPDATE schedules SET kind=$2, digest_config=$3::jsonb, digest_config_hash=$4, digest_approved_at=$5, workspace_id=$6, workspace_mode=$7 WHERE id=$1 RETURNING *`,
          [
            existing.id,
            digestFields.kind,
            digestFields.digestConfig,
            digestFields.digestConfigHash,
            digestFields.digestApprovedAt,
            wsId,
            wsMode,
          ],
        );
        savedRow = tagScheduleContext(updatedDigest.rows[0]!, segments);
      }
      return this.recordState(client, savedRow, now);
    }, 'STALE_PROPOSAL');
  }

  private isReauthPauseReason(row: ScheduleRow): boolean {
    const code = (row as unknown as { paused_reason_code?: string | null }).paused_reason_code;
    if (code === 'REAUTH_REQUIRED') return true;
    const reason = row.pause_reason ?? '';
    return (
      reason === 'REAUTH_REQUIRED' ||
      /\bREAUTH_REQUIRED\b/i.test(reason) ||
      /cấp quyền lại|xác nhận lại lịch|phiên bản cũ\s*\(v1\)|kết nối lại|hộp thư đã xác nhận|bị ngắt hoặc thay đổi/iu.test(reason)
    );
  }

  private async loadLiveTelegramLookup(
    db: Queryable,
    userId: string,
  ): Promise<TelegramConnectionLookupResult> {
    const encryptionKey = this.options.encryptionKey ?? process.env.ENCRYPTION_KEY ?? '';
    if (!encryptionKey || !isUuid(userId)) {
      return { status: 'not_connected', selectedChats: [] };
    }
    const res = await db.query<{ id: string; config: string; status: string }>(
      `SELECT id, config, status
         FROM service_credentials
        WHERE service = 'telegram' AND user_id = $1 AND workspace_id IS NULL
        ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    const row = res.rows[0];
    if (!row) {
      return { status: 'not_connected', selectedChats: [] };
    }
    if (row.status !== 'active') {
      return { status: 'reconnect_required', selectedChats: [] };
    }
    let decrypted: Record<string, any>;
    try {
      decrypted = decryptCredentials(row.config, encryptionKey) as Record<string, any>;
    } catch {
      return { status: 'reconnect_required', selectedChats: [] };
    }
    const telegramUserIdRaw =
      typeof decrypted.telegramUserId === 'string' ? decrypted.telegramUserId.trim() : '';
    const telegramUserId = telegramUserIdRaw ? normalizeTelegramChatId(telegramUserIdRaw) : '';
    if (!telegramUserId) {
      return { status: 'reconnect_required', selectedChats: [] };
    }
    const selectedChats: TelegramConnectionLookupResult['selectedChats'] = [];
    const seenChatIds = new Set<string>();
    for (const rawChat of Array.isArray(decrypted.selectedChats) ? decrypted.selectedChats : []) {
      if (!rawChat || typeof rawChat.chatId !== 'string') continue;
      const trimmed = rawChat.chatId.trim();
      if (!TELEGRAM_CHAT_ID_PATTERN.test(trimmed)) continue;
      const chatId = normalizeTelegramChatId(trimmed);
      if (seenChatIds.has(chatId)) continue;
      seenChatIds.add(chatId);
      const chatType =
        rawChat.type === 'private' ||
        rawChat.type === 'group' ||
        rawChat.type === 'supergroup' ||
        rawChat.type === 'channel'
          ? rawChat.type
          : chatId.startsWith('-')
            ? 'supergroup'
            : 'private';
      const title =
        typeof rawChat.title === 'string' && rawChat.title.trim()
          ? rawChat.title.trim()
          : chatId;
      selectedChats.push({ chatId, title, type: chatType });
    }
    return {
      status: 'connected',
      selectedChats,
      telegramUserId,
      username: typeof decrypted.username === 'string' ? decrypted.username : '',
      connection: {
        credentialId: row.id,
        telegramUserId,
        username: typeof decrypted.username === 'string' ? decrypted.username : '',
        chatIds: selectedChats.map((c) => c.chatId),
      },
    };
  }

  private async loadLiveGithubLookup(db: Queryable, userId: string) {
    const encryptionKey = this.options.encryptionKey ?? process.env.ENCRYPTION_KEY ?? '';
    if (!encryptionKey || !isUuid(userId)) {
      return { status: 'not_connected' as const };
    }
    const res = await db.query<{ id: string; config: string; status: string }>(
      `SELECT id, config, status
         FROM service_credentials
        WHERE service = 'github' AND user_id = $1 AND workspace_id IS NULL
        ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    const row = res.rows[0];
    if (!row || row.status !== 'active') {
      return { status: 'not_connected' as const };
    }
    try {
      const decrypted = decryptCredentials(row.config, encryptionKey) as Record<string, any>;
      const repos = Array.isArray(decrypted.repos)
        ? decrypted.repos.filter((r): r is string => typeof r === 'string' && r.trim().length > 0)
        : [];
      return {
        status: 'connected' as const,
        connection: {
          credentialId: row.id,
          githubUserId: String(decrypted.githubUserId ?? ''),
          login: String(decrypted.login ?? ''),
          repos,
        },
      };
    } catch {
      return { status: 'not_connected' as const };
    }
  }

  private async assertSheetsDigestCanResumeInTx(client: pg.PoolClient, row: ScheduleRow): Promise<void> {
    if (
      this.isReauthPauseReason(row) ||
      !isSheetsDigestConfigV2(row.digest_config) ||
      !row.digest_config_hash
    ) {
      throw new ScheduleConflict('REAUTHORIZATION_REQUIRED');
    }
    const trustedScope = resolveTrustedScheduleScope(row);
    const verified = await verifySheetsDigestCandidateInTx(client, {
      userId: row.user_id,
      recurrence: row.recurrence,
      config: row.digest_config,
      expectedHash: row.digest_config_hash,
      trustedScope,
      encryptionKey: this.options.encryptionKey,
      gmailOAuthClientId: this.options.gmailOAuthClientId,
      mysheetsOAuthClientId: this.options.mysheetsOAuthClientId,
      mysheetsEnabled: this.options.mysheetsEnabled,
    });
    if (!verified.ok) {
      throw new ScheduleConflict('REAUTHORIZATION_REQUIRED', verified.reason);
    }
  }

  async createReauthorizePreview(input: {
    userId: string;
    scheduleId: string;
    now?: Date;
    scope?: ScheduleScope;
    includeAiSummary?: boolean;
  }): Promise<{
    proposalMessageId: string;
    convId: string;
    scheduleId: string;
    baseVersion: number;
    expiresAt: string;
    candidate: SheetsDigestCandidate | TelegramDigestCandidate | SlackDigestCandidate;
    metadata: ScheduleProposalMetadata;
  }> {
    // Allow SheetsDigestCandidate | TelegramDigestCandidate | SlackDigestCandidate in runtime return
    const { userId, scheduleId, scope } = input;
    const now = input.now ?? new Date();
    if (!isUuid(userId) || !isUuid(scheduleId)) throw new ScheduleNotFound();

    // Phase A (Outside DB Transaction): Snapshot read & Candidate/Metadata resolution
    const snap = await this.repo.ownedSchedule(scheduleId, userId, this.options.pool, false, scope);
    if (!snap) throw new ScheduleNotFound();
    if (snap.kind !== 'sheets_digest' && snap.kind !== 'telegram_digest' && snap.kind !== 'slack_digest') {
      throw new ScheduleConflict(
        'REAUTHORIZATION_NOT_READY',
        'Chỉ lịch tổng hợp Google Sheets, Telegram hoặc Slack mới hỗ trợ cấp quyền lại.',
      );
    }
    if (snap.status === 'cancelled' || snap.status === 'completed') {
      throw new ScheduleConflict('SCHEDULE_CLOSED');
    }

    const convRes = await this.options.pool.query<{
      id: string;
      user_id: string;
      workspace_id: string | null;
      workspace_mode: string | null;
    }>(
      'SELECT id, user_id, workspace_id, workspace_mode FROM conversations WHERE id = $1 AND user_id = $2',
      [snap.conv_id, userId],
    );
    const convRow = convRes.rows[0];
    if (!convRow) throw new ScheduleNotFound();
    if (scope?.workspaceMode === 'organization' && convRow.workspace_id !== scope.workspaceId) {
      throw new ScheduleNotFound();
    }
    if (scope?.workspaceMode === 'personal' && convRow.workspace_id) {
      throw new ScheduleNotFound();
    }

    const trustedScope = resolveTrustedScheduleScope(convRow);
    const snapshotVersion = snap.version;

    const userRes = await this.options.pool.query<{ status: string }>(
      'SELECT status FROM users WHERE id = $1',
      [userId],
    );
    if (userRes.rows[0]?.status !== 'active') {
      throw new ScheduleConflict(
        'REAUTHORIZATION_NOT_READY',
        'Tài khoản người dùng không còn hoạt động.',
      );
    }
    if (trustedScope.workspaceMode === 'organization') {
      if (!trustedScope.workspaceId || !isUuid(trustedScope.workspaceId)) {
        throw new ScheduleConflict(
          'REAUTHORIZATION_NOT_READY',
          'Lịch Tổ chức thiếu định danh không gian làm việc hợp lệ.',
        );
      }
      const memberRes = await this.options.pool.query<{ status: string }>(
        'SELECT status FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
        [trustedScope.workspaceId, userId],
      );
      if (memberRes.rows[0]?.status !== 'active') {
        throw new ScheduleConflict(
          'REAUTHORIZATION_NOT_READY',
          'Quyền thành viên trong Tổ chức không còn hiệu lực.',
        );
      }
    }

    const prevTgConfig =
      snap.kind === 'telegram_digest' && snap.digest_config && typeof snap.digest_config === 'object'
        ? (snap.digest_config as TelegramDigestConfig)
        : null;
    const prevSlackConfig =
      snap.kind === 'slack_digest' && snap.digest_config && typeof snap.digest_config === 'object'
        ? (snap.digest_config as SlackDigestConfig)
        : null;
    const previousSources = prevTgConfig?.sources ?? prevSlackConfig?.sources;
    const previousHasCalendar = Array.isArray(previousSources) && previousSources.some(isMyCalendarDigestSource);
    const previousHasSheets = Array.isArray(previousSources) && previousSources.some(isMySheetsDigestSource);
    const reauthServices = [
      ...snap.services,
      ...(previousHasCalendar && !snap.services.includes('mycalendar') ? ['mycalendar'] : []),
      ...(previousHasSheets && !snap.services.includes('mysheets') ? ['mysheets'] : []),
    ];
    const [mycalendarLookup, mysheetsLookup] = await Promise.all([
      reauthServices.includes('mycalendar')
        ? loadLiveMyCalendarDigestConnection(this.options.pool, userId, this.options.encryptionKey, {
            oauthClientId: this.options.mycalendarOAuthClientId,
          })
        : Promise.resolve(undefined),
      reauthServices.includes('mysheets')
        ? loadLiveMySheetsDigestConnection(this.options.pool, userId, this.options.encryptionKey, {
            oauthClientId: this.options.mysheetsOAuthClientId,
          })
        : Promise.resolve(undefined),
    ]);
    let tgCandidate: TelegramDigestCandidate | null = null;
    let slackCandidate: SlackDigestCandidate | null = null;
    let sheetsCandidate: SheetsDigestCandidate | null = null;

    if (snap.kind === 'slack_digest') {
      const needsGmail =
        snap.services.includes('gmail') ||
        Boolean(prevSlackConfig?.sources?.some((s) => s.service === 'gmail'));
      const [gmailBinding, githubLookup, jiraLookup] = await Promise.all([
        needsGmail
          ? loadGmailDigestBinding(
              this.options.pool,
              userId,
              this.options.gmailOAuthClientId,
              this.options.encryptionKey,
            )
          : Promise.resolve(null),
        snap.services.includes('github')
          ? this.loadLiveGithubLookup(this.options.pool, userId)
          : Promise.resolve(null),
        snap.services.includes('myjira') && trustedScope.workspaceMode === 'organization'
          ? this.options.jiraConnection?.(userId, trustedScope.workspaceId)
          : Promise.resolve(null),
      ]);
      const effectiveIncludeAi =
        typeof input.includeAiSummary === 'boolean'
          ? input.includeAiSummary
          : typeof prevSlackConfig?.includeAiSummary === 'boolean'
            ? prevSlackConfig.includeAiSummary
            : undefined;
      const prevGmailSource = prevSlackConfig?.sources?.find((s) => s.service === 'gmail');
      const prevGmailQuery = prevGmailSource?.args?.query;
      const reauthorizeGmailQuery = prevGmailSource && isValidGmailDigestQuery(prevGmailQuery)
        ? {
            query: prevGmailQuery.trim(),
            label: prevGmailSource.label.replace(/\s*\([^()]+\)\s*$/, '').trim() || 'Email chưa đọc',
          }
        : undefined;
      const fallbackAdapter = async (serviceName: string) => {
        if (serviceName !== 'slack') return null;
        if (this.options.getAdapter) {
          return this.options.getAdapter(serviceName, {
            userId,
            phase: 'planning',
            workspaceMode: trustedScope.workspaceMode,
            workspaceId: trustedScope.workspaceId,
          });
        }
        return prevSlackConfig
          ? {
              execute: async () => [{ id: prevSlackConfig.channelId, name: prevSlackConfig.channelName }],
            }
          : null;
      };
      slackCandidate = await evaluateSlackDigestCandidate({
        proposal: {
          kind: 'schedule',
          action: 'update',
          name: snap.name,
          request: snap.request,
          recurrence: snap.recurrence,
          summary: `Cấp quyền lại lịch "${snap.name}".`,
        },
        services: reauthServices,
        timeZone: this.options.timeZone,
        userId,
        pool: this.options.pool,
        getAdapter: fallbackAdapter,
        mycalendarLookup,
        reauthorizeMyCalendar: true,
        mysheetsLookup,
        reauthorizeMySheets: true,
        githubLookup,
        jiraLookup,
        workspaceMode: trustedScope.workspaceMode,
        workspaceId: trustedScope.workspaceId,
        gmailBinding,
        existingDigest: prevSlackConfig,
        reauthorizeGmailQuery,
        includeAiSummary: effectiveIncludeAi,
      });
      if (!slackCandidate.canAutoDigest || !slackCandidate.config || !slackCandidate.configHash) {
        throw new ScheduleConflict(
          'REAUTHORIZATION_NOT_READY',
          slackCandidate.disabledReason ?? SCHEDULE_CONFLICTS.REAUTHORIZATION_NOT_READY,
        );
      }
      if (prevSlackConfig?.channelId && slackCandidate.config.channelId !== prevSlackConfig.channelId) {
        throw new ScheduleConflict(
          'REAUTHORIZATION_NOT_READY',
          `Kênh Slack "#${prevSlackConfig.channelName || prevSlackConfig.channelId}" không còn trong phạm vi cấp quyền hiện tại.`,
        );
      }
    } else if (snap.kind === 'telegram_digest') {
      if (telegramNotionSource(prevTgConfig) || snap.services.includes('notion')) {
        throw new ScheduleConflict('REAUTHORIZATION_NOT_READY', NOTION_DIGEST_REAPPROVAL);
      }
      const needsGmail =
        snap.services.includes('gmail') ||
        Boolean(prevTgConfig?.sources?.some((s) => s.service === 'gmail'));
      const [telegramLookup, gmailBinding, githubLookup, jiraLookup] = await Promise.all([
        this.loadLiveTelegramLookup(this.options.pool, userId),
        needsGmail
          ? loadGmailDigestBinding(
              this.options.pool,
              userId,
              this.options.gmailOAuthClientId,
              this.options.encryptionKey,
            )
          : Promise.resolve(null),
        snap.services.includes('github')
          ? this.loadLiveGithubLookup(this.options.pool, userId)
          : Promise.resolve(null),
        snap.services.includes('myjira') && trustedScope.workspaceMode === 'organization'
          ? this.options.jiraConnection?.(userId, trustedScope.workspaceId)
          : Promise.resolve(null),
      ]);
      const effectiveIncludeAi =
        typeof input.includeAiSummary === 'boolean'
          ? input.includeAiSummary
          : typeof prevTgConfig?.includeAiSummary === 'boolean'
            ? prevTgConfig.includeAiSummary
            : undefined;
      const prevGmailSource = prevTgConfig?.sources?.find((s) => s.service === 'gmail');
      const prevGmailQuery = prevGmailSource?.args?.query;
      const reauthorizeGmailQuery = prevGmailSource && isValidGmailDigestQuery(prevGmailQuery)
        ? {
            query: prevGmailQuery.trim(),
            label: prevGmailSource.label.replace(/\s*\([^()]+\)\s*$/, '').trim() || 'Email chưa đọc',
          }
        : undefined;
      tgCandidate = evaluateTelegramDigestCandidate({
        proposal: {
          kind: 'schedule',
          action: 'update',
          name: snap.name,
          request: snap.request,
          recurrence: snap.recurrence,
          summary: `Cấp quyền lại lịch "${snap.name}".`,
        },
        services: reauthServices,
        timeZone: this.options.timeZone,
        telegramLookup,
        mycalendarLookup,
        reauthorizeMyCalendar: true,
        mysheetsLookup,
        reauthorizeMySheets: true,
        githubLookup,
        jiraLookup,
        workspaceMode: trustedScope.workspaceMode,
        workspaceId: trustedScope.workspaceId,
        gmailBinding,
        existingDigest: prevTgConfig,
        reauthorizeGmailQuery,
        includeAiSummary: effectiveIncludeAi,
      });
      if (!tgCandidate.canAutoDigest || !tgCandidate.config || !tgCandidate.configHash) {
        throw new ScheduleConflict(
          'REAUTHORIZATION_NOT_READY',
          tgCandidate.disabledReason ?? SCHEDULE_CONFLICTS.REAUTHORIZATION_NOT_READY,
        );
      }
      if (prevTgConfig?.chatId && tgCandidate.config.chatId !== prevTgConfig.chatId) {
        throw new ScheduleConflict(
          'REAUTHORIZATION_NOT_READY',
          `Cuộc trò chuyện Telegram "${prevTgConfig.chatTitle || prevTgConfig.chatId}" không còn trong phạm vi cấp quyền hiện tại.`,
        );
      }
    } else {
      const prevConfig =
        snap.digest_config && typeof snap.digest_config === 'object'
          ? (snap.digest_config as SheetsDigestConfig)
          : null;
      const prevSource = prevConfig?.source;
      const prevDest = prevConfig?.destination;

      const effectiveServices =
        prevSource?.service && prevDest?.service
          ? [prevSource.service, prevDest.service]
          : snap.services;

      const requestHints: string[] = [snap.request];
      const reqLower = snap.request.toLowerCase();
      if (trustedScope.workspaceMode === 'organization' && prevSource?.service === 'mysheets') {
        if (!reqLower.includes('mysheets') && !reqLower.includes('cá nhân')) {
          requestHints.push('từ Google Sheets cá nhân');
        }
      } else if (trustedScope.workspaceMode === 'organization' && prevSource?.service === 'sheets') {
        if (!reqLower.includes('tổ chức') && !reqLower.includes('sheets chung')) {
          requestHints.push('từ Google Sheets tổ chức');
        }
      }
      if (prevSource?.spreadsheetId && !reqLower.includes(prevSource.spreadsheetId.toLowerCase())) {
        requestHints.push(prevSource.spreadsheetId);
      }
      if (
        prevSource?.spreadsheetTitle &&
        !reqLower.includes(prevSource.spreadsheetTitle.toLowerCase())
      ) {
        requestHints.push(prevSource.spreadsheetTitle);
      }
      if (prevSource?.sheetName && !reqLower.includes(prevSource.sheetName.toLowerCase())) {
        requestHints.push(`tab "${prevSource.sheetName}"`);
      }
      if (
        prevDest &&
        'channelId' in prevDest &&
        prevDest.channelId &&
        !reqLower.includes(prevDest.channelId.toLowerCase())
      ) {
        requestHints.push(prevDest.channelId);
      }
      if (
        prevDest?.service === 'telegram' &&
        prevDest.chatId &&
        !reqLower.includes(prevDest.chatId.toLowerCase())
      ) {
        requestHints.push(prevDest.chatId);
      }
      if (
        prevDest?.service === 'gmail' &&
        prevDest.recipientEmail &&
        !reqLower.includes(prevDest.recipientEmail.toLowerCase())
      ) {
        requestHints.push(prevDest.recipientEmail);
      }

      const effectiveRequest = requestHints.join(' ');

      const candidate = await analyzeSheetsDigestCandidate({
        userId,
        workspaceMode: trustedScope.workspaceMode,
        workspaceId: trustedScope.workspaceId,
        request: effectiveRequest,
        recurrence: snap.recurrence,
        services: effectiveServices,
        credentialRepo: this.options.credentialRepo,
        encryptionKey: this.options.encryptionKey,
        gmailOAuthClientId: this.options.gmailOAuthClientId,
        mysheetsOAuthClientId: this.options.mysheetsOAuthClientId,
        mysheetsEnabled: this.options.mysheetsEnabled,
        fetchOrgSheetsMetadata: this.options.fetchOrgSheetsMetadata,
        emitV2: true,
        explicitRange: prevSource?.range,
        includeAiSummary:
          typeof input.includeAiSummary === 'boolean'
            ? input.includeAiSummary
            : typeof prevConfig?.includeAiSummary === 'boolean'
              ? prevConfig.includeAiSummary
              : undefined,
      });

      if (
        !candidate.canAutoDigest ||
        !candidate.config ||
        !isSheetsDigestConfigV2(candidate.config) ||
        !candidate.configHash
      ) {
        throw new ScheduleConflict(
          'REAUTHORIZATION_NOT_READY',
          candidate.reason ?? SCHEDULE_CONFLICTS.REAUTHORIZATION_NOT_READY,
        );
      }

      if (prevSource?.spreadsheetId && candidate.config.source.spreadsheetId !== prevSource.spreadsheetId) {
        throw new ScheduleConflict(
          'REAUTHORIZATION_NOT_READY',
          `Bảng tính "${prevSource.spreadsheetTitle || prevSource.spreadsheetId}" không còn trong phạm vi cấp quyền hiện tại.`,
        );
      }
      if (prevDest && 'channelId' in prevDest) {
        if (
          candidate.config.destination.service !== prevDest.service ||
          !('channelId' in candidate.config.destination) ||
          candidate.config.destination.channelId !== prevDest.channelId
        ) {
          throw new ScheduleConflict(
            'REAUTHORIZATION_NOT_READY',
            `Kênh Slack "${prevDest.channelId}" không còn trong phạm vi cấp quyền hiện tại.`,
          );
        }
      } else if (prevDest?.service === 'telegram') {
        if (
          candidate.config.destination.service !== 'telegram' ||
          candidate.config.destination.chatId !== prevDest.chatId
        ) {
          throw new ScheduleConflict(
            'REAUTHORIZATION_NOT_READY',
            `Nhóm Telegram "${prevDest.chatId}" không còn trong phạm vi cấp quyền hiện tại.`,
          );
        }
      } else if (prevDest?.service === 'gmail') {
        if (
          candidate.config.destination.service !== 'gmail' ||
          candidate.config.destination.recipientEmail.toLowerCase() !==
            prevDest.recipientEmail.toLowerCase()
        ) {
          throw new ScheduleConflict(
            'REAUTHORIZATION_NOT_READY',
            'Địa chỉ email nhận báo cáo không khớp với lịch hiện tại.',
          );
        }
      }

      if (prevSource) {
        if (prevSource.sheetName && !candidate.config.source.sheetName) {
          candidate.config.source.sheetName = prevSource.sheetName;
        }
        if (prevSource.range && !candidate.config.source.range) {
          const rangeCheck = validateAndCanonicalizeDigestRange(prevSource.range);
          if (!rangeCheck.ok) {
            throw new ScheduleConflict('REAUTHORIZATION_NOT_READY', rangeCheck.reason);
          }
          candidate.config.source.range = rangeCheck.canonicalRange;
        }
        if (typeof prevSource.tailRows === 'number' && prevSource.tailRows > 0) {
          candidate.config.source.tailRows = prevSource.tailRows;
        }
      }
      const effectiveIncludeAi =
        typeof input.includeAiSummary === 'boolean'
          ? input.includeAiSummary
          : typeof prevConfig?.includeAiSummary === 'boolean'
            ? prevConfig.includeAiSummary
            : candidate.config.includeAiSummary;
      candidate.config.includeAiSummary = effectiveIncludeAi;
      if (candidate.preview) {
        candidate.preview = {
          ...candidate.preview,
          ...(candidate.config.source.sheetName ? { sheetName: candidate.config.source.sheetName } : {}),
          ...(candidate.config.source.range ? { range: candidate.config.source.range } : {}),
          includeAiSummary: effectiveIncludeAi,
        };
      }
      candidate.configHash = computeSheetsDigestHash({
        userId,
        recurrence: snap.recurrence,
        config: candidate.config,
      });
      sheetsCandidate = candidate;
    }

    // Phase B (Inside DB Transaction): Lock, Verify & Persist Sealed Proposal Message
    return this.transaction(async (client) => {
      const saved = await captureScheduleArtifact(client, this.registry, 'schedules', scheduleId);
      if (!saved || saved.owner !== userId) throw new ScheduleNotFound();
      await prelockScheduleArtifacts(client, this.registry, [saved]);

      const owner = await client.query<{
        id: string;
        user_id: string;
        workspace_id: string | null;
        workspace_mode: string | null;
      }>(
        'SELECT id, user_id, workspace_id, workspace_mode FROM conversations WHERE id = $1 AND user_id = $2 FOR UPDATE',
        [saved.row.conv_id, userId],
      );
      if (!owner.rows[0]) throw new ScheduleNotFound();
      if (scope?.workspaceMode === 'organization' && owner.rows[0].workspace_id !== scope.workspaceId) {
        throw new ScheduleNotFound();
      }
      if (scope?.workspaceMode === 'personal' && owner.rows[0].workspace_id) {
        throw new ScheduleNotFound();
      }

      const schedRes = await client.query<ScheduleRow>(
        'SELECT * FROM schedules WHERE id = $1 AND user_id = $2 FOR UPDATE',
        [scheduleId, userId],
      );
      const current = schedRes.rows[0];
      if (!current) throw new ScheduleNotFound();
      if (current.kind !== snap.kind || (current.kind !== 'sheets_digest' && current.kind !== 'telegram_digest' && current.kind !== 'slack_digest')) {
        throw new ScheduleConflict(
          'REAUTHORIZATION_NOT_READY',
          'Loại lịch đã thay đổi hoặc không hỗ trợ cấp quyền lại.',
        );
      }

      const guarded = await guardScheduleArtifact(client, this.registry, saved, 'planning', 'UPDATE');
      if (!guarded.allowed) throw new ScheduleConflict('SCHEDULE_SOURCE_PURGED');

      if (current.status === 'cancelled' || current.status === 'completed') {
        throw new ScheduleConflict('SCHEDULE_CLOSED');
      }
      if (current.version !== snapshotVersion) {
        throw new ScheduleConflict(
          'STALE_VERSION',
          'Lịch đã thay đổi trong lúc tạo bản xem trước. Vui lòng thử lại.',
        );
      }

      const expiresAt = new Date(now.getTime() + 15 * 60_000).toISOString();
      const firstRun = this.next(current, now);
      const upcoming = [
        firstRun,
        ...nextRuns(current.recurrence, firstRun, this.options.timeZone, 2),
      ].map((d) => d.toISOString());

      let sealedCandidate: SheetsDigestCandidate | TelegramDigestCandidate | SlackDigestCandidate;
      let proposalSummary: string;
      let metadataServices: string[];

      if (current.kind === 'slack_digest') {
        if (!slackCandidate?.config || !slackCandidate.configHash) {
          throw new ScheduleConflict('REAUTHORIZATION_NOT_READY', SCHEDULE_CONFLICTS.REAUTHORIZATION_NOT_READY);
        }
        try {
          await this.verifyTelegramDigestGmailConfigInTx(client, userId, slackCandidate.config as unknown as TelegramDigestConfig, current.services);
          await this.verifyMyCalendarDigestConfigInTx(client, userId, slackCandidate.config, reauthServices, 'REAUTHORIZATION_NOT_READY');
          await this.verifyMySheetsDigestConfigInTx(client, userId, slackCandidate.config, reauthServices, 'REAUTHORIZATION_NOT_READY');
        } catch (err) {
          if (err instanceof ScheduleConflict) {
            throw new ScheduleConflict('REAUTHORIZATION_NOT_READY', err.message);
          }
          throw err;
        }
        const wsCheckMode = slackCandidate.config.workspaceMode;
        const wsCheckId =
          wsCheckMode === 'organization'
            ? (slackCandidate.config.workspaceId ?? null)
            : null;
        await this.verifySlackDigestConfigInTx(client, {
          userId,
          wsMode: wsCheckMode,
          wsId: wsCheckId,
          config: slackCandidate.config,
          conflictCode: 'REAUTHORIZATION_NOT_READY',
          conflictMessage: 'Kết nối Slack nhận bản tin không còn hợp lệ.',
        });
        sealedCandidate = slackCandidate;
        proposalSummary = `Cấp quyền lại lịch "${current.name}" (Slack digest).`;
        metadataServices = reauthServices;
      } else if (current.kind === 'telegram_digest') {
        if (!tgCandidate?.config || !tgCandidate.configHash) {
          throw new ScheduleConflict('REAUTHORIZATION_NOT_READY', SCHEDULE_CONFLICTS.REAUTHORIZATION_NOT_READY);
        }
        if (telegramNotionSource(tgCandidate.config) || current.services.includes('notion')) {
          throw new ScheduleConflict('REAUTHORIZATION_NOT_READY', NOTION_DIGEST_REAPPROVAL);
        }
        try {
          await this.verifyTelegramDigestGmailConfigInTx(client, userId, tgCandidate.config, current.services);
          await this.verifyMyCalendarDigestConfigInTx(client, userId, tgCandidate.config, reauthServices, 'REAUTHORIZATION_NOT_READY');
          await this.verifyMySheetsDigestConfigInTx(client, userId, tgCandidate.config, reauthServices, 'REAUTHORIZATION_NOT_READY');
        } catch (err) {
          if (err instanceof ScheduleConflict) {
            throw new ScheduleConflict('REAUTHORIZATION_NOT_READY', err.message);
          }
          throw err;
        }
        const liveTg = await this.loadLiveTelegramLookup(client, userId);
        if (
          liveTg.status !== 'connected' ||
          liveTg.connection?.credentialId !== tgCandidate.config.credentialId ||
          liveTg.connection?.telegramUserId !== tgCandidate.config.telegramUserId ||
          !liveTg.selectedChats.some((c) => c.chatId === tgCandidate.config!.chatId)
        ) {
          throw new ScheduleConflict(
            'REAUTHORIZATION_NOT_READY',
            'Kết nối Telegram nhận bản tin không còn hợp lệ.',
          );
        }
        sealedCandidate = tgCandidate;
        proposalSummary = `Cấp quyền lại lịch "${current.name}" (Telegram digest).`;
        metadataServices = reauthServices;
      } else {
        const txTrustedScope = resolveTrustedScheduleScope(owner.rows[0]);
        const verified = await verifySheetsDigestCandidateInTx(client, {
          userId,
          recurrence: current.recurrence,
          config: sheetsCandidate!.config!,
          expectedHash: sheetsCandidate!.configHash,
          trustedScope: txTrustedScope,
          encryptionKey: this.options.encryptionKey,
          gmailOAuthClientId: this.options.gmailOAuthClientId,
          mysheetsOAuthClientId: this.options.mysheetsOAuthClientId,
          mysheetsEnabled: this.options.mysheetsEnabled,
        });
        if (!verified.ok) {
          throw new ScheduleConflict('REAUTHORIZATION_NOT_READY', verified.reason);
        }
        sealedCandidate = {
          ...sheetsCandidate!,
          canAutoDigest: true,
          config: verified.config,
          configHash: verified.configHash,
        };
        proposalSummary = `Cấp quyền lại lịch "${current.name}" (Google Sheets v2).`;
        metadataServices = [verified.config.source.service, verified.config.destination.service];
      }

      const metadata: ScheduleProposalMetadata = {
        type: 'schedule_proposal',
        scheduleId: current.id,
        baseVersion: current.version,
        reauthorize: true,
        expiresAt,
        digestCandidate: sealedCandidate,
        services: metadataServices,
        nextRuns: upcoming,
        previous: {
          name: current.name,
          request: current.request,
          recurrence: current.recurrence,
          status: current.status,
        },
        proposal: {
          kind: 'schedule',
          action: 'update',
          name: current.name,
          request: current.request,
          recurrence: current.recurrence,
          summary: proposalSummary,
        },
      };

      const taggedRow = tagScheduleContext(current, guarded.segments);
      const context = scheduleSourceContext(taggedRow);
      const msg = context
        ? await this.messages.createSlackMessage(
            current.conv_id,
            'assistant',
            proposalSummary,
            metadata,
            {
              ...context,
              selectors: messageOutputSelectors({ content: proposalSummary, metadata }),
            },
            client,
          )
        : await this.messages.createMessage(
            current.conv_id,
            'assistant',
            proposalSummary,
            metadata,
            client,
          );

      return {
        proposalMessageId: msg.id,
        convId: current.conv_id,
        scheduleId: current.id,
        baseVersion: current.version,
        expiresAt,
        candidate: sealedCandidate,
        metadata,
      };
    });
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

  private async assertNotionSourceInTx(client: pg.PoolClient, row: ScheduleRow): Promise<void> {
    if (row.kind === 'telegram_digest' && !telegramNotionSource(row.digest_config as TelegramDigestConfig)) return;
    if (row.kind !== 'notion_digest' && row.kind !== 'telegram_digest') return;

    const binding = row.kind === 'notion_digest'
      ? row.digest_config && approvedSlackNotionBinding(row.digest_config as NotionDigestConfig)
      : approvedTelegramNotionBinding(row.digest_config as TelegramDigestConfig);
    if (!binding || row.workspace_mode === 'organization' || !(await lockApprovedNotionSource(client, row.user_id, binding))) {
      throw new ScheduleConflict('REAUTHORIZATION_REQUIRED', NOTION_DIGEST_REAPPROVAL);
    }
  }

  private assertUnchangedMyCalendarDigestAuthority(
    previous: SlackDigestConfig | TelegramDigestConfig,
    current: SlackDigestConfig | TelegramDigestConfig,
  ): void {
    const currentSource = Array.isArray(current.sources) && current.sources.find(isMyCalendarDigestSource);
    if (!currentSource) return;
    const previousSource = Array.isArray(previous.sources) && previous.sources.find(isMyCalendarDigestSource);
    const destination = (config: SlackDigestConfig | TelegramDigestConfig) => 'channelId' in config
      ? [config.slackCredentialId, config.channelId] : [config.credentialId, config.chatId];
    if (
      JSON.stringify(canonicalizeDigestValue(previousSource)) !== JSON.stringify(canonicalizeDigestValue(currentSource)) ||
      JSON.stringify(destination(previous)) !== JSON.stringify(destination(current))
    ) {
      throw new ScheduleConflict('REAUTHORIZATION_REQUIRED', MYCALENDAR_DIGEST_REAPPROVAL);
    }
  }

  private async verifyMyCalendarDigestConfigInTx(
    client: pg.PoolClient,
    userId: string,
    config: SlackDigestConfig | TelegramDigestConfig,
    services: string[],
    conflictCode: 'DIGEST_PREVIEW_CHANGED' | 'REAUTHORIZATION_REQUIRED' | 'REAUTHORIZATION_NOT_READY' = 'DIGEST_PREVIEW_CHANGED',
  ): Promise<void> {
    const check = readMyCalendarDigestBinding(config, services);
    if (check.kind === 'none') return;
    if (check.kind === 'bound') {
      const live = await loadLiveMyCalendarDigestConnection(client, userId, this.options.encryptionKey, {
        oauthClientId: this.options.mycalendarOAuthClientId,
        lock: 'share',
      });
      if (matchesMyCalendarDigestBinding(live, check.binding)) return;
    }
    throw new ScheduleConflict(conflictCode, MYCALENDAR_DIGEST_REAPPROVAL);
  }

  private assertUnchangedMySheetsDigestAuthority(
    previous: SlackDigestConfig | TelegramDigestConfig,
    current: SlackDigestConfig | TelegramDigestConfig,
  ): void {
    const currentSource = Array.isArray(current.sources) && current.sources.find(isMySheetsDigestSource);
    if (!currentSource) return;
    const previousSource = Array.isArray(previous.sources) && previous.sources.find(isMySheetsDigestSource);
    const destination = (config: SlackDigestConfig | TelegramDigestConfig) => 'channelId' in config
      ? [config.slackCredentialId, config.channelId] : [config.credentialId, config.chatId];
    if (
      JSON.stringify(canonicalizeDigestValue(previousSource)) !== JSON.stringify(canonicalizeDigestValue(currentSource)) ||
      JSON.stringify(destination(previous)) !== JSON.stringify(destination(current))
    ) {
      throw new ScheduleConflict('REAUTHORIZATION_REQUIRED', MYSHEETS_DIGEST_REAPPROVAL);
    }
  }

  private async verifyMySheetsDigestConfigInTx(
    client: pg.PoolClient,
    userId: string,
    config: SlackDigestConfig | TelegramDigestConfig,
    services: string[],
    conflictCode: 'DIGEST_PREVIEW_CHANGED' | 'REAUTHORIZATION_REQUIRED' | 'REAUTHORIZATION_NOT_READY' = 'DIGEST_PREVIEW_CHANGED',
  ): Promise<void> {
    const check = readMySheetsDigestBinding(config, services);
    if (check.kind === 'none') return;
    if (check.kind === 'bound') {
      const live = await loadLiveMySheetsDigestConnection(client, userId, this.options.encryptionKey, {
        oauthClientId: this.options.mysheetsOAuthClientId,
        lock: 'share',
      });
      if (matchesMySheetsDigestBinding(live, check.binding)) return;
    }
    throw new ScheduleConflict(conflictCode, MYSHEETS_DIGEST_REAPPROVAL);
  }

  private async verifyTelegramDigestGmailConfigInTx(
    client: pg.PoolClient,
    userId: string,
    config: TelegramDigestConfig,
    services: string[],
  ): Promise<void> {
    const gmailCheck = validateTelegramDigestGmailConfig(config);
    if (
      gmailCheck.kind === 'invalid' ||
      gmailCheck.kind === 'gmail_legacy' ||
      (services.includes('gmail') && gmailCheck.kind !== 'gmail_bound')
    ) {
      throw new ScheduleConflict('AUTO_DIGEST_NOT_ALLOWED');
    }
    if (gmailCheck.kind === 'gmail_bound') {
      const liveBinding = await loadGmailDigestBinding(
        client,
        userId,
        this.options.gmailOAuthClientId,
        this.options.encryptionKey,
      );
      if (
        !liveBinding ||
        liveBinding.credentialId !== gmailCheck.binding.credentialId ||
        liveBinding.email !== gmailCheck.binding.email ||
        liveBinding.oauthClientId !== gmailCheck.binding.oauthClientId
      ) {
        throw new ScheduleConflict(
          'DIGEST_PREVIEW_CHANGED',
          'Kết nối Gmail nguồn đã thay đổi kể từ bản xem trước. Vui lòng tạo đề xuất mới và xác nhận lại.',
        );
      }
    }
  }

  private async assertTelegramDigestCanResumeInTx(
    client: pg.PoolClient,
    row: ScheduleRow,
  ): Promise<void> {
    const mycalendar = readMyCalendarDigestBinding(row.digest_config as TelegramDigestConfig | null, row.services);
    const mysheets = readMySheetsDigestBinding(row.digest_config as TelegramDigestConfig | null, row.services);
    const gmailCheck = validateTelegramDigestGmailConfig(row.digest_config);
    if (
      gmailCheck.kind === 'invalid' ||
      gmailCheck.kind === 'gmail_legacy' ||
      (Array.isArray(row.services) && row.services.includes('gmail') && gmailCheck.kind !== 'gmail_bound')
    ) {
      throw new ScheduleConflict(
        'REAUTHORIZATION_REQUIRED',
        gmailCheck.kind === 'non_gmail' ? undefined : gmailCheck.reason,
      );
    }
    if (gmailCheck.kind === 'gmail_bound') {
      let expectedHash: string | null = null;
      try {
        expectedHash = computeTelegramDigestConfigHash(row.digest_config as TelegramDigestConfig);
      } catch {
        expectedHash = null;
      }
      if (!row.digest_config_hash || !expectedHash || expectedHash !== row.digest_config_hash) {
        throw new ScheduleConflict('REAUTHORIZATION_REQUIRED');
      }
      const guard = await assertDigestScheduleLiveScopeAndAuth({
        pool: client,
        scheduleId: row.id,
        encryptionKey: this.options.encryptionKey,
        gmailOAuthClientId: this.options.gmailOAuthClientId,
        mycalendarOAuthClientId: this.options.mycalendarOAuthClientId,
        mysheetsOAuthClientId: this.options.mysheetsOAuthClientId,
        lockMyCalendarAuthority: 'share',
        lockMySheetsAuthority: 'share',
      });
      if (!guard.allowed) {
        throw new ScheduleConflict('REAUTHORIZATION_REQUIRED', guard.pauseReason);
      }
      if (this.options.encryptionKey) {
        const tgCtx = await buildPinnedTelegramAdapterContext({
          pool: client,
          scheduleId: row.id,
          encryptionKey: this.options.encryptionKey,
          gmailOAuthClientId: this.options.gmailOAuthClientId,
          mycalendarOAuthClientId: this.options.mycalendarOAuthClientId,
          mysheetsOAuthClientId: this.options.mysheetsOAuthClientId,
        });
        if (!tgCtx.allowed) {
          throw new ScheduleConflict('REAUTHORIZATION_REQUIRED');
        }
      }
    } else if (mycalendar.kind !== 'none' || mysheets.kind !== 'none' || row.services?.includes('myjira')) {
      let expectedHash: string | null = null;
      try {
        expectedHash = computeTelegramDigestConfigHash(row.digest_config as TelegramDigestConfig);
      } catch {
        expectedHash = null;
      }
      if (!row.digest_config_hash || !expectedHash || expectedHash !== row.digest_config_hash) {
        throw new ScheduleConflict('REAUTHORIZATION_REQUIRED');
      }
      const guard = await assertDigestScheduleLiveScopeAndAuth({
        pool: client,
        scheduleId: row.id,
        encryptionKey: this.options.encryptionKey,
        mycalendarOAuthClientId: this.options.mycalendarOAuthClientId,
        mysheetsOAuthClientId: this.options.mysheetsOAuthClientId,
        lockMyCalendarAuthority: 'share',
        lockMySheetsAuthority: 'share',
      });
      if (!guard.allowed) {
        throw new ScheduleConflict('REAUTHORIZATION_REQUIRED', guard.pauseReason);
      }
    }
  }

  private async assertSlackDigestCanResumeInTx(
    client: pg.PoolClient,
    row: ScheduleRow,
  ): Promise<void> {
    const gmailCheck = validateTelegramDigestGmailConfig(row.digest_config);
    if (
      gmailCheck.kind === 'invalid' ||
      gmailCheck.kind === 'gmail_legacy' ||
      (Array.isArray(row.services) && row.services.includes('gmail') && gmailCheck.kind !== 'gmail_bound')
    ) {
      throw new ScheduleConflict(
        'REAUTHORIZATION_REQUIRED',
        gmailCheck.kind === 'non_gmail' ? undefined : gmailCheck.reason,
      );
    }
    const cfg = row.digest_config as SlackDigestConfig | null;
    if (!cfg || !isUuid(cfg.slackCredentialId)) {
      throw new ScheduleConflict('REAUTHORIZATION_REQUIRED');
    }
    let expectedHash: string | null = null;
    try {
      expectedHash = computeSlackDigestConfigHash(cfg);
    } catch {
      expectedHash = null;
    }
    if (!row.digest_config_hash || !expectedHash || expectedHash !== row.digest_config_hash) {
      throw new ScheduleConflict('REAUTHORIZATION_REQUIRED');
    }
    const guard = await assertDigestScheduleLiveScopeAndAuth({
      pool: client,
      scheduleId: row.id,
      encryptionKey: this.options.encryptionKey,
      gmailOAuthClientId: this.options.gmailOAuthClientId,
      mycalendarOAuthClientId: this.options.mycalendarOAuthClientId,
      mysheetsOAuthClientId: this.options.mysheetsOAuthClientId,
      lockMyCalendarAuthority: 'share',
      lockMySheetsAuthority: 'share',
    });
    if (!guard.allowed) {
      throw new ScheduleConflict('REAUTHORIZATION_REQUIRED', guard.pauseReason);
    }
  }

  private async assertCalendarDigestCanResumeInTx(
    client: pg.PoolClient,
    row: ScheduleRow,
  ): Promise<void> {
    const cfg = row.digest_config as unknown as CalendarDigestConfig | null;
    if (!cfg || cfg.version !== 1 || cfg.source !== 'mycalendar') {
      throw new ScheduleConflict('REAUTHORIZATION_REQUIRED');
    }
    let expectedHash: string | null = null;
    try {
      expectedHash = computeCalendarDigestHash(cfg);
    } catch {
      expectedHash = null;
    }
    if (!row.digest_config_hash || !expectedHash || expectedHash !== row.digest_config_hash) {
      throw new ScheduleConflict('REAUTHORIZATION_REQUIRED');
    }
    const guard = await assertDigestScheduleLiveScopeAndAuth({
      pool: client,
      scheduleId: row.id,
      encryptionKey: this.options.encryptionKey,
    });
    if (!guard.allowed) {
      throw new ScheduleConflict('REAUTHORIZATION_REQUIRED', guard.pauseReason);
    }
    if (!this.options.encryptionKey) return;

    const calCredRes = await client.query<{ id: string; status: string; config: any }>(
      "SELECT id, status, config FROM service_credentials WHERE service = 'mycalendar' AND user_id = $1 LIMIT 1",
      [row.user_id],
    );
    const calCred = calCredRes.rows[0];
    if (!calCred || calCred.status !== 'active' || calCred.id !== cfg.credentialId) {
      throw new ScheduleConflict('REAUTHORIZATION_REQUIRED');
    }
    try {
      const dec = decryptCredentials(calCred.config, this.options.encryptionKey);
      const liveCalIds = new Set<string>([
        ...(Array.isArray(dec.selectedCalendars)
          ? dec.selectedCalendars.map((c: any) => String(c?.id ?? '')).filter(Boolean)
          : []),
        ...(Array.isArray(dec.allowedScope?.calendars)
          ? dec.allowedScope.calendars.filter((id: unknown): id is string => typeof id === 'string' && Boolean(id))
          : []),
      ]);
      if (cfg.calendars.length === 0 || cfg.calendars.some((c) => !liveCalIds.has(c.id))) {
        throw new ScheduleConflict('REAUTHORIZATION_REQUIRED');
      }
    } catch (err) {
      if (err instanceof ScheduleConflict) throw err;
      throw new ScheduleConflict('REAUTHORIZATION_REQUIRED');
    }

    if (cfg.destination.service === 'slack') {
      const slackRow = await findSlackDigestCredential(client, {
        userId: row.user_id,
        workspaceMode: row.workspace_mode ?? 'personal',
        workspaceId: row.workspace_id ?? null,
      });
      if (!slackRow || slackRow.status !== 'active') {
        throw new ScheduleConflict('REAUTHORIZATION_REQUIRED');
      }
      try {
        const decSlack =
          typeof slackRow.config === 'string'
            ? decryptCredentials(slackRow.config, this.options.encryptionKey)
            : (slackRow.config as Record<string, any> | null);
        const allowedChannels = Array.isArray(decSlack?.allowedScope?.channels)
          ? decSlack.allowedScope.channels.filter((id: unknown): id is string => typeof id === 'string' && Boolean(id))
          : [];
        if (!allowedChannels.includes(cfg.destination.channelId)) {
          throw new ScheduleConflict('REAUTHORIZATION_REQUIRED');
        }
      } catch (err) {
        if (err instanceof ScheduleConflict) throw err;
        throw new ScheduleConflict('REAUTHORIZATION_REQUIRED');
      }
    } else if (cfg.destination.service === 'telegram') {
      const tgRes = await client.query<{ id: string; status: string; config: any }>(
        "SELECT id, status, config FROM service_credentials WHERE service = 'telegram' AND user_id = $1 LIMIT 1",
        [row.user_id],
      );
      const tgRow = tgRes.rows[0];
      if (!tgRow || tgRow.status !== 'active' || (cfg.destination.credentialId && tgRow.id !== cfg.destination.credentialId)) {
        throw new ScheduleConflict('REAUTHORIZATION_REQUIRED');
      }
      try {
        const decTg = decryptCredentials(tgRow.config, this.options.encryptionKey);
        const scopeChats = Array.isArray(decTg.allowedScope?.chats)
          ? decTg.allowedScope.chats.filter((id: unknown): id is string => typeof id === 'string' && Boolean(id))
          : [];
        const selectedChatIds = Array.isArray(decTg.selectedChats)
          ? decTg.selectedChats.map((c: any) => String(c?.chatId ?? '')).filter(Boolean)
          : [];
        if (!new Set([...scopeChats, ...selectedChatIds]).has(cfg.destination.chatId)) {
          throw new ScheduleConflict('REAUTHORIZATION_REQUIRED');
        }
      } catch (err) {
        if (err instanceof ScheduleConflict) throw err;
        throw new ScheduleConflict('REAUTHORIZATION_REQUIRED');
      }
    }
  }

  private async verifySlackDigestConfigInTx(
    client: pg.PoolClient,
    input: {
      userId: string;
      wsMode: string;
      wsId: string | null;
      config: SlackDigestConfig;
      conflictCode: 'DIGEST_PREVIEW_CHANGED' | 'REAUTHORIZATION_NOT_READY';
      conflictMessage?: string;
    },
  ): Promise<void> {
    if (
      input.config.workspaceMode !== input.wsMode ||
      (input.config.workspaceId ?? null) !== input.wsId ||
      !isUuid(input.config.slackCredentialId)
    ) {
      throw new ScheduleConflict(
        input.conflictCode,
        input.conflictMessage ?? 'Không gian làm việc hoặc kết nối Slack không khớp với bản xem trước.',
      );
    }
    const slackCredRes = await client.query<{
      id: string;
      service: string;
      user_id: string | null;
      workspace_id: string | null;
      status: string;
    }>(
      'SELECT id, service, user_id, workspace_id, status FROM service_credentials WHERE id = $1',
      [input.config.slackCredentialId],
    );
    const credRow = slackCredRes.rows[0];
    if (
      !credRow ||
      credRow.status !== 'active' ||
      !matchesSlackDigestCredentialOwner(credRow, {
        userId: input.userId,
        workspaceMode: input.wsMode,
        trustedWorkspaceId: input.wsId,
      })
    ) {
      throw new ScheduleConflict(
        input.conflictCode,
        input.conflictMessage ?? 'Kết nối Slack đã thay đổi hoặc không còn hoạt động.',
      );
    }
  }

  private async assertJiraDigestConfigInTx(
    client: pg.PoolClient,
    userId: string,
    workspaceId: string,
    config: JiraDigestConfig,
  ): Promise<void> {
    if (!config.workspaceId || config.workspaceId !== workspaceId) {
      throw new ScheduleConflict('DIGEST_PREVIEW_CHANGED', 'Bản tin Jira tham chiếu workspace không khớp.');
    }
    const atiMem = await client.query<{ status: string }>(
      `SELECT am.status
       FROM ati_workspace_memberships am
       JOIN workspace_members wm ON wm.workspace_id = am.workspace_id AND wm.user_id = am.user_id
       WHERE am.workspace_id = $1 AND am.user_id = $2`,
      [workspaceId, userId],
    );
    if (atiMem.rows[0]?.status !== 'active') {
      throw new ScheduleConflict('REAUTHORIZATION_REQUIRED', 'Thành viên không còn quyền Jira trong không gian làm việc.');
    }
    if (!isUuid(config.grantId)) {
      throw new ScheduleConflict('REAUTHORIZATION_REQUIRED', 'Kết nối OAuth Jira không còn hiệu lực.');
    }
    const grantRes = await client.query<{ id: string }>(
      `SELECT g.id
       FROM jira_oauth_grants g
       JOIN jira_accounts a ON a.id = g.account_id
       WHERE g.id = $1 AND a.user_id = $2 AND a.status = 'connected'
         AND a.atlassian_account_id = $3 AND g.status = 'active'`,
      [config.grantId, userId, config.atlassianAccountId],
    );
    if (!grantRes.rowCount) {
      throw new ScheduleConflict('REAUTHORIZATION_REQUIRED', 'Kết nối OAuth Jira không còn hiệu lực.');
    }
    if (!Array.isArray(config.projects) || config.projects.length === 0) {
      throw new ScheduleConflict('AUTO_DIGEST_NOT_ALLOWED');
    }
    for (const proj of config.projects) {
      if (!isUuid(proj.siteId)) {
        throw new ScheduleConflict('REAUTHORIZATION_REQUIRED', 'Dự án Jira trong lịch không còn được cấp quyền.');
      }
      const okProj = await client.query<{ id: string }>(
        `SELECT p.id
         FROM ati_workspace_jira_sites s
         JOIN ati_workspace_jira_projects p ON p.site_id = s.id AND p.workspace_id = s.workspace_id
         JOIN jira_grant_sites gs ON gs.cloud_id = s.cloud_id AND gs.grant_id = $2 AND gs.product_type = 'jira'
         WHERE s.workspace_id = $1 AND s.id = $3 AND s.active = true
           AND upper(p.project_key) = upper($4) AND p.selected = true`,
        [workspaceId, config.grantId, proj.siteId, proj.projectKey],
      );
      if (!okProj.rowCount) {
        throw new ScheduleConflict('REAUTHORIZATION_REQUIRED', 'Dự án Jira trong lịch không còn được cấp quyền.');
      }
    }
    if (config.telegramChatId && config.telegramCredentialId) {
      if (!isUuid(config.telegramCredentialId)) {
        throw new ScheduleConflict('REAUTHORIZATION_REQUIRED');
      }
      const cred = await client.query<{ status: string }>(
        `SELECT status FROM service_credentials
         WHERE id = $1 AND user_id = $2 AND service = 'telegram' AND workspace_id IS NULL`,
        [config.telegramCredentialId, userId],
      );
      if (cred.rows[0]?.status !== 'active') {
        throw new ScheduleConflict('REAUTHORIZATION_REQUIRED');
      }
    }
  }

  private async assertMyJiraDigestCanResumeInTx(client: pg.PoolClient, row: ScheduleRow): Promise<void> {
    if (row.kind !== 'myjira_digest') return;
    const cfg = row.digest_config as JiraDigestConfig | null;
    if (!cfg || !row.workspace_id || row.workspace_mode !== 'organization') {
      throw new ScheduleConflict('REAUTHORIZATION_REQUIRED');
    }
    let expectedHash: string | null = null;
    try {
      expectedHash = computeJiraDigestConfigHash({
        config: cfg,
        recurrence: row.recurrence,
        userId: row.user_id,
      });
    } catch {
      expectedHash = null;
    }
    if (!row.digest_config_hash || !expectedHash || expectedHash !== row.digest_config_hash) {
      throw new ScheduleConflict('REAUTHORIZATION_REQUIRED');
    }
    const guard = await assertDigestScheduleLiveScopeAndAuth({
      pool: client,
      scheduleId: row.id,
    });
    if (!guard.allowed) {
      throw new ScheduleConflict('REAUTHORIZATION_REQUIRED', guard.pauseReason);
    }
  }

  async setStatus(input: { userId: string; scheduleId: string; action: 'pause' | 'resume' | 'cancel'; version: number; now: Date; scope?: ScheduleScope }): Promise<ScheduleChange> {
    return this.transaction(async (client) => {
      const row = await this.lockSchedule(client, input.scheduleId, input.userId, input.scope);
      if (!row) throw new ScheduleNotFound();
      if (row.version !== input.version) throw new ScheduleConflict('STALE_VERSION');
      if (input.action === 'resume') await this.assertNotionSourceInTx(client, row);
      if (input.action === 'resume' && row.kind === 'sheets_digest') {
        if (row.status === 'cancelled' || row.status === 'completed') {
          throw new ScheduleConflict('SCHEDULE_CLOSED');
        }
        await this.assertSheetsDigestCanResumeInTx(client, row);
      }
      if (input.action === 'resume' && row.kind === 'telegram_digest') {
        if (row.status === 'cancelled' || row.status === 'completed') {
          throw new ScheduleConflict('SCHEDULE_CLOSED');
        }
        await this.assertTelegramDigestCanResumeInTx(client, row);
      }
      if (input.action === 'resume' && row.kind === 'slack_digest') {
        if (row.status === 'cancelled' || row.status === 'completed') {
          throw new ScheduleConflict('SCHEDULE_CLOSED');
        }
        await this.assertSlackDigestCanResumeInTx(client, row);
      }
      if (input.action === 'resume' && row.kind === 'myjira_digest') {
        if (row.status === 'cancelled' || row.status === 'completed') {
          throw new ScheduleConflict('SCHEDULE_CLOSED');
        }
        await this.assertMyJiraDigestCanResumeInTx(client, row);
      }
      if (input.action === 'resume' && row.kind === 'calendar_digest') {
        if (row.status === 'cancelled' || row.status === 'completed') {
          throw new ScheduleConflict('SCHEDULE_CLOSED');
        }
        await this.assertCalendarDigestCanResumeInTx(client, row);
      }
      const fields = this.transition(row, input.action, null, null, input.now);
      if (!fields) return this.unchanged(client, row, input.now);
      return this.recordState(client, await this.saveFields(client, row.id, fields, null, scheduleSourceContext(row)?.segments ?? []), input.now);
    });
  }

  list(userId: string, now: Date, scope?: ScheduleScope) {
    return this.repo.listForUser(userId, now, scope);
  }

  async listRuns(userId: string, scheduleId: string, limit: number, now: Date, scope?: ScheduleScope) {
    const schedule = await this.repo.ownedSchedule(scheduleId, userId, this.options.pool, false, scope);
    if (!schedule) throw new ScheduleNotFound();
    return this.repo.listRuns(schedule, limit, now);
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
        const prevState = runState(previous, now);
        if (
          prevState === 'needs_attention' ||
          previous.status === 'needs_attention' ||
          previous.delivery_resolution != null ||
          (previous.delivery_started_at != null && previous.status !== 'digest_failed') ||
          (typeof previous.error === 'string' &&
            (previous.error.includes('SHEETS_DELIVERY_UNKNOWN') ||
              previous.error.includes('TELEGRAM_DELIVERY_UNKNOWN') ||
              previous.error.includes('SLACK_DELIVERY_UNKNOWN') ||
              previous.error.includes('TRELLO_DELIVERY_UNKNOWN') ||
              previous.error.includes('NOTION_DELIVERY_UNKNOWN') ||
              previous.error.includes('Chưa xác định bản tin Notion đã gửi hay chưa'))) ||
          !REPLANNABLE.has(prevState)
        ) {
          throw new ScheduleConflict('RUN_NOT_REPLANNABLE');
        }
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

  async resolveRunDelivery(input: {
    userId: string;
    runId: string;
    resolution: 'mark_sent' | 'retry_new_run' | string;
    confirmDuplicateRisk?: boolean;
    now?: Date;
    scope?: ScheduleScope;
  }): Promise<{
    run: ScheduleRunView;
    followUpRun: ScheduleRunView | null;
    schedule: ScheduleView;
  }> {
    const { userId, runId, resolution, confirmDuplicateRisk, scope } = input;
    const now = input.now ?? new Date();
    if (!isUuid(userId) || !isUuid(runId)) throw new ScheduleNotFound();

    const committed = await this.transaction(async (client) => {
      const lookup = await client.query<{
        run_id: string;
        schedule_id: string;
        user_id: string;
        workspace_id: string | null;
        workspace_mode: string | null;
      }>(
        `SELECT r.id AS run_id, s.id AS schedule_id, s.user_id, s.workspace_id, s.workspace_mode
         FROM schedule_runs r
         JOIN schedules s ON s.id = r.schedule_id
         WHERE r.id = $1`,
        [runId],
      );
      const meta = lookup.rows[0];
      if (!meta || meta.user_id !== userId) throw new ScheduleNotFound();
      if (scope) {
        if (
          scope.workspaceMode === 'personal' &&
          (meta.workspace_id != null || !['personal', 'legacy', undefined, null].includes(meta.workspace_mode))
        ) {
          throw new ScheduleNotFound();
        }
        if (
          scope.workspaceMode === 'organization' &&
          (!scope.workspaceId || meta.workspace_mode !== 'organization' || meta.workspace_id !== scope.workspaceId)
        ) {
          throw new ScheduleNotFound();
        }
        if (scope.workspaceMode === 'legacy' && meta.workspace_id != null) {
          throw new ScheduleNotFound();
        }
      }

      if (resolution !== 'mark_sent' && resolution !== 'retry_new_run') {
        throw new ScheduleBadRequest('INVALID_DELIVERY_RESOLUTION');
      }
      if (resolution === 'retry_new_run' && confirmDuplicateRisk !== true) {
        throw new ScheduleBadRequest(
          'DUPLICATE_RISK_CONFIRMATION_REQUIRED',
          'Vui lòng xác nhận rủi ro gửi trùng trước khi tạo lượt gửi bù.',
        );
      }

      // Canonical lock order: c -> s -> u/wm -> r -> r.conv_id
      const schedule = await this.lockSchedule(client, meta.schedule_id, userId, scope);
      if (!schedule) throw new ScheduleNotFound();
      if (schedule.status === 'cancelled') {
        throw new ScheduleConflict('SCHEDULE_CLOSED');
      }

      const trustedScope = resolveTrustedScheduleScope(schedule);
      const userRes = await client.query<{ status: string }>(
        'SELECT status FROM users WHERE id = $1 FOR SHARE',
        [userId],
      );
      if (userRes.rows[0]?.status !== 'active') {
        throw new ScheduleConflict('REAUTHORIZATION_REQUIRED', 'Tài khoản người dùng không còn hoạt động.');
      }
      if (trustedScope.workspaceMode === 'organization') {
        if (!trustedScope.workspaceId || !isUuid(trustedScope.workspaceId)) {
          throw new ScheduleConflict('REAUTHORIZATION_REQUIRED');
        }
        const memberRes = await client.query<{ status: string }>(
          'SELECT status FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 FOR SHARE',
          [trustedScope.workspaceId, userId],
        );
        if (memberRes.rows[0]?.status !== 'active') {
          throw new ScheduleConflict('REAUTHORIZATION_REQUIRED', 'Quyền thành viên trong Tổ chức không còn hiệu lực.');
        }
      }

      const run = await this.repo.runForUpdate(runId, client);
      if (!run || run.schedule_id !== schedule.id) throw new ScheduleNotFound();

      if (run.delivery_resolution != null) {
        throw new ScheduleConflict(
          'DELIVERY_ALREADY_RESOLVED',
          'Lượt chạy này đã được xử lý trạng thái gửi trước đó.',
        );
      }
      const isSheetsUnknown =
        schedule.kind === 'sheets_digest' &&
        run.status === 'needs_attention' &&
        run.delivery_started_at != null &&
        typeof run.error === 'string' &&
        run.error.includes('SHEETS_DELIVERY_UNKNOWN');
      const isTrelloOrTelegramUnknown =
        (schedule.kind === 'trello_digest' || schedule.kind === 'telegram_digest') &&
        run.status === 'needs_attention' &&
        run.delivery_started_at != null &&
        typeof run.error === 'string' &&
        run.error.trim().length > 0;
      const isNotionUnknown = isNotionDeliveryUnknown(run, schedule);
      const jiraUnknown = getJiraDeliveryUnknown(run);
      const slackUnknown = getSlackDeliveryUnknown(run);
      const unknownDigestKind = jiraUnknown ? 'myjira_digest'
        : slackUnknown ? 'slack_digest'
        : calendarOrGithubDeliveryUnknownKind(run, schedule);
      if (!isSheetsUnknown && !isTrelloOrTelegramUnknown && !isNotionUnknown && !unknownDigestKind) {
        throw new ScheduleConflict(
          'RUN_NOT_AWAITING_DELIVERY_RESOLUTION',
          'Lượt chạy này không ở trạng thái chờ xác nhận kết quả gửi.',
        );
      }

      const resolvedAtIso = now.toISOString();
      const targetConvId = run.conv_id ?? schedule.conv_id;

      if (resolution === 'mark_sent') {
        const deliveryKind = unknownDigestKind ?? schedule.kind;
        let deliveryPayload: Record<string, unknown>;
        if (deliveryKind === 'sheets_digest') {
          const prevDelivery =
            run.delivery && typeof run.delivery === 'object'
              ? (run.delivery as Partial<SheetsDigestDelivery>)
              : null;
          const dispatchedCfg =
            run.dispatched_config && typeof run.dispatched_config === 'object'
              ? (run.dispatched_config as SheetsDigestConfig)
              : schedule.version === run.schedule_version &&
                  schedule.digest_config &&
                  typeof schedule.digest_config === 'object'
                ? (schedule.digest_config as SheetsDigestConfig)
                : null;
          if (!dispatchedCfg && (!prevDelivery?.targetId || !prevDelivery?.spreadsheetId)) {
            throw new ScheduleConflict(
              'MISSING_DISPATCH_SNAPSHOT',
              'Không tìm thấy bản chụp cấu hình tại thời điểm gửi của lượt chạy cũ này sau khi lịch đã thay đổi.',
            );
          }
          const src = dispatchedCfg?.source;
          const dest = dispatchedCfg?.destination;
          const fallbackTargetId =
            dest && 'channelId' in dest
              ? dest.channelId
              : dest?.service === 'gmail'
                ? dest.recipientEmail
                : dest?.service === 'telegram'
                  ? dest.chatId
                  : 'unknown';
          const fallbackTargetLabel =
            dest && 'channelId' in dest
              ? (dest as any).channelLabel ?? dest.channelId
              : dest?.service === 'telegram'
                ? (dest as any).chatLabel ?? dest.chatId
                : dest?.service === 'gmail'
                  ? dest.recipientEmail
                  : undefined;
          const effectiveTargetLabel = prevDelivery?.targetLabel ?? fallbackTargetLabel;
          const effectiveSheetName = prevDelivery?.sheetName ?? src?.sheetName;

          const delivery: SheetsDigestDelivery = {
            destination: prevDelivery?.destination ?? dest?.service ?? 'telegram',
            targetId: prevDelivery?.targetId ?? fallbackTargetId,
            ...(effectiveTargetLabel ? { targetLabel: effectiveTargetLabel } : {}),
            spreadsheetId: prevDelivery?.spreadsheetId ?? src?.spreadsheetId ?? '',
            spreadsheetTitle: prevDelivery?.spreadsheetTitle ?? src?.spreadsheetTitle ?? '',
            ...(effectiveSheetName ? { sheetName: effectiveSheetName } : {}),
            rowCount: typeof prevDelivery?.rowCount === 'number' ? prevDelivery.rowCount : null,
            ...(prevDelivery?.dataScope ? { dataScope: prevDelivery.dataScope } : {}),
            ...(prevDelivery?.scannedRange ? { scannedRange: prevDelivery.scannedRange } : {}),
            ...(typeof prevDelivery?.windowClipped === 'boolean'
              ? { windowClipped: prevDelivery.windowClipped }
              : {}),
            summaryMode:
              prevDelivery?.summaryMode === 'ai' || prevDelivery?.summaryMode === 'deterministic'
                ? prevDelivery.summaryMode
                : dispatchedCfg?.includeAiSummary
                  ? 'ai'
                  : 'deterministic',
            sentAt: typeof prevDelivery?.sentAt === 'string' ? prevDelivery.sentAt : null,
            providerSentAt:
              typeof prevDelivery?.providerSentAt === 'string'
                ? prevDelivery.providerSentAt
                : typeof prevDelivery?.sentAt === 'string'
                  ? prevDelivery.sentAt
                  : null,
            manualConfirmedAt: resolvedAtIso,
            ...(typeof prevDelivery?.slackMessageTs === 'string'
              ? { slackMessageTs: prevDelivery.slackMessageTs }
              : {}),
            ...(prevDelivery?.telegramMessageId !== undefined
              ? { telegramMessageId: prevDelivery.telegramMessageId }
              : {}),
            ...(typeof prevDelivery?.gmailMessageId === 'string'
              ? { gmailMessageId: prevDelivery.gmailMessageId }
              : {}),
            ...(typeof prevDelivery?.skippedEmpty === 'boolean'
              ? { skippedEmpty: prevDelivery.skippedEmpty }
              : {}),
            manualResolution: {
              status: 'confirmed_sent',
              resolvedAt: resolvedAtIso,
              manualConfirmedAt: resolvedAtIso,
              resolvedBy: userId,
            },
          };
          deliveryPayload = delivery as unknown as Record<string, unknown>;
        } else if (deliveryKind === 'trello_digest') {
          const cfg =
            run.dispatched_config && typeof run.dispatched_config === 'object'
              ? (run.dispatched_config as unknown as TrelloDigestConfig)
              : schedule.version === run.schedule_version &&
                  schedule.digest_config &&
                  typeof schedule.digest_config === 'object'
                ? (schedule.digest_config as TrelloDigestConfig)
                : null;
          const prevDelivery =
            run.delivery && typeof run.delivery === 'object'
              ? (run.delivery as unknown as Record<string, unknown>)
              : {};
          deliveryPayload = buildConfirmedTrelloDigestDelivery({
            config: cfg,
            previousDelivery: prevDelivery,
            resolvedAtIso,
            resolvedBy: userId,
          });
        } else if (deliveryKind === 'myjira_digest') {
          const cfg = jiraUnknown?.config ??
            (schedule.kind === 'myjira_digest' &&
              matchesDispatchedDigestConfig(run, schedule) &&
              isValidJiraDigestConfig(schedule.digest_config)
              ? schedule.digest_config
              : null);
          const prevDelivery =
            run.delivery && typeof run.delivery === 'object'
              ? (run.delivery as unknown as Record<string, unknown>)
              : {};
          deliveryPayload = buildConfirmedJiraDigestDelivery({
            config: cfg,
            previousDelivery: prevDelivery,
            resolvedAtIso,
            resolvedBy: userId,
          });
        } else if (deliveryKind === 'notion_digest') {
          const cfg =
            run.dispatched_config && typeof run.dispatched_config === 'object'
              ? (run.dispatched_config as unknown as NotionDigestConfig)
              : schedule.version === run.schedule_version &&
                  schedule.digest_config &&
                  typeof schedule.digest_config === 'object'
                ? (schedule.digest_config as NotionDigestConfig)
                : null;
          const prevDelivery =
            run.delivery && typeof run.delivery === 'object'
              ? (run.delivery as Partial<NotionDigestDelivery>)
              : {};
          const delivery: NotionDigestDelivery = {
            channelId: prevDelivery.channelId ?? cfg?.channelId ?? 'unknown',
            channelName: prevDelivery.channelName ?? cfg?.channelName ?? 'unknown',
            ts: typeof prevDelivery.ts === 'string' && prevDelivery.ts.trim() ? prevDelivery.ts : null,
            counts: prevDelivery.counts ?? {
              databasesChecked: Array.isArray(cfg?.databases) ? cfg.databases.length : 0,
              totalPages: 0,
            },
            ...(prevDelivery.truncated ? { truncated: true } : {}),
            sentAt: typeof prevDelivery.sentAt === 'string' ? prevDelivery.sentAt : resolvedAtIso,
            manualConfirmedAt: resolvedAtIso,
            manualResolution: {
              status: 'confirmed_sent',
              resolvedAt: resolvedAtIso,
              manualConfirmedAt: resolvedAtIso,
              resolvedBy: userId,
            },
          };
          deliveryPayload = delivery as unknown as Record<string, unknown>;
        } else if (deliveryKind === 'calendar_digest') {
          const cfg =
            run.dispatched_config && typeof run.dispatched_config === 'object'
              ? (run.dispatched_config as unknown as CalendarDigestConfig)
              : schedule.version === run.schedule_version &&
                  schedule.digest_config &&
                  typeof schedule.digest_config === 'object'
                ? (schedule.digest_config as unknown as CalendarDigestConfig)
                : null;
          const prevDelivery =
            run.delivery && typeof run.delivery === 'object'
              ? (run.delivery as Partial<CalendarDigestDelivery>)
              : {};
          const dest = cfg?.destination;
          const fallbackLabel =
            dest && 'channelName' in dest ? dest.channelName : dest?.service === 'telegram' ? dest.chatTitle : undefined;
          const delivery: CalendarDigestDelivery & Record<string, unknown> = {
            ...(prevDelivery.destinationService ?? dest?.service
              ? { destinationService: prevDelivery.destinationService ?? dest?.service }
              : {}),
            channelId:
              prevDelivery.channelId ??
              (dest && 'channelId' in dest ? dest.channelId : dest?.service === 'telegram' ? dest.chatId : 'unknown'),
            ...(prevDelivery.channelName ?? fallbackLabel
              ? { channelName: prevDelivery.channelName ?? fallbackLabel }
              : {}),
            calendarsChecked:
              typeof prevDelivery.calendarsChecked === 'number'
                ? prevDelivery.calendarsChecked
                : Array.isArray(cfg?.calendars)
                  ? cfg.calendars.length
                  : 0,
            totalEvents: typeof prevDelivery.totalEvents === 'number' ? prevDelivery.totalEvents : 0,
            conflictCount: typeof prevDelivery.conflictCount === 'number' ? prevDelivery.conflictCount : 0,
            summaryIncluded:
              typeof prevDelivery.summaryIncluded === 'boolean' ? prevDelivery.summaryIncluded : false,
            sentAt: typeof prevDelivery.sentAt === 'string' ? prevDelivery.sentAt : resolvedAtIso,
            manualConfirmedAt: resolvedAtIso,
            manualResolution: {
              status: 'confirmed_sent',
              resolvedAt: resolvedAtIso,
              manualConfirmedAt: resolvedAtIso,
              resolvedBy: userId,
            },
          };
          deliveryPayload = delivery;
        } else if (deliveryKind === 'github_digest') {
          const cfg =
            run.dispatched_config && typeof run.dispatched_config === 'object'
              ? (run.dispatched_config as unknown as GithubDigestConfig)
              : schedule.version === run.schedule_version &&
                  schedule.digest_config &&
                  typeof schedule.digest_config === 'object'
                ? (schedule.digest_config as unknown as GithubDigestConfig)
                : null;
          const prevDelivery =
            run.delivery && typeof run.delivery === 'object'
              ? (run.delivery as Partial<GithubDigestDelivery>)
              : {};
          const isTelegram = Boolean(prevDelivery.telegramChatId ?? cfg?.telegramChatId);
          const delivery: GithubDigestDelivery & Record<string, unknown> = {
            channelId: prevDelivery.channelId ?? (isTelegram ? '' : cfg?.channelId ?? 'unknown'),
            channelName: prevDelivery.channelName ?? (isTelegram ? '' : cfg?.channelName ?? 'unknown'),
            ts: typeof prevDelivery.ts === 'string' && prevDelivery.ts.trim() ? prevDelivery.ts : null,
            counts: prevDelivery.counts ?? { newIssues: 0, stalePrs: 0, unassignedIssues: 0 },
            ...(isTelegram
              ? {
                  telegramChatId: prevDelivery.telegramChatId ?? cfg?.telegramChatId,
                  telegramChatTitle: prevDelivery.telegramChatTitle ?? cfg?.telegramChatTitle ?? '',
                  messageId: typeof prevDelivery.messageId === 'number' ? prevDelivery.messageId : null,
                }
              : {}),
            manualConfirmedAt: resolvedAtIso,
            manualResolution: {
              status: 'confirmed_sent',
              resolvedAt: resolvedAtIso,
              manualConfirmedAt: resolvedAtIso,
              resolvedBy: userId,
            },
          };
          deliveryPayload = delivery;
        } else if (deliveryKind === 'slack_digest') {
          const target = slackUnknown?.target ??
            (schedule.kind === 'slack_digest' && matchesDispatchedDigestConfig(run, schedule)
              ? schedule.digest_config as SlackDigestConfig
              : null);
          const prevDelivery =
            run.delivery && typeof run.delivery === 'object'
              ? (run.delivery as unknown as Record<string, unknown>)
              : {};
          deliveryPayload = {
            ...prevDelivery,
            destinationService: 'slack',
            channelId: prevDelivery.channelId ?? target?.channelId ?? 'unknown',
            channelName: prevDelivery.channelName ?? target?.channelName ?? 'unknown',
            ts: typeof prevDelivery.ts === 'string' && prevDelivery.ts.trim() ? prevDelivery.ts : null,
            sentAt: typeof prevDelivery.sentAt === 'string' ? prevDelivery.sentAt : resolvedAtIso,
            sources: Array.isArray(prevDelivery.sources) ? prevDelivery.sources : [],
            manualConfirmedAt: resolvedAtIso,
            manualResolution: {
              status: 'confirmed_sent',
              resolvedAt: resolvedAtIso,
              manualConfirmedAt: resolvedAtIso,
              resolvedBy: userId,
            },
          };
        } else {
          const cfg =
            run.dispatched_config && typeof run.dispatched_config === 'object'
              ? (run.dispatched_config as unknown as TelegramDigestConfig)
              : schedule.version === run.schedule_version &&
                  schedule.digest_config &&
                  typeof schedule.digest_config === 'object'
                ? (schedule.digest_config as TelegramDigestConfig)
                : null;
          const prevDelivery =
            run.delivery && typeof run.delivery === 'object'
              ? (run.delivery as unknown as Record<string, unknown>)
              : {};
          deliveryPayload = {
            ...prevDelivery,
            chatId: prevDelivery.chatId ?? cfg?.chatId ?? 'unknown',
            ...(prevDelivery.chatTitle ?? cfg?.chatTitle
              ? { chatTitle: prevDelivery.chatTitle ?? cfg?.chatTitle }
              : {}),
            sentAt: typeof prevDelivery.sentAt === 'string' ? prevDelivery.sentAt : resolvedAtIso,
            sources: Array.isArray(prevDelivery.sources) ? prevDelivery.sources : [],
            manualConfirmedAt: resolvedAtIso,
            manualResolution: {
              status: 'confirmed_sent',
              resolvedAt: resolvedAtIso,
              manualConfirmedAt: resolvedAtIso,
              resolvedBy: userId,
            },
          };
        }

        const updatedRes = await client.query(
          `UPDATE schedule_runs
           SET status = 'digest_sent',
               error = NULL,
               delivery = $2::jsonb,
               delivery_resolution = 'confirmed_sent',
               delivery_resolved_at = $3,
               delivery_resolved_by = $4,
               updated_at = now()
           WHERE id = $1 AND delivery_resolution IS NULL
           RETURNING *`,
          [run.id, JSON.stringify(deliveryPayload), now, userId],
        );
        if (!updatedRes.rowCount) {
          throw new ScheduleConflict(
            'DELIVERY_ALREADY_RESOLVED',
            'Lượt chạy này đã được xử lý trạng thái gửi trước đó.',
          );
        }
        const updatedRunRow = updatedRes.rows[0]!;

        const auditText =
          'Người dùng đã xác nhận thủ công rằng báo cáo của lượt chạy này đã được gửi tới đích.';
        await this.messages.createMessage(
          targetConvId,
          'system',
          auditText,
          {
            type: 'schedule_delivery_resolved',
            scheduleId: schedule.id,
            runId: run.id,
            resolution: 'mark_sent',
            deliveryResolution: 'confirmed_sent',
            resolvedAt: resolvedAtIso,
            resolvedBy: userId,
          },
          client,
        );

        const scheduleView = this.repo.view(schedule, await this.repo.lastRun(schedule.id, client), now);
        return {
          run: runView(updatedRunRow, now),
          followUpRun: null as ScheduleRunView | null,
          schedule: scheduleView,
        };
      }

      // Branch B: resolution === 'retry_new_run' with confirmDuplicateRisk === true
      if (unknownDigestKind && schedule.kind !== unknownDigestKind) {
        throw new ScheduleConflict('CONFIG_CHANGED_SINCE_RUN');
      }
      if (schedule.kind === 'sheets_digest') {
        await this.assertSheetsDigestCanResumeInTx(client, schedule);
        if (schedule.status !== 'active') {
          throw new ScheduleConflict(
            'SCHEDULE_PAUSED',
            'Lịch đang tạm dừng. Vui lòng tiếp tục (Chạy tiếp) lịch trước khi tạo lượt gửi bù mới để lượt chạy bù không bị hủy.',
          );
        }
      } else {
        if (schedule.status === 'paused') {
          throw new ScheduleConflict(
            this.isReauthPauseReason(schedule) ? 'REAUTHORIZATION_REQUIRED' : 'SCHEDULE_PAUSED',
          );
        }
        const isCompletedOneTimeRecovery = schedule.status === 'completed' &&
          schedule.recurrence.type === 'once' && unknownDigestKind !== null && !jiraUnknown;
        if (schedule.status !== 'active' && !isCompletedOneTimeRecovery) {
          throw new ScheduleConflict('SCHEDULE_CLOSED');
        }
        if (
          run.schedule_version !== schedule.version ||
          !schedule.digest_config ||
          typeof schedule.digest_config !== 'object' ||
          !schedule.digest_config_hash
        ) {
          throw new ScheduleConflict('CONFIG_CHANGED_SINCE_RUN');
        }
        if (schedule.kind === 'trello_digest') {
          const cfg = canonicalizeTrelloDigestConfig(schedule.digest_config as TrelloDigestConfig);
          const expectedHash = computeTrelloDigestConfigHash({
            config: cfg,
            recurrence: schedule.recurrence,
            userId: schedule.user_id,
          });
          if (expectedHash !== schedule.digest_config_hash) {
            throw new ScheduleConflict('CONFIG_CHANGED_SINCE_RUN');
          }
          for (const credId of getTrelloDigestPinnedCredentialIds(cfg)) {
            if (isUuid(credId)) {
              const credRes = await client.query<{ status: string }>(
                'SELECT status FROM service_credentials WHERE id = $1',
                [credId],
              );
              if (credRes.rows[0]?.status !== 'active') {
                throw new ScheduleConflict('REAUTHORIZATION_REQUIRED');
              }
            }
          }
        } else if (schedule.kind === 'telegram_digest') {
          const cfg = schedule.digest_config as TelegramDigestConfig;
          await this.assertNotionSourceInTx(client, schedule);
          const expectedHash = computeTelegramDigestConfigHash(cfg);
          if (expectedHash !== schedule.digest_config_hash) {
            throw new ScheduleConflict('CONFIG_CHANGED_SINCE_RUN');
          }
          if (cfg.credentialId) {
            const tgCredRes = await client.query<{ status: string }>(
              'SELECT status FROM service_credentials WHERE id = $1 AND user_id = $2',
              [cfg.credentialId, schedule.user_id],
            );
            if (tgCredRes.rows[0]?.status !== 'active') {
              throw new ScheduleConflict('REAUTHORIZATION_REQUIRED');
            }
          }
          await this.assertTelegramDigestCanResumeInTx(client, schedule);
        } else if (schedule.kind === 'slack_digest') {
          if (!matchesDispatchedDigestConfig(run, schedule)) {
            throw new ScheduleConflict('CONFIG_CHANGED_SINCE_RUN');
          }
          const cfg = schedule.digest_config as SlackDigestConfig;
          let expectedHash: string | null = null;
          try {
            expectedHash = computeSlackDigestConfigHash(cfg);
          } catch {
            expectedHash = null;
          }
          if (!expectedHash || expectedHash !== schedule.digest_config_hash) {
            throw new ScheduleConflict('CONFIG_CHANGED_SINCE_RUN');
          }
          await this.assertSlackDigestCanResumeInTx(client, schedule);
        } else if (schedule.kind === 'myjira_digest') {
          if (!matchesDispatchedDigestConfig(run, schedule)) {
            throw new ScheduleConflict('CONFIG_CHANGED_SINCE_RUN');
          }
          const cfg = canonicalizeJiraDigestConfig(schedule.digest_config as unknown as JiraDigestConfig);
          const expectedHash = computeJiraDigestConfigHash({
            config: cfg,
            recurrence: schedule.recurrence,
            userId: schedule.user_id,
          });
          if (expectedHash !== schedule.digest_config_hash) {
            throw new ScheduleConflict('CONFIG_CHANGED_SINCE_RUN');
          }
          await this.assertMyJiraDigestCanResumeInTx(client, schedule);
        } else if (schedule.kind === 'notion_digest') {
          const cfg = canonicalizeNotionDigestConfig(schedule.digest_config as NotionDigestConfig);
          const expectedHash = computeNotionDigestConfigHash({
            config: cfg,
            recurrence: schedule.recurrence,
            userId: schedule.user_id,
          });
          if (expectedHash !== schedule.digest_config_hash) {
            throw new ScheduleConflict('CONFIG_CHANGED_SINCE_RUN');
          }
          await this.assertNotionSourceInTx(client, schedule);
        } else if (schedule.kind === 'calendar_digest' || schedule.kind === 'github_digest') {
          if (!matchesDispatchedDigestConfig(run, schedule)) {
            throw new ScheduleConflict('CONFIG_CHANGED_SINCE_RUN');
          }
          const credIds: string[] = [];
          if (schedule.kind === 'calendar_digest') {
            const cfg = schedule.digest_config as unknown as CalendarDigestConfig;
            if (cfg.credentialId) credIds.push(cfg.credentialId);
            if (cfg.destination?.service === 'telegram' && cfg.destination.credentialId) {
              credIds.push(cfg.destination.credentialId);
            }
          } else {
            const cfg = schedule.digest_config as unknown as GithubDigestConfig;
            if (cfg.credentialId) credIds.push(cfg.credentialId);
            if (cfg.telegramCredentialId) credIds.push(cfg.telegramCredentialId);
          }
          for (const credId of credIds) {
            if (!isUuid(credId)) continue;
            const credRes = await client.query<{ status: string }>(
              'SELECT status FROM service_credentials WHERE id = $1 AND user_id = $2',
              [credId, schedule.user_id],
            );
            if (credRes.rows[0]?.status !== 'active') {
              throw new ScheduleConflict('REAUTHORIZATION_REQUIRED');
            }
          }
        }
      }
      const busy = await client.query(
        "SELECT 1 FROM schedule_runs WHERE schedule_id = $1 AND status = 'planning'",
        [schedule.id],
      );
      if (busy.rowCount) {
        throw new ScheduleConflict('RUN_IN_PROGRESS');
      }

      const newRunRes = await client.query(
        `INSERT INTO schedule_runs (
           schedule_id, schedule_version, trigger, due_at, status,
           dispatched_config, dispatched_config_hash
         )
         VALUES ($1, $2, 'manual', $3, 'planning', $4::jsonb, $5)
         RETURNING *`,
        [
          schedule.id,
          schedule.version,
          now,
          schedule.digest_config ? JSON.stringify(schedule.digest_config) : null,
          schedule.digest_config_hash ?? null,
        ],
      );
      const newRunRow = newRunRes.rows[0]!;

      const updatedOldRes = await client.query(
        `UPDATE schedule_runs
         SET delivery_resolution = 'retried_new_run',
             delivery_resolved_at = $2,
             delivery_resolved_by = $3,
             delivery_followup_run_id = $4,
             updated_at = now()
         WHERE id = $1 AND delivery_resolution IS NULL
         RETURNING *`,
        [run.id, now, userId, newRunRow.id],
      );
      if (!updatedOldRes.rowCount) {
        throw new ScheduleConflict(
          'DELIVERY_ALREADY_RESOLVED',
          'Lượt chạy này đã được xử lý trạng thái gửi trước đó.',
        );
      }
      const updatedOldRow = updatedOldRes.rows[0]!;

      const auditText = `Người dùng đã xác nhận rủi ro gửi trùng và yêu cầu tạo lượt chạy bù mới (${newRunRow.id}).`;
      await this.messages.createMessage(
        targetConvId,
        'system',
        auditText,
        {
          type: 'schedule_delivery_resolved',
          scheduleId: schedule.id,
          runId: run.id,
          resolution: 'retry_new_run',
          deliveryResolution: 'retried_new_run',
          followUpRunId: newRunRow.id,
          confirmDuplicateRisk: true,
          resolvedAt: resolvedAtIso,
          resolvedBy: userId,
        },
        client,
      );

      const scheduleView = this.repo.view(schedule, await this.repo.lastRun(schedule.id, client), now);
      return {
        run: runView(updatedOldRow, now),
        followUpRun: runView(newRunRow, now),
        schedule: scheduleView,
      };
    });

    if (committed.followUpRun) {
      this.options.runner
        ?.planNow(committed.followUpRun.id)
        .catch((error) =>
          console.error('[schedules] planning a follow-up run failed:', error instanceof Error ? error.message : error),
        );
    }

    return committed;
  }
}
