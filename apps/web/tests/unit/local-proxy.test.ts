import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, request as httpRequest, type Server } from "node:http";
import {
  validateProxyTarget,
  validateFrontendOrigin,
  createProxyGuard,
  createProxyForwarder,
} from "../../tooling/local-proxy.js";

describe("localProxy configuration validation", () => {
  it("accepts valid 127.0.0.1 HTTP target with port", () => {
    const url = validateProxyTarget("http://127.0.0.1:3001");
    expect(url.origin).toBe("http://127.0.0.1:3001");
    expect(url.hostname).toBe("127.0.0.1");
    expect(url.port).toBe("3001");
  });

  it("rejects non-HTTP protocols", () => {
    expect(() => validateProxyTarget("https://127.0.0.1:3001")).toThrow(
      /HTTP protocol/
    );
    expect(() => validateProxyTarget("ws://127.0.0.1:3001")).toThrow(
      /HTTP protocol/
    );
  });

  it("rejects non-loopback hostnames", () => {
    expect(() => validateProxyTarget("http://localhost:3001")).toThrow(
      /127\.0\.0\.1/
    );
    expect(() => validateProxyTarget("http://example.com:3001")).toThrow(
      /127\.0\.0\.1/
    );
    expect(() => validateProxyTarget("http://0.0.0.0:3001")).toThrow(
      /127\.0\.0\.1/
    );
  });

  it("rejects missing or out-of-range ports", () => {
    expect(() => validateProxyTarget("http://127.0.0.1")).toThrow(
      /explicit port/
    );
    expect(() => validateProxyTarget("http://127.0.0.1:0")).toThrow(
      /out of range/
    );
    expect(() => validateProxyTarget("http://127.0.0.1:70000")).toThrow(
      /out of range/
    );
  });

  it("rejects user credentials", () => {
    expect(() =>
      validateProxyTarget("http://user:pass@127.0.0.1:3001")
    ).toThrow(/credentials/);
  });

  it("rejects subpaths, queries, and fragments", () => {
    expect(() => validateProxyTarget("http://127.0.0.1:3001/api")).toThrow(
      /subpath/
    );
    expect(() => validateProxyTarget("http://127.0.0.1:3001?query=1")).toThrow(
      /query parameters/
    );
    expect(() => validateProxyTarget("http://127.0.0.1:3001#fragment")).toThrow(
      /fragment/
    );
  });

  it("validates frontend origins correctly", () => {
    expect(
      validateFrontendOrigin("http://127.0.0.1:5173").origin
    ).toBe("http://127.0.0.1:5173");
    expect(
      validateFrontendOrigin("http://127.0.0.1:4173").origin
    ).toBe("http://127.0.0.1:4173");
    expect(() => validateFrontendOrigin("https://127.0.0.1:5173")).toThrow();
    expect(() => validateFrontendOrigin("http://localhost:5173")).toThrow();
    expect(() => validateFrontendOrigin("http://127.0.0.1")).toThrow();
  });
});

