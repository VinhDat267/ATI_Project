import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import {
  validateRelativePath,
  readBoundedUtf8,
  validateWriteText,
  inspectFilesystemPath,
} from "../src/filesystem-paths.js";
import { captureFilesystemArtifact } from "../src/launch-policy.js";

function probeNativeCapability(kind: "file" | "junction" | "hardlink"): {
  available: boolean;
  error?: string;
} {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "ati-cap-probe-"));
  const target = path.join(base, "target.txt");
  fs.writeFileSync(target, "content");
  const link = path.join(base, "link");
  try {
    if (kind === "hardlink") {
      fs.linkSync(target, link);
    } else if (kind === "junction") {
      fs.symlinkSync(base, link, "junction");
    } else {
      fs.symlinkSync(target, link, "file");
    }
    return { available: true };
  } catch (err: any) {
    return { available: false, error: err.code || err.message };
  } finally {
    try {
      fs.rmSync(base, { recursive: true, force: true });
    } catch {}
  }
}

const fileSymlinkCap = probeNativeCapability("file");
const junctionCap = probeNativeCapability("junction");
const hardlinkCap = probeNativeCapability("hardlink");

describe("filesystem-paths policy and containment", () => {
  let tempDir: string;
  let outsideDir: string;
  let sentinelFile: string;
  const userId = "00000000-0000-4000-8000-000000000001";
  const rootId = "11111111-1111-4000-8000-111111111111";

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ati-fs-test-"));
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "ati-fs-outside-"));
    sentinelFile = path.join(outsideDir, "sentinel.txt");
    fs.writeFileSync(sentinelFile, "SENTINEL_OK", "utf8");

    // Write valid root marker
    fs.writeFileSync(
      path.join(tempDir, ".ati-root.json"),
      JSON.stringify(
        {
          format: "ati-filesystem-root-1",
          root_id: rootId,
          user_id: userId,
        },
        null,
        2
      ),
      "utf8"
    );
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
    try {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    } catch {}
  });

  describe("lexical validateRelativePath", () => {
    it.each([
      "../x",
      "a/../x",
      "/x",
      "C:/x",
      "C:x",
      "a\\x",
      "//host/x",
      "a//b",
      "./a",
      "a:stream",
      "CON.txt",
      "COM¹.txt",
      "x.",
      "x ",
      ".ati-root.json",
      "a/%2e%2e/x",
      "a\u0000b",
      "NUL",
      "PRN.log",
      "LPT²",
      "dir /file",
      "dir./file",
      "",
    ])("rejects unsafe path %s", (value) => {
      expect(() => validateRelativePath(value)).toThrow();
    });

    it("keeps Vietnamese relative paths byte-for-byte", () => {
      expect(validateRelativePath("báo cáo/tiến độ.txt")).toBe(
        "báo cáo/tiến độ.txt"
      );
    });

    it("accepts valid alphanumeric paths with internal spaces, hyphens, and dots", () => {
      expect(validateRelativePath("reports/q1 2026/summary-v1.0.txt")).toBe(
        "reports/q1 2026/summary-v1.0.txt"
      );
    });
  });

  describe("readBoundedUtf8 and validateWriteText", () => {
    it("P17: preserves exact UTF-8 Vietnamese + emoji + BOM + CRLF", async () => {
      const filePath = path.join(tempDir, "utf8.txt");
      const content = "\uFEFFTiến độ: Hoàn tất 🚀\r\nChi tiết: Tốt\r\n";
      fs.writeFileSync(filePath, Buffer.from(content, "utf8"));

      const read = await readBoundedUtf8(filePath);
      expect(read).toBe(content);
    });

    it("P18: accepts exactly 65,536 bytes; rejects 65,537 bytes", async () => {
      const exactPath = path.join(tempDir, "exact-limit.txt");
      const exactBuf = Buffer.alloc(65536, 0x61); // 'a'
      fs.writeFileSync(exactPath, exactBuf);
      const exactRead = await readBoundedUtf8(exactPath);
      expect(exactRead.length).toBe(65536);

      const overPath = path.join(tempDir, "over-limit.txt");
      const overBuf = Buffer.alloc(65537, 0x61);
      fs.writeFileSync(overPath, overBuf);
      await expect(readBoundedUtf8(overPath)).rejects.toThrow("PAYLOAD_TOO_LARGE");
    });

    it("P19: rejects invalid UTF-8 byte sequences and NUL bytes in file", async () => {
      const invalidPath = path.join(tempDir, "invalid-utf8.bin");
      fs.writeFileSync(invalidPath, Buffer.from([0xff, 0xfe, 0xfd]));
      await expect(readBoundedUtf8(invalidPath)).rejects.toThrow("BAD_CONTENT");

      const nulPath = path.join(tempDir, "nul-byte.txt");
      fs.writeFileSync(nulPath, Buffer.from("hello\u0000world", "utf8"));
      await expect(readBoundedUtf8(nulPath)).rejects.toThrow("BAD_CONTENT");
    });

    it("P20a: accepts valid clean text in readBoundedUtf8", async () => {
      const validPath = path.join(tempDir, "valid.txt");
      fs.writeFileSync(validPath, "clean text", "utf8");
      expect(await readBoundedUtf8(validPath)).toBe("clean text");
    });

    it("P20b: rejects lone surrogate byte sequences (CESU-8 surrogate halves) in readBoundedUtf8", async () => {
      const surrogatePath = path.join(tempDir, "surrogate-bytes.bin");
      // CESU-8 surrogate byte sequence for U+D800: 0xED, 0xA0, 0x80
      fs.writeFileSync(surrogatePath, Buffer.from([0xed, 0xa0, 0x80]));
      await expect(readBoundedUtf8(surrogatePath)).rejects.toThrow("BAD_CONTENT");
    });

    it("R5a: handles legal short reads in a loop across chunk boundaries", async () => {
      const shortFile = path.join(tempDir, "short-read.txt");
      const fullContent = "Hello, thế giới! 🚀 Bounded reading loop test.";
      fs.writeFileSync(shortFile, fullContent, "utf8");

      const originalOpen = fs.promises.open;
      try {
        fs.promises.open = async (...args: any[]) => {
          const handle = await (originalOpen as any).apply(fs.promises, args);
          const originalRead = handle.read.bind(handle);
          handle.read = (buf: any, offset: any, length: any, position: any) =>
            originalRead(buf, offset, Math.min(3, length), position);
          return handle;
        };

        const result = await readBoundedUtf8(shortFile);
        expect(result).toBe(fullContent);
      } finally {
        fs.promises.open = originalOpen;
      }
    });

    it("R5b: rejects over-limit file (>65,536 bytes) when read in small chunks", async () => {
      const overPath = path.join(tempDir, "short-chunks-over-limit.txt");
      fs.writeFileSync(overPath, Buffer.alloc(65537, 0x62));

      const originalOpen = fs.promises.open;
      try {
        fs.promises.open = async (...args: any[]) => {
          const handle = await (originalOpen as any).apply(fs.promises, args);
          const originalRead = handle.read.bind(handle);
          handle.read = (buf: any, offset: any, length: any, position: any) =>
            originalRead(buf, offset, Math.min(1024, length), position);
          return handle;
        };

        await expect(readBoundedUtf8(overPath)).rejects.toThrow("PAYLOAD_TOO_LARGE");
      } finally {
        fs.promises.open = originalOpen;
      }
    });

    it("R5c: rejects file with invalid UTF-8 suffix or NUL byte reached in later chunks", async () => {
      const invalidSuffixPath = path.join(tempDir, "short-chunks-invalid-suffix.bin");
      const prefix = Buffer.from("prefix data that is valid ");
      const invalidSuffix = Buffer.from([0xff, 0xfe]);
      fs.writeFileSync(invalidSuffixPath, Buffer.concat([prefix, invalidSuffix]));

      const originalOpen = fs.promises.open;
      try {
        fs.promises.open = async (...args: any[]) => {
          const handle = await (originalOpen as any).apply(fs.promises, args);
          const originalRead = handle.read.bind(handle);
          handle.read = (buf: any, offset: any, length: any, position: any) =>
            originalRead(buf, offset, Math.min(3, length), position);
          return handle;
        };

        await expect(readBoundedUtf8(invalidSuffixPath)).rejects.toThrow("BAD_CONTENT");
      } finally {
        fs.promises.open = originalOpen;
      }
    });

    it("validateWriteText rejects lone surrogates, NUL bytes, and oversized strings", () => {
      expect(() => validateWriteText("a\uD800b")).toThrow("lone surrogates");
      expect(() => validateWriteText("a\u0000b")).toThrow("NUL");
      expect(() => validateWriteText("a".repeat(65537))).toThrow("limit");
      expect(() => validateWriteText("valid content 👍")).not.toThrow();
    });
  });

  describe("inspectFilesystemPath boundary matrix P01–P24 and review findings", () => {
    it("P01–P03: accepts valid relative Vietnamese path and preserved empty file", async () => {
      const validRel = "tài liệu/báo cáo.txt";
      const fullDir = path.join(tempDir, "tài liệu");
      fs.mkdirSync(fullDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, validRel), "Nội dung báo cáo", "utf8");

      const res = await inspectFilesystemPath(tempDir, validRel, "read", userId);
      expect(res.relative).toBe(validRel);
      expect(res.expectedReadText).toBe("Nội dung báo cáo");

      // Empty file preserved
      const emptyRel = "empty.txt";
      fs.writeFileSync(path.join(tempDir, emptyRel), "", "utf8");
      const emptyRes = await inspectFilesystemPath(
        tempDir,
        emptyRel,
        "read",
        userId
      );
      expect(emptyRes.expectedReadText).toBe("");
    });

    it("P04–P07: rejects traversal and escapes; outside sentinel remains unchanged", async () => {
      await expect(
        inspectFilesystemPath(tempDir, "../outside.txt", "read", userId)
      ).rejects.toThrow();
      expect(fs.readFileSync(sentinelFile, "utf8")).toBe("SENTINEL_OK");
    });

    it("P08–P10: rejects reserved names, trailing space/dot, and hidden marker file", async () => {
      await expect(
        inspectFilesystemPath(tempDir, "CON.txt", "read", userId)
      ).rejects.toThrow();
      await expect(
        inspectFilesystemPath(tempDir, "invalid.txt.", "read", userId)
      ).rejects.toThrow();
      await expect(
        inspectFilesystemPath(tempDir, ".ati-root.json", "read", userId)
      ).rejects.toThrow();
    });

    it("P11: rejects outside symlink", (ctx) => {
      if (!fileSymlinkCap.available) {
        ctx.skip();
        return;
      }
      const linkPath = path.join(tempDir, "symlink-outside.txt");
      fs.symlinkSync(sentinelFile, linkPath, "file");

      return expect(
        inspectFilesystemPath(tempDir, "symlink-outside.txt", "read", userId)
      ).rejects.toThrow();
    });

    it("P12: rejects junction pointing outside", async () => {
      expect(junctionCap.available).toBe(true);
      const junctionPath = path.join(tempDir, "junction-outside");
      fs.symlinkSync(outsideDir, junctionPath, "junction");

      await expect(
        inspectFilesystemPath(tempDir, "junction-outside/sentinel.txt", "read", userId)
      ).rejects.toThrow();
      expect(fs.readFileSync(sentinelFile, "utf8")).toBe("SENTINEL_OK");
    });

    it("P13: rejects dangling junction in read and write modes", async () => {
      expect(junctionCap.available).toBe(true);
      const danglingPath = path.join(tempDir, "dangling-junction");
      fs.symlinkSync(path.join(outsideDir, "missing-target"), danglingPath, "junction");

      await expect(
        inspectFilesystemPath(tempDir, "dangling-junction", "read", userId)
      ).rejects.toThrow(/SYMLINK_REJECTED/);

      await expect(
        inspectFilesystemPath(tempDir, "dangling-junction", "write", userId)
      ).rejects.toThrow(/SYMLINK_REJECTED/);
    });

    it("P14: rejects hardlinks where nlink > 1", async () => {
      expect(hardlinkCap.available).toBe(true);
      const file1 = path.join(tempDir, "file1.txt");
      fs.writeFileSync(file1, "content", "utf8");
      const file2 = path.join(tempDir, "file2.txt");
      fs.linkSync(file1, file2);

      await expect(
        inspectFilesystemPath(tempDir, "file1.txt", "read", userId)
      ).rejects.toThrow(/HARDLINK_REJECTED/);
    });

    it("P15–P16: rejects directory targeted as file, and missing parent for write", async () => {
      const dirPath = path.join(tempDir, "somedir");
      fs.mkdirSync(dirPath);
      await expect(
        inspectFilesystemPath(tempDir, "somedir", "read", userId)
      ).rejects.toThrow(/NOT_REGULAR_FILE/);

      await expect(
        inspectFilesystemPath(tempDir, "nonexistent-dir/new.txt", "write", userId)
      ).rejects.toThrow(/PARENT_NOT_FOUND|DIRECTORY_NOT_FOUND/);
    });

    it("P16: accepts missing leaf in existing parent for write mode", async () => {
      const subDir = path.join(tempDir, "subfolder");
      fs.mkdirSync(subDir);
      const res = await inspectFilesystemPath(
        tempDir,
        "subfolder/new-leaf.txt",
        "write",
        userId
      );
      expect(res.relative).toBe("subfolder/new-leaf.txt");
      expect(res.canonicalRoot).toBe(fs.realpathSync(tempDir));
      expect(res.rootId).toBe(rootId);
    });

    it("R1: rejects root directory itself being a junction or symlink", async () => {
      expect(junctionCap.available).toBe(true);
      const linkedRoot = path.join(outsideDir, "linked-root");
      fs.symlinkSync(tempDir, linkedRoot, "junction");

      await expect(
        inspectFilesystemPath(linkedRoot, "notes.txt", "read", userId)
      ).rejects.toThrow(/BAD_ROOT/);
    });

    it("R1: rejects ancestor directory of root being a junction or symlink", async () => {
      expect(junctionCap.available).toBe(true);
      const actualParent = path.join(outsideDir, "actual-parent");
      fs.mkdirSync(actualParent);
      const childDir = path.join(actualParent, "child-root");
      fs.mkdirSync(childDir);
      fs.writeFileSync(
        path.join(childDir, ".ati-root.json"),
        JSON.stringify({ format: "ati-filesystem-root-1", root_id: rootId, user_id: userId })
      );
      fs.writeFileSync(path.join(childDir, "notes.txt"), "ANCESTOR_SENTINEL");

      const linkedParent = path.join(outsideDir, "linked-parent");
      fs.symlinkSync(actualParent, linkedParent, "junction");

      await expect(
        inspectFilesystemPath(path.join(linkedParent, "child-root"), "notes.txt", "read", userId)
      ).rejects.toThrow(/BAD_ROOT/);
    });

    it("R2: rejects dangling junction leaf in write mode", async () => {
      expect(junctionCap.available).toBe(true);
      const danglingWrite = path.join(tempDir, "dangling-write");
      fs.symlinkSync(path.join(outsideDir, "nonexistent-target"), danglingWrite, "junction");

      await expect(
        inspectFilesystemPath(tempDir, "dangling-write", "write", userId)
      ).rejects.toThrow(/SYMLINK_REJECTED/);
    });

    it("R4: rejects root marker with empty or invalid UUID root_id", async () => {
      fs.writeFileSync(
        path.join(tempDir, ".ati-root.json"),
        JSON.stringify({ format: "ati-filesystem-root-1", root_id: "", user_id: userId })
      );
      await expect(
        inspectFilesystemPath(tempDir, "test.txt", "write", userId)
      ).rejects.toThrow(/UNAUTHORIZED_ROOT_MARKER/);

      fs.writeFileSync(
        path.join(tempDir, ".ati-root.json"),
        JSON.stringify({ format: "ati-filesystem-root-1", root_id: "not-a-uuid", user_id: userId })
      );
      await expect(
        inspectFilesystemPath(tempDir, "test.txt", "write", userId)
      ).rejects.toThrow(/UNAUTHORIZED_ROOT_MARKER/);
    });

    it("R4: rejects root marker with extra unexpected fields", async () => {
      fs.writeFileSync(
        path.join(tempDir, ".ati-root.json"),
        JSON.stringify({
          format: "ati-filesystem-root-1",
          root_id: rootId,
          user_id: userId,
          unexpected: true,
        })
      );
      await expect(
        inspectFilesystemPath(tempDir, "test.txt", "write", userId)
      ).rejects.toThrow(/BAD_ROOT_MARKER/);
    });

    it("R4: rejects hardlinked .ati-root.json marker (nlink > 1)", async () => {
      expect(hardlinkCap.available).toBe(true);
      const markerPath = path.join(tempDir, ".ati-root.json");
      const aliasPath = path.join(tempDir, "marker-alias.json");
      fs.linkSync(markerPath, aliasPath);

      await expect(
        inspectFilesystemPath(tempDir, "test.txt", "write", userId)
      ).rejects.toThrow(/HARDLINK_REJECTED/);
    });

    it("P21–P23: rejects wrong principal and preserves other user root untouched", async () => {
      const otherUserId = "22222222-2222-4000-8000-222222222222";
      await expect(
        inspectFilesystemPath(tempDir, "any.txt", "write", otherUserId)
      ).rejects.toThrow("UNAUTHORIZED_ROOT_MARKER");

      expect(fs.readFileSync(sentinelFile, "utf8")).toBe("SENTINEL_OK");
    });

    it("P24a: rejects write when existing file has different Hangul Jamo spelling but identical NFC normalization", async () => {
      const nfcName = "가.txt";
      const nfdName = "가.txt".normalize("NFD");
      expect(nfcName).not.toBe(nfdName);

      // Both nfcName and nfdName pass lexical validation because Jamo are Category Lo (\p{L})
      expect(validateRelativePath(nfcName)).toBe(nfcName);
      expect(validateRelativePath(nfdName)).toBe(nfdName);

      fs.writeFileSync(path.join(tempDir, nfcName), "EXISTING_CONTENT", "utf8");

      // Attempting to inspect write for NFD alias must throw UNICODE_ALIAS_CONFLICT
      await expect(
        inspectFilesystemPath(tempDir, nfdName, "write", userId)
      ).rejects.toThrow(/UNICODE_ALIAS_CONFLICT/);

      // Original file content preserved
      expect(fs.readFileSync(path.join(tempDir, nfcName), "utf8")).toBe(
        "EXISTING_CONTENT"
      );
    });

    it("P24b: rejects Vietnamese NFD with combining marks at lexical stage (BAD_PATH)", () => {
      const vietNfd = "tiến-độ.txt".normalize("NFD");
      expect(() => validateRelativePath(vietNfd)).toThrow("BAD_PATH");
    });
  });

  describe("captureFilesystemArtifact", () => {
    it("captures artifact metadata matching pinned version and files", () => {
      const projectRoot = path.resolve(__dirname, "../../../");
      const artifact = captureFilesystemArtifact(projectRoot);
      expect(artifact.package).toBe("@modelcontextprotocol/server-filesystem");
      expect(artifact.version).toBe("2026.8.31");
      expect(artifact.files.length).toBe(7);
      expect(artifact.entryPath.endsWith("dist/index.js")).toBe(true);
      expect(artifact.nodePath).toBeDefined();
      expect(artifact.nodeVersion).toBe(process.version);
    });
  });
});
