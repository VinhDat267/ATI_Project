import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database } from "@wap/db";
import {
  assertPilotAccess,
  readSheetsRequest,
  PILOT_TOOL_CATALOG,
  executePilotWorkflow,
  PostgresReservationStore,
  PilotCreateRunBodySchema,
  PilotApproveBodySchema,
  PilotRunAcceptedResponseSchema,
  PilotRunDetailResponseSchema,
  PilotCatalogResponseSchema,
  type PilotConfig,
  type PilotPolicy,
  type ReadSheetsRequestResult,
  type SourceRow,
  type PilotToolEntry,
} from "@wap/engine";
import { HttpError, readJson, writeJson } from "./http.js";
import type { SessionAuthority } from "./auth.js";
import { sessionCredential } from "./http-auth.js";
import type { WorkerControl } from "./worker.js";
import { buildPilotApproval, pilotPreview } from "./pilot-approval.js";

export interface PilotRouterOptions {
  db: Database;
  sessions: SessionAuthority;
  worker?: WorkerControl;
  pilotConfig?: PilotConfig;
  pilotPolicy?: PilotPolicy;
  liveWriteEnabled?: boolean;
  /** Injectable intake reader for tests or offline execution */
  readSheetsRequestFn?: (params: {
    config: PilotConfig;
    policy: PilotPolicy;
    principalId: string;
    spreadsheetId: string;
    tabId: string;
    requestId: string;
  }) => Promise<ReadSheetsRequestResult>;
}

// Pilot dispatch is deliberately non-retryable. Expired pending approvals and
// abandoned dispatches are closed conservatively before admitting another run.
async function sweepPilotLifecycle(tx: any): Promise<void> {
  const expired = await tx`
    SELECT r.id FROM runs r JOIN pilot_approvals a ON a.run_id = r.id
    WHERE r.profile = 'pilot-v2' AND r.status = 'awaiting_approval'
      AND a.decision = 'pending' AND a.expires_at <= clock_timestamp()
    FOR UPDATE OF r, a
  `;
  for (const row of expired) {
    await tx`UPDATE pilot_approvals SET decision = 'expired', decided_at = clock_timestamp()
      WHERE run_id = ${row.id} AND decision = 'pending'`;
    await setPilotRunStatus(tx, row.id, "expired", "awaiting_approval");
  }

  const orphaned = await tx`
    SELECT r.id FROM runs r JOIN pilot_approvals a ON a.run_id = r.id
    WHERE r.profile = 'pilot-v2' AND r.status = 'running'
      AND a.decision = 'approved'
      AND a.decided_at <= clock_timestamp() - interval '15 minutes'
    FOR UPDATE OF r, a
  `;
  for (const row of orphaned) {
    await setPilotRunStatus(tx, row.id, "reconciliation_required", "running");
  }
}

async function setPilotRunStatus(
  tx: any, runId: string, status: string, previous: string,
): Promise<boolean> {
  const changed = await tx`
    UPDATE runs SET status = ${status}, next_event_seq = next_event_seq + 1
    WHERE id = ${runId} AND status = ${previous}
    RETURNING next_event_seq - 1 AS seq
  `;
  if (changed[0]) {
    await tx`
      INSERT INTO run_events(run_id, seq, type, payload)
      VALUES (${runId}, ${changed[0].seq}, 'run.status',
        ${tx.json({ status, previous })})
    `;
  }
  return Boolean(changed[0]);
}

