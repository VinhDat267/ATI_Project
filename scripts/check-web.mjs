import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

import {
  aggregateLatencyReport,
  collectKnownSecretValues,
  compareCleanupSnapshots,
  createWebGatePlan,
  normalizeRelativePath,
  parseGitStatus,
  runCommandSync,
  sanitizeEvidenceValue,
  selectOwnedDatabaseNames,
  selectOwnedProjectProcesses,
  selectOwnedTempRoots,
  validateBundleBudgets,
  resolveWebGateAdminUrls,
  JS_GZIP_BUDGET_BYTES,
  CSS_GZIP_BUDGET_BYTES,
} from "./check-web-lib.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const stamp = new Date()
  .toISOString()
  .replaceAll(/[-:.TZ]/g, "")
  .slice(0, 14);
const evidenceDir = path.join(
  root,
  "docs",
  "web-evidence",
  "WEB-03",
  `${stamp}-${randomUUID()}`,
);
mkdirSync(evidenceDir, { recursive: true });

const knownSecrets = collectKnownSecretValues();
const allCommands = createWebGatePlan();

// Optional filter for development/targeted verification (--gate=web-typecheck or --only=web-unit-tests)
const gateFilterArg = process.argv.find(
  (arg) => arg.startsWith("--gate=") || arg.startsWith("--only="),
);
const gateFilter = gateFilterArg
  ? gateFilterArg
      .split("=")[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  : null;

const commands = gateFilter
  ? allCommands.filter((cmd) => gateFilter.includes(cmd.id))
  : allCommands;

async function listOwnedDatabases() {
  const urls = resolveWebGateAdminUrls();
  const names = [];
  for (const [index, url] of urls.entries()) {
    let client;
    try {
      client = postgres(url, {
        max: 1,
        connect_timeout: 5,
        idle_timeout: 1,
        application_name: "ati_web_gate_cleanup_oracle",
      });
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
      if (client) {
        await client.end({ timeout: 5 }).catch(() => {});
      }
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
    if (result.status !== 0) {
      throw new Error(`process_oracle_exit_${result.status ?? "unknown"}`);
    }
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
  if (result.status !== 0) {
    throw new Error(`process_oracle_exit_${result.status ?? "unknown"}`);
  }
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

// 1. Capture baseline snapshot
const cleanupBaseline = await captureCleanupSnapshot();
const cleanupObservations = [];
const results = [];

// 2. Sequentially execute gate commands
for (const command of commands) {
  console.log(`\n[check:web] Starting gate: ${command.id} (${command.description})...`);
  const startedMs = Date.now();
  const result = runCommandSync({ ...command, cwd: root }, knownSecrets);
  const durationMs = Date.now() - startedMs;
  const after = await captureCleanupSnapshot();
  const comparison = compareCleanupSnapshots(cleanupBaseline, after);
  cleanupObservations.push({
    after_command: command.id,
    snapshot: after,
    comparison,
  });

  result.cleanup_evidence = {
    status: comparison.status,
    independently_verified: true,
    added: comparison.added,
    errors: comparison.errors,
  };
  results.push({ ...result, duration_ms: durationMs });

  writeFileSync(
    path.join(evidenceDir, `${command.id}.json`),
    JSON.stringify(result, null, 2) + "\n",
  );

  if (result.exit_code !== 0) {
    console.error(
      `[check:web] Gate FAILED: ${command.id} with exit code ${result.exit_code}`,
    );
    if (result.stderr) {
      console.error(result.stderr.trim());
    }
    break;
  }
  console.log(`[check:web] Gate PASSED: ${command.id} in ${durationMs}ms`);
}

// 3. Git commit & status check
let commit = "unknown";
let gitStatus = {
  available: false,
  dirty: null,
  tracked_changes: [],
  untracked: [],
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

// 4. Validate bundle budgets
const distDir = path.join(root, "apps", "web", "dist");
const bundleBudgets = validateBundleBudgets(distDir);

// 5. Aggregate NFR-03 latency report
const latencyCacheFile = path.join(root, ".cache", "nfr03-observations.json");
const latencyReport = aggregateLatencyReport(latencyCacheFile);

// 6. Cleanup evidence summary
const cleanupEvidence = {
  status:
    cleanupBaseline.status === "PASS" &&
    cleanupObservations.every(
      (observation) => observation.comparison.status === "PASS",
    )
      ? "PASS"
      : "FAIL",
  independently_verified: true,
  scope:
    "no new project-owned database, temp-root, or process after each gate command",
  baseline: cleanupBaseline,
  observations: cleanupObservations,
  fixture_ownership:
    "Each test suite owns its unique database, process, and temporary-root fixtures.",
  limitation:
    "Delta oracle preserves pre-existing resources and does not claim the host was globally clean before the gate.",
};

// 7. Overall assessment
const failedCommands = results.filter((result) => result.exit_code !== 0);
const allCommandsExecuted = results.length === commands.length;
const allCommandsPassed = allCommandsExecuted && failedCommands.length === 0;
const cleanupPassed = cleanupEvidence.status === "PASS";
const bundlePassed = bundleBudgets.status === "PASS";
const latencyPassed = latencyReport.pass;

const reasons = [];
if (!allCommandsExecuted) {
  reasons.push(
    `incomplete_run: executed ${results.length}/${commands.length} commands`,
  );
}
if (failedCommands.length > 0) {
  reasons.push(
    `failed_commands=${failedCommands.map((c) => c.id).join(",")}`,
  );
}
if (!cleanupPassed) {
  reasons.push(`cleanup=${cleanupEvidence.status}`);
  if (cleanupBaseline.status !== "PASS") {
    reasons.push(`cleanup_baseline_errors=${cleanupBaseline.errors.join(",")}`);
  }
  for (const obs of cleanupObservations) {
    if (obs.comparison.status !== "PASS") {
      const addedSummary = [];
      if (obs.comparison.leaked_databases?.length > 0) {
        addedSummary.push(`dbs:${obs.comparison.leaked_databases.join(",")}`);
      }
      if (obs.comparison.leaked_temp_roots?.length > 0) {
        addedSummary.push(`temp:${obs.comparison.leaked_temp_roots.join(",")}`);
      }
      if (obs.comparison.leaked_processes?.length > 0) {
        addedSummary.push(
          `processes:${obs.comparison.leaked_processes.map((p) => (typeof p === "string" ? p : p.pid)).join(",")}`,
        );
      }
      if (obs.comparison.errors?.length > 0) {
        addedSummary.push(`errors:${obs.comparison.errors.join(",")}`);
      }
      reasons.push(`leak_after_${obs.after_command}=${addedSummary.join(";")}`);
    }
  }
}
if (!bundlePassed) {
  reasons.push(...bundleBudgets.reasons);
}
if (!latencyPassed) {
  reasons.push(
    `latency_gate_failed: samples=${latencyReport.sample_count} (min 30), p95=${latencyReport.p95_ms}ms (max 3000ms)`,
  );
}

const isPass =
  allCommandsPassed && cleanupPassed && bundlePassed && latencyPassed;

const assessment = {
  command_status: allCommandsPassed ? "PASS" : "FAIL",
  cleanup_status: cleanupPassed ? "PASS" : "FAIL",
  bundle_status: bundlePassed ? "PASS" : "FAIL",
  latency_status: latencyPassed ? "PASS" : "FAIL",
  web_verdict: isPass ? "WEB_TECHNICAL_PASS" : "NEEDS_FIX",
  web_technical_pass: isPass,
  process_exit_code: isPass ? 0 : 1,
  reasons,
};

// 8. Package manifests metadata
const packageManifest = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
);
const webManifest = JSON.parse(
  readFileSync(path.join(root, "apps", "web", "package.json"), "utf8"),
);
const apiManifest = JSON.parse(
  readFileSync(path.join(root, "apps", "api", "package.json"), "utf8"),
);
const engineManifest = JSON.parse(
  readFileSync(path.join(root, "packages", "engine", "package.json"), "utf8"),
);
const taskHubManifest = JSON.parse(
  readFileSync(path.join(root, "apps", "mcp-task-hub", "package.json"), "utf8"),
);

// 9. Generate and write manifest.json
const manifest = sanitizeEvidenceValue(
  {
    task: "WEB-03",
    milestone: "WEB-03",
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
      web_package: {
        name: webManifest.name,
        version: webManifest.version,
      },
      api_package: {
        name: apiManifest.name,
        version: apiManifest.version,
      },
      engine_package: {
        name: engineManifest.name,
        version: engineManifest.version,
      },
      task_hub_package: {
        name: taskHubManifest.name,
        version: taskHubManifest.version,
      },
      declared_dependencies: {
        react: webManifest.dependencies?.react ?? null,
        playwright: webManifest.devDependencies?.["@playwright/test"] ?? null,
        axe_core_playwright:
          webManifest.devDependencies?.["@axe-core/playwright"] ?? null,
        vite: webManifest.devDependencies?.vite ?? null,
        vitest: webManifest.devDependencies?.vitest ?? null,
      },
    },
    commands: results.map(
      ({ stdout: _stdout, stderr: _stderr, ...summary }) => summary,
    ),
    bundle_budgets: bundleBudgets,
    nfr03_latency: latencyReport,
    cleanup_evidence: cleanupEvidence,
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

// 10. Update docs/WEB-STATUS.md if it exists
const webStatusPath = path.join(root, "docs", "WEB-STATUS.md");
if (existsSync(webStatusPath)) {
  try {
    let content = readFileSync(webStatusPath, "utf8");
    const relativeEvidencePath = normalizeRelativePath(
      path.relative(root, path.join(evidenceDir, "manifest.json")),
    );
    content = content.replace(
      /docs\/web-evidence\/WEB-03\/[^\/`\s]+\/manifest\.json/,
      relativeEvidencePath,
    );
    writeFileSync(webStatusPath, content, "utf8");
  } catch (err) {
    console.warn(
      `[check:web] Warning: could not update ${webStatusPath}: ${err.message}`,
    );
  }
}

// 11. Formatted Summary Report to console
console.log("\n" + "=".repeat(80));
console.log("                    WEB-03 GATE RUNNER SUMMARY REPORT");
console.log("=".repeat(80));
console.log(`Evidence Directory: ${normalizeRelativePath(path.relative(root, evidenceDir))}`);
console.log(`Git Commit:         ${commit}`);
console.log(`Git Status:         ${gitStatus.available ? (gitStatus.dirty ? "DIRTY" : "CLEAN") : "UNKNOWN"}`);

console.log("\nGATE COMMANDS:");
for (const cmd of results) {
  const statusMark = cmd.exit_code === 0 ? "PASS" : "FAIL";
  console.log(
    `  [${statusMark}] ${cmd.id.padEnd(24)} (exit: ${cmd.exit_code}, duration: ${cmd.duration_ms ?? "?"}ms)`,
  );
}

console.log("\nBUNDLE BUDGETS (apps/web/dist):");
console.log(`  Status:           ${bundleBudgets.status}`);
console.log(
  `  JS Entry Gzip:    ${bundleBudgets.js_gzip_bytes.toLocaleString()} bytes (budget: <= ${JS_GZIP_BUDGET_BYTES.toLocaleString()} bytes / 200 KiB)`,
);
console.log(
  `  CSS Entry Gzip:   ${bundleBudgets.css_gzip_bytes.toLocaleString()} bytes (budget: <= ${CSS_GZIP_BUDGET_BYTES.toLocaleString()} bytes / 30 KiB)`,
);
console.log(
  `  Synthetic Leaks:  ${bundleBudgets.has_synthetic_leak ? "LEAK DETECTED" : "None detected"}`,
);
if (bundleBudgets.reasons.length > 0) {
  console.log(`  Violations:       ${bundleBudgets.reasons.join("; ")}`);
}

console.log("\nNFR-03 LOCAL LATENCY (.cache/nfr03-observations.json):");
console.log(`  Status:           ${latencyReport.pass ? "PASS" : "FAIL"}`);
console.log(`  Sample Count:     ${latencyReport.sample_count} (target: >= 30)`);
console.log(`  p50 Latency:      ${latencyReport.p50_ms} ms`);
console.log(
  `  p95 Latency:      ${latencyReport.p95_ms} ms (target: <= ${latencyReport.p95_target_ms} ms)`,
);
console.log(
  `  Min / Max / Mean: ${latencyReport.min_ms} ms / ${latencyReport.max_ms} ms / ${latencyReport.mean_ms} ms`,
);
if (latencyReport.error) {
  console.log(`  Error:            ${latencyReport.error}`);
}

console.log("\nDELTA CLEANUP ORACLE:");
console.log(`  Baseline Status:  ${cleanupBaseline.status}`);
console.log(`  Overall Status:   ${cleanupEvidence.status}`);
const totalLeakedDbs = cleanupObservations.reduce(
  (acc, o) => acc + (o.comparison.leaked_databases?.length ?? 0),
  0,
);
const totalLeakedTemp = cleanupObservations.reduce(
  (acc, o) => acc + (o.comparison.leaked_temp_roots?.length ?? 0),
  0,
);
const totalLeakedProc = cleanupObservations.reduce(
  (acc, o) => acc + (o.comparison.leaked_processes?.length ?? 0),
  0,
);
console.log(`  Leaked DBs:       ${totalLeakedDbs}`);
console.log(`  Leaked TempRoots: ${totalLeakedTemp}`);
console.log(`  Leaked Processes: ${totalLeakedProc}`);
if (cleanupEvidence.status !== "PASS") {
  for (const obs of cleanupObservations) {
    if (obs.comparison.status !== "PASS") {
      console.log(
        `  After ${obs.after_command}: ${JSON.stringify(obs.comparison.added)} errors: ${obs.comparison.errors.join(", ")}`,
      );
    }
  }
}

console.log(
  `\nOVERALL VERDICT:    ${assessment.web_verdict} (exit code: ${assessment.process_exit_code})`,
);
if (assessment.reasons.length > 0) {
  console.log(`  Reasons:          ${assessment.reasons.join("; ")}`);
}
console.log("=".repeat(80) + "\n");

process.exitCode = assessment.process_exit_code;
