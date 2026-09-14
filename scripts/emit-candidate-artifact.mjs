import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { captureFilesystemArtifact } from "../packages/engine/dist/launch-policy.js";

/**
 * Validates exact path set, count, and SHA-256 matches against expected baseline.
 * Fails on missing, extra, duplicate, or mismatching files.
 */
export function validateArtifactFiles(files, expectedHashes) {
  if (!Array.isArray(files)) {
    throw new Error("INVALID_FILES: files must be an array");
  }
  if (typeof expectedHashes !== "object" || expectedHashes === null) {
    throw new Error("INVALID_BASELINE: expectedHashes must be an object");
  }

  const seenPaths = new Set();
  for (const f of files) {
    if (!f || typeof f.path !== "string" || typeof f.sha256 !== "string") {
      throw new Error("INVALID_FILE_RECORD: file record must have path and sha256");
    }
    if (seenPaths.has(f.path)) {
      throw new Error(`DUPLICATE_FILE: duplicate entry for path '${f.path}'`);
    }
    seenPaths.add(f.path);
  }

  const expectedPaths = Object.keys(expectedHashes);
  if (files.length !== expectedPaths.length) {
    throw new Error(
      `FILE_COUNT_MISMATCH: expected ${expectedPaths.length} files, but got ${files.length}`
    );
  }

  for (const expPath of expectedPaths) {
    if (!seenPaths.has(expPath)) {
      throw new Error(`MISSING_FILE: expected file '${expPath}' is missing`);
    }
  }

  for (const f of files) {
    if (!(f.path in expectedHashes)) {
      throw new Error(`UNEXPECTED_EXTRA_FILE: unexpected extra file '${f.path}'`);
    }
  }

  const comparisons = files.map((fileRecord) => {
    const expected = expectedHashes[fileRecord.path];
    if (fileRecord.sha256 !== expected) {
      throw new Error(
        `HASH_MISMATCH: file '${fileRecord.path}' sha256 '${fileRecord.sha256}' does not match expected '${expected}'`
      );
    }
    return {
      file: fileRecord.path,
      sha256: fileRecord.sha256,
      expected_baseline_sha256: expected,
      matches: true,
    };
  });

  return comparisons;
}

/**
 * Validates probe evidence file: must exist, verdict must be PASS,
 * and must contain required tool schemas for read_text_file and write_file.
 */
export function extractRawSchemaHashes(probeFilePath, probeDataOverride) {
  let probeData = probeDataOverride;
  if (!probeData) {
    if (!probeFilePath || typeof probeFilePath !== "string") {
      throw new Error("PROBE_PATH_REQUIRED: probe file path must be provided");
    }
    if (!fs.existsSync(probeFilePath)) {
      throw new Error(`PROBE_FILE_NOT_FOUND: probe file not found at ${probeFilePath}`);
    }
    try {
      probeData = JSON.parse(fs.readFileSync(probeFilePath, "utf8"));
    } catch (e) {
      throw new Error(`MALFORMED_PROBE_JSON: failed to parse probe JSON: ${e.message}`);
    }
  }

  if (probeData.verdict !== "PASS") {
    throw new Error(
      `PROBE_VERDICT_NOT_PASS: probe file verdict is '${probeData.verdict}', expected 'PASS'`
    );
  }

  if (!Array.isArray(probeData.discovered_tools)) {
    throw new Error("INVALID_PROBE_TOOLS: discovered_tools must be an array");
  }

  const requiredTools = ["read_text_file", "write_file"];
  const toolMap = new Map();
  for (const tool of probeData.discovered_tools) {
    if (tool && typeof tool.name === "string") {
      if (toolMap.has(tool.name)) {
        throw new Error(`DUPLICATE_TOOL: duplicate tool '${tool.name}' in probe`);
      }
      toolMap.set(tool.name, tool);
    }
  }

  for (const req of requiredTools) {
    if (!toolMap.has(req)) {
      throw new Error(`MISSING_REQUIRED_TOOL_SCHEMA: required tool '${req}' not found in probe`);
    }
    const tool = toolMap.get(req);
    if ([tool.inputSchema, tool.outputSchema].some(schema =>
      schema === null || typeof schema !== "object" || Array.isArray(schema))) {
      throw new Error(`INVALID_TOOL_SCHEMA: tool '${req}' requires object inputSchema and outputSchema`);
    }
  }

  const rawSchemaHashes = {};
  for (const toolName of ["read_file", "read_text_file", "write_file"]) {
    const tool = toolMap.get(toolName);
    if (tool) {
      const toolStr = JSON.stringify({
        name: tool.name,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
      });
      rawSchemaHashes[tool.name] = crypto.createHash("sha256").update(toolStr).digest("hex");
    }
  }

  if (Object.keys(rawSchemaHashes).length === 0) {
    throw new Error("EMPTY_RAW_SCHEMAS: no tool schemas were extracted from probe");
  }

  return rawSchemaHashes;
}

