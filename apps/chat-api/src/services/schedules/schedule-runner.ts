import type pg from 'pg';
import type { CalendarDigestConfig, GithubDigestConfig, ScheduleKind, ScheduleRecurrence, ScheduleRunMessageMetadata, TelegramDigestConfig } from '@wap/tool-schemas';
import { MessageRepo } from '../../db/repositories/message-repo.js';
import type { Queryable, ScheduleRow } from '../../db/repositories/schedule-repo.js';
import type { DigestRunOutcome as CalendarDigestRunOutcome, RunCalendarDigest } from './calendar-digest-runner.js';
import { CALENDAR_DELIVERY_UNKNOWN } from './calendar-digest-runner.js';
import { RUN_SELECT, runState, type RunRow } from './run-state.js';
import { localLabel, nextOccurrence } from './next-occurrence.js';
import type { ScheduleChange } from './schedule-service.js';
import type { SheetsDigestRunner } from './sheets-digest-runner.js';
import type { DigestRunOutcome as GithubDigestRunOutcome, RunGithubDigest } from './github-digest-runner.js';
import type { DigestRunInput, DigestRunOutcome } from './telegram-digest-runner.js';

export interface RunToPlan {
  runId: string; scheduleId: string; scheduleVersion: number; userId: string;
  name: string; request: string; dueAt: Date; trigger: 'scheduled' | 'manual' | 'replan';
  workspaceId?: string | null;
  workspaceMode?: 'legacy' | 'personal' | 'organization';
}
export interface PreparedRun {
  /** Writes the result with the client of the transaction that holds the schedule row. */
  persist(client: pg.PoolClient): Promise<{ state: 'planned'; planId: string } | { state: 'needs_attention' }>;
  /** Emits SSE after COMMIT. */
  afterCommit(): void;
}
export type PlanRun = (run: RunToPlan, convId: string, signal: AbortSignal) => Promise<PreparedRun>;
export type ExecuteDigestRun = (run: DigestRunInput, signal: AbortSignal) => Promise<DigestRunOutcome>;

/** The message a run is planned from (design 5.5), saved first in the run's conversation. */
export function runMessage(run: Pick<RunToPlan, 'name' | 'request' | 'dueAt'>, timeZone: string): string {
  return `${run.request}\n\n(Lượt chạy theo lịch "${run.name}" lúc ${localLabel(run.dueAt, timeZone)}.)`;
}

export interface ScheduleRunnerOptions {
  pool: pg.Pool;
  planRun: PlanRun;
  runDigest?: RunCalendarDigest | RunGithubDigest;
  runGithubDigest?: RunGithubDigest;
  executeDigestRun?: ExecuteDigestRun;
  timeZone: string;
  /** Writes the state message of a schedule the runner paused or completed (ScheduleService.recordState). */
  recordState: (client: Queryable, row: ScheduleRow, now: Date) => Promise<ScheduleChange>;
  emit?: (convId: string, event: string, payload: unknown) => unknown;
  now?: () => Date;
  tickMs?: number;
  planTimeoutMs?: number;
  sheetsDigestRunner?: SheetsDigestRunner;
}

const LATE_MS = 10 * 60_000;
const DUE_PER_TICK = 5;
const MAX_MISSED = 1000;
const BLOCKED = 'Tài khoản không còn hoạt động.';
const UNAPPROVED = '3 lượt liền không được duyệt';
const DIGEST_FAILED_3X = '3 lượt gửi bản tin liên tiếp thất bại';
const GITHUB_DIGEST_FAILED_3X = '3 lượt liền gửi thất bại';
const DIGEST_FAILED = 'Không gửi được bản tin lịch lúc này.';
const DISCARDED = 'Lịch đã thay đổi trong lúc lập kế hoạch. Kết quả này bị bỏ.';
const FAILED = 'Không lập được kế hoạch lúc này. Hãy thử lại.';
const TIMED_OUT = 'Lập kế hoạch quá thời gian cho phép.';
const STOPPED = 'Máy chủ dừng khi đang lập kế hoạch.';
const INTERRUPTED = 'Máy chủ khởi động lại khi đang lập kế hoạch.';

