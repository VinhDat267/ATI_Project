import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHttpTransport } from "../../src/core/api.js";
import { ClientError } from "../../src/core/errors.js";

describe("createHttpTransport", () => {
  const originalFetch = globalThis.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;
  let token: string | null = "test-token-123";

  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    token = "test-token-123";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const createTransport = () =>
    createHttpTransport({
      baseUrl: "http://127.0.0.1:3001",
      getToken: () => token,
    });

  it("login sends POST /api/v1/auth/login and parses token", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ token: "auth-jwt-token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const transport = createTransport();
    const result = await transport.login(
      "user@example.com",
      "password123",
      new AbortController().signal,
    );

    expect(result).toBe("auth-jwt-token");
    expect(mockFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:3001/api/v1/auth/login",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          email: "user@example.com",
          password: "password123",
        }),
      }),
    );
  });

  it("list sends GET /api/v1/runs with Authorization header and parses runs", async () => {
    const fakeRuns = [
      {
        run_id: "00000000-0000-0000-0000-000000000001",
        status: "planning",
        workflow_version_id: null,
        plan: null,
        planner_result: null,
        approval: null,
        time_zone: "Asia/Ho_Chi_Minh",
        runtime: {},
        last_seq: 0,
      },
    ];

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(fakeRuns), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const transport = createTransport();
    const runs = await transport.list(new AbortController().signal);

    expect(runs).toHaveLength(1);
    expect(runs[0]?.run_id).toBe("00000000-0000-0000-0000-000000000001");
    expect(mockFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:3001/api/v1/runs",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          authorization: "Bearer test-token-123",
        }),
      }),
    );
  });

  it("maps HTTP error responses with ApiErrorSchema into ClientError", async () => {
    const errorBody = {
      error: {
        code: "INVALID_CREDENTIALS",
        message: "Email hoặc mật khẩu không chính xác",
        request_id: "11111111-1111-1111-1111-111111111111",
      },
    };

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(errorBody), {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          "x-request-id": "11111111-1111-1111-1111-111111111111",
        },
      }),
    );

    const transport = createTransport();
    let thrown: unknown;
    try {
      await transport.login("bad@example.com", "wrong", new AbortController().signal);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(ClientError);
    const clientErr = thrown as ClientError;
    expect(clientErr.kind).toBe("http");
    expect(clientErr.status).toBe(401);
    expect(clientErr.code).toBe("INVALID_CREDENTIALS");
    expect(clientErr.message).toBe("Email hoặc mật khẩu không chính xác");
    expect(clientErr.requestId).toBe("11111111-1111-1111-1111-111111111111");
    expect(clientErr.uncertain).toBe(false);
  });

  it("marks write requests as uncertain when network fails", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const transport = createTransport();
    let thrown: unknown;
    try {
      await transport.create(
        { source_prompt: "Test prompt" },
        new AbortController().signal,
      );
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(ClientError);
    const clientErr = thrown as ClientError;
    expect(clientErr.kind).toBe("network");
    expect(clientErr.uncertain).toBe(true);
  });

  it("marks read requests as NOT uncertain when network fails", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const transport = createTransport();
    let thrown: unknown;
    try {
      await transport.list(new AbortController().signal);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(ClientError);
    const clientErr = thrown as ClientError;
    expect(clientErr.kind).toBe("network");
    expect(clientErr.uncertain).toBe(false);
  });

  it("maps malformed server payloads to protocol ClientError", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ not_a_token: 123 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const transport = createTransport();
    let thrown: unknown;
    try {
      await transport.login("user@example.com", "pwd", new AbortController().signal);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(ClientError);
    const clientErr = thrown as ClientError;
    expect(clientErr.kind).toBe("protocol");
  });

  it("cancel sends POST /api/v1/runs/:id/cancel and returns void", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(null, {
        status: 202,
      }),
    );

    const transport = createTransport();
    await expect(
      transport.cancel("00000000-0000-0000-0000-000000000001", new AbortController().signal),
    ).resolves.toBeUndefined();

    expect(mockFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:3001/api/v1/runs/00000000-0000-0000-0000-000000000001/cancel",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("events sends GET /api/v1/runs/:id/events?since_seq=... and parses event page", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          events: [],
          next_seq: 10,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const transport = createTransport();
    const result = await transport.events(
      "00000000-0000-0000-0000-000000000001",
      5,
      new AbortController().signal,
    );

    expect(result.next_seq).toBe(10);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:3001/api/v1/runs/00000000-0000-0000-0000-000000000001/events?since_seq=5",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("maps abort signal to aborted ClientError", async () => {
    const controller = new AbortController();
    controller.abort();

    const transport = createTransport();
    let thrown: unknown;
    try {
      await transport.list(controller.signal);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(ClientError);
    const clientErr = thrown as ClientError;
    expect(clientErr.kind).toBe("aborted");
    expect(clientErr.uncertain).toBe(false);
  });
});
