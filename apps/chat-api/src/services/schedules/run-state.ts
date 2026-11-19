import type {
  CalendarDigestDelivery,
  GithubDigestDelivery,
  MyJiraDigestDelivery,
  NotionDigestDelivery,
  ScheduleRunDeliveryResolution,
  ScheduleRunState,
  ScheduleRunView,
  SheetsDigestConfig,
  SheetsDigestDelivery,
  SlackDigestDelivery,
  TelegramDigestDelivery,
  TrelloDigestDelivery,
} from '@wap/tool-schemas';
import type { ScheduleRow } from '../../db/repositories/schedule-repo.js';
import { CALENDAR_DELIVERY_UNKNOWN } from './calendar-digest-runner.js';
import { GITHUB_DELIVERY_UNKNOWN } from './github-digest-runner.js';
import type { JiraDigestConfig } from './jira-digest-candidate.js';
import { isValidJiraDigestConfig, JIRA_READ_UNAVAILABLE_PREFIX, MYJIRA_DELIVERY_UNKNOWN } from './jira-digest-runner.js';
import { NOTION_DELIVERY_UNKNOWN } from './notion-digest-runner.js';
import { TELEGRAM_DELIVERY_UNKNOWN } from './telegram-digest-runner.js';
import { TRELLO_DELIVERY_UNKNOWN, TRELLO_READ_UNAVAILABLE_PREFIX } from './trello-digest-runner.js';

/** A schedule_runs row joined with the latest plan of its conversation (see RUN_SELECT). */
export interface RunRow {
  id: string;
  schedule_id: string;
  schedule_version: number;
  trigger: ScheduleRunView['trigger'];
  due_at: Date | string;
  status: string;
  missed_count: number;
  conv_id: string | null;
  plan_id: string | null;
  error: string | null;
  delivery?:
    | SheetsDigestDelivery
    | CalendarDigestDelivery
    | GithubDigestDelivery
    | TelegramDigestDelivery
    | SlackDigestDelivery
    | TrelloDigestDelivery
    | NotionDigestDelivery
    | MyJiraDigestDelivery
    | null;
  dispatched_config?: SheetsDigestConfig | Record<string, unknown> | null;
  dispatched_config_hash?: string | null;
  delivery_started_at?: Date | string | null;
  delivery_resolution?: ScheduleRunDeliveryResolution | null;
  delivery_resolved_at?: Date | string | null;
  delivery_resolved_by?: string | null;
  delivery_followup_run_id?: string | null;
  created_at: Date | string;
  latest_plan_id?: string | null;
  plan_status?: string | null;
  plan_expires_at?: Date | string | null;
}

/**
 * A run's columns plus the latest plan of its conversation. The member may have
 * changed the first plan in that conversation, so plan_id alone is not the answer.
 */
export const RUN_SELECT = `SELECT r.*,
    r.delivery_started_at,
    r.delivery_resolution,
    r.delivery_resolved_at,
    r.delivery_resolved_by,
    r.delivery_followup_run_id,
    p.id AS latest_plan_id, p.status AS plan_status, p.expires_at AS plan_expires_at
  FROM schedule_runs r
  LEFT JOIN LATERAL (
    SELECT id, status, expires_at FROM plans
    WHERE r.status = 'planned' AND plans.conv_id = r.conv_id
    ORDER BY created_at DESC, id DESC LIMIT 1
  ) p ON true`;

export function runState(row: RunRow, now: Date): ScheduleRunState {
  if (row.status !== 'planned') return row.status as ScheduleRunState;
  if (row.plan_status === 'pending') return new Date(row.plan_expires_at!).getTime() > now.getTime() ? 'awaiting_approval' : 'expired';
  if (row.plan_status === 'rejected') return 'rejected';
  return 'approved';
}

const iso = (value: Date | string) => new Date(value).toISOString();

type DeliverySchedule = Pick<ScheduleRow, 'kind' | 'version' | 'status' | 'recurrence' | 'digest_config' | 'digest_config_hash'>;

type CalendarOrGithubDigestKind = 'calendar_digest' | 'github_digest';

export function calendarOrGithubDeliveryUnknownKind(
  run: RunRow,
  schedule?: Pick<ScheduleRow, 'kind'>,
): CalendarOrGithubDigestKind | null {
  if (
    run.status !== 'needs_attention' ||
    run.delivery_started_at == null ||
    run.delivery_resolution != null ||
    typeof run.error !== 'string'
  ) {
    return null;
  }
  const markerKind = run.error.includes(CALENDAR_DELIVERY_UNKNOWN)
    ? 'calendar_digest'
    : run.error.includes(GITHUB_DELIVERY_UNKNOWN)
      ? 'github_digest'
      : null;
  if (!markerKind) return null;

  const config = run.dispatched_config;
  if (config && typeof config === 'object' && run.dispatched_config_hash) {
    // Keep these shape checks aligned with startup reconciliation.
    if ('source' in config && config.source === 'mycalendar' &&
        'version' in config && config.version === 1 &&
        'calendars' in config && Array.isArray(config.calendars)) {
      return 'calendar_digest';
    }
    if ('githubUserId' in config && typeof config.githubUserId === 'string' &&
        'repos' in config && Array.isArray(config.repos)) {
      return 'github_digest';
    }
  }
  return schedule?.kind === markerKind ? markerKind : null;
}

