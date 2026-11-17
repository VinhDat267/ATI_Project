import type {
  CalendarDigestDelivery,
  GithubDigestDelivery,
  NotionDigestDelivery,
  ScheduleRunDeliveryResolution,
  ScheduleRunState,
  ScheduleRunView,
  SheetsDigestConfig,
  SheetsDigestDelivery,
  TelegramDigestDelivery,
  TrelloDigestDelivery,
} from '@wap/tool-schemas';
import type { ScheduleRow } from '../../db/repositories/schedule-repo.js';
import { CALENDAR_DELIVERY_UNKNOWN } from './calendar-digest-runner.js';
import { GITHUB_DELIVERY_UNKNOWN } from './github-digest-runner.js';
import { JIRA_READ_UNAVAILABLE_PREFIX } from './jira-digest-runner.js';
import { NOTION_DELIVERY_UNKNOWN } from './notion-digest-runner.js';
import { TRELLO_READ_UNAVAILABLE_PREFIX } from './trello-digest-runner.js';

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
    | TrelloDigestDelivery
    | NotionDigestDelivery
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

export function matchesDispatchedDigestConfig(run: RunRow, schedule: DeliverySchedule): boolean {
  return run.schedule_version === schedule.version &&
    schedule.digest_config != null &&
    typeof schedule.digest_config === 'object' &&
    Boolean(schedule.digest_config_hash) &&
    (run.dispatched_config_hash == null || run.dispatched_config_hash === schedule.digest_config_hash);
}

export function isNotionDeliveryUnknown(run: RunRow, schedule?: DeliverySchedule): boolean {
  if (
    schedule?.kind !== 'notion_digest' ||
    run.status !== 'needs_attention' ||
    run.delivery_started_at == null ||
    run.delivery_resolution != null ||
    typeof run.error !== 'string'
  ) {
    return false;
  }
  if (run.error.includes('NOTION_DELIVERY_UNKNOWN') ||
      run.error.includes('Chưa xác định bản tin Notion đã gửi hay chưa')) {
    return true;
  }
  // Some older workers saved neither a Notion-specific error nor the
  // dispatched snapshot. The current config only identifies that run if
  // the schedule still has the exact version that dispatched it.
  const config = run.dispatched_config ??
    (run.schedule_version === schedule.version ? schedule.digest_config : null);
  return (run.error === CALENDAR_DELIVERY_UNKNOWN || run.error === GITHUB_DELIVERY_UNKNOWN) &&
    config !== null && typeof config === 'object' && 'databases' in config && Array.isArray(config.databases);
}

export function runView(row: RunRow, now: Date, schedule?: DeliverySchedule): ScheduleRunView {
  let error = isNotionDeliveryUnknown(row, schedule) ? NOTION_DELIVERY_UNKNOWN : row.error;
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
  const unknownKind = calendarOrGithubDeliveryUnknownKind(row, schedule);
  if (schedule && unknownKind) {
    view.canRetryDelivery = schedule.kind === unknownKind &&
      (schedule.status === 'active' || (schedule.status === 'completed' && schedule.recurrence.type === 'once')) &&
      matchesDispatchedDigestConfig(row, schedule);
  } else if (
    schedule?.kind === 'myjira_digest' &&
    row.status === 'needs_attention' &&
    row.delivery_started_at != null &&
    row.delivery_resolution == null &&
    typeof row.error === 'string' &&
    row.error.trim().length > 0
  ) {
    view.canRetryDelivery =
      (schedule.status === 'active' || (schedule.status === 'completed' && schedule.recurrence.type === 'once')) &&
      matchesDispatchedDigestConfig(row, schedule);
  }
  return view;
}

export const toRunView = runView;
export const runViewFromRow = runView;
