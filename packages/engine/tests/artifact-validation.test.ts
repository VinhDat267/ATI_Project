import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  validateArtifactFiles,
  extractRawSchemaHashes,
} from "../../../scripts/emit-candidate-artifact.mjs";

describe("emit-candidate-artifact validation logic with mock fixtures/doubles", () => {
  const mockBaselineHashes: Record<string, string> = {
    "dist/index.js": "hash_index",
    "dist/lib.js": "hash_lib",
    "dist/path-utils.js": "hash_path_utils",
    "dist/path-validation.js": "hash_path_val",
    "dist/roots-utils.js": "hash_roots",
    "package.json": "hash_pkg",
    "README.md": "hash_readme",
  };

  const validFiles = [
    { path: "dist/index.js", sha256: "hash_index" },
    { path: "dist/lib.js", sha256: "hash_lib" },
    { path: "dist/path-utils.js", sha256: "hash_path_utils" },
    { path: "dist/path-validation.js", sha256: "hash_path_val" },
    { path: "dist/roots-utils.js", sha256: "hash_roots" },
    { path: "package.json", sha256: "hash_pkg" },
    { path: "README.md", sha256: "hash_readme" },
  ];

  it("passes when exact files, count, and hashes match baseline", () => {
    const res = validateArtifactFiles(validFiles, mockBaselineHashes);
    expect(res.length).toBe(7);
    expect(res.every((r) => r.matches)).toBe(true);
  });

  it("fails when a file is missing from the artifact set", () => {
    const missingOne = validFiles.slice(0, 6);
    expect(() =>
      validateArtifactFiles(missingOne, mockBaselineHashes)
    ).toThrow(/FILE_COUNT_MISMATCH|MISSING_FILE/);
  });

  it("fails when an unexpected extra file is present", () => {
    const extra = [
      ...validFiles,
      { path: "unexpected.js", sha256: "some_hash" },
    ];
    expect(() => validateArtifactFiles(extra, mockBaselineHashes)).toThrow(
      /FILE_COUNT_MISMATCH|UNEXPECTED_EXTRA_FILE/
    );
  });

  it("fails when there is a duplicate file entry", () => {
    const duplicate = [
      ...validFiles.slice(0, 6),
      { path: "dist/index.js", sha256: "hash_index" },
    ];
    expect(() =>
      validateArtifactFiles(duplicate, mockBaselineHashes)
    ).toThrow(/DUPLICATE_FILE/);
  });

  it("fails when a file hash does not match baseline", () => {
    const corrupted = validFiles.map((f) =>
      f.path === "dist/index.js" ? { path: f.path, sha256: "wrong_hash" } : f
    );
    expect(() => validateArtifactFiles(corrupted, mockBaselineHashes)).toThrow(
      /HASH_MISMATCH/
    );
  });

  describe("extractRawSchemaHashes probe verification", () => {
    const validProbeData = {
      verdict: "PASS",
      discovered_tools: [
        {
          name: "read_text_file",
          inputSchema: { type: "object" },
          outputSchema: { type: "object" },
        },
        {
          name: "write_file",
          inputSchema: { type: "object" },
          outputSchema: { type: "object" },
        },
        {
          name: "read_file",
          inputSchema: { type: "object" },
          outputSchema: { type: "object" },
        },
      ],
    };

    it("extracts schema hashes when probe verdict is PASS and tools are present", () => {
      const hashes = extractRawSchemaHashes(
        "dummy-path",
        validProbeData
      );
      expect(hashes.read_text_file).toBeDefined();
      expect(hashes.write_file).toBeDefined();
      expect(hashes.read_file).toBeDefined();
    });

    it("rejects probe data when verdict is not PASS", () => {
      const failedProbe = {
        ...validProbeData,
        verdict: "FAIL",
      };
      expect(() =>
        extractRawSchemaHashes("dummy-path", failedProbe)
      ).toThrow(/PROBE_VERDICT_NOT_PASS/);
    });

    it("rejects duplicate tool identities instead of hashing the last entry", () => {
      expect(() => extractRawSchemaHashes("fixture", {
        ...validProbeData,
        discovered_tools: [...validProbeData.discovered_tools, validProbeData.discovered_tools[0]],
      })).toThrow(/DUPLICATE_TOOL/);
    });

    it.each([{ schema: "object" }, { schema: [] }, { schema: true }])("rejects non-object schema $schema", ({ schema }) => {
      expect(() => extractRawSchemaHashes("fixture", {
        ...validProbeData,
        discovered_tools: validProbeData.discovered_tools.map(t =>
          t.name === "write_file" ? { ...t, outputSchema: schema } : t),
      })).toThrow(/INVALID_TOOL_SCHEMA/);
    });

    it("rejects probe data when read_text_file is missing", () => {
      const missingReadText = {
        verdict: "PASS",
        discovered_tools: [
          {
            name: "write_file",
            inputSchema: { type: "object" },
            outputSchema: { type: "object" },
          },
        ],
      };
      expect(() =>
        extractRawSchemaHashes("dummy-path", missingReadText)
      ).toThrow(/MISSING_REQUIRED_TOOL_SCHEMA/);
    });

    it("rejects probe data when write_file is missing", () => {
      const missingWrite = {
        verdict: "PASS",
        discovered_tools: [
          {
            name: "read_text_file",
            inputSchema: { type: "object" },
            outputSchema: { type: "object" },
          },
        ],
      };
      expect(() =>
        extractRawSchemaHashes("dummy-path", missingWrite)
      ).toThrow(/MISSING_REQUIRED_TOOL_SCHEMA/);
    });

    it("rejects when probe file does not exist on disk", () => {
      expect(() =>
        extractRawSchemaHashes("nonexistent-probe-file-xyz.json")
      ).toThrow(/PROBE_FILE_NOT_FOUND/);
    });
  });
});

