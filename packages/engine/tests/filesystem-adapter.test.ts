import { describe, expect, it } from "vitest";
import {
  normalizeFilesystemReadResult,
  normalizeFilesystemWriteResult,
} from "../src/gateway-filesystem.js";

describe("filesystem adapter output normalization", () => {
  it("maps the reviewed raw content to the public text schema", () => {
    expect(
      normalizeFilesystemReadResult(
        {
          structuredContent: { content: "Tiến độ ATI\n" },
          content: [{ type: "text", text: "Tiến độ ATI\n" }],
        },
        "Tiến độ ATI\n",
      ),
    ).toEqual({ structuredContent: { text: "Tiến độ ATI\n" } });
  });

  it("preserves reviewed upstream errors without text-to-json fallback", () => {
    expect(
      normalizeFilesystemReadResult(
        { isError: true, content: [{ type: "text", text: "NOT_FOUND" }] },
        "ignored",
      ),
    ).toEqual({ isError: true, content: [{ type: "text", text: "NOT_FOUND" }] });
  });

  it.each([
    { structuredContent: { content: "changed" }, content: [{ type: "text", text: "expected" }] },
    { structuredContent: { content: "expected" }, content: [{ type: "text", text: "expected" }, { type: "text", text: "extra" }] },
    { structuredContent: { content: "expected", extra: true }, content: [{ type: "text", text: "expected" }] },
  ])("rejects an unreviewed raw response shape or content drift", (raw) => {
    expect(() => normalizeFilesystemReadResult(raw, "expected")).toThrow();
  });
});

describe("filesystem write acknowledgement normalization", () => {
  it("accepts only the reviewed exact acknowledgement", async () => {
    await expect(
      normalizeFilesystemWriteResult(
        {
          structuredContent: { content: "Successfully wrote to C:/root/report.txt" },
          content: [{ type: "text", text: "Successfully wrote to C:/root/report.txt" }],
        },
        "Successfully wrote to C:/root/report.txt",
      ),
    ).resolves.toEqual({ structuredContent: { acknowledged: true } });
  });

  it("preserves upstream errors and rejects acknowledgement drift", async () => {
    await expect(
      normalizeFilesystemWriteResult(
        { isError: true, content: [{ type: "text", text: "BAD_ARGS" }] },
        "ignored",
      ),
    ).resolves.toEqual({ isError: true, content: [{ type: "text", text: "BAD_ARGS" }] });
    await expect(
      normalizeFilesystemWriteResult(
        {
          structuredContent: { content: "changed" },
          content: [{ type: "text", text: "changed" }],
        },
        "Successfully wrote to C:/root/report.txt",
      ),
    ).rejects.toThrow();
  });
});
