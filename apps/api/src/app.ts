import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { Database } from "@wap/db";
import { z } from "zod";
import {
  ApiErrorSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  ServerSummaryListSchema,
} from "./contracts.js";
import type { ApiConfig } from "./config.js";
import { AuthError, SessionStore } from "./auth.js";
import { HttpError, readJson, writeJson } from "./http.js";

export interface ApiRuntime {
  server: Server;
  listen(): Promise<string>;
  close(): Promise<void>;
}

export function createApi(options: {
  db: Database;
  config: ApiConfig;
  principalExists?: () => Promise<boolean>;
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
      if (path === "/runs" || path.startsWith("/runs/")) {
        sessions.authenticate(request.headers.authorization);
        throw new HttpError(
          501,
          "NOT_IMPLEMENTED",
          "Run routes are not implemented in API-01",
        );
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
        if (!server.listening) return resolve();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

export type { ApiConfig } from "./config.js";
export { loadConfig } from "./config.js";
export { hashPassword } from "./auth.js";
export { ApiErrorSchema };