async function inTransaction<T>(pool: pg.Pool, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Startup: a run that was planning when the server stopped is interrupted, never planned again on its own. */
export async function reconcileScheduleRuns(pool: pg.Pool): Promise<void> {
  const messages = new MessageRepo(pool);
  await inTransaction(pool, async (client) => {
    const res = await client.query(
      `UPDATE schedule_runs r SET
         status=CASE WHEN r.delivery_started_at IS NOT NULL THEN 'needs_attention' ELSE 'interrupted' END,
         error=CASE WHEN r.delivery_started_at IS NOT NULL THEN $2 ELSE $1 END,
         updated_at=now()
       WHERE r.status='planning' RETURNING r.conv_id, r.error`,
      [INTERRUPTED, CALENDAR_DELIVERY_UNKNOWN]);
    for (const row of res.rows) {
      if (!row.conv_id) continue;
      // Answer the run's first message, so reopening the conversation ends its planning state.
      const first = (await client.query("SELECT id FROM messages WHERE conv_id=$1 AND metadata->>'type'='schedule_run' ORDER BY created_at, id LIMIT 1", [row.conv_id])).rows[0];
      await messages.createMessage(row.conv_id, 'system', `Lỗi: ${row.error}`, { type: 'planning_error', ...(first ? { replyToMessageId: first.id } : {}) }, client);
    }
  });
}

/**
 * Picks up due schedules every tick and plans their runs one at a time. One API
 * instance: schedule rows are claimed with SKIP LOCKED and each scheduled time
 * is unique, but there is no lease (as for W2-01 recovery).
 */
export class ScheduleRunner {
  private messages: MessageRepo;
  private now: () => Date;
  private planTimeoutMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking: Promise<void> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private current: AbortController | null = null;
  private stopping = false;

  constructor(private options: ScheduleRunnerOptions) {
    this.messages = new MessageRepo(options.pool);
    this.now = options.now ?? (() => new Date());
    this.planTimeoutMs = options.planTimeoutMs ?? 180_000;
  }

  start(): void {
    const beat = () => {
      if (this.ticking || this.stopping) return;
      this.ticking = this.tick()
        .catch((error) => console.error('[schedules] tick failed:', error instanceof Error ? error.message : error))
        .finally(() => { this.ticking = null; });
    };
    this.timer = setInterval(beat, this.options.tickMs ?? 30_000);
    this.timer.unref?.();
    beat();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.current?.abort();
    await this.ticking;
    await this.queue;
  }

  /** Called after COMMIT only. */
  private send(convId: string, event: string, payload: unknown) {
    try {
      void Promise.resolve(this.options.emit?.(convId, event, payload)).catch(() => undefined);
    } catch { /* A listener cannot undo a committed change. */ }
  }

  private announce(changes: ScheduleChange[]) {
    for (const change of changes) {
      if (change.state) this.send(change.convId, 'schedule_updated', { conversationId: change.convId, messageId: change.state.messageId, ...change.state.metadata });
    }
  }

  private async lastThreeExpired(client: pg.PoolClient, scheduleId: string, now: Date): Promise<boolean> {
    const res = await client.query(`${RUN_SELECT} WHERE r.schedule_id=$1 AND r.trigger='scheduled' ORDER BY r.created_at DESC, r.id DESC LIMIT 3`, [scheduleId]);
    return res.rows.length === 3 && res.rows.every((row: RunRow) => runState(row, now) === 'expired');
  }

  private async lastThreeDigestFailed(client: pg.PoolClient, scheduleId: string): Promise<boolean> {
    const res = await client.query(
      `SELECT status FROM schedule_runs WHERE schedule_id=$1 AND trigger='scheduled' ORDER BY created_at DESC, id DESC LIMIT 3`,
      [scheduleId],
    );
    return res.rows.length === 3 && res.rows.every((row: { status: string }) => row.status === 'digest_failed');
  }

  private async pause(client: pg.PoolClient, id: string, reason: string): Promise<ScheduleRow> {
    return (await client.query(
      "UPDATE schedules SET status='paused', pause_reason=$2, next_run_at=NULL, version=version+1, updated_at=now() WHERE id=$1 RETURNING *", [id, reason])).rows[0];
  }

  private async advance(client: pg.PoolClient, id: string, next: Date | null): Promise<ScheduleRow> {
    return (await client.query(
      `UPDATE schedules SET next_run_at=$2, status=CASE WHEN $2::timestamptz IS NULL THEN 'completed' ELSE status END, updated_at=now()
       WHERE id=$1 RETURNING *`, [id, next])).rows[0];
  }

  private insertRun(client: pg.PoolClient, row: ScheduleRow, dueAt: Date, status: string, extra: { missedCount?: number; error?: string } = {}) {
    return client.query(
      `INSERT INTO schedule_runs(schedule_id, schedule_version, trigger, due_at, status, missed_count, error)
       VALUES($1, $2, 'scheduled', $3, $4, $5, $6)
       ON CONFLICT (schedule_id, due_at) WHERE trigger = 'scheduled' DO NOTHING RETURNING id`,
      [row.id, row.version, dueAt, status, extra.missedCount ?? 0, extra.error ?? null]);
  }

  /** One tick: claim due schedules, record their runs, then plan the new runs one at a time. */
  async tick(): Promise<void> {
    const now = this.now();
    const { timeZone } = this.options;
    const toPlan: string[] = [];
    const changes = await inTransaction(this.options.pool, async (client) => {
      const changes: ScheduleChange[] = [];
      // Claim the conversation with the schedule, skipping both when either is held: a confirmation
      // holds the conversation while it waits for the schedule (lock order in ScheduleRepo.ownedSchedule).
      const due = await client.query(
        `SELECT s.*, u.status AS owner_status, wm.status AS member_status FROM schedules s
         JOIN conversations c ON c.id = s.conv_id JOIN users u ON u.id = s.user_id
         LEFT JOIN workspace_members wm ON wm.workspace_id = s.workspace_id AND wm.user_id = s.user_id
         WHERE s.status = 'active' AND s.next_run_at <= $1
         ORDER BY s.next_run_at, s.id FOR UPDATE OF c, s SKIP LOCKED LIMIT ${DUE_PER_TICK}`, [now]);
      for (const row of due.rows as Array<ScheduleRow & { owner_status: string; member_status?: string }>) {
        // A run started by hand is still planning; look again next tick.
        if ((await client.query("SELECT 1 FROM schedule_runs WHERE schedule_id=$1 AND status='planning'", [row.id])).rowCount) continue;
        const dueAt = new Date(row.next_run_at!);
        if (row.owner_status !== 'active' || (row.workspace_mode === 'organization' && row.member_status !== 'active')) {
          await this.insertRun(client, row, dueAt, 'blocked', { error: BLOCKED });
          changes.push(await this.options.recordState(client, await this.pause(client, row.id, BLOCKED), now));
          continue;
        }
        if (now.getTime() - dueAt.getTime() > LATE_MS) {
          // Missed while the server was off: one row for all of them, no write is ever replayed.
          let missed = 0;
          let next: Date | null = dueAt;
          while (next && next.getTime() <= now.getTime() && missed < MAX_MISSED) {
            missed++;
            next = nextOccurrence(row.recurrence, next, timeZone);
          }
          await this.insertRun(client, row, dueAt, 'missed', { missedCount: missed });
          const moved = await this.advance(client, row.id, next);
          if (moved.status === 'completed') changes.push(await this.options.recordState(client, moved, now));
          continue;
        }
        if (row.kind !== 'github_digest' && row.kind !== 'telegram_digest' && await this.lastThreeExpired(client, row.id, now)) {
          changes.push(await this.options.recordState(client, await this.pause(client, row.id, UNAPPROVED), now));
          continue;
        }
        if (row.kind === 'calendar_digest' && await this.lastThreeDigestFailed(client, row.id)) {
          changes.push(await this.options.recordState(client, await this.pause(client, row.id, DIGEST_FAILED_3X), now));
          continue;
        }
        const inserted = await this.insertRun(client, row, dueAt, 'planning');
        const moved = await this.advance(client, row.id, nextOccurrence(row.recurrence, new Date(Math.max(now.getTime(), dueAt.getTime())), timeZone));
        if (moved.status === 'completed') changes.push(await this.options.recordState(client, moved, now));
        if (inserted.rowCount) toPlan.push(inserted.rows[0].id);
      }
      return changes;
    });
    this.announce(changes);
    for (const runId of toPlan) await this.planNow(runId);
  }

  /** Queues a planning run; runs are planned one at a time in this process. */
  planNow(runId: string): Promise<void> {
    const job = this.queue.then(() => this.planOne(runId));
    this.queue = job.catch(() => undefined);
    return job;
  }

  private async planOne(runId: string): Promise<void> {
    const { pool, timeZone } = this.options;
    const started = await inTransaction(pool, async (client) => {
      const res = await client.query(
        `SELECT r.*, s.user_id, s.conv_id AS schedule_conv_id, s.name, s.request, s.recurrence, s.services,
                s.status AS schedule_status, s.pause_reason, s.version AS current_schedule_version,
                s.next_run_at, s.last_proposal_id, s.workspace_id, s.workspace_mode,
                s.kind, s.digest_config, s.digest_config_hash, s.digest_approved_at,
                s.created_at AS schedule_created_at, s.updated_at AS schedule_updated_at
         FROM schedule_runs r JOIN schedules s ON s.id = r.schedule_id
         WHERE r.id = $1 AND r.status = 'planning' FOR UPDATE OF r`, [runId]);
      const run = res.rows[0];
      if (!run) return null;
      const dueAt = new Date(run.due_at);
      const label = localLabel(dueAt, timeZone);
      const convId = (await client.query("INSERT INTO conversations(user_id, status, title, workspace_id, workspace_mode) VALUES($1, 'chatting', $2, $3, $4) RETURNING id",
        [run.user_id, `Lịch: ${run.name} · ${label}`, run.workspace_id ?? null, run.workspace_mode ?? 'legacy'])).rows[0].id as string;
      const metadata: ScheduleRunMessageMetadata = { type: 'schedule_run', scheduleId: run.schedule_id, runId: run.id, name: run.name, dueAt: dueAt.toISOString(), trigger: run.trigger };
      const first = await this.messages.createMessage(convId, 'user', runMessage({ name: run.name, request: run.request, dueAt }, timeZone), metadata, client);
      await client.query('UPDATE schedule_runs SET conv_id=$2, updated_at=now() WHERE id=$1', [runId, convId]);
      const toPlan: RunToPlan = { runId: run.id, scheduleId: run.schedule_id, scheduleVersion: run.schedule_version, userId: run.user_id,
        name: run.name, request: run.request, dueAt, trigger: run.trigger, workspaceId: run.workspace_id ?? null, workspaceMode: run.workspace_mode ?? 'legacy' };
      const scheduleRow: ScheduleRow = {
        id: run.schedule_id,
        user_id: run.user_id,
        conv_id: run.schedule_conv_id,
        name: run.name,
        request: run.request,
        recurrence: run.recurrence,
        services: run.services,
        status: run.schedule_status,
        pause_reason: run.pause_reason,
        version: run.current_schedule_version,
        next_run_at: run.next_run_at,
        last_proposal_id: run.last_proposal_id,
        workspace_id: run.workspace_id ?? null,
        workspace_mode: run.workspace_mode ?? 'legacy',
        kind: run.kind,
        digest_config: run.digest_config,
        digest_config_hash: run.digest_config_hash,
        digest_approved_at: run.digest_approved_at,
        created_at: run.schedule_created_at,
        updated_at: run.schedule_updated_at,
      };
      return {
        toPlan,
        convId,
        messageId: first.id,
        scheduleRow,
        kind: (run.kind ?? 'plan_approval') as ScheduleKind,
        recurrence: run.recurrence as ScheduleRecurrence,
        digestConfig: (run.digest_config ?? null) as CalendarDigestConfig | GithubDigestConfig | TelegramDigestConfig | null,
        digestConfigHash: (run.digest_config_hash ?? null) as string | null,
      };
    });
    if (!started) return;

    if (started.scheduleRow.kind === 'sheets_digest' && this.options.sheetsDigestRunner) {
      await this.executeDigestRun(runId, started);
      return;
    }

    if (started.kind === 'calendar_digest') {
      await this.runDigestOne({
        ...started,
        digestConfig: started.digestConfig as CalendarDigestConfig | null,
      });
      return;
    }

    if (started.kind === 'github_digest' && (this.options.runGithubDigest || this.options.runDigest)) {
      await this.executeGithubDigestOne(runId, {
        ...started,
        digestConfig: started.digestConfig as GithubDigestConfig | null,
      });
      return;
    }

    if (started.kind === 'telegram_digest' && this.options.executeDigestRun) {
      await this.executeTelegramDigestOne(runId, {
        ...started,
        digestConfig: started.digestConfig as TelegramDigestConfig | null,
      });
      return;
    }

    const controller = new AbortController();
    this.current = controller;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.planTimeoutMs);
    let prepared: PreparedRun | null = null;
    let failure: string | null = null;
    try {
      // Do not wait past the limit even if planning ignores its signal.
      const aborted = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
      prepared = await Promise.race([this.options.planRun(started.toPlan, started.convId, controller.signal), aborted]);
    } catch (error) {
      failure = timedOut ? TIMED_OUT : this.stopping ? STOPPED : FAILED;
      if (!timedOut && !this.stopping) console.error('[schedules] planning a run failed:', error instanceof Error ? error.message : error);
    } finally {
      clearTimeout(timer);
      this.current = null;
    }

    // 'planned', the text a run ended with when it has no result to announce, or null when another process ended it.
    const ended = await inTransaction(pool, async (client): Promise<string | null> => {
      const schedule = (await client.query('SELECT version, status FROM schedules WHERE id=$1 FOR UPDATE', [started.toPlan.scheduleId])).rows[0];
      const run = (await client.query('SELECT status FROM schedule_runs WHERE id=$1 FOR UPDATE', [runId])).rows[0];
      if (run?.status !== 'planning') return null;
      // Both endings answer the run's first message, as the error of a chat turn answers its request.
      const replyTo = { replyToMessageId: started.messageId };
      if (failure || !prepared) {
        const text = failure ?? FAILED;
        await this.messages.createMessage(started.convId, 'system', `Lỗi: ${text}`, { type: 'planning_error', ...replyTo }, client);
        await client.query("UPDATE schedule_runs SET status = $2, error=$3, updated_at=now() WHERE id=$1",
          [runId, failure === STOPPED ? 'interrupted' : 'planning_failed', text]);
        return text;
      }
      // Every change by the member bumps the version: a result planned for an older version is dropped.
      if (schedule.version !== started.toPlan.scheduleVersion || schedule.status === 'cancelled') {
        await this.messages.createMessage(started.convId, 'system', DISCARDED, { type: 'schedule_discarded', ...replyTo }, client);
        await client.query("UPDATE schedule_runs SET status='discarded', updated_at=now() WHERE id=$1", [runId]);
        return DISCARDED;
      }
      const outcome = await prepared.persist(client);
      await client.query('UPDATE schedule_runs SET status=$2, plan_id=$3, updated_at=now() WHERE id=$1',
        [runId, outcome.state, outcome.state === 'planned' ? outcome.planId : null]);
      return 'planned';
    });
    if (ended === 'planned') prepared!.afterCommit();
    // The page that showed "planning" for this run hears that it ended, once the ending is saved.
    else if (ended) this.send(started.convId, 'error', { conversationId: started.convId, message: ended, replyToMessageId: started.messageId });
  }

  private async executeDigestRun(
    runId: string,
    started: { toPlan: RunToPlan; convId: string; messageId: string; scheduleRow: ScheduleRow }
  ): Promise<void> {
    const { pool } = this.options;
    const controller = new AbortController();
    this.current = controller;
    const timer = setTimeout(() => controller.abort(), this.planTimeoutMs);

    let outcome: Awaited<ReturnType<SheetsDigestRunner['executeDigest']>>;
    try {
      outcome = await this.options.sheetsDigestRunner!.executeDigest(
        started.scheduleRow,
        started.toPlan.scheduleVersion,
        async () => {
          const res = await pool.query('SELECT version, status FROM schedules WHERE id=$1', [
            started.toPlan.scheduleId,
          ]);
          const row = res.rows[0];
          return Boolean(
            row &&
              row.version === started.toPlan.scheduleVersion &&
              row.status !== 'cancelled' &&
              row.status !== 'paused'
          );
        },
        controller.signal
      );
    } catch {
      outcome = { status: 'digest_failed', error: 'Không gửi được báo cáo tự động lúc này.' };
    } finally {
      clearTimeout(timer);
      this.current = null;
    }

    const now = this.now();
    const stateChanges = await inTransaction(pool, async (client): Promise<ScheduleChange[]> => {
      const changes: ScheduleChange[] = [];
      await client.query('SELECT id FROM conversations WHERE id=$1 FOR UPDATE', [started.scheduleRow.conv_id]);
      const schedule = (
        await client.query('SELECT * FROM schedules WHERE id=$1 FOR UPDATE', [started.toPlan.scheduleId])
      ).rows[0] as ScheduleRow | undefined;
      const run = (
        await client.query('SELECT status FROM schedule_runs WHERE id=$1 FOR UPDATE', [runId])
      ).rows[0];
      if (!schedule || run?.status !== 'planning') return changes;

      const replyTo = { replyToMessageId: started.messageId };

      if (
        outcome.status === 'discarded' ||
        schedule.version !== started.toPlan.scheduleVersion ||
        schedule.status === 'cancelled'
      ) {
        await this.messages.createMessage(
          started.convId,
          'system',
          DISCARDED,
          { type: 'schedule_discarded', ...replyTo },
          client
        );
        await client.query("UPDATE schedule_runs SET status='discarded', updated_at=now() WHERE id=$1", [runId]);
        return changes;
      }

      if (outcome.status === 'blocked') {
        await this.messages.createMessage(
          started.convId,
          'system',
          `Lỗi: ${outcome.pauseReason}`,
          { type: 'planning_error', ...replyTo },
          client
        );
        await client.query(
          "UPDATE schedule_runs SET status='blocked', error=$2, updated_at=now() WHERE id=$1",
          [runId, outcome.pauseReason]
        );
        const paused = await this.pause(client, schedule.id, outcome.pauseReason);
        changes.push(await this.options.recordState(client, paused, now));
        return changes;
      }

      if (outcome.status === 'digest_failed') {
        await this.messages.createMessage(
          started.convId,
          'system',
          `Lỗi: ${outcome.error}`,
          { type: 'planning_error', ...replyTo },
          client
        );
        await client.query(
          "UPDATE schedule_runs SET status='digest_failed', error=$2, updated_at=now() WHERE id=$1",
          [runId, outcome.error]
        );
        const recent = await client.query(
          'SELECT status FROM schedule_runs WHERE schedule_id=$1 ORDER BY created_at DESC, id DESC LIMIT 3',
          [schedule.id]
        );
        if (recent.rows.length === 3 && recent.rows.every((r) => r.status === 'digest_failed')) {
          const paused = await this.pause(
            client,
            schedule.id,
            'Tự dừng sau 3 lần gửi báo cáo tự động liên tiếp thất bại.'
          );
          changes.push(await this.options.recordState(client, paused, now));
        }
        return changes;
      }

      await this.messages.createMessage(
        started.convId,
        'assistant',
        outcome.text,
        { type: 'sheets_digest_sent', delivery: outcome.delivery, ...replyTo },
        client
      );
      await client.query(
        "UPDATE schedule_runs SET status='digest_sent', delivery=$2::jsonb, updated_at=now() WHERE id=$1",
        [runId, JSON.stringify(outcome.delivery)]
      );
      return changes;
    });

    this.announce(stateChanges);
  }

  private async runDigestOne(started: {
    toPlan: RunToPlan;
    convId: string;
    messageId: string;
    digestConfig: CalendarDigestConfig | null;
    digestConfigHash: string | null;
  }): Promise<void> {
    const { pool } = this.options;
    const runId = started.toPlan.runId;
    const controller = new AbortController();
    this.current = controller;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.planTimeoutMs);
    let outcome: CalendarDigestRunOutcome;
    let stoppedError = false;
    try {
      const calendarRunner = this.options.runDigest as RunCalendarDigest | undefined;
      if (!calendarRunner) throw new Error('Chưa nối digest runner');
      const aborted = new Promise<never>((_, reject) =>
        controller.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }),
      );
      outcome = await Promise.race([
        calendarRunner(
          {
            ...started.toPlan,
            digestConfig: started.digestConfig,
            digestConfigHash: started.digestConfigHash,
          },
          controller.signal,
        ),
        aborted,
      ]);
    } catch {
      if (this.stopping && !timedOut) {
        stoppedError = true;
        outcome = { state: 'digest_failed', error: STOPPED };
      } else {
        outcome = { state: 'digest_failed', error: timedOut ? TIMED_OUT : DIGEST_FAILED };
      }
    } finally {
      clearTimeout(timer);
      this.current = null;
    }

    const result = await inTransaction(pool, async (client) => {
      const schedule = (await client.query('SELECT * FROM schedules WHERE id=$1 FOR UPDATE', [started.toPlan.scheduleId])).rows[0] as ScheduleRow | undefined;
      const run = (await client.query('SELECT status, delivery_started_at FROM schedule_runs WHERE id=$1 FOR UPDATE', [runId])).rows[0];
      if (run?.status !== 'planning' || !schedule) return { ended: null as string | null, changes: [] as ScheduleChange[], assistantMessageId: undefined as string | undefined };
      const replyTo = { replyToMessageId: started.messageId };

      if (outcome.state === 'delivery_unknown' || (run.delivery_started_at && outcome.state !== 'digest_sent')) {
        await this.messages.createMessage(started.convId, 'system', CALENDAR_DELIVERY_UNKNOWN, { type: 'planning_error', ...replyTo }, client);
        await client.query("UPDATE schedule_runs SET status='needs_attention', error=$2, updated_at=now() WHERE id=$1", [runId, CALENDAR_DELIVERY_UNKNOWN]);
        return { ended: CALENDAR_DELIVERY_UNKNOWN, changes: [] as ScheduleChange[], assistantMessageId: undefined };
      }

      if (stoppedError && outcome.state !== 'digest_sent') {
        await this.messages.createMessage(started.convId, 'system', `Lỗi: ${STOPPED}`, { type: 'planning_error', ...replyTo }, client);
        await client.query("UPDATE schedule_runs SET status='interrupted', error=$2, updated_at=now() WHERE id=$1", [runId, STOPPED]);
        return { ended: STOPPED, changes: [] as ScheduleChange[], assistantMessageId: undefined };
      }

      if (outcome.state === 'discarded' || (outcome.state !== 'digest_sent' && (schedule.version !== started.toPlan.scheduleVersion || schedule.status === 'cancelled'))) {
        await this.messages.createMessage(started.convId, 'system', DISCARDED, { type: 'schedule_discarded', ...replyTo }, client);
        await client.query("UPDATE schedule_runs SET status='discarded', updated_at=now() WHERE id=$1", [runId]);
        return { ended: DISCARDED, changes: [] as ScheduleChange[], assistantMessageId: undefined };
      }

      if (outcome.state === 'blocked') {
        await this.messages.createMessage(started.convId, 'system', `Lỗi: ${outcome.pauseReason}`, { type: 'planning_error', ...replyTo }, client);
        await client.query("UPDATE schedule_runs SET status='blocked', error=$2, updated_at=now() WHERE id=$1", [runId, outcome.pauseReason]);
        const paused = await this.pause(client, started.toPlan.scheduleId, outcome.pauseReason);
        const change = await this.options.recordState(client, paused, this.now());
        return { ended: outcome.pauseReason, changes: [change], assistantMessageId: undefined };
      }

      if (outcome.state === 'digest_failed') {
        await this.messages.createMessage(started.convId, 'system', `Lỗi: ${outcome.error}`, { type: 'planning_error', ...replyTo }, client);
        await client.query("UPDATE schedule_runs SET status='digest_failed', error=$2, updated_at=now() WHERE id=$1", [runId, outcome.error]);
        return { ended: outcome.error, changes: [] as ScheduleChange[], assistantMessageId: undefined };
      }

      const msg = await this.messages.createMessage(
        started.convId,
        'assistant',
        outcome.messageText,
        { type: 'calendar_digest_sent', delivery: outcome.delivery, ...replyTo },
        client,
      );
      await client.query("UPDATE schedule_runs SET status='digest_sent', delivery=$2::jsonb, error=NULL, updated_at=now() WHERE id=$1", [
        runId,
        JSON.stringify(outcome.delivery),
      ]);
      return { ended: 'digest_sent', changes: [] as ScheduleChange[], assistantMessageId: msg.id, messageText: outcome.messageText };
    });

    this.announce(result.changes);
    if (result.ended === 'digest_sent') {
      this.send(started.convId, 'message_complete', {
        conversationId: started.convId,
        messageId: result.assistantMessageId,
        content: result.messageText,
        replyToMessageId: started.messageId,
      });
    } else if (result.ended) {
      this.send(started.convId, 'error', {
        conversationId: started.convId,
        message: result.ended,
        replyToMessageId: started.messageId,
      });
    }
  }

  private async executeGithubDigestOne(
    runId: string,
    started: {
      toPlan: RunToPlan;
      convId: string;
      messageId: string;
      recurrence: ScheduleRecurrence;
      digestConfig: GithubDigestConfig | null;
      digestConfigHash: string | null;
    },
  ): Promise<void> {
    const { pool } = this.options;
    const controller = new AbortController();
    this.current = controller;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.planTimeoutMs);

    let outcome: GithubDigestRunOutcome | null = null;
    let failure: string | null = null;
    try {
      const githubRunner = (this.options.runGithubDigest ?? this.options.runDigest) as RunGithubDigest | undefined;
      if (!githubRunner) throw new Error('Chưa nối digest runner');
      const aborted = new Promise<never>((_, reject) =>
        controller.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }),
      );
      outcome = await Promise.race([
        githubRunner(
          {
            ...started.toPlan,
            recurrence: started.recurrence,
            digestConfig: started.digestConfig,
            digestConfigHash: started.digestConfigHash,
          },
          started.convId,
          controller.signal,
        ),
        aborted,
      ]);
    } catch (error) {
      failure = timedOut ? TIMED_OUT : this.stopping ? STOPPED : 'Không gửi được bản tin lúc này. Hãy thử lại.';
      if (!timedOut && !this.stopping) {
        console.error('[schedules] running digest failed:', error instanceof Error ? error.message : error);
      }
    } finally {
      clearTimeout(timer);
      this.current = null;
    }

    const now = this.now();
    const committed = await inTransaction(pool, async (client) => {
      // Lock schedule's conversation together with schedule to preserve canonical lock order
      const schedRes = await client.query(
        'SELECT s.* FROM schedules s JOIN conversations c ON c.id = s.conv_id WHERE s.id = $1 FOR UPDATE OF c, s',
        [started.toPlan.scheduleId],
      );
      const schedule = schedRes.rows[0] as ScheduleRow | undefined;
      const run = (await client.query('SELECT status FROM schedule_runs WHERE id = $1 FOR UPDATE', [runId])).rows[0];
      if (!schedule || run?.status !== 'planning') return null;

      const replyTo = { replyToMessageId: started.messageId };
      const changes: ScheduleChange[] = [];

      if (failure && this.stopping) {
        await this.messages.createMessage(started.convId, 'system', `Lỗi: ${STOPPED}`, { type: 'planning_error', ...replyTo }, client);
        await client.query("UPDATE schedule_runs SET status='interrupted', error=$2, updated_at=now() WHERE id=$1", [runId, STOPPED]);
        return { kind: 'error' as const, error: STOPPED, changes };
      }

      if (outcome?.state === 'discarded') {
        await this.messages.createMessage(started.convId, 'system', DISCARDED, { type: 'schedule_discarded', ...replyTo }, client);
        await client.query("UPDATE schedule_runs SET status='discarded', updated_at=now() WHERE id=$1", [runId]);
        return { kind: 'error' as const, error: DISCARDED, changes };
      }

      if (outcome?.state === 'blocked') {
        await this.messages.createMessage(started.convId, 'system', `Lỗi: ${outcome.error}`, { type: 'planning_error', ...replyTo }, client);
        await client.query("UPDATE schedule_runs SET status='blocked', error=$2, updated_at=now() WHERE id=$1", [runId, outcome.error]);
        if (schedule.status === 'active') {
          const paused = await this.pause(client, schedule.id, outcome.pauseReason);
          changes.push(await this.options.recordState(client, paused, now));
        }
        return { kind: 'error' as const, error: outcome.error, changes };
      }

      if (outcome?.state === 'digest_sent') {
        await this.messages.createMessage(
          started.convId,
          'assistant',
          outcome.text,
          { type: 'answer', lookups: [], usedDirectory: [], ...replyTo },
          client,
        );
        await client.query(
          "UPDATE schedule_runs SET status='digest_sent', delivery=$2, updated_at=now() WHERE id=$1",
          [runId, JSON.stringify(outcome.delivery)],
        );
        return { kind: 'sent' as const, text: outcome.text, changes };
      }

      const errText = outcome?.state === 'digest_failed' ? outcome.error : failure ?? 'Không gửi được bản tin lúc này. Hãy thử lại.';
      await this.messages.createMessage(started.convId, 'system', `Lỗi: ${errText}`, { type: 'planning_error', ...replyTo }, client);
      await client.query("UPDATE schedule_runs SET status='digest_failed', error=$2, updated_at=now() WHERE id=$1", [runId, errText]);

      const recentRuns = await client.query(
        'SELECT status FROM schedule_runs WHERE schedule_id = $1 ORDER BY created_at DESC, id DESC LIMIT 3',
        [schedule.id],
      );
      if (
        schedule.status === 'active' &&
        recentRuns.rows.length === 3 &&
        recentRuns.rows.every((r: { status: string }) => r.status === 'digest_failed')
      ) {
        const paused = await this.pause(client, schedule.id, GITHUB_DIGEST_FAILED_3X);
        changes.push(await this.options.recordState(client, paused, now));
      }
      return { kind: 'error' as const, error: errText, changes };
    });

    if (!committed) return;
    this.announce(committed.changes);
    if (committed.kind === 'sent') {
      this.send(started.convId, 'answer', {
        conversationId: started.convId,
        text: committed.text,
        lookups: [],
        usedDirectory: [],
        replyToMessageId: started.messageId,
      });
      this.send(started.convId, 'agent_state', {
        conversationId: started.convId,
        state: 'idle',
        replyToMessageId: started.messageId,
      });
    } else {
      this.send(started.convId, 'error', {
        conversationId: started.convId,
        message: committed.error,
        replyToMessageId: started.messageId,
      });
    }
  }

  private async executeTelegramDigestOne(
    runId: string,
    started: {
      toPlan: RunToPlan;
      convId: string;
      messageId: string;
      digestConfig: TelegramDigestConfig | null;
      digestConfigHash: string | null;
    },
  ): Promise<void> {
    const { pool } = this.options;
    const now = this.now();
    const controller = new AbortController();
    this.current = controller;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.planTimeoutMs);

    let outcome: DigestRunOutcome;
    try {
      const aborted = new Promise<never>((_, reject) =>
        controller.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }),
      );
      outcome = await Promise.race([
        this.options.executeDigestRun!(
          {
            ...started.toPlan,
            digestConfig: started.digestConfig,
            digestConfigHash: started.digestConfigHash,
          },
          controller.signal,
        ),
        aborted,
      ]);
    } catch {
      outcome = {
        status: 'digest_failed',
        error: timedOut ? TIMED_OUT : this.stopping ? STOPPED : 'Không gửi được báo cáo tự động lúc này.',
      };
    } finally {
      clearTimeout(timer);
      this.current = null;
    }

    const pauseChanges: ScheduleChange[] = [];
    const replyTo = { replyToMessageId: started.messageId };

    await inTransaction(pool, async (client) => {
      const schedule = (
        await client.query('SELECT * FROM schedules WHERE id=$1 FOR UPDATE', [started.toPlan.scheduleId])
      ).rows[0] as ScheduleRow | undefined;
      const run = (await client.query('SELECT status FROM schedule_runs WHERE id=$1 FOR UPDATE', [runId])).rows[0];
      if (!schedule || run?.status !== 'planning') return;

      // A confirmed send remains a delivery even if the member changes the schedule
      // after dispatch. Only results that did not send may be discarded.
      if (outcome.status === 'discarded' || (outcome.status !== 'digest_sent' && (
        schedule.version !== started.toPlan.scheduleVersion ||
        schedule.status === 'cancelled' || schedule.status === 'paused'
      ))) {
        await this.messages.createMessage(
          started.convId,
          'system',
          DISCARDED,
          { type: 'schedule_discarded', ...replyTo },
          client,
        );
        await client.query("UPDATE schedule_runs SET status='discarded', updated_at=now() WHERE id=$1", [runId]);
        return;
      }

      if (outcome.status === 'digest_sent') {
        await this.messages.createMessage(
          started.convId,
          'assistant',
          outcome.digestText,
          { type: 'schedule_digest_sent', delivery: outcome.delivery, ...replyTo },
          client,
        );
        await client.query(
          "UPDATE schedule_runs SET status='digest_sent', delivery=$2, updated_at=now() WHERE id=$1",
          [runId, JSON.stringify(outcome.delivery)],
        );
      } else {
        await this.messages.createMessage(
          started.convId,
          'system',
          `Lỗi: ${outcome.error}`,
          { type: 'planning_error', ...replyTo },
          client,
        );
        await client.query(
          "UPDATE schedule_runs SET status='digest_failed', error=$2, updated_at=now() WHERE id=$1",
          [runId, outcome.error],
        );
        const shouldPause =
          outcome.pauseSchedule === true ||
          (await this.lastThreeDigestFailed(client, started.toPlan.scheduleId));
        if (shouldPause && schedule.status === 'active') {
          const reason = outcome.pauseSchedule
            ? outcome.error
            : '3 lượt gửi báo cáo tự động liên tiếp thất bại';
          const pausedRow = await this.pause(client, schedule.id, reason);
          pauseChanges.push(await this.options.recordState(client, pausedRow, now));
        }
      }
    });

    this.announce(pauseChanges);
  }
}
