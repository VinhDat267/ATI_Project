import type postgres from "postgres";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database } from "@wap/db";
import {
  RunEventSchema,
  RunDetailSchema,
  TraceSchema,
  EventPageSchema,
  TERMINAL_STATUSES,
  type RunStatus,
  type RunEventType,
} from "@wap/dsl";
import { EngineError, json, unpackPreview, type Snapshot } from "./snapshot.js";
export type Tx = postgres.TransactionSql;
export interface RunRow extends postgres.Row {
  id: string;
  user_id: string;
  workflow_id: string;
  workflow_version_id: string | null;
  source_prompt: string;
  planner_result: unknown | null;
  status: RunStatus;
  inputs: Record<string, string | number | boolean>;
  runtime: Record<string, string>;
  time_zone: string;
  claimed_by: string | null;
  cancel_requested_at: Date | null;
  created_at: Date;
  started_at: Date | null;
  next_event_seq: number;
}
export interface ApprovalRow extends postgres.Row {
  id: string;
  run_id: string;
  workflow_version_id: string;
  snapshot_hash: string;
  preview: unknown;
  decision: string;
  expires_at: Date;
  live: boolean;
}
const stamp = (d: Date | string) => new Date(d).toISOString();
export class Store {
  private lease: { pid: number; lost: boolean } | undefined;
  private workerActive = false;
  readonly workerId = randomUUID();
  constructor(
    readonly db: Database,
    readonly userId: string,
  ) {
    z.uuid().parse(userId);
  }
  async run(sql: postgres.Sql | Tx, id: string, lock = false): Promise<RunRow> {
    z.uuid().parse(id);
    const rows = lock
      ? await sql<
          RunRow[]
        >`SELECT * FROM runs WHERE id=${id} AND user_id=${this.userId} FOR UPDATE`
      : await sql<
          RunRow[]
        >`SELECT * FROM runs WHERE id=${id} AND user_id=${this.userId}`;
    if (!rows[0])
      throw new EngineError("NOT_FOUND", "Run not found for this principal");
    return rows[0];
  }
  async approval(
    sql: postgres.Sql | Tx,
    id: string,
    lock = false,
  ): Promise<ApprovalRow | undefined> {
    const rows = lock
      ? await sql<
          ApprovalRow[]
        >`SELECT *,expires_at>clock_timestamp() AS live FROM approvals WHERE run_id=${id} ORDER BY created_at DESC LIMIT 1 FOR UPDATE`
      : await sql<
          ApprovalRow[]
        >`SELECT *,expires_at>clock_timestamp() AS live FROM approvals WHERE run_id=${id} ORDER BY created_at DESC LIMIT 1`;
    return rows[0];
  }
  async emit(
    tx: Tx,
    id: string,
    type: RunEventType,
    payload: unknown,
    jobKind?: "prepare" | "execute",
  ) {
    await this.run(tx, id, true);
    if (
      (
        await tx`SELECT 1 FROM run_events WHERE run_id=${id} AND type='run.finished' LIMIT 1`
      ).length
    )
      throw new EngineError("CONFLICT", "No events may follow run.finished");
    const [next] =
      await tx`UPDATE runs SET next_event_seq=next_event_seq+1 WHERE id=${id} RETURNING next_event_seq-1 AS seq`;
    const event = RunEventSchema.parse({
      seq: next!.seq,
      created_at: new Date().toISOString(),
      type,
      payload,
    });
    await tx`INSERT INTO run_events(run_id,seq,type,payload,created_at) VALUES (${id},${event.seq},${type},${tx.json(json(event.payload))},${event.created_at})`;
    if (jobKind)
      await tx`INSERT INTO run_outbox(run_id,event_seq,job_kind,payload) VALUES (${id},${event.seq},${jobKind},${tx.json({ run_id: id })})`;
  }
  async transition(
    tx: Tx,
    run: RunRow,
    status: RunStatus,
    options: {
      error?: string;
      outputs?: unknown;
      job?: "prepare" | "execute";
    } = {},
  ) {
    if (TERMINAL_STATUSES.includes(run.status))
      throw new EngineError("CONFLICT", "Terminal runs cannot change status");
    const terminal = TERMINAL_STATUSES.includes(status);
    await tx`UPDATE runs SET status=${status},error_message=${options.error ?? null},ended_at=${terminal ? new Date() : null} WHERE id=${run.id}`;
    await this.emit(
      tx,
      run.id,
      "run.status",
      { status, previous: run.status },
      options.job,
    );
    run.status = status;
    if (terminal)
      await this.emit(tx, run.id, "run.finished", {
        status,
        duration_ms: Math.max(
          0,
          Date.now() - new Date(run.started_at ?? run.created_at).getTime(),
        ),
        error_message: options.error ?? null,
        outputs: options.outputs ?? {},
      });
  }
  async closeOpenAttempts(
    tx: Tx,
    id: string,
    message: string,
    writeCertainty: "unknown" | "before_dispatch" = "unknown",
  ) {
    await tx`UPDATE step_attempts SET ended_at=now(),outcome_certainty=CASE WHEN operation_id IS NULL THEN 'known_not_applied' ELSE ${writeCertainty} END,error_class='fatal',error_message=${message} WHERE ended_at IS NULL AND step_state_id IN (SELECT id FROM step_states WHERE run_id=${id})`;
    await tx`UPDATE step_states SET status='failed',ended_at=now(),last_error_class='fatal',last_error=${message} WHERE run_id=${id} AND status='running'`;
  }
  async assertWorker(sql: postgres.Sql | Tx = this.db.client) {
    if (!this.lease || this.lease.lost)
      throw new EngineError("LEASE_LOST", "Worker lease is no longer held");
    const rows =
      await sql`SELECT 1 FROM pg_locks WHERE locktype='advisory' AND pid=${this.lease.pid} AND objid=638019814 AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND granted`;
    if (!rows.length) {
      this.lease.lost = true;
      throw new EngineError(
        "LEASE_LOST",
        "Worker lease disconnected before dispatch",
      );
    }
  }
  async withWorker<T>(
    fn: () => Promise<T>,
    onLost?: () => Promise<void>,
  ): Promise<T> {
    if (this.workerActive)
      throw new EngineError("BUSY", "This worker is already active");
    this.workerActive = true;
    let active = false,
      lossAction: Promise<void> | undefined;
    const session = this.db.createWorkerClient(() => {
      if (active && this.lease) {
        this.lease.lost = true;
        lossAction = onLost?.().catch(() => {});
      }
    });
    try {
      const [row] =
        await session`SELECT pg_backend_pid() AS pid,pg_try_advisory_lock(638019814) AS acquired`;
      if (!row!.acquired)
        throw new EngineError("BUSY", "The local worker is already active");
      this.lease = { pid: row!.pid, lost: false };
      active = true;
      return await fn();
    } finally {
      active = false;
      try {
        if (this.lease && !this.lease.lost)
          await session`SELECT CASE WHEN pg_backend_pid()=${this.lease.pid} THEN pg_advisory_unlock(638019814) ELSE false END`;
      } catch {
        // A disconnect releases the old session lock; never unlock a reconnected pooled lease.
      } finally {
        await session.end({ timeout: 5 });
        await lossAction;
        this.lease = undefined;
        this.workerActive = false;
      }
    }
  }
  async detail(id: string) {
    return this.db.client.begin(async (tx) => {
      const run = await this.run(tx, id, true);
      const approval = await this.approval(tx, id);
      const version = run.workflow_version_id
        ? (
            await tx`SELECT plan FROM workflow_versions WHERE id=${run.workflow_version_id}`
          )[0]
        : undefined;
      return RunDetailSchema.parse({
        run_id: id,
        status: run.status,
        workflow_version_id: run.workflow_version_id,
        plan: version?.plan ?? null,
        planner_result: run.planner_result ?? null,
        time_zone: run.time_zone,
        runtime: run.runtime,
        last_seq: run.next_event_seq - 1,
        approval: approval
          ? {
              id: approval.id,
              run_id: id,
              workflow_version_id: approval.workflow_version_id,
              snapshot_hash: approval.snapshot_hash,
              decision: approval.decision,
              expires_at: stamp(approval.expires_at),
              actions: (approval.preview as Snapshot).actions,
            }
          : null,
      });
    });
  }

