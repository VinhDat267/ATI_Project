import { z } from "zod";
import {
  ApiErrorSchema,
  AuthMeSchema,
  EventPageSchema,
  LoginResponseSchema,
  ReconciliationSchema,
  RunAcceptedSchema,
  RunDetailSchema,
  ServerSummaryListSchema,
  TraceSchema,
} from "@wap/dsl/browser";
import type {
  CreateInput,
  DecisionInput,
  EventPage,
  Reconciliation,
  RunAccepted,
  RunDetail,
  Servers,
  TracePage,
  Transport,
} from "./contracts.js";
import {
  PilotCreateRunResponseSchema,
  PilotRunDetailResponseSchema,
  PilotApproveResponseSchema,
  PilotCatalogResponseSchema,
  type PilotCreateRunInput,
  type PilotCreateRunResponse,
  type PilotRunDetailResponse,
  type PilotApproveInput,
  type PilotApproveResponse,
  type PilotCatalogResponse,
} from "./pilot-contracts.js";
import { ClientError } from "./errors.js";

export interface HttpTransportOptions {
  baseUrl?: string;
  getToken?: () => string | null;
  mode?: "bearer" | "cookie" | "hybrid";
  getCsrfToken?: () => string | null;
}

export function createHttpTransport(
  options: HttpTransportOptions = {},
): Transport {
  const baseUrl = (options.baseUrl ?? "").replace(/\/$/, "");
  const getToken = options.getToken ?? (() => null);
  const mode = options.mode ?? "bearer";
  const getCsrfToken =
    options.getCsrfToken ??
    (() =>
      typeof document === "undefined"
        ? null
        : (document.cookie
            .split(";")
            .map((part) => part.trim())
            .find((part) => part.startsWith("wap_csrf="))
            ?.slice("wap_csrf=".length) ?? null));

  async function request<T>(
    method: "GET" | "POST",
    path: string,
    schema: z.ZodType<T> | null,
    signal: AbortSignal,
    reqOptions?: {
      body?: unknown;
      authenticated?: boolean;
      isWrite?: boolean;
    },
  ): Promise<T> {
    const isWrite = reqOptions?.isWrite ?? method === "POST";
    const headers: Record<string, string> = {
      accept: "application/json",
    };

    if (
      (mode === "bearer" || mode === "hybrid") &&
      reqOptions?.authenticated !== false
    ) {
      const token = getToken();
      if (token) {
        headers["authorization"] = `Bearer ${token}`;
      }
    }

    let bodyString: string | undefined;
    if (reqOptions?.body !== undefined) {
      headers["content-type"] = "application/json";
      bodyString = JSON.stringify(reqOptions.body);
    }

    const url = `${baseUrl}${path}`;

    if (mode !== "bearer" && isWrite) {
      const csrf = getCsrfToken();
      if (csrf) headers["x-csrf-token"] = csrf;
    }

    if (signal.aborted) {
      throw new ClientError({
        message: "Yêu cầu đã bị hủy",
        kind: "aborted",
        uncertain: isWrite,
      });
    }

    let response: Response;

    try {
      response = await fetch(url, {
        method,
        headers,
        body: bodyString,
        signal,
        cache: "no-store",
        ...(mode !== "bearer" ? { credentials: "include" as const } : {}),
      });
    } catch (err: unknown) {
      if (
        signal.aborted ||
        (err instanceof Error && err.name === "AbortError")
      ) {
        throw new ClientError({
          message: "Yêu cầu đã bị hủy",
          kind: "aborted",
          uncertain: isWrite,
          cause: err,
        });
      }
      throw new ClientError({
        message: "Không thể kết nối đến máy chủ",
        kind: "network",
        uncertain: isWrite,
        cause: err,
      });
    }

    if (!response.ok) {
      let code = "HTTP_ERROR";
      let message = `Máy chủ phản hồi mã lỗi ${response.status}`;
      let requestId = response.headers.get("x-request-id") ?? undefined;

      try {
        const errorJson = await response.json();
        const parsed = ApiErrorSchema.safeParse(errorJson);
        if (parsed.success) {
          code = parsed.data.error.code;
          message = parsed.data.error.message;
          requestId = parsed.data.error.request_id;
        } else if (
          typeof errorJson === "object" &&
          errorJson !== null &&
          "error" in errorJson
        ) {
          const rawErr = (
            errorJson as { error?: { message?: string; code?: string } }
          ).error;
          if (rawErr?.message) message = rawErr.message;
          if (rawErr?.code) code = rawErr.code;
        }
      } catch {
        // Non-JSON body
      }

      const uncertain = isWrite && response.status >= 500;

      throw new ClientError({
        message,
        kind: "http",
        status: response.status,
        code,
        requestId,
        uncertain,
      });
    }

    if (schema === null) {
      return undefined as T;
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (err) {
      throw new ClientError({
        message: "Phản hồi từ máy chủ không phải JSON hợp lệ",
        kind: "protocol",
        cause: err,
      });
    }

    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new ClientError({
        message: "Phản hồi từ máy chủ không khớp với cấu trúc dữ liệu mong đợi",
        kind: "protocol",
        cause: parsed.error,
      });
    }

    return parsed.data;
  }

  return {
    async login(email, password, signal) {
      const res = await request(
        "POST",
        "/api/v1/auth/login",
        LoginResponseSchema,
        signal,
        {
          body: { email, password },
          authenticated: false,
          isWrite: false,
        },
      );
      return res.token;
    },

    me(signal) {
      return request("GET", "/api/v1/auth/me", AuthMeSchema, signal, {
        authenticated: false,
        isWrite: false,
      });
    },

    logout(signal) {
      return request("POST", "/api/v1/auth/logout", null, signal, {
        authenticated: mode === "cookie" ? false : undefined,
        isWrite: true,
      });
    },

    startOidcLogin(returnTo = "/overview") {
      if (typeof window === "undefined") {
        throw new Error("OIDC login requires a browser window");
      }
      const safeReturnTo =
        returnTo.startsWith("/") && !returnTo.startsWith("//")
          ? returnTo
          : "/overview";
      const url = `${baseUrl}/api/v1/auth/oidc/start?return_to=${encodeURIComponent(safeReturnTo)}`;
      window.location.assign(url);
    },

    list(signal) {
      return request("GET", "/api/v1/runs", z.array(RunDetailSchema), signal, {
        isWrite: false,
      });
    },

    servers(signal) {
      return request(
        "GET",
        "/api/v1/servers",
        ServerSummaryListSchema,
        signal,
        {
          isWrite: false,
        },
      );
    },

    create(input: CreateInput, signal) {
      return request("POST", "/api/v1/runs", RunAcceptedSchema, signal, {
        body: input,
        isWrite: true,
      });
    },

    detail(id, signal) {
      return request("GET", `/api/v1/runs/${id}`, RunDetailSchema, signal, {
        isWrite: false,
      });
    },

    events(id, since, signal) {
      return request(
        "GET",
        `/api/v1/runs/${id}/events?since_seq=${since}`,
        EventPageSchema,
        signal,
        { isWrite: false },
      );
    },

    decide(id, input: DecisionInput, signal) {
      return request(
        "POST",
        `/api/v1/runs/${id}/approval`,
        RunDetailSchema,
        signal,
        {
          body: input,
          isWrite: true,
        },
      );
    },

    cancel(id, signal) {
      return request("POST", `/api/v1/runs/${id}/cancel`, null, signal, {
        isWrite: true,
      });
    },

    trace(id, cursor, signal) {
      const path = cursor
        ? `/api/v1/runs/${id}/trace?cursor=${encodeURIComponent(cursor)}`
        : `/api/v1/runs/${id}/trace`;
      return request("GET", path, TraceSchema, signal, { isWrite: false });
    },

    reconciliation(id, signal) {
      return request(
        "GET",
        `/api/v1/runs/${id}/reconciliation`,
        ReconciliationSchema,
        signal,
        { isWrite: false },
      );
    },

    createPilotRun(input: PilotCreateRunInput, signal: AbortSignal): Promise<PilotCreateRunResponse> {
      return request(
        "POST",
        "/pilot/v2/runs",
        PilotCreateRunResponseSchema,
        signal,
        {
          body: input,
          isWrite: true,
        },
      );
    },

    getPilotRun(id: string, signal: AbortSignal): Promise<PilotRunDetailResponse> {
      return request(
        "GET",
        `/pilot/v2/runs/${encodeURIComponent(id)}`,
        PilotRunDetailResponseSchema,
        signal,
        { isWrite: false },
      );
    },

    approvePilotRun(id: string, input: PilotApproveInput, signal: AbortSignal): Promise<PilotApproveResponse> {
      return request(
        "POST",
        `/pilot/v2/runs/${encodeURIComponent(id)}/approve`,
        PilotApproveResponseSchema,
        signal,
        {
          body: input,
          isWrite: true,
        },
      );
    },

    getPilotCatalog(signal: AbortSignal): Promise<PilotCatalogResponse> {
      return request(
        "GET",
        "/pilot/v2/catalog",
        PilotCatalogResponseSchema,
        signal,
        { isWrite: false },
      );
    },
  };
}