async function main() {
  const probeArg = process.argv[2];
  if (!probeArg?.trim()) {
    throw new Error("PROBE_PATH_REQUIRED: pass the reviewed probe JSON path explicitly");
  }
  const projectRoot = process.cwd();
  const baselinePath = path.resolve(projectRoot, "docs/antigravity/filesystem-handoff-baseline.json");
  const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));

  const probeFilePath = path.resolve(projectRoot, probeArg);

  const artifact = captureFilesystemArtifact(projectRoot);
  const hashComparisons = validateArtifactFiles(artifact.files, baseline.candidate_review.files_sha256);
  const rawSchemaHashes = extractRawSchemaHashes(probeFilePath);

  const evidenceDir =
    process.env.ATI_EVIDENCE_DIR ||
    path.resolve(
      projectRoot,
      "docs/task-hub-evidence/batch-02/FS-01",
      `${Date.now()}-artifact`
    );
  fs.mkdirSync(evidenceDir, { recursive: true });

  const output = {
    recorded_at: new Date().toISOString(),
    task: "FS-01",
    package: artifact.package,
    version: artifact.version,
    entryPath: artifact.entryPath,
    nodePath: artifact.nodePath,
    nodeVersion: artifact.nodeVersion,
    files_audit: {
      total_files: artifact.files.length,
      all_matched_baseline: true,
      files: hashComparisons,
    },
    resolved_dependencies: artifact.dependencyPackages,
    raw_schema_hashes: rawSchemaHashes,
    provenance: {
      generated_in_dir: path.resolve(evidenceDir).replace(/\\/g, "/"),
      probe_source: path.resolve(probeFilePath).replace(/\\/g, "/"),
      baseline_ref: "docs/antigravity/filesystem-handoff-baseline.json",
      generator: "scripts/emit-candidate-artifact.mjs",
    },
  };

  // Write artifact in fresh evidence run dir
  const runArtifactPath = path.join(evidenceDir, "candidate-artifact.json");
  fs.writeFileSync(runArtifactPath, JSON.stringify(output, null, 2) + "\n", { encoding: "utf8", flag: "wx" });

  // Update current pointer in FS-01 root
  const currentPointerPath = path.resolve(
    projectRoot,
    "docs/task-hub-evidence/batch-02/FS-01/candidate-artifact.json"
  );
  fs.writeFileSync(currentPointerPath, JSON.stringify(output, null, 2) + "\n", "utf8");

  console.log(
    JSON.stringify({
      status: "PASS",
      evidence_dir: evidenceDir,
      pointer: currentPointerPath,
      files_count: artifact.files.length,
      probe_source: probeFilePath,
      raw_schemas: Object.keys(rawSchemaHashes),
    })
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(JSON.stringify({ status: "FAIL", error: err.message }));
    process.exit(1);
  });
}
