import type { CalendarDigestDelivery, GithubDigestDelivery, ScheduleRunState, ScheduleRunView, SheetsDigestDelivery } from '@wap/tool-schemas';

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
  delivery?: SheetsDigestDelivery | CalendarDigestDelivery | GithubDigestDelivery | null;
  created_at: Date | string;
  latest_plan_id?: string | null;
  plan_status?: string | null;
  plan_expires_at?: Date | string | null;
}

/**
 * A run's columns plus the latest plan of its conversation. The member may have
 * changed the first plan in that conversation, so plan_id alone is not the answer.
 */
export const RUN_SELECT = `SELECT r.*, p.id AS latest_plan_id, p.status AS plan_status, p.expires_at AS plan_expires_at
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

export function runView(row: RunRow, now: Date): ScheduleRunView {
  const view: ScheduleRunView = {
    id: row.id, scheduleId: row.schedule_id, trigger: row.trigger,
    dueAt: iso(row.due_at), createdAt: iso(row.created_at),
    state: runState(row, now), missedCount: row.missed_count,
    convId: row.conv_id, planId: row.latest_plan_id ?? row.plan_id ?? null,
    planStatus: row.plan_status ?? null, error: row.error,
    delivery: row.delivery ?? null,
  };
  if (row.delivery != null) {
    view.delivery = row.delivery;
  }
  return view;
}
