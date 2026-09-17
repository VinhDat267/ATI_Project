/** OpenAPI 3.1 source generator. Schemas come from the shared Zod boundary types. */
import { z } from "zod";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";
import * as dsl from "../src/index.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const definitions = {
  WorkflowPlan: dsl.WorkflowPlanSchema,
  PlannerResult: dsl.PlannerResultSchema,
  RunEvent: dsl.RunEventSchema,
  RunStatus: dsl.RunStatusSchema,
  CreateRun: dsl.CreateRunSchema,
  LoginRequest: dsl.LoginRequestSchema,
  LoginResponse: dsl.LoginResponseSchema,
  ApiError: dsl.ApiErrorSchema,
  ServerSummary: dsl.ServerSummarySchema,
  ServerCatalogTool: dsl.ServerCatalogToolSchema,
  ServerCatalogEntry: dsl.ServerCatalogEntrySchema,
  ServerCatalog: dsl.ServerCatalogSchema,
  RunAccepted: dsl.RunAcceptedSchema,
  RunDetail: dsl.RunDetailSchema,
  Approval: dsl.ApprovalSchema,
  ApprovalDecision: dsl.ApprovalDecisionSchema,
  EventPage: dsl.EventPageSchema,
  Trace: dsl.TraceSchema,
  Reconciliation: dsl.ReconciliationSchema,
};
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
function component(schema: z.ZodType, name: string): unknown {
  const result = z.toJSONSchema(schema, { io: "input" });
  delete result.$schema;
  // Zod's recursive $defs are local to its standalone document; relocate them into this component.
  function visit(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [
          k,
          k === "$ref" && typeof v === "string" && v.startsWith("#")
            ? `#/components/schemas/${name}${v.slice(1)}`
            : visit(v),
        ]),
      );
    return value;
  }
  return visit(result);
}
const json = (schema: unknown) => ({ "application/json": { schema } });
const response = (name: string, description = "OK") => ({
  description,
  content: json(ref(name)),
});
const errors = {
  "401": {
    description: "Unauthenticated",
    content: json(ref("ApiError")),
  },
  "404": {
    description: "Not found or owned by another user",
    content: json(ref("ApiError")),
  },
};
const runParameters = [
  {
    name: "runId",
    in: "path",
    required: true,
    schema: { type: "string", minLength: 1 },
  },
];
const spec = {
  openapi: "3.1.0",
  info: {
    title: "ATI Workflow Platform — B/local",
    version: "0.3.0",
    description:
      "B/local HTTP boundary through API-CATALOG: login, stable server summaries, a no-launch reviewed catalog read, and a rate-limited active reviewed-preset check, plus durable run lifecycle, polling, trace cursors, and read-only reconciliation. GET /servers/catalog never launches MCP; POST /servers/check is the explicit active check. Session state remains in memory, and LLM/retrieval/replan, BullMQ, and browser integration remain outside this technical boundary. Shared schema generation does not encode every Zod refinement or runtime authorization rule.",
  },
  servers: [{ url: "/api/v1" }],
  security: [{ bearerAuth: [] }],
  paths: {
    "/runs/{runId}/trace": {
      parameters: runParameters,
      get: {
        operationId: "getRunTrace",
        parameters: [
          { name: "cursor", in: "query", schema: { type: "string" } },
        ],
        description:
          "Full immutable attempt snapshots, up to 100 per page. Opaque HMAC-signed next_cursor binds user/run, snapshot_id, and offset. Restart without cursor to see newer attempts. Legacy unknown metadata is explicit.",
        responses: { "200": response("Trace"), ...errors },
      },
    },
    "/auth/login": {
      post: {
        operationId: "login",
        security: [],
        summary: "Login to the single local demo account",
        requestBody: {
          required: true,
          content: json(ref("LoginRequest")),
        },
        responses: {
          "200": response("LoginResponse"),
          "400": {
            description: "Invalid request",
            content: json(ref("ApiError")),
          },
          "401": errors["401"],
          "429": {
            description: "Rate limited",
            content: json(ref("ApiError")),
          },
        },
      },
    },
    "/servers": {
      get: {
        operationId: "listServers",
        summary: "Reviewed local presets and tool discovery status",
        responses: {
          "200": {
            description: "OK",
            content: json({ type: "array", items: ref("ServerSummary") }),
          },
          ...errors,
        },
      },
    },
    "/servers/catalog": {
      get: {
        operationId: "getServerCatalog",
        summary:
          "Read the reviewed server catalog without launching connections",
        description:
          "Authenticated read-only catalog. The engine calls serverCatalog({connect:false}); it must not launch or ensure MCP connections.",
        responses: {
          "200": response("ServerCatalog"),
          "501": {
            description: "Server catalog is not enabled",
            content: json(ref("ApiError")),
          },
          ...errors,
        },
      },
    },
    "/servers/check": {
      post: {
        operationId: "checkServerCatalog",
        summary: "Actively inspect the fixed reviewed server presets",
        description:
          "Authenticated active check. The request has no launch parameters; the server invokes serverCatalog({connect:true}) against fixed reviewed presets only. Calls are rate limited per principal.",
        responses: {
          "200": response("ServerCatalog"),
          "429": {
            description: "Active check rate limited",
            headers: {
              "Retry-After": {
                description:
                  "Integer seconds until another active check is allowed",
                schema: { type: "integer", minimum: 1 },
              },
            },
            content: json(ref("ApiError")),
          },
          "501": {
            description: "Server catalog is not enabled",
            content: json(ref("ApiError")),
          },
          "503": {
            description: "Reviewed connection or configuration unavailable",
            content: json(ref("ApiError")),
          },
          ...errors,
        },
      },
    },
    "/runs": {
      post: {
        operationId: "createRun",
        summary:
          "Persist source prompt then enqueue planning; version is initially null",
        requestBody: { required: true, content: json(ref("CreateRun")) },
        responses: {
          "202": response("RunAccepted"),
          "400": { description: "Invalid request or IANA timezone" },
          ...errors,
        },
      },
      get: {
        operationId: "listRuns",
        responses: {
          "200": {
            description: "OK",
            content: json({ type: "array", items: ref("RunDetail") }),
          },
          ...errors,
        },
      },
    },
    "/runs/{runId}": {
      parameters: runParameters,
      get: {
        operationId: "getRun",
        responses: { "200": response("RunDetail"), ...errors },
      },
    },
    "/runs/{runId}/events": {
      parameters: runParameters,
      get: {
        operationId: "getRunEvents",
        parameters: [
          {
            name: "since_seq",
            in: "query",
            schema: { type: "integer", minimum: 0, default: 0 },
          },
        ],
        description:
          "Ordered seq > since_seq, capped at 200. Poll again from next_seq; dryrun.ready requires GET run for preview.",
        responses: { "200": response("EventPage"), ...errors },
      },
    },
    "/runs/{runId}/reconciliation": {
      parameters: runParameters,
      get: {
        operationId: "getRunReconciliation",
        description:
          "Read-only receipt and dispatch-marker projection for uncertain writes. This endpoint never retries or resumes an operation.",
        responses: {
          "200": response("Reconciliation"),
          "409": { description: "History or cursor limit" },
          ...errors,
        },
      },
    },
    "/runs/{runId}/approval": {
      parameters: runParameters,
      post: {
        operationId: "decideApproval",
        description:
          "Atomically compare owner, pending decision, run status, version, snapshot and expiry. Duplicate/stale decision returns 409. Reject yields rejected; approve yields running and queues one execute job.",
        requestBody: { required: true, content: json(ref("ApprovalDecision")) },
        responses: {
          "200": response("RunDetail"),
          "409": { description: "Stale, expired or already decided approval" },
          ...errors,
        },
      },
    },
    "/runs/{runId}/cancel": {
      parameters: runParameters,
      post: {
        operationId: "cancelRun",
        description:
          "Cooperative cancellation. Never claim rollback of an in-flight tool call. Unknown writes terminate as reconciliation_required; terminal cancellation returns 409.",
        responses: {
          "202": { description: "Cancellation requested" },
          "409": { description: "Already terminal" },
          ...errors,
        },
      },
    },
  },
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
    schemas: Object.fromEntries(
      Object.entries(definitions).map(([name, schema]) => [
        name,
        component(schema, name),
      ]),
    ),
  },
};
mkdirSync(`${root}docs`, { recursive: true });
writeFileSync(
  `${root}docs/openapi.yaml`,
  "# Generated by packages/dsl/scripts/emit-openapi.ts; do not hand-edit.\n" +
    stringify(spec, { lineWidth: 120 }),
);
console.log("Generated docs/openapi.yaml");