  async claimPrepare(id: string) {
    return this.db.client.begin(async (tx) => {
      const run = await this.run(tx, id, true);
      if (run.status !== "planning" || run.workflow_version_id !== null)
        throw new EngineError(
          "CONFLICT",
          "Run is no longer awaiting preparation",
        );
      const jobs = await tx`SELECT id FROM run_outbox
        WHERE run_id=${id} AND job_kind='prepare' AND delivered_at IS NULL
        ORDER BY id LIMIT 1 FOR UPDATE`;
      if (!jobs.length)
        throw new EngineError("CONFLICT", "Prepare job is no longer pending");
      await tx`UPDATE runs SET claimed_by=${this.workerId},claimed_at=now(),heartbeat_at=now() WHERE id=${id}`;
      return run;
    });
  }

  async markPrepareDelivered(id: string) {
    await this.db.client`
      UPDATE run_outbox SET delivered_at=COALESCE(delivered_at,now())
      WHERE run_id=${id} AND job_kind='prepare' AND delivered_at IS NULL`;
  }

  async recordPlannerResult(
    id: string,
    result: unknown,
    terminal?: "refused" | "needs_input",
  ) {
    await this.db.client.begin(async (tx) => {
      const run = await this.run(tx, id, true);
      if (run.status !== "planning")
        throw new EngineError("CONFLICT", "Run is no longer planning");
      await tx`UPDATE runs SET planner_result=${tx.json(json(result))} WHERE id=${id}`;
      if (terminal) {
        await tx`UPDATE runs SET claimed_by=NULL,claimed_at=NULL,heartbeat_at=NULL WHERE id=${id}`;
        await this.transition(tx, run, terminal, {
          error:
            terminal === "refused"
              ? "Planner refused this request"
              : "Planner needs clarification",
        });
        await tx`UPDATE run_outbox SET delivered_at=COALESCE(delivered_at,now()) WHERE run_id=${id} AND job_kind='prepare'`;
      }
    });
  }

