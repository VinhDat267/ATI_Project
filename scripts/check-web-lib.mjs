import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { gzipSync } from "node:zlib";

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

const SYNTHETIC_LEAK_PATTERNS = [
  /__WAP_FIXTURE_CALLS__/,
  /11111111-1111-4111-8111-111111111111/,
  /createFixtureTransport/,
  /synthetic-password/,
  /createWorld/,
  /WORLD_IDS/,
];

export const JS_GZIP_BUDGET_BYTES = 200 * 1024; // 204,800 bytes
export const CSS_GZIP_BUDGET_BYTES = 30 * 1024; // 30,720 bytes

export function resolveWebGateAdminUrls(env = process.env) {
  const defaultAdminUrl = "postgresql://wap:wap@127.0.0.1:55532/wap_g1";
  return [env.API_TEST_ADMIN_URL, env.G1_TEST_ADMIN_URL, defaultAdminUrl].filter(
    (value, index, values) => value && values.indexOf(value) === index,
  );
}

export function normalizeRelativePath(value) {
  return String(value).replaceAll("\\", "/").replace(/^\.\//, "");
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
  for (const secret of unique) {
    sanitized = sanitized.replaceAll(secret, "[REDACTED]");
  }
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
  if (typeof value === "string") {
    return sanitizeSensitiveText(value, knownSecrets);
  }
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

export function createWebGatePlan() {
  return [
    {
      id: "web-typecheck",
      command: ["npm", "run", "typecheck", "-w", "@wap/web"],
      description: "TypeScript typecheck across apps/web and tooling",
      timeout_ms: 180_000,
    },
    {
      id: "web-unit-tests",
      command: ["npm", "run", "test:unit", "-w", "@wap/web"],
      description: "Unit test suite for web application components and hooks",
      timeout_ms: 180_000,
    },
    {
      id: "web-strict-mode",
      command: [
        "npm",
        "exec",
        "-w",
        "@wap/web",
        "--",
        "playwright",
        "test",
        "--config=playwright.strict.config.ts",
      ],
      description:
        "Strict mode double-mounting and continuous polling validation",
      timeout_ms: 180_000,
    },
    {
      id: "web-fixture-browser",
      command: ["npm", "run", "test:browser", "-w", "@wap/web"],
      description:
        "Fixture browser tests for views, accessibility, XSS canary, session races",
      timeout_ms: 180_000,
    },
    {
      id: "web-live-browser",
      command: ["npm", "run", "test:live", "-w", "@wap/web"],
      description:
        "Live browser E2E tests against real backend and NFR-03 latency gate",
      timeout_ms: 300_000,
    },
    {
      id: "web-bundle-build",
      command: ["npm", "run", "build", "-w", "@wap/web", "--", "--mode", "live"],
      description: "Production live bundle build and asset compilation",
      timeout_ms: 180_000,
    },
  ];
}

export function compareCleanupSnapshots(before, after) {
  const errors = [...(before?.errors ?? []), ...(after?.errors ?? [])];
  const beforeDatabases = new Set(before?.databases ?? []);
  const beforeTempRoots = new Set(before?.temp_roots ?? []);
  const beforeProcesses = new Set(
    (before?.processes ?? []).map((p) =>
      typeof p === "string"
        ? p
        : `${p.pid}:${p.kind ?? ""}:${p.started_at ?? ""}`,
    ),
  );

  const addedDatabases = (after?.databases ?? [])
    .filter((name) => !beforeDatabases.has(name))
    .sort();

  const addedTempRoots = (after?.temp_roots ?? [])
    .filter((name) => !beforeTempRoots.has(name))
    .sort();

  const addedProcesses = (after?.processes ?? [])
    .filter(
      (p) =>
        !beforeProcesses.has(
          typeof p === "string"
            ? p
            : `${p.pid}:${p.kind ?? ""}:${p.started_at ?? ""}`,
        ),
    )
    .sort((left, right) => {
      if (typeof left === "string" || typeof right === "string") {
        return String(left).localeCompare(String(right));
      }
      return (
        left.pid - right.pid ||
        (left.kind ?? "").localeCompare(right.kind ?? "")
      );
    });

  const added = {
    databases: addedDatabases,
    temp_roots: addedTempRoots,
    processes: addedProcesses,
  };

  const pass =
    (before?.status === undefined || before?.status === "PASS") &&
    (after?.status === undefined || after?.status === "PASS") &&
    errors.length === 0 &&
    addedDatabases.length === 0 &&
    addedTempRoots.length === 0 &&
    addedProcesses.length === 0;

  return {
    status: pass ? "PASS" : "FAIL",
    added,
    leaked_databases: addedDatabases,
    leaked_temp_roots: addedTempRoots,
    leaked_processes: addedProcesses,
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

function extractExecutableAndArgs(command) {
  if (Array.isArray(command)) {
    return { executable: command[0], args: command.slice(1) };
  }
  if (command && Array.isArray(command.command)) {
    return { executable: command.command[0], args: command.command.slice(1) };
  }
  if (command && typeof command.executable === "string") {
    return { executable: command.executable, args: command.args ?? [] };
  }
  throw new Error("Invalid command format passed to runCommandSync");
}

export function runCommandSync(command, knownSecrets = []) {
  const { executable, args } = extractExecutableAndArgs(command);
  const startedAt = new Date().toISOString();
  const invocation = commandForPlatform(executable, args);
  const timeoutMs = command?.timeout_ms ?? 180_000;
  const cwd = command?.cwd;

  const result = spawnSync(invocation.file, invocation.args, {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true,
  });

  const commandStr = Array.isArray(command?.command)
    ? command.command.join(" ")
    : [executable, ...args].join(" ");

  return sanitizeEvidenceValue(
    {
      id: command?.id ?? [executable, ...args].join("-"),
      command: commandStr,
      description: command?.description ?? null,
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

function scanDirectoryFiles(dir) {
  const files = [];
  if (!existsSync(dir)) return files;
  const visit = (currentDir) => {
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  };
  visit(dir);
  return files;
}

export function validateBundleBudgets(distInfoOrDir) {
  let jsGzipBytes = 0;
  let cssGzipBytes = 0;
  let hasSyntheticLeak = false;
  const inspectedFiles = [];

  if (typeof distInfoOrDir === "string") {
    const distDir = path.resolve(distInfoOrDir);
    if (!existsSync(distDir)) {
      return {
        status: "FAIL",
        js_gzip_bytes: 0,
        js_budget_bytes: JS_GZIP_BUDGET_BYTES,
        css_gzip_bytes: 0,
        css_budget_bytes: CSS_GZIP_BUDGET_BYTES,
        has_synthetic_leak: false,
        reasons: [`Dist directory not found: ${distDir}`],
        inspected_files: [],
      };
    }

    const allFiles = scanDirectoryFiles(distDir);
    const jsFiles = allFiles.filter((f) => f.endsWith(".js"));
    const cssFiles = allFiles.filter((f) => f.endsWith(".css"));

    for (const file of jsFiles) {
      const content = readFileSync(file);
      const gzipped = gzipSync(content);
      jsGzipBytes += gzipped.byteLength;
      inspectedFiles.push({
        path: normalizeRelativePath(path.relative(distDir, file)),
        bytes: content.byteLength,
        gzip_bytes: gzipped.byteLength,
        type: "javascript",
      });

      const text = content.toString("utf8");
      if (SYNTHETIC_LEAK_PATTERNS.some((pattern) => pattern.test(text))) {
        hasSyntheticLeak = true;
      }
    }

    for (const file of cssFiles) {
      const content = readFileSync(file);
      const gzipped = gzipSync(content);
      cssGzipBytes += gzipped.byteLength;
      inspectedFiles.push({
        path: normalizeRelativePath(path.relative(distDir, file)),
        bytes: content.byteLength,
        gzip_bytes: gzipped.byteLength,
        type: "stylesheet",
      });
    }
  } else if (distInfoOrDir && typeof distInfoOrDir === "object") {
    jsGzipBytes =
      distInfoOrDir.jsGzipBytes ?? distInfoOrDir.js_gzip_bytes ?? 0;
    cssGzipBytes =
      distInfoOrDir.cssGzipBytes ?? distInfoOrDir.css_gzip_bytes ?? 0;
    hasSyntheticLeak = Boolean(
      distInfoOrDir.hasSyntheticLeak ??
        distInfoOrDir.has_synthetic_leak ??
        false,
    );
  }

  const reasons = [];
  if (jsGzipBytes > JS_GZIP_BUDGET_BYTES) {
    reasons.push(
      `JS gzip size ${jsGzipBytes} bytes exceeds budget ${JS_GZIP_BUDGET_BYTES} bytes (200 KiB)`,
    );
  }
  if (cssGzipBytes > CSS_GZIP_BUDGET_BYTES) {
    reasons.push(
      `CSS gzip size ${cssGzipBytes} bytes exceeds budget ${CSS_GZIP_BUDGET_BYTES} bytes (30 KiB)`,
    );
  }
  if (hasSyntheticLeak) {
    reasons.push("Synthetic fixture leaked into production bundle");
  }

  return {
    status: reasons.length === 0 ? "PASS" : "FAIL",
    js_gzip_bytes: jsGzipBytes,
    js_budget_bytes: JS_GZIP_BUDGET_BYTES,
    css_gzip_bytes: cssGzipBytes,
    css_budget_bytes: CSS_GZIP_BUDGET_BYTES,
    has_synthetic_leak: hasSyntheticLeak,
    reasons,
    inspected_files: inspectedFiles,
  };
}

export function aggregateLatencyReport(cacheFileOrData) {
  let raw = cacheFileOrData;
  if (typeof cacheFileOrData === "string") {
    const resolvedPath = path.resolve(cacheFileOrData);
    if (!existsSync(resolvedPath)) {
      return {
        sample_count: 0,
        min_ms: 0,
        max_ms: 0,
        mean_ms: 0,
        p50_ms: 0,
        p95_ms: 0,
        p95_target_ms: 3000,
        pass: false,
        error: `File not found: ${resolvedPath}`,
        observations: [],
      };
    }
    try {
      raw = JSON.parse(readFileSync(resolvedPath, "utf8"));
    } catch (err) {
      return {
        sample_count: 0,
        min_ms: 0,
        max_ms: 0,
        mean_ms: 0,
        p50_ms: 0,
        p95_ms: 0,
        p95_target_ms: 3000,
        pass: false,
        error: `JSON parse error: ${err instanceof Error ? err.message : String(err)}`,
        observations: [],
      };
    }
  }

  const obs = Array.isArray(raw) ? raw : (raw?.observations ?? []);
  if (obs.length > 0) {
    const latencies = obs
      .map((o) =>
        typeof o === "number"
          ? o
          : (o.latency_ms ?? o.delta_ms ?? 0),
      )
      .sort((a, b) => a - b);
    const sampleCount = latencies.length;
    const minMs = latencies[0] ?? 0;
    const maxMs = latencies[latencies.length - 1] ?? 0;
    const meanMs =
      sampleCount > 0
        ? Math.round(latencies.reduce((a, b) => a + b, 0) / sampleCount)
        : 0;
    const p50Index = Math.floor(sampleCount * 0.5);
    const p50Ms = latencies[p50Index] ?? 0;
    const p95Index = Math.floor(sampleCount * 0.95);
    const p95Ms = latencies[p95Index] ?? 0;
    const p95TargetMs = 3000;
    const pass = sampleCount >= 30 && p95Ms <= p95TargetMs;

    return {
      sample_count: sampleCount,
      min_ms: minMs,
      max_ms: maxMs,
      mean_ms: meanMs,
      p50_ms: p50Ms,
      p95_ms: p95Ms,
      p95_target_ms: p95TargetMs,
      pass,
      observations: obs,
    };
  }

  if (raw && typeof raw === "object") {
    const sampleCount = raw.sample_count ?? 0;
    const minMs = raw.min_ms ?? 0;
    const maxMs = raw.max_ms ?? 0;
    const meanMs = raw.mean_ms ?? 0;
    const p50Ms = raw.p50_ms ?? 0;
    const p95Ms = raw.p95_ms ?? 0;
    const p95TargetMs = raw.p95_target_ms ?? 3000;
    const pass = sampleCount >= 30 && p95Ms <= p95TargetMs;

    return {
      sample_count: sampleCount,
      min_ms: minMs,
      max_ms: maxMs,
      mean_ms: meanMs,
      p50_ms: p50Ms,
      p95_ms: p95Ms,
      p95_target_ms: p95TargetMs,
      pass,
      observations: raw.observations ?? [],
    };
  }

  return {
    sample_count: 0,
    min_ms: 0,
    max_ms: 0,
    mean_ms: 0,
    p50_ms: 0,
    p95_ms: 0,
    p95_target_ms: 3000,
    pass: false,
    observations: [],
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
    [
      "vite",
      /(?:node_modules\/vite\/bin\/vite\.js|vite(?:\.cmd|\.exe|\.ps1)?\s+(?:preview|dev|build))/,
      false,
    ],
    ["playwright", /@playwright\/test|playwright\.config/, false],
  ];

  return records
    .flatMap((record) => {
      const commandLine = normalizeRelativePath(
        record.command_line ?? "",
      ).toLowerCase();
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
    .sort(
      (left, right) =>
        left.pid - right.pid || left.kind.localeCompare(right.kind),
    );
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
  return {
    dirty: trackedChanges.length > 0 || untracked.length > 0,
    tracked_changes: trackedChanges,
    untracked,
  };
}