describe("localProxy HTTP boundary and forwarding", () => {
  let upstreamServer: Server;
  let frontendServer: Server;
  let upstreamOrigin: string;
  let frontendOrigin: string;
  let previewOrigin: string;
  const upstreamCalls: Array<{
    method: string;
    url: string;
    headers: Record<string, string | string[] | undefined>;
    body: string;
  }> = [];

  beforeEach(async () => {
    upstreamCalls.length = 0;

    // Upstream server simulating @wap/api on loopback
    upstreamServer = createServer((req, res) => {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        upstreamCalls.push({
          method: req.method ?? "UNKNOWN",
          url: req.url ?? "/",
          headers: req.headers,
          body,
        });
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true }));
      });
    });

    await new Promise<void>((resolve) => {
      upstreamServer.listen(0, "127.0.0.1", () => resolve());
    });

    const upstreamAddress = upstreamServer.address();
    if (!upstreamAddress || typeof upstreamAddress === "string") {
      throw new Error("Failed to start upstream server");
    }
    upstreamOrigin = `http://127.0.0.1:${upstreamAddress.port}`;

    // Frontend server running proxy forwarder on loopback
    frontendServer = createServer();
    await new Promise<void>((resolve) => {
      frontendServer.listen(0, "127.0.0.1", () => resolve());
    });

    const frontendAddress = frontendServer.address();
    if (!frontendAddress || typeof frontendAddress === "string") {
      throw new Error("Failed to start frontend server");
    }
    frontendOrigin = `http://127.0.0.1:${frontendAddress.port}`;
    previewOrigin = "http://127.0.0.1:4173";

    const forwarder = createProxyForwarder({
      target: upstreamOrigin,
      frontendOrigin: [frontendOrigin, previewOrigin],
    });

    frontendServer.on("request", (req, res) => {
      forwarder(req, res);
    });
  });

  afterEach(async () => {
    await Promise.all([
      new Promise<void>((resolve) => upstreamServer.close(() => resolve())),
      new Promise<void>((resolve) => frontendServer.close(() => resolve())),
    ]);
  });

  it("forwards valid same-origin POST to upstream with rewritten Origin and preserved body/auth", async () => {
    const syntheticBody = JSON.stringify({
      email: "synthetic@local.invalid",
      password: "synthetic-password-hash",
    });

    const response = await fetch(`${frontendOrigin}/api/v1/auth/login`, {
      method: "POST",
      headers: {
        host: new URL(frontendOrigin).host,
        origin: frontendOrigin,
        "content-type": "application/json",
        authorization: "Bearer synthetic-token-xyz",
      },
      body: syntheticBody,
    });

    expect(response.status).toBe(200);
    expect(upstreamCalls).toHaveLength(1);

    const call = upstreamCalls[0]!;
    expect(call.method).toBe("POST");
    expect(call.url).toBe("/api/v1/auth/login");
    expect(call.body).toBe(syntheticBody);
    expect(call.headers.origin).toBe(upstreamOrigin);
    expect(call.headers.host).toBe(new URL(upstreamOrigin).host);
    expect(call.headers.authorization).toBe("Bearer synthetic-token-xyz");
  });

  it("blocks foreign Origin with 403 and never forwards to upstream", async () => {
    const response = await fetch(`${frontendOrigin}/api/v1/auth/login`, {
      method: "POST",
      headers: {
        host: new URL(frontendOrigin).host,
        origin: "https://foreign.invalid",
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: "attacker@invalid" }),
    });

    expect(response.status).toBe(403);
    expect(upstreamCalls).toHaveLength(0);

    const data = (await response.json()) as any;
    expect(data.error?.code).toBe("FORBIDDEN");
  });

  it("blocks null Origin with 403 and never forwards to upstream", async () => {
    const response = await fetch(`${frontendOrigin}/api/v1/auth/login`, {
      method: "POST",
      headers: {
        host: new URL(frontendOrigin).host,
        origin: "null",
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: "attacker@invalid" }),
    });

    expect(response.status).toBe(403);
    expect(upstreamCalls).toHaveLength(0);
  });

  it("blocks requests with mismatched Host header with 403", async () => {
    const frontendUrl = new URL(frontendOrigin);
    const res = await new Promise<{ statusCode?: number }>((resolve, reject) => {
      const clientReq = httpRequest(
        {
          hostname: frontendUrl.hostname,
          port: frontendUrl.port,
          path: "/api/v1/auth/login",
          method: "POST",
          headers: {
            host: "evil.domain.invalid:5173",
            origin: frontendOrigin,
            "content-type": "application/json",
          },
        },
        (clientRes) => {
          clientRes.resume();
          clientRes.on("end", () => resolve({ statusCode: clientRes.statusCode }));
        }
      );
      clientReq.on("error", reject);
      clientReq.write(JSON.stringify({ email: "test@local.invalid" }));
      clientReq.end();
    });

    expect(res.statusCode).toBe(403);
    expect(upstreamCalls).toHaveLength(0);
  });

  it("blocks OPTIONS request (no CORS preflight allowed) with 403", async () => {
    const response = await fetch(`${frontendOrigin}/api/v1/auth/login`, {
      method: "OPTIONS",
      headers: {
        host: new URL(frontendOrigin).host,
        origin: frontendOrigin,
      },
    });

    expect(response.status).toBe(403);
    expect(upstreamCalls).toHaveLength(0);
  });

  it("blocks request without Origin when Sec-Fetch-Site is cross-site", async () => {
    const response = await fetch(`${frontendOrigin}/api/v1/auth/login`, {
      method: "POST",
      headers: {
        host: new URL(frontendOrigin).host,
        "sec-fetch-site": "cross-site",
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: "test@local.invalid" }),
    });

    expect(response.status).toBe(403);
    expect(upstreamCalls).toHaveLength(0);
  });

  it("allows requests from valid preview origin (4173)", async () => {
    const response = await fetch(`${frontendOrigin}/api/v1/runs`, {
      method: "GET",
      headers: {
        host: new URL(previewOrigin).host,
        origin: previewOrigin,
      },
    });

    expect(response.status).toBe(200);
    expect(upstreamCalls).toHaveLength(1);
    expect(upstreamCalls[0]!.headers.origin).toBe(upstreamOrigin);
  });
});
