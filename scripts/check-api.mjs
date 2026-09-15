import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";
import {
  collectKnownSecretValues,
  createGatePlan,
  deriveGateAssessment,
  fingerprintSourceEntries,
  listRepositoryFiles,
  parseGitStatus,
  runCommandSync,
  sanitizeEvidenceValue,
  selectEvidencePaths,
} from "./check-api-lib.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const stamp = new Date()
  .toISOString()
  .replaceAll(/[-:.TZ]/g, "")
  .slice(0, 14);
const evidenceDir = path.join(
  root,
  "docs",
  "api-evidence",
  "batch-03",
  "API-05",
  `${stamp}-${randomUUID()}`,
);
mkdirSync(evidenceDir, { recursive: true });

const knownSecrets = collectKnownSecretValues();
const commands = createGatePlan();
const results = [];
for (const command of commands) {
  const result = runCommandSync({ ...command, cwd: root }, knownSecrets);
  results.push(result);
  writeFileSync(
    path.join(evidenceDir, `${command.id}.json`),
    JSON.stringify(result, null, 2) + "\n",
  );
  if (result.exit_code !== 0) break;
}

let commit = "unknown";
let gitStatus = {
  available: false,
  dirty: null,
  tracked_changes: [],
  untracked: [],
  source_changes: { tracked: [], untracked: [] },
  error: null,
};
try {
  const git = spawnSync(
    process.platform === "win32" ? "git.exe" : "git",
    ["rev-parse", "HEAD"],
    { cwd: root, encoding: "utf8", windowsHide: true },
  );
  commit = git.stdout?.trim() || commit;
  const status = spawnSync(
    process.platform === "win32" ? "git.exe" : "git",
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    { cwd: root, encoding: "utf8", windowsHide: true },
  );
  if (git.status === 0 && status.status === 0) {
    gitStatus = {
      available: true,
      ...parseGitStatus(status.stdout ?? ""),
      error: null,
    };
  } else {
    gitStatus.error =
      git.error?.message ?? status.error?.message ?? "git command failed";
  }
} catch (error) {
  gitStatus.error = error instanceof Error ? error.message : String(error);
}

const evidencePaths = selectEvidencePaths(listRepositoryFiles(root));
const sourceEvidence = fingerprintSourceEntries(
  evidencePaths.map((relativePath) => ({
    path: relativePath,
    content: readFileSync(path.join(root, relativePath)),
  })),
);
const packageManifest = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
);
const engineManifest = JSON.parse(
  readFileSync(path.join(root, "packages", "engine", "package.json"), "utf8"),
);
const apiManifest = JSON.parse(
  readFileSync(path.join(root, "apps", "api", "package.json"), "utf8"),
);
const taskHubManifest = JSON.parse(
  readFileSync(path.join(root, "apps", "mcp-task-hub", "package.json"), "utf8"),
);
const cleanupEvidence = {
  status: "NOT_INDEPENDENTLY_VERIFIED",
  fixture_ownership:
    "Each test suite owns its unique database, process, and temporary-root fixtures.",
  limitation:
    "The runner records suite exit codes and output but has no independent database/process/root cleanup oracle.",
  observed_failures: [],
};
const requiredCoverage = {
  positive_http_lifecycle:
    results.find((result) => result.id === "api-integration")?.exit_code === 0
      ? "PASS"
      : "FAIL",
  required_negative_http_matrix: "NOT_ESTABLISHED_BY_RUNNER",
};
const assessment = deriveGateAssessment(
  results,
  requiredCoverage,
  cleanupEvidence,
);
const manifest = sanitizeEvidenceValue(
  {
    task: "API-05",
    created_at: new Date().toISOString(),
    commit,
    git: gitStatus,
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      root_package: {
        name: packageManifest.name,
        engines: packageManifest.engines ?? null,
      },
      api_package: { name: apiManifest.name, version: apiManifest.version },
      engine_package: {
        name: engineManifest.name,
        version: engineManifest.version,
      },
      task_hub_package: {
        name: taskHubManifest.name,
        version: taskHubManifest.version,
      },
      declared_dependencies: {
        postgres_client: apiManifest.dependencies?.postgres ?? null,
        mcp_sdk:
          engineManifest.dependencies?.["@modelcontextprotocol/sdk"] ?? null,
        filesystem_mcp:
          engineManifest.dependencies?.[
            "@modelcontextprotocol/server-filesystem"
          ] ?? null,
      },
      postgres_server: {
        version: "NOT_CAPTURED",
        limitation:
          "Runner does not read credential-bearing connection configuration or open a separate database session.",
      },
      mcp_processes: {
        versions: "NOT_CAPTURED_AT_PROCESS_BOUNDARY",
        limitation:
          "Integration suites own MCP child processes; declared package versions and source bytes are fingerprinted instead.",
      },
    },
    commands: results.map(
      ({ stdout: _stdout, stderr: _stderr, ...summary }) => summary,
    ),
    source_evidence: sourceEvidence,
    cleanup_evidence: cleanupEvidence,
    coverage: {
      required: requiredCoverage,
      planner: "DEV_FIXTURE",
      browser_e2e: "NOT_RUN",
      ai_evaluation: "NOT_RUN",
      rubric: "OPEN",
    },
    assessment,
    sanitization: {
      strategy:
        "structured-recursive-plus-text-patterns-and-known-runtime-values",
      known_values_supplied: knownSecrets.length,
      environment_files_read: false,
    },
  },
  knownSecrets,
);
writeFileSync(
  path.join(evidenceDir, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    sanitizeEvidenceValue(
      {
        task: "API-05",
        evidence_dir: path.relative(root, evidenceDir),
        results: results.map(
          ({ stdout: _stdout, stderr: _stderr, ...summary }) => summary,
        ),
        assessment,
      },
      knownSecrets,
    ),
    null,
    2,
  ),
);
process.exitCode = assessment.process_exit_code;
