import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const SECRET_FIELD = String.raw`(?:password|passwd|pwd|token|secret|authorization|api[_-]?key|cookie|database[_-]?url|connection[_-]?string)`;
const DOUBLE_QUOTED_SECRET_FIELD = new RegExp(
  String.raw`((?:["']?${SECRET_FIELD}["']?)\s*[=:]\s*)"(?:\\[\s\S]|[^"\\])*"`,
  "gi",
);
const SINGLE_QUOTED_SECRET_FIELD = new RegExp(
  String.raw`((?:["']?${SECRET_FIELD}["']?)\s*[=:]\s*)'(?:\\[\s\S]|[^'\\])*'`,
  "gi",
);
const UNQUOTED_SECRET_FIELD = new RegExp(
  String.raw`((?:["']?${SECRET_FIELD}["']?)\s*[=:]\s*)(?!["'])([^\s,}\]]+)`,
  "gi",
);
const SENSITIVE_PROPERTY = new RegExp(
  String.raw`(?:^|[_-])${SECRET_FIELD}(?:$|[_-])`,
  "i",
);
const URL_USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)([^@\s/?#]+)@/gi;
const BEARER_VALUE = /\bBearer\s+[^\s,}"']+/gi;
const CODE_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".json",
  ".mjs",
  ".mts",
  ".sql",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);
const SKIPPED_DIRECTORIES = new Set([
  ".cache",
  ".git",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "docs/api-evidence",
  "generated",
  "node_modules",
  "playwright-report",
  "runtime",
  "test-results",
]);
const OWNED_DATABASE_PREFIXES = ["api_it_", "engine_it_", "g1_it_"];
const OWNED_TEMP_ROOT_PREFIXES = [
  "ati-api-fs-",
  "ati-artifact-cli-",
  "ati-cap-probe-",
  "ati-fs-it-",
  "ati-fs-outside-",
  "ati-fs-test-",
  "ati-migration-test-",
  "ati-vite-proxy-test-",
];

export const API_ACCEPTANCE_MATRIX = [
  {
    id: "H01",
    title: "authentication, session expiry, restart invalidation, and owned history",
    tests: [
      {
        command_id: "api-integration",
        title: "authenticates the seeded demo principal over a real HTTP socket",
      },
      {
        command_id: "api-integration",
        title:
          "expires sessions, invalidates them on restart, and keeps owned history readable without MCP",
      },
    ],
  },
  {
    id: "H02",
    title: "strict content type, body shape, malformed JSON, and size bounds",
    tests: [
      {
        command_id: "api-unit",
        title: "returns 415 for a non-JSON login request without mutating state",
      },
      {
        command_id: "api-unit",
        title:
          "rejects unknown login fields and authenticates the protected servers route",
      },
      {
        command_id: "api-unit",
        title:
          "rejects malformed and oversized chunked JSON before principal lookup",
      },
      {
        command_id: "api-integration",
        title:
          "rejects malformed and oversized chunked run bodies without database mutation",
      },
    ],
  },
  {
    id: "H03",
    title: "accepted run is durably committed before asynchronous preparation",
    tests: [
      {
        command_id: "api-integration",
        title: "commits an accepted planning run before preparation starts",
      },
    ],
  },
  {
    id: "H04",
    title: "one active run and no client-supplied plan fields",
    tests: [
      {
        command_id: "api-integration",
        title:
          "rejects a second active run and never accepts client-supplied plan fields",
      },
    ],
  },
  {
    id: "H05",
    title: "admission rollback is atomic when durable outbox insertion fails",
    tests: [
      {
        command_id: "api-integration",
        title: "rolls back every admission record when durable outbox insert fails",
      },
    ],
  },
  {
    id: "H06",
    title: "planner refusal, needs-input, and rejection remain mutation-free",
    tests: [
      {
        command_id: "api-integration",
        title:
          "finishes an explicit planner refusal without creating a version or write",
      },
      {
        command_id: "api-integration",
        title:
          "finishes unknown demo input as needs_input and rejects a prepared plan without writes",
      },
    ],
  },
  {
    id: "H07",
    title: "preparation uses real PostgreSQL and MCP reads",
    tests: [
      {
        command_id: "api-integration",
        title: "prepares the accepted b02 run through real PostgreSQL and MCP read",
      },
    ],
  },
  {
    id: "H08",
    title: "every run route enforces ownership without mutation",
    tests: [
      {
        command_id: "api-integration",
        title:
          "returns no foreign run data from every run route and does not mutate the run",
      },
    ],
  },
  {
    id: "H09",
    title: "event paging is bounded and rejects unsafe sequence values",
    tests: [
      {
        command_id: "api-integration",
        title: "caps a page at 200 and rejects unsafe since_seq values",
      },
    ],
  },
  {
    id: "H10",
    title: "trace cursor pages an immutable 251-attempt snapshot",
    tests: [
      {
        command_id: "api-integration",
        title: "pages an immutable snapshot and redacts sensitive fields",
      },
    ],
  },
  {
    id: "H11",
    title: "trace cursors reject tampering, expiry, cross-run reuse, and foreign access",
    tests: [
      {
        command_id: "api-integration",
        title: "pages an immutable snapshot and redacts sensitive fields",
      },
      {
        command_id: "api-integration",
        title:
          "returns no foreign run data from every run route and does not mutate the run",
      },
    ],
  },
  {
    id: "H12",
    title: "configured secrets are blocked before write and redacted from trace",
    tests: [
      {
        command_id: "api-integration",
        title:
          "blocks configured secrets before write reservation and persists a safe trace projection",
      },
      {
        command_id: "api-integration",
        title:
          "blocks approval after a preview value becomes protected but still permits rejection",
      },
    ],
  },
  {
    id: "H13",
    title: "production API degrades safely when MCP is unavailable",
    tests: [
      {
        command_id: "api-integration",
        title:
          "boots the production HTTP entry point with unavailable MCP and settles an accepted job without losing reads",
      },
      {
        command_id: "api-integration",
        title:
          "expires sessions, invalidates them on restart, and keeps owned history readable without MCP",
      },
      {
        command_id: "api-integration",
        title: "does not report a closed real MCP transport as connected",
      },
      {
        command_id: "api-unit",
        title: "reports gateway validation failure as server error state",
      },
    ],
  },
  {
    id: "H14",
    title: "stale and concurrent approvals cannot duplicate execution",
    tests: [
      {
        command_id: "api-integration",
        title:
          "accepts exactly one concurrent approval and executes through the outbox",
      },
    ],
  },
  {
    id: "H15",
    title: "approval expiry uses the database clock and wins races safely",
    tests: [
      {
        command_id: "api-integration",
        title: "expires pending approvals using the database clock",
      },
      {
        command_id: "api-integration",
        title: "returns 409 EXPIRED when approval wins the race with maintenance",
      },
      {
        command_id: "engine-integration",
        title:
          "E09 expires the approval after the file commit and stops before notification",
      },
    ],
  },
  {
    id: "H16",
    title: "cancellation is idempotent and stops later writes",
    tests: [
      {
        command_id: "api-integration",
        title: "cancels queued planning runs and rejects a second terminal cancel",
      },
      {
        command_id: "engine-integration",
        title:
          "honors cancellation after the current write without dispatching the next write",
      },
      {
        command_id: "engine-integration",
        title: "keeps one terminal event when cancel races after a unknown attempt",
      },
    ],
  },
  {
    id: "H17",
    title: "orphan and process-crash recovery never silently replays committed work",
    tests: [
      {
        command_id: "api-integration",
        title:
          "waits for successful recovery and never replans an already claimed orphan",
      },
      {
        command_id: "api-integration",
        title:
          "survives a worker process killed before claim and executes the durable job once",
      },
      {
        command_id: "engine-integration",
        title:
          "recovers an actual engine process exit after receiver commit without resuming the workflow",
      },
    ],
  },
  {
    id: "H18",
    title: "lost task-hub response reconciles from the committed receipt without replay",
    tests: [
      {
        command_id: "engine-integration",
        title:
          "stops on a lost write response, then inspects the committed receipt without replaying",
      },
    ],
  },
  {
    id: "H19",
    title: "lost filesystem response becomes unknown and suppresses notification",
    tests: [
      {
        command_id: "engine-integration",
        title:
          "E06 marks a lost filesystem response unknown without dispatching notification",
      },
      {
        command_id: "engine-integration",
        title:
          "E08 recovers a crash after durable filesystem reservation and before write dispatch",
      },
    ],
  },
  {
    id: "H20",
    title: "both reviewed HTTP acceptance lifecycles execute end to end",
    tests: [
      {
        command_id: "api-integration",
        title:
          "runs the b02 lifecycle over HTTP, drains events, trace and reconciliation",
      },
      {
        command_id: "api-integration",
        title: "runs the two-server filesystem fixture only after HTTP approval",
      },
      {
        command_id: "engine-integration",
        title:
          "E13 drives the real built CLI through prepare, approve, execute, trace, and reconcile",
      },
    ],
  },
];

function normalizeRelativePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

function redactKnownValues(value, knownSecrets) {
  let sanitized = value;
  const unique = [
    ...new Set(
      knownSecrets.filter(
        (item) => typeof item === "string" && item.length > 0,
      ),
    ),
  ].sort((left, right) => right.length - left.length);
  for (const secret of unique)
    sanitized = sanitized.replaceAll(secret, "[REDACTED]");
  return sanitized;
}

export function sanitizeSensitiveText(value, knownSecrets = []) {
  let sanitized = redactKnownValues(String(value), knownSecrets);
  sanitized = sanitized.replace(DOUBLE_QUOTED_SECRET_FIELD, '$1"[REDACTED]"');
  sanitized = sanitized.replace(SINGLE_QUOTED_SECRET_FIELD, "$1'[REDACTED]'");
  sanitized = sanitized.replace(UNQUOTED_SECRET_FIELD, "$1[REDACTED]");
  sanitized = sanitized.replace(URL_USERINFO, "$1[REDACTED]@");
  sanitized = sanitized.replace(BEARER_VALUE, "Bearer [REDACTED]");
  return sanitized;
}

export function sanitizeEvidenceValue(value, knownSecrets = []) {
  if (typeof value === "string")
    return sanitizeSensitiveText(value, knownSecrets);
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeEvidenceValue(item, knownSecrets));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SENSITIVE_PROPERTY.test(key)
          ? "[REDACTED]"
          : sanitizeEvidenceValue(item, knownSecrets),
      ]),
    );
  }
  return value;
}