export function createPilotRouter(options: PilotRouterOptions) {
  const { db, sessions, worker } = options;

  const policy = options.pilotPolicy;
  const config = options.pilotConfig;

  const readSheetsFn = options.readSheetsRequestFn ?? readSheetsRequest;
  const store = new PostgresReservationStore(db);

  return async function handlePilotV2Request(
    request: IncomingMessage,
    response: ServerResponse,
    path: string,
    requestId: string,
  ): Promise<void> {
    // 1. Authenticate user
    const userId = await sessions.authenticate(sessionCredential(request));

    // 2. Preliminary Policy check for pilot access
    if (
      !policy || !config || !policy.enabled || !config.enabled ||
      !policy.principals.includes(userId) || !config.principals.includes(userId) ||
      policy.spreadsheetId !== config.spreadsheetId ||
      policy.tabId !== config.tabId || policy.boardId !== config.boardId
    ) {
      throw new HttpError(403, "ACCESS_DENIED", "Principal is unauthorized for pilot");
    }

    // -------------------------------------------------------------
    // Route: GET /pilot/v2/catalog
    // -------------------------------------------------------------
    if (path === "/catalog") {
      if (request.method !== "GET") {
        response.setHeader("allow", "GET");
        throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
      }

      const catalogPayload = PilotCatalogResponseSchema.parse({
        profile: "pilot-v2",
        tools: PILOT_TOOL_CATALOG.map((t: PilotToolEntry) => ({
          name: t.name,
          description: t.description,
          sideEffect: t.sideEffect,
          policyVersion: "pilot-v2",
          inputSchema: {},
          outputSchema: {},
          allowed: true,
        })),
      });

      writeJson(response, 200, catalogPayload, requestId);
      return;
    }

    // -------------------------------------------------------------
    // Route: POST /pilot/v2/runs
    // -------------------------------------------------------------
    if (path === "/runs") {
      if (request.method !== "POST") {
        response.setHeader("allow", "POST");
        throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
      }

      const body = PilotCreateRunBodySchema.parse(await readJson(request));

      // Policy check for specific spreadsheet and tab
      assertPilotAccess(policy, userId, {
        kind: "source",
        spreadsheetId: body.spreadsheetId,
        tabId: body.tabId,
      });

      // Intake preflight: read source and evaluate checklist
      let intake: ReadSheetsRequestResult;
      try {
        intake = await readSheetsFn({
          config,
          policy,
          principalId: userId,
          spreadsheetId: body.spreadsheetId,
          tabId: body.tabId,
          requestId: body.requestId,
        });
      } catch (err: unknown) {
        throw new HttpError(400, "INTAKE_ERROR", (err as Error).message);
      }

      const runId = randomUUID();
      const workflowId = randomUUID();
      const versionId = randomUUID();

      // Branching: Check if checklist requires clarification (UC1)
      const isUnconfirmed = intake.checklist.unconfirmedBusiness;
      const isNeedsInput = intake.checklist.status === "needs_input" || isUnconfirmed;
      const initialStatus = isNeedsInput ? "needs_input" : "awaiting_approval";
      const approvalPlan = !isNeedsInput ? buildPilotApproval({
        runId, ownerId: userId, versionId, sourceKey: intake.sourceKey,
        sourceRevision: intake.sourceRevision, row: intake.row, policy,
        targetListId: config.trello?.listId,
      }) : null;

      // Enforce single active run invariant across the database
      await db.client.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(638019815)`;
        await sweepPilotLifecycle(tx);

        const active = await tx`
          SELECT 1 FROM runs
          WHERE status::text NOT IN ('succeeded','failed','rejected','cancelled','expired','refused','needs_input','reconciliation_required')
          LIMIT 1
        `;
        if (active.length > 0) {
          throw new HttpError(409, "ACTIVE_RUN", "A run is already active");
        }

        // Insert workflow
        await tx`
          INSERT INTO workflows(id, user_id, name, source_prompt)
          VALUES (${workflowId}, ${userId}, ${'Pilot: ' + body.requestId}, ${body.userPrompt})
        `;

        await tx`
          INSERT INTO workflow_versions(id, workflow_id, version_no, plan, origin)
          VALUES (${versionId}, ${workflowId}, 1,
            ${tx.json({ profile: "pilot-v2", sourceRevision: intake.sourceRevision })}, 'initial')
        `;

        // Insert run
        await tx`
          INSERT INTO runs(id, user_id, workflow_id, workflow_version_id, source_prompt, inputs, runtime, time_zone, profile, status)
          VALUES (
            ${runId},
            ${userId},
            ${workflowId},
            ${versionId},
            ${body.userPrompt},
            ${tx.json(body)},
            ${tx.json({ runId, userId, timeZone: body.timeZone })},
            ${body.timeZone},
            'pilot-v2',
            ${initialStatus}
          )
        `;

        // Insert source snapshot
        await tx`
          INSERT INTO source_snapshots(run_id, source_key, source_revision, raw_data, checklist_version, checklist_result)
          VALUES (
            ${runId},
            ${intake.sourceKey},
            ${intake.sourceRevision},
            ${tx.json(intake.row)},
            ${intake.checklist.checklistVersion},
            ${tx.json(intake.checklist)}
          )
        `;

        if (approvalPlan) {
          await tx`
            INSERT INTO pilot_approvals(run_id, owner_id, version_id, snapshot_hash, expires_at)
            SELECT ${runId}, ${userId}, ${versionId}, ${approvalPlan.snapshotHash},
                   created_at + interval '10 minutes'
            FROM runs WHERE id = ${runId}
          `;
        }

        // Emit run.status event
        await tx`
          INSERT INTO run_events(run_id, seq, type, payload)
          VALUES (
            ${runId},
            1,
            'run.status',
            ${tx.json({ status: initialStatus, previous: null })}
          )
        `;
        await tx`UPDATE runs SET next_event_seq = 2 WHERE id = ${runId}`;
      });

      if (!isNeedsInput) {
        worker?.wake();
      }

      const responsePayload = PilotRunAcceptedResponseSchema.parse({
        runId,
        status: "planning",
        profile: "pilot-v2",
        sourceKey: intake.sourceKey,
        sourceRevision: intake.sourceRevision,
      });

      writeJson(response, 202, responsePayload, requestId);
      return;
    }

    // -------------------------------------------------------------
    // Route: GET /pilot/v2/runs/:runId
    // -------------------------------------------------------------
    if (path.startsWith("/runs/") && !path.includes("/approve")) {
      if (request.method !== "GET") {
        response.setHeader("allow", "GET");
        throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
      }

      const runId = path.slice("/runs/".length);
      z.string().uuid().parse(runId);

      await db.client.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(638019815)`;
        await sweepPilotLifecycle(tx);
      });

      // Enforce strict ownership: WHERE id = runId AND user_id = userId
      const runRows = await db.client<
        Array<{
          id: string;
          user_id: string;
          profile: string;
           status: string;
           created_at: Date;
           workflow_version_id: string;
        }>
      >`
        SELECT id, user_id, profile, status, created_at, workflow_version_id
        FROM runs
        WHERE id = ${runId} AND user_id = ${userId}
        LIMIT 1
      `;

      if (!runRows[0]) {
        throw new HttpError(404, "NOT_FOUND", "Run not found");
      }

      const run = runRows[0];

      // Query source snapshot
      const snapshotRows = await db.client<
        Array<{
          source_key: string;
          source_revision: string;
          raw_data: Record<string, string>;
          checklist_result: {
            valid: boolean;
            unconfirmedBusiness: boolean;
            missingFields: string[];
            evidences?: Record<string, string>;
          };
        }>
      >`
        SELECT source_key, source_revision, raw_data, checklist_result
        FROM source_snapshots
        WHERE run_id = ${runId}
        LIMIT 1
      `;

      const snapshot = snapshotRows[0] ?? {
        source_key: "unknown",
        source_revision: "0".repeat(64),
        raw_data: {},
        checklist_result: { valid: false, unconfirmedBusiness: false, missingFields: [] },
      };

      const rawChecklist = (snapshot.checklist_result ?? {}) as Record<string, any>;
      const normalizedChecklist = {
        valid: rawChecklist.status === "pass" || Boolean(rawChecklist.valid),
        unconfirmedBusiness: Boolean(rawChecklist.unconfirmedBusiness),
        missingFields: Array.isArray(rawChecklist.missingFields)
          ? rawChecklist.missingFields
          : [],
        evidences: (rawChecklist.evidencePositions ?? rawChecklist.evidences) as
          | Record<string, string>
          | undefined,
      };

      // Query reservation/receipt if available
      const reservation = await store.getReservation(snapshot.source_key);
      let preview = null;
      if (run.status === "awaiting_approval") {
        if (!snapshotRows[0]) {
          throw new HttpError(409, "MISSING_SNAPSHOT", "Source snapshot missing for run");
        }
        const approvalRows = await db.client<Array<{
          id: string;
          version_id: string;
          snapshot_hash: string;
          decision: string;
          expires_at: Date;
        }>>`
          SELECT id, version_id, snapshot_hash, decision, expires_at
          FROM pilot_approvals
          WHERE run_id = ${runId} AND owner_id = ${userId}
          LIMIT 1
        `;
        const approval = approvalRows[0];
        if (!approval || approval.decision !== "pending") {
          throw new HttpError(409, "APPROVAL_NOT_PENDING", "Pilot approval is unavailable");
        }
        if (approval.version_id !== run.workflow_version_id) {
          throw new HttpError(409, "VERSION_MISMATCH", "Pilot workflow version changed");
        }
        const plan = buildPilotApproval({
          runId, ownerId: userId, versionId: approval.version_id, sourceKey: snapshot.source_key,
          sourceRevision: snapshot.source_revision,
          row: snapshot.raw_data as SourceRow, policy,
          targetListId: config.trello?.listId,
        });
        if (plan.snapshotHash !== approval.snapshot_hash) {
          throw new HttpError(409, "SNAPSHOT_MISMATCH", "Pilot preview changed");
        }
        preview = pilotPreview(
          plan, approval.id, approval.version_id, new Date(approval.expires_at),
          normalizedChecklist.unconfirmedBusiness, normalizedChecklist.missingFields,
        );
      }

      const detailPayload = PilotRunDetailResponseSchema.parse({
        id: run.id,
        userId: run.user_id,
        profile: "pilot-v2",
        status: run.status,
        sourceKey: snapshot.source_key,
        sourceRevision: snapshot.source_revision,
        checklistResult: normalizedChecklist,
        preview,
        receipt: run.status === "succeeded" && reservation?.status === "confirmed" &&
          reservation.remoteId && reservation.remoteUrl && reservation.remoteListId
          ? {
              cardId: reservation.remoteId,
              url: reservation.remoteUrl,
              listId: reservation.remoteListId,
              boardId: policy.boardId,
              title: snapshot.raw_data?.deliverable || "Task",
              intentKey: reservation.intentKey,
            }
          : null,
        createdAt: new Date(run.created_at).toISOString(),
      });

      writeJson(response, 200, detailPayload, requestId);
      return;
    }

    // -------------------------------------------------------------
    // Route: POST /pilot/v2/runs/:runId/approve
    // -------------------------------------------------------------
    if (path.startsWith("/runs/") && path.endsWith("/approve")) {
      if (request.method !== "POST") {
        response.setHeader("allow", "POST");
        throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
      }

      const runId = path.slice("/runs/".length, -"/approve".length);
      z.string().uuid().parse(runId);

      const body = PilotApproveBodySchema.parse(await readJson(request));

      const claim = await db.client.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(638019815)`;
        const runRows = await tx<Array<{ id: string; status: string; profile: string; workflow_version_id: string }>>`
          SELECT id, status, profile, workflow_version_id FROM runs
          WHERE id = ${runId} AND user_id = ${userId}
          FOR UPDATE
        `;
        const run = runRows[0];
        if (!run || run.profile !== "pilot-v2") {
          throw new HttpError(404, "NOT_FOUND", "Run not found");
        }
        if (run.status !== "awaiting_approval") {
          throw new HttpError(409, "INVALID_RUN_STATE", `Run is not awaiting approval (current: ${run.status})`);
        }
        const approvalRows = await tx<Array<{
          id: string;
          version_id: string;
          snapshot_hash: string;
          decision: string;
          expires_at: Date;
          live: boolean;
        }>>`
          SELECT id, version_id, snapshot_hash, decision, expires_at,
                 expires_at > clock_timestamp() AS live
          FROM pilot_approvals
          WHERE run_id = ${runId} AND owner_id = ${userId}
          FOR UPDATE
        `;
        const approval = approvalRows[0];
        if (!approval || approval.decision !== "pending") {
          throw new HttpError(409, "APPROVAL_NOT_PENDING", "Pilot approval is unavailable");
        }

        if (!approval.live) {
          await tx`
            UPDATE pilot_approvals SET decision = 'expired', decided_at = clock_timestamp()
            WHERE run_id = ${runId} AND decision = 'pending'
          `;
          await setPilotRunStatus(tx, runId, "expired", "awaiting_approval");
          return { kind: "expired" } as const;
        }
        if (body.decision === "approved" && !options.liveWriteEnabled) {
          throw new HttpError(503, "LIVE_WRITE_BLOCKED", "Pilot live writes are disabled");
        }
        if (body.decision === "approved" && !config.trello?.listId) {
          throw new HttpError(503, "TARGET_NOT_BOUND", "Pilot Trello list ID is not configured");
        }
        if (body.approvalId !== approval.id || body.versionId !== approval.version_id ||
            run.workflow_version_id !== approval.version_id) {
          throw new HttpError(409, "VERSION_MISMATCH", "Pilot approval or workflow version changed");
        }

        const snapshotRows = await tx<Array<{
          source_key: string;
          source_revision: string;
          raw_data: SourceRow;
        }>>`
          SELECT source_key, source_revision, raw_data FROM source_snapshots
          WHERE run_id = ${runId} FOR UPDATE
        `;
        const snapshot = snapshotRows[0];
        if (!snapshot) {
          throw new HttpError(409, "MISSING_SNAPSHOT", "Source snapshot missing for run");
        }
        const plan = buildPilotApproval({
          runId, ownerId: userId, versionId: approval.version_id, sourceKey: snapshot.source_key,
          sourceRevision: snapshot.source_revision, row: snapshot.raw_data, policy,
          targetListId: config.trello?.listId,
        });
        if (plan.snapshotHash !== approval.snapshot_hash || body.snapshotHash !== approval.snapshot_hash) {
          throw new HttpError(409, "SNAPSHOT_MISMATCH", "Pilot preview changed or approval hash differs");
        }

        if (body.decision === "rejected") {
          await tx`
            UPDATE pilot_approvals SET decision = 'rejected', decided_at = clock_timestamp()
            WHERE run_id = ${runId} AND decision = 'pending'
          `;
          await setPilotRunStatus(tx, runId, "rejected", "awaiting_approval");
          return { kind: "rejected" } as const;
        }

        await tx`
          UPDATE pilot_approvals SET decision = 'approved', decided_at = clock_timestamp()
          WHERE run_id = ${runId} AND decision = 'pending'
        `;
        // Commit the approval and non-retryable run state before any remote write.
        await setPilotRunStatus(tx, runId, "running", "awaiting_approval");
        return {
          kind: "approved", plan, sourceKey: snapshot.source_key,
          expiresAt: new Date(approval.expires_at),
        } as const;
      });

      if (claim.kind === "expired") {
        throw new HttpError(409, "APPROVAL_EXPIRED", "Pilot approval expired");
      }
      if (claim.kind === "rejected") {
        writeJson(response, 200, { status: "rejected" }, requestId);
        return;
      }

      let dispatchResult;
      try {
        dispatchResult = await executePilotWorkflow({
          runId, principalId: userId, config, policy, store,
          approval: {
            ownerId: userId, decision: "approved",
            snapshotHash: claim.plan.snapshotHash, expiresAt: claim.expiresAt,
          },
          expectedHash: claim.plan.snapshotHash,
          cardTitle: claim.plan.cardTitle,
          description: claim.plan.description,
          dueDate: claim.plan.dueDate,
          listName: claim.plan.listName,
          listId: claim.plan.listId,
          intentKey: claim.sourceKey,
          sourceKey: claim.sourceKey,
        });
      } catch {
        await db.client.begin(async (tx) => {
          await tx`SELECT id FROM runs WHERE id = ${runId} AND user_id = ${userId} FOR UPDATE`;
          await setPilotRunStatus(tx, runId, "reconciliation_required", "running");
        });
        throw new HttpError(503, "DISPATCH_UNCERTAIN", "Pilot dispatch requires reconciliation");
      }

      const transitioned = await db.client.begin(async (tx) => {
        await tx`SELECT id FROM runs WHERE id = ${runId} AND user_id = ${userId} FOR UPDATE`;
        return setPilotRunStatus(tx, runId, dispatchResult.status, "running");
      });
      if (!transitioned) {
        throw new HttpError(503, "DISPATCH_UNCERTAIN", "Run changed during dispatch; reconcile before continuing");
      }
      writeJson(response, 200, dispatchResult, requestId);
      return;
    }

    throw new HttpError(404, "NOT_FOUND", "Route not found");
  };
}
