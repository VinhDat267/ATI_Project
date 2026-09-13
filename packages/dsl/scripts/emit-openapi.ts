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
  RunAccepted: dsl.RunAcceptedSchema,
  RunDetail: dsl.RunDetailSchema,
  Approval: dsl.ApprovalSchema,
  ApprovalDecision: dsl.ApprovalDecisionSchema,
  EventPage: dsl.EventPageSchema,
  Trace: dsl.TraceSchema,
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
  "401": { description: "Unauthenticated" },
  "404": { description: "Not found or owned by another user" },
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
    version: "0.2.0",
    description:
      "Design contract; HTTP implementation NOT_RUN. Poll every 2 seconds. Shared schema generation does not encode every Zod refinement or runtime authorization rule.",
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
          "Full immutable attempt snapshots, up to 100 per page. Opaque next_cursor binds a snapshot watermark and (started_at,id) position. Restart without cursor to see newer attempts. Legacy unknown metadata is explicit.",
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
          content: json({
            type: "object",
            additionalProperties: false,
            required: ["email", "password"],
            properties: {
              email: { type: "string" },
              password: { type: "string" },
            },
          }),
        },
        responses: {
          "200": {
            description: "OK",
            content: json({
              type: "object",
              required: ["token"],
              properties: { token: { type: "string" } },
              additionalProperties: false,
            }),
          },
          "401": errors["401"],
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
            content: json({
              type: "array",
              items: {
                type: "object",
                required: ["slug", "status", "policy_version"],
                additionalProperties: false,
                properties: {
                  slug: { type: "string" },
                  status: {
                    enum: ["connected", "disconnected", "error", "unreviewed"],
                  },
                  policy_version: { type: ["string", "null"] },
                },
              },
            }),
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
    "/runs/{runId}/approval": {
      parameters: runParameters,
      post: {
        operationId: "decideApproval",
        description:
          "Atomically compare owner, pending decision, run status, version, snapshot and expiry. Duplicate/stale decision returns 409. Reject yields rejected; approve yields running.",
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
          "Cooperative cancellation. Never claim rollback of an in-flight tool call. Unknown writes terminate as reconciliation_required.",
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