export function collectKnownSecretValues(environment = process.env) {
  return [
    ...new Set(
      Object.entries(environment)
        .filter(
          ([key, value]) =>
            SENSITIVE_PROPERTY.test(key) &&
            typeof value === "string" &&
            value.length > 0,
        )
        .map(([, value]) => value),
    ),
  ].sort((left, right) => right.length - left.length);
}


function shouldSkipPath(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  return [...SKIPPED_DIRECTORIES].some(
    (directory) =>
      normalized === directory ||
      normalized.startsWith(`${directory}/`) ||
      normalized.includes(`/${directory}/`),
  );
}

export function selectEvidencePaths(paths) {
  const selected = new Set();
  for (const candidate of paths) {
    const normalized = normalizeRelativePath(candidate);
    if (
      !normalized ||
      normalized.startsWith("../") ||
      path.posix.isAbsolute(normalized)
    )
      continue;
    if (shouldSkipPath(normalized)) continue;

    const basename = path.posix.basename(normalized);
    if (
      (basename === ".env" || basename.startsWith(".env.")) &&
      basename !== ".env.example"
    )
      continue;

    const extension = path.posix.extname(normalized).toLowerCase();
    const inCodeTree = /^(?:apps|packages|scripts)\//.test(normalized);
    const inMigrationTree = /(?:^|\/)migrations?(?:\/|$)/.test(normalized);
    const rootConfig =
      !normalized.includes("/") &&
      (normalized === ".env.example" ||
        normalized === "package.json" ||
        normalized === "package-lock.json" ||
        normalized === "tsconfig.json" ||
        /^(?:compose(?:\.[^.]+)?|docker-compose)\.ya?ml$/.test(normalized));
    const generatedContract = normalized === "docs/openapi.yaml";

    if (
      (inCodeTree && CODE_EXTENSIONS.has(extension)) ||
      inMigrationTree ||
      rootConfig ||
      generatedContract
    ) {
      selected.add(normalized);
    }
  }
  return [...selected].sort();
}

