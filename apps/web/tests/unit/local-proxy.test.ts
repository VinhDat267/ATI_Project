import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer as createHttpServer, request as httpRequest, type Server } from "node:http";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { createServer as createViteDevServer } from "vite";
import {
  validateProxyTarget,
  validateFrontendOrigin,
  createProxyGuard,
  createProxyForwarder,
  localProxy,
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

describe("localProxy independent dev and preview boundaries", () => {
  let upstreamServer: Server;
  let devServer: Server;
  let previewServer: Server;
  let upstreamOrigin: string;
  let devOrigin: string;
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
    upstreamServer = createHttpServer((req, res) => {
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

    // Independent dev server on port 0
    devServer = createHttpServer();
    await new Promise<void>((resolve) => {
      devServer.listen(0, "127.0.0.1", () => resolve());
    });
    const devAddress = devServer.address();
    if (!devAddress || typeof devAddress === "string") {
      throw new Error("Failed to start dev server");
    }
    devOrigin = `http://127.0.0.1:${devAddress.port}`;

    // Independent preview server on port 0
    previewServer = createHttpServer();
    await new Promise<void>((resolve) => {
      previewServer.listen(0, "127.0.0.1", () => resolve());
    });
    const previewAddress = previewServer.address();
    if (!previewAddress || typeof previewAddress === "string") {
      throw new Error("Failed to start preview server");
    }
    previewOrigin = `http://127.0.0.1:${previewAddress.port}`;

    // Dev server forwarder strictly bound to devOrigin only
    const devForwarder = createProxyForwarder({
      target: upstreamOrigin,
      frontendOrigin: devOrigin,
    });
    devServer.on("request", (req, res) => {
      devForwarder(req, res);
    });

    // Preview server forwarder strictly bound to previewOrigin only
    const previewForwarder = createProxyForwarder({
      target: upstreamOrigin,
      frontendOrigin: previewOrigin,
    });
    previewServer.on("request", (req, res) => {
      previewForwarder(req, res);
    });
  });

  afterEach(async () => {
    await Promise.all([
      new Promise<void>((resolve) => upstreamServer.close(() => resolve())),
      new Promise<void>((resolve) => devServer.close(() => resolve())),
      new Promise<void>((resolve) => previewServer.close(() => resolve())),
    ]);
  });

  it("dev server accepts matching dev Host and dev Origin", async () => {
    const syntheticBody = JSON.stringify({
      email: "synthetic@local.invalid",
      password: "synthetic-password-hash",
    });

    const response = await fetch(`${devOrigin}/api/v1/auth/login`, {
      method: "POST",
      headers: {
        host: new URL(devOrigin).host,
        origin: devOrigin,
        "content-type": "application/json",
        authorization: "Bearer synthetic-token-xyz",
      },
      body: syntheticBody,
    });

    expect(response.status).toBe(200);
    expect(upstreamCalls).toHaveLength(1);
    expect(upstreamCalls[0]!.headers.origin).toBe(upstreamOrigin);
    expect(upstreamCalls[0]!.headers.host).toBe(new URL(upstreamOrigin).host);
  });

  it("dev server rejects preview Origin (Host dev + Origin preview)", async () => {
    const response = await fetch(`${devOrigin}/api/v1/auth/login`, {
      method: "POST",
      headers: {
        host: new URL(devOrigin).host,
        origin: previewOrigin,
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: "test@local.invalid" }),
    });

    expect(response.status).toBe(403);
    expect(upstreamCalls).toHaveLength(0);
  });

  it("dev server rejects preview Host (Host preview + Origin dev)", async () => {
    const devUrl = new URL(devOrigin);
    const res = await new Promise<{ statusCode?: number }>((resolve, reject) => {
      const clientReq = httpRequest(
        {
          hostname: devUrl.hostname,
          port: devUrl.port,
          path: "/api/v1/auth/login",
          method: "POST",
          headers: {
            host: new URL(previewOrigin).host,
            origin: devOrigin,
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

  it("dev server rejects preview Host and preview Origin", async () => {
    const devUrl = new URL(devOrigin);
    const res = await new Promise<{ statusCode?: number }>((resolve, reject) => {
      const clientReq = httpRequest(
        {
          hostname: devUrl.hostname,
          port: devUrl.port,
          path: "/api/v1/auth/login",
          method: "POST",
          headers: {
            host: new URL(previewOrigin).host,
            origin: previewOrigin,
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

  it("preview server accepts matching preview Host and preview Origin", async () => {
    const response = await fetch(`${previewOrigin}/api/v1/runs`, {
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

  it("preview server rejects dev Origin (Host preview + Origin dev)", async () => {
    const response = await fetch(`${previewOrigin}/api/v1/runs`, {
      method: "GET",
      headers: {
        host: new URL(previewOrigin).host,
        origin: devOrigin,
      },
    });

    expect(response.status).toBe(403);
    expect(upstreamCalls).toHaveLength(0);
  });

  it("preview server rejects dev Host (Host dev + Origin preview)", async () => {
    const previewUrl = new URL(previewOrigin);
    const res = await new Promise<{ statusCode?: number }>((resolve, reject) => {
      const clientReq = httpRequest(
        {
          hostname: previewUrl.hostname,
          port: previewUrl.port,
          path: "/api/v1/runs",
          method: "GET",
          headers: {
            host: new URL(devOrigin).host,
            origin: previewOrigin,
          },
        },
        (clientRes) => {
          clientRes.resume();
          clientRes.on("end", () => resolve({ statusCode: clientRes.statusCode }));
        }
      );
      clientReq.on("error", reject);
      clientReq.end();
    });

    expect(res.statusCode).toBe(403);
    expect(upstreamCalls).toHaveLength(0);
  });

  it("blocks foreign Origin with 403 and never forwards to upstream", async () => {
    const response = await fetch(`${devOrigin}/api/v1/auth/login`, {
      method: "POST",
      headers: {
        host: new URL(devOrigin).host,
        origin: "https://foreign.invalid",
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: "attacker@invalid" }),
    });

    expect(response.status).toBe(403);
    expect(upstreamCalls).toHaveLength(0);
  });

  it("blocks null Origin with 403 and never forwards to upstream", async () => {
    const response = await fetch(`${devOrigin}/api/v1/auth/login`, {
      method: "POST",
      headers: {
        host: new URL(devOrigin).host,
        origin: "null",
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: "attacker@invalid" }),
    });

    expect(response.status).toBe(403);
    expect(upstreamCalls).toHaveLength(0);
  });

  it("blocks OPTIONS request (no CORS preflight allowed) with 403", async () => {
    const response = await fetch(`${devOrigin}/api/v1/auth/login`, {
      method: "OPTIONS",
      headers: {
        host: new URL(devOrigin).host,
        origin: devOrigin,
      },
    });

    expect(response.status).toBe(403);
    expect(upstreamCalls).toHaveLength(0);
  });

  it("blocks request without Origin when Sec-Fetch-Site is cross-site", async () => {
    const response = await fetch(`${devOrigin}/api/v1/auth/login`, {
      method: "POST",
      headers: {
        host: new URL(devOrigin).host,
        "sec-fetch-site": "cross-site",
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: "test@local.invalid" }),
    });

    expect(response.status).toBe(403);
    expect(upstreamCalls).toHaveLength(0);
  });
});

describe("Vite server integration with localProxy plugin", () => {
  let upstreamServer: Server;
  let upstreamOrigin: string;
  let tempDir: string;
  const upstreamCalls: Array<{
    method: string;
    url: string;
    headers: Record<string, string | string[] | undefined>;
    body: string;
  }> = [];

  beforeEach(async () => {
    upstreamCalls.length = 0;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ati-vite-proxy-test-"));
    fs.writeFileSync(
      path.join(tempDir, "index.html"),
      "<!doctype html><html><body>Test</body></html>"
    );

    upstreamServer = createHttpServer((req, res) => {
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
        res.end(JSON.stringify({ ok: true, source: "mock-api" }));
      });
    });

    await new Promise<void>((resolve) => {
      upstreamServer.listen(0, "127.0.0.1", () => resolve());
    });

    const addr = upstreamServer.address();
    if (!addr || typeof addr === "string") throw new Error("Upstream failed");
    upstreamOrigin = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    if (upstreamServer) {
      await new Promise<void>((resolve) => upstreamServer.close(() => resolve()));
    }
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("forwards requests through real Vite dev server and enforces origin guard", async () => {
    let viteServer: any;
    try {
      viteServer = await createViteDevServer({
        root: tempDir,
        configFile: false,
        server: {
          host: "127.0.0.1",
          port: 0,
        },
        plugins: [localProxy({ target: upstreamOrigin })],
      });

      await viteServer.listen();
      const vitePort = viteServer.httpServer.address().port;
      const viteOrigin = `http://127.0.0.1:${vitePort}`;

      // 1. Valid request to Vite dev server
      const validRes = await fetch(`${viteOrigin}/api/v1/auth/login`, {
        method: "POST",
        headers: {
          host: `127.0.0.1:${vitePort}`,
          origin: viteOrigin,
          "content-type": "application/json",
          authorization: "Bearer test-bearer-token",
        },
        body: JSON.stringify({ email: "real-vite@test.invalid" }),
      });

      expect(validRes.status).toBe(200);
      expect(upstreamCalls).toHaveLength(1);
      expect(upstreamCalls[0]!.headers.origin).toBe(upstreamOrigin);
      expect(upstreamCalls[0]!.headers.authorization).toBe("Bearer test-bearer-token");

      // 2. Request with foreign Origin to Vite dev server -> 403, upstream NOT called
      const invalidRes = await fetch(`${viteOrigin}/api/v1/auth/login`, {
        method: "POST",
        headers: {
          host: `127.0.0.1:${vitePort}`,
          origin: "https://foreign-attacker.invalid",
          "content-type": "application/json",
        },
        body: JSON.stringify({ email: "real-vite@test.invalid" }),
      });

      expect(invalidRes.status).toBe(403);
      expect(upstreamCalls).toHaveLength(1); // Still 1, no new call
    } finally {
      if (viteServer) {
        await viteServer.close();
      }
    }
  });
});