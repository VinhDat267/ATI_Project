import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";
import postgres from "postgres";
import {
  assessAcceptanceMatrix,
  collectKnownSecretValues,
  compareCleanupSnapshots,
  createGatePlan,
  deriveGateAssessment,
  fingerprintSourceEntries,
  listRepositoryFiles,
  parseGitStatus,
  runCommandSync,
  sanitizeEvidenceValue,
  selectOwnedDatabaseNames,
  selectOwnedProjectProcesses,
  selectOwnedTempRoots,
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
const defaultAdminUrl = "postgresql://wap:wap@127.0.0.1:55532/wap_g1";

async function listOwnedDatabases() {
  const urls = [
    process.env.API_TEST_ADMIN_URL,
    process.env.G1_TEST_ADMIN_URL,
    defaultAdminUrl,
  ].filter((value, index, values) => value && values.indexOf(value) === index);
  const names = [];
  for (const [index, url] of urls.entries()) {
    const client = postgres(url, {
      max: 1,
      connect_timeout: 5,
      idle_timeout: 1,
      application_name: "ati_api_gate_cleanup_oracle",
    });
    try {
      const rows = await client`
        SELECT datname FROM pg_database
        WHERE datname LIKE 'api_it_%'
           OR datname LIKE 'engine_it_%'
           OR datname LIKE 'g1_it_%'
        ORDER BY datname`;
      names.push(
        ...selectOwnedDatabaseNames(rows.map((row) => row.datname)).map(
          (name) => `cluster_${index + 1}:${name}`,
        ),
      );
    } finally {
      await client.end({ timeout: 5 });
    }
  }
  return names.sort();
}

function listProcessRecords() {
  if (process.platform === "win32") {
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_Process | Select-Object ProcessId,CreationDate,CommandLine | ConvertTo-Json -Compress",
      ],
      { encoding: "utf8", windowsHide: true, timeout: 15_000 },
    );
    if (result.status !== 0)
      throw new Error(`process_oracle_exit_${result.status ?? "unknown"}`);
    const parsed = JSON.parse(result.stdout || "[]");
    return (Array.isArray(parsed) ? parsed : [parsed]).map((record) => ({
      pid: record.ProcessId,
      started_at: record.CreationDate ?? null,
      command_line: record.CommandLine ?? "",
    }));
  }
  const result = spawnSync("ps", ["-eo", "pid=,args="], {
    encoding: "utf8",
    timeout: 15_000,
  });
  if (result.status !== 0)
    throw new Error(`process_oracle_exit_${result.status ?? "unknown"}`);
  return String(result.stdout)
    .split(/\r?\n/)
    .flatMap((line) => {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      return match
        ? [{ pid: Number(match[1]), command_line: match[2] }]
        : [];
    });
}

async function captureCleanupSnapshot() {
  const snapshot = {
    status: "PASS",
    databases: [],
    temp_roots: [],
    processes: [],
    errors: [],
  };
  try {
    snapshot.databases = await listOwnedDatabases();
  } catch (error) {
    snapshot.errors.push(
      `database:${error?.code ?? error?.name ?? "unknown_error"}`,
    );
  }
  try {
    snapshot.temp_roots = selectOwnedTempRoots(readdirSync(tmpdir()));
  } catch (error) {
    snapshot.errors.push(
      `temp:${error?.code ?? error?.name ?? "unknown_error"}`,
    );
  }
  try {
    snapshot.processes = selectOwnedProjectProcesses(listProcessRecords(), root);
  } catch (error) {
    snapshot.errors.push(
      `process:${error?.code ?? error?.name ?? "unknown_error"}`,
    );
  }
  snapshot.status = snapshot.errors.length === 0 ? "PASS" : "FAIL";
  return snapshot;
}

const cleanupBaseline = await captureCleanupSnapshot();
const cleanupObservations = [];
for (const command of commands) {
  const result = runCommandSync({ ...command, cwd: root }, knownSecrets);
  results.push(result);
  const after = await captureCleanupSnapshot();
  cleanupObservations.push({
    after_command: command.id,
    snapshot: after,
    comparison: compareCleanupSnapshots(cleanupBaseline, after),
  });
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
  status:
    cleanupBaseline.status === "PASS" &&
    cleanupObservations.every(
      (observation) => observation.comparison.status === "PASS",
    )
      ? "PASS"
      : "FAIL",
  independently_verified: true,
  scope: "no new project-owned database, temp-root, or process after each gate command",
  baseline: cleanupBaseline,
  observations: cleanupObservations,
  fixture_ownership:
    "Each test suite owns its unique database, process, and temporary-root fixtures.",
  limitation:
    "Delta oracle preserves pre-existing resources and does not claim the host was globally clean before the gate.",
};
const acceptanceMatrix = assessAcceptanceMatrix(results);
const requiredCoverage = {
  positive_http_lifecycle:
    acceptanceMatrix.scenarios.find((scenario) => scenario.id === "H20")
      ?.status ?? "NOT_ESTABLISHED",
  required_negative_http_matrix: acceptanceMatrix.status,
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
          "Cleanup oracle opens separate read-only admin sessions for owned-database discovery but does not persist connection configuration or capture the server version.",
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
    acceptance_matrix: acceptanceMatrix,
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