export function listRepositoryFiles(root) {
  const files = [];
  const visit = (directory, relativeDirectory = "") => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relativePath = normalizeRelativePath(
        path.posix.join(relativeDirectory, entry.name),
      );
      if (entry.isDirectory()) {
        if (!shouldSkipPath(relativePath))
          visit(path.join(directory, entry.name), relativePath);
        continue;
      }
      if (
        !entry.isFile() ||
        lstatSync(path.join(directory, entry.name)).isSymbolicLink()
      )
        continue;
      files.push(relativePath);
    }
  };
  visit(root);
  return files.sort();
}

function evidenceCategory(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  const basename = path.posix.basename(normalized);
  if (
    basename === "package-lock.json" ||
    /(?:^|[-.])lock(?:\.|$)/i.test(basename)
  )
    return "lockfile";
  if (
    /(?:^|\/)migrations?(?:\/|$)/.test(normalized) ||
    /^\d+.*\.sql$/i.test(basename)
  )
    return "migration";
  if (
    /(?:^|\/)tests?(?:\/|$)/.test(normalized) ||
    /\.(?:test|spec)\.[^.]+$/i.test(normalized)
  )
    return "test";
  if (/(?:^|\/)scripts?(?:\/|$)/.test(normalized)) return "script";
  if (
    basename === ".env.example" ||
    /(?:^|\.)config\.[^.]+$/i.test(basename) ||
    /^(?:package|tsconfig).*\.json$/i.test(basename) ||
    /^(?:compose(?:\.[^.]+)?|docker-compose)\.ya?ml$/i.test(basename) ||
    normalized === "docs/openapi.yaml"
  )
    return "config";
  return "source";
}