  async failPlanning(id: string, message: string) {
    await this.db.client.begin(async (tx) => {
      const run = await this.run(tx, id, true);
      if (TERMINAL_STATUSES.includes(run.status)) return;
      await this.transition(tx, run, "failed", { error: message });
      await tx`UPDATE run_outbox SET delivered_at=COALESCE(delivered_at,now()) WHERE run_id=${id} AND job_kind='prepare'`;
    });
  }
  async preview(id: string) {
    await this.run(this.db.client, id);
    const a = await this.approval(this.db.client, id);
    if (!a) throw new EngineError("NOT_FOUND", "Run has no write preview");
    return unpackPreview(a.preview, a.snapshot_hash);
  }
  async trace(id: string) {
    await this.run(this.db.client, id);
    const rows = await this.db
      .client`SELECT a.*,s.step_id FROM step_attempts a JOIN step_states s ON s.id=a.step_state_id WHERE s.run_id=${id} ORDER BY a.started_at,a.id`;
    return TraceSchema.parse({
      run_id: id,
      next_cursor: null,
      attempts: rows.map((a) => ({
        attempt_id: a.id,
        step_id: a.step_id,
        attempt_no: a.attempt_no,
        workflow_version_id: a.workflow_version_id,
        evidence:
          a.workflow_version_id &&
          a.tool_snapshot &&
          a.resolved_args &&
          a.outcome_certainty
            ? "complete"
            : "legacy_unknown",
        tool_snapshot: a.tool_snapshot,
        operation_id: a.operation_id,
        resolved_args: a.resolved_args,
        result: a.result,
        outcome_certainty: a.outcome_certainty,
        error_class: a.error_class,
        error_message: a.error_message,
        started_at: stamp(a.started_at),
        ended_at: a.ended_at ? stamp(a.ended_at) : null,
      })),
    });
  }
  async events(id: string, since = 0) {
    z.number().int().nonnegative().parse(since);
    await this.run(this.db.client, id);
    const rows = await this.db
      .client`SELECT seq,type,payload,created_at FROM run_events WHERE run_id=${id} AND seq>${since} ORDER BY seq LIMIT 100`;
    return EventPageSchema.parse({
      events: rows.map((e) => ({ ...e, created_at: stamp(e.created_at) })),
      next_seq: rows.at(-1)?.seq ?? since,
    });
  }
}
