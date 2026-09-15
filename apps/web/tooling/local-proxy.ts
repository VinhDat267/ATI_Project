import type { IncomingMessage, ServerResponse } from "node:http";
import { request as httpRequest } from "node:http";
import type { Plugin, ViteDevServer, PreviewServer } from "vite";

export interface LocalProxyOptions {
  target: string;
  devOrigin?: string | (() => string);
  previewOrigin?: string | (() => string);
}

export function validateProxyTarget(target: string): URL {
  const portMatch = target.match(/:(\d+)(?:[/?#]|$)/);
  if (portMatch && portMatch[1]) {
    const p = Number(portMatch[1]);
    if (p <= 0 || p > 65535) {
      throw new Error(`Proxy target port is out of range: "${portMatch[1]}"`);
    }
  }

  let url: URL;
  try {
    url = new URL(target);
  } catch {
    throw new Error(`Invalid proxy target URL: "${target}"`);
  }
  if (url.protocol !== "http:") {
    throw new Error(`Proxy target must use HTTP protocol, got "${url.protocol}"`);
  }
  if (url.hostname !== "127.0.0.1") {
    throw new Error(`Proxy target must be 127.0.0.1, got "${url.hostname}"`);
  }
  if (!url.port) {
    throw new Error(`Proxy target must specify an explicit port: "${target}"`);
  }
  const portNum = Number(url.port);
  if (!Number.isSafeInteger(portNum) || portNum <= 0 || portNum > 65535) {
    throw new Error(`Proxy target port is out of range: "${url.port}"`);
  }
  if (url.username !== "" || url.password !== "") {
    throw new Error("Proxy target must not contain user credentials");
  }
  if (url.pathname !== "" && url.pathname !== "/") {
    throw new Error(`Proxy target must not specify a subpath, got "${url.pathname}"`);
  }
  if (url.search !== "") {
    throw new Error("Proxy target must not specify search or query parameters");
  }
  if (url.hash !== "") {
    throw new Error("Proxy target must not specify a hash or fragment");
  }
  return url;
}

export function validateFrontendOrigin(origin: string): URL {
  const portMatch = origin.match(/:(\d+)(?:[/?#]|$)/);
  if (portMatch && portMatch[1]) {
    const p = Number(portMatch[1]);
    if (p <= 0 || p > 65535) {
      throw new Error(`Frontend origin port is out of range: "${portMatch[1]}"`);
    }
  }

  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Error(`Invalid frontend origin URL: "${origin}"`);
  }
  if (url.protocol !== "http:") {
    throw new Error(`Frontend origin must use HTTP protocol, got "${url.protocol}"`);
  }
  if (url.hostname !== "127.0.0.1") {
    throw new Error(`Frontend origin must be 127.0.0.1, got "${url.hostname}"`);
  }
  if (!url.port) {
    throw new Error(`Frontend origin must specify an explicit port: "${origin}"`);
  }
  const portNum = Number(url.port);
  if (!Number.isSafeInteger(portNum) || portNum <= 0 || portNum > 65535) {
    throw new Error(`Frontend origin port is out of range: "${url.port}"`);
  }
  if (url.username !== "" || url.password !== "") {
    throw new Error("Frontend origin must not contain user credentials");
  }
  if (url.pathname !== "" && url.pathname !== "/") {
    throw new Error(`Frontend origin must not specify a subpath, got "${url.pathname}"`);
  }
  if (url.search !== "" || url.hash !== "") {
    throw new Error("Frontend origin must not specify search or hash");
  }
  return url;
}

function sendForbidden(res: ServerResponse): void {
  res.statusCode = 403;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(
    JSON.stringify({
      error: {
        code: "FORBIDDEN",
        message: "Request blocked by local proxy boundary",
      },
    })
  );
}

export function createProxyGuard(options: {
  target: string;
  frontendOrigin: string | (() => string);
}): (req: IncomingMessage, res: ServerResponse, next: () => void) => void {
  validateProxyTarget(options.target);

  return function proxyGuard(
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void
  ): void {
    const rawUrl = req.url ?? "/";
    if (!rawUrl.startsWith("/api/v1")) {
      return next();
    }

    // Resolve expected frontend origin dynamically or statically
    const originStr =
      typeof options.frontendOrigin === "function"
        ? options.frontendOrigin()
        : options.frontendOrigin;
    const allowedUrl = validateFrontendOrigin(originStr);
    const allowedHost = allowedUrl.host;
    const allowedOrigin = allowedUrl.origin;

    // 1. Reject OPTIONS method (no CORS preflight)
    if (req.method === "OPTIONS") {
      sendForbidden(res);
      return;
    }

    // 2. Reject cross-site requests via Sec-Fetch-Site
    const secFetchSite = req.headers["sec-fetch-site"];
    if (
      typeof secFetchSite === "string" &&
      secFetchSite.toLowerCase() === "cross-site"
    ) {
      sendForbidden(res);
      return;
    }

    // 3. Verify Host header matches the exact frontend host for this server
    const host = req.headers.host;
    if (!host || host !== allowedHost) {
      sendForbidden(res);
      return;
    }

    // 4. Verify Origin header if present
    const origin = req.headers.origin;
    if (origin !== undefined) {
      if (origin !== allowedOrigin) {
        sendForbidden(res);
        return;
      }
    }

    next();
  };
}

const FORBIDDEN_FORWARD_HEADERS = new Set([
  "cookie",
  "sec-fetch",
  "sec-fetch-site",
  "sec-fetch-mode",
  "sec-fetch-dest",
  "sec-fetch-user",
]);

export function isForbiddenForwardHeader(headerName: string): boolean {
  const lower = headerName.toLowerCase();
  if (FORBIDDEN_FORWARD_HEADERS.has(lower)) {
    return true;
  }
  if (lower.startsWith("sec-fetch-")) {
    return true;
  }
  return false;
}

export function rewriteForwardHeaders(
  headers: Record<string, string | string[] | undefined>,
  targetUrl: URL
): Record<string, string | string[]>;
export function rewriteForwardHeaders(
  proxyReq: any,
  targetUrl: URL
): void;
export function rewriteForwardHeaders(
  target: any,
  targetUrl: URL
): any {
  if (
    target &&
    typeof target.setHeader === "function" &&
    typeof target.removeHeader === "function"
  ) {
    const proxyReq = target;
    proxyReq.removeHeader("cookie");
    proxyReq.removeHeader("sec-fetch-site");
    proxyReq.removeHeader("sec-fetch-mode");
    proxyReq.removeHeader("sec-fetch-dest");
    proxyReq.removeHeader("sec-fetch-user");
    proxyReq.removeHeader("sec-fetch");

    if (typeof proxyReq.getHeaderNames === "function") {
      for (const name of proxyReq.getHeaderNames()) {
        if (isForbiddenForwardHeader(name)) {
          proxyReq.removeHeader(name);
        }
      }
    }

    proxyReq.setHeader("host", targetUrl.host);
    proxyReq.setHeader("origin", targetUrl.origin);
    return;
  }

  const rewritten: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(
    (target ?? {}) as Record<string, string | string[] | undefined>
  )) {
    if (value === undefined) continue;
    const lower = key.toLowerCase();
    if (isForbiddenForwardHeader(lower) || lower === "host" || lower === "origin") {
      continue;
    }
    rewritten[lower] = value;
  }
  rewritten.host = targetUrl.host;
  rewritten.origin = targetUrl.origin;
  return rewritten;
}

export function createProxyForwarder(options: {
  target: string;
  frontendOrigin: string | (() => string);
}): (req: IncomingMessage, res: ServerResponse) => void {
  const targetUrl = validateProxyTarget(options.target);
  const guard = createProxyGuard(options);

  return function proxyForwarder(req: IncomingMessage, res: ServerResponse): void {
    guard(req, res, () => {
      const headers = rewriteForwardHeaders(req.headers, targetUrl);

      const clientReq = httpRequest(
        {
          hostname: targetUrl.hostname,
          port: targetUrl.port,
          path: req.url,
          method: req.method,
          headers,
        },
        (clientRes) => {
          res.writeHead(clientRes.statusCode ?? 500, clientRes.headers);
          clientRes.pipe(res);
        }
      );

      clientReq.on("error", () => {
        if (!res.headersSent) {
          res.statusCode = 502;
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");
          res.end(
            JSON.stringify({
              error: {
                code: "BAD_GATEWAY",
                message: "Failed to forward request to API target",
              },
            })
          );
        }
      });

      req.pipe(clientReq);
    });
  };
}

function resolveServerOrigin(
  server: ViteDevServer | PreviewServer,
  explicitOrigin: string | (() => string) | undefined,
  fallbackPort: number
): string {
  if (typeof explicitOrigin === "function") {
    return explicitOrigin();
  }
  if (typeof explicitOrigin === "string") {
    return explicitOrigin;
  }
  const address = server.httpServer?.address();
  if (address && typeof address === "object" && typeof address.port === "number") {
    return `http://127.0.0.1:${address.port}`;
  }
  const configPort =
    (server as ViteDevServer).config?.server?.port ??
    (server as PreviewServer).config?.preview?.port ??
    fallbackPort;
  return `http://127.0.0.1:${configPort}`;
}

export function localProxy(
  targetOrOptions: string | LocalProxyOptions,
  legacyDevOrigin?: string
): Plugin {
  const options: LocalProxyOptions =
    typeof targetOrOptions === "string"
      ? { target: targetOrOptions, devOrigin: legacyDevOrigin }
      : targetOrOptions;

  const targetUrl = validateProxyTarget(options.target);

  const proxyConfig = {
    "/api/v1": {
      target: targetUrl.origin,
      changeOrigin: true,
      ws: false,
      configure(proxy: any) {
        proxy.on("proxyReq", (proxyReq: any) => {
          rewriteForwardHeaders(proxyReq, targetUrl);
        });
      },
    },
  };

  return {
    name: "local-proxy",
    configureServer(server) {
      const getDevOrigin = () =>
        resolveServerOrigin(server, options.devOrigin, 5173);
      server.middlewares.use(
        createProxyGuard({
          target: targetUrl.origin,
          frontendOrigin: getDevOrigin,
        })
      );
    },
    configurePreviewServer(server) {
      const getPreviewOrigin = () =>
        resolveServerOrigin(server, options.previewOrigin, 4173);
      server.middlewares.use(
        createProxyGuard({
          target: targetUrl.origin,
          frontendOrigin: getPreviewOrigin,
        })
      );
    },
    config() {
      return {
        server: {
          host: "127.0.0.1",
          cors: false,
          open: false,
          proxy: proxyConfig,
        },
        preview: {
          host: "127.0.0.1",
          cors: false,
          open: false,
          proxy: proxyConfig,
        },
      };
    },
  };
}

export default localProxy;