export function fingerprintSourceEntries(entries) {
  const normalizedEntries = entries
    .map((entry) => ({ ...entry, path: normalizeRelativePath(entry.path) }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const files = {};
  const categoryCounts = {};
  for (const entry of normalizedEntries) {
    if (files[entry.path])
      throw new Error(`Duplicate evidence path: ${entry.path}`);
    const content = Buffer.isBuffer(entry.content)
      ? entry.content
      : Buffer.from(entry.content);
    const category = evidenceCategory(entry.path);
    files[entry.path] = {
      bytes: content.byteLength,
      category,
      sha256: createHash("sha256").update(content).digest("hex"),
    };
    categoryCounts[category] = (categoryCounts[category] ?? 0) + 1;
  }
  return {
    algorithm: "sha256",
    file_count: normalizedEntries.length,
    category_counts: Object.fromEntries(
      Object.entries(categoryCounts).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    files,
  };
}

export function parseGitStatus(statusOutput) {
  const trackedChanges = [];
  const untracked = [];
  const records = String(statusOutput).split("\0").filter(Boolean);
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.length < 4) continue;
    const status = record.slice(0, 2);
    const relativePath = normalizeRelativePath(record.slice(3));
    if (status === "??") untracked.push(relativePath);
    else trackedChanges.push(relativePath);
    if (status.includes("R") || status.includes("C")) index += 1;
  }
  trackedChanges.sort();
  untracked.sort();
  const sourcePaths = new Set(
    selectEvidencePaths([...trackedChanges, ...untracked]),
  );
  return {
    dirty: trackedChanges.length > 0 || untracked.length > 0,
    tracked_changes: trackedChanges,
    untracked,
    source_changes: {
      tracked: trackedChanges.filter((item) => sourcePaths.has(item)),
      untracked: untracked.filter((item) => sourcePaths.has(item)),
    },
  };
}

export function createGatePlan() {
  return [
    {
      id: "runner-unit",
      executable: process.execPath,
      args: ["--test", "scripts/check-api.test.mjs"],
      timeout_ms: 30_000,
    },
    {
      id: "check",
      executable: "npm",
      args: ["run", "check"],
      timeout_ms: 180_000,
    },
    {
      id: "api-unit",
      executable: "npm",
      args: [
        "run",
        "test:unit",
        "-w",
        "@wap/api",
        "--",
        "--reporter=json",
      ],
      timeout_ms: 180_000,
    },
    {
      id: "api-integration",
      executable: "npm",
      args: [
        "run",
        "test:integration",
        "-w",
        "@wap/api",
        "--",
        "--reporter=json",
      ],
      timeout_ms: 180_000,
    },
    {
      id: "db-integration",
      executable: "npm",
      args: ["run", "test:integration", "-w", "@wap/mcp-task-hub"],
      timeout_ms: 180_000,
    },
    {
      id: "engine-integration",
      executable: "npm",
      args: [
        "run",
        "test:integration",
        "-w",
        "@wap/engine",
        "--",
        "--reporter=json",
      ],
      timeout_ms: 360_000,
    },
  ];
}

function parseVitestJsonReport(value) {
  for (const line of String(value).split(/\r?\n/).reverse()) {
    const candidate = line.trim();
    if (!candidate.startsWith("{") || !candidate.endsWith("}")) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed?.testResults)) return parsed;
    } catch {
      // Keep looking: npm can print non-JSON diagnostics around the report.
    }
  }
  return null;
}

