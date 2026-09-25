import { randomBytes, randomUUID } from "node:crypto";
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
  AuthMeSchema,
  CreateRunSchema,
  ApprovalDecisionSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  RunAcceptedSchema,
  RunDetailSchema,
  ReconciliationSchema,
  TraceSchema,
  EventPageSchema,
  ServerSummaryListSchema,
  ServerCatalogSchema,
} from "./contracts.js";
import type { ApiConfig } from "./config.js";
import { AuthError, SessionStore, type SessionAuthority } from "./auth.js";
import { OidcProviderError, type OidcFlow } from "./oidc.js";
import {
  assertAuthMutationOrigin,
  hasCookie,
  parseCookieHeader,
  serializeCookie,
  sessionCredential,
  setCookies,
} from "./http-auth.js";
import { HttpError, readJson, writeEmpty, writeJson } from "./http.js";
import type { WorkerControl } from "./worker.js";
import type { MaintenanceControl } from "./maintenance.js";
import { decodeTraceCursor, encodeTraceCursor } from "./cursors.js";
import { redact } from "./redaction.js";
import {
  createRequestLogEntry,
  requestRouteTemplate,
  type RequestLogEntry,
} from "./observability.js";

export interface ApiRuntime {
  server: Server;
  listen(): Promise<string>;
  close(): Promise<void>;
}

/** Builds an engine whose Store and reviewed gateway are bound to one UUID. */
export type PrincipalEngineFactory = (
  userId: string,
) => WorkflowEngine | undefined;

export interface CatalogCheckOptions {
  /** Clock injection for deterministic active-check rate-limit tests. */
  now?: () => number;
  /** Minimum interval between active checks for one authenticated principal. */
  cooldownMs?: number;
}

export interface HealthOptions {
  /** DB/dependency readiness check; provider calls are deliberately excluded. */
  readiness?: () => Promise<boolean>;
}

import { createPilotRouter, type PilotRouterOptions } from "./pilot-router.js";
import type { PilotConfig, PilotPolicy, ReadSheetsRequestResult } from "@wap/engine";

export interface CreateApiOptions {
  db: Database;
  config: ApiConfig;
  principalExists?: () => Promise<boolean>;
  engine?: WorkflowEngine;
  worker?: WorkerControl;
  maintenance?: MaintenanceControl;
  /** Shared clock injection; also used by the in-memory session store. */
  now?: () => number;
  catalogCheck?: CatalogCheckOptions;
  health?: HealthOptions;
  /** Optional durable/session implementation; memory SessionStore remains default. */
  sessionStore?: SessionAuthority;
  /** Optional principal-scoped engine registry used when OIDC is enabled. */
  engineFactory?: PrincipalEngineFactory;
  /** OIDC flow is injected so provider/network behavior is testable and replaceable. */
  oidcFlow?: OidcFlow;
  /** Principal profile lookup kept outside the HTTP router. */
  identityLookup?: (userId: string) => Promise<z.infer<typeof AuthMeSchema>>;
  /** Structured request sink; it must not receive bodies, headers, or secrets. */
  requestLogger?: (entry: RequestLogEntry) => void;
  pilotRouter?: (
    request: IncomingMessage,
    response: ServerResponse,
    path: string,
    requestId: string,
  ) => Promise<void>;
  pilotConfig?: PilotConfig;
  pilotPolicy?: PilotPolicy;
  pilotLiveWriteEnabled?: boolean;
  readSheetsRequestFn?: (params: {
    config: PilotConfig;
    policy: PilotPolicy;
    principalId: string;
    spreadsheetId: string;
    tabId: string;
    requestId: string;
  }) => Promise<ReadSheetsRequestResult>;
  readTrelloListsFn?: PilotRouterOptions["readTrelloListsFn"];
}