const SLACK_DELIVERY_UNKNOWN_PREFIX = 'SLACK_DELIVERY_UNKNOWN:';
export const SLACK_DIGEST_DELIVERY_UNKNOWN =
  `${SLACK_DELIVERY_UNKNOWN_PREFIX} Đã bắt đầu gửi bản tin Slack nhưng mất kết nối hoặc thiếu biên nhận hợp lệ từ Slack. Hệ thống tạm dừng tự động gửi lại để tránh trùng lặp.`;

export function getSlackDeliveryUnknown(
  run: RunRow,
): { target: { channelId: string; channelName?: string } | null } | null {
  if (
    run.status !== 'needs_attention' ||
    run.delivery_started_at == null ||
    run.delivery_resolution != null
  ) {
    return null;
  }

  const config = run.dispatched_config;
  // Keep the snapshot identity aligned with startup reconciliation.
  if (run.dispatched_config_hash && config && typeof config === 'object' &&
      'destination' in config && config.destination === 'slack' &&
      'slackCredentialId' in config && typeof config.slackCredentialId === 'string' &&
      'channelId' in config && typeof config.channelId === 'string' &&
      'sources' in config && Array.isArray(config.sources)) {
    return {
      target: {
        channelId: config.channelId,
        ...('channelName' in config && typeof config.channelName === 'string'
          ? { channelName: config.channelName }
          : {}),
      },
    };
  }
  return run.error?.startsWith(SLACK_DELIVERY_UNKNOWN_PREFIX) ? { target: null } : null;
}

export function matchesDispatchedDigestConfig(run: RunRow, schedule: DeliverySchedule): boolean {
  return run.schedule_version === schedule.version &&
    schedule.digest_config != null &&
    typeof schedule.digest_config === 'object' &&
    Boolean(schedule.digest_config_hash) &&
    (run.dispatched_config_hash == null || run.dispatched_config_hash === schedule.digest_config_hash);
}

export function matchesDispatchedSheetsConfig(run: RunRow, schedule: DeliverySchedule): boolean {
  // A pause or resume changes the schedule version while preserving the approved digest hash.
  return schedule.kind === 'sheets_digest' &&
    Boolean(schedule.digest_config && schedule.digest_config_hash) &&
    (run.dispatched_config_hash
      ? run.dispatched_config_hash === schedule.digest_config_hash
      : run.schedule_version === schedule.version);
}

export function hasUnknownTelegramDispatch(run: RunRow): boolean {
  const config = run.dispatched_config;
  // Keep the snapshot identity aligned with startup reconciliation.
  return Boolean(
    run.status === 'needs_attention' && run.delivery_started_at != null && run.delivery_resolution == null &&
    run.dispatched_config_hash && config && typeof config === 'object' &&
    'credentialId' in config && typeof config.credentialId === 'string' &&
    'telegramUserId' in config && typeof config.telegramUserId === 'string' &&
    'chatId' in config && typeof config.chatId === 'string' &&
    'sources' in config && Array.isArray(config.sources),
  );
}

export function getJiraDeliveryUnknown(run: RunRow): { config: JiraDigestConfig | null } | null {
  if (
    run.status !== 'needs_attention' ||
    run.delivery_started_at == null ||
    run.delivery_resolution != null
  ) {
    return null;
  }
  const config = run.dispatched_config_hash && isValidJiraDigestConfig(run.dispatched_config)
    ? run.dispatched_config
    : null;
  // Older runs may have recorded the Jira error without saving a dispatch snapshot.
  return config || run.error?.includes(MYJIRA_DELIVERY_UNKNOWN) ? { config } : null;
}

export function getSheetsDeliveryUnknown(
  run: RunRow,
  schedule?: Pick<ScheduleRow, 'kind'>,
): boolean {
  if (
    run.status !== 'needs_attention' ||
    run.delivery_started_at == null ||
    run.delivery_resolution != null ||
    typeof run.error !== 'string' ||
    !run.error.includes('SHEETS_DELIVERY_UNKNOWN')
  ) {
    return false;
  }
  const config = run.dispatched_config;
  const hasSheetsSnapshot = Boolean(
    config &&
      typeof config === 'object' &&
      'source' in config &&
      'destination' in config &&
      (!('version' in config) || config.version === 2) &&
      !('calendars' in config),
  );
  return hasSheetsSnapshot || schedule?.kind === 'sheets_digest';
}

export function getTrelloDeliveryUnknown(
  run: RunRow,
  schedule?: Pick<ScheduleRow, 'kind' | 'version'>,
): boolean {
  if (
    run.status !== 'needs_attention' ||
    run.delivery_started_at == null ||
    run.delivery_resolution != null ||
    typeof run.error !== 'string'
  ) {
    return false;
  }
  const config = run.dispatched_config;
  if (config && typeof config === 'object') {
    return 'trelloMemberId' in config && typeof config.trelloMemberId === 'string' &&
      'boards' in config && Array.isArray(config.boards);
  }
  return run.error.includes('TRELLO_DELIVERY_UNKNOWN') ||
    (schedule?.kind === 'trello_digest' &&
      schedule.version === run.schedule_version &&
      run.error.trim().length > 0);
}

