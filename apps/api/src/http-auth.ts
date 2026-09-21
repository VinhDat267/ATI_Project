import type { IncomingMessage, ServerResponse } from "node:http";
import { HttpError } from "./http.js";
import type { OidcConfig } from "./config.js";
import type { SessionCredential } from "./auth.js";

const MAX_COOKIE_HEADER = 8_192;
const MAX_COOKIE_COUNT = 32;

export interface CookieOptions {
  maxAge: number;
  secure: boolean;
  sameSite?: "Lax" | "Strict";
  httpOnly?: boolean;
}

export function parseCookieHeader(
  header: string | undefined,
): ReadonlyMap<string, string> {
  if (!header) return new Map();
  if (header.length > MAX_COOKIE_HEADER)
    throw new HttpError(400, "INVALID_COOKIE", "Cookie header is too large");
  const values = new Map<string, string>();
  for (const part of header.split(";")) {
    if (values.size >= MAX_COOKIE_COUNT)
      throw new HttpError(400, "INVALID_COOKIE", "Too many cookies");
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name) || value.length > 4096)
      throw new HttpError(400, "INVALID_COOKIE", "Invalid cookie");
    if (!values.has(name)) values.set(name, value);
  }
  return values;
}

export function serializeCookie(
  name: string,
  value: string,
  options: CookieOptions,
): string {
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name))
    throw new Error("Invalid cookie name");
  if (!/^[A-Za-z0-9._~-]*$/.test(value) || value.length > 4096)
    throw new Error("Invalid cookie value");
  if (!Number.isSafeInteger(options.maxAge) || options.maxAge < 0)
    throw new Error("Invalid cookie max age");
  return [
    `${name}=${value}`,
    "Path=/",
    ...(options.httpOnly === false ? [] : ["HttpOnly"]),
    `Max-Age=${options.maxAge}`,
    `SameSite=${options.sameSite ?? "Lax"}`,
    ...(options.secure ? ["Secure"] : []),
  ].join("; ");
}

export function sessionCredential(request: IncomingMessage): SessionCredential {
  return {
    authorization: request.headers.authorization,
    cookie: request.headers.cookie,
  };
}

export function hasCookie(request: IncomingMessage, name: string): boolean {
  return parseCookieHeader(request.headers.cookie).has(name);
}

export function assertAuthMutationOrigin(
  request: IncomingMessage,
  config: OidcConfig | undefined,
  baseOrigin: string | undefined,
): void {
  const origin =
    request.headers["x-wap-frontend-origin"] ?? request.headers.origin;
  const expected = new Set(
    [baseOrigin, config?.webOrigin].filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    ),
  );
  if (typeof origin !== "string" || !expected.has(origin))
    throw new HttpError(403, "ORIGIN_NOT_ALLOWED", "Origin is not allowed");
  const cookies = parseCookieHeader(request.headers.cookie);
  const csrf = request.headers["x-csrf-token"];
  if (
    typeof csrf !== "string" ||
    csrf.length < 16 ||
    cookies.get("wap_csrf") !== csrf
  )
    throw new HttpError(403, "CSRF_REQUIRED", "CSRF validation failed");
}

export function setCookies(response: ServerResponse, values: string[]): void {
  response.setHeader("set-cookie", values);
}
