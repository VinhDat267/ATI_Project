import { describe, expect, it } from "vitest";
import { userError } from "../../src/services/user-error";

describe("User-facing error copy", () => {
  it.each([502, 503, 504])("explains a gateway %s without exposing the raw request message", (status) => {
    expect(userError(new Error(`Request failed with status ${status}`))).toBe("Tạm thời không thể kết nối đến máy chủ.");
  });
  it("preserves specific business errors instead of hiding them behind a connection message", () => {
    expect(userError(new Error("Bạn không có quyền cập nhật dịch vụ này."))).toBe("Bạn không có quyền cập nhật dịch vụ này.");
  });
});
