import { describe, expect, it, vi } from "vitest";
import { createHttpTransport } from "../../src/core/api.js";
import { ClientError } from "../../src/core/errors.js";
import { createSession } from "../../src/core/session.js";
import type { Transport } from "../../src/core/contracts.js";

describe("Login Flow & Error Mapping", () => {
  it("session.setToken updates session and getToken returns active token", async () => {
    const session = createSession();
    expect(session.getToken()).toBeNull();

    session.setToken("valid-auth-token");
    expect(session.getToken()).toBe("valid-auth-token");
  });

  it("fences late login success if session was cleared before response", async () => {
    const session = createSession();
    let resolveLogin!: (token: string) => void;
    const pendingPromise = new Promise<string>((resolve) => {
      resolveLogin = resolve;
    });

    const mockTransport: Partial<Transport> = {
      login: vi.fn().mockImplementation(() => pendingPromise),
    };

    const scope = session.beginRequest();
    expect(scope.isCurrent()).toBe(true);

    // User or app clears session / cancels while request is in flight
    session.clear();

    expect(scope.isCurrent()).toBe(false);
    expect(scope.signal.aborted).toBe(true);

    // Late response arrives
    resolveLogin("late-token");
    const token = await pendingPromise;

    // The token must NOT be applied to the session because scope is no longer current
    if (scope.isCurrent()) {
      session.setToken(token);
    }

    expect(session.getToken()).toBeNull();
  });

  it("distinguishes 401, 429, and network errors properly", () => {
    const err401 = new ClientError({
      message: "Email hoặc mật khẩu không chính xác",
      kind: "http",
      status: 401,
      code: "INVALID_CREDENTIALS",
    });
    expect(err401.status).toBe(401);
    expect(err401.kind).toBe("http");

    const err429 = new ClientError({
      message: "Quá nhiều yêu cầu",
      kind: "http",
      status: 429,
      code: "RATE_LIMITED",
    });
    expect(err429.status).toBe(429);

    const netErr = new ClientError({
      message: "Không thể kết nối",
      kind: "network",
    });
    expect(netErr.kind).toBe("network");
  });

  it("createHttpTransport integrates with session.getToken()", async () => {
    const session = createSession();
    session.setToken("active-token-999");

    const originalFetch = globalThis.fetch;
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    try {
      const transport = createHttpTransport({
        getToken: () => session.getToken(),
      });

      await transport.list(new AbortController().signal);

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/v1/runs",
        expect.objectContaining({
          headers: expect.objectContaining({
            authorization: "Bearer active-token-999",
          }),
        }),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
