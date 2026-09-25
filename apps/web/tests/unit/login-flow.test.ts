import { describe, expect, it, vi } from "vitest";
import { createHttpTransport } from "../../src/core/api.js";
import {
  ClientError,
  formatBusinessFieldName,
  formatChecklistSummary,
  formatErrorClass,
  toBusinessErrorMessage,
} from "../../src/core/errors.js";
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

  it("translates technical error codes, raw English server messages, and snake_case fields into business Vietnamese", () => {
    expect(toBusinessErrorMessage("NOT_FOUND", "INTAKE_ERROR", 422)).toBe(
      "Không tìm thấy mã yêu cầu này trong bảng dữ liệu nguồn. Vui lòng kiểm tra lại Mã yêu cầu hoặc Trang tính.",
    );
    expect(toBusinessErrorMessage("HEADERS", "INTAKE_ERROR", 422)).toBe(
      "Bảng dữ liệu nguồn chưa đúng mẫu quy định (thiếu các cột thông tin bắt buộc).",
    );
    expect(toBusinessErrorMessage("A run is already active", "ACTIVE_RUN", 409)).toBe(
      "Hệ thống đang xử lý một yêu cầu khác. Vui lòng hoàn tất hoặc phê duyệt yêu cầu đang chờ trước khi tạo yêu cầu mới.",
    );
    expect(toBusinessErrorMessage("Invalid credentials", "INVALID_CREDENTIALS", 401)).toBe(
      "Email hoặc mật khẩu chưa chính xác. Vui lòng kiểm tra lại thông tin đăng nhập.",
    );
    expect(
      toBusinessErrorMessage(
        "CHANNEL_NOT_FOUND: Không tìm thấy nơi nhận thông báo.",
        undefined,
        400,
      ),
    ).toBe("Không tìm thấy nơi nhận thông báo.");

    expect(formatBusinessFieldName("due_date")).toBe("Hạn hoàn thành");
    expect(formatBusinessFieldName("dimensions")).toBe("Kích thước thiết kế");
    expect(formatChecklistSummary("Checklist passed for design_asset", [], [])).toBe(
      "Đầy đủ thông tin cho yêu cầu thiết kế ấn phẩm",
    );
    expect(formatErrorClass("bad_args")).toBe("Thông tin nơi nhận hoặc tham số chưa hợp lệ");
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