export function assessAcceptanceMatrix(
  results,
  matrix = API_ACCEPTANCE_MATRIX,
) {
  const byId = new Map(results.map((result) => [result.id, result]));
  const scenarios = matrix.map((scenario) => {
    const tests = scenario.tests.map((expected) => {
      const result = byId.get(expected.command_id);
      let status = "NOT_ESTABLISHED";
      if (result?.exit_code !== undefined && result.exit_code !== 0) {
        status = "FAIL";
      } else if (result?.exit_code === 0) {
        const report = parseVitestJsonReport(result.stdout ?? "");
        const matches = (report?.testResults ?? []).flatMap((testFile) =>
          (testFile.assertionResults ?? []).filter(
            (assertion) =>
              assertion.status === "passed" &&
              assertion.title === expected.title &&
              (!expected.file ||
                normalizeRelativePath(testFile.name).endsWith(expected.file)),
          ),
        );
        const passed = matches.length === 1;
        status = passed ? "PASS" : "NOT_ESTABLISHED";
      }
      return { ...expected, status };
    });
    const status = tests.some((item) => item.status === "FAIL")
      ? "FAIL"
      : tests.every((item) => item.status === "PASS")
        ? "PASS"
        : "NOT_ESTABLISHED";
    return { ...scenario, status, tests };
  });
  return {
    status: scenarios.some((scenario) => scenario.status === "FAIL")
      ? "FAIL"
      : scenarios.every((scenario) => scenario.status === "PASS")
        ? "PASS"
        : "NOT_ESTABLISHED",
    scenarios,
  };
}

export function selectOwnedDatabaseNames(names) {
  return [...new Set(names.map(String))]
    .filter((name) =>
      OWNED_DATABASE_PREFIXES.some((prefix) => name.startsWith(prefix)),
    )
    .sort();
}

export function selectOwnedTempRoots(names) {
  return [...new Set(names.map(String))]
    .filter((name) =>
      OWNED_TEMP_ROOT_PREFIXES.some((prefix) => name.startsWith(prefix)),
    )
    .sort();
}

