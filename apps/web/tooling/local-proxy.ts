import type { IncomingMessage, ServerResponse } from "node:http";
import { request as httpRequest } from "node:http";
import type { Plugin } from "vite";

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
  frontendOrigin: string | string[];
}): (req: IncomingMessage, res: ServerResponse, next: () => void) => void {
  validateProxyTarget(options.target);
  const origins = Array.isArray(options.frontendOrigin)
    ? options.frontendOrigin
    : [options.frontendOrigin];
  const allowedUrls = origins.map(validateFrontendOrigin);
  const allowedHosts = new Set(allowedUrls.map((u) => u.host));
  const allowedOriginStrings = new Set(allowedUrls.map((u) => u.origin));

  return function proxyGuard(
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void
  ): void {
    const rawUrl = req.url ?? "/";
    if (!rawUrl.startsWith("/api/v1")) {
      return next();
    }

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

    // 3. Verify Host header matches an allowed frontend host
    const host = req.headers.host;
    if (!host || !allowedHosts.has(host)) {
      sendForbidden(res);
      return;
    }

    // 4. Verify Origin header if present
    const origin = req.headers.origin;
    if (origin !== undefined) {
      if (!allowedOriginStrings.has(origin)) {
        sendForbidden(res);
        return;
      }
    }

    next();
  };
}

export function createProxyForwarder(options: {
  target: string;
  frontendOrigin: string | string[];
}): (req: IncomingMessage, res: ServerResponse) => void {
  const targetUrl = validateProxyTarget(options.target);
  const guard = createProxyGuard(options);

  return function proxyForwarder(req: IncomingMessage, res: ServerResponse): void {
    guard(req, res, () => {
      const headers = { ...req.headers };
      headers.host = targetUrl.host;
      headers.origin = targetUrl.origin;

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

export function localProxy(
  target: string,
  frontendOrigin: string | string[] = "http://127.0.0.1:5173"
): Plugin {
  const targetUrl = validateProxyTarget(target);
  const origins = Array.isArray(frontendOrigin)
    ? [...frontendOrigin]
    : [frontendOrigin];
  if (!origins.some((o) => o.includes(":4173"))) {
    origins.push("http://127.0.0.1:4173");
  }

  const guard = createProxyGuard({
    target: targetUrl.origin,
    frontendOrigin: origins,
  });

  const proxyConfig = {
    "/api/v1": {
      target: targetUrl.origin,
      changeOrigin: true,
      ws: false,
      configure(proxy: any) {
        proxy.on("proxyReq", (proxyReq: any) => {
          proxyReq.setHeader("origin", targetUrl.origin);
        });
      },
    },
  };

  return {
    name: "local-proxy",
    configureServer(server) {
      server.middlewares.use(guard);
    },
    configurePreviewServer(server) {
      server.middlewares.use(guard);
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
