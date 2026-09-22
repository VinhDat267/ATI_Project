import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DEMO_USER_ID, type Database } from "@wap/db";
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

export interface PilotRouterOptions {
  db: Database;
  sessions: SessionAuthority;
  worker?: WorkerControl;
  pilotConfig?: PilotConfig;
  pilotPolicy?: PilotPolicy;
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

export function createPilotRouter(options: PilotRouterOptions) {
  const { db, sessions, worker } = options;

  const policy: PilotPolicy = options.pilotPolicy ?? {
    enabled: true,
    principals: ["operator-a", "operator-b", DEMO_USER_ID],
    spreadsheetId: "sheet-pilot-v2",
    tabId: "requests",
    boardId: "board-pilot-v2",
  };

  const config: PilotConfig = options.pilotConfig ?? {
    enabled: true,
    principals: policy.principals,
    spreadsheetId: policy.spreadsheetId,
    tabId: policy.tabId,
    boardId: policy.boardId,
    google: { apiKey: "mock-google-key" },
    trello: { apiKey: "mock-trello-key", apiToken: "mock-trello-token" },
  };

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
    if (!policy.enabled || !policy.principals.includes(userId)) {
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

      // Branching: Check if checklist requires clarification (UC1)
      const isUnconfirmed = intake.checklist.unconfirmedBusiness;
      const isNeedsInput = intake.checklist.status === "needs_input" || isUnconfirmed;
      const initialStatus = isNeedsInput ? "needs_input" : "awaiting_approval";

      // Enforce single active run invariant across the database
      await db.client.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(638019815)`;

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

        // Insert run
        await tx`
          INSERT INTO runs(id, user_id, workflow_id, source_prompt, inputs, runtime, time_zone, profile, status)
          VALUES (
            ${runId},
            ${userId},
            ${workflowId},
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

        // Emit run.status event
        await tx`
          INSERT INTO run_events(id, run_id, seq, event_type, payload, correlation_id)
          VALUES (
            ${randomUUID()},
            ${runId},
            1,
            'run.status',
            ${tx.json({ status: initialStatus, previous: null })},
            'pilot-intake'
          )
        `;
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

      // Enforce strict ownership: WHERE id = runId AND user_id = userId
      const runRows = await db.client<
        Array<{
          id: string;
          user_id: string;
          profile: string;
          status: string;
          created_at: Date;
        }>
      >`
        SELECT id, user_id, profile, status, created_at
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
      const expiresAt = new Date(new Date(run.created_at).getTime() + 10 * 60 * 1000);

      const detailPayload = PilotRunDetailResponseSchema.parse({
        id: run.id,
        userId: run.user_id,
        profile: "pilot-v2",
        status: run.status,
        sourceKey: snapshot.source_key,
        sourceRevision: snapshot.source_revision,
        checklistResult: normalizedChecklist,
        preview: run.status === "awaiting_approval"
          ? {
              snapshotHash: snapshot.source_revision,
              expiresAt: expiresAt.toISOString(),
              actions: [
                {
                  tool: "trello.create_card",
                  args: {
                    boardId: policy.boardId,
                    listName: "To Do",
                    title: snapshot.raw_data?.deliverable || "New Task",
                    desc: snapshot.raw_data?.raw_request || undefined,
                    due: snapshot.raw_data?.due_date || undefined,
                  },
                  sideEffect: "write",
                },
              ],
              unconfirmedBusiness: normalizedChecklist.unconfirmedBusiness,
              missingFields: normalizedChecklist.missingFields,
            }
          : null,
        receipt: reservation?.status === "confirmed" && reservation.remoteId && reservation.remoteUrl
          ? {
              cardId: reservation.remoteId,
              url: reservation.remoteUrl,
              listId: "confirmed-list",
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

      // Query run with strict ownership
      const runRows = await db.client<
        Array<{
          id: string;
          user_id: string;
          status: string;
          created_at: Date | string;
        }>
      >`
        SELECT id, user_id, status, created_at
        FROM runs
        WHERE id = ${runId} AND user_id = ${userId}
        LIMIT 1
      `;

      if (!runRows[0]) {
        throw new HttpError(404, "NOT_FOUND", "Run not found");
      }

      const run = runRows[0];
      if (run.status !== "awaiting_approval") {
        throw new HttpError(409, "INVALID_RUN_STATE", `Run is not awaiting approval (current: ${run.status})`);
      }

      // Query snapshot
      const snapshotRows = await db.client<
        Array<{
          source_key: string;
          source_revision: string;
          raw_data: SourceRow;
        }>
      >`
        SELECT source_key, source_revision, raw_data
        FROM source_snapshots
        WHERE run_id = ${runId}
        LIMIT 1
      `;

      if (!snapshotRows[0]) {
        throw new HttpError(400, "MISSING_SNAPSHOT", "Source snapshot missing for run");
      }

      const snapshot = snapshotRows[0];

      if (body.decision === "rejected") {
        await db.client`UPDATE runs SET status = 'rejected' WHERE id = ${runId}`;
        writeJson(response, 200, { status: "rejected" }, requestId);
        return;
      }

      const expiresAt = new Date(new Date(run.created_at).getTime() + 10 * 60 * 1000);

      // Execute Pilot Workflow with durable dispatch
      const dispatchResult = await executePilotWorkflow({
        runId,
        principalId: userId,
        config,
        policy,
        store,
        approval: {
          ownerId: userId,
          decision: "approved",
          snapshotHash: body.snapshotHash,
          expiresAt, // 10 min TTL from creation
        },
        expectedHash: snapshot.source_revision,
        cardTitle: snapshot.raw_data?.deliverable || "New Card",
        description: snapshot.raw_data?.raw_request || snapshot.raw_data?.deliverable,
        dueDate: snapshot.raw_data?.due_date,
        listName: "To Do",
        intentKey: snapshot.source_key,
        sourceKey: snapshot.source_key,
      });

      if (dispatchResult.status === "succeeded") {
        await db.client`UPDATE runs SET status = 'succeeded' WHERE id = ${runId}`;
      } else if (dispatchResult.status === "reconciliation_required") {
        await db.client`UPDATE runs SET status = 'reconciliation_required' WHERE id = ${runId}`;
      } else if (dispatchResult.status === "failed") {
        await db.client`UPDATE runs SET status = 'failed' WHERE id = ${runId}`;
      } else if (dispatchResult.status === "expired") {
        await db.client`UPDATE runs SET status = 'expired' WHERE id = ${runId}`;
      }

      writeJson(response, 200, dispatchResult, requestId);
      return;
    }

    throw new HttpError(404, "NOT_FOUND", "Route not found");
  };
}