export function createApi(options: CreateApiOptions): ApiRuntime {
  const { config } = options;
  const catalogCheckNow = options.catalogCheck?.now ?? options.now ?? Date.now;
  const catalogCooldownMs = options.catalogCheck?.cooldownMs ?? 5_000;
  const readiness = options.health?.readiness ?? (async () => true);
  const requestLogger =
    options.requestLogger ??
    ((entry: RequestLogEntry) => {
      if (process.env.NODE_ENV !== "test") console.log(JSON.stringify(entry));
    });
  if (!Number.isSafeInteger(catalogCooldownMs) || catalogCooldownMs < 0)
    throw new Error("Invalid catalog check cooldown");
  const principalExists =
    options.principalExists ??
    (async () => {
      const rows = await options.db
        .client`SELECT id FROM users WHERE id=${config.userId} AND email=${config.email}`;
      return rows.length === 1;
    });
  const sessions: SessionAuthority =
    options.sessionStore ??
    new SessionStore({
      userId: config.userId,
      email: config.email,
      passwordHash: config.passwordHash,
      ttlMs: config.sessionTtlMs,
      principalExists,
      now: options.now,
    });
  const pilotRouter =
    options.pilotRouter ??
    createPilotRouter({
      db: options.db,
      sessions,
      worker: options.worker,
      pilotConfig: options.pilotConfig,
      pilotPolicy: options.pilotPolicy,
      liveWriteEnabled: options.pilotLiveWriteEnabled,
      readSheetsRequestFn: options.readSheetsRequestFn,
      readTrelloListsFn: options.readTrelloListsFn,
    });
  const identityLookup =
    options.identityLookup ??
    (async (userId: string) => {
      const rows = await options.db.client<
        {
          id: string;
          email: string;
          display_name: string | null;
          roles: string[];
        }[]
      >`
        SELECT id,email,display_name,roles FROM users WHERE id=${userId}`;
      const user = rows[0];
      if (!user)
        throw new AuthError("UNAUTHENTICATED", "Authentication required");
      return AuthMeSchema.parse({
        user_id: user.id,
        email: user.email,
        display_name: user.display_name,
        roles: user.roles?.length ? user.roles : ["user"],
      });
    });
  const configuredSecrets = [
    config.passwordHash,
    config.cursorKey.toString("base64"),
  ];
  const engineFor = (userId: string): WorkflowEngine | undefined => {
    const principalEngine = options.engineFactory?.(userId);
    if (principalEngine) return principalEngine;
    return userId === config.userId ? options.engine : undefined;
  };
  const requireEngine = (userId: string): WorkflowEngine => {
    const engine = engineFor(userId);
    if (!engine)
      throw new HttpError(
        403,
        "FORBIDDEN",
        "Principal is not enabled for this API",
      );
    return engine;
  };
  const projectOutput = <T>(value: T, engine = options.engine): T =>
    engine
      ? engine.safeProjection(value)
      : (redact(value, configuredSecrets) as T);
  const parseInput = <T>(schema: z.ZodType<T>, value: unknown): T => {
    const parsed = schema.safeParse(value);
    if (!parsed.success)
      throw new HttpError(
        400,
        "INVALID_REQUEST",
        "Request does not match the API schema",
      );
    return parsed.data;
  };
  let baseOrigin: string | undefined;
  let closing = false;
  const nextCatalogCheck = new Map<string, number>();

  function claimCatalogCheck(userId: string): number | null {
    const now = catalogCheckNow();
    const nextAllowed = nextCatalogCheck.get(userId) ?? 0;
    if (now < nextAllowed)
      return Math.max(1, Math.ceil((nextAllowed - now) / 1_000));
    // Claim synchronously before any await so concurrent requests cannot both
    // launch or inspect the reviewed presets.
    nextCatalogCheck.set(userId, now + catalogCooldownMs);
    return null;
  }

  function requestHasBody(request: IncomingMessage): boolean {
    const contentLength = request.headers["content-length"];
    return (
      (contentLength !== undefined && contentLength !== "0") ||
      request.headers["transfer-encoding"] !== undefined
    );
  }

  async function readServerCatalog(engine: WorkflowEngine, connect: boolean) {
    try {
      return ServerCatalogSchema.parse(
        projectOutput(await engine.serverCatalog({ connect }), engine),
      );
    } catch (error) {
      if (error instanceof EngineError) throw error;
      throw new EngineError("CONFIG", "Reviewed server catalog is unavailable");
    }
  }

  const server = createServer(
    {
      requestTimeout: 15_000,
      headersTimeout: 10_000,
      keepAliveTimeout: 5_000,
    },
    (request, response) => {
      void handle(request, response).catch(() => {
        const requestId = randomUUID();
        const route = (() => {
          try {
            const parsed = new URL(
              request.url ?? "/",
              baseOrigin ?? `http://${config.host}`,
            );
            return requestRouteTemplate(
              parsed.pathname.startsWith("/pilot/v2")
                ? parsed.pathname.slice("/pilot/v2".length) || "/"
                : parsed.pathname.startsWith("/api/v1")
                ? parsed.pathname.slice("/api/v1".length) || "/"
                : "/unknown",
            );
          } catch {
            return "/unknown";
          }
        })();
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
        try {
          requestLogger(
            createRequestLogEntry(
              request.method ?? "UNKNOWN",
              route,
              response.statusCode || 500,
              requestId,
            ),
          );
        } catch {
          // Observability must never replace the response or change lifecycle state.
        }
      });
    },
  );

  async function handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const requestId = randomUUID();
    let route = "/unknown";
    try {
      if (closing)
        throw new HttpError(503, "SHUTTING_DOWN", "API is shutting down");
      const origin =
        request.headers["x-wap-frontend-origin"] ?? request.headers.origin;
      const configuredOrigins = new Set(
        [baseOrigin, config.oidc?.webOrigin].filter(
          (value): value is string => typeof value === "string",
        ),
      );
      if (
        origin !== undefined &&
        (typeof origin !== "string" || !configuredOrigins.has(origin))
      )
        throw new HttpError(403, "ORIGIN_NOT_ALLOWED", "Origin is not allowed");
      const parsed = new URL(
        request.url ?? "/",
        baseOrigin ?? `http://${config.host}`,
      );
      if (parsed.pathname.startsWith("/pilot/v2")) {
        const pilotPath = parsed.pathname.slice("/pilot/v2".length) || "/";
        route = requestRouteTemplate(pilotPath);
        await pilotRouter(request, response, pilotPath, requestId);
        return;
      }
      if (!parsed.pathname.startsWith("/api/v1"))
        throw new HttpError(404, "NOT_FOUND", "Route not found");
      const path = parsed.pathname.slice("/api/v1".length) || "/";
      route = requestRouteTemplate(path);
      if (path === "/health/live" || path === "/health/ready") {
        if (request.method !== "GET") {
          response.setHeader("allow", "GET");
          throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
        }
        if (path === "/health/live") {
          writeJson(response, 200, { status: "ok" }, requestId);
          return;
        }
        let ready = false;
        try {
          ready = await readiness();
        } catch {
          ready = false;
        }
        if (!ready)
          throw new HttpError(503, "NOT_READY", "Service is not ready");
        writeJson(response, 200, { status: "ready" }, requestId);
        return;
      }
      if (path === "/auth/oidc/start") {
        if (request.method !== "GET") {
          response.setHeader("allow", "GET");
          throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
        }
        if (!config.oidc?.enabled || !options.oidcFlow)
          throw new HttpError(
            503,
            "OIDC_NOT_CONFIGURED",
            "OIDC is not enabled",
          );
        const returnTo = parsed.searchParams.get("return_to") ?? "/";
        const started = await options.oidcFlow.start(returnTo);
        const secure = config.oidc.webOrigin.startsWith("https://");
        const csrf = randomBytes(32).toString("base64url");
        response.statusCode = 302;
        response.setHeader("location", started.authorizationUrl.toString());
        response.setHeader("cache-control", "no-store");
        response.setHeader("x-content-type-options", "nosniff");
        response.setHeader("x-request-id", requestId);
        setCookies(response, [
          serializeCookie("wap_oidc_tx", started.transactionCookie, {
            maxAge: Math.ceil(config.oidc.transactionTtlMs / 1000),
            secure,
          }),
          serializeCookie("wap_csrf", csrf, {
            maxAge: 900,
            secure,
            // Double-submit CSRF requires the browser client to echo this
            // nonce in a request header; it is not an authentication secret.
            httpOnly: false,
          }),
        ]);
        response.end();
        return;
      }
      if (path === "/auth/oidc/callback") {
        if (request.method !== "GET") {
          response.setHeader("allow", "GET");
          throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
        }
        if (!config.oidc?.enabled || !options.oidcFlow)
          throw new HttpError(
            503,
            "OIDC_NOT_CONFIGURED",
            "OIDC is not enabled",
          );
        const code = parsed.searchParams.get("code");
        const state = parsed.searchParams.get("state");
        const transactionCookie = parseCookieHeader(request.headers.cookie).get(
          "wap_oidc_tx",
        );
        if (!code || !state || !transactionCookie)
          throw new HttpError(
            400,
            "OIDC_INVALID_CALLBACK",
            "OIDC callback is invalid",
          );
        const completed = await options.oidcFlow.complete({
          code,
          state,
          transactionCookie,
        });
        const session = await sessions.issue(
          completed.userId,
          completed.sessionMetadata,
        );
        const secure = config.oidc.webOrigin.startsWith("https://");
        response.statusCode = 302;
        response.setHeader(
          "location",
          new URL(completed.returnTo, config.oidc.webOrigin).toString(),
        );
        response.setHeader("cache-control", "no-store");
        response.setHeader("x-content-type-options", "nosniff");
        response.setHeader("x-request-id", requestId);
        setCookies(response, [
          serializeCookie(config.oidc.sessionCookieName, session, {
            maxAge: Math.ceil(config.oidc.sessionTtlMs / 1000),
            secure,
          }),
          serializeCookie("wap_oidc_tx", "", { maxAge: 0, secure }),
        ]);
        response.end();
        return;
      }
      if (path === "/auth/me") {
        if (request.method !== "GET") {
          response.setHeader("allow", "GET");
          throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
        }
        if (!config.oidc?.enabled && !request.headers.authorization)
          throw new HttpError(
            503,
            "OIDC_NOT_CONFIGURED",
            "OIDC is not enabled",
          );
        const userId = await sessions.authenticate(sessionCredential(request));
        writeJson(
          response,
          200,
          AuthMeSchema.parse(await identityLookup(userId)),
          requestId,
        );
        return;
      }
      if (path === "/auth/login" || path === "/auth/logout") {
        if (request.method !== "POST") {
          response.setHeader("allow", "POST");
          throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
        }
        if (path === "/auth/logout") {
          if (
            config.oidc?.enabled &&
            hasCookie(request, config.oidc.sessionCookieName)
          )
            assertAuthMutationOrigin(request, config.oidc, baseOrigin);
          await sessions.revoke(sessionCredential(request));
          if (config.oidc?.enabled) {
            const secure = config.oidc.webOrigin.startsWith("https://");
            setCookies(response, [
              serializeCookie(config.oidc.sessionCookieName, "", {
                maxAge: 0,
                secure,
              }),
              serializeCookie("wap_csrf", "", {
                maxAge: 0,
                secure,
                httpOnly: false,
              }),
            ]);
          }
          writeEmpty(response, 204, requestId);
          return;
        }
        if (config.oidc?.enabled && config.legacyPasswordAuthEnabled === false)
          throw new HttpError(
            404,
            "AUTH_METHOD_DISABLED",
            "Password authentication is disabled",
          );
        const body = parseInput(LoginRequestSchema, await readJson(request));
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
        const userId = await sessions.authenticate(sessionCredential(request));
        const engine = engineFor(userId);
        const servers = ServerSummaryListSchema.parse(
          projectOutput(
            engine
              ? await engine.serverSummaries()
              : [
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
                ],
            engine,
          ),
        );
        writeJson(response, 200, servers, requestId);
        return;
      }
      if (path === "/servers/catalog") {
        if (request.method !== "GET") {
          response.setHeader("allow", "GET");
          throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
        }
        const userId = await sessions.authenticate(sessionCredential(request));
        const catalog = await readServerCatalog(requireEngine(userId), false);
        writeJson(response, 200, catalog, requestId);
        return;
      }
      if (path === "/servers/check") {
        if (request.method !== "POST") {
          response.setHeader("allow", "POST");
          throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
        }
        const userId = await sessions.authenticate(sessionCredential(request));
        const engine = requireEngine(userId);
        const retryAfter = claimCatalogCheck(userId);
        if (retryAfter !== null) {
          response.setHeader("retry-after", String(retryAfter));
          throw new HttpError(
            429,
            "RATE_LIMITED",
            "Server check temporarily rate limited",
          );
        }
        // The active check has no client-controlled launch contract. Consume
        // and ignore an optional body so executable-looking JSON cannot affect
        // the fixed reviewed presets selected by the engine.
        if (requestHasBody(request)) await readJson(request);
        const catalog = await readServerCatalog(engine, true);
        writeJson(response, 200, catalog, requestId);
        return;
      }
      if (path === "/runs") {
        if (request.method === "GET") {
          const userId = await sessions.authenticate(
            sessionCredential(request),
          );
          const engine = requireEngine(userId);
          writeJson(
            response,
            200,
            z
              .array(RunDetailSchema)
              .parse(projectOutput(await engine.list(), engine)),
            requestId,
          );
          return;
        }
        if (request.method !== "POST") {
          response.setHeader("allow", "GET, POST");
          throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
        }
        const userId = await sessions.authenticate(sessionCredential(request));
        if (config.allowNewRuns === false)
          throw new HttpError(
            503,
            "NEW_RUNS_DISABLED",
            "New runs are temporarily disabled",
          );
        const engine = requireEngine(userId);
        if (config.plannerMode === "disabled")
          throw new HttpError(
            503,
            "PLANNER_UNAVAILABLE",
            "Planner is not enabled",
          );
        const body = parseInput(CreateRunSchema, await readJson(request));
        const accepted = await engine.accept(body);
        options.worker?.wake();
        writeJson(response, 202, RunAcceptedSchema.parse(accepted), requestId);
        return;
      }
      if (path.startsWith("/runs/")) {
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
        const userId = await sessions.authenticate(sessionCredential(request));
        parseInput(z.uuid(), id);
        const engine = requireEngine(userId);
        if (!subpath) {
          writeJson(
            response,
            200,
            RunDetailSchema.parse(
              projectOutput(await engine.detail(id), engine),
            ),
            requestId,
          );
          return;
        }
        if (subpath === "approval") {
          const body = parseInput(
            ApprovalDecisionSchema,
            await readJson(request),
          );
          const detail = await engine.decide(id, body);
          options.worker?.wake();
          writeJson(
            response,
            200,
            RunDetailSchema.parse(projectOutput(detail, engine)),
            requestId,
          );
          return;
        }
        if (subpath === "cancel") {
          await engine.cancel(id, { strictTerminal: true });
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
            EventPageSchema.parse(
              projectOutput(await engine.events(id, since, 200), engine),
            ),
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
          const page = await engine.tracePage(id, cursor);
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
            TraceSchema.parse(
              projectOutput(
                {
                  run_id: id,
                  attempts: page.attempts,
                  next_cursor: nextCursor,
                },
                engine,
              ),
            ),
            requestId,
          );
          return;
        }
        if (subpath === "reconciliation") {
          writeJson(
            response,
            200,
            ReconciliationSchema.parse(
              projectOutput(await engine.reconcile(id), engine),
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
    } finally {
      try {
        requestLogger(
          createRequestLogEntry(
            request.method ?? "UNKNOWN",
            route,
            response.statusCode || 500,
            requestId,
          ),
        );
      } catch {
        // Observability must never replace the response or change lifecycle state.
      }
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
              error.code === "HISTORY_LIMIT" ||
              error.code === "EXPIRED"
            ? 409
            : error.code === "INVALID_INPUT" || error.code === "INVALID_PLAN"
              ? 400
              : error.code === "BUSY" || error.code === "CONFIG"
                ? 503
                : 500;
      const message =
        status === 404
          ? "Resource not found"
          : status === 409
            ? "Request conflicts with current state"
            : status === 400
              ? "Request is invalid"
              : status === 503
                ? "Service unavailable"
                : "Internal server error";
      return new HttpError(status, error.code, message);
    }
    if (error instanceof AuthError)
      return new HttpError(
        error.code === "RATE_LIMITED" ? 429 : 401,
        error.code,
        error.message,
      );
    if (error instanceof OidcProviderError)
      return new HttpError(
        error.code === "OIDC_PROVIDER_UNAVAILABLE" ? 503 : 400,
        error.code,
        error.message,
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
