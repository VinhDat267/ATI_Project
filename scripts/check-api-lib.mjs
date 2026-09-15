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
  ".git",
  "coverage",
  "dist",
  "docs/api-evidence",
  "node_modules",
  "runtime",
]);

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
      id: "engine-unit",
      executable: "npm",
      args: ["run", "test:unit", "-w", "@wap/engine"],
      timeout_ms: 180_000,
    },
    {
      id: "api-unit",
      executable: "npm",
      args: ["run", "test:unit", "-w", "@wap/api"],
      timeout_ms: 180_000,
    },
    {
      id: "api-integration",
      executable: "npm",
      args: ["run", "test:integration", "-w", "@wap/api"],
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
      args: ["run", "test:integration", "-w", "@wap/engine"],
      timeout_ms: 360_000,
    },
  ];
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
    process_exit_code: hardFailure ? 1 : 0,
    reasons,
  };
}
