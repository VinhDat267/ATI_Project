import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { Database } from "@wap/db";
import { z } from "zod";
import { EngineError, type WorkflowEngine } from "@wap/engine";
import {
  ApiErrorSchema,
  CreateRunSchema,
  ApprovalDecisionSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  RunAcceptedSchema,
  ReconciliationSchema,
  ServerSummaryListSchema,
} from "./contracts.js";
import type { ApiConfig } from "./config.js";
import { AuthError, SessionStore } from "./auth.js";
import { HttpError, readJson, writeJson } from "./http.js";
import type { WorkerControl } from "./worker.js";
import type { MaintenanceControl } from "./maintenance.js";
import { decodeTraceCursor, encodeTraceCursor } from "./cursors.js";
import { redact } from "./redaction.js";

export interface ApiRuntime {
  server: Server;
  listen(): Promise<string>;
  close(): Promise<void>;
}

export function createApi(options: {
  db: Database;
  config: ApiConfig;
  principalExists?: () => Promise<boolean>;
  engine?: WorkflowEngine;
  worker?: WorkerControl;
  maintenance?: MaintenanceControl;
}): ApiRuntime {
  const { config } = options;
  const principalExists =
    options.principalExists ??
    (async () => {
      const rows = await options.db
        .client`SELECT id FROM users WHERE id=${config.userId} AND email=${config.email}`;
      return rows.length === 1;
    });
  const sessions = new SessionStore({
    userId: config.userId,
    email: config.email,
    passwordHash: config.passwordHash,
    ttlMs: config.sessionTtlMs,
    principalExists,
  });
  let baseOrigin: string | undefined;
  let closing = false;

  const server = createServer(
    {
      requestTimeout: 15_000,
      headersTimeout: 10_000,
      keepAliveTimeout: 5_000,
    },
    (request, response) => {
      void handle(request, response).catch((error: unknown) => {
        const requestId = randomUUID();
        writeJson(
          response,
          500,
          {
            error: {
              code: "INTERNAL",
              message: "Internal server error",
              request_id: requestId,
            },
          },
          requestId,
        );
        if (error instanceof Error && process.env.NODE_ENV !== "test")
          console.error(
            JSON.stringify({ request_id: requestId, error: error.message }),
          );
      });
    },
  );

  async function handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const requestId = randomUUID();
    try {
      if (closing)
        throw new HttpError(503, "SHUTTING_DOWN", "API is shutting down");
      const origin = request.headers.origin;
      if (origin && baseOrigin && origin !== baseOrigin)
        throw new HttpError(403, "ORIGIN_NOT_ALLOWED", "Origin is not allowed");
      const parsed = new URL(
        request.url ?? "/",
        baseOrigin ?? `http://${config.host}`,
      );
      if (!parsed.pathname.startsWith("/api/v1"))
        throw new HttpError(404, "NOT_FOUND", "Route not found");
      const path = parsed.pathname.slice("/api/v1".length) || "/";
      if (path === "/auth/login") {
        if (request.method !== "POST") {
          response.setHeader("allow", "POST");
          throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
        }
        const body = LoginRequestSchema.parse(await readJson(request));
        const token = await sessions.login(
          body.email,
          body.password,
          request.socket.remoteAddress ?? "unknown",
        );
        writeJson(
          response,
          200,
          LoginResponseSchema.parse({ token }),
          requestId,
        );
        return;
      }
      if (path === "/servers") {
        if (request.method !== "GET") {
          response.setHeader("allow", "GET");
          throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
        }
        sessions.authenticate(request.headers.authorization);
        const servers = ServerSummaryListSchema.parse([
          {
            slug: "task_hub",
            status: "disconnected",
            policy_version: "b-local-1",
          },
          {
            slug: "filesystem",
            status: "disconnected",
            policy_version: "b-local-fs-1",
          },
        ]);
        writeJson(response, 200, servers, requestId);
        return;
      }
      if (path === "/runs") {
        if (request.method === "GET") {
          sessions.authenticate(request.headers.authorization);
          if (!options.engine)
            throw new HttpError(
              501,
              "NOT_IMPLEMENTED",
              "Run history is not enabled",
            );
          writeJson(
            response,
            200,
            redact(await options.engine.list()),
            requestId,
          );
          return;
        }
        if (request.method !== "POST") {
          response.setHeader("allow", "GET, POST");
          throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
        }
        const userId = sessions.authenticate(request.headers.authorization);
        if (!options.engine || config.plannerMode === "disabled")
          throw new HttpError(
            503,
            "PLANNER_UNAVAILABLE",
            "Planner is not enabled",
          );
        const body = CreateRunSchema.parse(await readJson(request));
        const accepted = await options.engine.accept(body);
        options.worker?.wake();
        if (userId !== config.userId)
          throw new HttpError(403, "FORBIDDEN", "Principal mismatch");
        writeJson(response, 202, RunAcceptedSchema.parse(accepted), requestId);
        return;
      }
      if (path.startsWith("/runs/")) {
        if (!options.engine)
          throw new HttpError(
            501,
            "NOT_IMPLEMENTED",
            "Run detail is not enabled",
          );
        const segments = path.slice("/runs/".length).split("/");
        const id = segments.shift() ?? "";
        const subpath = segments.join("/");
        if (!id || id.includes("/"))
          throw new HttpError(404, "NOT_FOUND", "Route not found");
        const writeRoute = subpath === "approval" || subpath === "cancel";
        if (request.method !== (writeRoute ? "POST" : "GET")) {
          response.setHeader("allow", writeRoute ? "POST" : "GET");
          throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
        }
        const userId = sessions.authenticate(request.headers.authorization);
        if (!subpath) {
          writeJson(
            response,
            200,
            redact(await options.engine.detail(id)),
            requestId,
          );
          return;
        }
        if (subpath === "approval") {
          const body = ApprovalDecisionSchema.parse(await readJson(request));
          const detail = await options.engine.decide(id, body);
          options.worker?.wake();
          writeJson(response, 200, redact(detail), requestId);
          return;
        }
        if (subpath === "cancel") {
          await options.engine.cancel(id, { strictTerminal: true });
          options.worker?.wake();
          response.statusCode = 202;
          response.setHeader("cache-control", "no-store");
          response.setHeader("x-content-type-options", "nosniff");
          response.setHeader("x-request-id", requestId);
          response.end();
          return;
        }
        if (subpath === "events") {
          const values = parsed.searchParams.getAll("since_seq");
          if (values.length > 1 || parsed.search.length > 2048)
            throw new HttpError(400, "INVALID_REQUEST", "Invalid event cursor");
          const raw = values[0];
          if (raw !== undefined && !/^(0|[1-9][0-9]*)$/.test(raw))
            throw new HttpError(400, "INVALID_REQUEST", "Invalid event cursor");
          const since = raw === undefined ? 0 : Number(raw);
          if (!Number.isSafeInteger(since))
            throw new HttpError(400, "INVALID_REQUEST", "Invalid event cursor");
          writeJson(
            response,
            200,
            redact(await options.engine.events(id, since, 200)),
            requestId,
          );
          return;
        }
        if (subpath === "trace") {
          const values = parsed.searchParams.getAll("cursor");
          if (values.length > 1 || parsed.search.length > 2048)
            throw new HttpError(400, "INVALID_REQUEST", "Invalid trace cursor");
          let cursor: { snapshotId: string; offset: number } | undefined;
          if (values[0] !== undefined) {
            try {
              const decoded = decodeTraceCursor(values[0], config.cursorKey, {
                runId: id,
                userId,
              });
              cursor = {
                snapshotId: decoded.snapshot_id,
                offset: decoded.offset,
              };
            } catch {
              throw new HttpError(
                400,
                "INVALID_REQUEST",
                "Invalid trace cursor",
              );
            }
          }
          const page = await options.engine.tracePage(id, cursor);
          const nextCursor =
            page.next_offset === null
              ? null
              : encodeTraceCursor(
                  {
                    snapshot_id: page.snapshot_id,
                    run_id: id,
                    user_id: userId,
                    offset: page.next_offset,
                  },
                  config.cursorKey,
                );
          writeJson(
            response,
            200,
            redact({
              run_id: id,
              attempts: page.attempts,
              next_cursor: nextCursor,
            }),
            requestId,
          );
          return;
        }
        if (subpath === "reconciliation") {
          writeJson(
            response,
            200,
            redact(
              ReconciliationSchema.parse(await options.engine.reconcile(id)),
            ),
            requestId,
          );
          return;
        }
        throw new HttpError(404, "NOT_FOUND", "Route not found");
      }
      throw new HttpError(404, "NOT_FOUND", "Route not found");
    } catch (error) {
      const mapped = mapError(error);
      if (mapped.status === 405 && response.getHeader("allow") === undefined)
        response.setHeader("allow", "GET, POST");
      writeJson(
        response,
        mapped.status,
        {
          error: {
            code: mapped.code,
            message: mapped.message,
            request_id: requestId,
          },
        },
        requestId,
      );
    }
  }

  function mapError(error: unknown): HttpError {
    if (error instanceof HttpError) return error;
    if (error instanceof EngineError) {
      const status =
        error.code === "NOT_FOUND"
          ? 404
          : error.code === "ACTIVE_RUN" ||
              error.code === "CONFLICT" ||
              error.code === "HISTORY_LIMIT"
            ? 409
            : error.code === "INVALID_INPUT" || error.code === "INVALID_PLAN"
              ? 400
              : error.code === "BUSY" || error.code === "CONFIG"
                ? 503
                : 500;
      return new HttpError(status, error.code, error.message);
    }
    if (error instanceof AuthError)
      return new HttpError(
        error.code === "RATE_LIMITED" ? 429 : 401,
        error.code,
        error.message,
      );
    if (error instanceof z.ZodError)
      return new HttpError(
        400,
        "INVALID_REQUEST",
        "Request does not match the API schema",
      );
    return new HttpError(500, "INTERNAL", "Internal server error");
  }

  return {
    server,
    listen: () =>
      new Promise<string>((resolve, reject) => {
        if (server.listening) {
          const address = server.address();
          if (!address || typeof address === "string")
            return reject(new Error("Invalid server address"));
          return resolve(`${baseOrigin}/api/v1`);
        }
        const onError = (error: Error) => {
          server.off("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          server.off("error", onError);
          const address = server.address();
          if (!address || typeof address === "string")
            return reject(new Error("Invalid server address"));
          baseOrigin = `http://${config.host}:${address.port}`;
          resolve(`${baseOrigin}/api/v1`);
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(config.port, config.host);
      }),
    close: () =>
      new Promise<void>((resolve, reject) => {
        closing = true;
        const workerStop = options.worker?.stop() ?? Promise.resolve();
        const maintenanceStop =
          options.maintenance?.stop() ?? Promise.resolve();
        void Promise.all([workerStop, maintenanceStop]).finally(() => {
          server.closeIdleConnections();
          server.closeAllConnections();
          if (!server.listening) return resolve();
          server.close((error) => (error ? reject(error) : resolve()));
        });
      }),
  };
}

export type { ApiConfig } from "./config.js";
export { loadConfig } from "./config.js";
export { hashPassword } from "./auth.js";
export { ApiErrorSchema };