describe("artifact emitter CLI with isolated package fixtures (no installed package changes)", () => {
  function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ati-artifact-cli-"));
    const pkg = path.join(root, "node_modules/@modelcontextprotocol/server-filesystem");
    fs.mkdirSync(path.join(pkg, "dist"), { recursive: true });
    const files: Record<string, string> = {
      "package.json": JSON.stringify({ name: "@modelcontextprotocol/server-filesystem", version: "2026.8.31", bin: { "mcp-server-filesystem": "dist/index.js" }, dependencies: {} }),
      "README.md": "test fixture only",
      "dist/index.js": "// fixture, never executed",
      "dist/lib.js": "// fixture", "dist/path-utils.js": "// fixture",
      "dist/path-validation.js": "// fixture", "dist/roots-utils.js": "// fixture",
    };
    for (const [file, content] of Object.entries(files)) fs.writeFileSync(path.join(pkg, file), content);
    const hashes = Object.fromEntries(Object.entries(files).map(([file, content]) => [file, crypto.createHash("sha256").update(content).digest("hex")]));
    fs.mkdirSync(path.join(root, "docs/antigravity"), { recursive: true });
    fs.writeFileSync(path.join(root, "docs/antigravity/filesystem-handoff-baseline.json"), JSON.stringify({ candidate_review: { files_sha256: hashes } }));
    const probe = path.join(root, "docs/task-hub-evidence/batch-02/FS-01/1789363214163-codex-r2-probe/filesystem-candidate-probe.json");
    fs.mkdirSync(path.dirname(probe), { recursive: true });
    fs.writeFileSync(probe, JSON.stringify({ verdict: "PASS", discovered_tools: ["read_text_file", "write_file"].map(name => ({ name, inputSchema: { type: "object" }, outputSchema: { type: "object" } })) }));
    const pointer = path.join(root, "docs/task-hub-evidence/batch-02/FS-01/candidate-artifact.json");
    fs.writeFileSync(pointer, "PRESERVE_CURRENT_POINTER");
    const evidence = path.join(root, "fresh-evidence");
    const script = fileURLToPath(new URL("../../../scripts/emit-candidate-artifact.mjs", import.meta.url));
    return { root, probe, pointer, evidence, run: (args: string[]) => spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8", windowsHide: true, env: { ...process.env, ATI_EVIDENCE_DIR: evidence } }) };
  }
  function cleanup(root: string) {
    const resolved = fs.realpathSync(root);
    const parent = fs.realpathSync(os.tmpdir());
    if (path.dirname(resolved) !== parent || !path.basename(resolved).startsWith("ati-artifact-cli-")) throw Error("Unsafe fixture cleanup");
    fs.rmSync(resolved, { recursive: true, force: true });
  }
  it("requires an explicit probe even when historical passing evidence exists", () => {
    const f = fixture();
    try {
      const result = f.run([]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("PROBE_PATH_REQUIRED");
      expect(fs.readFileSync(f.pointer, "utf8")).toBe("PRESERVE_CURRENT_POINTER");
      expect(fs.existsSync(f.evidence)).toBe(false);
    } finally { cleanup(f.root); }
  });
  it("emits an explicit probe once and preserves an existing evidence artifact", () => {
    const f = fixture();
    try {
      expect(f.run([f.probe]).status).toBe(0);
      const artifactPath = path.join(f.evidence, "candidate-artifact.json");
      const artifact = fs.readFileSync(artifactPath, "utf8");
      expect(JSON.parse(artifact).provenance.probe_source).toBe(f.probe.replaceAll("\\", "/"));
      fs.writeFileSync(f.pointer, "NEWER_CURRENT_POINTER");
      expect(f.run([f.probe]).status).toBe(1);
      expect(fs.readFileSync(artifactPath, "utf8")).toBe(artifact);
      expect(fs.readFileSync(f.pointer, "utf8")).toBe("NEWER_CURRENT_POINTER");
    } finally { cleanup(f.root); }
  });
});