export function selectOwnedProjectProcesses(records, projectRoot) {
  const normalizedRoot = normalizeRelativePath(path.resolve(projectRoot))
    .toLowerCase()
    .replace(/\/$/, "");
  const patterns = [
    [
      "api",
      /(?:^|[\/\s"'])apps\/api\/(?:src\/main\.ts|dist\/main\.js)(?:\s|$)/,
      true,
    ],
    ["task-hub", /(?:^|[\/\s"'])apps\/mcp-task-hub\//, true],
    ["filesystem-mcp", /@modelcontextprotocol\/server-filesystem/, true],
    [
      "engine-cli",
      /(?:^|[\/\s"'])packages\/engine\/(?:src\/cli\.ts|dist\/cli\.js)(?:\s|$)/,
      true,
    ],
    [
      "test-fault-worker",
      /(?:^|[\/\s"'])(?:apps\/api\/tests\/preclaim-crash-worker\.ts|packages\/engine\/tests\/(?:crash-worker|filesystem-crash-worker|filesystem-marker-crash-worker|filesystem-raw-fault-worker)\.mjs)(?:\s|$)/,
      true,
    ],
    ["vitest", /\/node_modules\/vitest\/vitest\.mjs(?:\s|$)/, false],
  ];
  return records
    .flatMap((record) => {
      const commandLine = normalizeRelativePath(record.command_line ?? "").toLowerCase();
      const match = patterns.find(
        ([, pattern, allowRelative]) =>
          pattern.test(commandLine) &&
          (allowRelative || commandLine.includes(normalizedRoot)),
      );
      return match
        ? [
            {
              pid: Number(record.pid),
              kind: match[0],
              ...(record.started_at
                ? { started_at: String(record.started_at) }
                : {}),
            },
          ]
        : [];
    })
    .filter((record) => Number.isInteger(record.pid) && record.pid > 0)
    .sort((left, right) => left.pid - right.pid || left.kind.localeCompare(right.kind));
}

export function compareCleanupSnapshots(before, after) {
  const errors = [...(before.errors ?? []), ...(after.errors ?? [])];
  const beforeDatabases = new Set(before.databases ?? []);
  const beforeTempRoots = new Set(before.temp_roots ?? []);
  const beforeProcesses = new Set(
    (before.processes ?? []).map(
      ({ pid, kind, started_at }) => `${pid}:${kind}:${started_at ?? ""}`,
    ),
  );
  const added = {
    databases: (after.databases ?? [])
      .filter((name) => !beforeDatabases.has(name))
      .sort(),
    temp_roots: (after.temp_roots ?? [])
      .filter((name) => !beforeTempRoots.has(name))
      .sort(),
    processes: (after.processes ?? [])
      .filter(
        ({ pid, kind, started_at }) =>
          !beforeProcesses.has(`${pid}:${kind}:${started_at ?? ""}`),
      )
      .sort(
        (left, right) =>
          left.pid - right.pid || left.kind.localeCompare(right.kind),
      ),
  };
  return {
    status:
      before.status === "PASS" &&
      after.status === "PASS" &&
      errors.length === 0 &&
      Object.values(added).every((items) => items.length === 0)
        ? "PASS"
        : "FAIL",
    added,
    errors,
  };
}

function commandForPlatform(executable, args) {
  if (
    process.platform === "win32" &&
    /^(?:npm|npx)(?:\.cmd)?$/i.test(executable)
  ) {
    return { file: "cmd.exe", args: ["/d", "/s", "/c", executable, ...args] };
  }
  return { file: executable, args };
}

export function runCommandSync(command, knownSecrets = []) {
  const startedAt = new Date().toISOString();
  const invocation = commandForPlatform(command.executable, command.args);
  const result = spawnSync(invocation.file, invocation.args, {
    cwd: command.cwd,
    encoding: "utf8",
    timeout: command.timeout_ms,
    windowsHide: true,
  });
  return sanitizeEvidenceValue(
    {
      id: command.id,
      command: [command.executable, ...command.args].join(" "),
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      exit_code: result.status ?? 1,
      signal: result.signal ?? null,
      timed_out: result.error?.code === "ETIMEDOUT",
      error: result.error?.message ?? null,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      cleanup_evidence: {
        status: "NOT_REPORTED_TO_RUNNER",
        independently_verified: false,
      },
    },
    knownSecrets,
  );
}

export function deriveGateAssessment(
  results,
  requiredCoverage,
  cleanupEvidence,
) {
  const failedCommands = results.filter((result) => result.exit_code !== 0);
  const reasons = Object.entries(requiredCoverage)
    .filter(([, status]) => status !== "PASS")
    .map(([name, status]) => `${name}=${status}`);
  if (cleanupEvidence.status !== "PASS")
    reasons.push(`cleanup=${cleanupEvidence.status}`);

  const commandStatus = failedCommands.length === 0 ? "PASS" : "FAIL";
  const apiTechnicalPass = commandStatus === "PASS" && reasons.length === 0;
  const hardFailure =
    commandStatus === "FAIL" || cleanupEvidence.status === "FAIL";
  return {
    command_status: commandStatus,
    api_verdict: hardFailure
      ? "NEEDS_FIX"
      : apiTechnicalPass
        ? "API_TECHNICAL_PASS"
        : "PARTIAL",
    api_technical_pass: apiTechnicalPass,
    process_exit_code: hardFailure ? 1 : reasons.length > 0 ? 2 : 0,
    reasons,
  };
}
