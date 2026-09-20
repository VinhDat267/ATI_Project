export interface RequestLogEntry {
  readonly event: "http_request";
  readonly method: string;
  readonly route: string;
  readonly status: number;
  readonly request_id: string;
}

/**
 * Convert an API-relative path into a stable, non-sensitive route template.
 * Values supplied by callers are never copied into the returned string.
 */
export function requestRouteTemplate(pathname: string): string {
  const pathOnly = pathname.split("?", 1)[0] ?? "";
  const segments = pathOnly.split("/").filter((segment) => segment.length > 0);
  const [root, , subpath] = segments;

  if (
    segments.length === 2 &&
    root === "auth" &&
    (segments[1] === "login" ||
      segments[1] === "logout" ||
      segments[1] === "me")
  )
    return `/auth/${segments[1]}`;
  if (
    segments.length === 3 &&
    root === "auth" &&
    segments[1] === "oidc" &&
    (segments[2] === "start" || segments[2] === "callback")
  )
    return `/auth/oidc/${segments[2]}`;
  if (segments.length === 1 && root === "servers") return "/servers";
  if (segments.length === 1 && root === "runs") return "/runs";
  if (
    segments.length === 2 &&
    root === "health" &&
    (segments[1] === "live" || segments[1] === "ready")
  )
    return `/health/${segments[1]}`;
  if (root !== "runs" || segments.length < 2 || segments.length > 3)
    return "/unknown";

  if (segments.length === 2) return "/runs/:runId";
  if (
    subpath === "events" ||
    subpath === "approval" ||
    subpath === "cancel" ||
    subpath === "trace" ||
    subpath === "reconciliation"
  )
    return `/runs/:runId/${subpath}`;
  return "/runs/:runId/unknown";
}

export function createRequestLogEntry(
  method: string,
  route: string,
  status: number,
  requestId: string,
): RequestLogEntry {
  return {
    event: "http_request",
    method,
    route,
    status,
    request_id: requestId,
  };
}