export function isNotionDeliveryUnknown(run: RunRow, schedule?: DeliverySchedule): boolean {
  if (
    run.status !== 'needs_attention' ||
    run.delivery_started_at == null ||
    run.delivery_resolution != null ||
    typeof run.error !== 'string'
  ) {
    return false;
  }
  const hasNotionError =
    run.error.includes('NOTION_DELIVERY_UNKNOWN') ||
    run.error.includes('Chưa xác định bản tin Notion đã gửi hay chưa');
  const config = run.dispatched_config;
  const hasNotionSnapshot = Boolean(
    config &&
      typeof config === 'object' &&
      'databases' in config &&
      Array.isArray(config.databases),
  );
  if (schedule?.kind !== 'notion_digest') {
    return hasNotionError && hasNotionSnapshot;
  }
  if (hasNotionError) {
    return true;
  }
  // Some older workers saved neither a Notion-specific error nor the
  // dispatched snapshot. The current config only identifies that run if
  // the schedule still has the exact version that dispatched it.
  const effectiveConfig = config ??
    (run.schedule_version === schedule.version ? schedule.digest_config : null);
  return (run.error === CALENDAR_DELIVERY_UNKNOWN || run.error === GITHUB_DELIVERY_UNKNOWN) &&
    effectiveConfig !== null && typeof effectiveConfig === 'object' && 'databases' in effectiveConfig && Array.isArray(effectiveConfig.databases);
}

export function runView(row: RunRow, now: Date, schedule?: DeliverySchedule): ScheduleRunView {
  const jiraUnknown = getJiraDeliveryUnknown(row);
  const slackUnknown = getSlackDeliveryUnknown(row);
  const telegramUnknown = hasUnknownTelegramDispatch(row);
  const sheetsUnknown = getSheetsDeliveryUnknown(row, schedule);
  const trelloUnknown = getTrelloDeliveryUnknown(row, schedule);
  const notionUnknown = isNotionDeliveryUnknown(row, schedule);
  let error = jiraUnknown ? MYJIRA_DELIVERY_UNKNOWN
    : slackUnknown && !row.error?.startsWith(SLACK_DELIVERY_UNKNOWN_PREFIX) ? SLACK_DIGEST_DELIVERY_UNKNOWN
    : telegramUnknown ? TELEGRAM_DELIVERY_UNKNOWN
    : trelloUnknown ? TRELLO_DELIVERY_UNKNOWN
    : notionUnknown ? NOTION_DELIVERY_UNKNOWN : row.error;
  if (row.status === 'digest_failed' && error?.startsWith(TRELLO_READ_UNAVAILABLE_PREFIX)) {
    error = error.slice(TRELLO_READ_UNAVAILABLE_PREFIX.length);
  }
  if (row.status === 'digest_failed' && error?.startsWith(JIRA_READ_UNAVAILABLE_PREFIX)) {
    error = error.slice(JIRA_READ_UNAVAILABLE_PREFIX.length);
  }
  const view: ScheduleRunView = {
    id: row.id, scheduleId: row.schedule_id, trigger: row.trigger,
    dueAt: iso(row.due_at), createdAt: iso(row.created_at),
    state: runState(row, now), missedCount: row.missed_count,
    convId: row.conv_id, planId: row.latest_plan_id ?? row.plan_id ?? null,
    planStatus: row.plan_status ?? null,
    error,
    delivery: row.delivery ?? null,
    deliveryStartedAt: row.delivery_started_at ? iso(row.delivery_started_at) : null,
    deliveryResolution: row.delivery_resolution ?? null,
    deliveryResolvedAt: row.delivery_resolved_at ? iso(row.delivery_resolved_at) : null,
    deliveryFollowupRunId: row.delivery_followup_run_id ?? null,
  };
  const unknownKind = slackUnknown ? 'slack_digest'
    : telegramUnknown ? 'telegram_digest'
    : trelloUnknown ? 'trello_digest'
    : notionUnknown ? 'notion_digest'
    : calendarOrGithubDeliveryUnknownKind(row, schedule);
  if (schedule && jiraUnknown) {
    view.canRetryDelivery = schedule.kind === 'myjira_digest' && schedule.status === 'active' &&
      matchesDispatchedDigestConfig(row, schedule);
  } else if (schedule && sheetsUnknown) {
    view.canRetryDelivery = schedule.status === 'active' && matchesDispatchedSheetsConfig(row, schedule);
  } else if (schedule && unknownKind) {
    view.canRetryDelivery = schedule.kind === unknownKind &&
      (schedule.status === 'active' || (schedule.status === 'completed' && schedule.recurrence.type === 'once')) &&
      matchesDispatchedDigestConfig(row, schedule);
  }
  return view;
}

export const toRunView = runView;
export const runViewFromRow = runView;
